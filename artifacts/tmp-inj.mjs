import fs from 'node:fs'
const ix = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
// 注入里各类记忆材料的来源，按出现次数排序
const SEGS = ['logText','userMemoryText','notesText','planText','latestHandoffText','eventCardsText','eventCatalogText','rulesText','reflectionText','calendarText']
console.log('=== 注入材料来源（出现次数 = 依赖深度）===')
for (const s of SEGS) console.log(s.padEnd(20), (ix.split(s).length - 1) + ' 处')
console.log('')
// 注入函数总长
const i = ix.indexOf('renderMemoryDynamic')
console.log('renderMemoryDynamic 起始 L' + (ix.slice(0,i).split('\n').length))
// 找 assemble 相关
for (const k of ['assembleCarryPre','composeMemoryEnvelopePre','buildTierLayerInjection','pushPart']) {
  const n = ix.split(k).length - 1
  console.log(k.padEnd(28), n + ' 处')
}