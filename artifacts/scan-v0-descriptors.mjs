// 一次性取证脚本(不入包、非产品代码):扫描所有 v0 会话日志里 subagent/descriptor 的 version 分布,
// 判定"哪些历史会话会让 session-query 索引硬失败"。
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { decodeZstdFrames } from 'file:///D:/dsh-auto-memory/lib/subagent-gc-pre.js'

const root = path.join(process.env.USERPROFILE, '.dsh', 'sessions')
const files = []
function walk(dir) {
  let ents = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'session.jsonl.zstd' || e.name === 'session.v3.jsonl.zstd') files.push(p)
  }
}
walk(root)

const rows = []
const errs = []
for (const f of files) {
  let txt = ''
  try { txt = decodeZstdFrames(readFileSync(f)) } catch (e) { errs.push({ f, msg: String((e && e.message) || e).slice(0, 120) }); continue }
  let hdr = null
  const versions = []
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue
    let o = null
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'session') hdr = o
    if (o.type === 'subagent/descriptor') versions.push(o?.data?.version)
  }
  rows.push({
    f: f.replace(root + path.sep, ''),
    fmt: path.basename(f) === 'session.jsonl.zstd' ? 'v0' : 'v3',
    hdrVer: hdr ? hdr.version : null,
    descVersions: versions,
  })
}

const v0 = rows.filter((r) => r.fmt === 'v0')
const bad = v0.filter((r) => r.descVersions.some((v) => v !== 3))
const good = v0.filter((r) => r.descVersions.length && r.descVersions.every((v) => v === 3))
const noDesc = v0.filter((r) => !r.descVersions.length)

console.log('文件总数 =', rows.length, ' | v0 =', v0.length, ' | v3 =', rows.length - v0.length)
console.log('v0 中含 descriptor 且全部=3(可迁移) =', good.length)
console.log('v0 中含 descriptor 且存在 !=3(会让索引失败) =', bad.length)
console.log('v0 中无 descriptor =', noDesc.length)
console.log('解码失败文件 =', errs.length)
console.log('\n=== 会让索引失败的文件(逐条)===\n')
for (const r of bad) console.log(`  ${r.fmt} hdrVer=${r.hdrVer} descVersions=[${r.descVersions.join(',')}]  ${r.f}`)
console.log('\n=== 解码失败文件 ===')
for (const e of errs) console.log('  ' + e.f.replace(root + path.sep, '') + '  :: ' + e.msg)
