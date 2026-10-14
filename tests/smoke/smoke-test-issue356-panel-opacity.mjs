import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const cssStart = source.indexOf('    var CSS = [')
const cssEnd = source.indexOf("    ].join('\\n')", cssStart) + "    ].join('\\n')".length
const context = {}
vm.runInNewContext(source.slice(cssStart, cssEnd), context)
const panelRule = context.CSS.match(/\[data-dam-panel\] \{[^}]+\}/)[0]
assert.ok(Number(panelRule.match(/\) (\d+)%, transparent/)[1]) >= 90)
const parseStart = source.indexOf('    function parseCssColor(')
const parse = source.slice(parseStart, source.indexOf('    // 承载面', parseStart))
const effectStart = source.indexOf('      useEffect(function () {\n        if (!panelOpen) return') + '      useEffect('.length
const effect = source.slice(effectStart, source.indexOf('}, [panelOpen])', effectStart) + 1)
const el = { style: {}, setAttribute() {}, removeAttribute() {} }
vm.runInNewContext(parse + '\n(' + effect + ')()', { panelOpen: true, panelRef: { current: el },
  getComputedStyle: () => ({ getPropertyValue: () => 'rgba(25,27,34,.3)' }) })
assert.equal(el.style.background, 'rgba(25, 27, 34, 0.96)')
console.log('PASS #356 actual panel CSS and theme fallback retain a readable background')
