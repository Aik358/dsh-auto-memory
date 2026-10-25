// E2 预跑(第 2 版):往 entries[].records[] 里挖真正的记录体量分布
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const p = path.join(process.env.USERPROFILE, '.dsh', 'memory', 'semantic-pre', 'derived-corpus.json')
if (!existsSync(p)) { console.log('找不到 ' + p); process.exit(1) }
const j = JSON.parse(readFileSync(p, 'utf8'))

const all = []
for (const [i, e] of (j.entries || []).entries()) {
  console.log('entry[' + i + '] 键 = ' + Object.keys(e).join(' | '))
  console.log('   scope=' + e.scope + '  wsRef=' + String(e.workspaceRef).slice(0, 18) + '  miv=' + String(e.memoryIndexVersion).slice(0, 14) + '  recordCount=' + e.recordCount)
  const recs = e.records || []
  console.log('   records 条数 = ' + recs.length)
  if (recs[0]) console.log('   单条字段 = ' + Object.keys(recs[0]).join(' | '))
  for (const r of recs) all.push(r)
}

const cand = ['text', 'l0', 'body', 'content', 'raw', 'excerpt']
const field = all[0] ? cand.find((f) => typeof all[0][f] === 'string') : null
console.log('\n全部记录 = ' + all.length + ' 条;用于计量的字段 = ' + (field || '(无:退化为整条 JSON)'))

const lenOf = (r) => field ? String(r[field] || '').length : JSON.stringify(r).length
const lens = all.map(lenOf).sort((a, b) => a - b)
const q = (x) => lens[Math.min(lens.length - 1, Math.round((lens.length - 1) * x))]
const sum = lens.reduce((a, b) => a + b, 0)

console.log('\n=== 体量分布(字符) ===')
console.log('  最小 ' + lens[0] + ' / p50 ' + q(0.5) + ' / p90 ' + q(0.9) + ' / p99 ' + q(0.99) + ' / 最大 ' + lens[lens.length - 1])
console.log('  合计 ' + sum + ' 字符;均值 ' + Math.round(sum / Math.max(1, all.length)))
for (const t of [200, 500, 1000, 2000, 5000, 10000]) {
  const n = lens.filter((x) => x > t).length
  console.log('  超过 ' + String(t).padStart(5) + ' 字符: ' + String(n).padStart(3) + ' 条 (' + (n / Math.max(1, all.length) * 100).toFixed(1) + '%)')
}

// 抽样看真实长度与开头
const sorted = [...all].sort((a, b) => lenOf(b) - lenOf(a))
console.log('\n=== 最大的 5 条(采样,前 90 字) ===')
for (const r of sorted.slice(0, 5)) {
  const t = field ? String(r[field] || '') : JSON.stringify(r)
  console.log('  ' + String(lenOf(r)).padStart(6) + ' 字符  ' + String(r.memoryId || r.id || '?').slice(0, 46))
  console.log('        ' + t.replace(/\s+/g, ' ').slice(0, 90))
}
console.log('\n=== 最小的 3 条(采样,前 90 字) ===')
for (const r of sorted.slice(-3)) {
  const t = field ? String(r[field] || '') : JSON.stringify(r)
  console.log('  ' + String(lenOf(r)).padStart(6) + ' 字符  ' + String(r.memoryId || r.id || '?').slice(0, 46))
  console.log('        ' + t.replace(/\s+/g, ' ').slice(0, 90))
}
