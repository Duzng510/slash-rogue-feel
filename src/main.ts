import { CONFIG } from "./config.ts";
import type { EnemyKind } from "./config.ts";
import { dist } from "./mathx.ts";
import { GameLoop } from "./loop.ts";
import { World } from "./world/world.ts";
import { IntentSource } from "./input/intent.ts";
import { DesktopInput, type Hotkey } from "./input/keyboardMouse.ts";
import { TouchInput } from "./input/touch.ts";
import { Camera } from "./render/camera.ts";
import { Renderer } from "./render/renderer.ts";
import { buildSprites } from "./render/pixelart.ts";
import { Hud } from "./ui/hud.ts";
import { syncOrientation, tryImmersive } from "./ui/immersive.ts";
import type { OrientationLike } from "./ui/immersive.ts";
import { startDiag } from "./ui/diag.ts";
import { DebugHud, type DebugFlags } from "./ui/debug.ts";
import { Sfx } from "./audio/sfx.ts";
import { createSwing } from "./systems/combat.ts";
import type { Intent } from "./sim/types.ts";

const qs = new URLSearchParams(location.search);
const autoplay = qs.get("autoplay") === "1";
const seed = Number(qs.get("seed") ?? CONFIG.SEED);

const game = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLDivElement;

const sprites = buildSprites();
const world = new World(seed);
if (qs.get("room") !== null) world.loadRoom(Number(qs.get("room")));
const cam = new Camera();
cam.snap(world.player.x, world.player.y - 6);
const renderer = new Renderer(game, overlay, world, cam, sprites);
renderer.resize();
const hud = new Hud(world, sprites);
const debug = new DebugHud();
const sfx = new Sfx();
const intent = new IntentSource();

const flags: DebugFlags = {
  boxes: qs.get("boxes") === "1",
  fps: qs.get("fps") === "1",
  hitStop: true,
};

function applyHotkey(k: Hotkey): void {
  switch (k) {
    case "panel":
      panel.classList.toggle("on");
      break;
    case "fps":
      flags.fps = !flags.fps;
      break;
    case "boxes":
      flags.boxes = !flags.boxes;
      break;
    case "hitstop":
      flags.hitStop = !flags.hitStop;
      break;
    case "slowmo":
      CONFIG.SLIDERS.timescale = CONFIG.SLIDERS.timescale > 0.5 ? 0.35 : 1;
      break;
    case "spawn":
      world.addEnemies(4);
      break;
    case "clear":
      for (const e of world.enemies) {
        if (!e.dead) e.die();
      }
      break;
    case "restartRoom":
      world.loadRoom(world.roomIndex);
      break;
    case "nextRoom":
      world.loadRoom(world.roomIndex + 1);
      break;
  }
  syncSliderLabels();
}

const desk = new DesktopInput(intent, {
  tick: () => world.tickCount,
  onHotkey: applyHotkey,
  aimFromClient: (x, y) => renderer.aimFromClient(x, y),
});
let touch: TouchInput | undefined;

const touchLayer = document.getElementById("touch") as HTMLDivElement | null;
if (touchLayer !== null) {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const forced = qs.get("touch") === "1";
  if (coarse || forced) {
    document.body.classList.add("touch");
    if (!autoplay) {
      touch = new TouchInput(
        intent,
        () => world.tickCount,
        document.getElementById("stick") as HTMLElement,
        document.getElementById("knob") as HTMLElement,
        document.getElementById("btn-attack") as HTMLElement,
        document.getElementById("btn-dash") as HTMLElement
      );
    }
  }
}

// rotation decides which axes the fit uses, so the two always change together
const onViewport = (): void => {
  syncOrientation();
  renderer.resize();
};
onViewport();

