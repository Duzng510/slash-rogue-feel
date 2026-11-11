import { CONFIG, enemyDef } from "../config.ts";

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
    const body = enemyDef("chaser").BODY_COLOR;
    rect(g, 1, 0, 2, 2, P.ENEMY_SHADE);
    rect(g, 8, 0, 2, 2, P.ENEMY_SHADE);
    rect(g, 1, 2, 9, 8, body);
    rect(g, 0, 3, 1, 6, P.VOID);
    rect(g, 10, 3, 1, 6, P.VOID);
    rect(g, 1, 9, 9, 2, P.ENEMY_SHADE);
    rect(g, 2, 11, 2, 1, P.VOID);
    rect(g, 7, 11, 2, 1, P.VOID);
    rect(g, 3, 4, 2, 2, P.ENEMY_EYE);
    rect(g, 7, 4, 1, 2, P.ENEMY_EYE);
  });

  const charger = enemyDef("charger");
  S[charger.SPRITE_KEY] = bake(13, 12, 6, 11, (g) => {
    const widths = [1, 3, 5, 7, 9, 11, 11, 9, 7, 5, 3];
    widths.forEach((w, y) => rect(g, (13 - w) / 2, y, w, 1, charger.BODY_COLOR));
    rect(g, 2, 5, 9, 2, P.ENEMY_CHARGER_SHADE);
    rect(g, 5, 3, 3, 2, P.ENEMY_EYE);
    rect(g, 3, 11, 2, 1, P.VOID);
    rect(g, 8, 11, 2, 1, P.VOID);
  });

  const splitter = enemyDef("splitter");
  S[splitter.SPRITE_KEY] = bake(13, 11, 6, 10, (g) => {
    rect(g, 1, 0, 11, 10, splitter.BODY_COLOR);
    rect(g, 0, 2, 13, 6, splitter.BODY_COLOR);
    rect(g, 1, 0, 11, 1, P.ENEMY_SPLITTER_SHADE);
    rect(g, 1, 8, 11, 2, P.ENEMY_SPLITTER_SHADE);
    rect(g, 6, 0, 1, 10, P.ENEMY_SPLITTER_SHADE);
    rect(g, 2, 3, 2, 2, P.ENEMY_EYE);
    rect(g, 9, 3, 2, 2, P.ENEMY_EYE);
    rect(g, 3, 10, 2, 1, P.VOID);
    rect(g, 8, 10, 2, 1, P.VOID);
  });

  const small = enemyDef("small");
  S[small.SPRITE_KEY] = bake(7, 8, 3, 7, (g) => {
    rect(g, 1, 0, 5, 7, small.BODY_COLOR);
    rect(g, 0, 1, 7, 5, small.BODY_COLOR);
    rect(g, 2, 2, 2, 2, P.ENEMY_EYE);
    rect(g, 1, 5, 5, 2, P.ENEMY_SMALL_SHADE);
    rect(g, 1, 7, 2, 1, P.VOID);
    rect(g, 4, 7, 2, 1, P.VOID);
  });

  const ranged = enemyDef("ranged");
  S[ranged.SPRITE_KEY] = bake(9, 12, 4, 11, (g) => {
    rect(g, 3, 0, 3, 1, P.ENEMY_RANGED_SHADE);
    rect(g, 2, 1, 5, 3, ranged.BODY_COLOR);
    rect(g, 1, 4, 7, 6, ranged.BODY_COLOR);
    rect(g, 2, 10, 5, 1, P.ENEMY_RANGED_SHADE);
    rect(g, 3, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 5, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 4, 6, 1, 2, P.PROJ);
    rect(g, 2, 11, 2, 1, P.VOID);
    rect(g, 5, 11, 2, 1, P.VOID);
  });

  const teleporter = enemyDef("teleporter");
  S[teleporter.SPRITE_KEY] = bake(9, 11, 4, 10, (g) => {
    rect(g, 4, 0, 1, 1, teleporter.BODY_COLOR);
    rect(g, 3, 1, 3, 1, teleporter.BODY_COLOR);
    rect(g, 2, 2, 5, 4, teleporter.BODY_COLOR);
    rect(g, 3, 6, 3, 3, teleporter.BODY_COLOR);
    rect(g, 1, 3, 1, 2, P.ENEMY_TELEPORTER_SHADE);
    rect(g, 7, 3, 1, 2, P.ENEMY_TELEPORTER_SHADE);
    rect(g, 3, 3, 1, 1, P.ENEMY_EYE);
    rect(g, 5, 3, 1, 1, P.ENEMY_EYE);
    rect(g, 3, 10, 3, 1, P.ENEMY_TELEPORTER_SHADE);
  });

  const healer = enemyDef("healer");
  S[healer.SPRITE_KEY] = bake(9, 11, 4, 10, (g) => {
    rect(g, 2, 0, 5, 2, healer.BODY_COLOR);
    rect(g, 1, 2, 7, 7, healer.BODY_COLOR);
    rect(g, 1, 8, 7, 1, P.ENEMY_HEALER_SHADE);
    rect(g, 4, 3, 1, 5, "#eafff0");
    rect(g, 2, 5, 5, 1, "#eafff0");
    rect(g, 2, 10, 2, 1, P.VOID);
    rect(g, 5, 10, 2, 1, P.VOID);
  });

  const exploder = enemyDef("exploder");
  S[exploder.SPRITE_KEY] = bake(11, 12, 5, 11, (g) => {
    rect(g, 5, 0, 1, 2, P.ENEMY_EYE);
    rect(g, 3, 2, 5, 1, exploder.BODY_COLOR);
    rect(g, 1, 3, 9, 6, exploder.BODY_COLOR);
    rect(g, 3, 9, 5, 1, exploder.BODY_COLOR);
    rect(g, 1, 7, 9, 2, P.ENEMY_EXPLODER_SHADE);
    rect(g, 4, 4, 3, 3, P.ENEMY_EXPLODER_SHADE);
    rect(g, 5, 5, 1, 1, P.ENEMY_EYE);
    rect(g, 2, 10, 2, 1, P.VOID);
    rect(g, 7, 10, 2, 1, P.VOID);
  });

  const shielder = enemyDef("shielder");
  S[shielder.SPRITE_KEY] = bake(12, 11, 6, 10, (g) => {
    rect(g, 2, 0, 8, 9, shielder.BODY_COLOR);
    rect(g, 2, 7, 8, 2, P.ENEMY_SHIELDER_SHADE);
    rect(g, 0, 1, 2, 7, P.ENEMY_SHIELDER_SHADE);
    rect(g, 10, 1, 2, 7, P.ENEMY_SHIELDER_SHADE);
    rect(g, 4, 3, 2, 2, P.ENEMY_EYE);
    rect(g, 7, 3, 1, 2, P.ENEMY_EYE);
    rect(g, 3, 10, 2, 1, P.VOID);
    rect(g, 7, 10, 2, 1, P.VOID);
  });

  const sniper = enemyDef("sniper");
  S[sniper.SPRITE_KEY] = bake(9, 13, 4, 12, (g) => {
    rect(g, 3, 0, 3, 2, P.ENEMY_SNIPER_SHADE);
    rect(g, 2, 2, 5, 4, sniper.BODY_COLOR);
    rect(g, 3, 6, 3, 5, sniper.BODY_COLOR);
    rect(g, 3, 3, 3, 1, P.ENEMY_EYE);
    rect(g, 4, 8, 1, 3, P.ENEMY_SNIPER_SHADE);
    rect(g, 2, 12, 2, 1, P.VOID);
    rect(g, 5, 12, 2, 1, P.VOID);
  });

  const jumper = enemyDef("jumper");
  S[jumper.SPRITE_KEY] = bake(9, 10, 4, 9, (g) => {
    rect(g, 3, 0, 3, 1, jumper.BODY_COLOR);
    rect(g, 2, 1, 5, 4, jumper.BODY_COLOR);
    rect(g, 1, 2, 1, 2, P.ENEMY_JUMPER_SHADE);
    rect(g, 7, 2, 1, 2, P.ENEMY_JUMPER_SHADE);
    rect(g, 3, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 5, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 2, 5, 2, 3, P.ENEMY_JUMPER_SHADE);
    rect(g, 5, 5, 2, 3, P.ENEMY_JUMPER_SHADE);
    rect(g, 1, 8, 3, 1, jumper.BODY_COLOR);
    rect(g, 5, 8, 3, 1, jumper.BODY_COLOR);
  });

  const warden = enemyDef("warden");
  S[warden.SPRITE_KEY] = bake(16, 16, 8, 15, (g) => {
    rect(g, 0, 2, 16, 12, P.ENEMY_WARDEN_SHADE);
    rect(g, 1, 1, 14, 12, warden.BODY_COLOR);
    rect(g, 1, 1, 14, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 2, 0, 2, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 12, 0, 2, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 3, 5, 3, 3, P.ENEMY_EYE);
    rect(g, 10, 5, 3, 3, P.ENEMY_EYE);
    rect(g, 6, 9, 4, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 3, 14, 3, 2, P.VOID);
    rect(g, 10, 14, 3, 2, P.VOID);
  });

  const boss = enemyDef("boss");
  S[boss.SPRITE_KEY] = bake(20, 18, 10, 17, (g) => {
    rect(g, 0, 2, 20, 14, P.ENEMY_BOSS_RIM);
    rect(g, 1, 1, 18, 15, P.ENEMY_BOSS_RIM);
    rect(g, 2, 2, 16, 13, boss.BODY_COLOR);
    rect(g, 4, 0, 3, 2, P.ENEMY_BOSS_RIM);
    rect(g, 13, 0, 3, 2, P.ENEMY_BOSS_RIM);
    rect(g, 2, 2, 16, 2, P.ENEMY_BOSS_SHADE);
    rect(g, 2, 12, 16, 3, P.ENEMY_BOSS_SHADE);
    rect(g, 5, 6, 3, 3, P.ENEMY_EYE);
    rect(g, 12, 6, 3, 3, P.ENEMY_EYE);
    rect(g, 4, 16, 4, 2, P.VOID);
    rect(g, 12, 16, 4, 2, P.VOID);
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

  S.trap = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    rect(g, 1, 13, T - 2, 2, P.WALL);
    for (const x of [2, 7, 12]) {
      rect(g, x + 1, 5, 1, 3, P.ENEMY_BODY);
      rect(g, x, 8, 3, 5, P.ENEMY_BODY);
      rect(g, x, 12, 3, 1, P.ENEMY_SHADE);
    }
  });

  S.trap_spent = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    rect(g, 1, 13, T - 2, 2, P.WALL);
    for (const x of [2, 7, 12]) rect(g, x, 11, 3, 2, P.DOOR_LOCKED);
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
