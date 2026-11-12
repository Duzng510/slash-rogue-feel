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
  gold: number;
  totalGoldEarned: number;
  eliteKills: number;
  critHits: number;
  poisonKills: number;
  wardenKills: number;
  golemKills: number;
  kingKills: number;
  kingNoDamage: boolean;
  phantomKills: number;
  vampireHeals: number;
  bossDamageTaken: number;
  roomKills: number;
  cursesTaken: number;
  finalHp: number;
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
    gold: 0,
    totalGoldEarned: 0,
    eliteKills: 0,
    critHits: 0,
    poisonKills: 0,
    wardenKills: 0,
    golemKills: 0,
    kingKills: 0,
    kingNoDamage: false,
    phantomKills: 0,
    vampireHeals: 0,
    bossDamageTaken: 0,
    roomKills: 0,
    cursesTaken: 0,
    finalHp: 0,
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
