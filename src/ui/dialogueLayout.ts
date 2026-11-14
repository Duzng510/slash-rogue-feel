export type DialogueOptionBounds = { x: number; y: number; width: number; height: number };
export type ModalKind = "p" | "w" | "a" | "c" | "s" | "t" | "q" | "e" | "d" | "x";
export type ModalKey = `${ModalKind}:${string}` | "restart" | "continue";

export interface Clickable {
  hitTest(x: number, y: number): ModalKey | null;
}

// Modal bounds stay in base logical coordinates; the UI render scale fits them to the internal viewport.
export function dialogueOptionBounds(index: number): DialogueOptionBounds {
  return {
    x: index % 2 === 0 ? 36 : 164,
    y: 108 + Math.floor(index / 2) * 20,
    width: 110,
    height: 16,
  };
}

export function dialogueOptionAt(x: number, y: number, count: number): number | null {
  for (let i = 0; i < count; i++) {
    const bounds = dialogueOptionBounds(i);
    if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) return i;
  }
  return null;
}

export type CardBounds = { x: number; y: number; width: number; height: number };

export function roomChoiceBounds(index: number): CardBounds {
  return { x: 12 + index * 102, y: 48, width: 92, height: 88 };
}

export function roomChoiceAt(x: number, y: number, count: number): number | null {
  for (let i = 0; i < count; i++) {
    const bounds = roomChoiceBounds(i);
    if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) return i;
  }
  return null;
}
