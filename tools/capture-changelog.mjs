// Start-screen changelog popup capture: drives the real page (no manual/autoplay) over headless CDP Chrome.
// Fresh profile => empty localStorage => the popup auto-opens. Verifies render, close, reopen, backdrop-close.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9341;
const BASE = "http://localhost:5199/?renderer=2d";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp-changelog`, `--remote-debugging-port=${PORT}`,
  "--window-size=1000,640", "about:blank",
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
  return new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function clickAt(x, y) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}
async function shot(name) {
  const img = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}`, Buffer.from(img.result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: BASE });

// wait for the app to boot and the popup to auto-open
for (let i = 0; i < 80; i++) {
  if (await evalJs(`!!(document.getElementById("changelog-modal") && !document.getElementById("changelog-modal").hidden)`)) break;
  await sleep(100);
}

const report = {};
report.autoOpened = await evalJs(`!document.getElementById("changelog-modal").hidden`);
report.sections = await evalJs(`document.querySelectorAll("#changelog-body section").length`);
report.newestHeader = await evalJs(`document.querySelector("#changelog-body section span")?.textContent`);
report.versionSynced = await evalJs(`document.getElementById("version").textContent.trim()`);
report.bodyScrollable = await evalJs(`(() => { const b=document.getElementById("changelog-body"); return b.scrollHeight > b.clientHeight; })()`);
await shot("shot-changelog-open.png");

// close via the X button (real click)
const closeRect = await evalJs(`(() => { const r=document.getElementById("changelog-close").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await clickAt(closeRect.x, closeRect.y);
await sleep(150);
report.closedByX = await evalJs(`document.getElementById("changelog-modal").hidden === true`);
report.seenStored = await evalJs(`localStorage.getItem("ruby.changelogSeen.v1")`);
await shot("shot-changelog-closed.png");

// reopen via the top-right icon (real click)
const iconRect = await evalJs(`(() => { const r=document.getElementById("btn-changelog").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await clickAt(iconRect.x, iconRect.y);
await sleep(150);
report.reopenedByIcon = await evalJs(`!document.getElementById("changelog-modal").hidden`);

// click the backdrop (a point inside the modal but outside the panel) closes it
const backdrop = await evalJs(`(() => { const m=document.getElementById("changelog-modal").getBoundingClientRect(); return {x:m.x+8,y:m.y+8}; })()`);
await clickAt(backdrop.x, backdrop.y);
await sleep(150);
report.closedByBackdrop = await evalJs(`document.getElementById("changelog-modal").hidden === true`);

console.log(JSON.stringify(report, null, 2));
ws.close();
chrome.kill();
process.exit(0);
