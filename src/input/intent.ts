import { CONFIG } from "../config.ts";
import type { Intent } from "../sim/types.ts";

const NONE = -99999;

const IDLE: Intent = { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false };

export type AimPoint = { x: number; y: number } | null;

/**
 * Sampled once per render frame, consumed once per sim tick.
 * Axes are latest-wins; presses are a one-slot queue with a TTL in *sim ticks*, so a press
 * landed during hit-stop still fires when the freeze ends instead of being swallowed.
 */
export class IntentSource {
  moveX = 0;
  moveY = 0;
  aim: AimPoint = null;
  private attackAt = NONE;
  private dashAt = NONE;

  pressAttack(tick: number): void {
    this.attackAt = tick;
  }

  pressDash(tick: number): void {
    this.dashAt = tick;
  }

  clearPresses(): void {
    this.attackAt = NONE;
    this.dashAt = NONE;
  }

  read(tick: number, live = true): Intent {
    if (!live) return IDLE;
    const ttl = CONFIG.INPUT.PRESS_BUFFER_TICKS;
    const attack = this.attackAt !== NONE && tick - this.attackAt <= ttl;
    const dash = this.dashAt !== NONE && tick - this.dashAt <= ttl;
    if (attack) this.attackAt = NONE;
    if (dash) this.dashAt = NONE;
    return {
      moveX: this.moveX,
      moveY: this.moveY,
      aimX: this.aim === null ? NaN : this.aim.x,
      aimY: this.aim === null ? NaN : this.aim.y,
      attack,
      dash,
    };
  }
}
