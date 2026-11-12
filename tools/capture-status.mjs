// Dev-only status-indicator capture: drives the __game harness over headless CDP Chrome.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const BASE = "http://localhost:5175/?manual=1&seed=42&renderer=2d";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp-status`, `--remote-debugging-port=${PORT}`,
  "--window-size=960,540", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
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

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: BASE });
for (let i = 0; i < 60; i++) {
  if (await evalJs("!!(window.__game && window.__game.ready)")) break;
  await sleep(100);
}

const result = await evalJs(`(() => {
  const g = window.__game;
  g.gotoRoom(0);
  g.clearEnemies();
  g.addEnemies(3, ["chaser", "charger", "splitter"]);
  g.advance(1 / 60);
  const near = g.state().enemies
    .filter(e => Math.abs(e.x - g.state().player.x) < 110 && Math.abs(e.y - g.state().player.y) < 75);
  if (near.length < 3) return { ok: false, info: near.length };
  const [burn, wet, shock] = near;
  g.applyStatus(burn.id, "burn");
  g.applyStatus(wet.id, "wet");
  g.applyStatus(shock.id, "shock");
  g.advance(1 / 60);
  return { ok: true, info: [burn, wet, shock].map(e => e.kind + ":" + e.hp).join(",") };
})()`);
if (!result?.ok) throw new Error(`status shot failed: ${JSON.stringify(result)}`);

const img = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/shot-status.png`, Buffer.from(img.result.data, "base64"));
console.log("shot-status.png", result.info);

ws.close();
chrome.kill();
process.exit(0);
