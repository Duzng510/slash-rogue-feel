import { CONFIG } from "../config.ts";
import { rectsOverlap } from "../mathx.ts";
import type { Projectile, Sim, Swing } from "../sim/types.ts";

/** advance every shot: terrain stops it, a body hit lands through the player's i-frames, range expires it */
export function resolveProjectiles(src: Sim): void {
  const dt = CONFIG.TIME.TICK;
  const pl = src.player;
  const hb = pl.hurtRect();
  const keep: Projectile[] = [];
  for (const p of src.projectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ticksLeft--;

    if (src.room.solidAtPx(p.x, p.y)) {
      src.particles.puffDust(p.x, p.y, 2, src.rng);
      continue;
    }
    if (pl.canBeHit() && rectsOverlap({ x: p.x - 1.5, y: p.y - 1.5, w: 3, h: 3 }, hb)) {
      const sw = { side: "enemy", dmg: p.dmg, dir: Math.atan2(p.vy, p.vx) } as unknown as Swing;
      pl.onHit(sw, p.x, p.y, src);
      continue;
    }
    if (p.ticksLeft > 0) keep.push(p);
  }
  src.projectiles = keep;
}
