import { body, EYE, GOLEM_RUNE, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("golem");
const S = shade("golem");

/** base box 24x20; a slab brute — fists overhead, ground slam, leaning recovery */
export const golem: PoseTable = {
  kind: "golem",
  box: { w: 24, h: 20 },
  windup: [
    r(0, 0, 5, 6, S), r(19, 0, 5, 6, S),
    r(2, 6, 1, 11, S), r(21, 6, 1, 11, S),
    r(3, 5, 18, 12, B),
    r(3, 5, 18, 2, S),
    r(6, 8, 4, 3, EYE), r(14, 8, 4, 3, EYE),
    r(7, 9, 2, 1, VOID), r(15, 9, 2, 1, VOID),
    r(11, 10, 2, 4, GOLEM_RUNE),
    r(8, 14, 2, 2, GOLEM_RUNE), r(14, 14, 2, 2, GOLEM_RUNE),
    r(5, 17, 4, 2, VOID), r(15, 17, 4, 2, VOID),
  ],
  strike: [
    r(0, 14, 6, 4, S), r(18, 14, 6, 4, S),
    r(1, 8, 22, 9, B),
    r(1, 8, 22, 2, S),
    r(5, 11, 4, 2, EYE), r(15, 11, 4, 2, EYE),
    r(11, 12, 2, 3, GOLEM_RUNE),
    r(6, 18, 4, 2, VOID), r(14, 18, 4, 2, VOID),
  ],
  recover: [
    r(0, 10, 4, 8, S), r(20, 5, 4, 5, S),
    r(3, 7, 1, 11, S), r(20, 7, 1, 11, S),
    r(4, 6, 16, 12, B),
    r(7, 10, 3, 3, EYE), r(14, 10, 3, 3, EYE),
    r(11, 13, 2, 2, GOLEM_RUNE),
    r(6, 18, 4, 2, VOID), r(14, 18, 4, 2, VOID),
  ],
};
