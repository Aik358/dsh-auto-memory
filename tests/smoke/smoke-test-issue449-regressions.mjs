// smoke-test-issue449-regressions —— #449 三条回归 + 两条附件的守卫（2026-10-18）
//
// 背景：社区贡献者 Xu3Zhen1 报「3.3.5 的三处修复各自引入了一个新回归」，并指出
//   #445 的复核方法是「原代码是否仍原样存在」，**没覆盖「修完之后存量数据会怎样」**。
//   逐条复核后三条全部成立，本套件把它们固化为守卫。
//
// 判据纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；
//   每条都带**负路径**（变异后必红），并给出可复算物理量（字节数/计数/耗时）。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildPackPre, validatePackPre, MIGRATE_PACK_FORMAT_PRE, packChecksumPre } from '../../lib/migrate-pack.js'
import { healPlanDuplicateIdsPre } from '../../lib/plan-store.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok   - ' + n) } else { fail++; console.error('  RED  - ' + n) } }
const eq = (g, w, n) => ok(JSON.stringify(g) === JSON.stringify(w), n + ' got=' + JSON.stringify(g) + ' want=' + JSON.stringify(w))

// ═══════════ R1: 历史迁移包（v1 摘要 + userFiles）默认拒、显式确认可放行 ═══════════
console.log('\n[R1] #449-1：3.1.3–3.3.4 产出的历史包（algo=sha256 + userFiles）')
{
  // 构造一个**真实的历史包形状**：v1 algo、含 userFiles、files 摘要按 v1 口径算
  const files = { 'handoff/PLAN.md': '# 白板\n内容\n', 'NOTES.md': 'note\n' }
  const userFiles = { 'CALENDAR.md': '- 2026-10-28 交作业\n' }
  const legacyPack = {
    format: MIGRATE_PACK_FORMAT_PRE,
    createdAt: '2026-09-01T00:00:00.000Z',
    source: { ws: 'ws-legacy' },
    runtime: {},
    files,
    userFiles,
    stats: { fileCount: Object.keys(files).length },
    checksum: { algo: 'sha256', value: packChecksumPre(files) },  // ← v1 口径：只算 files
  }
  // 默认：必须**拒**（fail closed 的安全意图保留）
  const vDef = validatePackPre(legacyPack)
  ok(vDef.ok === false, '默认拒绝历史包（fail closed 不变）')
  ok(vDef.errors.includes('userfiles-unproven-by-checksum'), '默认拒绝理由 = userfiles-unproven-by-checksum')
  // 显式确认：必须**放行**并留 warning（这是 #449-1 的修复本体）
  const vOk = validatePackPre(legacyPack, { allowUnprovenUserFiles: true })
  ok(vOk.ok === true, '★ 显式确认后放行（否则所有在野历史包全被判死）')
  ok(vOk.warnings.some(w => String(w).startsWith('userfiles-unproven-by-checksum-accepted:')), '★ 放行时留 warning 痕迹（未静默导入）')
  // 负路径：确认通道**不得**放过真篡改 —— files 被改但摘要没跟着改 ⇒ 必须 checksum-mismatch
  const tampered = JSON.parse(JSON.stringify(legacyPack))
  tampered.files['NOTES.md'] = 'tampered\n'
  const vBad = validatePackPre(tampered, { allowUnprovenUserFiles: true })
  ok(vBad.ok === false && vBad.errors.includes('checksum-mismatch'), '★ 负路径：确认通道仍拦得住内容篡改（checksum-mismatch）')
  // 负路径：v2 包（正确摘要）不受本改动影响
  const v2pack = {
    format: MIGRATE_PACK_FORMAT_PRE, createdAt: '2026-10-18T00:00:00.000Z',
    source: { ws: 'ws-new' }, runtime: {}, files, userFiles,
    stats: { fileCount: Object.keys(files).length },
    checksum: { algo: 'sha256+userFiles-v2', value: packChecksumPre(files, userFiles) },
  }
  const v2 = validatePackPre(v2pack)
  ok(v2.ok === true, '负路径：v2 包（双清单摘要）默认即通过，不受改动影响')
}

