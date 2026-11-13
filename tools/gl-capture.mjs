// Scratch GL capture: drive a melee swing in WebGL mode and screenshot the game canvas.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const URL = "http://localhost:5199/?manual=1&seed=42&renderer=gl";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--user-data-dir=${OUT}/cdp-glcap`, `--remote-debugging-port=${PORT}`,
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
async function shot(name) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}`, Buffer.from(s.result.data, "base64"));
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: URL });
for (let i = 0; i < 60; i++) { if (await evalJs("!!(window.__game && window.__game.ready)")) break; await sleep(100); }

await evalJs(`window.__game.pickCharacter("swordsman"); window.__game.chooseWeapon("katana")`);
await evalJs(`(() => { const g = window.__game; g.gotoRoom(0); g.addEnemies(5, ["chaser"]); return g.state().enemies.length; })()`);
await evalJs("window.__game.advance(1/60)");
await sleep(200);
await shot("shot-gl-stand.png");
await evalJs(`(() => { const g = window.__game; g.gotoRoom(1); g.addEnemies(3, ["chaser"]); for (let i = 0; i < 30; i++) g.advance(1/60); return g.state().enemies.length; })()`);
await sleep(200);
await shot("shot-gl-dungeon.png");

// drive the swordsman into range and catch an active melee swing + hit-stop
const caught = await evalJs(`(() => {
  const g = window.__game;
  for (let i = 0; i < 400; i++) {
    const s = g.state(); const p = s.player;
    let best = null, bd = Infinity;
    for (const e of s.enemies) { if (e.state === 'dead') continue; const d = Math.hypot(e.x-p.x, e.y-p.y); if (d < bd) { bd = d; best = e; } }
    if (!best) break;
    const a = Math.atan2(best.y-p.y, best.x-p.x);
    g.setMove(Math.cos(a), Math.sin(a)); g.setAim(best.x, best.y);
    if (bd < 34) g.pressAttack();
    g.advance(1/60);
    const s2 = g.state();
    if (s2.player.swing && s2.hitStop > 0) return { frame: i, swing: s2.player.swing, hitStop: s2.hitStop, fx: s2.fx, dist: Math.round(bd) };
  }
  return null;
})()`);
await sleep(200);
await shot("shot-gl-slash.png");
console.log("slash:", JSON.stringify(caught));
if (errs.length) console.log("EXCEPTIONS:", errs.join(" | ")); else console.log("no page exceptions");

chrome.kill();
process.exit(0);
