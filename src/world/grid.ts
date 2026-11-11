import type { Unit } from "../sim/types.ts";

const CELL = 32; // >= attack reach so a small pad window always covers a hit
const OFFSET = 1024;

function key(cx: number, cy: number): number {
  return (cx + OFFSET) * 8192 + (cy + OFFSET);
}

/** Uniform spatial hash rebuilt each tick; query returns candidate units near a point. */
export class SpatialGrid {
  private cells = new Map<number, Unit[]>();
  private scratch: Unit[] = [];

  clear(): void {
    this.cells.clear();
  }

  insert(u: Unit): void {
    const k = key(Math.floor(u.x / CELL), Math.floor(u.y / CELL));
    const b = this.cells.get(k);
    if (b) b.push(u);
    else this.cells.set(k, [u]);
  }

  /** units in cells overlapping radius r of (x,y); result is reused, so read before next call */
  query(x: number, y: number, r: number): Unit[] {
    this.scratch.length = 0;
    const pad = Math.ceil(r / CELL) + 1;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let oy = -pad; oy <= pad; oy++) {
      for (let ox = -pad; ox <= pad; ox++) {
        const b = this.cells.get(key(cx + ox, cy + oy));
        if (b) for (let i = 0; i < b.length; i++) this.scratch.push(b[i]);
      }
    }
    return this.scratch;
  }
}
