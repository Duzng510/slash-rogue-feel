// Flip probe: render a static room (no enemies) through GL and 2D, read the per-row mean
// luminance profile from each #game canvas, and decide whether GL is a vertical mirror of 2D.
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9340;
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--user-data-dir=${OUT}/cdp-flip`, `--remote-debugging-port=${PORT}`,
  "--window-size=960,540", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* up */ }
    await sleep(150);
  }
  throw new Error("CDP never came up");
}
const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };

// per-row mean luminance of the #game canvas, expressed SCREEN-TOP-FIRST.
// GL canvas: readPixels is bottom-up, so reverse it. 2D canvas: getImageData is already top-down.
const PROFILE = `(() => {
  const c = document.getElementById('game');
  const w = c.width, h = c.height;
  const rows = [];
  const gl = c.getContext('webgl2');
  if (gl) {
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let r = 0; r < h; r++) {
      const y = h - 1 - r; let s = 0;
      for (let x = 0; x < w; x++) { const i = (y*w + x)*4; s += 0.2126*px[i] + 0.7152*px[i+1] + 0.0722*px[i+2]; }
      rows.push(s / w);
    }
    return rows;
  }
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h).data;
  for (let r = 0; r < h; r++) {
    let s = 0;
    for (let x = 0; x < w; x++) { const i = (r*w + x)*4; s += 0.2126*img[i] + 0.7152*img[i+1] + 0.0722*img[i+2]; }
    rows.push(s / w);
  }
  return rows;
})()`;

const SETUP = `(() => { const g = window.__game; g.gotoRoom(0); g.setMove(0,0); for (let i=0;i<6;i++) g.advance(1/60); return true; })()`;

async function run(mode) {
  const url = `http://localhost:5199/?manual=1&seed=42&renderer=${mode}`;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url });
  for (let i = 0; i < 150; i++) { if (await evalJs("!!(window.__game && window.__game.ready)")) break; await sleep(100); }
  await evalJs(SETUP);
  await sleep(200);
  return await evalJs(PROFILE);
}

const gl = await run("gl");
const d2 = await run("2d");
chrome.kill();

if (!gl || !d2) { console.log("no profile", { gl: !!gl, d2: !!d2 }); process.exit(2); }
const n = gl.length;
const rev = (a) => a.slice().reverse();
const mad = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const diffSame = mad(gl, d2);
const diffRev = mad(gl, rev(d2));
console.log(`rows=${n}  meanAbsDiff(GL vs 2D)=${diffSame.toFixed(2)}  meanAbsDiff(GL vs 2D-flipped)=${diffRev.toFixed(2)}`);
const flipped = diffRev < diffSame;
console.log(flipped ? "VERDICT: GL is VERTICALLY FLIPPED vs 2D" : "VERDICT: GL matches 2D (not flipped)");
process.exit(flipped ? 1 : 0);
