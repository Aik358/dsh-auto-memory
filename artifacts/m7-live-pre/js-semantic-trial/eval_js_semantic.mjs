#!/usr/bin/env node
/** Trial: pure-JS semantic tier via transformers.js + multilingual-e5-small q8.
 * Mirrors the lexical-tuning protocol: L2 real corpus (251 episodes / 40
 * authored queries), R@1/R@5/MRR/nDCG@10/negHit@5 + encode latency.
 * e5 convention: "query: " prefix on queries, "passage: " on documents;
 * mean pooling + L2 normalize; max 512 tokens (model hard limit). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')

process.env.TRANSFORMERS_OFFLINE = '1'
const { pipeline, env } = await import(
  'file:///' + path.join(HERE, 'node_modules', '@huggingface', 'transformers',
    'dist', 'transformers.node.mjs').replace(/\\/g, '/'))
env.allowRemoteModels = false
env.localModelPath = path.join(HERE, 'models')

console.log('[js] loading multilingual-e5-small (q8)...')

const t0 = performance.now()
const extractor = await pipeline('feature-extraction', 'multilingual-e5-small',
  { dtype: 'q8' })
console.log('[js] model ready in %s ms', Math.round(performance.now() - t0))

const eps = readFileSync(path.join(REPO, 'artifacts', 'm7-corpus-pre',
  'episodes.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const queries = readFileSync(path.join(REPO, 'artifacts', 'm7-corpus-pre',
  'multilingual-queries.jsonl'), 'utf8').split('\n').filter(Boolean)
  .map(JSON.parse)

async function embed(texts, prefix) {
  const out = []
  const t = performance.now()
  for (const s of texts) {
    const e = await extractor(prefix + String(s || '').replace(/\s+/g, ' ').slice(0, 1200),
      { pooling: 'mean', normalize: true, truncation: true })
    out.push(Float32Array.from(e.data))
  }
  return { vecs: out, ms: performance.now() - t }
}

const docs = await embed(eps.map((e) => e.text), 'passage: ')
console.log('[js] encoded %d passages in %s ms (%.1f ms/doc)',
  eps.length, Math.round(docs.ms), docs.ms / eps.length)
const qs = await embed(queries.map((q) => q.text), 'query: ')
console.log('[js] encoded %d queries in %s ms (%.1f ms/query)',
  qs.vecs.length, Math.round(qs.ms), qs.ms / qs.vecs.length)

function cosine(a, b) {
  let d = 0
  for (let i = 0; i < a.length; i++) d += a[i] * b[i]
  return d // both L2-normalized
}

const rows = []
for (let qi = 0; qi < queries.length; qi++) {
  const q = queries[qi]
  const scored = eps.map((e, di) => ({ ep: e.episodeId, s: cosine(qs.vecs[qi], docs.vecs[di]) }))
  scored.sort((a, b) => b.s - a.s || (a.ep < b.ep ? -1 : 1))
  rows.push({ qid: q.qid, gold: q.gold || [], neg: q.neg || [],
    ranks: scored.slice(0, 64).map((x) => x.ep),
    topScore: +scored[0].s.toFixed(4) })
}

let r1 = 0, r5 = 0, mrr = 0, ndcg = 0, neg5 = 0
for (const r of rows) {
  const idxOf = (id) => r.ranks.indexOf(id) + 1
  const first = r.gold.reduce((m, g) => Math.min(m, idxOf(g) || 999), 999)
  if (first === 1) r1++
  if (first <= 5) r5++
  if (first < 999) mrr += 1 / first
  let dcg = 0
  r.ranks.slice(0, 10).forEach((id, i) => { if (r.gold.includes(id)) dcg += 1 / Math.log2(i + 2) })
  const idcg = Array.from({ length: Math.min(r.gold.length, 10) },
    (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0)
  ndcg += idcg ? dcg / idcg : 0
  if (r.neg.some((n) => r.ranks.slice(0, 5).includes(n))) neg5++
}
const n = rows.length
const report = {
  tier: 'js-semantic-trial', model: 'Xenova/multilingual-e5-small q8 (transformers.js 3.7.6)',
  n,
  R1: +(r1 / n).toFixed(3), R5: +(r5 / n).toFixed(3), MRR: +(mrr / n).toFixed(3),
  nDCG10: +(ndcg / n).toFixed(3), negHit5: +(neg5 / n).toFixed(3),
  docEncodeMsPerDoc: +(docs.ms / eps.length).toFixed(1),
  queryEncodeMsPerQuery: +(qs.ms / qs.vecs.length).toFixed(1),
}
console.log('RESULT ' + JSON.stringify(report))
