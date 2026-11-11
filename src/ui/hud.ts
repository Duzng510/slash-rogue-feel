import { CONFIG } from "../config.ts";
import type { World } from "../world/world.ts";
import type { Sprite } from "../render/pixelart.ts";
import { ARTIFACT_COLORS, unlockArtifactFor } from "../systems/artifacts.ts";
import { ACHIEVEMENT_NAMES, type AchievementId } from "../systems/unlocks.ts";

const P = CONFIG.PALETTE;

export class Hud {
  private toastText = "";
  private toastUntil = 0;

  constructor(
    private readonly world: World,
    private readonly sprites: Record<string, Sprite>
  ) {}

  /** queue the top-right unlock/achievement toast for ~2s with a fade-out tail */
  pushAchievement(id: AchievementId): void {
    const artifact = unlockArtifactFor(id);
    this.toastText = artifact !== null ? `MỞ KHÓA: ${artifact.name}` : `THÀNH TỰU: ${ACHIEVEMENT_NAMES[id]}`;
    this.toastUntil = performance.now() + 2000;
  }

  drawAchievementToast(o: CanvasRenderingContext2D, scale: number): void {
    const remaining = this.toastUntil - performance.now();
    if (remaining <= 0) return;
    const alpha = Math.min(1, remaining / 400);
    o.save();
    o.scale(scale, scale);
    o.globalAlpha = alpha;
    o.textBaseline = "top";
    o.textAlign = "right";
    o.font = "bold 8px sans-serif";
    const padX = 4;
    const tw = o.measureText(this.toastText).width;
    const right = CONFIG.WORLD.INTERNAL_W - 6;
    const top = 6;
    o.fillStyle = "rgba(8, 9, 13, 0.9)";
    o.fillRect(right - tw - padX * 2, top, tw + padX * 2, 15);
    o.fillStyle = "#ffd166";
    o.fillText(this.toastText, right - padX, top + 4);
    o.restore();
  }

  modalAt(x: number, y: number): string | null {
    const w = this.world;
    if (w.shopOffers !== null) {
      if (y >= 166 && y <= 178 && x >= 16 && x <= 304) return "s:leave";
      if (x < 16 || x > 304) return null;
      const i = Math.floor((y - 40) / 43);
      if (i < 0 || i > 2 || y > 40 + i * 43 + 38 || i >= w.shopOffers.length) return null;
      return `s:${i}`;
    }
    if (w.curseOffer !== null && y >= 24 && y <= 35) {
      if (x >= 16 && x < 160) return "t:normal";
      if (x >= 160 && x <= 304) return "t:curse";
      return null;
    }
    if (x < 16 || x > 304) return null;
    const i = Math.floor((y - 40) / 43);
    if (i < 0 || i > 2 || y > 40 + i * 43 + 38) return null;
    if (w.curseTab && w.curseOffer !== null) {
      const curse = i < 2 ? w.curseOffer.curses[i] : undefined;
      return curse ? `c:${curse.id}` : null;
    }
    const artifact = w.artifactChoices[i];
    return artifact && !w.artifacts.has(artifact.id) ? `a:${artifact.id}` : null;
  }

