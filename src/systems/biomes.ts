import type { EnemyKind } from "../config.ts";

export type BiomeId = "dungeon" | "caverns" | "forge" | "void";

export type Biome = {
  id: BiomeId;
  name: string;
  desc: string;
  color: string;
  roomStart: number;
  roomEnd: number;
  palette: {
    floor: string;
    wall: string;
    accent: string;
    ambient: string;
    particle: string;
  };
  enemyPool: EnemyKind[];
};

export const BIOMES: Record<BiomeId, Biome> = {
  dungeon: {
    id: "dungeon",
    name: "Ngục Tối",
    desc: "Những hành lang đá cổ xưa.",
    color: "#8a8a9a",
    roomStart: 0,
    roomEnd: 2,
    palette: { floor: "#121419", wall: "#2b3242", accent: "#1b1f28", ambient: "rgba(5, 7, 11, 0.5)", particle: "rgba(190, 204, 222, 0.16)" },
    enemyPool: ["chaser", "charger", "splitter", "small"],
  },
  caverns: {
    id: "caverns",
    name: "Hang Băng",
    desc: "Gió lạnh phủ kín hang sâu.",
    color: "#58caff",
    roomStart: 3,
    roomEnd: 5,
    palette: { floor: "#101822", wall: "#1f3548", accent: "#16304a", ambient: "rgba(80, 180, 255, 0.15)", particle: "rgba(182, 231, 255, 0.48)" },
    enemyPool: ["teleporter", "ranged", "shielder", "jumper"],
  },
  forge: {
    id: "forge",
    name: "Lò Rèn",
    desc: "Sức nóng tràn ra từ lò nung.",
    color: "#ff5a3c",
    roomStart: 6,
    roomEnd: 8,
    palette: { floor: "#1a0e08", wall: "#3a1a10", accent: "#2a1410", ambient: "rgba(255, 90, 60, 0.12)", particle: "rgba(255, 143, 68, 0.58)" },
    enemyPool: ["exploder", "charger", "sniper", "boss"],
  },
  void: {
    id: "void",
    name: "Hư Không",
    desc: "Một khoảng không méo mó và xa lạ.",
    color: "#c99ae6",
    roomStart: 9,
    roomEnd: 11,
    palette: { floor: "#0a0512", wall: "#1e0f2e", accent: "#180a28", ambient: "rgba(180, 100, 255, 0.15)", particle: "rgba(195, 174, 255, 0.32)" },
    enemyPool: ["teleporter", "healer", "splitter", "warden"],
  },
};

export function biomeForRoom(roomIndex: number): Biome {
  const index = Math.max(0, Math.floor(roomIndex));
  return Object.values(BIOMES).find((biome) => index >= biome.roomStart && index <= biome.roomEnd) ?? BIOMES.void;
}

export function biomeForNext(currentRoom: number): Biome {
  return biomeForRoom(currentRoom + 1);
}
