import { CONFIG, type EnemyKind } from "../config.ts";
import { makeRng } from "../mathx.ts";
import { EventQueue, sfx } from "../events.ts";
import { ParticlePool } from "../systems/particles.ts";
import { resolveHits, resolveFire, createSwing, hitFeedback } from "../systems/combat.ts";
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
import { Enemy, makeEnemy, resetEnemyIds } from "../entities/enemy.ts";
import { Room, TEMPLATES, TILE, type SpawnMark } from "../world/rooms.ts";
import { SpatialGrid } from "./grid.ts";
import type { Intent, Projectile, Sim, Unit } from "../sim/types.ts";

export type ShopOffer = {
  kind: "artifact" | "heal" | "maxhp" | "curse";
  price: number;
  artifact?: Artifact;
};

export class World implements Sim {
  readonly queue = new EventQueue();
  readonly particles = new ParticlePool();
  readonly player = new Player();
  readonly grid = new SpatialGrid();

  units: Unit[] = [];
  enemies: Enemy[] = [];
  room: Room;
  rng = makeRng(CONFIG.SEED);
  hitStopTicks = 0;
  roomIndex = 0;
  readonly roomTotal = TEMPLATES.length;
  bannerTicks = 0;
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
  readonly curses = new Set<CurseId>();
  curseOffer: { artifacts: Artifact[]; curses: Curse[] } | null = null;
  curseTab = false;
  shopOffers: ShopOffer[] | null = null;
  fireTrails: FireTrail[] = [];
  projectiles: Projectile[] = [];
  private rewardedRooms = new Set<number>();
  private artifactRng = makeRng(CONFIG.SEED);
  private swingSeq = 1;
  private lastKills = 0;
  private lastRooms = 0;
  private lastArtifacts = 0;
  private lastTaken = 0;

  constructor(seed: number = CONFIG.SEED, achievements: Achievements = emptyAchievements()) {
    this.rng = makeRng(seed);
    this.artifactRng = makeRng(seed ^ 0xb001);
    this.achievements = achievements;
    this.room = new Room(TEMPLATES[0], 0);
    this.loadRoom(0, false);
    this.characterChoices = [...CHARACTER_LIST];
  }

  pickCharacter(id: CharacterId): boolean {
    if (!this.characterChoices.includes(id)) return false;
    this.player.character = id;
    this.player.maxHp = CHARACTERS[id].baseHp;
    this.player.hp = this.player.maxHp;
    this.characterChoices = [];
    this.beginIntro();
    return true;
  }

  nextSwingId(): number {
    return this.swingSeq++;
  }

  spawnEnemy(x: number, y: number, kind: EnemyKind = "chaser", elite = false): void {
    if (this.aliveEnemies() >= CONFIG.ENEMY.MAX_ALIVE) return;
    this.enemies.push(makeEnemy(x, y, kind, elite));
  }

  /** pick `count` trash markers, deterministic by seed; boss markers always field */
  private waveSpawns(index: number): SpawnMark[] {
    const want = CONFIG.ROOMS.WAVES[index] ?? this.room.spawns.length;
    const bosses = this.room.spawns.filter(s => s.kind === "boss" || s.kind === "warden");
    const pool = this.room.spawns.filter(s => s.kind !== "boss" && s.kind !== "warden");
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    return [...bosses, ...pool.slice(0, Math.max(0, want - bosses.length))];
  }

  loadRoom(index: number, keepSweep = true): void {
    this.roomIndex = ((index % this.roomTotal) + this.roomTotal) % this.roomTotal;
    this.room = new Room(TEMPLATES[this.roomIndex], this.roomIndex);
    resetEnemyIds();
    this.enemies = [];
    this.fireTrails = [];
    this.projectiles = [];
    this.artifactChoices = [];
    this.curseOffer = null;
    this.curseTab = false;
    this.shopOffers = null;
    this.runStats.roomKills = 0;
    for (const s of this.waveSpawns(this.roomIndex)) {
      this.spawnEnemy(s.x, s.y, s.kind, s.kind !== "boss" && s.kind !== "warden" && this.rng.next() < 0.15);
    }
    this.syncUnits();
    this.player.reset(this.room.start.x, this.room.start.y);
    if (keepSweep) this.particles.reset();
    this.hitStopTicks = 0;
    this.victory = false;
    this.banner(`${this.roomIndex + 1}/${this.roomTotal}  ${this.room.name}`);
  }

