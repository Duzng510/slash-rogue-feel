import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, ENEMY_KINDS, enemyDef, isScripted } from "../src/config.ts";
import type { EnemyKind } from "../src/config.ts";
import { IntentSource } from "../src/input/intent.ts";
import { World } from "../src/world/world.ts";
import { TEMPLATES, MARKER_KIND, Room, TILE, type Template } from "../src/world/rooms.ts";
import { makeEnemy, ENEMY_STATE, ENEMY_TRANSITIONS, canGoEnemy, type Enemy } from "../src/entities/enemy.ts";
import { createSwing, hitFeedback, playerSwingInit } from "../src/systems/combat.ts";
import { CHARACTERS, COMBO_HITS } from "../src/systems/characters.ts";
import { WEAPONS, WEAPON_LIST, type WeaponId } from "../src/systems/weapons.ts";
import { ARTIFACTS, ARTIFACT_COLORS, ARTIFACT_UNLOCKS, CURSES } from "../src/systems/artifacts.ts";
import { formatRunTime, emptyStats } from "../src/systems/runStats.ts";
import { checkAchievements, emptyAchievements, parseAchievements, stringifyAchievements } from "../src/systems/unlocks.ts";
import type { Achievements, AchievementId } from "../src/systems/unlocks.ts";
import { PLAYER_STATE } from "../src/entities/player.ts";
import { requestHitStop } from "../src/systems/feelSim.ts";
import { ParticlePool } from "../src/systems/particles.ts";
import { makeRng } from "../src/mathx.ts";
import { fitAxes, rotateVec, tryImmersive } from "../src/ui/immersive.ts";
import { stalled } from "../src/ui/diag.ts";
import { GameLoop } from "../src/loop.ts";
import type { Intent } from "../src/sim/types.ts";
import { biomeForRoom } from "../src/systems/biomes.ts";
import { applyAscension } from "../src/systems/ascension.ts";
import { APP_VERSION, CHANGELOG } from "../src/ui/changelog.ts";

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
  return { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false, skill: false, ...over };
}

function sandbox(): World {
  const w = new World(CONFIG.SEED);
  w.enemies = [];
  w.syncUnits();
  w.player.reset(w.room.start.x, w.room.start.y);
  w.room.openDoors();
  return w;
}

/** every artifact's gating achievement earned, so offer-size laws ignore the unlock filter */
function allUnlocks(): Achievements {
  const earned = new Set<AchievementId>();
  for (const gate of Object.values(ARTIFACT_UNLOCKS)) if (gate !== null) earned.add(gate);
  return { earned, best: null, totalGold: 0, charactersWon: new Set(), weaponsWon: new Set(), ascensionMax: 0 };
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
ok(
  "post-effect feel sliders are graduated intensities in [0,1], not toggles",
  [CONFIG.SLIDERS.bloom, CONFIG.SLIDERS.crt, CONFIG.SLIDERS.ripple].every((v) => v >= 0 && v <= 1),
  `bloom ${CONFIG.SLIDERS.bloom} crt ${CONFIG.SLIDERS.crt} ripple ${CONFIG.SLIDERS.ripple}`
);
ok(
  "bloom/crt/haze carry a positive base strength so any nonzero slider reads",
  CONFIG.BLOOM.INTENSITY > 0 && CONFIG.CRT.BARREL > 0 && CONFIG.CRT.SCANLINE > 0 && CONFIG.HAZE.AMP > 0
);

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

heading("Run stats");
{
  const w = sandbox();
  ok(
    "runStats starts hurtFree with zeroed counters",
    w.runStats.hurtFree && w.runStats.enemiesKilled === 0 && w.runStats.damageDealt === 0 && w.runStats.roomsCleared === 0
  );

  const kill = sandbox();
  const e = makeEnemy(kill.player.x + 20, kill.player.y);
  withEnemy(kill, e);
  e.onHit(jab(kill, 999), e.x, e.y, kill);
  ok("a lethal enemy hit counts one kill", kill.runStats.enemiesKilled === 1, `k=${kill.runStats.enemiesKilled}`);

  const dd = sandbox();
  duel(dd);
  const foe = dd.enemies[0];
  dd.tick(intent({ attack: true, aimX: foe.x, aimY: foe.y }));
  const budget = CONFIG.ATTACK.COMBOS[0].startup + CONFIG.ATTACK.COMBOS[0].active + CONFIG.ATTACK.COMBOS[0].recovery + CONFIG.FEEL.HIT_STOP_KILL + 4;
  for (let i = 0; i < budget; i++) dd.tick(intent());
  ok("a landed player swing adds its damage to the tally", dd.runStats.damageDealt === CONFIG.ATTACK.DMG, `dd=${dd.runStats.damageDealt}`);

  const hurt = sandbox();
  hurt.player.onHit({ ...jab(hurt, 3), side: "enemy" as const }, hurt.player.x, hurt.player.y, hurt);
  ok("taking a hit clears hurtFree and counts damage taken", !hurt.runStats.hurtFree && hurt.runStats.damageTaken === 3, `dt=${hurt.runStats.damageTaken}`);

  const frozen = sandbox();
  frozen.hitStopTicks = 3;
  const before = frozen.runStats.ticksElapsed;
  frozen.tick(intent());
  ok("run time does not accrue during hit-stop", frozen.runStats.ticksElapsed === before, `delta=${frozen.runStats.ticksElapsed - before}`);

  const art = sandbox();
  art.artifactChoices = ARTIFACTS.slice(0, 3);
  const picked = art.artifactChoices[0].id;
  ok("picking an artifact counts it", art.chooseArtifact(picked) && art.runStats.artifactsTaken === 1);

  const exit = sandbox();
  const T = CONFIG.WORLD.TILE;
  exit.player.x = (exit.room.w - 1) * T + T / 2;
  exit.player.y = Math.floor(exit.room.h / 2) * T + T / 2;
  exit.runStats.enemiesKilled = 7;
  ok("player is standing on the open door", exit.room.exitsAt(exit.player.x, exit.player.y));
  exit.tick(intent());
  ok("leaving a room counts one cleared room", exit.runStats.roomsCleared === 1, `rc=${exit.runStats.roomsCleared}`);
  ok("loadRoom within a run keeps accumulated stats", exit.runStats.enemiesKilled === 7, `k=${exit.runStats.enemiesKilled}`);

  ok("formatRunTime renders m:ss", formatRunTime(154 * 60) === "2:34", formatRunTime(154 * 60));
}

heading("Unlocks");
{
  const gates = Object.values(ARTIFACT_UNLOCKS);
  ok("water and fire are unlocked from the first run", ARTIFACT_UNLOCKS.water === null && ARTIFACT_UNLOCKS.fire === null);
  ok("every other artifact has a non-null achievement gate", gates.filter((g) => g !== null).length === ARTIFACTS.length - 2);

  const oneKill = { ...emptyStats(), enemiesKilled: 1 };
  ok("the first kill reports first_blood", checkAchievements(oneKill, "kill").includes("first_blood"));

  const won = { ...emptyStats(), roomsCleared: 4, ticksElapsed: 60 };
  const wonAchs = checkAchievements(won, "win");
  ok("finishing the run reports full_run", wonAchs.includes("full_run"));
  ok("a fast clear reports speedrun", wonAchs.includes("speedrun"));
  ok("clearing three rooms on the way reports half_way", wonAchs.includes("half_way"));

  const hurt = { ...emptyStats(), hurtFree: false, killStreak: 20 };
  ok("a hit this run blocks the no-damage combo award", !checkAchievements(hurt, "kill").includes("combo_master"));
}

heading("Crowd separation (spatial grid)");
{
  const w = sandbox();
  const x0 = w.player.x + 60;
  const a = makeEnemy(x0, w.player.y);
  const b = makeEnemy(x0 + 1, w.player.y);
  w.enemies = [a, b];
  w.syncUnits();
  const d0 = Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < 12; i++) w.tick(intent());
  const d1 = Math.hypot(a.x - b.x, a.y - b.y);
  ok("two overlapping enemies push apart through the grid", d1 > d0 + 2, `d0=${d0.toFixed(2)} d1=${d1.toFixed(2)}`);
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

  const wm = sandbox();
  wm.player.character = "mage";
  wm.tick(intent({ dash: true }));
  for (let i = 0; i < 8; i++) wm.tick(intent());
  let ghostSprite = "";
  wm.particles.visit((s) => {
    if (s.kind === "ghost") ghostSprite = s.sprite ?? "";
  });
  ok("dash afterimage matches the active character's sprite", ghostSprite === "player_mage", `got ${ghostSprite || "none"}`);

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
  const w = new World(CONFIG.SEED, allUnlocks());
  ok("room starts with the door locked", !w.room.doorOpen);
  for (const e of w.enemies) e.die();
  w.tick(intent());
  ok("clearing the room offers three artifacts before opening the door", !w.room.doorOpen && w.artifactChoices.length === 3);
  w.chooseArtifact(w.artifactChoices[0].id);
  ok("choosing an artifact opens the door", w.room.doorOpen);
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
  ok(
    "every archetype that survives its attack leaves a reactable punish window",
    ENEMY_KINDS.filter((k) => enemyDef(k).EXPLODE_RADIUS === 0).every((k) => enemyDef(k).RECOVERY_TICKS / hz >= 0.15)
  );

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
  const elite = makeEnemy(w.player.x + 80, w.player.y, "chaser", true);
  ok("elites spawn in their red appearance telegraph", elite.state === ENEMY_STATE.APPEAR);

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
  // "small" is only ever summoned, and the legacy "boss" archetype is retired from the run now that
  // the Forgotten King owns the finale — neither is placed by a room marker.
  const missing = ENEMY_KINDS.filter((k) => k !== "small" && k !== "boss" && !placed.has(k));
  ok("every archetype you can fight is placed in a room", missing.length === 0, `missing ${missing.join(",")}`);
  const lastRoom = TEMPLATES[TEMPLATES.length - 1];
  ok("the last room is the Forgotten King's arena", lastRoom.rows.join("").includes("K"));
  ok("the finale arena holds no trash mobs", /[ECT]/.test(lastRoom.rows.join("")) === false);
  const countMark = (ch: string): number => TEMPLATES.reduce((n, t) => n + (t.rows.join("").split(ch).length - 1), 0);
  ok("each scripted superior is authored exactly once", countMark("W") === 1 && countMark("G") === 1 && countMark("K") === 1, `W${countMark("W")} G${countMark("G")} K${countMark("K")}`);
  ok("the legacy classic boss is retired from the authored run", countMark("B") === 0);

  const arena = TEMPLATES[TEMPLATES.length - 1];
  const cellOf = (ch: string): { x: number; y: number } | null => {
    for (let ry = 0; ry < arena.rows.length; ry++) {
      const cx = arena.rows[ry].indexOf(ch);
      if (cx >= 0) return { x: (cx + 1) * CONFIG.WORLD.TILE, y: (ry + 1) * CONFIG.WORLD.TILE };
    }
    return null;
  };
  const entry = cellOf("S");
  const kingMark = cellOf("K");
  const gap = entry !== null && kingMark !== null ? Math.hypot(kingMark.x - entry.x, kingMark.y - entry.y) : Infinity;
  ok("the king can see the player the moment the arena loads", enemyDef("king").CHASE_ACQUIRE >= gap, `gap ${Math.round(gap)}`);

  const w = sandbox();
  w.loadRoom(TEMPLATES.length - 1);
  let engaged = false;
  for (let i = 0; i < 400 && !engaged; i++) {
    w.tick(intent());
    engaged = w.enemies.some((e) => e.state === ENEMY_STATE.TELEGRAPH);
  }
  ok("the finale boss walks into range and telegraphs", engaged);
}

