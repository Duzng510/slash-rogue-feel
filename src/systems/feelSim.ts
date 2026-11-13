import { CONFIG } from "../config.ts";
import type { Sim } from "../sim/types.ts";

/**
 * Sim-side feel only (hit-stop, knockback). Everything visual -- shake, flash, particles,
 * sfx, damage numbers -- leaves the tick as a VisualEvent, so tick() stays free of DOM/audio.
 */

export function requestHitStop(src: Pick<Sim, "hitStopTicks">, ticks: number): void {
  const scaled = Math.round(ticks * CONFIG.SLIDERS.hitStopScale);
  /** max, never summed: five kills in one tick must not freeze the sim for 25 ticks */
  if (scaled > src.hitStopTicks) src.hitStopTicks = scaled;
}

export function knockback(u: { vx: number; vy: number }, dir: number, mag: number): void {
  u.vx += Math.cos(dir) * mag;
  u.vy += Math.sin(dir) * mag;
}

export function pulse(ticksElapsed: number, interval: number): boolean {
  return Math.floor(ticksElapsed / interval) % 2 === 0;
}
