import { body, eyes, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("splitter");
const S = shade("splitter");

/** base box 13x11; the splitter reads as one mass with a centre seam that opens */
export const splitter: PoseTable = {
  kind: "splitter",
  box: { w: 13, h: 11 },
  windup: [
    r(0, 0, 5, 10, B), r(8, 0, 5, 10, B),
    r(5, 1, 3, 8, VOID),
    r(0, 0, 5, 1, S), r(8, 0, 5, 1, S),
    r(0, 8, 5, 2, S), r(8, 8, 5, 2, S),
    ...eyes(1, 3, 2, 2), ...eyes(10, 3, 2, 2),
    r(1, 10, 2, 1, VOID), r(10, 10, 2, 1, VOID),
  ],
  strike: [
    r(0, 1, 6, 9, B), r(7, 1, 6, 9, B),
    r(5, 1, 1, 9, S), r(7, 1, 1, 9, S),
    r(0, 1, 6, 1, S), r(7, 1, 6, 1, S),
    r(0, 8, 6, 2, S), r(7, 8, 6, 2, S),
    ...eyes(1, 2, 2, 2), ...eyes(10, 2, 2, 2),
    r(0, 10, 3, 1, VOID), r(10, 10, 3, 1, VOID),
  ],
  recover: [
    r(1, 2, 11, 8, B),
    r(0, 4, 13, 4, B),
    r(6, 2, 1, 8, S),
    r(1, 2, 11, 1, S), r(1, 9, 11, 1, S),
    ...eyes(2, 4, 2, 2), ...eyes(9, 4, 2, 2),
    r(3, 10, 2, 1, VOID), r(8, 10, 2, 1, VOID),
  ],
};
