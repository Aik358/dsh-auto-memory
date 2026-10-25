/**
 * 记忆浮窗回归检查（E1 收口后）
 *
 * 目的：用户报「左下角记忆浮窗被改坏了」。用真 Chrome 证明 E1 注入的 EV4_CSS 是否会影响到它。
 * 核心判据：注入 EV4_CSS 前后，浮窗相关元素的 computed 样式必须**逐字不变**。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HERE = 'D:/dsh-auto-memory/artifacts/ev4-poc'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'D:/dsh-auto-memory/artifacts/e1-closure'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitJson (u, t = 90) {
  for (let i = 0; i < t; i++) {
    try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {}
    await sleep(200)
  }
  throw new Error('cdp timeout')
}
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value }
}

const SAMPLE_SELECTORS = ['.detail', '.topbar', '.badge', '.card', '.panel', '.chip', '.legend', '.rail']
const SAMPLE_JS = '(function(){ var out={}; ' + JSON.stringify(SAMPLE_SELECTORS) + '.forEach(function(sel){ var el=document.querySelector(sel); if(!el){out[sel]=null;return;} var c=getComputedStyle(el); out[sel]={color:c.color,bg:c.backgroundColor,font:c.fontSize,dur:c.transitionDuration,radius:c.borderRadius}; }); return out; })()'

const port = 9451
const profile = path.join(HERE, '.cdp-float-' + Date.now())
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1600,1000', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' })

const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond, msg }); console.log((cond ? '  ok   - ' : '  FAIL - ') + msg) }

try {
  await waitJson('http://127.0.0.1:' + port + '/json/version')
  const list = await waitJson('http://127.0.0.1:' + port + '/json/list')
  const cdp = await CDP.connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'file:///' + path.join(HERE, 'index.html').replace(/\\/g, '/') })
  await sleep(2600)

  console.log('== 1. 关键事实：页面里 .dam-ev4 容器数量 ==')
  const ev4Count = await cdp.eval('document.querySelectorAll(".dam-ev4").length')
  ok(ev4Count === 0, '页面里 .dam-ev4 容器 = ' + ev4Count + '（POC 用 .ev4-app，不是 .dam-ev4）')

  console.log('')
  console.log('== 2. ★核心判据：注入 EV4_CSS 前后浮窗元素样式必须逐字不变 ==')
  const clientSrc = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')
  const at = clientSrc.indexOf('var EV4_CSS = [')
  const ob = clientSrc.indexOf('[', at)
  let dep = 0, cb = -1
  for (let i = ob; i < clientSrc.length; i++) { const c = clientSrc[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
  const ev4Arr = await cdp.eval('(' + clientSrc.slice(ob, cb + 1) + ')')
  const ev4Css = ev4Arr.join(String.fromCharCode(10))
  console.log('  EV4_CSS 长度 ' + ev4Css.length)

  const before = await cdp.eval(SAMPLE_JS)
  await cdp.eval('(function(){ var s=document.createElement("style"); s.id="ev4-probe-style"; s.textContent=' + JSON.stringify(ev4Css) + '; document.head.appendChild(s); })()')
  await sleep(300)
  const after = await cdp.eval(SAMPLE_JS)

  let diffs = 0
  for (const sel of Object.keys(before)) {
    const b = JSON.stringify(before[sel]); const a = JSON.stringify(after[sel])
    if (b !== a) { diffs++; console.log('  WARN 差异 ' + sel + ': ' + b + ' -> ' + a) }
  }
  ok(diffs === 0, '★★★[核心] 注入 EV4_CSS 前后，' + SAMPLE_SELECTORS.length + ' 个元素 computed 样式逐字不变（差异 ' + diffs + ' 个）')

  const ev4After = await cdp.eval('document.querySelectorAll(".dam-ev4").length')
  ok(ev4After === 0, '注入后 .dam-ev4 容器仍 = ' + ev4After + ' ⇒ 全部作用域规则命不中')

  console.log('')
  console.log('== 3. 正向对照：规则确实是活的（手动加容器就生效）==')
  const withContainer = await cdp.eval('(function(){ var d=document.createElement("div"); d.className="dam-ev4"; var inner=document.createElement("div"); inner.className="card"; d.appendChild(inner); document.body.appendChild(d); var c=getComputedStyle(inner); var r={bg:c.backgroundColor,radius:c.borderRadius}; d.remove(); return r; })()')
  ok(withContainer && withContainer.bg !== 'rgba(0, 0, 0, 0)', '★[正向] 手动加 .dam-ev4 > .card 规则确实生效（bg=' + (withContainer && withContainer.bg) + '）⇒ 规则活的，只是当前无容器')

  fs.writeFileSync(path.join(OUT, 'float-check.json'), JSON.stringify({ ev4Count, before, after, diffs, withContainer }, null, 2), 'utf8')
} catch (e) {
  console.log('ERROR: ' + (e && e.message))
  results.push({ cond: false, msg: '脚本异常：' + (e && e.message) })
} finally {
  chrome.kill()
  const fail = results.filter((r) => !r.cond).length
  console.log('')
  console.log('SUMMARY  PASS ' + (results.length - fail) + ' / FAIL ' + fail)
  process.exit(fail > 0 ? 1 : 0)
}