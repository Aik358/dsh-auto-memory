#!/usr/bin/env node
/**
 * G-A1 比对工具 —— 采集端与比对端必须共用同一组常量。
 *
 *   node baseline-diff.mjs                       列出差异（退出码恒 0）
 *   node baseline-diff.mjs --expect a.md,b.md    断言：差异集合恰好是这些
 *   node baseline-diff.mjs --expect ""           断言：必须零差异
 *
 * 判定 = 「差异集合 === 预期差异集合」，不是「哈希等于基线」。
 * 报告同时写入 _gen/baseline-diff-report.txt（Windows 下 stdout 有时不显示）。
 * 退出码语义已由用户在真实 PowerShell 中反向验证，见 00-目标冻结书.md 附录 E.7。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

const ROOT = process.env.DAM_MEMORY_ROOT || path.join(os.homedir(), '.dsh', 'memory')
const SCAN_DEPTH = 3
const EXT = /\.(md|json)$/

function todayStr() {
  const t = new Date()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const dd = String(t.getDate()).padStart(2, '0')
  return t.getFullYear() + '-' + m + '-' + dd
}

/*
 * 后台自变文件（不参与判定）。依据：00-目标冻结书.md 附录 E.8 / E.8.1 的实测。
 * 这些文件由插件自身后台任务（心跳 / 语义索引重建 / hub flush）与进行中的对话改写，
 * mtime 精确到秒，与「是否实施了团队化代码」无关；不排除它们则永远假红。
 * 代价（明示）：若新代码误写这些目录，G-A1 不捕获；该风险由 G-A2 单独覆盖。
 */
const EXCLUDE = [
  /^semantic\//,
  /^index\/files\//,
  /(^|\/)hub\//,
  /(^|\/)polling-heartbeat\.json$/,
  /(^|\/)recall-stats\.json$/,
  /(^|\/)flush-state\.json$/,
  new RegExp('/' + todayStr() + '\\.md$'),
]
const excluded = (k) => EXCLUDE.some((re) => re.test(k))

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')

const OUT = {}
const walk = (dir, depth) => {
  if (depth > SCAN_DEPTH || !fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const q = path.join(dir, e.name)
    if (e.isDirectory()) walk(q, depth + 1)
    else if (EXT.test(e.name)) OUT[q.slice(ROOT.length + 1).split(path.sep).join('/')] = sha(q)
  }
}
walk(ROOT, 0)

const BASE = JSON.parse(fs.readFileSync(new URL('../00-基线快照.json', import.meta.url), 'utf8'))

const added = Object.keys(OUT).filter((k) => !(k in BASE.files))
const removed = Object.keys(BASE.files).filter((k) => !(k in OUT))
const changed = Object.keys(OUT).filter((k) => k in BASE.files && OUT[k] !== BASE.files[k].sha256)
const rawActual = [...added, ...removed, ...changed].sort()
const skipped = rawActual.filter(excluded)
const actual = rawActual.filter((k) => !excluded(k))

const lines = []
lines.push('扫描根 : ' + ROOT)
lines.push('扫描深度: ' + SCAN_DEPTH + '（基线也是 ' + BASE.scanDepth + '）')
lines.push('基线 ' + Object.keys(BASE.files).length + ' / 当前 ' + Object.keys(OUT).length)
lines.push('差异: 修改 ' + changed.length + ' / 新增 ' + added.length + ' / 删除 ' + removed.length)
lines.push('其中后台自变（已排除，不参与判定）: ' + skipped.length)
for (const k of skipped) lines.push('  ~ ' + k)
lines.push('')
for (const k of changed) if (!excluded(k)) lines.push('  M ' + k)
for (const k of added) if (!excluded(k)) lines.push('  + ' + k)
for (const k of removed) if (!excluded(k)) lines.push('  - ' + k)

const i = process.argv.indexOf('--expect')
let code = 0
if (i < 0) {
  lines.push('')
  lines.push('（未给 --expect：仅列出差异；判定需人工核对差异集合。）')
} else {
  const expect = new Set(String(process.argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
  const unexpected = actual.filter((k) => !expect.has(k))
  const missing = [...expect].filter((k) => !actual.includes(k))
  lines.push('')
  if (unexpected.length || missing.length) {
    code = 1
    lines.push('✗ G-A1 不通过')
    if (unexpected.length) lines.push('  预期外的改动（最危险）: ' + unexpected.join(', '))
    if (missing.length) lines.push('  预期内但未发生: ' + missing.join(', '))
  } else {
    lines.push('✓ 差异集合与预期完全一致')
  }
}
lines.push('')
lines.push('退出码: ' + code)

try {
  fs.writeFileSync(new URL('./baseline-diff-report.txt', import.meta.url), lines.join('\n'), 'utf8')
} catch (e) {
  lines.push('(报告写入失败: ' + e.message + ')')
}
process.stdout.write(lines.join('\n') + '\n')
process.exit(code)
