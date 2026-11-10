// Viewport/orientation glue for touch devices. The pure helpers below are the only place the
// screen->app axis mapping lives, so a wrong rotation sign is a test failure, not a sideways stick.

export type Axes = { w: number; h: number };
export type Vec = { x: number; y: number };

/** CSS #app box is 100dvh x 100dvw when rotated, so the fit must be measured on swapped axes. */
export function fitAxes(winW: number, winH: number, rotated: boolean): Axes {
  return rotated ? { w: winH, h: winW } : { w: winW, h: winH };
}

/**
 * Screen-space delta -> app-space vector. rotate(90deg) sends app right to screen down,
 * so the inverse sends screen right (1,0) to app up (0,-1).
 */
export function rotateVec(x: number, y: number, rotated: boolean): Vec {
  return rotated ? { x: y, y: -x } : { x, y };
}

/** true when the app is currently drawn sideways inside a portrait viewport */
export function isRotated(): boolean {
  return document.body.classList.contains("rot90");
}

/** touch devices get the sideways fallback; desktop keeps its real window size */
export function syncOrientation(): boolean {
  const rotated = document.body.classList.contains("touch") && window.innerHeight > window.innerWidth;
  document.body.classList.toggle("rot90", rotated);
  return rotated;
}

export type FullscreenRoot = { requestFullscreen?(opts?: { navigationUI?: string }): Promise<void> };
/** lib.dom has no ScreenOrientation.lock (it is a Chrome-only API), so the shape is declared here */
export type OrientationLike = { lock?(o: string): Promise<void> } | undefined;

/**
 * Fullscreen is the only way to drop the browser bar, and screen.orientation.lock only works
 * while fullscreen is granted, so the lock is attempted strictly after a successful request.
 * iOS supports neither: both are skipped silently, the CSS rotation covers landscape there.
 */
export async function tryImmersive(root: FullscreenRoot | null, orientation: OrientationLike | undefined): Promise<boolean> {
  if (root === null || typeof root.requestFullscreen !== "function") return false;
  try {
    await root.requestFullscreen({ navigationUI: "hide" });
  } catch {
    return false;
  }
  try {
    await orientation?.lock?.("landscape");
  } catch {
    /* lock is Android-only */
  }
  return true;
}
