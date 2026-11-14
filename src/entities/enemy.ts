import { CONFIG, enemyDef } from "../config.ts";
import type { EnemyDef, EnemyKind } from "../config.ts";
import { angleLerp, dist, normAngle } from "../mathx.ts";
import { artifactText, dmgNumber, sfx, shake } from "../events.ts";
import { createSwing, hitFeedback, instantSwing, makeDamageCarrier, stepSwing } from "../systems/combat.ts";
import { knockback, pulse } from "../systems/feelSim.ts";
import { WEAPONS } from "../systems/weapons.ts";
import { moveBody } from "../world/collision.ts";
import type { SpatialGrid } from "../world/grid.ts";
import type { Rect } from "../mathx.ts";
import type { DamageCarrier, Side, Sim, Swing, Unit } from "../sim/types.ts";

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
  idle: ["chase", "telegraph", "hurt", "dead", "appear"],
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

const WARDEN_CYCLE = ["spiral", "laser", "summon"] as const;

export class Enemy implements Unit {
  readonly id: number;
  readonly side: Side = "enemy";
  readonly kind: EnemyKind;
  readonly def: EnemyDef;
  readonly bodyW: number;
  readonly bodyH: number;
  readonly killPitch: number;
  readonly isElite: boolean;
  readonly dmgScale: number;
  private readonly hurtW: number;
  private readonly hurtH: number;

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
  /** z-height in px: body hovers above its ground shadow (jumper/teleporter vanish arcs) */
  z = 0;
  burnTicks = 0;
  wetTicks = 0;
  shockTicks = 0;
  poisonTicks = 0;
  freezeTicks = 0;
  bleedTicks = 0;
  private burnPulse = 0;
  private poisonPulse = 0;
  private bleedCd = 0;
  private healTicks = 0;

  /** boss only: never reverts, and shortens the telegraph / commits a second ring */
  enraged = false;
  /** rings still owed by the current attack */
  followUps = 0;
  /** boss phase 3: counts finished ring attacks so summons fire every 2 rings */
  private attackRings = 0;

  /** warden only: the pattern the current telegraph commits to */
  pattern: (typeof WARDEN_CYCLE)[number] = "spiral";
  private patternIndex = 0;

  /** king only: 3-phase finale — cinematic freeze on each phase drop, brief i-frames while it summons */
  kingPhase: 1 | 2 | 3 = 1;
  kingInvulnTicks = 0;
  kingCinematicTicks = 0;

  /** telegraph geometry the renderer draws; locked halfway through so late dodges still work */
  telegraphDir = Math.PI;
  telegraphTicksLeft = 0;
  telegraphTotal: number;

  constructor(x: number, y: number, id: number, kind: EnemyKind = "chaser", elite = false) {
    const def = enemyDef(kind);
    this.kind = kind;
    this.def = def;
    this.id = id;
    this.isElite = elite;
    this.dmgScale = elite ? 1.5 : 1;
    const size = elite ? 1.3 : 1;
    this.bodyW = def.BODY_W * size;
    this.bodyH = def.BODY_H * size;
    this.hurtW = def.HURT_W * size;
    this.hurtH = def.HURT_H * size;
    this.killPitch = def.KILL_PITCH;
    this.hp = Math.ceil(def.HP * (elite ? 2 : 1) * CONFIG.ASCENSION.enemyHpMultiplier);
    this.maxHp = this.hp;
    this.corpseTicks = def.CORPSE_TICKS;
    this.telegraphTotal = def.TELEGRAPH_TICKS;
    this.telegraphTicksLeft = def.TELEGRAPH_TICKS;
    this.x = x;
    this.y = y;
    if (elite) this.setState(ENEMY_STATE.APPEAR);
  }

  setState(next: EnemyState): void {
    if (!canGoEnemy(this.state, next)) {
      console.warn(`ignored illegal enemy transition ${this.state} -> ${next}`);
      return;
    }
    if (next !== this.state) {
      this.state = next;
      this.ticksInState = 0;
      // only the vanish/appear pair keeps altitude; every other state lands the body
      if (next !== ENEMY_STATE.VANISH && next !== ENEMY_STATE.APPEAR) this.z = 0;
    }
  }

  hurtRect(): Rect {
    const w = this.hurtW;
    const h = this.hurtH;
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }

  canBeHit(): boolean {
    return !this.dead && this.state !== ENEMY_STATE.VANISH;
  }

