import type { Atlas, AtlasRect } from "./sprites.ts";

// Raw WebGL2 instanced sprite batch. One interleaved per-instance buffer; two draw
// ranges (alpha list, additive list) flushed in separate draw calls so blending can
// differ. Coordinates are in the logical viewport (internal dimensions / pixel scale).

const FLOATS = 14;
const STRIDE = FLOATS * 4;

export type RenderTargetLike = { width: number; height: number; bind(): void; unbind(): void };

const VS = `#version 300 es
layout(location = 0) in vec2 aCorner;   // 0..1 unit quad
layout(location = 1) in vec4 aPosSize;  // top-left xy + size xy, internal px
layout(location = 2) in vec4 aUv;       // u0,v0,du,dv (normalized)
layout(location = 3) in vec4 aTint;     // rgba multiply
layout(location = 4) in vec2 aRotFlash; // rot radians, flash mix
uniform vec2 uInv;                       // 1 / internal size
out vec2 vUv;
out vec4 vTint;
out float vFlash;
void main() {
  vec2 off = aCorner - 0.5;
  float c = cos(aRotFlash.x), s = sin(aRotFlash.x);
  vec2 rotated = vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  vec2 px = aPosSize.xy + (rotated + 0.5) * aPosSize.zw;
  gl_Position = vec4(px * uInv * 2.0 - vec2(1.0, 1.0), 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  vUv = aUv.xy + aCorner * aUv.zw;
  vTint = aTint;
  vFlash = aRotFlash.y;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUv;
in vec4 vTint;
in float vFlash;
out vec4 fragColor;
void main() {
  vec4 t = vFlash < -0.5 ? vec4(1.0) : texture(uAtlas, vUv);
  vec3 rgb = mix(t.rgb, vec3(1.0), vFlash);
  fragColor = vec4(rgb * vTint.rgb, t.a * vTint.a);
}`;

export class SpriteBatch {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly cornerBuf: WebGLBuffer;
  private readonly normalBuf: WebGLBuffer;
  private readonly additiveBuf: WebGLBuffer;
  /** separate arrays per blend list: a normal sprite never has to shift the additive tail */
  private data: Float32Array;
  private additiveData: Float32Array;
  private normalCount = 0;
  private additiveCount = 0;
  private capacity: number;
  private additiveCapacity: number;
  private readonly invAtlas: [number, number];
  private readonly atlas: Atlas;

  constructor(gl: WebGL2RenderingContext, atlas: Atlas) {
    this.gl = gl;
    this.atlas = atlas;
    this.capacity = 1024;
    this.additiveCapacity = 1024;
    this.data = new Float32Array(this.capacity * FLOATS);
    this.additiveData = new Float32Array(this.additiveCapacity * FLOATS);
    this.invAtlas = [1 / atlas.width, 1 / atlas.height];
    this.program = this.build();

    this.vao = gl.createVertexArray()!;
    this.cornerBuf = gl.createBuffer()!;
    this.normalBuf = gl.createBuffer()!;
    this.additiveBuf = gl.createBuffer()!;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.additiveBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.additiveData.byteLength, gl.DYNAMIC_DRAW);
    const attribs: Array<[number, number, number]> = [
      [1, 4, 0],
      [2, 4, 4],
      [3, 4, 8],
      [4, 2, 12],
    ];
    for (const [loc, size, offsetFloats] of attribs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offsetFloats * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
  }

