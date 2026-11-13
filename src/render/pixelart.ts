import { CONFIG, enemyDef } from "../config.ts";
import { ARTIFACT_COLORS, ARTIFACTS } from "../systems/artifacts.ts";

const P = CONFIG.PALETTE;

export type Sprite = { c: HTMLCanvasElement; w: number; h: number; ax: number; ay: number };

/** a baked multi-frame clip; the renderer picks a frame from sim ticks (60Hz) */
export type SpriteSet = { frames: Sprite[]; mirrored: Sprite[]; tickDur: number };

function bake(w: number, h: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g !== null) draw(g);
  return { c, w, h, ax, ay };
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function bakeBiomeTiles(S: Record<string, Sprite>, T: number, id: string, floor: string, wall: string, accent: string): void {
  const dungeon = id === "dungeon";
  const edge = dungeon ? "#181b22" : id === "caverns" ? "#1e2d39" : id === "forge" ? "#2a150e" : "#1b0f28";
  const floorShadow = dungeon ? "#0d0f14" : id === "caverns" ? "#09111a" : id === "forge" ? "#0d0704" : "#06030b";
  const shadow = dungeon ? P.VOID : floorShadow;
  const wallTop = dungeon ? P.WALL_TOP : id === "caverns" ? "#2c4b64" : id === "forge" ? "#55271a" : "#321c47";
  const wallRim = dungeon ? "#4d5975" : id === "caverns" ? "#527a94" : id === "forge" ? "#8b3f29" : "#58336f";

  S[`floor_${id}`] = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, floor);
    rect(g, 0, 0, T, 1, edge);
    rect(g, 0, 0, 1, T, edge);
    rect(g, 0, T - 1, T, 1, shadow);
    rect(g, T - 1, 0, 1, T, shadow);
    g.globalAlpha = 0.45;
    rect(g, 3, 4, 2, 1, accent);
    rect(g, 9, 8, 3, 1, accent);
    rect(g, 12, 12, 2, 2, accent);
    rect(g, 5, 11, 1, 2, accent);
  });

  S[`accent_${id}`] = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, floor);
    rect(g, 0, 0, T, 1, accent);
    rect(g, 0, 0, 1, T, accent);
    rect(g, 0, T - 1, T, 1, shadow);
    rect(g, T - 1, 0, 1, T, shadow);
    g.globalAlpha = 0.6;
    rect(g, 4, 4, 8, 8, accent);
    rect(g, 6, 6, 4, 4, floor);
  });

  /** oblique face: the bottom 6px strip drawn over a wall tile that stands above walkable floor */
  S[`wallface_${id}`] = bake(T, 6, 0, 0, (g) => {
    rect(g, 0, 0, T, 6, wallTop);
    rect(g, 0, 0, T, 1, wallRim);
    g.globalAlpha = 0.55;
    rect(g, 0, 3, T, 1, shadow);
    rect(g, 5, 1, 1, 4, shadow);
    rect(g, 11, 1, 1, 4, shadow);
    g.globalAlpha = 0.8;
    rect(g, 0, 5, T, 1, shadow);
  });

  S[`wall_${id}`] = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, wall);
    rect(g, 0, 0, T, 3, wallTop);
    rect(g, 0, 0, T, 1, wallRim);
    rect(g, 0, 3, T, 1, shadow);
    g.globalAlpha = 0.55;
    rect(g, 0, 8, T, 1, shadow);
    rect(g, 7, 4, 1, 4, shadow);
    rect(g, 3, 9, 1, 7, shadow);
    rect(g, 12, 9, 1, 7, shadow);
    g.globalAlpha = 0.8;
    rect(g, 0, T - 2, T, 2, shadow);
  });
}

/** bottom-centre anchored, feet at ay */
export function buildSprites(): Record<string, Sprite> {
  const S: Record<string, Sprite> = {};
  const T = CONFIG.WORLD.TILE;
  buildPlayerSprites(S);
  buildPlayerPartSprites(S);
  buildEnemySprites(S);
  buildNpcSprites(S);
  buildTownPropSprites(S);
  buildHudSprites(S);
  buildTileSprites(S, T);
  buildParallaxSprites(S);
  buildPropSprites(S, T);
  buildWeaponSprites(S);
  buildTorchSprites(S);
  buildArtifactSprites(S);
  return S;
}

function buildNpcSprites(S: Record<string, Sprite>): void {
  S.npc_merchant = bake(12, 17, 6, 16, (g) => {
    rect(g, 2, 1, 8, 2, "#3d2817");
    rect(g, 3, 0, 6, 1, "#4d3222");
    rect(g, 4, 3, 4, 3, "#d4a373");
    rect(g, 5, 4, 1, 1, "#1a1a1a");
    rect(g, 7, 4, 1, 1, "#1a1a1a");
    rect(g, 2, 6, 8, 8, "#8b5a2b");
    rect(g, 3, 7, 6, 6, "#a6703d");
    rect(g, 2, 10, 8, 1, "#3d2817");
    rect(g, 1, 10, 2, 3, "#ffd166");
    rect(g, 1, 10, 1, 1, "#ffffff");
    rect(g, 3, 14, 2, 2, "#1a1a1a");
    rect(g, 7, 14, 2, 2, "#1a1a1a");
  });

  S.npc_guard = bake(12, 18, 6, 17, (g) => {
    rect(g, 3, 0, 6, 4, "#8fa8c8");
    rect(g, 4, 0, 4, 1, "#d8f0ff");
    rect(g, 5, 2, 2, 1, "#1a1a1a");
    rect(g, 2, 4, 8, 3, "#4a6076");
    rect(g, 3, 4, 6, 2, "#8fa8c8");
    rect(g, 3, 6, 6, 6, "#4a6076");
    rect(g, 4, 7, 4, 4, "#8fa8c8");
    rect(g, 4, 8, 4, 1, "#5a7a94");
    rect(g, 10, 2, 1, 14, "#795548");
    rect(g, 9, 0, 3, 3, "#c8ff8a");
    rect(g, 10, 0, 1, 1, "#ffffff");
    rect(g, 3, 12, 2, 4, "#2b2d42");
    rect(g, 7, 12, 2, 4, "#2b2d42");
    rect(g, 2, 16, 3, 1, "#1a1a1a");
    rect(g, 7, 16, 3, 1, "#1a1a1a");
  });

  S.npc_character_master = bake(12, 18, 6, 17, (g) => {
    rect(g, 3, 0, 6, 3, "#4a148c");
    rect(g, 4, 0, 4, 1, "#9d4edd");
    rect(g, 3, 3, 6, 2, "#2a0b3d");
    rect(g, 5, 3, 2, 1, "#ffd166");
    rect(g, 2, 5, 8, 9, "#5a189a");
    rect(g, 3, 6, 6, 7, "#7b2cbf");
    rect(g, 5, 6, 2, 7, "#c99ae6");
    rect(g, 10, 3, 1, 13, "#795548");
    rect(g, 9, 1, 3, 3, "#9d4edd");
    rect(g, 10, 0, 1, 1, "#ffd166");
    rect(g, 3, 14, 2, 2, "#2a0b3d");
    rect(g, 7, 14, 2, 2, "#2a0b3d");
  });
}

