import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../src/config.ts";
import { World } from "../src/world/world.ts";
import { Room } from "../src/world/rooms.ts";
import { createSwing, hitboxOf, playerSwingInit, resolveHits } from "../src/systems/combat.ts";
import { makeEnemy, ENEMY_STATE } from "../src/entities/enemy.ts";
import { IntentSource } from "../src/input/intent.ts";
import { ParticlePool } from "../src/systems/particles.ts";
import type { Intent } from "../src/sim/types.ts";

const idle: Intent = { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false };
function sandbox() {
  const w = new World();
  w.clearEnemies();
  w.player.reset(160, 100);
  w.queue.drain();
  return w;
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
      resolveHits(w);
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
      boss.tick(w);
      boss.tick(w);
      const angle = degrees * Math.PI / 180;
      w.player.reset(cx + Math.cos(angle) * (radius + offset), cy + Math.sin(angle) * (radius + offset) + CONFIG.PLAYER.HURT_H / 2);
      const hp = w.player.hp;
      resolveHits(w);
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

test("missing or truncated start selects a walkable tile; solid rooms reject", () => {
  for (const rows of [["OOOO", "OO.O", "OOOO"], ["OOOO", "OO.OS", "OOOO"]]) {
    const room = new Room({ name: "fallback", rows }, 0);
    assert.equal(room.solidAtPx(room.start.x, room.start.y), false);
  }
  assert.throws(() => new Room({ name: "solid", rows: ["OOOO", "OOOO"] }, 0), /walkable/i);
});
