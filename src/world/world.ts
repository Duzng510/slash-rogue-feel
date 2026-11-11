import { CONFIG, type EnemyKind } from "../config.ts";
import { makeRng } from "../mathx.ts";
import { EventQueue, sfx } from "../events.ts";
import { ParticlePool } from "../systems/particles.ts";
import { resolveHits, resolveFire } from "../systems/combat.ts";
import { resolveProjectiles } from "../systems/projectiles.ts";
import { ARTIFACTS, ARTIFACT_UNLOCKS, type Artifact, type ArtifactId, type FireTrail } from "../systems/artifacts.ts";
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
import { Enemy, makeEnemy, resetEnemyIds } from "../entities/enemy.ts";
import { Room, TEMPLATES, type SpawnMark } from "../world/rooms.ts";
import { SpatialGrid } from "./grid.ts";
import type { Intent, Projectile, Sim, Unit } from "../sim/types.ts";

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
  }

  nextSwingId(): number {
    return this.swingSeq++;
  }

  spawnEnemy(x: number, y: number, kind: EnemyKind = "chaser"): void {
    if (this.aliveEnemies() >= CONFIG.ENEMY.MAX_ALIVE) return;
    this.enemies.push(makeEnemy(x, y, kind));
  }

  /** pick `count` of the template's spawn markers, deterministic by seed */
  private waveSpawns(index: number): SpawnMark[] {
    const want = CONFIG.ROOMS.WAVES[index] ?? this.room.spawns.length;
    const pool = this.room.spawns.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    return pool.slice(0, Math.min(want, pool.length));
  }

  loadRoom(index: number, keepSweep = true): void {
    this.roomIndex = ((index % this.roomTotal) + this.roomTotal) % this.roomTotal;
    this.room = new Room(TEMPLATES[this.roomIndex], this.roomIndex);
    resetEnemyIds();
    this.enemies = [];
    this.fireTrails = [];
    this.projectiles = [];
    this.artifactChoices = [];
    for (const s of this.waveSpawns(this.roomIndex)) this.spawnEnemy(s.x, s.y, s.kind);
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
    this.rewardedRooms.clear();
    this.loadRoom(0);
  }

  /** after a win, keep the artifacts and start the next run from room 0 with fresh stats */
  continueAfterWin(): void {
    this.resetRun();
    this.rewardedRooms.clear();
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
    this.rewardedRooms.add(this.roomIndex);
    this.runStats.artifactsTaken++;
    this.artifactChoices = [];
    this.room.openDoors();
    sfx(this.queue, "door");
    this.banner(`${ARTIFACTS.find(b => b.id === id)!.name} — cửa mở`);
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
    if (this.pendingEnd !== null) return;
    this.tickCount++;
    if (this.bannerTicks > 0) this.bannerTicks--;

    if (this.hitStopTicks > 0) {
      this.hitStopTicks--;
      return;
    }

    this.runStats.ticksElapsed++;
    this.player.tick(input, this);
    for (const e of this.enemies) e.tick(this, this.grid);
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.syncUnits();
    this.grid.clear();
    for (const u of this.units) this.grid.insert(u);

    resolveHits(this, this.grid);
    resolveFire(this);
    resolveProjectiles(this);
    this.progress(input);
    this.detectAchievements();
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
      if (this.pendingEnd === null && this.playerDeadTicks >= CONFIG.ROOMS.END_DELAY) this.pendingEnd = "dead";
      return;
    }

    if (this.aliveEnemies() === 0 && !this.room.doorOpen) {
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
  addEnemies(n: number, kinds: EnemyKind[] = ["chaser", "charger", "splitter"]): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnEnemy(this.player.x + Math.cos(a) * 40, this.player.y + Math.sin(a) * 30, kinds[i % kinds.length] ?? "chaser");
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
