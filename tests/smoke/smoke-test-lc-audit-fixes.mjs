/**
 * smoke-test-lc-audit-fixes —— L-C 车道四条修复的真执行回归（#255 / #268 / #272 / #270）。
 *
 * 判据纪律（CR-10）：每条都真 import / 真起进程 → 真构造 → 真调用 → 断言**副作用**；
 * 每条都配**变异负路径**：把被测逻辑改回缺陷形态（写入临时副本后真跑），
 * 断言缺陷形态确实现形（变异必红），而正式实现不复现（还原复绿）。
 *
 *   ① #255 shadow lexical 先截断后排序 ⇒ 最高分项落在输入尾部时被截掉。
 *   ② #268 PLAN 冲突副本未验证物理子目录 ⇒ 预置 junction 时副本逃逸出 handoff。
 *   ③ #272 审计保留仅首条执行（once 标志位）⇒ 首条之后的过期分片永不清。
 *   ④ #270 recall_rank 绕过信封校验 ⇒ 畸形信封仍被受理成 recall_rank_result。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-lc-'))
let pass = 0, fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' :: ' + extra : '')) }
}
const readProduction = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

/** 把生产文件复制到临时目录并按映射改写相对 import，得到「可独立 import 的变体」。 */
function variantOf(rel, fileName, mutators) {
  let src = readProduction(rel)
  for (const [needle, replacement, label] of mutators) {
    const hits = src.split(needle).length - 1
    assert.equal(hits, 1, 'mutation anchor hit exactly 1: ' + label)
    src = src.replace(needle, replacement)
  }
  src = src.replace(/from '\.\/([^']+)'/g, (_, name) => 'from ' + JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', name)).href))
  const p = path.join(temp, fileName)
  fs.writeFileSync(p, src)
  return pathToFileURL(p).href
}

// =====================================================================
console.log('[L-C] ① #255 shadow lexical：先全量排序、后截断')
// =====================================================================
{
  const { lexicalSearch } = await import(pathToFileURL(path.join(ROOT, 'lib/shadow-retrieval.js')).href)
  const TERM = '\u706f\u5854'                   // 灯塔
  const PHRASE = '\u90e8\u7f72\u6d41\u7a0b'   // 部署流程
  const pad = '\u6b63\u6587\u586b\u5145\u5185\u5bb9'
  const mk = (i, opts) => {
    const id = 'mem_' + String(i).padStart(32, '0')
    const body = opts.heading ? ('\u8fd9\u662f ' + PHRASE + ' \u7684\u8bb0\u5f55 ' + TERM) : (pad + ' ' + TERM + ' ' + pad)
    return {
      memoryId: id, anchorId: 'memory:' + id, scope: 'Workspace', sourceClass: 'workspace-notes',
      sourceRef: 'workspace:notes.md', sourceEpoch: 'ep', sourceVersion: 1,
      fileDigest: 'f'.repeat(64), recordDigest: 'd' + String(i).padStart(63, '0'),
      lineStart: i, lineEnd: i, byteStart: i * 10, byteEnd: i * 10 + 9,
      heading: opts.heading ? ('\u6807\u9898 ' + TERM) : ('\u666e\u901a\u6807\u9898 ' + pad),
      text: body, bytes: Buffer.byteLength(body, 'utf8'),
    }
  }
  const records = []
  for (let i = 0; i < 69; i++) records.push(mk(i, { heading: false }))
  const TOP = mk(999, { heading: true })
  records.push(TOP)
  const corpus = {
    memoryIndexVersion: 'idx_pre_' + 'a'.repeat(32),
    records,
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:notes.md', sourceEpoch: 'ep', sourceVersion: 1, fileDigest: 'f'.repeat(64) }],
  }
  const qp = {
    terms: [{ term: TERM, weight: 1 }], phrases: [PHRASE], queryDigest: 'q'.repeat(32),
    explicitRecall: 1, raw: TERM, termsRaw: [TERM],
  }
  const res = lexicalSearch(corpus, qp, { triggerTs: Date.now(), mode: 'retrieve' })

  ok(records.length === 70, '夹具：70 条记录（> rawHits 预算 64），实得 ' + records.length)
  ok(res.counts.records === 70, '夹具：语料确被读入 70 条，实得 ' + res.counts.records)
  ok(res.rawHits.length <= 64, 'rawHits 仍受 64 预算约束，实得 ' + res.rawHits.length)
  ok(res.kept.length <= 8, 'kept 仍受 8 预算约束，实得 ' + res.kept.length)
  const topIdx = res.kept.findIndex((k) => k.memoryId === TOP.memoryId)
  ok(topIdx === 0, '★尾部最高分项进入结果且排名第一（#255 核心判据），实得位次 ' + topIdx)
  const scores = res.kept.map((k) => k.scores.total)
  ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'kept 按分数非递增排列，实得 ' + JSON.stringify(scores))
  ok(res.counts.rawHits === res.rawHits.length, 'counts.rawHits 与实际一致')
  ok(res.dropped.filter((d) => d.reason === 'candidate-budget').length > 0, '确有条目因候选预算被丢弃（非空转）')

  const mutatedUrl = variantOf('lib/shadow-retrieval.js', 'shadow-retrieval-truncfirst.mjs', [[
    '  rawHits.sort((x, y) => {\n',
    '  rawHits.length = Math.min(rawHits.length, B.rawHits)\n  rawHits.sort((x, y) => {\n',
    '#255 restore truncate-before-sort',
  ]])
  const mutated = await import(mutatedUrl)
  const mres = mutated.lexicalSearch(corpus, qp, { triggerTs: Date.now(), mode: 'retrieve' })
  ok(!mres.kept.some((k) => k.memoryId === TOP.memoryId),
    '★变异（截断在前）后尾部最高分项**消失** ⇒ 负路径必红')
  ok(mres.kept.length === 8, '变异后 kept 仍满编（证明丢的是高分项而非空转），实得 ' + mres.kept.length)
}

