// 验证器:精确复刻 DSH 读会话时的判定链(格式目录 → v0→v1 迁移 → 严格校验),
// 逐文件给出"索引器能不能读它"的结论与失败原因。只读,不改任何文件。
// 调用姿势对齐 dsh-session-persistence-jsonl:createRestore(header,{recovery:'strict',validation:'transformed'}) + decodeRow(obj) + finish()
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { decodeZstdFrames } from 'file:///D:/dsh-auto-memory/lib/subagent-gc-pre.js'

const CAT = 'file:///C:/Users/JH%20Z/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js'
const { sessionFormatCatalog: cat } = await import(CAT)

const root = path.join(process.env.USERPROFILE, '.dsh', 'sessions')
const files = []
function walk(d, depth = 0) {
  if (depth > 5) return
  let es = []
  try { es = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (/^session.*\.jsonl(\.zstd)?$/.test(e.name)) files.push(p)
  }
}
walk(root)

function checkFile(f) {
  const text = decodeZstdFrames(readFileSync(f))
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return { ok: false, err: '空文件' }
  let header
  try { header = JSON.parse(lines[0]) } catch { return { ok: false, err: '首行不是 JSON' } }
  let restore
  try {
    restore = cat.createRestore(header, { recovery: 'strict', validation: 'transformed' })
  } catch (e) {
    return { ok: false, err: 'createRestore: ' + String((e && e.message) || e).slice(0, 120) }
  }
  for (let i = 1; i < lines.length; i++) {
    let o
    try { o = JSON.parse(lines[i]) } catch { continue }   // 坏行交给下游判定,这里只做迁移校验
    try { restore.decodeRow(o) } catch (e) {
      return { ok: false, err: String((e && e.message) || e).slice(0, 160), atLine: i + 1 }
    }
  }
  try { restore.finish() } catch (e) {
    return { ok: false, err: 'finish: ' + String((e && e.message) || e).slice(0, 120) }
  }
  return { ok: true }
}

const bad = []
const good = []
let i = 0
for (const f of files) {
  i++
  if (i % 40 === 0) process.stdout.write(`  ...已检查 ${i}/${files.length}\n`)
  let r
  try { r = checkFile(f) } catch (e) { r = { ok: false, err: '解码失败: ' + String((e && e.message) || e).slice(0, 100) } }
  const rec = { f: f.replace(root, '~'), mtime: statSync(f).mtime.toISOString().slice(0, 10), ...r }
  if (r.ok) good.push(rec); else bad.push(rec)
}

console.log('\n================ 结论 ================')
console.log(`总文件 ${files.length}｜可读(索引器能摄取) ${good.length}｜不可读(会让整条检索失败) ${bad.length}`)
const byReason = new Map()
for (const b of bad) { const k = b.err.replace(/\d+/g, 'N').slice(0, 60); byReason.set(k, (byReason.get(k) || 0) + 1) }
console.log('\n--- 失败原因分类 ---')
;[...byReason.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  x${n}  ${k}`))
console.log('\n--- 不可读文件清单(带原因) ---')
bad.sort((a, b) => (a.mtime < b.mtime ? -1 : 1)).forEach((b) => console.log(`  ${b.mtime}  [${b.err.slice(0, 62)}]  ${path.basename(path.dirname(b.f))}`))
console.log('\n--- 非 descriptor 类失败的完整错误原文 ---')
for (const b of bad) {
  if (b.err.includes('descriptor')) continue
  console.log(`  ${b.mtime} ${path.basename(path.dirname(b.f))}`)
  console.log(`      ${b.err}`)
}
