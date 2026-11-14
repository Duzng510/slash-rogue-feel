import { body, HEAL, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("healer");
const S = shade("healer");

/** base box 9x11; the cross on its chest is the tell, so the poses grow and release it */
export const healer: PoseTable = {
  kind: "healer",
  box: { w: 9, h: 11 },
  windup: [
    r(2, 0, 5, 2, B),
    r(1, 2, 7, 6, B),
    r(0, 1, 1, 2, B), r(8, 1, 1, 2, B),
    r(4, 1, 1, 6, HEAL), r(2, 4, 5, 1, HEAL),
    r(1, 8, 7, 1, S),
    r(2, 10, 2, 1, VOID), r(5, 10, 2, 1, VOID),
  ],
  strike: [
    r(2, 1, 5, 2, B),
    r(1, 3, 7, 5, B),
    r(0, 5, 9, 1, HEAL),
    r(4, 5, 1, 3, HEAL),
    r(0, 3, 1, 2, S), r(8, 3, 1, 2, S),
    r(1, 8, 7, 1, S),
    r(2, 10, 2, 1, VOID), r(5, 10, 2, 1, VOID),
  ],
  recover: [
    r(2, 1, 5, 2, B),
    r(1, 3, 7, 6, B),
    r(4, 5, 1, 3, HEAL), r(3, 6, 3, 1, HEAL),
    r(1, 9, 7, 1, S),
    r(2, 10, 2, 1, VOID), r(5, 10, 2, 1, VOID),
  ],
};
