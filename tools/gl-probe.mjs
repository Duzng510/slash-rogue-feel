// Gate probe for the WebGL2 renderer migration. Launches headless Chrome with the
// software-GL flags we intend to move the capture harnesses to, loads tools/gl-probe.html,
// and reads back whether WebGL2 rasterizes AND presents. Throwaway tool.
//   node tools/gl-probe.mjs            -> new flags (expect PASS)
//   node tools/gl-probe.mjs --legacy   -> current --disable-gpu (expect RASTER fails / black)
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";
const FILE_URL = "file:///C:/Users/My%20Lenovo/Desktop/Vibe/slash-rogue-feel/tools/gl-probe.html";
const legacy = process.argv.includes("--legacy");
const PORT = legacy ? 9335 : 9334;

const BASE = ["--headless=new", "--no-sandbox", "--hide-scrollbars", "--window-size=960,540"];
const GL_FLAGS = legacy
  ? ["--disable-gpu"]
  : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const chrome = spawn(CHROME, [
  ...BASE, ...GL_FLAGS,
  `--user-data-dir=${OUT}/cdp-probe-${legacy ? "legacy" : "new"}`,
  `--remote-debugging-port=${PORT}`,
  "about:blank",
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
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
await send("Page.navigate", { url: FILE_URL });

for (let i = 0; i < 80; i++) {
  if (await evalJs("!!window.__done")) break;
  await sleep(100);
}
const result = await evalJs("JSON.stringify(window.__result || null)");
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/gl-probe-${legacy ? "legacy" : "new"}.png`, Buffer.from(shot.result.data, "base64"));

ws.close();
chrome.kill();

const parsed = JSON.parse(result);
console.log(`[${legacy ? "legacy --disable-gpu" : "new swiftshader flags"}]`, JSON.stringify(parsed, null, 2));
if (legacy) {
  console.log("expected on legacy: webgl2 false OR RASTER_OK_BUT_NOT_PRESENT / black");
  process.exit(0);
}
const ok = parsed && parsed.verdict === "PASS";
console.log(ok
  ? "GATE PASS — WebGL2 compiles, rasterizes and presents under the planned flags. Safe to proceed."
  : "GATE FAIL — do NOT start the big-bang; report environment issue. verdict=" + (parsed && parsed.verdict));
process.exit(ok ? 0 : 1);
