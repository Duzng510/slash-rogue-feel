import type { ArtifactId } from "./artifacts.ts";
import type { NpcKind } from "../entities/npc.ts";
import type { BiomeId } from "./biomes.ts";

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

export type DialogueVariant = {
  start: string;
  nodes: Record<string, DialogueNode>;
};

export type Dialogue = DialogueVariant & {
  lowHumanity?: DialogueVariant;
};

export type ActiveDialogue = {
  source: Dialogue;
  nodeId: string;
  charIndex: number;
  blocking: boolean;
};

function storyDialogue(text: string): Dialogue {
  return {
    start: "memory",
    nodes: {
      memory: {
        speaker: "Tiếng vọng",
        portrait: "portrait_gate",
        text,
        options: [{ label: "Tiếp tục", action: { t: "close" } }],
      },
    },
  };
}

export const BIOME_INTROS: Record<BiomeId, Dialogue> = {
  town: storyDialogue("Thất Trấn là nơi trú ẩn cuối cùng. Ngoài những bức tường, Thợ Săn vẫn phải tìm kiếm thứ thành trì không thể tự tạo ra."),
  dungeon: storyDialogue("Khe Nứt từng là nhà. Những hành lang này còn giữ dấu vết của đêm cả khu định cư biến mất khỏi ký ức mọi người."),
  caverns: storyDialogue("Bầu trời xanh trên đầu chỉ là một màn trời nhân tạo. Bên dưới lớp băng này, có thứ gì đó đang giữ lại ký ức ấy."),
  forge: storyDialogue("Thất Trấn kể rằng bên ngoài chỉ có quái vật. Những ghi chép trong lò rèn cho thấy họ đã biết nhiều hơn thế."),
  void: storyDialogue("Vô Danh Vương vẫn còn sống. Sáu mảnh ký ức của ông là bằng chứng cuối cùng rằng lời hứa xưa chưa tan biến."),
};

export const ARTIFACT_LORE_DIALOGUES: Partial<Record<ArtifactId, Dialogue>> = {
  water: storyDialogue("Nước này không thuộc về một chiếc bình nào ở Thất Trấn. Nó mang theo hơi thở của vùng đất đã bị nuốt bởi Thủy Triều."),
  fire: storyDialogue("Ngọn lửa không chỉ để thiêu rụi. Trong tro tàn, có những dấu vết về thế giới trước khi con người dựng nên các bức tường."),
  vampire: storyDialogue("Cổ vật này đổi máu lấy sức sống. Những ghi chép cũ gọi đó là cái giá mà người sống sót phải trả để tiếp tục bước đi."),
};

export const MERCHANT_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Thương nhân",
      portrait: "portrait_merchant",
      text: "Ta thu mua vật liệu từ Cõi Hoang. Có món hàng nào đáng giá, Thợ Săn mới có thể đem về đủ để giữ Thất Trấn đứng vững.",
      options: [
        { label: "Xem hàng", action: { t: "shop" } },
        { label: "Thôi", action: { t: "close" } },
      ],
    },
  },
  lowHumanity: {
    start: "greet",
    nodes: {
      greet: {
        speaker: "Thương nhân",
        portrait: "portrait_merchant",
        text: "Mắt ngươi như đang nhìn xuyên qua ta. Ta vẫn có hàng, nhưng đừng mang những tiếng nói ấy vào đây.",
        options: [
          { label: "Xem hàng", action: { t: "shop" } },
          { label: "Hỏi về tiếng vọng", action: { t: "next", node: "echo" } },
          { label: "Rời đi", action: { t: "close" } },
        ],
      },
      echo: {
        speaker: "Thương nhân",
        portrait: "portrait_merchant",
        text: "Ta chỉ nghe thấy tiếng chuông thị trấn. Nếu có giọng nói khác, hãy để nó ở ngoài cổng.",
        options: [{ label: "Ta hiểu", action: { t: "close" } }],
      },
    },
  },
};

