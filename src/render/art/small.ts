import { body, eyes, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("small");
const S = shade("small");

/** base box 7x8 — the swarm unit; squash and stretch carry the whole read */
export const small: PoseTable = {
  kind: "small",
  box: { w: 7, h: 8 },
  windup: [
    r(1, 3, 5, 1, B),
    r(0, 4, 7, 3, B),
    ...eyes(2, 5, 2, 2),
    r(1, 7, 2, 1, VOID), r(4, 7, 2, 1, VOID),
  ],
  strike: [
    r(1, 1, 5, 4, B),
    r(2, 0, 3, 7, B),
    ...eyes(2, 2, 2, 2),
    r(2, 7, 1, 1, VOID), r(4, 7, 1, 1, VOID),
  ],
  recover: [
    r(1, 2, 5, 5, B),
    r(0, 3, 7, 3, B),
    r(1, 5, 5, 2, S),
    ...eyes(2, 3, 2, 2),
    r(1, 7, 2, 1, VOID), r(4, 7, 2, 1, VOID),
  ],
};
