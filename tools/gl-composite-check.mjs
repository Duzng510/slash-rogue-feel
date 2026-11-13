// Stage-1 composite parity check: proves ?glbatch=1 (GPU tiles + overTex composite) renders the
// dungeon like the shipping default, headless on swiftshader. Screenshots both paths to tools/out
// and compares composited-output mean luminance. Throwaway dev tool, not shipped.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9340;
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";
const COMMON = "http://localhost:5199/?manual=1&seed=42";

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--user-data-dir=${OUT}/cdp-comp`, `--remote-debugging-port=${PORT}`,
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

// Read the composited default-framebuffer back: mean luminance + tonal range (same probe gl-smoke uses).
const READ = `(() => {
  const gl = document.getElementById('game').getContext('webgl2');
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0, min = 255, max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l; if (l < min) min = l; if (l > max) max = l;
  }
  return { mean: sum / (w * h), min, max };
})()`;

async function drive(url, tag) {
  await send("Page.navigate", { url });
  let ready = false;
  for (let i = 0; i < 80; i++) { if (await evalJs("!!(window.__game && window.__game.ready)")) { ready = true; break; } await sleep(100); }
  if (!ready) throw new Error(`${tag}: boot timed out`);
  await evalJs(`window.__game.pickCharacter("swordsman")`);
  await evalJs(`window.__game.gotoRoom(0)`); // dungeon biome -> composite path
  await evalJs(`window.__game.addEnemies(5, ["chaser"])`);
  await evalJs(`(() => { const g = window.__game; for (let i = 0; i < 90; i++) g.advance(1/60); })()`);
  const m = await evalJs(READ);
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-composite-${tag}.png`, Buffer.from(s.result.data, "base64"));
  return m;
}

await send("Runtime.enable");
await send("Page.enable");

const checks = [];
const rec = (ok, name, detail) => { checks.push({ ok, name, detail }); };

const base = await drive(COMMON, "default");
const comp = await drive(`${COMMON}&glbatch=1`, "glbatch1");

// The composited output must be lit, have range, and track the default within a generous band
// (grade/saturate are approximated on the GPU, so this is eyeball-parity not byte-parity).
rec(comp.mean > 4, "composite output is lit (not black)", `mean=${comp.mean.toFixed(1)}`);
rec(comp.max - comp.min > 12, "composite output has tonal range", JSON.stringify(comp));
const dMean = Math.abs(comp.mean - base.mean);
rec(dMean < 12, "composite mean tracks default", `base=${base.mean.toFixed(1)} comp=${comp.mean.toFixed(1)} |d|=${dMean.toFixed(1)}`);
if (errs.length) rec(false, "no page exceptions", errs.slice(0, 4).join(" | "));
else rec(true, "no page exceptions", "clean");

chrome.kill();
let ok = true;
for (const c of checks) { ok = ok && c.ok; console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`); }
console.log(`\nscreenshots -> ${OUT}/shot-composite-default.png , shot-composite-glbatch1.png`);
console.log(ok ? "COMPOSITE PARITY: PASS" : "COMPOSITE PARITY: FAIL");
process.exit(ok ? 0 : 1);
