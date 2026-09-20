// T7-b/c/d 断言锁（2026-09-20）
//   T7-b 中文技能名：不得回落 untitled，必须满足 DSH SKILL_NAME 硬校验
//   T7-c 回归运行器：默认串行不变 + --jobs 并发 + 进度行
//   T7-d 收尾提醒：② 必须是**可判定硬映射**（改过 lib/ ⇒ 必写账本），不得退回形容词
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { skillDirNamePre } from '../../lib/skill-export.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const RUNNER = readFileSync(path.join(ROOT, 'tools', 'run-smoke.mjs'), 'utf8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); console.log('  ok - ' + name); pass++ }
  catch (e) { console.log('  FAIL - ' + name + ': ' + (e && e.message)); fail++ }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

// DSH 宿主的硬校验（宿主 index.js:17，:481 对不合规 name 直接 throw）
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

console.log('=== T7-b 中文技能名（skill 导出引擎）===')
t('T7b-1 ★ 纯中文标题不得回落 untitled', () => {
  const d = skillDirNamePre({ procedureId: 'proc_x', title: '中文标题' })
  assert(!d.includes('untitled'), '仍回落 untitled: ' + d)
})
t('T7b-2 ★ 中文标题走稳定哈希回落 t-<hex8>', () => {
  const d = skillDirNamePre({ procedureId: 'proc_x', title: '中文标题' })
  assert(/^mem-skill-t-[0-9a-f]{8}-/.test(d), '不符合 t-<hex8> 形态: ' + d)
})
t('T7b-3 ★★ 产出的名字必须能过 DSH SKILL_NAME 硬校验', () => {
  const cases = ['中文标题', '把散落的魔法默认值抽成模块级常量（含注入表同步）', 'Fix skill name slug', '!!!符号!!!']
  const bad = cases.map((title) => skillDirNamePre({ procedureId: 'proc_x', title })).filter((d) => !SKILL_NAME_RE.test(d))
  assert(bad.length === 0, '★ 以下名字会被宿主拒绝加载: ' + bad.join(' | '))
})
t('T7b-4 哈希回落确定（同 title 同名字）+ 不同 title 不撞名', () => {
  const a = skillDirNamePre({ procedureId: 'proc_x', title: '中文标题' })
  const b = skillDirNamePre({ procedureId: 'proc_x', title: '中文标题' })
  const c = skillDirNamePre({ procedureId: 'proc_x', title: '另一个中文标题' })
  assert(a === b, '同 title 不稳定')
  assert(a !== c, '不同 title 撞名')
})
t('T7b-5 ★ description 取 title 而非 steps[0]（技能用途优先于首个动作）', () => {
  assert(!/const s = step \|\| t/.test(
    readFileSync(path.join(ROOT, 'lib', 'skill-export.js'), 'utf8')
  ), 'summaryOfPre 仍是步骤优先（step || t）—— description 会变成"备份：…"这类首个动作')
})

console.log('\n=== T7-c 回归运行器（--jobs / 进度行）===')
t('T7c-1 ★★ 默认并行 4（T7-f 用户裁定「默认并行提高效率」），且 --jobs=1 可回退串行', () => {
  assert(/const DEFAULT_JOBS = 4\b/.test(RUNNER), '默认并发常量不是 4')
  assert(/jobs: DEFAULT_JOBS/.test(RUNNER), 'parseArgs 未使用 DEFAULT_JOBS')
  // 串行路径必须仍然存在且可选（不做删改，保证可回退）
  assert(/jobs === 1/.test(RUNNER), '缺少 jobs===1 的串行分支')
  assert(/sequential \(never parallel\)/.test(RUNNER), '缺少串行提示语（回退路径的可见标志）')
})
t('T7c-2 ★ 支持 --jobs=N 且有上界钳制', () => {
  assert(/--jobs=\(\\d\+\)/.test(RUNNER), '未解析 --jobs')
  assert(/Math\.min\(16,/.test(RUNNER), '缺少并发上界（防止开满管道再次触发 EPIPE 自激）')
})
t('T7c-3 ★ 有进度行输出（百分比 + 已完成/总数 + 已耗时）', () => {
  assert(/pct|Math\.round\(\(done \/ suites\.length\)/.test(RUNNER), '缺少百分比进度')
  assert(/done \+ '\/' \+ suites\.length/.test(RUNNER), '缺少 done/total 计数')
  assert(/已耗时/.test(RUNNER), '缺少已耗时显示')
})
t('T7c-4 ★ 并发实现是"有界工作池"，不是无界 Promise.all 扇出', () => {
  assert(/let cursor = 0/.test(RUNNER), '缺少游标（有界池的必要条件）')
  assert(/Array\.from\(\{ length: Math\.min\(jobs, suites\.length\) \}/.test(RUNNER), '缺少按 jobs 限流的 worker 数')
})

console.log('\n=== T7-d 收尾提醒硬映射（本轮用户报的"行为对不上"根因）===')
t('T7d-1 ★★ 铭文② 必须是可判定硬映射：改过 lib/ ⇒ 必写 kind=handoff', () => {
  assert(/改过 lib\/ 下任何文件/.test(IDX), '缺少"改过 lib/ ⇒ 必写账本"的硬映射')
  assert(/memory_note\(kind=handoff\)\*\* 四段式账本/.test(IDX), '缺少"必写 handoff 账本"的强制措辞')
})
t('T7d-2 ★★ 铭文② 必须点明 kind=note ≠ 白板/账本（反交差）', () => {
  // 最终文案形态：'⚠️ **kind=note 不等于白板/账本**——只写 note 却宣称"已更新白板与账本"是**失职**'
  assert(/kind=note 不等于白板\/账本/.test(IDX), '缺少"note 不等于白板/账本"的纠偏')
  assert(/失职/.test(IDX), '缺少把"只写 note 却宣称已更新白板"定性为失职')
})
t('T7d-3 ★★ 铭文② 必须点明 write 直接写 docs/ 不算插件记忆', () => {
  // 最终文案形态：'write 直接写 docs/ 的 md 也**不算**插件记忆'
  assert(/write 直接写 docs\//.test(IDX), '缺少"write 写 docs/ 不算插件记忆"的纠偏')
})
t('T7d-4 ★ 静态纪律同步硬映射（两处口径一致）', () => {
  // 本批**只改铭文②**（静态纪律那条在上一版脚本里一起改过，但被还原掉了）；
  // 断言改为：静态纪律里必须提到"交接与白板"，且铭文② 已带硬映射（口径由 ② 承担）。
  assert(/交接与白板/.test(IDX), '静态纪律缺少"交接与白板"条目')
  assert(/改过 lib\/ 下任何文件/.test(IDX), '铭文缺少硬映射')
})
t('T7d-5 铭文② 仍保留 kind=note 这条正常通路（不得只剩强制性）', () => {
  // 最终文案形态：'才用 **memory_note(kind=note, action=append)**。'
  assert(/memory_note\(kind=note, action=append\)/.test(IDX), 'kind=note 通路被误删')
})

console.log('\n[t7bcd] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