  /** true when this enemy is in its vulnerable punish window */
  punishable(): boolean {
    return this.state === ENEMY_STATE.ATTACK && this.swing !== null && this.swing.phase === "recover";
  }

  telegraphThreatens(x: number, y: number): boolean {
    if (this.state !== ENEMY_STATE.TELEGRAPH) return false;
    const e = this.def;
    const dx = x - this.x;
    const dy = y - this.y;
    const distance = Math.hypot(dx, dy);
    if (e.EXPLODE_RADIUS > 0) return distance <= e.EXPLODE_RADIUS;
    if (this.kind === "warden" && this.pattern === "summon") return false;
    if (this.kind === "king" && this.kingPhase === 3) return distance <= e.ATTACK_REACH + 8;
    if (e.SNIPER || this.kind === "warden" && this.pattern === "laser") {
      const along = dx * Math.cos(this.telegraphDir) + dy * Math.sin(this.telegraphDir);
      const across = Math.abs(-dx * Math.sin(this.telegraphDir) + dy * Math.cos(this.telegraphDir));
      return along >= 0 && across <= 8;
    }
    if (this.kind === "warden" && this.pattern === "spiral") {
      const ray = Math.PI / 4;
      const nearestRay = Math.round(Math.atan2(dy, dx) / ray) * ray;
      return distance <= e.ATTACK_REACH + 8 &&
        Math.abs(normAngle(Math.atan2(dy, dx) - nearestRay)) <= Math.PI / 8;
    }
    if (distance > e.ATTACK_REACH + 8) return false;
    if (e.RADIAL) return true;
    return Math.abs(normAngle(Math.atan2(dy, dx) - this.telegraphDir)) <= e.ATTACK_ARC_DEG * Math.PI / 360;
  }

  onHit(sw: DamageCarrier, _cx: number, _cy: number, src: Sim): boolean {
    const e = this.def;
    if (this.dead) return false;
    if (this.kind === "king" && this.kingInvulnTicks > 0) {
      sw.dealt = 0;
      artifactText(src.queue, this.x, this.y - 16, "IMMUNE", "#e9d6ff");
      sfx(src.queue, "shock_hit", 0.4, 0.7);
      return false;
    }
    knockback(this, sw.dir, sw.knockback);
    const playerHit = sw.side === "player";
    const critChance = (src.artifacts.has("crit") ? 0.2 : 0) + (playerHit ? WEAPONS[src.player.weapon].critChance : 0);
    const crit = playerHit && critChance > 0 && src.rng.next() < critChance;
    const frozen = this.freezeTicks > 0;
    const statused = frozen || this.burnTicks > 0 || this.wetTicks > 0 || this.shockTicks > 0 || this.poisonTicks > 0 || this.bleedTicks > 0;
    if (frozen) this.freezeTicks = 0;
    let dmg = crit ? sw.dmg * 2 : sw.dmg;
    if (playerHit && statused && src.player.character === "mage") dmg *= 1.3;
    if (e.SHIELD && playerHit && Math.abs(normAngle(sw.dir - this.facing)) > Math.PI / 2) {
      dmg *= 0.5;
      src.particles.burstSpark(this.x, this.y - 5, 2, src.rng);
      sfx(src.queue, "shock_hit", 0.4, 0.6);
    }
    if (frozen) {
      dmg += 2;
      if (playerHit) artifactText(src.queue, this.x, this.y - 16, "PHÁ BĂNG", "#a8e8ff");
    }
    if (playerHit && this.wetTicks > 0 && src.artifacts.has("corrode")) dmg *= 1.25;
    if (playerHit && src.artifacts.has("executioner") && this.hp < this.maxHp * 0.2) dmg = this.hp;
    sw.dealt = dmg;
    this.takeDamage(dmg, src, playerHit);
    if (crit) {
      src.runStats.critHits++;
      src.queue.push({ t: "artifactText", x: this.x, y: this.y - 16, text: "CRIT", color: "#ffe66b" });
      sfx(src.queue, "kill", 0.6, 1.4);
    }
    if (!this.dead && sw.status) this.applyStatus(sw.status, src);
    if (!this.dead && playerHit && (sw.reach ?? 0) > 0 && src.artifacts.has("bleed")) this.applyStatus("bleed", src);
    if (this.dead) return true;
    this.swing = null;
    this.hurtTicks = e.HURT_TICKS;
    this.setState(ENEMY_STATE.HURT);
    return false;
  }

