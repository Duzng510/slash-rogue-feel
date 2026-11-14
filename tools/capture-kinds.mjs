// Dev-only archetype capture: drives the __game harness over headless CDP Chrome.
// Throws if a requested frame never happens, so a stale or missing frame cannot pass as a result.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const BASE = "http://localhost:5199/?manual=1&seed=42&renderer=2d";
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
// a fresh profile only unlocks two artifacts, too few for a curse package to draw from
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `localStorage.setItem("ruby.achievements.v1", JSON.stringify({ earned: ["first_blood","room_clear","half_way","combo_master","speedrun","flawless_room","full_run","heavy_hitter","fire_and_ice"], best: null }));`,
});
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
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(4, ["boss", "charger", "splitter", "small"]);`,
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
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["boss"]);`,
  `tele("boss", 4, 14) && !s.enemies.some(e => e.kind === "boss" && e.enraged)`
);

await shot(
  "boss-enraged",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["boss"]); const b = g.state().enemies.find(e => e.kind === "boss"); for (let i = 0; i < 13; i++) g.damageEnemy(b.id, 1);`,
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

await shot(
  "new-kinds",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(5, ["healer", "exploder", "shielder", "sniper", "jumper"]);`,
  `["healer", "exploder", "shielder", "sniper", "jumper"].every(k => s.enemies.some(e => e.kind === k)) && !s.enemies.some(e => e.dead || e.state === "attack")`,
  120
);

await shot(
  "sniper-beam",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(1, ["sniper"]);`,
  `s.enemies.some(e => e.kind === "sniper" && e.state === "attack")`,
  300
);

await shot(
  "elite",
  `g.gotoRoom(0); g.clearEnemies(); g.addEnemies(2, ["chaser", "shielder"], true);`,
  `s.enemies.filter(e => e.elite).length === 2 && !s.enemies.some(e => e.state === "attack")`,
  60
);

await shot(
  "warden",
  `g.gotoRoom(5);`,
  `s.enemies.some(e => e.kind === "warden" && e.state === "telegraph")`,
  400
);

await shot(
  "warden-laser",
  `g.gotoRoom(5); g.clearEnemies(); g.addEnemies(1, ["warden"]);`,
  `s.enemies.some(e => e.kind === "warden" && e.pattern === "laser" && e.state === "telegraph")`,
  400
);

// room 16 "Sàn nghi thức" and room 7 are the scripted king/golem rooms
await shot(
  "king-ring",
  `g.gotoRoom(16);`,
  `tele("king", 4, 14)`,
  400
);

await shot(
  "golem-slam",
  `g.gotoRoom(7);`,
  `tele("golem", 4, 14)`,
  400
);

await shot(
  "room-traps",
  `g.gotoRoom(9); ${walk(1, 0, 30)}`,
  `s.roomIndex === 9 && !s.player.dead`,
  40
);

// the shop hit-test works in HUD columns, and prices come from CONFIG, so read the real heal price
const HEAL_PRICE = await evalJs(`(async () => (await import("/src/config.ts")).CONFIG.SHOP.HEAL)()`);

await shot(
  "shop",
  `g.gotoRoom(0); g.addEnemies(8); for (const e of g.state().enemies) g.damageEnemy(e.id, 99); g.gotoRoom(10);`,
  `s.shopOffers === 3 && s.runStats.gold >= ${HEAL_PRICE}`,
  30
);

// real mouse clicks prove the shop pointer wiring: buy the heal card, then leave
const shopBefore = await evalJs(`window.__game.state()`);
const healIdx = shopBefore.shopKinds.indexOf("heal");
if (healIdx < 0) throw new Error("shop has no heal card");
const clickAt = async (ux, uy) => {
  const pt = await evalJs(`(() => {
    const r = document.getElementById("overlay").getBoundingClientRect();
    return { x: r.left + (${ux} / 320) * r.width, y: r.top + (${uy} / 180) * r.height };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  }
};
// modal.ts hit-tests shop cards as three columns centred at x 58/160/262, y band 38..158
await clickAt(58 + healIdx * 102, 98);
const bought = await evalJs(`(() => { const g = window.__game; g.advance(1 / 60); return g.state(); })()`);
if (bought.runStats.gold !== shopBefore.runStats.gold - HEAL_PRICE || bought.shopOffers !== 2) {
  throw new Error(`shop buy click failed: ${JSON.stringify({ before: shopBefore.runStats.gold, after: bought.runStats.gold, offers: bought.shopOffers })}`);
}
const boughtImg = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/shot-shop-bought.png`, Buffer.from(boughtImg.result.data, "base64"));
console.log("shot-shop-bought.png", JSON.stringify({ gold: bought.runStats.gold, offers: bought.shopOffers }));
await clickAt(160, 172);
const leftShop = await evalJs(`(() => { const g = window.__game; g.advance(1 / 60); return g.state().shopOffers; })()`);
if (leftShop !== 0) throw new Error(`shop leave click failed: ${leftShop}`);
console.log("shop leave click ok");

await shot(
  "curse-modal",
  `g.gotoRoom(8);`,
  `s.curseOffer !== null && s.artifactChoices.length === 3`,
  60
);

await shot(
  "curse-tab",
  `g.setCurseTab(true);`,
  `s.curseOffer !== null`,
  5
);

// screenshots prove rendering, not tapping: click curse card 0 with a real mouse event
// and require the bundle (offer consumed + exactly 2 artifacts) to prove the pointer wiring.
// a treasure offer carries one curse, drawn in the first HUD column (x band 12..104).
const before = await evalJs(`window.__game.state().artifacts.length`);
const pt = await evalJs(`(() => {
  const r = document.getElementById("overlay").getBoundingClientRect();
  return { x: r.left + (58 / 320) * r.width, y: r.top + (59 / 180) * r.height };
})()`);
for (const type of ["mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
}
const picked = await evalJs(`(() => {
  const g = window.__game; g.advance(1 / 60);
  const s = g.state(); return { offer: s.curseOffer, artifacts: s.artifacts.length };
})()`);
if (picked.offer !== null || picked.artifacts !== before + 2) {
  throw new Error(`curse click failed: ${JSON.stringify({ before, ...picked })}`);
}
const pickedImg = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/shot-curse-picked.png`, Buffer.from(pickedImg.result.data, "base64"));
console.log("shot-curse-picked.png", JSON.stringify({ before, ...picked }));

ws.close();
chrome.kill();
process.exit(0);
