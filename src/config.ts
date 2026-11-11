export type FrameData = { startup: number; active: number; recovery: number };

export type EnemyKind = "chaser" | "charger" | "splitter" | "small" | "boss" | "ranged" | "teleporter";

const PALETTE = {
  VOID: "#05070b",
  FLOOR: "#121419",
  FLOOR_ACCENT: "#1b1f28",
  WALL: "#2b3242",
  WALL_TOP: "#3a4358",
  DOOR_LOCKED: "#6b7280",
  DOOR_OPEN: "#7fd1ff",
  PLAYER_BODY: "#4da3ff",
  PLAYER_RIM: "#d8f0ff",
  ENEMY_BODY: "#e2434a",
  ENEMY_SHADE: "#8f1f26",
  ENEMY_EYE: "#ffd166",
  ENEMY_CHARGER: "#f28c28",
  ENEMY_CHARGER_SHADE: "#a8550f",
  ENEMY_SPLITTER: "#a55ad6",
  ENEMY_SPLITTER_SHADE: "#6d3391",
  ENEMY_SMALL: "#c99ae6",
  ENEMY_SMALL_SHADE: "#8f63ae",
  ENEMY_BOSS: "#a01820",
  ENEMY_BOSS_SHADE: "#5e0a12",
  ENEMY_BOSS_RIM: "#ffd166",
  ENEMY_RANGED: "#3fbf6f",
  ENEMY_RANGED_SHADE: "#1f7a44",
  ENEMY_TELEPORTER: "#29c5d6",
  ENEMY_TELEPORTER_SHADE: "#178a95",
  PROJ: "#ffe08a",
  TELEGRAPH_FILL: "#ff3b3b",
  TELEGRAPH_EDGE: "#ff8a8a",
  FLASH: "#ffffff",
  VIGNETTE_HURT: "#ff2d2d",
  BLOOD: "#c2182b",
  SPARK: "#ffffff",
  GHOST: "#2f6fb5",
  SLASH: "#bfe8ff",
  HP_FULL: "#4da3ff",
  HP_EMPTY: "#232838",
  TARGET_RIM: "#d8f0ff",
  TEXT: "#d7dbe4",
  DBG_HITBOX: "#ff5fb0",
  DBG_HURTBOX: "#5fffb0",
  DBG_ARC: "#ffd166",
};

/** every archetype overrides only what makes it read and play differently */
const ENEMY_BASE = {
  HP: 3,
  SPEED: 72,
  ACCEL: 900,
  BODY_W: 9,
  BODY_H: 8,
  HURT_W: 9,
  HURT_H: 6,
  TELEGRAPH_TICKS: 27,
  ACTIVE_TICKS: 3,
  RECOVERY_TICKS: 12,
  REST_TICKS: 10,
  ATTACK_REACH: 26,
  ATTACK_ARC_DEG: 100,
  DMG: 1,
  CHASE_ACQUIRE: 220,
  BLINK_INTERVAL: 4,
  BLINK_TAIL_TICKS: 12,
  HURT_TICKS: 8,
  CORPSE_TICKS: 10,
  KNOCKBACK_FRICTION: 0.86,
  SEPARATION: 11,
  SEPARATION_PUSH: 26,
  RETARGET_FRACTION: 0.34,

  SPRITE_KEY: "enemy",
  BODY_COLOR: PALETTE.ENEMY_BODY,
  /** charger only: px/s along the telegraph line while its swing is active */
  LUNGE_SPEED: 0,
  /** boss only: the swing covers every direction */
  RADIAL: false,
  /** boss only: enraged below this fraction of max hp, 0 disables */
  ENRAGE_FRACTION: 0,
  ENRAGED_TELEGRAPH_TICKS: 0,
  /** boss phase 3: below this fraction the ring pattern intensifies and summons start */
  PHASE3_FRACTION: 0,
  PHASE3_TELEGRAPH_TICKS: 0,
  /** extra rings committed back-to-back once enraged */
  RING_FOLLOWUPS: 0,

  /** ranged only: fires a projectile instead of swinging, and holds a stand-off band */
  RANGED: false,
  SHOT_SPEED: 150,
  SHOT_DMG: 1,
  SHOT_LIFE_TICKS: 48,
  STANDOFF_MIN: 55,
  STANDOFF_MAX: 115,
  /** teleporter only: blink behind the player, then telegraph a melee swing (0 disables) */
  TELEPORTER: false,
  VANISH_TICKS: 0,
  APPEAR_TICKS: 0,
  APPEAR_DIST: 20,

  /** splitter only */
  SPLIT_INTO: null as EnemyKind | null,
  SPLIT_COUNT: 0,
  HP_BAR: false,
  KILL_PITCH: 1,
  /** hard ceiling on living enemies, enforced at spawn */
  MAX_ALIVE: 12,
};