  private takeDamage(dmg: number, src: Sim, playerOwned = true): void {
    // a corpse must never re-enter the kill path (double bounty / enemiesKilled)
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp === 0) {
      this.die();
      this.split(src);
      src.runStats.enemiesKilled++;
      src.runStats.killsByKind[this.kind]++;
      src.runStats.killStreak++;
      if (this.kind === "boss" || this.kind === "warden" || this.kind === "golem" || this.kind === "king") {
        src.adjustHumanity(CONFIG.LAWS.HUMANITY_BOSS_RECOVERY);
      }
      const baseBounty = this.isElite
        ? src.room.kind === "elite" ? 6 : 3
        : this.kind === "boss" ? 20 : 1;
      const bounty = baseBounty * (src.room.kind === "challenge" ? 3 : 1);
      src.runStats.gold += bounty;
      src.runStats.totalGoldEarned += bounty;
      if (this.isElite) src.runStats.eliteKills++;
      if (this.kind === "warden") src.runStats.wardenKills++;
      if (this.kind === "golem") src.runStats.golemKills++;
      if (this.kind === "king") {
        src.runStats.kingKills++;
        if (src.runStats.hurtFree) src.runStats.kingNoDamage = true;
      }
      if (playerOwned) {
        src.runStats.roomKills++;
        src.player.registerKill(src);
        if (this.poisonTicks > 0) src.runStats.poisonKills++;
      }
      if (playerOwned && src.artifacts.has("heavy") && this.burnTicks === 0 && this.wetTicks === 0) src.runStats.heavyKills++;
      if (playerOwned && src.artifacts.has("pursuit")) {
        src.player.dashCd = Math.max(0, src.player.dashCd - 18);
        sfx(src.queue, "pursuit_proc", 0.5, 1.2);
      }
      if (playerOwned && src.artifacts.has("vampire") && src.runStats.enemiesKilled % 5 === 0 && !src.player.dead) {
        const cap = src.player.maxHp;
        if (src.player.hp < cap) {
          const healing = CONFIG.ASCENSION.playerHealMultiplier;
          src.player.hp = Math.min(cap, src.player.hp + healing);
          src.runStats.vampireHeals++;
          artifactText(src.queue, src.player.x, src.player.y - 14, `+${healing} HP`, "#e0455a");
          sfx(src.queue, "pursuit_proc", 0.6, 0.9);
        }
      }
      if (playerOwned && src.artifacts.has("detonate") && this.burnTicks > 0) this.detonate(src);
    } else if (this.def.ENRAGE_FRACTION > 0 && this.hp <= this.maxHp * this.def.ENRAGE_FRACTION) this.enraged = true;
  }

  private detonate(src: Sim): void {
    src.queue.push({ t: "slashArc", x: this.x, y: this.y, dir: 0, reach: 50, deg: 360, combo: 2, ticks: 12, contact: 0.5 });
    sfx(src.queue, "aftershock_boom", 1, 0.7);
    artifactText(src.queue, this.x, this.y - 12, "BỘC HỎA", "#ff7a3c");
    const blast = instantSwing(src, { side: "player", dir: 0, ox: this.x, oy: this.y, dmg: 3 });
    for (const other of src.enemies.slice()) {
      if (other === this || other.dead) continue;
      const hb = other.hurtRect();
      const cx = hb.x + hb.w / 2, cy = hb.y + hb.h / 2;
      if (Math.hypot(cx - this.x, cy - this.y) > 50) continue;
      const killed = other.onHit(blast, cx, cy, src);
      hitFeedback(src, other, blast, cx, cy, killed, false);
      if (!other.dead) other.applyStatus("burn", src);
    }
  }

  applyStatus(status: "burn" | "wet" | "shock" | "poison" | "freeze" | "bleed", src: Sim): void {
    if (this.dead || this.state === ENEMY_STATE.VANISH) return;
    if ((status === "burn" && this.wetTicks > 0) || (status === "wet" && this.burnTicks > 0)) {
      this.burnTicks = this.wetTicks = this.burnPulse = 0;
      src.runStats.comboSeen = true;
      this.takeDamage(2, src);
      src.particles.burstSpark(this.x, this.y - 5, 6, src.rng);
      dmgNumber(src.queue, this.x, this.y - 10, 2);
    } else if (status === "burn") {
      if (this.burnTicks === 0) this.burnPulse = CONFIG.STATUS.FIRST_PULSE_TICKS;
      this.burnTicks = 120;
    } else if (status === "wet") this.wetTicks = src.artifacts.has("corrode") ? 300 : 180;
    else if (status === "poison") {
      if (this.poisonTicks === 0) this.poisonPulse = CONFIG.STATUS.FIRST_PULSE_TICKS;
      this.poisonTicks = 240;
    } else if (status === "freeze") {
      if (this.freezeTicks === 0) {
        this.freezeTicks = 48;
        this.swing = null;
        this.followUps = 0;
        this.hurtTicks = this.def.HURT_TICKS;
        this.setState(ENEMY_STATE.HURT);
        sfx(src.queue, "shock_hit", 0.8, 1.5);
        artifactText(src.queue, this.x, this.y - 13, "ĐÓNG BĂNG", "#a8e8ff");
      }
    } else if (status === "bleed") this.bleedTicks = 300;
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

    if (this.kind === "king") this.tickKing(src);
    if (this.kingCinematicTicks > 0) {
      this.kingCinematicTicks--;
      this.vx = this.vy = 0;
      return;
    }

    // status aura: a slow orbit particle per active status, so the affliction reads at a glance
    if (this.animTicks % 3 === 0) {
      const orbA = this.animTicks * 0.3;
      const ox = this.x + Math.cos(orbA) * 8;
      const oy = this.y - 5 + Math.sin(orbA) * 3;
      const h = ((this.animTicks * 2654435761) ^ (this.id * 97)) >>> 0;
      const jit = ((h % 100) / 100 - 0.5) * 20;
      if (this.burnTicks > 0) src.particles.emit("ember", ox, oy, jit * 0.6, -26 - (h % 20), "#ff963f");
      else if (this.freezeTicks > 0) src.particles.emit("ice", ox, oy + 4, jit * 0.4, 8 + (h % 10), "#a8e8ff");
      else if (this.poisonTicks > 0) src.particles.emit("bubble", ox, oy, jit * 0.5, -16 - (h % 14), "#8f63ae");
      else if (this.shockTicks > 0) src.particles.emit("bolt", ox, oy, jit, 8 - (h % 30), "#ffe66b");
      else if (this.wetTicks > 0) src.particles.emit("bubble", ox, oy, jit * 0.5, -10 - (h % 10), "#58caff");
      else if (this.bleedTicks > 0) src.particles.emit("blood", ox, oy, jit * 0.4, 6 + (h % 12), CONFIG.PALETTE.BLOOD);
    }
    if (this.isElite && this.animTicks % 10 === 0) {
      const a = this.animTicks * 0.37;
      src.particles.emit("spark", this.x + Math.cos(a) * 7, this.y - 5 + Math.sin(a) * 3, 0, -24, "#ffd166", { life: 0.3 });
    }

    if (this.burnTicks > 0) {
      this.burnTicks--;
      if (--this.burnPulse === 0) {
        this.burnPulse = CONFIG.STATUS.PULSE_TICKS;
        this.takeDamage(1, src);
        src.particles.burstSpark(this.x, this.y - 5, 2, src.rng);
        for (let i = 0; i < 3; i++) {
          src.particles.emit("spark", this.x + src.rng.range(-3, 3), this.y - 6, src.rng.range(-12, 12), src.rng.range(-42, -18), "#ff963f", { life: 0.28 });
        }
        sfx(src.queue, "burn_tick", 0.3, 1);
        artifactText(src.queue, this.x, this.y - 13, "CHÁY", CONFIG.PALETTE.ELEMENT.burn);
        dmgNumber(src.queue, this.x, this.y - 10, 1, "element", CONFIG.PALETTE.ELEMENT.burn);
        if (this.dead) return;
      }
    }
    if (this.poisonTicks > 0) {
      this.poisonTicks--;
      if (--this.poisonPulse === 0) {
        this.poisonPulse = CONFIG.STATUS.PULSE_TICKS;
        const dmg = this.burnTicks > 0 ? 2 : 1;
        this.takeDamage(dmg, src);
        src.particles.burstSpark(this.x, this.y - 5, 2, src.rng);
        sfx(src.queue, "burn_tick", 0.3, 0.7);
        artifactText(src.queue, this.x, this.y - 13, "ĐỘC", CONFIG.PALETTE.ELEMENT.poison);
        dmgNumber(src.queue, this.x, this.y - 10, dmg, "element", CONFIG.PALETTE.ELEMENT.poison);
        if (this.dead) return;
      }
    }
    const speedScale = (this.wetTicks > 0 ? 0.7 : 1) * CONFIG.ASCENSION.enemySpeedMultiplier;
    if (this.wetTicks > 0) this.wetTicks--;
    if (this.bleedTicks > 0) this.bleedTicks--;
    if (this.bleedCd > 0) this.bleedCd--;
    const stunned = this.shockTicks > 0 || this.freezeTicks > 0;
    if (this.shockTicks > 0) this.shockTicks--;
    if (this.freezeTicks > 0) this.freezeTicks--;
    this.ticksInState++;
    if (this.state === ENEMY_STATE.HURT && --this.hurtTicks <= 0) {
      this.restTicks = e.REST_TICKS;
      this.setState(ENEMY_STATE.CHASE);
    }
    if (stunned) {
      this.vx = this.vy = 0;
      return;
    }
    // healing is an action: a stunned/frozen healer cannot pulse while it is locked down
    if (e.HEAL_INTERVAL > 0 && ++this.healTicks >= e.HEAL_INTERVAL) {
      this.healTicks = 0;
      for (const other of src.enemies) {
        if (other === this || other.dead || other.hp >= other.maxHp) continue;
        if (dist(this.x, this.y, other.x, other.y) > e.HEAL_RADIUS) continue;
        other.hp = Math.min(other.maxHp, other.hp + e.HEAL_AMOUNT);
        src.particles.emit("spark", other.x, other.y - 6, 0, -30, "#58ff8a");
        dmgNumber(src.queue, other.x, other.y - 10, e.HEAL_AMOUNT, "heal");
      }
      sfx(src.queue, "pursuit_proc", 0.3, 1.4);
    }
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
          if (this.kind === "golem" && this.golemRage()) this.fireLava(src);
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
        this.z = 6 * Math.min(1, this.ticksInState / e.VANISH_TICKS);
        if (this.ticksInState >= e.VANISH_TICKS) this.doAppear(src);
        break;

      case ENEMY_STATE.APPEAR: {
        const appearTicks = this.isElite ? CONFIG.ENEMY.ELITE_SPAWN_TICKS : e.APPEAR_TICKS;
        this.brake(dt);
        this.z = 6 * (1 - Math.min(1, this.ticksInState / appearTicks));
        if (this.ticksInState >= appearTicks) {
          const toPlayer = Math.atan2(src.player.y - this.y, src.player.x - this.x);
          this.beginTelegraph(src, toPlayer);
        }
        break;
      }

      case ENEMY_STATE.HURT:
        this.vx *= e.KNOCKBACK_FRICTION;
        this.vy *= e.KNOCKBACK_FRICTION;
        break;

      case ENEMY_STATE.DEAD:
        break;
    }

    if (!this.dead) moveBody(this, src.room, dt);
    if (!this.dead && this.bleedTicks > 0 && this.bleedCd <= 0 && (Math.hypot(this.vx, this.vy) > 10 || this.state === ENEMY_STATE.ATTACK)) {
      this.bleedCd = 30;
      this.takeDamage(1, src);
      artifactText(src.queue, this.x, this.y - 13, "MÁU", CONFIG.PALETTE.ELEMENT.bleed);
      dmgNumber(src.queue, this.x, this.y - 10, 1);
    }
  }

  /** 1 = calm, 2 = enraged rings, 3 = desperation + summons, 4 = ascension finale */
  bossPhase(): 1 | 2 | 3 | 4 {
    if (this.kind !== "boss") return 1;
    const frac = this.hp / this.maxHp;
    if (CONFIG.ASCENSION.bossExtraPhase && frac <= 0.1) return 4;
    if (this.def.PHASE3_FRACTION > 0 && frac <= this.def.PHASE3_FRACTION) return 3;
    if (this.enraged || frac <= this.def.ENRAGE_FRACTION) return 2;
    return 1;
  }

  /** golem phase 2: below its fraction of max hp the slam quickens and flings lava */
  private golemRage(): boolean {
    return this.kind === "golem" && this.def.PHASE2_FRACTION > 0 && this.hp <= this.maxHp * this.def.PHASE2_FRACTION;
  }

  /** the forgotten king steps 1 → 2 → 3, freezing on each drop and mirroring the player's weapon early */
  private tickKing(src: Sim): void {
    if (this.kingInvulnTicks > 0) this.kingInvulnTicks--;
    const frac = this.hp / this.maxHp;
    const target: 1 | 2 | 3 = frac <= 0.34 ? 3 : frac <= 0.67 ? 2 : 1;
    if (target > this.kingPhase) {
      this.kingPhase = target;
      this.kingCinematicTicks = 60;
      this.swing = null;
      this.followUps = 0;
      this.telegraphTicksLeft = 0;
      src.queue.push({ t: "kingPhase", phase: target });
      sfx(src.queue, "telegraph", 1, 0.5);
      shake(src.queue, this.x, this.y, this.facing, 1.6);
      if (target === 2) {
        src.spawnEnemy(this.x + 30, this.y, "chaser", true);
        src.spawnEnemy(this.x - 30, this.y, "chaser", true);
        this.kingInvulnTicks = 180;
      }
    }
  }

  private beginTelegraph(src: Sim, dir: number): void {
    const e = this.def;
    const phase = this.bossPhase();
    if (this.kind === "warden") this.pattern = WARDEN_CYCLE[this.patternIndex++ % WARDEN_CYCLE.length];
    const t = this.golemRage()
      ? 30
      : this.kind === "warden" && this.pattern === "laser" && e.LASER_TELEGRAPH_TICKS > 0
      ? e.LASER_TELEGRAPH_TICKS
      : phase >= 3 && e.PHASE3_TELEGRAPH_TICKS > 0
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
    if (e.EXPLODE_RADIUS > 0) {
      const dir = Math.atan2(src.player.y - this.y, src.player.x - this.x);
      if (!src.player.dead && dist(this.x, this.y, src.player.x, src.player.y) <= e.EXPLODE_RADIUS) {
        src.player.onHit(makeDamageCarrier({ side: "enemy", kind: this.kind, dmg: e.EXPLODE_DMG * this.dmgScale, dir }), this.x, this.y, src);
      }
      src.particles.burstSpark(this.x, this.y - 5, 12, src.rng);
      shake(src.queue, this.x, this.y, dir, 1.2);
      sfx(src.queue, "aftershock_boom", 1, 1.1);
      this.die();
      src.runStats.enemiesKilled++;
      src.runStats.killsByKind[this.kind]++;
      return;
    }
    if (this.kind === "warden") {
      if (this.pattern === "spiral") this.fireSpiral(src);
      else if (this.pattern === "laser") this.fireBeam(src);
      else this.summonMinions(src);
      this.setState(ENEMY_STATE.ATTACK);
      return;
    }
    if (this.kind === "king") {
      this.kingAttack(src);
      this.setState(ENEMY_STATE.ATTACK);
      return;
    }
    if (e.SNIPER) {
      this.fireBeam(src);
      this.setState(ENEMY_STATE.ATTACK);
      return;
    }
    if (e.RANGED) {
      this.fireShot(src);
      this.setState(ENEMY_STATE.ATTACK);
      return;
    }
    this.swing = createSwing(src, {
      side: "enemy",
      kind: this.kind,
      combo: 1,
      dir: this.telegraphDir,
      ox: this.x,
      oy: this.y - (e.RADIAL ? e.BODY_H * 0.5 : 0),
      reach: e.ATTACK_REACH,
      deg: e.ATTACK_ARC_DEG,
      dmg: e.DMG * this.dmgScale,
      knockback: 0,
      fd: { startup: 1, active: e.ACTIVE_TICKS, recovery: this.golemRage() ? 20 : e.RECOVERY_TICKS },
    });
    const phase = this.bossPhase();
    this.followUps = phase >= 2 ? phase - 1 : 0;
    if (this.kind === "boss") {
      this.attackRings++;
      if (phase >= 3 && this.attackRings % 2 === 0) {
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * Math.PI * 2 + src.rng.range(-0.4, 0.4);
          src.spawnEnemy(this.x + Math.cos(a) * 22, this.y + Math.sin(a) * 22, "small");
        }
        artifactText(src.queue, this.x, this.y - 16, "TRIỆU HỒI", "#c99ae6");
      }
    }
    this.setState(ENEMY_STATE.ATTACK);
  }

  private spawnShot(src: Sim, a: number, kind?: "ghost" | "lava"): void {
    const e = this.def;
    src.projectiles.push({
      x: this.x,
      y: this.y - e.BODY_H * 0.5,
      vx: Math.cos(a) * e.SHOT_SPEED,
      vy: Math.sin(a) * e.SHOT_SPEED,
      dmg: e.SHOT_DMG * this.dmgScale,
      ticksLeft: e.SHOT_LIFE_TICKS,
      owner: "enemy",
      sourceKind: this.kind,
      ...(kind !== undefined ? { kind } : {}),
    });
  }

  private fireShot(src: Sim): void {
    this.spawnShot(src, this.telegraphDir);
    sfx(src.queue, "shoot", 0.8, 1);
  }

  private fireSpiral(src: Sim): void {
    for (let i = 0; i < 8; i++) this.spawnShot(src, (i / 8) * Math.PI * 2 + this.animTicks * 0.05);
    sfx(src.queue, "shoot", 0.8, 0.7);
  }

  /** phase 1 mirrors the hero's own weapon; phases 2-3 trade the melee for ghost volleys */
  private kingAttack(src: Sim): void {
    const e = this.def;
    if (this.kingPhase === 1) {
      const cb = WEAPONS[src.player.weapon].combos[0];
      this.swing = createSwing(src, {
        side: "enemy",
        kind: "king",
        combo: 1,
        dir: this.telegraphDir,
        ox: this.x,
        oy: this.y - e.BODY_H * 0.5,
        reach: cb.reach,
        deg: cb.deg,
        dmg: e.DMG * this.dmgScale,
        knockback: 0,
        fd: { startup: 1, active: e.ACTIVE_TICKS, recovery: e.RECOVERY_TICKS },
      });
      sfx(src.queue, "slash_air", 0.7, 0.8);
      return;
    }
    const n = this.kingPhase === 3 ? 8 : 1;
    for (let i = 0; i < n; i++) {
      const a = this.kingPhase === 3 ? (i / n) * Math.PI * 2 : this.telegraphDir + src.rng.range(-0.1, 0.1);
      this.spawnShot(src, a, "ghost");
    }
    sfx(src.queue, "shoot", 0.8, 0.6);
  }

  /** a raging golem's slam spits three lava globs out at 120° */
  private fireLava(src: Sim): void {
    for (let i = 0; i < 3; i++) this.spawnShot(src, this.telegraphDir + ((i - 1) * Math.PI * 2) / 3, "lava");
    sfx(src.queue, "aftershock_boom", 0.5, 1.2);
  }

  private summonMinions(src: Sim): void {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      src.spawnEnemy(this.x + Math.cos(a) * 30, this.y + Math.sin(a) * 30, "small");
    }
    artifactText(src.queue, this.x, this.y - 18, "TRIỆU HỒI", "#c99ae6");
  }

  private fireBeam(src: Sim): void {
    const dir = this.telegraphDir;
    const fullLen = Math.hypot(src.room.widthPx, src.room.heightPx);
    const ox = this.x;
    const oy = this.y - this.def.BODY_H * 0.5;
    // raycast in 4px steps so a wall/crate between the shooter and the hero eats the beam
    let len = fullLen;
    const cos = Math.cos(dir);
    const sin = Math.sin(dir);
    for (let d = 4; d <= fullLen; d += 4) {
      if (src.room.solidAtPx(ox + cos * d, oy + sin * d)) {
        len = d;
        break;
      }
    }
    const px = src.player.x - ox;
    const py = src.player.y - oy;
    const along = px * cos + py * sin;
    const perp = Math.abs(-px * sin + py * cos);
    if (src.player.canBeHit() && along >= 0 && along <= len && perp <= 4) {
      src.player.onHit(makeDamageCarrier({ side: "enemy", kind: this.kind, dmg: 3 * this.dmgScale, dir }), src.player.x, src.player.y, src);
    }
    src.queue.push({ t: "beam", x: ox, y: oy, dir, len });
    shake(src.queue, ox, oy, dir, 0.8);
    sfx(src.queue, "shoot", 1, 0.5);
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

  shouldBlink(): boolean {
    const e = this.def;
    if (this.state !== ENEMY_STATE.TELEGRAPH) return false;
    const elapsed = this.telegraphTotal - this.telegraphTicksLeft;
    if (elapsed < this.telegraphTotal - e.BLINK_TAIL_TICKS) return false;
    return pulse(elapsed, e.BLINK_INTERVAL);
  }

}

export function resetEnemyIds(): void {
  nextId = 1;
}

export function makeEnemy(x: number, y: number, kind: EnemyKind = "chaser", elite = false): Enemy {
  return new Enemy(x, y, nextId++, kind, elite);
}
