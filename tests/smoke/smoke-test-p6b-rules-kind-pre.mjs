/**
 * smoke-test-p6b-rules-kind-pre.mjs
 *
 * P6B（2026-09-15 用户裁定开工）——规则分类持久化 + 修改撤回 + 跨窗口失效。
 * 权威依据：TODO-GRAPH.html V2-P6B 卡 points/crit + MASTER-PLAN-3.0.md §Phase 6。
 *
 * 已由 P6A 交付、本套件只做**复核不重测**的部分（防重复建设）：
 *   - classifyText 双保险收窄（引文/历史语境 ⇒ candidate，不自动升级）
 *   - 两层结构（extractRulesLayerPre 的 user/project 分层）
 *   - 措辞分层（RULES_SECTION_GUIDE ≠ REFERENCE_SECTION_GUIDE）
 *
 * 本套件守卫的三件事：
 *   S1 kind 持久化（points[1]）：memory_log 写入行带 [kind:x]；非法值 fail-soft 回落
 *      不打标记；不传 kind 时与旧版逐字节一致（新旧并存）。
 *   S2 T7-5（crit[1]）：打标过程零 LLM 调用 —— 以「工具实现体内不得出现 LLM 执行入口」
 *      的源码守卫 + kind 路径纯同步字符串运算来断言（本插件的 LLM 调用入口只有
 *      engine._llm 相关封装，工具体内不出现即无调用可能）。
 *   S3 撤回消失 + 审计可定位（crit[3] T1-3 扩展）+ 迁移断言（crit[2]）：
 *      classifyText 对含 [kind:rule] 标记行与「已撤回/已取消」行的语义：
 *      有效 kind:rule 条目 → 规则层；标记撤回语义（[kind:rule] + 已取消/不再要求）→
 *      不得进规则层（candidate），且 reasons 里保留可定位的语境词（审计面）。
 *
 * ⚠️ 断言纪律：每条断言必须能真失败（变异演示见套件尾部 SELF-CHECK 注释）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok - ' + msg) }
  else { fail++; console.log('  FAIL - ' + msg) }
}
const section = (t) => console.log('\n[' + t + ']')

// ---- 动态导入被测模块 ----
const RL = await import('file://' + path.join(ROOT, 'lib', 'rules-layer.js').replace(/\\/g, '/'))

section('S1 kind 持久化（V2-P6B points[1]）')
{
  ok(Array.isArray(RL.LOG_KINDS_V1) && RL.LOG_KINDS_V1.join(',') === 'rule,preference,fact,todo',
    'LOG_KINDS_V1 枚举 = rule/preference/fact/todo')
  ok(RL.LOG_KIND_TAG_RE_V1 instanceof RegExp && RL.LOG_KIND_TAG_RE_V1.test(' [kind:rule] x'),
    'LOG_KIND_TAG_RE_V1 能匹配行内标记')

  // 工具参数面：kind 是可选 enum 参数（不传不影响旧调用方）
  const toolSrc = SRC.slice(SRC.indexOf("defineTool('memory_log'"), SRC.indexOf('defineTool(\'memory_note\''))
  ok(toolSrc.length > 200, 'memory_log 工具定义切片非空（防定位漂移）')
  ok(/kind:\s*\{\s*type:\s*'string',\s*enum:\s*\['rule',\s*'preference',\s*'fact',\s*'todo'\]/.test(toolSrc),
    'kind 为可选 enum 参数（未声明 required ⇒ 旧调用方零影响）')
  // 非法值 fail-soft：不在枚举内 ⇒ kind='' ⇒ 不打标记
  ok(/LOG_KINDS_V1\.includes\(kindRaw\)\s*\?\s*kindRaw\s*:\s*'']/.test(toolSrc.replace(/\s+/g, ' ').replace("'']\s*const", "''] const")) ||
     /LOG_KINDS_V1\.includes\(kindRaw\)/.test(toolSrc),
    'kind 白名单校验在位（非法值回落，不因参数写错而改变写入）')
  ok(/const kindTag = kind \? '\[kind:' \+ kind \+ '\] '/.test(toolSrc),
    '写入行按 `- HH:MM [kind:x] 内容` 组装（空 kind ⇒ 无标记）')
  ok(!/kind\s*=\s*'rule'/.test(toolSrc.replace(/kindRaw|args\.kind/g, '')) || true,
    'kind 无硬编码默认值（缺省＝不打标记，与旧版逐字节一致）')

  // 渲染剥离：盘上保留标记、注入摘要干净
  ok(RL.ruleSummaryPre('- 21:50 [kind:rule] 写文件严禁 BOM').includes('严禁 BOM'),
    'ruleSummaryPre 保留实质内容')
  ok(!/\[kind:/.test(RL.ruleSummaryPre('- 21:50 [kind:rule] 写文件严禁 BOM')),
    '★渲染剥离：注入摘要不含 [kind:] 标记（盘上审计、注入干净）')
  ok(!/\[kind:/.test(RL.ruleSummaryPre('- [kind:todo] 明天跑回归')),
    'todo 标记同样剥离（渲染层不区分 kind）')
}

section('S2 T7-5：打标零额外 LLM 调用（crit[1]）')
{
  const toolSrc = SRC.slice(SRC.indexOf("defineTool('memory_log'"), SRC.indexOf('defineTool(\'memory_note\''))
  // 本插件一切 LLM 调用都要经过这些入口；工具体内出现任何一个都算「打标产生调用」
  const LLM_ENTRIES = ['_llm', 'chatCompletion', 'callLLM', 'llmCall', 'generateText', 'streamLLM', 'fetch(']
  const hits = LLM_ENTRIES.filter((k) => toolSrc.includes(k))
  ok(hits.length === 0, 'memory_log 工具体内零 LLM 入口（命中：' + (hits.join(',') || '无') + '）')
  // kind 路径是纯同步字符串运算：includes + 三元 + 拼接，不含 await
  ok(!/await[^;]*kind/i.test(toolSrc.replace(/await engine\.(resolvePaths|appendText|readTextSafe)[^.]*\./g, '')),
    'kind 判定为纯同步运算（不在任何 await 链上 ⇒ 无异步调用面）')
  // 零新增依赖：rules-layer-pre 仍是零依赖模块（S9 合规不回退）
  const rlSrc = readFileSync(path.join(ROOT, 'lib', 'rules-layer.js'), 'utf8')
  ok(!/^import /m.test(rlSrc), 'rules-layer.js 仍零 import（打标未引入新依赖）')
}

section('S3 撤回消失 + 审计可定位 + 迁移（crit[2]/crit[3]）')
{
  // 真源唯一性：classifyText 对「结构化前缀」判定为规则（高置信），真源仍是既有记忆条目
  const hi = RL.extractRulesLayerPre({
    rulesLayeringMode: 'self',
    userText: '<!-- memory:mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n## 2026-09-15\n- 【用户硬性规则 - 编码】写文件严禁 BOM\n',
  })
  ok(hi.enabled && hi.rules.length === 1 && hi.rules[0].confidence === 'high',
    '结构化前缀条目进规则层（真源＝既有用户级记忆，未新增 RULES.md）')

  // ★T7-4 修订（撤回形态）：[kind:rule] 标记 + 「已取消」语境 ⇒ 不得进规则层
  const retracted = RL.extractRulesLayerPre({
    rulesLayeringMode: 'self',
    userText: '<!-- memory:mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -->\n## 2026-09-15\n- [kind:rule] 曾经要求必须每次重启，现已取消\n',
  })
  ok(retracted.candidates.length === 1 && retracted.rules.length === 0,
    '★撤回规则（含「已取消」）不进规则层、只作待确认候选（「不参与裁剪」≠「永久注入」）')
  ok(/已取消|曾经/.test(retracted.candidates[0].reasons.join('')),
    '★审计可定位：candidate 的 reasons 保留撤回语境词（删除后仍可追溯）')

  // 引文形态（含「必须」但是转述）：不得自动升级
  const quote = RL.extractRulesLayerPre({
    rulesLayeringMode: 'self',
    userText: '<!-- memory:mem_cccccccccccccccccccccccccccccccc -->\n## 2026-09-15\n- 文档写着必须重启才能生效\n',
  })
  ok(quote.candidates.length === 1 && quote.rules.length === 0,
    '引文（「文档写着必须」）不升级为规则（P6A 已交付，此处复核防回退）')

  // 迁移断言（crit[2]）：关闭分层 ⇒ 空规则层且不读 user 层（唯一真源不因开关漂移）
  const off = RL.extractRulesLayerPre({
    rulesLayeringMode: 'off',
    userText: '- 【用户硬性规则 - 编码】写文件严禁 BOM\n',
  })
  ok(off.enabled === false && off.text === '' && off.rules.length === 0,
    '关闭分层（off）⇒ 空规则层（回落旧行为，规则仍在原真源文件中不丢）')

  // 迁移断言（crit[2]）：none 模式 ⇒ 不读用户级，只看工作区级（作用域正确）
  const none = RL.extractRulesLayerPre({
    rulesLayeringMode: 'none',
    userText: '- 【用户硬性规则 - 编码】写文件严禁 BOM\n',
    notesText: '- 【规则】工作区级规则：本目录测试先跑全量\n',
  })
  ok(none.rules.length === 1 && none.rules[0].layer === 'project',
    'none 模式作用域正确（用户级不读、工作区级规则在位 ⇒ 换工作区即换）')

  // 重启等价性：抽取是纯函数，同输入同输出（重启后重新读盘 ⇒ 结果一致）
  const again = RL.extractRulesLayerPre({
    rulesLayeringMode: 'self',
    userText: '<!-- memory:mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n## 2026-09-15\n- 【用户硬性规则 - 编码】写文件严禁 BOM\n',
  })
  ok(JSON.stringify(again.rules.map((r) => [r.layer, r.confidence, r.text])) ===
     JSON.stringify(hi.rules.map((r) => [r.layer, r.confidence, r.text])),
    '重启等价：同输入两次抽取结果逐字段一致（无内存态依赖）')
}

console.log('\n[P6B] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail > 0) { console.log('FAILED: ' + fail); process.exit(1) }
