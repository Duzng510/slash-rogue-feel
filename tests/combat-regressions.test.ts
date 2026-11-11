import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../src/config.ts";
import { World } from "../src/world/world.ts";
import { Room } from "../src/world/rooms.ts";
import { createSwing, hitboxOf, playerSwingInit, resolveHits } from "../src/systems/combat.ts";
import { makeEnemy, ENEMY_STATE } from "../src/entities/enemy.ts";
import { IntentSource } from "../src/input/intent.ts";
import { ParticlePool } from "../src/systems/particles.ts";
import { ARTIFACTS, ARTIFACT_UNLOCKS } from "../src/systems/artifacts.ts";
import { emptyStats } from "../src/systems/runStats.ts";
import { checkAchievements, emptyAchievements, parseAchievements, stringifyAchievements } from "../src/systems/unlocks.ts";
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
  return { earned, best: null, totalGold: 0 };
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
    if (w.room.shop) {
      assert.equal(w.shopOffers!.length, 3);
      w.leaveShop();
      continue;
    }
    assert.equal(w.artifactChoices.length, 3);
    assert.ok(w.artifactChoices.every(b => !w.artifacts.has(b.id)));
    w.chooseArtifact(w.artifactChoices[0].id);
  }
});

test("a fresh save only offers the two unlocked artifacts, then gating opens more", () => {
  const fresh = new World(CONFIG.SEED, { earned: new Set<AchievementId>(), best: null, totalGold: 0 });
  fresh.clearEnemies();
  fresh.player.reset(160, 100);
  fresh.tick(idle);
  const offered = fresh.artifactChoices.map(b => b.id);
  assert.ok(offered.length > 0);
  assert.ok(offered.every(id => ARTIFACT_UNLOCKS[id] === null));
  assert.ok(!offered.includes("lightning"));

  const withFirstBlood = new World(CONFIG.SEED, { earned: new Set<AchievementId>(["first_blood"]), best: null, totalGold: 0 });
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
  enemy.hp = 1.2;
  w.enemies = [enemy];
  w.syncUnits();
  w.player.dashCd = 40;
  w.player.swing = createSwing(w, playerSwingInit(w, 1, 0));
  w.player.swing.phase = "active";
  hits(w);
  assert.equal(enemy.hp, 0);
  assert.equal(w.player.dashCd, 22);
  assert.equal(w.hitStopTicks, Math.round(CONFIG.FEEL.HIT_STOP_KILL * 1.5));
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

const jab = (w: World, dmg: number, side: "player" | "enemy" = "player") =>
  createSwing(w, { side, combo: 1, dir: 0, ox: 0, oy: 0, reach: 20, deg: 90, dmg, knockback: 0, fd: { startup: 0, active: 1, recovery: 0 } });

test("berserker scales with lost HP and glasscannon multiplies damage by 1.75", () => {
  const w = sandbox();
  const base = playerSwingInit(w, 1, 0).dmg;
  w.artifacts.add("berserker");
  assert.equal(playerSwingInit(w, 1, 0).dmg, base);
  w.player.hp = 1;
  const low = base * (1 + (CONFIG.PLAYER.HP - 1) * 0.1);
  assert.equal(playerSwingInit(w, 1, 0).dmg, low);
  w.artifacts.add("glasscannon");
  assert.equal(playerSwingInit(w, 1, 0).dmg, low * 1.75);
});

test("status priority keeps water over poison and lightning over freeze", () => {
  const w = sandbox();
  w.artifacts.add("poison");
  w.artifacts.add("freeze");
  assert.equal(playerSwingInit(w, 1, 0).status, "poison");
  assert.equal(playerSwingInit(w, 2, 0).status, "freeze");
  w.artifacts.add("water");
  w.artifacts.add("lightning");
  assert.equal(playerSwingInit(w, 1, 0).status, "wet");
  assert.equal(playerSwingInit(w, 2, 0).status, "shock");
});

test("poison ticks 1/s, doubles while burning and is not consumed by wet", () => {
  const w = sandbox();
  const e = makeEnemy(175, 103, "boss");
  e.restTicks = 1000;
  w.enemies = [e];
  w.syncUnits();
  e.applyStatus("poison", w);
  e.applyStatus("wet", w);
  assert.ok(e.poisonTicks > 0);
  for (let i = 0; i < 60; i++) e.tick(w, w.grid);
  assert.equal(e.hp, 23);
  const f = makeEnemy(175, 103, "boss");
  f.restTicks = 1000;
  f.applyStatus("burn", w);
  f.applyStatus("poison", w);
  for (let i = 0; i < 60; i++) f.tick(w, w.grid);
  assert.equal(f.hp, 21);
});

test("freeze stuns briefly and the next hit shatters for +2 damage", () => {
  const w = sandbox();
  const e = makeEnemy(175, 103, "boss");
  w.enemies = [e];
  w.syncUnits();
  e.applyStatus("freeze", w);
  assert.equal(e.freezeTicks, 48);
  const x = e.x;
  for (let i = 0; i < 10; i++) e.tick(w, w.grid);
  assert.equal(e.x, x);
  e.onHit(jab(w, 1), e.x, e.y, w);
  assert.deepEqual([e.hp, e.freezeTicks], [21, 0]);
});

test("bleed damages moving enemies on a cooldown, not over time", () => {
  const w = sandbox();
  w.artifacts.add("bleed");
  const e = makeEnemy(220, 100, "boss");
  w.enemies = [e];
  w.syncUnits();
  e.onHit(jab(w, 0), e.x, e.y, w);
  assert.equal(e.bleedTicks, 300);
  e.vx = 60;
  e.tick(w, w.grid);
  assert.equal(e.hp, 23);
  e.vx = 60;
  e.tick(w, w.grid);
  assert.equal(e.hp, 23);
});

test("detonate blasts 3 dmg and burn within 50px when a burning enemy dies", () => {
  const w = sandbox();
  w.artifacts.add("detonate");
  const a = makeEnemy(200, 100);
  const b = makeEnemy(230, 100, "boss");
  const c = makeEnemy(280, 100, "boss");
  w.enemies = [a, b, c];
  w.syncUnits();
  a.applyStatus("burn", w);
  a.onHit(jab(w, 99), a.x, a.y, w);
  assert.ok(a.dead);
  assert.deepEqual([b.hp, b.burnTicks > 0], [21, true]);
  assert.equal(c.hp, c.maxHp);
});

test("corrode extends wet to 5s and amplifies direct slash damage by 25%", () => {
  const w = sandbox();
  w.artifacts.add("corrode");
  const e = makeEnemy(220, 100, "boss");
  w.enemies = [e];
  w.syncUnits();
  e.applyStatus("wet", w);
  assert.equal(e.wetTicks, 300);
  e.onHit(jab(w, 2), e.x, e.y, w);
  assert.equal(e.hp, 21.5);
});

test("vampire heals 1 HP every 5 kills, capped at max", () => {
  const w = sandbox();
  w.artifacts.add("vampire");
  w.player.hp = 1;
  for (let i = 0; i < 10; i++) {
    const e = makeEnemy(220, 100);
    w.enemies = [e];
    w.syncUnits();
    e.onHit(jab(w, 99), e.x, e.y, w);
    assert.equal(w.player.hp, i === 4 ? 2 : i === 9 ? 3 : w.player.hp);
  }
  assert.equal(w.player.hp, 3);
});

test("executioner instantly kills below 20% HP without hit-stop", () => {
  const w = sandbox();
  w.artifacts.add("executioner");
  const e = makeEnemy(175, 103, "boss");
  e.hp = 4;
  w.enemies = [e];
  w.syncUnits();
  const sw = createSwing(w, playerSwingInit(w, 1, 0));
  sw.phase = "active";
  const hb = e.hurtRect();
  sw.ox = hb.x + hb.w / 2;
  sw.oy = hb.y + hb.h / 2;
  w.player.swing = sw;
  hits(w);
  assert.deepEqual([e.dead, w.hitStopTicks], [true, 0]);
});

test("twin blades combo 2 also hits behind the player", () => {
  for (const owned of [false, true]) {
    const w = sandbox();
    if (owned) w.artifacts.add("twin_blades");
    const front = makeEnemy(w.player.x + 15, w.player.y);
    const back = makeEnemy(w.player.x - 15, w.player.y);
    w.enemies = [front, back];
    w.syncUnits();
    const sw = createSwing(w, playerSwingInit(w, 2, 0));
    sw.phase = "active";
    w.player.swing = sw;
    hits(w);
    assert.ok(front.hp < front.maxHp);
    assert.equal(back.hp < back.maxHp, owned);
  }
});

test("chain lightning jumps once to the nearest enemy within 60px", () => {
  const w = sandbox();
  w.artifacts.add("chain_lightning");
  const a = makeEnemy(w.player.x + 15, w.player.y);
  const b = makeEnemy(w.player.x + 45, w.player.y);
  const c = makeEnemy(w.player.x + 120, w.player.y);
  w.enemies = [a, b, c];
  w.syncUnits();
  const sw = createSwing(w, playerSwingInit(w, 2, 0));
  sw.phase = "active";
  w.player.swing = sw;
  hits(w);
  assert.equal(b.hp, b.maxHp - 1);
  assert.equal(c.hp, c.maxHp);
});

test("shield blocks one hit without damage and recharges after 7s", () => {
  const w = sandbox();
  w.artifacts.add("shield");
  const hp = w.player.hp;
  w.player.onHit(jab(w, 1, "enemy"), w.player.x, w.player.y, w);
  assert.deepEqual([w.player.hp, w.player.state], [hp, "idle"]);
  w.player.onHit(jab(w, 1, "enemy"), w.player.x, w.player.y, w);
  assert.equal(w.player.hp, hp - 1);
  for (let i = 0; i < 420; i++) w.player.tick(idle, w);
  assert.ok(w.player.shieldReady);
});

test("phantom dash teleports 60px without i-frames and cuts through enemies", () => {
  const w = sandbox();
  w.artifacts.add("phantom_dash");
  const e = makeEnemy(w.player.x + 30, w.player.y);
  w.enemies = [e];
  w.syncUnits();
  const x0 = w.player.x;
  w.player.tick({ ...idle, dash: true }, w);
  assert.equal(w.player.x, x0 + 60);
  assert.equal(w.player.dashIframeTicks, 0);
  assert.ok(w.player.canBeHit());
  assert.equal(e.hp, e.maxHp - 2);
});

test("glasscannon clamps current HP to 3 when picked", () => {
  const w = sandbox();
  w.artifactChoices = ARTIFACTS.filter(a => a.id === "glasscannon");
  assert.ok(w.chooseArtifact("glasscannon"));
  assert.equal(w.player.hp, 3);
});

test("healer pulses 1 HP to nearby allies every 3s, never itself or far allies", () => {
  const w = sandbox();
  const h = makeEnemy(200, 100, "healer");
  h.restTicks = 1000;
  const near = makeEnemy(230, 100, "boss");
  const far = makeEnemy(320, 100, "boss");
  near.hp = 20;
  far.hp = 20;
  h.hp = 1;
  w.enemies = [h, near, far];
  w.syncUnits();
  for (let i = 0; i < 179; i++) h.tick(w, w.grid);
  assert.equal(near.hp, 20);
  h.tick(w, w.grid);
  assert.deepEqual([near.hp, far.hp, h.hp], [21, 20, 1]);
});

test("exploder detonates for 3 dmg within 50px, spares outsiders, dies without kill credit", () => {
  const w = sandbox();
  const e = makeEnemy(w.player.x + 40, w.player.y, "exploder");
  w.enemies = [e];
  w.syncUnits();
  const hp = w.player.hp;
  for (let i = 0; i < 200 && !e.dead; i++) e.tick(w, w.grid);
  assert.ok(e.dead);
  assert.equal(w.player.hp, hp - 3);
  assert.equal(w.runStats.enemiesKilled, 0);

  const w2 = sandbox();
  const f = makeEnemy(w2.player.x + 90, w2.player.y, "exploder");
  f.setState(ENEMY_STATE.CHASE);
  f.setState(ENEMY_STATE.TELEGRAPH);
  f.telegraphDir = Math.PI;
  f.telegraphTotal = 60;
  f.telegraphTicksLeft = 1;
  w2.enemies = [f];
  w2.syncUnits();
  f.tick(w2, w2.grid);
  assert.ok(f.dead);
  assert.equal(w2.player.hp, CONFIG.PLAYER.HP);
});

test("shielder halves frontal damage but takes full from behind", () => {
  const w = sandbox();
  const e = makeEnemy(200, 100, "shielder");
  w.enemies = [e];
  w.syncUnits();
  e.facing = Math.PI;
  const front = jab(w, 2);
  front.dir = 0;
  e.onHit(front, e.x, e.y, w);
  assert.equal(e.hp, 3);
  const back = jab(w, 2);
  back.dir = Math.PI;
  e.onHit(back, e.x, e.y, w);
  assert.equal(e.hp, 1);
});

test("sniper beam hits along its line for 3 dmg and misses off-axis", () => {
  const w = sandbox();
  const e = makeEnemy(w.player.x + 100, w.player.y + 4, "sniper");
  e.setState(ENEMY_STATE.CHASE);
  e.setState(ENEMY_STATE.TELEGRAPH);
  e.telegraphDir = Math.PI;
  e.telegraphTotal = 120;
  e.telegraphTicksLeft = 1;
  w.enemies = [e];
  w.syncUnits();
  const hp = w.player.hp;
  e.tick(w, w.grid);
  assert.equal(w.player.hp, hp - 3);

  const w2 = sandbox();
  const f = makeEnemy(w2.player.x + 100, w2.player.y + 20, "sniper");
  f.setState(ENEMY_STATE.CHASE);
  f.setState(ENEMY_STATE.TELEGRAPH);
  f.telegraphDir = Math.PI;
  f.telegraphTotal = 120;
  f.telegraphTicksLeft = 1;
  w2.enemies = [f];
  w2.syncUnits();
  f.tick(w2, w2.grid);
  assert.equal(w2.player.hp, CONFIG.PLAYER.HP);
});

test("elites double HP, hit 1.5x and drop 3 gold instead of 1", () => {
  const w = sandbox();
  const e = makeEnemy(200, 100, "chaser", true);
  assert.equal(e.hp, 6);
  e.setState(ENEMY_STATE.CHASE);
  e.setState(ENEMY_STATE.TELEGRAPH);
  e.telegraphTicksLeft = 1;
  e.telegraphTotal = 27;
  e.tick(w, w.grid);
  assert.equal(e.swing!.dmg, 1.5);
  w.enemies = [e];
  w.syncUnits();
  e.onHit(jab(w, 99), e.x, e.y, w);
  assert.deepEqual([w.runStats.gold, w.runStats.eliteKills], [3, 1]);
  const n = makeEnemy(200, 100);
  w.enemies = [n];
  w.syncUnits();
  n.onHit(jab(w, 99), n.x, n.y, w);
  assert.deepEqual([w.runStats.gold, w.runStats.eliteKills], [4, 1]);
});

test("elite_slayer unlocks at 5 elite kills", () => {
  const s = emptyStats();
  s.eliteKills = 4;
  assert.ok(!checkAchievements(s, "kill").includes("elite_slayer"));
  s.eliteKills = 5;
  assert.ok(checkAchievements(s, "kill").includes("elite_slayer"));
});

test("boss death pays 20 gold into both run and lifetime counters", () => {
  const w = sandbox();
  const b = makeEnemy(200, 100, "boss");
  w.enemies = [b];
  w.syncUnits();
  b.onHit(jab(w, 999), b.x, b.y, w);
  assert.deepEqual([w.runStats.gold, w.runStats.totalGoldEarned], [20, 20]);
});

test("shop offers three goods, purchases deduct gold and reject when broke", () => {
  const w = sandbox();
  w.loadRoom(w.roomTotal - 2);
  w.player.hp = 1;
  w.runStats.gold = 20;
  w.tick(idle);
  assert.equal(w.shopOffers!.length, 3);
  const heal = w.shopOffers!.findIndex(o => o.kind === "heal");
  assert.ok(heal >= 0);
  assert.ok(w.chooseShop(heal));
  assert.deepEqual([w.player.hp, w.runStats.gold], [3, 12]);
  const maxhp = w.shopOffers!.findIndex(o => o.kind === "maxhp");
  assert.ok(maxhp >= 0 && !w.chooseShop(maxhp));
  w.leaveShop();
  assert.equal(w.shopOffers, null);
});

test("shop curse removal deletes one curse and charges 30 gold", () => {
  const w = sandbox();
  w.curses.add("glass");
  w.loadRoom(w.roomTotal - 2);
  w.runStats.gold = 50;
  w.tick(idle);
  const i = w.shopOffers!.findIndex(o => o.kind === "curse");
  assert.ok(i >= 0);
  assert.ok(w.chooseShop(i));
  assert.deepEqual([w.curses.size, w.runStats.gold], [0, 20]);
});

test("rich unlocks at 100 lifetime gold and totalGold survives a save round-trip", () => {
  assert.ok(!checkAchievements(emptyStats(), "end", 99).includes("rich"));
  assert.ok(checkAchievements(emptyStats(), "end", 100).includes("rich"));
  const a = emptyAchievements();
  a.totalGold = 123;
  assert.equal(parseAchievements(stringifyAchievements(a)).totalGold, 123);
});

test("drop 8 achievements fire on their win, kill, room and artifact signals", () => {
  const s = emptyStats();
  Object.assign(s, { finalHp: 1, cursesTaken: 1, ticksElapsed: 4 * 60 * 60, roomsCleared: 12 });
  const win = checkAchievements(s, "win");
  for (const id of ["speedrun_sub_5", "no_dash_win", "one_hp_win", "curse_bearer", "perfect_boss"] as const) {
    assert.ok(win.includes(id), id);
  }
  assert.ok(!checkAchievements({ ...s, dashCount: 1 }, "win").includes("no_dash_win"));
  assert.ok(!checkAchievements({ ...s, bossDamageTaken: 1 }, "win").includes("perfect_boss"));
  const k = emptyStats();
  Object.assign(k, { poisonKills: 10, critHits: 15, wardenKills: 1, phantomKills: 5, vampireHeals: 5, perfectDodges: 10 });
  const kill = checkAchievements(k, "kill");
  for (const id of ["poison_master", "crit_king", "warden_slayer", "phantom_master", "vampire_lord", "dodge_king"] as const) {
    assert.ok(kill.includes(id), id);
  }
  assert.ok(checkAchievements({ ...emptyStats(), roomsCleared: 1 }, "room").includes("pacifist_room"));
  assert.ok(!checkAchievements({ ...emptyStats(), roomsCleared: 1, roomKills: 2 }, "room").includes("pacifist_room"));
  assert.ok(checkAchievements({ ...emptyStats(), artifactsTaken: 10 }, "artifact").includes("collector_10"));
});
