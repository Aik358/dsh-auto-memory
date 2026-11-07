#!/usr/bin/env node
/**
 * #449-1 UI 接线 · 版本自适应应用器（契约驱动，面向 alpha.7 及以后）
 *
 * 与第一版（9 条精确字符串 + 固定命中数）的区别：
 *   · 不绑 commit SHA / version 字符串：从后端源码探测「确认字段名」和
 *     「是否仍需要显式确认」，从 client.js 探测请求点/状态/插入位。
 *   · 锚点是语义正则族，能容忍缩进变化、请求体新增字段、包路径变量改名。
 *   · 幂等：已打过补丁 → 校验后 no-op；上游自己修好了 / 限制被移除 → no-op。
 *   · 看不懂的结构 → DRIFT 报告（每个锚点实得/期望 + 建议），绝不写盘。
 *   · 运行时只留一个注册点 globalThis.__DAM_MIGRATION_OPTIN__：
 *     未来版本改字段名或取消确认要求，宿主注入一行即可，不必改 client.js。
 *
 * 用法：
 *   node tools/apply-migration-optin.mjs
 *   node tools/apply-migration-optin.mjs --dry-run
 *   node tools/apply-migration-optin.mjs --target=C:/path/to/alpha.7
 *   node tools/apply-migration-optin.mjs --field=acceptLegacyUserFiles
 *   node tools/apply-migration-optin.mjs --json=report.json
 * 退出码：0 = 已应用 / 无需变更；2 = 结构漂移（需人工补契约）；1 = 内部错误
 *
 * 纪律：只作用于 --target 指定树，绝不碰实验区插件；每条替换都做数量校验，
 *       任何一条不符即整体不写盘。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractHelperSource, selfSource, OPTIN_DEFAULT_FIELD,
} from '../lib/migration-optin-contract.js'
import { detectBackendContract, detectClientShape, normalize } from './lib/migration-contract-probe.mjs'

const argv = process.argv.slice(2)
const argVal = (k, d) => {
  const p = argv.find(x => x.startsWith('--' + k + '='))
  return p ? p.slice(k.length + 3) : d
}
const has = k => argv.includes('--' + k)
const DRY = has('dry-run')
const ROOT = path.resolve(argVal('target', fileURLToPath(new URL('..', import.meta.url))))
const OVERRIDE_FIELD = argVal('field', '')
const JSON_OUT = argVal('json', '')

const CL = path.join(ROOT, 'lib', 'client.js')
const BAK = CL + '.orig-449ui'
const IX = path.join(ROOT, 'lib', 'index.js')
const PK = path.join(ROOT, 'lib', 'migrate-pack.js')
const CONTRACT = path.join(ROOT, 'lib', 'migration-optin-contract.js')
const PKG = path.join(ROOT, 'package.json')

const report = {
  at: new Date().toISOString(), target: ROOT,
  status: 'UNKNOWN', backend: null, shape: null, drift: [], actions: [], checks: null,
}
const finish = (code) => {
  if (JSON_OUT) writeFileSync(path.resolve(JSON_OUT), JSON.stringify(report, null, 2))
  console.log('\n状态: ' + report.status + (DRY ? '（dry-run，未写盘）' : ''))
  process.exit(code)
}

const LABEL_SRC = `L('旧版包（≤3.3.4）请勾选：用户级文件（如日历）未被摘要保护，仍要导入', 'Legacy pack (<= 3.3.4): user-level files (e.g. calendar) are not covered by the checksum. Import anyway')`
const CALLSIG = 'globalThis.__damMigrationOptIn.body('
const BOXKEY = "'data-dam-migration': 'legacy-opt-in'"
const STATEKEY = "var migConfirmedLegacyPackPair = useState('')"
const count = (s, n) => { let c = 0, i = 0; for (;;) { const p = s.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

function read(p, required = true) {
  if (!existsSync(p)) {
    if (required) throw new Error('缺少文件: ' + p)
    return ''
  }
  return readFileSync(p, 'utf8')
}

function helperSource() {
  const raw = existsSync(CONTRACT) ? read(CONTRACT) : selfSource()
  const h = extractHelperSource(raw)
  if (!h) throw new Error('HELPER 区间缺失: ' + (existsSync(CONTRACT) ? CONTRACT : '内置契约模块'))
  return h
}

function verifyPatched(src, helper) {
  const checks = {
    requestsWithBody: count(src, CALLSIG),
    boxes: count(src, BOXKEY),
    states: count(src, STATEKEY),
    unconditionalTrue: count(src, 'allowUnprovenUserFiles: true'),
    helperInline: normalize(src).includes(normalize(helper)),
    helperUnique: count(src, '/* === HELPER-BEGIN === */'),
    syntax: true,
  }
  try { new Function(src) } catch (e) { checks.syntax = false; checks.syntaxError = String(e && e.message || e) }
  checks.ok = checks.requestsWithBody === 6 && checks.boxes === 3 && checks.states === 3 &&
    checks.unconditionalTrue === 0 && checks.helperInline && checks.helperUnique === 1 && checks.syntax
  return checks
}

