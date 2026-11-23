#!/usr/bin/env node
/**
 * smoke-test-issue539-replay-from-file.mjs —— #539：`replayFromFile` 调用了未定义的 `replay`。
 *
 * ============================ 根因（实测定位）============================
 *   lib/shadow-host.js:19    lexicalSearch, buildCandidates, buildRetrievalId, replay as replayCore,
 *                            ↑ import 时已把 replay 重命名为 replayCore
 *   lib/shadow-host.js:399     return replay(fixture)     ← 函数体仍调旧名 ⇒ ReferenceError
 * 修法：:399 改 `replayCore(fixture)`（一处一词，不新增同名包装器）。
 *
 * ============================ 验收判据（CR-10）============================
 *  R-1 真构造 createShadowHost → replayFromFile(合法夹具) **返回非空数组**，且 gate 是真实决策
 *  R-2 结果与**直接调核心 replay()** 逐字节一致（证明走同一份纯核心，不是兜底空值）
 *  R-3 同夹具两次调用逐字节一致（纯函数语义）
 *  R-4 负路径①：非法 JSON ⇒ 抛 SyntaxError（不得静默返回）
 *  R-5 负路径②：文件不存在 ⇒ 抛 ENOENT
 *  R-6 负路径③：夹具**形状**能解析但快照非法 ⇒ 逐条 error:true + suppress（fail-soft 但**不谎报成功**）
 *  MUT-539 变异：把 `replayCore` 改回 `replay` ⇒ 必须复现 ReferenceError（R-1 路径必红），源文件不变
 */
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = path.resolve(HERE, '..', '..')
const LIB = path.join(ROOT, 'lib')
const HOST_PATH = path.join(LIB, 'shadow-host.js')
const CORE_PATH = path.join(LIB, 'shadow-retrieval.js')

const HOST = await import(pathToFileURL(HOST_PATH).href)
const CORE = await import(pathToFileURL(CORE_PATH).href)

let pass = 0, fail = 0, skip = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ok - ' + name + (detail ? '  :: ' + detail : '')) }
  else { fail++; console.error('  FAIL - ' + name + (detail ? '  :: ' + detail : '')) }
}
const skipped = (name, why) => { skip++; console.log('  SKIP - ' + name + '  :: ' + why) }

// 临时目录：优先系统 tmp，不可用时退到仓内 .verify-tmp（沙箱里 os.tmpdir() 曾返回相对路径）
const tempRoot = (() => {
  const tryDir = (base) => { try { fs.mkdirSync(base, { recursive: true }); return fs.mkdtempSync(path.join(base, 'dam-539-')) } catch (_) { return null } }
  return tryDir(process.env.TEMP || '/tmp') || tryDir(path.join(ROOT, '.verify-tmp')) || null
})()
if (!tempRoot) { console.log('[539] 0 PASS / 0 FAIL / 1 SKIP  :: 无法创建临时目录'); process.exit(0) }
const cleanup = () => { try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch (_) {} }
process.on('exit', cleanup)

// ── 合法夹具：trigger.text 命中 explicitRecall 词典 + window 有对应文本 ⇒ gate=retrieve 且 candidates>0 ──
//   （这是刻意「真跑出结果」的夹具：空夹具会让本套件变成恒真守卫）
const mkSnap = (over = {}) => Object.assign({
  schemaVersion: 1, sessionId: 'sess-539', agentId: 'agent-a',
  workspaceKey: 'D:/ws-a', sessionClass: 'top-level', contextVersion: 5, eventSeq: 42,
  trigger: { segmentId: 'seg-t1', segmentDigest: 'digest-trigger-0000001', kind: 'user', eventType: 'user/message', ts: 1724300000000 },
  window: [],
}, over)
const FIXTURE = {
  contextSnapshots: [mkSnap({
    contextVersion: 7,
    trigger: { segmentId: 'seg-t1', segmentDigest: 'digest-trigger-0000001', kind: 'user', eventType: 'user/message', ts: 1000, text: '回忆一下部署流程' },
    window: [{ segmentId: 'seg-w1', digest: 'digest-w100000000001', kind: 'user', eventSeq: 40, contextVersion: 4, ts: 1724299000000, text: '部署流程是怎样的' }],
  })],
  corpusSnapshot: {
    memoryIndexVersion: 'idx_pre_replay539',
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f' }],
    records: [{ memoryId: 'mem_' + 'ef'.repeat(16), scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f', recordDigest: 'rd-ef', lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 40, heading: '部署流程', text: '部署流程使用 pnpm build 后 rsync 到服务器' }],
  },
}
const fixturePath = path.join(tempRoot, 'fixture-ok.json')
fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE), 'utf8')

