import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../src/config.ts";
import { World } from "../src/world/world.ts";
import { Room } from "../src/world/rooms.ts";
import { createSwing, hitboxOf, playerSwingInit, resolveHits } from "../src/systems/combat.ts";
import { makeEnemy, ENEMY_STATE } from "../src/entities/enemy.ts";
import { IntentSource } from "../src/input/intent.ts";
import { ParticlePool } from "../src/systems/particles.ts";
import { ARTIFACT_UNLOCKS } from "../src/systems/artifacts.ts";
import type { Achievements, AchievementId } from "../src/systems/unlocks.ts";
import type { Intent } from "../src/sim/types.ts";

const idle: Intent = { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false };
function sandbox() {
  const w = new World();
  w.clearEnemies();
  w.player.reset(160, 100);
  w.queue.drain();
  return w;
}

/** every artifact's gating achievement earned, so offer-size tests ignore the unlock filter */
function allUnlocks(): Achievements {
  const earned = new Set<AchievementId>();
  for (const gate of Object.values(ARTIFACT_UNLOCKS)) if (gate !== null) earned.add(gate);
  return { earned, best: null };
}

function hits(w: World): void {
  w.grid.clear();
  for (const u of w.units) w.grid.insert(u);
  resolveHits(w, w.grid);
}

