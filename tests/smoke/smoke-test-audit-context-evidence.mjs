import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { createContextHost } from '../../lib/context-host.js'
import { createAccessEvidencePre } from '../../lib/context-bridge.js'
import { EvidenceEventStore } from '../../lib/evidence-store.js'
import { buildSourceCatalog, CorpusRegistry } from '../../lib/m4-corpus.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-audit-evidence-'))
const previous = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
let host
try {
  const engine = new MemoryEngine(); engine.configLoaded = true
  Object.assign(engine.config, { memoryRoot: path.join(root, 'mem'), userMemoryDir: path.join(root, 'user'), memoryAnchorEnabled: true, associativeMemoryEnabled: true, contextBridgeEnabled: true, contextSinkMode: 'null', pythonBackendEnabled: false })
  const ws = path.join(root, 'ws'); const paths = { ws, userDir: engine.userDirOf(), notesPath: path.join(engine.projectDirOf(ws), 'MEMORY.md') }
  await mkdir(process.env.DSH_HOME, { recursive: true })
  await engine.docStore.append(paths.notesPath, '## 部署\n项目部署使用 pnpm build 和 rsync，回滚前保留构建目录。')
  const userFile = path.join(paths.userDir, 'MEMORY.md')
  await engine.docStore.append(userFile, '## 用户偏好\n用户偏好中文回复以及可复现的验证证据。')
  const registry = new CorpusRegistry({ sidecarDir: path.join(process.env.DSH_HOME, 'memory/index/files') })
  const snap = registry.get(buildSourceCatalog({ workspaceKey: ws, userMemoryPath: userFile, workspaceMemoryPath: paths.notesPath })).snapshot
  assert.equal(snap.records.length, 2)
  const a = snap.records.find(r => r.scope === 'Workspace'), b = snap.records.find(r => r.scope === 'User')
  host = createContextHost({ engine })
  const rt = { key: 'one', sessionId: 'one', contextVersion: 1, agent: { session: { header: {} } } }
  host.capturePaths(rt.key, paths)
  const makeRead = (r, sessionId, eventSeq, workspaceKey, ts) => createAccessEvidencePre({ ...r, kind: 'read', sessionId, eventSeq, nativeSeq: eventSeq, contextVersion: 1, workspaceKey, ts }).evidence
  await host.appendEvidence([makeRead(a, 'one', 1, ws, Date.now() - 1000), makeRead(b, 'other-session', 2, ws, Date.now())])
  const emit = async (text, eventSeq) => { host.onSegmentAccepted(rt, { id: 'seg_' + eventSeq, digest: 'a'.repeat(32), kind: 'user', eventSeq, nativeSeq: eventSeq, contextVersion: eventSeq, ts: Date.now(), text }, { payload: {} }); await new Promise(r => setTimeout(r, 60)) }
  await emit('这个不对，需要纠正。', 3)
  const store = new EvidenceEventStore({ root: path.join(process.env.DSH_HOME, 'memory/evidence') })
  let corrections = store.loadEvents().events.filter(e => e.kind === 'correction')
  assert.deepEqual(corrections.map(e => e.memoryId), [a.memoryId])
  await host.appendEvidence([makeRead(b, 'one', 4, path.join(root, 'other-workspace'), Date.now())])
  await emit('这个不对。', 5)
  assert.equal(store.loadEvents().events.filter(e => e.kind === 'correction').length, 1)
  await host.appendEvidence([makeRead(b, 'one', 6, ws, Date.now())])
  await emit(a.memoryId + ' 这条不对。', 7)
  corrections = store.loadEvents().events.filter(e => e.kind === 'correction')
  assert.ok(corrections.every(e => e.memoryId === a.memoryId))
  const both = await readFile(paths.notesPath, 'utf8') + await readFile(userFile, 'utf8')
  host.onToolResult(rt, { sessionId: 'one', eventSeq: 8, nativeSeq: 8, timestamp: Date.now(), payload: { ok: true, resultPreview: both } })
  await new Promise(r => setTimeout(r, 60))
  assert.equal(host.getStats().readsCovered, 2)
  assert.equal(host.getStats().stalesSeen, 0)
  console.log('PASS F05/R05: session/workspace attribution, explicit target isolation, multi-file coverage')
} finally { if (host) host.disposeAll('test'); await rm(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous }
