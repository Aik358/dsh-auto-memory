// 会话类型判定: 打印区分「子代理」vs「接续会话」的关键字段【值】。
// 为什么关键: restoreLastAgent 一律拒收带 parentSession 的会话 ——
//   若被拒的是子代理  => 拒得对(本该拒)
//   若被拒的是接续会话=> 拒错了(那是用户正在用的会话, 必须接受)
//   两种情形的修法完全相反, 故必须看值。
import { readdirSync, statSync, createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

const root = path.join(os.homedir(), '.dsh', 'sessions')
const wsName = process.argv[2] || '--D-dsh-auto-memory--'
const ws = path.join(root, wsName)

const rows = []
for (const d of readdirSync(ws, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  const p = path.join(ws, d.name, 'session.v3.jsonl.zstd')
  if (!existsSync(p)) continue
  const st = statSync(p)
  rows.push({ name: d.name, mtime: st.mtimeMs, size: st.size })
}
rows.sort((a, b) => b.mtime - a.mtime)

async function headOf(name) {
  const p = path.join(ws, name, 'session.v3.jsonl.zstd')
  return await new Promise((resolve) => {
    const dec = zlib.createZstdDecompress()
    const rs = createReadStream(p, { end: 2 * 1024 * 1024 })
    let buf = ''; let done = false
    const fin = (v) => { if (!done) { done = true; try { rs.destroy() } catch {} ; try { dec.destroy() } catch {}; resolve(v) } }
    dec.on('data', (c) => { buf += c.toString('utf8'); const i = buf.indexOf('\n'); if (i >= 0) fin(buf.slice(0, i)) })
    dec.on('error', () => fin(null)); rs.on('error', () => fin(null)); rs.pipe(dec)
    setTimeout(() => fin(buf ? buf.split('\n')[0] : null), 12000)
  })
}

console.log('字段含义推断: delegationDepth>0 或 origin 存在 => 子代理; 全为 0/无 => 顶层或接续\n')
console.log('name'.padEnd(46) + 'mtime              ' + 'size     ' + '关键的区分字段')
console.log('-'.repeat(150))
for (const r of rows.slice(0, 8)) {
  const line = await headOf(r.name)
  let desc = '(无法读取)'
  if (line) {
    try {
      // 实测: 身份字段在**顶层**（不是 .header 下）——第一版探针读 .header 全 null 即此故。
      const j = JSON.parse(line)
      const h = j.header || j
      desc = JSON.stringify({
        parent: h.parentSession ? String(h.parentSession).slice(0, 22) : null,
        isSeeded: h.isSeeded,
        delegationDepth: h.delegationDepth,
        agentPreset: h.agentPreset,
        origin: h.origin,
      })
    } catch { desc = '(非JSON) ' + line.slice(0, 80) }
  }
  console.log(r.name.padEnd(46) + new Date(r.mtime).toLocaleString('sv') + '  ' +
    (r.size / 1048576).toFixed(1).padStart(6) + 'MB  ' + desc)
}
