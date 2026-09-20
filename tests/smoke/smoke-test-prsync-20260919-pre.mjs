#!/usr/bin/env node
/**
 * smoke-test-prsync-20260919-pre.mjs —— 上游 4 个 PR 的 pre 线同步落地套件（2026-09-19）
 *
 * 背景：合作方 `Minervaowl7` 的 PR #77/#78/#79/#80 已 merge 到 **main（正式版）**。
 * 但本仓 pre 开发线是**活宿主代码**，且用户「发大版本时用 pre 统一覆盖正式版」
 * ⇒ **pre 线必须同等落地，否则覆盖时这些修复会丢**。本套件锁定这四处。
 *
 *   ① #63/#77  episodic_candidate 增量导入（**P0 数据丢失**）
 *   ② #64/#78  index-sync 页预算留信封余量（**P0 死锁**）
 *   ③ #65/#79  下载器每次尝试前清 tmp（**P1 静默损坏**）
 *   ④ #67/#80  fact-store 冲突左侧取检测时快照
 */
import { readFileSync } from 'node:fs'
import { createEpisodicStorePre } from '../../lib/episodic-store.js'
import { createMemoryHubPre } from '../../lib/memory-hub.js'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { createFactStorePre } from '../../lib/fact-store.js'
import { INDEX_SYNC_PAGE_BUDGET_V1 } from '../../lib/index-sync.js'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')

console.log('\n[① #63/#77] episodic_candidate 必须走增量导入，绝不清空既有 episode')
{
  const s = src('episodic-store.js')
  ok(/function importEpisodes\(rows\)/.test(s), '★ 新增 importEpisodes(rows)')
  ok(/importEpisodes,/.test(s) || /importEpisodes\b[^)]*\}\s*$/.test(s) || /snapshot, restore, importEpisodes/.test(s), '★ 已导出 importEpisodes')

  // 行为：先巩固出既有 episode，再喂一行**非法候选**，既有必须保留
  const store = createEpisodicStorePre({ now: () => 1000 })
  const good = {
    episodeId: 'epi_' + 'a'.repeat(32), sessionRef: 's1', startedAt: 1, outcome: 'success',
    intent: '既有 episode', actions: [], entities: [], unresolved: [], provenance: ['p'],
  }
  const r0 = store.restore({ schemaVersion: 1, episodes: [good] })
  ok(r0.ok && r0.restored === 1, '既有 episode 装载成功', JSON.stringify(r0))
  ok(store.size === 1, '装载后 size=1')

  // 关键：喂一行**缺必填字段**的候选（真机 worker 就是这种）
  const bad = { title: '半截候选', intent: 'x' }
  const imp = store.importEpisodes([bad])
  ok(imp.ok === true && imp.rejected === 1, '★ 非法候选被计入 rejected（不静默）', JSON.stringify(imp))
  ok(store.size === 1, '★★ 既有 episode **未被清空**（这正是 P0 数据丢失点）', 'size=' + store.size)

  // 幂等：同一合法 episode 导两次只留一条
  const dup = store.importEpisodes([good])
  ok(dup.duplicates === 1 && store.size === 1, '★ 按 episodeId 幂等去重', JSON.stringify(dup))

  // 追加合法新条目
  const good2 = { ...good, episodeId: 'epi_' + 'b'.repeat(32) }
  const imp2 = store.importEpisodes([good2])
  ok(imp2.imported === 1 && store.size === 2, '★ 合法新条目正常追加', JSON.stringify(imp2))

  // hub 侧必须改走 importEpisodes，且**不得**再出现 restore 调用
  const h = src('memory-hub.js')
  ok(/stores\.episodic\.importEpisodes\(\[row\]\)/.test(h), '★ hub 改走 importEpisodes([row])')
  ok(!/stores\.episodic\.restore\(\{ schemaVersion: 1, episodes: \[row\] \}\)/.test(h),
    '★★ hub 不再对候选行调 restore（快照替换语义）')
  ok(/no-import-episodes/.test(h), '★ 老 store 无该方法时 fail-soft（绝不回退到 restore）')
}

