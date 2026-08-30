#!/usr/bin/env node
/** Lexical-only evaluation of a shadow-retrieval variant over the L2
 * real corpus (251 episodes / 40 authored queries).
 * Usage: node eval_lexical.mjs [variantModulePath]
 *   no arg -> production lib (baseline lexical_pre_v2)
 * Variant modules are patched COPIES of lib/shadow-retrieval-pre.js in
 * this directory; production code is never modified by experiments. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const modPath = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(REPO, 'lib', 'shadow-retrieval-pre.js')
const SR = await import('file:///' + modPath.replace(/\\/g, '/'))

const eps = readFileSync(path.join(REPO, 'artifacts', 'm7-corpus-pre',
  'episodes.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const queries = readFileSync(path.join(REPO, 'artifacts', 'm7-corpus-pre',
  'multilingual-queries.jsonl'), 'utf8').split('\n').filter(Boolean)
  .map(JSON.parse)

// ep_* -> strict mem_[32hex] rename (bijective, evaluation-only)
const memOf = {}
for (const e of eps) {
  memOf[e.episodeId] = 'mem_' + createHash('sha256')
    .update(e.episodeId).digest('hex').slice(0, 32)
}

const corpus = {
  memoryIndexVersion: 'eval-miv-1',
  sources: [{ sourceRef: 'profile:eval', kind: 'profile' }],
  records: eps.map((e) => ({
    memoryId: memOf[e.episodeId],
    anchorId: 'memory:' + memOf[e.episodeId],
    scope: 'Workspace',
    sourceClass: 'profile',
    sourceRef: 'profile:eval/' + e.episodeId,
    sourceEpoch: e.sessionRef || 'e-eval',
    sourceVersion: 1,
    fileDigest: e.sourceDigest || '',
    recordDigest: '',
    lineStart: e.turnStart || 0, lineEnd: e.turnEnd || 0,
    byteStart: 0, byteEnd: Number(e.bytes || 0),
    bytes: Buffer.byteLength(String(e.text || ''), 'utf8'),
    heading: e.heading || '',
    text: String(e.text || ''),
  })),
}

const TRIG_TS = Date.UTC(2026, 7, 25, 12, 0, 0)

function rankOne(q) {
  const snapshot = { contextVersion: 1, window: [{ kind: 'user', text: q.text }] }
  const qp = SR.buildQueryPlan(snapshot)
  const out = SR.lexicalSearch(corpus, qp, { triggerTs: TRIG_TS, mode: 'retrieve' })
  const hits = (out.rawHits || []).slice()
    .sort((a, b) => b.scores.total - a.scores.total || (a.memoryId < b.memoryId ? -1 : 1))
    .map((h) => h.memoryId)
  return hits
}

function metrics(rows) {
  let r1 = 0, r5 = 0, mrr = 0, ndcg = 0, neg5 = 0
  for (const { goldMem, negMem, ranks } of rows) {
    const top = ranks.slice(0, 10)
    const firstGold = goldMem.reduce((m, g) => Math.min(m,
      ranks.indexOf(g) === -1 ? 999 : ranks.indexOf(g) + 1), 999)
    if (firstGold === 1) r1++
    if (firstGold <= 5) r5++
    if (firstGold < 999) mrr += 1 / firstGold
    const dcg = top.reduce((a, id, i) => a + (goldMem.includes(id) ? 1 / Math.log2(i + 2) : 0), 0)
    const idcg = Array.from({ length: Math.min(goldMem.length, 10) },
      (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0)
    ndcg += idcg > 0 ? dcg / idcg : 0
    if (negMem.some((n) => ranks.slice(0, 5).includes(n))) neg5++
  }
  const n = rows.length || 1
  return { n: rows.length, R1: +(r1 / n).toFixed(3), R5: +(r5 / n).toFixed(3),
    MRR: +(mrr / n).toFixed(3), nDCG10: +(ndcg / n).toFixed(3),
    negHit5: +(neg5 / n).toFixed(3) }
}

const rows = []
for (const q of queries) {
  const ranks = rankOne(q)
  rows.push({ qid: q.qid,
    goldMem: (q.gold || []).map((g) => memOf[g]).filter(Boolean),
    negMem: (q.neg || []).map((g) => memOf[g]).filter(Boolean),
    ranks })
}
const label = process.argv[2] ? path.basename(process.argv[2], '.js') : 'BASELINE_lib'
console.log(label, JSON.stringify(metrics(rows)))
