// Combat visual-FX layer: the transient event-driven effects (slash arcs, lingering cut
// slices, enemy beams, floating damage/artifact text). Renderer.consume routes the matching
// VisualEvents here; Renderer.stepVisual advances them; draw() renders them. Kept separate so
// the effect bookkeeping lives in one place instead of scattered across the Renderer class.
import { CONFIG } from "../config.ts";
import type { VisualEvent } from "../events.ts";
import type { SpriteBatch } from "./gl/batch.ts";

const P = CONFIG.PALETTE;

type Arc = { x: number; y: number; dir: number; reach: number; deg: number; combo: number; left: number; total: number };
type Slice = { x: number; y: number; dir: number; len: number; left: number; total: number };
type Beam = { x: number; y: number; dir: number; len: number; left: number; total: number };
type DamageType = "physical" | "burn" | "shock" | "freeze" | "poison" | "bleed";
type FloatText = { x: number; y: number; text: string; color: string; left: number; total: number; style: "normal" | "crit" | "heal" | "element"; damageType?: DamageType };

/** fills a pie-slice ring between `reach * innerRatio` and `reach` around `dir` */
export function wedge(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: number,
  reach: number,
  deg: number,
  innerRatio: number
): void {
  const half = ((deg * Math.PI) / 180) * 0.5;
  const r0 = reach * innerRatio;
  g.beginPath();
  g.arc(cx, cy, reach, dir - half, dir + half);
  g.arc(cx, cy, r0, dir + half, dir - half, true);
  g.closePath();
}

export class FxLayer {
  private arcs: Arc[] = [];
  private slices: Slice[] = [];
  private beams: Beam[] = [];
  private texts: FloatText[] = [];

  /** swing and beam lights read these while compositing the scene */
  get swingArcs(): readonly Arc[] {
    return this.arcs;
  }
  get enemyBeams(): readonly Beam[] {
    return this.beams;
  }
  get arcCount(): number {
    return this.arcs.length;
  }

  consume(events: VisualEvent[]): void {
    for (const e of events) {
      if (e.t === "slice") this.slices.push({ x: e.x, y: e.y, dir: e.dir, len: e.len, left: 6, total: 6 });
      else if (e.t === "slashArc") this.arcs.push({ x: e.x, y: e.y, dir: e.dir, reach: e.reach, deg: e.deg, combo: e.combo, left: e.ticks, total: e.ticks });
      else if (e.t === "beam") this.beams.push({ x: e.x, y: e.y, dir: e.dir, len: e.len, left: 20, total: 20 });
      else if (e.t === "artifactText") {
        if (this.texts.length >= CONFIG.RENDER.TEXT_CAP) this.texts.shift();
        this.texts.push({ x: e.x, y: e.y, text: e.text, color: e.color, left: 48, total: 48, style: "normal" });
      }
      else if (e.t === "dmgNumber") {
        if (this.texts.length >= CONFIG.RENDER.TEXT_CAP) this.texts.shift();
        const style = e.style ?? "normal";
        const damageType: DamageType | undefined = e.damageType ?? (style === "element" ? (e.color === CONFIG.PALETTE.ELEMENT.burn ? "burn" : e.color === CONFIG.PALETTE.ELEMENT.poison ? "poison" : "physical") : style === "heal" ? undefined : "physical");
        const palette: Record<DamageType, string> = { physical: "#ffffff", burn: "#ff963f", shock: "#ffe66b", freeze: "#8fe8ff", poison: "#c99ae6", bleed: "#ff4d5e" };
        this.texts.push({
          x: e.x, y: e.y,
          text: style === "heal" ? `+${Math.round(e.value)}` : String(Math.round(e.value)),
          color: style === "crit" ? "#ffd166" : style === "heal" ? "#58ff8a" : (damageType ? palette[damageType] : undefined) ?? e.color ?? "#ffffff",
          left: style === "crit" ? 42 : 36, total: style === "crit" ? 42 : 36,
          style, damageType,
        });
      }
    }
  }

