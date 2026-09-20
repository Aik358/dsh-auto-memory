// 会话归属取证: 解压会话日志头部, 看它自己声明的身份(parentSession / 类型 / cwd)。
// 为什么需要: `restoreLastAgent` 拒收带 parentSession 的会话, 而磁盘上 85e2b7e8 目录名带
//   `session-` 前缀(代码注释断言"带此前缀=普通会话")却又有 parent —— 二者矛盾, 必须看原始头部定论。
import { readdirSync, statSync, createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

const root = path.join(os.homedir(), '.dsh', 'sessions')
const wsName = process.argv[2] || '--D-dsh-auto-memory--'
const ws = path.join(root, wsName)
if (!existsSync(ws)) { console.error('工作区不存在:', ws); process.exit(1) }

// ① 按【文件】mtime 排序（目录 mtime 只在增删条目时变，不能代表最近写入）
const rows = []
for (const d of readdirSync(ws, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  const p = path.join(ws, d.name, 'session.v3.jsonl.zstd')
  if (!existsSync(p)) continue
  rows.push({ name: d.name, mtime: statSync(p).mtimeMs, size: statSync(p).size })
}
rows.sort((a, b) => b.mtime - a.mtime)
console.log('=== 最近写入的 6 个会话（按日志文件真实 mtime） ===')
for (const r of rows.slice(0, 6)) {
  console.log('  ' + r.name.padEnd(46) + new Date(r.mtime).toLocaleString('sv') + '  ' + (r.size / 1048576).toFixed(1) + ' MB')
}

// ② 解压指定会话的第一行, 打印身份字段
async function headOf(name) {
  const p = path.join(ws, name, 'session.v3.jsonl.zstd')
  if (!existsSync(p)) return null
  return await new Promise((resolve) => {
    const dec = zlib.createZstdDecompress()
    const rs = createReadStream(p, { end: 4 * 1024 * 1024 })
    let buf = ''
    let done = false
    const finish = (v) => { if (!done) { done = true; try { rs.destroy() } catch {} ; try { dec.destroy() } catch {}; resolve(v) } }
    dec.on('data', (c) => {
      buf += c.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl >= 0) finish(buf.slice(0, nl))
    })
    dec.on('error', () => finish(null))
    rs.on('error', () => finish(null))
    rs.pipe(dec)
    setTimeout(() => finish(buf ? buf.split('\n')[0] : null), 15000)
  })
}

const target = process.argv[3]
const names = target ? [target] : rows.slice(0, 3).map((r) => r.name)
for (const n of names) {
  console.log('\n=== ' + n + ' 头部 ===')
  const line = await headOf(n)
  if (!line) { console.log('  (无法解压/读取)'); continue }
  try {
    const j = JSON.parse(line)
    const h = j.header || j
    const pick = {}
    for (const k of ['id', 'type', 'kind', 'parentSession', 'parent', 'cwd', 'workspace', 'createdAt', 'time', 'model', 'title']) {
      if (h[k] !== undefined && h[k] !== null && h[k] !== '') pick[k] = h[k]
    }
    console.log('  ' + JSON.stringify(pick))
    const all = Object.keys(h)
    console.log('  头部全部字段: ' + all.join(', '))
  } catch (e) {
    console.log('  非 JSON, 前 300 字符: ' + line.slice(0, 300))
  }
}
