import { CONFIG, Settings } from "./config.ts";

export type FrameFn = (dtReal: number) => void;

/**
 * Fixed-timestep sim + free-running visuals. Visuals never interpolate between sim positions:
 * the world is drawn at integer internal pixels, so sub-tick interpolation would blur pixels
 * rather than smooth motion.
 */
export class GameLoop {
  private acc = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  maxSubSteps = 5;

  private readonly sim: () => void;
  private readonly frame: FrameFn;

  constructor(sim: () => void, frame: FrameFn) {
    this.sim = sim;
    this.frame = frame;
  }

  /** advance by real seconds; returns how many sim ticks ran */
  advance(dtReal: number): number {
    const step = CONFIG.TIME.TICK;
    this.acc += dtReal * Settings.timescale;
    let n = 0;
    while (this.acc >= step && n < this.maxSubSteps) {
      this.sim();
      this.acc -= step;
      n++;
    }
    if (this.acc > step * this.maxSubSteps) this.acc = 0;
    this.frame(dtReal);
    return n;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const pump = (now: number) => {
      if (!this.running) return;
      // re-arm before running: a throw from sim or frame must cost one frame, not the whole loop
      this.raf = requestAnimationFrame(pump);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.advance(dt);
    };
    this.raf = requestAnimationFrame(pump);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
