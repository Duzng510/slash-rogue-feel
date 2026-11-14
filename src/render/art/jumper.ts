import { body, EYE, r, shade, type PoseTable } from "./kit.ts";

const B = body("jumper");
const S = shade("jumper");

/** base box 9x10; it leaps, so the poses are coil → airborne → sprawl */
export const jumper: PoseTable = {
  kind: "jumper",
  box: { w: 9, h: 10 },
  windup: [
    r(3, 2, 3, 1, B),
    r(2, 3, 5, 4, B),
    r(3, 4, 1, 1, EYE), r(5, 4, 1, 1, EYE),
    r(1, 6, 2, 2, S), r(6, 6, 2, 2, S),
    r(1, 8, 7, 1, S),
  ],
  strike: [
    r(3, 0, 3, 2, B),
    r(2, 2, 5, 5, B),
    r(3, 3, 1, 1, EYE), r(5, 3, 1, 1, EYE),
    r(0, 6, 3, 2, S), r(6, 6, 3, 2, S),
    r(0, 8, 2, 1, B), r(7, 8, 2, 1, B),
  ],
  recover: [
    r(0, 7, 2, 2, B), r(7, 7, 2, 2, B),
    r(2, 8, 2, 2, S), r(5, 8, 2, 2, S),
    r(1, 9, 3, 1, B), r(5, 9, 3, 1, B),
    r(2, 5, 5, 3, B),
    r(3, 6, 1, 1, EYE), r(5, 6, 1, 1, EYE),
  ],
};
