import type { IntentSource } from "./intent.ts";
import { isRotated, rotateVec } from "../ui/immersive.ts";

/**
 * On-screen controls for touch devices: a left virtual stick for 8-way-ish movement and two
 * right-hand buttons for slash and dash. It only writes into IntentSource, exactly like
 * DesktopInput, so the sim never learns an input device exists. With no cursor the player faces
 * its movement direction and auto-aim snaps the swing to the nearest enemy in front.
 */
export class TouchInput {
  private stickId = -1;
  private baseX = 0;
  private baseY = 0;
  private radius = 0;

  constructor(
    private readonly intent: IntentSource,
    private readonly tick: () => number,
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly attackBtn: HTMLElement,
    private readonly dashBtn: HTMLElement
  ) {}

  attach(): void {
    this.stick.addEventListener("pointerdown", this.onStickDown);
    window.addEventListener("pointermove", this.onStickMove);
    window.addEventListener("pointerup", this.onStickUp);
    window.addEventListener("pointercancel", this.onStickUp);
    this.attackBtn.addEventListener("pointerdown", this.onAttack);
    this.attackBtn.addEventListener("pointerup", this.releaseAttack);
    this.dashBtn.addEventListener("pointerdown", this.onDash);
    this.dashBtn.addEventListener("pointerup", this.releaseDash);
  }

  detach(): void {
    this.stick.removeEventListener("pointerdown", this.onStickDown);
    window.removeEventListener("pointermove", this.onStickMove);
    window.removeEventListener("pointerup", this.onStickUp);
    window.removeEventListener("pointercancel", this.onStickUp);
    this.attackBtn.removeEventListener("pointerdown", this.onAttack);
    this.attackBtn.removeEventListener("pointerup", this.releaseAttack);
    this.dashBtn.removeEventListener("pointerdown", this.onDash);
    this.dashBtn.removeEventListener("pointerup", this.releaseDash);
  }

  reset(): void {
    if (this.stickId !== -1 && this.stick.hasPointerCapture(this.stickId)) {
      this.stick.releasePointerCapture(this.stickId);
    }
    this.stickId = -1;
    this.intent.moveX = 0;
    this.intent.moveY = 0;
    this.intent.aim = null;
    this.intent.clearPresses();
    this.knob.style.transform = "translate(-50%, -50%)";
    this.releaseAttack();
    this.releaseDash();
  }

  private onStickDown = (e: PointerEvent): void => {
    this.radius = this.stick.clientWidth * 0.28;
    const r = this.stick.getBoundingClientRect();
    this.baseX = r.left + r.width / 2;
    this.baseY = r.top + r.height / 2;
    this.stickId = e.pointerId;
    this.stick.setPointerCapture?.(e.pointerId);
    this.applyStick(e.clientX, e.clientY);
  };

  private onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    this.applyStick(e.clientX, e.clientY);
  };

  private onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    this.stickId = -1;
    this.intent.moveX = 0;
    this.intent.moveY = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
  };

  private applyStick(clientX: number, clientY: number): void {
    const v = rotateVec(clientX - this.baseX, clientY - this.baseY, isRotated());
    let dx = v.x;
    let dy = v.y;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, this.radius);
    if (len > 0) {
      dx = (dx / len) * clamped;
      dy = (dy / len) * clamped;
    }
    this.intent.moveX = dx / this.radius;
    this.intent.moveY = dy / this.radius;
    // touch has no cursor: let auto-aim own the swing direction.
    this.intent.aim = null;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private onAttack = (e: PointerEvent): void => {
    e.preventDefault();
    this.attackBtn.classList.add("press");
    this.intent.pressAttack(this.tick());
  };

  private releaseAttack = (): void => {
    this.attackBtn.classList.remove("press");
  };

  private onDash = (e: PointerEvent): void => {
    e.preventDefault();
    this.dashBtn.classList.add("press");
    this.intent.pressDash(this.tick());
  };

  private releaseDash = (): void => {
    this.dashBtn.classList.remove("press");
  };
}
