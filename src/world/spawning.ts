import { CONFIG, isScripted } from "../config.ts";
import type { EnemyKind } from "../config.ts";
import { shuffle } from "../mathx.ts";
import type { Rng } from "../mathx.ts";
import type { Biome } from "../systems/biomes.ts";
import type { Room, SpawnMark } from "./rooms.ts";

/** Selects the authored and extra spawns for a room using only the combat RNG. */
export function selectWaveSpawns(room: Room, biome: Biome, index: number, rng: Rng): SpawnMark[] {
  if (
    room.kind === "rest" ||
    room.kind === "event" ||
    room.kind === "shop" ||
    room.kind === "treasure" ||
    room.kind === "shrine"
  ) return [];
  if (room.kind === "elite") {
    return [{ x: room.widthPx / 2, y: room.heightPx / 2, kind: biome.enemyPool[0] ?? "chaser" }];
  }
  if (room.kind === "challenge") {
    return room.spawns.slice(0, 3).map((spawn) => ({
      ...spawn,
      kind: biome.enemyPool.includes(spawn.kind) ? spawn.kind : biome.enemyPool[0] ?? "chaser",
    }));
  }

  const fallback: EnemyKind = biome.enemyPool[0] ?? "chaser";
  const markers = room.spawns.map((spawn) => ({
    ...spawn,
    kind: isScripted(spawn.kind) || biome.enemyPool.includes(spawn.kind) ? spawn.kind : fallback,
  }));
  const bosses = markers.filter((spawn) => isScripted(spawn.kind));
  const pool = markers.filter((spawn) => !isScripted(spawn.kind));
  shuffle(pool, rng.next);
  const want = CONFIG.ROOMS.WAVES[index] ?? pool.length;
  const baseCount = Math.min(pool.length, Math.max(0, want - bosses.length));
  const selected = pool.slice(0, baseCount);
  const extra = CONFIG.ASCENSION.extraEnemiesPerWave;
  for (let i = 0; i < extra && pool.length > 0; i++) {
    const spawn = pool[i % pool.length]!;
    const angle = (i + 1) * 2.399963229728653;
    selected.push({
      ...spawn,
      x: spawn.x + Math.cos(angle) * 10,
      y: spawn.y + Math.sin(angle) * 10,
    });
  }
  return [...bosses, ...selected];
}
