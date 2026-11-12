// Mage ranged normal-attack capture: proves the mage fires violet bolts (not a melee arc)
// and that bolts read as a distinct color from the orange fireball skill. Headless CDP over `npm run dev`.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const BASE = "http://localhost:5199/?manual=1&seed=42";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp-mage`, `--remote-debugging-port=${PORT}`,
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

/** reload so characterChoices/weaponChoices are repopulated for a fresh pick */
async function loadPage() {
  await send("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) {
    if (await evalJs("!!(window.__game && window.__game.ready)")) return;
    await sleep(100);
  }
  throw new Error("game never became ready after reload");
}

/**
 * run setup, then advance one frame at a time until `cond` holds (or throw).
 * `settle` extra frames let the bolts leave the body so the screenshot shows them mid-flight.
 */
async function shot(name, setup, cond, settle, maxTicks = 200) {
  const info = await evalJs(`(() => {
    const g = window.__game;
    ${setup}
    let s = g.state();
    for (let i = 0; i < ${maxTicks}; i++) {
      s = g.state();
      if (${cond}) break;
      g.pressAttack();
      g.advance(1 / 60);
      s = g.state();
    }
    if (!(${cond})) return { ok: false, s };
    for (let j = 0; j < ${settle}; j++) g.advance(1 / 60);
    return { ok: true, s: g.state() };
  })()`);
  if (info === undefined) throw new Error(`${name}: harness returned nothing`);
  if (!info.ok) throw new Error(`${name}: condition never met — ${JSON.stringify({ proj: info.s.projectiles, char: info.s.character })}`);
  const img = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/shot-${name}.png`, Buffer.from(img.result.data, "base64"));
  console.log(`shot-${name}.png`, JSON.stringify({ character: info.s.character, weapon: info.s.weapon, projectiles: info.s.projectiles, state: info.s.player.state }));
}

// greatsword volley: a wide weapon -> a fan of violet bolts, captured right at spawn while airborne
await shot(
  "mage-greatsword",
  `g.pickCharacter("mage"); g.chooseWeapon("greatsword"); g.gotoRoom(0); g.addEnemies(3, ["chaser"]);`,
  `s.projectiles >= 3`,
  2,
  300
);

// the fireball skill on its own: a single orange shot, distinct from the violet bolts above
await loadPage();
const fire = await evalJs(`(() => {
  const g = window.__game;
  g.pickCharacter("mage"); g.chooseWeapon("katana"); g.gotoRoom(0); g.addEnemies(3, ["chaser"]);
  let s = g.state();
  for (let i = 0; i < 200 && s.projectiles === 0; i++) { g.pressSkill(); g.advance(1 / 60); s = g.state(); }
  for (let j = 0; j < 3; j++) { g.advance(1 / 60); s = g.state(); }
  return { character: s.character, weapon: s.weapon, projectiles: s.projectiles, tick: s.tick };
})()`);
if (fire.projectiles < 1) throw new Error(`fireball shot: no projectile airborne — ${JSON.stringify(fire)}`);
const fireImg = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/shot-mage-fireball.png`, Buffer.from(fireImg.result.data, "base64"));
console.log("shot-mage-fireball.png", JSON.stringify(fire));

ws.close();
chrome.kill();
process.exit(0);