let raw, ix, pk, pkgVersion
try {
  raw = read(CL); ix = read(IX); pk = read(PK, false)
  pkgVersion = existsSync(PKG) ? (JSON.parse(read(PKG)).version || '?') : '?'
} catch (e) {
  console.error('读取目标树失败: ' + String(e && e.message || e)); finish(1)
}
report.version = pkgVersion
const crlf = raw.includes('\r\n')
let src = crlf ? raw.replace(/\r\n/g, '\n') : raw
const helper = normalize(helperSource())

// ── ① 幂等：本工具已打过补丁 ──────────────────────────────────
if (src.includes('__damMigrationOptIn')) {
  report.status = 'NOOP_ALREADY_PATCHED'
  report.checks = verifyPatched(src, helper)
  report.actions.push('检测到本工具注入的契约层，改为校验一致性（幂等，不重复注入）')
  console.log('  幂等校验 ' + JSON.stringify(report.checks))
  finish(report.checks.ok ? 0 : 2)
}

// ── ② 能力 / 形态探测 ─────────────────────────────────────────
const backend = detectBackendContract({ indexSrc: ix, packSrc: pk })
if (OVERRIDE_FIELD) { backend.field = OVERRIDE_FIELD; backend.sources.push('cli-override:' + OVERRIDE_FIELD) }
const shape = detectClientShape(src)
report.backend = { field: backend.field, required: backend.required, sources: backend.sources, drift: backend.drift }
report.shape = {
  requests: shape.requests.length, states: shape.states, classicSlots: shape.classicSlots,
  iterSlots: shape.iterSlots, propsSlots: shape.propsSlots, hasUpstreamFix: shape.hasUpstreamFix,
  drift: shape.drift,
}

// ── ③ 上游已自行修好 / 后端已取消限制 ⇒ 不注入，避免双份勾选框 ──
if (shape.hasUpstreamFix) {
  report.status = 'NOOP_UPSTREAM_FIXED'
  report.actions.push('上游 6 处请求已自带确认字段且 UI 已有勾选框，本补丁不再需要')
  finish(0)
}
if (!backend.required) {
  report.status = 'NOOP_NOT_REQUIRED'
  report.actions.push('后端已无 userfiles-unproven-by-checksum guard ⇒ 不再需要显式确认，不注入（避免误导 UI）')
  finish(0)
}

// ── ④ 结构漂移 ⇒ 如实报告，绝不写盘 ───────────────────────────
const drift = [...backend.drift, ...shape.drift]
if (drift.length) {
  report.status = 'DRIFT'
  report.drift = drift
  console.log('\n后端契约: ' + JSON.stringify(report.backend))
  console.log('客户端形态: ' + JSON.stringify(report.shape))
  console.error('\n检测到 ' + drift.length + ' 处结构漂移，未写盘。逐条如下：')
  drift.forEach((d, i) => console.error('  [' + (i + 1) + '] ' + d))
  console.error('\n处理建议：打开 tools/lib/migration-contract-probe.mjs 补一条锚点规则，')
  console.error('或 --field=<新字段名> 指定后端契约；确认后再跑，不要在未知结构上猜。')
  finish(2)
}

// ── ⑤ 生成：单一真源 helper + 6 处统一调用 + 3 个勾选框 ────────
const field = backend.field || OPTIN_DEFAULT_FIELD
let prefix = ''
if (field !== OPTIN_DEFAULT_FIELD) {
  prefix += 'globalThis.__DAM_MIGRATION_OPTIN__ = { field: ' + JSON.stringify(field) + ', required: true };\n'
  report.actions.push('后端字段名已变为 ' + field + ' ⇒ 注入能力声明，client.js 无需再改')
}
prefix += helper + '\n'
src = prefix + src
report.actions.push('内联 HELPER 契约层（单一真源，默认字段 ' + OPTIN_DEFAULT_FIELD + '）')

// 5.1 六个请求点：保留原请求体，统一追加 body() 展开（packPath 表达式从原文提取）
const REQ = /apiPost\((API\.migrate(?:Inspect|Import)),\s*\{([^{}]*)\}\)/g
let nReq = 0
src = src.replace(REQ, (full, api, inner) => {
  nReq++
  const pm = inner.match(/packPath:\s*([^,}]+)/)
  const packExpr = pm ? pm[1].trim() : null
  return 'apiPost(' + api + ', Object.assign({' + inner + '}, ' + CALLSIG + packExpr + ', migConfirmedLegacyPack)))'
})
report.actions.push('6 处请求点改为 Object.assign(..., __damMigrationOptIn.body(packExpr, confirmedPack))')