heading("Room variety (P5)");
{
  const T = CONFIG.WORLD.TILE;
  // flood-fill from the authored start to any opened door tile, stepping only on non-solid tiles
  const reachesDoor = (t: Template): boolean => {
    const room = new Room(t, 0);
    room.openDoors();
    const sx = Math.floor(room.start.x / T);
    const sy = Math.floor(room.start.y / T);
    const key = (x: number, y: number): number => y * room.w + x;
    const seen = new Set<number>([key(sx, sy)]);
    const queue: [number, number][] = [[sx, sy]];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (queue.length > 0) {
      const [x, y] = queue.shift() as [number, number];
      if (room.at(x, y) === TILE.DOOR_OPEN) return true;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= room.w || ny >= room.h) continue;
        if (seen.has(key(nx, ny)) || room.isSolid(nx, ny)) continue;
        seen.add(key(nx, ny));
        queue.push([nx, ny]);
      }
    }
    return false;
  };
  const stuck = TEMPLATES.map((t, i) => (reachesDoor(t) ? -1 : i)).filter((i) => i >= 0);
  ok("every authored room has a reachable exit", stuck.length === 0, `stuck rooms ${stuck.join(",")}`);
  ok("the run is now 12 rooms long", TEMPLATES.length === 12, `length ${TEMPLATES.length}`);
  ok("the biggest authored wave fields 8+ enemies", Math.max(...CONFIG.ROOMS.WAVES) >= 8, `max ${Math.max(...CONFIG.ROOMS.WAVES)}`);
  ok("every non-boss room has a wave entry", CONFIG.ROOMS.WAVES.length === TEMPLATES.length - 1, `waves ${CONFIG.ROOMS.WAVES.length}`);
  // a full-reward run takes one artifact per room (rooms 0..roomTotal-1) and must still show a
  // 3-choice offer on the last room — so pool >= (roomTotal-1) consumed + 3 remaining.
  ok("the artifact pool can fill every reward room", ARTIFACTS.length >= TEMPLATES.length + 2 * CONFIG.CURSES.MAX_CURSES + 2, `have ${ARTIFACTS.length} need ${TEMPLATES.length + 2 * CONFIG.CURSES.MAX_CURSES + 2}`);
}

