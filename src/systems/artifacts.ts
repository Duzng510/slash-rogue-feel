import type { AchievementId } from "./unlocks.ts";

export type ArtifactId = "water" | "lightning" | "aftershock" | "fire" | "heavy" | "desperate" | "pursuit" | "impulse" | "reprisal" | "crit" | "berserker" | "thorns" | "poison" | "freeze" | "bleed" | "detonate" | "corrode" | "glasscannon" | "vampire" | "phantom_dash" | "executioner" | "twin_blades" | "shield" | "chain_lightning";
export type Artifact = { id: ArtifactId; name: string; desc: string };

/** which achievement reveals each artifact (null = available from the first run) */
export const ARTIFACT_UNLOCKS: Record<ArtifactId, AchievementId | null> = {
  water: null,
  fire: null,
  lightning: "first_blood",
  heavy: "room_clear",
  aftershock: "half_way",
  pursuit: "combo_master",
  impulse: "speedrun_sub_5",
  desperate: "one_hp_win",
  reprisal: "full_run",
  crit: "heavy_hitter",
  berserker: "combo_master",
  thorns: "flawless_room",
  poison: "first_blood",
  freeze: "room_clear",
  bleed: "first_blood",
  detonate: "fire_and_ice",
  corrode: "half_way",
  glasscannon: "full_run",
  vampire: "room_clear",
  phantom_dash: "speedrun",
  executioner: "combo_master",
  twin_blades: "half_way",
  shield: "dodge_king",
  chain_lightning: "heavy_hitter",
};

/** which achievement reveals each curse (null = in the pool from the first run) */
export const CURSE_UNLOCKS: Record<CurseId, AchievementId | null> = {
  frail: null,
  heavy_legs: null,
  glass: "curse_bearer",
  slow_hand: "warden_slayer",
  butterfingers: "collector_10",
};

/** the artifact an achievement reveals, if any — used by the HUD toast wording */
export function unlockArtifactFor(ach: AchievementId): Artifact | null {
  for (const artifact of ARTIFACTS) {
    if (ARTIFACT_UNLOCKS[artifact.id] === ach) return artifact;
  }
  return null;
}

/** one HUD colour per artifact, also used by the pickup card so the strip stays learnable */
export const ARTIFACT_COLORS: Record<ArtifactId, string> = {
  water: "#58caff",
  lightning: "#ffe66b",
  aftershock: "#ff963f",
  fire: "#d84b20",
  heavy: "#a0a0a0",
  desperate: "#ff5a7a",
  pursuit: "#7fd1ff",
  impulse: "#c99ae6",
  reprisal: "#ffd166",
  crit: "#fff2b3",
  berserker: "#ff5a5a",
  thorns: "#c8ff8a",
  poison: "#8f63ae",
  freeze: "#a8e8ff",
  bleed: "#c2182b",
  detonate: "#ff7a3c",
  corrode: "#7fe0a8",
  glasscannon: "#ff8ad8",
  vampire: "#e0455a",
  phantom_dash: "#e0b3ff",
  executioner: "#d8d8e8",
  twin_blades: "#4de3e0",
  shield: "#8ab4ff",
  chain_lightning: "#e8ff4d",
};

