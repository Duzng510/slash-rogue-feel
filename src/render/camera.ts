import { CONFIG } from "../config.ts";
import { clamp, lerp } from "../mathx.ts";
import type { Room } from "../world/rooms.ts";

/**
 * Runs on the visual clock, not the sim clock: screen shake must keep playing while hit-stop
 * freezes the simulation, otherwise the freeze reads as a stall instead of a snap.
 */
export class Camera {
  x = 0;
  y = 0;
  private mag = 0;
  private dir = 0;
  private sx = 0;
  private sy = 0;
  private focusTicks = 0;
  private focusX = 0;
  private focusY = 0;

  snap(tx: number, ty: number): void {
    this.x = tx;
    this.y = ty;
    this.mag = 0;
    this.sx = 0;
    this.sy = 0;
  }

  focus(tx: number, ty: number, ticks: number): void {
    this.focusX = tx;
    this.focusY = ty;
    this.focusTicks = Math.max(this.focusTicks, ticks);
  }

  addShake(mag: number, dir: number): void {
    const s = mag * CONFIG.SLIDERS.shake;
    if (s <= 0) return;
    if (s > this.mag) {
      this.mag = s;
      this.dir = dir;
    } else {
      this.mag = Math.max(this.mag, s * 0.6);
    }
  }

  follow(tx: number, ty: number, aimX: number, aimY: number, room: Room, dt: number): void {
    if (this.focusTicks > 0) {
      this.focusTicks = Math.max(0, this.focusTicks - dt * 60);
      const k = 1 - Math.pow(1 - 0.09, dt * 60);
      this.x = lerp(this.x, this.focusX, k);
      this.y = lerp(this.y, this.focusY, k);
    } else {
      const c = CONFIG.CAMERA;
      const k = 1 - Math.pow(1 - c.FOLLOW_LERP, dt * 60);
      const lead = c.LEAD_CLAMP;
      const lx = clamp(aimX - tx, -lead, lead);
      const ly = clamp(aimY - ty, -lead, lead);
      const gx = tx + lx * c.LEAD;
      const gy = ty + ly * c.LEAD;
      this.x = lerp(this.x, gx, k);
      this.y = lerp(this.y, gy, k);
    }
    const clamped = room.clampCamera(this.x, this.y);
    this.x = clamped.x;
    this.y = clamped.y;

    this.mag *= Math.pow(CONFIG.FEEL.SHAKE_DECAY, dt * 60);
    if (this.mag < CONFIG.FEEL.SHAKE_MIN) this.mag = 0;
    if (this.mag > 0) {
      const jitter = (Math.random() * 2 - 1) * this.mag;
      this.sx = Math.round(Math.cos(this.dir) * jitter);
      this.sy = Math.round(Math.sin(this.dir) * jitter);
    } else {
      this.sx = 0;
      this.sy = 0;
    }
  }

  /** integer pixels: fractional shake offsets would resample the pixel art and smear it */
  origin(room: Room): { x: number; y: number } {
    const w = CONFIG.WORLD.INTERNAL_W / CONFIG.WORLD.PIXEL_SCALE;
    const h = CONFIG.WORLD.INTERNAL_H / CONFIG.WORLD.PIXEL_SCALE;
    const raw = room.clampCamera(this.x, this.y);
    return {
      x: Math.round(raw.x - w / 2) + this.sx,
      y: Math.round(raw.y - h / 2) + this.sy,
    };
  }

  toWorld(sx: number, sy: number, origin: { x: number; y: number }): { x: number; y: number } {
    return { x: sx + origin.x, y: sy + origin.y };
  }

  get shakeMag(): number {
    return this.mag;
  }
}
