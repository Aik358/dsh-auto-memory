import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2];

/* 用 CDP 拿「渲染后真实态」：可见元素数、隐藏元素数、computed 颜色 */
const port = 9333 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  '--window-size=1440,900', '--user-data-dir=' + process.env.TEMP + '/_cdp' + port,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function cdp(path, method = 'GET', body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

try {
  await sleep(1800);
  const { webSocketDebuggerUrl } = await cdp('/json/version');
  const WS = (await import('node:worker_threads'), globalThis).WebSocket;
  if (!WS) { console.log('无 WebSocket，改用 fetch+DOM 方案'); process.exit(0); }

  const ws = new WS(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise(r => { ws.onopen = r; });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  const expr = `(() => {
    const all = [...document.querySelectorAll('section, .reveal, .sheet, h1, h2, p, a, button, canvas, img, svg')];
    let hidden = 0, visible = 0;
    const hiddenSamples = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      const op = parseFloat(cs.opacity);
      const vis = cs.visibility;
      const disp = cs.display;
      const isHidden = op < 0.05 || vis === 'hidden' || disp === 'none';
      if (isHidden) { hidden++; if (hiddenSamples.length < 8) hiddenSamples.push((el.tagName + '.' + (el.className||'')).slice(0,50) + ' op=' + op); }
      else visible++;
    }
    return JSON.stringify({
      total: all.length, visible, hidden,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      bodyFont: getComputedStyle(document.body).fontSize,
      docH: document.documentElement.scrollHeight,
      sections: document.querySelectorAll('section').length,
      reveals: document.querySelectorAll('.reveal').length,
      revealsIn: document.querySelectorAll('.reveal.in').length,
      hiddenSamples,
    });
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const d = JSON.parse(r.result.value);
  console.log('════ 渲染后真实态 ════');
  console.log(`  元素总数 ${d.total}  可见 ${d.visible}  隐藏 ${d.hidden}`);
  console.log(`  body 背景 ${d.bodyBg}   文字色 ${d.bodyColor}   字号 ${d.bodyFont}`);
  console.log(`  文档高 ${d.docH}px   section ${d.sections}   .reveal ${d.reveals}（已入场 ${d.revealsIn}）`);
  if (d.hiddenSamples.length) { console.log('  隐藏样本:'); d.hiddenSamples.forEach(s => console.log('    ' + s)); }

  writeFileSync('artifacts/_diag.json', JSON.stringify(d, null, 2));
  ws.close();
} catch (e) {
  console.log('CDP 失败:', e.message);
} finally {
  chrome.kill();
}
