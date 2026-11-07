#!/usr/bin/env node
/**
 * smoke-test-issue558-554-agent-options-and-evidence.mjs
 *
 * ★#558① 前端：向导「模型」下拉的 value 是 `provider + \u0001 + model`，
 *   选中值必须**原样保存整串**（旧实现 raw.slice(0, at) 只存 provider ⇒
 *   select value 不再等于任何 option value、且发出去的 model 是 provider 名）。
 *   ★#558② 后端：向导选的 model/effort 必须**真的下发到子代理**（旧实现只写
 *   upgrade-state.agentOptions，runSubagent 根本不读 ⇒ 走全局配置）。
 *
 * ★#554：`finishUpgradeJobPre` 不能因为「子代理返回了非空文字」就把 perWorkspace
 *   整批标 done；必须按**逐区落盘证据**（事件数 / 检查点数 / 白板内容摘要）判定。
 *
 * 验收纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值；负路径 + 变异必红。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createHarness } from './_harness.mjs'

const T = createHarness('issue558-554')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const damPath = (rel) => path.join(ROOT, rel)
const readSrc = (rel) => fs.readFileSync(damPath(rel), 'utf8')
/** ★本仓铁律：套件里做锚点匹配前必须先把源码归一成 LF（CRLF 下含 \n 的锚串恒不命中）。 */
const toLF = (s) => String(s).replace(/\r\n/g, '\n')
const IX = toLF(readSrc('lib/index.js'))
const CLI = toLF(readSrc('lib/client.js'))

/* ══ 提取被测函数（源码抽取式：与生产同源，不抄实现） ══ */
/** 按**花括号配平**截取完整函数定义（不能用第一个 '\n}' 截断 —— 函数体里有嵌套块，
 *  截早会得到残缺源码，外面再包一层调用就 SyntaxError）。字符串/注释里的括号已在本项目
 *  被测函数中不存在（实测三段源码均无），故简单配平即可；配平失败直接抛，不静默。 */
function cutFn(src, header) {
  const i = src.indexOf(header)
  if (i < 0) throw new Error('未找到: ' + header)
  const start = src.indexOf('{', i)
  if (start < 0) throw new Error('未找到函数体: ' + header)
  let depth = 0
  for (let k = start; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(i, k + 1)
    }
  }
  throw new Error('花括号未配平: ' + header)
}
const resolveSrc = cutFn(IX, 'function resolveSubAgentOptionsPre(')
const judgeSrc = cutFn(IX, 'function judgeUpgradeEvidencePre(')
const subOptSrc = cutFn(IX, 'function subAgentOptions(config, lane) {')
const whitelistSrc = (IX.match(/const SUBAGENT_EFFORT_WHITELIST = [^\n]+/) || [''])[0]
if (!whitelistSrc) throw new Error('未找到 SUBAGENT_EFFORT_WHITELIST')
// 把 subAgentOptions 一起喂进作用域（resolve 依赖它）
const factoryBody = ['"use strict";', whitelistSrc, subOptSrc, resolveSrc, judgeSrc,
  'return { resolveSubAgentOptionsPre, judgeUpgradeEvidencePre, subAgentOptions, SUBAGENT_EFFORT_WHITELIST };'].join('\n')
const M = new Function(factoryBody)()
console.log('')
console.log('== A. #558②  agentOptions 覆盖通道（真调用）==')
const CFG = { subagentProvider: 'glob-prov', subagentModel: 'glob-model', subagentReasoningEffort: 'low' }

// A-1 不传 override ⇒ 逐字节等于旧路径
const a1 = M.resolveSubAgentOptionsPre(undefined, CFG, 'long')
const a1old = M.subAgentOptions(CFG, 'long')
T.eq(a1, { ok: true, value: a1old }, 'A-1 不传 override ⇒ 与旧 subAgentOptions 逐字段相等（旧行为不变）')
T.eq(a1old, { provider: 'glob-prov', model: 'glob-model', reasoningEffort: 'low' }, 'A-1b 旧路径确实取到全局三项')

// A-2 传 override ⇒ 以 override 为准
const a2 = M.resolveSubAgentOptionsPre({ model: 'user-model', reasoningEffort: 'max' }, CFG, 'long')
T.eq(a2.ok, true, 'A-2 合法 override ⇒ ok')
T.eq(a2.value.model, 'user-model', 'A-2b ★model 用用户选的（不是全局 glob-model）')
T.eq(a2.value.reasoningEffort, 'max', 'A-2c ★effort 用用户选的')
T.eq(a2.value.provider, 'glob-prov', 'A-2d override 没给 provider ⇒ 回落全局（三级优先级②）')