test("broad phase preserves arc-edge hits for both combos in every direction", () => {
  for (const combo of [1, 2]) for (let dir = 0; dir < 360; dir += 15) {
    const w = sandbox();
    const sw = createSwing(w, playerSwingInit(w, combo, dir * Math.PI / 180));
    sw.phase = "active";
    w.player.swing = sw;
    const box = hitboxOf(sw)!;
    for (const edge of [-1, 1]) {
      const angle = sw.dir + edge * (sw.deg / 2 - 0.01) * Math.PI / 180;
      const x = sw.ox + Math.cos(angle) * sw.reach * 1.149;
      const y = sw.oy + Math.sin(angle) * sw.reach * 1.149;
      assert.ok(x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
      const e = makeEnemy(x, y);
      const hb = e.hurtRect();
      e.y += y - (hb.y + hb.h / 2);
      w.enemies = [e];
      w.syncUnits();
      const hp = e.hp;
      hits(w);
      assert.equal(e.hp, hp - sw.dmg);
    }
  }
});

test("attacking preserves normal movement in every swing phase and leaves dash unchanged", () => {
  for (const initialSpeed of [0, CONFIG.PLAYER.SPEED, CONFIG.DASH.SPEED]) {
    for (const move of [{ moveX: 0, moveY: 0 }, { moveX: 1, moveY: 0 }, { moveX: 1, moveY: 1 }, { moveX: -1, moveY: 0 }]) {
      const w = sandbox();
      const running = sandbox();
      w.player.vx = running.player.vx = initialSpeed;
      const input = { ...idle, ...move };
      w.player.tick({ ...input, attack: true }, w);
      running.player.tick(input, running);
      const phases = new Set<string>();
      while (w.player.swing !== null) {
        phases.add(w.player.swing.phase);
        assert.deepEqual(
          [w.player.x, w.player.y, w.player.vx, w.player.vy],
          [running.player.x, running.player.y, running.player.vx, running.player.vy],
          `initialSpeed=${initialSpeed} phase=${w.player.swing.phase}`
        );
        w.player.tick(input, w);
        running.player.tick(input, running);
      }
      assert.deepEqual([...phases], ["startup", "active", "recover"]);
    }
  }
  const w = sandbox();
  w.player.tick({ ...idle, attack: true }, w);
  w.player.tick({ ...idle, dash: true, moveX: 1 }, w);
  assert.equal(Math.hypot(w.player.vx, w.player.vy), CONFIG.DASH.SPEED);
});

test("startup press survives until the original recovery chain window", () => {
  const w = sandbox();
  const source = new IntentSource();
  source.pressAttack(0);
  w.player.tick(source.read(0), w);
  source.pressAttack(1);
  for (let tick = 1; tick <= 8; tick++) {
    w.player.tick(source.read(tick), w);
    assert.equal(w.player.combo, tick < 8 ? 1 : 2);
  }
  for (let tick = 9; tick < 40; tick++) w.player.tick(source.read(tick), w);
  assert.equal(w.player.swing, null);
});

test("buffer expires and cannot leak across dash, hurt, or reset", () => {
  for (const cancel of ["expire", "dash", "hurt", "reset"]) {
    const w = sandbox();
    w.player.tick({ ...idle, attack: true }, w);
    w.player.swing!.ticksLeft = CONFIG.INPUT.PRESS_BUFFER_TICKS + 3;
    w.player.tick({ ...idle, attack: true }, w);
    if (cancel === "dash") w.player.tick({ ...idle, dash: true }, w);
    if (cancel === "hurt") w.player.onHit(createSwing(w, playerSwingInit(w, 1, 0)), 160, 100, w);
    if (cancel === "reset") w.player.reset(160, 100);
    for (let i = 0; i < 40; i++) w.player.tick(idle, w);
    assert.equal(w.player.swing, null);
    assert.equal(w.player.combo, 0);
  }
});

test("available dash wins over attack without emitting a slash", () => {
  for (const chaining of [false, true]) {
    const w = sandbox();
    if (chaining) {
      w.player.tick({ ...idle, attack: true }, w);
      w.player.swing!.phase = "recover";
      w.player.swing!.ticksLeft = 2;
      w.queue.drain();
    }
    w.player.tick({ ...idle, attack: true, dash: true }, w);
    assert.equal(w.player.state, "dash");
    assert.equal(w.player.swing, null);
    assert.ok(!w.queue.drain().some(e => e.t === "slashArc" || e.t === "sfx" && e.name === "slash_air"));
  }
  const w = sandbox();
  w.player.dashCd = 10;
  w.player.tick({ ...idle, attack: true, dash: true }, w);
  assert.equal(w.player.combo, 1);
});

test("particle count follows expiry, eviction, rejected emits and reset", () => {
  const p = new ParticlePool(4);
  for (let i = 0; i < 6; i++) p.emit("blood", 0, 0, 0, 0, "#fff", { life: 1 });
  assert.equal(p.alive, 4);
  assert.equal(p.emit("dust", 0, 0, 0, 0, "#fff"), false);
  assert.equal(p.alive, 4);
  p.update(1);
  assert.equal(p.alive, 0);
  p.emit("spark", 0, 0, 0, 0, "#fff");
  assert.equal(p.alive, 1);
  p.reset();
  assert.equal(p.alive, 0);
  p.update(1);
  assert.equal(p.alive, 0);
});

test("boss damage matches the telegraph center and rim in every direction", () => {
  for (const enraged of [false, true]) for (const offset of [-0.1, 0.1, 5, 10]) {
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const w = sandbox();
      const boss = makeEnemy(160, 100, "boss");
      boss.enraged = enraged;
      w.enemies = [boss];
      w.syncUnits();
      const cx = boss.x;
      const cy = boss.y - boss.def.BODY_H / 2;
      const radius = boss.def.ATTACK_REACH;
      boss.state = ENEMY_STATE.TELEGRAPH;
      boss.telegraphTicksLeft = 1;
      boss.tick(w, w.grid);
      boss.tick(w, w.grid);
      const angle = degrees * Math.PI / 180;
      w.player.reset(cx + Math.cos(angle) * (radius + offset), cy + Math.sin(angle) * (radius + offset) + CONFIG.PLAYER.HURT_H / 2);
      const hp = w.player.hp;
      hits(w);
      assert.equal(w.player.hp, hp - (offset < 0 ? boss.def.DMG : 0), `angle=${degrees} offset=${offset} enraged=${enraged}`);
      assert.deepEqual(hitboxOf(boss.swing!), { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 });
    }
  }
});

test("being hit clears combo immediately", () => {
  const w = sandbox();
  w.player.combo = 2;
  w.player.onHit(createSwing(w, playerSwingInit(w, 1, 0)), 160, 100, w);
  assert.equal(w.player.combo, 0);
});

