import type { CONFIG } from "../config.ts";

export type AscensionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type AscensionModifier = {
  id: string;
  name: string;
  desc: string;
};

export const ASCENSION_MODS: Record<number, AscensionModifier> = {
  1: { id: "hp_boost", name: "Máu dày", desc: "Enemy HP +20%." },
  2: { id: "speed_boost", name: "Nhanh nhẹn", desc: "Enemy speed +10%." },
  3: { id: "heal_reduce", name: "Khắc nghiệt", desc: "Hồi máu giảm 50%." },
  4: { id: "extra_phase", name: "Cuồng bạo", desc: "Boss có thêm 1 phase." },
  5: { id: "more_enemies", name: "Đông đúc", desc: "Mỗi wave +2 enemy." },
  6: { id: "trap_double", name: "Hiểm ác", desc: "Bẫy gây ×2 sát thương." },
  7: { id: "fewer_choices", name: "Khan hiếm", desc: "Chỉ 2 cổ vật để chọn." },
  8: { id: "expensive", name: "Đắt đỏ", desc: "Shop price ×1.5." },
};

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
