import { CONFIG } from "../config.ts";
import { makeRng } from "../mathx.ts";
import { EventQueue, sfx } from "../events.ts";
import { ParticlePool } from "../systems/particles.ts";
import { resolveHits } from "../systems/combat.ts";
import { Player } from "../entities/player.ts";
import { Enemy, makeEnemy, resetEnemyIds } from "../entities/enemy.ts";
import { Room, TEMPLATES } from "../world/rooms.ts";
import type { Intent, Sim, Unit } from "../sim/types.ts";

export class World implements Sim {
  readonly queue = new EventQueue();
  readonly particles = new ParticlePool();
  readonly player = new Player();

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

  private swingSeq = 1;

  constructor(seed: number = CONFIG.SEED) {
    this.rng = makeRng(seed);
    this.room = new Room(TEMPLATES[0], 0);
    this.loadRoom(0, false);
  }

  nextSwingId(): number {
    return this.swingSeq++;
  }

  spawnEnemy(x: number, y: number): void {
    this.enemies.push(makeEnemy(x, y));
  }

  /** pick `count` of the template's spawn markers, deterministic by seed */
  private waveSpawns(index: number): { x: number; y: number }[] {
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
    for (const s of this.waveSpawns(this.roomIndex)) this.spawnEnemy(s.x, s.y);
    this.syncUnits();
    this.player.reset(this.room.start.x, this.room.start.y);
    if (keepSweep) this.particles.reset();
    this.hitStopTicks = 0;
    this.banner(`${this.roomIndex + 1}/${this.roomTotal}  ${this.room.name}`);
  }

  banner(text: string): void {
    this.bannerText = text;
    this.bannerTicks = 96;
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

  tick(input: Intent): void {
    this.tickCount++;
    if (this.bannerTicks > 0) this.bannerTicks--;

    if (this.hitStopTicks > 0) {
      this.hitStopTicks--;
      return;
    }

    this.player.tick(input, this);
    for (const e of this.enemies) e.tick(this);
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.syncUnits();

    resolveHits(this);
    this.progress(input);
  }

  private progress(_input: Intent): void {
    if (this.player.dead) {
      if (++this.playerDeadTicks === CONFIG.ROOMS.RESPAWN_DELAY) {
        this.victory = false;
        this.playerDeadTicks = 0;
        this.loadRoom(0);
        this.banner("Chết — trở lại phòng 1");
      }
      return;
    }

    if (this.aliveEnemies() === 0 && !this.room.doorOpen) {
      this.room.openDoors();
      sfx(this.queue, "door");
      this.banner(this.roomIndex === this.roomTotal - 1 ? "Sạch quái — hết prototype" : "Sạch quái — cửa mở");
    }

    if (this.room.exitsAt(this.player.x, this.player.y)) {
      const last = this.roomIndex === this.roomTotal - 1;
      this.victory = last;
      this.loadRoom(last ? 0 : this.roomIndex + 1);
      sfx(this.queue, "door", 0.8, 1.2);
    }
  }

  /** debug helper: F6 stress-tests readability without touching the wave table */
  addEnemies(n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnEnemy(this.player.x + Math.cos(a) * 40, this.player.y + Math.sin(a) * 30);
    }
    this.enemies = this.enemies.filter((e) => !e.removed);
    this.syncUnits();
  }
}
