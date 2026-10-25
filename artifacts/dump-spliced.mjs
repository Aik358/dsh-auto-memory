// 看最后几条 spliced 投递里到底装了什么(以及最后几条带 packet 的注入长什么样)
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
const brief = (v, n = 380) => String(v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').slice(0, n)

const splices = []
const packets = []
for (let i = 0; i < L.length; i++) {
  let o; try { o = JSON.parse(L[i]) } catch { continue }
  const s = JSON.stringify(o)
  if (o.type === 'agent/inbox/spliced') splices.push({ i, o, s })
  if (o.type !== 'assistant/message' && s.includes('Retrieved memory reference')) packets.push({ i, o })
}

console.log('=== 最后 4 条 agent/inbox/spliced 的内容 ===')
for (const x of splices.slice(-4)) {
  const d = x.o.data || {}
  console.log('\n行' + (x.i + 1) + '  seq=' + x.o.seq + '  time=' + (x.o.time ? new Date(x.o.time).toLocaleString('zh-CN') : '?'))
  console.log('  data 键: ' + Object.keys(d).join(' | '))
  for (const k of Object.keys(d)) {
    const v = brief(d[k], 200)
    if (v && v !== '[]' && v !== '{}') console.log('    ' + k + ' = ' + v)
  }
}

console.log('\n\n=== 最后 2 条带 packet 的注入(注入块原文前 700 字) ===')
for (const x of packets.slice(-2)) {
  const d = x.o.data || {}
  const txt = brief(d.content || d.message || d.text || JSON.stringify(d), 700)
  console.log('\n行' + (x.i + 1) + '  time=' + (x.o.time ? new Date(x.o.time).toLocaleString('zh-CN') : '?') + '  type=' + x.o.type)
  console.log('  ' + txt)
}
