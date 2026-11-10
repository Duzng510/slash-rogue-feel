import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, ENEMY_KINDS, enemyDef } from "../src/config.ts";
import type { EnemyKind } from "../src/config.ts";
import { IntentSource } from "../src/input/intent.ts";
import { World } from "../src/world/world.ts";
import { TEMPLATES, MARKER_KIND } from "../src/world/rooms.ts";
import { makeEnemy, ENEMY_STATE, ENEMY_TRANSITIONS, canGoEnemy, type Enemy } from "../src/entities/enemy.ts";
import { createSwing } from "../src/systems/combat.ts";
import { PLAYER_STATE } from "../src/entities/player.ts";
import { requestHitStop } from "../src/systems/feelSim.ts";
import { ParticlePool } from "../src/systems/particles.ts";
import { makeRng } from "../src/mathx.ts";
import { fitAxes, rotateVec, tryImmersive } from "../src/ui/immersive.ts";
import { stalled } from "../src/ui/diag.ts";
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

/** a swing that never goes through the sim, for poking one unit directly */
function jab(src: World, dmg: number) {
  return createSwing(src, {
    side: "player",
    combo: 1,
    dir: 0,
    ox: 0,
    oy: 0,
    reach: 10,
    deg: 90,
    dmg,
    knockback: 0,
    fd: { startup: 1, active: 1, recovery: 1 },
  });
}

