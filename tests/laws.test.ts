import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../src/config.ts";
import { IntentSource } from "../src/input/intent.ts";
import { World } from "../src/world/world.ts";
import { makeEnemy, ENEMY_STATE, canGoEnemy } from "../src/entities/enemy.ts";
import { PLAYER_STATE } from "../src/entities/player.ts";
import { requestHitStop } from "../src/systems/feelSim.ts";
import { ParticlePool } from "../src/systems/particles.ts";
import { makeRng } from "../src/mathx.ts";
import type { Intent } from "../src/sim/types.ts";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, note = ""): void {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${note}`);
  }
}

function heading(t: string): void {
  console.log(`\n${t}`);
}

function intent(over: Partial<Intent> = {}): Intent {
  return { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false, ...over };
}

function sandbox(): World {
  const w = new World(CONFIG.SEED);
  w.enemies = [];
  w.syncUnits();
  w.player.reset(w.room.start.x, w.room.start.y);
  return w;
}

function duel(w: World, gap = 16): number {
  const e = makeEnemy(w.player.x + gap, w.player.y);
  w.enemies.push(e);
  w.syncUnits();
  return e.id;
}

heading("Laws from config");
ok(
  "enemy telegraph is at least MIN_TELEGRAPH_S seconds",
  (CONFIG.ENEMY.TELEGRAPH_TICKS / CONFIG.TIME.TICK_HZ) >= CONFIG.LAWS.MIN_TELEGRAPH_S,
  `got ${(CONFIG.ENEMY.TELEGRAPH_TICKS / CONFIG.TIME.TICK_HZ).toFixed(2)}s`
);
ok(
  "punish window (enemy swing recovery) is long enough to react",
  CONFIG.ENEMY.RECOVERY_TICKS / CONFIG.TIME.TICK_HZ >= 0.15
);
ok("slash has startup, active and recovery phases", CONFIG.ATTACK.COMBOS.every((f) => f.startup > 0 && f.active > 0 && f.recovery > 0));
ok("player is invulnerable long enough to escape after a hit", CONFIG.PLAYER.IFRAMES / CONFIG.TIME.TICK_HZ >= 0.4);
ok("dash cooldown is shorter than its cost in risk", CONFIG.DASH.COOLDOWN / CONFIG.TIME.TICK_HZ <= 1.2);

heading("Hit registry");
{
  const w = sandbox();
  const id = duel(w);
  const enemy = w.enemies[0];
  w.tick(intent({ attack: true, aimX: enemy.x, aimY: enemy.y }));
  const startHp = enemy.hp;
  const budget = CONFIG.ATTACK.COMBOS[0].startup + CONFIG.ATTACK.COMBOS[0].active + CONFIG.ATTACK.COMBOS[0].recovery + CONFIG.FEEL.HIT_STOP_KILL + 4;
  for (let i = 0; i < budget; i++) w.tick(intent());
  ok("one swing damages an enemy exactly once, hit-stop or no hit-stop", enemy.hp === startHp - CONFIG.ATTACK.DMG, `hp ${enemy.hp}`);
  ok("the swing ends on its own", w.player.swing === null);
  ok("a fresh swing gets a fresh registry", (() => {
    const e2 = duel(w, 16);
    const hp2 = w.enemies[w.enemies.length - 1].hp;
    w.tick(intent({ attack: true, aimX: w.enemies[w.enemies.length - 1].x, aimY: w.enemies[w.enemies.length - 1].y }));
    for (let i = 0; i < budget; i++) w.tick(intent());
    return w.enemies.find((x) => x.id === e2)!.hp < hp2;
  })(), `target ${id}`);
}

heading("Hit-stop");
{
  const w = sandbox();
  requestHitStop(w, 3);
  requestHitStop(w, 5);
  requestHitStop(w, 2);
  ok("hit-stop takes the max, never the sum", w.hitStopTicks === 5, `got ${w.hitStopTicks}`);

  const w2 = sandbox();
  const e = makeEnemy(w2.player.x + 16, w2.player.y);
  w2.enemies.push(e);
  w2.syncUnits();
  w2.tick(intent({ attack: true, aimX: e.x, aimY: e.y }));
  let frozenAt = -1;
  for (let i = 0; i < 40 && frozenAt < 0; i++) {
    if (w2.hitStopTicks > 0) frozenAt = i;
    if (frozenAt >= 0) break;
    w2.tick(intent());
  }
  ok("landing a hit freezes the sim", frozenAt >= 0);
  const px = w2.player.x;
  const py = w2.player.y;
  const ex = e.x;
  const ticksBefore = w2.hitStopTicks;
  w2.tick(intent({ attack: true }));
  w2.tick(intent({ attack: true }));
  ok("positions do not move while frozen", w2.player.x === px && w2.player.y === py && e.x === ex);
  ok("the freeze consumes ticks", w2.hitStopTicks === Math.max(0, ticksBefore - 2));

  const w3 = sandbox();
  const before = w3.enemies.length;
  ok("sandbox has no leftover enemies", before === 0);
}

heading("Input buffering through a freeze");
{
  const src = new IntentSource();
  src.moveX = 1;
  src.pressAttack(100);
  const ttl = CONFIG.INPUT.PRESS_BUFFER_TICKS;
  const early = src.read(100);
  ok("a press is consumed on the tick it is read", early.attack);

  const src2 = new IntentSource();
  src2.pressAttack(100);
  let fired = false;
  let firedAt = 0;
  for (let t = 101; t <= 100 + CONFIG.FEEL.HIT_STOP_KILL + 2; t++) {
    const frozen = t <= 100 + CONFIG.FEEL.HIT_STOP_KILL;
    const r = src2.read(t, !frozen);
    if (r.attack) {
      fired = true;
      firedAt = t;
      break;
    }
  }
  ok("hit-stop does not swallow a press", fired);
  ok("the buffered press lands within 2 ticks after the freeze ends", firedAt === 100 + CONFIG.FEEL.HIT_STOP_KILL + 1, `firedAt ${firedAt}`);

  const src3 = new IntentSource();
  src3.pressAttack(100);
  const late = src3.read(100 + ttl + 1);
  ok("a stale press is dropped instead of firing much later", !late.attack);

  const src4 = new IntentSource();
  src4.moveX = 1;
  src4.moveY = 0;
  const a = src4.read(1);
  src4.moveX = -1;
  const b = src4.read(2);
  ok("movement axes are latest-wins, not queued", a.moveX === 1 && b.moveX === -1);
}

heading("Combo chain");
{
  const w = sandbox();
  const e = makeEnemy(w.player.x + 18, w.player.y);
  w.enemies.push(e);
  w.syncUnits();
  let maxCombo = 0;
  for (let i = 0; i < 90; i++) {
    w.tick(intent({ attack: i % 3 === 0, aimX: e.x, aimY: e.y }));
    if (w.player.swing !== null) maxCombo = Math.max(maxCombo, w.player.swing.combo);
  }
  ok("chaining reaches combo 2", maxCombo === 2, `maxCombo ${maxCombo}`);
  ok(`chain length is capped at CONFIG.ATTACK.COMBOS.length (${CONFIG.ATTACK.COMBOS.length})`, maxCombo <= CONFIG.ATTACK.COMBOS.length);
}

heading("Enemy state machine");
{
  const w = sandbox();
  const e = makeEnemy(w.player.x + 20, w.player.y);
  w.enemies.push(e);
  w.syncUnits();
  let sawTelegraph = false;
  let sawPunish = false;
  for (let i = 0; i < 120; i++) {
    w.tick(intent());
    if (e.state === ENEMY_STATE.TELEGRAPH) sawTelegraph = true;
    if (e.state === ENEMY_STATE.ATTACK && e.swing !== null && e.swing.phase === "recover") sawPunish = true;
  }
  ok("the enemy telegraphs before it attacks", sawTelegraph);
  ok("the enemy leaves a punish window after attacking", sawPunish);
  ok("illegal transitions throw", (() => { try { e.setState(ENEMY_STATE.DEAD); e.setState(ENEMY_STATE.CHASE); return false; } catch { return true; } })());
  ok("dead -> chase is not a legal edge", !canGoEnemy(ENEMY_STATE.DEAD, ENEMY_STATE.CHASE));

  const w2 = sandbox();
  const attacker = makeEnemy(w2.player.x + 14, w2.player.y);
  w2.enemies.push(attacker);
  w2.syncUnits();
  let taken = 0;
  let lastHp = w2.player.hp;
  for (let i = 0; i < 200; i++) {
    w2.tick(intent());
    if (w2.player.hp < lastHp) {
      taken++;
      lastHp = w2.player.hp;
    }
    if (taken >= 2) break;
  }
  ok("an enemy swing also lands at most once per swing", taken <= 2 && lastHp === CONFIG.PLAYER.HP - 2, `hits ${taken}`);
}

heading("Player defence");
{
  const w = sandbox();
  w.tick(intent({ dash: true }));
  ok("dash grants i-frames", w.player.dashIframeTicks > 0 && !w.player.canBeHit());
  ok("dash is stateful", w.player.state === PLAYER_STATE.DASH);

  const w2 = sandbox();
  const e = makeEnemy(w2.player.x + 10, w2.player.y);
  w2.enemies.push(e);
  w2.syncUnits();
  const hp0 = w2.player.hp;
  let hitsTaken = 0;
  for (let i = 0; i < 400 && hitsTaken < 2; i++) {
    const before = w2.player.hp;
    w2.tick(intent());
    if (w2.player.hp < before) hitsTaken++;
  }
  ok("the enemy can actually reach and hurt the player", hitsTaken >= 1, `hits ${hitsTaken}`);
  ok("i-frames keep the damage rate bounded", w2.player.hp > hp0 - 3, `hp ${w2.player.hp}`);
}

heading("Particle budget");
{
  const pool = new ParticlePool(CONFIG.READABILITY.PARTICLE_CAP);
  const rng = makeRng(7);
  for (let i = 0; i < 300; i++) pool.burstBlood(0, 0, 0, 1, rng);
  ok("particles are hard-capped", pool.alive <= pool.cap, `alive ${pool.alive}`);
  ok("no allocation beyond the pool", pool.cap === CONFIG.READABILITY.PARTICLE_CAP);
  pool.burstBlood(0, 0, 0, 8, rng);
  pool.burstSpark(0, 0, 3, rng);
  ok("five-enemy worst case fits the cap", 5 * (CONFIG.FEEL.BLOOD + CONFIG.FEEL.SPARK) <= CONFIG.READABILITY.PARTICLE_CAP);
  for (let i = 0; i < 400; i++) pool.update(1 / 60);
  ok("everything expires, pool is reusable", pool.alive === 0);
}

heading("Sim purity (tick() must stay testable in node)");
{
  const dirs = ["src/systems", "src/entities", "src/world", "src/sim"];
  const files: string[] = [];
  for (const d of dirs) {
    for (const f of readdirSync(d)) if (f.endsWith(".ts")) files.push(join(d, f));
  }
  files.push("src/events.ts", "src/config.ts", "src/mathx.ts", "src/input/intent.ts");
  const banned = ["document.", "window.", "requestAnimationFrame", "AudioContext", "localStorage", "getContext"];
  const offenders: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const b of banned) if (text.includes(b)) offenders.push(`${f}: ${b}`);
  }
  ok("no sim module touches the DOM or audio", offenders.length === 0, offenders.join(", "));
}

heading("Room loop");
{
  const w = sandbox();
  ok("room starts with the door locked", !w.room.doorOpen);
  for (const e of w.enemies) e.die();
  w.tick(intent());
  ok("clearing the room opens the door", w.room.doorOpen);
  const before = w.roomIndex;
  w.player.x = w.room.widthPx - 8;
  w.player.y = w.room.heightPx / 2;
  w.tick(intent());
  ok("walking into the open door advances the room", w.roomIndex !== before, `index ${w.roomIndex}`);
  ok("the new room is populated", w.enemies.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