  step(dtReal: number): void {
    const ticks = dtReal * CONFIG.TIME.TICK_HZ;
    for (const a of this.arcs) {
      a.left -= ticks;
      // the swing just finished: leave a long faint cut mark hanging in the air
      if (a.left <= 0 && this.slices.length < 8) {
        this.slices.push({ x: a.x, y: a.y, dir: a.dir, len: a.reach * 2.2, left: 6, total: 6 });
      }
    }
    this.arcs = this.arcs.filter((a) => a.left > 0);
    for (const s of this.slices) s.left -= ticks;
    this.slices = this.slices.filter((s) => s.left > 0);
    for (const b of this.beams) b.left -= ticks;
    this.beams = this.beams.filter((b) => b.left > 0);
    for (const ft of this.texts) {
      ft.left -= ticks;
      // crits punch up faster; heals drift gently; plain numbers float at the base rate
      ft.y -= ticks * (ft.style === "crit" ? 0.16 : ft.style === "heal" ? 0.12 : 0.09);
    }
    this.texts = this.texts.filter((ft) => ft.left > 0);
  }

  drawArcs(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    const rd = CONFIG.READABILITY;
    g.globalCompositeOperation = "lighter";
    for (const a of this.arcs) {
      const t = Math.max(0, a.left / Math.max(1, a.total));
      const cx = Math.round(a.x - ox);
      const cy = Math.round(a.y - oy);
      const r = a.reach * (0.75 + 0.25 * t);
      const half = ((a.deg * Math.PI) / 180) * 0.5;

      const isCombo2 = a.combo === 2;
      const baseColor = isCombo2 ? P.SLASH_GOLD : P.SLASH_CYAN;
      const deepColor = isCombo2 ? P.SLASH_ORANGE_DEEP : P.SLASH_CYAN_DEEP;

      // --- thrust weapons (spear, dagger): a piercing line, not an arc ---
      if (a.deg <= 50) {
        const x2 = cx + Math.cos(a.dir) * r;
        const y2 = cy + Math.sin(a.dir) * r;
        g.globalAlpha = rd.SLASH_ALPHA * (0.4 + 0.6 * t);
        g.strokeStyle = baseColor;
        g.lineWidth = glowOnly ? 5 : 3;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(x2, y2);
        g.stroke();
        if (!glowOnly) {
          g.globalAlpha = rd.SLASH_ALPHA * t * 0.9;
          g.strokeStyle = P.SLASH_EDGE;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(x2, y2);
          g.stroke();
          // sharp tip spark
          g.fillStyle = P.SLASH_EDGE;
          g.fillRect(x2 - 1, y2 - 1, 2, 2);
        }
        continue;
      }

      // --- sweep weapons (greatsword, whip combo 2): thick body + heavy follow-through ---
      if (a.deg >= 150) {
        g.globalAlpha = rd.SLASH_ALPHA * (0.35 + 0.65 * t);
        const grad = g.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
        grad.addColorStop(0, deepColor);
        grad.addColorStop(0.7, baseColor);
        grad.addColorStop(1, P.SLASH_EDGE);
        g.fillStyle = grad;
        wedge(g, cx, cy, a.dir, r, a.deg, 0.4);
        g.fill();

        // four trailing wedges instead of two — reads as a heavy follow-through
        g.fillStyle = baseColor;
        for (let k = 1; k <= 4; k++) {
          g.globalAlpha = rd.SLASH_ALPHA * t * (0.32 - 0.06 * k);
          wedge(g, cx, cy, a.dir - 0.06 * k, r * (0.98 - 0.02 * k), a.deg * (0.9 - 0.04 * k), 0.5);
          g.fill();
        }

        if (glowOnly) continue;

        g.globalAlpha = rd.SLASH_ALPHA * (0.65 + 0.35 * t);
        g.strokeStyle = P.SLASH_EDGE;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(cx, cy, r, a.dir - half, a.dir + half);
        g.stroke();

        g.globalAlpha = rd.SLASH_ALPHA * t * 0.85;
        g.strokeStyle = P.SLASH_EDGE;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, r * 0.88, a.dir - half * 0.9, a.dir + half * 0.9);
        g.stroke();

        const tipX = cx + Math.cos(a.dir + half) * r;
        const tipY = cy + Math.sin(a.dir + half) * r;
        g.fillStyle = P.SLASH_EDGE;
        g.fillRect(tipX - 1, tipY - 1, 2, 2);
        continue;
      }

      // --- strike weapons (katana, whip combo 1): the standard arc ---

      // Layer 1: Body glow gradient
      g.globalAlpha = rd.SLASH_ALPHA * (0.35 + 0.65 * t);
      const grad = g.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
      grad.addColorStop(0, deepColor);
      grad.addColorStop(0.7, baseColor);
      grad.addColorStop(1, P.SLASH_EDGE);
      g.fillStyle = grad;
      wedge(g, cx, cy, a.dir, r, a.deg, 0.45);
      g.fill();

      // Trailing echoes: two fainter wedges lagging behind the sweep
      g.fillStyle = baseColor;
      g.globalAlpha = rd.SLASH_ALPHA * t * 0.3;
      wedge(g, cx, cy, a.dir - 0.08, r * 0.98, a.deg * 0.9, 0.5);
      g.fill();
      g.globalAlpha = rd.SLASH_ALPHA * t * 0.15;
      wedge(g, cx, cy, a.dir - 0.16, r * 0.95, a.deg * 0.8, 0.5);
      g.fill();

      if (glowOnly) continue;

      // Layer 2: Razor edge rim (sharp outer perimeter)
      g.globalAlpha = rd.SLASH_ALPHA * (0.6 + 0.4 * t);
      g.strokeStyle = P.SLASH_EDGE;
      g.lineWidth = 1.25;
      g.beginPath();
      g.arc(cx, cy, r, a.dir - half, a.dir + half);
      g.stroke();

      // Inner core rim: a 1px white edge hugging the inside of the arc
      g.globalAlpha = rd.SLASH_ALPHA * t * 0.9;
      g.strokeStyle = P.SLASH_EDGE;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, r * 0.9, a.dir - half * 0.92, a.dir + half * 0.92);
      g.stroke();

