import { Renderer } from "ogl";
import { CONFIG } from "../../config.ts";
import { buildAtlas, type Atlas } from "./sprites.ts";
import { SpriteBatch, type RenderTargetLike } from "./batch.ts";
import type { Sprite, SpriteSet } from "../pixelart.ts";

// Thin WebGL2 executor for the renderer migration. OGL is used only for the context
// (canvas sizing / WebGL2 acquisition); every shader is raw GLSL ES 3.00 and every draw
// is issued directly, so state stays fully under our control.
//
// The scene is rendered at CONFIG.WORLD.INTERNAL_W × CONFIG.WORLD.INTERNAL_H pixels by the
// instanced SpriteBatch; Canvas-only effects are composited as a transparent overlay.
// The post chain runs on top of it: threshold -> separable gaussian bloom -> CRT barrel
// warp + scanlines + chromatic aberration + heat-haze/ripple displacement + dithered
// vignette. Every strength is a uniform fed from CONFIG x SLIDERS, so effects stay graduated.

export type PresentParams = {
  hurt: number;
  vignette: number;
  brightness: number;
  bloom: number;
  crt: number;
  ripple: number;
  time: number;
  lights: Float32Array;
  cols: Float32Array;
  lightCount: number;
  ambient: number;
  /** optional grade/saturate: when the 2D path already baked them (presentScene) leave undefined → no-op */
  grade?: readonly [number, number, number];
  gradeAmt?: number;
  saturate?: number;
  biomeDistortion?: 0 | 1 | 2 | 3;
  fogColor?: readonly [number, number, number];
  fogAmount?: number;
  fogTime?: number;
};

/** presentComposited extras: the same params plus the kill-cam geometric zoom for the composite. */
export type PresentCompositedParams = PresentParams & { zoom: number; overlayDirty?: boolean };

const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 v[3];
  v[0] = vec2(-1., -1.); v[1] = vec2(3., -1.); v[2] = vec2(-1., 3.);
  vec2 p = v[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0., 1.);
}`;

// soft-knee threshold: keep only pixels bright enough to emit into the glow, at half res
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uLight;
uniform float uThreshold;
uniform float uKnee;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb * texture(uLight, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float emit = smoothstep(uThreshold, uThreshold + uKnee, lum);
  fragColor = vec4(c * emit, 1.0);
}`;

// separable 5-tap gaussian (linear-sampled weights sum to 1); uDir picks the axis
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uRadius;
out vec4 fragColor;
void main() {
  vec2 o = uTexel * uDir * uRadius;
  vec3 sum = texture(uSrc, vUv).rgb * 0.2270270270;
  sum += (texture(uSrc, vUv + o * 1.3846153846).rgb + texture(uSrc, vUv - o * 1.3846153846).rgb) * 0.3162162162;
  sum += (texture(uSrc, vUv + o * 3.2307692308).rgb + texture(uSrc, vUv - o * 3.2307692308).rgb) * 0.0702702703;
  fragColor = vec4(sum, 1.0);
}`;

// light map: ambient floor + sum of radial emitters (xy=pos px, z=radius, w=intensity), internal res
const LIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform int uCount;
uniform float uAmbient;
uniform vec4 uLights[32];
uniform vec3 uCols[32];
out vec4 fragColor;
void main() {
  vec2 p = vUv * uRes;
  vec3 light = vec3(uAmbient);
  for (int i = 0; i < 32; i++) {
    if (i >= uCount) break;
    vec4 L = uLights[i];
    float f = clamp(1.0 - distance(p, L.xy) / L.z, 0.0, 1.0);
    light += uCols[i] * (L.w * f * f);
  }
  fragColor = vec4(light, 1.0);
}`;

const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;  // clean scene (tiles + entities + baked lighting), NEAREST
uniform sampler2D uBloom;  // blurred emit mask, half res, LINEAR
uniform sampler2D uFx;     // additive overlay (transparent-black when unused)
uniform sampler2D uLight;  // light map, internal res, NEAREST
uniform vec2 uRes;         // internal size in px
uniform float uTime;
uniform float uBloomAmt;
uniform float uCrtAmt;
uniform float uRippleAmt;
uniform float uVignette;   // dynamic hurt / low-hp rim 0..1
uniform float uHurt;
uniform float uBrightness;
uniform float uBarrel;
uniform float uScan;
uniform float uAberr;
uniform float uHazeSpeed;
uniform float uHazeFreq;
uniform float uHazeAmp;
uniform float uHazeNoise;
uniform vec3 uGrade;      // biome "color" grade tint (0..1)
uniform float uGradeAmt;  // grade strength (0 = no-op, presentScene bakes it in 2D instead)
uniform float uSaturate;  // kill-cam saturate factor (1 = no-op)
uniform int uBiomeDistortion; // 1 forge, 2 caverns, 3 void
uniform float uPixelScale;
uniform vec3 uFogColor;
uniform float uFogAmount;
uniform float uFogTime;
out vec4 fragColor;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 crtWarp(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  return c * (1.0 + uBarrel * uCrtAmt * r2) * 0.5 + 0.5;
}