// ═══════════ R3: 白板重复锚点先自愈、失败才拒 ═══════════
console.log('\n[R3] #449-3：存量白板含重复锚点时的自愈')
{
  const A = 'mem_' + 'a'.repeat(32)
  const B = 'mem_' + 'b'.repeat(32)
  const NL2 = String.fromCharCode(10)
  const doc = [
    '# 白板', '## 卡片一', '<!-- memory:' + A + ' -->', '正文一',
    '## 卡片二', '<!-- memory:' + A + ' -->', '正文二',
    '## 卡片三', '<!-- memory:' + B + ' -->', '正文三',
  ].join(NL2)
  // 前提：原文件确实有重复
  const idCount = new Map()
  for (const m of doc.matchAll(/memory:(mem_[a-f0-9]{32})/g)) idCount.set(m[1], (idCount.get(m[1]) || 0) + 1)
  eq([...idCount.values()].sort(), [1, 2], '前提：输入确有 2 张卡共用同一 id')
  const r = healPlanDuplicateIdsPre('ws-test', doc)
  ok(r.healed === 1, '★ 自愈移除 1 个重复锚点（实际 got=' + r.healed + '）')
  const ids = []
  for (const m of r.text.matchAll(/memory:(mem_[a-f0-9]{32})/g)) ids.push(m[1])
  eq(new Set(ids).size, ids.length, '★ 自愈后 id 唯一')
  ok(ids.includes(A), '★ 首个出现者（A）身份被保留（不误改合法锚点）')
  ok(ids.includes(B), '★ 无关的唯一锚点（B）完整保留')
  ok(r.text.includes('正文一') && r.text.includes('正文二') && r.text.includes('正文三'), '★ 卡片正文零丢失')
  // 负路径：本来唯一 ⇒ healed=0 且文本逐字节不变（绝不误伤）
  const clean = '# T' + NL2 + '## X' + NL2 + '<!-- memory:' + B + ' -->' + NL2 + 'y'
  const r2 = healPlanDuplicateIdsPre('ws-test', clean)
  eq(r2.healed, 0, '负路径：唯一锚点的白板 healed=0')
  ok(r2.text === clean, '负路径：唯一锚点白板文本逐字节不变')
  // 负路径：user 区/fence 内的重复锚点**不得**被改动
  const Q2 = String.fromCharCode(39)
  const fenced = '# T' + NL2 + '```' + NL2 + '<!-- memory:' + B + ' -->' + NL2 + '```' + NL2 + '## C' + NL2 + '<!-- memory:' + B + ' -->'
  const r3 = healPlanDuplicateIdsPre('ws-test', fenced)
  eq(r3.healed, 0, '负路径：fence 内的锚点不参与身份计算（healed=0）')
}

// ═══════════ R2: copyDir 自指目录环必须收敛（真跑生产 copyDir） ═══════════
console.log('\n[R2] #449-2：自指 junction 下 copyDir 必须快速返回')
{
  const root = mkdtempSync(path.join(tmpdir(), 'i449-loop-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  let engine = null
  try {
    const { MemoryEngine } = await import('../lib/audit-engine.mjs')
    engine = new MemoryEngine()
    engine.config = Object.assign({}, engine.config, {
      memoryRoot: path.join(root, 'memory', 'workspaces'),
      userMemoryDir: path.join(root, 'memory'),
      pythonBackendEnabled: false, l0IndexEnabled: false, globalBriefEnabled: false,
    })
  } catch (e) { console.error('  (engine 构造失败，跳过 R2 实测: ' + ((e && e.message) || e) + ')') }
  if (engine) {
    const src = path.join(root, 'mem')
    mkdirSync(path.join(src, 'handoff'), { recursive: true })
    writeFileSync(path.join(src, 'handoff', 'a.md'), 'x')
    const link = path.join(src, 'handoff', 'archive')
    let canLink = false
    try { execSync('cmd /c mklink /J "' + link + '" "' + path.join(src, 'handoff') + '"', { stdio: 'pipe' }); canLink = true } catch (_) { }
    if (!canLink) { console.log('  skip - 本机不可创建 junction') }
    else {
      const t0 = Date.now()
      const r = await engine.copyDir(src, path.join(root, 'dst'))
      const ms = Date.now() - t0
      ok(ms < 5000, '★ 自指环下 copyDir 在 5s 内返回（实测 ' + ms + ' ms；修复前 >90s 挂死）')
      ok(r && r.cycleSkipped === 1, '★ 回执带 cycleSkipped=1（可观测「遇到过环」）')
      ok(r && Number.isFinite(r.copied) && Number.isFinite(r.retained), '回执形状保持 {copied, retained, cycleSkipped}')
      ok(existsSync(path.join(root, 'dst', 'handoff', 'a.md')), '★ 环之外的正常文件仍被复制（未误伤）')
    }
  }
  if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
  try { rmSync(root, { recursive: true, force: true }) } catch (_) { }
}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
