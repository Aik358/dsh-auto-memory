/**
 * WB-GRAPH P1 (2026-09-16) —— 判据校验中间件验收套件。
 * 权威依据: WB-GRAPH-INTEGRATION-PLAN.md §2.2 判据定义表 + §2.5 报告契约
 *   + WB-FORMAT-CONVENTION.md 验收清单 + WB-GRAPH-DECISIONS §E(拍板: P1 全量/A6 照写+警示行)。
 * 勘误(施工时实测推翻方案假设): P0 窗口的 wb-contract-pre.js 已实现 H1-H4/S1-S4 判据并接线
 *   index.js checkMutationPre 两咽喉 — 本套件验「契约实现 + 接线现状」, 不重测独立实现。
 */
import { strict as assert } from 'node:assert'
import {
  checkHandoffCriteriaPre, checkPlanCriteriaPre, checkWriteCriteriaPre, renderCriteriaRejectionPre,
  HANDOFF_SECTIONS_PRE_V1, LEDGER_MAX_CHARS_PRE_V1, LEDGER_CRITERIA_VERSION,
} from '../../lib/ledger-criteria-pre.js'
import { readFile } from 'node:fs/promises'

let pass = 0, fail = 0
const t = (name, fn) => {
  Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ok - ' + name); flush() },
    (e) => { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)); flush() },
  )
}
let done = 0
const TOTAL = 10
function flush() { if (++done === TOTAL) { console.log('[p1-ledger-criteria] ' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exit(1) } }

const NL = '\n'
function makeLedger(over = {}) {
  const o = Object.assign({
    status: '8/8 阶段全部结项，回归基线 PASS 92 / FAIL 0，看板进度条已同步到 100%。',
    goal: '下一步实装白板线 P1 判据门，然后 vendor 搬入 dsh-graph 接管看板层。',
    fail: '- 变异基线用旧备份 → P2 改造整体回滚（测试 17/11 报错），重放 7 处编辑修复',
    next: '1. 重启宿主 D:\\dsh-auto-memory\n2. 运行全量回归 tests/smoke',
  }, over)
  return ['# 交接账本 · 测试', '', '## 任务状态', o.status, '', '## 目标', o.goal, '', '## 已试方案与失败原因', o.fail, '', '## 进度与下一步', o.next, ''].join(NL)
}

t('C1 H1 四段标题齐全逐字匹配 → hard_pass=true(权威 fixture)', () => {
  const r = checkHandoffCriteriaPre(makeLedger())
  assert.equal(r.version, 'ledger_criteria_v1')
  assert.equal(r.hard_pass, true, JSON.stringify(r.hard))
  assert.deepEqual(r.hard.map((h) => h.id), ['H1', 'H2', 'H3', 'H4'])
})

t('C2 H1 标题错写/缺段 → 拒绝并报缺失段清单(权重化截断失效防线)', () => {
  const bad = makeLedger().replace('## 已试方案与失败原因', '## 失败记录')
  const r = checkHandoffCriteriaPre(bad)
  assert.equal(r.hard_pass, false)
  const h1 = r.hard.find((h) => h.id === 'H1')
  assert.equal(h1.pass, false)
  assert.ok(h1.missing.some((m) => m.includes('已试方案与失败原因')), JSON.stringify(h1.missing))
  const dropped = makeLedger().replace(/## 已试方案与失败原因[\s\S]*?(?=## 进度与下一步)/, '')
  const r2 = checkHandoffCriteriaPre(dropped)
  assert.equal(r2.hard_pass, false, '整段缺失同样拒绝')
})

t('C3 H2 空段拒绝(<20 非空白字符); H3 占位符行拒绝(dsh-graph CRITERIA_PLACEHOLDERS 技巧)', () => {
  const empty = makeLedger({ goal: '短' })
  const r1 = checkHandoffCriteriaPre(empty)
  assert.equal(r1.hard_pass, false, '目标段 <20 字符应拒绝')
  assert.ok(r1.hard.find((h) => h.id === 'H2').missing.some((m) => m.includes('目标')), JSON.stringify(r1.hard))
  const ph = makeLedger({ status: '（待补充）' })
  const r2 = checkHandoffCriteriaPre(ph)
  assert.equal(r2.hard_pass, false)
  assert.ok(r2.hard.find((h) => h.id === 'H3').missing.length > 0, '占位符行应被点名')
  assert.ok(!/同上|(待补充)|TODO/.test(makeLedger()), 'fixture 自身不含占位符')
})

t('C4 H4 总长 ≤8000(先于 sanitizeForWrite, 防双重截断语义混乱); S1 超 5 行段=软警告不拦截', () => {
  const big = makeLedger({ next: Array.from({ length: 400 }, (_, i) => i + '. 行 ' + 'x'.repeat(40)).join(NL) })
  const r = checkHandoffCriteriaPre(big)
  assert.equal(r.hard.find((h) => h.id === 'H4').pass, false, '超 8000 拒绝')
  const overLong = makeLedger({ next: Array.from({ length: 9 }, (_, i) => (i + 1) + '. 步骤' + i + ' 含路径 D:\\x').join(NL) })
  const r2 = checkHandoffCriteriaPre(overLong)
  assert.equal(r2.hard_pass, true, '软判据不拦截')
  assert.equal(r2.soft.find((s) => s.id === 'S1').pass, false, '但 S1 如实标记')
})

t('C5 P-H1/P-H2 白板最弱判据: 非空 ## 节存在 → 过; 全空/无节 → 拒(防空白板)', () => {
  const ok = checkPlanCriteriaPre('# 全貌\n\n## 进度\n3.0 主体八阶段全部结项，下一步做白板线 P1 判据门实装\n')
  assert.equal(ok.hard_pass, true, JSON.stringify(ok.hard))
  const blank = checkPlanCriteriaPre('# 只有标题\n\n没有二级节\n')
  assert.equal(blank.hard_pass, false, '无 ## 节拒绝')
  const aged = checkPlanCriteriaPre('## 一\n' + 'x'.repeat(21) + '\n')
  assert.equal(aged.hard_pass, true)
})

t('C6 分派与 fail closed: 未知 target → hard_pass=false; 报告契约完整(§2.5)', () => {
  const bad = checkWriteCriteriaPre('unknown', 'x')
  assert.equal(bad.hard_pass, false)
  assert.equal(bad.hard[0].id, 'INVALID')
  const r = checkWriteCriteriaPre('handoff', makeLedger())
  assert.deepEqual(Object.keys(r).sort(), ['hard', 'hard_pass', 'soft', 'target', 'version'])
  assert.ok(r.soft.every((s) => typeof s.pass === 'boolean' && typeof s.detail === 'string'))
})

t('C7 拒绝文案可执行: renderCriteriaRejectionPre 含缺失明细与重试指引(P1-4)', () => {
  const r = checkHandoffCriteriaPre(makeLedger().replace('## 目标', '## 目標'))
  const msg = renderCriteriaRejectionPre(r)
  assert.ok(msg.includes('判据未过') && msg.includes('目标'), '文案点名缺失段')
  assert.ok(msg.includes('重试'), '给出改写指引')
})

t('C8 权威常量对账: 四段标题与 handoff-anchor-pre 权重表同源; 上限 8000', async () => {
  assert.deepEqual([...HANDOFF_SECTIONS_PRE_V1], ['任务状态', '目标', '已试方案与失败原因', '进度与下一步'])
  assert.equal(LEDGER_MAX_CHARS_PRE_V1, 8000)
  const anchorSrc = await readFile('lib/handoff-anchor-pre.js', 'utf8')
  for (const t of HANDOFF_SECTIONS_PRE_V1) assert.ok(anchorSrc.includes(t), '同源标题: ' + t)
})

t('C9 水位骨架 fail-soft 口径(A6): 模块永不抛错、报告即决策依据 — 骨架调用点可据此照写+警示行', () => {
  // 水位骨架在素材全空时产出标题齐全但内容单薄的账本。模块职责=返回报告(不抛错不拦截),
  // 骨架调用点(P1-5)读 hard_pass=false 仍照写 + 加警示行(A6 拍板: 优先保证接续材料存在, I4)。
  const skeleton = ['# 交接账本 · 自动', '', '## 任务状态', '(骨架) 素材不足，详见项目笔记。', '', '## 目标', '(骨架) 目标段待补。', '', '## 已试方案与失败原因', '(骨架) 本轮无失败项。', '', '## 进度与下一步', '(骨架) 下一步待补。', ''].join(NL)
  let r = null
  assert.doesNotThrow(() => { r = checkHandoffCriteriaPre(skeleton) }, '模块对任何输入都不抛错')
  assert.equal(r.hard.find((h) => h.id === 'H1').pass, true, '骨架标题硬编码天然过 H1(标题层不阻塞)')
  assert.equal(r.hard_pass, false, 'H2 如实标记单薄段 — 供骨架调用点打警示行(信息而非阻塞)')
  assert.ok(r.soft.every((s) => typeof s.pass === 'boolean'), '软判据同时给出(照写时的报告完整性)')
})

t('C10 接线现状(勘误后守卫): P0 已建 wb-contract 判据 + checkMutationPre 两咽喉已接线; 本窗口交付=对账验证', async () => {
  const src = await readFile('lib/index.js', 'utf8')
  assert.ok(src.includes("from './wb-contract-pre.js'"), 'index.js import wb-contract(判据真源)')
  assert.ok(src.includes('checkHandoffCriteriaPre') && src.includes('checkPlanCriteriaPre'), 'checkMutationPre 判据门引用契约函数')
  assert.ok(src.includes("gate === 'criteria'") || src.includes("gate: 'criteria'"), '判据门 gate=criteria 语义存在')
  assert.ok(src.includes('skipCriteria'), 'A6 水位骨架 skipCriteria 降级路径存在')
  // ledger-criteria-pre 只作转发/常量供独立调用, 不重复实现(单一真源)
  const lc = await readFile('lib/ledger-criteria-pre.js', 'utf8')
  assert.ok(lc.includes("from './wb-contract-pre.js'"), 'ledger-criteria 与契约同源(单一真源)')
})