vec2 haze(vec2 uv) {
  float t = uTime * uHazeSpeed;
  float amp = uHazeAmp * uRippleAmt;
  if (amp <= 0.0) return uv;
  // heat wobble stronger toward the bottom of the screen
  float w = uv.y;
  uv.x += sin(uv.y * uHazeFreq * uRes.y + t * 2.0) * amp / uRes.x * w;
  // ripple: blend a radial sine with animated value-noise (uHazeNoise picks the mix)
  vec2 d = uv - 0.5;
  float rr = length(d);
  float radial = sin(rr * 42.0 - t * 3.0);
  float nz = vnoise(uv * uRes * 0.15 + vec2(t * 0.6, -t * 0.4)) * 2.0 - 1.0;
  float ripple = mix(radial, nz, uHazeNoise);
  uv += (d / (rr + 1e-6)) * ripple * amp * 0.4 / uRes.x;
  return uv;
}

void main() {
  vec2 uv = haze(crtWarp(vUv));
  vec2 sceneUv = uv;
  if (uBiomeDistortion == 1) {
    float logicalY = (1.0 - uv.y) * uRes.y / uPixelScale;
    sceneUv.x += sin(logicalY * 0.3 + uTime * 2.2) * 1.5 * uPixelScale / uRes.x;
  }
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

  // chromatic aberration: split R/B along the screen radius
  vec2 dir = uv - 0.5;
  float ab = uAberr * uCrtAmt / uRes.x;
  vec3 color;
  color.r = texture(uScene, sceneUv + dir * ab).r;
  color.g = texture(uScene, sceneUv).g;
  color.b = texture(uScene, sceneUv - dir * ab).b;
  if (uBiomeDistortion == 2) {
    float edge = 4.0 * uPixelScale / uRes.x;
    float left = 1.0 - smoothstep(edge * 0.7, edge, vUv.x);
    float right = smoothstep(1.0 - edge, 1.0 - edge * 0.7, vUv.x);
    float top = smoothstep(1.0 - edge, 1.0 - edge * 0.7, vUv.y);
    float bottom = 1.0 - smoothstep(edge * 0.7, edge, vUv.y);
    vec3 echo = vec3(0.0);
    float weight = 0.0;
    if (left > 0.0) { echo += texture(uScene, sceneUv + vec2(1.0 / uRes.x, 0.0)).rgb * left; weight += left; }
    if (right > 0.0) { echo += texture(uScene, sceneUv - vec2(1.0 / uRes.x, 0.0)).rgb * right; weight += right; }
    if (top > 0.0) { echo += texture(uScene, sceneUv + vec2(0.0, 1.0 / uRes.y)).rgb * top; weight += top; }
    if (bottom > 0.0) { echo += texture(uScene, sceneUv - vec2(0.0, 1.0 / uRes.y)).rgb * bottom; weight += bottom; }
    if (weight > 0.0) color = mix(color, echo / weight, 0.3 * min(1.0, weight));
  }
  if (uBiomeDistortion == 3) {
    float shift = uPixelScale / uRes.x;
    color.r += texture(uScene, sceneUv + vec2(shift, 0.0)).r * 0.2;
    color.b += texture(uScene, sceneUv - vec2(shift, 0.0)).b * 0.2;
  }
  if (uFogAmount > 0.0) {
    vec2 fogPx = vec2(uv.x * uRes.x / 3.0, (1.0 - uv.y) * uRes.y / 3.0);
    float fog = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 center = vec2(
        160.0 * (0.5 + 0.45 * sin(uFogTime * (0.3 + fi * 0.13) + fi * 1.7)),
        90.0 * (0.5 + 0.4 * cos(uFogTime * (0.2 + fi * 0.11) + fi * 2.3))
      );
      float radius = max(10.0, 26.0 + 12.0 * sin(uFogTime * 0.8 + fi));
      float blob = clamp(1.0 - distance(fogPx, center) / radius, 0.0, 1.0);
      fog = 1.0 - (1.0 - fog) * (1.0 - blob);
    }
    vec3 fogLight = uFogColor * (fog * uFogAmount);
    color = vec3(1.0) - (vec3(1.0) - color) * (vec3(1.0) - fogLight);
  }
  color *= texture(uLight, uv).rgb;              // darkness falls on the scene, not on emissive glow

  color += texture(uBloom, uv).rgb * uBloomAmt;   // additive glow
  color += texture(uFx, uv).rgb;                   // additive FX overlay

  // scanlines: darken alternate device rows while CRT is on
  float sl = 1.0 - uScan * uCrtAmt * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159265));
  color *= sl;

  // dynamic hurt / low-health vignette
  float rd = length(vUv - 0.5);
  float vig = smoothstep(0.45, 0.95, rd) * uVignette;
  color *= 1.0 - clamp(vig, 0.0, 1.0);

  // hurt: red push with a soft radial bias
  color = mix(color, vec3(0.62, 0.07, 0.11) * color.r * 2.2 + vec3(0.25, 0.0, 0.0), uHurt * (0.55 + 0.45 * rd));

  // kill-cam desaturation (replaces the 2D g.filter saturate for the composited path)
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, uSaturate);
  // biome "color" grade: keep luminance, tint chroma toward uGrade (replaces the 2D source-over "color" op)
  if (uGradeAmt > 0.001) {
    float gLum = dot(uGrade, vec3(0.2126, 0.7152, 0.0722));
    vec3 gcol = vec3(lum) + (uGrade - vec3(gLum));
    color = mix(color, mix(vec3(lum), gcol, 0.7), uGradeAmt);
  }

  color *= uBrightness * inside; // black rounded tube edge + haze-outside
  fragColor = vec4(color, 1.0);
}`;

// composite for the batched scene path: opaque sceneRT (GPU world + outside) UNDER a
// transparent overTex (2D entity/fx/text passes), source-over. uZoom applies the kill-cam
// geometric zoom to BOTH layers at once so neither double-zooms (the 2D overlay is NOT
// transform-scaled in this path — that is the whole point of folding zoom here).
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uOver;
uniform float uZoom;
out vec4 fragColor;
void main() {
  vec2 uv = (vUv - 0.5) / uZoom + 0.5;
  vec4 s = texture(uScene, uv);
  vec4 o = texture(uOver, uv);
  fragColor = vec4(mix(s.rgb, o.rgb, o.a), 1.0);
}`;

