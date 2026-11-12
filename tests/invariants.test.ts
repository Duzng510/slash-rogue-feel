/**
 * Determinism oracle + property/fuzz invariants.
 *
 * No new dependencies, no external assertion DSL: the fuzz inputs come from the project's own
 * seeded makeRng (so every failure prints a seed that reproduces it exactly), and every check is a
 * plain in-repo invariant folded through node:assert — same philosophy as CONFIG.LAWS.
 *
 * Two guarantees:
 *  - #2 determinism: a fixed seed must replay a bit-for-bit identical trace (replay-equality + a
 *    committed golden hash). Nondeterministic leaks (Math.random, Date.now, global counters) show up
 *    here even when every scenario still "looks" fine.
 *  - #1 invariants: under thousands of seeded random inputs, kinematics never go NaN/Infinity, health
 *    stays in range, and population stays bounded — the NaN class behind the Android freeze bug.
 *
 * Counts are overridable for CI vs a quick local pass:
 *   INV_TRIALS=.. INV_BUDGET=.. node --test tests/invariants.test.ts
 *   INV_REPORT=1  ...   prints observed peaks so the ceilings above can be tightened from data
 *   RECORD_GOLDEN=1 ...  prints the current golden hash to paste back after an intended change
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG, ENEMY_KINDS, enemyDef, isScripted } from "../src/config.ts";
import type { EnemyKind } from "../src/config.ts";
import { World } from "../src/world/world.ts";
import { makeRng } from "../src/mathx.ts";
import type { Intent } from "../src/sim/types.ts";

const IDLE: Intent = { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false, skill: false };
const TRIALS = Number(process.env.INV_TRIALS ?? CONFIG.LAWS.FUZZ_TRIALS);
const BUDGET = Number(process.env.INV_BUDGET ?? CONFIG.LAWS.FUZZ_BUDGET);

/** the committed golden trace; regenerate the whole line with RECORD_GOLDEN=1 after an intended change */
let GOLDEN_HASH = 3722045457;
let GOLDEN_RAN = 480;

const fin = (...ns: number[]): boolean => ns.every((n) => Number.isFinite(n));
const num = (n: number): string => (n === 0 ? "0" : String(n)); // collapse -0/0 for a stable string
const liveCount = (w: World): number => w.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);

/** FNV-1a, folded across the per-tick fingerprint so any state change flips the running hash */
function fold(acc: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    acc ^= s.charCodeAt(i);
    acc = Math.imul(acc, 0x01000193);
  }
  return acc;
}

/** canonical *gameplay* fingerprint — visual/particle state is deliberately excluded */
function fingerprint(w: World): string {
  const p = w.player;
  const a: string[] = [
    "P", num(p.x), num(p.y), num(p.vx), num(p.vy), num(p.hp), String(p.iframeTicks), p.dead ? "1" : "0", String(p.state),
    "S", String(w.tickCount), String(w.roomIndex), String(w.hitStopTicks), String(w.projectiles.length), String(w.enemies.length),
  ];
  for (const e of w.enemies) a.push("E", String(e.kind), num(e.x), num(e.y), num(e.vx), num(e.vy), num(e.hp), e.dead ? "1" : "0", String(e.state), String(e.telegraphTicksLeft));
  for (const q of w.projectiles) a.push("Q", num(q.x), num(q.y), num(q.vx), num(q.vy), String(q.ticksLeft), String(q.owner));
  return a.join(",");
}

/** the sim no-ops while an offer or the end banner is up — stop a trial the moment it would block */
function blocked(w: World): boolean {
  return w.artifactChoices.length > 0 || w.weaponChoices !== null || w.shopOffers !== null || w.pendingEnd !== null;
}

/** a fuzzed player swing can aim NaN (auto-aim) or at a point around the player */
function fuzzIntent(grng: ReturnType<typeof makeRng>, attack: boolean): Intent {
  const near = () => 160 + grng.range(-80, 80);
  return {
    moveX: grng.range(-1, 1),
    moveY: grng.range(-1, 1),
    aimX: grng.next() < 0.5 ? NaN : near(),
    aimY: grng.next() < 0.5 ? NaN : near(),
    attack: attack && grng.next() < 0.7,
    dash: grng.next() < 0.1,
    skill: grng.next() < 0.1,
  };
}

