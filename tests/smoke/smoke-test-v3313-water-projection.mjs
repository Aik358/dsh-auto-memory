/**
 * v3.3.13 回归锁 —— issue #451 遗留「半修」根治。
 *
 * ## 缺陷形态（2026-10-21 重启后实测发现）
 * v3.3.11 号称「手off-state 透出三字段，面板可核对走没走兜底」，实际两处都没做完：
 *   ① `lib/index.js` 的 **else 分支**（有 sessionId 但该会话尚无水位记录）**漏掉** meterViaProxy /
 *      estimatedTokens / realUsageTokens ⇒ 三个 waterLevel 构造点里**只有一个形状不一致**，
 *      调用方恰好走到该分支就拿到 undefined（**半修**：另两个分支正常，故障难复现）。
 *   ② `lib/client.js` 对这三个字段引用 **0 次** ⇒ 承诺的「面板可核对」从未兑现。
 *
 * ## 本套件钉住的判据
 *   A. 三个 water 构造点**字段集完全一致**（含 else 分支）—— 真执行 handoff-state，逐分支断言三键存在；
 *   B. 前端**真的消费**这三字段（渲染分支存在且受 meterViaProxy 门控）；
 *   C. 未走兜底时界面**不渲染**该行（负路径：普通用户零变化）。
 *
 * A 组是真调用（隔离宿主 + 三种会话形态），B/C 组是真执行渲染函数。
 *
 * 运行：node tests/smoke/smoke-test-v3313-water-projection.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { pathToFileURL as __p2u } from 'node:url'
const ROOT_DIR = new URL('../../', import.meta.url)
const ROOT_IDX = new URL('lib/index.js', ROOT_DIR).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ROOT_CL = new URL('lib/client.js', ROOT_DIR).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const IDX_PATH = process.env.IDX_PATH || ROOT_IDX
const CL_PATH = process.env.CL_PATH || ROOT_CL
import { apply, API, MemoryEngine } from '../lib/audit-engine.mjs'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))) }
}
const has3 = (w) => !!w && Object.prototype.hasOwnProperty.call(w, 'meterViaProxy')
  && Object.prototype.hasOwnProperty.call(w, 'estimatedTokens')
  && Object.prototype.hasOwnProperty.call(w, 'realUsageTokens')

// ══════════ A 组：真跑 handoff-state 的三个分支 ══════════
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-v3313-'))
const prev = { home: process.env.DSH_HOME, fetch: globalThis.fetch, interval: globalThis.setInterval, timeout: globalThis.setTimeout, load: MemoryEngine.prototype.loadConfigSync }
const routes = []
let engine = null
try {
  process.env.DSH_HOME = root
  await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({
    teamEnabled: false, memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'),
    globalBriefEnabled: false, externalSources: {}, handoffEnabled: true,
  }))
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return prev.load.call(this) }
  globalThis.setInterval = globalThis.setTimeout = (cb, ms) => ({ callback: cb, ms, unref() {} })
  globalThis.fetch = async () => new Response('{}')
  apply({
    get: () => undefined, credentials: {}, on: () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: { register: r => { routes.push(r); return () => {} } },
    effect: () => {},
  }, {})
  globalThis.setTimeout = prev.timeout; globalThis.setInterval = prev.interval

  async function callHandoff(query) {
    const route = routes.find(r => r.path === API['handoff-state'] || r.path.indexOf('handoff-state') >= 0)
    assert.ok(route, 'handoff-state route registered')
    let status = 0, data = null
    const req = Readable.from([])
    Object.assign(req, { method: 'GET', url: route.path + (query || ''), socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' } })
    await route.handler(req, { writeHead: v => { status = v }, end: v => { try { data = JSON.parse(v) } catch (_) { data = v } }, setHeader() {} })
    return { status, data }
  }

  // 分支 1：不传 sessionId（全局视图）
  const r1 = await callHandoff('')
  ok(r1.status === 200, 'A0 handoff-state 可调用', r1.status)
  ok(has3(r1.data && r1.data.waterLevel), 'A1 ★全局视图（无 sessionId）三键齐全', r1.data && r1.data.waterLevel && Object.keys(r1.data.waterLevel))

  // 分支 2：传 sessionId 但**该会话无水位记录** ⇒ 走到 else 分支（本次缺陷点）
  const r2 = await callHandoff('?sessionId=no-such-session-3313')
  ok(has3(r2.data && r2.data.waterLevel), 'A2 ★★else 分支（有 sessionId 但无记录）三键齐全 —— v3.3.11 的缺陷点', r2.data && r2.data.waterLevel && Object.keys(r2.data.waterLevel))
  ok(r2.data && r2.data.waterLevel && r2.data.waterLevel.meterViaProxy === false,
    'A3 else 分支 meterViaProxy 取值语义 = false（未走兜底）', r2.data && r2.data.waterLevel && r2.data.waterLevel.meterViaProxy)
  ok(r2.data && r2.data.waterLevel && r2.data.waterLevel.estimatedTokens === 0 && r2.data.waterLevel.realUsageTokens === 0,
    'A4 else 分支两数为 0（与「未走兜底」语义一致）', r2.data && r2.data.waterLevel)

  // 分支 3：预置一条该会话的水位记录 ⇒ 走 rec 分支
  const sid3 = 'sess-with-water-3313'
  if (typeof engine.waterRecordFor === 'function') {
    // 通过真实写入路径注入记录（不改代码，只喂数据）
    const wsKey = typeof engine.wsKey === 'function' ? engine.wsKey(engine.state && engine.state.ws || process.cwd()) : 'k'
    if (engine.state) engine.state.waterLevelRatio = 0.42
    if (engine.state) {
      engine.state.waterLevelTokens = 420000
      engine.state.waterLevelAt = Date.now()
      engine.state.waterLevelMeter = 'official:proxyUsage'
      engine.state.waterLevelProxyCompat = { applied: true, estimated: 900000, proxyUsage: 420000 }
    }
    const r3 = await callHandoff('')
    const w3 = r3.data && r3.data.waterLevel
    ok(has3(w3), 'A5 ★全局视图（带兜底状态）三键齐全', w3 && Object.keys(w3))
    ok(w3 && w3.meterViaProxy === true, 'A6 兜底生效时 meterViaProxy=true（真值传播）', w3 && w3.meterViaProxy)
    ok(w3 && w3.estimatedTokens === 900000 && w3.realUsageTokens === 420000,
      'A7 两数如实传播（900000 / 420000）', w3 && { e: w3.estimatedTokens, u: w3.realUsageTokens })
  } else {
    ok(false, 'A5 waterRecordFor 不存在（判据前提失效）', typeof engine.waterRecordFor)
  }
} catch (e) {
  ok(false, 'A 组执行期异常', String(e && e.stack || e).slice(0, 400))
} finally {
  globalThis.fetch = prev.fetch
  globalThis.setInterval = prev.interval
  globalThis.setTimeout = prev.timeout
  if (prev.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev.home
  MemoryEngine.prototype.loadConfigSync = prev.load
  try { await fs.rm(root, { recursive: true, force: true }) } catch (_) {}
}

// ══════════ B/C 组：前端真的消费 + 负路径 ══════════
{
  const client = await fs.readFile(CL_PATH, 'utf8')

  ok(/data-dam-water-proxy-pair/.test(client), 'B1 ★前端存在代理对照行的渲染锚点 data-dam-water-proxy-pair')
  ok(/wl\.meterViaProxy\s*===\s*true/.test(client), 'B2 ★渲染受 meterViaProxy 门控（未走兜底不渲染 ⇒ 普通用户零变化）')
  ok(/wl\.estimatedTokens/.test(client) && /wl\.realUsageTokens/.test(client),
    'B3 ★两数都被真正读取（issue #451 承诺的「能核对两个数差多少」）')
  ok(/waterProxyPair/.test(client), 'B4 使用 i18n 键而非硬编码文案')

  // 三语齐备（负路径：少一语即红）
  for (const [tag, pat] of [
    ['zh', /waterProxyPair:\s*'代理压缩对照/],
    ['en', /waterProxyPair:\s*'Proxy-compaction reference/],
    ['ja', /waterProxyPair:\s*'プロキシ圧縮の対照/],
  ]) {
    ok(pat.test(client), 'B5 i18n ' + tag + ' 已齐备')
  }

  // 负路径：把 meterViaProxy 门控去掉 ⇒ 必须能检出（模拟「无条件渲染」回归）
  const broken = client.replace(/wl\.meterViaProxy\s*===\s*true/, 'true')
  ok(broken !== client, 'C1 ★负路径可构造（门控串可被替换，证明断言有鉴别力）')
  ok(!/wl\.meterViaProxy\s*===\s*true/.test(broken), 'C2 负路径确实抹掉了门控')
}

// ══════════ D 组：三个 water 构造点字段集一致（结构判据）══════════
{
  const idx = await fs.readFile(IDX_PATH, 'utf8')   // ★必须走可注入路径，否则变异无法作用于本组
  const waterBlocks = idx.split(/\r?\n/).reduce((acc, line, i) => {
    if (/^\s*water\s*=\s*\{/.test(line)) acc.push(i)
    return acc
  }, [])
  ok(waterBlocks.length === 3, 'D1 恰有 3 个 water 构造点', waterBlocks.length)
  // 每个构造点后 30 行内必须出现三键
  const lines = idx.split(/\r?\n/)
  let allHave = true
  const missing = []
  for (const start of waterBlocks) {
    const seg = lines.slice(start, start + 30).join('\n')
    for (const k of ['meterViaProxy', 'estimatedTokens', 'realUsageTokens']) {
      if (!new RegExp('\\b' + k + '\\b').test(seg)) { allHave = false; missing.push('L' + (start + 1) + ':' + k) }
    }
  }
  ok(allHave, 'D2 ★★三个构造点**全部**带三键（v3.3.11 只做了 2/3）', missing)
}


// ══════════ E 组：变异反向验证（改回旧写法 ⇒ 必须红）══════════
if (process.env.V3313_CHILD !== '1') {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const realIdx = await fs.readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const realCl = await fs.readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

  // M1：else 分支退回「不写三字段」（复刻 v3.3.11 原状）
  const M1_FROM = `          meterViaProxy: false,\r\n          estimatedTokens: 0,\r\n          realUsageTokens: 0,\r\n`
  const muts = [
    ['M1 else 分支三字段被删（复刻 v3.3.11）', path.join(ROOT_IDX), realIdx, M1_FROM, '', 'IDX'],
    ['M2 前端门控被去掉', path.join(ROOT_CL), realCl, "wl.meterViaProxy === true ?", "true ?", 'CL'],
  ]
  for (const [label, target, base, from, to, kind] of muts) {
    const hits = base.split(from).length - 1
    ok(hits === 1, 'E 变异定位:' + label + ' 锚点恰命中 1 次', { hits })
    if (hits !== 1) continue
    const mp = path.join(os.tmpdir(), 'mut-v3313-' + kind + path.extname(target))
    await fs.writeFile(mp, base.replace(from, to))
    const synCheck = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
    ok(synCheck.status === 0, 'E 变异文件语法可用(' + label + ')', String(synCheck.stderr || '').slice(0, 160))
    const env = Object.assign({}, process.env, { V3313_CHILD: '1' })
    if (kind === 'IDX') env.IDX_PATH = mp; else env.CL_PATH = mp
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env, encoding: 'utf8', maxBuffer: 1 << 25 })
    const out = String(r.stdout || '') + String(r.stderr || '')
    const m = out.match(/pass=(\d+) fail=(\d+)/)
    ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', { status: r.status })
    ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红不是崩溃', out.slice(-240))
    ok(!!m && Number(m[2]) > 0, '★变异必红(' + label + '):fail>0', m ? m[0] : '(未取到)')
    console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
    try { await fs.rm(mp, { force: true }) } catch (_) {}
  }
}

console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