// =====================================================================
console.log('[L-C] ② #268 PLAN 冲突副本：必须落在 handoff 的物理子目录内')
// =====================================================================
{
  const { conflictPlanPre } = await import(pathToFileURL(path.join(ROOT, 'lib/plan-store.js')).href)
  const mkTree = (name) => {
    const base = path.join(temp, name)
    fs.rmSync(base, { recursive: true, force: true })
    const handoff = path.join(base, 'handoff')
    const outside = path.join(base, 'outside')
    fs.mkdirSync(handoff, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    return { base, handoff, outside, plan: path.join(handoff, 'PLAN.md'), conflicts: path.join(handoff, 'conflicts') }
  }
  const OPTS = { expectedRevision: 'old-rev', cardId: null, expectedCardRevision: null }
  const countCopies = (dir) => fs.readdirSync(dir).filter((n) => /^PLAN-.*\.json$/.test(n)).length

  {
    const t = mkTree('ok')
    const r = await conflictPlanPre(t.plan, 'current-body', 'proposed-body', OPTS, 'plan-version-conflict')
    ok(r.ok === false && r.error === 'plan-version-conflict', '正路径：返回结构化冲突（ok:false + reason）')
    ok(fs.existsSync(r.conflictPath), '正路径：冲突副本已落盘')
    const inside = path.relative(t.handoff, r.conflictPath)
    ok(inside === path.join('conflicts', path.basename(r.conflictPath)), '正路径：副本在 handoff/conflicts 之内，实得 ' + inside)
    const payload = JSON.parse(fs.readFileSync(r.conflictPath, 'utf8'))
    ok(payload.schemaVersion === 'plan-conflict-v1' && payload.current === 'current-body' && payload.proposed === 'proposed-body', '正路径：副本内容为双方候选')
    ok(payload.currentRevision === r.revision, '正路径：副本 revision 与返回值一致')
  }

  for (const kind of ['junction', 'dangling']) {
    const t = mkTree('esc-' + kind)
    const target = kind === 'junction' ? t.outside : path.join(t.base, 'nowhere')
    fs.symlinkSync(target, t.conflicts, 'junction')
    let threw = null
    try { await conflictPlanPre(t.plan, 'cur', 'prop', OPTS, 'plan-version-conflict') }
    catch (e) { threw = e }
    ok(threw !== null, '★' + kind + '：越界 conflicts 被拒绝（抛错）')
    ok(threw && threw.code === 'PLAN_CONFLICT_DIR_ESCAPED', kind + '：错误码 PLAN_CONFLICT_DIR_ESCAPED，实得 ' + (threw && threw.code))
    ok(fs.existsSync(target) ? countCopies(target) === 0 : true, '★' + kind + '：外部目录零副本写入（逃逸未发生）')
  }

  {
    const t = mkTree('recover')
    fs.symlinkSync(t.outside, t.conflicts, 'junction')
    let rejected = false
    try { await conflictPlanPre(t.plan, 'cur', 'prop', OPTS, 'plan-version-conflict') } catch (_) { rejected = true }
    fs.rmSync(t.conflicts, { recursive: true, force: true })
    const r = await conflictPlanPre(t.plan, 'cur', 'prop', OPTS, 'plan-version-conflict')
    ok(rejected && fs.existsSync(r.conflictPath), '★移除越界链接后恢复正常写入（还原复绿）')
  }

  const mutatedUrl = variantOf('lib/plan-store.js', 'plan-store-noguard.mjs', [
    ["    const physical = fileWithinRoots(dir, [handoffDir], { strict: true, allowMissing: true })\n",
      '    const physical = dir\n', '#268 drop physical verification'],
    ['    if (!physical) {\n', '    if (false) {\n', '#268 disable reject branch'],
  ])
  const mutated = await import(mutatedUrl)
  const t = mkTree('mut')
  fs.symlinkSync(t.outside, t.conflicts, 'junction')
  const mr = await mutated.conflictPlanPre(t.plan, 'cur', 'prop', OPTS, 'plan-version-conflict')
  ok(countCopies(t.outside) === 1, '★变异（无物理校验）后副本逃逸到外部目录 ⇒ 负路径必红，实得 ' + countCopies(t.outside))
  ok(fs.realpathSync(path.dirname(mr.conflictPath)) === fs.realpathSync(t.outside),
    '★变异后 conflictPath 的**物理**父目录即外部目录，实得 ' + fs.realpathSync(path.dirname(mr.conflictPath)))
}

// =====================================================================
console.log('[L-C] ③ #272 审计保留：每条待审计记录都执行（非仅首条）')
// =====================================================================
{
  const driveHost = async (moduleUrl, homeDir) => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = homeDir
    try {
      const { MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests/lib/audit-engine.mjs')).href)
      const { createShadowHost } = await import(moduleUrl)
      const engine = new MemoryEngine(); engine.configLoaded = true
      // engine 级覆盖优先于环境变量（resolveDshHomeForEnginePre 判序）：
      // shadow-host 每次调用都重新解析 home，只靠 try/finally 还原 env 会漏写到真实用户目录。
      engine.__dshHomeOverride = homeDir
      Object.assign(engine.config, {
        memoryRoot: path.join(homeDir, 'mem'), userMemoryDir: path.join(homeDir, 'user'),
        memoryAnchorEnabled: true, associativeMemoryEnabled: true, shadowRetrievalEnabled: true,
        pythonBackendEnabled: false, dayBoundaryMinutes: 450,
      })
      const ws = path.join(homeDir, 'ws')
      const paths = { ws, userDir: engine.userDirOf(), notesPath: path.join(engine.projectDirOf(ws), 'MEMORY.md') }
      await engine.docStore.append(paths.notesPath, '## \u90e8\u7f72\n\u9879\u76ee\u90e8\u7f72\u4f7f\u7528 pnpm build\u3002')
      const host = createShadowHost({ engine: engine })
      const rt = { key: 'k1', sessionId: 's1', contextVersion: 1, agent: { session: { header: {} } } }
      host.capturePaths(rt.key, paths)
      const emit = async (eventSeq) => {
        host.onSegmentAccepted(rt, {
          id: 'seg_' + eventSeq, digest: String(eventSeq % 10).repeat(32), kind: 'user', eventSeq,
          nativeSeq: eventSeq, contextVersion: eventSeq, ts: Date.now(), eventType: 'user_message',
          text: '\u56de\u5fc6 \u4e0a\u6b21 \u8bb0\u5f97 \u4e0d\u5bf9 \u672a\u89e3\u51b3 \u63a5\u4e0b\u6765',
        }, { payload: {}, sessionId: 's1' })
        for (let i = 0; i < 240; i++) {
          if (host.debugView().auditWritten >= eventSeq) break
          await new Promise((r) => setTimeout(r, 25))
        }
      }
      return { host, emit }
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  }
  const seedStale = (auditDir, name) => {
    fs.mkdirSync(auditDir, { recursive: true })
    const p = path.join(auditDir, name)
    fs.writeFileSync(p, '{"seed":true}\n')
    const old = new Date(Date.now() - 40 * 86400000)
    fs.utimesSync(p, old, old)
    return p
  }
  const indexUrl = pathToFileURL(path.join(ROOT, 'lib/shadow-host.js')).href

  {
    const home = path.join(temp, 'home-real')
    const { host, emit } = await driveHost(indexUrl, home)
    const dv0 = host.debugView()
    assert.ok(dv0.auditDirPath.startsWith(home), 'fixture isolation: audit dir must live under temp home, got ' + dv0.auditDirPath)
    const auditDir = dv0.auditDirPath
    await emit(1)
    const staleA = seedStale(auditDir, '2020-01-01.jsonl')
    await emit(2)
    ok(!fs.existsSync(staleA), '第 2 条记录：过期分片被清（基线行为）')
    const staleB = seedStale(auditDir, '2020-01-02.jsonl')
    await emit(3)
    ok(!fs.existsSync(staleB), '★第 3 条记录：过期分片同样被清（#272 核心判据；旧写法此处恒不清）')
    const dv = host.debugView()
    ok(dv.auditWritten === 3, '★三条待审计记录各被处理一次，实得 auditWritten=' + dv.auditWritten)
    const shards = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'))
    const lines = shards.map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('').trim().split('\n').filter(Boolean)
    ok(lines.length === 3, '★三条记录各留一行 durable audit，实得 ' + lines.length)
    ok(lines.every((l) => { try { return JSON.parse(l).schemaVersion === 1 } catch (_) { return false } }), 'audit 行为合法 JSON 且 schemaVersion=1')
    ok(dv.lastAuditError === null, '无 audit 写入错误，实得 ' + dv.lastAuditError)
    host.disposeAll('test')
  }

  const mutatedUrl = variantOf('lib/shadow-host.js', 'shadow-host-once.mjs', [[
    "        maybeRetentionSweep(dir, Buffer.byteLength(line, 'utf8'))\n",
    "        if (!globalThis.__lcSweptOnce) { globalThis.__lcSweptOnce = true; maybeRetentionSweep(dir, Buffer.byteLength(line, 'utf8')) }\n",
    '#272 restore once-only sweep',
  ]])
  {
    delete globalThis.__lcSweptOnce
    const home = path.join(temp, 'home-mut')
    const { host, emit } = await driveHost(mutatedUrl, home)
    const auditDir = host.debugView().auditDirPath
    const staleA = seedStale(auditDir, '2020-01-01.jsonl')
    await emit(1)
    ok(!fs.existsSync(staleA), '变异：第 1 条仍清了首个过期分片（证明变异非空转且已执行到保留逻辑）')
    const staleB = seedStale(auditDir, '2020-01-02.jsonl')
    await emit(2)
    ok(fs.existsSync(staleB), '★变异（仅首条执行）后第 2 条不再清过期分片 ⇒ 负路径必红')
    ok(host.debugView().auditWritten === 2, '变异后两条记录仍都落盘（只少了保留，不是没跑）')
    host.disposeAll('test')
    delete globalThis.__lcSweptOnce
  }
}

// =====================================================================
console.log('[L-C] ④ #270 recall_rank：畸形信封必须走既有校验路径被拒')
// =====================================================================
{
  const pyDir = path.join(ROOT, 'python')
  const mkWorker = (name, mutators) => {
    const dir = path.join(temp, name)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    for (const f of fs.readdirSync(pyDir)) if (f.endsWith('.py')) fs.copyFileSync(path.join(pyDir, f), path.join(dir, f))
    if (mutators) {
      const wp = path.join(dir, 'worker_semantic_v1.py')
      let src = fs.readFileSync(wp, 'utf8').replace(/\r\n/g, '\n')
      for (const [needle, replacement, label] of mutators) {
        const hits = src.split(needle).length - 1
        assert.equal(hits, 1, 'py mutation anchor hit exactly 1: ' + label)
        src = src.replace(needle, replacement)
      }
      fs.writeFileSync(wp, src.replace(/\n/g, '\r\n'))
    }
    const home = path.join(dir, 'home'); fs.mkdirSync(home, { recursive: true })
    return { dir, home, script: path.join(dir, 'worker_semantic_v1.py') }
  }
  const runWorker = (w, frames) => {
    const input = frames.map((f) => JSON.stringify(f)).join('\n') + '\n'
    const r = spawnSync('python', [w.script, '--expect-epoch', 'ep', '--dsh-home', w.home],
      { cwd: pyDir, input, encoding: 'utf8', timeout: 120000 })
    assert.equal(r.error, undefined, 'python spawn error: ' + String(r.error))
    return String(r.stdout || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  }
  const envelope = (over) => Object.assign({
    protocolVersion: 'm7_wire_pre_v1', frameId: 'f1', requestId: 'r1', workerEpoch: 'ep',
    type: 'recall_rank', sentAt: 12,
    payload: { query: 'x', workspaceKey: 'wsr_' + '0'.repeat(32), scope: 'Workspace', memoryIndexVersion: 'idx_pre_' + '0'.repeat(32), topK: 5 },
  }, over)
  // 这四类只在 envelope_shape_ok 里校验 ⇒ 类型白名单旁路一旦恢复，它们必被受理
  const ENVELOPE_ONLY = [
    ['protocolVersion 不符', { protocolVersion: 'WRONG' }],
    ['frameId 缺失', { frameId: undefined }],
    ['requestId 非字符串', { requestId: 123 }],
    ['sentAt 为布尔', { sentAt: true }],
  ]
  // payload 另在 handler 里解引用 ⇒ 单独列出，仅用于正路径的「统一拒绝」判据
  const ALL_MALFORMED = ENVELOPE_ONLY.concat([['payload 非对象', { payload: 'not-a-dict' }]])

  {
    const w = mkWorker('py-ok', null)
    const out = runWorker(w, [envelope({})])
    ok(out.length === 1 && out[0].type === 'recall_rank_result', '正路径：合法 recall_rank 照常受理，实得 ' + (out[0] && out[0].type))
    ok(out[0].payload && Array.isArray(out[0].payload.scores), '正路径：返回结构含 scores 数组')
  }
  {
    const w = mkWorker('py-bad', null)
    const out = runWorker(w, ALL_MALFORMED.map(([, over], i) => envelope(Object.assign({ frameId: 'f' + i, requestId: 'r' + i }, over))))
    ALL_MALFORMED.forEach(([label], i) => {
      const fr = out[i]
      ok(fr && fr.type === 'error' && fr.payload && fr.payload.code === 'invalid-envelope',
        '★' + label + '：按既有校验路径拒绝（invalid-envelope），实得 ' + (fr && fr.type) + '/' + (fr && fr.payload && fr.payload.code))
    })
  }
  const mutated = mkWorker('py-mut', [[
    "        envelope = dict(obj, type='health') if isinstance(obj, dict) and obj.get('type') == 'recall_rank' else obj\n        if not base.envelope_shape_ok(envelope):\n",
    "        if not (isinstance(obj, dict) and obj.get('type') == 'recall_rank') and not base.envelope_shape_ok(obj):\n",
    '#270 restore envelope bypass',
  ]])
  const out = runWorker(mutated, ENVELOPE_ONLY.map(([, over], i) => envelope(Object.assign({ frameId: 'f' + i, requestId: 'r' + i }, over))))
  ENVELOPE_ONLY.forEach(([label], i) => {
    const fr = out[i]
    ok(fr && fr.type === 'recall_rank_result',
      '★变异（绕过信封）后「' + label + '」被受理 ⇒ 负路径必红，实得 ' + (fr && fr.type))
  })
}

fs.rmSync(temp, { recursive: true, force: true })
console.log('[L-C] PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