  private build(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`batch shader: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`batch link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  clear(): void {
    this.normalCount = 0;
    this.additiveCount = 0;
  }

  /** push a sprite by its source canvas (the handle the renderer already resolved). */
  drawSprite(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: readonly [number, number, number, number],
    rot = 0,
    flash = 0,
    additive = false,
    flipX = false,
  ): void {
    const rect = this.atlas.rectOf.get(canvas);
    if (rect) this.push(rect, x, y, w, h, tint, rot, flash, additive, flipX);
  }

  /** Queue a pixel-aligned solid rectangle without requiring an atlas entry. */
  drawSolidRect(x: number, y: number, w: number, h: number, tint: readonly [number, number, number, number], additive = false, rot = 0): void {
    const count = additive ? this.additiveCount : this.normalCount;
    this.ensureCapacity(additive, count + 1);
    const i = count * FLOATS;
    const a = additive ? this.additiveData : this.data;
    a[i] = x; a[i + 1] = y; a[i + 2] = w; a[i + 3] = h;
    a[i + 4] = 0; a[i + 5] = 0; a[i + 6] = 0; a[i + 7] = 0;
    a[i + 8] = tint[0]; a[i + 9] = tint[1]; a[i + 10] = tint[2]; a[i + 11] = tint[3];
    a[i + 12] = rot; a[i + 13] = -1;
    if (additive) this.additiveCount++; else this.normalCount++;
  }

  push(
    rect: AtlasRect,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: readonly [number, number, number, number],
    rot: number,
    flash: number,
    additive: boolean,
    flipX = false,
  ): void {
    const count = additive ? this.additiveCount : this.normalCount;
    this.ensureCapacity(additive, count + 1);
    const i = count * FLOATS;
    const a = additive ? this.additiveData : this.data;
    a[i] = x; a[i + 1] = y; a[i + 2] = w; a[i + 3] = h;
    a[i + 4] = (flipX ? rect.x + rect.w : rect.x) * this.invAtlas[0];
    a[i + 5] = rect.y * this.invAtlas[1];
    a[i + 6] = (flipX ? -rect.w : rect.w) * this.invAtlas[0];
    a[i + 7] = rect.h * this.invAtlas[1];
    a[i + 8] = tint[0]; a[i + 9] = tint[1]; a[i + 10] = tint[2]; a[i + 11] = tint[3];
    a[i + 12] = rot; a[i + 13] = flash;
    if (additive) this.additiveCount++; else this.normalCount++;
  }

  private ensureCapacity(additive: boolean, required: number): void {
    if (additive) {
      if (required <= this.additiveCapacity) return;
      while (this.additiveCapacity < required) this.additiveCapacity *= 2;
      const next = new Float32Array(this.additiveCapacity * FLOATS);
      next.set(this.additiveData);
      this.additiveData = next;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.additiveBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, next.byteLength, this.gl.DYNAMIC_DRAW);
      return;
    }
    if (required <= this.capacity) return;
    while (this.capacity < required) this.capacity *= 2;
    const next = new Float32Array(this.capacity * FLOATS);
    next.set(this.data);
    this.data = next;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, next.byteLength, this.gl.DYNAMIC_DRAW);
  }

  private flushRange(data: Float32Array, count: number, additive: boolean): void {
    if (count === 0) return;
    const gl = this.gl;
    const buf = additive ? this.additiveBuf : this.normalBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLOATS);
    // point the instance attributes at the buffer base (each blend list owns its buffer)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE, 16);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STRIDE, 32);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, STRIDE, 48);
    if (additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  render(target: RenderTargetLike | null, clear = true): void {
    const gl = this.gl;
    if (target) target.bind();
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const vw = target ? target.width : gl.drawingBufferWidth;
    const vh = target ? target.height : gl.drawingBufferHeight;
    gl.viewport(0, 0, vw, vh);
    gl.enable(gl.BLEND);
    if (clear) {
      gl.clearColor(this.clearR, this.clearG, this.clearB, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (this.normalCount + this.additiveCount === 0) {
      if (target) target.unbind();
      return;
    }
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, "uInv"), 1 / vw, 1 / vh);
    this.flushRange(this.data, this.normalCount, false);
    this.flushRange(this.additiveData, this.additiveCount, true);
    gl.bindVertexArray(null);
    if (target) target.unbind();
  }

  clearR = 0;
  clearG = 0;
  clearB = 0;

  setClearColor(r: number, g: number, b: number): void {
    this.clearR = r; this.clearG = g; this.clearB = b;
  }
}
