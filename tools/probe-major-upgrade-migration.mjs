#!/usr/bin/env node
/**
 * 探针：3.3.x → 3.4.0-alpha.6 大版本升级后，历史 .dam-pack 能否「直接导入」。
 *
 * 只做只读/临时目录验证，绝不碰实验区插件、真实记忆数据。
 * 四层：
 *   [A] 校验层（纯函数，真 import 生产 migrate-pack.js）
 *   [B] 端到端（真 MemoryEngine.migrateInspect，复现 UI 默认请求体）
 *   [C] UI 接线（静态判定 client.js 是否暴露显式确认入口）
 *   [D] 事件库 v1→v2（#535 写侧兼容是否真落地）
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  validatePackPre, packChecksumPre, buildPackPre, workspaceSlugPre,
  MIGRATE_PACK_FORMAT_PRE, MIGRATE_PACK_CHECKSUM_ALGO_PRE, MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE,
} from '../lib/migrate-pack.js'
import {
  eventStorePre, emptyEventPre, readStorePre, EVENT_STORE_FILENAME,
  LEGACY_UPGRADE_FIELDS_PRE, upgradeLegacyEventFieldsPre,
} from '../lib/event-store.js'

let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.log('  RED  ' + name + (detail ? '  ' + detail : '')) }
}
const has = (arr, s) => Array.isArray(arr) && arr.some(x => String(x).includes(s))

const root = mkdtempSync(path.join(tmpdir(), 'alpha6-major-upgrade-'))
mkdirSync(path.join(root, 'ws'), { recursive: true })

// ─────────────────────────────────────────────────────────────
// [A] 构造 3.1.3–3.3.4 产出的历史包形状（#449 实测口径）
//     checksum.algo = 'sha256'（v1）；userFiles 里有 CALENDAR.md
//     checksum.value 按 v1 口径：只喂 files，不含 userFiles
// ─────────────────────────────────────────────────────────────
console.log('\n[A] 校验层：历史包（3.3.4 形状）')
const files = { 'PLAN.md': '# 旧版白板\n', 'memory/notes.md': '旧版记忆\n' }
const userFiles = { 'CALENDAR.md': '2026-10-18 旧版日历\n' }
const legacyPack = {
  format: MIGRATE_PACK_FORMAT_PRE,
  createdAt: 1729238400000,
  source: { ws: 'C:/old/project', slug: workspaceSlugPre('C:/old/project'), host: 'old-pc' },
  runtime: { pluginVersion: '3.3.4' },
  summaryRecord: null,
  files,
  userFiles,
  stats: { fileCount: 2, bytes: 40, userFileCount: 1, userBytes: 30 },
  checksum: { algo: MIGRATE_PACK_CHECKSUM_ALGO_PRE, value: packChecksumPre(files) },
}

const a1 = validatePackPre(legacyPack)
ok(a1.ok === false && has(a1.errors, 'userfiles-unproven-by-checksum'),
  '[A1] 默认校验：历史包被拒', 'errors=' + JSON.stringify(a1.errors))

const a2 = validatePackPre(legacyPack, { allowUnprovenUserFiles: true })
ok(a2.ok === true && has(a2.warnings, 'userfiles-unproven-by-checksum-accepted'),
  '[A2] 显式确认后放行且留 warning', 'ok=' + a2.ok + ' warnings=' + JSON.stringify(a2.warnings))

const tampered = JSON.parse(JSON.stringify(legacyPack))
tampered.files['memory/notes.md'] = '被篡改的内容\n'
const a3 = validatePackPre(tampered, { allowUnprovenUserFiles: true })
ok(a3.ok === false && has(a3.errors, 'checksum-mismatch'),
  '[A3] 显式确认不等于免校验：files 被篡改仍拒', 'errors=' + JSON.stringify(a3.errors))

const oldNoUser = {
  format: MIGRATE_PACK_FORMAT_PRE, createdAt: 1729238400000,
  source: { ws: 'C:/old/project', slug: workspaceSlugPre('C:/old/project'), host: 'old-pc' },
  runtime: { pluginVersion: '3.1.2' }, files, stats: { fileCount: 2 },
  checksum: { algo: MIGRATE_PACK_CHECKSUM_ALGO_PRE, value: packChecksumPre(files) },
}
const a4 = validatePackPre(oldNoUser)
ok(a4.ok === true, '[A4] 无 userFiles 的更老包：默认可导入（老包互认）', 'ok=' + a4.ok)

const built = buildPackPre({ ws: 'C:/old/project', files, userFiles, pluginVersion: '3.4.0-alpha.6', now: 1 })
const a5 = validatePackPre(built.pack)
ok(built.ok === true && built.pack.checksum.algo === MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE && a5.ok === true,
  '[A5] alpha.6 新产出的包走 v2 双清单，默认通过', 'algo=' + built.pack.checksum.algo)

const oldStyleDigest = packChecksumPre(built.pack.files)
ok(oldStyleDigest !== built.pack.checksum.value,
  '[A6] 反向不兼容：alpha.6 的 v2 包在旧版 v1 口径下必判 mismatch',
  'v1口径=' + oldStyleDigest.slice(0, 12) + ' v2实际=' + built.pack.checksum.value.slice(0, 12))

// ─────────────────────────────────────────────────────────────
// [B] 端到端：真 MemoryEngine.migrateInspect，复现 UI 默认请求体
// ─────────────────────────────────────────────────────────────
console.log('\n[B] 端到端：真 MemoryEngine.migrateInspect（UI 默认请求体）')
const packPath = path.join(root, 'legacy.dam-pack')
writeFileSync(packPath, JSON.stringify(legacyPack))
ok(existsSync(packPath), '[B0] 历史包已落临时盘', packPath)

let engine = null, loadErr = null
try {
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const mod = await import('../tests/lib/audit-engine.mjs')
  engine = new mod.MemoryEngine()
  engine.config = Object.assign({}, engine.config, {
    memoryRoot: path.join(root, 'memory', 'workspaces'),
    userMemoryDir: path.join(root, 'memory'),
    pythonBackendEnabled: false, l0IndexEnabled: false, globalBriefEnabled: false,
    externalSources: {}, autoConsolidate: false, greetingEnabled: false,
  })
  engine.configLoaded = true
  if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
} catch (e) { loadErr = String(e && e.message ? e.message : e) }

if (!engine) {
  ok(false, '[B1] 真引擎装载失败（整段判红，不假绿）', loadErr || '')
} else {
  const targetWs = path.join(root, 'ws')
  const uiDefault = await engine.migrateInspect({ packPath, targetWs, onConflict: 'rename' })
  ok(uiDefault && uiDefault.ok === false && has(uiDefault.errors, 'userfiles-unproven-by-checksum'),
    '[B1] UI 默认路径：预览阶段即被拒（用户看不到差异、点不到确认导入）',
    'ok=' + (uiDefault && uiDefault.ok) + ' errors=' + JSON.stringify(uiDefault && uiDefault.errors))

  const withOptIn = await engine.migrateInspect({ packPath, targetWs, onConflict: 'rename', allowUnprovenUserFiles: true })
  ok(withOptIn && !has(withOptIn.errors, 'userfiles-unproven-by-checksum'),
    '[B2] 带显式确认：校验闸门放行（可进入计划计算）',
    'ok=' + (withOptIn && withOptIn.ok) + ' errors=' + JSON.stringify(withOptIn && withOptIn.errors) +
    ' warnings=' + JSON.stringify(withOptIn && withOptIn.warnings))
}

// ─────────────────────────────────────────────────────────────
// [C] UI 接线：双版本对照（原生备份 = 缺陷证据 / 当前 = 修复证据）
// ─────────────────────────────────────────────────────────────
console.log('\n[C] UI 接线：原生（缺陷） vs 打补丁后（修复）')
const clPath = new URL('../lib/client.js', import.meta.url)
const origPath = new URL('../lib/client.js.orig-449ui', import.meta.url)
const patchedSrc = readFileSync(clPath, 'utf8')
const origSrc = existsSync(origPath) ? readFileSync(origPath, 'utf8') : patchedSrc
// 两种请求体形态都要认：原生裸对象 / 契约层的 Object.assign({...}, body())。
// 探针只钉「有没有把确认通道接上」，不钉容器写法（后者由契约守护套件单独守）。
const countBodies = (s) => (s.match(/apiPost\(API\.migrate(?:Inspect|Import),\s*(?:\{[^}]*\}|Object\.assign\(\{[^}]*\},\s*globalThis\.__damMigrationOptIn\.body\([^)]*\)\))\)/g) || [])
const countOptIn = (s) => countBodies(s).filter(b => /allowUnprovenUserFiles:|__damMigrationOptIn\.body\(/.test(b)).length
const countBoxes = (s) => (s.match(/'data-dam-migration': 'legacy-opt-in'/g) || []).length

ok(countBodies(origSrc).length === 6 && countBodies(patchedSrc).length === 6,
  '[C1] 两版 UI 均共 6 处预览/导入请求（3 组向导）',
  '原生=' + countBodies(origSrc).length + ' 补丁=' + countBodies(patchedSrc).length)
ok(countOptIn(origSrc) === 0, '[C2] ★缺陷证据：原生 6 处请求零带参（后端通道悬空）',
  '带参=' + countOptIn(origSrc))
ok(countBoxes(origSrc) === 0, '[C3] ★缺陷证据：原生界面无任何显式确认勾选框',
  '勾选框=' + countBoxes(origSrc))
const routeSrc = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
ok(/allowUnprovenUserFiles:\s*!!\(body/.test(routeSrc),
  '[C4] 后端 HTTP 路由确实透传 ⇒ 断点精确定位在 UI→路由这一段', '')
ok(countOptIn(patchedSrc) === 6, '[C5] ★修复证据：6 处请求全部带参',
  '带参=' + countOptIn(patchedSrc))
ok(countBoxes(patchedSrc) === 3, '[C6] ★修复证据：三组界面各有勾选框',
  '勾选框=' + countBoxes(patchedSrc))
ok(/旧版包/.test(patchedSrc) && /not covered by the checksum/.test(patchedSrc),
  '[C7] 中英说明文案在场（明确告知用户级文件未被摘要保护）', '')
ok(!/allowUnprovenUserFiles:\s*true\b/.test(patchedSrc),
  '[C8] ★负路径：不得无条件传 true（fail-closed 不被架空）', '')
ok(/migConfirmedLegacyPack === migPack/.test(patchedSrc),
  '[C9] 确认状态按包路径绑定（换包自动失效，不会误延续）', '')

// ─────────────────────────────────────────────────────────────
// [D] #535：v1 事件（16 字段）在 alpha.6 上能否继续追加
// ─────────────────────────────────────────────────────────────
console.log('\n[D] 事件库 v1→v2 写侧兼容（#535，alpha.6 声称已修）')
const evRoot = mkdtempSync(path.join(tmpdir(), 'alpha6-v1-event-'))
const storePath = path.join(evRoot, 'handoff', EVENT_STORE_FILENAME)
mkdirSync(path.dirname(storePath), { recursive: true })
const created = await eventStorePre.create(storePath, { name: '旧版事件', summary: 'v1 形状' })
// 把真事件降级成 v1：删掉 v2 新增的 10 个字段，写回磁盘（模拟 3.3.x 老库）
const store = JSON.parse(readFileSync(storePath, 'utf8'))
for (const f of LEGACY_UPGRADE_FIELDS_PRE) delete store.events[0][f]
writeFileSync(storePath, JSON.stringify(store))
const before = await readStorePre(storePath)
const v1Fields = Object.keys(before.events[0]).length
ok(v1Fields === 16, '[D0] 已构造合法 v1 事件（16 顶层字段）', '实际=' + v1Fields)

let appendOk = false, appendErr = ''
try {
  const a = await eventStorePre.append(storePath, created.id, { checkpoint: { kind: 'log', text: '升级后追加', idemKey: 'after-upgrade' } })
  appendOk = a.appended === 1
} catch (e) { appendErr = String(e && e.message ? e.message : e) }
ok(appendOk, '[D1] 合法 v1 事件可追加检查点（#535 修复生效）', appendErr || 'appended=1')

const after = await readStorePre(storePath)
const upgraded = after.events.find(e => e.id === created.id)
ok(Object.keys(upgraded).length === 26 && LEGACY_UPGRADE_FIELDS_PRE.every(f => Object.prototype.hasOwnProperty.call(upgraded, f)),
  '[D2] 追加时按需补齐到 26 字段（不是全库重写）', '字段数=' + Object.keys(upgraded).length)
ok(upgraded.checkpoints && upgraded.checkpoints.length === 1,
  '[D3] 原正文/检查点未丢失', 'checkpoints=' + (upgraded.checkpoints || []).length)

// 负路径：字段存在但非法 ⇒ 不得被默认值洗白
const badRoot = mkdtempSync(path.join(tmpdir(), 'alpha6-v1-bad-'))
const badPath = path.join(badRoot, 'handoff', EVENT_STORE_FILENAME)
mkdirSync(path.dirname(badPath), { recursive: true })
const badEv = await eventStorePre.create(badPath, { name: '坏值事件', summary: 'bad' })
const badStore = JSON.parse(readFileSync(badPath, 'utf8'))
for (const f of LEGACY_UPGRADE_FIELDS_PRE) delete badStore.events[0][f]
badStore.events[0].kind = '__illegal_kind__'   // 字段存在但值非法
writeFileSync(badPath, JSON.stringify(badStore))
let badRejected = false, badMsg = ''
try { await eventStorePre.append(badPath, badEv.id, { checkpoint: { kind: 'log', text: 'x' } }) }
catch (e) { badRejected = true; badMsg = String(e && e.message ? e.message : e) }
ok(badRejected, '[D4] 负路径：字段存在但非法仍被拒，未被默认值洗白', badMsg.slice(0, 100))
const badAfter = JSON.parse(readFileSync(badPath, 'utf8'))
ok(badAfter.events[0].kind === '__illegal_kind__', '[D5] 非法值原样保留（未被 upgrade 覆盖）', 'kind=' + badAfter.events[0].kind)

// 幂等
const idempotent = upgradeLegacyEventFieldsPre(upgraded)
ok(idempotent.unchanged === true && idempotent.changed.length === 0,
  '[D6] 对已补齐事件再调用为 no-op（幂等）', 'changed=' + JSON.stringify(idempotent.changed))

console.log('\n=== 汇总 PASS=' + pass + ' FAIL=' + fail + ' ===')
console.log('临时目录：' + root)
process.exit(fail ? 1 : 0)
