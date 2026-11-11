import type { Rect, Rng } from "../mathx.ts";
import type { ArtifactId, FireTrail } from "../systems/artifacts.ts";
import type { RunStats, EndMode } from "../systems/runStats.ts";
import type { Achievements } from "../systems/unlocks.ts";
import type { EventQueue } from "../events.ts";
import type { ParticlePool } from "../systems/particles.ts";
import type { Enemy } from "../entities/enemy.ts";
import type { Player } from "../entities/player.ts";
import type { Room } from "../world/rooms.ts";
import type { EnemyKind, FrameData } from "../config.ts";

export type Side = "player" | "enemy";

export type SwingPhase = "startup" | "active" | "recover";

export type Swing = {
  id: number;
  side: Side;
  combo: number;
  dir: number;
  phase: SwingPhase;
  ticksLeft: number;
  fd: FrameData;
  /** captured at swing start so movement cannot stretch the arc */
  ox: number;
  oy: number;
  reach: number;
  deg: number;
  dmg: number;
  knockback: number;
  /** per-swing-instance: a swing can never hit the same unit twice, whatever hit-stop does */
  seen: Set<number>;
  aftershockDone?: boolean;
  status?: "burn" | "wet" | "shock";
};

/** a travelling enemy shot: its own entity, blocked by terrain, dodged by i-frames */
export type Projectile = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  ticksLeft: number;
};

export interface Unit {
  id: number;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  bodyW: number;
  bodyH: number;
  dead: boolean;
  removed: boolean;
  swing: Swing | null;
  hurtRect(): Rect;
  canBeHit(): boolean;
  /** returns true when this hit was lethal */
  onHit(sw: Swing, cx: number, cy: number, src: Sim): boolean;
  /** per-unit pitch for the kill/hit sfx; enemies take it from their archetype */
  killPitch?: number;
}

export type Intent = {
  moveX: number;
  moveY: number;
  /** NaN means "no explicit aim": fall back to facing / auto-aim */
  aimX: number;
  aimY: number;
  attack: boolean;
  dash: boolean;
};

export type Sim = {
  artifacts: Set<ArtifactId>;
  fireTrails: FireTrail[];
  projectiles: Projectile[];
  units: Unit[];
  enemies: Enemy[];
  player: Player;
  room: Room;
  queue: EventQueue;
  particles: ParticlePool;
  rng: Rng;
  hitStopTicks: number;
  nextSwingId(): number;
  spawnEnemy(x: number, y: number, kind?: EnemyKind): void;
  loadRoom(index: number, respawnAtDoor: boolean): void;
  roomIndex: number;
  roomTotal: number;
  bannerTicks: number;
  bannerText: string;
  victory: boolean;
  playerDeadTicks: number;
  runStats: RunStats;
  pendingEnd: EndMode | null;
  achievements: Achievements;
};
