# Design Spec: Hyper-Crisp Pixel Roguelike Visual Overhaul

- **Topic**: Comprehensive visual overhaul focusing on razor-sharp combat VFX, crisp neon slash arcs, detailed sprites, and atmospheric dungeon pixel art.
- **Date**: 2026-11-11
- **Status**: Approved

## 1. Core Architecture Invariants
- **Resolution**: Constant 320×180 internal canvas, integer-scaled to viewport, TILE 16.
- **Sim & Render Decoupling**: Simulation remains fixed 60Hz deterministic (`Sim` in `src/sim/types.ts`). Visual enhancements consume events from `EventQueue` (`src/events.ts`) and draw inside `Renderer` (`src/render/renderer.ts`) without mutating sim state.
- **Test Integrity**: All 194 laws and combat regression tests must remain green.

## 2. Subsystem 1: Combat VFX & Razor Slash Arcs
1. **Multi-layer Crescent Slash Arcs (`drawArcs` in `renderer.ts`)**:
   - Replace the flat single wedge with a 3-layer razor crescent:
     - Outer Razor Edge: 1px intense highlight (`#ffffff` / `#d8f0ff`) at the cutting perimeter.
     - Neon Body: Gradient body with additive glow (`globalCompositeOperation = "lighter"`), color-coded by combo stage:
       - Combo 1 (Slash): Cyan / Ice Blue (`#00f0ff` -> `#1a5fb4`).
       - Combo 2 (Heavy / Spin): Golden Amber / Solar Flare (`#ffe066` -> `#ff5533`).
     - Tapered Crescent Trail: Tapering tip and tail fading out smoothly across remaining active ticks.
2. **Hit Impact & Directional Sparks**:
   - Directional spark spray emitted along the tangent of the swing impact angle.
   - Slash slice line (diagonal flash cut) momentarily rendered over damaged enemies.
3. **Sharp Telegraphs**:
   - High-contrast animated border for enemy attack telegraphs with inward charging indicator.

## 3. Subsystem 2: Characters & Enemies Pixel Art
1. **Player Sprite & Animation**:
   - Refined knight sprite: High-contrast helmet visor, rim lighting, and subtle cape.
   - Dynamic attack lean: Directional tilt / stretch during startup and active attack ticks.
   - Ground drop shadows: Elliptical pixel shadows anchored under entities for grounding.
2. **Enemy Sprites**:
   - Distinct high-contrast silhouettes for all enemy archetypes (Chaser, Charger, Splitter, Ranged, Boss, Warden).
   - Intense glowing neon eyes (`#ffd166`, `#ff3b3b`, `#29c5d6`).
   - Impact squash & stretch during hit-stop ticks.

## 4. Subsystem 3: Atmospheric Dungeon Tileset & Ambient Lighting
1. **Floor & Wall Texturing**:
   - Stone tile variations: subtle cracks, corner bevels, and moss/debris dither on floor tiles.
   - Multi-tier walls: Light top rim (`WALL_TOP`), shaded stone brick face, and dark bottom drop shadow onto the floor.
2. **Ambient & Torchlight Glow**:
   - Soft radial light centered on the player and glowing weapon slashes to pop against the dark dungeon void.

