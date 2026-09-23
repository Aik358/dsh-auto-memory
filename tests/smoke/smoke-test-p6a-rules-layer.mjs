/**
 * 冒烟套件：P6A —— 注入表达与节奏（2026-09-14 · P0 第五步）。
 *
 * **用户最痛的病**（用户原话）：
 *   > 「这个 just for reference 说得太轻了，模型注意力没有在这上面。」
 *   > 「模型自动唤起的记忆，并没有对模型的工作起到比较实质性的影响。」
 *
 * **两条独立病因**（都有代码行号，都不许混为一谈）：
 *   A. **措辞**：注入开场白把"规矩"与"资料"统一降格为「只是背景事实与规则参考」。
 *   B. **节奏**：`snapshotMinGapRounds` 默认 5 ⇒ 规矩在第 2–5 轮**不在场**（模型不是不听话，是没收到）。
 *
 * **v2 修正，本套件逐条锁**（`ROUND3 §3.3 Q3c`）：
 *   - 节奏部分**改默认值不够**：已保存配置会覆盖默认值（`{ ...DEFAULT_CONFIG, ...saved }`）；
 *   - `Number(v) || 5` 让 **0 无法表达** ⇒ 必须修零值解析；
 *   - 旧节流分支**提前返回会跳过本轮动态快照** ⇒ 必须"**先提供规则段，再对参考内容应用 gap**"；
 *   - **T7-1 不能只测注入块存在**，"局部注入块存在"≠"模型真收到了"（但最终 messages 需要宿主 U6，
 *      故本套件在能测的范围内测**注入函数的返回值**，并把 U6 依赖如实标注）；
 *   - **T7-7**：仅引导语不同**不能**判"遵守问题已解决"——必须有**可机械判断的执行结果**断言。
 *
 * 只读、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import {
  extractRulesLayerPre,
  renderRulesSectionPre,
  splitMemoryEntriesPre,
  firstLine,
  RULES_SECTION_TITLE_PRE_V1,
  RULES_SECTION_GUIDE_PRE_V1,
  REFERENCE_SECTION_GUIDE_PRE_V1,
  RULES_LAYER_VERSION,
  RULE_MARKERS_PRE_V1,
  RULE_CONSTRAINT_WORDS_PRE_V1,
  RULE_DESCRIPTION_MARKERS_PRE_V1,
} from '../../lib/rules-layer.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const ID = (c) => 'mem_' + c.repeat(32)
const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const RULES_SRC = readFileSync(new URL('../../lib/rules-layer.js', import.meta.url), 'utf8')

// 真实形态的用户级记忆（结构与本机 ~/.dsh/memory/MEMORY.md 一致：锚点 + 日期小节）
const USER_MEM = [
  `<!-- memory:${ID('a')} -->`,
  '## 2026-08-14',
  '【用户硬性规则 - 文件编码】写/改任何文件时严禁引入 UTF-8 BOM（EF BB BF）。',
  '',
  `<!-- memory:${ID('b')} -->`,
  '## 2026-08-16',
  '发布节奏偏好：UI 改动先在本地联调，除非用户明确要求，否则不要发布 npm。',
  '',
  `<!-- memory:${ID('d')} -->`,
  '## 2026-08-20',
  '提交前必须跑全量回归，不得只跑受影响的那几个套件。',
  '',
  `<!-- memory:${ID('c')} -->`,
  '## 2026-09-01',
  '据文档写着必须重启才算生效，但该要求已取消。',
  '',
].join('\n')

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-1] 规则 vs 参考：分层抽取（真源 = 既有用户级记忆，不新增 RULES.md）')
{
  const layer = extractRulesLayerPre({ userText: USER_MEM, rulesLayeringMode: 'self' })
  ok(layer.enabled === true, '开启时 enabled=true')
  eq(layer.counts.entries, 4, '按锚点切成 4 条')
  ok(layer.counts.rules >= 2, '认出 ≥2 条规则（结构化前缀那条 + 约束语汇那条）')
  const high = layer.rules.find((r) => r.confidence === 'high')
  ok(!!high, '【用户硬性规则…】被判为**高置信**规则')
  ok(high.reasons.join('').includes('结构化前缀'), '高置信的理由是结构化前缀（可审计）')
  const medium = layer.rules.find((r) => r.confidence === 'medium')
  ok(!!medium, '「必须/不得」这类约束语汇判为中置信规则')
  ok(medium.text.includes('跑全量回归'), '中置信那条正是"提交前必须跑全量回归"')
  // 发布节奏那条既无前缀也无约束语汇（"不要发布"不在约束语汇表里）⇒ 参考类
  ok(layer.references.some((r) => r.text.includes('发布节奏')), '无规则标记的条目归**参考类**（不硬塞进规则）')
  eq(layer.candidates.length, 1, '含"必须"但带引用/历史语境的那条 → 待确认候选')
  // ⚠️ 防御式取值：变异演示时 `candidates` 会变空，若直接 `candidates[0].confidence` 会抛 TypeError
  // 让整套件崩掉、只剩一条红报告（实测踩到）。断言必须能在被测逻辑被改坏时**继续跑完并逐条报红**，
  // 否则"能红"就退化成"能崩"，看不到完整差异面。
  const cand0 = layer.candidates[0] || {}
  eq(cand0.confidence, 'low', '候选的置信度是 low（不冒充规则）')
  ok(String(cand0.reasons || '').includes('引用/历史语境') || (cand0.reasons || []).join('').includes('引用/历史语境'),
    '候选理由写明为什么不算规则')
  // 口径边界：「不要发布」**不**算约束语汇（表里是「不要再」）—— 记录这个刻意的保守取向
  ok(!RULE_CONSTRAINT_WORDS_PRE_V1.includes('不要'), '约束语汇表刻意不含宽泛的「不要」（避免把偏好描述误升为规则）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-2] ★T7-4 修订（v2 纠正我方原设计）：描述性"必须"不得自动升级为规则')
{
  // GPT 给的两个反例，逐条锁死
  const r1 = extractRulesLayerPre({ userText: '<!-- memory:' + ID('d') + ' -->\n据文档写着必须重启。', rulesLayeringMode: 'self' })
  eq(r1.counts.rules, 0, '反例①「据文档写着必须重启」→ 不进规则层')
  eq(r1.counts.candidates, 1, '而是进待确认候选')
  const r2 = extractRulesLayerPre({ userText: '<!-- memory:' + ID('e') + ' -->\n曾经要求必须 X 但已取消。', rulesLayeringMode: 'self' })
  eq(r2.counts.rules, 0, '反例②「曾经要求必须 X 但已取消」→ 不进规则层')
  eq(r2.counts.candidates, 1, '同上进候选')
  // 反面：真正的规则必须进（否则"防误报"就变成了"什么都不认"）
  const r3 = extractRulesLayerPre({ userText: '<!-- memory:' + ID('f') + ' -->\n【必须遵守】提交前必须跑全量回归。', rulesLayeringMode: 'self' })
  eq(r3.counts.rules, 1, '★反面：真规则仍进规则层（判据有鉴别力，不是恒空）')
  ok(RULE_DESCRIPTION_MARKERS_PRE_V1.length >= 5, '引用/历史语境标记表存在（' + RULE_DESCRIPTION_MARKERS_PRE_V1.length + ' 条）')
  ok(RULE_MARKERS_PRE_V1.includes('【用户硬性规则'), '结构化前缀表含本机真实形态')
  ok(RULE_CONSTRAINT_WORDS_PRE_V1.includes('严禁'), '约束语汇表含「严禁」')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-3] ★T7-3 措辞分层：规则类用约束语，参考类保留"参考"语义，两者引导语**必须不同**')
{
  eq(RULES_SECTION_GUIDE_PRE_V1 === REFERENCE_SECTION_GUIDE_PRE_V1, false, '★两段引导语不相同（防止改回统一措辞）')
  ok(/必须|约束|不是可选/.test(RULES_SECTION_GUIDE_PRE_V1), '规则段引导语含约束语（"必须"/"约束"）')
  ok(/参考/.test(REFERENCE_SECTION_GUIDE_PRE_V1), '参考段引导语保留"参考"语义')
  ok(!/参考/.test(RULES_SECTION_GUIDE_PRE_V1), '★规则段引导语里**没有**"参考"二字（这正是要修的病）')
  ok(/\u5fc5\u987b\u9075\u5b88/.test(RULES_SECTION_TITLE_PRE_V1), '规则段标题含"必须遵守"（醒目）')

  const layer = extractRulesLayerPre({ userText: USER_MEM, rulesLayeringMode: 'self' })
  const sec = renderRulesSectionPre(layer)
  ok(sec.text.includes(RULES_SECTION_TITLE_PRE_V1), '渲染出的规则段带标题')
  ok(sec.text.includes(RULES_SECTION_GUIDE_PRE_V1), '渲染出的规则段带约束语引导语')
  ok(!sec.text.includes('发布节奏'), '规则段**不含**参考类内容（分层是真分层，不是全塞进来）')
  eq(sec.chars, sec.text.length, '规则段长度自报口径 = 实际长度')

  // 旧开场白（病因 A）仍在，但**只描述参考类**——断言它不再声称"规则只是参考"
  const headM = /snapshotHead: '([^']*)'/.exec(SRC)
  ok(!!headM, '定位到 snapshotHead 默认文案')
  const head = headM[1]
  ok(/背景事实与规则参考|参考/.test(head), '开场白保留"参考"语义（用于参考类）')
  // 关键：规则段与开场白是**两段不同措辞**，规则不再靠开场白承载体面
  ok(RULES_SECTION_GUIDE_PRE_V1 !== head, '规则段引导语 ≠ 开场白（分层落地）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-4] ★零值解析：0 必须能表达（旧 `Number(v) || 5` 把 0 吞成 5）')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const m = /export function parseGapRoundsPre\(value, fallback = 1\) \{([\s\S]*?)\n\}/.exec(idx)
  ok(!!m, '定位到 parseGapRoundsPre 实现')
  const fn = new Function('value', 'fallback', m[1].replace(/fallback/g, 'fallback'))
  const parse = (v, f = 1) => fn(v, f)
  eq(parse(0), 0, '★0 → 0（合法值，旧实现会给 5）')
  eq(parse('0'), 0, '字符串 "0" → 0')
  eq(parse(3), 3, '3 → 3')
  eq(parse(5), 5, '5 → 5')
  eq(parse(1), 1, '1 → 1')
  eq(parse(undefined, 1), 1, 'undefined → 回退默认（不是 0）')
  eq(parse(null, 1), 1, 'null → 回退默认')
  eq(parse('', 1), 1, '空串 → 回退默认')
  eq(parse('abc', 1), 1, '非数值 → 回退默认')
  eq(parse(NaN, 1), 1, 'NaN → 回退默认')
  eq(parse(-3, 1), 1, '负数 → 回退默认（不把负间隔当合法）')
  eq(parse(2.7), 2, '小数向下取整')
  eq(parse(99999), 1000, '超大值被钳到 1000（防配置写错导致永不注入）')
  // 旧写法必须已从注入路径消失
  const code = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/Number\(engine\.config\.snapshotMinGapRounds\) \|\| 5/.test(code), '★旧 `Number(v) || 5` 已从注入路径移除')
  ok(/parseGapRoundsPre\(engine\.config\.snapshotMinGapRounds, 5\)/.test(code), '注入路径改用 parseGapRoundsPre')
  // ★2026-09-15 分级注入：默认值回到 5，但它现在是「**完整版**每 5 轮一次」的间隔
  //（其间各轮给精简版）——不再是"5 轮不注入"。
  ok(/snapshotMinGapRounds: 5,/.test(code), '★默认值 = 完整快照每 5 轮一次（其间给精简版，不是不注入）')
  ok(/injectBudgetChars: 8000,/.test(code), '★注入预算默认 8000（旧 2000 下用户级记忆只进去约 9%）')
  ok(/snapshotTieredInject: true,/.test(code), '★分级注入开关默认开（可 false 回退旧行为）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-5] ★分级注入（用户裁定"不是不注入，而是精简注入"）：节流只决定给完整还是精简')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const code = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 旧病灶：节流分支里 `return engine.renderReflectionRequest()`（整份快照被跳过 ⇒ 规则与索引也不在场）
  ok(!/st\._snapPendingSnap = snap\s*\n\s*st\._snapPendingLogFp = logFp\s*\n\s*return engine\.renderReflectionRequest\(\)/.test(code),
    '★旧的"节流即跳过整份快照"已被移除')
  ok(/return slimText \+ engine\.renderReflectionRequest\(\)/.test(code),
    '★节流分支改为返回**精简版**（规则 + 索引 + 日程都在场）')
  ok(/const slimText = engine\.config\.snapshotTieredInject === false \? '' : engine\.renderSlimSnapshotPre\([^)]*\)/.test(code),
    '注入调用方取精简版，且开关可一键回退')
  // ★2026-09-15：签名由 `renderSlimSnapshotPre()` 变为 `renderSlimSnapshotPre(wsHint)`（首轮工作区兜底）。
  // 这里**不写死参数表**——用 `[^)]*` 容忍后续参数演进，避免签名一变就让本套件切片落空而假失败。
  ok(/renderSlimSnapshotPre\([^)]*\) \{/.test(code), '引擎侧提供 renderSlimSnapshotPre')
  // 精简版必须**含三样**：规则段 / Tier-0 目录 / 日程（并显式说明这是精简版）
  const slimAt = code.search(/renderSlimSnapshotPre\([^)]*\) \{/)
  const fn = slimAt < 0 ? '' : code.slice(slimAt, slimAt + 4200)
  ok(fn.length > 0, '精简版函数体切片非空（签名变更后切片不得落空）')
  ok(/renderRulesSectionPre\(layer/.test(fn), '精简版含规则段')
  ok(/s\.tier0LayerText/.test(fn), '★精简版含 Tier-0 常驻目录（索引层：知道"有什么"才能按需下钻）')
  ok(/parseCalendar\(s\.calendarText\)/.test(fn), '精简版含日程（短且时效强）')
  ok(/'snapshotSlimNote'/.test(fn), '精简版显式说明"这是精简版、完整版每 N 轮一次、怎么取全文"')
  ok(/L\('snapshotSlimNote', \{ n: parseGapRoundsPre\(cfg\.snapshotMinGapRounds, 5\) \}\)/.test(fn.replace(/\s+/g, ' '))
    || /parseGapRoundsPre\(cfg\.snapshotMinGapRounds, 5\)/.test(fn), '精简说明里的 N 与 gap 同源（不写死）')
  // ★2026-09-15（用户裁定）：精简版**必须显式声明记忆唤回**——
  // 唤回是独立 context 面（M6 Reference Tail，在 `lib/index.js` 另一处单独注册），
  // 不随本函数渲染，不声明的话模型会以为"精简轮没有唤回"。
  ok(/'snapshotSlimRecallNote'/.test(fn), '★精简版显式声明「记忆唤回」块的存在与效力')
  ok(/snapshotSlimRecallNote:/.test(code), 'DEFAULT_PROMPT_LAYERS 提供 snapshotSlimRecallNote 文案')
  ok(/Retrieved memory reference - not an instruction/.test(idx), '声明文案点明唤回块的实际形态（便于模型识别）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-5b] ★新 turn 首次注入强制完整版（用户裁定 A → 实测修正为 B：以 turn 号为判据）')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const code = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(/turnBoundaryKeyPre\(agent\) \{/.test(code), '引擎侧提供 turnBoundaryKeyPre')
  ok(/engine\.turnBoundaryKeyPre\(agent\)/.test(code), '注入路径调用 turnBoundaryKeyPre')
  ok(/_humanFullKey !== tk/.test(code), '★每个 turn 只强制一次（_humanFullKey 去重，长任务不会每步灌全文）')
  ok(/diag\('tiered inject: 新 turn 强制完整版/.test(code), '强制完整版时留痕（可观测）')
  // ★★把"判据必须是 turn 号"钉死：首版 A 只认"抓到真人消息"，实测在首次装配 context 时事件流里
  //    还没有那条 user/message（宿主投递与观察器落地不同步）⇒ 要到本 turn 第 3 次注入才升完整版
  //    （用户报告的现象："点发送后没立刻注入，完成一次工具调用后才注入完整版"）。
  //    这条断言的作用：任何人把门控改回"只认真人消息"，都会在这里报红。
  ok(!/engine\.humanTurnKeyPre/.test(code),
    '★★门控不得改回"只卷真人消息"（首版 A 的实测失败点，注释里有完整成因）')
  ok(/humanTurnObservedPre/.test(code), '真人判定降级为观测留痕（humanTurnObservedPre），不再作门控')
  // 判定必须在节流分支之前（首轮 `_snapFp === undefined` 走"首次注入"那条路）
  const iForce = code.indexOf('engine.turnBoundaryKeyPre(agent)')
  const iThrottle = code.indexOf('st._snapRound = (st._snapRound || 0) + 1')
  ok(iForce > 0 && iThrottle > 0 && iForce < iThrottle,
    '★强制判定位于节流分支之前（否则首轮永远进不到）')
  // turn 号必须从 `data.turn` 读（首版读 ev.turn 恒 undefined，是已踩过的坑）
  const fnSrc = idx.slice(idx.indexOf('turnBoundaryKeyPre(agent) {'), idx.indexOf('humanTurnObservedPre(agent) {'))
  ok(/ev\.data\.turn/.test(fnSrc), '★turn 号从 event.data 读（顶层没有 turn；首版踩过这个坑）')
  ok(/'turn:' \+ curTurn/.test(fnSrc), '返回稳定的 turn 标识')
  ok(/events\.length - 400/.test(fnSrc), '只扫事件尾部 400 条（不做全量扫描）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-6] ★T7-1（在能测的范围内）：规则在**每一轮**的注入函数返回值里都在')
{
  // 说明：真正的"模型收到了"需要宿主最终 messages（U6，未具备）。本套件测**注入函数的返回值**，
  // 并把这一点如实标注——不把"局部注入块存在"冒充"模型真收到了"（这正是 T7-1 的修正要求）。
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  // 切片只取 `renderSlimSnapshotPre` **一个**方法体：终点是紧随其后的下一个类方法。
  // （2026-09-15 起 `renderSlimSnapshotPre` 与 `renderMemoryDynamic` 之间有两个方法：
  //  `turnBoundaryKeyPre` 与 `humanTurnObservedPre` —— 若仍切到 `renderMemoryDynamic`，
  //  拼进对象字面量会因缺逗号报 `Unexpected identifier`。）
  {
    // ★2026-09-15：签名由 `renderSlimSnapshotPre()` 变为 `renderSlimSnapshotPre(wsHint)`。
    // 用正则容忍参数表演进；若写死旧签名，`indexOf` 返回 -1，切片从 -1 开始 ⇒ 沙箱内 `.call` undefined。
    const m = /renderSlimSnapshotPre\([^)]*\) \{/.exec(idx)
    const start = m ? m.index : -1
    const nextMethod = idx.indexOf('\n  turnBoundaryKeyPre(agent) {')
    const end = nextMethod > start ? nextMethod : idx.indexOf('renderMemoryDynamic(context) {')
    var __fnSrc = start < 0 || end <= start ? '' : idx.slice(start, end) // eslint-disable-line no-var
  }
  const fnSrc = __fnSrc
  // ★2026-09-15：helpers 必须含 `parseGapRoundsPre` —— 精简版里 `snapshotSlimNote` 的 N 由它算，
  // 沙箱缺它会抛 ReferenceError 并被 try/catch 吞成**空串**（症状：本套件 4 条"规则都在"全红，
  // 但函数本身没坏）。教训与 handoff 套件同源：**抽取式测试必须提供被测函数依赖的全部模块级符号**。
  const helpers = ['DEFAULT_PROMPT_LAYERS', 'neutralizePromptTemplateVars', 'parseGapRoundsPre']
  const grab = (name) => {
    const lines = idx.split('\n')
    // 兼容三种声明形态：`const X =` / `function X(`（`neutralizePromptTemplateVars` 是后者）
    let li = lines.findIndex((l) => {
      const t = l.trim()
      return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=')
        || t.startsWith('function ' + name + '(') || t.startsWith('export function ' + name + '(')
    })
    if (li < 0) throw new Error('helper not found: ' + name)
    let buf = '', depth = 0, started = false
    for (; li < lines.length; li++) {
      buf += lines[li] + '\n'
      for (const ch of lines[li]) {
        if (ch === '(' || ch === '{') { depth++; started = true } else if (ch === ')' || ch === '}') depth--
      }
      if (started && depth <= 0) break
    }
    return buf.replace(/^export /gm, '') // ★`parseGapRoundsPre` 是 `export function`：抽进 new Function 前必须剥掉 export（否则 SyntaxError）
  }
  const rulesCode = readFileSync(new URL('../../lib/rules-layer.js', import.meta.url), 'utf8').replace(/^export /gm, '')
  const shell = new Function(helpers.map(grab).join('\n') + '\n' + rulesCode + '\nreturn {' + fnSrc + '};')()
  const renderRulesOnly = shell.renderSlimSnapshotPre

  const fakeThis = (mode) => ({
    state: { userText: USER_MEM, notesText: '' },
    config: { rulesLayeringMode: mode, promptLayerOverrides: {}, snapshotMinGapRounds: 5, dayBoundaryMinutes: 450 },
    // ★2026-09-15：精简版外壳还会调这三个宿主方法（meta 日期行 / 无人值守判定 / 日历解析）。
    // 源码抽取式沙箱里没有它们，不补桩就会整函数抛异常 → catch 返回空串（本套件首跑因此 4 条假红）。
    // 这不是"测试迁就实现"：抽取式测试必须提供被测函数依赖的全部外部符号（同 handoff 套件的先例）。
    memToday: () => '2026-09-15',
    isUnattendedNow: () => false,
    parseCalendar: () => [],
  })
  // 模拟"连续 6 轮"：节流期间调用方调用的就是本函数
  let rounds = 0
  for (let i = 0; i < 6; i++) {
    const out = renderRulesOnly.call(fakeThis('self'))
    if (out.includes('【用户硬性规则')) rounds++
  }
  eq(rounds, 6, '★连续 6 轮，规则都在（T7-1 的目标形态）')
  const out1 = renderRulesOnly.call(fakeThis('self'))
  ok(out1.includes(RULES_SECTION_GUIDE_PRE_V1), '规则段带约束语引导语（不是"只是参考"）')
  ok(out1.startsWith('<memory_system>'), '是完整可注入的块（有固定首行）')
  ok(out1.trimEnd().endsWith('</memory_system>'), '有固定尾行（边界完整）')
  const outOff = renderRulesOnly.call(fakeThis('off'))
  // ★语义变更（2026-09-15 分级注入）：精简版**不再**在 mode=off 时返回空串 ——
  // 它的职责是"每轮给规则 + 索引 + 日程"，其中索引/日程与规则分层开关无关。
  // 回退路径改为 `snapshotTieredInject=false`（注入调用方那侧），不再由本函数返回空串实现。
  ok(!outOff.includes('【用户硬性规则'), 'mode=off ⇒ 不含规则段（规则分层未启用）')
  ok(outOff.includes('精简注入'), 'mode=off 仍给精简版外壳（索引/日程在场，这就是分级注入的意义）')
  const outNone = renderRulesOnly.call({ state: { userText: USER_MEM, notesText: '' }, config: { rulesLayeringMode: 'none', promptLayerOverrides: {}, snapshotMinGapRounds: 5 }, memToday: () => '2026-09-15', isUnattendedNow: () => false, parseCalendar: () => [] })
  ok(!outNone.includes('【用户硬性规则'), 'mode=none ⇒ 也不含规则段（只看工作区级）')

  // T7-6 前缀字节稳定：内容不变时两次调用逐字节相同（缓存友好的前提，**不冒充**缓存命中）
  eq(renderRulesOnly.call(fakeThis('self')), renderRulesOnly.call(fakeThis('self')), 'T7-6：内容不变 ⇒ 前缀字节稳定')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-7] ★T7-7：不能只靠"引导语不同"判"遵守问题已解决" —— 要有可机械判断的执行结果')
{
  // 可机械判断的结果 = 规则段真的进了**最终注入文本**（分项账本的 rules 分项），
  // 且**不受参考类裁剪影响**。这正是"规则不参与裁剪"的唯一可观测证据。
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/pushPart\('rules', 'rules-section', rulesSection\.text\)/.test(idx),
    '规则段以 `rules` 分项进分项账本（不是混在 otherDynamic 里）')
  const budget = readFileSync(new URL('../../lib/memory-envelope.js', import.meta.url), 'utf8')
  ok(/if \(b === 'rules'\) return null/.test(budget), '★分项账本对 rules 恒不设上限（规则不参与裁剪）')
  // 原断言写法偷懒（正则里挂了个无关的 `m2pass` 备选，靠巧合通过）；2026-09-15 把
  // `dropFromTail` 改名 `enforceLimit`（并为优先级丢弃重写）后暴露 ⇒ 改成真断言。
  ok(/enforceLimit\('memoryReferences'\)/.test(budget) && /enforceLimit\('otherDynamic'\)/.test(budget),
    '裁剪只对 memoryReferences / otherDynamic 各执行一次')
  ok(!/enforceLimit\('rules'\)/.test(budget), '★代码里不存在对 rules 的裁剪调用')
  ok(!/dropFromTail\('rules'\)/.test(budget), '历史写法 dropFromTail 也从未指向 rules')
  // 规则段位置在参考内容之前（位置本身是"醒目"的一半，也是 T7-6 前缀稳定的前提）
  // 注意切片起点：`renderSlimSnapshotPre` 定义在 `renderMemoryDynamic` **之前**，
  // 故这里从 `renderMemoryDynamic` 起切到 `renderMemoryStatic`（不能用前者的 indexOf 当起点，
  // 否则切片为空、indexOf 全为 -1 —— 本套件首跑就因为这个假红过一次）。
  const dyn = idx.slice(idx.indexOf('renderMemoryDynamic(context) {'), idx.indexOf('renderMemoryStatic() {'))
  const iRules = dyn.indexOf("pushPart('rules', 'rules-section'")
  const iLogs = dyn.indexOf("'recent-logs'")
  const iNotes = dyn.indexOf("'project-notes'")
  ok(iRules > 0 && iLogs > iRules && iNotes > iRules, '★规则段排在所有参考内容之前（实测位置：' + iRules + ' < ' + iLogs + ' / ' + iNotes + '）')
  ok(iRules < dyn.indexOf("'tier0-catalog'"), '规则段也排在 Tier-0 目录之前（规矩比索引更靠前）')
  // 如实标注依赖边界：最终 messages 需要宿主 U6
  ok(/U6/.test(RULES_SRC) || /U6/.test(idx), '代码/模块注释如实标注"最终请求需 U6，未宣称已保证"')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[P6A-8] 边界与卫生：开关默认关 / 模式非法 fail-soft / 无 BOM / S9')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  // ★2026-09-15 修订：默认值 `off` → **`self`**。
  // 理由（现场实测）：`off` 的语义是"回落旧行为"（规则段完全不渲染），作为**回退开关**正确，
  // 但作为**出厂默认**等于新用户与未设过该键的老用户都拿不到规则段 ——
  // 症状：本机精简版里"规矩"一个字都没有（"规矩每轮在场"做成了"规矩从不出现"）。
  // `off` 仍可显式配置以完全回退。
  ok(/rulesLayeringMode: 'self'/.test(idx), '★开关默认 self（规则段默认渲染；off 仍可显式回退）')
  ok(/snapshotRulesTitle:/.test(idx) && /snapshotRulesGuide:/.test(idx), 'promptLayerOverrides 可覆盖规则段文案')
  // 非法模式值必须 fail-soft 成"未启用"，不得因配置写错改变注入
  for (const bad of ['yes', 'true', '1', 'ON', 'SELF!', ' ']) {
    const r = extractRulesLayerPre({ userText: USER_MEM, rulesLayeringMode: bad })
    eq(r.enabled, false, '非法/未启用模式 "' + bad + '" ⇒ enabled=false（fail-soft）')
    eq(r.text, '', '同上 ⇒ 不产出规则文本')
  }
  eq(extractRulesLayerPre({}).enabled, false, '无输入 ⇒ 未启用')
  eq(RULES_LAYER_VERSION, 'rules_layer_pre_v1', '模块版本标识')
  // 切条器：无锚点文件不丢内容
  const noAnchor = splitMemoryEntriesPre('【必须遵守】这是没有锚点的旧格式记忆。')
  eq(noAnchor.length, 1, '无锚点文件 ⇒ 整篇一条（不丢内容）')
  eq(splitMemoryEntriesPre('').length, 0, '空文本 ⇒ 0 条')
  ok(firstLine('第一行\n第二行').length === 3, 'firstLine 取首行')
  // 卫生
  for (const p of ['../../lib/rules-layer.js', '../../lib/index.js']) {
    const raw = readFileSync(new URL(p, import.meta.url))
    ok(!(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF), '无 BOM：' + p.split('/').pop())
  }
  const rulesCode = RULES_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/^import /m.test(rulesCode), '规则模块零依赖（无 import）')
  ok(!/\bfetch\s*\(|openai|chat\/completions/i.test(rulesCode), 'S9：无网络/无 LLM')
  ok(!/child_process|spawnSync|execSync/.test(rulesCode), 'S9：无子进程')
  ok(!/\bawait\b/.test(rulesCode), 'S9：全同步')
  ok(!/\bfs\.|readFileSync\(|writeFileSync\(/.test(rulesCode), '零 IO')
}

console.log('\n[p6a-rules-layer-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