export type EnemyDef = typeof ENEMY_BASE & { kind: EnemyKind };

const ENEMY_OVERRIDES: Record<EnemyKind, Partial<typeof ENEMY_BASE>> = {
  chaser: {},
  charger: {
    HP: 3,
    SPEED: 60,
    BODY_W: 12,
    BODY_H: 8,
    HURT_W: 12,
    TELEGRAPH_TICKS: 27,
    ACTIVE_TICKS: 14,
    RECOVERY_TICKS: 18,
    REST_TICKS: 26,
    ATTACK_REACH: 46,
    ATTACK_ARC_DEG: 45,
    BLINK_INTERVAL: 3,
    BLINK_TAIL_TICKS: 15,
    SPRITE_KEY: "enemy_charger",
    BODY_COLOR: PALETTE.ENEMY_CHARGER,
    LUNGE_SPEED: 250,
    KILL_PITCH: 0.9,
  },
  splitter: {
    HP: 4,
    SPEED: 52,
    BODY_W: 12,
    BODY_H: 10,
    HURT_W: 12,
    TELEGRAPH_TICKS: 30,
    ACTIVE_TICKS: 4,
    RECOVERY_TICKS: 16,
    REST_TICKS: 16,
    ATTACK_REACH: 22,
    ATTACK_ARC_DEG: 140,
    SPRITE_KEY: "enemy_splitter",
    BODY_COLOR: PALETTE.ENEMY_SPLITTER,
    SPLIT_INTO: "small",
    SPLIT_COUNT: 2,
    KILL_PITCH: 0.7,
  },
  small: {
    HP: 1,
    SPEED: 96,
    ACCEL: 1100,
    BODY_W: 7,
    BODY_H: 6,
    HURT_W: 7,
    HURT_H: 5,
    TELEGRAPH_TICKS: 18,
    ACTIVE_TICKS: 3,
    RECOVERY_TICKS: 10,
    REST_TICKS: 8,
    ATTACK_REACH: 14,
    ATTACK_ARC_DEG: 90,
    BLINK_INTERVAL: 5,
    BLINK_TAIL_TICKS: 8,
    SEPARATION: 8,
    SEPARATION_PUSH: 30,
    SPRITE_KEY: "enemy_small",
    BODY_COLOR: PALETTE.ENEMY_SMALL,
    KILL_PITCH: 1.35,
  },
  boss: {
    HP: 24,
    SPEED: 44,
    ACCEL: 700,
    BODY_W: 20,
    BODY_H: 16,
    HURT_W: 20,
    HURT_H: 14,
    TELEGRAPH_TICKS: 33,
    ENRAGED_TELEGRAPH_TICKS: 24,
    ACTIVE_TICKS: 4,
    RECOVERY_TICKS: 26,
    REST_TICKS: 40,
    ATTACK_REACH: 60,
    ATTACK_ARC_DEG: 360,
    DMG: 1,
    /** the arena is bigger than the acquire range of any other archetype */
    CHASE_ACQUIRE: 400,
    BLINK_INTERVAL: 5,
    BLINK_TAIL_TICKS: 20,
    SEPARATION: 0,
    SPRITE_KEY: "enemy_boss",
    BODY_COLOR: PALETTE.ENEMY_BOSS,
    RADIAL: true,
    ENRAGE_FRACTION: 0.5,
    PHASE3_FRACTION: 0.25,
    PHASE3_TELEGRAPH_TICKS: 18,
    RING_FOLLOWUPS: 1,
    HP_BAR: true,
    KILL_PITCH: 0.55,
  },
  ranged: {
    HP: 2,
    SPEED: 40,
    ACCEL: 700,
    BODY_W: 9,
    BODY_H: 9,
    HURT_W: 9,
    HURT_H: 7,
    TELEGRAPH_TICKS: 40,
    ACTIVE_TICKS: 2,
    RECOVERY_TICKS: 10,
    REST_TICKS: 40,
    ATTACK_REACH: 120,
    ATTACK_ARC_DEG: 12,
    DMG: 1,
    CHASE_ACQUIRE: 240,
    SPRITE_KEY: "enemy_ranged",
    BODY_COLOR: PALETTE.ENEMY_RANGED,
    RANGED: true,
    KILL_PITCH: 1.1,
  },
  teleporter: {
    HP: 2,
    SPEED: 78,
    ACCEL: 1000,
    BODY_W: 9,
    BODY_H: 9,
    HURT_W: 9,
    HURT_H: 7,
    TELEGRAPH_TICKS: 21,
    ACTIVE_TICKS: 3,
    RECOVERY_TICKS: 14,
    REST_TICKS: 26,
    ATTACK_REACH: 22,
    ATTACK_ARC_DEG: 90,
    DMG: 1,
    SPRITE_KEY: "enemy_teleporter",
    BODY_COLOR: PALETTE.ENEMY_TELEPORTER,
    TELEPORTER: true,
    VANISH_TICKS: 30,
    APPEAR_TICKS: 10,
    APPEAR_DIST: 20,
    KILL_PITCH: 1.2,
  },
};

