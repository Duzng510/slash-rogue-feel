import type { RunStats } from "./runStats.ts";
import { normalizeAscensionLevel, type AscensionLevel } from "./ascension.ts";
import type { CharacterId } from "./characters.ts";
import { type WeaponId, WEAPON_LIST } from "./weapons.ts";

/** Achievement ids are a stable, versioned contract — never rename one, only add. */
export type AchievementId =
  | "first_blood"
  | "room_clear"
  | "half_way"
  | "full_run"
  | "flawless_room"
  | "artifact_hoarder"
  | "combo_master"
  | "fire_and_ice"
  | "heavy_hitter"
  | "speedrun"
  | "elite_slayer"
  | "rich"
  | "speedrun_sub_5"
  | "no_dash_win"
  | "one_hp_win"
  | "collector_10"
  | "curse_bearer"
  | "poison_master"
  | "crit_king"
  | "dodge_king"
  | "perfect_boss"
  | "warden_slayer"
  | "golem_slayer"
  | "king_slayer"
  | "no_damage_king"
  | "phantom_master"
  | "vampire_lord"
  | "pacifist_room"
  | "soul_collector"
  | "master_of_arms"
  | "ascension_1"
  | "ascension_4"
  | "ascension_8";

export type AchEvent = "kill" | "room" | "win" | "hit" | "artifact" | "end";

const ALL_ACHIEVEMENTS: readonly AchievementId[] = [
  "first_blood",
  "room_clear",
  "half_way",
  "full_run",
  "flawless_room",
  "artifact_hoarder",
  "combo_master",
  "fire_and_ice",
  "heavy_hitter",
  "speedrun",
  "elite_slayer",
  "rich",
  "speedrun_sub_5",
  "no_dash_win",
  "one_hp_win",
  "collector_10",
  "curse_bearer",
  "poison_master",
  "crit_king",
  "dodge_king",
  "perfect_boss",
  "warden_slayer",
  "golem_slayer",
  "king_slayer",
  "no_damage_king",
  "phantom_master",
  "vampire_lord",
  "pacifist_room",
  "soul_collector",
  "master_of_arms",
  "ascension_1",
  "ascension_4",
  "ascension_8",
];

/** Vietnamese labels, shown by the HUD toast for achievements that unlock no artifact */
export const ACHIEVEMENT_NAMES: Record<AchievementId, string> = {
  first_blood: "Máu đầu tiên",
  room_clear: "Dọn phòng",
  half_way: "Nửa chặng",
  full_run: "Phá đảo",
  flawless_room: "Phòng không vết xước",
  artifact_hoarder: "Sưu tầm cổ vật",
  combo_master: "Bậc thầy combo",
  fire_and_ice: "Lửa gặp nước",
  heavy_hitter: "Kẻ nặng đòn",
  speedrun: "Tốc hành",
  elite_slayer: "Thợ săn tinh anh",
  rich: "Đại gia",
  speedrun_sub_5: "Dưới 5 phút",
  no_dash_win: "Không dash vẫn thắng",
  one_hp_win: "Một máu về đích",
  collector_10: "Nhà sưu tầm",
  curse_bearer: "Kẻ mang nguyền",
  poison_master: "Bậc thầy độc",
  crit_king: "Vua chí mạng",
  dodge_king: "Vua né đòn",
  perfect_boss: "Boss không vết xước",
  warden_slayer: "Hạ ngục trưởng",
  golem_slayer: "Hạ Golem Lò Rèn",
  king_slayer: "Hạ Vua Lãng Quên",
  no_damage_king: "Vua không vết xước",
  phantom_master: "Bậc thầy ảo ảnh",
  vampire_lord: "Chúa tể hút máu",
  pacifist_room: "Phòng hòa bình",
  soul_collector: "Thu phục hồn tướng",
  master_of_arms: "Bậc thầy binh khí",
  ascension_1: "Chinh phục Ascension I",
  ascension_4: "Chinh phục Ascension IV",
  ascension_8: "Chinh phục Ascension VIII",
};

export type BestRun = { time: number; rooms: number; kills: number; artifacts: number };

export type Achievements = {
  earned: Set<AchievementId>;
  best: BestRun | null;
  totalGold: number;
  /** characters beaten to the end at least once; three of them earns soul_collector */
  charactersWon: Set<CharacterId>;
  /** weapons beaten to the end at least once; five of them earns master_of_arms */
  weaponsWon: Set<WeaponId>;
  /** highest unlocked Ascension tier, kept backward-compatible with older saves */
  ascensionMax: AscensionLevel;
};

const SPEEDRUN_TICKS = 8 * 60 * 60;
const SUB5_TICKS = 5 * 60 * 60;
const RICH_GOLD = 100;

