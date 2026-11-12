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
import { WeaponSelect } from "./ui/weaponSelect.ts";
import { EndScreen } from "./ui/endScreen.ts";
import { isRotated, syncOrientation, tryImmersive } from "./ui/immersive.ts";
import type { OrientationLike } from "./ui/immersive.ts";
import { startDiag } from "./ui/diag.ts";
import { DebugHud, type DebugFlags } from "./ui/debug.ts";
import { Sfx } from "./audio/sfx.ts";
import { createSwing } from "./systems/combat.ts";
import type { Intent } from "./sim/types.ts";
import type { ArtifactId, CurseId } from "./systems/artifacts.ts";
import type { CharacterId } from "./systems/characters.ts";
import type { WeaponId } from "./systems/weapons.ts";
import type { RunStats, EndAction, EndMode } from "./systems/runStats.ts";
import { parseAchievements, stringifyAchievements, emptyAchievements } from "./systems/unlocks.ts";
import type { Achievements } from "./systems/unlocks.ts";
import { APP_VERSION, CHANGELOG } from "./ui/changelog.ts";

const qs = new URLSearchParams(location.search);
const autoplay = qs.get("autoplay") === "1";
const seed = Number(qs.get("seed") ?? Math.floor(Math.random() * 0x100000000));

/** unlocks live in localStorage only from the composition root; the sim never touches storage */
const ACH_KEY = "ruby.achievements.v1";
function readStore(): Achievements {
  try {
    return parseAchievements(localStorage.getItem(ACH_KEY));
  } catch {
    return emptyAchievements();
  }
}
function persist(): void {
  try {
    localStorage.setItem(ACH_KEY, stringifyAchievements(world.achievements));
  } catch {
    /** private mode / quota: this session's unlocks simply won't survive a reload */
  }
}
if (qs.get("resetAch") === "1") {
  try {
    localStorage.removeItem(ACH_KEY);
  } catch {
    /** nothing to clear */
  }
  location.reload();
}

const game = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLDivElement;

const sprites = buildSprites();
const world = new World(seed, readStore());
if (qs.get("room") !== null) world.loadRoom(Number(qs.get("room")));
const cam = new Camera();
cam.snap(world.player.x, world.player.y - 6);
const renderer = new Renderer(game, overlay, world, cam, sprites);
renderer.resize();
const hud = new Hud(world, sprites);
const weaponSelect = new WeaponSelect(world, sprites);
const endScreen = new EndScreen(overlay);
const debug = new DebugHud();
const sfx = new Sfx();
const intent = new IntentSource();

const flags: DebugFlags = {
  boxes: qs.get("boxes") === "1",
  fps: qs.get("fps") === "1",
  hitStop: true,
};

function applyHotkey(k: Hotkey): void {
  if (world.artifactChoices.length > 0 || world.characterChoices.length > 0 || world.weaponChoices !== null) return;
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
  blocked: () => world.artifactChoices.length > 0 || world.characterChoices.length > 0 || world.weaponChoices !== null || endScreen.isOpen(),
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
        document.getElementById("btn-dash") as HTMLElement,
        document.getElementById("btn-skill") as HTMLElement
      );
    }
  }
}

