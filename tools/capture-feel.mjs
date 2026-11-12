// Dev-only feel capture: drives the __game harness over CDP and screenshots a mid-swing frame.
// Throwaway tool, not part of the shipped game.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const GL = process.env.RENDERER === "gl";
const URL = "http://localhost:5199/?manual=1&seed=42" + (GL ? "&renderer=gl" : "&renderer=2d");
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  ...(GL
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    : ["--disable-gpu"]),
  `--user-data-dir=${OUT}/cdp`, `--remote-debugging-port=${PORT}`,
  "--window-size=960,540", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
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
await send("Page.navigate", { url: URL });

// wait for the harness to be installed
for (let i = 0; i < 60; i++) {
  if (await evalJs("!!(window.__game && window.__game.ready)")) break;
  await sleep(100);
}

// desktop pointer path: a real click on the middle card must pick that character and start the run
await evalJs("window.__game.advance(1/60)");
const modalShot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/shot-character-modal${GL ? "-gl" : ""}.png`, Buffer.from(modalShot.result.data, "base64"));
const card = await evalJs(`(() => { const r = document.getElementById("overlay").getBoundingClientRect();
  return { x: r.left + r.width * (160 / 320), y: r.top + r.height * (100 / 180) }; })()`);
for (const type of ["mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", { type, x: card.x, y: card.y, button: "left", clickCount: 1 });
}
const picked = await evalJs("({ character: window.__game.state().character, choices: window.__game.state().characterChoices.length })");
console.log("modal click ->", JSON.stringify(picked));
if (picked.character !== "mage" || picked.choices !== 0) throw new Error("middle card click did not pick the mage");

// spawn enemies around the player, walk in, then advance until a swing is in its active frames.
await evalJs(`(() => {
  const g = window.__game;
  g.gotoRoom(0);
  const p = g.state().player;
  g.addEnemies(3);
  return g.state().enemies.map(e => ({x:Math.round(e.x-p.x), y:Math.round(e.y-p.y)}));
})()`);

// drive: hold move toward nearest enemy, press attack, step frames, stop when swing phase is active.
const caught = await evalJs(`(() => {
  const g = window.__game;
  for (let i = 0; i < 400; i++) {
    const s = g.state();
    const p = s.player;
    let best = null, bd = Infinity;
    for (const e of s.enemies) { if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
    if (!best) break;
    const a = Math.atan2(best.y - p.y, best.x - p.x);
    g.setMove(Math.cos(a), Math.sin(a));
    g.setAim(best.x, best.y);
    if (bd < 34) { g.pressAttack(); }
    g.advance(1/60);
    const s2 = g.state();
    if (s2.player.swing && s2.hitStop > 0) {
      return { frame: i, swing: s2.player.swing, hitStop: s2.hitStop, particles: s2.particles, fx: s2.fx, dist: Math.round(bd) };
    }
  }
  return null;
})()`);

if (caught) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-slash${GL ? "-gl" : ""}.png`, Buffer.from(shot.result.data, "base64"));
  console.log("slash frame:", JSON.stringify(caught));
} else {
  console.log("no active-swing+hitstop frame caught");
}

ws.close();
chrome.kill();
process.exit(0);
