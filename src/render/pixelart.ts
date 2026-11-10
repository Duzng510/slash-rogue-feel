import { CONFIG } from "../config.ts";

const P = CONFIG.PALETTE;

export type Sprite = { c: HTMLCanvasElement; w: number; h: number; ax: number; ay: number };

function bake(w: number, h: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g !== null) draw(g);
  return { c, w, h, ax, ay };
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/** bottom-centre anchored, feet at ay */
export function buildSprites(): Record<string, Sprite> {
  const S: Record<string, Sprite> = {};
  const T = CONFIG.WORLD.TILE;

  S.player = bake(12, 14, 6, 13, (g) => {
    rect(g, 2, 0, 8, 3, P.VOID);
    rect(g, 2, 1, 8, 9, P.PLAYER_BODY);
    rect(g, 3, 0, 6, 2, P.PLAYER_RIM);
    rect(g, 1, 3, 1, 6, P.VOID);
    rect(g, 10, 3, 1, 6, P.VOID);
    rect(g, 2, 10, 3, 3, P.VOID);
    rect(g, 7, 10, 3, 3, P.VOID);
    rect(g, 3, 10, 2, 2, P.PLAYER_BODY);
    rect(g, 7, 10, 2, 2, P.PLAYER_BODY);
    rect(g, 4, 4, 4, 2, P.VOID);
    rect(g, 5, 5, 3, 1, P.PLAYER_RIM);
  });

  S.enemy = bake(11, 12, 5, 11, (g) => {
    rect(g, 1, 0, 2, 2, P.ENEMY_SHADE);
    rect(g, 8, 0, 2, 2, P.ENEMY_SHADE);
    rect(g, 1, 2, 9, 8, P.ENEMY_BODY);
    rect(g, 0, 3, 1, 6, P.VOID);
    rect(g, 10, 3, 1, 6, P.VOID);
    rect(g, 1, 9, 9, 2, P.ENEMY_SHADE);
    rect(g, 2, 11, 2, 1, P.VOID);
    rect(g, 7, 11, 2, 1, P.VOID);
    rect(g, 3, 4, 2, 2, P.ENEMY_EYE);
    rect(g, 7, 4, 1, 2, P.ENEMY_EYE);
  });

  S.shadow = bake(10, 4, 5, 2, (g) => {
    g.globalAlpha = CONFIG.READABILITY.SHADOW_ALPHA;
    rect(g, 1, 1, 8, 2, P.VOID);
    rect(g, 0, 2, 10, 1, P.VOID);
    rect(g, 2, 0, 6, 1, P.VOID);
  });

  S.heart_full = bake(8, 7, 0, 0, (g) => {
    rect(g, 1, 1, 2, 2, P.HP_FULL);
    rect(g, 5, 1, 2, 2, P.HP_FULL);
    rect(g, 1, 3, 6, 2, P.HP_FULL);
    rect(g, 2, 5, 4, 1, P.HP_FULL);
    rect(g, 3, 6, 2, 1, P.HP_FULL);
    rect(g, 2, 1, 1, 1, P.PLAYER_RIM);
  });

  S.heart_empty = bake(8, 7, 0, 0, (g) => {
    rect(g, 1, 1, 2, 2, P.HP_EMPTY);
    rect(g, 5, 1, 2, 2, P.HP_EMPTY);
    rect(g, 1, 3, 6, 2, P.HP_EMPTY);
    rect(g, 2, 5, 4, 1, P.HP_EMPTY);
    rect(g, 3, 6, 2, 1, P.HP_EMPTY);
  });

  S.floor = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    g.globalAlpha = 0.35;
    rect(g, 2, 11, 1, 1, P.FLOOR_ACCENT);
    rect(g, 9, 4, 1, 1, P.FLOOR_ACCENT);
    rect(g, 13, 13, 1, 1, P.FLOOR_ACCENT);
  });

  S.accent = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    rect(g, 0, 0, T, 1, P.FLOOR_ACCENT);
    rect(g, 0, 1, 1, T - 1, P.FLOOR_ACCENT);
    g.globalAlpha = 0.5;
    rect(g, 5, 7, 2, 2, P.FLOOR_ACCENT);
  });

  S.wall = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.WALL);
    rect(g, 0, 0, T, 3, P.WALL_TOP);
    rect(g, 0, 3, T, 1, P.VOID);
    g.globalAlpha = 0.5;
    rect(g, 3, 8, 2, 3, P.VOID);
    rect(g, 11, 10, 2, 2, P.VOID);
  });

  S.crate = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 2, T, T - 2, P.WALL);
    rect(g, 0, 2, T, 2, P.WALL_TOP);
    rect(g, 1, 4, T - 2, T - 5, P.FLOOR_ACCENT);
    rect(g, 3, 7, T - 6, 4, P.WALL_TOP);
    rect(g, 0, 2, 1, T - 2, P.VOID);
    rect(g, T - 1, 2, 1, T - 2, P.VOID);
  });

  S.door_locked = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.WALL);
    rect(g, 2, 3, T - 4, T - 5, P.DOOR_LOCKED);
    rect(g, 4, 6, T - 8, 2, P.VOID);
    rect(g, 4, 11, T - 8, 2, P.VOID);
  });

  S.door_open = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.VOID);
    rect(g, 1, 1, T - 2, T - 2, P.FLOOR);
    g.globalAlpha = 0.8;
    rect(g, 3, 3, T - 6, T - 6, P.DOOR_OPEN);
  });

  return S;
}

export function facingOffsets(dir: number): { x: number; y: number } {
  const step = Math.round(((dir + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  const table = [
    [3, 0],
    [2, -2],
    [0, -3],
    [-2, -2],
    [-3, 0],
    [-2, 2],
    [0, 3],
    [2, 2],
  ];
  const v = table[step];
  return { x: v[0], y: v[1] };
}
