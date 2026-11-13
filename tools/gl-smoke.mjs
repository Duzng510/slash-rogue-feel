// GL smoke test: proves the shipping default (WebGL2) boots, runs the post chain and
// paints a non-blank frame headless. Loads the page with NO ?renderer= param, so it also
// asserts GL is the default. Exit 0 = pass, 1 = fail. Throwaway dev tool, not shipped.
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9337;
// deliberately no &renderer= — the default path must be GL.
const URL = "http://localhost:5199/?manual=1&seed=42";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--user-data-dir=${OUT}/cdp-gls`, `--remote-debugging-port=${PORT}`,
  "--window-size=960,540", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error("CDP endpoint never came up");
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
const errs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    errs.push(`${d.exception?.description ?? d.text}`);
  }
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
function send(method, params = {}) {
  return new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
}

const checks = [];
const fail = (name, detail) => { checks.push({ name, ok: false, detail }); };
const pass = (name, detail) => { checks.push({ name, ok: true, detail }); };

let ready = false;
let ctx = null;
let pixels = null;
try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL });
  for (let i = 0; i < 80; i++) { if (await evalJs("!!(window.__game && window.__game.ready)")) { ready = true; break; } await sleep(100); }
  pass("harness booted", String(ready));

  // GL default: the #game canvas must hand back a live WebGL2 context.
  // (A 2D-mode canvas returns null here, so this also proves we did not silently fall back.)
  ctx = await evalJs(`(() => {
    const c = document.getElementById('game');
    const gl = c && c.getContext('webgl2');
    return gl ? { ver: gl.getParameter(gl.VERSION), w: gl.drawingBufferWidth, h: gl.drawingBufferHeight } : null;
  })()`);

  if (ctx) {
    pass("WebGL2 context live on #game", `${ctx.ver} ${ctx.w}x${ctx.h}`);

    // Drive a real scene: pick a melee char, load a room, spawn enemies, swing into hit-stop.
    await evalJs(`window.__game.pickCharacter("swordsman")`);

    // Non-dungeon biomes use the post shader for distortion; the scene must remain in its GPU
    // render target instead of being read back from the final composited canvas each frame.
    // An idle, enemy-free scene must keep stable non-zero luminance rather than feeding the
    // post-processed output back into itself.
    const readMean = `(() => {
      const gl = document.getElementById('game').getContext('webgl2');
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return s / (w * h);
    })()`;
    for (const room of [3, 6, 9]) {
      await evalJs(`window.__game.gotoRoom(${room})`);
      await evalJs(`(() => { const g = window.__game; for (let i = 0; i < 60; i++) g.advance(1/60); })()`);
      const settle = await evalJs(readMean);
      await evalJs(`(() => { const g = window.__game; for (let i = 0; i < 240; i++) g.advance(1/60); })()`);
      const later = await evalJs(readMean);
      const drift = Math.abs(later - settle);
      if (settle < 4 || later < 4 || drift > settle * 0.5) {
        fail(`biome room ${room} renders a stable world`, `settle=${settle.toFixed(1)} later=${later.toFixed(1)} drift=${drift.toFixed(1)}`);
      } else {
        pass(`biome room ${room} renders a stable world`, `settle=${settle.toFixed(1)} later=${later.toFixed(1)}`);
      }
    }

    await evalJs(`window.__game.gotoRoom(0)`);
    await evalJs(`(() => { const g = window.__game; for (let i = 0; i < 60; i++) g.advance(1/60); })()`);
    const idleStats = await evalJs(`window.__game.stats()`);
    if (idleStats.uploads !== 0 || idleStats.overlayDirty) fail("clean scene skips CPU overlay upload", JSON.stringify(idleStats));
    else pass("clean scene skips CPU overlay upload", JSON.stringify(idleStats));
    await evalJs(`window.__game.addEnemies(5, ["chaser"])`);
    await evalJs(`(() => {
      const g = window.__game;
      for (let i = 0; i < 120; i++) {
        const s = g.state(); const p = s.player;
        let best = null, bd = Infinity;
        for (const e of s.enemies) { if (e.state === 'dead') continue; const d = Math.hypot(e.x-p.x, e.y-p.y); if (d < bd) { bd = d; best = e; } }
        if (best) { const a = Math.atan2(best.y-p.y, best.x-p.x); g.setMove(Math.cos(a), Math.sin(a)); g.setAim(best.x, best.y); if (bd < 34) g.pressAttack(); }
        g.advance(1/60);
      }
      return g.state().enemies.length;
    })()`);

    // Read the composited GL backbuffer straight from the canvas context.
    pixels = await evalJs(`(() => {
      const gl = document.getElementById('game').getContext('webgl2');
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, min = 255, max = 0, opaque = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        sum += l; if (l < min) min = l; if (l > max) max = l;
        if (px[i + 3] > 0) opaque++;
      }
      return { mean: sum / (w * h), min, max, opaqueFrac: opaque / (w * h) };
    })()`);

    if (pixels.max - pixels.min < 12) fail("frame has tonal range", JSON.stringify(pixels));
    else pass("frame has tonal range", JSON.stringify(pixels));
    if (pixels.mean < 3) fail("frame is lit (not black)", JSON.stringify(pixels));
    else pass("frame is lit (not black)", `mean=${pixels.mean.toFixed(1)}`);
  } else {
    fail("WebGL2 context live on #game", "getContext('webgl2') returned null — GL default regressed to 2D");
  }
} catch (e) {
  fail("smoke run threw", String(e?.message ?? e));
}

if (errs.length) fail("no page exceptions", errs.slice(0, 4).join(" | "));
else pass("no page exceptions", "clean");

chrome.kill();

let ok = true;
for (const c of checks) { ok = ok && c.ok; console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`); }
if (!ready) ok = false;
console.log(ok ? "\nGL SMOKE: PASS" : "\nGL SMOKE: FAIL");
process.exit(ok ? 0 : 1);