      // Layer 3: Razor cutting tip spark
      const tipX = cx + Math.cos(a.dir + half) * r;
      const tipY = cy + Math.sin(a.dir + half) * r;
      g.fillStyle = P.SLASH_EDGE;
      g.fillRect(tipX - 1, tipY - 1, 2, 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  drawSlices(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    if (this.slices.length === 0) return;
    g.globalCompositeOperation = "lighter";
    for (const s of this.slices) {
      const prog = s.left / s.total;
      const cx = Math.round(s.x - ox);
      const cy = Math.round(s.y - oy);
      const angle = s.dir + Math.PI * 0.5; // perpendicular slice cut line
      const half = s.len * 0.5;
      const x0 = cx - Math.cos(angle) * half;
      const y0 = cy - Math.sin(angle) * half;
      const x1 = cx + Math.cos(angle) * half;
      const y1 = cy + Math.sin(angle) * half;

      // Glow border
      g.globalAlpha = prog * 0.8;
      g.strokeStyle = P.SLASH_CYAN;
      g.lineWidth = glowOnly ? 3 : 2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();

      if (glowOnly) continue;

      // Sharp white core
      g.globalAlpha = prog;
      g.strokeStyle = P.SLASH_EDGE;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  queueGL(batch: SpriteBatch, ox: number, oy: number): void {
    for (const s of this.slices) {
      const prog = Math.max(0, s.left / Math.max(1, s.total));
      const cx = Math.round(s.x - ox);
      const cy = Math.round(s.y - oy);
      const angle = s.dir + Math.PI * 0.5;
      const half = s.len * 0.5;
      const x = Math.round(cx - half);
      const y = Math.round(cy - 1);
      batch.drawSolidRect(x, y - 1, s.len, 2, [0.35, 0.85, 1, prog * 0.8], true, angle);
      batch.drawSolidRect(x, y, s.len, 1, [1, 1, 1, prog], true, angle);
    }
    for (const b of this.beams) {
      const alpha = Math.max(0, b.left / Math.max(1, b.total));
      const x = b.x - ox;
      const y = b.y - oy;
      batch.drawSolidRect(x - b.len * 0.5, y - 3, b.len, 6, [0.65, 0.25, 0.82, alpha], true, b.dir);
      batch.drawSolidRect(x - b.len * 0.5, y - 2, b.len, 4, [0.06, 0.03, 0.10, alpha], false, b.dir);
      batch.drawSolidRect(x - b.len * 0.5, y - 1, b.len, 2, [0.67, 0.39, 0.82, alpha], true, b.dir);
    }
  }

  drawBeams(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    for (const b of this.beams) {
      const x1 = Math.round(b.x - ox);
      const y1 = Math.round(b.y - oy);
      const x2 = Math.round(b.x + Math.cos(b.dir) * b.len - ox);
      const y2 = Math.round(b.y + Math.sin(b.dir) * b.len - oy);
      g.globalAlpha = Math.max(0, b.left / b.total);
      if (glowOnly) {
        g.strokeStyle = P.PROJ;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      } else {
        g.strokeStyle = P.VOID;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        g.strokeStyle = P.PROJ;
        g.lineWidth = 2;
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  drawTexts(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.texts.length === 0) return;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    for (const ft of this.texts) {
      let x = Math.round(ft.x - ox);
      const y = Math.round(ft.y - oy);
      const type = ft.damageType;
      const crit = ft.style === "crit";
      const shockFlash = type === "shock" && ft.left > ft.total - 2;
      const pulse = ft.style === "heal" ? 1 + 0.12 * Math.sin(ft.left * 0.55) : 1;
      g.font = crit ? "bold 7px ui-monospace, monospace" : "bold 5px ui-monospace, monospace";
      // D5: Giảm jitter của damage numbers để dễ đọc khi đông quái
      if (this.texts.length <= 4 && (crit || type === "shock")) {
        x += Math.floor((ft.left * (type === "shock" ? 17 : 7)) % (type === "shock" ? 3 : 2)) - 1;
      }
      g.globalAlpha = Math.min(1, (ft.left / ft.total) * 1.8);
      if (shockFlash) g.globalAlpha = 1;
      if (pulse !== 1) g.globalAlpha *= 0.8 + 0.2 * pulse;
      if (type === "burn") {
        g.fillStyle = "#ffb14d";
        g.fillRect(x - 5, y - 4 - (ft.left % 3), 1, 1);
        g.fillRect(x + 5, y - 2 - ((ft.left + 1) % 3), 1, 1);
      } else if (type === "freeze") {
        g.fillStyle = "#8fe8ff";
        g.fillRect(x - 5, y + 2 + (ft.left % 4), 1, 2);
        g.fillRect(x + 4, y + 1 + ((ft.left + 2) % 4), 1, 1);
      } else if (type === "poison") {
        g.fillStyle = "#c99ae6";
        g.fillRect(x - 5, y - 4 - (ft.left % 4), 2, 2);
        g.fillRect(x + 4, y - 2 - ((ft.left + 1) % 4), 1, 1);
      } else if (type === "bleed") {
        g.fillStyle = "#ff4d5e";
        g.fillRect(x - 5, y + 2 + (ft.left % 3), 1, 2);
        g.fillRect(x + 5, y + 2 + ((ft.left + 2) % 3), 1, 2);
      }
      g.fillStyle = P.VOID;
      g.fillText(ft.text, x + 1, y + 1);
      g.fillStyle = shockFlash ? "#ffffff" : ft.color;
      g.save();
      if (pulse !== 1) {
        g.translate(x, y);
        g.scale(pulse, pulse);
        g.fillText(ft.text, 0, 0);
      } else {
        g.fillText(ft.text, x, y);
      }
      g.restore();
    }
    g.globalAlpha = 1;
  }
}