export const GUARD_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Lính gác",
      portrait: "portrait_guard",
      text: "Lối xuống phía đông dẫn tới Khe Nứt. Hồ sơ của Thất Trấn nói nơi ấy đã bị bỏ hoang từ lâu, nhưng chẳng ai giải thích vì sao.",
      options: [
        { label: "Hỏi thêm", action: { t: "next", node: "lore" } },
        { label: "Cảm ơn", action: { t: "close" } },
      ],
    },
    lore: {
      speaker: "Lính gác",
      portrait: "portrait_guard",
      text: "Cha mẹ ngươi từng nghiên cứu Cõi Hoang. Sau đêm Khe Nứt biến mất, tên họ cũng biến mất khỏi mọi hồ sơ ta được phép xem.",
      options: [{ label: "Tôi hiểu rồi", action: { t: "close" } }],
    },
  },
  lowHumanity: {
    start: "greet",
    nodes: {
      greet: {
        speaker: "Lính gác",
        portrait: "portrait_guard",
        text: "Ngươi nghe thấy ai gọi từ phía bên kia cổng phải không? Đừng trả lời. Những người trả lời thường không nhớ đường về.",
        options: [
          { label: "Hỏi về tiếng gọi", action: { t: "next", node: "echo" } },
          { label: "Rời đi", action: { t: "close" } },
        ],
      },
      echo: {
        speaker: "Lính gác",
        portrait: "portrait_guard",
        text: "Ta nghe thấy nó trong giấc mơ. Giọng ấy giống hệt người anh đã mất của ta.",
        options: [{ label: "Im lặng", action: { t: "close" } }],
      },
    },
  },
};

export const MASTER_DIALOGUE: Dialogue = {
  start: "greet",
  nodes: {
    greet: {
      speaker: "Bậc thầy",
      portrait: "portrait_character_master",
      text: "Ta có thể giúp ngươi chọn một lối chiến đấu khác. Đừng nhầm sức mạnh với câu trả lời — các bức tường của Thất Trấn được dựng lên vì một lời hứa.",
      options: [
        { label: "Đổi", action: { t: "character_select" } },
        { label: "Thôi", action: { t: "close" } },
      ],
    },
  },
  lowHumanity: {
    start: "greet",
    nodes: {
      greet: {
        speaker: "Bậc thầy",
        portrait: "portrait_character_master",
        text: "Bước chân ngươi nặng như đang mang theo một người khác. Ta vẫn có thể dạy ngươi chiến đấu, nhưng không thể chọn thay điều đang thức tỉnh.",
        options: [
          { label: "Đổi lối chiến đấu", action: { t: "character_select" } },
          { label: "Hỏi về ký ức", action: { t: "next", node: "echo" } },
          { label: "Để sau", action: { t: "close" } },
        ],
      },
      echo: {
        speaker: "Bậc thầy",
        portrait: "portrait_character_master",
        text: "Có những ký ức chỉ thuộc về người đã khuất. Đừng để chúng quyết định ngươi là ai.",
        options: [{ label: "Ta sẽ nhớ", action: { t: "close" } }],
      },
    },
  },
};

export const MASTER_LOCKED_DIALOGUE: Dialogue = {
  start: "locked",
  nodes: {
    locked: {
      speaker: "Bậc thầy",
      portrait: "portrait_character_master",
      text: "Lựa chọn của ngươi đã khắc sâu vào chuyến đi này. Tiếp tục đi — có những bí mật về Thất Trấn mà chỉ Cõi Hoang mới còn lưu giữ.",
      options: [{ label: "Ta hiểu", action: { t: "close" } }],
    },
  },
  lowHumanity: {
    start: "locked",
    nodes: {
      locked: {
        speaker: "Bậc thầy",
        portrait: "portrait_character_master",
        text: "Ngươi không còn bước đi một mình. Hãy tự phân biệt đâu là ký ức của mình trước khi chọn con đường tiếp theo.",
        options: [
          { label: "Hỏi về tiếng vọng", action: { t: "next", node: "echo" } },
          { label: "Tiếp tục", action: { t: "close" } },
        ],
      },
      echo: {
        speaker: "Bậc thầy",
        portrait: "portrait_character_master",
        text: "Ta không thể lấy nó khỏi ngươi. Chỉ có thể nhắc rằng lựa chọn vẫn là của ngươi.",
        options: [{ label: "Ta hiểu", action: { t: "close" } }],
      },
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

export const NPC_DIALOGUES: Record<NpcKind, Dialogue> = {
  merchant: MERCHANT_DIALOGUE,
  guard: GUARD_DIALOGUE,
  character_master: MASTER_DIALOGUE,
};