// A-3 非法值 ⇒ 明确拒绝，不静默丢弃
const a3 = M.resolveSubAgentOptionsPre({ reasoningEffort: 'medium' }, CFG, 'long')
T.eq(a3.ok, false, 'A-3 ★★medium（宿主不认）⇒ 明确拒绝，不静默忽略')
T.eq(a3.code, 'bad-effort', 'A-3b 错误码 bad-effort')
T.eq(a3.detail.allowed, ['off', 'low', 'high', 'max'], 'A-3c 错误里带出宿主白名单（可判读）')
const a4 = M.resolveSubAgentOptionsPre({ reasoningEffort: 'turbo' }, CFG, 'long')
T.eq(a4.ok, false, 'A-4 任意非法值同样拒绝')

// A-5 白名单边界：四档全部被接受
for (const ef of ['off', 'low', 'high', 'max']) {
  const r = M.resolveSubAgentOptionsPre({ reasoningEffort: ef }, CFG, 'long')
  T.eq(r.ok === true && r.value.reasoningEffort === ef, true, 'A-5 白名单档 ' + ef + ' 被接受')
}
// A-6 空 override ⇒ 回落全局（不把空串当下发值）
const a6 = M.resolveSubAgentOptionsPre({ model: '', reasoningEffort: '' }, CFG, 'long')
T.eq(a6.value.model, 'glob-model', 'A-6 空串 model ⇒ 回落全局（不是空串下发）')
T.eq(a6.value.reasoningEffort, 'low', 'A-6b 空串 effort ⇒ 回落全局')

console.log('')
console.log('== B. #554  逐区证据判定（真调用）==')
const base = [
  { wsKey: 'k1', name: 'w1', dir: '/d/w1', ok: true, eventCount: 2, checkpointCount: 5, planDigest: 'aa' },
  { wsKey: 'k2', name: 'w2', dir: '/d/w2', ok: true, eventCount: 0, checkpointCount: 0, planDigest: '' },
]
// B-1 事件数增 ⇒ done
const b1 = M.judgeUpgradeEvidencePre(base, [
  { wsKey: 'k1', name: 'w1', dir: '/d/w1', ok: true, eventCount: 3, checkpointCount: 5, planDigest: 'aa' },
  { wsKey: 'k2', name: 'w2', dir: '/d/w2', ok: true, eventCount: 0, checkpointCount: 0, planDigest: '' },
])
T.eq(b1.rows[0].phase, 'done', 'B-1 ★eventCount 增 ⇒ done')
T.eq(b1.rows[1].phase, 'partial', 'B-1b 该区无变化 ⇒ partial（不是 done）')
T.eq(b1.overall, 'partial', 'B-1c 部分有 ⇒ overall=partial')

// B-2 检查点数增（事件数不变）⇒ done —— 证明②独立成立
const b2 = M.judgeUpgradeEvidencePre(base, [
  { wsKey: 'k1', name: 'w1', dir: '/d/w1', ok: true, eventCount: 2, checkpointCount: 6, planDigest: 'aa' },
  { wsKey: 'k2', name: 'w2', dir: '/d/w2', ok: true, eventCount: 0, checkpointCount: 0, planDigest: '' },
])
T.eq(b2.rows[0].phase, 'done', 'B-2 ★checkpointCount 增（事件数不变）⇒ done')
T.eq(b2.rows[0].evidence.dCheckpoint, 1, 'B-2b 差值算对')

// B-3 白板摘要变（事件/检查点都不变）⇒ done
const b3 = M.judgeUpgradeEvidencePre(base, [
  { wsKey: 'k1', name: 'w1', dir: '/d/w1', ok: true, eventCount: 2, checkpointCount: 5, planDigest: 'bb' },
  { wsKey: 'k2', name: 'w2', dir: '/d/w2', ok: true, eventCount: 0, checkpointCount: 0, planDigest: '' },
])
T.eq(b3.rows[0].phase, 'done', 'B-3 ★planDigest 变 ⇒ done（白板比内容摘要）')
T.eq(b3.rows[0].evidence.planChanged, true, 'B-3b planChanged 标记正确')

// B-4 ★★负路径：返回了文字但**零写入** ⇒ 不得 done
const b4 = M.judgeUpgradeEvidencePre(base, base.map((x) => Object.assign({}, x)))
T.eq(b4.rows.every((r) => r.phase !== 'done'), true, 'B-4 ★★零变化 ⇒ 没有任何一区是 done（正是 #554 的缺陷形态）')
T.eq(b4.overall, 'failed', 'B-4b 整批全无证据 ⇒ overall=failed（不是 done）')
T.eq(b4.verifiable, true, 'B-4c ★★该批是**可核实**的（不能靠「读不到」逃过判定）')
T.eq(b4.allUnknown, false, 'B-4d allUnknown=false')
// ★★关键区分：同一份输入若**读不到磁盘**（ok:false），结论必须变成「不可核实」而不是 failed
const b4u = M.judgeUpgradeEvidencePre(base, base.map((x) => Object.assign({}, x, { ok: false, reason: 'plan-unreadable' })))
T.eq(b4u.verifiable, false, 'B-4e ★★读不到磁盘 ⇒ verifiable=false（不可核实，不等于失败）')
T.eq(b4u.allUnknown, true, 'B-4f allUnknown=true')
T.eq(b4.verifiable !== b4u.verifiable, true, 'B-4g ★两者必须可区分（防「一律 failed」或「一律 unknown」的恒真判据）')

