#!/usr/bin/env node
/** smoke-test-p8-rrf-wiring-pre —— P8 RRF 融合接入 recall L0 排序 回归锁定(2026-09-09)。
 * 覆盖:证据复现(rankFusionRRFPre 有调用方)/ 核心断言(同 lex 组排序随 sem 变化)/
 * legacy vs rrf 三查询 top-5 diff / k=60 复用 FUSION_RRF_K_V1 不硬编码 /
 * 排序确定性 / fail-soft(语义臂抛错→纯词法)/ legacy 开关 / 非 L0 分支零改动。
 * 方法:与 p4 同款 —— 提取 recall 方法源码绑定假引擎(动态 import 改写为绝对 URL)。
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const FUSION_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'recall-fusion.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }

function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

// ---------- G1 源码守卫 ----------
console.log('[p8-rrf-wiring] G1 源码守卫')
ok(SRC.includes("await import('./recall-fusion.js')"), 'recall() 动态 import rankFusionRRFPre 模块(证据 A 复现:此前零引用)')
ok(SRC.includes('rankFusionRRFPre(l0Hits.map'), 'RRF 调用接入 L0 命中排序')
ok(SRC.includes(".sort((a, b) => b.lex - a.lex || (b.sem || 0) - (a.sem || 0)"), '证据 B 复现:旧字典序排序保留为 legacy 回退分支')
ok(/if \(\(opts && opts\.fusion\) !== 'legacy'\)/.test(SRC), 'legacy 开关:opts.fusion === legacy 时走旧排序(默认 rrf)')
ok(/catch \(eRrf\) \{\}/.test(SRC), 'RRF fail-soft(动态 import/异常 → legacy 回落)')
ok(/FUSION_RRF_K_V1 = 60/.test(FUSION_SRC) && !/rankFusionRRFPre\([^)]*\{\s*k:/.test(SRC), 'k=60 来自 FUSION_RRF_K_V1 默认值,调用处无硬编码')
ok(SRC.includes("opts.fusion") && !SRC.includes("recallFusionMode"), '开关为参数 opts.fusion(不新增配置键,边界内)')

// ---------- 夹具 ----------
const hex32 = (c) => c.repeat(Math.ceil(32 / c.length)).slice(0, 32)
const memId = (c) => 'mem_' + hex32(c)
const anchorOf = (id) => `<!-- memory:${id} -->`
const REC = {
  a: '## Alpha 主题',
  b: '## Alpha 附录',
  c: '## Alpha Beta Gamma 汇总',
  d: '## Alpha Beta Gamma 详情',
  e: '## Beta Gamma 混合',
  f: '## Gamma 专题',
}
const ORDER = ['a', 'b', 'c', 'd', 'e', 'f']
const LOG_TEXT = ORDER.map((k) => anchorOf(memId(k)) + '\n' + REC[k]).join('\n')

const tmp = mkdtempSync(path.join(tmpdir(), 'p8-smoke-'))
const projDir = path.join(tmp, 'logs'); mkdirSync(projDir)
const reflectDir = path.join(tmp, 'reflections'); mkdirSync(reflectDir)
const logPath = path.join(projDir, '2026-09-09.md'); writeFileSync(logPath, LOG_TEXT, 'utf8')
const userFile = path.join(tmp, 'user-memory.md'); writeFileSync(userFile, '', 'utf8')
const notesPath = path.join(tmp, 'notes.md'); writeFileSync(notesPath, '', 'utf8')

function bindRecall(fake) {
  const fnSrc = extractFn("async recall(query, limit = 8, agent, scope = 'all', opts = null) {")
  const l0Url = JSON.stringify(new URL('../../lib/l0-extract.js', import.meta.url).href)
  const rrfUrl = JSON.stringify(new URL('../../lib/recall-fusion.js', import.meta.url).href)
  const arrow = ('async ' + fnSrc.slice(fnSrc.indexOf('('), fnSrc.indexOf(') {') + 1) + ' => ' + fnSrc.slice(fnSrc.indexOf(') {') + 2)).replaceAll("'./l0-extract.js'", l0Url).replaceAll("'./recall-fusion.js'", rrfUrl)
  const factory = new Function('path', 'homedir', 'return { recall: ' + arrow + ' };')
  const obj = factory.call(fake, path, homedir)
  return (...args) => obj.recall.apply(fake, args)
}
function fakeEngine(semMap) {
  return {
    resolvePaths: async () => ({ projectDir: projDir, reflectDir, userFile, notesPath, ws: tmp }),
    listDailyLogs: async () => [{ name: '2026-09-09.md' }],
    listReflections: async () => [],
    readTextSafe: async (p) => (p === logPath ? LOG_TEXT : ''),
    searchHandoffCorpus: async () => [],
    searchSessionHistory: async () => [],
    discoverWorkspaces: async () => [tmp],
    external: { search: async () => [] },
    // 语义臂:按 semMap 返回 {scores: Map(memoryId→sem)};throw 语义臂故障
    _jsSemanticRank: async () => {
      if (semMap === 'throw') throw new Error('semantic down')
      return { scores: new Map(Object.entries(semMap || {}).map(([k, v]) => [memId(k), v])) }
    },
  }
}
const l0Ids = (out) => (out.match(/\[mem_[0-9a-f]{32}\]/g) || []).map((s) => s.slice(1, 37))

// ---------- G2 legacy vs rrf 三查询 top-5 diff(验收 5.7) ----------
console.log('[p8-rrf-wiring] G2 legacy vs rrf 实测 diff')
const SEM1 = { a: 0.95, b: 0.9, e: 0.5 } // c/d 语义分 <0.5 阈值 → 无 sem(P2 阈值语义)
const eng1 = fakeEngine(SEM1)
const recall1 = bindRecall(eng1)
const queries = ['alpha beta gamma', 'alpha beta', 'gamma']
const diffs = []
for (const q of queries) {
  const legacyOut = await recall1(q, 8, undefined, 'all', { format: 'l0', fusion: 'legacy' })
  const rrfOut = await recall1(q, 8, undefined, 'all', { format: 'l0' })
  const legacy = l0Ids(legacyOut); const rrf = l0Ids(rrfOut)
  const diff = legacy.length === rrf.length && legacy.some((x, i) => x !== rrf[i])
  diffs.push(diff)
  console.log(`  q="${q}" legacy=${legacy.join(',')} rrf=${rrf.join(',')} diff=${diff}`)
}
ok(diffs.filter(Boolean).length === 3, '三条主题性查询 legacy/rrf top-5 序列均存在 diff')

// ---------- G3 核心断言:lex 相同、sem 不同 → 排序随 sem 变化 ----------
console.log('[p8-rrf-wiring] G3 核心断言(同 lex 组,sem 驱动排序)')
{
  const engA = fakeEngine({ a: 0.9, b: 0.5, c: 0.2 })
  const seqA = l0Ids(await bindRecall(engA)('alpha', 8, undefined, 'all', { format: 'l0' }))
  assert.deepEqual(seqA, ['a', 'b', 'c', 'd'].map((k) => memId(k)))
  ok(true, '同 lex=1 四条:有 sem 的三条按 sem 降序(a,b,c)在前,无 sem 的 d 垫底(dense 臂贡献 0)')
  const engB = fakeEngine({ a: 0.2, b: 0.5, c: 0.9 })
  const seqB = l0Ids(await bindRecall(engB)('alpha', 8, undefined, 'all', { format: 'l0' }))
  assert.notDeepEqual(seqA, seqB)
  ok(true, `sem 翻转后序列变化:${seqA.join(',')} → ${seqB.join(',')}(sem 参与排序;rank-space 下高 dense 秩与 memoryId 秩偏置按凸性博弈,平局由 id 收敛——诚实记录该性质)`)
}

// ---------- G4 确定性 ----------
console.log('[p8-rrf-wiring] G4 排序确定性')
{
  const s1 = l0Ids(await recall1('alpha beta gamma', 8, undefined, 'all', { format: 'l0' }))
  const s2 = l0Ids(await recall1('alpha beta gamma', 8, undefined, 'all', { format: 'l0' }))
  assert.deepEqual(s1, s2)
  ok(true, '同输入两次调用 id 序列逐项相等')
}

// ---------- G5 fail-soft:语义臂抛错 → 纯词法 ----------
console.log('[p8-rrf-wiring] G5 语义臂不可用 fail-soft')
{
  const engDown = fakeEngine('throw')
  const out = await bindRecall(engDown)('alpha beta gamma', 8, undefined, 'all', { format: 'l0' })
  const seq = l0Ids(out)
  assert.deepEqual(seq, ['c', 'd', 'e', 'a', 'b', 'f'].map((k) => memId(k)))
  ok(true, 'rank 抛错 → 无 sem → dense 臂全空 → RRF 退化为纯词法序(c,d,e,a,b),不报错不阻塞')
}

// ---------- G6 legacy 开关 + 非 L0 分支 ----------
console.log('[p8-rrf-wiring] G6 开关与非 L0 分支')
{
  const legacyOut = await recall1('alpha beta gamma', 8, undefined, 'all', { format: 'l0', fusion: 'legacy' })
  assert.deepEqual(l0Ids(legacyOut), ['c', 'd', 'e', 'a', 'b', 'f'].map((k) => memId(k)))
  ok(true, "fusion:'legacy' → 旧字典序(c,d,e,a,b),与 rrf 序不同")
  const oldOut = await recall1('alpha', 8, undefined, 'all')
  ok(oldOut.includes('== 本地记忆文件命中 ==') && !oldOut.includes('== L0 命中'), '非 L0 分支(不传 format)行为完全不变')
}

rmSync(tmp, { recursive: true, force: true })
console.log(`\n[p8-rrf-wiring] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