const mkEngine = () => ({
  config: { associativeMemoryEnabled: false, shadowRetrievalEnabled: false, memoryAnchorEnabled: false },
  configLoaded: true, __dshHomeOverride: null,
})
const host = HOST.createShadowHost({ engine: mkEngine() })

console.log('[R-0] 构造契约')
ok(typeof host.replayFromFile === 'function', 'R-0a createShadowHost 返回对象上存在 replayFromFile（真构造，非模块级导出）')
ok(typeof CORE.replay === 'function', 'R-0b 核心 replay 是函数（对照组可用）')

console.log('[R-1] 合法夹具 ⇒ 得到预期结果（不是空对象/undefined）')
let viaHost = null
try { viaHost = host.replayFromFile(fixturePath) }
catch (e) { ok(false, 'R-1 replayFromFile 不得抛错', String((e && e.message) || e)) }
ok(Array.isArray(viaHost), 'R-1a 返回值是数组', 'typeof=' + (viaHost === null ? 'null' : typeof viaHost))
ok(Array.isArray(viaHost) && viaHost.length === FIXTURE.contextSnapshots.length,
  'R-1b 长度等于 contextSnapshots 条数', 'got=' + (Array.isArray(viaHost) ? viaHost.length : 'n/a') + ' want=' + FIXTURE.contextSnapshots.length)
const c0 = Array.isArray(viaHost) && viaHost[0] && viaHost[0].canonical
ok(!!c0, 'R-1c 第 1 条含 canonical（不是空对象）')
ok(!!(c0 && c0.retrievalId && String(c0.retrievalId).startsWith('ret_pre_')), 'R-1d retrievalId 前缀正确', c0 && c0.retrievalId)
ok(!!(c0 && c0.gate && c0.gate.action === 'retrieve'), 'R-1e gate.action=retrieve（真实决策，非 suppress 兜底）', c0 && c0.gate && c0.gate.action);
ok(!!(viaHost && viaHost[0] && viaHost[0].error !== true), 'R-1f 该条**不带** error 标记（不是 fail-soft 兜底路径）')
ok(!!(c0 && Array.isArray(c0.candidates) && c0.candidates.length > 0),
  'R-1g 真的产出了候选（>0）—— 空夹具会让本判据失效，故必须 >0', 'candidates=' + (c0 && c0.candidates ? c0.candidates.length : 'n/a'))

console.log('[R-2] 与直接调核心 replay() 逐字段一致')
const viaCore = CORE.replay(FIXTURE)
ok(JSON.stringify(viaHost) === JSON.stringify(viaCore), 'R-2a replayFromFile 输出 === 核心 replay 输出（逐字节）')
ok(JSON.stringify(viaCore).indexOf('candidates') > 0, 'R-2b 对照输出非空（负向保护：对照也空则本断言无意义）')

console.log('[R-3] 纯函数语义：同夹具两次调用逐字节一致')
ok(JSON.stringify(host.replayFromFile(fixturePath)) === JSON.stringify(viaHost), 'R-3a 两次调用结果逐字节相同')

console.log('[R-4] 负路径①：非法 JSON 必须明确抛错')
const badPath = path.join(tempRoot, 'fixture-bad-json.json')
fs.writeFileSync(badPath, '{ this is not json', 'utf8')
{
  let threw = null, ret;
  try { ret = host.replayFromFile(badPath) } catch (e) { threw = e }
  ok(!!threw, 'R-4a 非法 JSON ⇒ 抛错（不得静默返回）', threw ? 'threw=' + (threw.constructor && threw.constructor.name) : 'returned=' + JSON.stringify(ret).slice(0, 60))
  ok(!!threw && threw instanceof SyntaxError, 'R-4b 抛的是 SyntaxError（明确类型）', threw && threw.constructor && threw.constructor.name)
}

