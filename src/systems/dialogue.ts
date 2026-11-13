export type DialogueAction =
  | { t: "next"; node: string }
  | { t: "close" }
  | { t: "shop" }
  | { t: "character_select" }
  | { t: "enter_dungeon" }
  | { t: "banner"; text: string }
  | { t: "retreat" };

export type DialogueOption = { label: string; action: DialogueAction };

export type DialogueNode = {
  speaker: string;
  portrait: string;
  text: string;
  options: DialogueOption[];
};

export type Dialogue = {
  start: string;
  nodes: Record<string, DialogueNode>;
};

export type ActiveDialogue = {
  source: Dialogue;
  nodeId: string;
  charIndex: number;
};

export const MERCHANT_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Thương nhân",
      portrait: "portrait_merchant",
      text: "Hàng tốt, giá phải chăng! Ngó qua chút không?",
      options: [
        { label: "Xem hàng", action: { t: "shop" } },
        { label: "Thôi", action: { t: "close" } },
      ],
    },
  },
};

export const GUARD_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Lính gác",
      portrait: "portrait_guard",
      text: "Hầm ngục ở phía đông. Quái vật trong đó rất mạnh — hãy chuẩn bị kỹ.",
      options: [
        { label: "Hỏi thêm", action: { t: "next", node: "lore" } },
        { label: "Cảm ơn", action: { t: "close" } },
      ],
    },
    lore: {
      speaker: "Lính gác",
      portrait: "portrait_guard",
      text: "Nhiều kẻ đã đi vào. Không ai trở ra với đủ tay chân.",
      options: [{ label: "Tôi hiểu rồi", action: { t: "close" } }],
    },
  },
};

export const MASTER_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Bậc thầy",
      portrait: "portrait_character_master",
      text: "Ngươi muốn đổi anh hùng? Ta có thể giúp — nhưng chỉ lần này.",
      options: [
        { label: "Đổi", action: { t: "character_select" } },
        { label: "Thôi", action: { t: "close" } },
      ],
    },
  },
};

export const MASTER_LOCKED_DIALOGUE: Dialogue = {
  start: "locked",
  nodes: {
    locked: {
      speaker: "Bậc thầy",
      portrait: "portrait_character_master",
      text: "Số phận đã định. Ngươi phải tiếp tục với anh hùng hiện tại.",
      options: [{ label: "Ta hiểu", action: { t: "close" } }],
    },
  },
};

export const GATE_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Cửa hầm ngục",
      portrait: "portrait_gate",
      text: "Cửa dẫn tới Hầm Ngục. Bạn đã sẵn sàng?",
      options: [
        { label: "Vào", action: { t: "enter_dungeon" } },
        { label: "Chưa", action: { t: "retreat" } },
      ],
    },
  },
};
