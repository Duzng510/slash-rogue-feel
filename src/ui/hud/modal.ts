import type { World } from "../../world/world.ts";
import { dialogueOptionAt, roomChoiceAt } from "../dialogueLayout.ts";
import type { ModalKey } from "../dialogueLayout.ts";

export function hitTestHudModal(world: World, x: number, y: number): ModalKey | null {
  if (world.dialogue !== null) {
    const node = world.dialogue.source.nodes[world.dialogue.nodeId];
    if (!node) return null;
    const option = dialogueOptionAt(x, y, node.options.length);
    return option === null ? null : `d:${option}`;
  }
  if (world.roomChoices !== null) {
    const i = roomChoiceAt(x, y, world.roomChoices.choices.length);
    if (i === null) return null;
    const choice = world.roomChoices.choices[i];
    return choice !== undefined && !choice.disabled ? `e:${i}` : null;
  }
  if (world.characterChoices.length > 0) {
    if (world.achievements.ascensionMax > 0 && y >= 164 && y <= 180) {
      if (x >= 104 && x <= 132) return "q:-";
      if (x >= 188 && x <= 216) return "q:+";
      return null;
    }
    if (y < 34 || y >= 164) return null;
    let i = -1;
    if (x >= 12 && x <= 104) i = 0;
    else if (x >= 114 && x <= 206) i = 1;
    else if (x >= 216 && x <= 308) i = 2;
    const id = i < 0 ? undefined : world.characterChoices[i];
    return id === undefined ? null : `p:${id}`;
  }
  if (world.shopOffers !== null) {
    if (y >= 166 && y <= 178 && x >= 16 && x <= 304) return "s:leave";
    if (y < 38 || y > 158) return null;
    let i = -1;
    if (x >= 12 && x <= 104) i = 0;
    else if (x >= 114 && x <= 206) i = 1;
    else if (x >= 216 && x <= 308) i = 2;
    if (i < 0 || i >= world.shopOffers.length) return null;
    return `s:${i}`;
  }
  if (world.curseOffer !== null && world.room.kind !== "shrine" && y >= 20 && y <= 32) {
    if (x >= 16 && x < 160) return "t:normal";
    if (x >= 160 && x <= 304) return "t:curse";
    return null;
  }
  const topY = world.curseOffer !== null ? 36 : 38;
  const botY = world.curseOffer !== null ? 142 : 166;
  if (y < topY || y > botY) return null;
  let i = -1;
  if (x >= 12 && x <= 104) i = 0;
  else if (x >= 114 && x <= 206) i = 1;
  else if (x >= 216 && x <= 308) i = 2;
  if (i < 0) return null;

  if (world.curseTab && world.curseOffer !== null) {
    const curse = i < 2 ? world.curseOffer.curses[i] : undefined;
    return curse ? `c:${curse.id}` : null;
  }
  const artifact = world.artifactChoices[i];
  return artifact && !world.artifacts.has(artifact.id) ? `a:${artifact.id}` : null;
}
