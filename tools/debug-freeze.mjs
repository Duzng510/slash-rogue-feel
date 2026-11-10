// Throwaway diagnostic v2: sample sim liveness (hitStop + player position, not tickCount) while
// the player is swarmed, and print every swallowed eval error with its stack.
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9337;
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
const exceptions = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") exceptions.push(fmt(m.params.exceptionDetails));
});
function fmt(d) {
  const frames = d.exception?.stackTrace?.callFrames ?? d.stackTrace?.callFrames ?? [];
  const top = frames.slice(0, 4).map((f) => `${f.functionName || "anon"} @ ${(f.url || "").split("/").pop()}:${f.lineNumber}:${f.columnNumber}`);
  return `${d.exception?.description || d.text} ### ${top.join(" <- ")}`;
}
const send = (method, params = {}) =>
  new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });

async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) { const e = fmt(r.result.exceptionDetails); exceptions.push(`EVAL: ${e}`); return `ERR<${e}>`; }
  return r.result?.result?.value;
}

const LIVE = `(() => { const s = window.__game.state();
  return { tick: s.tick, stop: s.hitStop, hp: s.player.hp, x: Math.round(s.player.x), y: Math.round(s.player.y),
    alive: s.enemies.filter(e => e.state !== "dead").length, parts: s.particles }; })()`;

async function scenario(label, setup) {
  exceptions.length = 0;
  await evalJs(`(() => { const g = window.__game; ${setup} return 1; })()`);
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push(await evalJs(LIVE));
    await sleep(500);
  }
  const moved = new Set(rows.map((r) => `${r.x},${r.y}`)).size;
  const stuck = rows.slice(-4).every((r) => r.stop > 0);
  console.log(`\n[${label}] distinct positions=${moved} last4hitStop=${rows.slice(-4).map((r) => r.stop).join(",")} hp=${rows.at(-1).hp} alive=${rows.at(-1).alive}`);
  for (const r of rows) console.log(`   tick=${r.tick} stop=${r.stop} hp=${r.hp} pos=${r.x},${r.y} alive=${r.alive} parts=${r.parts}`);
  console.log(`   ${stuck ? "SIM FROZEN IN HIT-STOP" : "sim advancing normally"}`);
  for (const e of exceptions) console.log(`   EXCEPTION ${e}`);
  if (exceptions.length === 0) console.log("   no exceptions");
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:5199/?touch=1&seed=42" });
for (let i = 0; i < 80; i++) if (await evalJs("!!(window.__game && window.__game.ready)")) break;

// walking + swinging while swarmed, the way a real session plays
const drive = `
  g.setMove(0.7, 0.2);
  window.__drive = setInterval(() => { const G = window.__game; G.pressAttack(); }, 260);
  g.addEnemies(10);`;
await scenario("swarm room1 (moving+attacking)", `g.gotoRoom(1); ${drive}`);
await scenario("boss room4 (rings on player)", `clearInterval(window.__drive); g.gotoRoom(4); g.setMove(0, 0);`);
await scenario("splitters room3", `g.gotoRoom(3); g.addEnemies(6, ["splitter"]); g.setMove(0.3, -0.3);`);

ws.close();
chrome.kill();
process.exit(0);