function buildTownPropSprites(S: Record<string, Sprite>): void {
  S.prop_well = bake(24, 24, 12, 23, (g) => {
    rect(g, 4, 4, 16, 16, "#3a2f22");
    rect(g, 5, 5, 14, 14, "#5a4a38");
    rect(g, 7, 7, 10, 10, "#0d1419");
    rect(g, 8, 8, 8, 8, "#1a3a4a");
    rect(g, 10, 10, 4, 4, "#2a5a70");
    rect(g, 2, 0, 20, 3, "#2a1a0e");
    rect(g, 10, 2, 4, 4, "#8b5a2b");
    rect(g, 11, 6, 2, 6, "#a6703d");
    rect(g, 10, 12, 4, 2, "#3a2f22");
  });

  S.prop_tree = bake(20, 32, 10, 31, (g) => {
    rect(g, 8, 16, 4, 15, "#3a2817");
    rect(g, 9, 16, 2, 15, "#5a3d28");
    rect(g, 2, 2, 16, 14, "#1f4d2a");
    rect(g, 3, 1, 14, 15, "#2a6b3d");
    rect(g, 5, 3, 10, 11, "#3a8853");
    rect(g, 7, 5, 6, 7, "#4da36b");
    rect(g, 6, 4, 2, 2, "#6bc088");
    rect(g, 12, 8, 2, 2, "#6bc088");
  });

  S.prop_signpost = bake(12, 20, 6, 19, (g) => {
    rect(g, 5, 6, 2, 13, "#5a3d28");
    rect(g, 4, 15, 4, 2, "#3a2817");
    rect(g, 1, 4, 10, 6, "#8b5a2b");
    rect(g, 2, 5, 8, 4, "#a6703d");
    rect(g, 2, 5, 8, 1, "#c88a52");
    rect(g, 9, 4, 2, 6, "#8b5a2b");
    rect(g, 10, 5, 1, 4, "#8b5a2b");
    rect(g, 4, 7, 4, 1, "#2a1a0e");
    rect(g, 4, 8, 2, 1, "#2a1a0e");
  });

  S.prop_lantern = bake(8, 24, 4, 23, (g) => {
    rect(g, 3, 8, 2, 15, "#3a2817");
    rect(g, 2, 22, 4, 1, "#2a1a0e");
    rect(g, 1, 2, 6, 8, "#2a1a0e");
    rect(g, 2, 3, 4, 6, "#ff963f");
    rect(g, 3, 4, 2, 4, "#ffe66b");
    rect(g, 2, 1, 4, 1, "#2a1a0e");
    rect(g, 3, 10, 2, 2, "#8b5a2b");
  });
}

function buildPlayerSprites(S: Record<string, Sprite>): void {
  // Swordsman (Kiếm Khách) - Agile, light armor, sharp visor slit, sword hilt
  S.player_swordsman = bake(14, 15, 7, 14, (g) => {
    // Dark outline / cape undertone
    rect(g, 2, 0, 10, 3, P.VOID);
    rect(g, 2, 1, 10, 10, "#1f4068"); // deep blue armor base
    // Helmet rim / cowl highlight
    rect(g, 3, 0, 8, 2, "#4da3ff"); // cyan-blue rim
    // Side contour
    rect(g, 1, 3, 1, 8, P.VOID);
    rect(g, 12, 3, 1, 8, P.VOID);
    // Legs & feet boots
    rect(g, 3, 11, 3, 3, P.VOID);
    rect(g, 8, 11, 3, 3, P.VOID);
    rect(g, 4, 11, 2, 2, "#1f4068");
    rect(g, 8, 11, 2, 2, "#1f4068");
    // Visor slit with high-contrast glowing cyan slit
    rect(g, 4, 4, 6, 2, P.VOID);
    rect(g, 5, 4, 4, 1, "#00e5ff");
    rect(g, 6, 5, 2, 1, "#ffffff");
    // Belt & sheath
    rect(g, 4, 9, 6, 1, "#ffd166");
    // Sheathed katana at left hip
    rect(g, 1, 8, 2, 4, "#ffd166");
    rect(g, 0, 7, 2, 2, "#ffffff");
  });

  // Mage (Pháp Sư) - Mystical pointed hat, long purple robe, staff with glowing flame orb
  S.player_mage = bake(14, 16, 7, 15, (g) => {
    // Wizard pointed hat top
    rect(g, 6, 0, 2, 2, "#c99ae6");
    rect(g, 5, 2, 4, 2, "#7b2cbf");
    // Hat brim
    rect(g, 2, 4, 10, 2, "#4a148c");
    rect(g, 3, 4, 8, 1, "#9d4edd");
    // Shadowed hood face with mystic glowing yellow eyes
    rect(g, 4, 6, 6, 2, P.VOID);
    rect(g, 5, 6, 1, 1, "#ffd166");
    rect(g, 8, 6, 1, 1, "#ffd166");
    // Purple mystical Robe
    rect(g, 3, 8, 8, 6, "#5a189a");
    rect(g, 2, 9, 1, 4, P.VOID);
    rect(g, 11, 9, 1, 4, P.VOID);
    // Rune sash down the middle
    rect(g, 6, 8, 2, 6, "#c99ae6");
    // Bottom hem of robe
    rect(g, 3, 14, 8, 2, "#3c096c");
    // Arcane Staff on right side
    rect(g, 11, 3, 2, 12, "#795548"); // wooden staff pole
    // Staff head / glowing orb
    rect(g, 10, 1, 4, 3, "#9d4edd");
    rect(g, 11, 0, 2, 2, "#ffd166"); // glowing arcane core
  });

  // Tank (Khiên Sĩ) - Bulky horned helmet, thick crimson plate armor, heavy tower shield
  S.player_tank = bake(16, 16, 8, 15, (g) => {
    // Horned heavy war-helmet
    rect(g, 3, 0, 2, 3, "#d90429"); // left horn
    rect(g, 11, 0, 2, 3, "#d90429"); // right horn
    rect(g, 4, 1, 8, 3, "#3a0ca3");
    rect(g, 5, 1, 6, 2, "#ef233c");
    // Iron visor slit
    rect(g, 5, 4, 6, 2, P.VOID);
    rect(g, 6, 4, 4, 1, "#ff5a3c"); // glowing red/orange stare
    // Thick plate shoulder pads & chest
    rect(g, 2, 6, 12, 5, "#2b2d42");
    rect(g, 3, 6, 10, 4, "#8d99ae");
    rect(g, 5, 7, 6, 3, "#ef233c"); // crimson chestplate
    // Heavy spiked feet / greaves
    rect(g, 4, 12, 3, 4, "#1f2421");
    rect(g, 9, 12, 3, 4, "#1f2421");
    rect(g, 5, 12, 2, 2, "#8d99ae");
    rect(g, 9, 12, 2, 2, "#8d99ae");
    // Heavy Tower Shield on left
    rect(g, 0, 5, 3, 9, "#ff5a3c");
    rect(g, 1, 6, 2, 7, "#ffd166"); // gold cross / boss on shield
    rect(g, 0, 7, 1, 5, "#ffffff");
  });

  S.player = S.player_swordsman;
}

