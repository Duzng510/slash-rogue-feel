import { body, EYE, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("shielder");
const S = shade("shielder");

/** base box 12x11; the two side plates are its identity, so they move as one shield */
export const shielder: PoseTable = {
  kind: "shielder",
  box: { w: 12, h: 11 },
  windup: [
    r(2, 2, 8, 8, B),
    r(1, 0, 10, 2, S),
    r(4, 5, 2, 2, EYE), r(7, 5, 1, 2, EYE),
    r(3, 10, 2, 1, VOID), r(7, 10, 2, 1, VOID),
  ],
  strike: [
    r(3, 1, 8, 9, B),
    r(0, 1, 4, 9, S),
    r(0, 1, 1, 9, B),
    r(6, 4, 2, 2, EYE), r(9, 4, 1, 2, EYE),
    r(4, 10, 2, 1, VOID), r(8, 10, 2, 1, VOID),
  ],
  recover: [
    r(2, 2, 8, 8, B),
    r(0, 3, 2, 7, S), r(10, 3, 2, 7, S),
    r(4, 4, 2, 2, EYE), r(7, 4, 1, 2, EYE),
    r(2, 9, 8, 2, S),
    r(3, 10, 2, 1, VOID), r(7, 10, 2, 1, VOID),
  ],
};