// 5.2 三组状态定义（缩进由原文捕获，容忍未来版重排缩进）
const STATE = /^([ \t]*)var migConflictPair = useState\('keep'\)\n\1var migConflict = migConflictPair\[0\]\n\1var setMigConflict = migConflictPair\[1\]/gm
let nState = 0
src = src.replace(STATE, (full, ind) => {
  nState++
  return full + '\n' +
    ind + "var migConfirmedLegacyPackPair = useState('')\n" +
    ind + 'var migConfirmedLegacyPack = migConfirmedLegacyPackPair[0]\n' +
    ind + 'var setMigConfirmedLegacyPack = migConfirmedLegacyPackPair[1]'
})
report.actions.push('3 组向导各注入按「包路径」绑定的确认状态')

// 5.3 经典面 + 全屏页勾选框（required() 为假时自动不渲染）
const CLASSIC = /(\n([ \t]*))migPlan \? h\('div', \{ style: \{ wordBreak/g
let nClassic = 0
src = src.replace(CLASSIC, (full, lead, ind) => {
  nClassic++
  return '\n' + ind + "globalThis.__damMigrationOptIn.required() ? h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginTop: '6px' } },\n" +
    ind + "  h('label', null,\n" +
    ind + "    h('input', { type: 'checkbox', " + BOXKEY + ', checked: !!migPack && migConfirmedLegacyPack === migPack,\n' +
    ind + "      disabled: !!migBusy || !migPack, onChange: function (e) { setMigConfirmedLegacyPack(e.target.checked ? migPack : '') } }),\n" +
    ind + "    ' ' + " + LABEL_SRC + ')) : null,' + full
})

// 5.4 Iter5Migration 共享工具栏
const ITER = /(\n([ \t]*))(h\('div',[^\n]*props\.pickPack[^\n]*\n)/g
let nIter = 0
src = src.replace(ITER, (full, lead, ind, line) => {
  nIter++
  return full +
    ind + "globalThis.__damMigrationOptIn.required() ? h('label', { className: 'i5-form-field', " + BOXKEY + ' },\n' +
    ind + "  h('input', { type: 'checkbox', checked: !!props.pack && props.confirmedLegacyPack === props.pack,\n" +
    ind + "    disabled: busy || !props.pack, onChange: function (e) { props.setConfirmedLegacyPack(e.target.checked ? props.pack : '') } }),\n" +
    ind + "  ' ' + " + LABEL_SRC + ') : null,\n'
})

// 5.5 大屏页 props 传递
const PROPS = /(\n([ \t]*))(conflict: migConflict, setConflict: function \(value\) \{ setMigConflict\(value\); migPreview\(value\) \}, onApply: migApply,)/g
let nProps = 0
src = src.replace(PROPS, (full, lead, ind, line) => {
  nProps++
  return full + '\n' + ind + 'confirmedLegacyPack: migConfirmedLegacyPack, setConfirmedLegacyPack: setMigConfirmedLegacyPack,'
})
report.actions.push('3 处勾选框（含 required() 开关）+ 大屏页 props 传递')

// ── ⑥ 终检 ────────────────────────────────────────────────────
const checks = verifyPatched(src, helper)
checks.anchors = { requests: nReq, states: nState, classicSlots: nClassic, iterSlots: nIter, propsSlots: nProps }
checks.anchorsOk = nReq === 6 && nState === 3 && nClassic === 2 && nIter === 1 && nProps === 1
checks.fieldOverride = field !== OPTIN_DEFAULT_FIELD ? field : null
report.checks = checks
report.shape = Object.assign({}, report.shape, { fieldResolved: field })
console.log('  后端契约 ' + JSON.stringify(report.backend))
console.log('  锚点命中 ' + JSON.stringify(checks.anchors))
console.log('  终检 ' + JSON.stringify(checks))
if (!checks.ok || !checks.anchorsOk) {
  report.status = 'VERIFY_FAILED'
  console.error('终检失败，未写盘')
  finish(2)
}
if (DRY) { report.status = 'DRY_RUN_OK'; finish(0) }

if (!existsSync(BAK)) writeFileSync(BAK, raw)   // 保留原始字节，供反复复验
writeFileSync(CL, crlf ? src.replace(/\n/g, '\r\n') : src)
report.status = 'APPLIED'
report.actions.push('已写入 ' + CL + '（换行=' + (crlf ? 'CRLF' : 'LF') + '，原件备份 ' + BAK + '）')
console.log('已写入 ' + CL)
finish(0)
