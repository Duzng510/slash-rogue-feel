import { Renderer } from "ogl";
import { CONFIG } from "../../config.ts";
import { buildAtlas, type Atlas } from "./sprites.ts";
import { SpriteBatch } from "./batch.ts";
import type { Sprite, SpriteSet } from "../pixelart.ts";

// Thin WebGL2 executor for the renderer migration. OGL is used only for the context
// (canvas sizing / WebGL2 acquisition); every shader is raw GLSL ES 3.00 and every draw
// is issued directly, so state stays fully under our control.
//
// The scene arrives as a 320x180 texture (today a fully-composited 2D canvas uploaded via
// presentScene; later the batched atlas world-draw renders straight into the scene FBO).
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
};

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
uniform float uThreshold;
uniform float uKnee;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
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

const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;  // clean scene (tiles + entities + baked lighting), NEAREST
uniform sampler2D uBloom;  // blurred emit mask, half res, LINEAR
uniform sampler2D uFx;     // additive overlay (transparent-black when unused)
uniform sampler2D uLight;  // darkness overlay (opaque white when unused)
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
uniform float uAmbientVig;
uniform float uHazeSpeed;
uniform float uHazeFreq;
uniform float uHazeAmp;
uniform float uHazeNoise;
out vec4 fragColor;

