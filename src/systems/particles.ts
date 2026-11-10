import { CONFIG } from "../config.ts";
import type { Rng } from "../mathx.ts";

export const PARTICLE_KIND = {
  blood: "blood",
  spark: "spark",
  shard: "shard",
  dust: "dust",
  ghost: "ghost",
} as const;

export type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

type Slot = {
  live: boolean;
  kind: ParticleKind;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  drag: number;
  gravity: number;
  sprite: string | null;
  alphaScale: number;
};

const SPECS: Record<ParticleKind, { tier: number; life: number; size: number; drag: number; gravity: number }> = {
  blood: { tier: 1, life: 0.34, size: 1, drag: 0.9, gravity: 60 },
  spark: { tier: 1, life: 0.12, size: 1, drag: 0.86, gravity: 0 },
  shard: { tier: 1, life: 0.5, size: 2, drag: 0.9, gravity: 90 },
  dust: { tier: 3, life: 0.26, size: 1, drag: 0.8, gravity: -6 },
  ghost: { tier: 3, life: 0.2, size: 1, drag: 1, gravity: 0 },
};

function makeSlot(): Slot {
  return {
    live: false, kind: "blood", tier: 1, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
    size: 1, color: "#fff", drag: 0.9, gravity: 0, sprite: null, alphaScale: 1,
  };
}

export class ParticlePool {
  private slots: Slot[];
  private cursor = 0;
  private liveCount = 0;
  readonly cap: number;

  constructor(cap: number = CONFIG.READABILITY.PARTICLE_CAP) {
    this.cap = cap;
    this.slots = [];
    for (let i = 0; i < cap; i++) this.slots.push(makeSlot());
  }

  get alive(): number {
    return this.liveCount;
  }

  /** Ring allocation: reuse a free slot, else evict at cursor (newest impact wins over stale spray). */
  emit(
    kind: ParticleKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: string,
    opts?: { size?: number; life?: number; sprite?: string }
  ): boolean {
    const rd = CONFIG.READABILITY;
    const load = this.alive / this.cap;
    const spec = SPECS[kind];
    if (load >= rd.TIER3_OFF_AT && spec.tier >= 3) return false;

    let slot: Slot | null = null;
    for (let i = 0; i < this.cap; i++) {
      const c = (this.cursor + i) % this.cap;
      if (!this.slots[c].live) {
        slot = this.slots[c];
        this.cursor = (c + 1) % this.cap;
        break;
      }
    }
    if (slot === null) {
      slot = this.slots[this.cursor];
      this.cursor = (this.cursor + 1) % this.cap;
    }

    const downscale = load >= rd.DOWNSCALE_AT;
    if (!slot.live) this.liveCount++;
    slot.live = true;
    slot.kind = kind;
    slot.tier = spec.tier;
    slot.x = x;
    slot.y = y;
    slot.vx = vx;
    slot.vy = vy;
    slot.maxLife = (opts?.life ?? spec.life);
    slot.life = slot.maxLife;
    slot.size = (opts?.size ?? spec.size) * (downscale ? 0.8 : 1);
    slot.color = color;
    slot.drag = spec.drag;
    slot.gravity = spec.gravity;
    slot.sprite = opts?.sprite ?? null;
    slot.alphaScale = downscale ? 0.6 : 1;
    return true;
  }

  burstBlood(x: number, y: number, dir: number, count: number, rng: Rng): void {
    for (let i = 0; i < count; i++) {
      const a = dir + rng.range(-0.9, 0.9);
      const sp = rng.range(34, 110);
      this.emit("blood", x, y, Math.cos(a) * sp, Math.sin(a) * sp - rng.range(6, 34), CONFIG.PALETTE.BLOOD);
    }
  }

  burstSpark(x: number, y: number, count: number, rng: Rng): void {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const sp = rng.range(90, 170);
      this.emit("spark", x, y, Math.cos(a) * sp, Math.sin(a) * sp, CONFIG.PALETTE.SPARK);
    }
  }

  burstShards(x: number, y: number, count: number, color: string, rng: Rng): void {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const sp = rng.range(40, 96);
      this.emit("shard", x, y, Math.cos(a) * sp, Math.sin(a) * sp - rng.range(10, 40), color, {
        size: rng.next() < 0.4 ? 2 : 1,
      });
    }
  }

  puffDust(x: number, y: number, count: number, rng: Rng): void {
    for (let i = 0; i < count; i++) {
      const a = rng.range(-Math.PI, 0);
      const sp = rng.range(12, 34);
      this.emit("dust", x, y, Math.cos(a) * sp, Math.sin(a) * sp * 0.4, CONFIG.PALETTE.WALL_TOP);
    }
  }

  afterimage(x: number, y: number, sprite: string): void {
    this.emit("ghost", x, y, 0, 0, CONFIG.PALETTE.GHOST, { sprite });
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.live) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.live = false;
        this.liveCount--;
        continue;
      }
      s.vy += s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const d = Math.pow(s.drag, dt * 60);
      s.vx *= d;
      s.vy *= d;
    }
  }

  reset(): void {
    for (const s of this.slots) s.live = false;
    this.cursor = 0;
    this.liveCount = 0;
  }

  visit(fn: (s: Readonly<Slot>) => void): void {
    for (const s of this.slots) if (s.live) fn(s);
  }
}
