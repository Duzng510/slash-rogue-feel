import { body, EYE, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("sniper");
const S = shade("sniper");

/** base box 9x13; the scope band and the rifle line are what the player must read at range */
export const sniper: PoseTable = {
  kind: "sniper",
  box: { w: 9, h: 13 },
  windup: [
    r(1, 0, 7, 1, S),
    r(2, 1, 5, 3, B),
    r(3, 2, 3, 1, EYE),
    r(3, 4, 3, 4, B),
    r(3, 8, 3, 3, B),
    r(2, 12, 2, 1, VOID), r(5, 12, 2, 1, VOID),
  ],
  strike: [
    r(3, 6, 3, 1, S),
    r(1, 7, 7, 4, B),
    r(0, 8, 2, 1, S),
    r(2, 8, 3, 1, EYE),
    r(6, 11, 3, 2, B),
    r(6, 12, 2, 1, VOID),
  ],
  recover: [
    r(5, 1, 3, 1, S),
    r(2, 2, 5, 4, B),
    r(3, 3, 3, 1, EYE),
    r(3, 6, 3, 5, B),
    r(4, 8, 1, 3, S),
    r(2, 11, 2, 1, VOID), r(5, 11, 2, 1, VOID),
  ],
};
