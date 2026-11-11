import { CONFIG } from "../config.ts";
import type { FrameData } from "../config.ts";
import { normAngle, pointInArc, rectsOverlap } from "../mathx.ts";
import { artifactText, shake, sfx } from "../events.ts";
import { requestHitStop } from "./feelSim.ts";
import type { Rect } from "../mathx.ts";
import type { Side, Sim, Swing, Unit } from "../sim/types.ts";
import type { Enemy } from "../entities/enemy.ts";
import type { SpatialGrid } from "../world/grid.ts";

export type SwingInit = {
  side: Side;
  kind?: string;
  combo: number;
  dir: number;
  ox: number;
  oy: number;
  reach: number;
  deg: number;
  dmg: number;
  knockback: number;
  fd: FrameData;
  status?: Swing["status"];
};

export function createSwing(src: Sim, init: SwingInit): Swing {
  return {
    id: src.nextSwingId(),
    side: init.side,
    kind: init.kind,
    combo: init.combo,
    dir: init.dir,
    phase: "startup",
    ticksLeft: init.fd.startup,
    fd: init.fd,
    status: init.status,
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
  const berserk = src.artifacts.has("berserker") ? 1 + Math.min(0.5, (src.player.maxHp - src.player.hp) * 0.1) : 1;
  const base = a.COMBOS[Math.min(a.COMBOS.length, combo) - 1];
  const fd = src.curses.has("slow_hand") ? { ...base, startup: base.startup + CONFIG.CURSES.STARTUP_TICKS } : base;
  return {
    side: "player",
    status: combo === 1 ? (src.artifacts.has("water") ? "wet" : src.artifacts.has("poison") ? "poison" : undefined)
      : combo === 2 ? (src.artifacts.has("lightning") ? "shock" : src.artifacts.has("freeze") ? "freeze" : undefined)
      : undefined,
    combo,
    dir,
    ox: src.player.x,
    oy: src.player.y,
    reach: a.REACH * scale,
    deg: Math.min(170, a.ARC_DEG * (second ? a.COMBO2_ARC_SCALE : 1)),
    dmg:
      a.DMG * (src.artifacts.has("heavy") ? 1.3 : 1) * berserk * (src.artifacts.has("glasscannon") ? 1.75 : 1) *
      (src.curses.has("glass") ? CONFIG.CURSES.DEALT_MULT : 1) +
      (src.player.reprisalTicks > 0 ? 1 : 0),
    knockback: a.KNOCKBACK * (src.player.impulseTicks > 0 ? 2 : 1),
    fd,
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

export function resolveHits(src: Sim, grid: SpatialGrid): void {
  for (const attacker of src.units) {
    const sw = attacker.swing;
    if (sw === null || sw.phase !== "active") continue;
    const box = hitboxOf(sw);
    if (box === null) continue;
    // a whiffed swing loses its arc entirely, so the miss reads on screen too
    if (sw.side === "player" && sw.ticksLeft === sw.fd.active && src.curses.has("butterfingers") &&
      src.rng.next() < CONFIG.CURSES.WHIFF_CHANCE) sw.deg = 0;

    let blast: { x: number; y: number } | null = null;
    const reach = hitReach(sw);
    const twin = sw.side === "player" && sw.combo === 2 && src.artifacts.has("twin_blades");
    const cands = grid.query(attacker.x, attacker.y, reach);
    for (const target of cands) {
      if (target === attacker || target.side === sw.side) continue;
      if (target.dead || !target.canBeHit()) continue;
      const hb = target.hurtRect();
      if (!rectsOverlap(box, hb)) continue;
      const cx = hb.x + hb.w / 2;
      const cy = hb.y + hb.h / 2;
      if (!pointInArc(cx, cy, sw.ox, sw.oy, sw.dir, reach, sw.deg, 0) &&
        !(twin && pointInArc(cx, cy, sw.ox, sw.oy, normAngle(sw.dir + Math.PI), reach, sw.deg, 0))) continue;
      if (sw.seen.has(target.id)) continue;

      sw.seen.add(target.id);
      const exec = sw.side === "player" && target.side === "enemy" && src.artifacts.has("executioner") &&
        (target as Enemy).hp < (target as Enemy).maxHp * 0.2;
      const killed = target.onHit(sw, cx, cy, src);
      hitFeedback(src, target, sw, cx, cy, killed, !exec);
      if (target.side === "player" && src.artifacts.has("thorns") && !attacker.dead) {
        const dir = Math.atan2(attacker.y - target.y, attacker.x - target.x);
        const thornsSwing = createSwing(src, {
          side: "player",
          combo: 0,
          dir,
          ox: target.x,
          oy: target.y,
          reach: 0,
          deg: 0,
          dmg: 1,
          knockback: 30,
          fd: { startup: 0, active: 1, recovery: 0 },
        });
        attacker.onHit(thornsSwing, attacker.x, attacker.y, src);
        src.queue.push({ t: "artifactText", x: attacker.x, y: attacker.y - 14, text: "GAI", color: "#c8ff8a" });
        sfx(src.queue, "slash_hit", 0.5, 1.4);
      }
      if (sw.side === "player" && sw.combo === 2 && src.artifacts.has("aftershock") && !sw.aftershockDone) {
        sw.aftershockDone = true;
        blast = { x: cx, y: cy };
      }
      if (sw.side === "player" && sw.combo === 2 && src.artifacts.has("chain_lightning") && !sw.chainDone) {
        sw.chainDone = true;
        let best: Enemy | null = null;
        let bestD = 60;
        for (const other of src.enemies) {
          if (other === target || other.dead || !other.canBeHit()) continue;
          const d = Math.hypot(other.x - cx, other.y - cy);
          if (d < bestD) { bestD = d; best = other; }
        }
        if (best !== null) {
          const zap = { ...sw, dmg: 1, knockback: 0, status: undefined, seen: new Set<number>() };
          const zapped = best.onHit(zap, best.x, best.y, src);
          hitFeedback(src, best, zap, best.x, best.y, zapped, false);
          src.queue.push({ t: "slashArc", x: best.x, y: best.y, dir: 0, reach: 15, deg: 360, combo: 2, ticks: 8 });
          sfx(src.queue, "shock_hit", 0.6, 1.5);
          artifactText(src.queue, best.x, best.y - 12, "LIÊN LÔI", "#ffe66b");
        }
      }
    }
    if (blast !== null) {
      src.queue.push({ t: "slashArc", x: blast.x, y: blast.y, dir: 0, reach: 40, deg: 360, combo: 2, ticks: 12 });
      sfx(src.queue, "aftershock_boom", 1, 0.8);
      artifactText(src.queue, blast.x, blast.y - 12, "DƯ CHẤN", "#ff963f");
      const shock = { ...sw, dmg: 1, knockback: 0, status: undefined, seen: new Set<number>() };
      for (const enemy of src.enemies.slice()) {
        const hb = enemy.hurtRect();
        const cx = hb.x + hb.w / 2, cy = hb.y + hb.h / 2;
        if (enemy.dead || Math.hypot(cx - blast.x, cy - blast.y) > 40) continue;
        const killed = enemy.onHit(shock, cx, cy, src);
        hitFeedback(src, enemy, shock, cx, cy, killed, false);
      }
    }
  }
}

export function resolveFire(src: Sim): void {
  for (const trail of src.fireTrails) {
    for (const point of trail.points) point.ticks--;
    trail.points = trail.points.filter(p => p.ticks > 0);
    for (const enemy of src.enemies.slice()) {
      if (enemy.dead || trail.seen.has(enemy.id)) continue;
      const hb = enemy.hurtRect();
      if (!trail.points.some(p => rectsOverlap({ x: p.x - 6, y: p.y - 6, w: 12, h: 12 }, hb))) continue;
      trail.seen.add(enemy.id);
      const fire = createSwing(src, { side: "player", status: "burn", combo: 1, dir: 0, ox: enemy.x, oy: enemy.y, reach: 0, deg: 0, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
      const killed = enemy.onHit(fire, enemy.x, enemy.y, src);
      hitFeedback(src, enemy, fire, enemy.x, enemy.y, killed, false);
    }
  }
  src.fireTrails = src.fireTrails.filter(t => t.points.length > 0);
}

export function hitFeedback(src: Sim, target: Unit, sw: Swing, cx: number, cy: number, killed: boolean, stop = true): void {
  const f = CONFIG.FEEL;
  if (target.side === "enemy") {
    src.runStats.damageDealt += sw.dmg;
    const dir = sw.dir;
    src.queue.push({ t: "flash", ent: target.id, ticks: CONFIG.PLAYER.FLASH_TICKS });
    if (sw.side === "player") {
      src.queue.push({ t: "slice", x: cx, y: cy, dir: dir, len: 14 });
    }
    src.particles.burstBlood(cx, cy, dir, killed ? f.DEATH_SHARDS : f.BLOOD, src.rng);
    src.particles.burstSpark(cx, cy, f.SPARK, src.rng);
    if (killed) src.particles.burstShards(cx, cy, f.DEATH_SHARDS, CONFIG.PALETTE.ENEMY_SHADE, src.rng);
    if (CONFIG.SLIDERS.dmgNumbers > 0) src.queue.push({ t: "dmgNumber", x: cx, y: cy - 8, value: sw.dmg });
    shake(src.queue, cx, cy, dir, killed ? f.SHAKE_KILL_MULT : 1);
    const heavy = !killed && sw.side === "player" && src.artifacts.has("heavy");
    const sname = killed ? "kill" : heavy ? "slash_hit_heavy" : "slash_hit";
    sfx(src.queue, sname, killed ? 1.1 : 1, (killed ? 0.82 : heavy ? 0.85 : 1) * (target.killPitch ?? 1));
    if (stop) requestHitStop(src, (killed ? f.HIT_STOP_KILL : f.HIT_STOP_NORMAL) * (src.artifacts.has("heavy") ? 1.5 : 1));
  } else {
    src.queue.push({ t: "flash", ent: target.id, ticks: CONFIG.PLAYER.FLASH_TICKS });
    requestHitStop(src, CONFIG.FEEL.HIT_STOP_PLAYER_HURT);
  }
}
