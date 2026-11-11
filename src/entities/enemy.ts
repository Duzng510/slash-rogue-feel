import { CONFIG, enemyDef } from "../config.ts";
import type { EnemyDef, EnemyKind } from "../config.ts";
import { angleLerp, dist, normAngle } from "../mathx.ts";
import { artifactText, sfx } from "../events.ts";
import { createSwing, stepSwing } from "../systems/combat.ts";
import { knockback, pulse } from "../systems/feelSim.ts";
import { moveBody } from "../world/collision.ts";
import type { SpatialGrid } from "../world/grid.ts";
import type { Rect } from "../mathx.ts";
import type { Side, Sim, Swing, Unit } from "../sim/types.ts";

export const ENEMY_STATE = {
  IDLE: "idle",
  CHASE: "chase",
  TELEGRAPH: "telegraph",
  ATTACK: "attack",
  VANISH: "vanish",
  APPEAR: "appear",
  HURT: "hurt",
  DEAD: "dead",
} as const;

export type EnemyState = (typeof ENEMY_STATE)[keyof typeof ENEMY_STATE];

/** one table for every archetype, so the transition law has a single source */
export const ENEMY_TRANSITIONS: Record<EnemyState, EnemyState[]> = {
  idle: ["chase", "telegraph", "hurt", "dead"],
  chase: ["idle", "telegraph", "hurt", "dead", "vanish"],
  telegraph: ["attack", "hurt", "dead", "chase"],
  vanish: ["appear", "dead"],
  appear: ["telegraph", "hurt", "dead"],
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
  burnTicks = 0;
  wetTicks = 0;
  shockTicks = 0;
  private burnPulse = 0;

  /** boss only: never reverts, and shortens the telegraph / commits a second ring */
  enraged = false;
  /** rings still owed by the current attack */
  followUps = 0;
  /** boss phase 3: counts finished ring attacks so summons fire every 2 rings */
  private attackRings = 0;

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
    return !this.dead && this.state !== ENEMY_STATE.VANISH;
  }

  /** true when this enemy is in its vulnerable punish window */
  punishable(): boolean {
    return this.state === ENEMY_STATE.ATTACK && this.swing !== null && this.swing.phase === "recover";
  }

  onHit(sw: Swing, _cx: number, _cy: number, src: Sim): boolean {
    const e = this.def;
    if (this.dead) return false;
    knockback(this, sw.dir, sw.knockback);
    this.takeDamage(sw.dmg, src, sw.side === "player");
    if (!this.dead && sw.status) this.applyStatus(sw.status, src);
    if (this.dead) return true;
    this.swing = null;
    this.hurtTicks = e.HURT_TICKS;
    this.setState(ENEMY_STATE.HURT);
    return false;
  }

  private takeDamage(dmg: number, src: Sim, playerOwned = true): void {
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp === 0) {
      this.die();
      this.split(src);
      src.runStats.enemiesKilled++;
      src.runStats.killStreak++;
      if (playerOwned && src.artifacts.has("heavy") && this.burnTicks === 0 && this.wetTicks === 0) src.runStats.heavyKills++;
      if (playerOwned && src.artifacts.has("pursuit")) {
        src.player.dashCd = Math.max(0, src.player.dashCd - 18);
        sfx(src.queue, "pursuit_proc", 0.5, 1.2);
      }
    } else if (this.def.ENRAGE_FRACTION > 0 && this.hp <= this.maxHp * this.def.ENRAGE_FRACTION) this.enraged = true;
  }

  applyStatus(status: "burn" | "wet" | "shock", src: Sim): void {
    if (this.dead) return;
    if (status === "burn" && this.wetTicks > 0 || status === "wet" && this.burnTicks > 0) {
      this.burnTicks = this.wetTicks = this.burnPulse = 0;
      src.runStats.comboSeen = true;
      this.takeDamage(2, src);
      src.particles.burstSpark(this.x, this.y - 5, 6, src.rng);
      src.queue.push({ t: "dmgNumber", x: this.x, y: this.y - 10, value: 2 });
    } else if (status === "burn") {
      if (this.burnTicks === 0) this.burnPulse = 60;
      this.burnTicks = 120;
    } else if (status === "wet") this.wetTicks = 180;
    else if (this.shockTicks === 0) {
      this.shockTicks = this.wetTicks > 0 ? 48 : 15;
      this.wetTicks = 0;
      this.swing = null;
      this.followUps = 0;
      this.hurtTicks = this.def.HURT_TICKS;
      this.setState(ENEMY_STATE.HURT);
      sfx(src.queue, "shock_hit", 1, this.shockTicks > 30 ? 0.8 : 1.1);
      artifactText(src.queue, this.x, this.y - 13, "CHOÁNG", "#ffe66b");
    }
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

  tick(src: Sim, grid: SpatialGrid): void {
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

    if (this.burnTicks > 0) {
      this.burnTicks--;
      if (--this.burnPulse === 0) {
        this.burnPulse = 60;
        this.takeDamage(1, src);
        src.particles.burstSpark(this.x, this.y - 5, 2, src.rng);
        for (let i = 0; i < 3; i++) {
          src.particles.emit("spark", this.x + src.rng.range(-3, 3), this.y - 6, src.rng.range(-12, 12), src.rng.range(-42, -18), "#ff963f", { life: 0.28 });
        }
        sfx(src.queue, "burn_tick", 0.3, 1);
        artifactText(src.queue, this.x, this.y - 13, "CHÁY", "#ff963f");
        if (CONFIG.SLIDERS.dmgNumbers > 0) src.queue.push({ t: "dmgNumber", x: this.x, y: this.y - 10, value: 1 });
        if (this.dead) return;
      }
    }
    const speedScale = this.wetTicks > 0 ? 0.7 : 1;
    if (this.wetTicks > 0) this.wetTicks--;
    if (this.shockTicks > 0) {
      this.shockTicks--;
      this.vx = this.vy = 0;
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
        const d = dist(this.x, this.y, src.player.x, src.player.y);
        this.facing = angleLerp(this.facing, toPlayer, 0.18);
        const canShoot = !e.RANGED || d >= e.STANDOFF_MIN;
        if (!src.player.dead && d <= e.ATTACK_REACH && canShoot) {
          if (e.TELEPORTER) this.beginVanish(src);
          else this.beginTelegraph(src, toPlayer);
          break;
        }
        let moveDir = toPlayer;
        if (e.RANGED) {
          if (d > e.STANDOFF_MAX) moveDir = toPlayer;
          else if (d < e.STANDOFF_MIN) moveDir = toPlayer + Math.PI;
          else moveDir = toPlayer + Math.PI / 2;
        }
        if (!e.RANGED) this.separate(grid);
        this.vx += Math.cos(moveDir) * e.ACCEL * dt;
        this.vy += Math.sin(moveDir) * e.ACCEL * dt;
        this.capSpeed(e.SPEED * speedScale);
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
          this.vx = Math.cos(this.telegraphDir) * e.LUNGE_SPEED * speedScale;
          this.vy = Math.sin(this.telegraphDir) * e.LUNGE_SPEED * speedScale;
        } else {
          this.brake(dt);
        }
        if (this.swing === null) {
          this.restTicks = e.REST_TICKS;
          if (this.followUps > 0) {
            this.followUps--;
            this.beginTelegraph(src, this.telegraphDir);
          } else {
            this.setState(ENEMY_STATE.IDLE);
          }
        }
        break;
      }

      case ENEMY_STATE.VANISH:
        this.brake(dt);
        if (this.ticksInState >= e.VANISH_TICKS) this.doAppear(src);
        break;

      case ENEMY_STATE.APPEAR: {
        this.brake(dt);
        if (this.ticksInState >= e.APPEAR_TICKS) {
          const toPlayer = Math.atan2(src.player.y - this.y, src.player.x - this.x);
          this.beginTelegraph(src, toPlayer);
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

  /** 1 = calm, 2 = enraged rings, 3 = desperation + summons (boss only) */
  bossPhase(): 1 | 2 | 3 {
    if (this.kind !== "boss") return 1;
    const frac = this.hp / this.maxHp;
    if (this.def.PHASE3_FRACTION > 0 && frac <= this.def.PHASE3_FRACTION) return 3;
    if (this.enraged || frac <= this.def.ENRAGE_FRACTION) return 2;
    return 1;
  }

  private beginTelegraph(src: Sim, dir: number): void {
    const e = this.def;
    const phase = this.bossPhase();
    const t = phase === 3 && e.PHASE3_TELEGRAPH_TICKS > 0
      ? e.PHASE3_TELEGRAPH_TICKS
      : phase === 2 && e.ENRAGED_TELEGRAPH_TICKS > 0
        ? e.ENRAGED_TELEGRAPH_TICKS
        : e.TELEGRAPH_TICKS;
    this.telegraphTotal = t;
    this.telegraphTicksLeft = t;
    this.telegraphDir = dir;
    this.facing = dir;
    this.setState(ENEMY_STATE.TELEGRAPH);
    sfx(src.queue, "telegraph", 0.5, this.kind === "boss" ? 0.7 : this.kind === "small" ? 1.3 : 1);
  }

  private beginAttack(src: Sim): void {
    const e = this.def;
    if (e.RANGED) {
      this.fireShot(src);
      this.setState(ENEMY_STATE.ATTACK);
      return;
    }
    this.swing = createSwing(src, {
      side: "enemy",
      combo: 1,
      dir: this.telegraphDir,
      ox: this.x,
      oy: this.y - (e.RADIAL ? e.BODY_H * 0.5 : 0),
      reach: e.ATTACK_REACH,
      deg: e.ATTACK_ARC_DEG,
      dmg: e.DMG,
      knockback: 0,
      fd: { startup: 1, active: e.ACTIVE_TICKS, recovery: e.RECOVERY_TICKS },
    });
    const phase = this.bossPhase();
    this.followUps = phase >= 2 ? phase - 1 : 0;
    if (this.kind === "boss") {
      this.attackRings++;
      if (phase === 3 && this.attackRings % 2 === 0) {
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * Math.PI * 2 + src.rng.range(-0.4, 0.4);
          src.spawnEnemy(this.x + Math.cos(a) * 22, this.y + Math.sin(a) * 22, "small");
        }
        artifactText(src.queue, this.x, this.y - 16, "TRIỆU HỒI", "#c99ae6");
      }
    }
    this.setState(ENEMY_STATE.ATTACK);
  }

  private fireShot(src: Sim): void {
    const e = this.def;
    const dir = this.telegraphDir;
    src.projectiles.push({
      x: this.x,
      y: this.y - e.BODY_H * 0.5,
      vx: Math.cos(dir) * e.SHOT_SPEED,
      vy: Math.sin(dir) * e.SHOT_SPEED,
      dmg: e.SHOT_DMG,
      ticksLeft: e.SHOT_LIFE_TICKS,
    });
    sfx(src.queue, "shoot", 0.8, 1);
  }

  private beginVanish(src: Sim): void {
    this.setState(ENEMY_STATE.VANISH);
    src.particles.puffDust(this.x, this.y, 4, src.rng);
    sfx(src.queue, "teleport", 0.6, 1.2);
  }

  /** blink to just behind the player, falling back to ringed offsets if that tile is solid */
  private doAppear(src: Sim): void {
    const e = this.def;
    const pf = src.player.facing;
    const d = e.APPEAR_DIST;
    let tx = src.player.x - Math.cos(pf) * d;
    let ty = src.player.y - Math.sin(pf) * d;
    if (src.room.solidAtPx(tx, ty)) {
      for (let k = 1; k <= 3; k++) {
        const a = pf + Math.PI + (k * Math.PI) / 2;
        const cx = src.player.x + Math.cos(a) * d;
        const cy = src.player.y + Math.sin(a) * d;
        if (!src.room.solidAtPx(cx, cy)) {
          tx = cx;
          ty = cy;
          break;
        }
      }
    }
    this.x = tx;
    this.y = ty;
    this.setState(ENEMY_STATE.APPEAR);
    src.particles.burstSpark(this.x, this.y - 5, 4, src.rng);
    sfx(src.queue, "teleport", 0.7, 0.8);
  }

  private inRangeOfPlayer(src: Sim, range: number): boolean {
    if (src.player.dead) return false;
    return dist(this.x, this.y, src.player.x, src.player.y) <= range;
  }

  private separate(grid: SpatialGrid): void {
    const e = this.def;
    for (const other of grid.query(this.x, this.y, e.SEPARATION)) {
      if (other === this || other.dead || other.side !== "enemy") continue;
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