function buildPlayerPartSprites(S: Record<string, Sprite>): void {
  S.playerpart_swordsman_cape = bake(10, 10, 5, 0, (g) => {
    rect(g, 2, 0, 6, 2, P.VOID);
    rect(g, 1, 2, 8, 6, "#142338");
    rect(g, 0, 7, 10, 2, "#1f4068");
    rect(g, 2, 8, 6, 1, "#4da3ff");
  });
  S.playerpart_swordsman_legs = bake(10, 5, 5, 5, (g) => {
    rect(g, 1, 0, 8, 4, P.VOID);
    rect(g, 2, 0, 6, 3, "#1f4068");
    rect(g, 0, 3, 4, 2, P.VOID);
    rect(g, 6, 3, 4, 2, P.VOID);
    rect(g, 1, 3, 3, 1, "#4da3ff");
    rect(g, 6, 3, 3, 1, "#4da3ff");
  });
  S.playerpart_swordsman_torso = bake(10, 8, 5, 0, (g) => {
    rect(g, 1, 0, 8, 7, P.VOID);
    rect(g, 2, 1, 6, 5, "#1f4068");
    rect(g, 0, 1, 2, 3, "#4da3ff");
    rect(g, 8, 1, 2, 3, "#4da3ff");
    rect(g, 4, 1, 2, 5, "#2c6db0");
    rect(g, 3, 6, 4, 1, "#ffd166");
  });
  S.playerpart_swordsman_head = bake(10, 8, 5, 8, (g) => {
    rect(g, 1, 1, 8, 6, P.VOID);
    rect(g, 2, 0, 6, 5, "#1f4068");
    rect(g, 1, 0, 8, 2, "#4da3ff");
    rect(g, 3, 3, 5, 2, "#07101d");
    rect(g, 4, 3, 3, 1, "#00e5ff");
    rect(g, 5, 4, 2, 1, "#ffffff");
  });
  S.playerpart_swordsman_arm = bake(5, 8, 2, 1, (g) => {
    rect(g, 1, 0, 3, 6, P.VOID);
    rect(g, 1, 1, 2, 4, "#1f4068");
    rect(g, 0, 1, 2, 3, "#4da3ff");
    rect(g, 1, 6, 3, 1, "#ffd166");
  });

  S.playerpart_mage_cape = bake(10, 10, 5, 0, (g) => {
    rect(g, 2, 0, 6, 2, P.VOID);
    rect(g, 1, 2, 8, 6, "#3c096c");
    rect(g, 0, 7, 10, 2, "#5a189a");
    rect(g, 3, 8, 4, 1, "#c99ae6");
  });
  S.playerpart_mage_legs = bake(10, 5, 5, 5, (g) => {
    rect(g, 1, 0, 8, 4, P.VOID);
    rect(g, 2, 0, 6, 4, "#5a189a");
    rect(g, 0, 3, 4, 2, "#3c096c");
    rect(g, 6, 3, 4, 2, "#3c096c");
    rect(g, 4, 1, 2, 3, "#c99ae6");
  });
  S.playerpart_mage_torso = bake(10, 8, 5, 0, (g) => {
    rect(g, 1, 0, 8, 7, P.VOID);
    rect(g, 2, 1, 6, 6, "#5a189a");
    rect(g, 0, 2, 2, 4, "#4a148c");
    rect(g, 8, 2, 2, 4, "#4a148c");
    rect(g, 4, 1, 2, 6, "#c99ae6");
    rect(g, 3, 6, 4, 1, "#3c096c");
  });
  S.playerpart_mage_head = bake(10, 9, 5, 9, (g) => {
    rect(g, 4, 0, 2, 2, "#c99ae6");
    rect(g, 3, 2, 4, 2, "#7b2cbf");
    rect(g, 1, 4, 8, 2, "#4a148c");
    rect(g, 2, 4, 6, 1, "#9d4edd");
    rect(g, 3, 6, 4, 2, P.VOID);
    rect(g, 3, 6, 1, 1, "#ffd166");
    rect(g, 6, 6, 1, 1, "#ffd166");
  });
  S.playerpart_mage_arm = bake(5, 8, 2, 1, (g) => {
    rect(g, 1, 0, 3, 6, P.VOID);
    rect(g, 1, 1, 2, 5, "#5a189a");
    rect(g, 0, 2, 2, 3, "#9d4edd");
    rect(g, 1, 6, 3, 1, "#c99ae6");
  });

  S.playerpart_tank_cape = bake(12, 10, 6, 0, (g) => {
    rect(g, 2, 0, 8, 2, P.VOID);
    rect(g, 1, 2, 10, 6, "#3d1020");
    rect(g, 0, 7, 12, 2, "#8f172f");
    rect(g, 3, 8, 6, 1, "#ff5a3c");
  });
  S.playerpart_tank_legs = bake(12, 5, 6, 5, (g) => {
    rect(g, 1, 0, 10, 4, P.VOID);
    rect(g, 2, 0, 8, 3, "#2b2d42");
    rect(g, 0, 3, 5, 2, "#1f2421");
    rect(g, 7, 3, 5, 2, "#1f2421");
    rect(g, 1, 3, 3, 1, "#8d99ae");
    rect(g, 8, 3, 3, 1, "#8d99ae");
  });
  S.playerpart_tank_torso = bake(12, 8, 6, 0, (g) => {
    rect(g, 1, 0, 10, 7, P.VOID);
    rect(g, 2, 1, 8, 5, "#8d99ae");
    rect(g, 0, 1, 3, 4, "#2b2d42");
    rect(g, 9, 1, 3, 4, "#2b2d42");
    rect(g, 4, 1, 4, 5, "#ef233c");
    rect(g, 5, 2, 2, 3, "#ff5a3c");
    rect(g, 3, 6, 6, 1, "#ffd166");
  });
  S.playerpart_tank_head = bake(12, 9, 6, 9, (g) => {
    rect(g, 1, 2, 10, 6, P.VOID);
    rect(g, 2, 2, 8, 5, "#3a0ca3");
    rect(g, 3, 3, 6, 3, "#ef233c");
    rect(g, 0, 0, 3, 4, "#d90429");
    rect(g, 9, 0, 3, 4, "#d90429");
    rect(g, 4, 5, 5, 2, "#07101d");
    rect(g, 5, 5, 3, 1, "#ff5a3c");
  });
  S.playerpart_tank_arm = bake(6, 8, 3, 1, (g) => {
    rect(g, 1, 0, 4, 6, P.VOID);
    rect(g, 1, 1, 4, 5, "#2b2d42");
    rect(g, 0, 1, 2, 4, "#8d99ae");
    rect(g, 2, 2, 2, 3, "#ef233c");
    rect(g, 1, 6, 4, 1, "#ffd166");
  });
  S.playerpart_tank_shield = bake(6, 10, 3, 1, (g) => {
    rect(g, 1, 0, 4, 8, P.VOID);
    rect(g, 1, 1, 4, 7, "#ff5a3c");
    rect(g, 2, 2, 2, 5, "#ffd166");
    rect(g, 0, 4, 1, 2, "#ffffff");
    rect(g, 2, 8, 2, 1, "#ff5a3c");
  });
}

