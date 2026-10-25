import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'D:/dsh-auto-memory/artifacts/e1-closure'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value }
}

// 构造一个模拟宿主结构的 HTML：包含 data-composer-seat / data-composer-card / data-conversation-scroll
const HOST_HTML = `<!doctype html><html><head><style>
  [data-composer-seat]{height:120px;background:#eee}
  [data-composer-card]{height:80px;background:#ddd}
  [data-conversation-scroll]{height:400px;padding-bottom:120px;background:#f8f8f8}
  /* ===== 从 client.js 注入的两条规则（原文）===== */
  body[data-dam-fullpage] [data-composer-seat],body[data-dam-fullpage] [data-composer-card]{display:none!important;}
  body[data-dam-fullpage] [data-conversation-scroll]{padding-bottom:0!important;}
</style></head><body>
  <div data-conversation-scroll id="scroll">conversation</div>
  <div data-composer-seat id="seat"><div data-composer-card id="card"><textarea id="ta"></textarea></div></div>
</body></html>`

const port = 9452
const profile = path.join(OUT, '.cdp-composer-' + Date.now())
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1200,800', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' })
const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? '  ok   - ' : '  FAIL - ') + msg) }
try {
  await waitJson('http://127.0.0.1:' + port + '/json/version')
  const list = await waitJson('http://127.0.0.1:' + port + '/json/list')
  const cdp = await CDP.connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(HOST_HTML) })
  await sleep(600)

  console.log('== A. 未打标记（= 在「对话」页签）==')
  const noMark = await cdp.eval('({seat:getComputedStyle(document.getElementById("seat")).display,card:getComputedStyle(document.getElementById("card")).display,pad:getComputedStyle(document.getElementById("scroll")).paddingBottom,tag:document.body.hasAttribute("data-dam-fullpage")})')
  console.log(JSON.stringify(noMark))
  ok(noMark.seat !== 'none', '★[负路径] 无标记时 composer-seat **可见**（display=' + noMark.seat + '）⇒ 对话页打不了字的风险不存在')
  ok(noMark.card !== 'none', '★[负路径] 无标记时 composer-card **可见**')
  ok(noMark.pad === '120px', '★[负路径] 无标记时 padding-bottom 保持 120px（实测 ' + noMark.pad + '）')

  console.log('')
  console.log('== B. 打标记（= 在白板看板页签）==')
  await cdp.eval('document.body.setAttribute("data-dam-fullpage","true")')
  await sleep(120)
  const marked = await cdp.eval('({seat:getComputedStyle(document.getElementById("seat")).display,card:getComputedStyle(document.getElementById("card")).display,pad:getComputedStyle(document.getElementById("scroll")).paddingBottom})')
  console.log(JSON.stringify(marked))
  ok(marked.seat === 'none', '★★[正] 打标记后 composer-seat **隐藏**（display=' + marked.seat + '）')
  ok(marked.card === 'none', '★★[正] 打标记后 composer-card **隐藏**')
  ok(marked.pad === '0px', '★[正] 打标记后 padding-bottom 归 0（实测 ' + marked.pad + '）')

  console.log('')
  console.log('== C. ★摘标记（= 切回「对话」页签，负路径核心）==')
  await cdp.eval('document.body.removeAttribute("data-dam-fullpage")')
  await sleep(120)
  const restored = await cdp.eval('({seat:getComputedStyle(document.getElementById("seat")).display,card:getComputedStyle(document.getElementById("card")).display,pad:getComputedStyle(document.getElementById("scroll")).paddingBottom})')
  console.log(JSON.stringify(restored))
  ok(restored.seat !== 'none', '★★★[负路径·核心] 摘标记后 composer-seat **恢复可见**（display=' + restored.seat + '）⇒ 切回对话页能正常打字')
  ok(restored.card !== 'none', '★★★[负路径·核心] 摘标记后 composer-card **恢复可见**')
  ok(restored.pad === '120px', '★★[负路径] 摘标记后 padding-bottom 恢复 120px（实测 ' + restored.pad + '）')

  console.log('')
  console.log('== D. 变异：删掉 CSS 规则 ⇒ 打标记也不隐藏（证明断言非恒真）==')
  await cdp.eval('(function(){ var ss=[].slice.call(document.styleSheets); for (var i=0;i<ss.length;i++){ var rs=ss[i].cssRules; for (var j=rs.length-1;j>=0;j--){ if (rs[j].cssText && rs[j].cssText.indexOf("data-dam-fullpage")>=0) ss[i].deleteRule(j); } } })()')
  await cdp.eval('document.body.setAttribute("data-dam-fullpage","true")')
  await sleep(120)
  const mut = await cdp.eval('getComputedStyle(document.getElementById("seat")).display')
  ok(mut !== 'none', '★★[变异] 删掉规则后打标记 **不隐藏**（display=' + mut + '）⇒「打标记隐藏」断言有鉴别力')
} catch (e) {
  console.log('ERROR: ' + (e && e.message))
  results.push({ cond: false })
} finally {
  chrome.kill()
  const fail = results.filter((r) => !r.cond).length
  console.log('');
  console.log('SUMMARY  PASS ' + (results.length - fail) + ' / FAIL ' + fail)
  process.exit(fail > 0 ? 1 : 0)
}