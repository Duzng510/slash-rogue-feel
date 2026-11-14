// Pure pose data for enemy keyframe animation. Deliberately DOM-free: pixelart.ts bakes these ops,
// and tests/laws.test.ts reads them in node to prove a pose is not just a translated sprite.
import { CONFIG, enemyDef, type EnemyKind } from "../../config.ts";

const P = CONFIG.PALETTE;

/** one filled pixel rect, in the base sprite's logical units */
export type Op = { x: number; y: number; w: number; h: number; c: string };

export type Pose = Op[];

/**
 * A kind's authored keyframes. The three attack slots map 1:1 onto the frame indices the renderer
 * already picks (windup=0, strike=1, recover=2); `idle` is optional and free-length.
 */
export type PoseTable = {
  kind: EnemyKind;
  /** the base sprite's logical box; bakePose() refuses to bake a differently sized base */
  box: { w: number; h: number };
  idle?: Pose[];
  windup: Pose;
  strike: Pose;
  recover: Pose;
  tickDur?: number;
};

export const r = (x: number, y: number, w: number, h: number, c: string): Op => ({ x, y, w, h, c });

export const body = (kind: EnemyKind): string => enemyDef(kind).BODY_COLOR;

const SHADE: Partial<Record<EnemyKind, string>> = {
  chaser: P.ENEMY_SHADE,
  charger: P.ENEMY_CHARGER_SHADE,
  splitter: P.ENEMY_SPLITTER_SHADE,
  small: P.ENEMY_SMALL_SHADE,
  ranged: P.ENEMY_RANGED_SHADE,
  teleporter: P.ENEMY_TELEPORTER_SHADE,
  healer: P.ENEMY_HEALER_SHADE,
  exploder: P.ENEMY_EXPLODER_SHADE,
  shielder: P.ENEMY_SHIELDER_SHADE,
  sniper: P.ENEMY_SNIPER_SHADE,
  jumper: P.ENEMY_JUMPER_SHADE,
  warden: P.ENEMY_WARDEN_SHADE,
  boss: P.ENEMY_BOSS_SHADE,
  golem: P.ENEMY_GOLEM_SHADE,
  king: P.ENEMY_KING_SHADE,
};

export const shade = (kind: EnemyKind): string => SHADE[kind] ?? P.VOID;

export const VOID = P.VOID;
export const EYE = P.ENEMY_EYE;
export const HIT = "#ffffff";
export const BOSS_RIM = P.ENEMY_BOSS_RIM;
export const PROJ = P.PROJ;
export const GOLEM_RUNE = P.ENEMY_GOLEM_RUNE;
export const KING_CROWN = P.ENEMY_KING_CROWN;
export const KING_EYE = "#ff4d4d";
export const HEAL = "#eafff0";

/** the two-pixel glowing eye pair every archetype already ships with */
export const eyes = (x: number, y: number, w: number, h: number): Pose => [
  r(x, y, w, h, EYE),
  r(x, y, 1, 1, HIT),
];

/**
 * Centred row silhouette — the pattern the charger base art already uses (pixelart.ts:430), so a
 * pose body is one array of widths instead of a dozen rects. `cx` is the sprite's anchor x.
 */
export const rows = (cx: number, y0: number, widths: readonly number[], c: string): Pose =>
  widths.map((w, i) => r(Math.round(cx - w / 2), y0 + i, w, 1, c));

