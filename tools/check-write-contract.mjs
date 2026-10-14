import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = process.argv[2] || fileURLToPath(new URL('../lib/index.js', import.meta.url))
const source = readFileSync(file, 'utf8')
const names = 'writeFull|writeFullRaw|writeFullSingle|appendText|writePlanSnapshot|writeHandoffLedger'
const calls = new RegExp('\\b(?:this|engine)\\.(' + names + ')\\s*\\(', 'g')
const failures = []
let count = 0
for (const [index, line] of source.split(/\r?\n/).entries()) {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue
  for (const match of line.matchAll(calls)) {
    count++
    if (!/\b(?:await|return)\s*$/.test(line.slice(0, match.index))) failures.push((index + 1) + ': ' + match[1] + ' must be awaited or returned')
  }
}
if (!count) failures.push('no writer calls found; input or contract coverage is invalid')
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
else console.log('写入契约检查通过: ' + count + ' host writer calls')
