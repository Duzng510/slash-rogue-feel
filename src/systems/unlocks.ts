import type { RunStats } from "./runStats.ts";

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
  | "speedrun";

export type AchEvent = "kill" | "room" | "win" | "hit" | "artifact";

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
};

export type BestRun = { time: number; rooms: number; kills: number; artifacts: number };

export type Achievements = {
  earned: Set<AchievementId>;
  best: BestRun | null;
};

const SPEEDRUN_TICKS = 5 * 60 * 60;

function isAchievementId(v: unknown): v is AchievementId {
  return typeof v === "string" && (ALL_ACHIEVEMENTS as readonly string[]).includes(v);
}

export function emptyAchievements(): Achievements {
  return { earned: new Set<AchievementId>(), best: null };
}

/** decode persisted JSON into a valid Achievements; the storage adapter owns where the string came from */
export function parseAchievements(raw: string | null): Achievements {
  if (raw === null) return emptyAchievements();
  try {
    const data = JSON.parse(raw) as { earned?: unknown; best?: unknown };
    const earned = new Set<AchievementId>();
    if (Array.isArray(data.earned)) {
      for (const id of data.earned) if (isAchievementId(id)) earned.add(id);
    }
    const best = (data.best ?? null) as BestRun | null;
    return { earned, best };
  } catch {
    return emptyAchievements();
  }
}

export function stringifyAchievements(a: Achievements): string {
  return JSON.stringify({ earned: [...a.earned], best: a.best });
}

export function isUnlocked(id: AchievementId, a: Achievements): boolean {
  return a.earned.has(id);
}

/** newly qualifying ids for a given sim event; the caller filters against `earned` and persists */
export function checkAchievements(stats: RunStats, event: AchEvent): AchievementId[] {
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
      break;
    case "room":
      add("room_clear", stats.roomsCleared >= 1);
      add("half_way", stats.roomsCleared >= 3);
      add("flawless_room", stats.hurtFree && stats.roomsCleared >= 1);
      break;
    case "artifact":
      add("artifact_hoarder", stats.artifactsTaken >= 5);
      break;
    case "win":
      add("full_run", true);
      add("speedrun", stats.ticksElapsed < SPEEDRUN_TICKS);
      add("half_way", stats.roomsCleared >= 3);
      break;
    case "hit":
      break;
  }
  return out;
}
