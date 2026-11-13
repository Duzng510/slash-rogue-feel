// Tiles-batch probe (stage 0, throwaway dev tool): proves world tiles can be drawn through
// the GPU SpriteBatch into sceneRT on the software renderer, headlessly, with sane output.
// Loads ?glbatch=probe so renderer.draw() flushes the tile batch into sceneRT and stores its
// luminance mean (window.__game.glSceneRTMean()). It does NOT assert strict pixel parity with
// presentScene — that is validated later (Task 3) against shipped frames. Here we only prove:
// (a) WebGL2 is live, (b) the batch flush neither throws nor corrupts the context, (c) the
// sceneRT tile readback is finite and within a sane band (1..254), (d) no page exceptions.
// Exit 0 = pass, 1 = fail.
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9338;
const URL = "http://localhost:5199/?manual=1&seed=42&glbatch=probe";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--user-data-dir=${OUT}/cdp-glb`, `--remote-debugging-port=${PORT}`,
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

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL });

  let ready = false;
  for (let i = 0; i < 80; i++) { if (await evalJs("!!(window.__game && window.__game.ready)")) { ready = true; break; } await sleep(100); }
  if (!ready) fail("harness booted", "window.__game never became ready");
  else pass("harness booted", "ready");

  const ctxOk = await evalJs(`(() => {
    const c = document.getElementById('game');
    return !!(c && c.getContext('webgl2'));
  })()`);
  if (ctxOk) pass("WebGL2 context live on #game", "glbatch=probe still boots GL");
  else fail("WebGL2 context live on #game", "getContext('webgl2') returned null");

  // Drive a real dungeon room so the tile batch has something to flush.
  await evalJs(`window.__game.pickCharacter("swordsman")`);
  await evalJs(`window.__game.gotoRoom(0)`);
  await evalJs(`(() => { const g = window.__game; for (let i = 0; i < 120; i++) g.advance(1/60); })()`);

  // The batched-tiles readback (mean luminance of sceneRT after the tile flush).
  const mean = await evalJs(`window.__game.glSceneRTMean()`);
  if (typeof mean !== "number" || !Number.isFinite(mean)) {
    fail("sceneRT tile mean finite", String(mean));
  } else if (mean > 1 && mean < 254) {
    pass("sceneRT tile mean finite", `mean=${mean.toFixed(1)} (tiles drew through the batch)`);
  } else {
    fail("sceneRT tile mean in sane band", `mean=${mean.toFixed(1)} (expected 1..254)`);
  }
} catch (e) {
  fail("probe run threw", String(e?.message ?? e));
}

if (errs.length) fail("no page exceptions", errs.slice(0, 4).join(" | "));
else pass("no page exceptions", "clean");

chrome.kill();

let ok = checks.every((c) => c.ok);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
console.log(ok ? "\nGL TILES PROBE: PASS" : "\nGL TILES PROBE: FAIL");
process.exit(ok ? 0 : 1);
