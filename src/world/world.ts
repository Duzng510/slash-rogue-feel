import { CONFIG, isScripted, type EnemyKind } from "../config.ts";
import { dist, makeRng, shuffle } from "../mathx.ts";
import { EventQueue, sfx } from "../events.ts";
import { ParticlePool } from "../systems/particles.ts";
import { resolveHits, resolveFire, hitFeedback, instantSwing } from "../systems/combat.ts";
import { resolveProjectiles } from "../systems/projectiles.ts";
import { ARTIFACTS, ARTIFACT_UNLOCKS, CURSES, CURSE_UNLOCKS, type Artifact, type ArtifactId, type Curse, type CurseId, type FireTrail } from "../systems/artifacts.ts";
import { emptyStats, resetStats, type RunStats, type EndMode } from "../systems/runStats.ts";
import {
  type Achievements,
  type AchievementId,
  type BestRun,
  emptyAchievements,
  isUnlocked,
  checkAchievements,
} from "../systems/unlocks.ts";
import { Player } from "../entities/player.ts";
import { CHARACTERS, CHARACTER_LIST, type CharacterId } from "../systems/characters.ts";
import { WEAPON_LIST, type WeaponId } from "../systems/weapons.ts";
import { Enemy, makeEnemy, resetEnemyIds } from "../entities/enemy.ts";
import { Npc } from "../entities/npc.ts";
import { Room, TOWN_TEMPLATE, TEMPLATES, TILE } from "../world/rooms.ts";
import { SpatialGrid } from "./grid.ts";
import { selectWaveSpawns } from "./spawning.ts";
import { progressWorld } from "./progress.ts";
import { applyAscension, normalizeAscensionLevel, type AscensionLevel } from "../systems/ascension.ts";
import { BIOMES, biomeForRoom, type Biome } from "../systems/biomes.ts";
import {
  type ActiveDialogue,
  GATE_DIALOGUE,
  GUARD_DIALOGUE,
  MASTER_DIALOGUE,
  MASTER_LOCKED_DIALOGUE,
  MERCHANT_DIALOGUE,
  type Dialogue,
  type DialogueAction,
} from "../systems/dialogue.ts";
import type { DamageCarrier, Decal, Intent, Projectile, Sim, Unit } from "../sim/types.ts";

export type ShopOffer = {
  kind: "artifact" | "heal" | "maxhp" | "curse";
  price: number;
  artifact?: Artifact;
};

export type RoomChoiceOffer = {
  title: string;
  subtitle: string;
  choices: { id: string; label: string; detail: string; disabled?: boolean }[];
};

export type EventKind = "well" | "altar";

export type TownProp = { x: number; y: number; sprite: string };

export const INTRO_LINES: Record<CharacterId, string> = {
  swordsman: "Một nhát là đủ.",
  mage: "Lửa sẽ nuốt tất cả.",
  tank: "Đứng yên, ta lo.",
};

export type SceneMode = "town" | "dungeon";

export class World implements Sim {
  readonly queue = new EventQueue();
  readonly particles = new ParticlePool();
  readonly player = new Player();
  readonly grid = new SpatialGrid();

  mode: SceneMode = "town";
  units: Unit[] = [];
  enemies: Enemy[] = [];
  npcList: Npc[] = [];
  townProps: TownProp[] = [];
  nearbyNpc: Npc | null = null;
  room!: Room;
  /** Seeded sim stream: combat rolls, wave/spawn choices, and ordinary particle bursts. */
  rng = makeRng(CONFIG.SEED);
  hitStopTicks = 0;
  roomIndex = 0;
  readonly roomTotal = TEMPLATES.length;
  currentBiome: Biome = biomeForRoom(0);
  ascensionLevel: AscensionLevel = 0;
  /** what the player last picked; restart keeps this instead of jumping back to ascensionMax */
  lastChosenAscension: AscensionLevel = 0;
  bannerTicks = 0;
  bannerDuration = 96;
  bannerText = "";
  /** run-start walk-in; >0 while the hero enters and enemies hold */
  introTicks = 0;
  introLine = "";
  introLineTicks = 0;
  private introDx = 1;
  private introDy = 0;
  victory = false;
  playerDeadTicks = 0;
  tickCount = 0;
  runStats: RunStats = emptyStats();
  pendingEnd: EndMode | null = null;
  achievements: Achievements = emptyAchievements();
  /** achievements first earned during the current run; shown on the end screen */
  runAchievements: AchievementId[] = [];

