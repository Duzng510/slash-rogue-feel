// Town capture: five frames of the market map over the dev server, driven through window.__game.
// Throws when a frame never happens, so a roof that stopped peeling cannot pass as a result.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9338;
const BASE = `http://localhost:5199/?manual=1&seed=42${process.argv[2] ?? ""}`;
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp8`, `--remote-debugging-port=${PORT}`,
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

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: BASE });
for (let i = 0; i < 80; i++) {
  if (await evalJs("!!(window.__game && window.__game.ready)")) break;
  await sleep(100);
}

/**
 * room-tile centre -> pixels, matching how Room places spawns and props.
 * `want` is the house whose roof should be peeled (null = standing in the open).
 */
async function shot(name, tx, ty, want, settle = 45) {
  const info = await evalJs(`(() => {
    const g = window.__game;
    g.enterTown();
    g.placePlayer(${(tx + 0.5) * 16}, ${(ty + 0.75) * 16});
    const want = ${want === null ? "null" : `"${want}"`};
    let s = null;
    for (let i = 0; i < 240; i++) {
      g.advance(1 / 60);
      s = g.state();
      if (s.activeHouse === want && s.player.state !== "dash") break;
    }
    for (let i = 0; i < ${settle}; i++) g.advance(1 / 60);
    s = g.state();
    return { at: [Math.round(s.player.x), Math.round(s.player.y)], house: s.activeHouse, npcs: s.runStats ? 1 : 1, room: s.roomIndex };
  })()`);
  if (info === undefined) throw new Error(`${name}: harness returned nothing`);
  if (info.house !== want) throw new Error(`${name}: roof state ${info.house}, expected ${want}`);
  const img = await send("Page.captureScreenshot", { format: "png" });
  const tag = process.argv[2] ? "-2d" : "";
  writeFileSync(`${OUT}/town-${name}${tag}.png`, Buffer.from(img.result.data, "base64"));
  console.log(`town-${name}${tag}.png`, JSON.stringify(info));
}

// room coords = inner town grid + the 1-tile border Room adds
await shot("street", 11, 12, null);          // main street, every roof on
await shot("master-in", 7, 5, "master");     // inside Nhà Sư phụ: floor, walls, NPC
await shot("merchant-door", 34, 9, "merchant"); // threshold peel at the shop
await shot("forge-door", 11, 19, "forge");   // north-facing door of the smithy
await shot("plaza", 20, 15, null);           // well, lanterns and trees on the square
chrome.kill();