const defCache = new Map<EnemyKind, EnemyDef>();

/** merged once per kind; every number an enemy reads comes from here */
export function enemyDef(kind: EnemyKind): EnemyDef {
  const cached = defCache.get(kind);
  if (cached !== undefined) return cached;
  const def = { ...ENEMY_BASE, ...ENEMY_OVERRIDES[kind], kind } as EnemyDef;
  defCache.set(kind, def);
  return def;
}

export const ENEMY_KINDS = Object.keys(ENEMY_OVERRIDES) as EnemyKind[];

export const CONFIG = {
  TIME: {
    TICK_HZ: 60,
    TICK: 1 / 60,
  },

  WORLD: {
    TILE: 16,
    INTERNAL_W: 320,
    INTERNAL_H: 180,
    MIN_SCALE: 2,
  },

  ROOMS: {
    WAVES: [3, 4, 6, 8, 5, 10],
    END_DELAY: 40,
  },

  SEED: 1337,

  PLAYER: {
    HP: 5,
    SPEED: 104,
    ACCEL: 1500,
    FRICTION: 0.78,
    BODY_W: 10,
    BODY_H: 8,
    HURT_W: 10,
    HURT_H: 6,
    IFRAMES: 36,
    FLASH_TICKS: 2,
    HURT_KNOCKBACK: 130,
    HURT_TICKS: 10,
    DEATH_TICKS: 40,
    RESPAWN_FADE_TICKS: 36,
  },

  ATTACK: {
    COMBOS: [
      { startup: 4, active: 3, recovery: 7 },
      { startup: 3, active: 3, recovery: 7 },
    ] as FrameData[],
    CHAIN_CANCEL_WINDOW: 6,
    ARC_DEG: 120,
    REACH: 24,
    BAND: 14,
    DMG: 1,
    COMBO2_REACH_SCALE: 1.25,
    COMBO2_ARC_SCALE: 1.2,
    KNOCKBACK: 95,
  },

  DASH: {
    TICKS: 7,
    SPEED: 330,
    IFRAME_TICKS: 6,
    COOLDOWN: 54,
    GHOSTS: 4,
  },

  ENEMY: ENEMY_BASE,

  FEEL: {
    HIT_STOP_NORMAL: 3,
    HIT_STOP_KILL: 5,
    HIT_STOP_PLAYER_HURT: 4,
    SHAKE_MAG: 1.2,
    SHAKE_DECAY: 0.82,
    SHAKE_MIN: 0.03,
    SHAKE_KILL_MULT: 1.8,
    SHAKE_PLAYER_HURT_MULT: 2.4,
    BLOOD: 8,
    SPARK: 3,
    DEATH_SHARDS: 10,
    PLAYER_BLOOD: 6,
    DASH_DUST: 3,
    DECEL_ON_DEATH: 0.9,
  },

  READABILITY: {
    PARTICLE_CAP: 120,
    DOWNSCALE_AT: 0.72,
    TIER3_OFF_AT: 0.9,
    VIGNETTE_MAX: 0.25,
    DMG_NUMBER_BUDGET: 20,
    SLASH_ALPHA: 0.5,
    TELEGRAPH_FILL: 0.34,
    SHADOW_ALPHA: 0.35,
    IFRAME_ALPHA: 0.35,
  },

  CAMERA: {
    FOLLOW_LERP: 0.12,
    LEAD: 0.15,
    LEAD_CLAMP: 40,
  },

  INPUT: {
    PRESS_BUFFER_TICKS: 8,
  },

  AUTO_AIM: {
    CONE_DEG: 70,
    RANGE: 90,
  },

  AUDIO: {
    MASTER: 0.35,
  },

  SLIDERS: {
    shake: 1,
    volume: 0.35,
    particles: 1,
    timescale: 1,
    hitStopScale: 1,
    dmgNumbers: 0,
  },

  LAWS: {
    MIN_TELEGRAPH_S: 0.3,
    MAX_CHARGER_ARC_DEG: 60,
  },

  PALETTE,
};