function isAchievementId(v: unknown): v is AchievementId {
  return typeof v === "string" && (ALL_ACHIEVEMENTS as readonly string[]).includes(v);
}

function isCharacterId(v: unknown): v is CharacterId {
  return v === "swordsman" || v === "mage" || v === "tank";
}

function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === "string" && (WEAPON_LIST as readonly string[]).includes(v);
}

export function emptyAchievements(): Achievements {
  return {
    earned: new Set<AchievementId>(),
    best: null,
    totalGold: 0,
    charactersWon: new Set<CharacterId>(),
    weaponsWon: new Set<WeaponId>(),
    ascensionMax: 0,
  };
}

/** decode persisted JSON into a valid Achievements; the storage adapter owns where the string came from */
export function parseAchievements(raw: string | null): Achievements {
  if (raw === null) return emptyAchievements();
  try {
    const data = JSON.parse(raw) as {
      earned?: unknown;
      best?: unknown;
      totalGold?: unknown;
      charactersWon?: unknown;
      weaponsWon?: unknown;
      ascensionMax?: unknown;
    };
    const earned = new Set<AchievementId>();
    if (Array.isArray(data.earned)) {
      for (const id of data.earned) if (isAchievementId(id)) earned.add(id);
    }
    const charactersWon = new Set<CharacterId>();
    if (Array.isArray(data.charactersWon)) {
      for (const id of data.charactersWon) if (isCharacterId(id)) charactersWon.add(id);
    }
    const weaponsWon = new Set<WeaponId>();
    if (Array.isArray(data.weaponsWon)) {
      for (const id of data.weaponsWon) if (isWeaponId(id)) weaponsWon.add(id);
    }
    const best = (data.best ?? null) as BestRun | null;
    const totalGold = typeof data.totalGold === "number" && data.totalGold >= 0 ? data.totalGold : 0;
    const ascensionMax = normalizeAscensionLevel(data.ascensionMax);
    return { earned, best, totalGold, charactersWon, weaponsWon, ascensionMax };
  } catch {
    return emptyAchievements();
  }
}

export function stringifyAchievements(a: Achievements): string {
  return JSON.stringify({
    earned: [...a.earned],
    best: a.best,
    totalGold: a.totalGold,
    charactersWon: [...a.charactersWon],
    weaponsWon: [...a.weaponsWon],
    ascensionMax: a.ascensionMax,
  });
}

export function isUnlocked(id: AchievementId, a: Achievements): boolean {
  return a.earned.has(id);
}

/** newly qualifying ids for a given sim event; the caller filters against `earned` and persists */
export function checkAchievements(stats: RunStats, event: AchEvent, totalGold = 0): AchievementId[] {
  const out: AchievementId[] = [];
  const add = (id: AchievementId, ok: boolean): void => {
    if (ok) out.push(id);
  };
  switch (event) {
    case "kill":
      add("first_blood", stats.enemiesKilled >= 1);
      add("combo_master", stats.hurtFree && stats.killStreak >= 10);
      add("heavy_hitter", stats.heavyKills >= 5);
      add("fire_and_ice", stats.comboSeen);
      add("elite_slayer", stats.eliteKills >= 5);
      add("poison_master", stats.poisonKills >= 10);
      add("crit_king", stats.critHits >= 15);
      add("dodge_king", stats.perfectDodges >= 10);
      add("warden_slayer", stats.wardenKills >= 1);
      add("golem_slayer", stats.golemKills >= 1);
      add("king_slayer", stats.kingKills >= 1);
      add("no_damage_king", stats.kingNoDamage);
      add("phantom_master", stats.phantomKills >= 5);
      add("vampire_lord", stats.vampireHeals >= 5);
      break;
    case "room":
      add("room_clear", stats.roomsCleared >= 1);
      add("half_way", stats.roomsCleared >= 3);
      add("flawless_room", stats.hurtFree && stats.roomsCleared >= 1);
      add("pacifist_room", stats.roomsCleared >= 1 && stats.roomKills === 0);
      break;
    case "artifact":
      add("artifact_hoarder", stats.artifactsTaken >= 5);
      add("collector_10", stats.artifactsTaken >= 10);
      break;
    case "win":
      add("full_run", true);
      add("speedrun", stats.ticksElapsed < SPEEDRUN_TICKS);
      add("speedrun_sub_5", stats.ticksElapsed < SUB5_TICKS);
      add("half_way", stats.roomsCleared >= 3);
      add("no_dash_win", stats.dashCount === 0);
      add("one_hp_win", stats.finalHp === 1);
      add("curse_bearer", stats.cursesTaken >= 1);
      add("perfect_boss", stats.bossDamageTaken === 0);
      add("dodge_king", stats.perfectDodges >= 10);
      break;
    case "hit":
      break;
    case "end":
      add("rich", totalGold >= RICH_GOLD);
      break;
  }
  return out;
}
