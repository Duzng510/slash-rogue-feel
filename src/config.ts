export type FrameData = { startup: number; active: number; recovery: number };

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
    WAVES: [3, 4, 6, 8],
    RESPAWN_DELAY: 50,
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

  ENEMY: {
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
  },

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
  },

  PALETTE: {
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
  },
};
