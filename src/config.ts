export type FrameData = { startup: number; active: number; recovery: number };

export type EnemyKind = "chaser" | "charger" | "splitter" | "small" | "boss" | "ranged" | "teleporter" | "healer" | "exploder" | "shielder" | "sniper" | "jumper" | "warden" | "golem" | "king";

const PALETTE = {
  VOID: "#05070b",
  FLOOR: "#1a1e27",
  FLOOR_ACCENT: "#242a36",
  WALL: "#3a4356",
  WALL_TOP: "#4c5670",
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
  ENEMY_HEALER: "#58d68d",
  ENEMY_HEALER_SHADE: "#2e8b57",
  ENEMY_EXPLODER: "#ff7043",
  ENEMY_EXPLODER_SHADE: "#b23c17",
  ENEMY_SHIELDER: "#8fa8c8",
  ENEMY_SHIELDER_SHADE: "#4a6076",
  ENEMY_SNIPER: "#d64545",
  ENEMY_SNIPER_SHADE: "#8f1f26",
  ENEMY_JUMPER: "#7df0c8",
  ENEMY_JUMPER_SHADE: "#3fa884",
  ENEMY_WARDEN: "#e0c341",
  ENEMY_WARDEN_SHADE: "#8a6a1a",
  ENEMY_GOLEM: "#ff5a3c",
  ENEMY_GOLEM_SHADE: "#8a2f1c",
  ENEMY_GOLEM_RUNE: "#ffd166",
  ENEMY_KING: "#b06fd6",
  ENEMY_KING_SHADE: "#3a1252",
  ENEMY_KING_CROWN: "#ffd166",
  PROJ: "#ffe08a",
  TELEGRAPH_FILL: "#ff3b3b",
  TELEGRAPH_EDGE: "#ff8a8a",
  FLASH: "#ffffff",
  VIGNETTE_HURT: "#ff2d2d",
  BLOOD: "#c2182b",
  SPARK: "#ffffff",
  GHOST: "#2f6fb5",
  SLASH: "#bfe8ff",
  SLASH_EDGE: "#ffffff",
  SLASH_CYAN: "#00f0ff",
  SLASH_CYAN_DEEP: "#1060c0",
  SLASH_GOLD: "#ffe066",
  SLASH_ORANGE_DEEP: "#ff5522",
  HP_FULL: "#4da3ff",
  HP_EMPTY: "#232838",
  TARGET_RIM: "#d8f0ff",
  TEXT: "#d7dbe4",
  DBG_HITBOX: "#ff5fb0",
  DBG_HURTBOX: "#5fffb0",
  DBG_ARC: "#ffd166",
  /** status-element read colors — the single source shared by combat hit-feedback and enemy procs */
  ELEMENT: {
    burn: "#ff963f",
    wet: "#58caff",
    shock: "#ffe66b",
    poison: "#8f63ae",
    freeze: "#a8e8ff",
    bleed: "#c2182b",
  },
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

  /** healer only: pulses hp back to nearby allies (0 disables) */
  HEAL_RADIUS: 0,
  HEAL_INTERVAL: 0,
  HEAL_AMOUNT: 0,
  /** exploder only: detonates instead of swinging, then dies (0 disables) */
  EXPLODE_RADIUS: 0,
  EXPLODE_DMG: 0,
  /** shielder only: halves damage arriving from the front */
  SHIELD: false,
  /** sniper only: fires a room-crossing beam instead of a projectile */
  SNIPER: false,
  /** warden only: the laser pattern telegraphs longer than the other two (0 disables) */
  LASER_TELEGRAPH_TICKS: 0,
  /** golem only: below this fraction of max hp it enters phase 2 (0 disables) */
  PHASE2_FRACTION: 0,
  /** king only: authored 3-phase finale that mirrors the player's weapon at phase 1 */
  KING: false,

  /** splitter only */
  SPLIT_INTO: null as EnemyKind | null,
  SPLIT_COUNT: 0,
  HP_BAR: false,
  KILL_PITCH: 1,
  /** hard ceiling on living enemies, enforced at spawn */
  MAX_ALIVE: 14,
  ELITE_SPAWN_TICKS: 12,
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
  healer: {
    HP: 2,
    SPEED: 50,
    ATTACK_REACH: 0,
    HEAL_RADIUS: 60,
    HEAL_INTERVAL: 180,
    HEAL_AMOUNT: 1,
    SPRITE_KEY: "enemy_healer",
    BODY_COLOR: PALETTE.ENEMY_HEALER,
    KILL_PITCH: 1.15,
  },
  exploder: {
    HP: 2,
    SPEED: 70,
    TELEGRAPH_TICKS: 60,
    ACTIVE_TICKS: 1,
    RECOVERY_TICKS: 1,
    ATTACK_REACH: 50,
    RADIAL: true,
    EXPLODE_RADIUS: 50,
    EXPLODE_DMG: 3,
    SPRITE_KEY: "enemy_exploder",
    BODY_COLOR: PALETTE.ENEMY_EXPLODER,
    KILL_PITCH: 0.85,
  },
  shielder: {
    HP: 4,
    SPEED: 56,
    BODY_W: 11,
    BODY_H: 9,
    HURT_W: 11,
    SHIELD: true,
    SPRITE_KEY: "enemy_shielder",
    BODY_COLOR: PALETTE.ENEMY_SHIELDER,
    KILL_PITCH: 0.8,
  },
  sniper: {
    HP: 1,
    SPEED: 0,
    ACCEL: 0,
    TELEGRAPH_TICKS: 120,
    ACTIVE_TICKS: 1,
    RECOVERY_TICKS: 20,
    REST_TICKS: 60,
    ATTACK_REACH: 400,
    ATTACK_ARC_DEG: 4,
    CHASE_ACQUIRE: 400,
    SNIPER: true,
    SPRITE_KEY: "enemy_sniper",
    BODY_COLOR: PALETTE.ENEMY_SNIPER,
    KILL_PITCH: 1.25,
  },
  jumper: {
    HP: 3,
    SPEED: 84,
    ACCEL: 1000,
    TELEGRAPH_TICKS: 18,
    ACTIVE_TICKS: 3,
    RECOVERY_TICKS: 12,
    REST_TICKS: 20,
    ATTACK_REACH: 22,
    ATTACK_ARC_DEG: 90,
    TELEPORTER: true,
    VANISH_TICKS: 14,
    APPEAR_TICKS: 8,
    APPEAR_DIST: 30,
    SPRITE_KEY: "enemy_jumper",
    BODY_COLOR: PALETTE.ENEMY_JUMPER,
    KILL_PITCH: 1.1,
  },
  warden: {
    HP: 15,
    SPEED: 50,
    ACCEL: 700,
    BODY_W: 16,
    BODY_H: 14,
    HURT_W: 16,
    HURT_H: 12,
    TELEGRAPH_TICKS: 36,
    LASER_TELEGRAPH_TICKS: 120,
    ACTIVE_TICKS: 1,
    RECOVERY_TICKS: 20,
    REST_TICKS: 60,
    ATTACK_REACH: 120,
    ATTACK_ARC_DEG: 360,
    DMG: 1,
    CHASE_ACQUIRE: 400,
    SEPARATION: 0,
    SHOT_SPEED: 90,
    SHOT_DMG: 1,
    SHOT_LIFE_TICKS: 120,
    SPRITE_KEY: "enemy_warden",
    BODY_COLOR: PALETTE.ENEMY_WARDEN,
    HP_BAR: true,
    KILL_PITCH: 0.7,
  },
  golem: {
    HP: 30,
    SPEED: 40,
    ACCEL: 500,
    BODY_W: 24,
    BODY_H: 20,
    HURT_W: 24,
    HURT_H: 16,
    TELEGRAPH_TICKS: 40,
    ACTIVE_TICKS: 4,
    RECOVERY_TICKS: 30,
    REST_TICKS: 50,
    ATTACK_REACH: 70,
    ATTACK_ARC_DEG: 360,
    RADIAL: true,
    DMG: 2,
    CHASE_ACQUIRE: 400,
    SEPARATION: 0,
    /** phase 2 slam flings three lava globs outward */
    SHOT_SPEED: 95,
    SHOT_DMG: 1,
    SHOT_LIFE_TICKS: 90,
    SPRITE_KEY: "enemy_golem",
    BODY_COLOR: PALETTE.ENEMY_GOLEM,
    HP_BAR: true,
    KILL_PITCH: 0.5,
    PHASE2_FRACTION: 0.5,
  },
  king: {
    HP: 60,
    SPEED: 50,
    ACCEL: 700,
    BODY_W: 20,
    BODY_H: 18,
    HURT_W: 20,
    HURT_H: 14,
    TELEGRAPH_TICKS: 20,
    ACTIVE_TICKS: 3,
    RECOVERY_TICKS: 14,
    REST_TICKS: 30,
    ATTACK_REACH: 50,
    ATTACK_ARC_DEG: 360,
    DMG: 1,
    CHASE_ACQUIRE: 400,
    SEPARATION: 0,
    /** phase 2/3 fire ghost volleys instead of the phase 1 melee mirror */
    SHOT_SPEED: 100,
    SHOT_DMG: 1,
    SHOT_LIFE_TICKS: 160,
    SPRITE_KEY: "enemy_king",
    BODY_COLOR: PALETTE.ENEMY_KING,
    HP_BAR: true,
    KILL_PITCH: 0.4,
    KING: true,
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

/** authored encounters that spawn from their room marker instead of the biome pool */
export const SCRIPTED_ENEMIES: EnemyKind[] = ["boss", "warden", "golem", "king"];

/** a scripted encounter bypasses the biome pool, the elite roll and the pool-selection law */
export function isScripted(kind: EnemyKind): boolean {
  return SCRIPTED_ENEMIES.includes(kind);
}

export const CONFIG = {
  TIME: {
    TICK_HZ: 60,
    TICK: 1 / 60,
  },

  DIALOGUE: {
    CHARS_PER_SECOND: 40,
  },

  WORLD: {
    TILE: 16,
    INTERNAL_W: 480,
    INTERNAL_H: 270,
    PIXEL_SCALE: 1.5,
    MIN_SCALE: 2,
  },

  ROOMS: {
    WAVES: [3, 4, 6, 8, 5, 10, 6, 4, 0, 8, 0, 0, 1, 0, 0, 3],
    END_DELAY: 40,
    TRAP_DMG: 1,
    CAMPFIRE_RADIUS: 18,
    FORGE_CAP: 3,
    WELL_COST: 5,
    SACRIFICE_HP: 2,
    CHALLENGE_WAVES: 3,
    CHALLENGE_BASE_COUNT: 2,
    CHALLENGE_BREAK_TICKS: 90,
    CHALLENGE_RING_X: 38,
    CHALLENGE_RING_Y: 28,
  },

  TOWN: {
    NPC_INTERACT_RADIUS: 24,
    BELL_TICKS: 360,
    GATE_COOLDOWN_TICKS: 30,
    RETREAT_PUSH: 24,
  },

  CURSES: {
    OFFER_EVERY: 3,
    MAX_CURSES: 3,
    FRAIL_HP: 2,
    SPEED_MULT: 0.8,
    STARTUP_TICKS: 2,
    WHIFF_CHANCE: 0.1,
    TAKEN_MULT: 2,
    DEALT_MULT: 1.5,
  },

  SHOP: {
    ARTIFACT: 15,
    HEAL: 8,
    MAXHP: 25,
    CURSE: 30,
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
  },

  ATTACK: {
    COMBOS: [
      { startup: 4, active: 3, recovery: 7 },
      { startup: 3, active: 3, recovery: 7 },
    ] as FrameData[],
    REACH: 24,
    DMG: 1,
  },

  /** mage normal attack: the equipped weapon's arc/reach are reinterpreted as a ranged volley */
  MAGE_SHOT: {
    SPEED: 240, // bolt travel, px/s
    RANGE_SCALE: 4, // weapon reach -> bolt range, px
    DEG_PER_PELLET: 60, // weapon arc deg / this = number of bolts
    MAX_PELLETS: 3,
    SPREAD_DEG: 7, // angular step between adjacent bolts, centered on the aim
    PELLET_DMG_SCALE: 0.75, // per-bolt damage relative to the swing's dmg
    Y_OFFSET: 5, // spawn height above the player's feet
  },

  DASH: {
    TICKS: 7,
    SPEED: 330,
    IFRAME_TICKS: 6,
    COOLDOWN: 54,
  },

  ENEMY: ENEMY_BASE,

  ASCENSION: {
    enemyHpMultiplier: 1,
    enemySpeedMultiplier: 1,
    playerHealMultiplier: 1,
    bossExtraPhase: false,
    extraEnemiesPerWave: 0,
    trapDamageMultiplier: 1,
    artifactChoices: 3,
    shopPriceMultiplier: 1,
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
    /** kill-cam: zoom+desat punch when a player swing kills (visual-only, see renderer) */
    IMPACT_TICKS: 2,
    IMPACT_ZOOM: 1.04,
    /** subtle blink, not a strobe: 0.4 read as harsh flicker on device */
    IMPACT_FLASH_ALPHA: 0.22,
    IMPACT_SATURATE: 0.45,
    /** ground blood decals per room; oldest is recycled when full */
    DECAL_CAP: 64,
    /** iris-wipe room transition (visual-only): half close + half open */
    ROOM_TRANSITION_TICKS: 36,
  },

  READABILITY: {
    PARTICLE_CAP: 120,
    DOWNSCALE_AT: 0.72,
    TIER3_OFF_AT: 0.9,
    VIGNETTE_MAX: 0.25,
    SLASH_ALPHA: 0.5,
    TELEGRAPH_FILL: 0.34,
    SHADOW_ALPHA: 0.35,
    IFRAME_ALPHA: 0.35,
  },

  /** renderer visual constants: torch animation, weather motes, floating-text cap, cine beats */
  RENDER: {
    /** torch flicker: sine rad per renderer-ms, glow-breath amplitude, and sprite toggle period (ms) */
    TORCH_FLICKER: 0.01,
    TORCH_PULSE: 0.15,
    TORCH_FRAME_MS: 120,
    WEATHER_COUNT: 48,
    TEXT_CAP: 24,
    /** cinematic letterbox beat length, in frames */
    KING_PHASE_CINE: 60,
    BOSS_INTRO_CINE: 120,
  },

  /** WebGL post chain (renderer ?renderer=gl). Strengths are multiplied by the matching
   *  SLIDERS entry, so every effect is graduated, never an on/off toggle. */
  BLOOM: {
    /** luminance cut-off (0..1, sRGB) above which a pixel emits into the glow; ~0.78 == the pitch's "brighter than 200/255" */
    THRESHOLD: 0.78,
    KNEE: 0.12,
    INTENSITY: 0.9,
    /** gaussian radius as a fraction of the half-res bloom RT texel */
    RADIUS: 1.35,
  },
  CRT: {
    /** barrel warp strength (kept mild so the 16px grid stays legible) */
    BARREL: 0.05,
    SCANLINE: 0.1,
    /** radial RGB-split in internal pixels at full slider */
    ABERRATION: 0.5,
  },
  HAZE: {
    /** heat-haze horizontal wobble: cycles/sec and amplitude in internal px at full slider */
    SPEED: 1.8,
    FREQ: 0.16,
    AMP: 0.6,
    /** how much of the ripple comes from animated value-noise vs the radial sine (0..1) */
    NOISE: 0.6,
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

  /** dynamic light map (GL only): per-biome ambient floor + radial emitters, scaled by SLIDERS.lighting */
  LIGHTING: {
    MAX: 32,
    AMBIENT: { town: 0.8, dungeon: 0.2, caverns: 0.45, forge: 0.45, void: 0.2 } as Record<string, number>,
    AMBIENT_DEFAULT: 0.5,
    TORCH: { r: 60, intensity: 0.9, color: [1, 0.78, 0.47] },
    PLAYER: { r: 70, intensity: 0.7, color: [0.78, 0.86, 1] },
    FIRE: { r: 40, intensity: 0.8, color: [1, 0.55, 0.25] },
    BURN: { r: 30, intensity: 0.6, color: [1, 0.59, 0.25] },
  },

  SLIDERS: {
    shake: 0.8,
    volume: 0.35,
    particles: 1,
    timescale: 1,
    hitStopScale: 1,
    dmgNumbers: 1,
    brightness: 1,
    bloom: 0.55,
    crt: 0.25,
    ripple: 0.15,
    lighting: 1,
  },

  /** pixelfx slash recipe: wind-up -> snap on the contact frame -> follow-through -> dotted residue.
   *  Phase boundaries are fractions of the swing life, so a stretched startup still snaps on contact. */
  FX_SLASH: {
    SNAP_HALF: 0.08,
    WINDUP_PEAK: 0.45,
    WINDUP_WIDTH: 1,
    SNAP_WIDTH: 3,
    FOLLOW_WIDTH: 2,
    RESIDUE_DOT_GAP: 3,
    RESIDUE_DOT_SIZE: 1,
  },

  LAWS: {
    /** test-harness limits and authored-balance assertions; runtime systems do not read these. */
    MIN_TELEGRAPH_S: 0.3,
    MAX_CHARGER_ARC_DEG: 60,
    /** ceilings asserted by the fuzz + determinism invariants; MAX_ENEMIES sits above the biggest authored wave */
    MAX_ENEMIES: 80,
    MAX_PROJECTILES: 160,
    FUZZ_BUDGET: 240,
    FUZZ_TRIALS: 80,
    /** composite scenes with no Canvas-only effects must skip CPU overlay uploads */
    SKIP_EMPTY_OVERLAY: true,
    /** headroom cap: per-frame tile quads pushed into the GPU batch must stay under this (screen is ~2100 cells) */
    MAX_TILE_BATCH: 4000,
  },

  PALETTE,
};