function buildEnemySprites(S: Record<string, Sprite>): void {
  S.enemy = bake(12, 13, 6, 12, (g) => {
    const body = enemyDef("chaser").BODY_COLOR;
    // Horns / spikes
    rect(g, 1, 0, 2, 3, P.ENEMY_SHADE);
    rect(g, 9, 0, 2, 3, P.ENEMY_SHADE);
    rect(g, 2, 2, 8, 8, body);
    rect(g, 1, 3, 1, 7, P.VOID);
    rect(g, 10, 3, 1, 7, P.VOID);
    rect(g, 2, 9, 8, 2, P.ENEMY_SHADE);
    // Claws / feet
    rect(g, 2, 11, 2, 2, P.VOID);
    rect(g, 8, 11, 2, 2, P.VOID);
    // Glowing sharp eyes
    rect(g, 3, 4, 2, 2, P.ENEMY_EYE);
    rect(g, 7, 4, 2, 2, P.ENEMY_EYE);
    rect(g, 4, 4, 1, 1, "#ffffff");
    rect(g, 8, 4, 1, 1, "#ffffff");
  });

  const charger = enemyDef("charger");
  S[charger.SPRITE_KEY] = bake(13, 12, 6, 11, (g) => {
    const widths = [1, 3, 5, 7, 9, 11, 11, 9, 7, 5, 3];
    widths.forEach((w, y) => rect(g, (13 - w) / 2, y, w, 1, charger.BODY_COLOR));
    rect(g, 2, 5, 9, 2, P.ENEMY_CHARGER_SHADE);
    rect(g, 5, 3, 3, 2, P.ENEMY_EYE);
    rect(g, 3, 11, 2, 1, P.VOID);
    rect(g, 8, 11, 2, 1, P.VOID);
  });

  const splitter = enemyDef("splitter");
  S[splitter.SPRITE_KEY] = bake(13, 11, 6, 10, (g) => {
    rect(g, 1, 0, 11, 10, splitter.BODY_COLOR);
    rect(g, 0, 2, 13, 6, splitter.BODY_COLOR);
    rect(g, 1, 0, 11, 1, P.ENEMY_SPLITTER_SHADE);
    rect(g, 1, 8, 11, 2, P.ENEMY_SPLITTER_SHADE);
    rect(g, 6, 0, 1, 10, P.ENEMY_SPLITTER_SHADE);
    rect(g, 2, 3, 2, 2, P.ENEMY_EYE);
    rect(g, 9, 3, 2, 2, P.ENEMY_EYE);
    rect(g, 3, 10, 2, 1, P.VOID);
    rect(g, 8, 10, 2, 1, P.VOID);
  });

  const small = enemyDef("small");
  S[small.SPRITE_KEY] = bake(7, 8, 3, 7, (g) => {
    rect(g, 1, 0, 5, 7, small.BODY_COLOR);
    rect(g, 0, 1, 7, 5, small.BODY_COLOR);
    rect(g, 2, 2, 2, 2, P.ENEMY_EYE);
    rect(g, 1, 5, 5, 2, P.ENEMY_SMALL_SHADE);
    rect(g, 1, 7, 2, 1, P.VOID);
    rect(g, 4, 7, 2, 1, P.VOID);
  });

  const ranged = enemyDef("ranged");
  S[ranged.SPRITE_KEY] = bake(9, 12, 4, 11, (g) => {
    rect(g, 3, 0, 3, 1, P.ENEMY_RANGED_SHADE);
    rect(g, 2, 1, 5, 3, ranged.BODY_COLOR);
    rect(g, 1, 4, 7, 6, ranged.BODY_COLOR);
    rect(g, 2, 10, 5, 1, P.ENEMY_RANGED_SHADE);
    rect(g, 3, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 5, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 4, 6, 1, 2, P.PROJ);
    rect(g, 2, 11, 2, 1, P.VOID);
    rect(g, 5, 11, 2, 1, P.VOID);
  });

  const teleporter = enemyDef("teleporter");
  S[teleporter.SPRITE_KEY] = bake(9, 11, 4, 10, (g) => {
    rect(g, 4, 0, 1, 1, teleporter.BODY_COLOR);
    rect(g, 3, 1, 3, 1, teleporter.BODY_COLOR);
    rect(g, 2, 2, 5, 4, teleporter.BODY_COLOR);
    rect(g, 3, 6, 3, 3, teleporter.BODY_COLOR);
    rect(g, 1, 3, 1, 2, P.ENEMY_TELEPORTER_SHADE);
    rect(g, 7, 3, 1, 2, P.ENEMY_TELEPORTER_SHADE);
    rect(g, 3, 3, 1, 1, P.ENEMY_EYE);
    rect(g, 5, 3, 1, 1, P.ENEMY_EYE);
    rect(g, 3, 10, 3, 1, P.ENEMY_TELEPORTER_SHADE);
  });

  const healer = enemyDef("healer");
  S[healer.SPRITE_KEY] = bake(9, 11, 4, 10, (g) => {
    rect(g, 2, 0, 5, 2, healer.BODY_COLOR);
    rect(g, 1, 2, 7, 7, healer.BODY_COLOR);
    rect(g, 1, 8, 7, 1, P.ENEMY_HEALER_SHADE);
    rect(g, 4, 3, 1, 5, "#eafff0");
    rect(g, 2, 5, 5, 1, "#eafff0");
    rect(g, 2, 10, 2, 1, P.VOID);
    rect(g, 5, 10, 2, 1, P.VOID);
  });

  const exploder = enemyDef("exploder");
  S[exploder.SPRITE_KEY] = bake(11, 12, 5, 11, (g) => {
    rect(g, 5, 0, 1, 2, P.ENEMY_EYE);
    rect(g, 3, 2, 5, 1, exploder.BODY_COLOR);
    rect(g, 1, 3, 9, 6, exploder.BODY_COLOR);
    rect(g, 3, 9, 5, 1, exploder.BODY_COLOR);
    rect(g, 1, 7, 9, 2, P.ENEMY_EXPLODER_SHADE);
    rect(g, 4, 4, 3, 3, P.ENEMY_EXPLODER_SHADE);
    rect(g, 5, 5, 1, 1, P.ENEMY_EYE);
    rect(g, 2, 10, 2, 1, P.VOID);
    rect(g, 7, 10, 2, 1, P.VOID);
  });

  const shielder = enemyDef("shielder");
  S[shielder.SPRITE_KEY] = bake(12, 11, 6, 10, (g) => {
    rect(g, 2, 0, 8, 9, shielder.BODY_COLOR);
    rect(g, 2, 7, 8, 2, P.ENEMY_SHIELDER_SHADE);
    rect(g, 0, 1, 2, 7, P.ENEMY_SHIELDER_SHADE);
    rect(g, 10, 1, 2, 7, P.ENEMY_SHIELDER_SHADE);
    rect(g, 4, 3, 2, 2, P.ENEMY_EYE);
    rect(g, 7, 3, 1, 2, P.ENEMY_EYE);
    rect(g, 3, 10, 2, 1, P.VOID);
    rect(g, 7, 10, 2, 1, P.VOID);
  });

  const sniper = enemyDef("sniper");
  S[sniper.SPRITE_KEY] = bake(9, 13, 4, 12, (g) => {
    rect(g, 3, 0, 3, 2, P.ENEMY_SNIPER_SHADE);
    rect(g, 2, 2, 5, 4, sniper.BODY_COLOR);
    rect(g, 3, 6, 3, 5, sniper.BODY_COLOR);
    rect(g, 3, 3, 3, 1, P.ENEMY_EYE);
    rect(g, 4, 8, 1, 3, P.ENEMY_SNIPER_SHADE);
    rect(g, 2, 12, 2, 1, P.VOID);
    rect(g, 5, 12, 2, 1, P.VOID);
  });

  const jumper = enemyDef("jumper");
  S[jumper.SPRITE_KEY] = bake(9, 10, 4, 9, (g) => {
    rect(g, 3, 0, 3, 1, jumper.BODY_COLOR);
    rect(g, 2, 1, 5, 4, jumper.BODY_COLOR);
    rect(g, 1, 2, 1, 2, P.ENEMY_JUMPER_SHADE);
    rect(g, 7, 2, 1, 2, P.ENEMY_JUMPER_SHADE);
    rect(g, 3, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 5, 2, 1, 1, P.ENEMY_EYE);
    rect(g, 2, 5, 2, 3, P.ENEMY_JUMPER_SHADE);
    rect(g, 5, 5, 2, 3, P.ENEMY_JUMPER_SHADE);
    rect(g, 1, 8, 3, 1, jumper.BODY_COLOR);
    rect(g, 5, 8, 3, 1, jumper.BODY_COLOR);
  });

  const warden = enemyDef("warden");
  S[warden.SPRITE_KEY] = bake(16, 16, 8, 15, (g) => {
    rect(g, 0, 2, 16, 12, P.ENEMY_WARDEN_SHADE);
    rect(g, 1, 1, 14, 12, warden.BODY_COLOR);
    rect(g, 1, 1, 14, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 2, 0, 2, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 12, 0, 2, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 3, 5, 3, 3, P.ENEMY_EYE);
    rect(g, 10, 5, 3, 3, P.ENEMY_EYE);
    rect(g, 6, 9, 4, 2, P.ENEMY_WARDEN_SHADE);
    rect(g, 3, 14, 3, 2, P.VOID);
    rect(g, 10, 14, 3, 2, P.VOID);
  });

  const boss = enemyDef("boss");
  S[boss.SPRITE_KEY] = bake(20, 18, 10, 17, (g) => {
    rect(g, 0, 2, 20, 14, P.ENEMY_BOSS_RIM);
    rect(g, 1, 1, 18, 15, P.ENEMY_BOSS_RIM);
    rect(g, 2, 2, 16, 13, boss.BODY_COLOR);
    rect(g, 4, 0, 3, 2, P.ENEMY_BOSS_RIM);
    rect(g, 13, 0, 3, 2, P.ENEMY_BOSS_RIM);
    rect(g, 2, 2, 16, 2, P.ENEMY_BOSS_SHADE);
    rect(g, 2, 12, 16, 3, P.ENEMY_BOSS_SHADE);
    rect(g, 5, 6, 3, 3, P.ENEMY_EYE);
    rect(g, 12, 6, 3, 3, P.ENEMY_EYE);
    rect(g, 4, 16, 4, 2, P.VOID);
    rect(g, 12, 16, 4, 2, P.VOID);
  });

  const golem = enemyDef("golem");
  S[golem.SPRITE_KEY] = bake(24, 20, 12, 19, (g) => {
    rect(g, 0, 2, 24, 16, P.ENEMY_GOLEM_SHADE);
    rect(g, 2, 1, 20, 17, golem.BODY_COLOR);
    rect(g, 2, 1, 20, 2, P.ENEMY_GOLEM_SHADE);
    rect(g, 0, 4, 3, 8, P.ENEMY_GOLEM_SHADE);
    rect(g, 21, 4, 3, 8, P.ENEMY_GOLEM_SHADE);
    rect(g, 11, 5, 2, 3, P.ENEMY_GOLEM_RUNE);
    rect(g, 7, 9, 2, 2, P.ENEMY_GOLEM_RUNE);
    rect(g, 15, 9, 2, 2, P.ENEMY_GOLEM_RUNE);
    rect(g, 10, 12, 4, 2, P.ENEMY_GOLEM_RUNE);
    rect(g, 5, 4, 4, 3, P.ENEMY_EYE);
    rect(g, 15, 4, 4, 3, P.ENEMY_EYE);
    rect(g, 6, 5, 2, 1, P.VOID);
    rect(g, 16, 5, 2, 1, P.VOID);
    rect(g, 4, 18, 5, 2, P.VOID);
    rect(g, 15, 18, 5, 2, P.VOID);
  });

  const king = enemyDef("king");
  S[king.SPRITE_KEY] = bake(20, 18, 10, 17, (g) => {
    rect(g, 3, 1, 14, 2, P.ENEMY_KING_CROWN);
    rect(g, 4, 0, 2, 2, P.ENEMY_KING_CROWN);
    rect(g, 9, 0, 2, 2, P.ENEMY_KING_CROWN);
    rect(g, 14, 0, 2, 2, P.ENEMY_KING_CROWN);
    rect(g, 2, 3, 16, 13, P.ENEMY_KING_SHADE);
    rect(g, 3, 4, 14, 12, king.BODY_COLOR);
    rect(g, 1, 6, 3, 9, P.ENEMY_KING_SHADE);
    rect(g, 16, 6, 3, 9, P.ENEMY_KING_SHADE);
    rect(g, 5, 6, 3, 3, "#ff4d4d");
    rect(g, 12, 6, 3, 3, "#ff4d4d");
    rect(g, 6, 7, 1, 1, P.VOID);
    rect(g, 13, 7, 1, 1, P.VOID);
    rect(g, 5, 16, 4, 2, P.VOID);
    rect(g, 11, 16, 4, 2, P.VOID);
  });
}