test("artifacts gate doors, pause combat and cannot be farmed", () => {
  const w = new World(CONFIG.SEED, allUnlocks());
  w.clearEnemies();
  w.player.reset(160, 100);
  w.queue.drain();
  w.tick(idle);
  assert.equal(w.room.doorOpen, false);
  assert.equal(w.artifactChoices.length, 3);
  assert.equal(new Set(w.artifactChoices.map(b => b.id)).size, 3);
  const offered = w.artifactChoices.map(b => b.id);
  const tick = w.tickCount;
  w.tick({ ...idle, attack: true, moveX: 1 });
  assert.equal(w.tickCount, tick);
  assert.equal(w.player.swing, null);
  assert.equal(w.chooseArtifact("invalid" as never), false);
  assert.equal(w.chooseArtifact(offered[0]), true);
  assert.equal(w.chooseArtifact(offered[0]), false);
  assert.equal(w.room.doorOpen, true);
  // a rewarded room cannot be farmed a second time
  w.clearEnemies();
  w.tick(idle);
  assert.equal(w.artifactChoices.length, 0);
  assert.equal(w.room.doorOpen, true);
  // every later room offers a fresh choice the player does not already own
  for (let room = 1; room < w.roomTotal; room++) {
    w.loadRoom(room);
    w.clearEnemies();
    w.tick(idle);
    assert.equal(w.artifactChoices.length, 3);
    assert.ok(w.artifactChoices.every(b => !w.artifacts.has(b.id)));
    w.chooseArtifact(w.artifactChoices[0].id);
  }
});

test("a fresh save only offers the two unlocked artifacts, then gating opens more", () => {
  const fresh = new World(CONFIG.SEED, { earned: new Set<AchievementId>(), best: null });
  fresh.clearEnemies();
  fresh.player.reset(160, 100);
  fresh.tick(idle);
  const offered = fresh.artifactChoices.map(b => b.id);
  assert.ok(offered.length > 0);
  assert.ok(offered.every(id => ARTIFACT_UNLOCKS[id] === null));
  assert.ok(!offered.includes("lightning"));

  const withFirstBlood = new World(CONFIG.SEED, { earned: new Set<AchievementId>(["first_blood"]), best: null });
  withFirstBlood.clearEnemies();
  withFirstBlood.player.reset(160, 100);
  withFirstBlood.tick(idle);
  assert.ok(withFirstBlood.artifactChoices.some(b => b.id === "lightning"));
});

test("a first kill marks the achievement earned and queues one toast event", () => {
  const w = sandbox();
  const e = makeEnemy(w.player.x + 20, w.player.y);
  e.hp = 1;
  w.enemies = [e];
  w.syncUnits();
  e.onHit(createSwing(w, playerSwingInit(w, 1, 0)), e.x, e.y, w);
  assert.equal(w.runStats.enemiesKilled, 1);
  assert.equal(w.achievements.earned.has("first_blood"), false);
  w.tick(idle);
  assert.ok(w.achievements.earned.has("first_blood"));
  const queued = w.queue.drain().filter(ev => ev.t === "achievement");
  assert.deepEqual(queued.map(ev => ev.id), ["first_blood"]);
  assert.deepEqual(w.runAchievements, ["first_blood"]);
});

test("dying freezes the run, ends it after END_DELAY, then restart resets it", () => {
  const w = sandbox();
  w.artifacts.add("water");
  w.runStats.enemiesKilled = 4;
  w.player.die(w);
  for (let i = 0; i < CONFIG.ROOMS.END_DELAY - 1; i++) w.tick(idle);
  assert.equal(w.pendingEnd, null);
  w.tick(idle);
  assert.equal(w.pendingEnd, "dead");
  const tickAtEnd = w.tickCount;
  for (let i = 0; i < 10; i++) w.tick(idle);
  assert.equal(w.tickCount, tickAtEnd);
  assert.ok(w.artifacts.has("water"));
  assert.equal(w.runStats.enemiesKilled, 4);
  w.restart();
  assert.equal(w.pendingEnd, null);
  assert.equal(w.roomIndex, 0);
  assert.equal(w.artifacts.size, 0);
  assert.equal(w.runStats.enemiesKilled, 0);
});

