import { CONFIG } from "../config.ts";
import { angleDiff, dist } from "../mathx.ts";
import type { Enemy } from "../entities/enemy.ts";

export type AimResult = { dir: number; targetId: number };

const NO_TARGET = -1;

/**
 * Mouse aim wins and is exact. Without a cursor (keyboard-only, touch) the swing snaps to the
 * enemy closest to the centre of a cone in front of facing, so a tap never swings at nothing.
 */
export function resolveAttackDir(
  fx: number,
  fy: number,
  facing: number,
  aim: { x: number; y: number } | null,
  enemies: Enemy[]
): AimResult {
  if (aim !== null) return { dir: Math.atan2(aim.y - fy, aim.x - fx), targetId: NO_TARGET };

  const half = ((CONFIG.AUTO_AIM.CONE_DEG * Math.PI) / 180) * 0.5;
  let bestDir = facing;
  let bestId = NO_TARGET;
  let bestScore = Infinity;

  for (const e of enemies) {
    if (e.dead) continue;
    const d = dist(fx, fy, e.x, e.y);
    if (d > CONFIG.AUTO_AIM.RANGE) continue;
    const to = Math.atan2(e.y - fy, e.x - fx);
    const off = Math.abs(angleDiff(facing, to));
    if (off > half) continue;
    const score = off + (d / CONFIG.AUTO_AIM.RANGE) * 0.3;
    if (score < bestScore) {
      bestScore = score;
      bestDir = to;
      bestId = e.id;
    }
  }
  return { dir: bestDir, targetId: bestId };
}
