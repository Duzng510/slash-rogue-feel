import type { Player } from "../../entities/player.ts";
import type { Sprite } from "../../render/pixelart.ts";

export function drawHpBar(
  o: CanvasRenderingContext2D,
  scale: number,
  player: Player,
  tickCount: number,
  sprites: Record<string, Sprite>,
): number {
  const full = sprites.heart_full;
  const empty = sprites.heart_empty;
  const maxPerRow = 10;
  const clampedStep = player.maxHp > maxPerRow ? 8 : 9;
  for (let i = 0; i < player.maxHp; i++) {
    const col = i % maxPerRow;
    const row = Math.floor(i / maxPerRow);
    const x = Math.round((6 + col * clampedStep) * scale);
    const y = Math.round((6 + row * 8) * scale);
    const width = full.w * scale;
    const height = full.h * scale;
    const fill = Math.max(0, Math.min(1, player.hp - i));
    o.drawImage(empty.c, x, y, empty.w * scale, empty.h * scale);
    if (fill >= 1 && i === 0 && player.hp <= 1) {
      const pulse = 1 + 0.05 * Math.sin(tickCount * 0.18);
      o.save();
      o.translate(x + width / 2, y + height / 2);
      o.scale(pulse, pulse);
      o.drawImage(full.c, -width / 2, -height / 2, width, height);
      o.restore();
    } else if (fill >= 1) o.drawImage(full.c, x, y, width, height);
    else if (fill >= 0.5) {
      o.save();
      o.beginPath();
      o.rect(x, y, Math.ceil(width / 2), height);
      o.clip();
      o.drawImage(full.c, x, y, width, height);
      o.restore();
    }
  }
  return Math.min(maxPerRow, player.maxHp) * clampedStep;
}
