import type { FrameData } from "../config.ts";

export type WeaponId = "katana" | "greatsword" | "dagger" | "spear" | "whip";

export type WeaponCombo = {
  fd: FrameData;
  reach: number;
  deg: number;
  dmg: number;
  knockback: number;
};

export type Weapon = {
  id: WeaponId;
  name: string;        // "Kiếm nhật", "Đại đao", "Song đao", "Thương", "Roi"
  desc: string;        // tiếng Việt
  color: string;
  combos: WeaponCombo[];
  chainWindow: number; // ticks
  hitStopMult: number;
  critChance: number;
  sprite: string;
};

export const WEAPONS: Record<WeaponId, Weapon> = {
  katana: {
    id: "katana",
    name: "Kiếm nhật",
    desc: "Cân bằng, hai đòn liên hoàn.",
    color: "#bfe8ff",
    combos: [
      { fd: { startup: 4, active: 3, recovery: 7 }, reach: 24, deg: 120, dmg: 1, knockback: 95 },
      { fd: { startup: 3, active: 3, recovery: 7 }, reach: 30, deg: 144, dmg: 1, knockback: 95 },
    ],
    chainWindow: 6,
    hitStopMult: 1,
    critChance: 0,
    sprite: "weapon_katana",
  },
  greatsword: {
    id: "greatsword",
    name: "Đại đao",
    desc: "Chậm, 1 nhát, arc 200°, sát thương 2.",
    color: "#a0a0a0",
    combos: [
      { fd: { startup: 9, active: 4, recovery: 14 }, reach: 34, deg: 200, dmg: 2, knockback: 180 },
    ],
    chainWindow: 0,
    hitStopMult: 2,
    critChance: 0,
    sprite: "weapon_greatsword",
  },
  dagger: {
    id: "dagger",
    name: "Song đao",
    desc: "3 đòn cực nhanh, 30% crit, phải áp sát.",
    color: "#ffd166",
    combos: [
      { fd: { startup: 2, active: 2, recovery: 4 }, reach: 18, deg: 70, dmg: 1, knockback: 40 },
      { fd: { startup: 2, active: 2, recovery: 4 }, reach: 18, deg: 70, dmg: 1, knockback: 40 },
      { fd: { startup: 3, active: 3, recovery: 6 }, reach: 20, deg: 90, dmg: 2, knockback: 80 },
    ],
    chainWindow: 5,
    hitStopMult: 0.7,
    critChance: 0.3,
    sprite: "weapon_dagger",
  },
  spear: {
    id: "spear",
    name: "Thương",
    desc: "Đâm xa 40px, arc hẹp 40°. An toàn.",
    color: "#c8ff8a",
    combos: [
      { fd: { startup: 6, active: 3, recovery: 10 }, reach: 40, deg: 40, dmg: 1, knockback: 60 },
    ],
    chainWindow: 0,
    hitStopMult: 1,
    critChance: 0,
    sprite: "weapon_spear",
  },
  whip: {
    id: "whip",
    name: "Roi",
    desc: "2 đòn quét rộng 180°, khống chế không gian.",
    color: "#e0455a",
    combos: [
      { fd: { startup: 4, active: 4, recovery: 9 }, reach: 30, deg: 160, dmg: 1, knockback: 80 },
      { fd: { startup: 3, active: 4, recovery: 11 }, reach: 36, deg: 180, dmg: 1, knockback: 100 },
    ],
    chainWindow: 7,
    hitStopMult: 0.9,
    critChance: 0,
    sprite: "weapon_whip",
  },
};

export const WEAPON_LIST: readonly WeaponId[] = ["katana", "greatsword", "dagger", "spear", "whip"];
