import { CONFIG } from "../config.ts";
import { clamp, makeRng } from "../mathx.ts";
import { buildTownRows } from "./town.ts";
import type { EnemyKind } from "../config.ts";

export const TILE = {
  FLOOR: 0,
  ACCENT: 1,
  WALL: 2,
  CRATE: 3,
  DOOR: 4,
  DOOR_OPEN: 5,
  TRAP: 6,
  TRAP_ARMED: 7,
  GRASS: 8,
  ROAD: 9,
  FLOOR_WOOD: 10,
  DOOR_TOWN: 11,
  FENCE: 12,
} as const;

export type Tile = (typeof TILE)[keyof typeof TILE];

/** E chaser, C charger, T splitter, B boss, R ranged, P teleporter, H healer, X exploder, D shielder, N sniper, J jumper, W warden, G golem, K king; S stays the player start, O crate, ^ spike trap */
export const MARKER_KIND: Record<string, EnemyKind> = {
  E: "chaser",
  C: "charger",
  T: "splitter",
  B: "boss",
  R: "ranged",
  P: "teleporter",
  H: "healer",
  X: "exploder",
  D: "shielder",
  N: "sniper",
  J: "jumper",
  W: "warden",
  G: "golem",
  K: "king",
};

export type SpawnMark = { x: number; y: number; kind: EnemyKind };

export type RoomKind = "combat" | "town" | "shop" | "treasure" | "rest" | "elite" | "event" | "shrine" | "boss" | "challenge";

export type Template = {
  name: string;
  rows: string[];
  shop?: boolean;
  /** scene the template belongs to; omitted means "combat" */
  kind?: RoomKind;
};

const FLOOR_ROW = ".".repeat(22);

/**
 * The town grid is generated from HOUSES (see world/town.ts) rather than typed, so the map and the
 * house data cannot drift apart: one source describes a wall ring, an interior and a door.
 */
export const TOWN_TEMPLATE: Template = {
  name: "Thị trấn",
  kind: "town",
  rows: buildTownRows(),
};

