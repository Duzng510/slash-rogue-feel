import { CONFIG } from "../config.ts";
import type { World } from "../world/world.ts";
import type { Sprite } from "../render/pixelart.ts";
import { ARTIFACT_COLORS, unlockArtifactFor } from "../systems/artifacts.ts";
import { CHARACTERS, COMBO_HITS } from "../systems/characters.ts";
import { WEAPONS } from "../systems/weapons.ts";
import { ACHIEVEMENT_NAMES, type AchievementId } from "../systems/unlocks.ts";
import { dialogueOptionAt, dialogueOptionBounds } from "./dialogueLayout.ts";

const P = CONFIG.PALETTE;

/** greedy word wrap to the card width, in canvas measure units */
function wrapLines(o: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && o.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

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

  drawInteractPrompt(o: CanvasRenderingContext2D, scale: number, origin: { x: number; y: number }): void {
    const npc = this.world.nearbyNpc;
    if (npc === null || this.world.mode !== "town" || this.world.dialogue !== null) return;
    if (
      this.world.characterChoices.length > 0 ||
      this.world.weaponChoices !== null ||
      this.world.shopOffers !== null ||
      this.world.artifactChoices.length > 0 ||
      this.world.roomChoices !== null
    ) return;

    const wx = Math.round(npc.x - origin.x);
    const wy = Math.round(npc.y - npc.bodyH - 14 - origin.y);

    o.save();
    o.scale(scale, scale);
    o.font = "bold 6px ui-monospace, monospace";
    o.textAlign = "center";
    o.textBaseline = "middle";
    const text = npc.prompt;
    const tw = o.measureText(text).width;
    const bgW = Math.ceil(tw) + 8;
    const bgH = 10;
    o.fillStyle = "rgba(5, 7, 11, 0.9)";
    o.fillRect(wx - bgW / 2, wy - bgH / 2, bgW, bgH);
    o.strokeStyle = "#7fd1ff";
    o.lineWidth = 1;
    o.strokeRect(wx - bgW / 2 + 0.5, wy - bgH / 2 + 0.5, bgW - 1, bgH - 1);
    o.fillStyle = "#d8f0ff";
    o.fillText(text, wx, wy);
    o.restore();
    o.textBaseline = "alphabetic";
    o.textAlign = "left";
  }

  modalAt(x: number, y: number): string | null {
    const w = this.world;
    if (w.dialogue !== null) {
      const node = w.dialogue.source.nodes[w.dialogue.nodeId];
      if (!node) return null;
      const option = dialogueOptionAt(x, y, node.options.length);
      return option === null ? null : `d:${option}`;
    }
    if (w.roomChoices !== null) {
      if (y < 38 || y > 158) return null;
      const i = x >= 12 && x <= 104 ? 0 : x >= 114 && x <= 206 ? 1 : x >= 216 && x <= 308 ? 2 : -1;
      const choice = w.roomChoices.choices[i];
      return i >= 0 && choice !== undefined && !choice.disabled ? `e:${i}` : null;
    }
    if (this.world.characterChoices.length > 0) {
      if (this.world.achievements.ascensionMax > 0 && y >= 164 && y <= 180) {
        if (x >= 104 && x <= 132) return "q:-";
        if (x >= 188 && x <= 216) return "q:+";
        return null;
      }
      if (y < 34 || y >= 164) return null;
      let i = -1;
      if (x >= 12 && x <= 104) i = 0;
      else if (x >= 114 && x <= 206) i = 1;
      else if (x >= 216 && x <= 308) i = 2;
      const id = i < 0 ? undefined : w.characterChoices[i];
      return id === undefined ? null : `p:${id}`;
    }
    if (w.shopOffers !== null) {
      if (y >= 166 && y <= 178 && x >= 16 && x <= 304) return "s:leave";
      // 3 vertical columns for shop: left 12, width 92, gap 10 (col 0: 12-104, col 1: 114-206, col 2: 216-308), y: 38 - 158
      if (y < 38 || y > 158) return null;
      let i = -1;
      if (x >= 12 && x <= 104) i = 0;
      else if (x >= 114 && x <= 206) i = 1;
      else if (x >= 216 && x <= 308) i = 2;
      if (i < 0 || i >= w.shopOffers.length) return null;
      return `s:${i}`;
    }
    if (w.curseOffer !== null && w.room.kind !== "shrine" && y >= 20 && y <= 32) {
      if (x >= 16 && x < 160) return "t:normal";
      if (x >= 160 && x <= 304) return "t:curse";
      return null;
    }
    // 3 vertical columns for artifacts / curses
    const topY = w.curseOffer !== null ? 36 : 38;
    const botY = w.curseOffer !== null ? 142 : 166;
    if (y < topY || y > botY) return null;
    let i = -1;
    if (x >= 12 && x <= 104) i = 0;
    else if (x >= 114 && x <= 206) i = 1;
    else if (x >= 216 && x <= 308) i = 2;
    if (i < 0) return null;

    if (w.curseTab && w.curseOffer !== null) {
      const curse = i < 2 ? w.curseOffer.curses[i] : undefined;
      return curse ? `c:${curse.id}` : null;
    }
    const artifact = w.artifactChoices[i];
    return artifact && !w.artifacts.has(artifact.id) ? `a:${artifact.id}` : null;
  }

  /** the run-start build choice: impressive character selection stage with pedestals, animated preview models and glowing runes */
  drawCharacters(o: CanvasRenderingContext2D, scale: number): void {
    const list = this.world.characterChoices;
    if (list.length === 0) return;
    const now = performance.now();

    o.save();
    o.scale(scale, scale);

    // Deep cosmic background with dark gradient
    const bgGrad = o.createRadialGradient(160, 90, 20, 160, 90, 180);
    bgGrad.addColorStop(0, "rgba(15, 20, 32, 0.96)");
    bgGrad.addColorStop(1, "rgba(5, 7, 12, 0.98)");
    o.fillStyle = bgGrad;
    o.fillRect(0, 0, 320, 180);

    // Subtle atmospheric floating magical motes
    for (let i = 0; i < 18; i++) {
      const px = (Math.sin(now * 0.0007 + i * 2.3) * 0.5 + 0.5) * 320;
      const py = (Math.cos(now * 0.0009 + i * 1.7) * 0.5 + 0.5) * 180;
      const pAlpha = 0.15 + 0.15 * Math.sin(now * 0.002 + i);
      o.fillStyle = i % 2 === 0 ? "rgba(100, 200, 255," + pAlpha + ")" : "rgba(255, 200, 100," + pAlpha + ")";
      o.fillRect(Math.floor(px), Math.floor(py), 1.5, 1.5);
    }

    // Title banner with glowing aura
    o.textBaseline = "top";
    o.textAlign = "center";
    o.shadowColor = "#4da3ff";
    o.shadowBlur = 4;
    o.fillStyle = "#ffffff";
    o.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    o.fillText("CHỌN ANH HÙNG XUẤT TRẬN", 160, 8);
    o.shadowBlur = 0;

    o.font = "bold 6.5px sans-serif";
    o.fillStyle = "#8ab4ff";
    o.fillText("Bấm phím [1], [2], [3] hoặc chạm/nhấn vào thẻ nhân vật để bắt đầu", 160, 23);

    const cardW = 92;
    const cardH = 130;
    const cardY = 34;

    list.forEach((id, i) => {
      const c = CHARACTERS[id];
      const cardX = 12 + i * 102;
      const midX = cardX + cardW / 2;

      // Card Base
      o.fillStyle = "rgba(13, 17, 26, 0.95)";
      o.fillRect(cardX, cardY, cardW, cardH);

      // Card Outline with soft glow
      o.strokeStyle = c.color;
      o.lineWidth = 1;
      o.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);

      // Top color banner
      o.fillStyle = c.color;
      o.fillRect(cardX, cardY, cardW, 2);

      // Hotkey badge [1], [2], [3]
      o.fillStyle = "#0a0d14";
      o.fillRect(cardX + 4, cardY + 4, 13, 11);
      o.strokeStyle = c.color;
      o.strokeRect(cardX + 4.5, cardY + 4.5, 12, 10);
      o.textAlign = "center";
      o.fillStyle = "#ffffff";
      o.font = "bold 7px sans-serif";
      o.fillText(`${i + 1}`, cardX + 10.5, cardY + 6);

      // Character Title
      o.textAlign = "left";
      o.font = "bold 9px sans-serif";
      o.fillStyle = "#ffffff";
      o.fillText(c.name, cardX + 21, cardY + 6);

      if (this.world.achievements.charactersWon.has(id)) {
        o.fillStyle = "#ffd166";
        o.font = "bold 5.5px sans-serif";
        o.textAlign = "right";
        o.fillText("✓ ĐÃ PHÁ ĐẢO", cardX + cardW - 4, cardY + 6);
        o.textAlign = "left";
      }

      // --- Pedestal & Summoning Circle ---
      const pedY = cardY + 42;
      // Glowing rune aura beneath feet
      const pulse = 0.6 + 0.35 * Math.sin(now * 0.005 + i * 1.5);
      o.save();
      o.globalAlpha = pulse;
      o.strokeStyle = c.color;
      o.lineWidth = 1.2;
      o.beginPath();
      o.ellipse(midX, pedY + 4, 22, 6, 0, 0, Math.PI * 2);
      o.stroke();
      o.fillStyle = c.color;
      o.globalAlpha = pulse * 0.25;
      o.fill();
      o.restore();

      // Stone pedestal
      o.fillStyle = "#1e2638";
      o.beginPath();
      o.ellipse(midX, pedY + 6, 17, 4.5, 0, 0, Math.PI * 2);
      o.fill();
      o.fillStyle = "#111622";
      o.fillRect(midX - 17, pedY + 6, 34, 4);
      o.beginPath();
      o.ellipse(midX, pedY + 10, 17, 4.5, 0, 0, Math.PI * 2);
      o.fill();

      // --- Live Sprite Model Preview ---
      const spriteKey = `player_${id}`;
      const sp = this.sprites[spriteKey] ?? this.sprites.player;
      if (sp) {
        // Gentle breathing/idle bob animation
        const bob = Math.round(Math.sin(now * 0.004 + i * 2) * 1.5);
        const sprX = Math.round(midX - sp.ax);
        const sprY = Math.round(pedY + 4 - sp.ay + bob);
        o.drawImage(sp.c, sprX, sprY);
      }

      // --- Stat Bars (HP, DMG, SPD) ---
      const statY = cardY + 48;
      o.font = "bold 6.5px sans-serif";

      // HP Bar
      o.fillStyle = "#8d99ae";
      o.fillText("MÁU", cardX + 6, statY);
      o.fillStyle = "#161d2d";
      o.fillRect(cardX + 26, statY + 1, 58, 4);
      o.fillStyle = "#ef233c";
      const hpFill = Math.min(58, Math.round((c.baseHp / 7) * 58));
      o.fillRect(cardX + 26, statY + 1, hpFill, 4);

      // DMG Bar
      o.fillStyle = "#8d99ae";
      o.fillText("CÔNG", cardX + 6, statY + 7);
      o.fillStyle = "#161d2d";
      o.fillRect(cardX + 26, statY + 8, 58, 4);
      o.fillStyle = "#ffd166";
      const dmgFill = Math.min(58, Math.round((c.damageMult / 1.5) * 58));
      o.fillRect(cardX + 26, statY + 8, dmgFill, 4);

      // SPD Bar
      o.fillStyle = "#8d99ae";
      o.fillText("TỐC", cardX + 6, statY + 14);
      o.fillStyle = "#161d2d";
      o.fillRect(cardX + 26, statY + 15, 58, 4);
      o.fillStyle = "#06d6a0";
      const spdFill = Math.min(58, Math.round((c.speedMult / 1.2) * 58));
      o.fillRect(cardX + 26, statY + 15, spdFill, 4);

      // Divider line
      o.fillStyle = "#222c3f";
      o.fillRect(cardX + 6, cardY + 70, cardW - 12, 1);

      // --- Skill Section ---
      o.font = "bold 7px sans-serif";
      o.fillStyle = "#ffd166";
      o.fillText(`[E] ${c.skillName}`, cardX + 6, cardY + 74);
      o.font = "6.5px sans-serif";
      o.fillStyle = "#c5d3e8";
      wrapLines(o, c.skillDesc, cardW - 12).forEach((t, j) => {
        o.fillText(t, cardX + 6, cardY + 82 + j * 8, cardW - 12);
      });

      // --- Passive Section ---
      o.font = "bold 7px sans-serif";
      o.fillStyle = c.color;
      o.fillText(`Nội tại: ${c.passiveName}`, cardX + 6, cardY + 99);
      o.font = "6.5px sans-serif";
      o.fillStyle = "#9db0cc";
      wrapLines(o, c.passiveDesc, cardW - 12).forEach((t, j) => {
        o.fillText(t, cardX + 6, cardY + 108 + j * 7, cardW - 12);
      });
    });

    if (this.world.achievements.ascensionMax > 0) {
      o.fillStyle = "rgba(5, 7, 11, 0.96)";
      o.fillRect(0, 164, 320, 16);
      o.textBaseline = "top";
      o.textAlign = "center";
      o.font = "bold 7px ui-monospace, monospace";
      o.fillStyle = "#ffd166";
      o.fillText(`ASCENSION ${this.world.ascensionLevel} / ${this.world.achievements.ascensionMax}`, 160, 168);
      o.fillStyle = "#161d2d";
      o.fillRect(108, 166, 20, 12);
      o.fillRect(192, 166, 20, 12);
      o.strokeStyle = "#ffd166";
      o.strokeRect(108.5, 166.5, 19, 11);
      o.strokeRect(192.5, 166.5, 19, 11);
      o.fillStyle = "#ffffff";
      o.font = "bold 10px ui-monospace, monospace";
      o.fillText("−", 118, 167);
      o.fillText("+", 202, 167);
    }

    o.restore();
  }

  private drawDialogue(o: CanvasRenderingContext2D, scale: number): void {
    const dialogue = this.world.dialogue;
    if (dialogue === null) return;
    const node = dialogue.source.nodes[dialogue.nodeId];
    if (!node) return;
    o.save();
    o.scale(scale, scale);
    o.fillStyle = "rgba(7, 10, 16, 0.94)";
    o.fillRect(24, 28, 272, 124);
    o.strokeStyle = "#7fd1ff";
    o.strokeRect(24.5, 28.5, 271, 123);
    o.fillStyle = "#e4ebf7";
    o.textAlign = "left";
    o.textBaseline = "top";
    o.font = "bold 10px sans-serif";
    o.fillText(node.speaker, 36, 38);
    o.fillStyle = "#9db0cc";
    o.font = "7px sans-serif";
    const shown = node.text.slice(0, Math.floor(dialogue.charIndex));
    const lines = wrapLines(o, shown, 210);
    lines.slice(0, 4).forEach((line, index) => o.fillText(line, 36, 54 + index * 10));
    if (dialogue.charIndex < node.text.length) {
      const lastLine = lines[lines.length - 1] ?? "";
      const cursorX = 36 + o.measureText(lastLine).width + 1;
      const cursorY = 54 + (lines.length - 1) * 10;
      if (Math.floor(performance.now() / 200) % 2 === 0) {
        o.fillStyle = "#7fd1ff";
        o.fillRect(cursorX, cursorY + 1, 4, 1);
      }
    }
    const optsReady = dialogue.charIndex >= node.text.length;
    node.options.forEach((option, i) => {
      const { x, y, width, height } = dialogueOptionBounds(i);
      o.fillStyle = optsReady ? "rgba(17, 22, 34, 0.95)" : "rgba(10, 13, 20, 0.95)";
      o.fillRect(x, y, width, height);
      o.strokeStyle = optsReady ? "#ffd166" : "#3a4458";
      o.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      o.fillStyle = optsReady ? "#ffffff" : "#7a8aa5";
      o.font = "bold 7px sans-serif";
      o.fillText(`[${i + 1}] ${option.label}`, x + 8, y + 4);
    });
    o.restore();
  }

  drawArtifacts(o: CanvasRenderingContext2D, scale: number): void {
    if (this.world.dialogue !== null) {
      this.drawDialogue(o, scale);
      return;
    }
    if (this.world.roomChoices !== null) {
      this.drawRoomChoices(o, scale);
      return;
    }
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
    o.fillText(shop !== null ? "CỬA HÀNG" :
      this.world.room.kind === "shrine" ? "HIẾN TẾ ĐỔI CỔ VẬT" :
        this.world.curseTab && offer !== null ? "HAI CỔ VẬT + MỘT NGUYỀN RỦA" : "CHỌN MỘT CỔ VẬT", 160, 10);
    o.font = "7px sans-serif";
    if (shop !== null) {
      o.fillStyle = "#ffd166";
      o.fillText(`Vàng đang có: ◆ ${this.world.runStats.gold}`, 160, 26);
    } else if (offer === null) {
      o.fillStyle = "#a7b4c9";
      o.fillText("Đã sạch phòng · Chạm để chọn và tiếp tục", 160, 26);
    } else {
      if (this.world.room.kind !== "shrine") {
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
    }
    o.textAlign = "left";
    const cards = shop !== null
      ? shop.map(offer => offer.kind === "artifact" && offer.artifact !== undefined
        ? { id: offer.artifact.id, name: offer.artifact.name, desc: offer.artifact.desc, color: ARTIFACT_COLORS[offer.artifact.id], price: offer.price as number | null }
        : offer.kind === "heal"
          ? { id: "heal", name: "Hồi 2 HP", desc: "Hồi ngay 2 máu.", color: "#58ff8a", price: offer.price as number | null }
          : offer.kind === "maxhp"
            ? { id: "maxhp", name: "+1 HP tối đa", desc: "Tăng máu tối đa thêm 1, hồi kèm 1 máu.", color: "#4da3ff", price: offer.price as number | null }
            : { id: "curse_remove", name: "Gỡ nguyền rủa", desc: "Gỡ bỏ một nguyền rủa đang mang.", color: "#ff5a7a", price: offer.price as number | null })
      : this.world.curseTab && offer !== null
        ? offer.curses.map(c => ({ id: c.id, name: c.name, desc: c.desc, color: "#ff5a7a", price: null as number | null }))
        : this.world.artifactChoices.slice(0, 3).map(a => ({ id: a.id, name: a.name, desc: a.desc, color: ARTIFACT_COLORS[a.id], price: null as number | null }));

    const cardW = 92;
    const cardH = offer !== null && this.world.curseTab ? 96 : shop !== null ? 120 : 126;
    const startY = offer !== null ? 36 : 38;
    const tick = this.world.tickCount;

    cards.forEach((card, i) => {
      const x = 12 + i * 102;
      const y = startY;
      const affordable = card.price === null || this.world.runStats.gold >= card.price;
      o.globalAlpha = affordable ? 1 : 0.45;

      // Card background
      o.fillStyle = "#111622";
      o.fillRect(x, y, cardW, cardH);

      // Card border
      o.strokeStyle = card.color;
      o.lineWidth = 1;
      o.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);

      // Header top accent
      o.fillStyle = card.color;
      o.fillRect(x, y, cardW, 3);

      // Elemental dynamic aura effects
      if (affordable) {
        o.save();
        const cid = card.id;
        if (cid === "lightning" || cid === "chain_lightning") {
          // Lightning spark arcs around the border
          o.strokeStyle = "#ffffff";
          o.lineWidth = 1;
          for (let s = 0; s < 3; s++) {
            const seed = (tick * 0.4 + s * 13) % 40;
            const sx = x + (seed < 20 ? (seed / 20) * cardW : cardW);
            const sy = y + (seed >= 20 ? ((seed - 20) / 20) * cardH : 0);
            o.beginPath();
            o.moveTo(sx, sy);
            o.lineTo(sx + (Math.sin(tick + s) * 4), sy + (Math.cos(tick + s) * 4));
            o.stroke();
          }
        } else if (cid === "fire" || cid === "detonate") {
          // Fire ember glow floating upwards
          o.fillStyle = "#ff6a00";
          for (let s = 0; s < 4; s++) {
            const ex = x + 10 + ((s * 23 + tick * 0.7) % (cardW - 20));
            const ey = y + cardH - 6 - ((tick * 1.2 + s * 19) % (cardH * 0.7));
            o.fillRect(ex, ey, 2, 2);
          }
        } else if (cid === "freeze" || cid === "water") {
          // Frost crystal shine
          o.fillStyle = "#e0f8ff";
          const fx = x + 6 + (Math.sin(tick * 0.08 + i) * 0.5 + 0.5) * (cardW - 12);
          const fy = y + 8;
          o.fillRect(fx, fy, 2, 2);
        } else if (cid === "poison" || cid === "bleed") {
          // Venom / Blood drip pulse
          o.fillStyle = card.color;
          const dropY = y + 8 + ((tick * 0.6 + i * 15) % 18);
          o.fillRect(x + 8 + i * 10, dropY, 2, 3);
        }
        o.restore();
      }

      // Title
      o.font = "bold 8.5px sans-serif";
      o.fillStyle = "#ffffff";
      o.fillText(card.name, x + 6, y + 8, cardW - 12);

      // Price tag if in shop
      if (card.price !== null) {
        o.font = "bold 8px sans-serif";
        o.fillStyle = affordable ? "#ffd166" : "#ff5a7a";
        o.fillText(`◆ ${card.price}`, x + 6, y + 21);
      }

      // Separator line
      o.fillStyle = "#222c3f";
      o.fillRect(x + 6, y + (card.price !== null ? 31 : 21), cardW - 12, 1);

      // Description with word-wrap
      o.font = "7.5px sans-serif";
      o.fillStyle = "#b4c4d9";
      const lines: string[] = [];
      let line = "";
      for (const word of card.desc.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && o.measureText(next).width > cardW - 12) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
      const textStartY = y + (card.price !== null ? 35 : 25);
      lines.forEach((text, j) => {
        if (textStartY + j * 10 < y + cardH - 4) {
          o.fillText(text, x + 6, textStartY + j * 10, cardW - 12);
        }
      });
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
      o.fillText(`Nhận: ${offer.artifacts.map(a => a.name).join(" + ")}`, 16, 148, 288);
      o.fillStyle = "#a7b4c9";
      o.fillText("Chạm một nguyền rủa để nhận cả gói", 16, 160, 288);
    }
    o.restore();
  }

  private drawRoomChoices(o: CanvasRenderingContext2D, scale: number): void {
    const offer = this.world.roomChoices;
    if (offer === null) return;
    o.save();
    o.scale(scale, scale);
    o.fillStyle = "rgba(8, 9, 13, 0.94)";
    o.fillRect(0, 0, 320, 180);
    o.textBaseline = "top";
    o.textAlign = "center";
    o.fillStyle = "#e4ebf7";
    o.font = "bold 11px sans-serif";
    o.fillText(offer.title, 160, 12);
    o.fillStyle = "#a7b4c9";
    o.font = "7px sans-serif";
    o.fillText(offer.subtitle, 160, 28);
    offer.choices.forEach((choice, i) => {
      const x = 12 + i * 102;
      const color = choice.disabled ? "#626a78" : i === 2 ? "#c99ae6" : "#ffd166";
      o.globalAlpha = choice.disabled ? 0.48 : 1;
      o.fillStyle = "#111622";
      o.fillRect(x, 48, 92, 88);
      o.strokeStyle = color;
      o.strokeRect(x + 0.5, 48.5, 91, 87);
      o.fillStyle = color;
      o.fillRect(x, 48, 92, 3);
      o.fillStyle = "#ffffff";
      o.font = "bold 8px sans-serif";
      o.fillText(`[${i + 1}] ${choice.label}`, x + 46, 64, 82);
      o.fillStyle = "#b8c2d4";
      o.font = "7px sans-serif";
      const lines = wrapLines(o, choice.detail, 78);
      lines.slice(0, 4).forEach((line, lineIndex) => o.fillText(line, x + 46, 82 + lineIndex * 9, 80));
      o.globalAlpha = 1;
    });
    o.restore();
  }

  /** persistent strip of owned artifacts, placed below room info and gold */
  drawOwnedArtifacts(o: CanvasRenderingContext2D, scale: number): void {
    const ids = [...this.world.artifacts];
    if (ids.length === 0) return;
    const size = 8;
    const gap = 3;
    const pad = 2;
    const left = 6;
    const top = 36;
    const width = ids.length * (size + gap) - gap;
    o.fillStyle = "rgba(5, 7, 11, 0.72)";
    o.fillRect(
      Math.round((left - pad) * scale),
      Math.round((top - pad) * scale),
      Math.round((width + pad * 2) * scale),
      Math.round((size + pad * 2) * scale)
    );
    ids.forEach((id, i) => {
      const icon = this.sprites[`artifact_${id}`];
      const x = Math.round((left + i * (size + gap)) * scale);
      const y = Math.round(top * scale);
      if (icon !== undefined) o.drawImage(icon.c, x, y, Math.round(size * scale), Math.round(size * scale));
      else {
        o.fillStyle = ARTIFACT_COLORS[id];
        o.fillRect(x, y, Math.round(size * scale), Math.round(size * scale));
      }
    });
  }

  draw(o: CanvasRenderingContext2D, scale: number): void {
    const w = this.world;
    const full = this.sprites.heart_full;
    const empty = this.sprites.heart_empty;
    const step = 9;

    // 1. Dãy tim máu (HP): Hỗ trợ cuộn/gập hàng khi maxHp lớn (D10)
    const maxPerRow = 10;
    const clampedStep = w.player.maxHp > maxPerRow ? 8 : step;
    for (let i = 0; i < w.player.maxHp; i++) {
      const col = i % maxPerRow;
      const row = Math.floor(i / maxPerRow);
      const x = Math.round((6 + col * clampedStep) * scale);
      const y = Math.round((6 + row * 8) * scale);
      const width = full.w * scale;
      const height = full.h * scale;
      const fill = Math.max(0, Math.min(1, w.player.hp - i));
      o.drawImage(empty.c, x, y, empty.w * scale, empty.h * scale);
      if (fill >= 1 && i === 0 && w.player.hp <= 1) {
        const pulse = 1 + 0.05 * Math.sin(w.tickCount * 0.18);
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

    // 2. Thông tin nhân vật và vũ khí (Tách sang bên phải với khoảng cách thoáng tối thiểu 72px)
    const cdef = CHARACTERS[w.player.character];
    const heartsWidth = Math.min(maxPerRow, w.player.maxHp) * clampedStep;
    const badgeX = Math.max(72, 10 + heartsWidth + 8);

    // Huy hiệu & Tên nhân vật (Hàng 1: y = 5)
    o.textBaseline = "top";
    o.fillStyle = cdef.color;
    o.fillRect(Math.round(badgeX * scale), Math.round(6 * scale), Math.round(5 * scale), Math.round(5 * scale));
    o.font = `${Math.round(6 * scale)}px ui-monospace, monospace`;
    o.globalAlpha = 0.9;
    o.fillStyle = P.TEXT;
    o.fillText(cdef.name, Math.round((badgeX + 8) * scale), Math.round(5 * scale));

    // Huy hiệu & Tên vũ khí (Hàng 2: y = 14)
    const wdef = WEAPONS[w.player.weapon];
    if (wdef) {
      const wy = Math.round(14 * scale);
      o.fillStyle = wdef.color;
      o.fillRect(Math.round(badgeX * scale), wy + Math.round(1 * scale), Math.round(4 * scale), Math.round(4 * scale));
      o.font = `${Math.round(5.5 * scale)}px sans-serif`;
      o.globalAlpha = 0.9;
      o.fillStyle = wdef.color;
      const weaponLabel = w.player.weaponDamageBonus > 0
        ? `${wdef.name} +${w.player.weaponDamageBonus} dmg`
        : wdef.name;
      o.fillText(weaponLabel, Math.round((badgeX + 8) * scale), wy);
    }
    o.globalAlpha = 1;

    // Swordsman combo dots
    if (w.player.character === "swordsman") {
      const cx = Math.round(badgeX * scale);
      const cy = Math.round(23 * scale);
      if (w.player.comboHits > 0 || w.player.comboBonus) {
        for (let i = 0; i < COMBO_HITS; i++) {
          o.fillStyle = (w.player.comboBonus || i < w.player.comboHits) ? "#ffd166" : "#2b3242";
          o.fillRect(cx + i * 3 * scale, cy, Math.round(2 * scale), Math.round(2 * scale));
        }
      }
      if (w.player.comboBonus) {
        o.fillStyle = "#ffd166";
        o.font = `bold ${Math.round(6 * scale)}px sans-serif`;
        o.fillText("+50%", cx + 17 * scale, cy - Math.round(1 * scale));
      }
    }

    // 3. Tiến trình phòng & Vàng (Tách xuống hàng y = 16 và y = 25)
    o.font = `${Math.round(6 * scale)}px ui-monospace, monospace`;
    o.textBaseline = "top";
    o.fillStyle = P.TEXT;
    o.globalAlpha = 0.75;
    const roomLabel = w.mode === "town"
      ? w.room.name
      : `${w.roomIndex + 1}/${w.roomTotal}  ${w.room.name}`;
    o.fillText(roomLabel, Math.round(6 * scale), Math.round(16 * scale));
    o.fillStyle = P.ENEMY_EYE;
    const coinY = Math.round((25 + Math.sin(w.tickCount * 0.1)) * scale);
    o.fillText(`◆ ${w.runStats.gold}`, Math.round(6 * scale), coinY);
    o.globalAlpha = 1;

    /** vertical skill gauge, top-right (the bottom-left corner belongs to the touch stick) */
    const total = cdef.skillCd;
    const ratio = w.player.skillCd <= 0 ? 1 : 1 - w.player.skillCd / total;
    const gx = Math.round(312 * scale);
    const gy = Math.round(14 * scale);
    const radius = Math.max(3, Math.round(5 * scale));
    o.beginPath();
    o.strokeStyle = P.VOID;
    o.lineWidth = Math.max(2, Math.round(2 * scale));
    o.arc(gx, gy, radius, 0, Math.PI * 2);
    o.stroke();
    o.beginPath();
    o.strokeStyle = ratio >= 1 ? "#ffffff" : "#2b3242";
    o.lineWidth = Math.max(1, Math.round(scale));
    o.arc(gx, gy, radius, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
    if (ratio >= 1) {
      o.save();
      const pulse = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(w.tickCount * 0.2));
      o.globalAlpha = pulse;
      o.shadowColor = "#ffffff";
      o.shadowBlur = 4 * scale;
      o.stroke();
      o.restore();
    } else o.stroke();
    o.fillStyle = P.TEXT;
    o.textAlign = "center";
    o.fillText("E", gx, gy + radius + Math.round(2 * scale));
    o.textAlign = "left";

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

  if (w.bannerTicks > 0 && w.bannerText.length > 0) {
    const fadeIn = Math.min(1, (w.bannerDuration - w.bannerTicks + 1) / 6);
    const a = Math.min(fadeIn, w.bannerTicks / 24);
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

    if (w.introLineTicks > 0 && w.introLine.length > 0) {
      o.globalAlpha = Math.min(1, w.introLineTicks / 24);
      o.font = `${Math.round(7 * scale)}px ui-monospace, monospace`;
      const text = `${CHARACTERS[w.player.character].name}: "${w.introLine}"`;
      const tw = o.measureText(text).width;
      const x = Math.round((o.canvas.width - tw) / 2);
      const y = Math.round(o.canvas.height * 0.8);
      o.fillStyle = P.VOID;
      o.fillRect(x - 5, y - 3, tw + 10, Math.round(11 * scale));
      o.fillStyle = P.TEXT;
      o.fillText(text, x, y);
      o.globalAlpha = 1;
    }
  }
}
