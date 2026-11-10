export type BoonId = "water" | "lightning" | "aftershock" | "fire" | "heavy" | "desperate" | "pursuit" | "impulse" | "reprisal";
export type Boon = { id: BoonId; name: string; desc: string };

export const BOONS: readonly Boon[] = [
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
