#!/usr/bin/env node
/** Diagnose why production memoryRefs are empty: replay the exact
 * context-host chain (buildSourceCatalog -> registry.get -> lexicalSearch)
 * against the real workspace paths and the 4 validation queries. */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const REPO = 'D:/dsh-auto-memory'
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href)
const { canonicalize, buildSourceCatalog, loadCorpusSnapshot, CorpusRegistry } =
  await imp('lib/m4-corpus-pre.js')
const { buildQueryPlan, lexicalSearch } = await imp('lib/shadow-retrieval-pre.js')

const WS = 'D:\\dsh-auto-memory'
const notesDir = path.join(os.homedir(), '.dsh', 'memory', 'workspaces',
  '--D--dsh-auto-memory--')
const catalog = buildSourceCatalog({
  workspaceKey: canonicalize(WS),
  userMemoryPath: path.join(os.homedir(), '.dsh', 'memory', 'MEMORY.md'),
  workspaceMemoryPath: path.join(notesDir, 'MEMORY.md'),
  todayLogPath: path.join(notesDir, '2026-08-25.md'),
})
console.log('catalog sources:')
for (const s of catalog.sources) console.log(' ', s.kind, s.file ? s.file.slice(-52) : '')

const registry = new CorpusRegistry({ sidecarDir: path.join(os.homedir(),
  '.dsh', 'memory', 'index-pre', 'files') })
const res = registry.get(catalog)
console.log('registry.get ok:', res && res.ok, res && !res.ok ? ('reason=' + res.reason) : '')
if (!(res && res.ok)) process.exit(0)
const snap = res.snapshot
console.log('snapshot: miv=%s records=%d sources=%d',
  snap.memoryIndexVersion, snap.records.length, snap.sources.length)

const QUERIES = [
  'M7-3 冻结的混合检索权重是多少？',
  '这个函数写得挺优雅的。',
  'Which milestone completed the JS stages M0-M6 with live verification?',
  '接下来我准备继续做 G-02 控制台了。',
]
for (const q of QUERIES) {
  const qpInput = {
    trigger: { segmentId: 'diag', segmentDigest: 'd0', kind: 'user',
      eventType: 'session/event', ts: Date.now() },
    window: [{ segmentId: 'diag', digest: 'd0', kind: 'user', eventSeq: 1,
      contextVersion: 1, ts: Date.now(), text: q }],
  }
  const qp = buildQueryPlan(qpInput)
  const ls = lexicalSearch(snap, qp, { triggerTs: Date.now(), mode: 'prefetch',
    dayBoundaryMinutes: 450 })
  const drops = {}
  for (const d of (ls.dropped || [])) drops[d.reason] = (drops[d.reason] || 0) + 1
  console.log('Q=%s\n  terms=%d kept=%d rawHits=%d drops=%j top=%s', q.slice(0, 24),
    qp.terms.length, ls.kept.length,
    (ls.rawHits || []).length, drops,
    (ls.kept || [])[0] ? ls.kept[0].memoryId + ':' + (ls.kept[0].scores.total).toFixed(3) : '-')
}