// B-5 ★白板「字节相同但内容不同」必须能区分 —— 用摘要而不是字节数
const b5 = M.judgeUpgradeEvidencePre(
  [{ wsKey: 'k1', name: 'w1', dir: '/d', ok: true, eventCount: 1, checkpointCount: 1, planDigest: 'aaaa' }],
  [{ wsKey: 'k1', name: 'w1', dir: '/d', ok: true, eventCount: 1, checkpointCount: 1, planDigest: 'bbbb' }],
)
T.eq(b5.rows[0].phase, 'done', 'B-5 ★同长不同内容的白板（摘要不同）也判 done')

// B-6 快照读不到 ⇒ unknown（不假装成功也不假装失败）
const b6 = M.judgeUpgradeEvidencePre(base, [
  { wsKey: 'k1', name: 'w1', dir: '/d/w1', ok: false, reason: 'event-store-unreadable', eventCount: 0, checkpointCount: 0, planDigest: '' },
])
T.eq(b6.rows[0].phase, 'unknown', 'B-6 ★快照读不到 ⇒ unknown')
T.eq(b6.overall, 'unknown', 'B-6b overall=unknown')

// B-7 全部区都有证据 ⇒ done
const b7 = M.judgeUpgradeEvidencePre(
  [{ wsKey: 'k1', ok: true, eventCount: 1, checkpointCount: 1, planDigest: 'a' }, { wsKey: 'k2', ok: true, eventCount: 1, checkpointCount: 1, planDigest: 'b' }],
  [{ wsKey: 'k1', ok: true, eventCount: 2, checkpointCount: 1, planDigest: 'a' }, { wsKey: 'k2', ok: true, eventCount: 1, checkpointCount: 2, planDigest: 'b' }],
)
T.eq(b7.overall, 'done', 'B-7 全部区都有证据 ⇒ overall=done')

