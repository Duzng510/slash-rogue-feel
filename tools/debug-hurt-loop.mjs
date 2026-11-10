// Throwaway: (A) mashing attack while hurt must not kill the rAF loop.
// (B) capture the two i-frame blink phases so the dim-vs-missing change is visible.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9345;
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools";
const PROFILE = `${OUT}/cdp-hurt`;
const TAG = process.argv[2] ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
  "--window-size=960,540", "about:blank",
], { stdio: "ignore" });

// never leave an orphan holding the profile dir
process.on("exit", () => { try { chrome.kill(); } catch { /* gone */ } });

async function pageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error("CDP never came up");
}

const page = await pageTarget();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return `EVAL ERR ${r.result.exceptionDetails.exception?.description}`;
  return r.result?.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });

async function open(query) {
  await send("Page.navigate", { url: `http://localhost:5199/${query}` });
  for (let i = 0; i < 240; i++) {
    if (await evalJs("!!(window.__game && __game.ready)")) return;
    await sleep(100);
  }
  throw new Error(`harness never loaded at ${await evalJs("location.href")}`);
}

async function shot(name) {
  const img = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-blink-${name}${TAG}.png`, Buffer.from(img.result.data, "base64"));
}

// ---- A: real rAF, attack pressed every frame, six enemies on top of the player
await open("?diag=1&touch=1&seed=42");
await evalJs("__game.addEnemies(6); window.__i = setInterval(() => __game.pressAttack(), 16); 1");
await sleep(4000);
const a1 = await evalJs("document.getElementById('diag').textContent");
await sleep(2000);
const a2 = await evalJs("document.getElementById('diag').textContent");
console.log(`[A] mash attack while hurt: ${String(a1).replace(/\n/g, " / ")}`);
console.log(`[A] 2s later:               ${String(a2).replace(/\n/g, " / ")}`);
await evalJs("clearInterval(window.__i); 1");

// ---- B: manual frames, land one real hit, then shoot both blink phases
const hitLoop = `(() => {
  __game.clearEnemies();
  __game.addEnemies(4);
  let i = 0;
  for (; i < 4000; i++) {
    __game.advance(1 / 60);
    const s = __game.state();
    if (s.player.state === "hurt" && s.player.invuln) break;
  }
  return JSON.stringify({ ticks: i, ...__game.state().player });
})()`;

// the hit tick has iframeTicks = IFRAMES, whose blink phase is the "off" one
await open("?manual=1&seed=42");
console.log("[B] hit landed:", await evalJs(hitLoop));
await shot("out");
// once hit-stop drains, iframeTicks goes odd -> the "on" phase
await evalJs("(() => { while (__game.state().hitStop > 0) __game.advance(1 / 60); __game.advance(1 / 60); })()");
await shot("in");

ws.close();
chrome.kill();
console.log(`[B] wrote shot-blink-out${TAG}.png and shot-blink-in${TAG}.png`);
process.exit(0);
