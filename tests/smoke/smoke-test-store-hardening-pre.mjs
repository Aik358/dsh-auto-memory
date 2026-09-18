// 回归:三处 store 数据完整性小修(issue #55 / #56 / 冲突活引用)
// 1) storage-manage.readSidecarPrev 引用未定义 docStore → ReferenceError 被 catch 吞 → 恒 null
// 2) evidence-store 幂等缓存在落盘前登记 id,写失败一次后同 id 重试恒 duplicate-evidence
// 3) fact-store 冲突左侧持活引用,后续 merge 原地改写已落盘的冲突左侧
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

// —— 1) readSidecarPrev:repair 时应继承既有 sidecar 的 sourceEpoch/sourceVersion ——
{
  const { createStorageManagerPre } = await import('../../lib/storage-manage.js')
  const root = mkdtempSync(path.join(tmpdir(), 'dam-sm-'))
  const dir = path.join(root, 'mem'); mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'MEMORY.md')
  writeFileSync(file, '# MEMORY\n\n- 旧记录\n', 'utf8')
  const sidecarPath = path.join(dir, 'MEMORY.sidecar.json')
  writeFileSync(sidecarPath, JSON.stringify({ sourceEpoch: 'ep-old', sourceVersion: 3, fileDigest: 'dig-old' }), 'utf8')
  let captured = undefined
  const io = { readFileSync: (p) => readFileSync(p, 'utf8'), writeFileSync: () => {} }
  const docStore = {
    sidecarPath: () => sidecarPath,
    scanHealth: () => ({ ok: true, stale: [{ file }], missing: [], orphans: [] }),
    rebuildSidecar: (f, prev) => { captured = prev; return { ok: true } },
  }
  const mgr = createStorageManagerPre({ io, docStore, pathsOf: () => ({ memoryDir: dir, userMemoryDir: dir, projectMemoryDir: dir }) })
  try { await mgr.repair([{ file }]) } catch (_) {}
  ok(captured && captured.sourceEpoch === 'ep-old' && captured.sourceVersion === 3,
    '回归点:rebuildSidecar 收到既有 sidecar 的 prev (got ' + JSON.stringify(captured) + ')')
  rmSync(root, { recursive: true, force: true })
}

// —— 2) evidence append:写失败后同 evidenceId 重试应放行(幂等语义保持) ——
{
  const ES = await import('../../lib/evidence-store.js')
  const CB = await import('../../lib/context-bridge.js')
  const root = mkdtempSync(path.join(tmpdir(), 'dam-ev-'))
  // _writeLine 直接走 node:fs 的 appendFileSync;用"eventsDir 位置被一个文件占用"制造
  // mkdirSync 失败 → 首次写入 write-failed;删掉占位文件后即"磁盘恢复"。
  const eventsDir = path.join(root, 'ev')
  writeFileSync(eventsDir, 'x', 'utf8')
  const store = new ES.EvidenceEventStore({ eventsDir })
  const ev = CB.createAccessEvidencePre({
    kind: 'read', memoryId: 'mem_' + 'aa'.repeat(16), anchorId: 'memory:mem_x',
    scope: 'Workspace', workspaceKey: 'C:\\wsA',
    sessionId: 'sess-A', eventSeq: 3, contextVersion: 5,
    ts: 1700000000000, sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2,
    fileDigest: 'e'.repeat(64), recordDigest: 'c'.repeat(64),
  }).evidence
  ok(ev && ev.evidenceId && ev.evidenceId.startsWith('ev_'), '前置:构造合法 evidence (' + (ev && ev.evidenceId) + ')')
  const r1 = await store.append(ev)
  ok(r1.ok === false && r1.reason === 'write-failed', '前置:首次写失败 (got ' + JSON.stringify(r1).slice(0, 80) + ')')
  rmSync(eventsDir, { force: true }) // 释放占位文件 = 磁盘恢复
  const r2 = await store.append(ev)
  ok(r2.ok === true, '回归点:恢复后同 evidenceId 重试成功 (got ' + JSON.stringify(r2).slice(0, 80) + ')')
  const r3 = await store.append(ev)
  ok(r3.ok === false && r3.reason === 'duplicate-evidence', '幂等语义保持:成功后再喂仍去重')
  rmSync(root, { recursive: true, force: true })
}

// —— 3) fact-store 冲突左侧为检测时快照 ——
{
  const { createFactStorePre } = await import('../../lib/fact-store.js')
  const store = createFactStorePre({ io: { save() {}, load() { return [] }, clear() {} }, nowFn: () => 1700000000000 })
  const base = { scope: 'Workspace', subject: '部署流程', predicate: '使用工具', sourceKind: 'explicit', sourceClass: 'user-memory' }
  const r1 = store.upsert({ ...base, object: '脚本A', provenance: ['user-1'], confidence: 0.5 })
  ok(r1.ok && r1.outcome === 'created', '前置:写入事实A (got ' + JSON.stringify(r1).slice(0, 80) + ')')
  const r2 = store.upsert({ ...base, object: '脚本B', provenance: ['user-2'], confidence: 0.9 })
  ok(r2.ok && r2.outcome === 'conflict-added', '前置:产生冲突 (got ' + JSON.stringify(r2).slice(0, 80) + ')')
  // 对左侧事实做无关 merge:同 subject/predicate/object,不同来源 → 原地改写 provenance/confidence
  store.upsert({ ...base, object: '脚本A', provenance: ['user-1', 'user-3'], confidence: 0.95 })
  const pending = store.pendingConflicts()
  const cf = Array.isArray(pending) ? pending[0] : (pending && pending.items && pending.items[0])
  ok(cf && Array.isArray(cf.left.provenance) && cf.left.provenance.length === 1,
    '回归点:冲突左侧 provenance 保持检测时值 (got ' + JSON.stringify(cf && cf.left) + ')')
  ok(cf && cf.left.confidence === 0.5, '回归点:冲突左侧 confidence 保持 0.5 (got ' + (cf && cf.left.confidence) + ')')
  ok(cf && cf.right && cf.right.object === '脚本B', '右侧候选不受影响')
}

console.log(`\n[store-hardening] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
