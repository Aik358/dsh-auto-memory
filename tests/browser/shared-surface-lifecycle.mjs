// Optional real-browser regression; no DSH process, memories or model provider.
// npm install --prefix artifacts/issue284 --no-save react@18.3.1 react-dom@18.3.1 playwright-core
// node tests/browser/shared-surface-lifecycle.mjs [baseline-client.js]
// Set CHROME_PATH if Chrome is not at the default Windows installation path.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = path.join(root, 'artifacts/issue284')
mkdirSync(out, { recursive: true })
const require = createRequire(path.join(out, 'fixture.cjs'))
const { chromium } = require('playwright-core')
const react = path.dirname(require.resolve('react/package.json'))
const dom = path.dirname(require.resolve('react-dom/package.json'))
let client = readFileSync(process.argv[2] || path.join(root, 'lib/client.js'), 'utf8')
assert.equal(client.split('    return module.exports').length, 2, 'Unique fixture export seam')
client = client.replace('    return module.exports', `
    var fixtureRoot = ReactDOM.createRoot(document.getElementById('root'));
    var pickerHost = document.createElement('div');
    pickerHost.id = 'fixture-picker';
    pickerHost.style.cssText = 'position:fixed;top:0;left:0;width:600px;z-index:1';
    document.body.appendChild(pickerHost);
    ReactDOM.createRoot(pickerHost).render(h(SkinPicker, {}));
    window.fixture = {
      tree: function (mask) {
        ensureStyle(); damSkinEnsureCss(); applyLocalePref('zh-CN');
        fixtureRoot.render(h(React.Fragment, null,
          mask.includes('page') ? h(Iter5Surface, {kind:'page',key:'page'}, h(MemoryPageView)) : null,
          mask.includes('autocont') ? h(Iter5Surface, {kind:'autocont',key:'autocont'}, h(AutoContinueHost)) : null,
          mask.includes('dialogs') ? h(Iter5Surface, {kind:'dialogs',key:'dialogs'}, h(DialogHost)) : null));
      },
      dialog: function (value) { dialogState = value; notifyDialog(); },
      shared: damSharedSurfaceCss, flavor: damSkinCssFlavor
    };
    return module.exports`)
