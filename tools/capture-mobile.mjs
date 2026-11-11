// Throwaway: mobile layout check. Emulates a portrait phone, then the same device rotated.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
const URL = "http://localhost:5199/?manual=1&touch=1&seed=42";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp2`, `--remote-debugging-port=${PORT}`,
  "--window-size=390,844", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error("CDP endpoint never came up");
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "window.__errs=[];addEventListener('error',(e)=>window.__errs.push(String(e.message)));addEventListener('unhandledrejection',(e)=>window.__errs.push('promise: '+String(e.reason)));",
});

async function shot(name, w, h) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: URL });
  for (let i = 0; i < 60; i++) {
    if (await evalJs("!!(window.__game && window.__game.ready)")) break;
    const errs = await evalJs("(window.__errs || []).join(' | ')");
    if (i === 59) throw new Error(`${name}: harness never loaded — ${errs}`);
    if (errs) throw new Error(`${name}: page error — ${errs}`);
    await sleep(100);
  }
  const info = await evalJs(`(() => {
    const g = window.__game;
    for (let i = 0; i < 40; i++) g.advance(1 / 60);
    const c = document.getElementById("game");
    const stick = document.getElementById("stick").getBoundingClientRect();
    const btn = document.getElementById("btn-attack").getBoundingClientRect();
    return {
      body: document.body.className,
      canvas: c.style.width + "x" + c.style.height,
      stick: [Math.round(stick.left), Math.round(stick.top), Math.round(stick.width)],
      attack: [Math.round(btn.left), Math.round(btn.top), Math.round(btn.width)],
    };
  })()`);
  if (info.body === undefined) throw new Error(`${name}: no harness`);
  const img = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-${name}.png`, Buffer.from(img.result.data, "base64"));
  console.log(`shot-${name}.png`, JSON.stringify(info));
}

await shot("mobile-portrait", 390, 844);
await shot("mobile-landscape", 844, 390);

// end-to-end stick mapping: drag the knob 40px toward screen right and read the CSS it produces.
// in the rotated app, screen right is app up, so the knob must move -40 on its own y axis.
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: URL });
for (let i = 0; i < 60; i++) if (await evalJs("!!(window.__game && window.__game.ready)")) break;
const probe = await evalJs(`(() => {
  Element.prototype.setPointerCapture = () => {};
  const g = window.__game;
  for (let i = 0; i < 5; i++) g.advance(1 / 60);
  const stick = document.getElementById("stick");
  const knob = document.getElementById("knob");
  const r = stick.getBoundingClientRect();
  const fire = (t, x, y) => (t === "pointerdown" ? stick : window).dispatchEvent(
    new PointerEvent(t, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
  fire("pointerdown", r.left + r.width / 2, r.top + r.height / 2);
  fire("pointermove", r.left + r.width / 2 + 40, r.top + r.height / 2);
  const rotated = knob.style.transform;
  fire("pointerup", r.left + r.width / 2 + 40, r.top + r.height / 2);
  fire("pointerdown", r.left + r.width / 2, r.top + r.height / 2);
  fire("pointermove", r.left + r.width / 2 + 40, r.top + r.height / 2);
  const moved = [g.state().player.x, g.state().player.y];
  return { body: document.body.className, rotated, moved };
})()`);
console.log("stick probe", JSON.stringify(probe));

ws.close();
chrome.kill();
process.exit(0);