function buildHudSprites(S: Record<string, Sprite>): void {
  S.shadow = bake(10, 4, 5, 2, (g) => {
    g.globalAlpha = CONFIG.READABILITY.SHADOW_ALPHA;
    rect(g, 1, 1, 8, 2, P.VOID);
    rect(g, 0, 2, 10, 1, P.VOID);
    rect(g, 2, 0, 6, 1, P.VOID);
  });

  S.heart_full = bake(8, 7, 0, 0, (g) => {
    rect(g, 1, 1, 2, 2, P.HP_FULL);
    rect(g, 5, 1, 2, 2, P.HP_FULL);
    rect(g, 1, 3, 6, 2, P.HP_FULL);
    rect(g, 2, 5, 4, 1, P.HP_FULL);
    rect(g, 3, 6, 2, 1, P.HP_FULL);
    rect(g, 2, 1, 1, 1, P.PLAYER_RIM);
  });

  S.heart_empty = bake(8, 7, 0, 0, (g) => {
    rect(g, 1, 1, 2, 2, P.HP_EMPTY);
    rect(g, 5, 1, 2, 2, P.HP_EMPTY);
    rect(g, 1, 3, 6, 2, P.HP_EMPTY);
    rect(g, 2, 5, 4, 1, P.HP_EMPTY);
    rect(g, 3, 6, 2, 1, P.HP_EMPTY);
  });
}