console.log('\n[② #64/#78] index-sync 页预算必须为线帧信封留余量')
{
  const s = src('index-sync.js')
  ok(/maxPageBytes: 252 \* 1024/.test(s), '★★ maxPageBytes = 252KiB（不是 256KiB）', '实际: ' + (s.match(/maxPageBytes: [^,}]+/) || ['?'])[0])
  ok(INDEX_SYNC_PAGE_BUDGET_V1.maxPageBytes === 252 * 1024, '★ 常量取值确认')
  const MAX_LINE = 256 * 1024
  ok(INDEX_SYNC_PAGE_BUDGET_V1.maxPageBytes < MAX_LINE, '★ 预算严格小于线帧上限（余量存在）')
  const headroom = MAX_LINE - INDEX_SYNC_PAGE_BUDGET_V1.maxPageBytes
  ok(headroom >= 4096, '★ 余量 ≥ 4KiB（实测信封约 202–230B 的 ~18 倍）', 'headroom=' + headroom)
  ok(/信封|envelope|MAX_LINE_BYTES|line-oversize/.test(s), '★ 注释写明原因（防后人改回去）')
}

console.log('\n[③ #65/#79] 下载器每次尝试前必须清 tmp 残留')
{
  const s = src('semantic-js.js')
  ok(/rmSync\(dst, \{ force: true \}\)/.test(s), '★★ 每次尝试前清 dst（不复用半截文件）')
  // 定位：该 rmSync 必须在 hash 创建之前（即每次尝试开始处）
  const iRm = s.indexOf('rmSync(dst, { force: true })')
  const iHash = s.indexOf('const hash = createHash(\'sha256\')')
  ok(iRm > 0 && iHash > 0 && iRm < iHash, '★ 清理发生在哈希累积之前（顺序正确）')
  ok(/appendChunk/.test(s) && /flag: 'a'/.test(s), '★ 追加写仍保留（只承担单次尝试内分块）')
}

console.log('\n[④ #67/#80] fact-store 冲突左侧必须取检测时快照（非活引用）')
{
  const s = src('fact-store.js')
  ok(/left: \{ \.\.\.existing, provenance: Array\.isArray\(existing\.provenance\)/.test(s),
    '★★ left 取快照 + provenance 数组副本')
  ok(!/left: existing,/.test(s), '★★ 不再持 store 内活引用')

  // 行为验证：登记冲突 → 改写 existing → 冲突左侧必须保持检测时值
  const fs = createFactStorePre({ now: () => 5000 })
  const base = {
    scope: 'Workspace', subject: '冲突主体', predicate: '状态', object: 'A',
    sourceKind: 'explicit', sourceClass: 'user-memory', provenance: ['prov-1'], confidence: 0.9,
  }
  const r1 = fs.upsert(base)
  ok(r1.ok, '第一条事实写入', JSON.stringify(r1))
  const conflicting = { ...base, object: 'B', provenance: ['prov-2'], confidence: 0.3 }
  const r2 = fs.upsert(conflicting)
  ok(r2.outcome === 'conflict-added', '★ 第二条触发冲突', JSON.stringify(r2))

  const c0 = r2.conflict
  ok(!!c0 && !!c0.left, '拿到冲突对象')
  const leftConf0 = c0.left.confidence
  const leftProv0 = JSON.stringify(c0.left.provenance)
  console.log('    · 检测时 left.confidence =', leftConf0, ' provenance =', leftProv0)

  // 用同一 subject+predicate 再 upsert 一次同 object（会走 merge 路径，原地改写 existing）
  fs.upsert({ ...base, provenance: ['prov-3'], confidence: 0.5 })
  fs.upsert({ ...base, provenance: ['prov-4'], confidence: 0.6 })

  ok(c0.left.confidence === leftConf0,
    '★★ merge 后冲突左侧 confidence 仍是检测时值（未被原地改写）', c0.left.confidence + ' vs ' + leftConf0)
  ok(JSON.stringify(c0.left.provenance) === leftProv0,
    '★★ merge 后冲突左侧 provenance 未被原地 push', JSON.stringify(c0.left.provenance) + ' vs ' + leftProv0)
}

console.log('\n[⑤] 汇总：四处均不得回退（源码级反向锁）')
{
  const es = src('episodic-store.js'), is = src('index-sync.js')
  const ss = src('semantic-js.js'), fs = src('fact-store.js')
  ok(!/maxPageBytes: 256 \* 1024/.test(is), 'index-sync 未退回 256KiB')
  ok(!/left: existing,/.test(fs), 'fact-store 未退回活引用')
  ok(/importEpisodes/.test(es), 'episodic-store 仍有增量导入')
  ok(/rmSync\(dst, \{ force: true \}\)/.test(ss), 'semantic-js 仍有每尝试清理')
}

console.log(`\n[PRsync-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
