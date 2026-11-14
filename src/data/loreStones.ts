import type { EnemyKind } from "../config.ts";
import type { Dialogue } from "../systems/dialogue.ts";

export const LORE_ACTS = ["I", "II", "III", "IV", "V"] as const;
export type LoreAct = typeof LORE_ACTS[number];

export const LORE_ACT_ROOM_RANGES: Record<LoreAct, { start: number; end: number }> = {
  I: { start: 0, end: 2 },
  II: { start: 3, end: 5 },
  III: { start: 6, end: 8 },
  IV: { start: 9, end: 15 },
  V: { start: 16, end: 16 },
};

export type LoreStone = {
  id: string;
  act: LoreAct;
  roomIndex: number;
  tileX: number;
  tileY: number;
  origin: EnemyKind;
  dialogue: Dialogue;
};

function memory(text: string): Dialogue {
  return {
    start: "memory",
    nodes: {
      memory: {
        speaker: "Tiếng vọng",
        portrait: "portrait_gate",
        text,
        options: [{ label: "Ghi nhớ", action: { t: "close" } }],
      },
    },
  };
}

export const LORE_STONES: readonly LoreStone[] = [
  {
    id: "act-i",
    act: "I",
    roomIndex: 1,
    tileX: 14,
    tileY: 7,
    origin: "boss",
    dialogue: memory("Chiếc ngai trong bóng tối không phải nơi khởi đầu. Kẻ ngồi trên đó từng là người canh cổng, trước khi nỗi sợ biến lời thề thành xiềng xích."),
  },
  {
    id: "act-ii",
    act: "II",
    roomIndex: 4,
    tileX: 8,
    tileY: 2,
    origin: "warden",
    dialogue: memory("Ngục Trưởng không dựng nên ngục tù để giam kẻ thù. Hắn khóa mọi lối ra sau khi nghe thấy thứ gì đó gọi tên mình từ sâu dưới lòng đất."),
  },
  {
    id: "act-iii",
    act: "III",
    roomIndex: 7,
    tileX: 20,
    tileY: 9,
    origin: "golem",
    dialogue: memory("Khối đá canh giữ lò rèn từng là người thợ cuối cùng. Nó vẫn giữ nguyên mệnh lệnh bảo vệ ngọn lửa, dù chẳng còn ai để sưởi ấm."),
  },
  {
    id: "act-iv",
    act: "IV",
    roomIndex: 13,
    tileX: 10,
    tileY: 8,
    origin: "teleporter",
    dialogue: memory("Kẻ dịch chuyển mang theo những mảnh ký ức không thuộc về nó. Mỗi lần biến mất, một giọng nói lại bị bỏ quên ở phía bên kia."),
  },
  {
    id: "act-v",
    act: "V",
    roomIndex: 16,
    tileX: 22,
    tileY: 8,
    origin: "king",
    dialogue: memory("Vị Vua đã tự phong ấn mình cùng cánh cổng. Ông không canh giữ kho báu; ông canh giữ điều sẽ thức dậy nếu cánh cổng mở ra."),
  },
];

export function loreStoneForRoom(roomIndex: number): LoreStone | null {
  return LORE_STONES.find((stone) => stone.roomIndex === roomIndex) ?? null;
}
