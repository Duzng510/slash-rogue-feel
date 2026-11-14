import { CONFIG, enemyDef } from "../config.ts";
import type { VisualEvent } from "../events.ts";
import { humanityErosion } from "../systems/humanity.ts";
import { ENEMY_STATE, type Enemy } from "../entities/enemy.ts";
import type { Npc } from "../entities/npc.ts";
import { PLAYER_STATE } from "../entities/player.ts";
import { angleLerp } from "../mathx.ts";
import { TILE } from "../world/rooms.ts";
import { HOUSES } from "../world/town.ts";
import { fitAxes, isRotated } from "../ui/immersive.ts";
import { buildAnimSets, facingOffsets, flipH, type Sprite, type SpriteSet } from "./pixelart.ts";
import { playerRigPose, type RigPart, type RigTransform } from "./playerRig.ts";
import { WEAPONS, type WeaponId } from "../systems/weapons.ts";
import type { Slot } from "../systems/particles.ts";
import type { Projectile } from "../sim/types.ts";
import type { Camera } from "./camera.ts";
import type { TownProp, World } from "../world/world.ts";
import { GLPipeline } from "./gl/pipeline.ts";
import { FxLayer, wedge } from "./fxLayer.ts";

const P = CONFIG.PALETTE;
const PIXEL_SCALE = CONFIG.WORLD.PIXEL_SCALE;
const VIEW_W = CONFIG.WORLD.INTERNAL_W / PIXEL_SCALE;
const VIEW_H = CONFIG.WORLD.INTERNAL_H / PIXEL_SCALE;

const TINT_OPAQUE: readonly [number, number, number, number] = [1, 1, 1, 1];

/** house footprints in room-tile coords (Room's border shifts the inner grid by one) */
const TOWN_FOOTPRINTS = HOUSES.map((h) => ({
  id: h.id,
  tx0: h.x + 1,
  ty0: h.y + 1,
  tx1: h.x + h.w,
  ty1: h.y + h.h,
}));

function townFootprintAt(tx: number, ty: number): (typeof TOWN_FOOTPRINTS)[number] | null {
  for (const fp of TOWN_FOOTPRINTS) {
    if (tx >= fp.tx0 && tx <= fp.tx1 && ty >= fp.ty0 && ty <= fp.ty1) return fp;
  }
  return null;
}

/** parse "#rrggbb" → normalized rgb tuple for the GPU tile-batch clear color */
function rgbTuple(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function colorTuple(hex: string, alpha = 1): [number, number, number, number] {
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(hex);
  if (rgba) {
    const channel = (value: string): number => Math.max(0, Math.min(255, Number(value))) / 255;
    return [
      channel(rgba[1]!),
      channel(rgba[2]!),
      channel(rgba[3]!),
      alpha * (rgba[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgba[4])))),
    ];
  }
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`expected a hex color for WebGL batching, got "${hex}"`);
  const raw = match[1]!;
  const expanded = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const value = Number.parseInt(expanded, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
}

type VerletPoint = { x: number; y: number; px: number; py: number };

/** depth-sort list entries: pooled structs, drawn by a switch (no per-item closures) */
const SORT_KIND = { prop: 0, enemy: 1, npc: 2, player: 3, projectile: 4, particle: 5, wall: 6 } as const;
type SortItem = {
  y: number;
  kind: number;
  ref: unknown;
  sp: Sprite | null;
  face: Sprite | null;
  x: number;
  sy: number;
};

/** per-sprite-key art resolved once instead of string lookups per enemy per frame */
type EnemyArt = {
  base: Sprite;
  white: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  status: HTMLCanvasElement[] | undefined;
  elite: HTMLCanvasElement | undefined;
  idle: SpriteSet | undefined;
  attack: SpriteSet | undefined;
  spawn: SpriteSet | undefined;
  death: SpriteSet | undefined;
};
const WEAPON_GRIPS: Record<WeaponId, { x: number; y: number; scale: number }> = {
  katana: { x: 3, y: 13, scale: 0.85 },
  greatsword: { x: 8, y: 13, scale: 0.9 },
  dagger: { x: 8, y: 12, scale: 0.72 },
  spear: { x: 3, y: 14, scale: 1.1 },
  whip: { x: 3, y: 13, scale: 0.9 },
};

const BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

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

  private fx = new FxLayer();
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
  /** drifting fog: baked at half logical viewport resolution, then upscaled pixelated */
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
  private enemyArtCache = new Map<string, EnemyArt>();
  /** pooled depth-sort entries + the reused list that orders them */
  private sortPool: SortItem[] = [];
  private sortList: SortItem[] = [];
  private sortCount = 0;

  private artFor(key: string): EnemyArt {
    let art = this.enemyArtCache.get(key);
    if (art !== undefined) return art;
    art = {
      base: this.sprites[key] ?? this.sprites.enemy,
      white: this.white[key] ?? this.white.enemy,
      shadow: this.shadowSprites[key] ?? this.shadowSprites.enemy,
      status: this.statusSprites[key],
      elite: this.eliteSprites[key],
      idle: this.anims[key] ?? this.anims.enemy,
      attack: this.anims[`${key}_attack`],
      spawn: this.anims[`${key}_spawn`],
      death: this.anims[`${key}_death`],
    };
    this.enemyArtCache.set(key, art);
    return art;
  }

  private nextSortItem(): SortItem {
    let it = this.sortPool[this.sortCount];
    if (it === undefined) {
      it = { y: 0, kind: 0, ref: null, sp: null, face: null, x: 0, sy: 0 };
      this.sortPool[this.sortCount] = it;
    }
    this.sortCount++;
    this.sortList.push(it);
    return it;
  }

  private readonly collectParticle = (s: Readonly<Slot>): void => {
    if (!s.live) return;
    const it = this.nextSortItem();
    it.y = s.y;
    it.kind = SORT_KIND.particle;
    it.ref = s;
  };
  private mirrored(sp: Sprite, key: string): Sprite {
    const hit = this.mirrorCache[key];
    if (hit) return hit;
    const made = flipH(sp);
    this.mirrorCache[key] = made;
    return made;
  }

  private glow: {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    half: HTMLCanvasElement;
    halfContext: CanvasRenderingContext2D;
  } | null = null;

  private frameCanvas: HTMLCanvasElement;
  private frameG: CanvasRenderingContext2D;
  private redCanvas: HTMLCanvasElement;
  private redG: CanvasRenderingContext2D;
  private blueCanvas: HTMLCanvasElement;
  private blueG: CanvasRenderingContext2D;
  private visualTime = 0;
  private capeChain: VerletPoint[] = [];

  /** WebGL2 mode: batched world is rendered by GL; remaining Canvas effects use `sceneCanvas` as an overlay. */
  private glMode = false;
  private sceneCanvas: HTMLCanvasElement | null = null;
  private gl: GLPipeline | null = null;
  /** GL world batching is disabled only by ?glbatch=0 or the measurement-only probe mode. */
  private glBatch = false;
  private glComposite = false;
  private glWorldBatch = false;
  private tileBatchCount = 0;
  private probeTilesMean = 0;
  /** per-frame CPU 2D tile blits — zero in the default GL batch path */
  private drawImageCount = 0;
  /** per-frame Canvas overlay uploads to the GPU in the present step */
  private presentUploads = 0;
  /** whether the CPU overlay contains anything that was not migrated to the batch */
  private overlayDirty = false;
  /** last draw's debug flags, reused by profileFrames so it renders identically */
  private lastFlags: DrawFlags = { boxes: false, fps: false, hitStop: false };

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

    // WebGL is the default path: world sprites go through SpriteBatch into sceneRT, while
    // the remaining Canvas-only effects are uploaded as a transparent overlay on demand.
    // ?renderer=2d keeps the Canvas renderer reachable as a fallback.
    const rendererParam = typeof location !== "undefined" ? new URLSearchParams(location.search).get("renderer") : null;
    this.glMode = rendererParam !== "2d";
    const glBatchParam = typeof location !== "undefined" ? new URLSearchParams(location.search).get("glbatch") : null;
    // The full-scene composite is on by default for every biome.
    //   ?glbatch=0  -> escape hatch, revert to the old presentScene upload for every biome
    //   ?glbatch=probe -> measurement-only: batch tiles but keep presentScene + sceneRT readback
    //   absent / =1 -> composite default
    this.glComposite = glBatchParam !== "0" && glBatchParam !== "probe";
    this.glBatch = this.glComposite || glBatchParam === "probe";
    if (this.glMode) {
      this.sceneCanvas = document.createElement("canvas");
      this.sceneCanvas.width = iw;
      this.sceneCanvas.height = ih;
    }
    this.g = ctx2d(this.glMode ? (this.sceneCanvas as HTMLCanvasElement) : game);
    this.g.scale(PIXEL_SCALE, PIXEL_SCALE);
    this.o = ctx2d(overlay);
    this.g.imageSmoothingEnabled = false;
    this.o.imageSmoothingEnabled = false;
    if (!this.glMode) {
      const canvas = document.createElement("canvas");
      canvas.width = iw;
      canvas.height = ih;
      const context = ctx2d(canvas);
      context.scale(PIXEL_SCALE, PIXEL_SCALE);
      context.imageSmoothingEnabled = false;

      const half = document.createElement("canvas");
      half.width = Math.floor(iw / 2);
      half.height = Math.floor(ih / 2);
      const halfContext = ctx2d(half);
      halfContext.imageSmoothingEnabled = true;
      this.glow = { canvas, context, half, halfContext };
    }

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
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H,
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
      if (key.startsWith("playerpart_") || key.startsWith("weapon_")) {
        this.white[key] = tinted(sprites[key].c, P.FLASH);
      }
      if (key.startsWith("enemy")) {
        this.white[key] = tinted(sprites[key].c, P.FLASH);
        this.statusSprites[key] = [P.ELEMENT.burn, P.ELEMENT.wet, P.ELEMENT.shock].map(color => tinted(sprites[key].c, color));
        this.shadowSprites[key] = tinted(sprites[key].c, P.VOID);
        this.eliteSprites[key] = tinted(sprites[key].c, "#ffd166");
      }
      if (key.startsWith("npc_")) this.shadowSprites[key] = tinted(sprites[key].c, P.VOID);
    }
    this.tileOf[TILE.FLOOR] = sprites.floor;
    this.tileOf[TILE.ACCENT] = sprites.accent;
    this.tileOf[TILE.WALL] = sprites.wall;
    this.tileOf[TILE.CRATE] = sprites.crate;
    this.tileOf[TILE.DOOR] = sprites.door_locked;
    this.tileOf[TILE.DOOR_OPEN] = sprites.door_open;
    this.tileOf[TILE.TRAP] = sprites.trap;
    this.tileOf[TILE.TRAP_ARMED] = sprites.trap_spent;
    this.tileOf[TILE.GRASS] = sprites.grass;
    this.tileOf[TILE.ROAD] = sprites.road;
    this.tileOf[TILE.FLOOR_WOOD] = sprites.floor_wood;
    this.tileOf[TILE.DOOR_TOWN] = sprites.door_wood;
    this.tileOf[TILE.FENCE] = sprites.fence;
    for (const id of ["dungeon", "caverns", "forge", "void"] as const) {
      this.biomeTileOf[id] = {
        ...this.tileOf,
        [TILE.FLOOR]: sprites[`floor_${id}`] ?? sprites.floor,
        [TILE.ACCENT]: sprites[`accent_${id}`] ?? sprites.accent,
        [TILE.WALL]: sprites[`wall_${id}`] ?? sprites.wall,
      };
    }
    /** the market keeps its own plaster walls; the town biome id has no dungeon tile art behind it */
    this.biomeTileOf["town"] = { ...this.tileOf, [TILE.WALL]: sprites.wall_town };

    if (this.glMode) {
      // acquiring WebGL2 on `game` is only safe here: in 2D mode `game` holds a 2D context,
      // and the two contexts are mutually exclusive on one canvas.
      this.gl = new GLPipeline(game, iw, ih, sprites, this.anims);
      this.gl.batchTiles = this.glBatch;
    }
  }

  resize(): void {
    const axes = fitAxes(window.innerWidth, window.innerHeight, isRotated());
    const fit = Math.min(axes.w / VIEW_W, axes.h / VIEW_H);
    const floor = Math.floor(fit);
    this.scale = Math.max(CONFIG.WORLD.MIN_SCALE, Number.isFinite(floor) && floor > 0 ? floor : CONFIG.WORLD.MIN_SCALE);
    const w = VIEW_W * this.scale;
    const h = VIEW_H * this.scale;
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
    const sx = ((clientX - r.left) / r.width) * VIEW_W;
    const sy = ((clientY - r.top) / r.height) * VIEW_H;
    return { x: sx + this.origin.x, y: sy + this.origin.y };
  }

  get fxInfo(): { arcs: number; flashes: number; vignette: number; shake: number } {
    return { arcs: this.fx.arcCount, flashes: this.flash.size, vignette: this.vignette, shake: this.cam.shakeMag };
  }

  consume(events: VisualEvent[]): void {
    this.fx.consume(events);
    for (const e of events) {
      if (e.t === "shake") this.cam.addShake(e.mag, e.dir);
      else if (e.t === "flash") this.flash.set(e.ent, e.ticks);
      else if (e.t === "hurtVignette") this.vignette = Math.min(CONFIG.READABILITY.VIGNETTE_MAX, e.strength);
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
      else if (e.t === "humanityShift") {
        const erosion = humanityErosion(e.humanity);
        const count = Math.round(
          CONFIG.LAWS.HUMANITY_PARTICLE_MIN +
          erosion * (CONFIG.LAWS.HUMANITY_PARTICLE_MAX - CONFIG.LAWS.HUMANITY_PARTICLE_MIN),
        );
        const color = e.humanity <= CONFIG.LAWS.HUMANITY_LOW_THRESHOLD ? "#8f63ae" : "#8fe8ff";
        this.world.particles.burstBubble(e.x, e.y - 8, count, color);
      }
      else if (e.t === "hitImpact") this.impactTicks = CONFIG.FEEL.IMPACT_TICKS;
    }
  }

  private stepVisual(dtReal: number): void {
    const ticks = dtReal * CONFIG.TIME.TICK_HZ;
    this.visualTime += dtReal;
    this.updateCape(dtReal);
    this.fx.step(dtReal);
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
    this.lastFlags = flags;
    this.drawImageCount = 0;
    this.tileBatchCount = 0;
    this.presentUploads = 0;
    this.stepVisual(dtReal);
    const g = this.g;
    const w = this.world;
    this.origin = this.cam.origin(w.room);
    const ox = this.origin.x;
    const oy = this.origin.y;

    // The full WebGL path handles every biome; the post shader replaces the old 2D distortion pass.
    const biomeId = w.currentBiome.id;
    const composite = this.glComposite && this.gl !== null;
    const wantBatch = this.glBatch;
    if (this.gl) this.gl.batchTiles = wantBatch;
    this.glWorldBatch = composite;

    if (composite) {
      // Transparent overlay base: the opaque outside color and tiles come from sceneRT (GPU),
      // not this canvas. Clear the whole device surface, then restore the scaled base transform.
      const dev = g.canvas;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, dev.width, dev.height);
      g.restore();
    } else {
      g.fillStyle = this.world.currentBiome.palette.outside;
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      this.drawParallax(g);
    }

    // Apply the kill-cam to the complete canvas scene before GL post-processing.
    const iw = VIEW_W;
    const ih = VIEW_H;
    const impactFlash = this.impactTicks === CONFIG.FEEL.IMPACT_TICKS;
    g.save();
    if (this.impactTicks > 0 && !composite) {
      if (impactFlash) g.filter = `saturate(${CONFIG.FEEL.IMPACT_SATURATE})`;
      g.translate(iw / 2, ih / 2);
      g.scale(CONFIG.FEEL.IMPACT_ZOOM, CONFIG.FEEL.IMPACT_ZOOM);
      g.translate(-iw / 2, -ih / 2);
    }

    if (this.gl?.batchTiles) {
      this.gl.beginTileBatch(rgbTuple(this.world.currentBiome.palette.outside));
      if (this.glWorldBatch) this.drawParallaxBatch();
    }
    this.drawTiles(g, ox, oy);
    this.drawRoomFeature(g, ox, oy);
    this.drawBossIntroCracks(g, ox, oy);
    this.drawDecals(g, ox, oy);
    this.drawTorches(g, ox, oy, false);
    for (const trail of w.fireTrails) for (const p of trail.points) {
      const x = Math.round(p.x - ox), y = Math.round(p.y - oy);
      if (this.glWorldBatch) {
        this.queueRect(x - 6, y - 6, 12, 12, "#d84b20", Math.min(0.45, p.ticks / 60));
        this.queueRect(x - 1, y - 2 - (p.ticks % 3), 2, 4, "#ffc35a", Math.min(1, p.ticks / 15));
        continue;
      }
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
    this.drawForeground(g, ox, oy);

    // --- Glow Bloom Pass (canvas 2D only; in GL mode the bloom post chain replaces it) ---
    if (this.glow !== null) {
      const hw = Math.floor(iw / 2);
      const hh = Math.floor(ih / 2);
      const { canvas, context: gg, half, halfContext: hg } = this.glow;
      gg.clearRect(0, 0, iw, ih);

      // Render bright FX onto isolated glow canvas
      this.fx.drawArcs(gg, ox, oy, true);
      this.fx.drawSlices(gg, ox, oy, true);
      this.fx.drawBeams(gg, ox, oy, true);
      this.drawProjectileTrails(gg, ox, oy, true);
      this.drawProjectiles(gg, ox, oy, true);
      this.drawTelegraphs(gg, ox, oy, true);
      this.drawTorches(gg, ox, oy, true);
      // Fake gaussian blur via downscale -> upscale
      hg.clearRect(0, 0, hw, hh);
      hg.drawImage(canvas, 0, 0, hw, hh);

      // Composite bloom softly with additive blend
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.85;
      g.drawImage(half, 0, 0, iw, ih);
      g.restore();
    }

    // Sharp pixel-crisp foreground layer on main canvas
    if (this.glWorldBatch && this.gl) this.fx.drawArcsBatch(this.gl.batch, ox, oy, PIXEL_SCALE);
    else this.fx.drawArcs(g, ox, oy, false);
    if (this.glWorldBatch && this.gl) {
      this.fx.drawSlicesBatch(this.gl.batch, ox, oy, PIXEL_SCALE);
      this.fx.drawBeamsBatch(this.gl.batch, ox, oy, PIXEL_SCALE);
    } else {
      this.fx.drawSlices(g, ox, oy, false);
      this.fx.drawBeams(g, ox, oy, false);
    }
    this.drawProjectileTrails(g, ox, oy, false);
    this.drawProjectiles(g, ox, oy, false);

    if (!this.glWorldBatch) this.drawParticles(g, ox, oy);
    this.fx.drawTexts(g, ox, oy);
    this.drawAmbient(g, ox, oy);
    this.drawFog(g, dtReal);
    if (!composite) {
      // Biome colour grade via the 2D "color" op — the composite path folds it into POST_FS instead.
      g.save();
      g.globalCompositeOperation = "color";
      g.globalAlpha = 0.15;
      g.fillStyle = w.currentBiome.palette.grade;
      g.fillRect(0, 0, iw, ih);
      g.restore();
    }

    g.restore();
    g.filter = "none";
    if (impactFlash) {
      g.globalAlpha = CONFIG.FEEL.IMPACT_FLASH_ALPHA;
      g.fillStyle = P.VIGNETTE_HURT;
      g.fillRect(0, 0, iw, ih);
      g.globalAlpha = 1;
    }

    this.drawTransition(g);
    this.drawVignette(g, flags, false); // D7: Cho phép render viền đỏ hurt vignette và boss intro flash cả ở GL
    if (!composite) this.applyBiomeDistortion(g);

    // Probe-only: flush the GPU tile batch into sceneRT and read it back BEFORE presentScene
    // re-uploads the 2D canvas over sceneRT, so glSceneRTMean() reports the batched tiles.
    // (Composite mode flushes tiles inside the present step below instead.)
    if (this.gl?.batchTiles && !composite) {
      this.gl.flushTileBatch();
      const buf = this.gl.exportSceneRT();
      if (buf !== null) {
        let sum = 0;
        for (let i = 0; i < buf.length; i += 4) sum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        this.probeTilesMean = sum / (buf.length / 4);
      }
    }

    // Only the remaining Canvas-only effects and text require a CPU overlay upload.
    this.overlayDirty =
      this.fx.hasCanvasOverlay ||
      w.enemies.some((en) => en.state === ENEMY_STATE.TELEGRAPH && en.kind === "boss") ||
      this.transTicks > 0 ||
      this.kingCine > 0 ||
      this.vignette > 0.001 ||
      (flags.hitStop && w.hitStopTicks > 0) ||
      impactFlash;

    if (this.gl && this.sceneCanvas) {
      const { lights, cols, count } = this.gatherLights(ox, oy);
      const lit = CONFIG.SLIDERS.lighting;
      const base = CONFIG.LIGHTING.AMBIENT[w.currentBiome.id] ?? CONFIG.LIGHTING.AMBIENT_DEFAULT;
      const fogColor = colorTuple(w.currentBiome.palette.fog);
      const params = {
        hurt: this.vignette,
        vignette: 0,
        brightness: CONFIG.SLIDERS.brightness,
        bloom: CONFIG.SLIDERS.bloom,
        crt: CONFIG.SLIDERS.crt,
        ripple: CONFIG.SLIDERS.ripple,
        time: this.visualTime,
        lights,
        cols,
        lightCount: count,
        ambient: 1 + (base - 1) * lit,
        biomeDistortion: biomeId === "forge" ? 1 as const : biomeId === "caverns" ? 2 as const : biomeId === "void" ? 3 as const : 0 as const,
        fogColor: [fogColor[0], fogColor[1], fogColor[2]] as const,
        fogAmount: biomeId === "dungeon" || biomeId === "town"
          ? 0
          : (biomeId === "void" ? 0.1 : 0.14) * fogColor[3],
        fogTime: this.fogPhase,
      };
      if (composite) {
        this.gl.flushTileBatch(); // GPU tiles -> sceneRT (opaque)
        this.gl.presentComposited(this.sceneCanvas, {
          ...params,
          grade: rgbTuple(w.currentBiome.palette.grade),
          gradeAmt: 0.15, // matches the 2D "color" grade alpha this path replaces
          saturate: impactFlash ? CONFIG.FEEL.IMPACT_SATURATE : 1,
          zoom: this.impactTicks > 0 ? CONFIG.FEEL.IMPACT_ZOOM : 1,
          overlayDirty: this.overlayDirty,
        });
        if (this.overlayDirty) this.presentUploads++;
      } else {
        this.gl.presentScene(this.sceneCanvas, params);
        this.presentUploads++;
      }
    }
  }

  private drawBossIntroCracks(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.kingCine <= 0 || this.kingCineTotal !== 120) return;
    const progress = 1 - this.kingCine / this.kingCineTotal;
    const radius = Math.floor(progress * 28);
    const cx = Math.round(this.bossCineX - ox);
    const cy = Math.round(this.bossCineY - oy);
    if (this.glWorldBatch) {
      for (let ray = 0; ray < 8; ray++) {
        const angle = ray * Math.PI / 4;
        for (let distance = 4; distance < radius; distance += 3) {
          const wobble = Math.round(Math.sin(distance * 0.7 + ray) * 1.5);
          const x = Math.round(cx + Math.cos(angle) * distance + wobble);
          const y = Math.round(cy + Math.sin(angle) * distance);
          this.queueRect(x, y, 2, 1, "#ff6b45", Math.min(0.7, (1 - progress) * 0.8) * 0.65);
        }
      }
      return;
    }
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

  private applyBiomeDistortion(g: CanvasRenderingContext2D): void {
    const biome = this.world.currentBiome.id;
    if (biome === "dungeon" || biome === "town") return;
    const iw = this.g.canvas.width;
    const ih = this.g.canvas.height;
    this.frameG.clearRect(0, 0, iw, ih);
    // Snapshot the scene we just drew into `g`'s canvas. In GL mode `g` is the offscreen
    // sceneCanvas and `this.game` is the composited GL output — reading this.game here would
    // feed the post-processed frame back as the scene, discarding the world and compounding
    // bloom each frame (black ghost on software GL, blown-out white on real GPUs).
    this.frameG.drawImage(this.g.canvas, 0, 0);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, iw, ih);

    if (biome === "forge") {
      g.fillStyle = this.world.currentBiome.palette.outside;
      g.fillRect(0, 0, iw, ih);
      for (let y = 0; y < ih; y += Math.round(2 * PIXEL_SCALE)) {
        const h = Math.min(Math.round(2 * PIXEL_SCALE), ih - y);
        const offset = Math.round(Math.sin((y / PIXEL_SCALE) * 0.3 + this.visualTime * 2.2) * 1.5 * PIXEL_SCALE);
        if (offset > 0) {
          g.drawImage(this.frameCanvas, 0, y, iw - offset, h, offset, y, iw - offset, h);
          g.drawImage(this.frameCanvas, 0, y, 1, h, 0, y, offset, h);
        } else if (offset < 0) {
          const shift = -offset;
          g.drawImage(this.frameCanvas, shift, y, iw - shift, h, 0, y, iw - shift, h);
          g.drawImage(this.frameCanvas, iw - 1, y, 1, h, iw - shift, y, shift, h);
        } else g.drawImage(this.frameCanvas, 0, y, iw, h, 0, y, iw, h);
      }
      g.restore();
      return;
    }

    g.drawImage(this.frameCanvas, 0, 0);
    if (biome === "caverns") {
      const edge = Math.round(4 * PIXEL_SCALE);
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
    g.drawImage(this.redCanvas, -PIXEL_SCALE, 0);
    g.drawImage(this.blueCanvas, PIXEL_SCALE, 0);
    g.restore();
    g.restore();
  }

  /** iris wipe: black closes over the door point, then opens onto the new room */
  private drawTransition(g: CanvasRenderingContext2D): void {
    if (this.transTicks <= 0) return;
    const total = CONFIG.FEEL.ROOM_TRANSITION_TICKS;
    const p = 1 - this.transTicks / total;
    const iw = VIEW_W;
    const ih = VIEW_H;
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
      if (x < -8 || y < -8 || x > VIEW_W + 8 || y > VIEW_H + 8) continue;
      // floor stains only — walls and crates stay clean
      const tile = room.at(Math.floor(d.x / T), Math.floor(d.y / T));
      if (tile !== TILE.FLOOR && tile !== TILE.ACCENT) continue;
      if (this.glWorldBatch) {
        for (const s of d.spots) {
          this.queueRect(x + Math.round(s.dx), y + Math.round(s.dy), s.s, s.s, d.color, 0.55);
        }
        continue;
      }
      g.globalAlpha = 0.55;
      g.fillStyle = d.color;
      for (const s of d.spots) {
        g.fillRect(x + Math.round(s.dx), y + Math.round(s.dy), s.s, s.s);
      }
    }

    // Vũng máu người chơi lớn dần dưới đất khi chết
    const pl = this.world.player;
    if (pl.dead && pl.deadTicks > 0) {
      const px = Math.round(pl.x - ox);
      const py = Math.round(pl.y - 2 - oy);
      const t = Math.min(24, pl.deadTicks);
      const radius = Math.min(12, Math.floor(2 + t * 0.45));
      if (this.glWorldBatch) {
        for (let dy = -radius; dy <= radius; dy++) {
          const span = Math.floor(radius * Math.sqrt(Math.max(0, 1 - (dy * dy) / (radius * radius))));
          this.queueRect(px - span, py + dy, span * 2 + 1, 1, "#8a0303", Math.min(0.85, 0.3 + t * 0.03));
          const innerRadius = Math.floor(radius * 0.6);
          const innerSpan = Math.floor(innerRadius * Math.sqrt(Math.max(0, 1 - (dy * dy) / Math.max(1, innerRadius * innerRadius))));
          if (Math.abs(dy) <= innerRadius) this.queueRect(px - innerSpan, py + dy, innerSpan * 2 + 1, 1, "#5c0000", Math.min(0.85, 0.3 + t * 0.03));
        }
        return;
      }
      g.save();
      g.fillStyle = "#8a0303";
      g.globalAlpha = Math.min(0.85, 0.3 + t * 0.03);
      g.beginPath();
      g.ellipse(px, py, radius, Math.max(2, Math.floor(radius * 0.55)), 0, 0, Math.PI * 2);
      g.fill();
      // Vệt máu đậm ở tâm
      g.fillStyle = "#5c0000";
      g.beginPath();
      g.ellipse(px, py, Math.floor(radius * 0.6), Math.max(1, Math.floor(radius * 0.35)), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
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

  private queueSprite(
    sp: Sprite | HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: readonly [number, number, number, number] = TINT_OPAQUE,
    rot = 0,
    flash = 0,
    additive = false,
    flipX = false,
  ): void {
    if (!this.gl) return;
    const canvas = "c" in sp ? sp.c : sp;
    this.gl.batch.drawSprite(
      canvas,
      Math.round(x * PIXEL_SCALE),
      Math.round(y * PIXEL_SCALE),
      Math.round(w * PIXEL_SCALE),
      Math.round(h * PIXEL_SCALE),
      tint,
      rot,
      flash,
      additive,
      flipX,
    );
  }

  private queueRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    alpha = 1,
    additive = false,
    rot = 0,
  ): void {
    if (!this.gl) return;
    this.gl.batch.drawSolidRect(
      Math.round(x * PIXEL_SCALE),
      Math.round(y * PIXEL_SCALE),
      Math.max(1, Math.round(w * PIXEL_SCALE)),
      Math.max(1, Math.round(h * PIXEL_SCALE)),
      colorTuple(color, alpha),
      additive,
      rot,
    );
  }

  private queueDisc(cx: number, cy: number, radius: number, color: string, alpha: number): void {
    const r = Math.max(1, Math.ceil(radius));
    for (let y = -r; y <= r; y += 2) {
      const span = Math.floor(r * Math.sqrt(Math.max(0, 1 - (y * y) / (r * r))));
      this.queueRect(cx - span, cy + y, span * 2 + 1, 2, color, alpha);
    }
  }

  private queueRing(cx: number, cy: number, radius: number, color: string, alpha: number, thickness = 1): void {
    if (radius <= 0) return;
    const segments = Math.max(16, Math.ceil(radius * Math.PI / 3));
    const step = (Math.PI * 2) / segments;
    const width = Math.max(1, radius * step * 1.4);
    for (let i = 0; i < segments; i++) {
      const angle = (i + 0.5) * step;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      this.queueRect(x - width * 0.5, y - thickness * 0.5, width, thickness, color, alpha, false, angle + Math.PI / 2);
    }
  }

  private queueWedge(cx: number, cy: number, dir: number, reach: number, deg: number, innerRatio: number, color: string, alpha: number): void {
    const half = deg * Math.PI / 360;
    const steps = Math.max(8, Math.ceil(deg / 6));
    const step = (half * 2) / steps;
    const inner = reach * innerRatio;
    const radius = (reach + inner) * 0.5;
    const height = Math.max(1, reach - inner);
    const width = Math.max(1, radius * step * 1.3);
    for (let i = 0; i < steps; i++) {
      const angle = dir - half + (i + 0.5) * step;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      this.queueRect(x - width * 0.5, y - height * 0.5, width, height, color, alpha, false, angle + Math.PI / 2);
    }
  }

  private drawParallaxBatch(): void {
    const iw = VIEW_W;
    const ih = VIEW_H;
    const biome = this.world.currentBiome.id;
    for (const [layer, speed] of [["far", 0.15], ["mid", 0.4], ["near", 0.7]] as const) {
      const bg = this.sprites[`parallax_${biome}_${layer}`];
      if (bg === undefined) continue;
      const px = Math.round(-this.origin.x * speed) % iw;
      const py = Math.round(-this.origin.y * speed) % ih;
      for (let kx = -1; kx <= 1; kx++) {
        for (let ky = -1; ky <= 1; ky++) {
          this.queueSprite(bg, px + kx * iw, py + ky * ih, iw, ih);
        }
      }
    }
  }

  /** Three transparent depth planes, each with a distinct camera parallax rate. */
  private drawParallax(g: CanvasRenderingContext2D): void {
    const iw = VIEW_W;
    const ih = VIEW_H;
    const biome = this.world.currentBiome.id;
    for (const [layer, speed] of [["far", 0.15], ["mid", 0.4], ["near", 0.7]] as const) {
      const bg = this.sprites[`parallax_${biome}_${layer}`];
      if (bg === undefined) continue;
      const px = Math.round(-this.origin.x * speed) % iw;
      const py = Math.round(-this.origin.y * speed) % ih;
      g.save();
      g.imageSmoothingEnabled = true;
      if (layer === "far") g.filter = "blur(0.5px)";
      for (let kx = -1; kx <= 1; kx++) {
        for (let ky = -1; ky <= 1; ky++) {
          g.drawImage(bg.c, px + kx * iw, py + ky * ih, iw, ih);
        }
      }
      g.restore();
    }
  }

  /** sparse edge details pass in front of y-sorted actors */
  private drawForeground(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const fg = this.sprites[`foreground_${this.world.currentBiome.id}`];
    if (fg === undefined) return;
    const iw = VIEW_W;
    const ih = VIEW_H;
    const px = Math.round(-ox) % iw;
    const py = Math.round(-oy) % ih;
    if (this.glWorldBatch) {
      for (let kx = -1; kx <= 1; kx++) {
        for (let ky = -1; ky <= 1; ky++) {
          this.queueSprite(fg, px + kx * iw, py + ky * ih, iw, ih);
        }
      }
      return;
    }
    g.save();
    for (let kx = -1; kx <= 1; kx++) {
      for (let ky = -1; ky <= 1; ky++) {
        g.drawImage(fg.c, px + kx * iw, py + ky * ih, iw, ih);
      }
    }
    g.restore();
  }

  /** wall torches: sprite + additive glow */
  private drawTorches(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    const torches = this.world.room.torches;
    if (torches.length === 0) return;
    const now = this.visualTime * 1000;
    const iw = VIEW_W;
    const ih = VIEW_H;
    g.globalCompositeOperation = "lighter";
    for (const t of torches) {
      const x = Math.round(t.x - ox) - 2;
      const y = Math.round(t.y - oy) - 7;
      if (x < -8 || y < -12 || x > iw || y > ih) continue;
      const frame = Math.floor(now / CONFIG.RENDER.TORCH_FRAME_MS + t.phase) % 2 === 0 ? this.sprites.torch : this.sprites.torch_flicker;
      if (frame === undefined) continue;
      if (this.glWorldBatch) {
        if (glowOnly) {
          const pulse = 1 + CONFIG.RENDER.TORCH_PULSE * Math.sin(now * CONFIG.RENDER.TORCH_FLICKER + t.phase);
          this.queueRect(x - 2, y - 2, 9 * pulse, 10 * pulse, "#ff963f", 0.5, true);
        } else {
          this.queueSprite(frame, x, y, frame.w, frame.h, TINT_OPAQUE, 0, 0, true);
        }
        continue;
      }
      if (glowOnly) {
        // bloom: a soft flame halo that breathes with the flicker
        const pulse = 1 + CONFIG.RENDER.TORCH_PULSE * Math.sin(now * CONFIG.RENDER.TORCH_FLICKER + t.phase);
        g.globalAlpha = 0.5;
        g.fillStyle = "#ff963f";
        g.fillRect(x - 2, y - 2, 9 * pulse, 10 * pulse);
      } else {
        g.drawImage(frame.c, x, y, frame.w, frame.h);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /** biome fog: blobs baked at half logical viewport resolution and composited with the scene */
  private drawFog(g: CanvasRenderingContext2D, dtReal: number): void {
    const biome = this.world.currentBiome;
    if (biome.id === "dungeon" || biome.id === "town") return;
    this.fogPhase += dtReal * 0.15;
    const iw = VIEW_W;
    const ih = VIEW_H;
    const fw = 160;
    const fh = 90;
    if (this.glWorldBatch) return;
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
    if (biome.id === "dungeon" || biome.id === "town") return;
    const time = this.visualTime;
    const iw = VIEW_W;
    const ih = VIEW_H;
    const drift = time * 14;
    for (let i = 0; i < this.weather.length; i++) {
      const p = this.weather[i];
      if (biome.id === "caverns") {
        // snow: falls with a sideways sine drift
        const x = (p.x + Math.sin(time * 1.4 + p.phase) * 8) % iw;
        const y = (p.y + drift * p.v) % ih;
        const alpha = 0.5;
        const color = i % 5 === 0 ? "#ffffff" : "#bfe4ff";
        if (this.glWorldBatch) this.queueRect(Math.floor(x), Math.floor(y), 1, i % 7 === 0 ? 2 : 1, color, alpha);
        else {
          g.globalAlpha = alpha;
          g.fillStyle = color;
          g.fillRect(Math.floor(x), Math.floor(y), 1, i % 7 === 0 ? 2 : 1);
        }
      } else if (biome.id === "forge") {
        // ash rises, embers climb faster and glow
        const x = (p.x + Math.sin(time * 0.9 + p.phase) * 5) % iw;
        const y = (p.y - drift * p.v) % ih;
        const ember = i % 6 === 0;
        const alpha = ember ? 0.85 : 0.35;
        const color = ember ? "#ff963f" : "#8a6a55";
        if (this.glWorldBatch) this.queueRect(Math.floor(x), Math.floor((y + ih) % ih), ember ? 2 : 1, ember ? 2 : 1, color, alpha);
        else {
          g.globalAlpha = alpha;
          g.fillStyle = color;
          g.fillRect(Math.floor(x), Math.floor((y + ih) % ih), ember ? 2 : 1, ember ? 2 : 1);
        }
      } else if (biome.id === "void") {
        // crystals drift almost still; stars twinkle in place
        const x = (p.x + Math.sin(time * 0.4 + p.phase) * 4 + iw) % iw;
        const y = (p.y + Math.cos(time * 0.3 + p.phase) * 3 + ih) % ih;
        if (i % 4 === 0) {
          const alpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(time * 2.2 + p.phase * 3));
          if (this.glWorldBatch) this.queueRect(Math.floor(x), Math.floor(y), 1, 1, "#e6d4ff", alpha);
          else {
            g.globalAlpha = alpha;
            g.fillStyle = "#e6d4ff";
            g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
          }
        } else {
          if (this.glWorldBatch) this.queueRect(Math.floor(x), Math.floor(y), 1, 2, "#8a4fbf", 0.3);
          else {
            g.globalAlpha = 0.3;
            g.fillStyle = "#8a4fbf";
            g.fillRect(Math.floor(x), Math.floor(y), 1, 2);
          }
        }
      } else {
        return; // dungeon: no weather
      }
    }
    g.globalAlpha = 1;
  }

  /** tiles-batch probe: mean luminance of the last sceneRT tile flush (0 outside probe mode) */
  glSceneRTMean(): number {
    return this.probeTilesMean;
  }

  /** last frame's render counters, for the measurement harness (drawImage vs tile-batch) */
  stats(): { drawImage: number; tileBatch: number; uploads: number; overlayDirty: boolean } {
    return {
      drawImage: this.drawImageCount,
      tileBatch: this.tileBatchCount,
      uploads: this.presentUploads,
      overlayDirty: this.overlayDirty,
    };
  }

  /** Re-render the current frame n times (no sim advance) to average CPU draw cost. */
  profileFrames(n: number): { cpuMsPerFrame: number; drawImagePerFrame: number; tileBatchPerFrame: number; uploadsPerFrame: number } {
    let diSum = 0, tbSum = 0, upSum = 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.draw(1 / 60, this.lastFlags);
      diSum += this.drawImageCount;
      tbSum += this.tileBatchCount;
      upSum += this.presentUploads;
    }
    const cpuMsPerFrame = (performance.now() - t0) / n;
    return {
      cpuMsPerFrame,
      drawImagePerFrame: diSum / n,
      tileBatchPerFrame: tbSum / n,
      uploadsPerFrame: upSum / n,
    };
  }

  /** radial emitters for the GL light map: torches, player, fire projectiles, burning enemies */
  private gatherLights(ox: number, oy: number): { lights: Float32Array; cols: Float32Array; count: number } {
    const L = CONFIG.LIGHTING;
    const lit = CONFIG.SLIDERS.lighting;
    const lights = new Float32Array(L.MAX * 4);
    const cols = new Float32Array(L.MAX * 3);
    let n = 0;
    const add = (x: number, y: number, r: number, i: number, c: number[]): void => {
      if (n >= L.MAX) return;
      lights.set([x - ox, y - oy, r, i * lit], n * 4);
      cols.set(c, n * 3);
      n++;
    };
    const now = this.visualTime * 1000;
    for (const t of this.world.room.torches) {
      const pulse = 1 + CONFIG.RENDER.TORCH_PULSE * Math.sin(now * CONFIG.RENDER.TORCH_FLICKER + t.phase);
      add(t.x, t.y - 4, L.TORCH.r, L.TORCH.intensity * pulse, L.TORCH.color);
    }
    const pl = this.world.player;
    add(pl.x, pl.y - 6, L.PLAYER.r, L.PLAYER.intensity, L.PLAYER.color);
    for (const p of this.world.projectiles) {
      if (p.kind === "fireball" || p.kind === "lava") add(p.x, p.y, L.FIRE.r, L.FIRE.intensity, L.FIRE.color);
    }
    for (const en of this.world.enemies) {
      if (!en.removed && en.burnTicks > 0) add(en.x, en.y - 6, L.BURN.r, L.BURN.intensity, L.BURN.color);
    }
    return { lights, cols, count: n };
  }

  private drawAmbient(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const pl = this.world.player;
    const px = Math.round(pl.x - ox);
    const py = Math.round(pl.y - 7 - oy);
    const iw = VIEW_W;
    const ih = VIEW_H;
    const biome = this.world.currentBiome;

    if (biome.id !== "dungeon" && this.gl === null) {
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
      if (this.glWorldBatch) {
        this.queueRect(Math.floor(x), Math.floor(y), size, size, biome.palette.particle, alpha);
        continue;
      }
      g.globalAlpha = alpha;
      g.fillStyle = biome.palette.particle;
      g.fillRect(Math.floor(x), Math.floor(y), size, size);
    }
    g.globalAlpha = 1;
    this.drawWeather(g);
  }

  /** furniture and NPCs inside a house stay under its roof until the player peels it by approaching */
  private coveredByRoof(px: number, py: number): boolean {
    if (this.world.room.kind !== "town") return false;
    const T = CONFIG.WORLD.TILE;
    const fp = townFootprintAt(Math.floor(px / T), Math.floor(py / T));
    return fp !== null && fp.id !== (this.world.activeHouse?.id ?? null);
  }

  private drawTiles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const T = CONFIG.WORLD.TILE;
    const room = this.world.room;
    const x0 = Math.max(0, Math.floor(ox / T));
    const y0 = Math.max(0, Math.floor(oy / T));
    const x1 = Math.min(room.w - 1, Math.ceil((ox + VIEW_W) / T));
    const y1 = Math.min(room.h - 1, Math.ceil((oy + VIEW_H) / T));
    const biomeTiles = this.biomeTileOf[this.world.currentBiome.id] ?? this.tileOf;
    const gl = this.gl;
    const batching = gl !== null && gl.batchTiles;
    const town = room.kind === "town";
    const activeId = this.world.activeHouse?.id ?? null;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        /** a roofed-over house draws nothing here: the roof quad below replaces the whole footprint */
        if (town) {
          const fp = townFootprintAt(tx, ty);
          if (fp !== null && fp.id !== activeId) continue;
        }
        const s = biomeTiles[room.at(tx, ty)] ?? biomeTiles[TILE.FLOOR] ?? this.tileOf[TILE.FLOOR];
        const lx = Math.round(tx * T - ox), ly = Math.round(ty * T - oy);
        if (batching && gl !== null) {
          gl.batch.drawSprite(s.c, Math.round(lx * PIXEL_SCALE), Math.round(ly * PIXEL_SCALE),
            Math.round(s.w * PIXEL_SCALE), Math.round(s.h * PIXEL_SCALE), TINT_OPAQUE);
          this.tileBatchCount++;
        } else {
          g.drawImage(s.c, lx, ly, s.w, s.h);
          this.drawImageCount++;
        }
      }
    }

    if (town) {
      for (const fp of TOWN_FOOTPRINTS) {
        if (fp.id === activeId) continue;
        const s = this.sprites[`roof_${fp.id}`];
        if (s === undefined) continue;
        const rx = Math.round(fp.tx0 * T - ox), ry = Math.round(fp.ty0 * T - oy);
        if (rx > VIEW_W || ry > VIEW_H || rx + s.w < 0 || ry + s.h < 0) continue;
        if (batching && gl !== null) {
          gl.batch.drawSprite(s.c, Math.round(rx * PIXEL_SCALE), Math.round(ry * PIXEL_SCALE),
            Math.round(s.w * PIXEL_SCALE), Math.round(s.h * PIXEL_SCALE), TINT_OPAQUE);
          this.tileBatchCount++;
        } else {
          g.drawImage(s.c, rx, ry, s.w, s.h);
          this.drawImageCount++;
        }
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
          const fx = Math.round(tx * T - ox), fy = Math.round((ty + 1) * T - FACE_H - oy);
          if (batching && gl !== null) {
            gl.batch.drawSprite(face.c, Math.round(fx * PIXEL_SCALE), Math.round(fy * PIXEL_SCALE),
              Math.round(face.w * PIXEL_SCALE), Math.round(face.h * PIXEL_SCALE), TINT_OPAQUE);
            this.tileBatchCount++;
          } else {
            g.drawImage(face.c, fx, fy, face.w, face.h);
            this.drawImageCount++;
          }
        }
      }

      const ps = PIXEL_SCALE;
      const dh = Math.max(1, Math.round(1 * ps));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const tile = room.at(tx, ty);
          if (tile !== TILE.WALL && tile !== TILE.DOOR && tile !== TILE.CRATE) continue;
          const below = room.at(tx, ty + 1);
          if (below === TILE.WALL || below === TILE.CRATE) continue;
          const lx = tx * T - ox;
          const ly = (ty + 1) * T - oy;
          if (batching && gl !== null) {
            const dx = Math.round(lx * ps), dy1 = Math.round(ly * ps), dy2 = Math.round((ly + 1) * ps);
            const dw = Math.round(T * ps);
            gl.batch.drawSolidRect(dx, dy1, dw, dh, [0, 0, 0, 0.22]);
            gl.batch.drawSolidRect(dx, dy2, dw, dh, [0, 0, 0, 0.1]);
            this.tileBatchCount += 2;
          } else {
            const x = Math.round(lx);
            const y = Math.round(ly);
            g.globalAlpha = 0.22;
            g.fillStyle = "#000000";
            g.fillRect(x, y, T, 1);
            g.globalAlpha = 0.1;
            g.fillRect(x, y + 1, T, 1);
          }
        }
      }
      g.globalAlpha = 1;
    }
  }

  private drawRoomFeature(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.world.room.kind !== "treasure") return;
    const x = Math.round(this.world.room.widthPx / 2 - ox);
    const y = Math.round(this.world.room.heightPx / 2 - oy);
    if (this.glWorldBatch) {
      this.queueRect(x - 7, y - 3, 14, 8, "#573716");
      this.queueRect(x - 8, y - 6, 16, 5, "#d99b42");
      this.queueRect(x - 1, y - 4, 2, 4, "#d99b42");
      this.queueRect(x - 6, y - 5, 12, 1, "#f4ce79");
      return;
    }
    g.fillStyle = "#573716";
    g.fillRect(x - 7, y - 3, 14, 8);
    g.fillStyle = "#d99b42";
    g.fillRect(x - 8, y - 6, 16, 5);
    g.fillRect(x - 1, y - 4, 2, 4);
    g.fillStyle = "#f4ce79";
    g.fillRect(x - 6, y - 5, 12, 1);
  }

  private drawTelegraphs(g: CanvasRenderingContext2D, ox: number, oy: number, glowOnly = false): void {
    for (const en of this.world.enemies) {
      if (en.state !== ENEMY_STATE.TELEGRAPH) continue;
      const e = en.def;
      const prog = 1 - en.telegraphTicksLeft / Math.max(1, en.telegraphTotal);
      const cx = Math.round(en.x - ox);
      const cy = Math.round(en.y - e.BODY_H * 0.5 - oy);

      if (this.glWorldBatch && (en.kind === "charger" || en.kind === "sniper")) {
        const reach = en.kind === "charger" ? e.ATTACK_REACH : Math.hypot(this.world.room.widthPx, this.world.room.heightPx);
        const x1 = cx + Math.cos(en.telegraphDir) * reach;
        const y1 = cy + Math.sin(en.telegraphDir) * reach;
        const angle = Math.atan2(y1 - cy, x1 - cx);
        const alpha = en.kind === "charger"
          ? 0.55 + 0.45 * prog
          : 0.35 + 0.65 * prog;
        if (en.kind === "charger") {
          this.queueRect(cx, cy - 2, reach, 4, P.TELEGRAPH_FILL, CONFIG.READABILITY.TELEGRAPH_FILL * alpha, false, en.telegraphDir);
          this.queueRect(cx, cy - 1, reach, 2, P.TELEGRAPH_EDGE, alpha, false, en.telegraphDir);
          const tip = 5;
          this.queueRect(x1 - Math.cos(en.telegraphDir - 0.7) * tip, y1 - Math.sin(en.telegraphDir - 0.7) * tip, tip, 1, P.TELEGRAPH_EDGE, alpha, false, en.telegraphDir + 0.7);
          this.queueRect(x1 - Math.cos(en.telegraphDir + 0.7) * tip, y1 - Math.sin(en.telegraphDir + 0.7) * tip, tip, 1, P.TELEGRAPH_EDGE, alpha, false, en.telegraphDir - 0.7);
        } else {
          this.queueRect(cx, cy - 0.5, reach, 1, P.TELEGRAPH_EDGE, alpha, false, angle);
          this.queueRect(x1 - 2, y1 - 2, 4, 4, P.TELEGRAPH_EDGE, 0.5 + 0.5 * prog, true);
        }
        continue;
      }

      if (this.glWorldBatch) {
        const fillAlpha = CONFIG.READABILITY.TELEGRAPH_FILL * (0.55 + 0.45 * prog);
        const edgeAlpha = 0.55 + 0.45 * prog;
        if (en.kind === "exploder") {
          this.queueDisc(cx, cy, Math.max(1, e.ATTACK_REACH * prog), P.TELEGRAPH_FILL, CONFIG.READABILITY.TELEGRAPH_FILL * (0.5 + 0.5 * prog * prog));
          this.queueRing(cx, cy, e.ATTACK_REACH, P.TELEGRAPH_EDGE, edgeAlpha);
          if (prog > 0.75) this.queueRing(cx, cy, e.ATTACK_REACH * prog * 0.7, "#ffffff", (prog - 0.75) * 4 * 0.8);
        } else if (e.RADIAL || (en.kind === "warden" && en.pattern !== "laser")) {
          this.queueDisc(cx, cy, Math.max(1, e.ATTACK_REACH * prog), P.TELEGRAPH_FILL, fillAlpha);
          this.queueRing(cx, cy, e.ATTACK_REACH, P.TELEGRAPH_EDGE, edgeAlpha);
          if (en.kind === "boss") {
            g.globalAlpha = 0.9;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.font = "bold 7px ui-monospace, monospace";
            const secs = String(Math.ceil(en.telegraphTicksLeft / 60));
            g.fillStyle = P.VOID;
            g.fillText(secs, cx + 1, cy + 1);
            g.fillStyle = "#ffe66b";
            g.fillText(secs, cx, cy);
            g.globalAlpha = 1;
          }
        } else {
          const laser = en.kind === "warden" && en.pattern === "laser";
          const reach = laser ? Math.hypot(this.world.room.widthPx, this.world.room.heightPx) : e.ATTACK_REACH;
          const deg = laser ? 8 : e.ATTACK_ARC_DEG;
          this.queueWedge(cx, cy, en.telegraphDir, reach, deg, 0.1, P.TELEGRAPH_FILL, fillAlpha);
          this.queueRing(cx, cy, reach, P.TELEGRAPH_EDGE, edgeAlpha, 1);
          if (laser) {
            this.queueRect(cx, cy - 1, reach, 2, "#ff5a3c", edgeAlpha, false, en.telegraphDir);
          }
        }
        continue;
      }

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
      wedge(g, cx, cy, en.telegraphDir, reach, deg, 0.1);
      g.fill();

      g.globalAlpha = 0.55 + 0.45 * prog;
      g.strokeStyle = P.TELEGRAPH_EDGE;
      wedge(g, cx, cy, en.telegraphDir, reach, deg, 0.1);
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
      const art = this.artFor(en.def.SPRITE_KEY);
      const sp = art.base;
      const sc = en.isElite ? 1.3 : 1;
      const shadow = art.shadow;
      const x = Math.round(en.x - sp.ax * sc - ox);
      const y = Math.round(en.y - sp.ay * sc - oy);
      const w = Math.round(sp.w * sc);
      const h = Math.round(sp.h * sc);
      if (this.glWorldBatch) {
        this.queueSprite(sp, x, y + 1, w, h, [0, 0, 0, 0.3]);
        this.queueSprite(sp, x, y + 2, w, h, [0, 0, 0, 0.15]);
        continue;
      }
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
    if (this.glWorldBatch) {
      this.queueSprite(sp, x, y + 1, sp.w, sp.h, [0, 0, 0, 0.3]);
      this.queueSprite(sp, x, y + 2, sp.w, sp.h, [0, 0, 0, 0.15]);
      return;
    }
    g.globalAlpha = 0.3;
    g.drawImage(shadow, x, y + 1, sp.w, sp.h);
    g.globalAlpha = 0.15;
    g.drawImage(shadow, x, y + 2, sp.w, sp.h);
    g.globalAlpha = 1;
  }

  /** depth sort: enemies, player, projectiles and particles in one y-sorted draw list.
   *  Floor indicators (telegraphs, arcs, beams) stay below; damage numbers stay above. */
  private drawSortedWorld(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    this.sortCount = 0;
    this.sortList.length = 0;
    for (const prop of this.world.townProps) {
      if (this.coveredByRoof(prop.x, prop.y)) continue;
      const it = this.nextSortItem();
      it.y = prop.y;
      it.kind = SORT_KIND.prop;
      it.ref = prop;
    }
    for (const en of this.world.enemies) {
      if (en.removed) continue;
      const it = this.nextSortItem();
      it.y = en.y;
      it.kind = SORT_KIND.enemy;
      it.ref = en;
    }
    for (const npc of this.world.npcList) {
      if (this.coveredByRoof(npc.x, npc.y)) continue;
      const it = this.nextSortItem();
      it.y = npc.y;
      it.kind = SORT_KIND.npc;
      it.ref = npc;
    }
    {
      const it = this.nextSortItem();
      it.y = this.world.player.y;
      it.kind = SORT_KIND.player;
    }
    for (const p of this.world.projectiles) {
      const it = this.nextSortItem();
      it.y = p.y;
      it.kind = SORT_KIND.projectile;
      it.ref = p;
    }
    if (CONFIG.SLIDERS.particles > 0.01) this.world.particles.visit(this.collectParticle);
    // standing walls/doors occlude entities north of them; face rides along so the redraw doesn't erase it
    const T = CONFIG.WORLD.TILE;
    const room = this.world.room;
    const x0 = Math.max(0, Math.floor(ox / T));
    const y0 = Math.max(0, Math.floor(oy / T));
    const x1 = Math.min(room.w - 1, Math.ceil((ox + VIEW_W) / T));
    const y1 = Math.min(room.h - 1, Math.ceil((oy + VIEW_H) / T));
    const biomeTiles = this.biomeTileOf[this.world.currentBiome.id] ?? this.tileOf;
    const face = this.sprites[`wallface_${this.world.currentBiome.id}`];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = room.at(tx, ty);
        if (t !== TILE.WALL && t !== TILE.DOOR) continue;
        const below = room.at(tx, ty + 1);
        if (below === TILE.WALL || below === TILE.CRATE) continue;
        const sp = biomeTiles[t] ?? this.tileOf[t];
        const it = this.nextSortItem();
        it.y = (ty + 1) * T - 1;
        it.kind = SORT_KIND.wall;
        it.sp = sp;
        it.face = face ?? null;
        it.x = Math.round(tx * T - ox);
        it.sy = Math.round(ty * T - oy);
      }
    }
    const list = this.sortList;
    list.sort((a, b) => a.y - b.y);
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!;
      switch (it.kind) {
        case SORT_KIND.prop:
          this.drawOneProp(g, it.ref as TownProp, ox, oy);
          break;
        case SORT_KIND.enemy:
          this.drawOneEnemy(g, it.ref as Enemy, ox, oy);
          break;
        case SORT_KIND.npc:
          this.drawOneNpc(g, it.ref as Npc, ox, oy);
          break;
        case SORT_KIND.player:
          this.drawPlayer(g, ox, oy);
          break;
        case SORT_KIND.projectile:
          this.drawOneProjectile(g, it.ref as Projectile, ox, oy, false);
          break;
        case SORT_KIND.particle:
          this.drawOneParticle(g, it.ref as Slot, ox, oy, CONFIG.SLIDERS.particles);
          break;
        case SORT_KIND.wall: {
          const sp = it.sp!;
          const wallFace = it.face;
          if (this.glWorldBatch) {
            this.queueSprite(sp, it.x, it.sy, sp.w, sp.h);
            if (wallFace !== null) this.queueSprite(wallFace, it.x, it.sy + T - wallFace.h, wallFace.w, wallFace.h);
          } else {
            g.drawImage(sp.c, it.x, it.sy, sp.w, sp.h);
            if (wallFace !== null) g.drawImage(wallFace.c, it.x, it.sy + T - wallFace.h, wallFace.w, wallFace.h);
          }
          break;
        }
      }
    }
  }

  private drawOneEnemy(g: CanvasRenderingContext2D, en: Enemy, ox: number, oy: number): void {
    const target = this.world.player.autoTargetId;
    if (en.removed) return;
    const art = this.artFor(en.def.SPRITE_KEY);
    const baseSprite = art.base;
    const white = art.white;
    const sc = en.isElite ? 1.3 : 1;

    // --- multi-frame anim + state clips, right-facing mirror ---
    let set = art.idle;
    let phaseFrame: number | null = null;
    let flipX = false;
    if (en.state === ENEMY_STATE.TELEGRAPH) {
      const windup = art.attack;
      if (windup) { set = windup; phaseFrame = 0; }
    } else if (en.state === ENEMY_STATE.ATTACK && en.swing !== null) {
      const atk = art.attack;
      if (atk) { set = atk; phaseFrame = en.swing.phase === "active" ? 1 : 2; }
    } else if (en.state === ENEMY_STATE.APPEAR) {
      const spawn = art.spawn;
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
      flipX = true;
    }
    // death clip: crumble frames advance as the corpse fades out
    if (en.dead) {
      const death = art.death;
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
    const ecx = Math.round(en.x - ox);
    const ecy = Math.round(en.y - oy);
    const flashing = (this.flash.get(en.id) ?? 0) > 0;

    if (this.glWorldBatch) {
      if (en.dead) {
        const total = en.def.CORPSE_TICKS;
        this.queueSprite(sp, x, y + (total - en.corpseTicks), w, h, [1, 1, 1, Math.max(0, en.corpseTicks / total)]);
        return;
      }
      if (en.state === ENEMY_STATE.VANISH) return;
      const appearTicks = en.isElite ? CONFIG.ENEMY.ELITE_SPAWN_TICKS : en.def.APPEAR_TICKS;
      const fade = en.state === ENEMY_STATE.APPEAR && appearTicks > 0
        ? 0.3 + 0.7 * Math.min(1, en.ticksInState / appearTicks)
        : 1;
      const drawX = ecx + (x - ecx) * sx;
      const drawY = ecy + (y - ecy) * sy;
      const drawW = w * sx;
      const drawH = h * sy;
      this.queueSprite(flipX ? baseSprite : sp, drawX, drawY, drawW, drawH, [1, 1, 1, fade], 0, flashing ? 1 : 0, false, flipX);

      const status = en.shockTicks > 0 ? 2 : en.wetTicks > 0 ? 1 : en.burnTicks > 0 ? 0 : -1;
      if (status >= 0 && !flashing) {
        const tint = ["#ff963f", "#58caff", "#ffe66b"][status]!;
        this.queueSprite(flipX ? baseSprite : sp, drawX, drawY, drawW, drawH, colorTuple(tint, 0.55 * fade), 0, 0, false, flipX);
      }
      if (en.isElite) this.queueSprite(flipX ? baseSprite : sp, drawX, drawY, drawW, drawH, colorTuple("#ffd166", 0.22 * fade), 0, 0, false, flipX);
      if (en.shouldBlink()) this.queueSprite(flipX ? baseSprite : sp, drawX, drawY, drawW, drawH, [1, 1, 1, 0.5], 0, 1, false, flipX);

      const active = [en.burnTicks, en.wetTicks, en.shockTicks, en.poisonTicks, en.freezeTicks, en.bleedTicks];
      const icons = ["00100/01101/11111/11111/01110", "00100/00100/01110/11111/01110", "00111/01110/11111/00110/01100", "00100/01110/11111/01110/00100", "10101/01110/11111/01110/10101", "00100/01110/11111/11111/01110"];
      const iconColors = ["#ff963f", "#58caff", "#ffe66b", "#8f63ae", "#a8e8ff", "#c2182b"];
      let iconX = Math.round(en.x - ox - (active.filter(t => t > 0).length * 7 - 2) / 2);
      for (let i = 0; i < active.length; i++) {
        if (active[i] <= 0) continue;
        this.queueRect(iconX - 1, y - 9, 7, 7, P.VOID);
        icons[i]!.split("/").forEach((row, iy) => {
          for (let ix = 0; ix < row.length; ix++) {
            if (row[ix] === "1") this.queueRect(iconX + ix, y - 8 + iy, 1, 1, iconColors[i]!);
          }
        });
        iconX += 7;
      }
      if (en.id === target) {
        this.queueRect(x - 0.5, y - 0.5, sp.w + 1, 1, P.TARGET_RIM);
        this.queueRect(x - 0.5, y + sp.h - 0.5, sp.w + 1, 1, P.TARGET_RIM);
        this.queueRect(x - 0.5, y - 0.5, 1, sp.h + 1, P.TARGET_RIM);
        this.queueRect(x + sp.w - 0.5, y - 0.5, 1, sp.h + 1, P.TARGET_RIM);
      }
      if (en.kind === "boss" && en.enraged) {
        this.queueRect(x - 1, y - 1, w + 2, 1, P.ENEMY_CHARGER);
        this.queueRect(x - 1, y + h, w + 2, 1, P.ENEMY_CHARGER);
        this.queueRect(x - 1, y - 1, 1, h + 2, P.ENEMY_CHARGER);
        this.queueRect(x + w, y - 1, 1, h + 2, P.ENEMY_CHARGER);
      }
      if (en.isElite) {
        const crownX = Math.round(en.x - ox - 1);
        const crownY = y - 4;
        this.queueRect(crownX, crownY + 1, 3, 2, "#ffd166");
        this.queueRect(crownX, crownY, 1, 1, "#ffd166");
        this.queueRect(crownX + 2, crownY, 1, 1, "#ffd166");
      }
      if (en.state === ENEMY_STATE.ATTACK && en.swing !== null && en.swing.phase === "recover") {
        this.queueRect(x + Math.floor(sp.w / 2) - 1, y - 3, 3, 1, P.ENEMY_EYE);
      }
      return;
    }

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
        g.drawImage(art.status![status]!, x, y, w, h);
        g.globalAlpha = 1;
      }
      if (en.isElite) {
        const elite = art.elite;
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

    if (en.shouldBlink()) {
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

  private drawOneNpc(g: CanvasRenderingContext2D, npc: Npc, ox: number, oy: number): void {
    const key = `npc_${npc.kind}`;
    const base = this.sprites[key];
    if (!base) return;
    const flipX = Math.cos(npc.facing) > 0.15;
    const sp = flipX ? this.mirrored(base, key) : base;
    const bob = Math.round(Math.sin(npc.animTicks * 0.05) * 0.5);
    const x = Math.round(npc.x - sp.ax - ox);
    const y = Math.round(npc.y - sp.ay - oy) - bob;
    if (this.glWorldBatch) {
      const shadow = this.shadowSprites[key];
      if (shadow) {
        this.queueSprite(base, Math.round(npc.x - base.ax - ox), y + 1, base.w, base.h, [0, 0, 0, 0.3]);
        this.queueSprite(base, Math.round(npc.x - base.ax - ox), y + 2, base.w, base.h, [0, 0, 0, 0.15]);
      }
      this.queueSprite(base, x, y, sp.w, sp.h, TINT_OPAQUE, 0, 0, false, flipX);
      return;
    }
    const shadow = this.shadowSprites[key];
    g.save();
    if (shadow) {
      const sx = Math.round(npc.x - base.ax - ox);
      g.globalAlpha = 0.3;
      g.drawImage(shadow, sx, y + 1, base.w, base.h);
      g.globalAlpha = 0.15;
      g.drawImage(shadow, sx, y + 2, base.w, base.h);
      g.globalAlpha = 1;
    }
    g.drawImage(sp.c, x, y, sp.w, sp.h);
    g.restore();
  }

  private drawOneProp(g: CanvasRenderingContext2D, prop: TownProp, ox: number, oy: number): void {
    const sp = this.sprites[prop.sprite];
    if (!sp) return;
    const x = Math.round(prop.x - sp.ax - ox);
    const y = Math.round(prop.y - sp.ay - oy);
    if (this.glWorldBatch) {
      this.queueSprite(sp, x, y, sp.w, sp.h);
      return;
    }
    g.drawImage(sp.c, x, y, sp.w, sp.h);
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
        if (this.glWorldBatch) {
          this.queueRect(
            x - (glowOnly ? 2 : 1),
            y - (glowOnly ? 2 : 1),
            glowOnly ? 4 : 2,
            glowOnly ? 4 : 2,
            color,
            fade * (glowOnly ? 0.45 : 0.75),
            glowOnly,
          );
          continue;
        }
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
    if (this.glWorldBatch) {
      if (p.owner === "player" && p.kind === "bolt") {
        this.queueRect(x - 2, y - 2, 4, 4, "#3a1450");
        this.queueRect(x - 1, y - 1, 2, 2, "#c99ae6");
      } else if (p.kind === "ghost") {
        this.queueRect(x - 3, y - 3, 6, 6, "#3a1252");
        this.queueRect(x - 1, y - 1, 3, 3, "#c99ae6");
      } else if (p.kind === "lava") {
        const total = enemyDef("golem").SHOT_LIFE_TICKS;
        const t = 1 - p.ticksLeft / Math.max(1, total);
        const arc = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * 8;
        this.queueRect(x - 3, y - 3 - arc, 6, 6, "#8a2f1c");
        this.queueRect(x - 1, y - 1 - arc, 3, 3, "#ffb14d");
      } else {
        const hot = p.owner === "player";
        this.queueRect(x - 2, y - 2, 4, 4, hot ? "#3a1c08" : P.VOID);
        this.queueRect(x - 1, y - 1, 2, 2, hot ? "#ff963f" : P.PROJ);
      }
      return;
    }
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
    if (this.glWorldBatch) {
      this.drawPlayerBatch(ox, oy);
      return;
    }
    const pl = this.world.player;
    if (pl.dead && pl.deadTicks > 12) return;

    // Death animation: 5 frames (deadTicks 1..12), tách thành 4 mảnh bay ra, soul orb bay lên
    if (pl.dead) {
      const t = Math.min(12, pl.deadTicks);
      const prog = t / 12; // 0..1
      const cx = Math.round(pl.x - ox);
      const cy = Math.round(pl.y - oy);

      // Soul orb glowing cyan/gold bay lên
      const orbY = cy - 8 - Math.round(prog * 26);
      const orbAlpha = Math.max(0, 1 - prog * 0.7);
      g.save();
      g.globalAlpha = orbAlpha;
      // Core
      g.fillStyle = "#ffffff";
      g.fillRect(cx - 1, orbY - 1, 2, 2);
      // Glow aura
      g.fillStyle = "#4da3ff";
      g.fillRect(cx - 2, orbY - 1, 1, 2);
      g.fillRect(cx + 1, orbY - 1, 1, 2);
      g.fillRect(cx - 1, orbY - 2, 2, 1);
      g.fillRect(cx - 1, orbY + 1, 2, 1);
      // Soft outer ring
      g.globalAlpha = orbAlpha * 0.4;
      g.fillStyle = "#c99ae6";
      g.fillRect(cx - 3, orbY - 2, 1, 4);
      g.fillRect(cx + 2, orbY - 2, 1, 4);
      g.restore();

      // 4 mảnh cơ thể vỡ ra và phân tán 4 góc
      const dist = Math.round(prog * 14);
      const rot = prog * 1.2;
      const alpha = Math.max(0, 1 - prog * 0.85);

      const parts: { key: string; dx: number; dy: number; r: number }[] = [
        { key: `playerpart_${pl.character}_head`, dx: -dist, dy: -dist - 4, r: -rot },
        { key: `playerpart_${pl.character}_torso`, dx: dist * 0.6, dy: -dist * 0.5, r: rot * 0.8 },
        { key: `playerpart_${pl.character}_arm`, dx: -dist * 1.1, dy: dist * 0.6, r: -rot * 1.5 },
        { key: `playerpart_${pl.character}_legs`, dx: dist * 0.9, dy: dist * 0.8, r: rot * 1.3 },
      ];

      g.save();
      g.globalAlpha = alpha;
      for (const p of parts) {
        const sp = this.sprites[p.key] ?? this.sprites[`player_${pl.character}`] ?? this.sprites.player;
        if (!sp) continue;
        g.save();
        g.translate(cx + p.dx, cy + p.dy);
        g.rotate(p.r);
        g.drawImage(sp.c, -sp.ax, -sp.ay, sp.w, sp.h);
        g.restore();
      }
      g.restore();
      return;
    }

    const blinkOut = pl.iframeTicks > 0 && Math.floor(pl.iframeTicks / 3) % 2 === 0;
    const dir = pl.state === PLAYER_STATE.DASH ? pl.dashDir : pl.facing;
    const faceSign = Math.cos(dir) > 0.15 ? 1 : -1;
    const pose = playerRigPose(pl, pl.animTicks);
    let sx = 1;
    let sy = 1;
    if (pl.state === PLAYER_STATE.DASH) {
      sx = 1.15;
      sy = 0.85;
    } else if (pl.state === PLAYER_STATE.ATTACK && pl.swing !== null) {
      const t = pl.swing.phase === "active"
        ? 1 - pl.swing.ticksLeft / Math.max(1, pl.swing.fd.active)
        : 0;
      const pulse = 0.08 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
      sx = 1 + pulse;
      sy = 1 - pulse;
    }

    const lift = pl.state === PLAYER_STATE.DASH ? 2 : 0;
    const cx = Math.round(pl.x - ox);
    const cy = Math.round(pl.y - oy) - lift;
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

    const cape = this.sprites[`playerpart_${pl.character}_cape`];
    if (cape === undefined) return;
    const capeRoot = this.capeChain[0];
    const capeTip = this.capeChain[this.capeChain.length - 1];
    if (capeRoot !== undefined && capeTip !== undefined) {
      const worldAngle = Math.atan2(capeTip.y - capeRoot.y, capeTip.x - capeRoot.x);
      pose.cape.rotation = faceSign > 0 ? worldAngle - Math.PI / 2 : Math.PI / 2 - worldAngle;
    }

    g.save();
    g.translate(cx, cy);
    g.scale(faceSign * sx, sy);
    const drawPart = (part: RigPart, transform: RigTransform): void => {
      const spritePart = part === "leftArm" || part === "rightArm" ? "arm" : part;
      const key = `playerpart_${pl.character}_${spritePart}`;
      const sprite = this.sprites[key];
      if (sprite === undefined) return;
      g.save();
      g.translate(transform.x, transform.y);
      g.rotate(transform.rotation);
      g.scale(transform.scaleX, transform.scaleY);
      g.drawImage(flashing ? this.white[key] ?? sprite.c : sprite.c, -sprite.ax, -sprite.ay, sprite.w, sprite.h);
      g.restore();
    };

    drawPart("cape", pose.cape);
    drawPart("legs", pose.legs);
    drawPart("torso", pose.torso);
    drawPart("leftArm", pose.leftArm);

    if (pl.character === "tank") {
      const shield = this.sprites.playerpart_tank_shield;
      if (shield !== undefined) {
        g.save();
        g.translate(pose.leftArm.x, pose.leftArm.y + 2);
        g.rotate(pose.leftArm.rotation * 0.35);
        g.drawImage(flashing ? this.white.playerpart_tank_shield ?? shield.c : shield.c, -shield.ax, -shield.ay, shield.w, shield.h);
        g.restore();
      }
    }

    const weapon = WEAPONS[pl.weapon];
    const weaponSprite = this.sprites[weapon.sprite];
    if (weaponSprite !== undefined) {
      const grip = WEAPON_GRIPS[pl.weapon];
      const attackAngle = this.playerWeaponAngle();
      const localAngle = faceSign > 0 ? attackAngle + Math.PI / 4 : Math.PI - attackAngle + Math.PI / 4;
      g.save();
      g.translate(pose.weapon.x, pose.weapon.y);
      g.rotate(localAngle + pose.weapon.rotation);
      g.scale(grip.scale * pose.weapon.scaleX, grip.scale * pose.weapon.scaleY);
      const image = flashing ? this.white[weapon.sprite] ?? weaponSprite.c : weaponSprite.c;
      g.drawImage(image, -grip.x, -grip.y);
      g.restore();
    }

    drawPart("rightArm", pose.rightArm);
    drawPart("head", pose.head);
    g.restore();

    const facingOffset = facingOffsets(dir);
    g.fillStyle = P.PLAYER_RIM;
    g.fillRect(cx - 1 + facingOffset.x, cy - 8 + facingOffset.y, 2, 2);
    g.globalAlpha = 1;
  }

  private queueRigPart(
    sp: Sprite,
    cx: number,
    cy: number,
    transform: RigTransform,
    outerScaleX: number,
    outerScaleY: number,
    alpha: number,
    flash: number,
  ): void {
    const localX = (sp.w * 0.5 - sp.ax) * transform.scaleX;
    const localY = (sp.h * 0.5 - sp.ay) * transform.scaleY;
    const c = Math.cos(transform.rotation);
    const s = Math.sin(transform.rotation);
    const centerX = cx + outerScaleX * (transform.x + localX * c - localY * s);
    const centerY = cy + outerScaleY * (transform.y + localX * s + localY * c);
    const width = sp.w * Math.abs(outerScaleX * transform.scaleX);
    const height = sp.h * Math.abs(outerScaleY * transform.scaleY);
    const flipX = outerScaleX < 0;
    this.queueSprite(
      sp,
      centerX - width * 0.5,
      centerY - height * 0.5,
      width,
      height,
      [1, 1, 1, alpha],
      transform.rotation * (flipX ? -1 : 1),
      flash,
      false,
      flipX,
    );
  }

  private drawPlayerBatch(ox: number, oy: number): void {
    const pl = this.world.player;
    if (pl.dead && pl.deadTicks > 12) return;
    const cx = Math.round(pl.x - ox);
    const cy = Math.round(pl.y - oy);
    if (pl.dead) {
      const progress = Math.min(12, pl.deadTicks) / 12;
      const orbY = cy - 8 - Math.round(progress * 26);
      const orbAlpha = Math.max(0, 1 - progress * 0.7);
      this.queueRect(cx - 1, orbY - 1, 2, 2, "#ffffff", orbAlpha, true);
      this.queueRect(cx - 2, orbY - 1, 1, 2, "#4da3ff", orbAlpha, true);
      this.queueRect(cx + 1, orbY - 1, 1, 2, "#4da3ff", orbAlpha, true);
      this.queueRect(cx - 1, orbY - 2, 2, 1, "#4da3ff", orbAlpha, true);
      this.queueRect(cx - 1, orbY + 1, 2, 1, "#4da3ff", orbAlpha, true);
      const dist = Math.round(progress * 14);
      const rot = progress * 1.2;
      const alpha = Math.max(0, 1 - progress * 0.85);
      const parts = [
        { key: `playerpart_${pl.character}_head`, dx: -dist, dy: -dist - 4, r: -rot },
        { key: `playerpart_${pl.character}_torso`, dx: dist * 0.6, dy: -dist * 0.5, r: rot * 0.8 },
        { key: `playerpart_${pl.character}_arm`, dx: -dist * 1.1, dy: dist * 0.6, r: -rot * 1.5 },
        { key: `playerpart_${pl.character}_legs`, dx: dist * 0.9, dy: dist * 0.8, r: rot * 1.3 },
      ];
      for (const part of parts) {
        const sp = this.sprites[part.key] ?? this.sprites[`player_${pl.character}`] ?? this.sprites.player;
        if (sp) this.queueSprite(sp, cx + part.dx - sp.ax, cy + part.dy - sp.ay, sp.w, sp.h, [1, 1, 1, alpha], part.r);
      }
      return;
    }

    const blinkOut = pl.iframeTicks > 0 && Math.floor(pl.iframeTicks / 3) % 2 === 0;
    const dir = pl.state === PLAYER_STATE.DASH ? pl.dashDir : pl.facing;
    const faceSign = Math.cos(dir) > 0.15 ? 1 : -1;
    const pose = playerRigPose(pl, pl.animTicks);
    let sx = 1;
    let sy = 1;
    if (pl.state === PLAYER_STATE.DASH) {
      sx = 1.15;
      sy = 0.85;
    } else if (pl.state === PLAYER_STATE.ATTACK && pl.swing !== null && pl.swing.phase === "active") {
      const t = 1 - pl.swing.ticksLeft / Math.max(1, pl.swing.fd.active);
      const pulse = 0.08 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
      sx = 1 + pulse;
      sy = 1 - pulse;
    }
    const lift = pl.state === PLAYER_STATE.DASH ? 2 : 0;
    const py = cy - lift;
    const alpha = blinkOut ? CONFIG.READABILITY.IFRAME_ALPHA : 1;
    const flashing = (this.flash.get(pl.id) ?? 0) > 0 ? 1 : 0;
    const cape = this.sprites[`playerpart_${pl.character}_cape`];
    if (!cape) return;
    const capeRoot = this.capeChain[0];
    const capeTip = this.capeChain[this.capeChain.length - 1];
    if (capeRoot && capeTip) {
      const worldAngle = Math.atan2(capeTip.y - capeRoot.y, capeTip.x - capeRoot.x);
      pose.cape.rotation = faceSign > 0 ? worldAngle - Math.PI / 2 : Math.PI / 2 - worldAngle;
    }

    const drawPart = (part: RigPart, transform: RigTransform): void => {
      const spritePart = part === "leftArm" || part === "rightArm" ? "arm" : part;
      const key = `playerpart_${pl.character}_${spritePart}`;
      const sp = this.sprites[key];
      if (sp) this.queueRigPart(sp, cx, py, transform, faceSign * sx, sy, alpha, flashing);
    };
    drawPart("cape", pose.cape);
    drawPart("legs", pose.legs);
    drawPart("torso", pose.torso);
    drawPart("leftArm", pose.leftArm);

    if (pl.character === "tank") {
      const shield = this.sprites.playerpart_tank_shield;
      if (shield) {
        const transform: RigTransform = {
          x: pose.leftArm.x,
          y: pose.leftArm.y + 2,
          rotation: pose.leftArm.rotation * 0.35,
          scaleX: pose.leftArm.scaleX,
          scaleY: pose.leftArm.scaleY,
        };
        this.queueRigPart(shield, cx, py, transform, faceSign * sx, sy, alpha, flashing);
      }
    }

    const weapon = WEAPONS[pl.weapon];
    const weaponSprite = this.sprites[weapon.sprite];
    if (weaponSprite) {
      const grip = WEAPON_GRIPS[pl.weapon];
      const attackAngle = this.playerWeaponAngle();
      const localAngle = faceSign > 0 ? attackAngle + Math.PI / 4 : Math.PI - attackAngle + Math.PI / 4;
      const rotation = localAngle + pose.weapon.rotation;
      const scaleX = grip.scale * pose.weapon.scaleX;
      const scaleY = grip.scale * pose.weapon.scaleY;
      const localX = (weaponSprite.w * 0.5 - grip.x) * scaleX;
      const localY = (weaponSprite.h * 0.5 - grip.y) * scaleY;
      const centerX = cx + faceSign * sx * (pose.weapon.x + localX * Math.cos(rotation) - localY * Math.sin(rotation));
      const centerY = py + sy * (pose.weapon.y + localX * Math.sin(rotation) + localY * Math.cos(rotation));
      const width = weaponSprite.w * Math.abs(scaleX * sx);
      const height = weaponSprite.h * Math.abs(scaleY * sy);
      this.queueSprite(weaponSprite, centerX - width * 0.5, centerY - height * 0.5, width, height,
        [1, 1, 1, alpha], rotation * faceSign, flashing, false, faceSign < 0);
    }

    drawPart("rightArm", pose.rightArm);
    drawPart("head", pose.head);
    if (pl.skillActiveTicks > 0) {
      const pulse = 0.5 + 0.35 * Math.sin(pl.skillActiveTicks * 0.4);
      const radius = 14;
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        const x = Math.round(pl.x - ox + Math.cos(angle) * radius);
        const y = Math.round(pl.y - 7 - oy + Math.sin(angle) * radius);
        this.queueRect(x - 1, y - 0.5, 2, 1, "#8ab4ff", pulse, false, angle + Math.PI / 2);
      }
    }
    const facingOffset = facingOffsets(dir);
    this.queueRect(cx - 1 + facingOffset.x, py - 8 + facingOffset.y, 2, 2, P.PLAYER_RIM, alpha);
  }

  private playerWeaponAngle(): number {
    const pl = this.world.player;
    const swing = pl.swing;
    if (pl.state !== PLAYER_STATE.ATTACK || swing === null) return pl.facing - 0.55;

    const combo = WEAPONS[pl.weapon].combos[Math.min(swing.combo - 1, WEAPONS[pl.weapon].combos.length - 1)];
    if (combo === undefined) return swing.dir;
    const halfArc = (combo.deg * Math.PI) / 360;
    const direction = swing.combo % 2 === 0 ? -1 : 1;
    if (swing.phase === "startup") {
      const t = 1 - swing.ticksLeft / Math.max(1, swing.fd.startup);
      return angleLerp(pl.facing - 0.55, swing.dir - halfArc * direction - 0.2 * direction, t);
    }
    if (swing.phase === "active") {
      const t = 1 - swing.ticksLeft / Math.max(1, swing.fd.active);
      return swing.dir + (-halfArc + 2 * halfArc * t) * direction;
    }
    const t = 1 - swing.ticksLeft / Math.max(1, swing.fd.recovery);
    return angleLerp(swing.dir + halfArc * direction, pl.facing - 0.55, t);
  }

  private updateCape(dtReal: number): void {
    const player = this.world.player;
    const anchorX = player.x;
    const anchorY = player.y - 11;
    const segments = 4;
    if (this.capeChain.length !== segments + 1) {
      this.capeChain = Array.from({ length: segments + 1 }, (_, i) => {
        const x = anchorX - Math.cos(player.facing) * i * 1.2;
        const y = anchorY + i * 2.5;
        return { x, y, px: x, py: y };
      });
      return;
    }

    const step = Math.min(2, Math.max(0, dtReal * 60));
    const root = this.capeChain[0]!;
    root.x = anchorX;
    root.y = anchorY;
    root.px = anchorX;
    root.py = anchorY;
    const windX = -player.vx * dtReal * 0.12 - Math.cos(player.facing) * step * 0.03;
    const windY = -player.vy * dtReal * 0.04;
    for (let i = 1; i < this.capeChain.length; i++) {
      const point = this.capeChain[i]!;
      const vx = (point.x - point.px) * 0.92;
      const vy = (point.y - point.py) * 0.92;
      point.px = point.x;
      point.py = point.y;
      point.x += vx + windX;
      point.y += vy + windY + 0.14 * step * step;
    }

    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < this.capeChain.length; i++) {
        const previous = this.capeChain[i - 1]!;
        const point = this.capeChain[i]!;
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const length = Math.hypot(dx, dy) || 1;
        const correction = (length - 2.7) / length;
        point.x -= dx * correction;
        point.y -= dy * correction;
      }
    }
  }

  private drawParticles(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const density = CONFIG.SLIDERS.particles;
    if (density <= 0.01) return;
    this.world.particles.visit((s) => {
      this.drawOneParticle(g, s, ox, oy, density);
    });
  }

  private drawOneParticle(g: CanvasRenderingContext2D, s: Slot, ox: number, oy: number, density: number): void {
    if (!s.live) return;
    const t = s.life / s.maxLife;
    const alpha = Math.min(1, (0.25 + 0.75 * t) * s.alphaScale * density);
    const sz = Math.max(1, Math.round(s.size));
    if (s.sprite !== null) {
      const sp = this.sprites[s.sprite];
      if (sp === undefined) return;
      if (this.glWorldBatch) {
        this.queueSprite(sp, Math.round(s.x - sp.ax - ox), Math.round(s.y - sp.ay - oy), sp.w, sp.h, [1, 1, 1, alpha * 0.35]);
        return;
      }
      g.globalAlpha = alpha * 0.35;
      g.drawImage(sp.c, Math.round(s.x - sp.ax - ox), Math.round(s.y - sp.ay - oy), sp.w, sp.h);
      return;
    }
    if (this.glWorldBatch) {
      this.queueRect(Math.round(s.x - ox), Math.round(s.y - oy), sz, sz, s.color, alpha);
      return;
    }
    g.globalAlpha = alpha;
    g.fillStyle = s.color;
    g.fillRect(Math.round(s.x - ox), Math.round(s.y - oy), sz, sz);
    g.globalAlpha = 1;
  }

  private drawVignette(g: CanvasRenderingContext2D, flags: DrawFlags, glOwnsHurt = false): void {
    const iw = VIEW_W;
    const ih = VIEW_H;
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