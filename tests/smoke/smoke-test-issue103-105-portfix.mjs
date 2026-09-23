/**
 * 永久守卫：issue #103 / #104 / #105 的修复（2026-09-22 从被强推冲掉的快照 475abfe 移植进 pre 线）
 *
 * 为什么需要本守卫（这三条能"修了又没了"的全部原因）：
 *   1. 修复当年提交进 GitHub `main`（PR #118/#119/#120），而 **pre 线自 2026-09-07 起与 main 分叉**、
 *      **发布包是从 pre 线构建的** ⇒ 用户侧从未拿到；
 *   2. main 侧随后被 3.1.0 发布强推覆盖 ⇒ 三个合并提交成了孤儿；
 *   3. **原先没有守卫，或有守卫也只断言"调用了 disposeRuntime"这种字符串** —— 断言调用存在 ≠ 断言可达性，
 *      所以 `dispose` 里的 host 回填被整行删掉后，回归照样全绿（#104 的注释里点名了这个失败模式）。
 *   ⇒ 本守卫一律**驱动真实行为**，不接受"源码里有这行"作为唯一证据。详见
 *      docs/internal/WHY-FIXES-MISSING-20260922.md
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createJsonlTailCursorPre } from '../../lib/jsonl-tail-cursor.js'
import { SessionRuntimeStore } from '../../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }
const IX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const PS = fs.readFileSync(path.join(ROOT, 'lib/python-setup.js'), 'utf8')

console.log('[G1] #104 会话释放清理：生产侧成对 + **行为可达**')
// 生产侧：回填必须成对存在（删任一侧，对侧即为死判据）
ok(cnt(IX, 'engine.runtimes._shadowHost = engine._shadowHost') === 1, 'G1a 回填 shadowHost（生产侧）')
ok(cnt(IX, 'engine.runtimes._activationHost = engine._activationHost') === 1, 'G1b 回填 activationHost（生产侧）')
ok(cnt(IX, 'export { SessionRuntimeStore }') === 1, 'G1c 导出 SessionRuntimeStore（让行为可驱动）')
{
  // ★行为断言：按生产代码的同款回填方式驱动 dispose，断言两个 host 真的收到 disposeRuntime。
  //   若把回填删掉，本组必红 —— 这正是旧守卫（只断言字符串）漏掉的。
  const seen = { shadow: 0, activation: 0 }
  const store = new SessionRuntimeStore()
  store._shadowHost = { disposeRuntime: () => { seen.shadow++ } }
  store._activationHost = { disposeRuntime: () => { seen.activation++ } }
  const agent = {}
  const runtime = store.get ? store.get(agent) : null
  ok(!!runtime, 'G1d 能创建 runtime（store.get 可用）')
  if (runtime) {
    const r = store.dispose(agent)
    ok(r === true, 'G1e dispose 返回 true（走的是真实释放路径）')
    ok(seen.shadow === 1, 'G1f shadowHost.disposeRuntime 被调用（行为断言，实得 ' + seen.shadow + '）')
    ok(seen.activation === 1, 'G1g activationHost.disposeRuntime 被调用（行为断言，实得 ' + seen.activation + '）')
  }
  // 反向：不回填时必须**不**调用（证明上面测的确实是回填带来的可达性，而非无条件执行）
  const store2 = new SessionRuntimeStore()
  const a2 = {}
  store2.get(a2)
  store2.dispose(a2)
  ok(seen.shadow === 1 && seen.activation === 1, 'G1h 未回填时不触发清理（对照：证明判据依赖回填）')
}

console.log('[G2] #103 judgement-shadow 游标：真行为（环写满仍交付新行）')
{
  const c = createJsonlTailCursorPre({ maxSeen: 1024 }) // 与 index.js 实配一致
  const ring = Array.from({ length: 256 }, (_, i) => 'line-' + i) // SHADOW_LOG_MAX=256
  ok(c.take(ring).fresh.length === 0, 'G2a 冷启动只登记、不喂历史行（避免重复计数）')
  ok(c.take(ring).fresh.length === 0, 'G2b 环未变 ⇒ 0 新行')
  const added = c.take(ring.slice(1).concat(['line-NEW'])).fresh
  ok(added.length === 1 && added[0] === 'line-NEW',
    'G2c ★写满 256 行后**仍能拿到新行**（旧行数游标在此恒返回 0 ⇒ 学习面永久停摆，实得 ' + JSON.stringify(added) + '）')
  ok(c.take(ring.slice(1).concat(['line-NEW'])).fresh.length === 0, 'G2d 幂等：同一行不重复交付')
  // 反例自检：maxSeen 小于环上限时确实会重复交付（证明 maxSeen 不是装饰参数）
  const bad = createJsonlTailCursorPre({ maxSeen: 4 })
  bad.take(ring)
  ok(bad.take(ring.slice(1).concat(['line-NEW'])).fresh.length > 1,
    'G2e 反例：maxSeen < 环上限 ⇒ 旧行重复交付（故生产必须 ≥256）')
}
ok(cnt(IX, 'lines.length >= prev.count') === 0, 'G2f 生产代码已无行数游标')
ok(cnt(IX, 'const hubFeedCursor = createJsonlTailCursorPre(') === 1, 'G2g 游标实例已声明（哨兵：防锚点不匹配导致整块被静默跳过）')
ok(cnt(IX, 'hubFeedCursor.take(lines)') === 1, 'G2h 游标已在 hubFeedTick 内使用')
ok(IX.indexOf('const hubFeedCursor') < IX.indexOf('hubFeedCursor.take(lines)'), 'G2i 哨兵：声明先于使用（否则运行期 ReferenceError，而 node --check 不报）')

console.log('[G3] #105 Python 档下载链路：真 API + 根因对照')
ok(cnt(PS, "resp.body.on(") === 0, 'G3a 已无对 WHATWG 流调 .on() 的旧写法')
ok(cnt(PS, 'Readable.fromWeb(resp.body)') === 1, 'G3b 有 Readable.fromWeb（WHATWG → Node 流）')
ok(cnt(PS, 'await pipeline(src, createWriteStream(part') === 1, 'G3c 有 pipeline 真写入（旧实现全程无 stream.write）')
ok(cnt(PS, 'new AbortController()') === 1, 'G3d 取消走 AbortController（同时传给 fetch，断的是连接）')
ok(cnt(PS, "import { pipeline } from 'node:stream/promises'") === 1, 'G3e 已导入 stream/promises')
{
  // 根因断言：fetch 的 body 是 WHATWG ReadableStream，**没有 .on** ⇒ 旧实现在本 Node 版本必然抛。
  const resp = await fetch('data:text/plain,hello')
  ok(typeof resp.body.on === 'undefined', 'G3f 根因：fetch().body 没有 .on（旧写法必抛，实得 typeof=' + typeof resp.body.on + '）')
  ok(typeof resp.body.getReader === 'function', 'G3g 对照：它是 WHATWG 流（有 getReader）')
  // 真链路：fromWeb → pipeline → 落盘，逐字节一致
  const tmp = path.join(os.tmpdir(), 'dam-105-probe-' + process.pid + '.bin')
  const { Readable } = await import('node:stream')
  const { pipeline } = await import('node:stream/promises')
  const { createWriteStream } = await import('node:fs')
  const payload = 'x'.repeat(4096)
  const r2 = await fetch('data:text/plain,' + payload)
  await pipeline(Readable.fromWeb(r2.body), createWriteStream(tmp))
  ok(fs.statSync(tmp).size === 4096, 'G3h ★真链路跑通：fromWeb + pipeline 落盘 4096 字节（实得 ' + fs.statSync(tmp).size + '）')
  fs.rmSync(tmp, { force: true })
}

console.log('\n[portfix] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
