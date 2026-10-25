// 只统计"插件注入侧"的语义唤回痕迹,排除 assistant 自己的话
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { decodeZstdFrames } from 'file:///D:/dsh-auto-memory/lib/subagent-gc-pre.js'

const wsDir = path.join(process.env.USERPROFILE, '.dsh', 'sessions', '--D-dsh-auto-memory--')
const cands = readdirSync(wsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('session-'))
  .map((e) => {
    const dir = path.join(wsDir, e.name)
    const f = readdirSync(dir).find((x) => /^session.*\.zstd$/.test(x) && !/backup/.test(x))
    return f ? { sid: e.name, file: path.join(dir, f), mtime: statSync(path.join(dir, f)).mtimeMs } : null
  })
  .filter(Boolean).sort((a, b) => b.mtime - a.mtime)

const L = decodeZstdFrames(readFileSync(cands[0].file)).split('\n').filter((l) => l.trim())
const PACKET = 'Retrieved memory reference'
const rows = []
for (let i = 0; i < L.length; i++) {
  let o; try { o = JSON.parse(L[i]) } catch { continue }
  const t = o.type
  if (t === 'assistant/message') continue // 排除我自己的话
  const s = JSON.stringify(o)
  const isSplice = t === 'agent/inbox/spliced'
  const hasPacket = s.includes(PACKET)
  if (!isSplice && !hasPacket) continue
  rows.push({ row: i + 1, seq: o.seq, t, packet: hasPacket, time: o.time ? new Date(o.time) : null })
}

const fmt = (d) => d ? d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '(无)'
console.log('会话 = ' + cands[0].sid.slice(0, 24))
console.log('注入侧事件合计 = ' + rows.length + '（含 packet 的 ' + rows.filter((r) => r.packet).length + ' 条，spliced ' + rows.filter((r) => r.t === 'agent/inbox/spliced').length + ' 条）\n')

const packets = rows.filter((r) => r.packet)
console.log('=== 带「' + PACKET + '」的注入事件时间轴（末 18 条）===')
for (const r of packets.slice(-18)) console.log('  行' + String(r.row).padStart(6) + ' seq=' + String(r.seq).padStart(7) + '  ' + String(r.t).padEnd(20) + fmt(r.time))

console.log('\n=== 按分钟聚合（带 packet 的）===')
const byMin = new Map()
for (const r of packets) { const k = fmt(r.time).slice(0, 14); byMin.set(k, (byMin.get(k) || 0) + 1) }
for (const [k, v] of [...byMin.entries()]) console.log('  ' + k + '  ' + '#'.repeat(Math.min(v, 40)) + ' ' + v)

console.log('\n=== spliced(唤醒包投递)事件时间轴（末 12 条，带时间）===')
for (const r of rows.filter((x) => x.t === 'agent/inbox/spliced').slice(-12)) console.log('  行' + String(r.row).padStart(6) + ' seq=' + String(r.seq).padStart(7) + '  ' + fmt(r.time) + (r.packet ? '  [含 packet]' : ''))

if (packets.length) console.log('\n最后一条带 packet 的注入: ' + fmt(packets[packets.length - 1].time) + '（行' + packets[packets.length - 1].row + '）')
const sp = rows.filter((x) => x.t === 'agent/inbox/spliced')
if (sp.length) console.log('最后一次 spliced 投递: ' + fmt(sp[sp.length - 1].time) + '（行' + sp[sp.length - 1].row + '）')
