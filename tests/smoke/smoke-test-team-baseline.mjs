#!/usr/bin/env node
/**
 * smoke-test-team-baseline.mjs —— 团队版「记忆基线」编解码 ★真 import → 真调用 → 断言返回值（CR-10 最高档）。
 *
 * ★为什么本套件必须真跑：基线模块的全部价值在「**校验**」——
 *   而校验类断言最容易写成恒真守卫（例如只看源码里有没有 checksum 字样）。
 *   ⇒ 本套件每条都断言**真实返回值**，并额外做一次**变异反向验证**：
 *     把 checksum 比较那一行删掉后，篡改包必须被接受（证明断言测的是真行为，不是恒绿）。
 *
 * 覆盖：
 *  ① 正向：打包 → 解包 → 文件逐字节一致
 *  ② 体积：HTTP 体积必须 < 1MB（nginx `client_max_body_size` 默认值，超了会 413）
 *  ③ 负路径 ×8：必需文件缺失 / 白名单外文件 / 坏 JSON / 无 events 数组 /
 *     checksum 篡改 / body 截断 / 格式版本不符 / 畸形入参（null·undefined·{}·''·42·[]）
 *  ④ checksum 语义：只依赖内容（改 at/by 不变）、改一字节必变
 *  ⑤ baselineSamePre：同内容 true / 不同 false / 缺 checksum 拒
 *  ⑥ 变异反向验证：去掉 checksum 比较 ⇒ 篡改包被接受（必须红-转-绿可复现）
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const MOD_URL = pathToFileURL(path.join(ROOT, 'lib', 'team-baseline.js')).href
const M = await import(MOD_URL)

const {
  packBaselinePre,
  unpackBaselinePre,
  baselineChecksumPre,
  baselineSamePre,
  TEAM_BASELINE_FORMAT_PRE,
  TEAM_BASELINE_REQUIRED_PRE,
} = M

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass++ } catch (e) { fail++; console.log('FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 240)) }
}

const EV = JSON.stringify({ events: [{ id: 'evt_aaaaaaaa', name: 'A' }, { id: 'evt_bbbbbbbb', name: 'B' }], total: 2 })
const PLAN = '# 白板\n内容'
const PM = '# 项目\n笔记'
const UM = '# 用户\n规则'
const baseFiles = { 'event-store.json': EV, 'PLAN.md': PLAN, 'MEMORY.project.md': PM, 'MEMORY.user.md': UM }

// ── 模块契约（真 import 的对象本身）
ok('导出的是纯函数（不是类/不是 undefined）', () => {
  for (const f of ['packBaselinePre', 'unpackBaselinePre', 'baselineChecksumPre', 'baselineSamePre']) {
    assert.equal(typeof M[f], 'function', f + ' 必须是函数')
  }
})
ok('格式版本是正整数', () => assert(Number.isInteger(TEAM_BASELINE_FORMAT_PRE) && TEAM_BASELINE_FORMAT_PRE >= 1))
ok('必需文件清单含 event-store.json', () => assert(TEAM_BASELINE_REQUIRED_PRE.includes('event-store.json')))

// ── ① 正向：打包 → 解包 → 逐字节一致
const p = packBaselinePre({ files: baseFiles, by: { id: 'u1', name: '阿三' }, memoryFormat: 'v4', at: 1700000000000 })
ok('pack 成功且编码是 br+base64 字符串', () => {
  assert.equal(p.ok, true)
  assert.equal(p.payload.enc, 'br+base64')
  assert.equal(typeof p.payload.body, 'string')
  assert(p.payload.body.length > 0)
})
// ── ② 体积判据：必须 < 1MB（nginx client_max_body_size 默认值）
ok('HTTP 体积 < 1MB（否则服务端 413）', () => {
  assert(p.payload.body.length < 1024 * 1024, '实际 ' + p.payload.body.length + ' 字节')
})
ok('pack 带 by/at/memoryFormat', () => {
  assert.equal(p.payload.by.name, '阿三')
  assert.equal(p.payload.at, 1700000000000)
  assert.equal(p.payload.memoryFormat, 'v4')
})
ok('pack files 清单已排序', () => {
  assert.deepEqual(p.payload.files, ['MEMORY.project.md', 'MEMORY.user.md', 'PLAN.md', 'event-store.json'])
})

const u = unpackBaselinePre(p.payload)
ok('unpack 成功', () => assert.equal(u.ok, true))
ok('unpack 文件内容与原文逐字节一致', () => {
  for (const k of Object.keys(baseFiles)) assert.equal(u.files[k], baseFiles[k], 'mismatch: ' + k)
})
ok('unpack meta 回填 by/checksum', () => {
  assert.equal(u.meta.by.name, '阿三')
  assert.equal(u.meta.checksum, p.payload.checksum)
})

// ── ③ 负路径 ×8
ok('neg 必需文件缺失被拒', () => {
  const r = packBaselinePre({ files: { 'PLAN.md': PLAN } })
  assert.equal(r.ok, false)
  assert(/required-file-missing/.test(r.reason), r.reason)
})
ok('neg 白名单外文件不入包（prev-req / index.json）', () => {
  const r = packBaselinePre({ files: Object.assign({}, baseFiles, { 'prev-req-xxx.md': 'DEBUG', 'index.json': '{}' }) })
  assert.equal(r.ok, true)
  assert(!r.payload.files.includes('prev-req-xxx.md'))
  assert(!r.payload.files.includes('index.json'))
})
ok('neg event-store 坏 JSON 被拒', () => {
  const r = packBaselinePre({ files: { 'event-store.json': '{broken' } })
  assert.equal(r.ok, false)
  assert(/event-store-bad-json/.test(r.reason), r.reason)
})
ok('neg event-store 无 events 数组被拒', () => {
  const r = packBaselinePre({ files: { 'event-store.json': '{"foo":1}' } })
  assert.equal(r.ok, false)
  assert(/event-store-no-events/.test(r.reason), r.reason)
})
ok('neg checksum 篡改被拒（核心）', () => {
  const t = JSON.parse(JSON.stringify(p.payload))
  t.checksum = 'deadbeef'.repeat(8)
  const r = unpackBaselinePre(t)
  assert.equal(r.ok, false)
  assert(/checksum-mismatch/.test(r.reason), r.reason)
})
ok('neg body 截断被拒', () => {
  const c = JSON.parse(JSON.stringify(p.payload))
  c.body = c.body.slice(0, Math.floor(c.body.length / 2))
  const r = unpackBaselinePre(c)
  assert.equal(r.ok, false)
  assert(/brotli-decode-failed|json-parse-failed|checksum-mismatch|inner-/.test(r.reason), r.reason)
})
ok('neg 格式版本不符被拒', () => {
  const v = JSON.parse(JSON.stringify(p.payload))
  v.v = 99
  const r = unpackBaselinePre(v)
  assert.equal(r.ok, false)
  assert(/format-mismatch/.test(r.reason), r.reason)
})
ok('neg 畸形入参全被拒且不抛', () => {
  for (const bad of [null, undefined, {}, '', 42, []]) {
    const r = unpackBaselinePre(bad)
    assert.equal(r.ok, false, '应拒绝: ' + JSON.stringify(bad))
  }
})

// ── ④ checksum 语义
ok('checksum 只依赖内容（改动 at/by 不变）', () => {
  const p2 = packBaselinePre({ files: baseFiles, by: { id: 'u9', name: '别人' }, at: 999 })
  assert.equal(p2.payload.checksum, p.payload.checksum)
})
ok('改一字节 checksum 必变', () => {
  const changed = Object.assign({}, baseFiles, { 'PLAN.md': PLAN + 'x' })
  assert.notEqual(baselineChecksumPre(changed), baselineChecksumPre(baseFiles))
})

// ── ⑤ baselineSamePre
ok('same 判定：同内容 true', () => {
  const p2 = packBaselinePre({ files: baseFiles, at: 999 })
  const r = baselineSamePre(p.payload, p2.payload)
  assert.equal(r.ok, true)
  assert.equal(r.same, true)
})
ok('same 判定：不同内容 false', () => {
  const r = baselineSamePre(p.payload, { checksum: 'zzz' })
  assert.equal(r.ok, true)
  assert.equal(r.same, false)
})
ok('neg same：缺 checksum 被拒', () => {
  const r = baselineSamePre({}, {})
  assert.equal(r.ok, false)
})

// ── ⑥ 变异反向验证（本条证明前面所有 checksum 断言测的是**真行为**）
ok('变异验证：删掉 checksum 比较 ⇒ 篡改包被接受（可复现）', async () => {})
{
  const srcTxt = readFileSync(path.join(ROOT, 'lib', 'team-baseline.js'), 'utf8')
  const anchor = "if (want !== got) return { ok: false, reason: 'checksum-mismatch: want ' + want.slice(0, 16) + ' got ' + got.slice(0, 16) }"
  const hits = srcTxt.split(anchor).length - 1
  assert.equal(hits, 1, '变异锚串必须恰好命中 1 次，实际 ' + hits)
  const mutated = srcTxt.replace(anchor, '/* mutated: checksum compare removed */')
  const tmpDir = path.join(ROOT, '.tmp-smoke-run')
  try { mkdirSync(tmpDir, { recursive: true }) } catch (_) {}
  const tmpFile = path.join(tmpDir, '_mut-team-baseline-' + process.pid + '.mjs')
  writeFileSync(tmpFile, mutated, 'utf8')
  const MM = await import(pathToFileURL(tmpFile).href + '?t=' + Date.now())
  const t = JSON.parse(JSON.stringify(p.payload))
  t.checksum = 'deadbeef'.repeat(8)
  const r = MM.unpackBaselinePre(t)
  assert.equal(r.ok, true, '变异后篡改包**必须**被接受，否则说明 checksum 断言是恒绿守卫')
  try { (await import('node:fs')).unlinkSync(tmpFile) } catch (_) {}
}

console.log('PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
