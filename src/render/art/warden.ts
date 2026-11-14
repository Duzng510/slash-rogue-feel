import { body, EYE, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("warden");
const S = shade("warden");

/** base box 16x16; an emitter brute — arms up, sweep, then shut down */
export const warden: PoseTable = {
  kind: "warden",
  box: { w: 16, h: 16 },
  windup: [
    r(0, 0, 4, 5, S), r(12, 0, 4, 5, S),
    r(2, 4, 12, 10, B),
    r(2, 4, 12, 2, S),
    r(4, 7, 3, 1, EYE), r(9, 7, 3, 1, EYE),
    r(6, 10, 4, 3, S),
    r(4, 14, 3, 2, VOID), r(9, 14, 3, 2, VOID),
  ],
  strike: [
    r(0, 6, 16, 3, S),
    r(1, 7, 14, 6, B),
    r(0, 5, 2, 2, B), r(14, 5, 2, 2, B),
    r(4, 9, 3, 1, EYE), r(9, 9, 3, 1, EYE),
    r(1, 13, 14, 2, S),
    r(4, 15, 3, 1, VOID), r(9, 15, 3, 1, VOID),
  ],
  recover: [
    r(2, 3, 2, 2, S), r(12, 3, 2, 2, S),
    r(1, 5, 14, 10, B),
    r(1, 5, 14, 2, S),
    r(3, 10, 10, 3, S),
    r(5, 8, 2, 1, EYE), r(9, 8, 2, 1, EYE),
    r(4, 15, 3, 1, VOID), r(9, 15, 3, 1, VOID),
  ],
};
