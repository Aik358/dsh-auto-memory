// 读取本工作区最新会话(即当前会话)的原始记录,输出"人读得懂"的回合摘要
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { decodeZstdFrames } from 'file:///D:/dsh-auto-memory/lib/subagent-gc-pre.js'

const wsDir = path.join(process.env.USERPROFILE, '.dsh', 'sessions', '--D-dsh-auto-memory--')
const cands = readdirSync(wsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('session-'))
  .map((e) => {
    const dir = path.join(wsDir, e.name)
    const f = readdirSync(dir).find((x) => /^session.*\.zstd$/.test(x) && !/backup/.test(x))
    return f ? { sid: e.name, file: path.join(dir, f), mtime: statSync(path.join(dir, f)).mtimeMs, size: statSync(path.join(dir, f)).size } : null
  })
  .filter(Boolean)
  .sort((a, b) => b.mtime - a.mtime)

console.log('本工作区会话文件 ' + cands.length + ' 个,最新 3 个:')
for (const c of cands.slice(0, 3)) {
  console.log('  ' + c.sid.slice(0, 24) + '  ' + (c.size / 1024 / 1024).toFixed(1) + 'MB  ' + new Date(c.mtime).toLocaleString('zh-CN'))
}

const target = cands[0]
console.log('\n>>> 当前会话 = ' + target.sid + '\n')
const L = decodeZstdFrames(readFileSync(target.file)).split('\n').filter((l) => l.trim())

const turns = []
for (const line of L) {
  let o; try { o = JSON.parse(line) } catch { continue }
  const d = o.data || {}
  const brief = (s, n = 190) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
  if (o.type === 'user/message') {
    const c = Array.isArray(d.content) ? d.content : []
    const txt = c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ')
    if (txt.trim()) turns.push('U| ' + brief(txt))
  } else if (o.type === 'assistant/message') {
    const c = (d.message && Array.isArray(d.message.content)) ? d.message.content : (Array.isArray(d.content) ? d.content : [])
    const txt = c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ')
    const tools = c.filter((b) => b && b.type === 'tool-call').map((b) => b.name).filter(Boolean)
    if (txt.trim()) turns.push('A| ' + brief(txt) + (tools.length ? '   [tools:' + [...new Set(tools)].join(',') + ']' : ''))
  }
}
console.log('共提取 ' + turns.length + ' 个回合文本(仅正文,不含工具输出)\n')
const mode = process.argv[2] || ''
let show
if (mode === 'brief') {
  const out = []
  let prev = ''
  for (const t of turns) {
    const body = t.slice(2)
    if (/^Current runtime context/.test(body) || /^\[model changed/.test(body) || /^\[Retrieved memory|^\[File |^\[记忆检索/.test(body)) continue
    const sig = (t[0] + body.slice(0, 60)).replace(/\s+/g, '')
    if (sig === prev) continue
    prev = sig
    out.push(t[0] + '| ' + body.slice(0, t[0] === 'U' ? 260 : 90))
  }
  show = out
} else {
  show = mode === 'all' ? turns : turns.slice(-46)
}
show.forEach((t, i) => console.log(String(i).padStart(3) + ' ' + t))
