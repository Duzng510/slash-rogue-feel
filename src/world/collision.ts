import { CONFIG } from "../config.ts";

export type Body = { x: number; y: number; vx: number; vy: number; bodyW: number; bodyH: number };

type Block = { hitX: boolean; hitY: boolean };

function blocked(room: RoomLike, x: number, y: number, w: number, h: number): boolean {
  const T = CONFIG.WORLD.TILE;
  const x0 = x - w / 2;
  const y0 = y - h;
  return (
    room.isSolid(Math.floor(x0 / T), Math.floor(y0 / T)) ||
    room.isSolid(Math.floor((x0 + w - 0.01) / T), Math.floor(y0 / T)) ||
    room.isSolid(Math.floor(x0 / T), Math.floor((y0 + h - 0.01) / T)) ||
    room.isSolid(Math.floor((x0 + w - 0.01) / T), Math.floor((y0 + h - 0.01) / T))
  );
}

export interface RoomLike {
  isSolid(tx: number, ty: number): boolean;
  exitsAt(px: number, py: number): boolean;
}

/** Axis-separated movement so a body sliding along a wall keeps its tangential speed. */
export function moveBody(b: Body, room: RoomLike, dt: number): Block {
  const out: Block = { hitX: false, hitY: false };
  const dx = b.vx * dt;
  if (dx !== 0) {
    if (blocked(room, b.x + dx, b.y, b.bodyW, b.bodyH)) {
      out.hitX = true;
      b.vx = 0;
    } else {
      b.x += dx;
    }
  }
  const dy = b.vy * dt;
  if (dy !== 0) {
    if (blocked(room, b.x, b.y + dy, b.bodyW, b.bodyH)) {
      out.hitY = true;
      b.vy = 0;
    } else {
      b.y += dy;
    }
  }
  return out;
}
