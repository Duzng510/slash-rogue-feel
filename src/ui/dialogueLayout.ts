export type DialogueOptionBounds = { x: number; y: number; width: number; height: number };

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
