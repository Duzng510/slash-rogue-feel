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

type Arc = { x: number; y: number; dir: number; reach: number; deg: number; left: number; total: number };

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
  private flash = new Map<number, number>();
  private vignette = 0;
  private white: Record<string, HTMLCanvasElement> = {};
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
    for (const key of Object.keys(sprites)) {
      if (key.startsWith("enemy")) this.white[key] = tinted(sprites[key].c, P.FLASH);
    }
    this.tileOf[TILE.FLOOR] = sprites.floor;
    this.tileOf[TILE.ACCENT] = sprites.accent;
    this.tileOf[TILE.WALL] = sprites.wall;
    this.tileOf[TILE.CRATE] = sprites.crate;
    this.tileOf[TILE.DOOR] = sprites.door_locked;
    this.tileOf[TILE.DOOR_OPEN] = sprites.door_open;
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
      else if (e.t === "slashArc") this.arcs.push({ x: e.x, y: e.y, dir: e.dir, reach: e.reach, deg: e.deg, left: e.ticks, total: e.ticks });
      else if (e.t === "hurtVignette") this.vignette = Math.min(CONFIG.READABILITY.VIGNETTE_MAX, e.strength);
    }
  }

  private stepVisual(dtReal: number): void {
    const ticks = dtReal * CONFIG.TIME.TICK_HZ;
    for (const a of this.arcs) a.left -= ticks;
    this.arcs = this.arcs.filter((a) => a.left > 0);
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
    this.drawTelegraphs(g, ox, oy);
    this.drawShadows(g, ox, oy);
    this.drawArcs(g, ox, oy);
    this.drawEnemies(g, ox, oy);
    this.drawPlayer(g, ox, oy);
    this.drawParticles(g, ox, oy);
    this.drawVignette(g, flags);
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
      g.globalAlpha = rd.SLASH_ALPHA * (0.35 + 0.65 * t);
      g.fillStyle = P.SLASH;
      this.wedge(g, Math.round(a.x - ox), Math.round(a.y - oy), a.dir, a.reach * (0.7 + 0.3 * t), a.deg, 0.4);
      g.fill();
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

      if (e.RADIAL) {
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
      this.wedge(g, cx, cy, en.telegraphDir, e.ATTACK_REACH, e.ATTACK_ARC_DEG, 0.1);
      g.fill();

      g.globalAlpha = 0.55 + 0.45 * prog;
      g.strokeStyle = P.TELEGRAPH_EDGE;
      this.wedge(g, cx, cy, en.telegraphDir, e.ATTACK_REACH, e.ATTACK_ARC_DEG, 0.1);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  private drawShadows(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const s = this.sprites.shadow;
    for (const en of this.world.enemies) {
      if (en.removed) continue;
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
      const x = Math.round(en.x - sp.ax - ox);
      const y = Math.round(en.y - sp.ay - oy);
      const flashing = (this.flash.get(en.id) ?? 0) > 0;

      if (en.dead) {
        const total = en.def.CORPSE_TICKS;
        g.globalAlpha = Math.max(0, en.corpseTicks / total);
        g.drawImage(sp.c, x, y + (total - en.corpseTicks));
        g.globalAlpha = 1;
        continue;
      }

      if (flashing) g.drawImage(white, x, y);
      else g.drawImage(sp.c, x, y);

      if (en.blink()) {
        g.globalAlpha = 0.5;
        g.drawImage(white, x, y);
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
      if (en.state === ENEMY_STATE.ATTACK && en.swing !== null && en.swing.phase === "recover") {
        g.fillStyle = P.ENEMY_EYE;
        g.fillRect(x + Math.floor(sp.w / 2) - 1, y - 3, 3, 1);
      }
    }
  }

  private drawPlayer(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const pl = this.world.player;
    if (pl.dead && pl.deadTicks > 12) return;

    const blinkOut = pl.iframeTicks > 0 && Math.floor(pl.iframeTicks / 3) % 2 === 0;

    const sp = this.sprites.player;
    const x = Math.round(pl.x - sp.ax - ox);
    const y = Math.round(pl.y - sp.ay - oy);
    const flashing = (this.flash.get(pl.id) ?? 0) > 0;

    g.globalAlpha = blinkOut ? CONFIG.READABILITY.IFRAME_ALPHA : 1;
    g.drawImage(flashing ? this.white.player : sp.c, x, y);

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
