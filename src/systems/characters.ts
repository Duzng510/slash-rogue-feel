import { blocked } from "../world/collision.ts";
import { dist } from "../mathx.ts";
import { artifactText, sfx, shake } from "../events.ts";
import { hitFeedback } from "./combat.ts";
import type { Sim, Swing } from "../sim/types.ts";

export type CharacterId = "swordsman" | "mage" | "tank";

export type CharacterDef = {
  id: CharacterId;
  name: string;
  desc: string;
  color: string;
  baseHp: number;
  speedMult: number;
  damageMult: number;
  skillName: string;
  skillDesc: string;
  skillCd: number;
  passiveName: string;
  passiveDesc: string;
};

/** swordsman's passive: N landed hits inside the window arm the next hit bonus */
export const COMBO_HITS = 5;
export const COMBO_WINDOW = 180;

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  swordsman: {
    id: "swordsman",
    name: "Kiếm Khách",
    desc: "Cân đối, combos mạnh.",
    color: "#4da3ff",
    baseHp: 5,
    speedMult: 1,
    damageMult: 1,
    skillName: "Bộ Pháp",
    skillDesc: "Lướt 80px, chém 2 sát thương quanh chỗ mới.",
    skillCd: 180,
    passiveName: "Liên Hoàn",
    passiveDesc: "5 trúng đòn trong 3s: đòn sau +50%.",
  },
  mage: {
    id: "mage",
    name: "Pháp Sư",
    desc: "Mỏng, đòn nặng, tầm xa.",
    color: "#c99ae6",
    baseHp: 3,
    speedMult: 1,
    damageMult: 1.2,
    skillName: "Cầu Lửa",
    skillDesc: "Bắn cầu lửa 2 sát thương, đốt cháy.",
    skillCd: 240,
    passiveName: "Cộng Hưởng",
    passiveDesc: "Quái đang mang trạng thái: +30% sát thương.",
  },
  tank: {
    id: "tank",
    name: "Khiên Sĩ",
    desc: "Bò, chậm, lắm máu.",
    color: "#ff5a3c",
    baseHp: 7,
    speedMult: 0.85,
    damageMult: 0.75,
    skillName: "Khiên Chắn",
    skillDesc: "90 đòn bất tử, phản 2 sát thương quanh mình.",
    skillCd: 360,
    passiveName: "Bền Bỉ",
    passiveDesc: "Đẩy lùi nửa mức, hạ 1 quái hồi 1 máu.",
  },
};

export const CHARACTER_LIST: CharacterId[] = ["swordsman", "mage", "tank"];

function aimDir(src: Sim, mx: number, my: number): number {
  const p = src.player;
  return mx !== 0 || my !== 0 ? Math.atan2(my, mx) : p.facing;
}

/** one enemy around the player takes the area hit of a skill */
function blastAt(src: Sim, dmg: number, x: number, y: number, radius: number, knockback: number): void {
  const blast = {
    side: "player",
    combo: 0,
    dir: 0,
    ox: x,
    oy: y,
    reach: 0,
    deg: 0,
    dmg,
    knockback,
  } as unknown as Swing;
  for (const e of src.enemies.slice()) {
    if (e.dead || !e.canBeHit()) continue;
    if (dist(e.x, e.y, x, y) > radius) continue;
    const killed = e.onHit(blast, e.x, e.y, src);
    hitFeedback(src, e, blast, e.x, e.y, killed, false);
  }
}

export function executeSkill(id: CharacterId, src: Sim): void {
  const p = src.player;
  switch (id) {
    case "swordsman": {
      const dir = aimDir(src, p.vx, p.vy);
      const ox = p.x;
      const oy = p.y;
      let step = 0;
      while (step < 80 && !blocked(src.room, p.x + Math.cos(dir) * (step + 6), p.y + Math.sin(dir) * (step + 6), p.bodyW, p.bodyH)) step += 6;
      p.x += Math.cos(dir) * step;
      p.y += Math.sin(dir) * step;
      blastAt(src, 2, p.x, p.y, 18, 24);
      src.particles.afterimage(ox, oy - 14, "player");
      sfx(src.queue, "teleport", 0.7, 1.2);
      break;
    }
    case "mage": {
      const dir = aimDir(src, p.vx, p.vy);
      src.projectiles.push({
        x: p.x,
        y: p.y - 5,
        vx: Math.cos(dir) * 180,
        vy: Math.sin(dir) * 180,
        dmg: 2,
        ticksLeft: 90,
        owner: "player",
        status: "burn",
      });
      sfx(src.queue, "shoot", 0.9, 1.3);
      break;
    }
    case "tank": {
      p.skillActiveTicks = 90;
      artifactText(src.queue, p.x, p.y - 14, "KHIÊN", "#8ab4ff");
      shake(src.queue, p.x, p.y, p.facing, 0.6);
      sfx(src.queue, "reprisal_ready", 0.9, 0.8);
      break;
    }
  }
}
