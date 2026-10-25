// 全库量化:191 个会话文件里,非法 source.kind / 空工具名 / seq 缺口各有多少(逐文件流式,不驻留)
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { decodeZstdFrames } from 'file:///D:/dsh-auto-memory/lib/subagent-gc-pre.js'

const ALLOWED = new Set(['user', 'plugin', 'model', 'tool', 'agent-instructions', 'session-reference', 'team-message', 'agent-message'])
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
console.log('扫描文件数 = ' + files.length)

const kindHist = new Map()
const badKindFiles = []
const emptyNameFiles = []
const gapFiles = []
let n = 0
const t0 = Date.now()
for (const f of files) {
  n++
  let text
  try { text = decodeZstdFrames(readFileSync(f)) } catch { console.log('  [解码失败] ' + f); continue }
  const L = text.split('\n')
  let bad = 0, empty = 0, gaps = 0, last = null, firstGap = null, row = 0
  for (const line of L) {
    if (!line.trim()) continue
    row++
    let o; try { o = JSON.parse(line) } catch { continue }
    const d = o.data || {}
    const check = (s) => { if (s && typeof s === 'object' && 'kind' in s) { const k = s.kind; if (typeof k !== 'string' || !ALLOWED.has(k)) { bad++; kindHist.set(String(k), (kindHist.get(String(k)) || 0) + 1) } } }
    check(d.source)
    if (d.message && typeof d.message === 'object') check(d.message.source)
    for (const arr of [d.inserted, d.messages]) if (Array.isArray(arr)) for (const m of arr) if (m && typeof m === 'object') check(m.source)
    const msg = (d.message && typeof d.message === 'object') ? d.message : o.message
    if (msg && Array.isArray(msg.content)) for (const b of msg.content) if (b && typeof b === 'object' && b.type === 'tool-call' && b.name === '') empty++
    if (o.type === 'tool/call' && d.name === '') empty++
    if (typeof o.seq === 'number') {
      if (last !== null && o.seq !== last + 1) { gaps++; if (!firstGap) firstGap = '行' + row + ' 期望' + (last + 1) + ' 实得' + o.seq }
      last = o.seq
    }
  }
  const rel = f.replace(sessions, '~')
  if (bad) badKindFiles.push({ f: rel, bad })
  if (empty) emptyNameFiles.push({ f: rel, empty })
  if (gaps) gapFiles.push({ f: rel, gaps, firstGap, rows: row, last })
  if (n % 25 === 0) console.log('  ...已处理 ' + n + '/' + files.length + ' (' + Math.round((Date.now() - t0) / 1000) + 's)')
}

console.log('\n===== 甲) 非法 source.kind =====')
console.log('  命中文件数 = ' + badKindFiles.length)
for (const x of badKindFiles.sort((a, b) => b.bad - a.bad)) console.log('    ' + String(x.bad).padStart(4) + ' 处  ' + x.f.replace(/\\session-[0-9a-f-]+\\/, '\\<sid>\\'))
console.log('  kind 值分布 = ' + [...kindHist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join(', '))

console.log('\n===== 乙) 空工具名 =====')
console.log('  命中文件数 = ' + emptyNameFiles.length)
for (const x of emptyNameFiles.slice(0, 20)) console.log('    ' + String(x.empty).padStart(4) + ' 处  ' + x.f.replace(/\\session-[0-9a-f-]+\\/, '\\<sid>\\'))

console.log('\n===== 丙) seq 缺口 =====')
console.log('  命中文件数 = ' + gapFiles.length)
for (const x of gapFiles.slice(0, 20)) console.log('    缺口' + x.gaps + ' 行=' + x.rows + ' 末seq=' + x.last + ' 首缺口:' + x.firstGap + '  ' + x.f.replace(/\\session-[0-9a-f-]+\\/, '\\<sid>\\'))

console.log('\n总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's')
