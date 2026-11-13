export type NpcKind = "merchant" | "guard" | "character_master";

export const NPC_PROMPTS: Record<NpcKind, string> = {
  merchant: "[F] Cửa hàng",
  guard: "[F] Hỏi thăm",
  character_master: "[F] Nói chuyện",
};

/** Passive town entity; World owns proximity and interaction behavior. */
export class Npc {
  readonly kind: NpcKind;
  x: number;
  y: number;
  facing = Math.PI;
  animTicks = 0;
  readonly bodyW = 12;
  readonly bodyH = 16;
  readonly prompt: string;

  constructor(x: number, y: number, kind: NpcKind) {
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.prompt = NPC_PROMPTS[kind];
  }

  tick(): void {
    this.animTicks++;
  }

  faceToward(tx: number): void {
    if (Math.abs(tx - this.x) > 0.5) this.facing = tx > this.x ? 0 : Math.PI;
  }
}
