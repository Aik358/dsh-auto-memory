// 精确口径:只查 assertSource 真正会校验的位置(v2→v3 转换器 lib/index.js:98-108)
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { decodeZstdFrames } from 'file:///D:/dsh-auto-memory/lib/subagent-gc-pre.js'

const ALLOWED = new Set(['user', 'plugin', 'model', 'tool', 'agent-instructions', 'session-reference', 'team-message', 'goal', 'skill-invocation', 'skill-catalog', 'coordinator', 'subagent-report', 'subagent-settled', 'webhook', 'agent-message'])
const sessions = path.join(process.env.USERPROFILE, '.dsh', 'sessions')
const files = []
const walk = (d, depth) => {
  if (depth > 4) return
  let es = []
  try { es = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    if (e.isDirectory()) { walk(path.join(d, e.name), depth + 1); continue }
    if (/\.zstd$/.test(e.name) && !/backup/.test(e.name)) files.push(path.join(d, e.name))
  }
}
walk(sessions, 0)

const hits = []
const kindHist = new Map()
for (const f of files) {
  let text
  try { text = decodeZstdFrames(readFileSync(f)) } catch { continue }
  const bad = []
  let row = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    row++
    let o; try { o = JSON.parse(line) } catch { continue }
    const d = o.data || {}
    const t = o.type
    const test = (s, where) => {
      if (!s || typeof s !== 'object') return
      const k = s.kind
      if (typeof k !== 'string' || !ALLOWED.has(k)) { bad.push(t + '@行' + row + ' ' + where + ' kind=' + JSON.stringify(k)); kindHist.set(String(k), (kindHist.get(String(k)) || 0) + 1) }
    }
    if (t === 'user/message') test(d.source, 'data.source')
    if (t === 'assistant/message' || t === 'tool/result') test(d.message && d.message.source, 'data.message.source')
    if (t === 'agent/inbox/spliced') { for (const m of d.inserted || []) test(m && m.source, 'data.inserted[].source') }
    if (t === 'session/title-llm-request') { for (const m of d.messages || []) test(m && m.source, 'data.messages[].source') }
  }
  if (bad.length) hits.push({ f, n: bad.length, sample: bad.slice(0, 3) })
}
console.log('扫描 ' + files.length + ' 个文件 —— 会被 "unclassified message source" 拦下的:')
for (const h of hits.sort((a, b) => b.n - a.n)) {
  console.log('  ' + String(h.n).padStart(3) + ' 处  ' + h.f.replace(sessions, '~'))
  for (const s of h.sample) console.log('        ' + s)
}
console.log('合计命中文件 = ' + hits.length)
console.log('非法 kind 值分布 = ' + [...kindHist.entries()].map(([k, v]) => k + '×' + v).join(', '))
