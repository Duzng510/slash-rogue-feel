// Kinds with authored keyframes. Anything not listed here keeps the derived offset clip, so a new
// archetype can be added without touching this table and still animate.
import { enemyDef } from "../../config.ts";
import { boss } from "./boss.ts";
import { chaser } from "./chaser.ts";
import { charger } from "./charger.ts";
import { exploder } from "./exploder.ts";
import { golem } from "./golem.ts";
import { healer } from "./healer.ts";
import { jumper } from "./jumper.ts";
import { king } from "./king.ts";
import type { PoseTable } from "./kit.ts";
import { ranged } from "./ranged.ts";
import { shielder } from "./shielder.ts";
import { small } from "./small.ts";
import { sniper } from "./sniper.ts";
import { splitter } from "./splitter.ts";
import { teleporter } from "./teleporter.ts";
import { warden } from "./warden.ts";

const TABLES: readonly PoseTable[] = [
  chaser, charger, boss, splitter, small, ranged, teleporter, healer, exploder,
  shielder, sniper, jumper, warden, golem, king,
];

/** keyed by the sprite key the renderer looks up, not the kind name */
export const POSES: Record<string, PoseTable> = Object.fromEntries(
  TABLES.map((t) => [enemyDef(t.kind).SPRITE_KEY, t]),
);
