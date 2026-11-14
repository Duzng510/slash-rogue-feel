// Dump the code-baked sprites (src/render/pixelart.ts) into PNG atlases + JSON,
// so the same art exists as editable/exportable assets. Drives headless CDP Chrome
// against `npm run dev`; the page dynamic-imports pixelart.ts, nothing in game code changes.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9337;
const BASE = "http://localhost:5199/?manual=1&renderer=2d";
const ROOT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel";
const OUT = `${ROOT}/assets/sprites`;
const PREVIEW_SCALE = 4;
const SHEET_MAX_W = 2048;
const PAD = 2;

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/preview`, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${ROOT}/tools/out/cdp-sprites`, `--remote-debugging-port=${PORT}`,
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
for (let i = 0; i < 80; i++) {
  if (await evalJs("!!document.querySelector(\"canvas\")")) break;
  await sleep(100);
}

// One call per group keeps each CDP payload small; both return {sheet, preview, atlas}.
const BUILDER = `(() => {
  const place = (items) => {
    let x = ${PAD}, y = ${PAD}, rowH = 0, usedW = 0;
    const cells = items.map((it) => {
      if (x + it.s.c.width + ${PAD} > ${SHEET_MAX_W}) { x = ${PAD}; y += rowH + ${PAD}; rowH = 0; }
      const cell = { ...it, x, y };
      x += it.s.c.width + ${PAD};
      rowH = Math.max(rowH, it.s.c.height);
      usedW = Math.max(usedW, x);
      return cell;
    });
    return { cells, w: Math.min(usedW, ${SHEET_MAX_W}), h: y + rowH + ${PAD} };
  };
  const canvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  };
  const drawSheet = (layout, scale, labeled) => {
    const c = canvas(layout.w * scale, layout.h * scale);
    const g = c.getContext("2d");
    if (scale !== 1) g.imageSmoothingEnabled = false;
    if (labeled) {
      g.fillStyle = "#14161c";
      g.fillRect(0, 0, c.width, c.height);
    }
    for (const cell of layout.cells) {
      const w = cell.s.c.width * scale, h = cell.s.c.height * scale;
      g.drawImage(cell.s.c, cell.x * scale, cell.y * scale, w, h);
      if (labeled) {
        g.strokeStyle = "rgba(90,170,255,.55)";
        g.strokeRect(cell.x * scale + .5, cell.y * scale + .5, w - 1, h - 1);
        g.fillStyle = "#8fe3ff";
        g.font = "600 11px Consolas, monospace";
        g.fillText(cell.name, cell.x * scale + 3, cell.y * scale + 11);
      }
    }
    return c;
  };
  const encode = (cells) => {
    const atlas = {};
    for (const cell of cells) {
      atlas[cell.name] = {
        x: cell.x, y: cell.y,
        w: cell.s.c.width, h: cell.s.c.height,
        lw: cell.s.w, lh: cell.s.h,
        ax: cell.s.ax, ay: cell.s.ay,
      };
    }
    return atlas;
  };
  return { place, drawSheet, encode };
})()`;

async function dump(groupName, itemsExpr) {
  const out = await evalJs(`(async () => {
    const m = await import("/src/render/pixelart.ts");
    const H = ${BUILDER};
    const items = ${itemsExpr};
    const layout = H.place(items);
    return {
      count: items.length,
      size: { w: layout.w, h: layout.h },
      atlas: H.encode(layout.cells),
      sheet: H.drawSheet(layout, 1, false).toDataURL("image/png").split(",")[1],
      preview: H.drawSheet(layout, ${PREVIEW_SCALE}, true).toDataURL("image/png").split(",")[1],
    };
  })()`);
  if (!out?.sheet) throw new Error(`${groupName}: empty result from page`);
  writeFileSync(`${OUT}/${groupName}.png`, Buffer.from(out.sheet, "base64"));
  writeFileSync(`${OUT}/${groupName}.atlas.json`, JSON.stringify(out.atlas, null, 2) + "\n");
  writeFileSync(`${OUT}/preview/${groupName}-${PREVIEW_SCALE}x.png`, Buffer.from(out.preview, "base64"));
  console.log(`${groupName}.png  ${out.size.w}x${out.size.h}  ${out.count} entries`);
  return out;
}

const sprites = await dump("static", `(() => {
  const mk = (name, s) => ({ name, s });
  const S = m.buildSprites();
  return Object.keys(S).sort().map((name) => mk(name, S[name]));
})()`);

const anims = await dump("anims", `(() => {
  const mk = (name, s) => ({ name, s });
  const A = m.buildAnimSets();
  const items = [];
  for (const clip of Object.keys(A).sort()) {
    const set = A[clip];
    set.frames.forEach((s, i) => items.push(mk(clip + "_" + i, s)));
    set.mirrored.forEach((s, i) => items.push(mk(clip + "_" + i + "_flip", s)));
  }
  return items;
})()`);

// Pose strip: the checkpoint artifact — idle frames then windup | strike | recover, side by side.
const strips = await evalJs(`(async () => {
  const m = await import("/src/render/pixelart.ts");
  const { POSES } = await import("/src/render/art/index.ts");
  const A = m.buildAnimSets();
  const S = ${PREVIEW_SCALE};
  const out = [];
  for (const key of Object.keys(POSES).sort()) {
    const idle = A[key];
    const atk = A[key + "_attack"];
    if (!idle || !atk) { out.push({ key, error: "clip missing" }); continue; }
    const frames = idle.frames.concat(atk.frames);
    const labels = idle.frames.map((f, i) => "idle" + i).concat(["windup", "strike", "recover"]);
    const cellW = Math.max.apply(null, frames.map((f) => f.c.width)) * S + 8;
    const cellH = Math.max.apply(null, frames.map((f) => f.c.height)) * S + 18;
    const c = document.createElement("canvas");
    c.width = cellW * frames.length;
    c.height = cellH;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#14161c";
    g.fillRect(0, 0, c.width, c.height);
    frames.forEach((f, i) => {
      const w = f.c.width * S;
      g.drawImage(f.c, Math.round(i * cellW + (cellW - w) / 2), 16, w, f.c.height * S);
      g.fillStyle = "#8fe3ff";
      g.font = "600 11px Consolas, monospace";
      g.fillText(labels[i], i * cellW + 3, 11);
    });
    out.push({ key, frames: frames.length, png: c.toDataURL("image/png").split(",")[1] });
  }
  return out;
})()`);

for (const s of strips) {
  if (s.error) throw new Error(`pose strip ${s.key}: ${s.error}`);
  writeFileSync(`${OUT}/preview/pose-${s.key}.png`, Buffer.from(s.png, "base64"));
  console.log(`pose-${s.key}.png  ${s.frames} frames`);
}

const pixelScale = await evalJs(`(async () => (await import("/src/config.ts")).CONFIG.WORLD.PIXEL_SCALE)()`);
writeFileSync(
  `${OUT}/manifest.json`,
  JSON.stringify({
    source: "src/render/pixelart.ts (buildSprites + buildAnimSets)",
    pixelScale,
    note: `x/y/w/h are pixels inside the PNG; lw/lh are the logical art size before bake scaled by pixelScale; ax/ay are anchor offsets in lw/lh units.`,
    groups: {
      static: { entries: sprites.count, size: sprites.size },
      anims: { entries: anims.count, size: anims.size },
    },
  }, null, 2) + "\n"
);

ws.close();
chrome.kill();
console.log(`wrote ${Object.keys(sprites.atlas).length + Object.keys(anims.atlas).length} sprites to ${OUT}`);
process.exit(0);
