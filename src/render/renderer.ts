import { CONFIG, enemyDef } from "../config.ts";
import type { VisualEvent } from "../events.ts";
import { ENEMY_STATE, type Enemy } from "../entities/enemy.ts";
import { PLAYER_STATE } from "../entities/player.ts";
import { TILE } from "../world/rooms.ts";
import { fitAxes, isRotated } from "../ui/immersive.ts";
import { facingOffsets, buildAnimSets, flipH, type Sprite, type SpriteSet } from "./pixelart.ts";
import type { Slot } from "../systems/particles.ts";
import type { Projectile } from "../sim/types.ts";
import type { Camera } from "./camera.ts";
import type { World } from "../world/world.ts";
import { GLPipeline } from "./gl/pipeline.ts";

const P = CONFIG.PALETTE;

const BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

type Arc = { x: number; y: number; dir: number; reach: number; deg: number; combo: number; left: number; total: number };
type Slice = { x: number; y: number; dir: number; len: number; left: number; total: number };
type FloatText = { x: number; y: number; text: string; color: string; left: number; total: number; style: "normal" | "crit" | "heal" | "element" };

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
  /** iris-wipe room transition: half close, half open, centred on the door point */
  private transTicks = 0;
  private transX = 0;
  private transY = 0;
  /** the forgotten king's phase-drop cinematic: a white flash + centred label, ticking down from 60 */
  private kingCine = 0;
  private kingCineTotal = 60;
  private kingCineLabel = "";
  private bossCineX = 0;
  private bossCineY = 0;
  /** kill-cam punch: zoom + desaturate while > 0, red full-screen flash on the first frame */
  private impactTicks = 0;
  /** drifting fog: baked at 160×90 then upscaled 2x pixelated */
  private fogPhase = 0;
  private fogCanvas: HTMLCanvasElement;
  private fogG: CanvasRenderingContext2D;
  /** screen-space weather motes, independent of the player position */
  private weather: { x: number; y: number; v: number; phase: number }[] = [];
  private white: Record<string, HTMLCanvasElement> = {};
  private statusSprites: Record<string, HTMLCanvasElement[]> = {};
  private shadowSprites: Record<string, HTMLCanvasElement> = {};
  private eliteSprites: Record<string, HTMLCanvasElement> = {};
  private tileOf: Record<number, Sprite> = {};
  private biomeTileOf: Record<string, Record<number, Sprite>> = {};
  /** baked multi-frame clips, keyed by sprite key (players get idle + walk, enemies walk) */
  private anims: Record<string, SpriteSet> = buildAnimSets();
  /** lazily mirrored single sprites for the right-facing direction */
  private mirrorCache: Record<string, Sprite> = {};
  private mirrored(sp: Sprite, key: string): Sprite {
    const hit = this.mirrorCache[key];
    if (hit) return hit;
    const made = flipH(sp);
    this.mirrorCache[key] = made;
    return made;
  }

  private glowCanvas: HTMLCanvasElement;
  private glowG: CanvasRenderingContext2D;
  private glowHalf: HTMLCanvasElement;
  private glowHalfG: CanvasRenderingContext2D;

  private lightCanvas: HTMLCanvasElement;
  private lightG: CanvasRenderingContext2D;
  private frameCanvas: HTMLCanvasElement;
  private frameG: CanvasRenderingContext2D;
  private redCanvas: HTMLCanvasElement;
  private redG: CanvasRenderingContext2D;
  private blueCanvas: HTMLCanvasElement;
  private blueG: CanvasRenderingContext2D;
  private visualTime = 0;

  /** WebGL2 migration mode (?renderer=gl): scene is drawn offscreen into `sceneCanvas`, then composited by `gl`. */
  private glMode = false;
  private sceneCanvas: HTMLCanvasElement | null = null;
  private gl: GLPipeline | null = null;

  constructor(
    private readonly game: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly world: World,
    private readonly cam: Camera,
    private readonly sprites: Record<string, Sprite>
  ) {
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    game.width = iw;
    game.height = ih;

    // WebGL is the default path: the game canvas is handed to GL and every existing draw*
    // helper runs unchanged into an offscreen 2D scene canvas, which the GL post chain
    // (bloom/CRT/haze) uploads and composites. ?renderer=2d keeps the canvas-2D phao
    // reachable as a fallback until the WebGL path is confirmed on real Android devices.
    const rendererParam = typeof location !== "undefined" ? new URLSearchParams(location.search).get("renderer") : null;
    this.glMode = rendererParam !== "2d";
    if (this.glMode) {
      this.sceneCanvas = document.createElement("canvas");
      this.sceneCanvas.width = iw;
      this.sceneCanvas.height = ih;
    }
    this.g = ctx2d(this.glMode ? (this.sceneCanvas as HTMLCanvasElement) : game);
    this.o = ctx2d(overlay);
    this.g.imageSmoothingEnabled = false;
    this.o.imageSmoothingEnabled = false;

    this.glowCanvas = document.createElement("canvas");
    this.glowCanvas.width = iw;
    this.glowCanvas.height = ih;
    this.glowG = ctx2d(this.glowCanvas);
    this.glowG.imageSmoothingEnabled = false;

    this.glowHalf = document.createElement("canvas");
    this.glowHalf.width = Math.floor(iw / 2);
    this.glowHalf.height = Math.floor(ih / 2);
    this.glowHalfG = ctx2d(this.glowHalf);
    this.glowHalfG.imageSmoothingEnabled = true;

    this.lightCanvas = document.createElement("canvas");
    this.lightCanvas.width = iw;
    this.lightCanvas.height = ih;
    this.lightG = ctx2d(this.lightCanvas);
    this.lightG.imageSmoothingEnabled = true;

    this.frameCanvas = document.createElement("canvas");
    this.frameCanvas.width = iw;
    this.frameCanvas.height = ih;
    this.frameG = ctx2d(this.frameCanvas);
    this.frameG.imageSmoothingEnabled = false;
    this.redCanvas = document.createElement("canvas");
    this.redCanvas.width = iw;
    this.redCanvas.height = ih;
    this.redG = ctx2d(this.redCanvas);
    this.blueCanvas = document.createElement("canvas");
    this.blueCanvas.width = iw;
    this.blueCanvas.height = ih;
    this.blueG = ctx2d(this.blueCanvas);

    this.fogCanvas = document.createElement("canvas");
    this.fogCanvas.width = 160;
    this.fogCanvas.height = 90;
    this.fogG = ctx2d(this.fogCanvas);

    const weatherCount = CONFIG.RENDER.WEATHER_COUNT;
    for (let i = 0; i < weatherCount; i++) {
      this.weather.push({
        x: Math.random() * iw,
        y: Math.random() * ih,
        v: 0.4 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.white.player = tinted(sprites.player.c, P.FLASH);
    this.shadowSprites.player = tinted(sprites.player.c, P.VOID);
    if (sprites.player_swordsman) {
      this.white.player_swordsman = tinted(sprites.player_swordsman.c, P.FLASH);
      this.shadowSprites.player_swordsman = tinted(sprites.player_swordsman.c, P.VOID);
    }
    if (sprites.player_mage) {
      this.white.player_mage = tinted(sprites.player_mage.c, P.FLASH);
      this.shadowSprites.player_mage = tinted(sprites.player_mage.c, P.VOID);
    }
    if (sprites.player_tank) {
      this.white.player_tank = tinted(sprites.player_tank.c, P.FLASH);
      this.shadowSprites.player_tank = tinted(sprites.player_tank.c, P.VOID);
    }
    for (const key of Object.keys(sprites)) {
      if (key.startsWith("enemy")) {
        this.white[key] = tinted(sprites[key].c, P.FLASH);
        this.statusSprites[key] = [P.ELEMENT.burn, P.ELEMENT.wet, P.ELEMENT.shock].map(color => tinted(sprites[key].c, color));
        this.shadowSprites[key] = tinted(sprites[key].c, P.VOID);
        this.eliteSprites[key] = tinted(sprites[key].c, "#ffd166");
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
    for (const id of ["dungeon", "caverns", "forge", "void"] as const) {
      this.biomeTileOf[id] = {
        ...this.tileOf,
        [TILE.FLOOR]: sprites[`floor_${id}`] ?? sprites.floor,
        [TILE.ACCENT]: sprites[`accent_${id}`] ?? sprites.accent,
        [TILE.WALL]: sprites[`wall_${id}`] ?? sprites.wall,
      };
    }

    if (this.glMode) {
      // acquiring WebGL2 on `game` is only safe here: in 2D mode `game` holds a 2D context,
      // and the two contexts are mutually exclusive on one canvas.
      this.gl = new GLPipeline(game, iw, ih, sprites, this.anims);
    }
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
        if (this.texts.length >= CONFIG.RENDER.TEXT_CAP) this.texts.shift();
        this.texts.push({ x: e.x, y: e.y, text: e.text, color: e.color, left: 48, total: 48, style: "normal" });
      }
      else if (e.t === "dmgNumber") {
        if (this.texts.length >= CONFIG.RENDER.TEXT_CAP) this.texts.shift();
        const style = e.style ?? "normal";
        this.texts.push({
          x: e.x, y: e.y,
          text: style === "heal" ? `+${Math.round(e.value)}` : String(Math.round(e.value)),
          color: style === "crit" ? "#ffd166" : style === "heal" ? "#58ff8a" : e.color ?? "#ffffff",
          left: style === "crit" ? 42 : 36, total: style === "crit" ? 42 : 36,
          style,
        });
      }
      else if (e.t === "roomTransition") {
        this.transTicks = CONFIG.FEEL.ROOM_TRANSITION_TICKS;
        this.transX = e.x;
        this.transY = e.y;
      }
      else if (e.t === "kingPhase") {
        this.kingCine = CONFIG.RENDER.KING_PHASE_CINE;
        this.kingCineTotal = CONFIG.RENDER.KING_PHASE_CINE;
        this.kingCineLabel = `GIAI ĐOẠN ${e.phase}`;
      }
      else if (e.t === "bossIntro") {
        this.kingCine = CONFIG.RENDER.BOSS_INTRO_CINE;
        this.kingCineTotal = CONFIG.RENDER.BOSS_INTRO_CINE;
        this.kingCineLabel = e.name;
        this.bossCineX = e.x;
        this.bossCineY = e.y;
        this.cam.focus(e.x, e.y, 90);
      }
      else if (e.t === "hitImpact") this.impactTicks = CONFIG.FEEL.IMPACT_TICKS;
    }
  }

  private stepVisual(dtReal: number): void {
    const ticks = dtReal * CONFIG.TIME.TICK_HZ;
    this.visualTime += dtReal;
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
    if (this.transTicks > 0) this.transTicks = Math.max(0, this.transTicks - ticks);
    // low-HP pulse: the vignette breathes while at or below 30% health (sfx heartbeat lives in player tick)
    const pl = this.world.player;
    if (!pl.dead && pl.hp > 0 && pl.hp / pl.maxHp < 0.3) {
      this.vignette = Math.max(this.vignette, 0.12 + 0.08 * Math.sin(pl.animTicks * 0.15));
    }
    for (const [k, v] of this.flash) {
      const n = v - ticks;
      if (n <= 0) this.flash.delete(k);
      else this.flash.set(k, n);
    }
    if (this.vignette > 0) this.vignette = Math.max(0, this.vignette - dtReal * 0.9);
    if (this.kingCine > 0) this.kingCine = Math.max(0, this.kingCine - ticks);
    if (this.impactTicks > 0) this.impactTicks--;
  }

  draw(dtReal: number, flags: DrawFlags): void {
    this.stepVisual(dtReal);
    const g = this.g;
    const w = this.world;
    this.origin = this.cam.origin(w.room);
    const ox = this.origin.x;
    const oy = this.origin.y;

    g.fillStyle = this.world.currentBiome.palette.outside;
    g.fillRect(0, 0, CONFIG.WORLD.INTERNAL_W, CONFIG.WORLD.INTERNAL_H);
    this.drawParallax(g);

    // kill-cam: everything world-space gets the zoom punch; first frame also desaturates
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const impactFlash = this.impactTicks === CONFIG.FEEL.IMPACT_TICKS;
    g.save();
    if (this.impactTicks > 0) {
      if (impactFlash) g.filter = `saturate(${CONFIG.FEEL.IMPACT_SATURATE})`;
      g.translate(iw / 2, ih / 2);
      g.scale(CONFIG.FEEL.IMPACT_ZOOM, CONFIG.FEEL.IMPACT_ZOOM);
      g.translate(-iw / 2, -ih / 2);
    }

    this.drawTiles(g, ox, oy);
    this.drawBossIntroCracks(g, ox, oy);
    this.drawDecals(g, ox, oy);
    this.drawTorches(g, ox, oy, false);
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
    this.drawSortedWorld(g, ox, oy);

    // --- Glow Bloom Pass (canvas 2D only; in GL mode the bloom post chain replaces it) ---
    if (!this.glMode) {
      const hw = Math.floor(iw / 2);
      const hh = Math.floor(ih / 2);
      const gg = this.glowG;
      gg.clearRect(0, 0, iw, ih);

      // Render bright FX onto isolated glow canvas
      this.drawArcs(gg, ox, oy, true);
      this.drawSlices(gg, ox, oy, true);
      this.drawBeams(gg, ox, oy, true);
      this.drawProjectileTrails(gg, ox, oy, true);
      this.drawProjectiles(gg, ox, oy, true);
      this.drawTelegraphs(gg, ox, oy, true);
      this.drawTorches(gg, ox, oy, true);
      // Fake gaussian blur via downscale -> upscale
      const hg = this.glowHalfG;
      hg.clearRect(0, 0, hw, hh);
      hg.drawImage(this.glowCanvas, 0, 0, hw, hh);

      // Composite bloom softly with additive blend
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.85;
      g.drawImage(this.glowHalf, 0, 0, iw, ih);
      g.restore();
    }

    // Sharp pixel-crisp foreground layer on main canvas
    this.drawArcs(g, ox, oy, false);
    this.drawSlices(g, ox, oy, false);
    this.drawBeams(g, ox, oy, false);
    this.drawProjectileTrails(g, ox, oy, false);
    this.drawProjectiles(g, ox, oy, false);

    this.drawParticles(g, ox, oy);
    this.drawTexts(g, ox, oy);
    this.drawAmbient(g, ox, oy);
    this.drawFog(g, dtReal);
    this.drawLighting(g, ox, oy);
    g.save();
    g.globalCompositeOperation = "color";
    g.globalAlpha = 0.15;
    g.fillStyle = w.currentBiome.palette.grade;
    g.fillRect(0, 0, iw, ih);
    g.restore();

    g.restore();
    g.filter = "none";
    if (impactFlash) {
      g.globalAlpha = CONFIG.FEEL.IMPACT_FLASH_ALPHA;
      g.fillStyle = P.VIGNETTE_HURT;
      g.fillRect(0, 0, iw, ih);
      g.globalAlpha = 1;
    }

    this.drawTransition(g);
    this.drawVignette(g, flags, this.glMode);
    this.applyBiomeDistortion(g, iw, ih);

    if (this.gl && this.sceneCanvas) {
      // GL owns bloom + vignette now; the dynamic hurt pulse rides on uHurt (red push),
      // while the baseline ambient rim comes from CONFIG.CRT.AMBIENT_VIGNETTE in the shader.
      this.gl.presentScene(this.sceneCanvas, {
        hurt: this.vignette,
        vignette: 0,
        brightness: CONFIG.SLIDERS.brightness,
        bloom: CONFIG.SLIDERS.bloom,
        crt: CONFIG.SLIDERS.crt,
        ripple: CONFIG.SLIDERS.ripple,
        time: this.visualTime,
      });
    }
  }

  private drawBossIntroCracks(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.kingCine <= 0 || this.kingCineTotal !== 120) return;
    const progress = 1 - this.kingCine / this.kingCineTotal;
    const radius = Math.floor(progress * 28);
    const cx = Math.round(this.bossCineX - ox);
    const cy = Math.round(this.bossCineY - oy);
    g.save();
    g.globalAlpha = Math.min(0.7, (1 - progress) * 0.8);
    for (let ray = 0; ray < 8; ray++) {
      const angle = ray * Math.PI / 4;
      for (let distance = 4; distance < radius; distance += 3) {
        const wobble = Math.round(Math.sin(distance * 0.7 + ray) * 1.5);
        const x = Math.round(cx + Math.cos(angle) * distance + wobble);
        const y = Math.round(cy + Math.sin(angle) * distance);
        this.ditherRect(g, x, y, 2, 1, "#ff6b45", 0.65);
      }
    }
    g.restore();
  }

  private applyBiomeDistortion(g: CanvasRenderingContext2D, iw: number, ih: number): void {
    const biome = this.world.currentBiome.id;
    if (biome === "dungeon") return;
    this.frameG.clearRect(0, 0, iw, ih);
    // Snapshot the scene we just drew into `g`'s canvas. In GL mode `g` is the offscreen
    // sceneCanvas and `this.game` is the composited GL output — reading this.game here would
    // feed the post-processed frame back as the scene, discarding the world and compounding
    // bloom each frame (black ghost on software GL, blown-out white on real GPUs).
    this.frameG.drawImage(this.g.canvas, 0, 0);
    g.clearRect(0, 0, iw, ih);

    if (biome === "forge") {
      g.fillStyle = this.world.currentBiome.palette.outside;
      g.fillRect(0, 0, iw, ih);
      for (let y = 0; y < ih; y += 2) {
        const h = Math.min(2, ih - y);
        const offset = Math.round(Math.sin(y * 0.3 + this.visualTime * 2.2) * 1.5);
        if (offset > 0) {
          g.drawImage(this.frameCanvas, 0, y, iw - offset, h, offset, y, iw - offset, h);
          g.drawImage(this.frameCanvas, 0, y, 1, h, 0, y, offset, h);
        } else if (offset < 0) {
          const shift = -offset;
          g.drawImage(this.frameCanvas, shift, y, iw - shift, h, 0, y, iw - shift, h);
          g.drawImage(this.frameCanvas, iw - 1, y, 1, h, iw - shift, y, shift, h);
        } else g.drawImage(this.frameCanvas, 0, y, iw, h, 0, y, iw, h);
      }
      return;
    }

    g.drawImage(this.frameCanvas, 0, 0);
    if (biome === "caverns") {
      const edge = 4;
      g.save();
      g.globalAlpha = 0.3;
      for (const [x, y, dx, dy, w, h] of [
        [0, 0, -1, 0, edge, ih],
        [iw - edge, 0, 1, 0, edge, ih],
        [0, 0, 0, -1, iw, edge],
        [0, ih - edge, 0, 1, iw, edge],
      ]) {
        g.save();
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        g.drawImage(this.frameCanvas, dx, dy);
        g.restore();
      }
      g.restore();
      return;
    }

    this.redG.clearRect(0, 0, iw, ih);
    this.redG.drawImage(this.frameCanvas, 0, 0);
    this.redG.globalCompositeOperation = "source-atop";
    this.redG.fillStyle = "#ff0000";
    this.redG.fillRect(0, 0, iw, ih);
    this.redG.globalCompositeOperation = "source-over";
    this.blueG.clearRect(0, 0, iw, ih);
    this.blueG.drawImage(this.frameCanvas, 0, 0);
    this.blueG.globalCompositeOperation = "source-atop";
    this.blueG.fillStyle = "#0000ff";
    this.blueG.fillRect(0, 0, iw, ih);
    this.blueG.globalCompositeOperation = "source-over";
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.2;
    g.drawImage(this.redCanvas, -1, 0);
    g.drawImage(this.blueCanvas, 1, 0);
    g.restore();
  }

  /** iris wipe: black closes over the door point, then opens onto the new room */
  private drawTransition(g: CanvasRenderingContext2D): void {
    if (this.transTicks <= 0) return;
    const total = CONFIG.FEEL.ROOM_TRANSITION_TICKS;
    const p = 1 - this.transTicks / total;
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const cx = Math.round(Math.max(10, Math.min(iw - 10, this.transX - this.origin.x)));
    const cy = Math.round(Math.max(10, Math.min(ih - 10, this.transY - this.origin.y)));
    // close over the first half, open through the second
    const r = Math.max(6, 200 * Math.abs(p * 2 - 1));
    g.globalAlpha = 1;
    g.fillStyle = P.VOID;
    g.beginPath();
    g.rect(0, 0, iw, ih);
    g.arc(cx, cy, r, 0, Math.PI * 2, true);
    g.fill("evenodd");
  }

  /** permanent blood stains under everything alive; drawn between tiles and telegraphs */
  private drawDecals(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const decals = this.world.decals;
    if (decals.length === 0) return;
    const T = CONFIG.WORLD.TILE;
    const room = this.world.room;
    for (const d of decals) {
      const x = Math.round(d.x - ox);
      const y = Math.round(d.y - oy);
      if (x < -8 || y < -8 || x > CONFIG.WORLD.INTERNAL_W + 8 || y > CONFIG.WORLD.INTERNAL_H + 8) continue;
      // floor stains only — walls and crates stay clean
      const tile = room.at(Math.floor(d.x / T), Math.floor(d.y / T));
      if (tile !== TILE.FLOOR && tile !== TILE.ACCENT) continue;
      g.globalAlpha = 0.55;
      g.fillStyle = d.color;
      for (const s of d.spots) {
        g.fillRect(x + Math.round(s.dx), y + Math.round(s.dy), s.s, s.s);
      }
    }
    g.globalAlpha = 1;
  }

  private ditherRect(
    g: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    color: string, threshold: number
  ): void {
    if (threshold <= 0) return;
    g.fillStyle = color;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iw = Math.ceil(w);
    const ih = Math.ceil(h);
    for (let py = 0; py < ih; py++) {
      const row = BAYER4[(iy + py) & 3];
      for (let px = 0; px < iw; px++) {
        if (row[(ix + px) & 3] / 16 < threshold) {
          g.fillRect(ix + px, iy + py, 1, 1);
        }
      }
    }
  }

  private drawLighting(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const lg = this.lightG;

    lg.globalCompositeOperation = "source-over";
    // the brightness slider scales the dim layer down (2x brightness = half the shade)
    const bright = Math.max(0.5, CONFIG.SLIDERS.brightness);
    const dimA = Math.min(1, 0.38 / bright);
    // Mềm và sáng hơn: giảm từ 0.82 xuống 0.38 để tránh màn hình bị tối đen quá mức
    lg.fillStyle = `rgba(10, 14, 22, ${dimA})`;
    lg.fillRect(0, 0, iw, ih);

    lg.globalCompositeOperation = "destination-out";

    const punch = (x: number, y: number, r: number, intensity = 1) => {
      const grad = lg.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(0,0,0,${intensity})`);
      grad.addColorStop(0.55, `rgba(0,0,0,${intensity * 0.6})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      lg.fillStyle = grad;
      lg.fillRect(x - r, y - r, r * 2, r * 2);
    };

    // player aura: mở rộng bán kính và tăng cường độ sáng
    const pl = this.world.player;
    punch(pl.x - ox, pl.y - 8 - oy, CONFIG.RENDER.LIGHT_PLAYER_R, 1);

    // enemy auras nhẹ để quái không bị chìm hoàn toàn vào bóng tối
    for (const en of this.world.enemies) {
      if (!en.dead && en.state !== ENEMY_STATE.VANISH) {
        punch(en.x - ox, en.y - en.bodyH * 0.5 - oy, CONFIG.RENDER.LIGHT_ENEMY_R, 0.45);
      }
    }

    // projectile lights: sáng rộng hơn
    for (const p of this.world.projectiles) {
      punch(p.x - ox, p.y - oy, CONFIG.RENDER.LIGHT_PROJ_R, 0.85);
    }

    // torch lights: flicker radius ±15%, slow enough to read as fire not strobe
    const now = this.visualTime * 1000;
    for (const t of this.world.room.torches) {
      const r = CONFIG.RENDER.TORCH_LIGHT_R * (1 + CONFIG.RENDER.TORCH_PULSE * Math.sin(now * CONFIG.RENDER.TORCH_FLICKER + t.phase));
      punch(t.x - ox, t.y - 3 - oy, r, 0.85);
    }

    // swing lights: mở rộng tầm sáng của nhát chém
    for (const a of this.arcs) {
      punch(a.x - ox, a.y - oy, a.reach * CONFIG.RENDER.LIGHT_SWING_SCALE, 0.7);
    }

    // beam lights
    for (const b of this.beams) {
      punch(b.x - ox, b.y - oy, CONFIG.RENDER.LIGHT_BEAM_R, 0.75);
      const bx = b.x + Math.cos(b.dir) * b.len * 0.5;
      const by = b.y + Math.sin(b.dir) * b.len * 0.5;
      punch(bx - ox, by - oy, CONFIG.RENDER.LIGHT_BEAM_MID_R, 0.75);
      const ex = b.x + Math.cos(b.dir) * b.len;
      const ey = b.y + Math.sin(b.dir) * b.len;
      punch(ex - ox, ey - oy, CONFIG.RENDER.LIGHT_BEAM_R, 0.75);
    }

    g.save();
    g.globalCompositeOperation = "multiply";
    g.drawImage(this.lightCanvas, 0, 0);
    g.restore();
  }

  /** distant biome backdrop, scrolled at 0.4x camera speed; drawn behind everything */
  private drawParallax(g: CanvasRenderingContext2D): void {
    const bg = this.sprites[`parallax_${this.world.currentBiome.id}`];
    if (bg === undefined) return;
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const px = Math.round(-this.origin.x * 0.4) % iw;
    const py = Math.round(-this.origin.y * 0.4) % ih;
    g.save();
    // the distant layer is the one place a touch of smoothing reads as "far away"
    g.imageSmoothingEnabled = true;
    for (let kx = -1; kx <= 1; kx++) {
      for (let ky = -1; ky <= 1; ky++) {
        g.drawImage(bg.c, px + kx * iw, py + ky * ih, iw, ih);
      }
    }
    g.restore();
  }

  /** wall torches: sprite + additive glow; the light punch lives in drawLighting */
  private drawTorches(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    const torches = this.world.room.torches;
    if (torches.length === 0) return;
    const now = this.visualTime * 1000;
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    g.globalCompositeOperation = "lighter";
    for (const t of torches) {
      const x = Math.round(t.x - ox) - 2;
      const y = Math.round(t.y - oy) - 7;
      if (x < -8 || y < -12 || x > iw || y > ih) continue;
      const frame = Math.floor(now / CONFIG.RENDER.TORCH_FRAME_MS + t.phase) % 2 === 0 ? this.sprites.torch : this.sprites.torch_flicker;
      if (frame === undefined) continue;
      if (glowOnly) {
        // bloom: a soft flame halo that breathes with the flicker
        const pulse = 1 + CONFIG.RENDER.TORCH_PULSE * Math.sin(now * CONFIG.RENDER.TORCH_FLICKER + t.phase);
        g.globalAlpha = 0.5;
        g.fillStyle = "#ff963f";
        g.fillRect(x - 2, y - 2, 9 * pulse, 10 * pulse);
      } else {
        g.drawImage(frame.c, x, y);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /** biome fog: blobs baked at 160×90, upscaled pixelated, composited with screen */
  private drawFog(g: CanvasRenderingContext2D, dtReal: number): void {
    const biome = this.world.currentBiome;
    if (biome.id === "dungeon") return;
    this.fogPhase += dtReal * 0.15;
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const fw = 160;
    const fh = 90;
    const fg = this.fogG;
    fg.clearRect(0, 0, fw, fh);
    for (let i = 0; i < 5; i++) {
      const cx = fw * (0.5 + 0.45 * Math.sin(this.fogPhase * (0.3 + i * 0.13) + i * 1.7));
      const cy = fh * (0.5 + 0.4 * Math.cos(this.fogPhase * (0.2 + i * 0.11) + i * 2.3));
      const r = Math.max(10, 26 + 12 * Math.sin(this.fogPhase * 0.8 + i));
      const grad = fg.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, biome.palette.fog);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      fg.fillStyle = grad;
      fg.fillRect(0, 0, fw, fh);
    }
    g.save();
    g.globalCompositeOperation = "screen";
    g.globalAlpha = biome.id === "void" ? 0.1 : 0.14;
    g.drawImage(this.fogCanvas, 0, 0, iw, ih);
    g.restore();
  }

  /** weather motes: snow (caverns), rising ash + embers (forge), drifting crystals + stars (void) */
  private drawWeather(g: CanvasRenderingContext2D): void {
    const biome = this.world.currentBiome;
    const time = this.visualTime;
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const drift = time * 14;
    for (let i = 0; i < this.weather.length; i++) {
      const p = this.weather[i];
      if (biome.id === "caverns") {
        // snow: falls with a sideways sine drift
        const x = (p.x + Math.sin(time * 1.4 + p.phase) * 8) % iw;
        const y = (p.y + drift * p.v) % ih;
        g.globalAlpha = 0.5;
        g.fillStyle = i % 5 === 0 ? "#ffffff" : "#bfe4ff";
        g.fillRect(Math.floor(x), Math.floor(y), 1, i % 7 === 0 ? 2 : 1);
      } else if (biome.id === "forge") {
        // ash rises, embers climb faster and glow
        const x = (p.x + Math.sin(time * 0.9 + p.phase) * 5) % iw;
        const y = (p.y - drift * p.v) % ih;
        const ember = i % 6 === 0;
        g.globalAlpha = ember ? 0.85 : 0.35;
        g.fillStyle = ember ? "#ff963f" : "#8a6a55";
        g.fillRect(Math.floor(x), Math.floor((y + ih) % ih), ember ? 2 : 1, ember ? 2 : 1);
      } else if (biome.id === "void") {
        // crystals drift almost still; stars twinkle in place
        const x = (p.x + Math.sin(time * 0.4 + p.phase) * 4 + iw) % iw;
        const y = (p.y + Math.cos(time * 0.3 + p.phase) * 3 + ih) % ih;
        if (i % 4 === 0) {
          g.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(time * 2.2 + p.phase * 3));
          g.fillStyle = "#e6d4ff";
          g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
        } else {
          g.globalAlpha = 0.3;
          g.fillStyle = "#8a4fbf";
          g.fillRect(Math.floor(x), Math.floor(y), 1, 2);
        }
      } else {
        return; // dungeon: no weather
      }
    }
    g.globalAlpha = 1;
  }

  private drawAmbient(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const pl = this.world.player;
    const px = Math.round(pl.x - ox);
    const py = Math.round(pl.y - 7 - oy);
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    const biome = this.world.currentBiome;

    // Ambient vignette giữ lại nhưng dịu: rìa 0.18 để quái cả phòng vẫn đọc được
    const bright = Math.max(0.5, CONFIG.SLIDERS.brightness);
    const rim = Math.min(0.25, 0.18 / bright);
    const mid = Math.min(0.15, 0.08 / bright);
    const grad = g.createRadialGradient(px, py, 60, px, py, 185);
    grad.addColorStop(0, "rgba(5, 7, 11, 0)");
    grad.addColorStop(0.7, `rgba(5, 7, 11, ${mid})`);
    grad.addColorStop(1, `rgba(5, 7, 11, ${rim})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, iw, ih);

    if (biome.id !== "dungeon") {
      const atmosphere = g.createRadialGradient(px, py, 10, px, py, 150);
      atmosphere.addColorStop(0, "rgba(0, 0, 0, 0)");
      atmosphere.addColorStop(0.62, biome.palette.ambient);
      atmosphere.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = atmosphere;
      g.fillRect(0, 0, iw, ih);
    }

    const time = this.visualTime;
    for (let i = 0; i < 12; i++) {
      let x = 0;
      let y = 0;
      let size = 1;
      let alpha = 0.2;
      if (biome.id === "caverns") {
        x = (i * 37 + time * 2.5 + Math.sin(time + i) * 3) % iw;
        y = (i * 29 + time * 8) % ih;
        size = i % 3 === 0 ? 2 : 1;
        alpha = 0.3;
      } else if (biome.id === "forge") {
        x = (i * 31 + Math.sin(time * 0.8 + i) * 8 + iw) % iw;
        y = (ih - ((i * 19 + time * 18) % ih)) % ih;
        size = i % 4 === 0 ? 2 : 1;
        alpha = 0.42;
      } else if (biome.id === "void") {
        x = (i * 23 + 7) % iw;
        y = (i * 17 + 3) % ih;
        size = i % 5 === 0 ? 2 : 1;
        alpha = 0.12 + (Math.sin(time * 1.8 + i) + 1) * 0.12;
      } else {
        x = (i * 23 + time * 1.5) % iw;
        y = (i * 31 + Math.sin(time + i) * 2 + ih) % ih;
        alpha = 0.1;
      }
      g.globalAlpha = alpha;
      g.fillStyle = biome.palette.particle;
      g.fillRect(Math.floor(x), Math.floor(y), size, size);
    }
    g.globalAlpha = 1;
    this.drawWeather(g);
  }

  private drawTiles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const T = CONFIG.WORLD.TILE;
    const room = this.world.room;
    const x0 = Math.max(0, Math.floor(ox / T));
    const y0 = Math.max(0, Math.floor(oy / T));
    const x1 = Math.min(room.w - 1, Math.ceil((ox + CONFIG.WORLD.INTERNAL_W) / T));
    const y1 = Math.min(room.h - 1, Math.ceil((oy + CONFIG.WORLD.INTERNAL_H) / T));
    const biomeTiles = this.biomeTileOf[this.world.currentBiome.id] ?? this.tileOf;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const s = biomeTiles[room.at(tx, ty)] ?? biomeTiles[TILE.FLOOR] ?? this.tileOf[TILE.FLOOR];
        g.drawImage(s.c, Math.round(tx * T - ox), Math.round(ty * T - oy));
      }
    }

    // --- oblique wall faces: bottom 6px strip over walls (and closed doors) that stand above floor ---
    // collision and room data are untouched; this only changes what is drawn
    const face = this.sprites[`wallface_${this.world.currentBiome.id}`];
    if (face !== undefined) {
      const FACE_H = face.h;
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = room.at(tx, ty);
          if (t !== TILE.WALL && t !== TILE.DOOR) continue;
          const below = room.at(tx, ty + 1);
          if (below === TILE.WALL || below === TILE.CRATE) continue;
          g.drawImage(face.c, Math.round(tx * T - ox), Math.round((ty + 1) * T - FACE_H - oy));
        }
      }

      g.fillStyle = "#000000";
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const tile = room.at(tx, ty);
          if (tile !== TILE.WALL && tile !== TILE.DOOR && tile !== TILE.CRATE) continue;
          const below = room.at(tx, ty + 1);
          if (below === TILE.WALL || below === TILE.CRATE) continue;
          const x = Math.round(tx * T - ox);
          const y = Math.round((ty + 1) * T - oy);
          g.globalAlpha = 0.22;
          g.fillRect(x, y, T, 1);
          g.globalAlpha = 0.1;
          g.fillRect(x, y + 1, T, 1);
        }
      }
      g.globalAlpha = 1;
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

  private drawArcs(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
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
        this.wedge(g, cx, cy, a.dir, r, a.deg, 0.4);
        g.fill();

        // four trailing wedges instead of two — reads as a heavy follow-through
        g.fillStyle = baseColor;
        for (let k = 1; k <= 4; k++) {
          g.globalAlpha = rd.SLASH_ALPHA * t * (0.32 - 0.06 * k);
          this.wedge(g, cx, cy, a.dir - 0.06 * k, r * (0.98 - 0.02 * k), a.deg * (0.9 - 0.04 * k), 0.5);
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
      this.wedge(g, cx, cy, a.dir, r, a.deg, 0.45);
      g.fill();

      // Trailing echoes: two fainter wedges lagging behind the sweep
      g.fillStyle = baseColor;
      g.globalAlpha = rd.SLASH_ALPHA * t * 0.3;
      this.wedge(g, cx, cy, a.dir - 0.08, r * 0.98, a.deg * 0.9, 0.5);
      g.fill();
      g.globalAlpha = rd.SLASH_ALPHA * t * 0.15;
      this.wedge(g, cx, cy, a.dir - 0.16, r * 0.95, a.deg * 0.8, 0.5);
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

  private drawSlices(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
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

  private drawTelegraphs(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    for (const en of this.world.enemies) {
      if (en.state !== ENEMY_STATE.TELEGRAPH) continue;
      const e = en.def;
      const prog = 1 - en.telegraphTicksLeft / Math.max(1, en.telegraphTotal);
      const cx = Math.round(en.x - ox);
      const cy = Math.round(en.y - e.BODY_H * 0.5 - oy);

      g.globalAlpha = 0.55 + 0.45 * prog;
      g.strokeStyle = P.TELEGRAPH_EDGE;
      g.lineWidth = 1;
      if (!glowOnly) {
        g.setLineDash([3, 2]);
        g.lineDashOffset = -this.world.tickCount % 5;
      }

      if (en.kind === "charger") {
        // a fat thrust line with a chevron tip: read the shaft, step off it
        const x1 = cx + Math.cos(en.telegraphDir) * e.ATTACK_REACH;
        const y1 = cy + Math.sin(en.telegraphDir) * e.ATTACK_REACH;
        g.lineCap = "butt";
        if (glowOnly) {
          g.globalAlpha = 0.5 + 0.5 * prog;
          g.strokeStyle = P.TELEGRAPH_EDGE;
          g.lineWidth = 6;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(x1, y1);
          g.stroke();
        } else {
          g.globalAlpha = CONFIG.READABILITY.TELEGRAPH_FILL * (0.55 + 0.45 * prog);
          g.strokeStyle = P.TELEGRAPH_FILL;
          g.lineWidth = 4;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(x1, y1);
          g.stroke();
          g.globalAlpha = 0.55 + 0.45 * prog;
          g.strokeStyle = P.TELEGRAPH_EDGE;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(x1, y1);
          g.stroke();
          // chevron tip pointing down the shaft
          const a = en.telegraphDir;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x1 - Math.cos(a - 0.7) * 5, y1 - Math.sin(a - 0.7) * 5);
          g.lineTo(x1, y1);
          g.lineTo(x1 - Math.cos(a + 0.7) * 5, y1 - Math.sin(a + 0.7) * 5);
          g.stroke();
        }
        g.lineCap = "butt";
        g.globalAlpha = 1;
        continue;
      }

      if (en.kind === "sniper") {
        // a hair-thin lane across the room with a pulsing target dot at the far end
        const reach = Math.hypot(this.world.room.widthPx, this.world.room.heightPx);
        const x1 = cx + Math.cos(en.telegraphDir) * reach;
        const y1 = cy + Math.sin(en.telegraphDir) * reach;
        if (glowOnly) {
          g.globalAlpha = 0.4 + 0.6 * prog;
          g.strokeStyle = P.TELEGRAPH_EDGE;
          g.lineWidth = 4;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(x1, y1);
          g.stroke();
        } else {
          g.globalAlpha = 0.35 + 0.65 * prog;
          g.strokeStyle = P.TELEGRAPH_EDGE;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(x1, y1);
          g.stroke();
          // target dot: where the shot will land, brightening as it locks
          g.globalAlpha = 0.5 + 0.5 * prog;
          g.fillStyle = P.TELEGRAPH_EDGE;
          g.beginPath();
          g.arc(x1, y1, 2 + prog * 1.5, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        continue;
      }

      if (en.kind === "exploder") {
        // a swelling blast disc that flashes harder the closer it is to popping
        if (glowOnly) {
          g.globalAlpha = 0.35 + 0.65 * prog;
          g.fillStyle = P.TELEGRAPH_EDGE;
          g.beginPath();
          g.arc(cx, cy, Math.max(1, e.ATTACK_REACH * prog), 0, Math.PI * 2);
          g.fill();
        } else {
          g.globalAlpha = CONFIG.READABILITY.TELEGRAPH_FILL * (0.5 + 0.5 * prog * prog);
          g.fillStyle = P.TELEGRAPH_FILL;
          g.beginPath();
          g.arc(cx, cy, Math.max(1, e.ATTACK_REACH * prog), 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 0.55 + 0.45 * prog;
          g.strokeStyle = P.TELEGRAPH_EDGE;
          g.beginPath();
          g.arc(cx, cy, e.ATTACK_REACH, 0, Math.PI * 2);
          g.stroke();
          // final flash: an inner ring that blooms right before detonation
          if (prog > 0.75) {
            g.globalAlpha = (prog - 0.75) * 4 * 0.8;
            g.strokeStyle = "#ffffff";
            g.beginPath();
            g.arc(cx, cy, e.ATTACK_REACH * prog * 0.7, 0, Math.PI * 2);
            g.stroke();
          }
        }
        g.globalAlpha = 1;
        continue;
      }

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
        if (!glowOnly) g.setLineDash([]);
        // boss ring carries a countdown read at the centre (whole seconds remaining)
        if (en.kind === "boss" && !glowOnly) {
          g.globalAlpha = 0.9;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.font = "bold 7px ui-monospace, monospace";
          const secs = String(Math.ceil(en.telegraphTicksLeft / 60));
          g.fillStyle = P.VOID;
          g.fillText(secs, cx + 1, cy + 1);
          g.fillStyle = "#ffe66b";
          g.fillText(secs, cx, cy);
        }
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
      if (!glowOnly) g.setLineDash([]);
      // warden laser: a bright core down the wedge centre so the sweep lane reads instantly
      if (laser) {
        const lx = cx + Math.cos(en.telegraphDir) * reach;
        const ly = cy + Math.sin(en.telegraphDir) * reach;
        if (glowOnly) {
          g.globalAlpha = 0.4 + 0.6 * prog;
          g.strokeStyle = "#ff5a3c";
          g.lineWidth = 6;
        } else {
          g.globalAlpha = 0.55 + 0.45 * prog;
          g.strokeStyle = "#ff5a3c";
          g.lineWidth = 2;
        }
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(lx, ly);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  private drawShadows(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const en of this.world.enemies) {
      if (en.removed) continue;
      if (en.state === ENEMY_STATE.VANISH) continue;
      const sp = this.sprites[en.def.SPRITE_KEY] ?? this.sprites.enemy;
      const sc = en.isElite ? 1.3 : 1;
      const shadow = this.shadowSprites[en.def.SPRITE_KEY] ?? this.shadowSprites.enemy;
      const x = Math.round(en.x - sp.ax * sc - ox);
      const y = Math.round(en.y - sp.ay * sc - oy);
      const w = Math.round(sp.w * sc);
      const h = Math.round(sp.h * sc);
      g.globalAlpha = 0.3;
      g.drawImage(shadow, x, y + 1, w, h);
      g.globalAlpha = 0.15;
      g.drawImage(shadow, x, y + 2, w, h);
    }
    const pl = this.world.player;
    const key = `player_${pl.character}`;
    const sp = this.sprites[key] ?? this.sprites.player;
    const shadow = this.shadowSprites[key] ?? this.shadowSprites.player;
    const x = Math.round(pl.x - sp.ax - ox);
    const y = Math.round(pl.y - sp.ay - oy);
    g.globalAlpha = 0.3;
    g.drawImage(shadow, x, y + 1, sp.w, sp.h);
    g.globalAlpha = 0.15;
    g.drawImage(shadow, x, y + 2, sp.w, sp.h);
    g.globalAlpha = 1;
  }

  /** depth sort: enemies, player, projectiles and particles in one y-sorted draw list.
   *  Floor indicators (telegraphs, arcs, beams) stay below; damage numbers stay above. */
  private drawSortedWorld(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (const en of this.world.enemies) {
      if (en.removed) continue;
      items.push({ y: en.y, draw: () => this.drawOneEnemy(g, en, ox, oy) });
    }
    items.push({ y: this.world.player.y, draw: () => this.drawPlayer(g, ox, oy) });
    for (const p of this.world.projectiles) {
      items.push({ y: p.y, draw: () => this.drawOneProjectile(g, p, ox, oy, false) });
    }
    const density = CONFIG.SLIDERS.particles;
    if (density > 0.01) {
      this.world.particles.visit((s) => {
        if (!s.live) return;
        items.push({ y: s.y, draw: () => this.drawOneParticle(g, s, ox, oy, density) });
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
  }

  private drawOneEnemy(g: CanvasRenderingContext2D, en: Enemy, ox: number, oy: number): void {
    const target = this.world.player.autoTargetId;
    if (en.removed) return;
    const baseSprite = this.sprites[en.def.SPRITE_KEY] ?? this.sprites.enemy;
    const white = this.white[en.def.SPRITE_KEY] ?? this.white.enemy;
    const sc = en.isElite ? 1.3 : 1;

    // --- multi-frame anim + state clips, right-facing mirror ---
    const key = en.def.SPRITE_KEY;
    let set = this.anims[key] ?? this.anims.enemy;
    let phaseFrame: number | null = null;
    if (en.state === ENEMY_STATE.TELEGRAPH) {
      const windup = this.anims[`${key}_attack`];
      if (windup) { set = windup; phaseFrame = 0; }
    } else if (en.state === ENEMY_STATE.ATTACK && en.swing !== null) {
      const atk = this.anims[`${key}_attack`];
      if (atk) { set = atk; phaseFrame = en.swing.phase === "active" ? 1 : 2; }
    } else if (en.state === ENEMY_STATE.APPEAR) {
      const spawn = this.anims[`${key}_spawn`];
      if (spawn) set = spawn;
    }
    let sp = baseSprite;
    if (set) {
      const fi = phaseFrame !== null
        ? Math.min(set.frames.length - 1, phaseFrame)
        : en.state === ENEMY_STATE.APPEAR
          ? Math.min(set.frames.length - 1, Math.floor(en.ticksInState / set.tickDur))
          : Math.floor(en.animTicks / set.tickDur) % set.frames.length;
      sp = Math.cos(en.facing) > 0.15 ? set.mirrored[fi] : set.frames[fi];
    } else if (Math.cos(en.facing) > 0.15) {
      sp = this.mirrored(baseSprite, en.def.SPRITE_KEY);
    }
    // death clip: crumble frames advance as the corpse fades out
    if (en.dead) {
      const death = this.anims[`${key}_death`];
      if (death) {
        const total = en.def.CORPSE_TICKS;
        const fi = Math.min(death.frames.length - 1, Math.floor((1 - en.corpseTicks / total) * death.frames.length));
        sp = Math.cos(en.facing) > 0.15 ? death.mirrored[fi] : death.frames[fi];
      }
    }

    // --- squash & stretch during the attack's active window ---
    let sx = 1;
    let sy = 1;
    if (en.state === ENEMY_STATE.ATTACK && en.swing !== null && en.swing.phase === "active") {
      const t = 1 - en.swing.ticksLeft / Math.max(1, en.swing.fd.active);
      const pulse = 0.08 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
      sx = 1 + pulse;
      sy = 1 - pulse;
    }
    const w = Math.round(sp.w * sc);
    const h = Math.round(sp.h * sc);
    const x = Math.round(en.x - sp.ax * sc - ox);
    // z-height lifts the body off the ground; the shadow (drawShadows) stays put
    const y = Math.round(en.y - sp.ay * sc - en.z * sc - oy);
    const flashing = (this.flash.get(en.id) ?? 0) > 0;

    if (en.dead) {
      const total = en.def.CORPSE_TICKS;
      g.globalAlpha = Math.max(0, en.corpseTicks / total);
      g.drawImage(sp.c, x, y + (total - en.corpseTicks), w, h);
      g.globalAlpha = 1;
      return;
    }

    if (en.state === ENEMY_STATE.VANISH) return;
    const appearTicks = en.isElite ? CONFIG.ENEMY.ELITE_SPAWN_TICKS : en.def.APPEAR_TICKS;
    const fade =
      en.state === ENEMY_STATE.APPEAR && appearTicks > 0
        ? 0.3 + 0.7 * Math.min(1, en.ticksInState / appearTicks)
        : 1;
    const ecx = Math.round(en.x - ox);
    const ecy = Math.round(en.y - oy);
    g.save();
    g.translate(ecx, ecy);
    g.scale(sx, sy);
    g.translate(-ecx, -ecy);
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
      if (en.isElite) {
        const elite = this.eliteSprites[en.def.SPRITE_KEY];
        if (elite !== undefined) {
          g.globalAlpha = 0.22 * fade;
          g.drawImage(elite, x, y, w, h);
          g.globalAlpha = 1;
        }
      }
    }
    g.restore();
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
      const crownX = Math.round(en.x - ox - 1);
      const crownY = y - 4;
      g.fillStyle = "#ffd166";
      g.fillRect(crownX, crownY + 1, 3, 2);
      g.fillRect(crownX, crownY, 1, 1);
      g.fillRect(crownX + 2, crownY, 1, 1);
      if (en.state === ENEMY_STATE.APPEAR) {
        g.globalAlpha = 0.45 + 0.35 * Math.sin(en.animTicks * 0.3);
        g.strokeStyle = "#ff3b3b";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(Math.round(en.x - ox), Math.round(en.y - oy), 9 + (en.animTicks % 4), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
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

  private drawBeams(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
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

  private drawProjectiles(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    for (const p of this.world.projectiles) this.drawOneProjectile(g, p, ox, oy, glowOnly);
  }

  /** afterimage trails: 4 faded ghosts behind each shot, matching its palette */
  private drawProjectileTrails(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    for (const p of this.world.projectiles) {
      if (!p.trail) continue;
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i];
        const fade = 1 - i / p.trail.length;
        const x = Math.round(t.x - ox);
        const y = Math.round(t.y - oy);
        let color: string;
        if (p.kind === "ghost" || p.kind === "bolt") color = "#c99ae6";
        else if (p.kind === "lava") color = "#ffb14d";
        else color = p.owner === "player" ? "#ff963f" : P.PROJ;
        if (glowOnly) {
          g.globalAlpha = fade * 0.45;
          g.fillStyle = color;
          g.fillRect(x - 2, y - 2, 4, 4);
        } else {
          g.globalAlpha = fade * 0.75;
          g.fillStyle = color;
          g.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }
    g.globalAlpha = 1;
  }

  private drawOneProjectile(g: CanvasRenderingContext2D, p: Projectile, ox: number, oy: number, glowOnly = false): void {
    const x = Math.round(p.x - ox);
    const y = Math.round(p.y - oy);
    // the mage's arcane bolt reads violet so it never passes for the orange fireball skill
    if (p.owner === "player" && p.kind === "bolt") {
      if (glowOnly) {
        g.fillStyle = "#c99ae6";
        g.fillRect(x - 3, y - 3, 6, 6);
      } else {
        g.fillStyle = "#3a1450";
        g.fillRect(x - 2, y - 2, 4, 4);
        g.fillStyle = "#c99ae6";
        g.fillRect(x - 1, y - 1, 2, 2);
      }
      return;
    }
    // the forgotten king's ghost shots: a cold violet, distinct from the warm fireball
    if (p.kind === "ghost") {
      if (glowOnly) {
        g.fillStyle = "#c99ae6";
        g.fillRect(x - 4, y - 4, 8, 8);
      } else {
        g.fillStyle = "#3a1252";
        g.fillRect(x - 3, y - 3, 6, 6);
        g.fillStyle = "#c99ae6";
        g.fillRect(x - 1, y - 1, 3, 3);
      }
      return;
    }
    // the forge golem's lava globs: molten orange over a dark crust, flying in an arc
    if (p.kind === "lava") {
      const total = enemyDef("golem").SHOT_LIFE_TICKS;
      const t = 1 - p.ticksLeft / Math.max(1, total);
      const arc = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * 8;
      if (glowOnly) {
        g.fillStyle = "#ffb14d";
        g.fillRect(x - 4, y - 4 - arc, 8, 8);
      } else {
        g.fillStyle = "#8a2f1c";
        g.fillRect(x - 3, y - 3 - arc, 6, 6);
        g.fillStyle = "#ffb14d";
        g.fillRect(x - 1, y - 1 - arc, 3, 3);
      }
      return;
    }
    const hot = p.owner === "player";
    if (glowOnly) {
      g.fillStyle = hot ? "#ff963f" : P.PROJ;
      g.fillRect(x - 3, y - 3, 6, 6);
    } else {
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
    const base = this.sprites[spriteKey] ?? this.sprites.player;
    const dir = pl.state === PLAYER_STATE.DASH ? pl.dashDir : pl.facing;

    // --- multi-frame anim: idle-breath / walk cycle, mirrored when facing right ---
    const idle = this.anims[`${spriteKey}_idle`];
    const walk = this.anims[spriteKey];
    // swing/hurt clips override the locomotion loop, framed by the swing phase
    let set: SpriteSet | undefined;
    let phaseFrame: number | null = null;
    if (pl.state === PLAYER_STATE.ATTACK && pl.swing !== null) {
      set = this.anims[`${spriteKey}_attack`];
      if (set) phaseFrame = pl.swing.phase === "startup" ? 0 : pl.swing.phase === "active" ? 1 : 2;
    } else if (pl.state === PLAYER_STATE.HURT) {
      set = this.anims[`${spriteKey}_hurt`];
      if (set) phaseFrame = pl.hurtTicks > CONFIG.PLAYER.HURT_TICKS / 2 ? 0 : 1;
    }
    if (set === undefined) set = pl.state === PLAYER_STATE.IDLE ? (idle ?? walk) : (walk ?? idle);
    let sp = base;
    if (set) {
      const fi = phaseFrame !== null ? Math.min(set.frames.length - 1, phaseFrame) : Math.floor(pl.animTicks / set.tickDur) % set.frames.length;
      sp = Math.cos(dir) > 0.15 ? set.mirrored[fi] : set.frames[fi];
    } else if (Math.cos(dir) > 0.15) {
      sp = this.mirrored(base, spriteKey);
    }

    // --- squash & stretch: dash stretch, attack swing pulse ---
    let sx = 1;
    let sy = 1;
    if (pl.state === PLAYER_STATE.DASH) {
      sx = 1.15;
      sy = 0.85;
    } else if (pl.state === PLAYER_STATE.ATTACK && pl.swing !== null) {
      const t = 1 - pl.swing.ticksLeft / Math.max(1, pl.swing.fd.active);
      const pulse = 0.08 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
      sx = 1 + pulse;
      sy = 1 - pulse;
    }

    // Dynamic attack lean
    let leanX = 0;
    let leanY = 0;
    if (pl.state === PLAYER_STATE.ATTACK) {
      leanX = Math.round(Math.cos(pl.facing) * 1.5);
      leanY = Math.round(Math.sin(pl.facing) * 1.5);
    }

    const x = Math.round(pl.x - sp.ax - ox) + leanX;
    // a dash lifts the body 2px off its shadow — reads as a hop, not a slide
    const lift = pl.state === PLAYER_STATE.DASH ? 2 : 0;
    const y = Math.round(pl.y - sp.ay - oy) + leanY - lift;
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
    const cxp = Math.round(pl.x - ox) + leanX;
    const cyp = Math.round(pl.y - oy) + leanY;
    g.save();
    g.translate(cxp, cyp);
    g.scale(sx, sy);
    g.translate(-cxp, -cyp);
    g.drawImage(flashing ? flashImg : sp.c, x, y);
    g.restore();

    const f = facingOffsets(dir);
    g.fillStyle = P.PLAYER_RIM;
    g.fillRect(x + sp.ax - 1 + f.x, y + sp.ay - 8 + f.y, 2, 2);
    g.globalAlpha = 1;
  }

  private drawParticles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const density = CONFIG.SLIDERS.particles;
    if (density <= 0.01) return;
    this.world.particles.visit((s) => this.drawOneParticle(g, s, ox, oy, density));
  }

  private drawOneParticle(g: CanvasRenderingContext2D, s: Slot, ox: number, oy: number, density: number): void {
    if (!s.live) return;
    const t = s.life / s.maxLife;
    const alpha = Math.min(1, (0.25 + 0.75 * t) * s.alphaScale * density);
    if (s.sprite !== null) {
      const sp = this.sprites[s.sprite];
      if (sp === undefined) return;
      g.globalAlpha = alpha * 0.35;
      g.drawImage(sp.c, Math.round(s.x - sp.ax - ox), Math.round(s.y - sp.ay - oy));
      return;
    }
    g.globalAlpha = alpha;
    g.fillStyle = s.color;
    const sz = Math.max(1, Math.round(s.size));
    g.fillRect(Math.round(s.x - ox), Math.round(s.y - oy), sz, sz);
    g.globalAlpha = 1;
  }

  private drawTexts(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.texts.length === 0) return;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    for (const ft of this.texts) {
      let x = Math.round(ft.x - ox);
      const y = Math.round(ft.y - oy);
      g.font = ft.style === "crit" ? "bold 7px ui-monospace, monospace" : "bold 5px ui-monospace, monospace";
      // crits jitter ±1px so the blow reads heavy
      if (ft.style === "crit") x += Math.floor((ft.left * 7) % 3) - 1;
      g.globalAlpha = Math.min(1, (ft.left / ft.total) * 1.8);
      g.fillStyle = P.VOID;
      g.fillText(ft.text, x + 1, y + 1);
      g.fillStyle = ft.color;
      g.fillText(ft.text, x, y);
    }
    g.globalAlpha = 1;
  }

  private drawVignette(g: CanvasRenderingContext2D, flags: DrawFlags, glOwnsHurt = false): void {
    const iw = CONFIG.WORLD.INTERNAL_W;
    const ih = CONFIG.WORLD.INTERNAL_H;
    if (!glOwnsHurt && this.vignette > 0.001) {
      g.globalAlpha = Math.min(0.75, this.vignette * 1.4);
      g.fillStyle = P.VIGNETTE_HURT;
      const thickness = 3 + Math.round(this.vignette * 10);
      g.fillRect(0, 0, iw, thickness);
      g.fillRect(0, ih - thickness, iw, thickness);
      g.fillRect(0, 0, thickness, ih);
      g.fillRect(iw - thickness, 0, thickness, ih);
      g.globalAlpha = 1;
    }
    if (flags.hitStop && this.world.hitStopTicks > 0) {
      g.globalAlpha = 0.25;
      g.strokeStyle = P.SLASH;
      g.lineWidth = 1;
      g.strokeRect(1.5, 1.5, iw - 3, ih - 3);
      g.globalAlpha = 1;
    }
    // boss and king intros share the same brief white bloom and centred title card
    if (this.kingCine > 0) {
      const a = this.kingCine / this.kingCineTotal;
      g.globalAlpha = Math.min(0.8, a * 0.8);
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, iw, ih);
      g.globalAlpha = Math.min(1, a * 1.6);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "bold 16px ui-monospace, monospace";
      const cx = Math.round(iw / 2);
      const cy = Math.round(ih / 2);
      g.fillStyle = "#2a0b3d";
      g.fillText(this.kingCineLabel, cx + 1, cy + 1);
      g.fillStyle = "#ffe66b";
      g.fillText(this.kingCineLabel, cx, cy);
      g.globalAlpha = 1;
    }
  }
}