import type { Player } from "../entities/player.ts";

export type RigPart = "cape" | "legs" | "torso" | "head" | "leftArm" | "rightArm" | "weapon";
export type RigTransform = { x: number; y: number; rotation: number; scaleX: number; scaleY: number };
export type PlayerRigPose = Record<RigPart, RigTransform>;

const REST: PlayerRigPose = {
  cape: { x: 0, y: -11, rotation: 0, scaleX: 1, scaleY: 1 },
  legs: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  torso: { x: 0, y: -12, rotation: 0, scaleX: 1, scaleY: 1 },
  head: { x: 0, y: -8, rotation: 0, scaleX: 1, scaleY: 1 },
  leftArm: { x: -5, y: -10, rotation: -0.08, scaleX: 1, scaleY: 1 },
  rightArm: { x: 5, y: -10, rotation: 0.08, scaleX: 1, scaleY: 1 },
  weapon: { x: 5, y: -9, rotation: 0, scaleX: 1, scaleY: 1 },
};

const WINDUP: PlayerRigPose = {
  cape: { x: -1, y: -11, rotation: -0.12, scaleX: 1, scaleY: 1 },
  legs: { x: -1, y: 0, rotation: -0.04, scaleX: 0.96, scaleY: 1.02 },
  torso: { x: -1, y: -12, rotation: -0.1, scaleX: 0.98, scaleY: 1.02 },
  head: { x: -1, y: -8, rotation: -0.16, scaleX: 0.98, scaleY: 1.02 },
  leftArm: { x: -5, y: -10, rotation: -0.42, scaleX: 1, scaleY: 1 },
  rightArm: { x: 4, y: -10, rotation: -0.9, scaleX: 1, scaleY: 1 },
  weapon: { x: 4, y: -10, rotation: -0.5, scaleX: 1, scaleY: 1 },
};

const STRIKE: PlayerRigPose = {
  cape: { x: 1, y: -11, rotation: 0.16, scaleX: 1.08, scaleY: 0.94 },
  legs: { x: 1, y: 0, rotation: 0.08, scaleX: 1.08, scaleY: 0.96 },
  torso: { x: 1, y: -12, rotation: 0.12, scaleX: 1.08, scaleY: 0.96 },
  head: { x: 1, y: -8, rotation: 0.14, scaleX: 1.04, scaleY: 0.98 },
  leftArm: { x: -4, y: -10, rotation: 0.42, scaleX: 1.06, scaleY: 0.96 },
  rightArm: { x: 6, y: -8, rotation: 0.48, scaleX: 1.08, scaleY: 0.94 },
  weapon: { x: 7, y: -8, rotation: 0.16, scaleX: 1, scaleY: 1 },
};

const RECOVER: PlayerRigPose = {
  cape: { x: 0, y: -11, rotation: -0.04, scaleX: 1, scaleY: 1 },
  legs: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  torso: { x: 0.3, y: -12, rotation: -0.03, scaleX: 1, scaleY: 1 },
  head: { x: 0.2, y: -8, rotation: -0.03, scaleX: 1, scaleY: 1 },
  leftArm: { x: -5, y: -10, rotation: 0.08, scaleX: 1, scaleY: 1 },
  rightArm: { x: 5, y: -9, rotation: 0.14, scaleX: 1, scaleY: 1 },
  weapon: { x: 5, y: -9, rotation: -0.12, scaleX: 1, scaleY: 1 },
};

function ease(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function blend(a: PlayerRigPose, b: PlayerRigPose, t: number): PlayerRigPose {
  const k = ease(t);
  const pose = {} as PlayerRigPose;
  for (const part of Object.keys(REST) as RigPart[]) {
    pose[part] = {
      x: a[part].x + (b[part].x - a[part].x) * k,
      y: a[part].y + (b[part].y - a[part].y) * k,
      rotation: a[part].rotation + (b[part].rotation - a[part].rotation) * k,
      scaleX: a[part].scaleX + (b[part].scaleX - a[part].scaleX) * k,
      scaleY: a[part].scaleY + (b[part].scaleY - a[part].scaleY) * k,
    };
  }
  return pose;
}

export function playerRigPose(player: Player, tick: number): PlayerRigPose {
  const swing = player.swing;
  if (player.state === "attack" && swing !== null) {
    if (swing.phase === "startup") return blend(REST, WINDUP, 1 - swing.ticksLeft / Math.max(1, swing.fd.startup));
    if (swing.phase === "active") return blend(WINDUP, STRIKE, 1 - swing.ticksLeft / Math.max(1, swing.fd.active));
    return blend(STRIKE, RECOVER, 1 - swing.ticksLeft / Math.max(1, swing.fd.recovery));
  }

  const pose = blend(REST, REST, 1);
  const moving = Math.hypot(player.vx, player.vy) > 8;
  const stride = moving ? Math.sin(tick * 0.65) : Math.sin(tick * 0.1) * 0.2;
  pose.torso.y += Math.abs(stride) * 0.35;
  pose.head.y += Math.abs(stride) * 0.25;
  pose.leftArm.rotation += stride * 0.25;
  pose.rightArm.rotation -= stride * 0.25;
  if (player.state === "hurt") {
    pose.head.rotation = -0.12;
    pose.torso.rotation = -0.08;
    pose.leftArm.rotation = -0.55;
    pose.rightArm.rotation = 0.5;
  } else if (player.state === "dash") {
    pose.torso.scaleX = 1.12;
    pose.torso.scaleY = 0.84;
    pose.head.y -= 1;
    pose.leftArm.rotation = -0.4;
    pose.rightArm.rotation = 0.4;
  }
  return pose;
}