let modalOpen = false;
function resetInput(): void {
  desk.reset();
  touch?.reset();
}
/** the start screen sits above the canvas, so its clicks must not be swallowed by the modal blocker */
const modalActive = (): boolean => startScreen.hidden && (world.characterChoices.length > 0 || world.weaponChoices !== null || world.artifactChoices.length > 0 || world.shopOffers !== null);
function syncArtifactModal(): boolean {
  const open = modalActive();
  if (open !== modalOpen) {
    resetInput();
    modalOpen = open;
    document.body.classList.toggle("artifact-modal", open);
  }
  return open;
}
function chooseArtifact(id: ArtifactId): boolean {
  const chosen = world.chooseArtifact(id);
  if (chosen) {
    resetInput();
    suppressModalClick = false;
  }
  syncArtifactModal();
  return chosen;
}
function modalFromClient(x: number, y: number): string | null {
  const r = overlay.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const u = (x - r.left) / r.width;
  const v = (y - r.top) / r.height;
  const cx = isRotated() ? v * 320 : u * 320;
  const cy = isRotated() ? (1 - u) * 180 : v * 180;
  if (world.weaponChoices !== null) {
    const wid = weaponSelect.handlePointer(cx, cy);
    if (wid !== null) return `w:${wid}`;
  }
  return hud.modalAt(cx, cy);
}
function applyModal(key: string, from: ModalKey): void {
  if (from === "q") {
    if (key === "q:-") world.setAscensionLevel(world.ascensionLevel - 1);
    else if (key === "q:+") world.setAscensionLevel(world.ascensionLevel + 1);
    return;
  }
  if (from === "w" || key.startsWith("w:")) {
    if (world.pickWeapon(key.slice(2) as WeaponId)) {
      resetInput();
      suppressModalClick = false;
    }
    syncArtifactModal();
  } else if (from === "p") {
    if (world.pickCharacter(key.slice(2) as CharacterId)) {
      resetInput();
      suppressModalClick = false;
    }
    syncArtifactModal();
  } else if (key === "t:normal") world.curseTab = false;
  else if (key === "t:curse") world.curseTab = true;
  else if (key.startsWith("c:")) {
    if (world.chooseCurse(key.slice(2) as CurseId)) {
      resetInput();
      suppressModalClick = false;
    }
    syncArtifactModal();
  } else if (key === "s:leave") {
    world.leaveShop();
    resetInput();
    suppressModalClick = false;
    syncArtifactModal();
  } else if (key.startsWith("s:")) {
    if (world.chooseShop(Number(key.slice(2)))) {
      resetInput();
      suppressModalClick = false;
    }
    syncArtifactModal();
  } else chooseArtifact(key.slice(2) as ArtifactId);
}
/** which modal a pointer press landed in; the key after the prefix tells which id was hit */
type ModalKey = "p" | "w" | "a" | "c" | "s" | "t" | "q";
function modalKind(key: string | null): ModalKey | null {
  if (key === null) return null;
  return key[0] as ModalKey;
}
const modalPointers = new Map<number, ModalKey | null>();
const endPointers = new Map<number, EndAction | null>();
const endActionFromClient = (x: number, y: number): EndAction | null => endScreen.handlePointer(x, y, renderer.scale);
let suppressModalClick = false;
window.addEventListener("pointerdown", (e) => {
  const end = endScreen.isOpen();
  suppressModalClick = end || modalActive();
  if (!suppressModalClick) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  sfx.unlock();
  if (end) {
    endPointers.set(e.pointerId, e.button === 0 ? endActionFromClient(e.clientX, e.clientY) : null);
    return;
  }
  syncArtifactModal();
  modalPointers.set(e.pointerId, e.button === 0 ? modalKind(modalFromClient(e.clientX, e.clientY)) : null);
}, { capture: true });
for (const type of ["pointerup", "pointercancel"] as const) {
  window.addEventListener(type, (e) => {
    const hasEnd = endPointers.has(e.pointerId);
    if (!hasEnd && !modalPointers.has(e.pointerId) && !modalActive() && !endScreen.isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (hasEnd) {
      const act = endPointers.get(e.pointerId);
      endPointers.delete(e.pointerId);
      if (type === "pointerup" && act != null && act === endActionFromClient(e.clientX, e.clientY)) {
        endScreen.close();
        resetInput();
        if (act === "restart") world.restart();
        else world.continueAfterWin();
      }
      return;
    }
    const kind = modalPointers.get(e.pointerId);
    modalPointers.delete(e.pointerId);
    const key = type === "pointerup" ? modalFromClient(e.clientX, e.clientY) : null;
    if (key !== null && kind !== null && kind === modalKind(key)) applyModal(key, kind);
  }, { capture: true });
}
// Keyboard selection shortcuts for character screen [1]-[3] and weapon screen [1]-[5]
window.addEventListener("keydown", (e) => {
  if (world.weaponChoices !== null && world.weaponChoices.length > 0) {
    let pickWId: WeaponId | null = null;
    if (e.code === "Digit1" || e.code === "Numpad1") pickWId = world.weaponChoices[0];
    else if (e.code === "Digit2" || e.code === "Numpad2") pickWId = world.weaponChoices[1];
    else if (e.code === "Digit3" || e.code === "Numpad3") pickWId = world.weaponChoices[2];
    else if (e.code === "Digit4" || e.code === "Numpad4") pickWId = world.weaponChoices[3];
    else if (e.code === "Digit5" || e.code === "Numpad5") pickWId = world.weaponChoices[4];
    if (pickWId) {
      e.preventDefault();
      applyModal(`w:${pickWId}`, "w");
      return;
    }
  }
  if (world.characterChoices.length > 0) {
    let pickId: CharacterId | null = null;
    if (e.code === "Digit1" || e.code === "Numpad1") pickId = world.characterChoices[0];
    else if (e.code === "Digit2" || e.code === "Numpad2") pickId = world.characterChoices[1];
    else if (e.code === "Digit3" || e.code === "Numpad3") pickId = world.characterChoices[2];
    if (pickId) {
      e.preventDefault();
      applyModal(`p:${pickId}`, "p");
    }
  }
}, { capture: true });

window.addEventListener("pointermove", (e) => {
  if (world.weaponChoices !== null) {
    const r = overlay.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      const cx = isRotated() ? v * 320 : u * 320;
      const cy = isRotated() ? (1 - u) * 180 : v * 180;
      weaponSelect.updateHover(cx, cy);
    }
  }
});