function buildTileSprites(S: Record<string, Sprite>, T: number): void {
  S.floor = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    // Beveled stone tile borders
    rect(g, 0, 0, T, 1, "#181b22");
    rect(g, 0, 0, 1, T, "#181b22");
    rect(g, 0, T - 1, T, 1, "#0d0f14");
    rect(g, T - 1, 0, 1, T, "#0d0f14");
    // Subtle dither / stone texture
    g.globalAlpha = 0.45;
    rect(g, 3, 4, 2, 1, P.FLOOR_ACCENT);
    rect(g, 9, 8, 3, 1, P.FLOOR_ACCENT);
    rect(g, 12, 12, 2, 2, P.FLOOR_ACCENT);
    rect(g, 5, 11, 1, 2, P.FLOOR_ACCENT);
  });

  S.accent = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    // Raised carved floor stone
    rect(g, 0, 0, T, 1, P.FLOOR_ACCENT);
    rect(g, 0, 0, 1, T, P.FLOOR_ACCENT);
    rect(g, 0, T - 1, T, 1, P.VOID);
    rect(g, T - 1, 0, 1, T, P.VOID);
    g.globalAlpha = 0.6;
    rect(g, 4, 4, 8, 8, P.FLOOR_ACCENT);
    rect(g, 6, 6, 4, 4, P.FLOOR);
  });

  S.wall = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.WALL);
    // Wall top rim
    rect(g, 0, 0, T, 3, P.WALL_TOP);
    rect(g, 0, 0, T, 1, "#4d5975");
    // Mid drop line
    rect(g, 0, 3, T, 1, P.VOID);
    // Stone brick patterns
    g.globalAlpha = 0.55;
    rect(g, 0, 8, T, 1, P.VOID);
    rect(g, 7, 4, 1, 4, P.VOID);
    rect(g, 3, 9, 1, 7, P.VOID);
    rect(g, 12, 9, 1, 7, P.VOID);
    // Cast shadow at the base
    g.globalAlpha = 0.8;
    rect(g, 0, T - 2, T, 2, P.VOID);
  });

  bakeBiomeTiles(S, T, "dungeon", "#191d26", "#39445a", "#232834");
  bakeBiomeTiles(S, T, "caverns", "#16222e", "#2a4862", "#1e3f61");
  bakeBiomeTiles(S, T, "forge", "#25150c", "#4d2316", "#391c15");
  bakeBiomeTiles(S, T, "void", "#110a1c", "#2a163d", "#221033");
}

function buildParallaxSprites(S: Record<string, Sprite>): void {
  // --- distant parallax backdrops, baked at 640×360 and scrolled at 0.4x camera speed ---
  const bakeParallax = (id: string, paint: (g: CanvasRenderingContext2D) => void): void => {
    S[`parallax_${id}`] = bake(640, 360, 0, 0, paint);
  };
  bakeParallax("dungeon", (g) => {
    rect(g, 0, 0, 640, 360, "#0b0e14");
    // distant arches + pillars
    g.globalAlpha = 0.5;
    for (let i = 0; i < 7; i++) {
      const x = 24 + i * 88;
      const y = 140 + (i % 2) * 26;
      rect(g, x, y, 44, 360 - y, "#12161f");
      rect(g, x + 9, y - 26, 26, 28, "#12161f");
    }
    g.globalAlpha = 0.3;
    for (let i = 0; i < 5; i++) rect(g, 70 + i * 130, 64 + (i % 3) * 20, 8, 296, "#171c27");
    g.globalAlpha = 1;
  });
  bakeParallax("caverns", (g) => {
    rect(g, 0, 0, 640, 360, "#0a1016");
    // two rows of hanging stalactites
    for (let row = 0; row < 2; row++) {
      g.globalAlpha = row === 0 ? 0.55 : 0.3;
      const depth = 40 + row * 52;
      for (let i = 0; i < 14; i++) {
        const x = 12 + i * 46 + (row * 17) % 23;
        const h = depth + ((i * 37) % 30);
        for (let r = 0; r < h; r += 2) {
          const half = Math.max(1, 5 - Math.floor((r / h) * 5));
          rect(g, x - half, r, half * 2, 2, "#14222e");
        }
      }
    }
    g.globalAlpha = 0.2;
    for (let i = 0; i < 6; i++) rect(g, 40 + i * 104, 250 + (i % 2) * 18, 52, 110, "#0e1822");
    g.globalAlpha = 1;
  });
  bakeParallax("forge", (g) => {
    rect(g, 0, 0, 640, 360, "#140a06");
    // far furnace mouths glowing behind the haze
    for (let i = 0; i < 4; i++) {
      const x = 40 + i * 156;
      const glow = g.createRadialGradient(x + 40, 190, 4, x + 40, 190, 120);
      glow.addColorStop(0, "rgba(255, 110, 40, 0.5)");
      glow.addColorStop(1, "rgba(255, 110, 40, 0)");
      g.fillStyle = glow;
      g.fillRect(x - 60, 90, 200, 200);
      g.globalAlpha = 0.7;
      rect(g, x, 160, 80, 60, "#200f07");
      rect(g, x + 18, 176, 44, 28, "#ff5a3c");
      g.globalAlpha = 1;
    }
    // distant catwalk silhouettes
    g.globalAlpha = 0.4;
    for (let i = 0; i < 6; i++) rect(g, 20 + i * 104, 120 + (i % 2) * 14, 64, 6, "#1c0e08");
    g.globalAlpha = 1;
  });
  bakeParallax("void", (g) => {
    rect(g, 0, 0, 640, 360, "#0a0512");
    // nebula wisps
    for (let i = 0; i < 6; i++) {
      const x = 60 + ((i * 217) % 560);
      const y = 60 + ((i * 131) % 240);
      const r = 70 + ((i * 53) % 60);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(120, 60, 190, 0.28)");
      grad.addColorStop(0.6, "rgba(80, 40, 140, 0.12)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // floating shard silhouettes
    g.globalAlpha = 0.5;
    for (let i = 0; i < 10; i++) {
      const x = 30 + ((i * 149) % 590);
      const y = 40 + ((i * 83) % 280);
      const s = 4 + ((i * 13) % 10);
      rect(g, x, y, 1, s + 6, "#2a163d");
      rect(g, x - 1, y + s, 3, 4, "#221033");
    }
    g.globalAlpha = 1;
  });
}

function buildPropSprites(S: Record<string, Sprite>, T: number): void {
  S.crate = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 2, T, T - 2, P.WALL);
    rect(g, 0, 2, T, 2, P.WALL_TOP);
    rect(g, 1, 4, T - 2, T - 5, P.FLOOR_ACCENT);
    rect(g, 3, 7, T - 6, 4, P.WALL_TOP);
    rect(g, 0, 2, 1, T - 2, P.VOID);
    rect(g, T - 1, 2, 1, T - 2, P.VOID);
  });

  S.trap = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    rect(g, 1, 13, T - 2, 2, P.WALL);
    for (const x of [2, 7, 12]) {
      rect(g, x + 1, 5, 1, 3, P.ENEMY_BODY);
      rect(g, x, 8, 3, 5, P.ENEMY_BODY);
      rect(g, x, 12, 3, 1, P.ENEMY_SHADE);
    }
  });

  S.trap_spent = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.FLOOR);
    rect(g, 1, 13, T - 2, 2, P.WALL);
    for (const x of [2, 7, 12]) rect(g, x, 11, 3, 2, P.DOOR_LOCKED);
  });

  S.door_locked = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.WALL);
    rect(g, 2, 3, T - 4, T - 5, P.DOOR_LOCKED);
    rect(g, 4, 6, T - 8, 2, P.VOID);
    rect(g, 4, 11, T - 8, 2, P.VOID);
  });

  S.door_open = bake(T, T, 0, 0, (g) => {
    rect(g, 0, 0, T, T, P.VOID);
    rect(g, 1, 1, T - 2, T - 2, P.FLOOR);
    g.globalAlpha = 0.8;
    rect(g, 3, 3, T - 6, T - 6, P.DOOR_OPEN);
  });
}

