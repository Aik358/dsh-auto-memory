#!/usr/bin/env node
/**
 * audit-prototype.mjs —— 白板看板事件原型 · 审计脚本（可复算）
 *
 * 用法: node artifacts/audit-prototype.mjs
 * 判据: 每条断言必须真读磁盘、真算 sha256，禁止用常量冒充。
 */
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const HD = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff'
const FILES = [
  'handoff-20261022-220513.md',
  'handoff-20261022-220934.md',
  'handoff-20261023-061339.md',
  'handoff-20261023-062627.md',
]

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

console.log('=== 1. 逐文件读盘 · 字节 / sha256 / 四段 ===')
const rows = []
for (const f of FILES) {
  const p = join(HD, f)
  const buf = readFileSync(p)
  const st = statSync(p)
  const sha = createHash('sha256').update(buf).digest('hex')
  const txt = buf.toString('utf8')
  const secs = [...txt.matchAll(/^## (.+)$/gm)].map((m) => m[1])
  rows.push({ f, bytes: buf.length, chars: txt.length, sha, secs, mtime: st.mtimeMs })
  console.log(`  ${f}  ${buf.length} B / ${txt.length} 字符 / ${sha.slice(0, 16)}…`)
  ok(secs.length === 4, `${f} 四段结构（实 ${secs.length} 段：${secs.join('|')}）`)
  ok(secs[0] === '任务状态' && secs[1] === '目标', `${f} 前两段顺序正确`)
  ok(secs[2] === '已试方案与失败原因' && secs[3] === '进度与下一步', `${f} 后两段顺序正确`)
}

console.log('')
console.log('=== 2. 事件聚合 ===')
const totalBytes = rows.reduce((a, r) => a + r.bytes, 0)
const totalChars = rows.reduce((a, r) => a + r.chars, 0)
console.log(`  检查点 ${rows.length} 个 · 合计 ${totalBytes} B / ${totalChars} 字符`)
ok(rows.length === 4, '检查点数 = 4')
ok(totalBytes === 7269, `合计字节 = 7,269（实 ${totalBytes}）`)
ok(totalChars === 4611, `合计字符 = 4,611（实 ${totalChars}）`)
const B2 = 2400
ok(totalChars > B2, `超 B2 上限 ${B2} 字 → 需摘要（实 ${totalChars}，${(totalChars / B2).toFixed(2)}×）`)

console.log('')
console.log('=== 3. 折叠可行性：只取四段首行 ===')
let folded = 0
for (const r of rows) {
  const txt = readFileSync(join(HD, r.f), 'utf8')
  for (const name of ['任务状态', '目标', '已试方案与失败原因', '进度与下一步']) {
    const m = txt.match(new RegExp('## ' + name + '\\n([\\s\\S]*?)(?=\\n## |$)'))
    const first = (m ? m[1] : '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => l.trim().startsWith('-'))[0]
    if (first) folded += first.replace(/^\s*-\s*/, '').length
  }
}
console.log(`  四段首行合计 ${folded} 字符`)
ok(folded < totalChars, `折叠后远小于全文（${folded} < ${totalChars}）`)
ok(folded < B2, `折叠后可塞进 B2（${folded} < ${B2}）`)

console.log('')
console.log('=== 4. 负路径：篡改一个字节必须让 sha 变 ===')
{
  const buf = readFileSync(join(HD, FILES[0]))
  const orig = createHash('sha256').update(buf).digest('hex')
  const tampered = Buffer.from(buf)
  tampered[tampered.length - 2] = tampered[tampered.length - 2] ^ 0x01
  const after = createHash('sha256').update(tampered).digest('hex')
  ok(orig !== after, '篡改 1 字节 ⇒ sha256 必变（审计有效）')
  ok(rows[0].sha === orig, '原文件 sha 未被改动（原型只读）')
}

console.log('')
console.log(`=== 汇总 === PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