for (const type of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"] as const) {
  window.addEventListener(type, (e) => {
    if (!suppressModalClick && !modalActive() && !endScreen.isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
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
  { id: "s-bright", label: "v-bright", key: "brightness", fmt: (v) => v.toFixed(2) },
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
window.addEventListener("keydown", (e) => {
  if (e.repeat || !endScreen.isOpen() || e.code.toLowerCase() !== "keyr") return;
  e.preventDefault();
  endScreen.close();
  resetInput();
  world.restart();
});
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
    return { moveX: 0, moveY: 0, aimX: NaN, aimY: NaN, attack: false, dash: false, skill: false };
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
    skill: false,
  };
}

function sim(): void {
  if (endScreen.isOpen()) return;
  if (world.pendingEnd !== null) {
    endScreen.open(world.pendingEnd, world.runStats, [...world.artifacts], [...world.runAchievements]);
    persist();
    return;
  }
  if (syncArtifactModal()) return;
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
  syncArtifactModal();
  diag.frame();
  const dtSim = dtReal * CONFIG.SLIDERS.timescale;
  world.particles.update(dtSim);
  const aim = intent.aim ?? { x: world.player.x, y: world.player.y };
  cam.follow(world.player.x, world.player.y - 6, aim.x, aim.y, world.room, dtSim);

  const events = world.queue.drain();
  renderer.consume(events);
  let earned = false;
  for (const e of events) {
    if (e.t === "sfx") sfx.play(e.name, e.gain, e.pitch);
    else if (e.t === "achievement") {
      hud.pushAchievement(e.id);
      earned = true;
    }
  }
  if (earned) persist();

  renderer.draw(dtSim, flags);
  const o = renderer.o;
  o.clearRect(0, 0, o.canvas.width, o.canvas.height);
  hud.draw(o, renderer.scale);
  hud.drawOwnedArtifacts(o, renderer.scale);
  debug.measure(dtReal);
  debug.draw(o, renderer.scale, world, renderer, flags);
  hud.drawArtifacts(o, renderer.scale);
  hud.drawCharacters(o, renderer.scale);
  if (weaponSelect.isOpen()) weaponSelect.draw(o, renderer.scale);
  if (endScreen.isOpen()) endScreen.draw(o, renderer.scale);
  hud.drawAchievementToast(o, renderer.scale);
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
  /** the capture harnesses assert on frames counted from the fight itself, so no intro walk there */
  if (autoplay) {
    world.characterChoices = [];
    world.weaponChoices = null;
  }
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
    startScreen.classList.add("fading");
    setTimeout(startGame, 380);
  }, { once: true });
}

/** release-notes popup: opens automatically only for a version the player hasn't seen yet */
const CHANGELOG_SEEN_KEY = "ruby.changelogSeen.v1";
function initChangelog(): void {
  const modal = document.getElementById("changelog-modal") as HTMLDivElement;
  const body = document.getElementById("changelog-body") as HTMLDivElement;
  const closeBtn = document.getElementById("changelog-close") as HTMLButtonElement;
  const openBtn = document.getElementById("btn-changelog") as HTMLButtonElement;
  const versionEl = document.getElementById("version") as HTMLSpanElement;

  versionEl.textContent = APP_VERSION;
  body.innerHTML = CHANGELOG.map(
    (e) =>
      `<section class="mb-4">` +
      `<div class="flex items-baseline justify-between mb-1.5 pb-1 border-b border-[#233045]">` +
      `<span class="text-[12px] font-bold text-[#00f0ff]">${e.version}</span>` +
      `<span class="text-[10px] text-[#6b7d99]">${e.date}</span></div>` +
      `<ul class="list-none p-0 m-0">` +
      e.items
        .map((i) => `<li class="mb-1.5 relative pl-3.5 before:content-['⚡'] before:absolute before:left-0 before:text-[#00f0ff] before:text-[9px]">${i}</li>`)
        .join("") +
      `</ul></section>`
  ).join("");

  const open = (): void => {
    modal.hidden = false;
  };
  const close = (): void => {
    modal.hidden = true;
    try {
      localStorage.setItem(CHANGELOG_SEEN_KEY, APP_VERSION);
    } catch {
      /** private mode: the popup just reappears next load */
    }
  };
  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) close();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !modal.hidden) close();
  });

  let seen: string | null = null;
  try {
    seen = localStorage.getItem(CHANGELOG_SEEN_KEY);
  } catch {
    seen = null;
  }
  if (seen !== APP_VERSION) open();
}
if (!autoplay && qs.get("manual") !== "1") initChangelog();

