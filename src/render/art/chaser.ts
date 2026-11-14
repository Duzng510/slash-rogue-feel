import { body, eyes, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("chaser");
const S = shade("chaser");

/** base box is 12x13 with the feet line at y=12 (pixelart.ts buildEnemySprites) */
export const chaser: PoseTable = {
  kind: "chaser",
  box: { w: 12, h: 13 },
  idle: [
    [
      r(1, 0, 2, 3, S), r(9, 0, 2, 3, S),
      r(2, 2, 8, 8, B),
      r(1, 3, 1, 7, VOID), r(10, 3, 1, 7, VOID),
      r(2, 9, 8, 2, S),
      r(2, 11, 2, 2, VOID), r(8, 11, 2, 2, VOID),
      ...eyes(3, 4, 2, 2), ...eyes(7, 4, 2, 2),
    ],
    [
      r(1, 1, 2, 2, S), r(9, 1, 2, 2, S),
      r(2, 3, 8, 7, B),
      r(1, 4, 1, 6, VOID), r(10, 4, 1, 6, VOID),
      r(1, 10, 10, 2, S),
      r(2, 12, 2, 1, VOID), r(8, 12, 2, 1, VOID),
      ...eyes(3, 5, 2, 2), ...eyes(7, 5, 2, 2),
    ],
  ],
  // coil: mass drops and spreads, horns splay wide, eyes narrow to a slit
  windup: [
    r(0, 2, 3, 2, S), r(9, 2, 3, 2, S),
    r(1, 4, 10, 7, B),
    r(0, 5, 1, 6, VOID), r(11, 5, 1, 6, VOID),
    r(1, 9, 10, 3, S),
    ...eyes(3, 6, 2, 1), ...eyes(7, 6, 2, 1),
    r(0, 11, 3, 2, VOID), r(9, 11, 3, 2, VOID),
  ],
  // strike: everything goes up and thin, claws lead above the head
  strike: [
    r(2, 0, 2, 3, S), r(8, 0, 2, 3, S),
    r(1, 2, 2, 5, S), r(9, 2, 2, 5, S),
    r(3, 2, 6, 8, B),
    r(2, 3, 1, 6, VOID), r(9, 3, 1, 6, VOID),
    r(3, 9, 6, 2, S),
    ...eyes(4, 4, 2, 2), ...eyes(7, 4, 2, 2),
    r(3, 11, 2, 2, VOID), r(7, 11, 2, 2, VOID),
  ],
  // recover: lands heavy, arms still hanging, head low
  recover: [
    r(1, 1, 2, 3, S), r(9, 1, 2, 3, S),
    r(2, 3, 8, 8, B),
    r(1, 4, 1, 7, VOID), r(10, 4, 1, 7, VOID),
    r(0, 8, 2, 4, S), r(10, 8, 2, 4, S),
    r(2, 10, 8, 2, S),
    ...eyes(4, 6, 2, 2), ...eyes(7, 6, 2, 2),
    r(2, 12, 2, 1, VOID), r(8, 12, 2, 1, VOID),
  ],
};
