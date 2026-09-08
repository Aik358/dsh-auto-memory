#!/usr/bin/env node
/** 子代理痕迹回收 CLI(pre 线,2026-09-08)。
 *
 * 用法:
 *   node tools/subagent-gc.mjs                 # 预览(dry-run),不移动任何文件
 *   node tools/subagent-gc.mjs --apply         # 实际回收(移入备份目录,可回滚)
 *   node tools/subagent-gc.mjs --keep-days 0 --min-age-minutes 10 --apply
 *
 * 选项:
 *   --apply                实际执行(缺省只预览)
 *   --keep-days N          保留最近 N 天的痕迹(缺省 3;存量清理可用 0)
 *   --min-age-minutes N    只处理 N 分钟前创建的痕迹(缺省 10,避免与运行中的子代理竞争)
 *   --label-prefix S       只认该前缀的子代理 label(缺省 auto-memory-,即本插件产物)
 *   --sessions-root PATH   会话根目录(缺省 ~/.dsh/sessions)
 *   --backup-root PATH     备份目录(缺省 ~/.dsh/subagent-gc-backup)
 *   --json                 以 JSON 输出结果
 */

import { homedir } from 'node:os'
import path from 'node:path'
import { scanPluginSubagentSessions, recycleSessions, PLUGIN_LABEL_PREFIX } from '../lib/subagent-gc-pre.js'

function argOf(name, def) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? def : v
}

const home = homedir()
const apply = process.argv.includes('--apply')
const asJson = process.argv.includes('--json')
const keepDays = Number(argOf('keep-days', '3'))
const minAgeMinutes = Number(argOf('min-age-minutes', '10'))
const labelPrefix = String(argOf('label-prefix', PLUGIN_LABEL_PREFIX))
const sessionsRoot = String(argOf('sessions-root', path.join(home, '.dsh', 'sessions')))
const backupRoot = String(argOf('backup-root', path.join(home, '.dsh', 'subagent-gc-backup')))
const projcacheRoot = String(argOf('projcache', path.join(home, '.dsh', 'storages', 'session_projcache', 'sessions')))

const keepMs = Math.max(0, keepDays) * 24 * 60 * 60 * 1000
const minAgeMs = Math.max(0, minAgeMinutes) * 60 * 1000

const scan = await scanPluginSubagentSessions({ sessionsRoot, labelPrefix, keepMs: 0 })
// min-age 保护:最近仍在写入的痕迹一律不动
const now = Date.now()
const protectedRecent = scan.candidates.filter((c) => now - c.mtimeMs < minAgeMs)
const eligible = scan.candidates.filter((c) => now - c.mtimeMs >= minAgeMs && (keepMs === 0 || now - c.mtimeMs >= keepMs))

const byLabel = {}
for (const c of eligible) byLabel[c.label] = (byLabel[c.label] || 0) + 1

const result = await recycleSessions({ candidates: eligible, backupRoot, projcacheRoot, apply })

const report = {
  mode: apply ? 'apply' : 'dry-run',
  sessionsRoot,
  backupRoot,
  keepDays,
  minAgeMinutes,
  labelPrefix,
  scanned: scan.scanned,
  subagentSessions: scan.subagents,
  pluginCandidates: scan.candidates.length,
  protectedRecent: protectedRecent.length,
  eligible: eligible.length,
  bytes: result.bytes,
  moved: result.moved.length,
  skipped: result.skipped.length,
  failed: result.failed.length,
  byLabel,
  reasons: scan.reasons,
  failures: result.failed.slice(0, 10),
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('=== 子代理痕迹回收 ' + (apply ? '(实际执行)' : '(预览,未改动任何文件)'))
  console.log('扫描会话目录:', report.scanned, '| 其中 origin=subagent:', report.subagentSessions)
  console.log('匹配插件一次性痕迹:', report.pluginCandidates)
  console.log('  ├ 最近 ' + minAgeMinutes + ' 分钟保护跳过:', report.protectedRecent)
  console.log('  └ 本次可回收:', report.eligible, '(' + (report.bytes / 1024 / 1024).toFixed(1) + ' MB)')
  const labels = Object.entries(byLabel).sort((a, b) => b[1] - a[1])
  if (labels.length) {
    console.log('按 label:')
    for (const [k, v] of labels) console.log('  ' + k + ':', v)
  }
  console.log('已' + (apply ? '移入备份' : '待移动') + ':', report.moved, '| 跳过:', report.skipped, '| 失败:', report.failed)
  if (apply) console.log('备份目录:', backupRoot, '(回滚:把子目录移回 ' + sessionsRoot + ' 即可)')
  if (report.failures.length) console.log('失败样例:', JSON.stringify(report.failures))
  const otherReasons = Object.entries(report.reasons).filter(([k]) => k !== 'hit' && k !== 'foreign-label').sort((a, b) => b[1] - a[1])
  if (otherReasons.length) console.log('扫描判据分布:', otherReasons.map(([k, v]) => k + '=' + v).join(', '))
}