/** common (non-scripted) archetypes — scripted superiors have their own dedicated regressions */
const FUZZ_POOL: EnemyKind[] = ENEMY_KINDS.filter((k) => !isScripted(k));

type Result = { violation: string | null; maxEnemies: number; maxProjectiles: number; ran: number; hash: number };

/** drive one seeded run; with report=false it stops at the first invariant breach */
function runWorld(seed: number, ticks: number, attack: boolean, report: boolean): Result {
  const w = new World(seed);
  w.clearEnemies();
  w.player.reset(160, 100);
  const grng = makeRng(seed * 7919 + 13);
  for (let i = 0; i < 4; i++) w.spawnEnemy(160 + grng.range(-46, 46), 100 + grng.range(-46, 46), grng.pick(FUZZ_POOL));
  w.queue.drain();

  let hash = 0x811c9dc5;
  let ran = 0;
  let maxEnemies = w.enemies.length;
  let maxProjectiles = w.projectiles.length;
  let violation: string | null = null;

  for (let i = 0; i < ticks; i++) {
    if (blocked(w)) break;
    w.tick(fuzzIntent(grng, attack));
    w.queue.drain();
    ran++;

    // keep the arena busy so a run explores sustained combat rather than going quiet after one clear
    if (liveCount(w) < 3) {
      for (let s = 0; s < 2 && w.enemies.length < CONFIG.LAWS.MAX_ENEMIES; s++) {
        w.spawnEnemy(160 + grng.range(-70, 70), 100 + grng.range(-70, 70), grng.pick(FUZZ_POOL));
      }
    }

    maxEnemies = Math.max(maxEnemies, w.enemies.length);
    maxProjectiles = Math.max(maxProjectiles, w.projectiles.length);
    hash = fold(hash, fingerprint(w));

    const why = check(w);
    if (why !== null) {
      violation = `seed ${seed} tick ${w.tickCount}: ${why}`;
      if (!report) return { violation, maxEnemies, maxProjectiles, ran, hash: hash >>> 0 };
    }
  }
  return { violation, maxEnemies, maxProjectiles, ran, hash: hash >>> 0 };
}

/** every gameplay invariant that must hold after any single tick */
function check(w: World): string | null {
  const p = w.player;
  if (!fin(p.x, p.y, p.vx, p.vy, p.hp)) return `player non-finite x=${p.x} y=${p.y} hp=${p.hp}`;
  if (p.hp < 0 || p.hp > p.maxHp + 1e-9) return `player hp ${p.hp} out of [0,${p.maxHp}]`;
  if (w.enemies.length < 0 || w.enemies.length > CONFIG.LAWS.MAX_ENEMIES) return `enemy count ${w.enemies.length} over ceiling`;
  if (w.projectiles.length > CONFIG.LAWS.MAX_PROJECTILES) return `projectile count ${w.projectiles.length} over ceiling`;
  for (const e of w.enemies) {
    if (!fin(e.x, e.y, e.vx, e.vy, e.hp)) return `enemy ${e.kind} non-finite x=${e.x} y=${e.y} hp=${e.hp}`;
    if (e.hp < -1e-9 || e.hp > e.maxHp + 1e-6) return `enemy ${e.kind} hp ${e.hp} out of [0,${e.maxHp}]`;
  }
  for (const q of w.projectiles) if (!fin(q.x, q.y, q.vx, q.vy)) return "projectile non-finite position/velocity";
  if (!fin(w.hitStopTicks) || w.hitStopTicks < 0) return `hitStopTicks ${w.hitStopTicks}`;
  return null;
}

// #2 — determinism. attack=false keeps the room uncrowded so the whole budget is a valid trace.
const GOLDEN_SEED = 1337;
const GOLDEN_TICKS = 480;
const gold = (): { hash: number; ran: number } => {
  const r = runWorld(GOLDEN_SEED, GOLDEN_TICKS, false, false);
  assert.equal(r.violation, null, `golden run broke an invariant: ${r.violation}`);
  return { hash: r.hash, ran: r.ran };
};

