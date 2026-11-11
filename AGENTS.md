# AGENTS.md — slash-rogue-feel

Top-down slash roguelike (survivors-like), pixel art, browser + mobile. Vite + TypeScript, no
framework, canvas 2D. Node runs `.ts` directly (native type stripping, no build for tests).

## Run
- `npm run dev` — Vite dev server (what the capture harnesses drive).
- `npm run typecheck` — `tsc --noEmit`, fast type errors, **no dist build**.
- `npm test` — both test runners (see Verification).
- `npm run build` — only when the user asks; do not auto-build.

## Architecture (the invariants that break the game if violated)
- **Fixed-timestep sim @ 60Hz, free-running visuals.** `GameLoop` (`src/loop.ts`) ticks `sim()`
  in whole steps and calls `frame(dtReal)` once per rAF. Visuals never interpolate between sim
  positions — the world draws at integer internal pixels (`320×180`, `TILE 16`), sub-tick lerp
  blurs pixels. Don't add interpolation.
- **`Sim` is the central state contract** (`src/sim/types.ts`); `World` (`src/world/world.ts`)
  implements it. Systems are functions that take `Sim` and mutate only sim state.
- **Sim never touches DOM/canvas/audio.** Sim pushes `VisualEvent` into `EventQueue`
  (`src/events.ts`); the renderer, sfx and particles consume via `drain()` each frame. New effect
  = new event type, not a direct draw call from a system.
- **Input → `Intent` per tick.** `DesktopInput` / `TouchInput` feed `IntentSource`
  (`src/input/*`); sim reads `Intent` only. Keep combat/input decoupled.
- **Everything tunable lives in `CONFIG` (`src/config.ts`)** — sizes, frames, feel, readability.
  `CONFIG.SLIDERS` = graduated player settings, `CONFIG.LAWS` = thresholds asserted in tests.

## Modules
- `config.ts` — all constants + `CONFIG`. Single source of tuning.
- `mathx.ts` — `clamp/lerp/angle*/rectsOverlap/pointInArc`, `makeRng(seed)` (seeded).
- `events.ts` — `EventQueue`, `sfx()`, `shake()`. The sim→visual bus.
- `loop.ts` — `GameLoop` (fixed step + rAF pump).
- `sim/types.ts` — `Sim`, `Unit`, `Swing`, `Intent` contracts.
- `entities/` — `player.ts`, `enemy.ts` (state machines: `PLAYER_STATE`/`ENEMY_STATE` +
  `canGo*` guards; `makeEnemy`, `resetEnemyIds` for tests).
- `systems/` — `combat.ts` (swing lifecycle, `resolveHits`/`resolveFire`), `feelSim.ts`
  (hit-stop/knockback/pulse), `aim.ts` (auto-aim), `particles.ts` (pooled), `artifacts.ts` (rewards).
- `world/` — `rooms.ts` (tile templates, `Room`), `collision.ts` (`moveBody`), `world.ts` (`Sim`).
- `render/` — `renderer.ts`, `pixelart.ts` (sprites built in code), `camera.ts`.
- `ui/` — `hud.ts`, `debug.ts`/`diag.ts` (stall detection), `immersive.ts` (orientation/fullscreen).
- `audio/sfx.ts` — WebAudio playback of queued sfx.

## Conventions
- **Rewards are "artifacts"** (not "boons"). Bump `#version` in `index.html` when finishing a step.
- **Feel is graduated, never a toggle** — go through `CONFIG.SLIDERS` (shake/volume/particles/
  timescale/hitStopScale/dmgNumbers), not on/off flags.
- **Normal movement continues during attacks.** A `Swing` captures `ox/oy` at start so movement
  can't stretch the arc; don't recompute the hitbox from live player pos.
- **Determinism by seeding, not by loosening.** Tests build a `World` with `CONFIG.SEED`; if a
  check is flaky, seed the draw — never relax the assertion to get green.
- Target Android Chrome + desktop; orientation lives in `immersive.ts`.

## Verification (prove it, then report)
- Type: `npm run typecheck`.
- Logic: `npm test` = `node --test tests/combat-regressions.test.ts` (node:test) **then**
  `node tests/laws.test.ts` (custom `ok()` runner, self-sets `exitCode`). Two runners on purpose.
- `npm run test:combat` / `npm run test:laws` for targeted runs — prefer the narrow one.
- Add a laws/regression assertion for any feel or combat rule you change; it should fail without
  the fix.
- Visual/feel: `tools/capture-*.mjs` take headless CDP screenshots at fixed frames off `npm run dev`
  (`capture-feel|kinds|mobile|status|touch`). `tools/debug-freeze.mjs` reproduces the hit-freeze bug.

## Working rules (token discipline)
- **Grep to the function before reading a file.** `src/` is ~4k lines across small modules; don't
  load `main.ts`/`renderer.ts` whole when one call site is enough.
- Edit in place; don't re-read files just edited.
- Reuse existing capture harnesses instead of writing new ones; scratch output goes to `tools/out/`.
