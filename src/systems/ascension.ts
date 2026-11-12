import type { CONFIG } from "../config.ts";

export type AscensionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function normalizeAscensionLevel(value: unknown): AscensionLevel {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(8, Math.floor(value))) as AscensionLevel;
}

export function applyAscension(config: typeof CONFIG, level: AscensionLevel): void {
  config.ASCENSION.enemyHpMultiplier = level >= 1 ? 1.2 : 1;
  config.ASCENSION.enemySpeedMultiplier = level >= 2 ? 1.1 : 1;
  config.ASCENSION.playerHealMultiplier = level >= 3 ? 0.5 : 1;
  config.ASCENSION.bossExtraPhase = level >= 4;
  config.ASCENSION.extraEnemiesPerWave = level >= 5 ? 2 : 0;
  config.ASCENSION.trapDamageMultiplier = level >= 6 ? 2 : 1;
  config.ASCENSION.artifactChoices = level >= 7 ? 2 : 3;
  config.ASCENSION.shopPriceMultiplier = level >= 8 ? 1.5 : 1;
}