export const TEMPLATES: Template[] = [
  {
    name: "Sảnh vào",
    rows: [
      "......................",
      "..O..............O....",
      FLOOR_ROW,
      "....E.........E.........",
      FLOOR_ROW,
      "......OO................",
      ".....S................",
      "..........E.............",
      FLOOR_ROW,
      "....O..........O........",
      FLOOR_ROW,
      "......................",
    ],
  },
  {
    name: "Kho nứt",
    rows: [
      "......................",
      "...OO.......OO........",
      "....C.....R....T......",
      "......................",
      ".........OO...........",
      "S......E....E.........",
      ".........OO...........",
      "......................",
      "....O...........O.....",
      "......................",
      ".........E............",
      "..............H....D..",
    ],
  },
  {
    name: "Sân cột",
    rows: [
      "....O....O....O....O..",
      "..C.......P......T....",
      "......................",
      "....O....O....O....O..",
      "S.....................",
      "..E......E......E.....",
      "....O....O....O....O..",
      "......................",
      "..T..............C....",
      "....O....O....O....O..",
      "......................",
      ".........E.......X..J.",
    ],
  },
  {
    name: "Lò đúc",
    rows: [
      "OOOO..............OOOO",
      "O..................O..",
      "..C...E....R...T......",
      "O..................O..",
      "OOO....OOOO....OOO....",
      "S.....................",
      "..P...T....C...E......",
      "OOO....OOOO....OOO....",
      "O..................O..",
      "..E.........C.........",
      "O..................O..",
      "OOOO.......N......OOOO",
    ],
  },
  {
    name: "Hành lang hẹp",
    rows: [
      "OOOOOOOOOOOOOOOOOOOOOO",
      "S............OOOOOOOOO",
      "...........D.OOOOOOOOO",
      "OOOOOOOOOOOO........CR",
      "OOOOOOOOOOOOT......E.P",
      "OOOOOOOOOOOOOOOOOOOOOO",
      "OOOOOOOOOOOOOOOOOOOOOO",
      "OOOOOOOOOOOOOOOOOOOOOO",
    ],
  },
  {
    name: "Đấu trường",
    rows: [
      "......................",
      "..E......E......E.....",
      "......................",
      "..C....OO....OO....T..",
      "......................",
      "S.......E..E.......W..",
      "......................",
      "..T....OO....OO....C..",
      "......................",
      "..E......E......E.....",
      "......................",
      ".........P.......H..X.",
    ],
  },
  {
    name: "Mê cung",
    rows: [
      "......................",
      ".....O.....O.....O....",
      ".....O.....O.....O....",
      "..E..O..C..O..T..O....",
      ".....O.....O.....O....",
      ".....O.....O.....O....",
      "S....O.....O.....O....",
      ".....O.....O.....O....",
      "..T..O..E..O..C..O..R.",
      ".....O.....O.....O....",
      ".....O..H..O.....O....",
      "......................",
    ],
  },
  {
    name: "Đấu trường mở",
    rows: [
      "......................",
      "..E....E....E....E....",
      "......................",
      "..C....T....R....C....",
      "......................",
      "S.....................",
      "...........G..........",
      "..E....X....E....T....",
      "......................",
      "..P....E....C....E....",
      "......................",
      "......................",
    ],
  },
  {
    name: "Phòng kho báu",
    kind: "treasure",
    rows: [
      "......................",
      "..OO..............OO..",
      "......................",
      "......................",
      "......................",
      "S.....................",
      "......................",
      "......................",
      "......................",
      "......................",
      "..OO..............OO..",
      "......................",
    ],
  },
  {
    name: "Bẫy",
    rows: [
      "......................",
      "...^^^^......^^^^.....",
      "......................",
      "..E...^^^..T...^^^....",
      "......................",
      "S.....^^^^^^^^........",
      "......................",
      "..C...^^^..E...^^^....",
      "......................",
      "...^^^^......^^^^.....",
      "......................",
      "......................",
    ],
  },
  {
    name: "Cửa hàng",
    kind: "shop",
    shop: true,
    rows: [
      "......................",
      "..OO..............OO..",
      "......................",
      "....OO..........OO....",
      "......................",
      "S.....................",
      "......................",
      "....OO..........OO....",
      "......................",
      "......................",
      "..OO..............OO..",
      "......................",
    ],
  },
  {
    name: "Lửa trại",
    kind: "rest",
    rows: [
      "......................",
      "..O................O..",
      "......................",
      "......................",
      "......................",
      "S.....................",
      "......................",
      "......................",
      "......................",
      "......................",
      "..O................O..",
      "......................",
    ],
  },
  {
    name: "Sàn tinh anh",
    kind: "elite",
    rows: [
      "......................",
      "..O................O..",
      "......................",
      "......................",
      "......................",
      "S.....................",
      "......................",
      "......................",
      "......................",
      "......................",
      "..O................O..",
      "......................",
    ],
  },
  {
    name: "Giếng cổ",
    kind: "event",
    rows: [
      "......................",
      "..O................O..",
      "......................",
      "......................",
      "......................",
      "S.....................",
      "......................",
      "......................",
      "......................",
      "......................",
      "..O................O..",
      "......................",
    ],
  },
  {
    name: "Đền thờ",
    kind: "shrine",
    rows: [
      "......................",
      "..O................O..",
      "......................",
      "......................",
      "......................",
      "S.....................",
      "......................",
      "......................",
      "......................",
      "......................",
      "..O................O..",
      "......................",
    ],
  },
  {
    name: "Thử thách",
    kind: "challenge",
    rows: [
      "......................",
      "......................",
      "..E......C......R.....",
      "......................",
      "......................",
      "S.....................",
      "......................",
      "......................",
      "......................",
      "......................",
      "......................",
      "......................",
    ],
  },
  {
    name: "Sàn nghi thức",
    kind: "boss",
    rows: [
      "..........................",
      "..O....O........O....O....",
      "..........................",
      "....O..................O....",
      "..........................",
      "S.............K.............",
      "..........................",
      "....O..................O....",
      "..........................",
      "..O....O........O....O....",
      "..........................",
      "..........................",
    ],
  },
];

export class Room {
  readonly w: number;
  readonly h: number;
  readonly index: number;
  readonly name: string;
  readonly kind: RoomKind;
  get shop(): boolean {
    return this.kind === "shop";
  }
  readonly tiles: Uint8Array;
  readonly spawns: SpawnMark[] = [];
  /** wall torches: one every ~8 wall tiles, flicker phase varies per torch */
  readonly torches: { x: number; y: number; phase: number }[] = [];
  readonly start: { x: number; y: number } = { x: 0, y: 0 };
  private readonly doorTiles: number[] = [];
  private hasStart = false;
  doorOpen = false;