  readonly artifacts = new Set<ArtifactId>();
  artifactChoices: Artifact[] = [];
  /** open build choice while non-empty; the composition root owns the modal */
  characterChoices: CharacterId[] = [];
  weaponChoices: WeaponId[] | null = null;
  readonly curses = new Set<CurseId>();
  curseOffer: { artifacts: Artifact[]; curses: Curse[] } | null = null;
  curseTab = false;
  shopOffers: ShopOffer[] | null = null;
  roomChoices: RoomChoiceOffer | null = null;
  dialogue: ActiveDialogue | null = null;
  decals: Decal[] = [];
  fireTrails: FireTrail[] = [];
  projectiles: Projectile[] = [];
  rewardedRooms = new Set<number>();
  private gateCooldown = 0;
  private townBellCd = 0;
  /** Reward RNG is isolated so shop/artifact choices cannot perturb combat outcomes. */
  artifactRng = makeRng(CONFIG.SEED);
  private swingSeq = 1;
  private lastKills = 0;
  private lastRooms = 0;
  private lastArtifacts = 0;
  private lastTaken = 0;
  private bossIntroPending = false;
  restUsed = false;
  eventKind: EventKind | null = null;
  challengeWave = 0;
  challengeBreakTicks = -1;

  constructor(seed: number = CONFIG.SEED, achievements: Achievements = emptyAchievements()) {
    this.rng = makeRng(seed);
    this.artifactRng = makeRng(seed ^ 0xb001);
    this.achievements = achievements;
    this.ascensionLevel = normalizeAscensionLevel(achievements.ascensionMax);
    this.lastChosenAscension = this.ascensionLevel;
    applyAscension(CONFIG, this.ascensionLevel);
    this.enterTown();
    this.characterChoices = [...CHARACTER_LIST];
  }

