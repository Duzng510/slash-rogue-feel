// Dev-only archetype capture: drives the __game harness over headless CDP Chrome.
// Throws if a requested frame never happens, so a stale or missing frame cannot pass as a result.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const BASE = "http://localhost:5199/?manual=1&seed=42";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp2`, `--remote-debugging-port=${PORT}`,
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

/**
 * run setup, then step frames until pred holds.
 * advance happens BEFORE the check: in manual mode nothing is drawn unless a frame is stepped,
 * so checking first would screenshot the previous shot's frame.
 */
async function shot(name, setup, predExpr, maxTicks = 900) {
  const result = await evalJs(`(() => {
    const g = window.__game;
    ${setup}
    let s = g.state();
    const near = (kind, r) => s.enemies.some((e) => e.kind === kind && Math.hypot(e.x - s.player.x, e.y - s.player.y) < (r || 90));
    const tele = (kind, lo, hi) => s.enemies.some((e) => e.kind === kind && e.state === "telegraph" && e.telegraphTicksLeft >= lo && e.telegraphTicksLeft <= hi);
    for (let i = 0; i < ${maxTicks}; i++) {
      g.advance(1 / 60);
      s = g.state();
      if (${predExpr}) {
        return { ok: true, info: { room: s.roomIndex, at: i, enemies: s.enemies.map((e) => e.kind + ":" + e.state).join(",") } };
      }
    }
    return { ok: false, info: { enemies: s.enemies.map((e) => e.kind + ":" + e.state).join(",") } };
  })()`);

  if (result === undefined) throw new Error(`${name}: harness returned nothing`);
  if (!result.ok) throw new Error(`${name}: frame never reached in ${maxTicks} ticks — ${result.info.enemies}`);
  const img = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-${name}.png`, Buffer.from(img.result.data, "base64"));
  console.log(`shot-${name}.png`, JSON.stringify(result.info));
}

const walk = (dx, dy, ticks) => `
  g.setMove(${dx}, ${dy});
  for (let i = 0; i < ${ticks}; i++) g.advance(1 / 60);
  g.setMove(0, 0);`;

await shot(
  "kinds",
  `g.gotoRoom(6); ${walk(1, 0, 55)} g.addEnemies(3, ["charger", "splitter", "small"]);`,
  `near("boss") && near("charger") && near("splitter") && near("small") && s.enemies.every(e => e.state !== "attack" && e.state !== "dead")`
);

await shot(
  "charger-lane",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["charger"]);`,
  `s.enemies.length === 1 && tele("charger", 8, 20)`,
  300
);

await shot(
  "boss-ring",
  `g.gotoRoom(6);`,
  `tele("boss", 4, 14) && !s.enemies.some(e => e.kind === "boss" && e.enraged)`
);

await shot(
  "boss-enraged",
  `g.gotoRoom(6); const b = g.state().enemies.find(e => e.kind === "boss"); for (let i = 0; i < 13; i++) g.damageEnemy(b.id, 1);`,
  `s.enemies.some(e => e.kind === "boss" && e.enraged) && tele("boss", 4, 12)`
);

await shot(
  "crowd",
  `g.gotoRoom(1); ${walk(1, 0, 40)} g.addEnemies(8);`,
  `s.enemies.filter(e => e.state === "telegraph").length >= 4`
);

await shot(
  "ranged",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["ranged"]);`,
  `tele("ranged", 1, 40)`
);

await shot(
  "ranged-shot",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["ranged"]);`,
  `s.projectiles > 0`
);

await shot(
  "teleporter",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["teleporter"]);`,
  `s.enemies.some(e => e.kind === "teleporter" && e.state !== "vanish" && e.state !== "dead")`
);

await shot(
  "teleporter-vanish",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["teleporter"]);`,
  `s.enemies.some(e => e.kind === "teleporter" && e.state === "vanish")`
);

await shot(
  "room-corridor",
  `g.gotoRoom(4);`,
  `s.enemies.length === 5 && !s.player.dead`,
  10
);

await shot(
  "room-arena",
  `g.gotoRoom(5);`,
  `s.enemies.length === 10 && !s.player.dead`,
  10
);

ws.close();
chrome.kill();
process.exit(0);