console.log('')
console.log('== C. #558①  前端 model value（源码锚点 + 真调用抽取函数）==')
// C-1 value 拼接用分隔符
T.ok(CLI.indexOf("var val = String(p.id || '') + '\\u0001' + String(m.id || '')") >= 0, 'C-1 选项 value = provider + 分隔符 + model')
// C-2 onChange 必须整串存（不得 slice(0, at)）
const onChangeBlock = (function () {
  const i = CLI.indexOf("'data-dam-wizard-model'")
  return i < 0 ? '' : CLI.slice(i, i + 600)
})()
T.ok(onChangeBlock.length > 0, 'C-2 找到模型 select 代码块')
T.ok(onChangeBlock.indexOf('setModelSel(raw)') >= 0, 'C-2b ★★onChange 保存**整串**（与 option value 同源）')
T.ok(!/setModelSel\(at >= 0 \? raw\.slice\(0, at\)/.test(onChangeBlock), 'C-2c ★旧写法（只存 provider）已不存在')
// C-3 发送时拆分
T.ok(CLI.indexOf('var _mdlProvider = _atM >= 0 ? _mdl.slice(0, _atM) : \'\'') >= 0, 'C-3 ★发送时把整串拆成 provider')
T.ok(CLI.indexOf('model: _mdlId, provider: _mdlProvider') >= 0, 'C-3b ★payload 发 model=模型 id + provider 分开')
// C-4 真执行：模拟 onChange + 发送时的拆分
const splitModel = new Function('modelSel', [
  'var _mdl = String(modelSel || "")',
  'var _atM = _mdl.indexOf(String.fromCharCode(1))',
  'var _mdlProvider = _atM >= 0 ? _mdl.slice(0, _atM) : ""',
  'var _mdlId = _atM >= 0 ? _mdl.slice(_atM + 1) : _mdl',
  'return { model: _mdlId, provider: _mdlProvider }',
].join('\n'))
T.eq(splitModel('provA' + String.fromCharCode(1) + 'modelX'), { model: 'modelX', provider: 'provA' }, 'C-4 ★真执行：整串正确拆成 model/provider')
T.eq(splitModel(''), { model: '', provider: '' }, 'C-4b 空值 ⇒ 两项都空（不抛）')

console.log('')
console.log('== D. #558①  档位口径同源（前端 = 后端 = 估算表）==')
T.ok(CLI.indexOf("useState('medium')") < 0, 'D-1 ★默认档位不再是 medium（宿主不认）')
T.ok(CLI.indexOf("useState('high')") >= 0, 'D-1b 默认档位 = high（宿主缺省档）')
for (const ef of ['off', 'low', 'high', 'max']) {
  T.ok(CLI.indexOf("effortOpt('" + ef + "'") >= 0, 'D-2 前端提供档位 ' + ef)
}
T.ok(CLI.indexOf("effortOpt('medium'") < 0, 'D-3 ★前端不再提供 medium')
T.ok(CLI.indexOf('data-dam-wizard-effort-hint') >= 0, 'D-4 ★显示实际生效值（effort-hint 带 data 属性）')
T.ok(/实际以账单为准|the bill is authoritative/.test(CLI), 'D-5 ★文案写明「实际以账单为准」')
T.ok(/max 按 high 上界估算|max is estimated at the high upper bound/.test(CLI), 'D-6 ★文案写明「max 按 high 上界估算」')

console.log('')
console.log('== E. ★变异必红（改回旧实现 ⇒ 断言必红）==')
// E-1 变异 resolveSubAgentOptionsPre：不校验白名单（静默接受 medium）
const mut1 = resolveSrc.replace("if (oEffort && SUBAGENT_EFFORT_WHITELIST.indexOf(oEffort) < 0) {", 'if (false) {')
T.ok(mut1 !== resolveSrc, 'E-1a 变异体已生成（锚串命中）')
const M1 = new Function(['"use strict";', whitelistSrc, subOptSrc, mut1, 'return { resolveSubAgentOptionsPre };'].join('\n'))()
const m1 = M1.resolveSubAgentOptionsPre({ reasoningEffort: 'medium' }, CFG, 'long')
T.eq(m1.ok, true, 'E-1b 变异体静默接受 medium（证明 A-3 的拒绝是真判据，不是恒真）')

// E-2 变异 judge：只要有快照就判 done（回到「不看证据」）
const mut2 = judgeSrc.replace('const hasEvidence = dEv > 0 || dCp > 0 || planChanged', 'const hasEvidence = true')
T.ok(mut2 !== judgeSrc, 'E-2a 变异体已生成')
const M2 = new Function(['"use strict";', mut2, 'return { judgeUpgradeEvidencePre };'].join('\n'))()
const m2 = M2.judgeUpgradeEvidencePre(base, base.map((x) => Object.assign({}, x)))
T.eq(m2.rows.every((r) => r.phase === 'done'), true, 'E-2b 变异体把零写入判成 done（证明 B-4 有区分力）')

// E-3 变异判定：白板改回「比字节数」的等价形态（这里用「永远认为没变」模拟）
const mut3 = judgeSrc.replace('const planChanged = prevDigest !== curDigest', 'const planChanged = false')
const M3 = new Function(['"use strict";', mut3, 'return { judgeUpgradeEvidencePre };'].join('\n'))()
const m3 = M3.judgeUpgradeEvidencePre(
  [{ wsKey: 'k1', ok: true, eventCount: 1, checkpointCount: 1, planDigest: 'aa' }],
  [{ wsKey: 'k1', ok: true, eventCount: 1, checkpointCount: 1, planDigest: 'bb' }],
)
T.eq(m3.rows[0].phase, 'partial', 'E-3 变异体看不到白板变化 ⇒ 判 partial（证明 B-3 有区分力）')

console.log('')
console.log('== F. [守卫·非功能证据] 接线在位（可证伪，但不算功能验收）==')
T.ok(IX.indexOf('resolveSubAgentOptionsPre(override, this.config, lane)') >= 0, 'F-1 runSubagent 内部真解析 override')
T.ok(IX.indexOf("...(_ao && _ao.ok && _ao.value ? { agentOptions: _ao.value } : {})") >= 0, 'F-2 主路径 agentOptions 走 override（不再直接 subAgentOptions）')
T.ok(IX.indexOf('agentOptions: subAgentOptions({ ...this.config, subagentModel: fbModel') < 0, 'F-3 回退路径已不再「只跑全局」（半修防线）')
T.ok(IX.indexOf('_aoCommit.override') >= 0, 'F-4 startUpgradeJobPre 把 override 传给 runSubagent')
T.ok(IX.indexOf('evidenceBaseline') >= 0, 'F-5 start 落写前证据快照')
T.ok(IX.indexOf('judgeUpgradeEvidencePre(_base, _after)') >= 0, 'F-6 finish 用证据判定终态')
T.ok(IX.indexOf('evidence-insufficient') >= 0, 'F-7 证据不足时写入可判读的 error')

T.done()