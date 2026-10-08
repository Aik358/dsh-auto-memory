// Opt-in, isolated Chrome regression using the complete production bundle and React.
// npm install --prefix artifacts/issue287-browser --no-save --ignore-scripts --package-lock=false react@18.3.1 react-dom@18.3.1 playwright-core
// node tests/browser/issue287-autocont-lifecycle.mjs
// CLIENT_SOURCE may select a baseline bundle for the negative control.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = path.join(root, 'artifacts/issue287-browser')
mkdirSync(artifacts, { recursive: true })
const require = createRequire(path.join(artifacts, 'package.json'))
const { chromium } = require('playwright-core')
const react = path.dirname(require.resolve('react/package.json'))
const dom = path.dirname(require.resolve('react-dom/package.json'))
let client = readFileSync(process.env.CLIENT_SOURCE || path.join(root, 'lib/client.js'), 'utf8')
const seam = '    return module.exports'
if (client.split(seam).length !== 2) throw Error('bundle diagnostic seam changed')
client = client.replace(seam, `
    var diagnosticRoot=ReactDOM.createRoot(document.getElementById('root')),diagnosticKey=0;
    sessions={list:{getSnapshot:function(){return {current:window.fixtureSid,byId:{}}}},open:function(sid){window.fixtureSid=sid}};
    window.diagnostic={mount:function(){ensureStyle();damSkinEnsureCss();applyLocalePref('zh-CN');diagnosticRoot.render(h(Iter5Surface,{kind:'autocont',key:++diagnosticKey},h(AutoContinueHost)))},poll:function(){window.fixtureIntervals.forEach(function(f){f()})}};
` + seam)
const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/react.js"></script><script src="/dom.js"></script><script>
window.fixtureSid='new-A';window.fakeNow=1800000000000;Date.now=function(){return window.fakeNow};
window.fixtureIntervals=new Map();var seq=900000,nativeInterval=window.setInterval,nativeClear=window.clearInterval;
window.setInterval=function(f,ms){if(ms===3000){var id=++seq;fixtureIntervals.set(id,f);return id}return nativeInterval(f,ms)};
window.clearInterval=function(id){if(!fixtureIntervals.delete(id))nativeClear(id)};
window.__ModuleLoader__={load:function(entry){entry.factory(function(n){return n==='react'?React:n==='react-dom'?ReactDOM:{}})}};
</script><script src="/client.js"></script>`
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html')
  res.end(req.url === '/react.js' ? readFileSync(path.join(react, 'umd/react.development.js'))
    : req.url === '/dom.js' ? readFileSync(path.join(dom, 'umd/react-dom.development.js'))
      : req.url === '/client.js' ? client : html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = [], rows = []
page.on('pageerror', (e) => errors.push(e.message))
let state = { executing: false, armed: null, lastOk: { at: 1799999995000, sessionId: 'new-A', fromSid: 'old-A', model: 'fixture' } }
await page.route('**/api/dsh-auto-memory/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).pathname.endsWith('/config') ? { config: { autoContinueEnabled: true, autoContinueThreshold: .75 } } : state) }))
async function settle() { await page.waitForTimeout(150) }
async function mount() { await page.evaluate(() => diagnostic.mount()); await settle() }
async function poll() { await page.evaluate(() => diagnostic.poll()); await settle() }
async function record(name, expected) {
  const texts = await page.locator('[data-dam-autocont]').allTextContents()
  const actual = texts.some((t) => t.includes('已自动接续'))
  const row = { name, actual, expected, pass: actual === expected, text: texts.join('') }
  rows.push(row); console.log(JSON.stringify(row))
}
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('dam-skin-style', 'instrument'); localStorage.setItem('dsh-auto-memory.presentation.v1', 'instrument') })
  await mount(); await record('fresh success', true)
  const geometry = await page.locator('[data-dam-autocont]').evaluate((el) => {
    const rect = el.getBoundingClientRect(), css = getComputedStyle(el)
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: css.display, visibility: css.visibility }
  })
  rows.push({ name: 'visible production card geometry', pass: geometry.width > 0 && geometry.height > 0 && geometry.display !== 'none' && geometry.visibility === 'visible', geometry })
  await page.screenshot({ path: path.join(artifacts, 'shown.png') })
  await page.locator('[data-dam-autocont-close]').click(); await poll(); await record('same-mount dismissal', false)
  await mount(); await record('dismissal survives remount', false)
  await page.reload(); await mount(); await record('dismissal survives page reload', false)
  state.lastOk = { ...state.lastOk, at: 1799999999000 }
  await poll(); await record('new timestamp with same session displays', true)
  await page.locator('[data-dam-autocont-close]').click()
  state.lastOk = { ...state.lastOk, sessionId: 'new-B' }
  await poll(); await record('new session with same timestamp displays', true)
  await page.evaluate(() => { fakeNow = 1799999999000 + 600000 - 1 }); await poll(); await record('visible just before expiry', true)
  await page.evaluate(() => { fakeNow++ }); await poll(); await record('shown success clears at expiry', false)
  await mount(); await record('expired success cold-mount control', false)
  await page.screenshot({ path: path.join(artifacts, 'expired.png') })
  state = { executing: true, lastOk: null }; await poll()
  rows.push({ name: 'executing control', pass: (await page.locator('[data-dam-autocont]').allTextContents()).some((s) => s.includes('宿主正在自动接续')) })
  state = { executing: false, error: 'fixture-error' }; await poll()
  rows.push({ name: 'error control', pass: (await page.locator('[data-dam-autocont]').allTextContents()).some((s) => s.includes('fixture-error')) })
  console.log('errors=' + JSON.stringify(errors))
  writeFileSync(path.join(artifacts, process.env.CLIENT_SOURCE ? 'baseline-result.json' : 'fixed-result.json'), JSON.stringify({ browser: browser.version(), rows, errors }, null, 2))
  if (rows.some((r) => !r.pass) || errors.length) process.exitCode = 1
} finally {
  await browser.close(); await new Promise((r) => server.close(r))
}
