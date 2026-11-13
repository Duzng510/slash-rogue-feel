import type { Sprite, SpriteSet } from "../pixelart.ts";

// Boot-time texture atlas for the WebGL2 renderer.
//
// pixelart.ts is unchanged: it still bakes every sprite as its own offscreen canvas.
// Here we blit all those canvases into ONE sheet so the whole world layer draws as a
// single instanced batch against a single NEAREST texture. Lookups are keyed by the
// source canvas element, which is the handle the (2D) renderer already resolves per draw
// (it picks the exact anim frame / mirror), so no string-keying of frames is needed.
//
// Shadows, hit-flash and elite scale are NOT packed as variants — the batch layer
// reproduces them as vertex attributes on the base sprite, keeping the sheet minimal.

/** rect in atlas pixel space; the batch layer converts to UV with the flip convention below. */
export type AtlasRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number; // anchor, from the original Sprite
  ay: number;
};

export type Atlas = {
  texture: WebGLTexture;
  rectOf: Map<HTMLCanvasElement, AtlasRect>;
  width: number;
  height: number;
};

const PAD = 1; // 1px transparent gutter blocks neighbour bleed under NEAREST sampling
const MAX_ATLAS = 2048;

/** Collect every distinct source canvas the world layer can draw. */
function collectCanvases(
  sprites: Record<string, Sprite>,
  anims: Record<string, SpriteSet>,
): Sprite[] {
  const seen = new Set<HTMLCanvasElement>();
  const out: Sprite[] = [];
  const add = (sp: Sprite | undefined): void => {
    if (!sp) return;
    if (seen.has(sp.c)) return;
    seen.add(sp.c);
    out.push(sp);
  };
  for (const key in sprites) add(sprites[key]);
  for (const key in anims) {
    const set = anims[key];
    for (const f of set.frames) add(f);
    for (const m of set.mirrored) add(m);
  }
  return out;
}

/**
 * Shelf packer: rows of fixed-height items, grow sheet width first, wrap to a new row,
 * double height (pow2) when out of room. Naive is fine at ~150 small sprites.
 */
function pack(list: Sprite[]): { rects: Map<HTMLCanvasElement, AtlasRect>; width: number; height: number } {
  const rects = new Map<HTMLCanvasElement, AtlasRect>();
  let width = MAX_ATLAS;
  let height = 256;
  let x = PAD;
  let y = PAD;
  let rowH = 0;

  // pack twice: first pass establishes the needed height, second writes final rects.
  for (let pass = 0; pass < 2; pass++) {
    x = PAD; y = PAD; rowH = 0;
    for (const sp of list) {
      const w = sp.c.width;
      const h = sp.c.height;
      if (x + w + PAD > width) {
        x = PAD;
        y += rowH + PAD;
        rowH = 0;
      }
      if (y + h + PAD > height) {
        if (pass === 1) {
          height *= 2;
          if (height > MAX_ATLAS) throw new Error(`atlas exceeds ${MAX_ATLAS}px; grow cap or split sheets`);
          // restart the second pass at the larger height
          pass = 1; x = PAD; y = PAD; rowH = 0;
          continue;
        }
        height = Math.min(MAX_ATLAS, height * 2);
      }
      if (pass === 1) {
        rects.set(sp.c, { x, y, w, h, ax: sp.ax, ay: sp.ay });
      }
      x += w + PAD;
      if (h > rowH) rowH = h;
    }
  }
  return { rects, width, height };
}

export function buildAtlas(gl: WebGLRenderingContext, sprites: Record<string, Sprite>, anims: Record<string, SpriteSet>): Atlas {
  const list = collectCanvases(sprites, anims);
  const { rects, width, height } = pack(list);

  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext("2d") as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  for (const sp of list) {
    const r = rects.get(sp.c);
    if (!r) continue;
    ctx.drawImage(sp.c, r.x, r.y);
  }

  // Raw upload (no OGL): OGL Textures only lazily upload through OGL's own render path,
  // but the batch binds the raw texture, so upload it eagerly here. Top-left of the sheet
  // maps to uv (0,0) (no Y flip) so the batch can use raw atlas pixel coords directly.
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { texture, rectOf: rects, width, height };
}