  spawnChallengeWave(): void {
    const pool = this.currentBiome.enemyPool.filter((kind) => !isScripted(kind));
    const safePool = pool.length > 0 ? pool : ["chaser" as EnemyKind];
    const centerX = this.room.widthPx / 2;
    const centerY = this.room.heightPx / 2;
    const count = this.challengeWave + CONFIG.ROOMS.CHALLENGE_BASE_COUNT;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.challengeWave * 0.41;
      const kind = safePool[Math.floor(this.rng.next() * safePool.length)]!;
      this.spawnEnemy(centerX + Math.cos(angle) * CONFIG.ROOMS.CHALLENGE_RING_X, centerY + Math.sin(angle) * CONFIG.ROOMS.CHALLENGE_RING_Y, kind);
    }
    this.syncUnits();
    this.banner(`ĐỢT ${this.challengeWave}/${CONFIG.ROOMS.CHALLENGE_WAVES}`);
  }

  setAscensionLevel(level: number): boolean {
    if (!Number.isFinite(level)) return false;
    const next = normalizeAscensionLevel(level);
    if (next > this.achievements.ascensionMax) return false;
    if (next === this.ascensionLevel) {
      applyAscension(CONFIG, next);
      return false;
    }
    this.ascensionLevel = next;
    this.lastChosenAscension = next;
    applyAscension(CONFIG, next);
    return true;
  }

  pickCharacter(id: CharacterId): boolean {
    if (!this.characterChoices.includes(id)) return false;
    this.player.character = id;
    this.player.maxHp = CHARACTERS[id].baseHp;
    if (this.artifacts.has("glasscannon")) this.applyGlasscannon();
    this.player.hp = this.player.maxHp;
    this.characterChoices = [];
    this.weaponChoices = [...WEAPON_LIST];
    return true;
  }

  pickWeapon(id: WeaponId): boolean {
    if (this.weaponChoices === null || !this.weaponChoices.includes(id)) return false;
    this.player.weapon = id;
    this.weaponChoices = null;
    return true;
  }

  nextSwingId(): number {
    return this.swingSeq++;
  }

  hitUnit(target: Unit, carrier: DamageCarrier, cx: number, cy: number): boolean {
    return target.onHit(carrier, cx, cy, this);
  }

  spawnEnemy(x: number, y: number, kind: EnemyKind = "chaser", elite = false): void {
    if (this.aliveEnemies() >= CONFIG.ENEMY.MAX_ALIVE) return;
    this.enemies.push(makeEnemy(x, y, kind, elite));
  }

  loadRoom(index: number, keepSweep = true): void {
    this.mode = "dungeon";
    this.npcList = [];
    this.townProps = [];
    this.nearbyNpc = null;
    // iris-wipe transition centred on where the player stood at the door
    this.queue.push({ t: "roomTransition", x: this.player.x, y: this.player.y });
    const previousBiome = this.currentBiome.id;
    this.roomIndex = ((index % this.roomTotal) + this.roomTotal) % this.roomTotal;
    this.currentBiome = biomeForRoom(this.roomIndex);
    const biomeChanged = previousBiome !== this.currentBiome.id;
    this.room = new Room(TEMPLATES[this.roomIndex], this.roomIndex);
    resetEnemyIds();
    this.enemies = [];
    this.decals = [];
    this.fireTrails = [];
    this.projectiles = [];
    this.artifactChoices = [];
    this.curseOffer = null;
    this.curseTab = false;
    this.shopOffers = null;
    this.roomChoices = null;
    this.restUsed = false;
    this.eventKind = null;
    this.challengeWave = this.room.kind === "challenge" ? 1 : 0;
    this.challengeBreakTicks = -1;
    this.runStats.roomKills = 0;
    this.hitStopTicks = 0;
    for (const s of selectWaveSpawns(this.room, this.currentBiome, this.roomIndex, this.rng)) {
      const elite = this.room.kind === "elite" ||
        this.room.kind !== "challenge" && !isScripted(s.kind) && this.rng.next() < 0.15;
      this.spawnEnemy(s.x, s.y, s.kind, elite);
    }
    this.bossIntroPending = this.enemies.some((enemy) => enemy.kind === "boss" || enemy.kind === "king");
    this.syncUnits();
    this.player.reset(this.room.start.x, this.room.start.y);
    if (keepSweep) this.particles.reset();
    this.victory = false;
    this.banner(this.room.kind === "elite" ? "TINH ANH" :
      biomeChanged ? `VÀO ${this.currentBiome.name.toLocaleUpperCase("vi-VN")}` : `${this.roomIndex + 1}/${this.roomTotal}  ${this.room.name}`,
    biomeChanged && this.room.kind !== "elite" ? 60 : 96);
  }

  banner(text: string, duration = 96): void {
    this.bannerText = text;
    this.bannerTicks = duration;
    this.bannerDuration = duration;
  }

  /** start the entrance: hero walks in through the gap in the left wall, then says their line */
  beginIntro(): void {
    this.introTicks = 120;
    this.introDx = 1;
    this.introDy = 0;
    this.player.x = CONFIG.WORLD.TILE / 2;
    this.player.y = this.room.start.y;
  }

  /** zero per-run stats and achievement-delta bookkeeping, keeping object identities alive */
  private resetRun(): void {
    resetStats(this.runStats);
    // a fresh run starts its periodic phases (heartbeat/bot cadence) from zero, not wherever the last run ended
    this.tickCount = 0;
    this.runAchievements = [];
    this.lastKills = 0;
    this.lastRooms = 0;
    this.lastArtifacts = 0;
    this.lastTaken = 0;
    this.pendingEnd = null;
    this.playerDeadTicks = 0;
    this.player.weaponDamageBonus = 0;
  }

  /** full run reset from the end screen: fresh stats, no artifacts, back to town */
  restart(): void {
    this.resetRun();
    this.setAscensionLevel(this.lastChosenAscension);
    this.artifacts.clear();
    this.curses.clear();
    this.player.maxHp = CHARACTERS[this.player.character].baseHp;
    this.rewardedRooms.clear();
    this.characterChoices = [...CHARACTER_LIST];
    this.weaponChoices = null;
    this.dialogue = null;
    this.gateCooldown = 0;
    this.enterTown();
  }

  /** after a win, keep the artifacts and start the next run from room 0 with fresh stats */
  continueAfterWin(): void {
    this.resetRun();
    this.setAscensionLevel(this.lastChosenAscension);
    this.rewardedRooms.clear();
    this.characterChoices = [...CHARACTER_LIST];
    this.weaponChoices = null;
    this.dialogue = null;
    this.gateCooldown = 0;
    this.loadRoom(0);
  }

  enterTown(): void {
    this.mode = "town";
    this.dialogue = null;
    this.gateCooldown = 0;
    this.loadTown();
  }

  enterDungeon(playIntro = true): void {
    this.mode = "dungeon";
    this.nearbyNpc = null;
    this.dialogue = null;
    this.gateCooldown = 0;
    this.loadRoom(0, false);
    if (playIntro) this.beginIntro();
  }

  private loadTown(): void {
    this.queue.push({ t: "roomTransition", x: this.player.x, y: this.player.y });
    this.currentBiome = BIOMES.town;
    this.room = new Room(TOWN_TEMPLATE, -1);
    this.room.openDoors();
    this.roomIndex = -1;
    this.enemies = [];
    this.decals = [];
    this.fireTrails = [];
    this.projectiles = [];
    this.hitStopTicks = 0;
    this.bossIntroPending = false;
    this.introTicks = 0;
    this.dialogue = null;
    this.gateCooldown = 0;
    this.townBellCd = 240;
    this.syncUnits();
    this.player.reset(this.room.start.x, this.room.start.y);
    this.npcList = [
      new Npc(40, 60, "character_master"),
      new Npc(136, 76, "merchant"),
      new Npc(264, 124, "guard"),
    ];
    this.townProps = [
      { x: 120, y: 92, sprite: "prop_well" },
      { x: 60, y: 140, sprite: "prop_tree" },
      { x: 240, y: 60, sprite: "prop_tree" },
      { x: 344, y: 108, sprite: "prop_signpost" },
      { x: 24, y: 56, sprite: "prop_lantern" },
      { x: 296, y: 56, sprite: "prop_lantern" },
    ];
    this.nearbyNpc = null;
    this.victory = false;
    this.banner("Thị trấn", 96);
  }

  syncUnits(): void {
    this.units.length = 0;
    this.units.push(this.player);
    for (const e of this.enemies) if (!e.removed) this.units.push(e);
  }

  aliveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  private applyGlasscannon(): void {
    this.player.maxHp = 3;
    this.player.hp = Math.min(this.player.hp, 3);
  }

  chooseArtifact(id: ArtifactId): boolean {
    if (this.room.kind === "shrine" || this.room.kind === "event" && this.curseOffer !== null) return false;
    if (!this.artifactChoices.some(b => b.id === id) || this.artifacts.has(id)) return false;
    this.artifacts.add(id);
    if (id === "glasscannon") this.applyGlasscannon();
    this.rewardedRooms.add(this.roomIndex);
    this.runStats.artifactsTaken++;
    this.artifactChoices = [];
    this.curseOffer = null;
    this.curseTab = false;
    this.room.openDoors();
    sfx(this.queue, "door");
    this.banner(`${ARTIFACTS.find(b => b.id === id)!.name} — cửa mở`);
    return true;
  }

  chooseRoomOption(index: number): boolean {
    const offer = this.roomChoices;
    const choice = offer?.choices[index];
    if (offer === null || choice === undefined || choice.disabled) return false;
    if (this.room.kind === "rest") {
      if (choice.id === "rest") this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
      else if (choice.id === "forge" && this.player.weaponDamageBonus < CONFIG.ROOMS.FORGE_CAP) this.player.weaponDamageBonus++;
      else return false;
      this.restUsed = true;
      this.roomChoices = null;
      this.rewardedRooms.add(this.roomIndex);
      this.room.openDoors();
      this.banner(choice.id === "rest" ? "Đã nghỉ ngơi" : `Rèn vũ khí +${this.player.weaponDamageBonus} sát thương`);
      return true;
    }
    if (this.room.kind !== "event" || this.eventKind === null) return false;
    if (this.eventKind === "well") {
      if (choice.id === "drink") {
        const gain = this.artifactRng.next() < 0.5;
        if (gain) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
        else {
          const sw = instantSwing(this, { side: "enemy", dir: 0, ox: this.player.x, oy: this.player.y, dmg: 1 });
          this.player.onHit(sw, this.player.x, this.player.y, this);
        }
        return this.finishRoomChoice(gain ? "Giếng cổ: +2 HP" : "Giếng cổ: -1 HP");
      }
      if (choice.id === "gold") {
        if (this.runStats.gold < CONFIG.ROOMS.WELL_COST) return false;
        const pool = this.availableArtifacts();
        if (pool.length === 0) return false;
        this.runStats.gold -= CONFIG.ROOMS.WELL_COST;
        this.grantArtifact(pool[Math.floor(this.artifactRng.next() * pool.length)]!);
        return this.finishRoomChoice("Vàng đổi lấy cổ vật");
      }
    } else {
      if (choice.id === "sacrifice") {
        if (this.player.hp <= CONFIG.ROOMS.SACRIFICE_HP) return false;
        this.player.hp -= CONFIG.ROOMS.SACRIFICE_HP;
        this.player.maxHp++;
        return this.finishRoomChoice("Bàn thờ máu: +1 HP tối đa");
      }
      if (choice.id === "prayer") {
        const curse = this.availableCurses()[0];
        const artifacts = this.availableArtifacts();
        if (curse === undefined || artifacts.length < 2) return false;
        this.roomChoices = null;
        this.artifactChoices = artifacts.slice(0, 2);
        this.curseOffer = { artifacts: this.artifactChoices.slice(), curses: [curse] };
        this.curseTab = true;
        return true;
      }
    }
    if (choice.id === "leave") return this.finishRoomChoice("Đã rời sự kiện");
    return false;
  }

  private finishRoomChoice(message: string): boolean {
    this.roomChoices = null;
    this.eventKind = null;
    this.rewardedRooms.add(this.roomIndex);
    this.room.openDoors();
    this.banner(message);
    return true;
  }

  openDialogue(source: Dialogue): void {
    this.dialogue = { source, nodeId: source.start, charIndex: 0 };
  }

  dialogueFullyShown(): boolean {
    if (this.dialogue === null) return true;
    const node = this.dialogue.source.nodes[this.dialogue.nodeId];
    return !node || this.dialogue.charIndex >= node.text.length;
  }

  finishDialogueText(): void {
    if (this.dialogue === null) return;
    const node = this.dialogue.source.nodes[this.dialogue.nodeId];
    if (node) this.dialogue.charIndex = node.text.length;
  }

  closeDialogue(): void {
    this.dialogue = null;
  }

  closeDialogueByUser(): boolean {
    if (this.dialogue === null) return false;
    if (!this.dialogueFullyShown()) {
      this.finishDialogueText();
      return true;
    }
    this.dialogue = null;
    return true;
  }

  chooseDialogueOption(idx: number): boolean {
    const d = this.dialogue;
    if (d === null) return false;
    if (!this.dialogueFullyShown()) {
      this.finishDialogueText();
      return true;
    }
    const node = d.source.nodes[d.nodeId];
    if (!node) return false;
    if (idx < 0 || idx >= node.options.length) return false;
    this.applyDialogueAction(node.options[idx].action);
    return true;
  }

  private applyDialogueAction(action: DialogueAction): void {
    switch (action.t) {
      case "close":
        this.closeDialogue();
        break;
      case "next":
        if (this.dialogue) {
          this.dialogue.nodeId = action.node;
          this.dialogue.charIndex = 0;
        }
        break;
      case "shop":
        this.closeDialogue();
        this.shopOffers = this.buildShopOffers();
        sfx(this.queue, "door");
        break;
      case "character_select":
        this.closeDialogue();
        this.characterChoices = [...CHARACTER_LIST];
        this.weaponChoices = null;
        break;
      case "enter_dungeon":
        this.closeDialogue();
        this.enterDungeon();
        break;
      case "banner":
        this.closeDialogue();
        this.banner(action.text, 120);
        break;
      case "retreat":
        this.closeDialogue();
        this.player.x -= CONFIG.TOWN.RETREAT_PUSH;
        this.player.vx = 0;
        this.gateCooldown = CONFIG.TOWN.GATE_COOLDOWN_TICKS;
        this.banner("Hãy chuẩn bị kỹ.", 90);
        break;
    }
  }

  availableArtifacts(): Artifact[] {
    return ARTIFACTS.filter((artifact) => {
      if (this.artifacts.has(artifact.id)) return false;
      const gate = ARTIFACT_UNLOCKS[artifact.id];
      return gate === null || isUnlocked(gate, this.achievements);
    });
  }

  availableCurses(): Curse[] {
    return CURSES.filter((curse) => !this.curses.has(curse.id) &&
      (CURSE_UNLOCKS[curse.id] === null || this.achievements.earned.has(CURSE_UNLOCKS[curse.id]!)));
  }

  private grantArtifact(artifact: Artifact): void {
    this.artifacts.add(artifact.id);
    if (artifact.id === "glasscannon") this.applyGlasscannon();
    this.runStats.artifactsTaken++;
  }

  /** buy one shop offer; rejects when the offer is gone or gold is short */
  chooseShop(i: number): boolean {
    const offer = this.shopOffers?.[i];
    if (offer === undefined || this.runStats.gold < offer.price) return false;
    this.runStats.gold -= offer.price;
    if (offer.kind === "artifact" && offer.artifact !== undefined) {
      this.artifacts.add(offer.artifact.id);
      if (offer.artifact.id === "glasscannon") this.applyGlasscannon();
      this.runStats.artifactsTaken++;
    } else if (offer.kind === "heal") {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2 * CONFIG.ASCENSION.playerHealMultiplier);
    } else if (offer.kind === "maxhp") {
      this.player.maxHp++;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + CONFIG.ASCENSION.playerHealMultiplier);
    } else {
      const first = [...this.curses][0];
      if (first !== undefined) this.removeCurse(first);
    }
    this.shopOffers!.splice(i, 1);
    if (this.shopOffers!.length === 0) this.shopOffers = null;
    sfx(this.queue, "pursuit_proc", 0.6, 1.2);
    return true;
  }

  leaveShop(): void {
    this.shopOffers = null;
    this.closeDialogue();
  }

  buildShopOffers(): ShopOffer[] {
    const pool: ShopOffer[] = [
      { kind: "heal", price: CONFIG.SHOP.HEAL },
      { kind: "maxhp", price: CONFIG.SHOP.MAXHP },
    ];
    const arts = ARTIFACTS.filter(b => {
      if (this.artifacts.has(b.id)) return false;
      const gate = ARTIFACT_UNLOCKS[b.id];
      return gate === null || isUnlocked(gate, this.achievements);
    });
    if (arts.length > 0) {
      pool.push({ kind: "artifact", price: CONFIG.SHOP.ARTIFACT, artifact: arts[Math.floor(this.artifactRng.next() * arts.length)] });
    }
    if (this.curses.size > 0) pool.push({ kind: "curse", price: CONFIG.SHOP.CURSE });
    shuffle(pool, this.artifactRng.next);
    return pool.slice(0, 3).map((offer) => ({
      ...offer,
      price: Math.ceil(offer.price * CONFIG.ASCENSION.shopPriceMultiplier),
    }));
  }

  /** bank this run's earnings into the persisted lifetime total, then check the rich achievement */
  endRun(): void {
    this.runStats.finalHp = this.player.hp;
    this.achievements.totalGold += this.runStats.totalGoldEarned;
    if (this.victory) {
      this.achievements.charactersWon.add(this.player.character);
      if (this.achievements.charactersWon.size >= CHARACTER_LIST.length) {
        this.awardAchievements(["soul_collector"]);
      }
      this.achievements.weaponsWon.add(this.player.weapon);
      if (this.achievements.weaponsWon.size >= WEAPON_LIST.length) {
        this.awardAchievements(["master_of_arms"]);
      }
    }
    this.awardAchievements(checkAchievements(this.runStats, "end", this.achievements.totalGold));
  }

  /** accept a curse package: the curse plus both bundled artifacts, then the door opens */
  chooseCurse(id: CurseId): boolean {
    const offer = this.curseOffer;
    if (offer === null || !offer.curses.some(c => c.id === id)) return false;
    this.curses.add(id);
    this.runStats.cursesTaken++;
    if (id === "frail") {
      this.player.maxHp = Math.max(1, this.player.maxHp - CONFIG.CURSES.FRAIL_HP);
      this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    }
    for (const a of offer.artifacts) {
      this.artifacts.add(a.id);
      if (a.id === "glasscannon") this.applyGlasscannon();
    }
    this.runStats.artifactsTaken += offer.artifacts.length;
    this.rewardedRooms.add(this.roomIndex);
    this.artifactChoices = [];
    this.curseOffer = null;
    this.curseTab = false;
    this.room.openDoors();
    sfx(this.queue, "door");
    this.banner(`${CURSES.find(c => c.id === id)!.name} — cửa mở`);
    return true;
  }

  /** undo a curse's one-time stat change; live-read curses (speed/startup) clear with the id */
  private removeCurse(id: CurseId): void {
    if (!this.curses.delete(id)) return;
    if (id === "frail") {
      this.player.maxHp += CONFIG.CURSES.FRAIL_HP;
    }
  }

  /** mark ids earned (dedup) and queue a toast per new one; the composition root persists */
  awardAchievements(ids: AchievementId[]): void {
    for (const id of ids) {
      if (this.achievements.earned.has(id)) continue;
      this.achievements.earned.add(id);
      this.runAchievements.push(id);
      this.queue.push({ t: "achievement", id });
    }
  }

  /** record this run as the personal best when it clears more rooms, or ties and is faster */
  saveBestRun(): void {
    const s = this.runStats;
    const candidate: BestRun = {
      time: s.ticksElapsed,
      rooms: s.roomsCleared,
      kills: s.enemiesKilled,
      artifacts: s.artifactsTaken,
    };
    const cur = this.achievements.best;
    const better =
      cur === null ||
      candidate.rooms > cur.rooms ||
      (candidate.rooms === cur.rooms && candidate.time < cur.time);
    if (better) this.achievements.best = candidate;
  }

  tick(input: Intent): void {
    if (this.weaponChoices !== null) return;
    if (this.artifactChoices.length > 0) return;
    if (this.shopOffers !== null) return;
    if (this.roomChoices !== null) return;
    if (this.pendingEnd !== null) return;
    if (this.dialogue !== null) {
      const node = this.dialogue.source.nodes[this.dialogue.nodeId];
      if (node) {
        this.dialogue.charIndex = Math.min(node.text.length, this.dialogue.charIndex + CONFIG.DIALOGUE.CHARS_PER_SECOND * CONFIG.TIME.TICK);
      }
      if (!input.interact) return;
    }

    if (this.mode === "dungeon" && this.bossIntroPending) {
      this.bossIntroPending = false;
      const boss = this.enemies.find((enemy) => enemy.kind === "boss" || enemy.kind === "king");
      if (boss !== undefined) {
        this.hitStopTicks = Math.max(this.hitStopTicks, 60);
        const name = boss.kind === "king" ? "VUA LÃNG QUÊN" : "BẠO CHÚA";
        this.queue.push({ t: "bossIntro", name, x: boss.x, y: boss.y });
      }
    }
    this.tickCount++;
    if (this.bannerTicks > 0) this.bannerTicks--;
    if (this.introLineTicks > 0) this.introLineTicks--;

    if (this.hitStopTicks > 0) {
      this.hitStopTicks--;
      return;
    }

    this.runStats.ticksElapsed++;

    if (this.mode === "town") {
      this.tickTown(input);
      return;
    }
    this.tickDungeon(input);
  }

  private tickTown(input: Intent): void {
    this.player.tick({ ...input, attack: false, skill: false }, this);

    const radius = CONFIG.TOWN.NPC_INTERACT_RADIUS;
    let nearest: Npc | null = null;
    let nearestDist = radius;
    for (const npc of this.npcList) {
      const d = dist(this.player.x, this.player.y, npc.x, npc.y);
      if (d <= nearestDist) {
        nearestDist = d;
        nearest = npc;
      }
    }
    this.nearbyNpc = nearest;

    if (this.dialogue !== null) {
      if (input.interact) this.closeDialogue();
      return;
    }

    if (nearest !== null) {
      nearest.faceToward(this.player.x);
      if (input.interact) this.interactNpc(nearest);
    }
    for (const npc of this.npcList) npc.tick();

    this.syncUnits();
    this.grid.clear();
    for (const u of this.units) this.grid.insert(u);

    if (this.dialogue !== null) return;

    if (this.townBellCd > 0) this.townBellCd--;
    else {
      this.townBellCd = CONFIG.TOWN.BELL_TICKS;
      sfx(this.queue, "town_bell", 0.6, 1);
    }

    if (this.gateCooldown > 0) this.gateCooldown--;
    if (this.gateCooldown <= 0 && this.room.exitsAt(this.player.x, this.player.y)) {
      this.openDialogue(GATE_DIALOGUE);
      return;
    }
  }

  private interactNpc(npc: Npc): void {
    switch (npc.kind) {
      case "merchant":
        sfx(this.queue, "door");
        this.openDialogue(MERCHANT_DIALOGUE);
        break;
      case "guard":
        this.banner("Hầm ngục ở phía đông — chúc may mắn.", 120);
        sfx(this.queue, "pursuit_proc", 0.5, 1.2);
        this.openDialogue(GUARD_DIALOGUE);
        break;
      case "character_master":
        if (this.runStats.enemiesKilled > 0 || this.artifacts.size > 0) {
          this.banner("Đã vào hầm ngục, không thể đổi nữa.", 120);
          this.openDialogue(MASTER_LOCKED_DIALOGUE);
        } else {
          this.openDialogue(MASTER_DIALOGUE);
        }
        break;
    }
  }

  private tickDungeon(input: Intent): void {
    const intro = this.introTicks > 0;
    if (intro) this.introTicks--;
    const s = this.room.start;
    const walkingIn = intro && (s.x - this.player.x) * this.introDx + (s.y - this.player.y) * this.introDy > 1.5 &&
      this.introTicks > 0;
    this.player.tick(
      walkingIn ? { moveX: this.introDx, moveY: this.introDy, aimX: NaN, aimY: NaN, attack: false, dash: false, skill: false, interact: false } : input,
      this,
    );
    if (intro && !walkingIn) {
      this.introTicks = 0;
      this.player.reset(this.room.start.x, this.room.start.y);
      this.introLine = INTRO_LINES[this.player.character];
      this.introLineTicks = 180;
    }
    // snapshot: a summon/split must not tick inside the same iteration that spawned it
    if (!intro) for (const e of this.enemies.slice()) e.tick(this, this.grid);
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.syncUnits();
    this.grid.clear();
    for (const u of this.units) this.grid.insert(u);

    resolveHits(this, this.grid);
    resolveFire(this);
    resolveProjectiles(this);
    this.resolveTraps();
    progressWorld(this);
    this.detectAchievements();
  }

  /** spikes hurt both sides once, then stay spent; i-frames and dash still dodge them */
  private resolveTraps(): void {
    const T = CONFIG.WORLD.TILE;
    for (const u of this.units) {
      const tx = Math.floor(u.x / T);
      const ty = Math.floor(u.y / T);
      if (this.room.at(tx, ty) !== TILE.TRAP || !u.canBeHit()) continue;
      const sw = instantSwing(this, { side: "enemy", dir: 0, ox: u.x, oy: u.y, dmg: CONFIG.ROOMS.TRAP_DMG * CONFIG.ASCENSION.trapDamageMultiplier });
      const killed = u.onHit(sw, u.x, u.y, this);
      hitFeedback(this, u, sw, u.x, u.y, killed, false);
      this.room.setTile(tx, ty, TILE.TRAP_ARMED);
    }
  }

  /** fire the check whose counter moved since last tick; a fresh hit breaks the kill streak */
  private detectAchievements(): void {
    const s = this.runStats;
    if (s.damageTaken !== this.lastTaken) {
      this.lastTaken = s.damageTaken;
      s.killStreak = 0;
    }
    if (s.enemiesKilled !== this.lastKills) {
      this.lastKills = s.enemiesKilled;
      this.awardAchievements(checkAchievements(s, "kill"));
    }
    if (s.roomsCleared !== this.lastRooms) {
      this.lastRooms = s.roomsCleared;
      this.awardAchievements(checkAchievements(s, "room"));
    }
    if (s.artifactsTaken !== this.lastArtifacts) {
      this.lastArtifacts = s.artifactsTaken;
      this.awardAchievements(checkAchievements(s, "artifact"));
    }
  }

  /** debug helper: F6 stress-tests readability without touching the wave table */
  addEnemies(n: number, kinds: EnemyKind[] = ["chaser", "charger", "splitter"], elite = false): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnEnemy(this.player.x + Math.cos(a) * 40, this.player.y + Math.sin(a) * 30, kinds[i % kinds.length] ?? "chaser", elite);
    }
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.syncUnits();
  }

  /** debug helper: isolate one archetype for a readability shot */
  clearEnemies(): void {
    this.enemies = [];
    this.syncUnits();
  }
}
