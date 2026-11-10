import { CONFIG } from "../config.ts";
import { angleLerp, normAngle } from "../mathx.ts";
import { shake, sfx } from "../events.ts";
import { createSwing, playerSwingInit, stepSwing } from "../systems/combat.ts";
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
  autoTargetId = -1;
  private queuedAttackTicks = 0;

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.hp = CONFIG.PLAYER.HP;
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
    this.hp -= sw.dmg;
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

    this.integrate(intent, src, dt);
    moveBody(this, src.room, dt);

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
  }

  private startDash(intent: Intent, src: Sim): void {
    const d = CONFIG.DASH;
    const dir = intent.moveX !== 0 || intent.moveY !== 0 ? Math.atan2(intent.moveY, intent.moveX) : this.facing;
    this.swing = null;
    this.combo = 0;
    this.queuedAttackTicks = 0;
    this.setState(PLAYER_STATE.DASH);
    this.dashTicks = d.TICKS;
    this.dashDir = dir;
    this.dashCd = d.COOLDOWN;
    this.dashIframeTicks = d.IFRAME_TICKS;
    this.facing = dir;
    sfx(src.queue, "dash");
    src.particles.puffDust(this.x, this.y, CONFIG.FEEL.DASH_DUST, src.rng);
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

    const control = this.state === PLAYER_STATE.HURT ? 0 : this.swing !== null ? 0.35 : 1;
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

    if (control === 1) {
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > p.SPEED) {
        this.vx = (this.vx / speed) * p.SPEED;
        this.vy = (this.vy / speed) * p.SPEED;
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
