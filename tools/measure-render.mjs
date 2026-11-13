// Stage-1 render measurement harness: reports CPU draw cost, per-frame 2D drawImage blits,
// GPU tile-batch quads, scene uploads and the batched-tiles mean for each present path.
// Reads the numbers the stage-1 gate needs: does routing tiles through the GPU actually cut
// the CPU drawImage work? Throwaway dev tool, not shipped. Requires `npm run dev` on :5199.
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9339;
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";
const BASE = "http://localhost:5199/?manual=1&seed=42";
const VARIANTS = [
  { name: "shipping default (presentScene upload)", url: `${BASE}` },
  { name: "tiles batched (?glbatch=probe)", url: `${BASE}&glbatch=probe` },
  { name: "2D reference (?renderer=2d)", url: `${BASE}&renderer=2d` },
];

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--user-data-dir=${OUT}/cdp-measure`, `--remote-debugging-port=${PORT}`,
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

await send("Runtime.enable");
await send("Page.enable");

const rows = [];
for (const v of VARIANTS) {
  await send("Page.navigate", { url: v.url });
  let ready = false;
  for (let i = 0; i < 80; i++) { if (await evalJs("!!(window.__game && window.__game.ready)")) { ready = true; break; } await sleep(100); }
  if (!ready) { rows.push({ ...v, error: "boot timed out" }); continue; }

  await evalJs(`window.__game.pickCharacter("swordsman")`);
  await evalJs(`window.__game.gotoRoom(0)`);
  await evalJs(`window.__game.addEnemies(6, ["chaser"])`);
  // settle a few real frames so stats()/glSceneRTMean() reflect a drawn, populated room
  await evalJs(`(() => { const g = window.__game; for (let i = 0; i < 60; i++) g.advance(1/60); })()`);
  const stats = await evalJs(`window.__game.stats()`);
  const mean = await evalJs(`window.__game.glSceneRTMean()`);
  // 200 synchronous re-renders of the current frame: average CPU draw cost + counter rates
  const prof = await evalJs(`window.__game.profileFrames(200)`);
  rows.push({ ...v, ready, stats, mean, prof });
}

chrome.kill();

const fmt = (x) => (typeof x === "number" ? x.toFixed(2) : String(x));
console.log("\nSTAGE-1 RENDER MEASUREMENT (mean = batched-tiles sceneRT luminance; cpuMs includes any probe readPixels)\n");
console.log("variant".padEnd(38), "cpuMs".padStart(8), "drawImage/f".padStart(13), "tileBatch/f".padStart(12), "uploads/f".padStart(10), "tilesMean".padStart(10), "overlayDirty".padStart(13));
console.log("-".repeat(98));
for (const r of rows) {
  if (r.error) { console.log(r.name.padEnd(38), r.error); continue; }
  console.log(
    r.name.padEnd(38),
    fmt(r.prof.cpuMsPerFrame).padStart(8),
    fmt(r.prof.drawImagePerFrame).padStart(13),
    fmt(r.prof.tileBatchPerFrame).padStart(12),
    fmt(r.prof.uploadsPerFrame).padStart(10),
    fmt(r.mean).padStart(10),
    String(r.stats.overlayDirty).padStart(13),
  );
}
if (errs.length) console.log("\npage exceptions:", errs.slice(0, 4).join(" | "));
console.log("\nRecord these as the stage-1 gate input: glbatch tiles should drive drawImage down by ~the tile count with tileBatch/f > 0.");
process.exit(0);
