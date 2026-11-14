import { CONFIG } from "../config.ts";
import type { NpcKind } from "../entities/npc.ts";

/**
 * The town is data, not a hand-typed grid: HOUSES drives the tile rows, the NPC anchors and the
 * props, so a law can prove every NPC stands inside its own house instead of trusting coordinates
 * that were typed twice.
 */

/** inner grid; Room adds a 1-tile wall border, so the walkable town is (TOWN.W + 2) x (TOWN.H + 2) */
export const TOWN = { w: 46, h: 26 } as const;

export type DoorSide = "n" | "s" | "e" | "w";

export type House = {
  id: string;
  /** shown in the banner when the roof peels */
  name: string;
  /** footprint in inner tile coords, ring included */
  x: number;
  y: number;
  w: number;
  h: number;
  door: DoorSide;
  npc: NpcKind | null;
  /** anchored for a later spec: the room exists, the door only says "chưa mở" */
  locked: boolean;
};

export const HOUSES: readonly House[] = [
  { id: "master", name: "Nhà Sư phụ", x: 3, y: 2, w: 8, h: 6, door: "s", npc: "character_master", locked: false },
  { id: "storage", name: "Nhà kho", x: 14, y: 2, w: 8, h: 6, door: "s", npc: null, locked: true },
  { id: "merchant", name: "Quán Tiệm buôn", x: 29, y: 2, w: 9, h: 7, door: "s", npc: "merchant", locked: false },
  { id: "forge", name: "Lò rèn", x: 6, y: 18, w: 9, h: 7, door: "n", npc: null, locked: true },
  { id: "shrine", name: "Đền hồi máu", x: 25, y: 18, w: 8, h: 6, door: "n", npc: null, locked: true },
  { id: "guard", name: "Chốt Lính gác", x: 35, y: 18, w: 7, h: 6, door: "w", npc: "guard", locked: false },
];

/** main east-west street; the auto east gate sits on its middle rows, so it reads as one path */
const STREET = { y: 11, h: 3 };
const AVENUE = { x: 22, w: 2 };
const PLAZA = { x: 18, y: 14, w: 10, h: 3 };

/** tile legend: . grass  , road  # house wall  = interior floor  d house door  f fence  S start.
 *  Uppercase letters are enemy spawn markers in the dungeon legend, so town chars stay lowercase
 *  or punctuation — "H" here used to spawn 149 healers in the market square. */
export const TOWN_LEGEND = ".=,#dfS" as const;

const T = CONFIG.WORLD.TILE;

type Grid = string[][];

function blankGrid(): Grid {
  return Array.from({ length: TOWN.h }, () => Array.from({ length: TOWN.w }, () => "."));
}

function paint(grid: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (tx < 0 || ty < 0 || tx >= TOWN.w || ty >= TOWN.h) continue;
      grid[ty][tx] = ch;
    }
  }
}

/** the ring cell a door occupies for this house */
export function doorCell(h: House): { x: number; y: number } {
  const cx = h.x + Math.floor((h.w - 1) / 2);
  const cy = h.y + Math.floor((h.h - 1) / 2);
  if (h.door === "n") return { x: cx, y: h.y };
  if (h.door === "s") return { x: cx, y: h.y + h.h - 1 };
  if (h.door === "w") return { x: h.x, y: cy };
  return { x: h.x + h.w - 1, y: cy };
}

export function interiorRect(h: House): { x: number; y: number; w: number; h: number } {
  return { x: h.x + 1, y: h.y + 1, w: h.w - 2, h: h.h - 2 };
}

function paintHouse(grid: Grid, h: House): void {
  paint(grid, h.x, h.y, h.w, h.h, "#");
  const inner = interiorRect(h);
  paint(grid, inner.x, inner.y, inner.w, inner.h, "=");
  const d = doorCell(h);
  grid[d.y][d.x] = "d";
}

/** footpath from a door to the nearest street row/column, so houses are not islands */
function paintPath(grid: Grid, h: House): void {
  const d = doorCell(h);
  if (h.door === "s") {
    for (let ty = d.y + 1; ty < STREET.y; ty++) grid[ty][d.x] = ",";
  } else if (h.door === "n") {
    for (let ty = STREET.y + STREET.h; ty < d.y; ty++) grid[ty][d.x] = ",";
  } else {
    const from = h.door === "w" ? 0 : d.x + 1;
    const to = h.door === "w" ? d.x : TOWN.w;
    for (let tx = from; tx < to; tx++) grid[d.y][tx] = ",";
  }
}

