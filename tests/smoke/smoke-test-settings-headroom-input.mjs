import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const callbacks = [...source.matchAll(/onChange: function \(e\) \{ set\('officialHeadroomTokens', ([^\n]+?)\) \}/g)]
assert.equal(callbacks.length, 1, 'all V3 surfaces use the same shipped setting')
for (const [, expression] of callbacks) {
  const change = new Function('e', 'return ' + expression)
  for (const [input, expected] of [['0', 0], ['', 65536], ['   ', 65536], ['invalid', 65536], ['32768', 32768], ['-1', 0]]) {
    assert.equal(change({ target: { value: input } }), expected, 'headroom input ' + JSON.stringify(input))
  }
}
console.log('PASS actual shared headroom callback: zero, empty, whitespace, invalid, valid and negative input')