function buildWeaponSprites(S: Record<string, Sprite>): void {
  // --- 5 Weapon Icons (16x16) ---
  S.weapon_katana = bake(16, 16, 8, 8, (g) => {
    // Handle wrap (bottom-left)
    rect(g, 2, 13, 2, 2, "#1a2233");
    rect(g, 3, 12, 2, 2, "#2b3952");
    // Gold Tsuba (guard)
    rect(g, 4, 10, 3, 2, "#ffd166");
    // Slender Katana Blade with cyan razor shine
    rect(g, 6, 8, 2, 3, "#bfe8ff");
    rect(g, 8, 6, 2, 3, "#bfe8ff");
    rect(g, 10, 4, 2, 3, "#e0f4ff");
    rect(g, 12, 2, 2, 3, "#ffffff");
    rect(g, 13, 1, 1, 2, "#7fd1ff"); // tip
  });

  S.weapon_greatsword = bake(16, 16, 8, 8, (g) => {
    // Pommel & grip
    rect(g, 7, 13, 2, 2, "#ffd166");
    rect(g, 7, 10, 2, 3, "#3d405b");
    // Wide crossguard
    rect(g, 4, 9, 8, 2, "#8d99ae");
    // Broad heavy blade
    rect(g, 5, 2, 6, 7, "#b8c0cc");
    rect(g, 6, 2, 4, 7, "#e2e7ed");
    rect(g, 7, 3, 2, 5, "#6c757d"); // center fuller
    // Blade point
    rect(g, 6, 0, 4, 2, "#ffffff");
  });

  S.weapon_dagger = bake(16, 16, 8, 8, (g) => {
    // Left Dagger
    rect(g, 2, 12, 2, 2, "#2b2d42");
    rect(g, 3, 10, 3, 1, "#ffd166");
    rect(g, 4, 7, 2, 3, "#ffda79");
    rect(g, 5, 5, 2, 2, "#ffffff");
    // Right Dagger
    rect(g, 12, 12, 2, 2, "#2b2d42");
    rect(g, 10, 10, 3, 1, "#ffd166");
    rect(g, 9, 7, 2, 3, "#ffda79");
    rect(g, 8, 5, 2, 2, "#ffffff");
    // Twin glint
    rect(g, 5, 4, 1, 1, "#ffd166");
    rect(g, 8, 4, 1, 1, "#ffd166");
  });

  S.weapon_spear = bake(16, 16, 8, 8, (g) => {
    // Long wooden pole
    rect(g, 2, 13, 2, 2, "#6f4e37");
    rect(g, 4, 11, 2, 2, "#8b5a2b");
    rect(g, 6, 9, 2, 2, "#8b5a2b");
    rect(g, 8, 7, 2, 2, "#8b5a2b");
    // Emerald tassel
    rect(g, 8, 9, 2, 2, "#06d6a0");
    // Spearhead
    rect(g, 10, 5, 3, 3, "#c8ff8a");
    rect(g, 12, 3, 3, 3, "#e2f9b8");
    rect(g, 14, 1, 2, 2, "#ffffff"); // sharp tip
  });

  S.weapon_whip = bake(16, 16, 8, 8, (g) => {
    // Handle
    rect(g, 1, 12, 3, 3, "#3d2b1f");
    rect(g, 3, 11, 2, 2, "#d4a373");
    // Coiling lash with crimson thorns
    rect(g, 5, 10, 2, 2, "#e0455a");
    rect(g, 7, 8, 2, 2, "#ff6b6b");
    rect(g, 9, 5, 2, 3, "#e0455a");
    rect(g, 11, 3, 3, 2, "#ff6b6b");
    rect(g, 13, 4, 2, 2, "#e0455a");
    rect(g, 12, 7, 2, 2, "#ff6b6b");
    rect(g, 10, 9, 2, 2, "#e0455a");
    rect(g, 8, 11, 2, 2, "#ffffff"); // crack tip
  });
}

function buildTorchSprites(S: Record<string, Sprite>): void {
  // --- Wall torch, 2 flicker frames (anchor: bottom-centre) ---
  const torchPaint = (g: CanvasRenderingContext2D, lean: number): void => {
    // iron sconce
    rect(g, 1, 6, 3, 2, "#4a3b2a");
    rect(g, 2, 5, 1, 2, "#2a2018");
    // wooden handle
    rect(g, 2, 3, 1, 3, "#6f4e37");
    // flame: tall teardrop that sways with `lean`
    rect(g, 2 + lean, 0, 2, 3, "#ff963f");
    rect(g, 2 + lean, 1, 2, 2, "#ffc35a");
    rect(g, 2 + lean, 1, 1, 1, "#ffe66b");
  };
  S.torch = bake(5, 8, 2, 7, (g) => torchPaint(g, 0));
  S.torch_flicker = bake(5, 8, 2, 7, (g) => torchPaint(g, -1));
}

function buildArtifactSprites(S: Record<string, Sprite>): void {
  for (const [index, artifact] of ARTIFACTS.entries()) {
    const color = ARTIFACT_COLORS[artifact.id];
    S[`artifact_${artifact.id}`] = bake(12, 12, 0, 0, (g) => {
      rect(g, 5, 0, 2, 1, color);
      rect(g, 3, 1, 6, 2, color);
      rect(g, 2, 3, 8, 5, color);
      rect(g, 3, 8, 6, 2, color);
      rect(g, 5, 10, 2, 1, color);
      rect(g, 4, 3, 2, 2, "#ffffff");
      rect(g, 6, 7, 3, 1, index % 2 === 0 ? "#1b1f28" : "#ffffff");
      if (index % 3 === 0) rect(g, 4, 6, 1, 2, "#ffffff");
      if (index % 3 === 1) rect(g, 7, 3, 2, 2, "#1b1f28");
      if (index % 3 === 2) rect(g, 5, 8, 2, 1, "#1b1f28");
    });
  }
}

export function facingOffsets(dir: number): { x: number; y: number } {
  const step = Math.round(((dir + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  const table = [
    [3, 0],
    [2, -2],
    [0, -3],
    [-2, -2],
    [-3, 0],
    [-2, 2],
    [0, 3],
    [2, 2],
  ];
  const v = table[step];
  return { x: v[0], y: v[1] };
}

/** mirror a sprite horizontally, keeping the feet anchor centred */
export function flipH(src: Sprite): Sprite {
  const c = document.createElement("canvas");
  c.width = src.w;
  c.height = src.h;
  const g = c.getContext("2d");
  if (g !== null) {
    g.translate(src.w, 0);
    g.scale(-1, 1);
    g.drawImage(src.c, 0, 0);
  }
  return { c, w: src.w, h: src.h, ax: src.w - src.ax, ay: src.ay };
}

/** re-bake a sprite with its bottom 3 rows (feet) shifted sideways: a leg shuffle */
function footShift(base: Sprite, dx: number): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    g.drawImage(base.c, 0, 0, base.w, base.h - 3, 0, 0, base.w, base.h - 3);
    g.drawImage(base.c, 0, base.h - 3, base.w, 3, dx, base.h - 3, base.w, 3);
  });
}

/** idle-breath: the whole body bobs down 1px, feet stay planted */
function bobDown(base: Sprite): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    g.drawImage(base.c, 0, 1);
  });
}

/**
 * Multi-frame clips derived from the baked base sprites: idle-breath (2 frames / 40 ticks)
 * and a 4-step walk (6 ticks) for the three heroes, a 3-step walk (8 ticks) for enemies.
 * Each set also carries mirrored frames for the right-facing direction.
 */
