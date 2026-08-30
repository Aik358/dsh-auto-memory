#!/usr/bin/env node
/** C2 pipeline export: run the JS semantic tier (multilingual-e5-small q8)
 * retrieval over the SAME held-out human gold set used for C3 acceptance,
 * exporting per-query top-K candidates for fv2 decision replay in Python.
 * Output: js-retrieval-candidates.jsonl */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const HERE = 'D:/dsh-auto-memory/artifacts/m7-live-pre/js-semantic-trial'
const REPO = 'D:/dsh-auto-memory'
if (!existsSync(path.join(HERE, 'node_modules', '@huggingface', 'transformers'))) {
  console.error('peer deps missing'); process.exit(2)
}
process.env.TRANSFORMERS_OFFLINE = '1'
const { pipeline, env } = await import('file:///' +
  path.join(HERE, 'node_modules', '@huggingface', 'transformers', 'dist',
    'transformers.node.mjs').replace(/\\/g, '/'))
env.allowRemoteModels = false
env.localModelPath = path.join(HERE, 'models')
console.log('[c2] loading model...', )
const t0 = performance.now()
const extractor = await pipeline('feature-extraction', 'multilingual-e5-small',
  { dtype: 'q8' })
console.log('[c2] ready in %d ms', Math.round(performance.now() - t0))

const eps = readFileSync(path.join(REPO, 'artifacts', 'm7-corpus-pre',
  'episodes.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
// same anchor recovery as the controlled shadow (4 distilled test memories)
const ANCH = JSON.parse(readFileSync(path.join(REPO, 'artifacts',
  'm7-live-pre', 'feature-v2-heldout', 'anchor-recovery.json'), 'utf8'))
const golds = readFileSync(path.join(REPO, 'artifacts', 'm7-live-pre',
  'feature-v2-heldout', 'heldout-human-gold.jsonl'), 'utf8').split('\n')
  .filter(Boolean).map(JSON.parse)

// unified corpus: episodes + live records (from derived-corpus) + anchors
const dc = JSON.parse(readFileSync(process.env.USERPROFILE +
  '/.dsh/memory/semantic-pre/derived-corpus.json', 'utf8'))
const liveTexts = {}
for (const entry of (Array.isArray(dc.entries) ? dc.entries
    : Object.values(dc.entries))) {
  for (const rec of entry.records) liveTexts[rec.memoryId] = rec.text || ''
}
for (const [mid, a] of Object.entries(ANCH)) liveTexts[mid] = a.text

const docs = []
for (const e of eps) docs.push({ id: e.episodeId, text: e.text || '' })
for (const mid of Object.keys(liveTexts))
  docs.push({ id: mid, text: liveTexts[mid] })
console.log('[c2] corpus:', docs.length, 'documents')

async function embed(texts, prefix) {
  const out = []
  const t = performance.now()
  for (const s of texts) {
    const e = await extractor(prefix + String(s || '').replace(/\s+/g, ' ')
      .slice(0, 1200), { pooling: 'mean', normalize: true, truncation: true })
    out.push(Float32Array.from(e.data))
  }
  return { vecs: out, ms: performance.now() - t }
}

const dv = await embed(docs.map((d) => d.text), 'passage: ')
console.log('[c2] encoded %d docs (%.1f ms/doc)', docs.length,
  dv.ms / docs.length)
const qv = await embed(golds.map((g) => g.queryText), 'query: ')
console.log('[c2] encoded %d queries (%.1f ms/query)', qv.vecs.length,
  qv.ms / qv.vecs.length)

function cosine(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

const lines = []
for (let qi = 0; qi < golds.length; qi++) {
  const g = golds[qi]
  const scored = docs.map((d, di) => ({ id: d.id, s: cosine(qv.vecs[qi], dv.vecs[di]) }))
  scored.sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1))
  lines.push(JSON.stringify({
    sampleId: g.sampleId, category: g.category, language: g.language,
    expectedMemoryIds: g.expectedMemoryIds || [],
    independence: g.independence, pairId: g.pairId,
    goldAction: g.finalAction, queryText: g.queryText,
    ranked: scored.slice(0, TOPK()).map((x) => ({ key: x.id, score: +x.s.toFixed(4) })),
  }))
  function TOPK() { return 8 }
}
writeFileSync(path.join(HERE, 'js-retrieval-candidates.jsonl'),
  lines.join('\n') + '\n')
console.log('[c2] exported', lines.length, 'rows -> js-retrieval-candidates.jsonl')
