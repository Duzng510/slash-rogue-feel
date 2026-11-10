// Throwaway: does the ?diag=1 overlay keep reporting when the frame loop is not running?
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9338;
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp2`, `--remote-debugging-port=${PORT}`,
  "--window-size=960,540", "about:blank",
], { stdio: "ignore" });

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

async function open(name, query, extra) {
  await send("Page.navigate", { url: `http://localhost:5199/${query}` });
  for (let i = 0; i < 120; i++) if (await evalJs("!!document.getElementById('diag')")) break;
  await sleep(1500);
  if (extra) await evalJs(extra);
  await sleep(900);
  const text = await evalJs("document.getElementById('diag')?.textContent");
  const img = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-${name}.png`, Buffer.from(img.result.data, "base64"));
  console.log(`\n[${name}] ${String(text).replace(/\n/g, " / ")}`);
}

// real rAF: frames must be counting, fs must report the truth
await open("diag-live", "?diag=1&touch=1&seed=42");
// manual mode: the loop never pumps, so the timer-driven overlay must still talk and say STALL
await open("diag-stall", "?diag=1&manual=1&seed=42",
  "window.dispatchEvent(new ErrorEvent('error',{message:'synthetic boom',filename:'http://x/src/render/renderer.ts',lineno:12,colno:3})); 1");

ws.close();
chrome.kill();
process.exit(0);
