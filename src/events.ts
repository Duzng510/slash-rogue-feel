import { CONFIG } from "./config.ts";
import type { AchievementId } from "./systems/unlocks.ts";

export type SfxName =
  | "slash_air"
  | "slash_hit"
  | "slash_hit_heavy"
  | "kill"
  | "hurt"
  | "dash"
  | "door"
  | "death"
  | "telegraph"
  | "burn_tick"
  | "shock_hit"
  | "aftershock_boom"
  | "pursuit_proc"
  | "reprisal_ready"
  | "shoot"
  | "teleport";

export type VisualEvent =
  | { t: "shake"; x: number; y: number; dir: number; mag: number }
  | { t: "hitStopBegin"; ticks: number }
  | { t: "sfx"; name: SfxName; gain: number; pitch: number }
  | { t: "flash"; ent: number; ticks: number }
  | { t: "hurtVignette"; strength: number }
  | { t: "slashArc"; x: number; y: number; dir: number; reach: number; deg: number; combo: number; ticks: number }
  | { t: "dmgNumber"; x: number; y: number; value: number }
  | { t: "roomBanner"; text: string }
  | { t: "artifactText"; x: number; y: number; text: string; color: string }
  | { t: "achievement"; id: AchievementId };

const CAP = 64;

export class EventQueue {
  private items: VisualEvent[] = [];

  push(e: VisualEvent): void {
    if (this.items.length >= CAP) this.items.shift();
    this.items.push(e);
  }

  drain(): VisualEvent[] {
    if (this.items.length === 0) return this.items;
    const out = this.items;
    this.items = [];
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}

export function sfx(e: EventQueue, name: SfxName, gain = 1, pitch = 1): void {
  e.push({ t: "sfx", name, gain, pitch });
}

/** a short world-space label that floats up from the trigger point (artifact procs) */
export function artifactText(e: EventQueue, x: number, y: number, text: string, color: string): void {
  e.push({ t: "artifactText", x, y, text, color });
}

export function shake(e: EventQueue, x: number, y: number, dir: number, mult = 1): void {
  e.push({ t: "shake", x, y, dir, mag: CONFIG.FEEL.SHAKE_MAG * mult });
}
