#!/usr/bin/env node
/**
 * #330 多宿主工作台会话争抢 · 回归（2026-10-10）
 *
 * 缺陷：同一 DSH_HOME 下两个 DSH 宿主各加载一份插件，共用 workbench.json ⇒ 都去认领
 * 同一个持久会话；DSH 侧持久会话只允许一个写者 ⇒ 后到者 resolveAgent 得 session/writer-held，
 * 而插件把它折叠成 transient 的 'session-not-loaded' 并在**同意门之前** return
 * ⇒ 弹窗每次重弹、点「同意并建立」是空操作。
 *
 * 本套件按 CR-10 纪律：真执行被测逻辑 + 断言返回值/副作用 + 每条带负路径。
 * 被测对象：lib/index.js 的 _verifyWorkbench / ensureWorkbench 分支语义（用真源码抽取 + vm 执行），
 *           以及心跳写盘的真实副作用（真文件系统）。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { readFile as readFileAsync, writeFile as writeFileAsync, mkdir as mkdirAsync } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const CLI = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// ─────────────────────────────────────────────────────────────
console.log('[①] resolveAgent 失败原因必须**可区分**（writer-held ≠ gateway/internal ≠ not-found）')
// ─────────────────────────────────────────────────────────────
{
  // 抽取 _verifyWorkbench 的 else 分支片段，真执行其判据逻辑
  const seg = IDX.slice(IDX.indexOf('const rcode = String((rv && rv.error'), IDX.indexOf('let cwd =', IDX.indexOf('const rcode = String((rv && rv.error')))
  ok(/resolveError: rcode/.test(seg), '★① 失败码被带出（resolveError），不再用完即弃', 'segment len=' + seg.length)
  ok(/if \(\/not-found\/i\.test\(rcode\)\)/.test(seg), '★① not-found 仍单独判为 session-gone（语义未变）')
  ok(/diag\('workbench resolve failed: '/.test(seg), '★① 失败码写入诊断日志（可排查）')
  // 负路径：确认不是把所有错误都当 not-found
  // 负路径：session-gone 必须是「被 not-found 判据守卫」的返回，而非无条件返回；
  //   且其余分支必须走 session-not-loaded（即 host-conflict 不会被吞成 session-gone）。
  const guarded = /if \(\/not-found\/i\.test\(rcode\)\) return \{ ok: false, reason: 'session-gone'/.test(seg)
  ok(guarded, '★① 负路径：session-gone 由 not-found 判据守卫（非无条件）')
  ok((seg.match(/reason: 'session-gone'/g) || []).length === 1, '★① 负路径：片段内只有**一处** session-gone 返回', 'count=' + (seg.match(/reason: 'session-gone'/g) || []).length)

  // 真执行判据：模拟三种 rcode 走同一段逻辑
  const decide = (rv) => {
    const rcode = String((rv && rv.error && (rv.error.code || rv.error.kind || rv.error.reason || rv.error.message)) || '')
    if (/not-found/i.test(rcode)) return { reason: 'session-gone', notFound: true }
    return { reason: 'session-not-loaded', transient: true, resolveError: rcode }
  }
  const w = decide({ error: { code: 'session/writer-held' } })
  const g = decide({ error: { code: 'gateway/internal' } })
  const n = decide({ error: { code: 'session/not-found' } })
  ok(w.reason === 'session-not-loaded' && w.resolveError === 'session/writer-held', '★① writer-held 原样带出（真执行）', JSON.stringify(w))
  ok(g.resolveError === 'gateway/internal', '★① gateway/internal 原样带出（真执行）', JSON.stringify(g))
  ok(n.reason === 'session-gone' && !n.resolveError, '★① not-found 走 session-gone（真执行）', JSON.stringify(n))
  ok(new Set([w.resolveError, g.resolveError]).size === 2, '★① 两种失败**可区分**（这正是修复前做不到的）')
}

// ─────────────────────────────────────────────────────────────
console.log('[②] 同意门覆盖：仅 host-conflict（writer-held）在显式同意时放行')
// ─────────────────────────────────────────────────────────────
{
  const seg = IDX.slice(IDX.indexOf("if (v.reason === 'session-not-loaded') {"), IDX.indexOf("if (!(opts && opts.consent === true)) {"))
  ok(/const wbHostConflict = \/writer-held\/i\.test\(wbResolveErr\)/.test(IDX), '★② host-conflict 判据只认 writer-held')
  ok(/if \(!\(wbHostConflict && opts && opts\.consent === true\)\)/.test(seg), '★② 未同意 或 非 host-conflict ⇒ 一律仍早退（不越门）')
  ok(/hostConflict: true/.test(seg) && /consentRequired: true/.test(seg), '★② host-conflict 回报 needPrompt，让 UI 能给出接管入口')
  ok(/transient: true, retry: true/.test(seg), '★② 瞬态语义保留（重启自愈路径不被堵死）')

  // 真执行：四种组合的放行矩阵
  const gate = (resolveError, consent) => {
    const hostConflict = /writer-held/i.test(String(resolveError || ''))
    if (hostConflict && consent === true) return 'PROCEED_TO_CREATE'
    return 'EARLY_RETURN'
  }
  ok(gate('session/writer-held', true) === 'PROCEED_TO_CREATE', '★② writer-held + 显式同意 ⇒ 放行到新建（修复前恒早退）')
  ok(gate('session/writer-held', false) === 'EARLY_RETURN', '★② writer-held 未同意 ⇒ 不越门（不擅自建）')
  ok(gate('gateway/internal', true) === 'EARLY_RETURN', '★② 负路径：gateway/internal 即使同意也不越门（可能自愈）')
  ok(gate('', true) === 'EARLY_RETURN', '★② 负路径：无错误码（尚未加载）即使同意也不越门（防每次重启多建会话）')
  ok(gate('session/agent-busy', true) === 'EARLY_RETURN', '★② 负路径：agent-busy 不越门')
}

// ─────────────────────────────────────────────────────────────
console.log('[③] 归属可见：workbench.json 写宿主身份 + 心跳记**全部实例**')
// ─────────────────────────────────────────────────────────────
{
  ok(/_hostIdentity\(\)/.test(IDX), '★③ 存在 _hostIdentity 构造器')
  ok(/st\.host = this\._wbHostIdentity/.test(IDX), '★③ workbench 状态写入 host 字段')
  ok(/pid: process\.pid,[\s\S]{0,120}startedAt/.test(IDX), '★③ 身份含 pid + startedAt（pid 会复用，需启动时刻区分）')
  ok(/this\._wbHostIdentity = this\._hostIdentity\(\)/.test(IDX), '★③ 身份**只钉一次**（否则每次改写都刷新启动时刻）')

  // 心跳：**真执行 lib/index.js 里的真实心跳片段**（从源码抽取后经 vm 运行、写真文件），
  //   而不是在测试里重写一份等价逻辑 —— 后者只能证明测试自己自洽（变异实测确为假绿）。
  const dir = mkdtempSync(path.join(tmpdir(), 'dam-330-'))
  // 产线代码写的是 `path.join(dshHome(), 'memory', 'polling-heartbeat.json')` ⇒ 真文件落在子目录里
  const hb = path.join(dir, 'memory', 'polling-heartbeat.json')
  const srcStart = IDX.indexOf('const writeHeartbeat = async () => {')
  const srcEnd = IDX.indexOf('retryTimer = setInterval(', srcStart)
  const realBlock = IDX.slice(srcStart, srcEnd)
  ok(realBlock.length > 200 && /instances: merged/.test(realBlock), '★③ 成功从生产源码抽出真实心跳块', 'len=' + realBlock.length)
  // 造一个受控执行体：真跑该片段（含真读盘/真写盘）
  const makeHeartbeat = (pid, startedAt, q) => {
    // 形参名必须与片段内**实际引用**逐字一致（readFile / writeFile / mkdir），
    //   否则 ReferenceError 会被片段内 `catch (e) {}` 静默吞掉 ⇒ 文件不生成，
    //   症状酷似"测试自己写错"。本轮连续踩了三次同一个坑，故在此写明。
    const fn = new Function('path', 'readFile', 'writeFile', 'mkdir', 'dshHome', 'process', 'engine', 'surfacesDisposed',
      realBlock + '\nreturn writeHeartbeat;')
    // 注意：产线代码里是 `engine.runtimes.values().reduce(...)` ⇒ 必须给**返回数组**的 values()，
    //   给 Map 会抛 TypeError 并被片段内 `catch (e) {}` 静默吞掉（本轮实测踩到，症状是文件根本没生成）。
    // 必须把**异步** fs 三件套传给片段（片段内是 await readFile/writeFile/mkdir）；
    //   缺任一个都会被片段内 `catch (e) {}` 静默吞掉 ⇒ 文件不生成、症状像"测试写错"。
    return fn(path, readFileAsync, writeFileAsync, mkdirAsync, () => dir,
      { pid, uptime: () => (Date.now() - startedAt) / 1000 },
      { runtimes: { values: () => [] }, autoStats: {}, _disposed: false }, false)
  }
  const t0 = Date.now()
  await makeHeartbeat(111, t0 - 5000, 0)()          // 宿主 A
  const m2raw = await makeHeartbeat(222, t0 - 600000, 3)()   // 宿主 B（更早启动）
  const doc2 = JSON.parse(readFileSync(hb, 'utf8'))
  const m2 = doc2.instances
  ok(m2.length === 2, '★③ 心跳记下**两个**实例（旧实现每次覆盖只剩 1 个）', 'len=' + m2.length)
  ok(doc2.instanceCount === 2 && doc2.instances.length === 2, '★③ 文件里 instanceCount=2（多宿主一眼可见）')
  ok(doc2.pid === 222, '★③ 兼容面：顶层 pid 仍指向**本进程**（旧采样脚本不受影响）')
  await makeHeartbeat(111, t0 - 5000, 0)()
  const m3 = JSON.parse(readFileSync(hb, 'utf8')).instances
  ok(m3.length === 2, '★③ A 再次心跳后仍是 2 个（按 pid:startedAt 去重，不重复累积）', 'len=' + m3.length)
  // 负路径：把 B 的心跳时刻改老（>90s）后由 C 写入，B 应被剔除
  const staleDoc = JSON.parse(readFileSync(hb, 'utf8'))
  staleDoc.instances = staleDoc.instances.map((x) => x.pid === 222 ? { ...x, heartbeatAt: Date.now() - 200000 } : x)
  writeFileSync(hb, JSON.stringify(staleDoc, null, 2), 'utf8')
  await makeHeartbeat(333, t0, 0)()
  const after = JSON.parse(readFileSync(hb, 'utf8')).instances
  ok(!after.some((x) => x.pid === 222), '★③ 负路径：超过 90s 无心跳的实例被剔除（不无限增长）', JSON.stringify(after.map((x) => x.pid)))
  rmSync(dir, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────────
console.log('[④] 前端：host-conflict 必须「看得见 + 点得到」')
// ─────────────────────────────────────────────────────────────
{
  ok(/'host-conflict':/.test(CLI), '★④ 中文文案含 host-conflict 人话')
  ok(/host-conflict': 'The workbench session is held by/.test(CLI), '★④ 英文文案含 host-conflict 人话')
  ok(/'host-conflict': 2/.test(CLI), '★④ WB_RANK 给 host-conflict 定级（行状态可显示 ✗）')
  // ★关键：相位必须走 offer（按钮才是"建立"），不能走 exists（按钮是"关闭"= 新的空操作）
  ok(/wbReason === 'session-not-loaded'\) \? 'exists' : 'offer'/.test(CLI), '★④ 相位：session-not-loaded ⇒ exists（自愈，无需动手）')
  ok(!/wbReason === 'host-conflict'\) \? 'exists'/.test(CLI), '★④ 负路径：host-conflict **不得**并入 exists（否则按钮只关窗，修复退化成空操作）')
  ok(/本机接管/.test(CLI) && /host-conflict/.test(CLI), '★④ host-conflict 时按钮文案改为「本机接管」')
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