test("determinism: the same seed replays a bit-identical trace", () => {
  const a = gold();
  const b = gold();
  assert.equal(a.hash, b.hash, "identical seeds diverged — the sim has a nondeterministic read (Math.random/Date/global)");
  assert.ok(a.ran > GOLDEN_TICKS * 0.5, `golden trace is suspiciously short (${a.ran}/${GOLDEN_TICKS} ticks) — a gate is firing early`);
});

test("determinism: the golden trace matches the committed hash", () => {
  const { hash, ran } = gold();
  if (process.env.RECORD_GOLDEN === "1") {
    console.log(`\n  >>> RECORD_GOLDEN — paste this line into tests/invariants.test.ts:\n      let GOLDEN_HASH = ${hash}; let GOLDEN_RAN = ${ran};\n`);
    return;
  }
  if (GOLDEN_HASH === 0) {
    console.log(`\n  NOTE golden hash not recorded yet; first observed: let GOLDEN_HASH = ${hash}; let GOLDEN_RAN = ${ran};\n`);
    return;
  }
  assert.equal(hash, GOLDEN_HASH, `deterministic sim changed (got ${hash}, want ${GOLDEN_HASH}) — if intended, RECORD_GOLDEN=1 and commit the new golden`);
  assert.equal(ran, GOLDEN_RAN, `golden trace length changed (${ran} vs ${GOLDEN_RAN})`);
});

// #1 — property/fuzz. attack=true so hits, crits, knockback and the enemy-death path all get exercised.
test(`property: ${TRIALS} seeded fuzz runs keep kinematics finite and health in range`, () => {
  let maxEnemies = 0;
  let maxProjectiles = 0;
  for (let t = 0; t < TRIALS; t++) {
    const seed = 1000 + t;
    const r = runWorld(seed, BUDGET, true, process.env.INV_REPORT === "1");
    maxEnemies = Math.max(maxEnemies, r.maxEnemies);
    maxProjectiles = Math.max(maxProjectiles, r.maxProjectiles);
    assert.equal(r.violation, null, r.violation ?? "");
  }
  if (process.env.INV_REPORT === "1") {
    console.log(`\n  >>> observed peaks over ${TRIALS} runs: MAX_ENEMIES=${maxEnemies} MAX_PROJECTILES=${maxProjectiles}\n`);
  }
});

test("property: no archetype auto-teleports to the player on spawn", () => {
  // a 400px acquisition only starts a chase; a monster that warped into melee range on frame one
  // would make an unreadable spawn. Assert every kind respects a safe spawn gap.
  const w = new World(CONFIG.SEED);
  w.player.reset(160, 100);
  for (const kind of ENEMY_KINDS) {
    w.clearEnemies();
    const x = 400;
    const y = 100;
    w.spawnEnemy(x, y, kind);
    const e = w.enemies[w.enemies.length - 1];
    assert.equal(e.x, x, `${kind} mutated x before the first tick`);
    assert.equal(e.y, y, `${kind} mutated y before the first tick`);
    for (let i = 0; i < 30; i++) w.tick(IDLE);
    const gap = Math.hypot(e.x - w.player.x, e.y - w.player.y);
    assert.ok(gap > 16, `${kind} closed ${Math.round(400 - gap)}px before it could be seen (gap now ${Math.round(gap)})`);
  }
});

test("law: the MAX_ENEMIES ceiling is above the biggest authored room wave", () => {
  const waveSum = CONFIG.ROOMS.WAVES.reduce((a, b) => a + b, 0);
  const biggest = CONFIG.ROOMS.WAVES.reduce((a, b) => Math.max(a, b), 0);
  assert.ok(CONFIG.LAWS.MAX_ENEMIES >= waveSum + biggest, `ceiling ${CONFIG.LAWS.MAX_ENEMIES} is below the theoretical authored max ${waveSum + biggest}`);
  assert.ok(enemyDef("chaser").ATTACK_ARC_DEG < 360, "a 360° melee tell with no telegraph would be unavoidable; radial arcs are reserved for scripted superiors");
});
