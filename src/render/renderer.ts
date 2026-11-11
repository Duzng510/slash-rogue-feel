import { CONFIG } from "../config.ts";
import type { VisualEvent } from "../events.ts";
import { ENEMY_STATE } from "../entities/enemy.ts";
import { PLAYER_STATE } from "../entities/player.ts";
import { TILE } from "../world/rooms.ts";
import { fitAxes, isRotated } from "../ui/immersive.ts";
import { facingOffsets, type Sprite } from "./pixelart.ts";
import type { Camera } from "./camera.ts";
import type { World } from "../world/world.ts";

const P = CONFIG.PALETTE;

type Arc = { x: number; y: number; dir: number; reach: number; deg: number; combo: number; left: number; total: number };
type Slice = { x: number; y: number; dir: number; len: number; left: number; total: number };
type FloatText = { x: number; y: number; text: string; color: string; left: number; total: number };

export type DrawFlags = { boxes: boolean; fps: boolean; hitStop: boolean };

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d") as CanvasRenderingContext2D;
}

function tinted(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export class Renderer {
  readonly g: CanvasRenderingContext2D;
  readonly o: CanvasRenderingContext2D;
  scale = 3;
  origin = { x: 0, y: 0 };

  private arcs: Arc[] = [];
  private slices: Slice[] = [];
  private beams: { x: number; y: number; dir: number; len: number; left: number; total: number }[] = [];
  private texts: FloatText[] = [];
  private flash = new Map<number, number>();
  private vignette = 0;
  private white: Record<string, HTMLCanvasElement> = {};
  private statusSprites: Record<string, HTMLCanvasElement[]> = {};
  private tileOf: Record<number, Sprite> = {};

  constructor(
    private readonly game: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly world: World,
    private readonly cam: Camera,
    private readonly sprites: Record<string, Sprite>
  ) {
    game.width = CONFIG.WORLD.INTERNAL_W;
    game.height = CONFIG.WORLD.INTERNAL_H;
    this.g = ctx2d(game);
    this.o = ctx2d(overlay);
    this.g.imageSmoothingEnabled = false;
    this.o.imageSmoothingEnabled = false;
    this.white.player = tinted(sprites.player.c, P.FLASH);
    if (sprites.player_swordsman) this.white.player_swordsman = tinted(sprites.player_swordsman.c, P.FLASH);
    if (sprites.player_mage) this.white.player_mage = tinted(sprites.player_mage.c, P.FLASH);
    if (sprites.player_tank) this.white.player_tank = tinted(sprites.player_tank.c, P.FLASH);
    for (const key of Object.keys(sprites)) {
      if (key.startsWith("enemy")) {
        this.white[key] = tinted(sprites[key].c, P.FLASH);
        this.statusSprites[key] = ["#ff963f", "#58caff", "#ffe66b"].map(color => tinted(sprites[key].c, color));
      }
    }
    this.tileOf[TILE.FLOOR] = sprites.floor;
    this.tileOf[TILE.ACCENT] = sprites.accent;
    this.tileOf[TILE.WALL] = sprites.wall;
    this.tileOf[TILE.CRATE] = sprites.crate;
    this.tileOf[TILE.DOOR] = sprites.door_locked;
    this.tileOf[TILE.DOOR_OPEN] = sprites.door_open;
    this.tileOf[TILE.TRAP] = sprites.trap;
    this.tileOf[TILE.TRAP_ARMED] = sprites.trap_spent;
  }

  resize(): void {
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const axes = fitAxes(window.innerWidth, window.innerHeight, isRotated());
    const fit = Math.min(axes.w / iw, axes.h / ih);
    const floor = Math.floor(fit);
    this.scale = Math.max(CONFIG.WORLD.MIN_SCALE, Number.isFinite(floor) && floor > 0 ? floor : CONFIG.WORLD.MIN_SCALE);
    const w = iw * this.scale;
    const h = ih * this.scale;
    for (const c of [this.game, this.overlay]) {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.overlay.width = w;
    this.overlay.height = h;
    this.o.imageSmoothingEnabled = false;
  }

  /** client px -> world px, used for mouse aim */
  aimFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.game.getBoundingClientRect();
    if (r.width <= 0) return null;
    const sx = ((clientX - r.left) / r.width) * CONFIG.WORLD.INTERNAL_W;
    const sy = ((clientY - r.top) / r.height) * CONFIG.WORLD.INTERNAL_H;
    return { x: sx + this.origin.x, y: sy + this.origin.y };
  }

  get fxInfo(): { arcs: number; flashes: number; vignette: number; shake: number } {
    return { arcs: this.arcs.length, flashes: this.flash.size, vignette: this.vignette, shake: this.cam.shakeMag };
  }

  consume(events: VisualEvent[]): void {
    for (const e of events) {
      if (e.t === "shake") this.cam.addShake(e.mag, e.dir);
      else if (e.t === "flash") this.flash.set(e.ent, e.ticks);
      else if (e.t === "slice") this.slices.push({ x: e.x, y: e.y, dir: e.dir, len: e.len, left: 6, total: 6 });
      else if (e.t === "slashArc") this.arcs.push({ x: e.x, y: e.y, dir: e.dir, reach: e.reach, deg: e.deg, combo: e.combo, left: e.ticks, total: e.ticks });
      else if (e.t === "hurtVignette") this.vignette = Math.min(CONFIG.READABILITY.VIGNETTE_MAX, e.strength);
      else if (e.t === "beam") this.beams.push({ x: e.x, y: e.y, dir: e.dir, len: e.len, left: 20, total: 20 });
      else if (e.t === "artifactText") {
        if (this.texts.length >= 24) this.texts.shift();
        this.texts.push({ x: e.x, y: e.y, text: e.text, color: e.color, left: 48, total: 48 });
      }
      else if (e.t === "dmgNumber") {
        if (this.texts.length >= 24) this.texts.shift();
        this.texts.push({ x: e.x, y: e.y, text: String(Math.round(e.value)), color: "#ffffff", left: 36, total: 36 });
      }
    }
  }

  private stepVisual(dtReal: number): void {
    const ticks = dtReal * CONFIG.TIME.TICK_HZ;
    for (const a of this.arcs) a.left -= ticks;
    this.arcs = this.arcs.filter((a) => a.left > 0);
    for (const s of this.slices) s.left -= ticks;
    this.slices = this.slices.filter((s) => s.left > 0);
    for (const b of this.beams) b.left -= ticks;
    this.beams = this.beams.filter((b) => b.left > 0);
    for (const ft of this.texts) {
      ft.left -= ticks;
      ft.y -= ticks * 0.09;
    }
    this.texts = this.texts.filter((ft) => ft.left > 0);
    for (const [k, v] of this.flash) {
      const n = v - ticks;
      if (n <= 0) this.flash.delete(k);
      else this.flash.set(k, n);
    }
    if (this.vignette > 0) this.vignette = Math.max(0, this.vignette - dtReal * 0.9);
  }

  draw(dtReal: number, flags: DrawFlags): void {
    this.stepVisual(dtReal);
    const g = this.g;
    const w = this.world;
    this.origin = this.cam.origin(w.room);
    const ox = this.origin.x;
    const oy = this.origin.y;

    g.fillStyle = P.VOID;
    g.fillRect(0, 0, CONFIG.WORLD.INTERNAL_W, CONFIG.WORLD.INTERNAL_H);

    this.drawTiles(g, ox, oy);
    for (const trail of w.fireTrails) for (const p of trail.points) {
      const x = Math.round(p.x - ox), y = Math.round(p.y - oy);
      g.globalAlpha = Math.min(0.45, p.ticks / 60);
      g.fillStyle = "#d84b20";
      g.fillRect(x - 6, y - 6, 12, 12);
      g.globalAlpha = Math.min(1, p.ticks / 15);
      g.fillStyle = "#ffc35a";
      g.fillRect(x - 1, y - 2 - (p.ticks % 3), 2, 4);
    }
    g.globalAlpha = 1;
    this.drawTelegraphs(g, ox, oy);
    this.drawShadows(g, ox, oy);
    this.drawArcs(g, ox, oy);
    this.drawEnemies(g, ox, oy);
    this.drawSlices(g, ox, oy);
    this.drawProjectiles(g, ox, oy);
    this.drawBeams(g, ox, oy);
    this.drawPlayer(g, ox, oy);
    this.drawParticles(g, ox, oy);
    this.drawTexts(g, ox, oy);
    this.drawAmbient(g, ox, oy);
    this.drawVignette(g, flags);
  }

  private drawAmbient(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const pl = this.world.player;
    const px = Math.round(pl.x - ox);
    const py = Math.round(pl.y - 7 - oy);
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;

    // Soft atmospheric vignette darkening screen corners
    const grad = g.createRadialGradient(px, py, 45, px, py, 175);
    grad.addColorStop(0, "rgba(5, 7, 11, 0)");
    grad.addColorStop(0.65, "rgba(5, 7, 11, 0.22)");
    grad.addColorStop(1, "rgba(5, 7, 11, 0.65)");
    g.fillStyle = grad;
    g.fillRect(0, 0, iw, ih);
  }

  private drawTiles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const T = CONFIG.WORLD.TILE;
    const room = this.world.room;
    const x0 = Math.max(0, Math.floor(ox / T));
    const y0 = Math.max(0, Math.floor(oy / T));
    const x1 = Math.min(room.w - 1, Math.ceil((ox + CONFIG.WORLD.INTERNAL_W) / T));
    const y1 = Math.min(room.h - 1, Math.ceil((oy + CONFIG.WORLD.INTERNAL_H) / T));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const s = this.tileOf[room.at(tx, ty)] ?? this.tileOf[TILE.FLOOR];
        g.drawImage(s.c, Math.round(tx * T - ox), Math.round(ty * T - oy));
      }
    }
  }

  private wedge(
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

  private drawArcs(g: CanvasRenderingContext2D, ox: number, oy: number): void {
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

      // Layer 1: Body glow gradient
      g.globalAlpha = rd.SLASH_ALPHA * (0.35 + 0.65 * t);
      const grad = g.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
      grad.addColorStop(0, deepColor);
      grad.addColorStop(0.7, baseColor);
      grad.addColorStop(1, P.SLASH_EDGE);
      g.fillStyle = grad;
      this.wedge(g, cx, cy, a.dir, r, a.deg, 0.45);
      g.fill();

      // Layer 2: Razor edge rim (sharp outer perimeter)
      g.globalAlpha = rd.SLASH_ALPHA * (0.6 + 0.4 * t);
      g.strokeStyle = P.SLASH_EDGE;
      g.lineWidth = 1.25;
      g.beginPath();
      g.arc(cx, cy, r, a.dir - half, a.dir + half);
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

  private drawSlices(g: CanvasRenderingContext2D, ox: number, oy: number): void {
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
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();

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

  private drawTelegraphs(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const en of this.world.enemies) {
      if (en.state !== ENEMY_STATE.TELEGRAPH) continue;
      const e = en.def;
      const prog = 1 - en.telegraphTicksLeft / Math.max(1, en.telegraphTotal);
      const cx = Math.round(en.x - ox);
      const cy = Math.round(en.y - e.BODY_H * 0.5 - oy);

      g.globalAlpha = 0.55 + 0.45 * prog;
      g.strokeStyle = P.TELEGRAPH_EDGE;
      g.lineWidth = 1;
      g.setLineDash([3, 2]);
      g.lineDashOffset = -this.world.tickCount % 5;

      if (e.RADIAL || (en.kind === "warden" && en.pattern !== "laser")) {
        /** the disc grows into a fixed rim: read the rim, that is the line you must cross */
        g.globalAlpha = CONFIG.READABILITY.TELEGRAPH_FILL * (0.55 + 0.45 * prog);
        g.fillStyle = P.TELEGRAPH_FILL;
        g.beginPath();
        g.arc(cx, cy, Math.max(1, e.ATTACK_REACH * prog), 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 0.55 + 0.45 * prog;
        g.strokeStyle = P.TELEGRAPH_EDGE;
        g.beginPath();
        g.arc(cx, cy, e.ATTACK_REACH, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        continue;
      }

      g.globalAlpha = CONFIG.READABILITY.TELEGRAPH_FILL * (0.55 + 0.45 * prog);
      g.fillStyle = P.TELEGRAPH_FILL;
      const laser = en.kind === "warden" && en.pattern === "laser";
      const reach = laser ? Math.hypot(this.world.room.widthPx, this.world.room.heightPx) : e.ATTACK_REACH;
      const deg = laser ? 8 : e.ATTACK_ARC_DEG;
      this.wedge(g, cx, cy, en.telegraphDir, reach, deg, 0.1);
      g.fill();

      g.globalAlpha = 0.55 + 0.45 * prog;
      g.strokeStyle = P.TELEGRAPH_EDGE;
      this.wedge(g, cx, cy, en.telegraphDir, reach, deg, 0.1);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  private drawShadows(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const s = this.sprites.shadow;
    for (const en of this.world.enemies) {
      if (en.removed) continue;
      if (en.state === ENEMY_STATE.VANISH) continue;
      const sp = this.sprites[en.def.SPRITE_KEY] ?? this.sprites.enemy;
      const w = Math.max(s.w, Math.round(sp.w * 0.9));
      g.drawImage(s.c, Math.round(en.x - w / 2 - ox), Math.round(en.y - s.ay - oy), w, s.h);
    }
    const pl = this.world.player;
    g.drawImage(s.c, Math.round(pl.x - s.ax - ox), Math.round(pl.y - s.ay - oy));
  }

  private drawEnemies(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const target = this.world.player.autoTargetId;
    for (const en of this.world.enemies) {
      if (en.removed) continue;
      const sp = this.sprites[en.def.SPRITE_KEY] ?? this.sprites.enemy;
      const white = this.white[en.def.SPRITE_KEY] ?? this.white.enemy;
      const sc = en.isElite ? 1.3 : 1;
      const w = Math.round(sp.w * sc);
      const h = Math.round(sp.h * sc);
      const x = Math.round(en.x - sp.ax * sc - ox);
      const y = Math.round(en.y - sp.ay * sc - oy);
      const flashing = (this.flash.get(en.id) ?? 0) > 0;

      if (en.dead) {
        const total = en.def.CORPSE_TICKS;
        g.globalAlpha = Math.max(0, en.corpseTicks / total);
        g.drawImage(sp.c, x, y + (total - en.corpseTicks), w, h);
        g.globalAlpha = 1;
        continue;
      }

      if (en.state === ENEMY_STATE.VANISH) continue;
      const appearTicks = en.def.APPEAR_TICKS;
      const fade =
        en.state === ENEMY_STATE.APPEAR && appearTicks > 0
          ? 0.3 + 0.7 * Math.min(1, en.ticksInState / appearTicks)
          : 1;
      if (flashing) g.drawImage(white, x, y, w, h);
      else {
        g.globalAlpha = fade;
        g.drawImage(sp.c, x, y, w, h);
        g.globalAlpha = 1;
        const status = en.shockTicks > 0 ? 2 : en.wetTicks > 0 ? 1 : en.burnTicks > 0 ? 0 : -1;
        if (status >= 0) {
          g.globalAlpha = 0.55 * fade;
          g.drawImage(this.statusSprites[en.def.SPRITE_KEY][status], x, y, w, h);
          g.globalAlpha = 1;
        }
      }
      if (en.shockTicks > 0) {
        const bx = x + Math.floor(sp.w / 2) - 1;
        const by = y - 4;
        g.globalAlpha = 0.9;
        g.fillStyle = "#ffe66b";
        g.fillRect(bx, by, 3, 1);
        g.fillRect(bx - 1, by + 1, 3, 1);
        g.fillRect(bx, by + 2, 2, 1);
        g.fillRect(bx - 2, by + 3, 3, 1);
        g.globalAlpha = 1;
      }
      const active = [en.burnTicks, en.wetTicks, en.shockTicks, en.poisonTicks, en.freezeTicks, en.bleedTicks];
      const icons = ["00100/01101/11111/11111/01110", "00100/00100/01110/11111/01110", "00111/01110/11111/00110/01100", "00100/01110/11111/01110/00100", "10101/01110/11111/01110/10101", "00100/01110/11111/11111/01110"];
      let iconX = Math.round(en.x - ox - (active.filter(t => t > 0).length * 7 - 2) / 2);
      for (let i = 0; i < active.length; i++) {
        if (active[i] <= 0) continue;
        g.fillStyle = P.VOID;
        g.fillRect(iconX - 1, y - 9, 7, 7);
        g.fillStyle = ["#ff963f", "#58caff", "#ffe66b", "#8f63ae", "#a8e8ff", "#c2182b"][i];
        icons[i].split("/").forEach((row, iy) => {
          for (let ix = 0; ix < row.length; ix++) if (row[ix] === "1") g.fillRect(iconX + ix, y - 8 + iy, 1, 1);
        });
        iconX += 7;
      }

      if (en.blink()) {
        g.globalAlpha = 0.5;
        g.drawImage(white, x, y, w, h);
        g.globalAlpha = 1;
      }

      if (en.id === target) {
        g.strokeStyle = P.TARGET_RIM;
        g.lineWidth = 1;
        g.strokeRect(x - 0.5, y - 0.5, sp.w + 1, sp.h + 1);
      }

      if (en.kind === "boss" && en.enraged) {
        g.strokeStyle = P.ENEMY_CHARGER;
        g.lineWidth = 1;
        g.strokeRect(x - 1.5, y - 1.5, sp.w + 3, sp.h + 3);
      }
      if (en.isElite) {
        g.globalAlpha = 0.6 + 0.4 * Math.sin(en.animTicks * 0.15);
        g.strokeStyle = "#ff3b3b";
        g.lineWidth = 1;
        g.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
        g.globalAlpha = 1;
      }
      if (en.def.SHIELD) {
        g.strokeStyle = "#d8f0ff";
        g.lineWidth = 2;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(Math.round(en.x - ox), Math.round(en.y - en.bodyH / 2 - oy), Math.max(en.bodyW, en.bodyH) / 2 + 2, en.facing - 0.9, en.facing + 0.9);
        g.stroke();
        g.globalAlpha = 1;
      }
      if (en.state === ENEMY_STATE.ATTACK && en.swing !== null && en.swing.phase === "recover") {
        g.fillStyle = P.ENEMY_EYE;
        g.fillRect(x + Math.floor(sp.w / 2) - 1, y - 3, 3, 1);
      }
    }
  }

  private drawBeams(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const b of this.beams) {
      const x1 = Math.round(b.x - ox);
      const y1 = Math.round(b.y - oy);
      const x2 = Math.round(b.x + Math.cos(b.dir) * b.len - ox);
      const y2 = Math.round(b.y + Math.sin(b.dir) * b.len - oy);
      g.globalAlpha = Math.max(0, b.left / b.total);
      g.strokeStyle = P.VOID;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.strokeStyle = P.PROJ;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  private drawProjectiles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const p of this.world.projectiles) {
      const x = Math.round(p.x - ox);
      const y = Math.round(p.y - oy);
      const hot = p.owner === "player";
      g.fillStyle = hot ? "#3a1c08" : P.VOID;
      g.fillRect(x - 2, y - 2, 4, 4);
      g.fillStyle = hot ? "#ff963f" : P.PROJ;
      g.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  private drawPlayer(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const pl = this.world.player;
    if (pl.dead && pl.deadTicks > 12) return;

    const blinkOut = pl.iframeTicks > 0 && Math.floor(pl.iframeTicks / 3) % 2 === 0;

    const spriteKey = `player_${pl.character}`;
    const sp = this.sprites[spriteKey] ?? this.sprites.player;
    // Dynamic attack lean
    let leanX = 0;
    let leanY = 0;
    if (pl.state === PLAYER_STATE.ATTACK) {
      leanX = Math.round(Math.cos(pl.facing) * 1.5);
      leanY = Math.round(Math.sin(pl.facing) * 1.5);
    }

    const x = Math.round(pl.x - sp.ax - ox) + leanX;
    const y = Math.round(pl.y - sp.ay - oy) + leanY;
    const flashing = (this.flash.get(pl.id) ?? 0) > 0;

    g.globalAlpha = blinkOut ? CONFIG.READABILITY.IFRAME_ALPHA : 1;
    if (pl.skillActiveTicks > 0) {
      g.save();
      g.strokeStyle = "#8ab4ff";
      g.lineWidth = 1;
      g.globalAlpha = 0.5 + 0.35 * Math.sin(pl.skillActiveTicks * 0.4);
      g.beginPath();
      g.arc(Math.round(pl.x - ox), Math.round(pl.y - 7 - oy), 14, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      g.globalAlpha = blinkOut ? CONFIG.READABILITY.IFRAME_ALPHA : 1;
    }
    const flashImg = (this.white[spriteKey] ?? this.white.player);
    g.drawImage(flashing ? flashImg : sp.c, x, y);

    const f = facingOffsets(pl.state === PLAYER_STATE.DASH ? pl.dashDir : pl.facing);
    g.fillStyle = P.PLAYER_RIM;
    g.fillRect(x + sp.ax - 1 + f.x, y + sp.ay - 8 + f.y, 2, 2);
    g.globalAlpha = 1;
  }

  private drawParticles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const density = CONFIG.SLIDERS.particles;
    if (density <= 0.01) return;
    this.world.particles.visit((s) => {
      const t = s.life / s.maxLife;
      const alpha = Math.min(1, (0.25 + 0.75 * t) * s.alphaScale * density);
      if (s.sprite !== null) {
        const sp = this.sprites[s.sprite];
        g.globalAlpha = alpha * 0.35;
        g.drawImage(sp.c, Math.round(s.x - sp.ax - ox), Math.round(s.y - sp.ay - oy));
        return;
      }
      g.globalAlpha = alpha;
      g.fillStyle = s.color;
      const sz = Math.max(1, Math.round(s.size));
      g.fillRect(Math.round(s.x - ox), Math.round(s.y - oy), sz, sz);
    });
    g.globalAlpha = 1;
  }

  private drawTexts(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.texts.length === 0) return;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.font = "bold 5px ui-monospace, monospace";
    for (const ft of this.texts) {
      const x = Math.round(ft.x - ox);
      const y = Math.round(ft.y - oy);
      g.globalAlpha = Math.min(1, (ft.left / ft.total) * 1.8);
      g.fillStyle = P.VOID;
      g.fillText(ft.text, x + 1, y + 1);
      g.fillStyle = ft.color;
      g.fillText(ft.text, x, y);
    }
    g.globalAlpha = 1;
  }

  private drawVignette(g: CanvasRenderingContext2D, flags: DrawFlags): void {
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    if (this.vignette > 0.001) {
      g.globalAlpha = this.vignette;
      g.fillStyle = P.VIGNETTE_HURT;
      g.fillRect(0, 0, iw, 3);
      g.fillRect(0, ih - 3, iw, 3);
      g.fillRect(0, 0, 3, ih);
      g.fillRect(iw - 3, 0, 3, ih);
      g.globalAlpha = 1;
    }
    if (flags.hitStop && this.world.hitStopTicks > 0) {
      g.globalAlpha = 0.25;
      g.strokeStyle = P.SLASH;
      g.lineWidth = 1;
      g.strokeRect(1.5, 1.5, iw - 3, ih - 3);
      g.globalAlpha = 1;
    }
  }
}