export function buildAnimSets(): Record<string, SpriteSet> {
  const S = buildSprites();
  const out: Record<string, SpriteSet> = {};
  const set = (key: string, frames: Sprite[], tickDur: number): void => {
    out[key] = { frames, mirrored: frames.map(flipH), tickDur };
  };

  for (const key of ["player_swordsman", "player_mage", "player_tank"]) {
    const base = S[key];
    if (!base) continue;
    set(`${key}_idle`, [copyOfSprite(base), bobDown(base)], 40);
    set(key, [footShift(base, -1), copyOfSprite(base), footShift(base, 1), copyOfSprite(base)], 6);
    // swing clip: windup lean-back → active lunge → recovery settle
    set(`${key}_attack`, [shiftX(base, 2), shiftX(base, -2), bobDown(base)], 3);
    // hurt clip: recoil lean-back → white flash
    set(`${key}_hurt`, [shiftX(base, 2), whiteOf(base)], 4);
  }
  for (const kind of ["chaser", "charger", "splitter", "small", "boss", "ranged", "teleporter", "healer", "exploder", "shielder", "sniper", "jumper", "warden", "golem", "king"] as const) {
    const key = enemyDef(kind).SPRITE_KEY;
    const base = S[key];
    if (!base) continue;
    set(key, [footShift(base, -1), copyOfSprite(base), footShift(base, 1)], 8);
    // attack clip: telegraph windup → strike lunge → recovery
    set(`${key}_attack`, [shiftX(base, 1), shiftX(base, -2), copyOfSprite(base)], 3);
    // spawn clip: materialize from a dither (3 frames)
    set(`${key}_spawn`, [
      materialize(base, 1, 0.3),
      materialize(base, 1, 0.6),
      materialize(base, 1, 0.9),
    ], 5);
    // death clip: crumble outward (4 frames)
    set(`${key}_death`, [
      scatter(base, 2, 0.8, 0.9),
      scatter(base, 2, 1.8, 0.7),
      scatter(base, 2, 2.8, 0.5),
      scatter(base, 2, 4, 0.3),
    ], 3);
  }
  return out;
}

function copyOfSprite(base: Sprite): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    g.drawImage(base.c, 0, 0);
  });
}

/** body shifted sideways: a windup lean-back / lunge lean-in (feet stay at ay) */
function shiftX(base: Sprite, dx: number): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    g.drawImage(base.c, dx, 0);
  });
}

/** re-bake the sprite as a solid white silhouette (hurt flash frame) */
function whiteOf(base: Sprite): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    g.drawImage(base.c, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, base.w, base.h);
  });
}

/** per-pixel deterministic hash so dissolve frames never perturb any seeded rng */
function pixelHash(x: number, y: number, seed: number): number {
  let h = ((x * 2654435761) ^ (y * 40503) ^ (seed * 97)) >>> 0;
  h = (h * 1664525 + 1013904223) >>> 0;
  return h / 4294967296;
}

/** materialize frame: a fraction of the body's pixels are present, dithered */
function materialize(base: Sprite, seed: number, keep: number): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    const img = g.getImageData(0, 0, base.w, base.h);
    const src = bake(base.w, base.h, 0, 0, (gg) => gg.drawImage(base.c, 0, 0));
    const data = src.c.getContext("2d")?.getImageData(0, 0, base.w, base.h).data;
    if (!data) return;
    for (let y = 0; y < base.h; y++) {
      for (let x = 0; x < base.w; x++) {
        const i = (y * base.w + x) * 4;
        if (data[i + 3] === 0) continue;
        if (pixelHash(x, y, seed) > keep) continue;
        img.data[i] = data[i];
        img.data[i + 1] = data[i + 1];
        img.data[i + 2] = data[i + 2];
        img.data[i + 3] = data[i + 3];
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** crumble frame: pixels scatter outward from the body centre and fade */
function scatter(base: Sprite, seed: number, amount: number, alpha: number): Sprite {
  return bake(base.w, base.h, base.ax, base.ay, (g) => {
    const src = bake(base.w, base.h, 0, 0, (gg) => gg.drawImage(base.c, 0, 0));
    const data = src.c.getContext("2d")?.getImageData(0, 0, base.w, base.h).data;
    if (!data) return;
    const cx = base.w / 2;
    for (let y = 0; y < base.h; y++) {
      for (let x = 0; x < base.w; x++) {
        const i = (y * base.w + x) * 4;
        if (data[i + 3] === 0) continue;
        const h1 = pixelHash(x, y, seed);
        const h2 = pixelHash(x, y, seed + 13);
        const dx = Math.round((h1 - 0.5) * 8 * amount + Math.sign(x + 0.5 - cx) * amount * 1.5);
        const dy = Math.round((h2 - 0.5) * 4 * amount - amount);
        g.globalAlpha = alpha * (0.4 + 0.6 * pixelHash(x, y, seed + 7));
        g.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
        g.fillRect(x + dx, y + dy, 1, 1);
      }
    }
    g.globalAlpha = 1;
  });
}

/** pixelfx slash recipe as ramp-indexed keyframes rather than baked sheets: geometry stays
 *  procedural so any reach/deg/dir draws without resampling pixels. The fourth phase
 *  (dotted residue) lives on the lingering slice, after the arc's life ends. */
export type SlashPhase = "windup" | "snap" | "followthrough";

export type SlashFrame = { phase: SlashPhase; intensity: number; ramp: number; width: number };

const SLASH_RAMP_CYAN: readonly string[] = [P.SLASH_CYAN_DEEP, P.SLASH_CYAN, P.SLASH, P.SLASH_EDGE];
const SLASH_RAMP_GOLD: readonly string[] = [P.SLASH_ORANGE_DEEP, P.SLASH_GOLD, P.SLASH, P.SLASH_EDGE];

export function slashRamp(combo: number): readonly string[] {
  return combo === 2 ? SLASH_RAMP_GOLD : SLASH_RAMP_CYAN;
}

/** `p` = elapsed fraction of the swing life, `contact` = startup / (startup + active).
 *  Boundaries are half-open so the phases tile [0,1] and intensity stays continuous:
 *  wind-up climbs to WINDUP_PEAK, the snap peaks at 1 on contact and falls back to that
 *  same peak, then the follow-through decays to zero. */
export function slashFrame(p: number, contact: number): SlashFrame {
  const fx = CONFIG.FX_SLASH;
  const x = Math.min(1, Math.max(0, p));
  const c = Math.min(1, Math.max(0, contact));
  const lo = Math.max(0, c - fx.SNAP_HALF);
  const hi = Math.min(1, c + fx.SNAP_HALF);
  if (x <= lo) {
    const t = lo <= 0 ? 1 : x / lo;
    return { phase: "windup", intensity: fx.WINDUP_PEAK * t, ramp: t < 0.5 ? 0 : 1, width: fx.WINDUP_WIDTH };
  }
  if (x < hi) {
    const d = Math.abs(x - c) / Math.max(1e-6, fx.SNAP_HALF);
    return { phase: "snap", intensity: 1 - (1 - fx.WINDUP_PEAK) * d, ramp: SLASH_RAMP_CYAN.length - 1, width: fx.SNAP_WIDTH };
  }
  const t = hi >= 1 ? 0 : (x - hi) / (1 - hi);
  return { phase: "followthrough", intensity: fx.WINDUP_PEAK * (1 - t), ramp: t < 0.5 ? 2 : 1, width: fx.FOLLOW_WIDTH };
}

/** offsets along the cut, centred on 0, spaced at least `gap` apart — a dotted residue, not a stroke */
export function residueDotPositions(len: number, gap: number): number[] {
  const n = Math.max(2, Math.floor(len / Math.max(1, gap)));
  return Array.from({ length: n }, (_, i) => -len / 2 + (len * i) / (n - 1));
}