type Harness = {
  ready: true;
  advance: (dt: number) => number;
  pressAttack: () => void;
  pressDash: () => void;
  pressSkill: () => void;
  pickCharacter: (id: CharacterId) => boolean;
  setMove: (x: number, y: number) => void;
  setAim: (x: number, y: number) => void;
  addEnemies: (n: number, kinds?: EnemyKind[], elite?: boolean) => void;
  clearEnemies: () => void;
  damageEnemy: (id: number, dmg: number) => boolean;
  applyStatus: (id: number, status: "burn" | "wet" | "shock" | "poison" | "freeze" | "bleed") => boolean;
  gotoRoom: (i: number) => void;
  chooseArtifact: (id: ArtifactId) => boolean;
  chooseWeapon: (id: WeaponId) => boolean;
  buyShop: (i: number) => boolean;
  leaveShop: () => void;
  setCurseTab: (v: boolean) => void;
  forceEnd: (mode: EndMode) => void;
  state: () => {
    tick: number;
    hitStop: number;
    player: { x: number; y: number; hp: number; state: string; swing: string | null; invuln: boolean };
    roomIndex: number;
    character: string;
    characterChoices: CharacterId[];
    artifacts: ArtifactId[];
    artifactChoices: ArtifactId[];
    curseOffer: string[] | null;
    shopOffers: number;
    shopKinds: string[];
    enemies: {
      id: number;
      x: number;
      y: number;
      hp: number;
      state: string;
      kind: string;
      pattern: string;
      enraged: boolean;
      elite: boolean;
      telegraphTicksLeft: number;
    }[];
    particles: number;
    projectiles: number;
    fx: { arcs: number; flashes: number; vignette: number; shake: number };
    runStats: RunStats;
    pendingEnd: EndMode | null;
  };
};

const harness: Harness = {
  ready: true,
  advance: (dt) => loop.advance(dt),
  pressAttack: () => intent.pressAttack(world.tickCount),
  pressDash: () => intent.pressDash(world.tickCount),
  pressSkill: () => intent.pressSkill(world.tickCount),
  pickCharacter: (id) => {
    const picked = world.pickCharacter(id);
    if (picked) resetInput();
    syncArtifactModal();
    return picked;
  },
  setMove: (x, y) => {
    intent.moveX = x;
    intent.moveY = y;
  },
  setAim: (x, y) => {
    intent.aim = { x, y };
  },
  addEnemies: (n, kinds, elite) => world.addEnemies(n, kinds, elite),
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
  applyStatus: (id, status) => {
    const e = world.enemies.find((x) => x.id === id);
    if (e === undefined || e.dead) return false;
    e.applyStatus(status, world);
    return true;
  },
  gotoRoom: (i) => { world.characterChoices = []; world.weaponChoices = null; world.loadRoom(i); syncArtifactModal(); },
  chooseArtifact,
  chooseWeapon: (id: WeaponId) => {
    const picked = world.pickWeapon(id);
    syncArtifactModal();
    return picked;
  },
  buyShop: (i) => {
    const bought = world.chooseShop(i);
    syncArtifactModal();
    return bought;
  },
  leaveShop: () => { world.leaveShop(); syncArtifactModal(); },
  setCurseTab: (v) => { world.curseTab = v; },
  forceEnd: (mode) => {
    if (mode === "won") world.runStats.roomsCleared = world.roomTotal;
    world.pendingEnd = mode;
  },
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
    character: world.player.character,
    weapon: world.player.weapon,
    characterChoices: [...world.characterChoices],
    weaponChoices: world.weaponChoices ? [...world.weaponChoices] : null,
    artifacts: [...world.artifacts],
    artifactChoices: world.artifactChoices.map((artifact) => artifact.id),
    curseOffer: world.curseOffer === null ? null : world.curseOffer.curses.map((c) => c.id),
    shopOffers: world.shopOffers?.length ?? 0,
    shopKinds: world.shopOffers?.map((o) => o.kind) ?? [],
    enemies: world.enemies.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      hp: e.hp,
      state: e.state,
      kind: e.kind,
      pattern: e.pattern,
      enraged: e.enraged,
      elite: e.isElite,
      telegraphTicksLeft: e.telegraphTicksLeft,
    })),
    particles: world.particles.alive,
    projectiles: world.projectiles.length,
    fx: renderer.fxInfo,
    runStats: world.runStats,
    pendingEnd: world.pendingEnd,
  }),
};

(window as unknown as { __game: Harness & { config: typeof CONFIG } }).__game =
  Object.assign(harness, { config: CONFIG });