function withEnemy(w: World, e: Enemy): void {
  w.enemies = [e];
  w.syncUnits();
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

heading("Archetype readability");
{
  const hz = CONFIG.TIME.TICK_HZ;
  ok(
    "every archetype telegraphs for at least MIN_TELEGRAPH_S",
    ENEMY_KINDS.every((k) => enemyDef(k).TELEGRAPH_TICKS / hz >= CONFIG.LAWS.MIN_TELEGRAPH_S),
    ENEMY_KINDS.map((k) => `${k}:${(enemyDef(k).TELEGRAPH_TICKS / hz).toFixed(2)}s`).join(" ")
  );
  ok("the boss stays readable in phase 2", enemyDef("boss").ENRAGED_TELEGRAPH_TICKS / hz >= CONFIG.LAWS.MIN_TELEGRAPH_S);
  ok("every archetype leaves a reactable punish window", ENEMY_KINDS.every((k) => enemyDef(k).RECOVERY_TICKS / hz >= 0.15));

  const colors = ENEMY_KINDS.map((k) => enemyDef(k).BODY_COLOR);
  ok("body colours are pairwise distinct", new Set(colors).size === colors.length, colors.join(" "));
  const keys = ENEMY_KINDS.map((k) => enemyDef(k).SPRITE_KEY);
  ok("sprite keys are pairwise distinct", new Set(keys).size === keys.length, keys.join(" "));

  const reserved = [
    CONFIG.PALETTE.VOID,
    CONFIG.PALETTE.FLOOR,
    CONFIG.PALETTE.FLOOR_ACCENT,
    CONFIG.PALETTE.WALL,
    CONFIG.PALETTE.WALL_TOP,
    CONFIG.PALETTE.DOOR_LOCKED,
    CONFIG.PALETTE.PLAYER_BODY,
    CONFIG.PALETTE.PLAYER_RIM,
    CONFIG.PALETTE.DOOR_OPEN,
  ];
  const clashes = colors.filter((c) => reserved.includes(c));
  ok("no enemy body colour is a floor, wall or player colour", clashes.length === 0, clashes.join(" "));

  const art = readFileSync("src/render/pixelart.ts", "utf8");
  const unbuilt = ENEMY_KINDS.filter((k) => !art.includes(`enemyDef("${k}")`));
  ok("every archetype is drawn from its own def", unbuilt.length === 0, `missing ${unbuilt.join(",")}`);

  ok(
    "the charger telegraph is narrow enough to read as a lane",
    enemyDef("charger").ATTACK_ARC_DEG <= CONFIG.LAWS.MAX_CHARGER_ARC_DEG,
    `got ${enemyDef("charger").ATTACK_ARC_DEG}`
  );
  ok("the charger lane outranges a chaser swing", enemyDef("charger").ATTACK_REACH > enemyDef("chaser").ATTACK_REACH);
  ok("the charger commits: it moves only while the swing is active", enemyDef("charger").LUNGE_SPEED > 0);
  ok("the splitter is the only archetype that splits", ENEMY_KINDS.filter((k) => enemyDef(k).SPLIT_INTO !== null).join() === "splitter");
}

heading("Crowding cap");
{
  const w = sandbox();
  for (let i = 0; i < 40; i++) w.spawnEnemy(w.player.x + i, w.player.y, "chaser");
  ok("spawnEnemy refuses to exceed MAX_ALIVE", w.aliveEnemies() === CONFIG.ENEMY.MAX_ALIVE, `alive ${w.aliveEnemies()}`);
  ok("the cap still leaves room above the biggest authored wave", CONFIG.ENEMY.MAX_ALIVE > Math.max(...CONFIG.ROOMS.WAVES));

  const w2 = sandbox();
  const parent = makeEnemy(w2.player.x + 40, w2.player.y, "splitter");
  withEnemy(w2, parent);
  for (let i = 0; i < 40; i++) w2.spawnEnemy(w2.player.x, w2.player.y, "chaser");
  parent.onHit(jab(w2, 99), parent.x, parent.y, w2);
  ok("a split into a full room cannot break the cap", w2.aliveEnemies() <= CONFIG.ENEMY.MAX_ALIVE, `alive ${w2.aliveEnemies()}`);
}

heading("Splitter");
{
  const w = sandbox();
  const parent = makeEnemy(w.player.x + 40, w.player.y, "splitter");
  withEnemy(w, parent);
  const killed = parent.onHit(jab(w, 99), parent.x, parent.y, w);
  const kids = w.enemies.filter((e) => e !== parent);
  ok("a lethal hit kills the splitter", killed && parent.dead);
  ok("it spawns exactly its configured count", kids.length === enemyDef("splitter").SPLIT_COUNT, `kids ${kids.length}`);
  ok("the spawnlings are the configured kind", kids.every((k) => k.kind === enemyDef("splitter").SPLIT_INTO));
  ok("the spawnlings come in at full hp", kids.every((k) => !k.dead && k.hp === enemyDef("small").HP));

  const w2 = sandbox();
  const p2 = makeEnemy(w2.player.x + 40, w2.player.y, "splitter");
  withEnemy(w2, p2);
  p2.onHit(jab(w2, 99), p2.x, p2.y, w2);
  const kids2 = w2.enemies.filter((e) => e !== p2);
  ok(
    "the split spread is deterministic for a seed",
    kids2.length === kids.length && kids2.every((k, i) => Math.abs(k.x - kids[i].x) < 1e-9 && Math.abs(k.y - kids[i].y) < 1e-9)
  );
}

heading("Radial ring geometry");
{
  const w = sandbox();
  const boss = makeEnemy(w.player.x + 20, w.player.y, "boss");
  withEnemy(w, boss);
  let guard = 0;
  while (boss.state !== ENEMY_STATE.TELEGRAPH && guard++ < 300) w.tick(intent());
  ok("the boss telegraphs before the ring lands", boss.state === ENEMY_STATE.TELEGRAPH);
  const locked = 1 - enemyDef("boss").RETARGET_FRACTION;
  while (boss.telegraphTicksLeft > boss.telegraphTotal * locked && guard++ < 500) w.tick(intent());
  ok("the telegraph direction is locked by the time the player dodges", boss.telegraphTicksLeft <= boss.telegraphTotal * locked);

  w.player.x = boss.x + 22;
  w.player.y = boss.y;
  let toAttack = 0;
  while (boss.state !== ENEMY_STATE.ATTACK && toAttack++ < 80) w.tick(intent());
  let duringRing = 0;
  const hpBeforeRing = w.player.hp;
  while (boss.state === ENEMY_STATE.ATTACK && duringRing++ < 80) w.tick(intent());
  ok(
    "the ring that is already charging lands behind the attacker",
    w.player.hp < hpBeforeRing,
    `hp ${w.player.hp}/${hpBeforeRing} after ${duringRing}`
  );
  ok("i-frames keep one ring to a single heart", hpBeforeRing - w.player.hp === 1);
}

heading("Boss phase 2");
{
  const w = sandbox();
  const boss = makeEnemy(w.player.x, w.player.y, "boss");
  withEnemy(w, boss);
  const half = boss.maxHp * enemyDef("boss").ENRAGE_FRACTION;
  let guard = 0;
  while (boss.hp > half && !boss.enraged && guard++ < 60) boss.onHit(jab(w, 1), boss.x, boss.y, w);
  ok("the boss enrages at or below half health", boss.enraged && boss.hp <= half, `hp ${boss.hp} half ${half}`);
  ok("enrage is configured no later than half health", enemyDef("boss").ENRAGE_FRACTION <= 0.5);
  boss.enraged = false;
  boss.onHit(jab(w, 1), boss.x, boss.y, w);
  ok("enrage never reverts once it is set", boss.enraged);
  ok("phase 2 telegraphs faster", enemyDef("boss").ENRAGED_TELEGRAPH_TICKS < enemyDef("boss").TELEGRAPH_TICKS);
  ok("phase 2 commits follow-up rings", enemyDef("boss").RING_FOLLOWUPS > 0);
}

heading("Shared state machine");
{
  const names = Object.values(ENEMY_STATE);
  const badEdges = Object.entries(ENEMY_TRANSITIONS).flatMap(([from, tos]) =>
    tos.filter((t) => !names.includes(t)).map((t) => `${from}->${t}`)
  );
  ok("every edge in the table lands on a real state", badEdges.length === 0, badEdges.join(","));
  ok("one transition table serves every archetype", Object.keys(ENEMY_TRANSITIONS).length === names.length);
  ok("an attack can chain straight into the next telegraph", canGoEnemy(ENEMY_STATE.ATTACK, ENEMY_STATE.TELEGRAPH));
  ok("dead -> telegraph is not a legal edge", !canGoEnemy(ENEMY_STATE.DEAD, ENEMY_STATE.TELEGRAPH));

  const w = sandbox();
  const boss = makeEnemy(w.player.x + 30, w.player.y, "boss");
  withEnemy(w, boss);
  w.player.hp = 99;
  let sawTelegraph = false;
  let sawPunish = false;
  for (let i = 0; i < 250; i++) {
    w.tick(intent());
    if (boss.state === ENEMY_STATE.TELEGRAPH) sawTelegraph = true;
    if (boss.state === ENEMY_STATE.ATTACK && boss.swing !== null && boss.swing.phase === "recover") sawPunish = true;
  }
  ok("the boss telegraphs and then leaves a punish window", sawTelegraph && sawPunish);
  ok("the boss rings twice back to back once enraged", (() => {
    boss.enraged = true;
    let telegraphs = 0;
    let last = boss.state;
    for (let i = 0; i < 250; i++) {
      w.tick(intent());
      if (boss.state === ENEMY_STATE.TELEGRAPH && last !== ENEMY_STATE.TELEGRAPH) telegraphs++;
      last = boss.state;
      if (telegraphs >= 2) break;
    }
    return telegraphs >= 2;
  })(), "no follow-up ring");
}

heading("Authored content");
{
  const placed = new Set<EnemyKind>();
  for (const t of TEMPLATES) {
    for (const ch of t.rows.join("")) {
      const k = MARKER_KIND[ch];
      if (k !== undefined) placed.add(k);
    }
  }
  const missing = ENEMY_KINDS.filter((k) => k !== "small" && !placed.has(k));
  ok("every archetype you can fight is placed in a room", missing.length === 0, `missing ${missing.join(",")}`);
  const lastRoom = TEMPLATES[TEMPLATES.length - 1];
  ok("the last room is the boss arena", lastRoom.rows.join("").includes("B"));
  ok("the boss arena holds no trash mobs", /[ECT]/.test(lastRoom.rows.join("")) === false);
  ok("exactly one boss exists in the authored rooms", TEMPLATES.reduce((n, t) => n + (t.rows.join("").match(/B/g) ?? []).length, 0) === 1);

  const arena = TEMPLATES[TEMPLATES.length - 1];
  const cellOf = (ch: string): { x: number; y: number } | null => {
    for (let ry = 0; ry < arena.rows.length; ry++) {
      const cx = arena.rows[ry].indexOf(ch);
      if (cx >= 0) return { x: (cx + 1) * CONFIG.WORLD.TILE, y: (ry + 1) * CONFIG.WORLD.TILE };
    }
    return null;
  };
  const entry = cellOf("S");
  const bossMark = cellOf("B");
  const gap = entry !== null && bossMark !== null ? Math.hypot(bossMark.x - entry.x, bossMark.y - entry.y) : Infinity;
  ok("the boss can see the player the moment the arena loads", enemyDef("boss").CHASE_ACQUIRE >= gap, `gap ${Math.round(gap)}`);

  const w = sandbox();
  w.loadRoom(TEMPLATES.length - 1);
  let engaged = false;
  for (let i = 0; i < 400 && !engaged; i++) {
    w.tick(intent());
    engaged = w.enemies.some((e) => e.state === ENEMY_STATE.TELEGRAPH);
  }
  ok("the boss walks into range and telegraphs", engaged);
}

heading("Mobile landscape");
{
  const r = rotateVec(1, 0, true);
  ok("a sideways app maps screen right to app up", r.x === 0 && r.y === -1, `${r.x},${r.y}`);
  ok("an unrotated stick vector passes through", rotateVec(0.5, -0.25, false).x === 0.5);
  let v = { x: 1, y: 2 };
  for (let i = 0; i < 4; i++) v = rotateVec(v.x, v.y, true);
  ok("rotateVec is a quarter turn, not a mirror", v.x === 1 && v.y === 2, `${v.x},${v.y}`);

  const rotated = fitAxes(390, 844, true);
  ok("the fit measures the rotated box, not the screen", rotated.w === 844 && rotated.h === 390, `${rotated.w}x${rotated.h}`);
  const plain = fitAxes(844, 390, false);
  ok("a real landscape window keeps its axes", plain.w === 844 && plain.h === 390);

  const order: string[] = [];
  const noApi = await tryImmersive({}, { lock: async () => { order.push("lock"); } });
  ok("a browser without fullscreen is skipped, not thrown", !noApi.fullscreen);
  ok("the skip is reported as unsupported instead of swallowed", noApi.reason === "unsupported", noApi.reason);
  ok("no fullscreen means no orientation lock attempt", order.length === 0, order.join(","));
  const granted = await tryImmersive(
    { requestFullscreen: async () => { order.push("fs"); } },
    { lock: async () => { order.push("lock"); } }
  );
  ok("the lock runs only after fullscreen is granted", granted.fullscreen && order.join(",") === "fs,lock", order.join(","));
  ok("a clean run says so", granted.reason === "ok", granted.reason);
  const denied = await tryImmersive(
    { requestFullscreen: async () => { throw new DOMException("denied", "NotAllowedError"); } },
    { lock: async () => { order.push("denied-lock"); } }
  );
  ok("a denied fullscreen stops there", !denied.fullscreen && !order.includes("denied-lock"));
  ok("the denial reason survives for the on-screen diagnostic", denied.reason === "fs:NotAllowedError", denied.reason);
  const lockFailed = await tryImmersive(
    { requestFullscreen: async () => {} },
    { lock: async () => { throw new DOMException("nope", "NotSupportedError"); } }
  );
  ok("a fullscreen that works without a lock is still immersive", lockFailed.fullscreen, lockFailed.reason);
  ok("the refused lock is named, not hidden", lockFailed.reason === "lock:NotSupportedError", lockFailed.reason);

  ok("the watchdog fires only past the limit", stalled(1000, 400, 500) && !stalled(1000, 600, 500) && !stalled(1000, 1000, 500));

  const entry = readFileSync("src/main.ts", "utf8");
  ok("the diagnostic is gated on exactly one query check", entry.includes('startDiag(qs.get("diag") === "1",'), "gate changed");
  ok("the diagnostic never auto-enables from device detection", !readFileSync("src/ui/diag.ts", "utf8").includes("matchMedia"));

  const html = readFileSync("index.html", "utf8");
  const open = html.indexOf('<div id="app">');
  const script = html.indexOf("<script");
  const inside = open >= 0 && script > open ? html.slice(open, script) : "";
  const outside = ["stage", "panel", "touch", "keys"].filter((id) => !inside.includes(`id="${id}"`));
  ok("every overlay lives inside the rotated wrapper", outside.length === 0, `outside: ${outside.join(",")}`);
  ok("rot90 transforms that wrapper by a quarter turn", html.includes("body.rot90 #app") && html.includes("rotate(90deg)"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
