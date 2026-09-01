// M4-2 Corpus Adapter 测试(docs/M4-CONTRACT.md §7/§8/§14 + §19 矩阵 11-15/21):
// shadow-copy 临时目录(自建合法 sidecar+Markdown),零真实记忆接触。hard-fail guard。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M42-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M42-TEST] REJ:', r); process.exit(1) })
const {
  buildSourceCatalog, canonicalScopeGuard, loadCorpusSnapshot, sourceFingerprint, CorpusRegistry, canonicalize,
} = await import('../../lib/m4-corpus.js')
const { parseAnchors } = await import('../../lib/memory-anchor.js')

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
// shadow-copy 构造:真实 anchored Markdown → parseAnchors → 合法 sidecar(fileDigest/recordDigest 真算)
function makeShadow(root, relName, markdown) {
  const file = path.join(root, relName)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, markdown, 'utf8')
  const buf = readFileSync(file)
  const p = parseAnchors(buf)
  const fileDigest = sha256Hex(buf)
  const records = p.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId, anchorId: r.anchorId || null,
    anchorLine: r.anchorLine || null,
    anchorByteStart: r.markerByteStart, anchorByteEnd: r.markerByteEnd,
    heading: r.heading != null ? r.heading : null,
    lineStart: r.lineStart, lineEnd: r.lineEnd, byteStart: r.byteStart, byteEnd: r.byteEnd,
    bytes: r.bytes, chars: r.chars, recordDigest: r.recordDigest,
    sourceVersion: 1, fileDigest,
  }))
  const sc = {
    schemaVersion: 1, namespace: 'dsh-auto-memory',
    sourceFile: file, sourceEpoch: '11111111-1111-4111-8111-111111111111', sourceVersion: 1,
    fileDigest, newline: p.newline === 'crlf' ? 'crlf' : 'lf',
    updatedAt: 1700000000000, records,
  }
  return { file, sidecar: sc }
}
function writeSidecar(sideDir, file, sc) {
  mkdirSync(sideDir, { recursive: true })
  const h = createHash('sha256').update(canonicalize(file), 'utf8').digest('hex')
  writeFileSync(path.join(sideDir, h + '.json'), JSON.stringify(sc, null, 2) + '\n', 'utf8')
}
const anchoredMd = (id, heading, body) => '<!-- memory:' + id + ' -->\n## ' + heading + '\n' + body

// ---------- G1 catalog 三源/scope 授权 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m42-'))
  try {
    const cat = buildSourceCatalog({
      workspaceKey: canonicalize(ws),
      userMemoryPath: path.join(ws, '..', 'user-MEMORY.md'),
      workspaceMemoryPath: path.join(ws, 'MEMORY.md'),
      todayLogPath: path.join(ws, '2026-08-23.md'),
    })
    if (cat.sources.length !== 3) throw new Error('catalog must have exactly 3 sources, got ' + cat.sources.length)
    const refs = cat.sources.map((s) => s.sourceRef).join(',')
    if (!refs.includes('user:') || !refs.includes('workspace:') || !refs.includes('workspace-log:')) throw new Error('sourceRef prefixes wrong: ' + refs)
    console.log('G1 catalog 三源 ✓ (user/workspace/workspace-log 固定顺序)')
  } finally { rmSync(ws, { recursive: true, force: true }) }
}

// ---------- G2 loader:正常路径 + sidecar 校验链 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m42-'))
  try {
    const userMem = makeShadow(ws, 'user-MEMORY.md', anchoredMd('mem_' + 'a'.repeat(32), '用户偏好', '- 中文回复'))
    const wsMem = makeShadow(ws, 'ws/MEMORY.md', anchoredMd('mem_' + 'b'.repeat(32), '部署流程', '- pnpm build 后 rsync'))
    const log = makeShadow(ws, 'ws/2026-08-23.md', anchoredMd('mem_' + 'c'.repeat(32), '2026-08-23', '- 今日修复缓存穿透'))
    const sideDir = path.join(ws, 'side')
    writeSidecar(sideDir, userMem.file, userMem.sidecar)
    writeSidecar(sideDir, wsMem.file, wsMem.sidecar)
    writeSidecar(sideDir, log.file, log.sidecar)
    const cat = buildSourceCatalog({ workspaceKey: canonicalize(ws), userMemoryPath: userMem.file, workspaceMemoryPath: wsMem.file, todayLogPath: log.file })
    const res = loadCorpusSnapshot(cat, { sidecarDir: sideDir }, {})
    if (!res.ok) throw new Error('load failed: ' + res.reason)
    const snap = res.snapshot
    if (snap.records.length !== 3) throw new Error('expected 3 records, got ' + snap.records.length + ' | dropped=' + JSON.stringify(snap.dropped))
    for (const r of snap.records) {
      // 完整 M3 provenance
      if (!r.sourceEpoch || r.sourceVersion !== 1 || !/^[0-9a-f]{64}$/.test(r.fileDigest) || !/^[0-9a-f]{64}$/.test(r.recordDigest)) throw new Error('provenance incomplete')
      if (!/^mem_[0-9a-f]{32}$/.test(r.memoryId)) throw new Error('memoryId malformed')
    }
    if (!snap.memoryIndexVersion.startsWith('idx_')) throw new Error('index version prefix wrong')
    console.log('G2 loader 正常链 ✓ (3 记录, provenance 完整, idx_ 版本)')
  } finally { rmSync(ws, { recursive: true, force: true }) }
}

