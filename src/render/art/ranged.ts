import { body, PROJ, r, shade, VOID, EYE, type PoseTable } from "./kit.ts";

const B = body("ranged");
const S = shade("ranged");

/** base box 9x12; the held shot is the readable prop, so it moves through the three slots */
export const ranged: PoseTable = {
  kind: "ranged",
  box: { w: 9, h: 12 },
  windup: [
    r(3, 0, 3, 1, PROJ),
    r(2, 2, 5, 3, B),
    r(1, 5, 7, 5, B),
    r(3, 3, 1, 1, EYE), r(5, 3, 1, 1, EYE),
    r(2, 10, 5, 1, S),
    r(2, 11, 2, 1, VOID), r(5, 11, 2, 1, VOID),
  ],
  strike: [
    r(3, 0, 3, 1, S),
    r(2, 1, 5, 3, B),
    r(1, 4, 7, 6, B),
    r(0, 5, 2, 2, B),
    r(0, 4, 1, 1, PROJ),
    r(3, 2, 1, 1, EYE), r(5, 2, 1, 1, EYE),
    r(2, 10, 5, 1, S),
    r(2, 11, 2, 1, VOID), r(5, 11, 2, 1, VOID),
  ],
  recover: [
    r(4, 0, 3, 1, S),
    r(3, 1, 5, 3, B),
    r(2, 4, 7, 6, B),
    r(6, 7, 3, 2, B),
    r(4, 2, 1, 1, EYE), r(6, 2, 1, 1, EYE),
    r(3, 10, 5, 1, S),
    r(3, 11, 2, 1, VOID), r(6, 11, 2, 1, VOID),
  ],
};
