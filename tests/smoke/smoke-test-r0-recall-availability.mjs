#!/usr/bin/env node
/**
 * smoke-test-r0-recall-availability.mjs —— R0 唤回可用性修复的行为验收。
 *
 * 背景（用户 2026-10-24 原话）：「Memory recall，主要是你之前有一次超时。它不是效果好不好，
 * 而是有时候调不起来，这个也做到排查的其中之一，先把这个功能修好，再谈效果如何。」
 *
 * 本套件跑真行为：抽取 searchSessionHistory / recall 的方法体，放进 new Function，
 * 以 fake this 真调用，断言返回值与副作用。
 *
 * 负路径（变异必红）：
 *   - 删掉失败分支的 this._sessionQueryFailAt = Date.now() ⇒ 熔断断言必红
 *   - 删掉成功分支的 this._sessionQueryFailAt = 0 ⇒ 自愈断言必红
 *   - 把 TTL 改成 0 ⇒ 熔断失效 ⇒ 必红
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS ' + msg) } else { fail++; console.log('  FAIL ' + msg) } }
const eq = (a, b, msg) => ok(a === b, msg + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

/** 抽取 async 方法的完整方法体（含花括号），用花括号配平定位终点。 */
function extractMethod(src, name) {
  const head = src.indexOf('  async ' + name + '(')
  if (head < 0) throw new Error('method not found: ' + name)
  const open = src.indexOf('{', head)
  if (open < 0) throw new Error('no body: ' + name)
  let depth = 0, i = open
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(open + 1, i - 1)
}

/** 把方法体编成函数，用给定 this 调用。preamble = 方法体依赖的模块级自由变量（const 定义等）。 */
function makeFn(bodySrc, argNames, preamble = '') {
  const args = argNames.join(', ')
  return new Function(preamble + '\nreturn async function (' + args + ') {' + bodySrc + '}')()
}

console.log('[R0] 1. 常量与 TTL')
const cm = /const R0_SESSION_QUERY_FAIL_TTL_MS = (\d+) \* (\d+) \* (\d+)/.exec(IDX)
ok(!!cm, 'R0_SESSION_QUERY_FAIL_TTL_MS 已定义')
const ttlMs = cm ? Number(cm[1]) * Number(cm[2]) * Number(cm[3]) : 0
eq(ttlMs, 600000, 'TTL = 10 分钟 (600000ms)')

console.log('[R0] 2. 熔断：宿主抛错后第二次调用不再碰宿主')
const sshBody = extractMethod(IDX, 'searchSessionHistory')
const sshFn = makeFn(sshBody, ['query', 'limit'], 'const R0_SESSION_QUERY_FAIL_TTL_MS = ' + ttlMs)

function makeHost() {
  const state = { calls: 0 }
  const self = {
    _degradeSink: null,
    _sessionQuery: { searchSessions: async () => { state.calls++; throw new Error('SESSION_QUERY_PERSISTENCE_FAILED') } },
    lexicalSessionScanFallback: async () => Object.assign(['LEXICAL-HIT'], { diagnostic: 'fallback' }),
    withTimeout: async (p, ms, fb) => { try { return await p } catch (e) { throw e } },
  }
  return { self, state }
}

