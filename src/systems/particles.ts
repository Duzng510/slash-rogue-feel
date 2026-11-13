import { CONFIG } from "../config.ts";
import type { Rng } from "../mathx.ts";

export const PARTICLE_KIND = {
  blood: "blood",
  spark: "spark",
  shard: "shard",
  dust: "dust",
  ghost: "ghost",
  ember: "ember",
  bolt: "bolt",
  ice: "ice",
  bubble: "bubble",
} as const;

export type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

export type Slot = {
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
  ember: { tier: 1, life: 0.4, size: 1, drag: 0.92, gravity: -26 },
  bolt: { tier: 1, life: 0.15, size: 1, drag: 0.86, gravity: 0 },
  ice: { tier: 1, life: 0.45, size: 1, drag: 0.9, gravity: 26 },
  bubble: { tier: 1, life: 0.5, size: 1, drag: 0.94, gravity: -14 },
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
  private nonce = 0x1f2e3d4c;
  readonly cap: number;
  /** free-list stack: emit is O(1) instead of scanning all slots for a dead one */
  private free: number[] = [];

  constructor(cap: number = CONFIG.READABILITY.PARTICLE_CAP) {
    this.cap = cap;
    this.slots = [];
    for (let i = 0; i < cap; i++) this.slots.push(makeSlot());
    // push in reverse so the first emitted particle still lands in slot 0 (stable draw order)
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
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

    let slot: Slot;
    const freeIdx = this.free.pop();
    if (freeIdx !== undefined) {
      slot = this.slots[freeIdx];
    } else {
      // full: evict the stalest slot at the cursor (newest impact wins over stale spray)
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

  /**
   * deterministic pseudo-random for element sprays: hashed from position + a pool
   * nonce so landing element hits never consumes the sim rng (keeps the golden oracle intact)
   */
  private hashNext(x: number, y: number): number {
    this.nonce = (this.nonce + 0x9e3779b9) >>> 0;
    let h = ((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663) ^ this.nonce) >>> 0;
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  }

  /** burning embers: warm sparks that drift upward */
  burstEmber(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const r = this.hashNext(x, y);
      const r2 = this.hashNext(x + 3, y);
      this.emit("ember", x, y, (r - 0.5) * 34, -30 - r2 * 55, r2 < 0.5 ? "#ff963f" : "#ffc35a", {
        size: r < 0.35 ? 2 : 1, life: 0.3 + r * 0.25,
      });
    }
  }

  /** shock bolts: fast bright yellow sparks in all directions */
  burstBolt(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.hashNext(x, y) * Math.PI * 2;
      const sp = 80 + this.hashNext(x + 5, y) * 90;
      this.emit("bolt", x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.hashNext(x + 9, y) < 0.4 ? "#ffffff" : "#ffe66b");
    }
  }

  /** ice crystals: cool shards that pop out and drop */
  burstIce(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.hashNext(x, y) * Math.PI * 2;
      const sp = 22 + this.hashNext(x + 4, y) * 40;
      this.emit("ice", x, y, Math.cos(a) * sp, Math.sin(a) * sp - 14, this.hashNext(x + 8, y) < 0.5 ? "#a8e8ff" : "#d8f0ff", {
        size: this.hashNext(x + 2, y) < 0.3 ? 2 : 1,
      });
    }
  }

  /** poison bubbles: violet blobs that float up and pop */
  burstBubble(x: number, y: number, count: number, color = "#8f63ae"): void {
    for (let i = 0; i < count; i++) {
      const r = this.hashNext(x, y);
      this.emit("bubble", x + (r - 0.5) * 8, y - 2, (r - 0.5) * 18, -14 - this.hashNext(x + 6, y) * 26, r < 0.4 ? "#c99ae6" : color, {
        size: r < 0.3 ? 2 : 1, life: 0.4 + r * 0.25,
      });
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
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.live) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.live = false;
        this.liveCount--;
        this.free.push(i);
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
    this.free.length = 0;
    for (let i = this.cap - 1; i >= 0; i--) this.free.push(i);
  }

  visit(fn: (s: Readonly<Slot>) => void): void {
    for (const s of this.slots) if (s.live) fn(s);
  }
}
