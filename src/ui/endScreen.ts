import { CONFIG } from "../config.ts";
import { TEMPLATES } from "../world/rooms.ts";
import { ARTIFACT_COLORS, type ArtifactId } from "../systems/artifacts.ts";
import { emptyStats, formatRunTime, type RunStats, type EndMode } from "../systems/runStats.ts";
import { ACHIEVEMENT_NAMES, type AchievementId } from "../systems/unlocks.ts";
import type { Clickable, ModalKey } from "./dialogueLayout.ts";

const LW = CONFIG.WORLD.INTERNAL_W / CONFIG.WORLD.PIXEL_SCALE;
const LH = CONFIG.WORLD.INTERNAL_H / CONFIG.WORLD.PIXEL_SCALE;
const ROOM_TOTAL = TEMPLATES.length;

const BTN_W = 140;
const BTN_H = 22;
const BTN_X = Math.round((LW - BTN_W) / 2);

type Box = { x: number; y: number; w: number; h: number };

function inRect(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** full-screen result overlay drawn in the base logical space shared by the other modals */
export class EndScreen implements Clickable {
  private shown = false;
  private mode: EndMode = "dead";
  private stats: RunStats = emptyStats();
  private artifacts: ArtifactId[] = [];
  private unlocked: AchievementId[] = [];

  open(mode: EndMode, stats: RunStats, artifacts: ArtifactId[], unlocked: AchievementId[]): void {
    this.shown = true;
    this.mode = mode;
    this.stats = { ...stats };
    this.artifacts = [...artifacts];
    this.unlocked = [...unlocked];
  }

  close(): void {
    this.shown = false;
  }

  isOpen(): boolean {
    return this.shown;
  }

  private layout(): { restart: Box; cont: Box | null } {
    if (this.mode === "won") {
      return { restart: { x: BTN_X, y: 112, w: BTN_W, h: BTN_H }, cont: { x: BTN_X, y: 138, w: BTN_W, h: BTN_H } };
    }
    return { restart: { x: BTN_X, y: 124, w: BTN_W, h: BTN_H }, cont: null };
  }

  hitTest(x: number, y: number): ModalKey | null {
    if (!this.shown) return null;
    const boxes = this.layout();
    if (inRect(boxes.restart, x, y)) return "restart";
    if (boxes.cont !== null && inRect(boxes.cont, x, y)) return "continue";
    return null;
  }

  draw(o: CanvasRenderingContext2D, scale: number): void {
    if (!this.shown) return;
    o.save();
    o.scale(scale, scale);
    o.globalAlpha = 1;
    o.fillStyle = "rgba(0, 0, 0, 0.92)";
    o.fillRect(0, 0, LW, LH);
    o.textBaseline = "top";

    o.textAlign = "center";
    o.font = "bold 14px sans-serif";
    o.fillStyle = this.mode === "won" ? "#ffd166" : "#ff4444";
    o.fillText(this.mode === "won" ? "CHIẾN THẮNG" : "BẠN ĐÃ CHẾT", LW / 2, 12);
    o.font = "7px sans-serif";
    o.fillStyle = "#a7b4c9";
    const cleared = Math.min(this.stats.roomsCleared, ROOM_TOTAL);
    o.fillText(this.mode === "won" ? `Phá đảo ${ROOM_TOTAL}/${ROOM_TOTAL} phòng` : `Phòng ${cleared}/${ROOM_TOTAL}`, LW / 2, 31);

    const rows: [string, string][] = [
      ["Thời gian", formatRunTime(this.stats.ticksElapsed)],
      ["Phòng đã qua", `${this.stats.roomsCleared}`],
      ["Kẻ địch đã diệt", `${this.stats.enemiesKilled}`],
      ["Sát thương gây ra", `${this.stats.damageDealt}`],
      ["Sát thương nhận vào", `${this.stats.damageTaken}`],
      ["Cổ vật thu thập", `${this.stats.artifactsTaken}`],
      ["Vàng kiếm được", `${this.stats.totalGoldEarned}`],
    ];
    if (this.stats.hurtFree) rows.push(["Không trúng đòn", "CÓ"]);

    o.font = "8px ui-monospace, monospace";
    const startY = 44;
    const lineH = 8;
    rows.forEach(([label, value], i) => {
      const y = startY + i * lineH;
      o.textAlign = "left";
      o.fillStyle = "#a7b4c9";
      o.fillText(label, 70, y);
      o.textAlign = "right";
      o.fillStyle = "#e4ebf7";
      o.fillText(value, 250, y);
    });

    if (this.artifacts.length > 0) {
      const size = 6;
      const gap = 2;
      const total = this.artifacts.length * (size + gap) - gap;
      let x = Math.round((LW - total) / 2);
      const y = startY + rows.length * lineH + 2;
      for (const id of this.artifacts) {
        o.fillStyle = ARTIFACT_COLORS[id];
        o.fillRect(x, y, size, size);
        x += size + gap;
      }
    }

    if (this.unlocked.length > 0) {
      o.textAlign = "center";
      o.font = "7px sans-serif";
      o.fillStyle = "#ffd166";
      o.fillText(`Mở khóa: ${this.unlocked.map((id) => ACHIEVEMENT_NAMES[id]).join(", ")}`, LW / 2, startY + rows.length * lineH + 11);
    }

    const boxes = this.layout();
    this.drawButton(o, boxes.restart, "CHƠI LẠI");
    if (boxes.cont !== null) this.drawButton(o, boxes.cont, "TIẾP TỤC");

    o.textAlign = "center";
    o.font = "6px ui-monospace, monospace";
    o.fillStyle = "#6b7688";
    o.fillText("Nhấn R để chơi lại", LW / 2, this.mode === "won" ? 166 : 152);
    o.restore();
  }

  private drawButton(o: CanvasRenderingContext2D, b: Box, label: string): void {
    o.fillStyle = "#172233";
    o.fillRect(b.x, b.y, b.w, b.h);
    o.strokeStyle = "#7fd1ff";
    o.lineWidth = 1;
    o.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    o.textAlign = "center";
    o.textBaseline = "middle";
    o.font = "bold 10px sans-serif";
    o.fillStyle = "#d2e8ff";
    o.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
    o.textBaseline = "top";
  }
}