// ---------- G3 fail closed:missing/corrupt/mismatch/stale ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m42-'))
  try {
    const a = makeShadow(ws, 'user-MEMORY.md', anchoredMd('mem_' + 'a'.repeat(32), '用户偏好', '- x'))
    const b = makeShadow(ws, 'ws/MEMORY.md', anchoredMd('mem_' + 'b'.repeat(32), '部署流程', '- y'))
    const c = makeShadow(ws, 'ws/log.md', anchoredMd('mem_' + 'c'.repeat(32), '日志', '- z'))
    const sideDir = path.join(ws, 'side')
    writeSidecar(sideDir, a.file, a.sidecar)
    writeSidecar(sideDir, b.file, b.sidecar)
    writeSidecar(sideDir, c.file, c.sidecar)
    // missing:删除 c 的 sidecar
    rmSync(path.join(sideDir, createHash('sha256').update(canonicalize(c.file), 'utf8').digest('hex') + '.json'))
    // corrupt:b 的 sidecar 写垃圾
    const bHash = createHash('sha256').update(canonicalize(b.file), 'utf8').digest('hex')
    writeFileSync(path.join(sideDir, bHash + '.json'), '{broken', 'utf8')
    // mismatch:a 的 sidecar sourceFile 改指别处
    const aHash = createHash('sha256').update(canonicalize(a.file), 'utf8').digest('hex')
    const scA = JSON.parse(readFileSync(path.join(sideDir, aHash + '.json'), 'utf8'))
    scA.sourceFile = 'D:/somewhere/else.md'
    writeFileSync(path.join(sideDir, aHash + '.json'), JSON.stringify(scA), 'utf8')
    const cat = buildSourceCatalog({ workspaceKey: canonicalize(ws), userMemoryPath: a.file, workspaceMemoryPath: b.file, todayLogPath: c.file })
    const res = loadCorpusSnapshot(cat, { sidecarDir: sideDir }, {})
    if (!res.ok) throw new Error('fail-closed sources must not kill whole load, got: ' + res.reason)
    if (res.snapshot.records.length !== 0) throw new Error('all three must be dropped')
    for (const expect of ['sidecar-missing', 'sidecar-invalid', 'source-mismatch']) {
      if (!res.snapshot.dropped.some((d) => d.reason === expect)) throw new Error('drop reason missing: ' + expect + ' in ' + JSON.stringify(res.snapshot.dropped))
    }
    // stale:a 的文件被外部编辑(digest 不再匹配 sidecar;a 的 sidecar 已被 mismatch 篡改,改验 c 之外单独构造)
    const d4 = makeShadow(ws, 'ws/stale.md', anchoredMd('mem_' + 'd'.repeat(32), '将被外部编辑', '- 原始内容'))
    writeSidecar(sideDir, d4.file, d4.sidecar)
    writeFileSync(d4.file, anchoredMd('mem_' + 'd'.repeat(32), '将被外部编辑', '- 外部修改后的内容'), 'utf8')
    const cat2 = buildSourceCatalog({ workspaceKey: canonicalize(ws), userMemoryPath: a.file, workspaceMemoryPath: b.file, todayLogPath: c.file })
    const catStaleOnly = buildSourceCatalog({ workspaceKey: canonicalize(ws), workspaceMemoryPath: d4.file })
    const resS = loadCorpusSnapshot(catStaleOnly, { sidecarDir: sideDir }, {})
    if (!resS.ok) throw new Error('stale-only load failed')
    if (!resS.snapshot.dropped.some((d) => d.reason === 'stale-source')) throw new Error('externally edited file must be stale-source')
    const res2 = loadCorpusSnapshot(cat2, { sidecarDir: sideDir }, {})
    if (!res2.ok) throw new Error('load2 failed')
    // a 的 sidecar 已被 mismatch 步骤篡改 → guard 的 source-mismatch 先于 digest 校验(优先级正确)
    if (!res2.snapshot.dropped.some((d) => d.reason === 'source-mismatch' && d.sourceRef.includes('user:'))) throw new Error('tampered sidecar must be source-mismatch')
    console.log('G3 fail closed ✓ (missing/corrupt/mismatch/stale-source 全部带原因丢弃)')
  } finally { rmSync(ws, { recursive: true, force: true }) }
}