function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

type RT = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };

export class GLPipeline {
  readonly gl: WebGL2RenderingContext;
  readonly batch: SpriteBatch;
  private readonly atlas: Atlas;
  private readonly sceneRT: RT;
  private readonly bloomA: RT;
  private readonly bloomB: RT;
  private readonly lightRT: RT;
  private readonly light: WebGLProgram;
  private readonly bright: WebGLProgram;
  private readonly blur: WebGLProgram;
  private readonly post: WebGLProgram;
  private readonly fxTex: WebGLTexture;
  private readonly compRT: RT;
  private readonly overRT: RT;
  private readonly overTex: WebGLTexture;
  private readonly composite: WebGLProgram;
  private overlayUploaded = false;

  /** true while tiles participate in the GPU batch, including the default world path */
  batchTiles = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly iw: number,
    private readonly ih: number,
    sprites: Record<string, Sprite>,
    anims: Record<string, SpriteSet>,
  ) {
    const ogl = new Renderer({ canvas, width: iw, height: ih, dpr: 1, alpha: false, antialias: false, preserveDrawingBuffer: true });
    this.gl = ogl.gl as WebGL2RenderingContext;
    const gl = this.gl;

    this.atlas = buildAtlas(gl, sprites, anims);
    this.batch = new SpriteBatch(gl, this.atlas);

    this.sceneRT = this.makeRT(iw, ih, gl.NEAREST);
    const bw = Math.max(1, Math.floor(iw / 2));
    const bh = Math.max(1, Math.floor(ih / 2));
    this.bloomA = this.makeRT(bw, bh, gl.LINEAR);
    this.bloomB = this.makeRT(bw, bh, gl.LINEAR);
    this.lightRT = this.makeRT(iw, ih, gl.NEAREST);

    this.light = makeProgram(gl, FULLSCREEN_VS, LIGHT_FS);
    this.bright = makeProgram(gl, FULLSCREEN_VS, BRIGHT_FS);
    this.blur = makeProgram(gl, FULLSCREEN_VS, BLUR_FS);
    this.post = makeProgram(gl, FULLSCREEN_VS, POST_FS);

    this.fxTex = this.makeOverlayTexture();
    this.compRT = this.makeRT(iw, ih, gl.NEAREST);
    this.overRT = this.makeRT(iw, ih, gl.NEAREST);
    this.overTex = this.overRT.tex;
    this.clearOverlayTarget();
    this.composite = makeProgram(gl, FULLSCREEN_VS, COMPOSITE_FS);
  }

  private makeRT(w: number, h: number, filter: number): RT {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("RT FBO incomplete");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { tex, fbo, w, h };
  }

  /** Adapt our RT to the batch's minimal bind target (width/height/bind/unbind). */
  private rtAsTarget(rt: RT): RenderTargetLike {
    const gl = this.gl;
    return {
      width: rt.w, height: rt.h,
      bind: () => { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); },
      unbind: () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); },
    };
  }

  /** Queue-clear and set the opaque outside color (0..1 rgb) the tile batch clears sceneRT to. */
  beginTileBatch(outsideRgb: readonly [number, number, number]): void {
    this.batch.clear();
    this.batch.setClearColor(outsideRgb[0], outsideRgb[1], outsideRgb[2]);
  }

  /** Draw all queued tile quads into sceneRT (opaque, cleared to the outside color). */
  flushTileBatch(): void {
    this.batch.render(this.rtAsTarget(this.sceneRT), true);
  }

  /** Bind sceneRT and read its RGBA pixels back to the CPU, then restore the default framebuffer. */
  exportSceneRT(): Uint8Array | null {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneRT.fbo);
    const buf = new Uint8Array(this.iw * this.ih * 4);
    gl.readPixels(0, 0, this.iw, this.ih, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
  }

  /** bind an RT (or the default framebuffer) and select a program; uniforms are set before endPass(). */
  private beginPass(target: RT | null, program: WebGLProgram): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindVertexArray(null);
  }

  private endPass(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** a NEAREST texture pre-sized to the internal resolution, refreshed from a 2D canvas. */
  private makeOverlayTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.iw, this.ih, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(this.iw * this.ih * 4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  private uploadOverlay(tex: WebGLTexture, canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private clearOverlayTarget(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.overRT.fbo);
    gl.viewport(0, 0, this.overRT.w, this.overRT.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Fully-composited 2D canvas (all layers correctly ordered, depth-sorted, and text-overlaid)
   * uploaded into the scene RT, then run through the GL post chain (bloom, CRT warp, scanlines, ripple).
   */
  presentScene(scene: HTMLCanvasElement, params: PresentParams): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    this.runPostFrom(this.sceneRT, params);
  }

  /**
   * Batched-scene present: the GPU world is in sceneRT. Composite the optional 2D overlay
   * over it, then run the post chain. Empty overlay transitions are cleared on the GPU.
   */
  presentComposited(over: HTMLCanvasElement, params: PresentCompositedParams): void {
    const gl = this.gl;
    if (params.overlayDirty === false) {
      if (this.overlayUploaded) {
        this.clearOverlayTarget();
        this.overlayUploaded = false;
      }
    } else {
      // FLIP_Y=true so the 2D canvas top row lands at texel row 0, matching the batch-drawn sceneRT.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.uploadOverlay(this.overTex, over);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.overlayUploaded = true;
    }

    this.beginPass(this.compRT, this.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.uniform1i(gl.getUniformLocation(this.composite, "uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overTex);
    gl.uniform1i(gl.getUniformLocation(this.composite, "uOver"), 1);
    gl.uniform1f(gl.getUniformLocation(this.composite, "uZoom"), params.zoom);
    this.endPass();

    this.runPostFrom(this.compRT, params);
  }

  /** threshold -> horizontal blur -> vertical blur -> CRT/haze composite of `scene` to the canvas. */
  private runPostFrom(scene: RT, params: PresentParams): void {
    const gl = this.gl;
    const B = CONFIG.BLOOM;
    const C = CONFIG.CRT;
    const H = CONFIG.HAZE;

    // light map pass: ambient + emitters, before bloom so dark regions cannot emit
    this.beginPass(this.lightRT, this.light);
    gl.uniform2f(gl.getUniformLocation(this.light, "uRes"), this.iw, this.ih);
    gl.uniform1i(gl.getUniformLocation(this.light, "uCount"), params.lightCount);
    gl.uniform1f(gl.getUniformLocation(this.light, "uAmbient"), params.ambient);
    gl.uniform4fv(gl.getUniformLocation(this.light, "uLights"), params.lights);
    gl.uniform3fv(gl.getUniformLocation(this.light, "uCols"), params.cols);
    this.endPass();

    // bright/emit pass: lit scene -> bloomA (half res)
    this.beginPass(this.bloomA, this.bright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.bright, "uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lightRT.tex);
    gl.uniform1i(gl.getUniformLocation(this.bright, "uLight"), 1);
    gl.uniform1f(gl.getUniformLocation(this.bright, "uThreshold"), B.THRESHOLD);
    gl.uniform1f(gl.getUniformLocation(this.bright, "uKnee"), B.KNEE);
    this.endPass();

    // separable gaussian: bloomA -> bloomB (horizontal), bloomB -> bloomA (vertical)
    const texel = 1 / this.bloomA.w;
    const texelY = 1 / this.bloomA.h;
    this.beginPass(this.bloomB, this.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform1i(gl.getUniformLocation(this.blur, "uSrc"), 0);
    gl.uniform2f(gl.getUniformLocation(this.blur, "uTexel"), texel, texelY);
    gl.uniform2f(gl.getUniformLocation(this.blur, "uDir"), 1, 0);
    gl.uniform1f(gl.getUniformLocation(this.blur, "uRadius"), B.RADIUS);
    this.endPass();

    this.beginPass(this.bloomA, this.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
    gl.uniform1i(gl.getUniformLocation(this.blur, "uSrc"), 0);
    gl.uniform2f(gl.getUniformLocation(this.blur, "uTexel"), texel, texelY);
    gl.uniform2f(gl.getUniformLocation(this.blur, "uDir"), 0, 1);
    gl.uniform1f(gl.getUniformLocation(this.blur, "uRadius"), B.RADIUS);
    this.endPass();

    // final composite: scene + bloom + overlays -> canvas
    this.beginPass(null, this.post);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uBloom"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uFx"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.lightRT.tex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uLight"), 3);
    gl.uniform2f(gl.getUniformLocation(this.post, "uRes"), this.iw, this.ih);
    gl.uniform1f(gl.getUniformLocation(this.post, "uTime"), params.time);
    gl.uniform1f(gl.getUniformLocation(this.post, "uBloomAmt"), params.bloom * B.INTENSITY);
    gl.uniform1f(gl.getUniformLocation(this.post, "uCrtAmt"), params.crt);
    gl.uniform1f(gl.getUniformLocation(this.post, "uRippleAmt"), params.ripple);
    gl.uniform1f(gl.getUniformLocation(this.post, "uVignette"), params.vignette);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHurt"), params.hurt);
    gl.uniform1f(gl.getUniformLocation(this.post, "uBrightness"), params.brightness);
    gl.uniform1f(gl.getUniformLocation(this.post, "uBarrel"), C.BARREL);
    gl.uniform1f(gl.getUniformLocation(this.post, "uScan"), C.SCANLINE);
    gl.uniform1f(gl.getUniformLocation(this.post, "uAberr"), C.ABERRATION);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeSpeed"), H.SPEED);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeFreq"), H.FREQ);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeAmp"), H.AMP);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeNoise"), H.NOISE);
    const g3 = params.grade ?? [0, 0, 0];
    gl.uniform3f(gl.getUniformLocation(this.post, "uGrade"), g3[0], g3[1], g3[2]);
    gl.uniform1f(gl.getUniformLocation(this.post, "uGradeAmt"), params.gradeAmt ?? 0);
    gl.uniform1f(gl.getUniformLocation(this.post, "uSaturate"), params.saturate ?? 1);
    gl.uniform1i(gl.getUniformLocation(this.post, "uBiomeDistortion"), params.biomeDistortion ?? 0);
    gl.uniform1f(gl.getUniformLocation(this.post, "uPixelScale"), CONFIG.WORLD.PIXEL_SCALE);
    const fog = params.fogColor ?? [0, 0, 0];
    gl.uniform3f(gl.getUniformLocation(this.post, "uFogColor"), fog[0], fog[1], fog[2]);
    gl.uniform1f(gl.getUniformLocation(this.post, "uFogAmount"), params.fogAmount ?? 0);
    gl.uniform1f(gl.getUniformLocation(this.post, "uFogTime"), params.fogTime ?? 0);
    this.endPass();
  }
}
