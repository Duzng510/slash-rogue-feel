import { CONFIG } from "../config.ts";
import type { World } from "../world/world.ts";
import type { Sprite } from "../render/pixelart.ts";
import type { BoonId } from "../systems/boons.ts";

const P = CONFIG.PALETTE;

export class Hud {
  constructor(
    private readonly world: World,
    private readonly sprites: Record<string, Sprite>
  ) {}

  boonAt(x: number, y: number): BoonId | null {
    if (x < 16 || x > 304) return null;
    const i = Math.floor((y - 40) / 43);
    if (i < 0 || i > 2 || y > 40 + i * 43 + 38) return null;
    const boon = this.world.boonChoices[i];
    return boon && !this.world.boons.has(boon.id) ? boon.id : null;
  }

  drawBoons(o: CanvasRenderingContext2D, scale: number): void {
    if (this.world.boonChoices.length === 0) return;
    o.save();
    o.scale(scale, scale);
    o.globalAlpha = 1;
    o.fillStyle = "rgba(8, 9, 13, 0.94)";
    o.fillRect(0, 0, 320, 180);
    o.textBaseline = "top";
    o.textAlign = "center";
    o.fillStyle = "#e4ebf7";
    o.font = "bold 11px sans-serif";
    o.fillText("CHỌN MỘT CỔ VẬT", 160, 10);
    o.font = "7px sans-serif";
    o.fillStyle = "#a7b4c9";
    o.fillText("Đã sạch phòng · Chạm để chọn và tiếp tục", 160, 26);
    o.textAlign = "left";
    this.world.boonChoices.slice(0, 3).forEach((boon, i) => {
      const y = 40 + i * 43;
      o.fillStyle = "#172233";
      o.fillRect(16, y, 288, 38);
      o.strokeStyle = "#537da6";
      o.lineWidth = 1;
      o.strokeRect(16.5, y + 0.5, 287, 37);
      o.font = "bold 9px sans-serif";
      o.fillStyle = "#d2e8ff";
      o.fillText(boon.name, 24, y + 5, 272);
      o.font = "8px sans-serif";
      o.fillStyle = "#c3cddd";
      const lines: string[] = [];
      let line = "";
      for (const word of boon.desc.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && o.measureText(next).width > 272) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
      lines.forEach((text, j) => o.fillText(text, 24, y + 18 + j * 9, 272));
    });
    o.restore();
  }

  draw(o: CanvasRenderingContext2D, scale: number): void {
    const w = this.world;
    const full = this.sprites.heart_full;
    const empty = this.sprites.heart_empty;
    const step = 9;
    for (let i = 0; i < CONFIG.PLAYER.HP; i++) {
      const s = i < w.player.hp ? full : empty;
      o.drawImage(s.c, Math.round((6 + i * step) * scale), Math.round(6 * scale), s.w * scale, s.h * scale);
    }

    let boss: World["enemies"][number] | null = null;
    for (const e of w.enemies) if (e.def.HP_BAR && !e.dead) boss = e;
    if (boss !== null) {
      const bw = 68;
      const x = Math.round((o.canvas.width / scale - bw) / 2);
      const fill = Math.round((bw * boss.hp) / boss.maxHp);
      o.fillStyle = P.VOID;
      o.fillRect(x - 1, 5, bw + 2, 6);
      o.fillStyle = P.HP_EMPTY;
      o.fillRect(x, 6, bw, 4);
      o.fillStyle = boss.enraged ? P.ENEMY_CHARGER : P.ENEMY_BOSS;
      o.fillRect(x, 6, fill, 4);
    }

    o.font = `${Math.round(6 * scale)}px ui-monospace, monospace`;
    o.textBaseline = "top";
    o.fillStyle = P.TEXT;
    o.globalAlpha = 0.75;
    o.fillText(`${w.roomIndex + 1}/${w.roomTotal}  ${w.room.name}`, Math.round(6 * scale), Math.round(16 * scale));
    o.globalAlpha = 1;

    if (w.bannerTicks > 0 && w.bannerText.length > 0) {
      const a = Math.min(1, w.bannerTicks / 24);
      o.globalAlpha = a;
      o.font = `${Math.round(8 * scale)}px ui-monospace, monospace`;
      const text = w.bannerText.toUpperCase();
      const tw = o.measureText(text).width;
      const x = Math.round((o.canvas.width - tw) / 2);
      const y = Math.round(o.canvas.height * 0.16);
      o.fillStyle = P.VOID;
      o.fillRect(x - 4, y - 2, tw + 8, Math.round(11 * scale));
      o.fillStyle = w.victory ? P.DOOR_OPEN : P.TEXT;
      o.fillText(text, x, y);
      o.globalAlpha = 1;
    }
  }
}