heading("Rooms (P8)");
{
  const T = CONFIG.WORLD.TILE;
  const trapIndex = TEMPLATES.findIndex(t => t.rows.join("").includes("^"));
  const treasureIndex = TEMPLATES.findIndex(t => t.name === "Phòng kho báu");
  ok("a spike room is authored", trapIndex >= 0);
  ok("a treasure room is authored", treasureIndex >= 0);
  ok("the treasure room fields no enemies", TEMPLATES[treasureIndex].rows.join("").match(/[ECTBRPHXDNJ]/) === null);

  const w = new World(CONFIG.SEED);
  w.loadRoom(trapIndex);
  w.clearEnemies();
  w.room.openDoors();
  const spots: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let ty = 1; ty < w.room.h - 1; ty++) {
    for (let tx = 1; tx < w.room.w - 1; tx++) {
      if (w.room.at(tx, ty) === TILE.TRAP) spots.push({ x: (tx + 0.5) * T, y: (ty + 0.5) * T, tx, ty });
    }
  }
  ok("the spike room arms several tiles", spots.length >= 2, `spots ${spots.length}`);
  const [a, b] = spots;
  w.player.x = a.x;
  w.player.y = a.y;
  const hp0 = w.player.hp;
  w.tick(intent());
  ok("a spike bites the player", w.player.hp === hp0 - CONFIG.ROOMS.TRAP_DMG, `hp ${w.player.hp}`);
  ok("a triggered spike is spent", w.room.at(a.tx, a.ty) === TILE.TRAP_ARMED);
  w.player.x = a.x;
  w.player.y = a.y;
  w.player.vx = 0;
  w.player.vy = 0;
  w.player.iframeTicks = 0;
  w.hitStopTicks = 0;
  const hp1 = w.player.hp;
  w.tick(intent());
  ok("a spent spike never bites twice", w.player.hp === hp1, `hp ${w.player.hp}`);

  const e = makeEnemy(b.x, b.y, "chaser");
  w.enemies.push(e);
  w.syncUnits();
  w.hitStopTicks = 0;
  const ehp0 = e.hp;
  w.tick(intent());
  ok("a spike bites enemies too", e.hp === ehp0 - CONFIG.ROOMS.TRAP_DMG, `hp ${e.hp}`);
  ok("the enemy trigger spends the tile as well", w.room.at(b.tx, b.ty) === TILE.TRAP_ARMED);

  const safe = new World(CONFIG.SEED);
  safe.loadRoom(treasureIndex);
  ok("the treasure room spawns nothing", safe.enemies.length === 0);
  safe.tick(intent());
  ok("the treasure room rewards without a fight", safe.artifactChoices.length > 0 || safe.room.doorOpen);
}

heading("Warden (P9)");
{
  ok("the warden is a 15 HP mid-boss", enemyDef("warden").HP === 15);
  ok("the warden laser telegraphs for 2s", enemyDef("warden").LASER_TELEGRAPH_TICKS / CONFIG.TIME.TICK_HZ === 2);
  const mid = TEMPLATES.findIndex(t => t.rows.join("").includes("W"));
  ok("a mid-boss room is authored before the finale", mid >= 0 && mid < TEMPLATES.length - 1);
  const fielded = new World(CONFIG.SEED);
  fielded.loadRoom(mid);
  ok("the mid-boss room always fields the warden", fielded.enemies.some(e => e.kind === "warden"));

  const shopIdx = TEMPLATES.findIndex(t => t.shop === true);
  ok("a shop room is authored before the finale", shopIdx >= 0 && shopIdx < TEMPLATES.length - 1, `shop at ${shopIdx}`);
  ok("the shop room fields no enemies", shopIdx >= 0 && TEMPLATES[shopIdx].rows.join("").split("").every(ch => MARKER_KIND[ch] === undefined));
  ok("shop prices are ordered heal < artifact < maxhp < curse", CONFIG.SHOP.HEAL < CONFIG.SHOP.ARTIFACT && CONFIG.SHOP.ARTIFACT < CONFIG.SHOP.MAXHP && CONFIG.SHOP.MAXHP < CONFIG.SHOP.CURSE);

  const w = sandbox();
  w.clearEnemies();
  w.spawnEnemy(w.player.x + 70, w.player.y, "warden");
  w.player.iframeTicks = 10000;
  let spiral = false;
  let laser = false;
  let summon = false;
  for (let i = 0; i < 900; i++) {
    w.tick(intent());
    for (const ev of w.queue.drain()) if (ev.t === "beam") laser = true;
    if (w.projectiles.length > 0) spiral = true;
    if (w.enemies.some(e => e.kind === "small")) summon = true;
  }
  ok("the warden cycles spiral, laser and summon", spiral && laser && summon, `spiral=${spiral} laser=${laser} summon=${summon}`);
}

heading("Forge Golem (mini-boss)");
{
  const hz = CONFIG.TIME.TICK_HZ;
  ok("the golem is a 30 HP brute", enemyDef("golem").HP === 30);
  ok("the golem slam sweeps a full circle", enemyDef("golem").RADIAL && enemyDef("golem").ATTACK_ARC_DEG === 360);
  ok("the golem rages at half health", enemyDef("golem").PHASE2_FRACTION === 0.5);
  ok("a golem slam leaves a reactable punish window", enemyDef("golem").RECOVERY_TICKS / hz >= 0.15);
  const golemRoom = TEMPLATES.findIndex((t) => t.rows.join("").includes("G"));
  const wardenRoom = TEMPLATES.findIndex((t) => t.rows.join("").includes("W"));
  ok("the golem is authored in the forge, after the warden", golemRoom >= 0 && biomeForRoom(golemRoom).id === "forge" && golemRoom > wardenRoom, `golem@${golemRoom} warden@${wardenRoom}`);
  const fieldedG = new World(CONFIG.SEED);
  fieldedG.loadRoom(golemRoom);
  ok("the forge duel room fields the golem", fieldedG.enemies.some((e) => e.kind === "golem"));

  const g = sandbox();
  g.clearEnemies();
  g.spawnEnemy(g.player.x + 60, g.player.y, "golem");
  g.player.iframeTicks = 100000;
  const golem = g.enemies[g.enemies.length - 1];
  // a healthy golem swings melee only — no lava yet
  let guard = 0;
  while (golem.state !== ENEMY_STATE.ATTACK && guard++ < 400) g.tick(intent());
  ok("an at-health golem swings melee", golem.swing !== null && g.projectiles.length === 0, `swing=${golem.swing !== null} proj=${g.projectiles.length}`);
  // drop it into rage and watch the following slams: a shorter tell and lava spit
  golem.hp = Math.floor(golem.maxHp * 0.4);
  let sawLava = false;
  let ragedTelegraph = 0;
  for (let i = 0; i < 360; i++) {
    g.tick(intent());
    if (golem.state === ENEMY_STATE.TELEGRAPH && ragedTelegraph === 0) ragedTelegraph = golem.telegraphTotal;
    if (g.projectiles.some((p) => p.kind === "lava")) sawLava = true;
  }
  ok("the enraged golem flings lava globs on its slam", sawLava);
  ok("rage shortens the golem telegraph", ragedTelegraph > 0 && ragedTelegraph < enemyDef("golem").TELEGRAPH_TICKS, `telegraph ${ragedTelegraph}`);
}

