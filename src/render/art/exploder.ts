import { body, EYE, HIT, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("exploder");
const S = shade("exploder");

/** base box 11x12; it swells, goes white-hot, then sags — volume is the whole telegraph */
export const exploder: PoseTable = {
  kind: "exploder",
  box: { w: 11, h: 12 },
  windup: [
    r(5, 0, 1, 3, EYE),
    r(0, 3, 11, 6, B),
    r(0, 8, 11, 2, S),
    r(3, 4, 5, 4, S),
    r(5, 5, 1, 1, EYE),
    r(1, 10, 3, 1, VOID), r(7, 10, 3, 1, VOID),
  ],
  strike: [
    r(5, 0, 1, 2, EYE),
    r(2, 2, 7, 7, B),
    r(4, 4, 3, 3, HIT),
    r(2, 9, 7, 1, S),
    r(3, 10, 2, 1, VOID), r(6, 10, 2, 1, VOID),
  ],
  recover: [
    r(5, 1, 1, 1, EYE),
    r(1, 4, 9, 5, B),
    r(4, 5, 3, 2, S),
    r(1, 8, 9, 2, S),
    r(2, 10, 2, 1, VOID), r(7, 10, 2, 1, VOID),
  ],
};
