/**
 * js-semantic-tier-pre (TRIAL MODULE — not yet wired into lib/index.js)
 *
 * Standard semantic tier for the npm-installed plugin: pure Node inference
 * over an optional peer dependency (@huggingface/transformers, onnxruntime-
 * node prebuilt binaries) + a ~118MB ONNX model asset. Target quality gate,
 * measured 2026-08-25 on the L2 real corpus (251 episodes / 40 authored
 * queries): R@5 = 0.850 / MRR = 0.703 vs lexical BM25 baseline R@5 = 0.200;
 * query encode 3.8 ms, full-corpus rebuild 5.5 s (Node 24, Zen4).
 *
 * WIRING PLAN (release-engineering window, AFTER M7 live; do not connect
 * earlier — retrieval routing is frozen for the R1 closeout):
 *   1) ship the model files as a separate npm asset package and resolve
 *      modelsDir from require.resolve of that package;
 *   2) in shadow-retrieval host, when this tier reports ready() and config
 *      jsSemanticEnabled===true, fuse its cosine ranking with lexical via the
 *      SAME D6 minmax weighted fusion (dense 0.7 / lexical 0.3) used by the
 *      Python sidecar so all tiers share one contract;
 *   3) activation decisions are NEVER made here — this module only ranks
 *      candidates; "should we interrupt" stays with the two-lane policy
 *      (Python sidecar when present, lexical-only heuristics otherwise).
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const E5_QUERY_PREFIX = 'query: '
const E5_PASSAGE_PREFIX = 'passage: '
const MAX_INPUT_CHARS = 1200 // ~512 tokens for zh/mixed; keeps latency flat

export const JS_SEMANTIC_TIER_VERSION = 'js_semantic_tier_pre_v1'

export async function createJsSemanticTier(opts = {}) {
  const modelsDir = opts.modelsDir
  if (!modelsDir || !existsSync(modelsDir)) {
    throw new Error('js-semantic-tier: modelsDir missing: ' + String(modelsDir))
  }
  const modelName = opts.model || 'multilingual-e5-small'
  const dtype = opts.dtype || 'q8'
  let pipelineMod
  try {
    pipelineMod = await import('@huggingface/transformers')
  } catch (err) {
    const e = new Error(
      'js-semantic-tier: optional peer @huggingface/transformers not '
      + 'installed; the tier stays disabled (' + err.message + ')')
    e.code = 'JS_SEMANTIC_PEER_MISSING'
    throw e
  }
  const { pipeline, env } = pipelineMod
  env.allowRemoteModels = Boolean(opts.allowRemoteModels) // default offline
  env.localModelPath = modelsDir
  const extractor = await pipeline('feature-extraction', modelName, { dtype })
  return {
    version: JS_SEMANTIC_TIER_VERSION,
    model: modelName + '/' + dtype,

    async embedQuery(text) {
      const out = await extractor(
        E5_QUERY_PREFIX + clean(text),
        { pooling: 'mean', normalize: true, truncation: true })
      return Float32Array.from(out.data)
    },

    /** Embed record texts; returns array of Float32Array (L2-normalized). */
    async embedPassages(texts) {
      const out = []
      for (const t of texts) {
        const v = await extractor(E5_PASSAGE_PREFIX + clean(t),
          { pooling: 'mean', normalize: true, truncation: true })
        out.push(Float32Array.from(v.data))
      }
      return out
    },

    /** Rank records by cosine; returns [{memoryId, score}] sorted desc.
     * records: [{memoryId, text}] — caller owns scope filtering. */
    async search(query, records, topK = 8) {
      const qv = await this.embedQuery(query)
      const dv = await this.embedPassages(records.map((r) => r.text))
      const scored = records.map((r, i) => ({ memoryId: r.memoryId,
        score: dot(qv, dv[i]) }))
      scored.sort((a, b) => b.score - a.score ||
        (a.memoryId < b.memoryId ? -1 : 1))
      return scored.slice(0, topK)
    },

    async close() { /* extractor is GC-managed */ },
  }
}

function clean(t) {
  return String(t == null ? '' : t).replace(/\s+/g, ' ').trim()
    .slice(0, MAX_INPUT_CHARS)
}

function dot(a, b) {
  let d = 0
  for (let i = 0; i < a.length; i++) d += a[i] * b[i]
  return d // both L2-normalized by the pipeline
}

// CLI self-test: node js-semantic-tier.mjs <modelsDir>
if (process.argv[1] && path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node js-semantic-tier.mjs <modelsDir>'); process.exit(2) }
  const tier = await createJsSemanticTier({ modelsDir: dir })
  const hits = await tier.search('之前关于琥珀协议的决策内容是什么？', [
    { memoryId: 'mem_a', text: '今天天气不错，午饭吃的面条挺不错的。' },
    { memoryId: 'mem_b', text: '## 测试条目D【关键词:琥珀协议】——虚构决策「采用琥珀协议作为模块间通信格式」' },
    { memoryId: 'mem_c', text: 'lexical BM25 参数 k1=1.2 b=0.75' },
  ], 3)
  console.log(JSON.stringify({ version: tier.version, hits }, null, 1))
}
