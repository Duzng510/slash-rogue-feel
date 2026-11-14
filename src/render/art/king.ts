import { body, KING_CROWN, KING_EYE, r, shade, VOID, type PoseTable } from "./kit.ts";

const B = body("king");
const S = shade("king");

/** base box 20x18; the crowned boss — arms wide, robe flare, hands clasped */
export const king: PoseTable = {
  kind: "king",
  box: { w: 20, h: 18 },
  windup: [
    r(3, 1, 14, 2, KING_CROWN),
    r(4, 0, 2, 2, KING_CROWN), r(9, 0, 2, 2, KING_CROWN), r(14, 0, 2, 2, KING_CROWN),
    r(0, 0, 3, 5, S), r(17, 0, 3, 5, S),
    r(2, 3, 16, 2, S),
    r(3, 4, 14, 12, B),
    r(5, 6, 3, 3, KING_EYE), r(12, 6, 3, 3, KING_EYE),
    r(6, 7, 1, 1, VOID), r(13, 7, 1, 1, VOID),
    r(5, 16, 4, 2, VOID), r(11, 16, 4, 2, VOID),
  ],
  strike: [
    r(2, 7, 16, 9, S),
    r(3, 8, 14, 7, B),
    r(0, 8, 3, 6, S), r(17, 8, 3, 6, S),
    r(0, 7, 3, 2, B), r(17, 7, 3, 2, B),
    r(3, 5, 14, 2, KING_CROWN),
    r(4, 4, 2, 2, KING_CROWN), r(9, 4, 2, 2, KING_CROWN), r(14, 4, 2, 2, KING_CROWN),
    r(5, 10, 3, 2, KING_EYE), r(12, 10, 3, 2, KING_EYE),
    r(5, 16, 4, 2, VOID), r(11, 16, 4, 2, VOID),
  ],
  recover: [
    r(1, 8, 2, 8, S), r(17, 8, 2, 8, S),
    r(3, 6, 14, 11, B),
    r(2, 5, 16, 2, S),
    r(3, 3, 14, 2, KING_CROWN),
    r(4, 2, 2, 2, KING_CROWN), r(9, 2, 2, 2, KING_CROWN), r(14, 2, 2, 2, KING_CROWN),
    r(5, 8, 3, 2, KING_EYE), r(12, 8, 3, 2, KING_EYE),
    r(6, 12, 8, 2, S),
    r(5, 17, 4, 1, VOID), r(11, 17, 4, 1, VOID),
  ],
};