console.log('[R-5] 负路径②：文件不存在必须明确抛错')
{
  let threw = null, ret;
  try { ret = host.replayFromFile(path.join(tempRoot, 'no-such-file.json')) } catch (e) { threw = e }
  ok(!!threw, 'R-5a 文件不存在 ⇒ 抛错', threw ? 'threw=' + (threw.code || threw.name) : 'returned=' + JSON.stringify(ret))
  ok(!!threw && threw.code === 'ENOENT', 'R-5b 错误码是 ENOENT', threw && threw.code)
}

console.log('[R-6] 负路径③：JSON 合法但快照非法 ⇒ fail-soft 逐条标错，不得谎报成功')
{
  const p = path.join(tempRoot, 'fixture-bad-shape.json')
  // 形状非法：contextSnapshots 是字符串（可解析的 JSON），逐条都不是合法 snapshot
  fs.writeFileSync(p, JSON.stringify({ contextSnapshots: ['not-a-snapshot', 'also-bad'], corpusSnapshot: { sources: [], records: [] } }), 'utf8')
  let threw = null, ret;
  try { ret = host.replayFromFile(p) } catch (e) { threw = e }
  ok(!threw && Array.isArray(ret), 'R-6a 不抛错、返回数组（replay 对单条非法快照是 fail-soft 设计）', threw ? 'threw=' + threw.message : 'len=' + (ret && ret.length))
  ok(Array.isArray(ret) && ret.length === 2, 'R-6b 条数与输入一致', ret && ret.length)
  ok(Array.isArray(ret) && ret.every((x) => x && x.error === true), '★R-6c 每条都带 error:true（不得谎报成功）')
  ok(Array.isArray(ret) && ret.every((x) => x && x.canonical && x.canonical.gate && x.canonical.gate.action === 'suppress'),
    '★R-6d 每条 gate.action=suppress（非法快照不得产 retrieve）')
  ok(Array.isArray(ret) && ret.every((x) => x && x.canonical && !x.canonical.candidates), 'R-6e 非法快照不产出 candidates')
}

console.log('[MUT-539] 变异：把 replayCore 改回 replay ⇒ 必须复现 ReferenceError')
{
  const orig = fs.readFileSync(HOST_PATH, 'utf8')
  const fixedAnchor = '    return replayCore(fixture)'
  const n = orig.split(fixedAnchor).length - 1
  ok(n === 1, 'MUT-539a 修复锚串在源码中恰命中 1 次（否则变异无从施加）', 'scope=' + n)
  if (n !== 1) {
    skipped('MUT-539b/c', '锚串未唯一命中，拒绝施加变异');
  } else {
    // ★变异副本必须落在 lib/ 内：shadow-host.js 用相对路径 import './datadir.js' 等，换目录会 ERR_MODULE_NOT_FOUND
    const mutPath = path.join(LIB, '.shadow-host-mut-539-' + process.pid + '.mjs')
    try {
      fs.writeFileSync(mutPath, orig.replace(fixedAnchor, '    return replay(fixture)'), 'utf8')
      const MUT = await import(pathToFileURL(mutPath).href)
      const mhost = MUT.createShadowHost({ engine: mkEngine() })
      let mThrew = null, mRet;
      try { mRet = mhost.replayFromFile(fixturePath) } catch (e) { mThrew = e }
      ok(!!mThrew, '★MUT-539b 变异体（replay 未定义）调用即抛错 ⇒ 缺陷可复现', mThrew ? String(mThrew.message || mThrew).slice(0, 80) : 'returned=' + JSON.stringify(mRet).slice(0, 60))
      ok(!!mThrew && /replay is not defined|replay is not a function/.test(String(mThrew.message || '')),
        '★MUT-539c 抛错信息指向未定义的 replay', mThrew && mThrew.message)
      ok(!(mRet !== undefined), '★MUT-539d 变异体没有返回任何结果（证明 R-1 的返回值只能来自修复）')
    } finally {
      try { fs.unlinkSync(mutPath) } catch (_) {}
    }
  }
  ok(fs.readFileSync(HOST_PATH, 'utf8') === orig, 'MUT-539e 产品源文件全程未被改动（变异只在副本上）')
}

console.log('');
console.log('[539] ' + pass + ' PASS / ' + fail + ' FAIL / ' + skip + ' SKIP')
process.exit(fail ? 1 : 0)