heading("Forgotten King (finale mega-boss)");
{
  ok("the king is a 60 HP finale boss", enemyDef("king").HP === 60 && enemyDef("king").KING);
  ok("the king hits in a full circle", enemyDef("king").ATTACK_ARC_DEG === 360);
  const kingRoom = TEMPLATES.findIndex((t) => t.rows.join("").includes("K"));
  ok("the king owns the last room, in the void biome", kingRoom === TEMPLATES.length - 1 && biomeForRoom(kingRoom).id === "void", `king@${kingRoom}`);
  const fieldedK = new World(CONFIG.SEED);
  fieldedK.loadRoom(kingRoom);
  ok("the finale always fields the king", fieldedK.enemies.some((e) => e.kind === "king"));
  const intro = new World(CONFIG.SEED);
  intro.loadRoom(kingRoom);
  intro.queue.drain();
  intro.tick(intent());
  const introEvent = intro.queue.drain().find((ev) => ev.t === "bossIntro");
  ok("boss intro announces the name and schedules a 60-tick freeze",
    introEvent?.t === "bossIntro" && introEvent.name === "VUA LÃNG QUÊN" && intro.hitStopTicks === 59,
    `event=${introEvent?.t ?? "none"} stop=${intro.hitStopTicks}`);

  // a hit landed during the phase-drop invulnerability costs the king nothing
  const ki = sandbox();
  ki.clearEnemies();
  ki.spawnEnemy(ki.player.x + 40, ki.player.y, "king");
  const kin = ki.enemies[ki.enemies.length - 1];
  kin.kingInvulnTicks = 30;
  const hpI = kin.hp;
  kin.onHit(jab(ki, 5), kin.x, kin.y, ki);
  ok("an invulnerable king shrugs off a hit", kin.hp === hpI, `hp ${hpI}->${kin.hp}`);

  const k = sandbox();
  k.clearEnemies();
  k.spawnEnemy(k.player.x + 40, k.player.y, "king");
  k.player.iframeTicks = 100000;
  const king = k.enemies[k.enemies.length - 1];

  // phase 1 opens with a melee swing mirroring the hero's own weapon, no ranged fire yet
  let guard = 0;
  while (king.state !== ENEMY_STATE.ATTACK && guard++ < 500) k.tick(intent());
  ok("phase 1 mirrors the hero's melee", king.swing !== null && king.swing.kind === "king" && k.projectiles.length === 0, `swing=${king.swing?.kind} proj=${k.projectiles.length}`);

  // step down through phases 2 and 3, draining the sim queue each tick
  const phases: number[] = [];
  let sawGhost = false;
  let sawSummon = false;
  let sawFreeze = false;
  king.hp = Math.floor(king.maxHp * 0.5);
  for (let i = 0; i < 400; i++) {
    if (king.kingCinematicTicks > 0) sawFreeze = true;
    k.tick(intent());
    for (const ev of k.queue.drain()) if (ev.t === "kingPhase") phases.push(ev.phase);
    if (k.projectiles.some((p) => p.kind === "ghost")) sawGhost = true;
    if (k.enemies.some((e) => e.kind === "chaser")) sawSummon = true;
  }
  king.kingInvulnTicks = 0;
  king.hp = Math.floor(king.maxHp * 0.2);
  for (let i = 0; i < 200; i++) {
    k.tick(intent());
    for (const ev of k.queue.drain()) if (ev.t === "kingPhase") phases.push(ev.phase);
    if (k.projectiles.some((p) => p.kind === "ghost")) sawGhost = true;
  }
  ok("crossing the hp thresholds announces phases 2 and 3", phases.includes(2) && phases.includes(3), `phases ${phases.join(",")}`);
  ok("phase 2 summons elite chasers", sawSummon);
  ok("the king freezes for a beat on each phase drop", sawFreeze);
  ok("phases 2-3 trade melee for ghost volleys", sawGhost);

  // a flawless finish flags the no-damage king kill
  ok("killing the king records king_slayer, and flawless sets no-damage", (() => {
    const s = emptyStats();
    s.hurtFree = true;
    const w2 = new World(CONFIG.SEED);
    w2.clearEnemies();
    w2.runStats = s;
    w2.spawnEnemy(w2.player.x + 40, w2.player.y, "king");
    const kk = w2.enemies[w2.enemies.length - 1];
    let g = 0;
    while (!kk.dead && g++ < 60) kk.onHit(jab(w2, 20), kk.x, kk.y, w2);
    return kk.dead && s.kingKills === 1 && s.kingNoDamage;
  })());
  ok("the golem kill counts toward golem_slayer", checkAchievements({ ...emptyStats(), golemKills: 1 }, "kill").includes("golem_slayer"));
  ok("the king kill counts toward king_slayer and no_damage_king", (() => {
    const hit = checkAchievements({ ...emptyStats(), kingKills: 1 }, "kill");
    const perfect = checkAchievements({ ...emptyStats(), kingKills: 1, kingNoDamage: true }, "kill");
    return hit.includes("king_slayer") && perfect.includes("no_damage_king");
  })());
}

heading("Curse (P10)");
{
  const earned = new Set<AchievementId>();
  for (const gate of Object.values(ARTIFACT_UNLOCKS)) if (gate !== null) earned.add(gate);
  const w = new World(CONFIG.SEED, { earned, best: null, totalGold: 0, charactersWon: new Set(), weaponsWon: new Set(), ascensionMax: 0 });
  w.clearEnemies();
  w.tick(intent());
  ok("the first clear offers a two-curse package", w.curseOffer !== null && w.curseOffer.curses.length === 2 && w.curseOffer.artifacts.length === 2);
  const offer = w.curseOffer!;
  const bundle = offer.artifacts.map(a => a.id);
  ok("choosing a curse grants both bundled artifacts", w.chooseCurse(offer.curses[0].id) && bundle.every(id => w.artifacts.has(id)));
  ok("the curse package opens the door and closes the modal", w.room.doorOpen && w.artifactChoices.length === 0 && w.curseOffer === null);
  ok("a spent curse offer cannot be chosen again", w.chooseCurse(offer.curses[0].id) === false);

  const f = new World(CONFIG.SEED);
  f.curseOffer = { artifacts: [], curses: CURSES.filter(c => c.id === "frail") };
  f.chooseCurse("frail");
  ok("frail cuts max HP by 2", f.player.maxHp === CONFIG.PLAYER.HP - CONFIG.CURSES.FRAIL_HP && f.player.hp === f.player.maxHp);

  const g = new World(CONFIG.SEED);
  g.curseOffer = { artifacts: [], curses: CURSES.filter(c => c.id === "glass") };
  g.chooseCurse("glass");
  const hp0 = g.player.hp;
  g.player.onHit(createSwing(g, { side: "enemy", combo: 0, dir: 0, ox: 0, oy: 0, reach: 0, deg: 0, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } }), g.player.x, g.player.y, g);
  ok("glass doubles damage taken", g.player.hp === hp0 - CONFIG.CURSES.TAKEN_MULT, `hp ${g.player.hp}`);
  ok("glass multiplies damage dealt", playerSwingInit(g, 1, 0).dmg === CONFIG.ATTACK.DMG * CONFIG.CURSES.DEALT_MULT);

  const s = new World(CONFIG.SEED);
  s.curses.add("slow_hand");
  ok("slow_hand adds 2 startup ticks", playerSwingInit(s, 1, 0).fd.startup === CONFIG.ATTACK.COMBOS[0].startup + CONFIG.CURSES.STARTUP_TICKS);

  const run = (cursed: boolean): number => {
    const wr = new World(CONFIG.SEED);
    wr.clearEnemies();
    if (cursed) wr.curses.add("heavy_legs");
    const x0 = wr.player.x;
    for (let i = 0; i < 60; i++) wr.tick(intent({ moveX: 1 }));
    return wr.player.x - x0;
  };
  const plain = run(false);
  ok("heavy_legs slows the run by 20%", Math.abs(run(true) - plain * CONFIG.CURSES.SPEED_MULT) < 1, `plain ${plain.toFixed(1)}`);

  const b = new World(CONFIG.SEED);
  b.clearEnemies();
  b.curses.add("butterfingers");
  b.spawnEnemy(b.player.x + 20, b.player.y, "chaser");
  b.enemies[0].hp = 999;
  b.player.iframeTicks = 10000;
  let whiff = 0;
  let landed = 0;
  for (let i = 0; i < 600; i++) {
    b.tick(intent({ attack: true }));
    const sw = b.player.swing;
    if (sw !== null && sw.phase === "active" && sw.ticksLeft === sw.fd.active) {
      if (sw.deg === 0) whiff++;
      else landed++;
    }
  }
  ok("butterfingers whiffs some swings but not all", whiff > 0 && landed > 0, `whiff=${whiff} landed=${landed}`);
}

