import { body, BOSS_RIM, eyes, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("boss");
const S = shade("boss");

/** base box is 20x18 with the feet line at y=17 */
export const boss: PoseTable = {
  kind: "boss",
  box: { w: 20, h: 18 },
  idle: [
    [
      r(0, 2, 20, 14, BOSS_RIM),
      r(2, 2, 16, 13, B),
      r(4, 0, 3, 2, S), r(13, 0, 3, 2, S),
      r(2, 2, 16, 2, S),
      r(2, 12, 16, 3, S),
      ...eyes(5, 6, 3, 3), ...eyes(12, 6, 3, 3),
      r(4, 16, 4, 2, VOID), r(12, 16, 4, 2, VOID),
    ],
    [
      r(0, 3, 20, 14, BOSS_RIM),
      r(2, 3, 16, 13, B),
      r(4, 1, 3, 2, S), r(13, 1, 3, 2, S),
      r(2, 3, 16, 2, S),
      r(2, 13, 16, 3, S),
      ...eyes(5, 7, 3, 3), ...eyes(12, 7, 3, 3),
      r(4, 16, 4, 2, VOID), r(12, 16, 4, 2, VOID),
    ],
  ],
  // windup: both arms go over the head and the chest opens up
  windup: [
    r(0, 0, 4, 6, BOSS_RIM), r(16, 0, 4, 6, BOSS_RIM),
    r(2, 3, 16, 14, BOSS_RIM),
    r(3, 4, 14, 12, B),
    r(5, 2, 3, 2, S), r(12, 2, 3, 2, S),
    r(3, 4, 14, 2, S),
    r(3, 14, 14, 2, S),
    ...eyes(6, 8, 2, 2), ...eyes(12, 8, 2, 2),
    r(5, 16, 3, 2, VOID), r(12, 16, 3, 2, VOID),
  ],
  // strike: flattened wide into the floor, fists driven down either side
  strike: [
    r(1, 6, 18, 12, BOSS_RIM),
    r(2, 7, 16, 10, B),
    r(0, 8, 3, 7, BOSS_RIM), r(17, 8, 3, 7, BOSS_RIM),
    r(0, 14, 4, 3, S), r(16, 14, 4, 3, S),
    r(4, 5, 3, 2, S), r(13, 5, 3, 2, S),
    r(2, 7, 16, 2, S),
    ...eyes(5, 11, 3, 2), ...eyes(12, 11, 3, 2),
    r(4, 17, 4, 1, VOID), r(12, 17, 4, 1, VOID),
  ],
  // recover: hunched over to one side, one arm still dragging
  recover: [
    r(3, 4, 15, 14, BOSS_RIM),
    r(4, 5, 13, 12, B),
    r(6, 3, 3, 2, S), r(14, 3, 3, 2, S),
    r(1, 9, 3, 6, S),
    r(4, 15, 13, 2, S),
    ...eyes(7, 9, 2, 2), ...eyes(13, 9, 2, 2),
    r(5, 17, 3, 1, VOID), r(13, 17, 3, 1, VOID),
  ],
  tickDur: 10,
};
