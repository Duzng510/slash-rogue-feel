import { body, EYE, r, shade, type PoseTable } from "./kit.ts";

const B = body("teleporter");
const S = shade("teleporter");

/** base box 9x11; it blinks, so the poses trade volume for a smear */
export const teleporter: PoseTable = {
  kind: "teleporter",
  box: { w: 9, h: 11 },
  windup: [
    r(4, 0, 1, 1, B),
    r(3, 1, 3, 2, B),
    r(2, 3, 5, 4, B),
    r(1, 2, 1, 3, S), r(7, 2, 1, 3, S),
    r(3, 3, 1, 1, EYE), r(5, 3, 1, 1, EYE),
    r(3, 7, 3, 2, S),
  ],
  strike: [
    r(0, 4, 9, 3, B),
    r(0, 3, 2, 1, S), r(7, 3, 2, 1, S),
    r(3, 5, 1, 1, EYE), r(5, 5, 1, 1, EYE),
    r(1, 7, 7, 1, S),
  ],
  recover: [
    r(4, 1, 1, 1, B),
    r(2, 2, 3, 4, B),
    r(5, 3, 3, 4, B),
    r(1, 4, 1, 2, S), r(7, 4, 1, 2, S),
    r(3, 3, 1, 1, EYE), r(6, 4, 1, 1, EYE),
    r(3, 9, 3, 1, S),
  ],
};
