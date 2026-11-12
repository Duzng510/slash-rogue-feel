export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sign(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

export function normAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleDiff(a: number, b: number): number {
  return normAngle(b - a);
}

export function angleLerp(a: number, b: number, t: number): number {
  return normAngle(a + angleDiff(a, b) * t);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export type Rect = { x: number; y: number; w: number; h: number };

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Wedge in pixel units: point p must sit within +/-deg/2 of dir and inside `reach`. */
export function pointInArc(
  px: number,
  py: number,
  ox: number,
  oy: number,
  dir: number,
  reach: number,
  deg: number,
  inner: number
): boolean {
  const dx = px - ox;
  const dy = py - oy;
  const d = Math.hypot(dx, dy);
  if (d > reach || d < inner) return false;
  if (d < 0.0001) return true;
  return Math.abs(angleDiff(dir, Math.atan2(dy, dx))) <= ((deg * Math.PI) / 180) * 0.5;
}

export type Rng = { next: () => number; range: (lo: number, hi: number) => number; pick: <T>(xs: readonly T[]) => T };

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: <T>(xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(next() * xs.length))],
  };
}

/** Fisher-Yates in place using the caller's RNG draw; returns the same array. */
export function shuffle<T>(arr: T[], next: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
