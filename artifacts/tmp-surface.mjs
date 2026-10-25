import fs from 'node:fs'
const ix = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
const cl = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')
// 所有写记忆的工具，各自写到哪里
const TOOLS = ['memory_log','memory_note','memory_user','memory_event','memory_procedure','memory_reflect','memory_rules','memory_consolidate','memory_maintain']
console.log('=== 各写记忆工具 -> 写入目标 ===')
for (const t of TOOLS) {
  const i = ix.indexOf("defineTool('" + t + "'")
  if (i < 0) { console.log(t.padEnd(20), '未找到'); continue }
  const seg = ix.slice(i, i + 4000)
  const hits = []
  if (/appendText\(/.test(seg)) hits.push('appendText')
  if (/writeFullRaw\(/.test(seg)) hits.push('writeFullRaw')
  if (/writeFull\(/.test(seg)) hits.push('writeFull')
  if (/eventStore/.test(seg)) hits.push('eventStore')
  if (/savePlan|plan-store|writePlanSnapshot/.test(seg)) hits.push('plan-store')
  if (/writeHandoffLedger/.test(seg)) hits.push('handoff')
  if (/procedure-store|procedureStore/.test(seg)) hits.push('procedure-store')
  console.log(t.padEnd(20), hits.join(', ') || '(间接)')
}