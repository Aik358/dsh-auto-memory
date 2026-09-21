#!/usr/bin/env node
/**
 * smoke-test-batch5-20260919-pre.mjs —— 第五批上游 issue 修复套件（#72 fail-open + 残尾污染）
 *
 * #72：`python-sidecar-client-pre.js`
 *   ① **入站 epoch 门 fail-open**：`:164` 旧写法 `if (epoch !== null && frame.workerEpoch !== epoch)`
 *      ⇒ `epoch === null`（未启动 / exit 后 stdio 未排空 / restart 到新 spawn 之间）时**整条门失效**，
 *      任何合法 envelope 的帧都穿透到 handler；而 `activation_request` 上游 `context-host` **无二次校验**
 *      （同 activationId 有 dedup，但**新 id 可穿透**）⇒ 幽灵激活。与文件头 `:7` 承诺的 fail-closed 相反。
 *   ② **旧 worker 残尾污染新首帧**：`ensureStarted` 的「收尾中重生」分支与 `restart()` 都只置 `epoch = null`，
 *      **不清共享 buffer**（`:121` 的 exit 清理在这两条路径上不生效，因为它们的前提正是 exit 未到）
 *      ⇒ 旧代无换行尾字节 concat 进新首帧 ⇒ 该行 badJson ⇒ 应答被吞、请求白等到超时（默认 5000ms）。
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = readFileSync(new URL('../../lib/python-sidecar-client-pre.js', import.meta.url), 'utf8')
/** 只取代码行、剥掉注释——本仓已知陷阱：修复处注释会引用旧代码文本（会假红）。 */
const codeOnly = (text) => String(text).split(/\r?\n/)
  .filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) })
  .join('\n')

console.log('\n[1] 入站 epoch 门必须是 fail-closed（epoch 为空 ⇒ 丢弃）')
{
  const code = codeOnly(src)
  // 反向锁：不得再有「epoch !== null &&」这种 fail-open 前置
  ok(!/if \(epoch !== null && frame\.workerEpoch !== epoch\)/.test(code),
    '★★ 不再使用 `epoch !== null &&` 前置（fail-open 根因）')
  // 正面锁：判据必须是「!epoch || 不匹配 ⇒ 丢弃」
  ok(/if \(!epoch \|\| frame\.workerEpoch !== epoch\)/.test(code),
    '★★ 判据改为 `!epoch || 不匹配 ⇒ 丢弃`（fail-closed）')
  // 与文件头契约一致：仍计入 staleEpoch 台账（可观测）
  ok(/stats\.dropped\.staleEpoch\+\+/.test(code), '★ 丢弃仍计入 staleEpoch 台账（可观测）')
}

console.log('\n[2] 文件头契约与实现必须一致（:7 fail closed）')
{
  ok(/入站帧 epoch 不匹配即丢弃\(fail closed\)/.test(src),
    '★ 文件头仍声明 fail closed（修的是实现，不是把契约改软）')
}

console.log('\n[3] 三条 worker 换代码路径都必须清共享 buffer')
{
  const code = codeOnly(src)
  // 统计 `buffer = Buffer.alloc(0)` 出现次数：声明 1 + ensureStarted 重生 1 + restart 1 + exit 1 + fatal 1
  const resets = (code.match(/buffer = Buffer\.alloc\(0\)/g) || []).length
  ok(resets >= 4, `★★ buffer 重置点 ≥4（实际 ${resets}）——覆盖 ensureStarted/restart/exit/fatal`, String(resets))
  // restart 内必须清 buffer（本次新增）
  const iRestart = code.indexOf('function restart(reason)')
  ok(iRestart > 0, '找到 restart 定义')
  const restartBody = code.slice(iRestart, iRestart + 400)
  ok(/buffer = Buffer\.alloc\(0\)/.test(restartBody),
    '★★ restart() 内清空 buffer（旧代残尾不得污染新 worker 首帧）')
  // ensureStarted 的「收尾中重生」分支必须清 buffer
  const iEnsure = code.indexOf('function ensureStarted()')
  const ensureBody = code.slice(iEnsure, iEnsure + 900)
  const iKill = ensureBody.indexOf('child.kill()')
  ok(iKill > 0 && /buffer = Buffer\.alloc\(0\)/.test(ensureBody.slice(iKill)),
    '★★ ensureStarted 的「已死立即重生」分支清空 buffer（exit 事件未到时的兜底）')
}

console.log('\n[4] feed 解析：坏 JSON 必须计账且不注入上层')
{
  ok(/stats\.dropped\.badJson\+\+/.test(src), '★ badJson 计账（残尾污染的后果可观测）')
  const iFeed = src.indexOf('function feed(')
  ok(iFeed > 0, '找到 feed 定义')
  // feed 内的 badJson 分支必须在 handleLine 里（行级），而非整块丢弃
  ok(/catch \(_\) \{ stats\.dropped\.badJson\+\+; return \}/.test(src),
    '★ 坏 JSON 行被丢弃并计账（单行粒度，不放大为整块失败）')
}

console.log('\n[5] 不得回退：既有 stale-epoch 语义仍保留（m70 G2/G4 契约）')
{
  // m70 断言：错误 epoch 丢弃 → staleEpoch+1；本次修复只加「epoch 为空也丢」，不改变非空比较
  const code = codeOnly(src)
  ok(/frame\.workerEpoch !== epoch/.test(code),
    '★ 非空 epoch 的严格相等比较仍保留（m70 G2/G4 契约不破）')
}

console.log(`\n[batch5-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