// ---------- G4 record-stale:byte range 越界与切片 digest 不匹配 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m42-'))
  try {
    const a = makeShadow(ws, 'user-MEMORY.md', anchoredMd('mem_' + 'a'.repeat(32), '用户偏好', '- x'))
    writeSidecar(path.join(ws, 'side'), a.file, (() => {
      const sc = JSON.parse(JSON.stringify(a.sidecar))
      // 篡改 record byte range 超界
      sc.records[0].byteEnd = 999999
      return sc
    })())
    const cat = buildSourceCatalog({ workspaceKey: canonicalize(ws), userMemoryPath: a.file })
    const res = loadCorpusSnapshot(cat, { sidecarDir: path.join(ws, 'side') }, {})
    if (!res.ok) throw new Error('load failed')
    if (res.snapshot.records.length !== 0 || !res.snapshot.dropped.some((d) => d.reason === 'record-stale')) throw new Error('out-of-range record must be record-stale')
    console.log('G4 record-stale ✓ (越界 range 拒绝)')
  } finally { rmSync(ws, { recursive: true, force: true }) }
}

// ---------- G5 scope guard:mismatch 与 symlink/reparse 逃逸拒绝 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m42-'))
  try {
    const src = { kind: 'workspace', scope: 'Workspace', file: path.join(ws, 'ws', 'MEMORY.md'), sourceRef: 'workspace:MEMORY.md' }
    // identical 通过用例要求文件真实存在(realpath 校验)
    mkdirSync(path.dirname(src.file), { recursive: true })
    writeFileSync(src.file, anchoredMd('mem_' + '5'.repeat(32), '占位', '- x'), 'utf8')
    // mismatch
    const gm = canonicalScopeGuard(src, 'D:/other/place.md')
    // 预期:guard 以 source-mismatch 拒绝(ok=false 是正确结果)
    if (gm.ok || gm.reason !== 'source-mismatch') throw new Error('mismatch must be flagged as rejection, got ' + JSON.stringify(gm))
    // 同一声明路径(realpath 相同)→ 通过
    const gok = canonicalScopeGuard(src, src.file)
    if (!gok.ok) throw new Error('identical declared must pass: ' + gok.reason)
    // 逃逸:realpath 返回声明目录之外(模拟注入 fsApi)→ cross-workspace 拒绝
    const outside = path.join(tmpdir(), 'outside-target.md')
    const gesc = canonicalScopeGuard(src, src.file, { realpathSync: () => outside })
    if (gesc.ok || gesc.reason !== 'cross-workspace') throw new Error('escape must be rejected cross-workspace, got ' + JSON.stringify(gesc))
    console.log('G5 scope guard ✓ (mismatch/逃逸拒绝/一致通过)')
  } finally { rmSync(ws, { recursive: true, force: true }) }
}

// ---------- G6 CorpusRegistry:fingerprint 缓存与失效 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m42-'))
  try {
    const mem = makeShadow(ws, 'MEMORY.md', anchoredMd('mem_' + 'b'.repeat(32), '部署流程', '- pnpm build'))
    const sideDir = path.join(ws, 'side')
    writeSidecar(sideDir, mem.file, mem.sidecar)
    const reg = new CorpusRegistry({ sidecarDir: sideDir })
    const rebuildCatalog = () => buildSourceCatalog({ workspaceKey: canonicalize(ws), workspaceMemoryPath: mem.file })
    const r1 = reg.get(rebuildCatalog())
    if (r1.fromCache !== false || r1.reloaded.length !== 1) throw new Error('first get must load')
    const v1 = r1.snapshot.memoryIndexVersion
    const r2 = reg.get(rebuildCatalog())
    if (r2.fromCache !== true || r2.reloaded.length !== 0) throw new Error('second get must reuse cache')
    if (r2.snapshot.memoryIndexVersion !== v1) throw new Error('cached version must match')
    // 外部编辑 → fingerprint 变化 → reload;但 sidecar 未更新 → stale-source drop(snapshot 空 records)
    writeFileSync(mem.file, anchoredMd('mem_' + 'b'.repeat(32), '部署流程', '- pnpm build 后加一行'), 'utf8')
    const r3 = reg.get(rebuildCatalog())
    if (r3.fromCache !== false) throw new Error('fingerprint change must trigger reload')
    if (r3.reloaded[0].indexOf('MEMORY.md') < 0) throw new Error('reloaded must report affected source')
    if (r3.snapshot.dropped.some((d) => d.reason === 'stale-source') === false && r3.snapshot.records.length !== 0) {
      // sidecar 也可能因 mtime 变化被重建?此处 sidecar 未动,digest 必不匹配
      throw new Error('stale-source expected after external edit without sidecar update')
    }
    // invalidate 强制全量重建
    reg.invalidate()
    const r4 = reg.get(rebuildCatalog())
    if (r4.fromCache !== false) throw new Error('invalidate must force full reload')
    console.log('G6 CorpusRegistry ✓ (fingerprint 复用/失效重载/invalidate)')
  } finally { rmSync(ws, { recursive: true, force: true }) }
}

console.log('\n[M4-2] ALL PASS: G1-G6 (shadow-copy fixture, 零真实记忆接触)')
