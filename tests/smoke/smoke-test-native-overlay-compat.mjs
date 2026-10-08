import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../skins/iter5/legacy-native-overlays.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim()
const assignment = source.match(/^\s*var LEGACY_ITER5_CSS = ([^\r\n]+)/m)?.[1]
assert.ok(assignment, 'generated legacy stylesheet assignment exists')
const legacy = vm.runInNewContext(assignment, { LEGACY_SKIN_NS: { css: 'FROZEN_PAGE' } })
assert.equal(legacy, 'FROZEN_PAGE\n' + css, 'compat is appended to the frozen sheet from canonical source')

const shared = source.match(/function damSharedSurfaceCss\(\) \{[\s\S]*?\n    \}/)?.[0]
assert.ok(shared)
for (const flavor of ['legacy', 'classic', 'iter5']) {
  const actual = vm.runInNewContext(shared + '\ndamSharedSurfaceCss()', {
    damSkinCssFlavor: () => flavor, LEGACY_ITER5_CSS: legacy, ITER5_CSS: 'VARIANT_PAGE',
  })
  assert.equal(actual, flavor === 'iter5' ? 'VARIANT_PAGE' : legacy)
}
assert.ok(css.includes('position:fixed') && css.includes('max-height:calc(100dvh - 32px)') && css.includes('overflow:auto'))
assert.ok(css.includes('.i5-continuation-heading') && css.includes('display:flex'))
assert.ok(css.includes('[data-dam-autocont-confirm]>footer') && css.includes('flex-wrap:wrap'))
assert.ok(css.includes('prefers-reduced-motion:reduce'))
assert.ok(!css.includes('--i5-blue:') && !css.includes('[data-iter5]'), 'compat must not replace palette or page rules')
assert.ok(!css.includes('data-dam-status-dialog') && !css.includes('i5-quick'), 'unrelated overlays stay out of this repair')
console.log('PASS legacy/classic native overlay compat source, dispatch, bounds and scope')