test("clearing the last room ends the run with victory", () => {
  const w = sandbox();
  w.loadRoom(w.roomTotal - 1);
  w.clearEnemies();
  w.tick(idle);
  w.chooseArtifact(w.artifactChoices[0].id);
  w.runStats.roomsCleared = w.roomTotal - 1;
  w.player.x = (w.room.w - 0.5) * 16;
  w.player.y = Math.floor(w.room.h / 2) * 16;
  w.tick(idle);
  assert.equal(w.pendingEnd, "won");
  assert.equal(w.victory, true);
  assert.equal(w.roomIndex, w.roomTotal - 1);
  assert.ok(w.artifacts.size > 0);
  assert.match(w.bannerText, /Thắng/);

  w.continueAfterWin();
  assert.equal(w.pendingEnd, null);
  assert.equal(w.roomIndex, 0);
  assert.equal(w.victory, false);
  assert.ok(w.artifacts.size > 0);
  assert.equal(w.runStats.roomsCleared, 0);

  const w2 = sandbox();
  w2.pendingEnd = "won";
  w2.artifacts.add("fire");
  w2.restart();
  assert.equal(w2.pendingEnd, null);
  assert.equal(w2.roomIndex, 0);
  assert.equal(w2.artifacts.size, 0);
});

test("artifact melee modifiers apply once without changing the base config", () => {
  const w = sandbox();
  w.artifacts.add("heavy");
  w.artifacts.add("pursuit");
  const enemy = makeEnemy(175, 103);
  enemy.hp = 1.5;
  w.enemies = [enemy];
  w.syncUnits();
  w.player.dashCd = 40;
  w.player.swing = createSwing(w, playerSwingInit(w, 1, 0));
  w.player.swing.phase = "active";
  hits(w);
  assert.equal(enemy.hp, 0);
  assert.equal(w.player.dashCd, 22);
  assert.equal(w.hitStopTicks, CONFIG.FEEL.HIT_STOP_KILL * 2);
  assert.equal(playerSwingInit(sandbox(), 1, 0).dmg, 1);
  w.artifacts.add("desperate");
  for (const hp of [2, 3]) {
    w.player.reset(160, 100);
    w.player.hp = hp;
    w.player.vx = 200;
    w.player.tick({ ...idle, moveX: 1 }, w);
    assert.equal(w.player.vx, hp === 2 ? 124.8 : 104);
  }
  w.artifacts.add("impulse");
  w.player.reset(160, 100);
  w.player.tick({ ...idle, dash: true }, w);
  for (let i = 0; i < 7; i++) w.player.tick(idle, w);
  w.player.tick({ ...idle, attack: true }, w);
  assert.equal(w.player.swing!.knockback, 190);
  for (let i = 0; i < 20; i++) w.player.tick(idle, w);
  w.player.tick({ ...idle, attack: true }, w);
  assert.equal(w.player.swing!.knockback, 95);
});

test("reprisal empowers only the next slash after surviving a hit, with a two-second limit", () => {
  for (const wait of [12, 121]) {
    const w = sandbox();
    w.artifacts.add("reprisal");
    w.player.onHit(createSwing(w, playerSwingInit(w, 1, 0)), 160, 100, w);
    for (let i = 0; i < wait; i++) w.player.tick(idle, w);
    w.player.tick({ ...idle, attack: true }, w);
    assert.equal(w.player.swing!.dmg, wait === 12 ? 2 : 1);
    for (let i = 0; i < 20; i++) w.player.tick(idle, w);
    w.player.tick({ ...idle, attack: true }, w);
    assert.equal(w.player.swing!.dmg, 1);
  }
});

test("aftershock triggers once per second slash with a strict 40px radius", () => {
  const w = sandbox();
  w.artifacts.add("aftershock");
  const enemies = [makeEnemy(175, 103), makeEnemy(214.9, 103), makeEnemy(215.1, 103)];
  for (const e of enemies) e.hp = 10;
  w.enemies = enemies;
  w.syncUnits();
  w.player.swing = createSwing(w, playerSwingInit(w, 2, 0));
  w.player.swing.phase = "active";
  hits(w);
  hits(w);
  assert.deepEqual(enemies.map(e => e.hp), [8, 9, 10]);
});

