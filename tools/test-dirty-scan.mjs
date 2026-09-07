#!/usr/bin/env node
// tools/test-dirty-scan.mjs — 0.1.28 脏 token 检查器行为自测(dev-only, 不随包发布)
import { sanitizeForWrite, dirtyScanForFiles } from '../lib/index.js'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name) }
  else { fail++; console.log('XX FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

console.log('— sanitizeForWrite —')
check('mojibake 拒写', sanitizeForWrite('涓婁紶鏂囦欢娴嬭瘯').ok === false && sanitizeForWrite('涓婁紶鏂囦欢娴嬭瘯').reason === 'mojibake')
check('raw JSON envelope 拒写', sanitizeForWrite('{"uid":"abc","updatedAt":"2026-08-18"}').ok === false && sanitizeForWrite('{"uid":"abc"}').reason === 'raw-json')
check('memoryBlock 拒写', sanitizeForWrite('xxx memoryBlock {content} "role":"user"').ok === false)
check('base64 行拒写', sanitizeForWrite('abc' + 'Zv3x'.repeat(60)).ok === false && sanitizeForWrite('Zv3x'.repeat(60) + '=').reason === 'base64')
const longClean = '- 这是一条干净的长条目'.repeat(40) // >500 字正常长条目, 不应按长度拒写
check('干净长条目(>500字)不拒写', sanitizeForWrite(longClean).ok === true, 'len=' + longClean.length)
check('正常文本放行', sanitizeForWrite('今日完成记忆清洗与插件集成, 全部用例通过。').ok === true)
check('空内容拒写', sanitizeForWrite('').ok === false)

console.log('— dirtyScanForFiles —')
const dir = mkdtempSync(path.join(os.tmpdir(), 'dirty-scan-'))
try {
  writeFileSync(path.join(dir, 'clean.md'), '# ok\n## 2026-08-18\n- 正常条目, 正常写法。\n')
  writeFileSync(path.join(dir, 'dirty.md'), '# bad\n## 2026-08-18\n涓婁紶鏂囦欢残骸行\n{"uid":"abc","updatedAt":"latest"}\n' + 'Z'.repeat(300) + '\n' + '重复内容行'.repeat(6) + '\n')
  const rep = await dirtyScanForFiles([
    { name: 'clean', path: path.join(dir, 'clean.md') },
    { name: 'dirty', path: path.join(dir, 'dirty.md') },
  ])
  const cleanF = rep.find((x) => x.file.includes('clean'))
  const dirtyF = rep.find((x) => x.file.includes('dirty'))
  check('干净文件无发现', !cleanF)
  check('脏文件有发现', !!dirtyF && dirtyF.findings.length > 0)
  if (dirtyF) {
    const types = dirtyF.findings.map((f) => f.type).join(' | ')
    check('发现含 mojibake', /mojibake/i.test(types))
    check('发现含 raw JSON', /raw JSON/i.test(types))
    check('发现含 base64', /base64/i.test(types))
    // 报告不含正文: 任何 finding 的 range/type 不含样例残骸本身
    const reportText = JSON.stringify(dirtyF)
    check('报告不含残骸正文', !reportText.includes('涓婁紶') && !reportText.includes('Z'.repeat(60)), reportText.slice(0, 160))
  }
} finally { rmSync(dir, { recursive: true, force: true }) }

console.log('\nPASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)