heading("Artifact HUD");
{
  const colors = ARTIFACTS.map((a) => ARTIFACT_COLORS[a.id]);
  ok("every artifact has a HUD colour", colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
  ok("artifact HUD colours are pairwise distinct", new Set(colors).size === colors.length);
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

heading("Changelog popup: version stays in sync");
{
  const html = readFileSync("index.html", "utf8");
  const open = html.indexOf('<div id="app">');
  const script = html.indexOf("<script");
  const inside = open >= 0 && script > open ? html.slice(open, script) : "";
  ok("the newest changelog entry is the app version", CHANGELOG[0].version === APP_VERSION, `${CHANGELOG[0].version} vs ${APP_VERSION}`);
  ok("every changelog version is well-formed", CHANGELOG.every((e) => /^v\d+\.\d+\.\d+$/.test(e.version)));
  ok("no duplicate versions in the changelog", new Set(CHANGELOG.map((e) => e.version)).size === CHANGELOG.length);
  ok("the start screen offers a changelog button and modal", html.includes('id="btn-changelog"') && html.includes('id="changelog-modal"'));
  ok("the inline changelog box is gone from the start screen", !html.includes("changelog-box"));
  ok("the changelog modal lives inside the rotated wrapper", inside.includes('id="changelog-modal"'));
}

heading("Hurt lockout: no input may throw the sim");
{
  const inputs: Array<{ name: string; value: Intent }> = [
    { name: "attack", value: intent({ attack: true }) },
    { name: "dash", value: intent({ dash: true }) },
    { name: "attack+dash", value: intent({ attack: true, dash: true }) },
    { name: "move", value: intent({ moveX: 1, moveY: 1 }) },
    { name: "idle", value: intent() },
  ];
  const offenders: string[] = [];
  for (const input of inputs) {
    const w = sandbox();
    duel(w, 10);
    let hurt = false;
    for (let i = 0; i < 200 && !hurt; i++) {
      w.tick(intent());
      hurt = w.player.state === PLAYER_STATE.HURT;
    }
    if (!hurt) {
      offenders.push(`${input.name}: no hit landed in 200 ticks`);
      continue;
    }
    for (let k = 0; k < 12; k++) {
      try {
        w.tick(input.value);
        w.tick(intent());
      } catch (err) {
        offenders.push(`${input.name} at live tick ${k}: ${(err as Error).message}`);
        break;
      }
    }
  }
  ok("every input inside the hurt window is legal", offenders.length === 0, offenders.join(" | "));

  const w = sandbox();
  duel(w, 10);
  for (let i = 0; i < 200 && w.player.state !== PLAYER_STATE.HURT; i++) w.tick(intent());
  w.hitStopTicks = 0;
  w.tick(intent({ attack: true }));
  ok("hurt locks attack out instead of cancelling the stagger", w.player.state === PLAYER_STATE.HURT && w.player.swing === null, w.player.state);
  for (let i = 0; i < 20; i++) w.tick(intent());
  ok("the lockout ends by itself", w.player.state !== PLAYER_STATE.HURT, w.player.state);
}

heading("A sim throw must not kill the frame loop");
{
  const queue: Array<(t: number) => void> = [];
  const raf = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => queue.push(cb)) as unknown as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as unknown as typeof globalThis.cancelAnimationFrame;

  let ticks = 0;
  const loop = new GameLoop(
    () => {
      ticks++;
      if (ticks === 1) throw new Error("synthetic sim throw");
    },
    () => {}
  );
  const t0 = performance.now();
  loop.start();
  ok("starting schedules one frame", queue.length === 1, `queue ${queue.length}`);
  let thrown = "";
  try {
    queue[0](t0 + 100);
  } catch (err) {
    thrown = (err as Error).message;
  }
  ok("the throw still escapes so the on-screen diagnostic can name it", thrown === "synthetic sim throw", thrown);
  ok("the next frame is scheduled before the throwing one runs", queue.length === 2, `queue ${queue.length}`);
  queue[1](t0 + 200);
  ok("the loop is still simulating after the throw", ticks > 1, `ticks ${ticks}`);

  loop.stop();
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = cancel;
}

heading("The player is never absent while alive");
{
  const src = readFileSync("src/render/renderer.ts", "utf8");
  ok("the i-frame blink dims the sprite instead of skipping it", !/if \(blinkOut\) return/.test(src) && src.includes("CONFIG.READABILITY.IFRAME_ALPHA"), "drawPlayer still returns early");
  const a = CONFIG.READABILITY.IFRAME_ALPHA;
  ok("the dim reads as i-frames, not as a solid body", a > 0.1 && a < 0.9, `alpha ${a}`);
  ok("a corpse is still hidden", src.includes("pl.deadTicks > 12"));
}

heading("Artifact feedback events");
{
  const names = (w: World) => w.queue.drain().filter((e) => e.t === "sfx").map((e) => (e as { name: string }).name);

  const shock = sandbox();
  duel(shock);
  shock.artifacts.add("lightning");
  shock.enemies[0].applyStatus("shock", shock);
  const shockEvs = shock.queue.drain();
  ok("shocking an enemy queues the shock sfx", shockEvs.some((e) => e.t === "sfx" && e.name === "shock_hit"));
  ok("shocking an enemy floats the shock label", shockEvs.some((e) => e.t === "artifactText" && e.text === "CHOÁNG"));

  const burn = sandbox();
  const burning = makeEnemy(burn.player.x + 200, burn.player.y);
  burn.enemies.push(burning);
  burn.syncUnits();
  burn.artifacts.add("fire");
  burning.applyStatus("burn", burn);
  burn.queue.drain();
  for (let i = 0; i < 66; i++) burn.tick(intent());
  const burnEvs = burn.queue.drain();
  ok("each burn second queues the burn sfx", burnEvs.some((e) => e.t === "sfx" && e.name === "burn_tick"));
  ok("each burn second floats the burn label", burnEvs.some((e) => e.t === "artifactText" && e.text === "CHÁY"));

  const heavy = sandbox();
  duel(heavy);
  heavy.artifacts.add("heavy");
  const foe = heavy.enemies[0];
  heavy.tick(intent({ attack: true, aimX: foe.x, aimY: foe.y }));
  const hb = CONFIG.ATTACK.COMBOS[0].startup + CONFIG.ATTACK.COMBOS[0].active + CONFIG.ATTACK.COMBOS[0].recovery + CONFIG.FEEL.HIT_STOP_KILL + 4;
  for (let i = 0; i < hb; i++) heavy.tick(intent());
  ok("a non-lethal heavy swing uses the heavy hit sfx", names(heavy).includes("slash_hit_heavy"));

  const repr = sandbox();
  repr.artifacts.add("reprisal");
  repr.player.onHit({ ...jab(repr, 1), side: "enemy" as const }, repr.player.x, repr.player.y, repr);
  const reprEvs = repr.queue.drain();
  ok("taking a hit with reprisal queues the ready sfx", reprEvs.some((e) => e.t === "sfx" && e.name === "reprisal_ready"));
  ok("reprisal floats its label", reprEvs.some((e) => e.t === "artifactText" && e.text === "PHẢN KÍCH"));

  const pur = sandbox();
  duel(pur);
  pur.artifacts.add("pursuit");
  const doomed = pur.enemies[0];
  doomed.onHit(jab(pur, 999), doomed.x, doomed.y, pur);
  ok("a pursuit kill queues the proc sfx", names(pur).includes("pursuit_proc"));

  const tel = sandbox();
  duel(tel, 16);
  let sawTelegraph = false;
  for (let i = 0; i < 60 && !sawTelegraph; i++) {
    tel.tick(intent());
    sawTelegraph = names(tel).includes("telegraph");
  }
  ok("an enemy telegraph plays the audio cue", sawTelegraph);

  const rsrc = readFileSync("src/render/renderer.ts", "utf8");
  ok("the renderer floats artifact text from the event bus", rsrc.includes('e.t === "artifactText"') && rsrc.includes("drawTexts"));
  ok("the renderer draws a shock bolt over stunned enemies", rsrc.includes("en.shockTicks > 0"));
}

heading("Boss phase 3");
{
  const bd = enemyDef("boss");
  ok("phase 3 telegraphs for at least MIN_TELEGRAPH_S", bd.PHASE3_TELEGRAPH_TICKS / CONFIG.TIME.TICK_HZ >= CONFIG.LAWS.MIN_TELEGRAPH_S);
  ok("phase 3 is authored inside the enraged band", bd.PHASE3_FRACTION > 0 && bd.PHASE3_FRACTION < bd.ENRAGE_FRACTION);

  const w = sandbox();
  const boss = makeEnemy(w.player.x + 40, w.player.y, "boss");
  withEnemy(w, boss);
  boss.hp = Math.ceil(boss.maxHp * 0.4);
  ok("40% hp is phase 2", boss.bossPhase() === 2, `phase ${boss.bossPhase()}`);
  boss.hp = Math.floor(boss.maxHp * 0.2);
  ok("20% hp is phase 3", boss.bossPhase() === 3, `phase ${boss.bossPhase()}`);

  let guard = 0;
  while (boss.state !== ENEMY_STATE.TELEGRAPH && guard++ < 400) w.tick(intent());
  const smallsBefore = w.enemies.filter((e) => e.kind === "small" && !e.dead).length;
  let rings = 1;
  let last = boss.state;
  guard = 0;
  while (boss.state !== ENEMY_STATE.IDLE && guard++ < 400) {
    w.tick(intent());
    if (boss.state === ENEMY_STATE.TELEGRAPH && last !== ENEMY_STATE.TELEGRAPH) rings++;
    last = boss.state;
  }
  const smallsAfter = w.enemies.filter((e) => e.kind === "small" && !e.dead).length;
  ok("phase 3 commits three rings before resting", rings >= 3, `rings ${rings}`);
  ok("phase 3 summons smalls during the commit", smallsAfter > smallsBefore, `smalls ${smallsAfter}`);
}

heading("Priority 4 — ranged & teleporter");
{
  const T = CONFIG.WORLD.TILE;

  // ranged: telegraph then a projectile aimed at the player
  const w = sandbox();
  const r = makeEnemy(w.player.x + 80, w.player.y, "ranged");
  withEnemy(w, r);
  let guard = 0;
  while (w.projectiles.length === 0 && guard++ < 200) w.tick(intent());
  ok("a ranged enemy telegraphs then fires a projectile", w.projectiles.length === 1 && guard < 200, `guard ${guard}`);
  ok("the shot flies toward the player", (w.projectiles[0]?.vx ?? 0) < 0, `vx ${w.projectiles[0]?.vx}`);
  const hpBefore = w.player.hp;
  let hitGuard = 0;
  while (w.player.hp === hpBefore && w.projectiles.length > 0 && hitGuard++ < 120) w.tick(intent());
  ok("a ranged shot eventually damages the player", w.player.hp < hpBefore, `hp ${hpBefore}->${w.player.hp}`);

  // projectile respects i-frames: no damage, and it passes through (kept)
  const wi = sandbox();
  const hpI = wi.player.hp;
  wi.player.iframeTicks = 20;
  wi.projectiles = [{ x: wi.player.x, y: wi.player.y - 3, vx: 0, vy: 0, dmg: 1, ticksLeft: 40, owner: "enemy" }];
  wi.tick(intent());
  ok("a shot during i-frames deals no damage", wi.player.hp === hpI, `hp ${hpI}->${wi.player.hp}`);
  ok("a shot during i-frames passes through, not consumed", wi.projectiles.length === 1, `left ${wi.projectiles.length}`);

  // projectile hits when the player is hittable
  const wh = sandbox();
  const hpH = wh.player.hp;
  wh.projectiles = [{ x: wh.player.x, y: wh.player.y - 3, vx: 0, vy: 0, dmg: 1, ticksLeft: 40, owner: "enemy" }];
  wh.tick(intent());
  ok("a shot that overlaps a hittable player lands", wh.player.hp < hpH && wh.projectiles.length === 0, `hp ${wh.player.hp}`);

  // projectile is blocked by a wall
  const wwall = sandbox();
  wwall.projectiles = [{ x: T + 1, y: 2 * T + 8, vx: -400, vy: 0, dmg: 1, ticksLeft: 400, owner: "enemy" }];
  let wguard = 0;
  while (wwall.projectiles.length > 0 && wguard++ < 20) wwall.tick(intent());
  ok("a projectile is blocked by a wall before it expires", wwall.projectiles.length === 0 && wguard < 6, `ticks ${wguard}`);

  // projectile expires on its own when it never overlaps
  const wexp = sandbox();
  const hpE = wexp.player.hp;
  wexp.projectiles = [{ x: wexp.player.x, y: wexp.player.y - 100, vx: 0, vy: -150, dmg: 1, ticksLeft: 5, owner: "enemy" }];
  let eguard = 0;
  while (wexp.projectiles.length > 0 && eguard++ < 40) wexp.tick(intent());
  ok("a stray projectile expires and never hurts the player", wexp.projectiles.length === 0 && wexp.player.hp === hpE, `ticks ${eguard}`);

  // teleporter: enters VANISH and cannot be hit while vanished
  const wt = sandbox();
  const tp = makeEnemy(wt.player.x + 12, wt.player.y, "teleporter");
  withEnemy(wt, tp);
  let vg = 0;
  while (tp.state !== ENEMY_STATE.VANISH && vg++ < 120) wt.tick(intent());
  ok("a teleporter in range enters VANISH", tp.state === ENEMY_STATE.VANISH, `state ${tp.state}`);
  ok("a vanished teleporter cannot be hit", !tp.canBeHit());
  wt.tick(intent());
  ok("vanishing lifts the body off its shadow", tp.z > 0 && tp.z <= 6, `z ${tp.z.toFixed(2)}`);

  // teleporter cycle: VANISH -> APPEAR -> TELEGRAPH -> ATTACK, materialising at or behind the player
  let sawAppear = false;
  let sawTelegraph = false;
  let dot = 999;
  let apd = NaN;
  let cg = 0;
  while (!(sawTelegraph && tp.state === ENEMY_STATE.ATTACK) && cg++ < 200) {
    wt.tick(intent());
    if (tp.state === ENEMY_STATE.APPEAR && !sawAppear) {
      sawAppear = true;
      const fx = Math.cos(wt.player.facing);
      const fy = Math.sin(wt.player.facing);
      dot = (tp.x - wt.player.x) * fx + (tp.y - wt.player.y) * fy;
      apd = Math.hypot(tp.x - wt.player.x, tp.y - wt.player.y);
    }
    if (sawAppear && tp.state === ENEMY_STATE.TELEGRAPH) sawTelegraph = true;
  }
  ok("a vanished teleporter reappears (APPEAR)", sawAppear, `cg ${cg}`);
  ok("it reappears at its materialise distance", Math.abs(apd - enemyDef("teleporter").APPEAR_DIST) < 0.5, `dist ${apd}`);
  ok("it never reappears in front of the player", dot <= 0.001, `dot ${dot.toFixed(2)}`);
  ok("after reappearing it telegraphs an attack", sawTelegraph, `state ${tp.state}`);
  ok("the body lands after materialising", tp.z === 0, `z ${tp.z}`);

  // determinism: identical seeds fire the shot on the same tick
  const d1 = sandbox();
  withEnemy(d1, makeEnemy(d1.player.x + 80, d1.player.y, "ranged"));
  const d2 = sandbox();
  withEnemy(d2, makeEnemy(d2.player.x + 80, d2.player.y, "ranged"));
  let g1 = 0;
  while (d1.projectiles.length === 0 && g1++ < 200) d1.tick(intent());
  let g2 = 0;
  while (d2.projectiles.length === 0 && g2++ < 200) d2.tick(intent());
  ok("the ranged shot is deterministic", g1 === g2 && Math.abs(d1.projectiles[0].vx - d2.projectiles[0].vx) < 1e-6, `g1 ${g1} g2 ${g2}`);
}

heading("Characters (H2 build choice)");
{
  const w = new World(CONFIG.SEED);
  ok("a fresh world asks for a build", w.characterChoices.length === 3);
  ok("picking banks its health and closes the choice", w.pickCharacter("tank") && w.player.maxHp === CHARACTERS.tank.baseHp && w.characterChoices.length === 0);
  ok("a character outside the open choice cannot be picked", w.pickCharacter("mage") === false);

  w.player.character = "swordsman";
  const base = playerSwingInit(w, 1, 0).dmg;
  for (let i = 0; i < COMBO_HITS; i++) w.player.registerHit();
  ok("five landed hits inside the window make the next swing 1.5x", Math.abs(playerSwingInit(w, 1, 0).dmg - base * 1.5) < 1e-9);
  ok("the bonus is spent on that one swing", Math.abs(playerSwingInit(w, 1, 0).dmg - base) < 1e-9);
}
{
  const m = sandbox();
  const foe = makeEnemy(m.player.x + 12, m.player.y, "chaser");
  withEnemy(m, foe);
  const melee = createSwing(m, { side: "player", combo: 1, dir: 0, ox: m.player.x, oy: m.player.y, reach: CONFIG.ATTACK.REACH, deg: 90, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  hitFeedback(m, foe, melee, foe.x, foe.y, false, false);
  ok("a landed swing is what feeds the combo counter", m.player.comboHits === 1);
  const dot = createSwing(m, { side: "player", combo: 1, dir: 0, ox: foe.x, oy: foe.y, reach: 0, deg: 0, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  hitFeedback(m, foe, dot, foe.x, foe.y, false, false);
  ok("status damage does not feed it", m.player.comboHits === 1);
}
{
  const m = sandbox();
  const foe = makeEnemy(m.player.x + 12, m.player.y, "chaser");
  withEnemy(m, foe);
  const melee = createSwing(m, { side: "player", combo: 1, dir: 0, ox: m.player.x, oy: m.player.y, reach: CONFIG.ATTACK.REACH, deg: 90, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  hitFeedback(m, foe, melee, foe.x, foe.y, false, false);
  ok("every landed hit paints the floor", m.decals.length === 1 && m.decals[0].kind === "blood" && m.decals[0].spots.length === 4);
  const kill = createSwing(m, { side: "player", combo: 1, dir: 0, ox: m.player.x, oy: m.player.y, reach: CONFIG.ATTACK.REACH, deg: 90, dmg: 99, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  const before = m.decals.length;
  hitFeedback(m, foe, kill, foe.x, foe.y, true, false);
  ok("a kill splashes a bigger decal and fires the impact punch", m.decals.length === before + 1 && m.decals[before].spots.length === 7 && m.queue.size > 0);
  const swarmed = createSwing(m, { side: "player", combo: 1, dir: 0, ox: m.player.x, oy: m.player.y, reach: CONFIG.ATTACK.REACH, deg: 90, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  for (let i = 0; i < 300; i++) hitFeedback(m, foe, swarmed, foe.x + (i % 7), foe.y, false, false);
  ok("decals stay capped for the whole room", m.decals.length === CONFIG.FEEL.DECAL_CAP);
}
{
  const g = sandbox();
  g.pickCharacter("mage");
  g.pickWeapon("katana");
  g.introTicks = 0;
  g.player.reset(g.room.start.x, g.room.start.y);
  const foe = makeEnemy(g.player.x + 24, g.player.y, "chaser");
  withEnemy(g, foe);
  g.tick(intent({ skill: true }));
  ok("the fireball is a player-owned shot", g.projectiles.length === 1 && g.projectiles[0]?.owner === "player");
  ok("casting locks the skill behind its cooldown", g.player.skillCd === CHARACTERS.mage.skillCd);
  g.tick(intent({ skill: true }));
  ok("a press on cooldown fires nothing", g.projectiles.length === 1);
  let guard = 0;
  while (g.projectiles.length > 0 && guard++ < 40) g.tick(intent());
  ok("the fireball damages and lights its target", foe.hp < foe.maxHp && foe.burnTicks > 0 && g.projectiles.length === 0, `hp ${foe.hp} burn ${foe.burnTicks}`);

  const plain = makeEnemy(g.player.x + 60, g.player.y, "chaser");
  const lit = makeEnemy(g.player.x + 60, g.player.y + 20, "chaser");
  g.enemies = [plain, lit];
  g.syncUnits();
  lit.applyStatus("burn", g);
  const bolt = createSwing(g, { side: "player", combo: 1, dir: 0, ox: g.player.x, oy: g.player.y, reach: 8, deg: 90, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  plain.onHit(bolt, plain.x, plain.y, g);
  const bolt2 = createSwing(g, { side: "player", combo: 1, dir: 0, ox: g.player.x, oy: g.player.y, reach: 8, deg: 90, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  lit.onHit(bolt2, lit.x, lit.y, g);
  ok("resonance: a statused enemy takes 30% more", plain.maxHp - plain.hp < lit.maxHp - lit.hp, `${plain.maxHp - plain.hp} vs ${lit.maxHp - lit.hp}`);
}

heading("Mage normal attack: ranged arcane volley");
{
  // the mage's attack spawns a bolt instead of a melee arc
  const m = sandbox();
  m.pickCharacter("mage");
  m.pickWeapon("katana");
  m.introTicks = 0;
  m.player.reset(m.room.start.x, m.room.start.y);
  const foe = makeEnemy(m.player.x + 24, m.player.y, "chaser");
  withEnemy(m, foe);
  const hp0 = foe.hp;
  let guard = 0;
  while (m.projectiles.length === 0 && guard++ < 30) m.tick(intent({ attack: true }));
  ok("the mage's attack fires a bolt instead of swinging", m.projectiles.some(p => p.owner === "player" && p.kind === "bolt"), `ticks ${guard}`);
  ok("no melee damage lands at the swing origin", foe.hp === hp0, `hp ${foe.hp} vs ${hp0}`);
  guard = 0;
  while (foe.hp === hp0 && m.projectiles.length > 0 && guard++ < 40) m.tick(intent());
  ok("the bolt damages its target downrange", foe.hp < hp0, `hp ${foe.hp}`);

  // the other two builds keep swinging melee and never spawn a bolt
  for (const who of ["swordsman", "tank"] as const) {
    const p = sandbox();
    p.pickCharacter(who);
    p.pickWeapon("katana");
    p.introTicks = 0;
    p.player.reset(p.room.start.x, p.room.start.y);
    const near = makeEnemy(p.player.x + 16, p.player.y, "chaser");
    withEnemy(p, near);
    const nhp = near.hp;
    for (let i = 0; i < 30; i++) p.tick(intent({ attack: true }));
    ok(`${who} keeps a melee swing, no bolt`, p.projectiles.filter(pr => pr.kind === "bolt").length === 0 && near.hp < nhp);
  }

  // the equipped weapon's arc shapes the volley size
  const volleyOf = (weapon: WeaponId): number => {
    const w = sandbox();
    w.pickCharacter("mage");
    w.pickWeapon(weapon);
    w.introTicks = 0;
    w.player.reset(w.room.start.x, w.room.start.y);
    let g = 0;
    while (w.projectiles.length === 0 && g++ < 40) w.tick(intent({ attack: true }));
    return w.projectiles.filter(pr => pr.kind === "bolt").length;
  };
  const gsBolts = volleyOf("greatsword");
  const spBolts = volleyOf("spear");
  ok("a wide weapon fires a bigger volley than a narrow one", gsBolts > spBolts, `greatsword ${gsBolts} vs spear ${spBolts}`);
}
{
  const t = sandbox();
  t.pickCharacter("tank");
  t.pickWeapon("katana");
  t.introTicks = 0;
  t.player.reset(t.room.start.x, t.room.start.y);
  t.player.skillActiveTicks = 30;
  const foe = makeEnemy(t.player.x + 10, t.player.y, "chaser");
  withEnemy(t, foe);
  const foeHp = foe.hp;
  const swing = createSwing(t, { side: "enemy", combo: 1, dir: Math.PI, ox: foe.x, oy: foe.y, reach: 20, deg: 90, dmg: 1, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  t.player.onHit(swing, t.player.x, t.player.y, t);
  ok("the shield nulls the hit", t.player.hp === t.player.maxHp);
  ok("the shield reflects 2 damage", foeHp - foe.hp === 2, `${foeHp}->${foe.hp}`);

  t.player.skillActiveTicks = 0;
  t.player.hp = 6;
  t.player.killsSinceHeal = 9;
  const last = makeEnemy(t.player.x + 10, t.player.y, "chaser");
  last.hp = 1;
  withEnemy(t, last);
  const kill = createSwing(t, { side: "player", combo: 1, dir: 0, ox: t.player.x, oy: t.player.y, reach: 8, deg: 90, dmg: 2, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });
  last.onHit(kill, last.x, last.y, t);
  ok("every tenth kill knits the tank back 1 HP", t.player.hp === 7 && t.player.killsSinceHeal === 0, `hp ${t.player.hp}`);
}
{
  const saved = emptyAchievements();
  saved.charactersWon.add("mage");
  ok("the roster of beaten characters survives storage", parseAchievements(stringifyAchievements(saved)).charactersWon.has("mage"));
  ok("an older save without the roster still parses", parseAchievements('{"earned":[],"best":null,"totalGold":5}').charactersWon.size === 0);
}
{
  const m = sandbox();
  m.pickCharacter("mage");
  m.pickWeapon("katana");
  m.player.comboBonus = true;
  ok("mage cannot consume combo bonus", !m.player.consumeCombo());
  const t = sandbox();
  t.pickCharacter("tank");
  t.pickWeapon("katana");
  t.player.comboBonus = true;
  ok("tank cannot consume combo bonus", !t.player.consumeCombo());
  const s = sandbox();
  s.pickCharacter("swordsman");
  s.pickWeapon("katana");
  s.player.comboBonus = true;
  ok("swordsman can consume combo bonus", s.player.consumeCombo());

  const w1 = sandbox();
  w1.pickCharacter("swordsman");
  w1.pickWeapon("katana");
  w1.introTicks = 1;
  w1.tick(intent());
  const w2 = sandbox();
  w2.pickCharacter("mage");
  w2.pickWeapon("katana");
  w2.introTicks = 1;
  w2.tick(intent());
  const w3 = sandbox();
  w3.pickCharacter("tank");
  w3.pickWeapon("katana");
  w3.introTicks = 1;
  w3.tick(intent());
  ok("each character has a distinct intro line", w1.introLine.length > 0 && w1.introLine !== w2.introLine && w2.introLine !== w3.introLine);
}
{
  heading("Weapon System Laws");
  ok("all 5 weapons defined", WEAPON_LIST.length === 5);
  ok("greatsword does 2 dmg and 200 deg arc", WEAPONS.greatsword.combos[0]?.dmg === 2 && WEAPONS.greatsword.combos[0]?.deg === 200);
  ok("dagger has 3 combos and 30% crit chance", WEAPONS.dagger.combos.length === 3 && WEAPONS.dagger.critChance === 0.3);
  ok("spear has 40px reach and narrow 40 deg arc", WEAPONS.spear.combos[0]?.reach === 40 && WEAPONS.spear.combos[0]?.deg === 40);
  ok("whip has 2 combos sweeping up to 180 deg", WEAPONS.whip.combos.length === 2 && WEAPONS.whip.combos[1]?.deg === 180);
  ok("katana baseline remains 2-hit combo with chainWindow 6", WEAPONS.katana.combos.length === 2 && WEAPONS.katana.chainWindow === 6);

  const saved = emptyAchievements();
  saved.weaponsWon.add("dagger");
  saved.weaponsWon.add("greatsword");
  const parsed = parseAchievements(stringifyAchievements(saved));
  ok("weaponsWon persists across serialization", parsed.weaponsWon.has("dagger") && parsed.weaponsWon.has("greatsword"));
}

heading("Biomes and Ascension");
{
  const expectedBiomes = ["dungeon", "dungeon", "dungeon", "caverns", "caverns", "caverns", "forge", "forge", "forge", "void", "void", "void"];
  const rangesMatch = expectedBiomes.every((id, room) => biomeForRoom(room).id === id);
  ok("the twelve room indices map to the four requested biomes", rangesMatch);

  const world = new World(CONFIG.SEED, emptyAchievements());
  let poolsMatch = true;
  for (let roomIndex = 0; roomIndex < world.roomTotal; roomIndex++) {
    world.loadRoom(roomIndex, false);
    const pool = biomeForRoom(roomIndex).enemyPool;
    if (world.currentBiome.id !== biomeForRoom(roomIndex).id || world.enemies.some((enemy) => !isScripted(enemy.kind) && !pool.includes(enemy.kind))) poolsMatch = false;
  }
  ok("normal enemies use biome pools while scripted bosses remain", poolsMatch);

  const levelFive = new World(CONFIG.SEED, { ...emptyAchievements(), ascensionMax: 5 });
  const baseline = new World(CONFIG.SEED, emptyAchievements());
  ok("Ascension V adds two enemies to the opening wave", levelFive.enemies.length === baseline.enemies.length + 2);
  ok("Ascension level selection stays within the unlocked maximum", levelFive.ascensionLevel === 5 && !levelFive.setAscensionLevel(6) && levelFive.setAscensionLevel(3));

  const config = { ...CONFIG, ASCENSION: { ...CONFIG.ASCENSION } };
  applyAscension(config, 8);
  ok("Ascension VIII enables every cumulative modifier", config.ASCENSION.enemyHpMultiplier === 1.2 && config.ASCENSION.enemySpeedMultiplier === 1.1 && config.ASCENSION.playerHealMultiplier === 0.5 && config.ASCENSION.bossExtraPhase && config.ASCENSION.extraEnemiesPerWave === 2 && config.ASCENSION.trapDamageMultiplier === 2 && config.ASCENSION.artifactChoices === 2 && config.ASCENSION.shopPriceMultiplier === 1.5);
  applyAscension(config, 0);
  ok("Ascension 0 restores the base modifiers", config.ASCENSION.enemyHpMultiplier === 1 && config.ASCENSION.enemySpeedMultiplier === 1 && config.ASCENSION.playerHealMultiplier === 1 && !config.ASCENSION.bossExtraPhase && config.ASCENSION.extraEnemiesPerWave === 0 && config.ASCENSION.trapDamageMultiplier === 1 && config.ASCENSION.artifactChoices === 3 && config.ASCENSION.shopPriceMultiplier === 1);

  const saved = emptyAchievements();
  saved.ascensionMax = 8;
  ok("Ascension unlock progress survives save serialization", parseAchievements(stringifyAchievements(saved)).ascensionMax === 8);
  ok("legacy saves start with Ascension 0 unlocked", parseAchievements('{"earned":[],"best":null,"totalGold":5}').ascensionMax === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;

