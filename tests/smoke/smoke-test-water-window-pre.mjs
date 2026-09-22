#!/usr/bin/env node
/** [water-window] 上下文窗口解析防回归(2.2.4,2026-09-08)。
 *
 * 守卫 lib/water-window.js。实测故障:水位显示「500,998 / 131,072 token · 150%」——
 * 真实模型窗口 1M 却取成 fallback 128K,水位虚高。两条路同时失效:
 *   1) settings.yaml 的 llm-deepseek 段是 flow 风格 YAML(`{ models: [ { id: x, contextWindow: 1000000, … } ] }`),
 *      旧解析器只认 block 风格(`- id: x` + 行尾纯数字)→ 整段解析不出;
 *   2) 官方 request/context 事件只在会话开头出现(实测 2999 条事件里仅 2 条),旧代码只扫最近 256 条 → 永远扫不到。
 *
 * 覆盖:
 *   W1  parseModelWindowsPre:block 风格解析(llm-pi-ai 那种)
 *   W2  parseModelWindowsPre:flow 风格解析(llm-deepseek 那种,核心回归)
 *   W3  parseModelWindowsPre:空/非法输入容错
 *   W4  pickWindowPre:provider/model 精确命中
 *   W5  pickWindowPre:provider 不匹配时按 model 名兜底
 *   W6  pickWindowPre:未命中返回 0
 *   W7  findOfficialContextWindowPre:事件位于数组开头时仍能找到(核心回归)
 *   W8  findOfficialContextWindowPre:取最后一条 request/context(last-wins)
 *   W9  findOfficialContextWindowPre:缺失/非法值返回 0
 *   W10 findOfficialContextWindowPre:maxScan 限制生效
 *   W11-W14 会话真实模型(request/header 优先,2026-09-08)
 *   W15-W16 provider 前缀式模型 id(含 `/`)可被解析并命中(核心回归,2026-09-14)
 *   W17 非法 id 行不得把窗口记到上一条模型头上(静默错配)
 *   W18-W21 会话模型扫描缓存的复用边界(空结果不得被锁死 5 分钟,2026-09-14)
 *   W22 首轮 pre-step 只存在 request/header 时 contextWindow 恒为 0(空值的来源)
 *   W23-W25 会话真实模型未知时不得按比例 arm(新会话首轮,2026-09-14;W25 同日审查修正为 fail-closed)
 *   W26 接线守卫:宿主端确实调用 reusableWindowCachePre 并写入 events 字段
 *       —— 编号刻意让扫描缓存(W18-W22/W26)与首轮判定(W23-W25)两段互不重叠
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseModelWindowsPre, pickWindowPre, findOfficialContextWindowPre, findSessionModelPre, reusableWindowCachePre, shouldArmAutoContinuePre } from '../../lib/water-window.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

try {
  // ── W1 block 风格(llm-pi-ai 片段) ─────────────────────
  const blockYaml = [
    'llm-pi-ai:',
    '  providers:',
    '    opencode-go:',
    '      models:',
    '        - id: deepseek-v4-flash',
    '          contextWindow: 1000000',
    '        - id: glm-5.1',
    '          contextWindow: 202752',
  ].join('\n')
  const w1 = parseModelWindowsPre(blockYaml)
  ok('W1 block 风格解析出 2 个模型', Object.keys(w1.byModel).length === 2, JSON.stringify(w1.byModel))
  ok('W1 block 风格 deepseek-v4-flash = 1000000', w1.byModel['deepseek-v4-flash'] === 1000000)
  ok('W1 block 风格 glm-5.1 = 202752', w1.byModel['glm-5.1'] === 202752)

  // ── W2 flow 风格(llm-deepseek 片段,核心回归) ───────────
  const flowYaml = [
    'llm-deepseek:',
    '  {',
    '    models:',
    '      [',
    '        {',
    '            id: deepseek-v4-flash,',
    '            name: DeepSeek-V4-Flash,',
    '            contextWindow: 1000000,',
    '            inputModalities: [ text ]',
    '          },',
    '        {',
    '            id: deepseek-v4.1-flash-expires-on-0910,',
    '            name: deepseek-v4.1-flash,',
    '            contextWindow: 1000000,',
    '            inputModalities: [ text, image ]',
    '          }',
    '      ]',
    '  }',
  ].join('\n')
  const w2 = parseModelWindowsPre(flowYaml)
  ok('W2 flow 风格解析出 2 个模型', Object.keys(w2.byModel).length === 2, JSON.stringify(w2.byModel))
  ok('W2 flow 风格 deepseek-v4.1-flash-expires-on-0910 = 1000000', w2.byModel['deepseek-v4.1-flash-expires-on-0910'] === 1000000)
  ok('W2 flow 风格 id 行尾逗号已剥离', w2.byModel['deepseek-v4-flash'] === 1000000)

  // ── W3 容错 ───────────────────────────────────────────
  ok('W3 空输入不抛错', Object.keys(parseModelWindowsPre('').byModel).length === 0)
  ok('W3 null 输入不抛错', Object.keys(parseModelWindowsPre(null).byModel).length === 0)
  ok('W3 无 contextWindow 的 id 不产生窗口', parseModelWindowsPre('        id: x-no-window,\n').byModel['x-no-window'] === 0)

  // ── W4-W6 选窗口 ──────────────────────────────────────
  const both = parseModelWindowsPre(blockYaml + '\n' + flowYaml)
  ok('W4 精确命中 provider/model', pickWindowPre(both, 'opencode-go', 'glm-5.1') === 202752)
  ok('W5 provider 不同仍按 model 名兜底', pickWindowPre(both, 'deepseek-official', 'deepseek-v4.1-flash-expires-on-0910') === 1000000)
  ok('W6 未知模型返回 0', pickWindowPre(both, 'x', 'no-such-model') === 0)
  ok('W6 空 model 返回 0', pickWindowPre(both, 'x', '') === 0)

  // ── W7-W10 官方事件扫描 ───────────────────────────────
  const longEvents = [{ type: 'request/context', data: { contextWindow: 1000000 } }]
  for (let i = 0; i < 3000; i++) longEvents.push({ type: 'assistant/chunk', data: { i } })
  ok('W7 事件在数组开头仍能找到(核心回归,旧版只扫最近 256)', findOfficialContextWindowPre(longEvents) === 1000000)

  const twoCtx = [
    { type: 'request/context', data: { contextWindow: 1000000 } },
    { type: 'user/message', data: {} },
    { type: 'request/context', data: { contextWindow: 202752 } },
  ]
  ok('W8 last-wins 取最后一条', findOfficialContextWindowPre(twoCtx) === 202752)
  ok('W9 无 request/context 返回 0', findOfficialContextWindowPre([{ type: 'user/message', data: {} }]) === 0)
  ok('W9 非法 contextWindow 返回 0', findOfficialContextWindowPre([{ type: 'request/context', data: { contextWindow: 'x' } }]) === 0)
  ok('W10 maxScan 限制生效(只扫最近 1 条 → 0)', findOfficialContextWindowPre(longEvents, 1) === 0)
  ok('W9 非数组输入返回 0', findOfficialContextWindowPre(null) === 0)

  // ── W11-W14 会话真实模型(request/header 优先,2026-09-08) ──────────
  const sessEvents = [
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910' } } } },
    { type: 'request/context', data: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910', contextWindow: 1000000 } },
  ]
  for (let i = 0; i < 3000; i++) sessEvents.push({ type: 'assistant/chunk', data: { i } })
  const m1 = findSessionModelPre(sessEvents)
  ok('W11 取会话真实 provider/model(事件在开头也能取到)', m1.provider === 'deepseek-official' && m1.model === 'deepseek-v4.1-flash-expires-on-0910')
  ok('W12 顺带带回 contextWindow', m1.contextWindow === 1000000)
  ok('W13 无 request 事件时返回空', JSON.stringify(findSessionModelPre([{ type: 'user/message', data: {} }])) === '{"provider":"","model":"","contextWindow":0,"maxTokens":0}')
  ok('W13b 顺带带回预留输出额度 maxTokens(水位口径要扣掉它)', findSessionModelPre([{ type: 'request/header', data: { header: { config: { provider: 'opencode-go2', model: 'deepseek-flash', maxTokens: 384000 } } } }]).maxTokens === 384000)
  ok('W13 非数组输入返回空', findSessionModelPre(null).model === '')
  const newer = [
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910' } } } },
    { type: 'request/header', data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } } },
  ]
  ok('W14 last-wins 取最新一条 request/header', findSessionModelPre(newer).model === 'deepseek-v4-flash')
  ok('W14 maxScan 限制生效(只扫最近 1 条仍取到最新)', findSessionModelPre(newer, 1).model === 'deepseek-v4-flash')

  // ── W15-W17 provider 前缀式模型 id(含 `/`) ────────────────────────────
  // 核心回归:`parseModelWindowsPre` 的 id 字符类此前不含 `/`,凡 `provider/model` 形态的 id
  // 整行匹配失败 → 该模型的 contextWindow 被静默丢弃 → 窗口退化为 fallback,水位虚高。
  // 实测:真实窗口 1,000,000 的会话按 131,072 当分母,水位被放大 7.63 倍(12.8% 显示成 98%),
  // 未达阈值即误弹「接续到新会话」确认卡。
  // 2026-09-14 从主车道回填(PR #31 的回归用例当时只落在发行轨;开发轨缺这 5 条断言)。
  const slashYaml = [
    'llm-pi-ai:',
    '  providers:',
    '    command-code:',
    '      models:',
    '        - id: deepseek/deepseek-v4.1-flash',
    '          name: DeepSeek V4.1 Flash',
    '          contextWindow: 1000000',
    '        - id: z-ai/glm-5.3-flash',
    '          contextWindow: 1048576',
  ].join('\n')
  const w15 = parseModelWindowsPre(slashYaml)
  ok('W15 含斜杠的 id 能被解析', w15.byModel['deepseek/deepseek-v4.1-flash'] === 1000000, JSON.stringify(w15.byModel))
  ok('W15 第二个含斜杠 id 同样解析', w15.byModel['z-ai/glm-5.3-flash'] === 1048576)
  ok('W16 按 model 名命中(provider 段缩进更深时由 byModel 兜底)',
    pickWindowPre(w15, 'command-code', 'deepseek/deepseek-v4.1-flash') === 1000000)
  ok('W16 未知 provider 仍按 model 命中',
    pickWindowPre(w15, 'whatever', 'z-ai/glm-5.3-flash') === 1048576)

  // W17 id 行格式不被识别时不得把窗口记到上一条模型头上。
  // 静默错配比"读不到"更危险:读不到只会退化为 fallback,错配会直接给出**偏小**的窗口 → 水位漏报。
  const badIdYaml = [
    '        - id: good-model',
    '        - id: "quoted-model"',
    '          contextWindow: 222222',
  ].join('\n')
  const w17 = parseModelWindowsPre(badIdYaml)
  ok('W17 非法 id 行的窗口不记到上一条', w17.byModel['good-model'] === 0, JSON.stringify(w17.byModel))

  // ── W18-W21 会话模型扫描缓存的复用边界(2026-09-14) ──────────────────
  // 回归:checkWaterLevel 原先无条件缓存扫描结果,空结果(contextWindow=0)同样命中
  // `cached.info`(对象恒为 truthy)⇒ 被锁死 5 分钟。而首轮 agent/pre-step 必然早于
  // request/context 写入(实测同轮内 turn/start → request/context 相隔 58ms,
  // step/start 在 request/context 之前约 21ms)⇒ official-context 在开局 5 分钟内永远取不到。
  const t0 = 1000000
  const mkCache = (over) => Object.assign(
    { sid: 's1', at: t0, info: { provider: 'p', model: 'm', contextWindow: 0 }, events: 13 }, over)
  const nonEmpty = { provider: 'p', model: 'm', contextWindow: 1000000 }

  ok('W18 非空结果 TTL 内复用(request/context 只在会话开头追加,值稳定)',
    reusableWindowCachePre(mkCache({ info: nonEmpty }), 's1', 999, t0 + 1000) === true)
  ok('W19 空结果 + 事件数未变 → 复用(不给每个 pre-step 加一次 O(n) 扫描)',
    reusableWindowCachePre(mkCache(), 's1', 13, t0 + 1000) === true)
  ok('W20 空结果 + 事件数增长 → 必须重扫【核心回归;修复前此断言为 true,即锁死 5 分钟】',
    reusableWindowCachePre(mkCache(), 's1', 14, t0 + 1000) === false)
  ok('W21 超过 TTL 不复用', reusableWindowCachePre(mkCache({ info: nonEmpty }), 's1', 13, t0 + 300001) === false)
  ok('W21 换会话不复用', reusableWindowCachePre(mkCache({ info: nonEmpty }), 's2', 13, t0 + 1000) === false)
  ok('W21 无缓存不复用', reusableWindowCachePre(null, 's1', 13, t0 + 1000) === false)
  ok('W21 无 sid 不复用', reusableWindowCachePre(mkCache({ info: nonEmpty }), '', 13, t0 + 1000) === false)
  ok('W21 空 info 且旧缓存缺 events 字段 → 不复用(兼容降级为"重扫")',
    reusableWindowCachePre({ sid: 's1', at: t0, info: { provider: '', model: '', contextWindow: 0 } }, 's1', 13, t0 + 1000) === false)

  // ── W22 空值的来源:首轮 pre-step 只存在 request/header ────────────────
  // 实测事件序列为 turn/start → step/start → user/message → request/header → request/context,
  // pre-step 早于 request/context ⇒ 首次扫描只能拿到 provider/model,contextWindow 为 0。
  const round1Model = findSessionModelPre([
    { type: 'request/header', data: { header: { config: { provider: 'command-code', model: 'deepseek/deepseek-v4.1-flash' } } } },
  ])
  ok('W22 只有 request/header 时 provider/model 有值、contextWindow 为 0',
    round1Model.provider === 'command-code'
      && round1Model.model === 'deepseek/deepseek-v4.1-flash'
      && round1Model.contextWindow === 0,
    JSON.stringify(round1Model))

  // ── W23-W25 会话真实模型未知时的 arm 资格(2026-09-14) ────────────────
  // 新会话首轮 agent/pre-step 时 request/header 尚未写入会话,
  // findSessionModelPre 返回 {provider:'',model:'',contextWindow:0,maxTokens:0} 全空
  // (DSH 的 sessionApi 只有 selectModel,没有查询会话当前模型的接口)。
  // 此时窗口只能用 settings.yaml 的 agent-default-model 推算 —— 而它与会话实际模型可能完全不同,
  // 按比例 arm 会让水位虚高数倍(实测 1,000,000 被当 131,072)后误弹接续卡。
  ok('W23 模型未知 + 无硬信号 → 不得按比例 arm',
    shouldArmAutoContinuePre({ ratio: 0.99, modelKnown: false, hard: false }) === false)
  ok('W23 模型未知 + 有硬信号(compaction/overflow/硬墙) → 放行（真实事件不依赖窗口估算）',
    shouldArmAutoContinuePre({ ratio: 0.50, modelKnown: false, hard: true }) === true)
  ok('W24 模型已知 → 比例判据照常生效',
    shouldArmAutoContinuePre({ ratio: 0.80, modelKnown: true, hard: false }) === true)
  // W25 fail-closed(2026-09-14 审查修正):原先 `=== false` 显式判等下,undefined 视为「已知」→
  // checkWaterLevel 早退路径(handoff 关闭/win<=0/测量异常)残留 undefined 时闸被静默绕过。
  // 改为 `!== true`:凡非 true 一律视为未知,只放行硬信号。
  ok('W25 未传 modelKnown → 视为未知(fail-closed,字段缺失不得绕闸)',
    shouldArmAutoContinuePre({ ratio: 0.80, hard: false }) === false)
  ok('W25 modelKnown=null/0/"true" 等非 true 值 → 一律视为未知',
    shouldArmAutoContinuePre({ ratio: 0.80, modelKnown: null, hard: false }) === false &&
    shouldArmAutoContinuePre({ ratio: 0.80, modelKnown: 0, hard: false }) === false &&
    shouldArmAutoContinuePre({ ratio: 0.80, modelKnown: 'true', hard: false }) === false)
  ok('W25 空 wl → 不放行', shouldArmAutoContinuePre(null) === false)
  ok('W25 undefined → 不放行', shouldArmAutoContinuePre(undefined) === false)

  // ── W26 接线守卫:纯函数正确 ≠ 接线正确 ─────────────────────────────
  // 以上全是纯函数断言,无法发现「checkWaterLevel 忘了调用它 / 参数传错 / 忘了写 events」
  // 这类接线问题(纯函数测试照样全绿)。故对宿主端补一次源码守卫,与本仓库其余 *-pre 测试同法。
  // 注:守卫的 import 路径按本仓 dev 车道写成 water-window.js(主车道为 water-window.js)。
  const INDEX_SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok('W26 已导入 reusableWindowCachePre',
    /import \{[^}]*\breusableWindowCachePre\b[^}]*\} from '\.\/water-window.js'/.test(INDEX_SRC))
  ok('W26 checkWaterLevel 用它判定缓存复用(传入的是当前事件数)',
    /if \(reusableWindowCachePre\(cached, sid, eventsForModel\.length, Date\.now\(\)\)\)/.test(INDEX_SRC))
  ok('W26 写入缓存时带 events 字段(否则空结果没有重扫依据,修复即失效)',
    /info: sessModel, events: eventsForModel\.length/.test(INDEX_SRC))
} catch (e) {
  fail++
  console.log('  FAIL - 未捕获异常: ' + (e && e.stack ? e.stack : e))
}

console.log('\n[water-window] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
