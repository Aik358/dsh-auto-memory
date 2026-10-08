// Isolated Chromium regression for #283. No DSH host, personal data or models.
// npm install --prefix .tmp-issue283 --no-save react@18.3.1 react-dom@18.3.1 playwright-core
// node tests/browser/status-dialog-box-sizing.mjs [--expect-overflow]
// Set CHROME_PATH for another Chromium installation; ISSUE283_DEPS for dependencies.
// ISSUE283_CLIENT can point to a baseline bundle for --expect-overflow.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, '.tmp-issue283')
const require = createRequire(path.join(process.env.ISSUE283_DEPS || output, 'package.json'))
const { chromium } = require('playwright-core')
const expectOverflow = process.argv.includes('--expect-overflow')
const results = [], errors = []
let client = readFileSync(process.env.ISSUE283_CLIENT || path.join(root, 'lib/client.js'), 'utf8')
const marker = '    return module.exports'
assert.equal(client.split(marker).length, 2, 'one loader export seam')
// Only expose a mount seam in memory. Components, wrappers and CSS stay unchanged.
client = client.replace(marker, `
    var testRoot = ReactDOM.createRoot(document.getElementById('root'));
    window.statusDialogTest = { mount: function (result) {
      ensureStyle(); damSkinEnsureCss(); applyLocalePref('zh-CN');
      dialogQueue = [];
      dialogState = { kind: 'semSetup', result: result || { deep: { integrated: true } } };
      testRoot.render(h(Iter5Surface, { kind: 'dialogs' }, h(DialogHost)));
      notifyDialog();
    }};
${marker}`)
const html = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}#host{height:calc(100vh - 80px);background:#f7f8fa;display:flex;align-items:center;justify-content:center;font:16px system-ui}#root{display:contents}</style>
<div id="host">隔离宿主占位</div><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>
var params = new URLSearchParams(location.search), mode = params.get('mode'), theme = params.get('theme');
localStorage.setItem('dam-skin-style', mode);
localStorage.setItem('dsh-auto-memory.presentation.v1', mode);
localStorage.setItem('dsh-auto-memory.appearance.v1', theme);
localStorage.setItem('dam-skin-theme', theme);
window.__ModuleLoader__ = { load: function (item) { item.factory(function (name) {
  if (name === 'react') return React;
  if (name === 'react-dom') return ReactDOM;
  return {};
})}};
</script><script src="/client.js"></script>`
const reactDir = path.dirname(require.resolve('react/package.json'))
const domDir = path.dirname(require.resolve('react-dom/package.json'))
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html')
  if (pathname === '/react.js') res.end(readFileSync(path.join(reactDir, 'umd/react.development.js')))
  else if (pathname === '/react-dom.js') res.end(readFileSync(path.join(domDir, 'umd/react-dom.development.js')))
  else if (pathname === '/client.js') res.end(client)
  else if (pathname === '/') res.end(html)
  else { res.statusCode = 404; res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
let browser
try {
  const isolatedHome = path.join(output, 'isolated-home')
  const isolatedLocal = path.join(isolatedHome, 'AppData', 'Local')
  mkdirSync(isolatedLocal, { recursive: true })
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    env: { ...process.env, DSH_HOME: isolatedHome, HOME: isolatedHome, USERPROFILE: isolatedHome, LOCALAPPDATA: isolatedLocal },
  })
  mkdirSync(output, { recursive: true })
  for (const mode of ['instrument', 'editorial', 'water']) {
    for (const theme of ['light', 'dark']) {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport })
        page.on('pageerror', e => errors.push({ mode, theme, viewport, error: e.message }))
        // Never send a request to a host/provider: API responses are inert fixtures.
        await page.route('**/*', route => {
          const url = new URL(route.request().url())
          if (url.origin !== origin) return route.abort()
          if (url.pathname.startsWith('/api/dsh-auto-memory/')) {
            return route.fulfill({ contentType: 'application/json', body: '{}' })
          }
          return route.continue()
        })
        await page.goto(origin + '/?mode=' + mode + '&theme=' + theme)
        await page.evaluate(() => statusDialogTest.mount())
        const dialog = page.locator('[data-dam-status-dialog]')
        await dialog.waitFor()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const measure = () => dialog.evaluate(el => {
          const rect = el.getBoundingClientRect(), css = getComputedStyle(el)
          const boundary = el.closest('[data-dam-theme]')
          return {
            left: rect.left, right: rect.right, width: rect.width,
            top: rect.top, bottom: rect.bottom, boxSizing: css.boxSizing,
            cssWidth: css.width, padding: css.padding, border: css.borderWidth,
            theme: boundary.getAttribute('data-deep'), mode: boundary.getAttribute('data-i5-style'),
            hasIter5Ancestor: !!el.closest('[data-iter5]'),
            buttons: [...el.querySelectorAll('button')].map(button => {
              const r = button.getBoundingClientRect()
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
            }),
          }
        })
        const m = await measure()
        results.push({ mode, theme, viewport, fixture: 'integrated', m })
        const label = mode + '/' + theme + '/' + viewport.width
        assert.equal(m.mode, mode, label + ' actual style')
        assert.equal(m.theme, String(theme === 'dark'), label + ' actual theme')
        assert.equal(m.hasIter5Ancestor, false, label + ' native DOM must exercise reset gap')
        const width = Math.min(640, viewport.width - 32)
        const padding = viewport.width > 600 ? 24 : 18
        if (expectOverflow) {
          assert.equal(m.boxSizing, 'content-box', label + ' baseline')
          assert.equal(m.width, width + 2 * padding + 2, label + ' baseline border inflation')
          assert.equal(m.left, (viewport.width - width) / 2, label + ' overlay stays centered')
        } else {
          assert.equal(m.boxSizing, 'border-box', label + ' fixed computed style')
          assert.equal(m.width, width, label + ' outer width includes padding and border')
          assert.equal(m.left, (viewport.width - width) / 2, label + ' centered left')
          assert.equal(m.right, (viewport.width + width) / 2, label + ' centered right')
          assert.ok(m.top >= 0 && m.bottom <= viewport.height, label + ' vertical visibility')
          for (const b of m.buttons) assert.ok(b.left >= m.left && b.right <= m.right && b.top >= 0 && b.bottom <= viewport.height, label + ' usable button')
          // Adversarial control: reverting only the box model must reproduce #283.
          await dialog.evaluate(el => el.style.setProperty('box-sizing', 'content-box', 'important'))
          const broken = await measure()
          assert.equal(broken.width, width + 2 * padding + 2, label + ' negative control')
          await dialog.evaluate(el => el.style.removeProperty('box-sizing'))
        }
        await page.screenshot({ path: path.join(output, `${mode}-${theme}-${viewport.width}${expectOverflow ? '-before' : '-after'}.png`) })
        // Real button interaction, then reopen the same production component.
        await dialog.locator('button').last().click()
        await dialog.waitFor({ state: 'detached' })
        await page.evaluate(() => statusDialogTest.mount())
        await dialog.waitFor()
        assert.equal((await measure()).width, m.width, label + ' close/reopen')
        await dialog.locator('button').last().click()
        await dialog.waitFor({ state: 'detached' })
        // Missing runtime/model path has more copy and actions; close only.
        await page.evaluate(() => statusDialogTest.mount({ recommendation: 'setup-both' }))
        await dialog.waitFor()
        const missing = await measure()
        results.push({ mode, theme, viewport, fixture: 'setup-both', m: missing })
        assert.equal(missing.width, m.width, label + ' missing runtime/model width')
        assert.equal(missing.buttons.length, 3, label + ' missing runtime/model actions')
        if (!expectOverflow) {
          assert.equal(missing.boxSizing, 'border-box', label + ' missing runtime/model box sizing')
          assert.equal(missing.left, m.left, label + ' missing runtime/model centered')
          assert.ok(missing.top >= 0 && missing.bottom <= viewport.height, label + ' missing runtime/model visible')
          for (const b of missing.buttons) assert.ok(b.left >= missing.left && b.right <= missing.right && b.top >= 0 && b.bottom <= viewport.height, label + ' missing runtime/model usable actions')
        }
        await dialog.locator('button').last().click()
        await dialog.waitFor({ state: 'detached' })
        assert.ok(await page.evaluate(() => Number(localStorage.getItem('dsh-auto-memory.semDetectSnoozeUntil')) > Date.now()), label + ' snooze close')
        await page.close()
      }
    }
  }
  assert.deepEqual(errors, [], 'no component errors')
  writeFileSync(path.join(output, expectOverflow ? 'before.json' : 'after.json'), JSON.stringify({ browser: browser.version(), results, errors }, null, 2))
  console.log(`PASS ${results.length} production-bundle ${expectOverflow ? 'baseline reproductions' : 'geometry/interaction regressions + negative controls'}; Chromium ${browser.version()}`)
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