const float BAYER[4] = float[4](0.0, 0.5, 0.75, 0.25); // 2x2 ordered dither
float bayer2(ivec2 p) {
  int idx = (p.y % 2) * 2 + (p.x % 2);
  return BAYER[idx];
}

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
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

  // chromatic aberration: split R/B along the screen radius
  vec2 dir = uv - 0.5;
  float ab = uAberr * uCrtAmt / uRes.x;
  vec3 color;
  color.r = texture(uScene, uv + dir * ab).r;
  color.g = texture(uScene, uv).g;
  color.b = texture(uScene, uv - dir * ab).b;

  color += texture(uBloom, uv).rgb * uBloomAmt;   // additive glow
  color += texture(uFx, uv).rgb;                   // additive FX overlay
  color *= texture(uLight, uv).rgb;                // darkness multiply

  // scanlines: darken alternate device rows while CRT is on
  float sl = 1.0 - uScan * uCrtAmt * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159265));
  color *= sl;

  // vignette: ambient rim (baseline, always on in GL) + dynamic hurt, ordered-dithered so the ramp doesn't band
  ivec2 qpos = ivec2(gl_FragCoord.xy);
  float rd = length(vUv - 0.5);
  float vig = smoothstep(0.45, 0.95, rd) * (uAmbientVig + uVignette);
  vig += (bayer2(qpos % ivec2(2)) - 0.5) * 0.02;
  color *= 1.0 - clamp(vig, 0.0, 1.0);

  // hurt: red push with a soft radial bias
  color = mix(color, vec3(0.62, 0.07, 0.11) * color.r * 2.2 + vec3(0.25, 0.0, 0.0), uHurt * (0.55 + 0.45 * rd));

  color *= uBrightness * inside; // black rounded tube edge + haze-outside
  fragColor = vec4(color, 1.0);
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
  private readonly bright: WebGLProgram;
  private readonly blur: WebGLProgram;
  private readonly post: WebGLProgram;
  private readonly fxTex: WebGLTexture;
  private readonly lightTex: WebGLTexture;
  private fxPending: HTMLCanvasElement | null = null;
  private lightPending: HTMLCanvasElement | null = null;

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

    this.bright = makeProgram(gl, FULLSCREEN_VS, BRIGHT_FS);
    this.blur = makeProgram(gl, FULLSCREEN_VS, BLUR_FS);
    this.post = makeProgram(gl, FULLSCREEN_VS, POST_FS);

    this.fxTex = this.makeOverlayTexture();
    this.lightTex = this.makeOverlayTexture();
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.iw, this.ih, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  private uploadOverlay(tex: WebGLTexture, canvas: HTMLCanvasElement | null, fillLit: boolean): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (canvas) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } else if (fillLit) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.iw, this.ih, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixels(this.iw, this.ih));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.iw, this.ih, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(this.iw * this.ih * 4));
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  setClearColor(r: number, g: number, b: number): void {
    this.batch.setClearColor(r, g, b);
  }

  /** queue a 2D overlay canvas to upload on the next present. */
  setFxOverlay(canvas: HTMLCanvasElement | null): void {
    this.fxPending = canvas;
  }

  setLightOverlay(canvas: HTMLCanvasElement | null): void {
    this.lightPending = canvas;
  }

  /** render the batched scene into the scene RT, then run the post chain. */
  present(params: PresentParams): void {
    const gl = this.gl;
    this.batch.render({
      width: this.iw,
      height: this.ih,
      bind: () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneRT.fbo);
        gl.viewport(0, 0, this.iw, this.ih);
      },
      unbind: () => gl.bindFramebuffer(gl.FRAMEBUFFER, null),
    });
    this.uploadOverlay(this.fxTex, this.fxPending, false);
    this.uploadOverlay(this.lightTex, this.lightPending, true);
    this.fxPending = null;
    this.lightPending = null;
    this.runPost(params);
    this.batch.clear();
  }

  /**
   * Compatibility bridge while the world is migrated in layers. The existing
   * canvas supplies the not-yet-migrated layers; queued batch sprites are then
   * drawn over it directly in the scene RT, avoiding a second scene upload.
   */
  presentSceneWithBatch(scene: HTMLCanvasElement, params: PresentParams): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    this.batch.render({
      width: this.iw,
      height: this.ih,
      bind: () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneRT.fbo);
        gl.viewport(0, 0, this.iw, this.ih);
      },
      unbind: () => gl.bindFramebuffer(gl.FRAMEBUFFER, null),
    }, false);
    this.uploadOverlay(this.fxTex, this.fxPending, false);
    this.uploadOverlay(this.lightTex, this.lightPending, true);
    this.fxPending = null;
    this.lightPending = null;
    this.runPost(params);
    this.batch.clear();
  }

  /**
   * Bootstrap integration path: the scene arrives as a fully-composited 2D canvas (every
   * existing draw* helper reused unchanged, drawn offscreen), uploaded into the scene RT,
   * then run through the GL post chain.
   */
  presentScene(scene: HTMLCanvasElement, params: PresentParams): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    // The scene arrives as a top-down 2D canvas, but the fullscreen composite samples vUv.y=0
    // at the SCREEN BOTTOM, so an unflipped upload would render the world upside down. Flip on
    // upload so canvas-top lands at V=1; the bloom passes read this same texture, so they stay aligned.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    this.uploadOverlay(this.fxTex, null, false);
    this.uploadOverlay(this.lightTex, null, true);
    this.runPost(params);
  }

  /** threshold -> horizontal blur -> vertical blur -> CRT/haze composite to the canvas. */
  private runPost(params: PresentParams): void {
    const gl = this.gl;
    const B = CONFIG.BLOOM;
    const C = CONFIG.CRT;
    const H = CONFIG.HAZE;

    // bright/emit pass: scene -> bloomA (half res)
    this.beginPass(this.bloomA, this.bright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.uniform1i(gl.getUniformLocation(this.bright, "uScene"), 0);
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
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uBloom"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
    gl.uniform1i(gl.getUniformLocation(this.post, "uFx"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
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
    gl.uniform1f(gl.getUniformLocation(this.post, "uAmbientVig"), C.AMBIENT_VIGNETTE);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeSpeed"), H.SPEED);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeFreq"), H.FREQ);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeAmp"), H.AMP);
    gl.uniform1f(gl.getUniformLocation(this.post, "uHazeNoise"), H.NOISE);
    this.endPass();
  }
}

function whitePixels(w: number, h: number): Uint8Array {
  const a = new Uint8Array(w * h * 4);
  a.fill(255);
  return a;
}