const SLIDERS: { id: string; label: string; key: keyof typeof CONFIG.SLIDERS; fmt: (v: number) => string }[] = [
  { id: "s-shake", label: "v-shake", key: "shake", fmt: (v) => v.toFixed(2) },
  { id: "s-volume", label: "v-volume", key: "volume", fmt: (v) => v.toFixed(2) },
  { id: "s-particles", label: "v-particles", key: "particles", fmt: (v) => v.toFixed(2) },
  { id: "s-timescale", label: "v-timescale", key: "timescale", fmt: (v) => v.toFixed(2) },
  { id: "s-hitstop", label: "v-hitstop", key: "hitStopScale", fmt: (v) => `${v}` },
  { id: "s-dmgnum", label: "v-dmgnum", key: "dmgNumbers", fmt: (v) => (v > 0 ? "on" : "off") },
];

function syncSliderLabels(): void {
  for (const s of SLIDERS) {
    const input = document.getElementById(s.id) as HTMLInputElement | null;
    const out = document.getElementById(s.label) as HTMLElement | null;
    if (input === null || out === null) continue;
    input.value = String(CONFIG.SLIDERS[s.key]);
    out.textContent = s.fmt(CONFIG.SLIDERS[s.key]);
  }
}

for (const s of SLIDERS) {
  const input = document.getElementById(s.id) as HTMLInputElement | null;
  if (input === null) continue;
  input.addEventListener("input", () => {
    CONFIG.SLIDERS[s.key] = Number(input.value);
    syncSliderLabels();
  });
}
syncSliderLabels();

let immersiveNote = "not tried";

window.addEventListener("pointerdown", () => sfx.unlock());
window.addEventListener("keydown", () => sfx.unlock());
window.addEventListener("resize", onViewport);
window.addEventListener("orientationchange", onViewport);
document.addEventListener("fullscreenchange", onViewport);

function botIntent(): Intent {
  const p = world.player;
  let target: { x: number; y: number } | null = null;
  let best = Infinity;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < best) {
      best = d;
      target = { x: e.x, y: e.y };
    }
  }
  if (target === null) {
    return { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false };
  }
  const a = Math.atan2(target.y - p.y, target.x - p.x);
  const close = best <= CONFIG.ATTACK.REACH * 0.95;
  return {
    moveX: close ? 0 : Math.cos(a),
    moveY: close ? 0 : Math.sin(a),
    aimX: target.x,
    aimY: target.y,
    attack: close && world.tickCount % 14 === 0,
    dash: best > 70 && world.tickCount % 89 === 0,
  };
}

function sim(): void {
  /** hit-stop must not swallow presses: read(live=false) leaves them queued for the first tick after the freeze */
  const live = world.hitStopTicks === 0;
  if (!autoplay) {
    desk.sampleAim();
    world.tick(intent.read(world.tickCount, live));
    return;
  }
  const manual = intent.read(world.tickCount, live);
  if (qs.get("bot") === "0") {
    world.tick(manual);
    return;
  }
  const b = botIntent();
  world.tick(live ? { ...b, attack: b.attack || manual.attack, dash: b.dash || manual.dash } : manual);
}

function frame(dtReal: number): void {
  diag.frame();
  const dtSim = dtReal * CONFIG.SLIDERS.timescale;
  world.particles.update(dtSim);
  const aim = intent.aim ?? { x: world.player.x, y: world.player.y };
  cam.follow(world.player.x, world.player.y - 6, aim.x, aim.y, world.room, dtSim);

  const events = world.queue.drain();
  renderer.consume(events);
  for (const e of events) if (e.t === "sfx") sfx.play(e.name, e.gain, e.pitch);

  renderer.draw(dtSim, flags);
  const o = renderer.o;
  o.clearRect(0, 0, o.canvas.width, o.canvas.height);
  hud.draw(o, renderer.scale);
  debug.measure(dtReal);
  debug.draw(o, renderer.scale, world, renderer, flags);
}

