import type { AchievementId } from "./unlocks.ts";

export type ArtifactId = "water" | "lightning" | "aftershock" | "fire" | "heavy" | "desperate" | "pursuit" | "impulse" | "reprisal";
export type Artifact = { id: ArtifactId; name: string; desc: string };

/** which achievement reveals each artifact (null = available from the first run) */
export const ARTIFACT_UNLOCKS: Record<ArtifactId, AchievementId | null> = {
  water: null,
  fire: null,
  lightning: "first_blood",
  heavy: "room_clear",
  aftershock: "half_way",
  pursuit: "combo_master",
  impulse: "speedrun",
  desperate: "flawless_room",
  reprisal: "full_run",
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
};

export const ARTIFACTS: readonly Artifact[] = [
  { id: "reprisal", name: "Phản kích", desc: "Chịu đòn: nhát chém kế trong 2 giây thêm 1 sát thương." },
  { id: "aftershock", name: "Dư chấn", desc: "Chém 2 trúng: nổ lan 40px, thêm 1 sát thương." },
  { id: "fire", name: "Hỏa bộ", desc: "Dash để lại lửa: 1 dmg + cháy 1 dmg/giây trong 2 giây. Gặp ướt: tiêu thụ cả hai, nổ 2 dmg." },
  { id: "water", name: "Thủy kiếm", desc: "Chém 1 gây ướt 3 giây, chậm 30%. Gặp cháy: tiêu thụ cả hai, nổ 2 dmg." },
  { id: "lightning", name: "Lôi kiếm", desc: "Chém 2 gây choáng 0,25 giây; tiêu thụ ướt để choáng 0,8 giây. Không gia hạn khi đang choáng." },
  { id: "heavy", name: "Trọng kiếm", desc: "Chém mạnh hơn 50%, hit-stop khi trúng dài gấp đôi." },
  { id: "desperate", name: "Đường cùng", desc: "Khi HP còn 2 trở xuống, chạy nhanh hơn 20%." },
  { id: "pursuit", name: "Truy sát", desc: "Mỗi lần hạ địch giảm hồi dash 0,3 giây." },
  { id: "impulse", name: "Xung kích", desc: "Sau dash: nhát chém kế trong 2 giây đẩy lùi gấp đôi." },
];

export type FireTrail = {
  points: { x: number; y: number; ticks: number }[];
  seen: Set<number>;
};
