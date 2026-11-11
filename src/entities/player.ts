import { CONFIG } from "../config.ts";
import { angleLerp, dist, normAngle } from "../mathx.ts";
import { artifactText, shake, sfx } from "../events.ts";
import { createSwing, playerSwingInit, stepSwing } from "../systems/combat.ts";
import { ENEMY_STATE } from "./enemy.ts";
import { resolveAttackDir } from "../systems/aim.ts";
import { knockback } from "../systems/feelSim.ts";
import { moveBody } from "../world/collision.ts";
import type { Intent, Side, Sim, Swing, Unit } from "../sim/types.ts";
import type { Rect } from "../mathx.ts";

export const PLAYER_STATE = {
  IDLE: "idle",
  RUN: "run",
  ATTACK: "attack",
  DASH: "dash",
  HURT: "hurt",
  DEAD: "dead",
} as const;

export type PlayerState = (typeof PLAYER_STATE)[keyof typeof PLAYER_STATE];

const TRANSITIONS: Record<PlayerState, PlayerState[]> = {
  idle: ["run", "attack", "dash", "hurt", "dead"],
  run: ["idle", "attack", "dash", "hurt", "dead"],
  attack: ["idle", "run", "attack", "dash", "hurt", "dead"],
  dash: ["idle", "run", "attack", "hurt", "dead"],
  hurt: ["idle", "run", "dead"],
  dead: [],
};

