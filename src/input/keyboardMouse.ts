import type { IntentSource } from "./intent.ts";

export type Hotkey =
  | "panel"
  | "fps"
  | "boxes"
  | "hitstop"
  | "slowmo"
  | "spawn"
  | "clear"
  | "restartRoom"
  | "nextRoom";

const MOVE: Record<string, [number, number]> = {
  keyw: [0, -1],
  keya: [-1, 0],
  keys: [0, 1],
  keyd: [1, 0],
  arrowup: [0, -1],
  arrowleft: [-1, 0],
  arrowdown: [0, 1],
  arrowright: [1, 0],
};

const HOTKEYS: Record<string, Hotkey> = {
  digit1: "panel",
  digit2: "fps",
  digit3: "boxes",
  digit4: "hitstop",
  digit5: "slowmo",
  digit6: "spawn",
  digit7: "clear",
  keyr: "restartRoom",
  keyn: "nextRoom",
};

const ATTACK = new Set(["keyj", "keyk"]);
const DASH = new Set(["space", "shiftleft", "shiftright"]);
const SKILL = new Set(["keyq", "keye"]);
const INTERACT = new Set(["keyf"]);

export type DesktopOpts = {
  tick: () => number;
  blocked?: () => boolean;
  onHotkey: (k: Hotkey) => void;
  aimFromClient: (clientX: number, clientY: number) => { x: number; y: number } | null;
};

/** Desktop provider. It only ever writes into IntentSource, so the sim has no idea a mouse exists. */
export class DesktopInput {
  private down = new Set<string>();
  private lastX = 0;
  private lastY = 0;
  private hasPointer = false;

  constructor(
    private readonly intent: IntentSource,
    private readonly opts: DesktopOpts
  ) {}

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mousedown", this.onDown);
    window.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code.toLowerCase();
    if (MOVE[code] || ATTACK.has(code) || DASH.has(code) || SKILL.has(code) || INTERACT.has(code) || HOTKEYS[code]) e.preventDefault();
    if (this.opts.blocked?.() || e.repeat || this.down.has(code)) return;
    this.down.add(code);

    if (ATTACK.has(code)) this.intent.pressAttack(this.opts.tick());
    else if (DASH.has(code)) this.intent.pressDash(this.opts.tick());
    else if (SKILL.has(code)) this.intent.pressSkill(this.opts.tick());
    else if (INTERACT.has(code)) this.intent.pressInteract(this.opts.tick());
    else if (HOTKEYS[code]) this.opts.onHotkey(HOTKEYS[code]);

    this.syncAxes();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code.toLowerCase());
    this.syncAxes();
  };

  private onMove = (e: MouseEvent): void => {
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.hasPointer = true;
  };

  private onDown = (e: MouseEvent): void => {
    if (this.opts.blocked?.() || e.button !== 0) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.hasPointer = true;
    this.intent.pressAttack(this.opts.tick());
  };

  reset(): void {
    this.down.clear();
    this.hasPointer = false;
    this.intent.aim = null;
    this.intent.clearPresses();
    this.syncAxes();
  }

  private onBlur = (): void => this.reset();

  private syncAxes(): void {
    let x = 0;
    let y = 0;
    for (const code of this.down) {
      const v = MOVE[code];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    this.intent.moveX = Math.max(-1, Math.min(1, x));
    this.intent.moveY = Math.max(-1, Math.min(1, y));
  }

  /** called once per render frame: aim depends on the camera, which only the renderer knows */
  sampleAim(): void {
    if (!this.hasPointer) {
      this.intent.aim = null;
      return;
    }
    this.intent.aim = this.opts.aimFromClient(this.lastX, this.lastY);
  }

  get usingMouse(): boolean {
    return this.hasPointer;
  }
}
