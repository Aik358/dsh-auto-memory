/**
 * 冒烟套件：T0-8 / T0-8B / T0-8C —— 写入门（共同提交与保护）与白板最小适配边界（2026-09-14 · P0）。
 *
 * **背景（事故根因，不是设想）**：`docs/internal/WB-FORMAT-CONVENTION.md` §4 早就定义了写入门
 * （只做一件事：重写前后比对卡片集合，不允许卡片凭空消失），§5 早已定义人机分区。
 * 但 **2026-09-14 实测：实际 `PLAN.md` 一个锚点、一个分区标记都没有** —— 规范已批准、代码从未实现。
 * 这正是「白板被整篇覆盖成骨架」事故的根因。
 *
 * **边界（总纲 §0.5 / ROUND3 §3.1）**：
 *   3.0 主体拥有 `lib/memory-mutation.js:validateMutationBoundaryPre`（**只收规范化投影**，
 *   不解释图格式）；白板线拥有 `lib/wb-contract.js:parseWhiteboardPre`（解释白板格式）。
 *
 * **判据不能张冠李戴**（v2 修正）：账本用 H1–H4/S1–S4；PLAN 用 P-H1/P-H2/P-S1。
 *
 * 只读、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import {
  validateMutationBoundaryPre,
  mutationRefusalTextPre,
  protectedRegionDigestPre,
  MEMORY_MUTATION_VERSION,
  MUTATION_REASONS_V1,
} from '../../lib/memory-mutation.js'
import {
  parseWhiteboardPre,
  computeWhiteboardCardIdPre,
  extractProtectedRegionsPre,
  toMutationProjectionPre,
  checkHandoffCriteriaPre,
  checkPlanCriteriaPre,
  criteriaRefusalTextPre,
  WB_MARKERS_V1,
  WB_ANCHOR_RE_V1,
  HANDOFF_REQUIRED_SECTIONS_V1,
} from '../../lib/wb-contract.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const ID = (c) => 'mem_' + c.repeat(32)
const M = WB_MARKERS_V1

// ═══════════════════════════════════════════════════════════════════
console.log('[WB-1] 白板格式适配器：解析卡片 / 锚点 / 人机分区')
{
  const page = [
    '# 项目全貌',
    '',
    '## 这是什么',
    '一句话介绍。',
    '',
    '### 卡片甲',
    `<!-- memory:${ID('a')} -->`,
    M.modelOpen,
    '模型维护：状态 current。',
    M.modelClose,
    M.userOpen,
    '用户备注：这行的原文必须原样保留。',
    M.userClose,
    '',
    '### 卡片乙',
    `<!-- memory:${ID('b')} -->`,
    '模型维护（无显式分区标记，也合法）。',
  ].join('\n')
  const p = parseWhiteboardPre(page, { kind: 'plan' })
  eq(p.counts.cards, 2, '解析出 2 张卡片')
  eq(p.cardIds.length, 2, '两张卡都有锚点')
  ok(p.cardIds.includes(ID('a')) && p.cardIds.includes(ID('b')), '锚点 id 正确取出')
  eq(p.counts.userRegions, 1, '1 处用户区')
  eq(p.counts.modelRegions, 1, '1 处模型区')
  eq(p.cards[0].hasUserRegion, true, '卡片甲有用户区')
  eq(p.cards[1].hasUserRegion, false, '卡片乙无用户区')
  eq(p.ok, true, '合法页面解析无误（ok=true）')
  eq(p.version, 'wb_contract_v1', '适配器版本标识')
  // 状态缺省 = current（与检索侧 isCurrentPre 口径一致）
  eq(p.cards[0].status, 'current', '缺 status ⇒ current（与 isCurrentPre 口径一致）')
  const withStatus = parseWhiteboardPre('### 卡\n<!-- memory:' + ID('c') + ' -->\nstatus=superseded', { kind: 'plan' })
  eq(withStatus.cards[0].status, 'superseded', 'status=superseded 被识别')
  // 锚点正则与 L0 抽取一致
  ok(WB_ANCHOR_RE_V1.test('<!-- memory:' + ID('d') + ' -->'), '锚点正则命中合法形态')
  ok(!WB_ANCHOR_RE_V1.test('<!-- memory:mem_XYZ -->'), '锚点正则拒绝非法形态')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[WB-2] 锚点契约（A8 预授权默认值）：内容寻址 id —— 重排不变、改名即变、跨工作区即变')
{
  const a = computeWhiteboardCardIdPre('D:\\ws-a', 'handoff/PLAN.md', '卡片甲')
  const b = computeWhiteboardCardIdPre('D:\\ws-a', 'handoff/PLAN.md', '卡片甲')
  eq(a, b, '同输入同 id（确定性）')
  ok(/^mem_[0-9a-f]{32}$/.test(a), 'id 形态 = mem_ + 32 位小写十六进制')
  ok(computeWhiteboardCardIdPre('D:\\ws-a', 'handoff/PLAN.md', '卡片乙') !== a, '改标题 ⇒ 新 id（旧 id 走 supersede 留痕）')
  ok(computeWhiteboardCardIdPre('D:\\ws-b', 'handoff/PLAN.md', '卡片甲') !== a, '换工作区 ⇒ 新 id')
  ok(computeWhiteboardCardIdPre('D:\\ws-a', 'handoff/OTHER.md', '卡片甲') !== a, '换页面路径 ⇒ 新 id')
  // 重排不变：同一组卡片换顺序，id 集合不变（这正是"移动卡不影响 id"的落地证据）
  const pageA = '### 甲\n<!-- memory:' + a + ' -->\n### 乙\n<!-- memory:' + ID('e') + ' -->'
  const pageB = '### 乙\n<!-- memory:' + ID('e') + ' -->\n### 甲\n<!-- memory:' + a + ' -->'
  const idsA = parseWhiteboardPre(pageA).cardIds.slice().sort().join(',')
  const idsB = parseWhiteboardPre(pageB).cardIds.slice().sort().join(',')
  eq(idsA, idsB, '卡片重排后 id 集合不变')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-8] 丢卡保护：删卡无归档 → 拒写；合法归档 / 合法改名 → 放行')
{
  const before = [ID('a'), ID('b'), ID('c')]
  // ① 直接删一张 → 必须拒
  const r1 = validateMutationBoundaryPre({ target: 'plan', beforeIds: before, afterIds: [ID('a'), ID('b')], protectedRegions: [], afterProtectedRegions: [] })
  eq(r1.ok, false, '★删卡且无归档 → 拒写')
  eq(r1.gate, 'mutation', 'gate=mutation')
  eq(r1.hard.find((h) => h.id === 'M1').pass, false, 'M1 报红')
  ok(r1.report.unarchived.includes(ID('c')), '差异清单点名了消失的那张卡')
  ok(mutationRefusalTextPre(r1).includes(ID('c')), '拒绝文案含具体卡片 id（模型据此可修）')
  ok(mutationRefusalTextPre(r1).includes('原文件未改动'), '拒绝文案明确"原文件未改动"')

  // ② 显式归档 → 放行（"消失"的合法形态）
  const r2 = validateMutationBoundaryPre({ target: 'plan', beforeIds: before, afterIds: [ID('a'), ID('b')], archivedIds: [ID('c')], protectedRegions: [], afterProtectedRegions: [] })
  eq(r2.ok, true, '显式归档 1 张 → 放行（契约 §4 允许的"消失"）')
  // 注意 `archived` = 本次声明的归档集合；`newlyArchived` = 其中**此前不在 before 集合里**的
  // （即"归档了一个本来就没有的 id"，属于可疑输入，不是正常留痕）。
  ok(r2.report.archived.includes(ID('c')), '归档记录被登记（留痕）')
  eq(r2.report.newlyArchived.length, 0, '被归档的 id 确实来自 before 集合（不是凭空归档一个不存在的 id）')

  // ③ 合法改名 = 旧 id 归档 + 新 id 出现
  const r3 = validateMutationBoundaryPre({
    target: 'plan', beforeIds: before, afterIds: [ID('a'), ID('b'), ID('f')],
    archivedIds: [ID('c')], protectedRegions: [], afterProtectedRegions: [],
  })
  eq(r3.ok, true, '改名（旧 id 归档 + 新 id 出现）→ 放行')

  // ④ 加卡 / 移动 / 改正文 —— 都不得被拦
  const r4 = validateMutationBoundaryPre({ target: 'plan', beforeIds: before, afterIds: before.concat([ID('9')]), protectedRegions: [], afterProtectedRegions: [] })
  eq(r4.ok, true, '加卡 → 放行')
  const r5 = validateMutationBoundaryPre({ target: 'plan', beforeIds: before, afterIds: [ID('c'), ID('b'), ID('a')], protectedRegions: [], afterProtectedRegions: [] })
  eq(r5.ok, true, '重排 → 放行（顺序无关）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-8] 用户区保护（B4 预授权默认值）：模型整篇重写必须原样带回用户段')
{
  const pageV1 = ['### 甲', '<!-- memory:' + ID('a') + ' -->', M.userOpen, '用户备注：绝不能被模型改掉。', M.userClose].join('\n')
  const pB = parseWhiteboardPre(pageV1)
  const prot = extractProtectedRegionsPre(pB)
  eq(prot.length, 1, '抽到 1 处受保护区域')
  eq(prot[0].key, 'user:' + ID('a'), '保护键 = user:<cardId>')
  eq(prot[0].digest, protectedRegionDigestPre('用户备注：绝不能被模型改掉。'), '摘要算法与公共实现一致')

  // ① 原样带回 → 放行
  const keep = [M.modelOpen, '模型新写的状态。', M.modelClose, M.userOpen, '用户备注：绝不能被模型改掉。', M.userClose].join('\n')
  const pageV2 = '### 甲\n<!-- memory:' + ID('a') + ' -->\n' + keep
  const pA = parseWhiteboardPre(pageV2)
  const r1 = validateMutationBoundaryPre({
    target: 'plan', beforeIds: pB.cardIds, afterIds: pA.cardIds,
    protectedRegions: prot, afterProtectedRegions: extractProtectedRegionsPre(pA),
  })
  eq(r1.ok, true, '用户段原样带回 → 放行')
  eq(r1.report.protectedOk, 1, '保护账：1 处通过')

  // ② 整篇重写把用户段吞掉 → 拒
  const pageLost = '### 甲\n<!-- memory:' + ID('a') + ' -->\n' + M.modelOpen + '\n只写了模型区。\n' + M.modelClose
  const pLost = parseWhiteboardPre(pageLost)
  const r2 = validateMutationBoundaryPre({
    target: 'plan', beforeIds: pB.cardIds, afterIds: pLost.cardIds,
    protectedRegions: prot, afterProtectedRegions: extractProtectedRegionsPre(pLost),
  })
  eq(r2.ok, false, '★用户段被吞掉 → 拒写')
  eq(r2.hard.find((h) => h.id === 'M2').pass, false, 'M2 报红')
  ok(r2.report.protectedLost.includes('user:' + ID('a')), '差异清单点名丢失的用户区')

  // ③ 用户段被改动（哪怕改一个字）→ 拒
  const pageMod = [M.userOpen, '用户备注：被模型改掉了一个字。', M.userClose].join('\n')
  const pageV3 = '### 甲\n<!-- memory:' + ID('a') + ' -->\n' + pageMod
  const pMod = parseWhiteboardPre(pageV3)
  const r3 = validateMutationBoundaryPre({
    target: 'plan', beforeIds: pB.cardIds, afterIds: pMod.cardIds,
    protectedRegions: prot, afterProtectedRegions: extractProtectedRegionsPre(pMod),
  })
  eq(r3.ok, false, '★用户段被改动 → 拒写（逐字节保留）')
  ok(r3.report.protectedModified.includes('user:' + ID('a')), '差异清单点名被改动的用户区')

  // ④ 省略 afterProtectedRegions = fail closed（"忘了传"与"真的丢了"同处理）
  const r4 = validateMutationBoundaryPre({ target: 'plan', beforeIds: pB.cardIds, afterIds: pMod.cardIds, protectedRegions: prot })
  eq(r4.ok, false, '★未提供写入后保护摘要 → fail closed 拒写（不默认通过）')
  ok(r4.hard.find((h) => h.id === 'M2').detail.includes('fail closed'), '拒绝理由写明 fail closed 的原因')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-8] 重复 id 保护：同一 id 指两个卡片 → 拒')
{
  const r = validateMutationBoundaryPre({ target: 'plan', beforeIds: [], afterIds: [ID('a'), ID('a')], protectedRegions: [], afterProtectedRegions: [] })
  eq(r.ok, false, '同一 id 出现两次 → 拒写')
  eq(r.hard.find((h) => h.id === 'M3').pass, false, 'M3 报红')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-8C] ★质量门关闭后仍拒绝丢卡（ROUND3 §3.7 第 4 条：开关不能撤掉共同保护）')
{
  const before = [ID('a'), ID('b')]
  for (const strict of [true, false]) {
    const r = validateMutationBoundaryPre({
      target: 'plan', strict, beforeIds: before, afterIds: [ID('a')],
      protectedRegions: [{ key: 'user:' + ID('a'), digest: 'x' }], afterProtectedRegions: [],
    })
    eq(r.ok, false, 'strict=' + strict + '：criteriaGate 关闭（strict=false）仍拒丢卡')
    eq(r.hard.find((h) => h.id === 'M1').pass, false, 'strict=' + strict + '：M1 仍报红')
    eq(r.hard.find((h) => h.id === 'M2').pass, false, 'strict=' + strict + '：M2 仍报红')
    ok(r.soft.some((s) => s.id === 'S-strict-off') === !strict, 'strict=' + strict + '：只有软项受 strict 影响')
  }
  // 三个开关名逐个验证：M1/M2/M3 **任何输入组合下**都不受 strict/criteriaGate 影响
  const cases = [
    { strict: false, criteriaGate: false },
    { strict: false },
    { strict: true },
  ]
  const allReject = cases.every((c) => validateMutationBoundaryPre({
    target: 'plan', ...c, beforeIds: [ID('a')], afterIds: [], protectedRegions: [], afterProtectedRegions: [],
  }).ok === false)
  ok(allReject, '三种开关组合下，空 after 集合一律被拒（保护无条件）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[判据] 账本用 H1–H4（不能套给 PLAN）；PLAN 用 P-H1/P-H2/P-S1（刻意最弱）')
{
  // ⚠️ 每段必须 ≥20 字符（H2 阈值）。首版 fixture 有两段只有 17/19 字符 ⇒ 我自己的"合格账本"
  //    没过 H2，是**测试期望写错**而非实现错（这类失败必须查清方向再改，不能反向放宽阈值）。
  const goodLedger = [
    '## 任务状态', '状态一句话：P0 前三步已完成，全量回归 82 套件全绿。',
    '## 目标', '目标：完成 P0 五步并通过全量回归，交给 GPT 验收。',
    '## 已试方案与失败原因', '方案甲→失败原因：报错 EPERM；方案乙→成功。',
    '## 进度与下一步', '下一步：跑 `node tools/run-smoke.mjs` 并核对 82 套件。',
  ].join('\n')
  const g = checkHandoffCriteriaPre(goodLedger)
  eq(g.ok, true, '合格账本过 H1–H4')
  eq(g.target, 'handoff', 'target=handoff')
  ok(g.soft.find((s) => s.id === 'S2').pass, 'S2：失败项写成「方案→失败原因」且带报错词 → 通过')
  ok(g.soft.find((s) => s.id === 'S3').pass, 'S3：下一步含可执行特征（反引号命令）→ 通过')

  // H1 缺段
  const miss = checkHandoffCriteriaPre('## 任务状态\n够长的内容。\n## 目标\n够长的内容。')
  eq(miss.ok, false, '缺四段 → H1 报红')
  ok(miss.hard.find((h) => h.id === 'H1').missing.includes('已试方案与失败原因'), 'H1 点名缺失的段')
  ok(criteriaRefusalTextPre(miss).includes('已试方案与失败原因'), '拒绝文案列出缺失段（可执行）')

  // H2 空段
  const TARGET_LINE = '目标：完成 P0 五步并通过全量回归，交给 GPT 验收。'
  const empty = checkHandoffCriteriaPre(goodLedger.replace(TARGET_LINE, '短'))
  eq(empty.ok, false, '段内容过短 → H2 报红')

  // H3 纯占位符
  const ph = checkHandoffCriteriaPre(goodLedger.replace(TARGET_LINE, '(待补充)'))
  eq(ph.ok, false, '段只有占位符 → H3 报红')

  // H4 超长
  const huge = checkHandoffCriteriaPre(goodLedger + '\n' + 'x'.repeat(9000))
  eq(huge.ok, false, '超 8000 字符 → H4 报红')

  // 四段标题必须逐字
  eq(HANDOFF_REQUIRED_SECTIONS_V1.length, 4, '四段标题共 4 条（与 handoff-anchor-pre 权重表同源）')
  const wrongTitle = checkHandoffCriteriaPre(goodLedger.replace('## 已试方案与失败原因', '## 失败的尝试'))
  eq(wrongTitle.ok, false, '标题不逐字匹配 → H1 报红')

  // ── PLAN 判据（刻意最弱；**不能**用账本判据） ──
  const planOk = checkPlanCriteriaPre('# 全貌\n\n## 这是什么\n' + 'x'.repeat(30) + '\n\n## 下一步\n做某事。')
  eq(planOk.ok, true, 'PLAN 有非空顶层节 → 过 P-H1')
  ok(planOk.soft.find((s) => s.id === 'P-S1').pass, 'P-S1：含前瞻内容')
  const planBad = checkPlanCriteriaPre('# 全貌\n\n## 空节\n')
  eq(planBad.ok, false, '★PLAN 无非空顶层节（空白板形态）→ P-H1 报红')
  // 关键鉴别力：**账本判据套给 PLAN 会误拒** —— 反过来正是 v2 修正要防的
  const ledgerGateOnPlan = checkHandoffCriteriaPre('# 全貌\n\n## 这是什么\n' + 'x'.repeat(30))
  eq(ledgerGateOnPlan.ok, false, '★（反证）账本判据套给 PLAN 会拒 —— 所以判据不能张冠李戴')
  eq(planOk.ok, true, '而 PLAN 自己的判据放行同一内容（判据归属正确）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-8B] ★三条写入路径都不能绕过共同保护（源码接线守卫）')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const code = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 三条路径：① 工具层 memory_note（kind=plan/handoff）② 水位骨架直调 ③ 刷新仪式产物
  ok(/async writePlanSnapshot\(projectDir, content, opts\) \{/.test(code), '① writePlanSnapshot 是唯一白板入口（带 opts）')
  ok(/async writeHandoffLedger\(projectDir, content, opts\) \{/.test(code), '② writeHandoffLedger 是唯一账本入口（带 opts）')
  const planFn = code.slice(code.indexOf('async writePlanSnapshot(projectDir, content, opts) {'), code.indexOf('async writeHandoffLedger(projectDir, content, opts) {'))
  const ledgerFn = code.slice(code.indexOf('async writeHandoffLedger(projectDir, content, opts) {'), code.indexOf('async listHandoffLedgers('))
  ok(/this\.checkMutationPre\(\{/.test(planFn), 'writePlanSnapshot 内部过 checkMutationPre（工具/仪式路径都被覆盖）')
  ok(/this\.checkMutationPre\(\{/.test(ledgerFn), 'writeHandoffLedger 内部过 checkMutationPre（水位骨架直调路径也被覆盖）')
  ok(/if \(!gate\.ok\) return \{ ok: false/.test(planFn) && /if \(!gate\.ok\) return \{ ok: false/.test(ledgerFn),
    '门不过 ⇒ 两个入口都**在写盘之前**返回失败（字节不变）')
  // 水位骨架：只跳过判据门，**绝不**跳过保护门
  const wl = code.slice(code.indexOf('water level auto-handoff skipped criteria gate'), code.indexOf('water level auto-handoff skipped criteria gate') + 1200)
  ok(/skipCriteria: true/.test(wl), '水位骨架降级路径显式传 skipCriteria: true（只跳质量门）')
  ok(/gate === 'mutation'/.test(wl) && /not bypassed/.test(wl), '★水位骨架遇保护门拒绝时**不绕过**并留痕')
  // checkMutationPre 内部：skipCriteria 只影响判据门
  const gateFn = code.slice(code.indexOf('checkMutationPre(input = {}) {'), code.indexOf('checkMutationPre(input = {}) {') + 3600)
  ok(/if \(this\.config\.criteriaGate !== false && !\(o\.skipCriteria\)\) \{/.test(gateFn), 'skipCriteria 与 criteriaGate 只作用于判据门')
  ok(/validateMutationBoundaryPre\(\{/.test(gateFn), '保护门在同一函数内被调用（无法只走质量门）')
  ok(!/skipCriteria/.test(gateFn.slice(gateFn.indexOf('validateMutationBoundaryPre({'))), '保护门调用处**没有** skipCriteria 之类旁路参数')
  // 工具层拒绝文案：必须把可执行指引交给模型
  ok(/if \(r && r\.gate === 'mutation'\) return 'memory_note: ' \+ detail/.test(code)
    || /r\.gate === 'mutation'\) return/.test(code), '工具层对保护门拒绝返回**原始可执行文案**（不是"未知"）')
  // 配置项存在且默认开
  ok(/criteriaGate: true/.test(code), '默认配置含 criteriaGate: true（质量门默认开）')
  ok(/import \{ validateMutationBoundaryPre, mutationRefusalTextPre \} from '\.\/memory-mutation(?:-pre)?\.js'/.test(idx),
    'index.js 导入共同保护门（不是本地复写一份）')
  ok(/from '\.\/wb-contract(?:-pre)?\.js'/.test(idx), 'index.js 导入白板适配器')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[边界] 职责不混：保护门不解释白板格式；适配器不做接受/拒绝判定')
{
  const mut = readFileSync(new URL('../../lib/memory-mutation.js', import.meta.url), 'utf8')
  const mutCode = mut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/###|<!--\s*model|<!--\s*user|memory:mem_/.test(mutCode),
    '★保护门内**没有**任何白板格式知识（### / 分区标记 / 锚点），只处理规范化投影')
  ok(!/from '\.\/wb-contract(?:-pre)?\.js'/.test(mutCode), '保护门不反向依赖白板适配器（避免职责环）')
  const wb = readFileSync(new URL('../../lib/wb-contract.js', import.meta.url), 'utf8')
  const wbCode = wb.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/validateMutationBoundaryPre/.test(wbCode), '适配器不调用保护门（判定权归保护门）')
  ok(/export function parseWhiteboardPre/.test(wb), '适配器导出 parseWhiteboardPre（唯一格式真源）')
  ok(/export function checkHandoffCriteriaPre|export function checkPlanCriteriaPre/.test(wb),
    '判据门与格式同处一个模块（格式只维护一份）')
  // toMutationProjectionPre 是两者的唯一桥
  const proj = toMutationProjectionPre(parseWhiteboardPre('### 甲\n<!-- memory:' + ID('a') + ' -->'))
  ok(Array.isArray(proj.afterIds) && proj.afterIds.length === 1, '适配器产物就是保护门要的规范化投影形状')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[卫生] 无 BOM / S9 / 版本与原因码')
{
  for (const p of ['../../lib/memory-mutation.js', '../../lib/wb-contract.js', '../../lib/index.js']) {
    const raw = readFileSync(new URL(p, import.meta.url))
    ok(!(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF), '无 BOM：' + p.split('/').pop())
  }
  for (const p of ['../../lib/memory-mutation.js', '../../lib/wb-contract.js']) {
    const code = readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    ok(!/\bfetch\s*\(|openai|chat\/completions/i.test(code), 'S9 无网络/无 LLM：' + p.split('/').pop())
    ok(!/child_process|spawnSync|execSync/.test(code), 'S9 无子进程：' + p.split('/').pop())
    ok(!/\bawait\b/.test(code), 'S9 全同步：' + p.split('/').pop())
    ok(!/\bfs\.|readFileSync\(|writeFileSync\(/.test(code), '零 IO：' + p.split('/').pop())
  }
  eq(MEMORY_MUTATION_VERSION, 'memory_mutation_v1', '保护门版本标识')
  for (const k of Object.keys(MUTATION_REASONS_V1)) {
    ok(typeof MUTATION_REASONS_V1[k] === 'string' && MUTATION_REASONS_V1[k].length > 0, '原因码有可读中文：' + k)
  }
  // 确定性
  const mk = () => JSON.stringify(validateMutationBoundaryPre({ target: 'plan', beforeIds: [ID('a')], afterIds: [ID('a')], protectedRegions: [], afterProtectedRegions: [] }))
  eq(mk(), mk(), '保护门同输入同输出（纯函数）')
}

console.log('\n[t0-8-mutation-gate-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
