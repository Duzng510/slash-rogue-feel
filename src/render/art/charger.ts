import { body, eyes, r, rows, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("charger");
const S = shade("charger");

/** base box is 13x12 with the feet line at y=11; the charger attacks down a lane */
export const charger: PoseTable = {
  kind: "charger",
  box: { w: 13, h: 12 },
  idle: [
    [
      ...rows(6, 0, [1, 3, 5, 7, 9, 11, 11, 9, 7, 5, 3], B),
      r(2, 5, 9, 2, S),
      ...eyes(5, 3, 3, 2),
      r(3, 11, 2, 1, VOID), r(8, 11, 2, 1, VOID),
    ],
    [
      ...rows(6, 1, [1, 3, 5, 7, 9, 11, 11, 9, 7, 5], B),
      r(2, 6, 9, 2, S),
      ...eyes(5, 4, 3, 2),
      r(3, 11, 2, 1, VOID), r(8, 11, 2, 1, VOID),
    ],
  ],
  // windup: the whole dome sinks to the floor and the crest drops
  windup: [
    ...rows(6, 4, [3, 7, 11, 13, 13, 11, 9, 7], B),
    r(6, 1, 1, 3, S),
    r(2, 7, 9, 2, S),
    ...eyes(5, 6, 3, 2),
    r(2, 11, 3, 1, VOID), r(8, 11, 3, 1, VOID),
  ],
  // strike: the dome flattens and stretches low, snout and tusk lead, tail spikes up
  strike: [
    ...rows(6, 3, [4, 8, 12, 12, 10, 8, 6, 4], B),
    r(0, 5, 2, 3, B),
    r(0, 4, 2, 1, VOID),
    r(11, 2, 2, 4, S),
    r(2, 8, 9, 2, S),
    ...eyes(3, 5, 2, 2),
    r(3, 11, 2, 1, VOID), r(8, 11, 2, 1, VOID),
  ],
  // recover: springs back upright and narrow, crest high
  recover: [
    ...rows(6, 0, [3, 5, 7, 9, 9, 9, 7, 5, 3, 3], B),
    r(3, 1, 2, 2, S), r(8, 1, 2, 2, S),
    r(4, 7, 5, 2, S),
    ...eyes(5, 3, 2, 2), ...eyes(7, 3, 2, 2),
    r(4, 10, 2, 2, VOID), r(7, 10, 2, 2, VOID),
  ],
};
