export type RunStats = {
  roomsCleared: number;
  enemiesKilled: number;
  damageDealt: number;
  damageTaken: number;
  artifactsTaken: number;
  ticksElapsed: number;
  hurtFree: boolean;
  dashCount: number;
  perfectDodges: number;
  /** achievement signals; tracked but not shown on the end screen */
  killStreak: number;
  heavyKills: number;
  comboSeen: boolean;
};

export function emptyStats(): RunStats {
  return {
    roomsCleared: 0,
    enemiesKilled: 0,
    damageDealt: 0,
    damageTaken: 0,
    artifactsTaken: 0,
    ticksElapsed: 0,
    hurtFree: true,
    dashCount: 0,
    perfectDodges: 0,
    killStreak: 0,
    heavyKills: 0,
    comboSeen: false,
  };
}

/** zero a run's stats in place, keeping the object identity held by systems and the harness */
export function resetStats(s: RunStats): void {
  Object.assign(s, emptyStats());
}

/** ticks (60Hz) -> "m:ss" */
export function formatRunTime(ticks: number): string {
  const total = Math.floor(ticks / 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type EndMode = "dead" | "won";
export type EndAction = "restart" | "continue";