export const ARTIFACTS: readonly Artifact[] = [
  { id: "reprisal", name: "Phản kích", desc: "Chịu đòn: nhát chém kế trong 2 giây thêm 1 sát thương." },
  { id: "aftershock", name: "Dư chấn", desc: "Chém 2 trúng: nổ lan 40px, thêm 1 sát thương." },
  { id: "fire", name: "Hỏa bộ", desc: "Dash để lại lửa: 1 dmg + cháy 1 dmg/giây trong 2 giây. Gặp ướt: tiêu thụ cả hai, nổ 2 dmg." },
  { id: "water", name: "Thủy kiếm", desc: "Chém 1 gây ướt 3 giây, chậm 30%. Gặp cháy: tiêu thụ cả hai, nổ 2 dmg." },
  { id: "lightning", name: "Lôi kiếm", desc: "Chém 2 gây choáng 0,25 giây; tiêu thụ ướt để choáng 0,8 giây. Không gia hạn khi đang choáng." },
  { id: "heavy", name: "Trọng kiếm", desc: "Chém mạnh hơn 30%, hit-stop khi trúng dài gấp 1,5 lần." },
  { id: "desperate", name: "Đường cùng", desc: "Khi HP còn 2 trở xuống, chạy nhanh hơn 20%." },
  { id: "pursuit", name: "Truy sát", desc: "Mỗi lần hạ địch giảm hồi dash 0,3 giây." },
  { id: "impulse", name: "Xung kích", desc: "Sau dash: nhát chém kế trong 2 giây đẩy lùi gấp đôi." },
  { id: "crit", name: "Chí mạng", desc: "20% cơ hội gây sát thương gấp đôi." },
  { id: "berserker", name: "Cuồng nộ", desc: "Sát thương +10% mỗi HP đã mất (tối đa +50%)." },
  { id: "thorns", name: "Gai nhọn", desc: "Trúng đòn: kẻ tấn công nhận 1 sát thương." },
  { id: "poison", name: "Độc kiếm", desc: "Chém 1 gây độc 4 giây, 1 dmg/giây. Không bị ướt hủy; đang cháy thì độc gây 2 dmg/giây." },
  { id: "freeze", name: "Băng kiếm", desc: "Chém 2 đóng băng 0,8 giây. Đánh kẻ đóng băng: phá băng, thêm 2 sát thương." },
  { id: "bleed", name: "Huyết kiếm", desc: "Chém gây chảy máu 5 giây: địch nhận 1 dmg mỗi khi di chuyển hoặc tấn công." },
  { id: "detonate", name: "Bộc hỏa", desc: "Địch đang cháy chết: nổ 3 dmg lan 50px, gây cháy cho địch xung quanh." },
  { id: "corrode", name: "Ăn mòn", desc: "Ướt kéo dài 5 giây; đòn chém trực tiếp gây thêm 25% sát thương lên địch đang ướt." },
  { id: "glasscannon", name: "Thủy tinh", desc: "Sát thương ×1,75, nhưng HP tối đa chỉ còn 3." },
  { id: "vampire", name: "Hút máu", desc: "Mỗi 5 lần hạ địch hồi 1 HP." },
  { id: "phantom_dash", name: "Ảo ảnh", desc: "Dash teleport 60px, không miễn thương, gây 2 dmg cho địch đi xuyên qua." },
  { id: "executioner", name: "Đao phủ", desc: "Đánh địch dưới 20% HP: xử tử ngay, không hit-stop." },
  { id: "twin_blades", name: "Song kiếm", desc: "Chém 2 quét thêm một cung phía sau lưng." },
  { id: "shield", name: "Khiên", desc: "Chặn 1 đòn không mất máu, hồi sau 7 giây." },
  { id: "chain_lightning", name: "Liên lôi", desc: "Chém 2 trúng: giật sang địch gần nhất trong 60px, 1 sát thương." },
];

export type FireTrail = {
  points: { x: number; y: number; ticks: number }[];
  seen: Set<number>;
};

export type CurseId = "frail" | "heavy_legs" | "slow_hand" | "butterfingers" | "glass";
export type Curse = { id: CurseId; name: string; desc: string };

export const CURSES: readonly Curse[] = [
  { id: "frail", name: "Yếu ớt", desc: "Max HP -2." },
  { id: "heavy_legs", name: "Nặng chân", desc: "Tốc độ chạy -20%." },
  { id: "slow_hand", name: "Chậm tay", desc: "Startup đòn chém +2 tick." },
  { id: "butterfingers", name: "Vụng về", desc: "10% đòn chém trượt hoàn toàn." },
  { id: "glass", name: "Mỏng manh", desc: "Nhận 2x sát thương, gây 1.5x sát thương." },
];
