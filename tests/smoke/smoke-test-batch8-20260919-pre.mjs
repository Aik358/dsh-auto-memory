#!/usr/bin/env node
/**
 * smoke-test-batch8-20260919-pre.mjs —— 第八批（#75 两项 P3）
 *
 * **CC-9 writeChain 延后写绑定「当时的 child」**：`writeFrame` 的 `writeChain.then(...)` 回调
 *   解引用**当时的**模块级 `child` 变量。若排队期间发生 respawn（`ensureStarted` 收尾中重生 /
 *   `restart()`），回调会把**旧 epoch 的帧**写进**新** worker 的 stdin ⇒ 对端回帧 epoch-mismatch
 *   ⇒ 被判 `staleEpoch` 丢弃 ⇒ 请求挂满自身超时（默认 5000ms）。
 *
 * **CC-11 stepFor 双自增压缩 TTL 窗**：`stepFor` 是自增器。「注入即泵」路径
 *   `finishInject` 先 `offerActivation({nowStep: stepFor(...)})` 烘焙 TTL 起点，
 *   紧接着**同一同步块内** `pumpClaimed` 又调一次 `stepFor` 去 claim
 *   ⇒ offer 与 pump 各消耗 1 步而**零时间流逝** ⇒ TTL 窗口凭空少 1 步
 *   （ttl=3 自然投递窗由 2 次机会缩为 1；ttl=2 rollback 场景整包必死）。
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
const codeOnly = (t) => String(t).split(/\r?\n/)
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) }).join('\n')

console.log('\n[1] CC-9 出站帧必须绑定「建帧时的 child」，flush 时校验身份')
{
  const code = codeOnly(src('python-sidecar-client-pre.js'))
  ok(/const sentTo = child/.test(code), '★★ 建帧时捕获 child 引用（sentTo）')
  ok(/const sentStdin = child\.stdin/.test(code), '★ 同时捕获 stdin 引用')
  ok(/if \(child !== sentTo\) \{ done\(\); return \}/.test(code),
    '★★ flush 时校验身份：已换代则本帧作废，不写入新 worker')
  // 反向锁：不得再直接解引用模块级 child 写流
  ok(!/if \(!child \|\| !child\.stdin \|\| child\.stdin\.destroyed\) \{ done\(\); return \}/.test(code),
    '★★ 回调内不再直接解引用模块级 child')
  ok(/sentStdin\.write\(line, \(\) => done\(\)\)/.test(code), '★ 实际写流走捕获的 stdin')
}

console.log('\n[2] CC-11 注入即泵不得在同一步内消耗 2 步 TTL')
{
  const code = codeOnly(src('activation-host-pre.js'))
  // 只读步号存在
  ok(/function currentStepOf\(sessionId, workspaceKey\)/.test(code), '★★ 新增只读 currentStepOf')
  ok(/return stepsByRuntime\.get\(stepKeyOf\(sessionId, workspaceKey\)\) \|\| 0/.test(code),
    '★ currentStepOf 不自增（只读 Map）')
  ok(/function stepFor\(sessionId, workspaceKey\)/.test(code), '★ stepFor 自增器仍保留（自然 pre-step 路径要用）')

  // pumpClaimed 必须用只读版
  const i = code.indexOf('function pumpClaimed')
  ok(i > 0, '找到 pumpClaimed')
  const pump = code.slice(i, i + 600)
  ok(/nowStep: currentStepOf\(req\.sessionId, req\.workspaceKey\)/.test(pump),
    '★★ pumpClaimed 用 currentStepOf（不再自增）')
  ok(!/stepFor\(/.test(pump), '★★ pumpClaimed 内不再出现 stepFor（同一步不消耗 2 步）')

  // offer 侧仍用自增（stepFor），保持"每次注入推进 1 步"的语义
  const i2 = code.indexOf('function finishInject')
  const fi = code.slice(i2, i2 + 400)
  ok(/nowStep: stepFor\(req\.sessionId, req\.workspaceKey\)/.test(fi),
    '★ finishInject 的 offer 仍用 stepFor（每次注入推进 1 步）')

  // 自然 pre-step claim 仍用自增（:383 附近）
  ok(/const nowStep = stepFor\(identity\.sessionId, identity\.workspaceKey\)/.test(code),
    '★ 自然 pre-step 路径仍用 stepFor（未被误改）')
}

console.log('\n[3] 两条修复都不得回退（反向锁）')
{
  const c9 = codeOnly(src('python-sidecar-client-pre.js'))
  ok(!/writeChain = writeChain\.then\(\(\) => new Promise\(\(done\) => \{\s*if \(!child/.test(c9),
    '★★ writeFrame 回调不再以模块级 child 为判据')
  const c11 = codeOnly(src('activation-host-pre.js'))
  ok(!/function pumpClaimed[\s\S]{0,400}?nowStep: stepFor\(/.test(c11),
    '★★ pumpClaimed 不再用自增 stepFor')
}

console.log(`\n[batch8-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