  drawArtifacts(o: CanvasRenderingContext2D, scale: number): void {
    if (this.world.artifactChoices.length === 0 && this.world.shopOffers === null) return;
    o.save();
    o.scale(scale, scale);
    o.globalAlpha = 1;
    o.fillStyle = "rgba(8, 9, 13, 0.94)";
    o.fillRect(0, 0, 320, 180);
    o.textBaseline = "top";
    o.textAlign = "center";
    o.fillStyle = "#e4ebf7";
    o.font = "bold 11px sans-serif";
    const offer = this.world.curseOffer;
    const shop = this.world.shopOffers;
    o.fillText(shop !== null ? "CỬA HÀNG" : this.world.curseTab && offer !== null ? "HAI CỔ VẬT + MỘT NGUYỀN RỦA" : "CHỌN MỘT CỔ VẬT", 160, 10);
    o.font = "7px sans-serif";
    if (shop !== null) {
      o.fillStyle = "#ffd166";
      o.fillText(`Vàng đang có: ◆ ${this.world.runStats.gold}`, 160, 26);
    } else if (offer === null) {
      o.fillStyle = "#a7b4c9";
      o.fillText("Đã sạch phòng · Chạm để chọn và tiếp tục", 160, 26);
    } else {
      const tabs: [string, number, boolean][] = [
        ["THƯỜNG", 16, !this.world.curseTab],
        ["NGUYỀN RỦA", 160, this.world.curseTab],
      ];
      for (const [label, left, active] of tabs) {
        o.fillStyle = active ? "#2b3242" : "#121419";
        o.fillRect(left, 24, 144, 11);
        o.fillStyle = active ? "#ffd166" : "#a7b4c9";
        o.fillText(label, left + 72, 26);
      }
    }
    o.textAlign = "left";
    const cards = shop !== null
      ? shop.map(offer => offer.kind === "artifact" && offer.artifact !== undefined
        ? { name: offer.artifact.name, desc: offer.artifact.desc, color: ARTIFACT_COLORS[offer.artifact.id], price: offer.price as number | null }
        : offer.kind === "heal"
          ? { name: "Hồi 2 HP", desc: "Hồi ngay 2 máu.", color: "#58ff8a", price: offer.price as number | null }
          : offer.kind === "maxhp"
            ? { name: "+1 HP tối đa", desc: "Tăng máu tối đa thêm 1, hồi kèm 1 máu.", color: "#4da3ff", price: offer.price as number | null }
            : { name: "Gỡ nguyền rủa", desc: "Gỡ bỏ một nguyền rủa đang mang.", color: "#ff5a7a", price: offer.price as number | null })
      : this.world.curseTab && offer !== null
        ? offer.curses.map(c => ({ name: c.name, desc: c.desc, color: "#ff5a7a", price: null as number | null }))
        : this.world.artifactChoices.slice(0, 3).map(a => ({ name: a.name, desc: a.desc, color: ARTIFACT_COLORS[a.id], price: null as number | null }));
    cards.forEach((card, i) => {
      const y = 40 + i * 43;
      o.globalAlpha = card.price === null || this.world.runStats.gold >= card.price ? 1 : 0.45;
      o.fillStyle = "#172233";
      o.fillRect(16, y, 288, 38);
      o.fillStyle = card.color;
      o.fillRect(16, y, 2, 38);
      o.strokeStyle = "#537da6";
      o.lineWidth = 1;
      o.strokeRect(16.5, y + 0.5, 287, 37);
      o.font = "bold 9px sans-serif";
      o.fillStyle = "#d2e8ff";
      o.fillText(card.name, 24, y + 5, 272);
      if (card.price !== null) {
        o.textAlign = "right";
        o.fillStyle = this.world.runStats.gold >= card.price ? "#ffd166" : "#ff5a7a";
        o.fillText(`◆ ${card.price}`, 296, y + 5);
        o.textAlign = "left";
      }
      o.font = "8px sans-serif";
      o.fillStyle = "#c3cddd";
      const lines: string[] = [];
      let line = "";
      for (const word of card.desc.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && o.measureText(next).width > 272) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
      lines.forEach((text, j) => o.fillText(text, 24, y + 18 + j * 9, 272));
      o.globalAlpha = 1;
    });
    if (shop !== null) {
      o.fillStyle = "#2b3242";
      o.fillRect(16, 166, 288, 12);
      o.fillStyle = "#a7b4c9";
      o.textAlign = "center";
      o.font = "bold 8px sans-serif";
      o.fillText("RỜI ĐI", 160, 168);
    }
    if (this.world.curseTab && offer !== null) {
      o.font = "8px sans-serif";
      o.fillStyle = "#ffd166";
      o.fillText(`Nhận: ${offer.artifacts.map(a => a.name).join(" + ")}`, 24, 128, 272);
      o.fillStyle = "#a7b4c9";
      o.fillText("Chạm một nguyền rủa để nhận cả gói", 24, 140, 272);
    }
    o.restore();
  }

  /** persistent strip of owned artifacts, tucked under the hearts so loot is reviewable at a glance */
  drawOwnedArtifacts(o: CanvasRenderingContext2D, scale: number): void {
    const ids = [...this.world.artifacts];
    if (ids.length === 0) return;
    const size = 6;
    const gap = 2;
    const pad = 2;
    const left = 6;
    const top = 26;
    const width = ids.length * (size + gap) - gap;
    o.fillStyle = "rgba(5, 7, 11, 0.72)";
    o.fillRect(
      Math.round((left - pad) * scale),
      Math.round((top - pad) * scale),
      Math.round((width + pad * 2) * scale),
      Math.round((size + pad * 2) * scale)
    );
    ids.forEach((id, i) => {
      o.fillStyle = ARTIFACT_COLORS[id];
      o.fillRect(
        Math.round((left + i * (size + gap)) * scale),
        Math.round(top * scale),
        Math.round(size * scale),
        Math.round(size * scale)
      );
    });
  }

  draw(o: CanvasRenderingContext2D, scale: number): void {
    const w = this.world;
    const full = this.sprites.heart_full;
    const empty = this.sprites.heart_empty;
    const step = 9;
    for (let i = 0; i < w.player.maxHp; i++) {
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
    o.fillStyle = P.ENEMY_EYE;
    o.fillText(`◆ ${w.runStats.gold}`, Math.round(6 * scale), Math.round(24 * scale));
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
