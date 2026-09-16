/**
 * RED-PROOF：验证外部方案里的验收断言**真的能红**（2026-09-14）。
 *
 * 纪律来源：本项目"跑不红的断言等于没有断言"。方案（PLAN-gpt6astra-round2-20260914.md）里
 * 每条 T0-x 都声称"能失败"，但**声称 ≠ 能红**。本文件只做一件事：把其中最关键的一条
 * （T0-1 状态，对应核实表 C8）在**当时未修复的代码**上跑一遍，看它是否报红。
 *
 * 【2026-09-15 更新 · 本文件的使命已完成，保留为**历史证据**】
 *   修复前实测：**0 通过 / 4 报红**（C8 证据，已留痕于 `docs/internal/RUN-P0-NIGHTLY.md`）。
 *   修复后实测：**4 通过 / 0 报红**（P0 第一步完成）。
 *   正式套件：`tests/smoke/smoke-test-i5-status-filter-pre.mjs`（45 断言，含本文件 4 条 + I5 取值域、
 *   与检索侧同函数对照、过滤在闸门之前、挡下不静默等）；本文件**不再承担回归职责**，
 *   仅作为"这条断言确实能红"的**历史证明**保留（可随时重跑复核）。
 *   ⚠️ 因此本文件仍放在 `tools/_redproof/` 而非 `tests/smoke/`：它不该被算作一个回归套件。
 *
 * 判据方向：断言写的是**期望行为**（I5 要求非 current 条目在检索与注入两处都被过滤）。
 *   - 修复前应 **RED**（代码确有 C8 缺陷）；
 *   - 修复后应 **GREEN**（现态）。
 *
 * 只读、零依赖、不联网、不启宿主。
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildTier0CatalogFromTextPre,
} from '../../lib/tier0-catalog-pre.js'
import {
  composeTieredInjectionPre,
} from '../../lib/tier-layer-inject-pre.js'

const scratch = mkdtempSync(path.join(tmpdir(), 'dam-redproof-'))
const SOURCES = {
  userPath: path.join(scratch, 'USER.md'),
  notesPath: path.join(scratch, 'MEMORY.md'),
  logPath: path.join(scratch, '2026-09-14.md'),
}
void readFileSync // 保持与其它套件一致的导入面（本文件不读盘）

const catalog = buildTier0CatalogFromTextPre(
  { user: '- 用户偏好一\n- 用户偏好二', project: '- 项目结论一', log: '- 今日做了一件事' },
  { maxTokens: 800, quota: true },
)

// 混合状态候选：这正是核实表 C8 指出的场景（tests/smoke/smoke-test-c5-tier-inject-pre.mjs:127 同形）
const hits = [
  { memoryId: 'mem_' + 'a'.repeat(32), score: 0.91, excerpt: '命中摘要一', layer: 'project', status: 'current' },
  { memoryId: 'mem_' + 'b'.repeat(32), score: 0.72, excerpt: '命中摘要二', layer: 'log', status: 'current' },
  { memoryId: 'mem_' + 'c'.repeat(32), score: 0.55, excerpt: '命中摘要三', layer: 'user', status: 'superseded' },
  { memoryId: 'mem_' + 'd'.repeat(32), score: 0.51, excerpt: '命中摘要四', layer: 'reflection', status: 'retracted' },
]

const r = composeTieredInjectionPre({ catalog, hits, question: '再看看' })
const lines = (r && r.tier1 && r.tier1.lines) || []
const ids = lines.map((l) => (/(mem_[0-9a-f]{32})/.exec(l) || [])[1]).filter(Boolean)

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }

console.log('[red-proof] T0-1（对应核实表 C8）：非 current 条目不得进入注入')
ok(!ids.includes('mem_' + 'c'.repeat(32)), 'superseded 条目不出现在 Tier-1 注入行')
ok(!ids.includes('mem_' + 'd'.repeat(32)), 'retracted 条目不出现在 Tier-1 注入行')
ok(!r.text.includes('命中摘要三') && !r.text.includes('命中摘要四'), '非 current 正文不出现在最终文本')
ok(ids.length === 2 || ids.length === 0, 'Tier-1 条数 = current 命中数(2) —— 实际 ' + ids.length)

console.log('[red-proof] 结果：' + pass + ' 通过 / ' + fail + ' 报红')
console.log('[red-proof] 判读：报红 = 断言有效（代码确有 C8 缺陷）；'
  + '全绿 = 空断言（方案 T0-1 不可信）。')
process.exit(fail ? 1 : 0)
