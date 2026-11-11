// Dev-only: prove the on-screen controls actually move/attack the player, over CDP.
import { spawn } from "node:child_process";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const URL = "http://localhost:5199/?manual=1&touch=1&seed=42";
const OUT = "C:/Users/My Lenovo/Desktop/Vibe/slash-rogue-feel/tools/out";
const chrome = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars",
  `--user-data-dir=${OUT}/cdp2`,`--remote-debugging-port=${PORT}`,"--window-size=820,720","about:blank"],{stdio:"ignore"});
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function target(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();const p=l.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);if(p)return p;}catch{}await sleep(150);}throw new Error("no cdp");}
const page=await target();const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener("open",r,{once:true}));
let id=0;const pend=new Map();ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(expr)=>{const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
await send("Page.enable");await send("Runtime.enable");await send("Page.navigate",{url:URL});
for(let i=0;i<60;i++){if(await ev("!!(window.__game&&window.__game.ready)"))break;await sleep(100);}

// touch layer visible?
const visible = await ev("getComputedStyle(document.getElementById('touch')).display");

// drag the stick to the right, then step frames and watch the player move.
const moved = await ev(`(() => {
  const stick = document.getElementById('stick');
  const r = stick.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  stick.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,clientX:cx,clientY:cy,bubbles:true}));
  window.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,clientX:cx+60,clientY:cy,bubbles:true}));
  const g = window.__game;
  const x0 = g.state().player.x;
  for (let i=0;i<30;i++) g.advance(1/60);
  return { dx: Math.round(g.state().player.x - x0), state: g.state().player.state };
})()`);

// tap CHÉM, step frames, expect a swing.
const slashed = await ev(`(() => {
  const g = window.__game;
  document.getElementById('btn-attack').dispatchEvent(new PointerEvent('pointerdown',{pointerId:8,bubbles:true}));
  for (let i=0;i<8;i++) g.advance(1/60);
  return g.state().player.swing;
})()`);

// tap DASH, expect dash state or dash cooldown ticking.
const dashed = await ev(`(() => {
  const g = window.__game;
  document.getElementById('btn-dash').dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,bubbles:true}));
  for (let i=0;i<4;i++) g.advance(1/60);
  return g.state().player.state;
})()`);

console.log(JSON.stringify({ visible, moved, slashed, dashed }, null, 2));
ws.close();chrome.kill();process.exit(0);