test("fire trail damages once per dash and expires, including respawn cleanup", () => {
  const w = sandbox();
  w.artifacts.add("fire");
  const e = makeEnemy(160, 103);
  e.hp = 10;
  e.restTicks = 1000;
  w.enemies = [e];
  w.syncUnits();
  w.tick({ ...idle, dash: true, moveX: 1 });
  assert.equal(e.hp, 9);
  for (let i = 0; i < 8; i++) w.tick(idle);
  assert.equal(e.hp, 9);
  assert.ok(w.fireTrails.length > 0);
  for (let i = 0; i < 70; i++) w.tick(idle);
  assert.equal(w.fireTrails.length, 0);
  w.player.dashCd = 0;
  w.tick({ ...idle, dash: true });
  w.loadRoom(0);
  assert.equal(w.fireTrails.length, 0);
  assert.ok(w.artifacts.has("fire"));
});

test("status artifacts apply wet then extended shock without refreshing an active stun", () => {
  const w = sandbox();
  w.artifacts.add("water");
  w.artifacts.add("lightning");
  const e = makeEnemy(175, 103, "boss");
  w.enemies = [e];
  w.syncUnits();
  for (const combo of [1, 2, 2]) {
    w.player.swing = createSwing(w, playerSwingInit(w, combo, 0));
    w.player.swing.phase = "active";
    hits(w);
    if (combo === 1) assert.equal(e.wetTicks, 180);
    else assert.deepEqual([e.wetTicks, e.shockTicks], [0, 48]);
  }
});

test("status slow expires and shock blocks movement without extending on reapplication", () => {
  const w = sandbox();
  const e = makeEnemy(100, 100);
  e.state = ENEMY_STATE.CHASE;
  e.vx = e.def.SPEED;
  e.applyStatus("wet", w);
  e.tick(w, w.grid);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - e.def.SPEED * 0.7) < 1e-9);
  e.wetTicks = 1;
  e.tick(w, w.grid);
  assert.equal(e.wetTicks, 0);
  e.applyStatus("shock", w);
  assert.equal(e.shockTicks, 15);
  const x = e.x, y = e.y;
  for (let i = 0; i < 15; i++) {
    e.applyStatus("shock", w);
    e.tick(w, w.grid);
    assert.deepEqual([e.x, e.y, e.shockTicks], [x, y, 14 - i]);
  }
  e.applyStatus("burn", w);
  for (let i = 0; i < 30; i++) e.tick(w, w.grid);
  e.applyStatus("burn", w);
  for (let i = 0; i < 30; i++) e.tick(w, w.grid);
  assert.equal(e.hp, 2);
});

test("status burn ticks without interrupting, expires and steam consumes both orders", () => {
  const w = sandbox();
  const e = makeEnemy(175, 103, "boss");
  e.restTicks = 1000;
  e.applyStatus("burn", w);
  for (let i = 0; i < 59; i++) e.tick(w, w.grid);
  assert.equal(e.hp, 24);
  e.tick(w, w.grid);
  assert.equal(e.hp, 23);
  assert.equal(e.state, "idle");
  assert.equal(w.hitStopTicks, 0);
  for (let i = 0; i < 60; i++) e.tick(w, w.grid);
  assert.deepEqual([e.hp, e.burnTicks], [22, 0]);
  for (const order of [["burn", "wet"], ["wet", "burn"]] as const) {
    const hp: number = e.hp;
    for (const status of order) e.applyStatus(status, w);
    assert.deepEqual([e.hp, e.burnTicks, e.wetTicks], [hp - 2, 0, 0]);
  }
  const splitter = makeEnemy(175, 103, "splitter");
  splitter.hp = 1;
  w.artifacts.add("pursuit");
  w.player.dashCd = 40;
  splitter.applyStatus("burn", w);
  for (let i = 0; i < 60; i++) splitter.tick(w, w.grid);
  assert.equal(splitter.dead, true);
  assert.equal(w.enemies.length, 2);
  assert.equal(w.player.dashCd, 22);
});

test("missing or truncated start selects a walkable tile; solid rooms reject", () => {
  for (const rows of [["OOOO", "OO.O", "OOOO"], ["OOOO", "OO.OS", "OOOO"]]) {
    const room = new Room({ name: "fallback", rows }, 0);
    assert.equal(room.solidAtPx(room.start.x, room.start.y), false);
  }
  assert.throws(() => new Room({ name: "solid", rows: ["OOOO", "OOOO"] }, 0), /walkable/i);
});
