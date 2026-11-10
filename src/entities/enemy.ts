import { CONFIG, enemyDef } from "../config.ts";
import type { EnemyDef, EnemyKind } from "../config.ts";
import { angleLerp, dist, normAngle } from "../mathx.ts";
import { createSwing, stepSwing } from "../systems/combat.ts";
import { knockback, pulse } from "../systems/feelSim.ts";
import { moveBody } from "../world/collision.ts";
import type { Rect } from "../mathx.ts";
import type { Side, Sim, Swing, Unit } from "../sim/types.ts";

export const ENEMY_STATE = {
  IDLE: "idle",
  CHASE: "chase",
  TELEGRAPH: "telegraph",
  ATTACK: "attack",
  HURT: "hurt",
  DEAD: "dead",
} as const;

export type EnemyState = (typeof ENEMY_STATE)[keyof typeof ENEMY_STATE];

/** one table for every archetype, so the transition law has a single source */
export const ENEMY_TRANSITIONS: Record<EnemyState, EnemyState[]> = {
  idle: ["chase", "telegraph", "hurt", "dead"],
  chase: ["idle", "telegraph", "hurt", "dead"],
  telegraph: ["attack", "hurt", "dead", "chase"],
  attack: ["idle", "telegraph", "hurt", "dead"],
  hurt: ["idle", "chase", "telegraph", "dead"],
  dead: [],
};

export function canGoEnemy(from: EnemyState, to: EnemyState): boolean {
  return from === to || ENEMY_TRANSITIONS[from].includes(to);
}

let nextId = 1;

export class Enemy implements Unit {
  readonly id: number;
  readonly side: Side = "enemy";
  readonly kind: EnemyKind;
  readonly def: EnemyDef;
  readonly bodyW: number;
  readonly bodyH: number;
  readonly killPitch: number;

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  hp: number;
  readonly maxHp: number;
  facing = Math.PI;
  state: EnemyState = ENEMY_STATE.IDLE;
  swing: Swing | null = null;
  dead = false;
  removed = false;

  ticksInState = 0;
  restTicks = 0;
  hurtTicks = 0;
  corpseTicks: number;
  animTicks = 0;

  /** boss only: never reverts, and shortens the telegraph / commits a second ring */
  enraged = false;
  /** rings still owed by the current attack */
  followUps = 0;

  /** telegraph geometry the renderer draws; locked halfway through so late dodges still work */
  telegraphDir = Math.PI;
  telegraphTicksLeft = 0;
  telegraphTotal: number;

  constructor(x: number, y: number, id: number, kind: EnemyKind = "chaser") {
    const def = enemyDef(kind);
    this.kind = kind;
    this.def = def;
    this.id = id;
    this.bodyW = def.BODY_W;
    this.bodyH = def.BODY_H;
    this.killPitch = def.KILL_PITCH;
    this.hp = def.HP;
    this.maxHp = def.HP;
    this.corpseTicks = def.CORPSE_TICKS;
    this.telegraphTotal = def.TELEGRAPH_TICKS;
    this.telegraphTicksLeft = def.TELEGRAPH_TICKS;
    this.x = x;
    this.y = y;
  }

  setState(next: EnemyState): void {
    if (!canGoEnemy(this.state, next)) throw new Error(`illegal enemy transition ${this.state} -> ${next}`);
    if (next !== this.state) {
      this.state = next;
      this.ticksInState = 0;
    }
  }

  hurtRect(): Rect {
    const w = this.def.HURT_W;
    const h = this.def.HURT_H;
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }

  canBeHit(): boolean {
    return !this.dead;
  }

  /** true when this enemy is in its vulnerable punish window */
  punishable(): boolean {
    return this.state === ENEMY_STATE.ATTACK && this.swing !== null && this.swing.phase === "recover";
  }