  constructor(template: Template, index: number) {
    const rows = template.rows;
    const innerW = rows[0].length;
    const innerH = rows.length;
    this.w = innerW + 2;
    this.h = innerH + 2;
    this.index = index;
    this.name = template.name;
    this.kind = template.kind ?? (template.shop ? "shop" : "combat");
    this.tiles = new Uint8Array(this.w * this.h);

    const rng = makeRng(0x9e37 + index * 7919);
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const edge = tx === 0 || ty === 0 || tx === this.w - 1 || ty === this.h - 1;
        let t: Tile = edge ? TILE.WALL : TILE.FLOOR;
        if (!edge) {
          const line = (rows[ty - 1] ?? "").padEnd(innerW, ".").slice(0, innerW);
          const ch = line[tx - 1];
          if (ch === "O") t = TILE.CRATE;
          else if (ch === "^") t = TILE.TRAP;
          else if (ch === ",") t = TILE.ROAD;
          else if (ch === "#") t = TILE.WALL;
          else if (ch === "=") t = TILE.FLOOR_WOOD;
          else if (ch === "d") t = TILE.DOOR_TOWN;
          else if (ch === "f") t = TILE.FENCE;
          else if (template.kind === "town") t = TILE.GRASS;
          else if (rng.next() < 0.14) t = TILE.ACCENT;
          const cx = tx * CONFIG.WORLD.TILE;
          const cy = ty * CONFIG.WORLD.TILE;
          const mark = MARKER_KIND[ch ?? ""];
          if (mark !== undefined) this.spawns.push({ x: cx + CONFIG.WORLD.TILE / 2, y: cy + CONFIG.WORLD.TILE * 0.75, kind: mark });
          if (ch === "S") {
            this.start.x = cx + CONFIG.WORLD.TILE / 2;
            this.start.y = cy + CONFIG.WORLD.TILE * 0.75;
            this.hasStart = true;
          }
        }
        this.tiles[ty * this.w + tx] = t;
      }
    }

    // torches: scan wall faces (wall with a walkable tile below) and place one every ~8 tiles.
    // town is skipped: its wall rings are house walls, and the lantern props carry its light.
    const torchRng = makeRng(0x51ee + index * 104729);
    let sinceLast = 8;
    for (let ty = this.kind === "town" ? this.h : 1; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.tiles[ty * this.w + tx] !== TILE.WALL) continue;
        const below = ty + 1 < this.h ? this.tiles[(ty + 1) * this.w + tx] : TILE.WALL;
        if (below === TILE.WALL || below === TILE.CRATE || below === TILE.FENCE) continue;
        if (++sinceLast < 8 || torchRng.next() < 0.25) continue;
        sinceLast = 0;
        this.torches.push({
          x: tx * CONFIG.WORLD.TILE + CONFIG.WORLD.TILE / 2,
          y: (ty + 1) * CONFIG.WORLD.TILE - 2,
          phase: torchRng.next() * Math.PI * 2,
        });
      }
    }

    if (!this.hasStart) {
      const fallbackX = this.w * 0.25 * CONFIG.WORLD.TILE;
      const fallbackY = this.h * 0.5 * CONFIG.WORLD.TILE;
      let nearest = Infinity;
      for (let ty = 1; ty < this.h - 1; ty++) {
        for (let tx = 1; tx < this.w - 1; tx++) {
          if (this.isSolid(tx, ty)) continue;
          const x = (tx + 0.5) * CONFIG.WORLD.TILE;
          const y = (ty + 0.75) * CONFIG.WORLD.TILE;
          const distance = (x - fallbackX) ** 2 + (y - fallbackY) ** 2;
          if (distance >= nearest) continue;
          nearest = distance;
          this.start.x = x;
          this.start.y = y;
        }
      }
      if (!Number.isFinite(nearest)) throw new Error(`Room ${this.name} has no walkable start`);
    }

    const midY = Math.floor(this.h / 2);
    for (const ty of [midY - 1, midY]) {
      const idx = ty * this.w + (this.w - 1);
      this.tiles[idx] = TILE.DOOR;
      this.doorTiles.push(idx);
      this.tiles[ty * this.w] = TILE.FLOOR;
    }
  }

  at(tx: number, ty: number): Tile {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return TILE.WALL;
    return this.tiles[ty * this.w + tx] as Tile;
  }

  setTile(tx: number, ty: number, t: Tile): void {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    this.tiles[ty * this.w + tx] = t;
  }

  isSolid(tx: number, ty: number): boolean {
    const t = this.at(tx, ty);
    return t === TILE.WALL || t === TILE.CRATE || t === TILE.DOOR || t === TILE.FENCE;
  }

  solidAtPx(px: number, py: number): boolean {
    return this.isSolid(Math.floor(px / CONFIG.WORLD.TILE), Math.floor(py / CONFIG.WORLD.TILE));
  }

  openDoors(): void {
    if (this.doorOpen) return;
    this.doorOpen = true;
    for (const i of this.doorTiles) this.tiles[i] = TILE.DOOR_OPEN;
  }

  exitsAt(px: number, py: number): boolean {
    if (!this.doorOpen) return false;
    const t = this.at(Math.floor(px / CONFIG.WORLD.TILE), Math.floor(py / CONFIG.WORLD.TILE));
    return t === TILE.DOOR_OPEN;
  }

  get widthPx(): number {
    return this.w * CONFIG.WORLD.TILE;
  }

  get heightPx(): number {
    return this.h * CONFIG.WORLD.TILE;
  }

  clampCamera(cx: number, cy: number): { x: number; y: number } {
    const viewW = CONFIG.WORLD.INTERNAL_W / CONFIG.WORLD.PIXEL_SCALE * 0.5;
    const viewH = CONFIG.WORLD.INTERNAL_H / CONFIG.WORLD.PIXEL_SCALE * 0.5;
    const x = this.widthPx <= viewW * 2 ? this.widthPx / 2 : clamp(cx, viewW, this.widthPx - viewW);
    const y = this.heightPx <= viewH * 2 ? this.heightPx / 2 : clamp(cy, viewH, this.heightPx - viewH);
    return { x, y };
  }
}
