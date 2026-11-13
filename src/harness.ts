// Dev-only test harness: exposes the live game over window.__game for the capture harnesses.
// installHarness keeps the object body identical to the old inline main.ts wiring by destructuring
// the injected singletons back into local names, so nothing here touches the sim contract.
import { CONFIG } from "./config.ts";
import type { EnemyKind } from "./config.ts";
import { createSwing } from "./systems/combat.ts";
import type { GameLoop } from "./loop.ts";
import type { IntentSource } from "./input/intent.ts";
import type { World } from "./world/world.ts";
import type { Renderer } from "./render/renderer.ts";
import type { ArtifactId } from "./systems/artifacts.ts";
import type { CharacterId } from "./systems/characters.ts";
import type { WeaponId } from "./systems/weapons.ts";
import type { RunStats, EndMode } from "./systems/runStats.ts";

export type Harness = {
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
  /** tiles-batch probe: mean luminance of the last sceneRT tile flush (0 unless ?glbatch=probe) */
  glSceneRTMean: () => number;
  /** last frame's render counters: CPU drawImage blits vs GPU tile-batch quads */
  stats: () => { drawImage: number; tileBatch: number; uploads: number; overlayDirty: boolean };
  /** re-render the current frame n times to average CPU draw cost (no sim advance) */
  profileFrames: (n: number) => { cpuMsPerFrame: number; drawImagePerFrame: number; tileBatchPerFrame: number; uploadsPerFrame: number };
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

export type HarnessDeps = {
  loop: GameLoop;
  intent: IntentSource;
  world: World;
  renderer: Renderer;
  resetInput: () => void;
  syncArtifactModal: () => boolean;
  chooseArtifact: (id: ArtifactId) => boolean;
};

export function installHarness(deps: HarnessDeps): void {
  const { loop, intent, world, renderer, resetInput, syncArtifactModal, chooseArtifact } = deps;

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
    glSceneRTMean: () => renderer.glSceneRTMean(),
    stats: () => renderer.stats(),
    profileFrames: (n) => renderer.profileFrames(n),
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
}