const diag = startDiag(qs.get("diag") === "1", () => ({
  fs: document.fullscreenElement !== null,
  orient: screen.orientation ? `${screen.orientation.type}/${screen.orientation.angle}` : "n/a",
  fserr: immersiveNote,
  tick: world.tickCount,
  stop: world.hitStopTicks,
  alive: world.aliveEnemies(),
}));

const loop = new GameLoop(sim, frame);
const startScreen = document.getElementById("start-screen") as HTMLDivElement;
const startButton = document.getElementById("btn-start") as HTMLButtonElement;
function startGame(): void {
  startScreen.hidden = true;
  document.body.classList.remove("starting");
  if (!autoplay) {
    desk.attach();
    touch?.attach();
  }
  if (qs.get("manual") !== "1") loop.start();
}
if (autoplay || qs.get("manual") === "1") {
  startGame();
} else {
  startButton.addEventListener("click", () => {
    sfx.unlock();
    void tryImmersive(document.documentElement, screen.orientation as unknown as OrientationLike)
      .then((r) => {
        immersiveNote = r.reason;
        onViewport();
      });
    startGame();
  }, { once: true });
}

type Harness = {
  ready: true;
  advance: (dt: number) => number;
  pressAttack: () => void;
  pressDash: () => void;
  setMove: (x: number, y: number) => void;
  setAim: (x: number, y: number) => void;
  addEnemies: (n: number, kinds?: EnemyKind[]) => void;
  clearEnemies: () => void;
  damageEnemy: (id: number, dmg: number) => boolean;
  gotoRoom: (i: number) => void;
  state: () => {
    tick: number;
    hitStop: number;
    player: { x: number; y: number; hp: number; state: string; swing: string | null; invuln: boolean };
    roomIndex: number;
    enemies: {
      id: number;
      x: number;
      y: number;
      hp: number;
      state: string;
      kind: string;
      enraged: boolean;
      telegraphTicksLeft: number;
    }[];
    particles: number;
    fx: { arcs: number; flashes: number; vignette: number; shake: number };
  };
};

const harness: Harness = {
  ready: true,
  advance: (dt) => loop.advance(dt),
  pressAttack: () => intent.pressAttack(world.tickCount),
  pressDash: () => intent.pressDash(world.tickCount),
  setMove: (x, y) => {
    intent.moveX = x;
    intent.moveY = y;
  },
  setAim: (x, y) => {
    intent.aim = { x, y };
  },
  addEnemies: (n, kinds) => world.addEnemies(n, kinds),
  clearEnemies: () => world.clearEnemies(),
  damageEnemy: (id, dmg) => {
    const e = world.enemies.find((x) => x.id === id);
    if (e === undefined || e.dead) return false;
    e.onHit(
      createSwing(world, {
        side: "player",
        combo: 1,
        dir: 0,
        ox: e.x,
        oy: e.y,
        reach: 8,
        deg: 90,
        dmg,
        knockback: 0,
        fd: { startup: 1, active: 1, recovery: 1 },
      }),
      e.x,
      e.y,
      world
    );
    return true;
  },
  gotoRoom: (i) => world.loadRoom(i),
  state: () => ({
    tick: world.tickCount,
    hitStop: world.hitStopTicks,
    player: {
      x: world.player.x,
      y: world.player.y,
      hp: world.player.hp,
      state: world.player.state,
      swing: world.player.swing === null ? null : `${world.player.swing.combo}:${world.player.swing.phase}`,
      invuln: !world.player.canBeHit(),
    },
    roomIndex: world.roomIndex,
    enemies: world.enemies.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      hp: e.hp,
      state: e.state,
      kind: e.kind,
      enraged: e.enraged,
      telegraphTicksLeft: e.telegraphTicksLeft,
    })),
    particles: world.particles.alive,
    fx: renderer.fxInfo,
  }),
};

(window as unknown as { __game: Harness & { config: typeof CONFIG } }).__game =
  Object.assign(harness, { config: CONFIG });
