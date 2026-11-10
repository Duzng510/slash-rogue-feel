import { CONFIG } from "../config.ts";
import type { FrameData } from "../config.ts";
import { pointInArc, rectsOverlap } from "../mathx.ts";
import { shake, sfx } from "../events.ts";
import { requestHitStop } from "./feelSim.ts";
import type { Rect } from "../mathx.ts";
import type { Side, Sim, Swing, Unit } from "../sim/types.ts";

export type SwingInit = {
  side: Side;
  combo: number;
  dir: number;
  ox: number;
  oy: number;
  reach: number;
  deg: number;
  dmg: number;
  knockback: number;
  fd: FrameData;
};

export function createSwing(src: Sim, init: SwingInit): Swing {
  return {
    id: src.nextSwingId(),
    side: init.side,
    combo: init.combo,
    dir: init.dir,
    phase: "startup",
    ticksLeft: init.fd.startup,
    fd: init.fd,
    ox: init.ox,
    oy: init.oy,
    reach: init.reach,
    deg: init.deg,
    dmg: init.dmg,
    knockback: init.knockback,
    seen: new Set<number>(),
  };
}

export function playerSwingInit(src: Sim, combo: number, dir: number): SwingInit {
  const a = CONFIG.ATTACK;
  const second = combo >= 2;
  const scale = second ? a.COMBO2_REACH_SCALE : 1;
  return {
    side: "player",
    combo,
    dir,
    ox: src.player.x,
    oy: src.player.y,
    reach: a.REACH * scale,
    deg: Math.min(170, a.ARC_DEG * (second ? a.COMBO2_ARC_SCALE : 1)),
    dmg: a.DMG,
    knockback: a.KNOCKBACK,
    fd: a.COMBOS[Math.min(a.COMBOS.length, combo) - 1],
  };
}

/** true once the swing has left its recover phase and should be cleared */
export function stepSwing(sw: Swing): boolean {
  if (sw.ticksLeft > 0) {
    sw.ticksLeft--;
    if (sw.ticksLeft > 0) return false;
  }
  if (sw.phase === "startup") {
    sw.phase = "active";
    sw.ticksLeft = sw.fd.active;
    return false;
  }
  if (sw.phase === "active") {
    sw.phase = "recover";
    sw.ticksLeft = sw.fd.recovery;
    return false;
  }
  return true;
}

function hitReach(sw: Swing): number {
  return sw.reach * (sw.side === "enemy" && sw.deg === 360 ? 1 : 1.15);
}

export function hitboxOf(sw: Swing): Rect | null {
  if (sw.phase !== "active") return null;
  const r = hitReach(sw);
  return { x: sw.ox - r, y: sw.oy - r, w: r * 2, h: r * 2 };
}

export function resolveHits(src: Sim): void {
  for (const attacker of src.units) {
    const sw = attacker.swing;
    if (sw === null || sw.phase !== "active") continue;
    const box = hitboxOf(sw);
    if (box === null) continue;

    for (const target of src.units) {
      if (target === attacker || target.side === sw.side) continue;
      if (target.dead || !target.canBeHit()) continue;
      const hb = target.hurtRect();
      if (!rectsOverlap(box, hb)) continue;
      const cx = hb.x + hb.w / 2;
      const cy = hb.y + hb.h / 2;
      if (!pointInArc(cx, cy, sw.ox, sw.oy, sw.dir, hitReach(sw), sw.deg, 0)) continue;
      if (sw.seen.has(target.id)) continue;

      sw.seen.add(target.id);
      const killed = target.onHit(sw, cx, cy, src);
      hitFeedback(src, target, sw, cx, cy, killed);
    }
  }
}

function hitFeedback(src: Sim, target: Unit, sw: Swing, cx: number, cy: number, killed: boolean): void {
  const f = CONFIG.FEEL;
  if (target.side === "enemy") {
    const dir = sw.dir;
    src.queue.push({ t: "flash", ent: target.id, ticks: CONFIG.PLAYER.FLASH_TICKS });
    src.particles.burstBlood(cx, cy, dir, killed ? f.DEATH_SHARDS : f.BLOOD, src.rng);
    src.particles.burstSpark(cx, cy, f.SPARK, src.rng);
    if (killed) src.particles.burstShards(cx, cy, f.DEATH_SHARDS, CONFIG.PALETTE.ENEMY_SHADE, src.rng);
    if (CONFIG.SLIDERS.dmgNumbers > 0) src.queue.push({ t: "dmgNumber", x: cx, y: cy - 8, value: sw.dmg });
    shake(src.queue, cx, cy, dir, killed ? f.SHAKE_KILL_MULT : 1);
    sfx(src.queue, killed ? "kill" : "slash_hit", killed ? 1.1 : 1, (killed ? 0.82 : 1) * (target.killPitch ?? 1));
    requestHitStop(src, killed ? f.HIT_STOP_KILL : f.HIT_STOP_NORMAL);
  } else {
    src.queue.push({ t: "flash", ent: target.id, ticks: CONFIG.PLAYER.FLASH_TICKS });
    requestHitStop(src, CONFIG.FEEL.HIT_STOP_PLAYER_HURT);
  }
}
