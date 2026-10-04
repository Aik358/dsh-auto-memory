/**
 * 采集插件注册产物的 **worker 脚本**（供 `smoke-test-g3-note-status-wire.mjs` 第 6 段使用）。
 *
 * ★为什么必须放在独立 worker 里（2026-10-04 由 wrapper 探针实证后定稿）：
 *   `apply()` 会启动一批**异步**任务 —— 末尾的 `void engine.checkUpdate(false)`
 *   （拉 notices.json / npm registry）、`fetchNotices` 读缓存、diag 日志写盘 —— 它们在 apply
 *   **返回之后**才真正发请求/写盘。同进程里即使把 fetch 换成 stub：
 *     - 一旦恢复 `globalThis.fetch`，那些残留任务就会打到**真实网络**
 *       （实测命中 `raw.githubusercontent.com/.../notices.json` 与 `registry.npmjs.org/@a9i5k4%2Fdsh-auto-memory`）；
 *     - `rm(临时目录)` 会与滞后写盘竞争（ENOTEMPTY），甚至删完又被重建；
 *     - apply 还会给进程加 `uncaughtException` / `unhandledRejection` / `exit` 监听器。
 *   而"等一会儿再清理"是证明不了它们已结束的。把整个生命周期关进 worker 后：stub 与临时 home
 *   由 worker 独占，采集完就 `terminate()`，残留任务随 worker 一起消失；父进程再删目录不存在
 *   竞争，也绝不会碰真实网络与宿主 `DSH_HOME`。
 *
 * 协议：`workerData = { home }`；
 * 成功时 `postMessage({ ok: true, tools: [{ name, parameters }], armProbe })`。
 * `armProbe` 顺带验证 `armAutoContinue` 的子代理守卫（见 lib/index.js 该函数内的 ★2026-10-04 注释）：
 * 子代理会话不得 arm，普通会话仍须能 arm。
 */
import { parentPort, workerData } from 'node:worker_threads'
import path from 'node:path'

process.env.DSH_HOME = workerData.home
// 定时器与网络都按住：apply 启动的异步任务即便稍后才跑，也只落在 stub 上（随后被 terminate 收走）
globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
globalThis.fetch = async () => new Response('{}', { status: 503 })

// 测试桥：暴露 lib/index.js 的内部符号（MemoryEngine / diag / flushDiagnostics），不复制生产逻辑
const { apply, MemoryEngine } = await import('./audit-engine.mjs')

const tools = []
let engineRef = null
const originalLoadConfigSync = MemoryEngine.prototype.loadConfigSync
MemoryEngine.prototype.loadConfigSync = function (...args) {
  engineRef = this
  return originalLoadConfigSync.apply(this, args)
}

const cwd = path.join(workerData.home, 'workspace')
const agent = { session: { id: 'session-a', header: { cwd } } }

// 写入测试配置：`autoContinueEnabled` 的默认值是 **false**（DEFAULT_CONFIG），
// 不打开的话 armAutoContinue 会在开关那一行就 return —— 那样"子代理不 arm"就是**假绿**（与守卫无关），
// 对照组也永远不会 arm。打开它，探针才真的在考守卫。
const { writeFile } = await import('node:fs/promises')
await writeFile(path.join(workerData.home, 'dsh-auto-memory.json'), JSON.stringify({
  autoContinueEnabled: true,
  teamEnabled: false,
  globalBriefEnabled: false,
  externalSources: {},
}))

apply({
  get: (k) => (k === 'agents' ? { get: (id) => (id === 'session-a' ? agent : null) } : undefined),
  on: () => {},
  systemPrompt: { context: () => () => {}, section: () => () => {} },
  tools: { register: (t) => { tools.push(t); return () => {} } },
  webServer: { register: () => () => {} },
  effect: (f) => { try { f() } catch { /* disposer 失败不影响采集 */ } },
}, {})

/** 子代理守卫探针：子代理会话不得 arm；普通会话仍须能 arm（证明守卫没误伤正常路径）。 */
let armProbe = null
try {
  const wl = { ratio: 0.99, tokens: 9000000, window: 10000000, source: 'probe', modelKnown: true, hard: true }
  const subAgent = { session: { id: 'probe-sub-1', header: { cwd, origin: 'subagent', delegationDepth: 1 } } }
  engineRef.armAutoContinue(subAgent, wl)
  const armedForSubAgent = !!(engineRef._autoContState && engineRef._autoContState.armed)

  const normalAgent = { session: { id: 'probe-normal-1', header: { cwd } } }
  engineRef.armAutoContinue(normalAgent, wl)
  const armedForNormal = !!(engineRef._autoContState && engineRef._autoContState.armed)

  armProbe = { ok: true, hasEngine: !!engineRef, armedForSubAgent, armedForNormal }
} catch (e) {
  armProbe = { ok: false, error: String((e && e.message) || e) }
}

parentPort.postMessage({
  ok: true,
  tools: tools.map((t) => ({ name: t.name, parameters: t.parameters })),
  armProbe,
})
