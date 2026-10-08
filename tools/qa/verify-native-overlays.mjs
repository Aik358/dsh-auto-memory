// Real Chromium regression for #282. Install React 18 and playwright-core in
// an isolated directory, then pass --deps=<directory containing node_modules>.
// Tests the shipped bundle with fixture APIs; no models or personal data.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const deps = process.argv.find(arg => arg.startsWith('--deps='))?.slice(7)
assert.ok(deps, 'Pass --deps=<isolated dependency directory>')
const require = createRequire(path.resolve(deps, 'package.json'))
const { chromium } = require('playwright-core')
const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const output = path.resolve(option('output') || path.join(root, 'artifacts/issue282'))
mkdirSync(output, { recursive: true })
let client = readFileSync(path.resolve(option('client') || path.join(root, 'lib/client.js')), 'utf8')
const hasReason = client.includes('confirmation.reasonText')
const hasConsumption = client.includes('function acConsumeOk(')
assert.ok(!process.argv.includes('--require-reason') || hasReason, 'combined client must include reasonText')
assert.ok(!process.argv.includes('--require-consumption') || hasConsumption, 'combined client must include success consumption')
const seam = '    return module.exports'
assert.equal(client.split(seam).length - 1, 1)
client = client.replace(seam, `
    var qaRoot = ReactDOM.createRoot(document.getElementById('root')), qaSequence = 0;
    window.qa = { mount: function(kind, reason) {
      ensureStyle(); damSkinEnsureCss(); applyLocalePref('zh-CN');
      dialogState = null; dialogQueue = [];
      var node;
      if (kind === 'longConfirm') node = h(Iter5AutoContinue, {confirmation: {ratio: .8, tokens: 80000, window: 100000, ring: .8, wall: 110000, reasonText: reason}, countdown: 35, onDismiss: function(){qaRoot.render(null)}, onReject: function(){window.qaDecision='reject';qaRoot.render(null)}, onAgree: function(){window.qaDecision='agree';qaRoot.render(null)}});
      else if (kind === 'progress') node = h(Iter5AutoContinue, {executing: true, status: '正在接续', onDismiss: function(){qaRoot.render(null)}});
      else if (kind === 'success' || kind === 'confirm') node = h(AutoContinueHost);
      else {dialogState = kind === 'notice' ? {kind: kind, notice: {id: 'fixture', title: '插件通知', message: '隔离布局通知。'}} : {kind: kind}; node = h(DialogHost)}
      qaRoot.render(h(Iter5Surface, {kind: kind === 'notice' || kind === 'welcomeBack' ? 'dialogs' : 'autocont', key: ++qaSequence}, node));
    }, switchSkin: function(mode){localStorage.setItem('dam-skin',mode==='classic'?'classic':'v4');localStorage.setItem('dam-skin-style',mode==='classic'?'legacy':mode);iter5SetStyle(mode==='classic'?'legacy':mode,false);damSkinEnsureCss()}, unmount: function(){qaRoot.render(null)}, notify: function(message){dialogState={kind:'notice',notice:{id:'fixture-long',title:'插件通知',message:message}};notifyDialog()}};
` + seam)
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}#host{height:calc(100vh - 80px);background:#eee}#root{display:contents}</style><div id="host">Isolated host content</div><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>
var query=new URLSearchParams(location.search), mode=query.get('mode'), theme=query.get('theme');
if(mode==='classic')localStorage.setItem('dam-skin','classic');else if(mode!=='legacy'){localStorage.setItem('dam-skin','v4');localStorage.setItem('dam-skin-style',mode);localStorage.setItem('dsh-auto-memory.presentation.v1',mode)};
localStorage.setItem('dsh-auto-memory.appearance.v1',theme);localStorage.setItem('dam-skin-theme',theme);
window.__ModuleLoader__={load:function(item){item.factory(function(name){if(name==='react')return React;if(name==='react-dom')return ReactDOM;return {}})}};
</script><script src="/client.js"></script>`
const react = path.dirname(require.resolve('react/package.json'))
const dom = path.dirname(require.resolve('react-dom/package.json'))
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html')
  res.end(req.url === '/react.js' ? readFileSync(path.join(react, 'umd/react.development.js'))
    : req.url === '/react-dom.js' ? readFileSync(path.join(dom, 'umd/react-dom.development.js'))
      : req.url === '/client.js' ? client : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const results = [], errors = [], failures = [], extra = []
const negative = process.argv.includes('--negative')
const initialGeometry = process.argv.includes('--initial-geometry')
async function measure(page, selector) {
  await page.locator(selector).waitFor()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.locator(selector).evaluate(el => {
    const rect = el.getBoundingClientRect(), css = getComputedStyle(el)
    return { position: css.position, width: rect.width, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      padding: css.padding, background: css.backgroundColor, backgroundImage: css.backgroundImage, color: css.color, overflow: css.overflowY,
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      header: getComputedStyle(el.querySelector('header')).display,
      deep: el.closest('[data-dam-theme]').getAttribute('data-deep'),
      buttons: [...el.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { text: button.textContent || button.getAttribute('aria-label'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } }) }
  })
}
// A scrollable surface may contain off-screen actions. Verify actual wheel/Tab
// reachability, clipping and pointer hit-testing instead of assuming initial visibility.
async function reachableActions(page, selector, viewport) {
  const surface = page.locator(selector), buttons = surface.locator('button'), rows = []
  const box = await surface.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 100000)
  if (await surface.evaluate(el => el.scrollHeight > el.clientHeight)) {
    await page.waitForFunction(selector => document.querySelector(selector)?.scrollTop > 0, selector, {timeout:1000})
  }
  const wheelScroll = await surface.evaluate(el => el.scrollTop)
  // Focus the first button, then use real Tab navigation through the action order.
  await buttons.first().focus()
  for (let i = 0; i < await buttons.count(); i++) {
    const button = buttons.nth(i)
    if (i) await page.keyboard.press('Tab')
    assert.ok(await button.evaluate(el => document.activeElement === el), 'Tab must reach every action')
    // Native focus scrolls only enough to expose a target; center it to check
    // its full geometry and pointer hit, including surfaces with internal scroll.
    await button.scrollIntoViewIfNeeded()
    const row = await button.evaluate(el => {
      const r = el.getBoundingClientRect(), surface = el.closest('[data-dam-autocont],.i5-native-notice'), s = surface.getBoundingClientRect()
      return { text: el.textContent || el.getAttribute('aria-label'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
        surfaceTop: s.top, surfaceBottom: s.bottom, scrollTop: surface.scrollTop,
        hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }
    })
    assert.ok(row.top >= 0 && row.bottom <= viewport.height + .5 && row.left >= 0 && row.right <= viewport.width + .5 && row.height >= 30, 'reachable action must be bounded and large enough')
    assert.ok(row.top >= row.surfaceTop && row.bottom <= row.surfaceBottom + .5 && row.hit, 'action must be unclipped and receive pointer input')
    rows.push({...row, wheelScroll})
  }
  return rows
}
try {
  for (const mode of ['legacy', 'classic', 'instrument', 'editorial', 'water']) {
    for (const theme of ['light', 'dark']) {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        // Fresh context proves cold starts, including the factory-default legacy mode.
        const context = await browser.newContext({ viewport })
        const page = await context.newPage()
        page.on('pageerror', error => errors.push(error.message))
        let state = 'success', successId = 'fixture-new', successAt = Date.now(), successSeq = 0, decisions = []
        const freshSuccess = () => { successId = 'fixture-new-' + ++successSeq; successAt = Date.now() }
        // Block unexpected outgoing browser traffic; all plugin routes below are fixtures.
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
        await page.route('**/api/dsh-auto-memory/**', route => {
          const endpoint = new URL(route.request().url()).pathname.split('/').pop()
          let data = {}
          if (endpoint === 'config') data = { config: { autoContinueEnabled: true, autoContinueThreshold: .75 } }
          if (endpoint === 'auto-continue-state') data = state === 'confirm'
            ? { armed: { ratio: .8, tokens: 80000, window: 100000, ring: .8, wall: 110000, edgeAt: 1, expiresAt: Date.now() + 35000 } }
            : { lastOk: { at: successAt, sessionId: successId, model: 'fixture', reasoningEffort: 'high' } }
          if (endpoint === 'auto-continue-decide') { decisions.push(route.request().postDataJSON()); data = { ok: true }; state = 'success' }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
        })
        await page.goto('http://127.0.0.1:' + server.address().port + '/?mode=' + mode + '&theme=' + theme)
        for (const kind of ['success', 'confirm', 'progress', 'notice', 'welcomeBack']) {
          state = kind
          if (kind === 'success') freshSuccess()
          const selector = kind === 'notice' || kind === 'welcomeBack' ? '.i5-native-notice' : '[data-dam-autocont]'
          await page.evaluate(kind => qa.mount(kind), kind)
          const m = await measure(page, selector)
          const row = { mode, theme, viewport, kind, ...m }
          results.push(row)
          try {
            assert.equal(m.position, 'fixed')
            assert.equal(m.header, 'flex')
            assert.equal(m.deep, String(theme === 'dark'))
            assert.ok(m.top >= 0 && m.bottom <= viewport.height + .5 && m.left >= 0 && m.right <= viewport.width + .5, 'surface outside viewport')
            if (negative || initialGeometry) assert.ok(m.buttons.every(b => b.top >= 0 && b.bottom <= viewport.height && b.left >= 0 && b.right <= viewport.width && b.height >= 30), 'action outside initial viewport or too small')
            else {
              assert.ok(m.buttons.every(b => b.left >= 0 && b.right <= viewport.width && b.height >= 30), 'action outside horizontal viewport or too small')
              if (m.buttons.some(b => b.top < m.top || b.bottom > m.bottom)) assert.ok(m.overflow === 'auto' && m.scrollHeight > m.clientHeight, 'off-screen action needs a real scroll container')
              row.reachable = await reachableActions(page, selector, viewport)
            }
            assert.ok(m.background !== 'rgba(0, 0, 0, 0)' || m.backgroundImage !== 'none', 'surface needs a readable background')
            if (mode === 'legacy' || mode === 'classic') assert.ok(parseFloat(m.padding) >= 16, 'missing card spacing')
          } catch (error) { failures.push({ mode, theme, viewport, kind, error: error.message }) }
          if ((mode === 'legacy' || mode === 'classic') && kind === 'confirm') await page.screenshot({ path: path.join(output, mode + '-' + theme + '-' + viewport.width + '.png') })
          // Use the actual buttons and handlers. Re-mount only after verifying closure.
          if (kind === 'confirm') {
            if (!negative && !initialGeometry) {
              const other = mode === 'instrument' ? 'water' : 'instrument'
              await page.evaluate(other => qa.switchSkin(other), other)
              const switched = await measure(page, selector)
              assert.ok(switched.top >= 0 && switched.bottom <= viewport.height + .5 && switched.left >= 0 && switched.right <= viewport.width + .5)
              extra.push({mode, theme, viewport, kind:'switchConfirm', to:other, ...switched, reachable:await reachableActions(page, selector, viewport)})
              await page.evaluate(mode => qa.switchSkin(mode), mode)
              await reachableActions(page, selector, viewport)
            }
            await page.locator('[data-dam-autocont-confirm] button').first().click()
            assert.equal(decisions.at(-1).action, 'reject')
            state = 'confirm'
            await page.evaluate(() => qa.mount('confirm'))
            await page.locator('[data-primary=true]').click()
            await page.waitForFunction(() => !document.querySelector('[data-dam-autocont-confirm]'))
            assert.equal(decisions.at(-1).action, 'agree')
          }
          if (kind === 'notice' || kind === 'welcomeBack') await page.locator(selector + ' button').first().click()
          else await page.locator('[data-dam-autocont-close]').click()
          await page.locator(selector).waitFor({ state: 'detached' })
          // A layout reopen represents a new result, never a consumed identity.
          if (kind === 'success') freshSuccess()
          await page.evaluate(kind => qa.mount(kind), kind)
          await page.locator(selector).waitFor()
          await page.evaluate(() => qa.unmount())
        }
        if (!negative && !initialGeometry) {
          // Failure path: a long notification stays bounded and its action remains reachable.
          await page.evaluate(() => qa.mount('notice'))
          await page.locator('.i5-native-notice').waitFor()
          await page.evaluate(() => qa.notify('长通知内容。\n'.repeat(100)))
          const long = await measure(page, '.i5-native-notice')
          assert.ok(long.top >= 0 && long.bottom <= viewport.height)
          assert.equal(long.overflow, 'auto')
          assert.equal(await page.locator('.i5-notice-copy').textContent(), '长通知内容。\n'.repeat(100), 'preserve the complete notification')
          extra.push({mode, theme, viewport, kind:'longNotice', ...long, reachable: await reachableActions(page, '.i5-native-notice', viewport)})
          await page.locator('.i5-native-notice button').click()
          await page.locator('.i5-native-notice').waitFor({ state: 'detached' })
          if (hasReason) {
            const reason = '变长触发原因：等待用户确认、保留全部上下文。'.repeat(100)
            for (const action of ['reject', 'agree', 'close']) {
              await page.evaluate(reason => qa.mount('longConfirm', reason), reason)
              const longConfirm = await measure(page, '[data-dam-autocont]')
              assert.ok(longConfirm.top >= 0 && longConfirm.bottom <= viewport.height + .5)
              assert.equal(await page.locator('.i5-continuation-facts dd').first().textContent(), reason)
              extra.push({mode, theme, viewport, kind:'longConfirm', action, ...longConfirm, reachable: await reachableActions(page, '[data-dam-autocont]', viewport)})
              await page.locator(action === 'close' ? '[data-dam-autocont-close]' : action === 'agree' ? '[data-primary=true]' : '[data-dam-autocont-confirm] button').first().click()
              if (action !== 'close') assert.equal(await page.evaluate(() => window.qaDecision), action)
              await page.locator('[data-dam-autocont]').waitFor({state:'detached'})
            }
          }
        }
        if (!negative && !initialGeometry && theme === 'light' && viewport.width === 1280) {
          state = 'success'
          freshSuccess()
          await page.evaluate(() => qa.mount('success'))
          await page.locator('[data-dam-autocont-close]').click()
          await page.waitForTimeout(3300)
          assert.equal(await page.locator('[data-dam-autocont]').count(), 0, 'dismissed success must stay closed after poll')
          if (hasConsumption) {
            await page.evaluate(() => qa.mount('success'))
            await page.waitForTimeout(3300)
            assert.equal(await page.locator('[data-dam-autocont]').count(), 0, 'same consumed success must stay closed after remount')
          }
          freshSuccess()
          await page.locator('[data-dam-autocont]').waitFor()
          await page.locator('[data-dam-autocont-close]').click()
        }
        await context.close()
      }
    }
  }
  const report = { browser: browser.version(), client: option('client') || 'lib/client.js', hasReason, hasConsumption, results, extra, failures, errors }
  writeFileSync(path.join(output, negative || initialGeometry ? 'before.json' : 'after.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ browser: report.browser, cases: results.length, extra: extra.length, failures: failures.length, errors }))
  assert.equal(errors.length, 0)
  if (negative) {
    assert.equal(failures.length, 40, 'baseline must fail legacy/classic only, across all five states')
    assert.ok(failures.every(row => row.mode === 'legacy' || row.mode === 'classic'))
    console.log('PASS negative control: 40 old-skin failures, 60 variant controls')
  } else assert.equal(failures.length, 0, JSON.stringify(failures))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