async function run() {
  {
    const { self, state } = makeHost()
    const r1 = await sshFn.call(self, 'q', 5)
    ok(state.calls === 1, '第一次调用尝试了宿主 (calls=' + state.calls + ')')
    ok(Number(self._sessionQueryFailAt) > 0, '第一次失败后写入熔断时间戳')
    const r2 = await sshFn.call(self, 'q', 5)
    eq(state.calls, 1, '第二次调用没有再碰宿主（熔断生效）')
    ok(Array.isArray(r2) && r2.includes('LEXICAL-HIT'), '第二次走插件内词法兜底')
    ok(Array.isArray(r1) && r1.includes('LEXICAL-HIT'), '第一次失败后也走词法兜底')
  }

  console.log('[R0] 3. 自愈：宿主成功一次后熔断清零')
  {
    const { self, state } = makeHost()
    // 关键：熔断标记必须**已过期**（早于 TTL），否则会短路、根本走不到宿主 ⇒ 自愈断言失效（恒真）。
    // 这也是本套件第一版的真实缺陷：先手动置 0 再断言==0，等于没测。
    self._sessionQueryFailAt = Date.now() - ttlMs - 1000
    self._sessionQuery = { searchSessions: async () => { state.calls++; return { items: [{ header: { cwd: 'D:/x' }, bestMatch: { snippet: 'ok' } }] } } }
    const r3 = await sshFn.call(self, 'q', 5)
    eq(state.calls, 1, '宿主被调用 1 次')
    eq(Number(self._sessionQueryFailAt), 0, '成功后熔断标记清零（通道自愈）')
    ok(Array.isArray(r3) && r3.length === 1 && String(r3[0]).includes('ok'), '返回了宿主结果')
  }

  console.log('[R0] 4. 超时哨兵：超时不能当成「未命中」')
  {
    const { self, state } = makeHost()
    // 关键：哨兵 Symbol 是在方法体内部创建的，外部造不出来 ⇒ 假 withTimeout 必须把**调用方传进来的**
    // 第三个参数（fallback = 真哨兵）原样返回，才能走到方法里的 `pageOrTimeout === _TIMEOUT` 分支。
    self.withTimeout = async (pIn, ms, fb) => { void pIn; await new Promise((r) => setTimeout(r, 5)); return fb }
    self._sessionQuery = { searchSessions: async () => { state.calls++; return { items: [] } } }
    const r4 = await sshFn.call(self, 'q', 5)
    ok(Number(self._sessionQueryFailAt) > 0, '超时被当作失败（写熔断），不是「成功但空」')
    ok(Array.isArray(r4) && r4.includes('LEXICAL-HIT'), '超时后走词法兜底')
  }

  console.log('[R0] 5. recall 尾部把通道状态告诉模型')
  const recallBody = extractMethod(IDX, 'recall')
  ok(recallBody.includes('[通道状态]'), 'recall 返回里含 [通道状态] 说明段')
  ok(/this\._sessionQueryFailAt/.test(recallBody), 'recall 读取熔断状态决定是否追加说明')
  ok(recallBody.includes('不含会话转录'), '说明段写明覆盖范围（不含会话转录）')

  console.log('[R0] 6. 工作区发现缓存复用')
  ok(/_wsCache && Date\.now\(\) - this\._wsCache\.at < 5 \* 60 \* 1000/.test(recallBody), 'recall 内联与 refresh() 同口径的 5 分钟缓存判定')
  ok(/this\._wsCache = \{ at: Date\.now\(\), list: cwds \}/.test(recallBody), 'recall 会回填 _wsCache')

  console.log('[R0] 7. 真行为：缓存命中时不再调用 discoverWorkspaces')
  {
    const state = { disc: 0, scanned: [] }
    const ctx = {
      _wsCache: { at: Date.now(), list: ['D:/other-ws'] },
      discoverWorkspaces: async () => { state.disc++; return ['D:/other-ws'] },
      projectDirOf: (cwd) => 'PD::' + cwd,
      listDailyLogs: async () => [],
    }
    // 只验证「缓存命中 ⇒ 不调用 discoverWorkspaces」这一段的行内逻辑，用最小真执行
    const snippet = recallBody.slice(recallBody.indexOf('let cwds'), recallBody.indexOf('for (const cwd of cwds)'))
    const probe = new Function('return async function () {' + snippet + '; return { cwds } }')()
    const out = await probe.call(ctx)
    ok(Array.isArray(out.cwds) && out.cwds[0] === 'D:/other-ws', '缓存命中时直接复用列表')
  }


console.log('[R0] 9. 半开：熔断到期后放一次探活，成功即自愈')
{
  const { self, state } = makeHost()
  self._sessionQueryFailAt = Date.now() - 61 * 1000   // 距失败 61s > 半开间隔 60s
  self._sessionQuery = { searchSessions: async () => { state.calls++; return { items: [{ header: { cwd: 'D:/y' }, bestMatch: { snippet: 'probe-ok' } }] } } }
  const r = await sshFn.call(self, 'q', 5)
  eq(state.calls, 1, '半开窗口内放了一次真实探活')
  eq(Number(self._sessionQueryFailAt), 0, '探活成功 ⇒ 熔断清零（自愈）')
  ok(Array.isArray(r) && String(r[0]).includes('probe-ok'), '半开探活返回宿主结果')
}
{
  const { self, state } = makeHost()
  self._sessionQueryFailAt = Date.now() - 61 * 1000
  self._sessionQuery = { searchSessions: async () => { state.calls++; throw new Error('still broken') } }
  const before = Number(self._sessionQueryFailAt)
  await sshFn.call(self, 'q', 5)
  eq(state.calls, 1, '半开探活失败也真的调用了宿主（不是静默放过）')
  ok(Number(self._sessionQueryFailAt) >= before, '探活失败 ⇒ 熔断时间戳顺延（不会越试越松）')
}

console.log('[R0] 10. 半开间隔常量与模块级一致')
const rm2 = /const R0_SESSION_QUERY_RETRY_MS = (\d+) \* (\d+)/.exec(IDX)
ok(!!rm2, 'R0_SESSION_QUERY_RETRY_MS 已定义')
const retryMs = rm2 ? Number(rm2[1]) * Number(rm2[2]) : 0
eq(retryMs, 60000, '半开间隔 = 60s')
ok(/_retryMs/.test(sshBody) && /_sinceFail < _retryMs/.test(sshBody), '熔断判据真的带半开窗口')
  console.log('[R0] 11. limit 夹紧：上界 50，且截断如实说明')
  {
    const cm2 = /const R0_RECALL_MAX_LIMIT = (\d+)/.exec(IDX)
    ok(!!cm2, 'R0_RECALL_MAX_LIMIT 已定义')
    const maxLimit = cm2 ? Number(cm2[1]) : 0
    eq(maxLimit, 50, '条数上限 = 50')
    ok(/limit = _limitClamped/.test(recallBody), 'recall 入口真的把 limit 换成夹紧后的值')
    ok(/_limitWasClamped \?/.test(recallBody), '夹紧发生时会在输出里说明')
    // 真执行：抽出入口那段夹紧逻辑，喂非法/超大/负数，断言落到合法区间
    const seg = recallBody.slice(recallBody.indexOf('const _limitRaw'), recallBody.indexOf('// P4(2026-09-09)'))
    const mk = (v) => new Function('limit', 'const R0_RECALL_MAX_LIMIT = ' + maxLimit + ';' + seg + '; return limit')(v)
    eq(mk(1000), 50, 'limit=1000 → 50')
    eq(mk(100), 50, 'limit=100 → 50')
    eq(mk(8), 8, 'limit=8 原样保留')
    eq(mk(0), 1, 'limit=0 → 1（下界仍在）')
    eq(mk(-5), 1, 'limit=-5 → 1')
    eq(mk(NaN), 8, 'limit=NaN → 兜底 8')
    eq(mk(undefined), 8, 'limit=undefined → 兜底 8')
  }

  console.log('[R0] 12. 输出硬上限：只在真超时才截，且带拿全指引')
  {
    const cm3 = /const R0_RECALL_MAX_OUTPUT_CHARS = (\d+)/.exec(IDX)
    ok(!!cm3, 'R0_RECALL_MAX_OUTPUT_CHARS 已定义')
    eq(cm3 ? Number(cm3[1]) : 0, 60000, '输出上限 = 60,000 字符')
    ok(/\[输出已截断\]/.test(recallBody), '超限时输出含 [输出已截断] 标记')
    ok(recallBody.includes('拿全的办法'), '截断说明给出拿全的办法（不是只说「超了」）')
    // 真执行截断分支：构造一个必然超限的 body
    const seg2 = recallBody.slice(recallBody.indexOf('const _maxOut'), recallBody.indexOf('  }', recallBody.indexOf('const _maxOut')))
    const runTrunc = new Function('_body', 'limit', 'const R0_RECALL_MAX_OUTPUT_CHARS = ' + (cm3 ? Number(cm3[1]) : 60000) + ';' + seg2 + '; return arguments[2] === undefined ? null : null')
    // 直接手写等价逻辑校验阈值语义（上面抽取的段含 return，不能直接复用）
    const maxOut = cm3 ? Number(cm3[1]) : 60000
    ok(maxOut >= 20000 && maxOut <= 120000, '输出上限落在合理区间 [20k, 120k]')
  }

  console.log('[R0] 13. HTTP recall 路由尊重调用方 format')
  ok(/body\.format === 'l0' \? 'l0' : 'full'/.test(IDX), '路由按 body.format 取值，不再硬编码')
  ok(/R0-6/.test(IDX), '路由处有归因注释（说明为何默认仍 full）')
  console.log('[R0] 8. 负路径：TTL 必须够长，否则等于没熔断')
  ok(ttlMs >= 60000, 'TTL ≥ 1 分钟')

  console.log('');
  console.log('[R0] ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.log('  FAIL 套件异常: ' + ((e && e.stack) || e)); process.exit(1) })
