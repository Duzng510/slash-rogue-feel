import { CONFIG } from "../config.ts";
import { hitboxOf } from "../systems/combat.ts";
import { ENEMY_STATE } from "../entities/enemy.ts";
import type { World } from "../world/world.ts";
import type { Renderer } from "../render/renderer.ts";

const P = CONFIG.PALETTE;

export type DebugFlags = { boxes: boolean; fps: boolean; hitStop: boolean };

export class DebugHud {
  fps = 0;
  private acc = 0;
  private frames = 0;

  measure(dtReal: number): void {
    this.acc += dtReal;
    this.frames++;
    if (this.acc >= 0.5) {
      this.fps = Math.round(this.frames / this.acc);
      this.acc = 0;
      this.frames = 0;
    }
  }

  draw(o: CanvasRenderingContext2D, scale: number, world: World, view: Renderer, flags: DebugFlags): void {
    if (!flags.boxes && !flags.fps) return;
    const ox = view.origin.x;
    const oy = view.origin.y;
    const box = (x: number, y: number, w: number, h: number, color: string): void => {
      o.strokeStyle = color;
      o.lineWidth = 1;
      o.strokeRect(Math.round((x - ox) * scale) + 0.5, Math.round((y - oy) * scale) + 0.5, Math.round(w * scale), Math.round(h * scale));
    };

    if (flags.boxes) {
      const pl = world.player;
      const hb = pl.hurtRect();
      box(hb.x, hb.y, hb.w, hb.h, P.DBG_HURTBOX);
      for (const e of world.enemies) {
        if (e.removed) continue;
        const r = e.hurtRect();
        box(r.x, r.y, r.w, r.h, e.dead ? P.ENEMY_SHADE : P.DBG_HURTBOX);
      }
      const pswing = pl.swing;
      if (pswing !== null) {
        const b = hitboxOf(pswing);
        if (b !== null) box(b.x, b.y, b.w, b.h, P.DBG_HITBOX);
      }
      for (const e of world.enemies) {
        const sw = e.swing;
        if (sw === null) continue;
        const b = hitboxOf(sw);
        if (b !== null) box(b.x, b.y, b.w, b.h, P.DBG_HITBOX);
      }
    }

    if (flags.fps) {
      const pl = world.player;
      o.font = `${Math.max(10, Math.round(5.5 * scale))}px ui-monospace, monospace`;
      o.textBaseline = "top";
      const lines = [
        `fps ${this.fps}  tick ${world.tickCount}  ts ${CONFIG.SLIDERS.timescale.toFixed(2)}`,
        `parts ${world.particles.alive}/${world.particles.cap}  alive ${world.aliveEnemies()}  stop ${world.hitStopTicks}`,
        `you ${pl.state}${pl.swing !== null ? `/${pl.swing.phase}:${pl.swing.ticksLeft}` : ""} c${pl.combo} ifr${pl.iframeTicks}`,
      ];
      const lineHeight = Math.max(12, Math.round(9 * scale));
      const height = lines.length * lineHeight + 8;
      const top = o.canvas.height - height - 2;
      const width = Math.min(o.canvas.width - 8, Math.ceil(Math.max(...lines.map(t => o.measureText(t).width))) + 8);
      o.fillStyle = P.VOID;
      o.globalAlpha = 0.72;
      o.fillRect(4, top, width, height);
      o.globalAlpha = 1;
      o.fillStyle = P.TEXT;
      lines.forEach((t, i) => o.fillText(t, 8, top + 4 + i * lineHeight, width - 8));

      if (flags.boxes) {
        o.fillStyle = P.DBG_ARC;
        for (const e of world.enemies) {
          if (e.removed || e.dead) continue;
          const tag = `${e.state}${e.state === ENEMY_STATE.TELEGRAPH ? `:${e.telegraphTicksLeft}` : ""}${e.state === ENEMY_STATE.ATTACK ? `:${e.swing?.phase ?? "?"}` : ""}`;
          o.fillText(tag, Math.round((e.x - ox) * scale) - 18, Math.round((e.y - 16 - oy) * scale));
        }
      }
    }
  }
}
