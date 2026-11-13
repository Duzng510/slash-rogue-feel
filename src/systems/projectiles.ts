import { CONFIG } from "../config.ts";
import { rectsOverlap } from "../mathx.ts";
import { hitFeedback, makeDamageCarrier } from "./combat.ts";
import type { CombatSim, Projectile } from "../sim/types.ts";

/** advance every shot: terrain stops it, a body hit lands through the player's i-frames, range expires it */
export function resolveProjectiles(src: CombatSim): void {
  const dt = CONFIG.TIME.TICK;
  const pl = src.player;
  const hb = pl.hurtRect();
  const keep: Projectile[] = [];
  for (const p of src.projectiles) {
    // render-only afterimage: record positions before moving (no sim effect)
    if (!p.trail) p.trail = [];
    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > 4) p.trail.pop();

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ticksLeft--;

    if (src.room.solidAtPx(p.x, p.y)) {
      src.particles.puffDust(p.x, p.y, 2, src.rng);
      continue;
    }
    if (p.owner === "player") {
      const sw = makeDamageCarrier({
        side: "player",
        combo: 0,
        dir: Math.atan2(p.vy, p.vx),
        reach: 0,
        dmg: p.dmg,
        knockback: 20,
        status: p.status,
      });
      const foe = src.enemies.find(e => !e.dead && e.canBeHit() && rectsOverlap({ x: p.x - 1.5, y: p.y - 1.5, w: 3, h: 3 }, e.hurtRect()));
      if (foe === undefined) {
        if (p.ticksLeft > 0) keep.push(p);
        continue;
      }
      const killed = src.hitUnit(foe, sw, foe.x, foe.y);
      hitFeedback(src, foe, sw, foe.x, foe.y, killed, false);
      continue;
    }
    if (pl.canBeHit() && rectsOverlap({ x: p.x - 1.5, y: p.y - 1.5, w: 3, h: 3 }, hb)) {
      const sw = makeDamageCarrier({ side: "enemy", kind: p.sourceKind, dmg: p.dmg, dir: Math.atan2(p.vy, p.vx) });
      src.hitUnit(pl, sw, p.x, p.y);
      continue;
    }
    if (p.ticksLeft > 0) keep.push(p);
  }
  src.projectiles = keep;
}
