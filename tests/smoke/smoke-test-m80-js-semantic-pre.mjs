#!/usr/bin/env node
/** [M80] JS semantic tier (js_semantic_tier_v1) — trial-module contract.
 * Zero production wiring: this suite exercises the standalone module in
 * artifacts/m7-live-pre/js-semantic-trial/. If the optional peer deps are not
 * installed, the suite SKIPS (exit 0) with an explicit note — the tier is an
 * optional enhancement by design. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TRIAL = path.resolve(HERE, '..', '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial')
const MODELS = path.join(TRIAL, 'models')
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok -', name) } else { fail++; console.log('  FAIL -', name) } }

if (!existsSync(path.join(TRIAL, 'node_modules', '@huggingface', 'transformers'))
    || !existsSync(path.join(MODELS, 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'))) {
  console.log('[M80] SKIP: trial peer deps/model not present on this machine '
    + '(optional tier; run artifacts/m7-live-pre/js-semantic-trial setup to enable)')
  process.exit(0)
}

console.log('[M80] G1 module loads offline and reports identity')
process.env.TRANSFORMERS_OFFLINE = '1'
const tierMod = await import('file:///' +
  path.join(TRIAL, 'js-semantic-tier.mjs').replace(/\\/g, '/'))
ok(typeof tierMod.createJsSemanticTier === 'function', 'factory exported')
ok(String(tierMod.JS_SEMANTIC_TIER_VERSION) === 'js_semantic_tier_v1',
  'version constant frozen')

console.log('[M80] G2 tier boots from local model dir (no network)')
const tier = await tierMod.createJsSemanticTier({ modelsDir: MODELS })
ok(tier.model === 'multilingual-e5-small/q8', 'model/dtype pinned')

console.log('[M80] G3 determinism: same query -> identical vector')
const v1 = await tier.embedQuery('之前关于琥珀协议的决策内容是什么？')
const v2 = await tier.embedQuery('之前关于琥珀协议的决策内容是什么？')
ok(v1.length === v2.length && v1.every((x, i) => x === v2[i]),
  'bitwise deterministic embedding')

console.log('[M80] G4 retrieval sanity: echo vs recall separation')
const hits = await tier.search('之前关于琥珀协议的决策内容是什么？', [
  { memoryId: 'mem_echo', text: '今天天气不错，午饭吃的面条挺不错的。' },
  { memoryId: 'mem_gold', text: '## 测试条目D【关键词:琥珀协议】虚构决策「采用琥珀协议作为模块间通信格式」' },
], 2)
ok(hits[0].memoryId === 'mem_gold', 'recall target ranks above life-log echo')
ok(hits[0].score > hits[1].score, 'scores sorted desc')

console.log('[M80] G5 no raw query persistence surface: search() returns ids+scores only')
ok(hits.every((h) => typeof h.memoryId === 'string' && typeof h.score === 'number'
  && Object.keys(h).length === 2), 'result shape minimal')

await tier.close()
console.log(`[M80] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
