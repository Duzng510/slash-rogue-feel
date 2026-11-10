export type BoonId = "aftershock" | "fire" | "heavy" | "desperate" | "pursuit" | "impulse" | "reprisal";
export type Boon = { id: BoonId; name: string; desc: string };

export const BOONS: readonly Boon[] = [
  { id: "reprisal", name: "Phản kích", desc: "Chịu đòn: nhát chém kế trong 2 giây thêm 1 sát thương." },
  { id: "aftershock", name: "Dư chấn", desc: "Chém 2 trúng: nổ lan 40px, thêm 1 sát thương." },
  { id: "fire", name: "Hỏa bộ", desc: "Dash để lại lửa 1 giây. Mỗi địch mất 1 HP mỗi dash." },
  { id: "heavy", name: "Trọng kiếm", desc: "Chém mạnh hơn 50%, hit-stop khi trúng dài gấp đôi." },
  { id: "desperate", name: "Đường cùng", desc: "Khi HP còn 2 trở xuống, chạy nhanh hơn 20%." },
  { id: "pursuit", name: "Truy sát", desc: "Mỗi lần hạ địch giảm hồi dash 0,3 giây." },
  { id: "impulse", name: "Xung kích", desc: "Sau dash: nhát chém kế trong 2 giây đẩy lùi gấp đôi." },
];

export type FireTrail = {
  points: { x: number; y: number; ticks: number }[];
  seen: Set<number>;
};