  banner(text: string): void {
    this.bannerText = text;
    this.bannerTicks = 96;
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
    this.runAchievements = [];
    this.lastKills = 0;
    this.lastRooms = 0;
    this.lastArtifacts = 0;
    this.lastTaken = 0;
    this.pendingEnd = null;
    this.playerDeadTicks = 0;
  }

  /** full run reset from the end screen: fresh stats, no artifacts, back to room 0 */
  restart(): void {
    this.resetRun();
    this.artifacts.clear();
    this.curses.clear();
    this.player.maxHp = CHARACTERS[this.player.character].baseHp;
    this.rewardedRooms.clear();
    this.characterChoices = [...CHARACTER_LIST];
    this.loadRoom(0);
  }

  /** after a win, keep the artifacts and start the next run from room 0 with fresh stats */
  continueAfterWin(): void {
    this.resetRun();
    this.rewardedRooms.clear();
    this.characterChoices = [...CHARACTER_LIST];
    this.loadRoom(0);
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

  chooseArtifact(id: ArtifactId): boolean {
    if (!this.artifactChoices.some(b => b.id === id) || this.artifacts.has(id)) return false;
    this.artifacts.add(id);
    if (id === "glasscannon") {
      this.player.maxHp = 3;
      this.player.hp = Math.min(this.player.hp, 3);
    }
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

  /** buy one shop offer; rejects when the offer is gone or gold is short */
  chooseShop(i: number): boolean {
    const offer = this.shopOffers?.[i];
    if (offer === undefined || this.runStats.gold < offer.price) return false;
    this.runStats.gold -= offer.price;
    if (offer.kind === "artifact" && offer.artifact !== undefined) {
      this.artifacts.add(offer.artifact.id);
      if (offer.artifact.id === "glasscannon") {
        this.player.maxHp = 3;
        this.player.hp = Math.min(this.player.hp, 3);
      }
      this.runStats.artifactsTaken++;
    } else if (offer.kind === "heal") {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
    } else if (offer.kind === "maxhp") {
      this.player.maxHp++;
      this.player.hp++;
    } else {
      const first = [...this.curses][0];
      if (first !== undefined) this.curses.delete(first);
    }
    this.shopOffers!.splice(i, 1);
    if (this.shopOffers!.length === 0) this.shopOffers = null;
    sfx(this.queue, "pursuit_proc", 0.6, 1.2);
    return true;
  }

  leaveShop(): void {
    this.shopOffers = null;
  }

  private buildShopOffers(): ShopOffer[] {
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
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.artifactRng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  /** bank this run's earnings into the persisted lifetime total, then check the rich achievement */
  private endRun(): void {
    this.runStats.finalHp = this.player.hp;
    this.achievements.totalGold += this.runStats.totalGoldEarned;
    if (this.victory) {
      this.achievements.charactersWon.add(this.player.character);
      if (this.achievements.charactersWon.size >= CHARACTER_LIST.length) {
        this.awardAchievements(["soul_collector"]);
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
      if (a.id === "glasscannon") {
        this.player.maxHp = 3;
        this.player.hp = Math.min(this.player.hp, 3);
      }
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

  /** mark ids earned (dedup) and queue a toast per new one; the composition root persists */
  private awardAchievements(ids: AchievementId[]): void {
    for (const id of ids) {
      if (this.achievements.earned.has(id)) continue;
      this.achievements.earned.add(id);
      this.runAchievements.push(id);
      this.queue.push({ t: "achievement", id });
    }
  }

  /** record this run as the personal best when it clears more rooms, or ties and is faster */
  private saveBestRun(): void {
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
    if (this.artifactChoices.length > 0) return;
    if (this.shopOffers !== null) return;
    if (this.pendingEnd !== null) return;
    this.tickCount++;
    if (this.bannerTicks > 0) this.bannerTicks--;
    if (this.introLineTicks > 0) this.introLineTicks--;

    if (this.hitStopTicks > 0) {
      this.hitStopTicks--;
      return;
    }

    this.runStats.ticksElapsed++;
    const intro = this.introTicks > 0;
    if (intro) this.introTicks--;
    const s = this.room.start;
    const walkingIn = intro && (s.x - this.player.x) * this.introDx + (s.y - this.player.y) * this.introDy > 1.5 &&
      this.introTicks > 0;
    this.player.tick(
      walkingIn ? { moveX: this.introDx, moveY: this.introDy, aimX: NaN, aimY: NaN, attack: false, dash: false, skill: false } : input,
      this,
    );
    if (intro && !walkingIn) {
      this.introTicks = 0;
      this.player.reset(this.room.start.x, this.room.start.y);
      this.introLine = "Let's fight!";
      this.introLineTicks = 180;
    }
    if (!intro) for (const e of this.enemies) e.tick(this, this.grid);
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.syncUnits();
    this.grid.clear();
    for (const u of this.units) this.grid.insert(u);

    resolveHits(this, this.grid);
    resolveFire(this);
    resolveProjectiles(this);
    this.resolveTraps();
    this.progress(input);
    this.detectAchievements();
  }

  /** spikes hurt both sides once, then stay spent; i-frames and dash still dodge them */
  private resolveTraps(): void {
    const T = CONFIG.WORLD.TILE;
    for (const u of this.units) {
      const tx = Math.floor(u.x / T);
      const ty = Math.floor(u.y / T);
      if (this.room.at(tx, ty) !== TILE.TRAP || !u.canBeHit()) continue;
      const sw = createSwing(this, {
        side: "enemy",
        combo: 0,
        dir: 0,
        ox: u.x,
        oy: u.y,
        reach: 0,
        deg: 0,
        dmg: CONFIG.ROOMS.TRAP_DMG,
        knockback: 0,
        fd: { startup: 0, active: 1, recovery: 0 },
      });
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

  private progress(_input: Intent): void {
    if (this.player.dead) {
      this.playerDeadTicks++;
      if (this.pendingEnd === null && this.playerDeadTicks >= CONFIG.ROOMS.END_DELAY) {
        this.endRun();
        this.pendingEnd = "dead";
      }
      return;
    }

    if (this.room.shop) {
      if (!this.room.doorOpen) {
        this.room.openDoors();
        sfx(this.queue, "door");
      }
      if (!this.rewardedRooms.has(this.roomIndex)) {
        this.rewardedRooms.add(this.roomIndex);
        this.shopOffers = this.buildShopOffers();
      }
    } else if (this.aliveEnemies() === 0 && !this.room.doorOpen) {
      if (!this.rewardedRooms.has(this.roomIndex)) {
        const pool = ARTIFACTS.filter(b => {
          if (this.artifacts.has(b.id)) return false;
          const gate = ARTIFACT_UNLOCKS[b.id];
          return gate === null || isUnlocked(gate, this.achievements);
        });
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(this.artifactRng.next() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        this.artifactChoices = pool.slice(0, 3);
        if (this.runStats.roomsCleared % CONFIG.CURSES.OFFER_EVERY === 0 &&
          this.curses.size < CONFIG.CURSES.MAX_CURSES && pool.length >= 5) {
          const cursePool = CURSES.filter(c => !this.curses.has(c.id) &&
            (CURSE_UNLOCKS[c.id] === null || this.achievements.earned.has(CURSE_UNLOCKS[c.id]!)));
          for (let i = cursePool.length - 1; i > 0; i--) {
            const j = Math.floor(this.artifactRng.next() * (i + 1));
            [cursePool[i], cursePool[j]] = [cursePool[j], cursePool[i]];
          }
          this.curseOffer = { artifacts: pool.slice(3, 5), curses: cursePool.slice(0, 2) };
        }
        if (this.artifactChoices.length > 0) return;
      }
      this.room.openDoors();
      sfx(this.queue, "door");
      this.banner(this.roomIndex === this.roomTotal - 1 ? "Sạch quái — hết prototype" : "Sạch quái — cửa mở");
    }

    if (this.room.exitsAt(this.player.x, this.player.y)) {
      const last = this.roomIndex === this.roomTotal - 1;
      this.runStats.roomsCleared++;
      sfx(this.queue, "door", 0.8, 1.2);
      if (last) {
        this.victory = true;
        this.endRun();
        this.awardAchievements(checkAchievements(this.runStats, "win"));
        this.saveBestRun();
        this.pendingEnd = "won";
        this.banner("Thắng!");
        return;
      }
      this.loadRoom(this.roomIndex + 1);
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
