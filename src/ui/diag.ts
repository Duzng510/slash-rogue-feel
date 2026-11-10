// On-screen diagnostic, only ever built with ?diag=1. The overlay is refreshed by a timer, not
// by the frame loop, so it keeps talking after the loop dies -- that is the whole point.

export type DiagSample = {
  fs: boolean;
  orient: string;
  fserr: string;
  tick: number;
  stop: number;
  alive: number;
};

/** wall time outrunning the last frame by more than the limit means the rAF loop is gone */
export function stalled(now: number, lastFrame: number, limit: number): boolean {
  return now - lastFrame > limit;
}

export function startDiag(on: boolean, sample: () => DiagSample): { frame: () => void } {
  if (!on) return { frame: () => {} };
  let frames = 0;
  let lastFrame = performance.now();
  let error = "none";
  window.addEventListener("error", (e) => {
    error = `${e.message} @ ${(e.filename ?? "").split("/").pop()}:${e.lineno}:${e.colno}`;
  });
  window.addEventListener("unhandledrejection", (e) => {
    error = `promise ${String(e.reason)}`;
  });
  const box = document.createElement("div");
  box.id = "diag";
  box.style.cssText =
    "position:fixed;left:6px;top:6px;z-index:99;pointer-events:none;white-space:pre;" +
    "font:10px/1.35 ui-monospace,monospace;color:#8fd3ff;background:rgba(4,6,10,.82);padding:3px 5px;";
  document.body.appendChild(box);
  window.setInterval(() => {
    const s = sample();
    const now = performance.now();
    const gap = Math.round(now - lastFrame);
    box.textContent =
      `fs=${s.fs ? "on" : "OFF"}  orient=${s.orient}  fserr=${s.fserr}\n` +
      `frame=${frames} d=${gap}ms ${stalled(now, lastFrame, 500) ? "STALL" : "ok"}  tick=${s.tick} stop=${s.stop} alive=${s.alive}\n` +
      `err=${error}`;
  }, 250);
  return {
    frame: () => {
      frames++;
      lastFrame = performance.now();
    },
  };
}
