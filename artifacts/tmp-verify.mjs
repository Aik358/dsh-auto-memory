import fs from 'node:fs'
const ix = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
console.log('=== 复核文档中的计数 ===')
// 1) memory_log 写 md
const iLog = ix.indexOf("defineTool('memory_log'")
const logSeg = ix.slice(iLog, iLog + 3000)
console.log('memory_log 写 .md:', logSeg.includes("date + '.md'"), '| appendText:', logSeg.includes('appendText'))
// 2) 8 个写记忆工具绕开事件层
const TOOLS = ['memory_log','memory_note','memory_user','memory_rules','memory_procedure','memory_reflect','memory_consolidate','memory_maintain']
let绕 = 0
for (const t of TOOLS) {
  const i = ix.indexOf("defineTool('" + t + "'")
  if (i < 0) continue
  const seg = ix.slice(i, i + 4000)
  if (!seg.includes('eventStore')) 绕++
}
console.log('绕开事件层的工具数:', 绕, '/', TOOLS.length)
// 3) all scope 是否含 events
const m = ix.match(/\['all',\s*'handoff',\s*'sessions',\s*'archive'(,\s*'events')?\]/)
console.log('scope 枚举:', m ? m[0] : '未匹配')
// 4) 事件目录段
console.log('eventCatalogText:', ix.split('eventCatalogText').length - 1, '处')