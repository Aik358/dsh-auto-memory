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
 */

import assert from 'node:assert/strict'
import { parseModelWindowsPre, pickWindowPre, findOfficialContextWindowPre, findSessionModelPre } from '../../lib/water-window.js'

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
  ok('W13 无 request 事件时返回空', JSON.stringify(findSessionModelPre([{ type: 'user/message', data: {} }])) === '{"provider":"","model":"","contextWindow":0}')
  ok('W13 非数组输入返回空', findSessionModelPre(null).model === '')
  const newer = [
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910' } } } },
    { type: 'request/header', data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } } },
  ]
  ok('W14 last-wins 取最新一条 request/header', findSessionModelPre(newer).model === 'deepseek-v4-flash')
  ok('W14 maxScan 限制生效(只扫最近 1 条仍取到最新)', findSessionModelPre(newer, 1).model === 'deepseek-v4-flash')
} catch (e) {
  fail++
  console.log('  FAIL - 未捕获异常: ' + (e && e.stack ? e.stack : e))
}

console.log('\n[water-window] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