const html = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}#host{height:820px;background:#f7f8fa;font:16px system-ui}#root{display:contents}</style>
<div id="host">Isolated host fixture</div><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>
var mode=new URLSearchParams(location.search).get('mode');
localStorage.setItem('dam-skin-style',mode);localStorage.setItem('dsh-auto-memory.presentation.v1',mode);
localStorage.setItem('dsh-auto-memory.appearance.v1','light');localStorage.setItem('dam-skin-theme','light');
window.__ModuleLoader__={load:function(item){item.factory(function(name){
  if(name==='react')return React;if(name==='react-dom')return ReactDOM;return {};
})}};
</script><script src="/client.js"></script>`
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html')
  res.end(req.url === '/react.js' ? readFileSync(path.join(react, 'umd/react.development.js'))
    : req.url === '/react-dom.js' ? readFileSync(path.join(dom, 'umd/react-dom.development.js'))
      : req.url === '/client.js' ? client : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const errors = [], histories = []
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  for (const mode of ['instrument', 'legacy']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/dsh-auto-memory/**', route => {
      const endpoint = new URL(route.request().url()).pathname.split('/').pop()
      const data = {
        config: { config: { autoContinueEnabled:true, boardMode:'graph', handoffEnabled:true, workbenchEnabled:true, memoryRoot:'/fixture/memory', userMemoryDir:'/fixture/user' }, promptSections:[], promptSectionMust:[] },
        'auto-continue-state': { lastOk: { at:0, sessionId:'fixture-new', model:'fixture', reasoningEffort:'high' } },
        'semantic-status': { loaded:true, ready:true, resolvedTier:'c0', download:{phase:'idle'} },
        state: { ws:'/fixture/project', noteSessionId:'fixture', notesPath:'/fixture/memory/notes.md', recent:[], files:[], counts:{}, logs:[] },
        'memory-hub': { notes:{entries:[]}, items:[], counts:{} },
        'handoff-state': { enabled:true, ledgers:[], waterLevel:{live:true,ratio:.1,tokens:10000,window:100000} },
        external: { sources:[] }, models: { providers:[] }, procedures: { items:[], procedures:[] },
        facts: { items:[],size:0 }, episodic: { items:[],size:0 },
      }[endpoint] || {}
      return route.fulfill({ contentType:'application/json', body:JSON.stringify(data) })
    })
    await page.goto('http://127.0.0.1:' + server.address().port + '/?mode=' + mode)
    await page.evaluate(() => fixture.tree(['page', 'autocont', 'dialogs']))
    await page.locator('[data-dam-autocont]').waitFor()
    const history = []
    async function capture(label) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const row = await page.evaluate(label => {
        const sheet = document.getElementById('dam-shared-ui-style'), el = document.querySelector('[data-dam-autocont]')
        window.fixtureSheet ||= sheet
        const rect = el && el.getBoundingClientRect()
        return { label, flavor:fixture.flavor(), matches:!!sheet && sheet.textContent === fixture.shared(),
          users:Number(sheet?.dataset.users || 0), sameNode:sheet === window.fixtureSheet, exists:!!sheet,
          layout:el ? { position:getComputedStyle(el).position, width:rect.width, left:rect.left, top:rect.top,
            height:rect.height, header:getComputedStyle(el.querySelector('header')).display } : null }
      }, label)
      history.push(row)
      return row
    }
    function owned(row, count) {
      assert.equal(row.matches, true, row.label + ': active sheet')
      assert.equal(row.sameNode, true, row.label + ': retained node')
      assert.equal(row.users, count, row.label + ': owners')
    }
    owned(await capture('initial'), 3)
    for (const target of mode === 'instrument' ? ['legacy', 'instrument', 'legacy'] : ['instrument', 'legacy', 'instrument']) {
      if (await page.locator('.i5-style-picker').count()) await page.locator('.i5-style-picker').first().selectOption(target)
      else await page.locator('[data-dam-skin-pick=' + target + ']').first().click()
      const before = await capture('switch-' + target)
      owned(before, 3)
      assert.equal(before.flavor, target === 'legacy' ? 'legacy' : 'iter5', 'Actual UI changes skin family')
      if (target === 'instrument') assert.equal(before.layout.position, 'fixed')
      await page.evaluate(() => fixture.dialog({ kind:'summary', summary:{summary:'Isolated summary'} }))
      await page.locator('.i5-dialog').waitFor()
      const opened = await capture('open-summary-' + target)
      owned(opened, 4)
      assert.deepEqual(opened.layout, before.layout, 'Popup must retain continuation geometry')
      await page.locator('#fixture-picker').evaluate(el => { el.style.visibility = 'hidden' })
      await page.screenshot({ path:path.join(out, mode + '-to-' + target + '.png'), fullPage:true })
      await page.locator('#fixture-picker').evaluate(el => { el.style.visibility = 'visible' })
      await page.locator('.i5-dialog button[aria-label]').first().click()
      await page.locator('.i5-dialog').waitFor({ state:'detached' })
      const closed = await capture('close-summary-' + target)
      owned(closed, 3)
      assert.deepEqual(closed.layout, before.layout, 'Popup close must retain geometry')
    }
    const retainedLayout = history[history.length - 1].layout
    for (const mask of [['autocont', 'dialogs'], ['autocont'], []]) {
      await page.evaluate(mask => fixture.tree(mask), mask)
      const row = await capture('remaining-' + mask.length)
      assert.equal(row.users, mask.length)
      if (mask.length) {
        owned(row, mask.length)
        // Removing the page legitimately changes the top of a document-flow
        // overlay (#282); its CSS positioning/size must still remain stable.
        for (const key of ['position', 'width', 'left', 'height', 'header']) assert.equal(row.layout[key], retainedLayout[key])
      }
      else assert.equal(row.exists, false, 'Final Surface removes the sheet')
    }
    histories.push({ mode, history })
    await page.close()
  }
  assert.deepEqual(errors, [])
  writeFileSync(path.join(out, 'browser-lifecycle.json'), JSON.stringify({ browser:browser.version(), histories, errors }, null, 2))
  console.log('PASS real browser ' + browser.version() + ': both switch directions, popup geometry, incremental/final cleanup; no page errors')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