export function canGoPlayer(from: PlayerState, to: PlayerState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class Player implements Unit {
  readonly id = 0;
  readonly side: Side = "player";
  readonly bodyW = CONFIG.PLAYER.BODY_W;
  readonly bodyH = CONFIG.PLAYER.BODY_H;

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  hp = CONFIG.PLAYER.HP;
  maxHp = CONFIG.PLAYER.HP;
  facing = 0;
  state: PlayerState = PLAYER_STATE.IDLE;
  swing: Swing | null = null;
  combo = 0;
  dead = false;
  removed = false;

  iframeTicks = 0;
  dashIframeTicks = 0;
  dashCd = 0;
  dashTicks = 0;
  dashDir = 0;
  hurtTicks = 0;
  deadTicks = 0;
  animTicks = 0;
  ghostTick = 0;
  impulseTicks = 0;
  reprisalTicks = 0;
  shieldReady = true;
  shieldCd = 0;
  autoTargetId = -1;
  private queuedAttackTicks = 0;

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.removed = false;
    this.state = PLAYER_STATE.IDLE;
    this.swing = null;
    this.combo = 0;
    this.queuedAttackTicks = 0;
    this.iframeTicks = 0;
    this.dashIframeTicks = 0;
    this.dashCd = 0;
    this.dashTicks = 0;
    this.impulseTicks = 0;
    this.reprisalTicks = 0;
    this.shieldReady = true;
    this.shieldCd = 0;
    this.hurtTicks = 0;
    this.deadTicks = 0;
    this.autoTargetId = -1;
  }

  setState(next: PlayerState): void {
    if (!canGoPlayer(this.state, next)) {
      throw new Error(`illegal player transition ${this.state} -> ${next}`);
    }
    this.state = next;
  }

  hurtRect(): Rect {
    const h = CONFIG.PLAYER.HURT_H;
    const w = CONFIG.PLAYER.HURT_W;
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }

  canBeHit(): boolean {
    return !this.dead && this.iframeTicks <= 0 && this.dashIframeTicks <= 0;
  }

  onHit(sw: Swing, cx: number, cy: number, src: Sim): boolean {
    const p = CONFIG.PLAYER;
    if (src.artifacts.has("shield") && this.shieldReady) {
      this.shieldReady = false;
      this.shieldCd = 420;
      knockback(this, sw.dir, p.HURT_KNOCKBACK);
      artifactText(src.queue, this.x, this.y - 14, "KHIÊN", "#8ab4ff");
      sfx(src.queue, "reprisal_ready", 0.8, 1.3);
      return false;
    }
    const dmg = sw.dmg * (src.curses.has("glass") ? CONFIG.CURSES.TAKEN_MULT : 1);
    this.hp -= dmg;
    src.runStats.damageTaken += dmg;
    if (sw.kind === "boss") src.runStats.bossDamageTaken += dmg;
    src.runStats.hurtFree = false;
    this.swing = null;
    this.combo = 0;
    this.queuedAttackTicks = 0;
    knockback(this, sw.dir, p.HURT_KNOCKBACK);
    src.particles.burstBlood(cx, cy, sw.dir, CONFIG.FEEL.PLAYER_BLOOD, src.rng);
    shake(src.queue, this.x, this.y, sw.dir, CONFIG.FEEL.SHAKE_PLAYER_HURT_MULT);

    if (this.hp <= 0) {
      this.hp = 0;
      this.die(src);
      return true;
    }
    if (src.artifacts.has("reprisal")) {
      this.reprisalTicks = 120;
      sfx(src.queue, "reprisal_ready", 0.8, 1);
      artifactText(src.queue, this.x, this.y - 14, "PHẢN KÍCH", "#ffd166");
    } else {
      this.reprisalTicks = 0;
    }
    this.iframeTicks = p.IFRAMES;
    this.hurtTicks = p.HURT_TICKS;
    this.setState(PLAYER_STATE.HURT);
    src.queue.push({ t: "hurtVignette", strength: CONFIG.READABILITY.VIGNETTE_MAX });
    sfx(src.queue, "hurt");
    return false;
  }

  die(src: Sim): void {
    this.dead = true;
    this.deadTicks = 0;
    this.setState(PLAYER_STATE.DEAD);
    sfx(src.queue, "death");
    src.particles.burstShards(this.x, this.y - 6, CONFIG.FEEL.DEATH_SHARDS, CONFIG.PALETTE.PLAYER_BODY, src.rng);
  }

  tick(intent: Intent, src: Sim): void {
    const dt = CONFIG.TIME.TICK;
    if (this.iframeTicks > 0) this.iframeTicks--;
    if (this.dashIframeTicks > 0) this.dashIframeTicks--;
    if (this.dashCd > 0) this.dashCd--;
    if (this.impulseTicks > 0) this.impulseTicks--;
    if (this.reprisalTicks > 0) this.reprisalTicks--;
    if (this.shieldCd > 0 && --this.shieldCd === 0) this.shieldReady = true;
    this.animTicks++;

    if (this.dead) {
      this.deadTicks++;
      this.vx *= 0.8;
      this.vy *= 0.8;
      moveBody(this, src.room, dt);
      return;
    }

    const hasCursor = Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY);
    if (hasCursor) this.facing = Math.atan2(intent.aimY - this.y, intent.aimX - this.x);
    else if (intent.moveX !== 0 || intent.moveY !== 0) {
      this.facing = angleLerp(this.facing, Math.atan2(intent.moveY, intent.moveX), 0.55);
    }

    // TRANSITIONS forbids hurt -> attack, so an unguarded request would throw and stop the loop
    const attackAllowed = this.state !== PLAYER_STATE.HURT;
    const freshRequest = intent.attack && attackAllowed && this.swing === null;
    if (this.queuedAttackTicks > 0) this.queuedAttackTicks--;
    if (intent.attack && attackAllowed && this.swing !== null && this.combo < CONFIG.ATTACK.COMBOS.length) {
      this.queuedAttackTicks = CONFIG.INPUT.PRESS_BUFFER_TICKS;
    }

    if (intent.dash && this.dashCd <= 0 && this.state !== PLAYER_STATE.HURT) {
      this.startDash(intent, src);
    } else if (this.swing !== null) {
      const done = stepSwing(this.swing);
      if (this.queuedAttackTicks > 0 && this.canChain()) this.startSwing(src, this.combo + 1, intent, this.swing.dir);
      else if (done) {
        this.swing = null;
        this.combo = 0;
        this.queuedAttackTicks = 0;
      }
    } else if (freshRequest) {
      this.startSwing(src, 1, intent, null);
    }

    const dashing = this.state === PLAYER_STATE.DASH;
    this.integrate(intent, src, dt);
    moveBody(this, src.room, dt);
    if (dashing && src.artifacts.has("fire")) {
      src.fireTrails.at(-1)?.points.push({ x: this.x, y: this.y - 3, ticks: 60 });
    }

    if (this.swing === null && this.state !== PLAYER_STATE.DASH && this.state !== PLAYER_STATE.HURT) {
      const moving = Math.abs(intent.moveX) + Math.abs(intent.moveY) > 0.1;
      this.setState(moving ? PLAYER_STATE.RUN : PLAYER_STATE.IDLE);
    }
  }

  private canChain(): boolean {
    const sw = this.swing;
    if (sw === null) return false;
    const maxCombo = CONFIG.ATTACK.COMBOS.length;
    return sw.phase === "recover" && sw.ticksLeft <= CONFIG.ATTACK.CHAIN_CANCEL_WINDOW && sw.combo < maxCombo;
  }

  private startSwing(src: Sim, combo: number, intent: Intent, prevDir: number | null): void {
    const aim = resolveAttackDir(this.x, this.y, prevDir === null ? this.facing : normAngle(prevDir + Math.PI), cursorOf(intent), src.enemies);
    const init = playerSwingInit(src, combo, aim.dir);
    init.ox = this.x;
    init.oy = this.y;
    this.swing = createSwing(src, init);
    this.impulseTicks = 0;
    this.reprisalTicks = 0;
    this.combo = combo;
    this.queuedAttackTicks = 0;
    this.autoTargetId = aim.targetId;
    this.setState(PLAYER_STATE.ATTACK);
    sfx(src.queue, "slash_air", 0.7, combo === 2 ? 1.12 : 1);
    const fd = CONFIG.ATTACK.COMBOS[combo - 1];
    src.queue.push({
      t: "slashArc",
      x: init.ox,
      y: init.oy,
      dir: aim.dir,
      reach: init.reach,
      deg: init.deg,
      combo,
      ticks: fd.startup + fd.active,
    });
    if (combo === 2 && src.artifacts.has("twin_blades")) {
      src.queue.push({ t: "slashArc", x: init.ox, y: init.oy, dir: normAngle(aim.dir + Math.PI), reach: init.reach, deg: init.deg, combo, ticks: fd.startup + fd.active });
    }
  }

  private startDash(intent: Intent, src: Sim): void {
    const d = CONFIG.DASH;
    const dir = intent.moveX !== 0 || intent.moveY !== 0 ? Math.atan2(intent.moveY, intent.moveX) : this.facing;
    src.runStats.dashCount++;
    if (src.enemies.some(e => !e.dead && e.state === ENEMY_STATE.TELEGRAPH)) src.runStats.perfectDodges++;
    this.swing = null;
    this.combo = 0;
    this.queuedAttackTicks = 0;
    this.setState(PLAYER_STATE.DASH);
    this.dashDir = dir;
    this.impulseTicks = src.artifacts.has("impulse") ? 120 : 0;
    if (src.artifacts.has("fire")) src.fireTrails.push({ points: [{ x: this.x, y: this.y - 3, ticks: 60 }], seen: new Set() });
    this.dashCd = d.COOLDOWN;
    this.facing = dir;
    if (src.artifacts.has("phantom_dash")) {
      const ox = this.x, oy = this.y;
      let step = 0;
      while (step < 60 && !src.room.solidAtPx(this.x + Math.cos(dir) * (step + 6), this.y + Math.sin(dir) * (step + 6))) step += 6;
      this.x += Math.cos(dir) * step;
      this.y += Math.sin(dir) * step;
      const slash = createSwing(src, { side: "player", combo: 0, dir, ox, oy, reach: 0, deg: 0, dmg: 2, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
      for (const e of src.enemies) {
        if (e.dead || !e.canBeHit()) continue;
        if ([0, 0.5, 1].some(t => dist(e.x, e.y, ox + (this.x - ox) * t, oy + (this.y - oy) * t) < 14)) {
          e.onHit(slash, e.x, e.y, src);
          if (e.dead) src.runStats.phantomKills++;
        }
      }
      this.dashTicks = 0;
      this.dashIframeTicks = 0;
      this.setState(PLAYER_STATE.IDLE);
      src.particles.afterimage(ox, oy - CONFIG.PLAYER.BODY_H, "player");
      sfx(src.queue, "teleport", 0.7, 1.1);
    } else {
      this.dashTicks = d.TICKS;
      this.dashIframeTicks = d.IFRAME_TICKS;
      sfx(src.queue, "dash");
      src.particles.puffDust(this.x, this.y, CONFIG.FEEL.DASH_DUST, src.rng);
    }
  }

  private integrate(intent: Intent, src: Sim, dt: number): void {
    const p = CONFIG.PLAYER;
    if (this.state === PLAYER_STATE.DASH) {
      this.vx = Math.cos(this.dashDir) * CONFIG.DASH.SPEED;
      this.vy = Math.sin(this.dashDir) * CONFIG.DASH.SPEED;
      this.ghostTick++;
      if (this.ghostTick % 2 === 0) src.particles.afterimage(this.x, this.y - p.BODY_H, "player");
      if (--this.dashTicks <= 0) this.setState(PLAYER_STATE.IDLE);
      return;
    }

    const control = this.state === PLAYER_STATE.HURT ? 0 : 1;
    if (this.state === PLAYER_STATE.HURT) {
      this.hurtTicks--;
      if (this.hurtTicks <= 0) this.setState(PLAYER_STATE.IDLE);
    }

    const len = Math.hypot(intent.moveX, intent.moveY);
    if (len > 0.1 && control > 0) {
      const ax = (intent.moveX / Math.max(1, len)) * p.ACCEL * control;
      const ay = (intent.moveY / Math.max(1, len)) * p.ACCEL * control;
      this.vx += ax * dt;
      this.vy += ay * dt;
    } else {
      const f = Math.pow(p.FRICTION, dt * 60);
      this.vx *= f;
      this.vy *= f;
      if (Math.abs(this.vx) < 1) this.vx = 0;
      if (Math.abs(this.vy) < 1) this.vy = 0;
    }

    if (control > 0) {
      const speed = Math.hypot(this.vx, this.vy);
      const maxSpeed = p.SPEED * (src.artifacts.has("desperate") && this.hp <= 2 ? 1.2 : 1) *
        (src.curses.has("heavy_legs") ? CONFIG.CURSES.SPEED_MULT : 1);
      if (speed > maxSpeed) {
        this.vx = (this.vx / speed) * maxSpeed;
        this.vy = (this.vy / speed) * maxSpeed;
      }
    }
  }

  /** 0..3 walk cycle, mirrored by facing for the slash-heavy look */
  spriteFrame(): number {
    if (this.state === PLAYER_STATE.IDLE) return 0;
    return Math.floor(this.animTicks / 7) % 4;
  }
}

function cursorOf(intent: Intent): { x: number; y: number } | null {
  return Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY)
    ? { x: intent.aimX, y: intent.aimY }
    : null;
}