export function buildTownRows(): string[] {
  const grid = blankGrid();
  paint(grid, 0, STREET.y, TOWN.w, STREET.h, ",");
  paint(grid, AVENUE.x, 0, AVENUE.w, TOWN.h, ",");
  paint(grid, PLAZA.x, PLAZA.y, PLAZA.w, PLAZA.h, ",");
  // paths first: a street that would run through a building is overwritten by that building,
  // so the block always reads as a wall rather than a road cut in half
  for (const h of HOUSES) paintPath(grid, h);
  for (const h of HOUSES) paintHouse(grid, h);
  // two garden fences, so the empty south and north fields read as yards rather than void
  paint(grid, 2, 16, 10, 1, "f");
  paint(grid, 34, 16, 10, 1, "f");
  grid[STREET.y][1] = "S";
  return grid.map((row) => row.join(""));
}

/** inner coords -> pixel centre of that tile, matching how Room places spawn marks */
function tileCenterPx(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 1 + 0.5) * T, y: (ty + 1 + 0.75) * T };
}

export function npcAnchor(h: House): { kind: NpcKind; x: number; y: number } | null {
  if (h.npc === null) return null;
  const inner = interiorRect(h);
  const at = tileCenterPx(inner.x + Math.floor((inner.w - 1) / 2), inner.y + Math.floor((inner.h - 1) / 2));
  return { kind: h.npc, ...at };
}

/** which house the player is standing in (interior or threshold); null means the roof stays on */
export function houseAt(px: number, py: number): House | null {
  const tx = Math.floor(px / T) - 1;
  const ty = Math.floor(py / T) - 1;
  for (const h of HOUSES) {
    const inner = interiorRect(h);
    const inside = tx >= inner.x && tx < inner.x + inner.w && ty >= inner.y && ty < inner.y + inner.h;
    const d = doorCell(h);
    if (inside || (tx === d.x && ty === d.y)) return h;
  }
  return null;
}

export type TownPropSpec = { x: number; y: number; sprite: string };

/** furniture offsets inside each house's interior rect, so a bigger house can hold more props */
const FURNITURE: Record<string, readonly { dx: number; dy: number; sprite: string }[]> = {
  master: [{ dx: 1, dy: 0, sprite: "prop_table" }, { dx: 4, dy: 0, sprite: "prop_shelf" }],
  storage: [{ dx: 0, dy: 0, sprite: "prop_barrel" }, { dx: 1, dy: 0, sprite: "prop_barrel" }, { dx: 4, dy: 0, sprite: "prop_barrel" }, { dx: 5, dy: 0, sprite: "prop_barrel" }],
  merchant: [{ dx: 0, dy: 0, sprite: "prop_shelf" }, { dx: 5, dy: 0, sprite: "prop_shelf" }, { dx: 1, dy: 3, sprite: "prop_table" }],
  forge: [{ dx: 3, dy: 0, sprite: "prop_hearth" }, { dx: 1, dy: 2, sprite: "prop_anvil" }],
  shrine: [{ dx: 2, dy: 0, sprite: "prop_altar" }, { dx: 0, dy: 2, sprite: "prop_brazier" }],
  guard: [{ dx: 1, dy: 0, sprite: "prop_brazier" }, { dx: 3, dy: 2, sprite: "prop_table" }],
};

/**
 * Indoor props, generated from the same interior rects the map paints: the renderer hides anything
 * under a house's roof, so a prop that fell outside its house would float in the street.
 */
export function buildInteriorProps(): TownPropSpec[] {
  const out: TownPropSpec[] = [];
  for (const h of HOUSES) {
    const inner = interiorRect(h);
    for (const f of FURNITURE[h.id] ?? []) {
      out.push({ ...tileCenterPx(inner.x + f.dx, inner.y + f.dy), sprite: f.sprite });
    }
  }
  return out;
}

/** outdoor dressing; interior furniture arrives with its sprites in the art pass */
export function buildTownProps(): TownPropSpec[] {
  const at = (tx: number, ty: number, sprite: string): TownPropSpec => ({ ...tileCenterPx(tx, ty), sprite });
  return [
    at(20, 15, "prop_well"),
    at(41, 14, "prop_signpost"),
    at(5, 10, "prop_lantern"),
    at(13, 10, "prop_lantern"),
    at(21, 10, "prop_lantern"),
    at(29, 10, "prop_lantern"),
    at(37, 10, "prop_lantern"),
    at(2, 4, "prop_tree"),
    at(2, 23, "prop_tree"),
    at(44, 4, "prop_tree"),
    at(44, 23, "prop_tree"),
    at(16, 15, "prop_tree"),
    at(31, 15, "prop_tree"),
  ];
}