  onHit(sw: Swing, _cx: number, _cy: number, src: Sim): boolean {
    const e = this.def;
    this.hp -= sw.dmg;
    knockback(this, sw.dir, sw.knockback);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      this.split(src);
      return true;
    }
    if (e.ENRAGE_FRACTION > 0 && !this.enraged && this.hp <= this.maxHp * e.ENRAGE_FRACTION) this.enraged = true;
    this.swing = null;
    this.hurtTicks = e.HURT_TICKS;
    this.setState(ENEMY_STATE.HURT);
    return false;
  }

  die(): void {
    this.dead = true;
    this.swing = null;
    this.corpseTicks = this.def.CORPSE_TICKS;
    this.setState(ENEMY_STATE.DEAD);
  }

  private split(src: Sim): void {
    const e = this.def;
    if (e.SPLIT_INTO === null || e.SPLIT_COUNT <= 0) return;
    for (let i = 0; i < e.SPLIT_COUNT; i++) {
      const a = (i / e.SPLIT_COUNT) * Math.PI * 2 + src.rng.range(-0.6, 0.6);
      src.spawnEnemy(this.x + Math.cos(a) * 6, this.y + Math.sin(a) * 4, e.SPLIT_INTO);
    }
  }

  tick(src: Sim): void {
    const e = this.def;
    const dt = CONFIG.TIME.TICK;
    this.animTicks++;

    if (this.dead) {
      this.vx *= CONFIG.FEEL.DECEL_ON_DEATH;
      this.vy *= CONFIG.FEEL.DECEL_ON_DEATH;
      moveBody(this, src.room, dt);
      if (--this.corpseTicks <= 0) this.removed = true;
      return;
    }

    this.ticksInState++;
    if (this.restTicks > 0) this.restTicks--;

    if (this.swing !== null && stepSwing(this.swing)) this.swing = null;

    switch (this.state) {
      case ENEMY_STATE.IDLE:
        if (this.restTicks <= 0 && this.inRangeOfPlayer(src, e.CHASE_ACQUIRE)) this.setState(ENEMY_STATE.CHASE);
        this.brake(dt);
        break;

      case ENEMY_STATE.CHASE: {
        const toPlayer = Math.atan2(src.player.y - this.y, src.player.x - this.x);
        this.facing = angleLerp(this.facing, toPlayer, 0.18);
        if (!src.player.dead && dist(this.x, this.y, src.player.x, src.player.y) <= e.ATTACK_REACH) {
          this.beginTelegraph(toPlayer);
          break;
        }
        this.separate(src);
        this.vx += Math.cos(toPlayer) * e.ACCEL * dt;
        this.vy += Math.sin(toPlayer) * e.ACCEL * dt;
        this.capSpeed(e.SPEED);
        break;
      }

      case ENEMY_STATE.TELEGRAPH: {
        this.brake(dt);
        this.telegraphTicksLeft--;
        const locked = this.telegraphTicksLeft <= this.telegraphTotal * (1 - e.RETARGET_FRACTION);
        if (!locked && !src.player.dead) {
          const toPlayer = Math.atan2(src.player.y - this.y, src.player.x - this.x);
          this.telegraphDir = angleLerp(this.telegraphDir, toPlayer, 0.1);
        }
        if (this.telegraphTicksLeft <= 0) this.beginAttack(src);
        break;
      }

      case ENEMY_STATE.ATTACK: {
        const lunging = this.swing !== null && this.swing.phase === "active" && e.LUNGE_SPEED > 0;
        if (lunging) {
          this.vx = Math.cos(this.telegraphDir) * e.LUNGE_SPEED;
          this.vy = Math.sin(this.telegraphDir) * e.LUNGE_SPEED;
        } else {
          this.brake(dt);
        }
        if (this.swing === null) {
          this.restTicks = e.REST_TICKS;
          if (this.followUps > 0) {
            this.followUps--;
            this.beginTelegraph(this.telegraphDir);
          } else {
            this.setState(ENEMY_STATE.IDLE);
          }
        }
        break;
      }

      case ENEMY_STATE.HURT:
        this.vx *= e.KNOCKBACK_FRICTION;
        this.vy *= e.KNOCKBACK_FRICTION;
        if (--this.hurtTicks <= 0) {
          this.restTicks = e.REST_TICKS;
          this.setState(ENEMY_STATE.CHASE);
        }
        break;

      case ENEMY_STATE.DEAD:
        break;
    }

    if (!this.dead) moveBody(this, src.room, dt);
  }

  private beginTelegraph(dir: number): void {
    const e = this.def;
    const t = this.enraged && e.ENRAGED_TELEGRAPH_TICKS > 0 ? e.ENRAGED_TELEGRAPH_TICKS : e.TELEGRAPH_TICKS;
    this.telegraphTotal = t;
    this.telegraphTicksLeft = t;
    this.telegraphDir = dir;
    this.facing = dir;
    this.setState(ENEMY_STATE.TELEGRAPH);
  }

  private beginAttack(src: Sim): void {
    const e = this.def;
    this.swing = createSwing(src, {
      side: "enemy",
      combo: 1,
      dir: this.telegraphDir,
      ox: this.x,
      oy: this.y,
      reach: e.ATTACK_REACH,
      deg: e.ATTACK_ARC_DEG,
      dmg: e.DMG,
      knockback: 0,
      fd: { startup: 1, active: e.ACTIVE_TICKS, recovery: e.RECOVERY_TICKS },
    });
    this.followUps = this.enraged ? e.RING_FOLLOWUPS : 0;
    this.setState(ENEMY_STATE.ATTACK);
  }

  private inRangeOfPlayer(src: Sim, range: number): boolean {
    if (src.player.dead) return false;
    return dist(this.x, this.y, src.player.x, src.player.y) <= range;
  }

  private separate(src: Sim): void {
    const e = this.def;
    for (const other of src.enemies) {
      if (other === this || other.dead) continue;
      const d = dist(this.x, this.y, other.x, other.y);
      if (d > e.SEPARATION || d < 0.001) continue;
      const a = normAngle(Math.atan2(this.y - other.y, this.x - other.x));
      this.vx += Math.cos(a) * e.SEPARATION_PUSH;
      this.vy += Math.sin(a) * e.SEPARATION_PUSH;
    }
  }

  private brake(dt: number): void {
    const f = Math.pow(0.82, dt * 60);
    this.vx *= f;
    this.vy *= f;
    this.capSpeed(this.def.SPEED * 2.5);
  }

  private capSpeed(limit: number): void {
    const s = Math.hypot(this.vx, this.vy);
    if (s > limit) {
      this.vx = (this.vx / s) * limit;
      this.vy = (this.vy / s) * limit;
    }
  }

  blink(): boolean {
    const e = this.def;
    if (this.state !== ENEMY_STATE.TELEGRAPH) return false;
    const elapsed = this.telegraphTotal - this.telegraphTicksLeft;
    if (elapsed < this.telegraphTotal - e.BLINK_TAIL_TICKS) return false;
    return pulse(elapsed, e.BLINK_INTERVAL);
  }

  spriteFrame(): number {
    return Math.floor(this.animTicks / 11) % 2;
  }
}

export function resetEnemyIds(): void {
  nextId = 1;
}

export function makeEnemy(x: number, y: number, kind: EnemyKind = "chaser"): Enemy {
  return new Enemy(x, y, nextId++, kind);
}
