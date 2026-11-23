/**
 * _exit-guard.mjs —— 测试进程的**退出码护栏**（#536）。
 *
 * ============================ 为什么必须有它 ============================
 * lib/index.js `apply()` 会挂一个 `process.on('uncaughtException')` 处理器（:19774），
 * 这是**生产容错**：插件跑在 dsh web 里，不能因为一条未捕获异常就带崩整个宿主。
 * 它只往 stderr 打一行 `[dsh-auto-memory] uncaughtException: …`，**不改变退出码**。
 *
 * 副作用（#536 的真根因）：**任何** smoke 套件只要在收尾阶段抛异常，
 * 异常被插件处理器吞掉 ⇒ 进程仍 exit 0 ⇒ 回归把「抛异常的套件」判成 PASS（假绿）。
 * 实证：smoke-test-v4-h10-curate-apply.mjs 每次跑都在 :231 抛
 *   `ReferenceError: iv is not defined`，而 `node <该套件>; echo $?` 得到 **0**。
 *
 * ============================ 设计原则 ============================
 * ① **职责分离**：插件的 uncaughtException 是生产容错，**不动它**（不得用
 *    `removeAllListeners('uncaughtException')` 之类的做法改变生产行为）；
 *    本模块是**测试侧**的第二层监听器，只做「记账 + 改退出码」。
 * ② **记账而非抛回**：本模块的监听器**不 rethrow** —— 让进程继续跑到 finally，
 *    使清理动作有机会执行（否则一次未捕获异常会让临时目录/全局替身残留）。
 * ③ **退出码在 exit 阶段落地**：`process.on('exit')` 里置 `process.exitCode = 1`。
 *    实测这**能覆盖**显式 `process.exit(0)`（Node 以 exit 监听器结束时的 exitCode 为准），
 *    所以套件末尾的 `process.exit(fail ? 1 : 0)` 不会再把它抹掉。
 * ④ **opt-in**：不 import 本模块的套件行为逐字节不变（不改历史套件的退出语义）。
 *
 * ============================ 用法 ============================
 *   import { installExitGuard, guardCleanup } from './_exit-guard.mjs'
 *   const G = installExitGuard({ suite: 'my-suite' })
 *   try { ...主测试体... }
 *   finally {
 *     guardCleanup(G, 'restore-globals', () => { globalThis.setInterval = interval })
 *     guardCleanup(G, 'rm-temp', () => fs.rmSync(root, { recursive: true, force: true }))
 *   }
 *   console.log('[x] ' + G.summary())
 *   process.exit(G.failed() ? 1 : 0)   // 或直接依赖 G 的 exit 监听器
 *
 * ============================ 可观测 ============================
 * 记账时向 stderr 打一行**固定前缀** `[smoke-fatal]`：
 *   · 人看得到（不再只靠插件的 `[dsh-auto-memory] uncaughtException` 一行）；
 *   · tools/run-smoke.mjs 可在**运行器边界**再兜一层（子进程 exit 0 但出现该前缀 ⇒ 判 FAIL）。
 */

/** 固定前缀：运行器边界据此识别「本套件发生过致命测试异常」。改这里必须同步 tools/run-smoke.mjs。 */
export const FATAL_MARKER = '[smoke-fatal]'

/** 已安装标记（同一进程重复 install 不重复挂监听器，只把记账表并回来）。 */
let _installed = null

/**
 * 安装退出码护栏。
 *
 * @param {{suite?: string}} [opts]
 * @returns {{suite:string, fatal:Array<{kind:string,label:string,message:string}>, failed:()=>boolean, summary:()=>string, record:(kind:string,label:string,e:any)=>void, cleanups:number}}
 */
export function installExitGuard(opts = {}) {
  const suite = String(opts.suite || 'smoke');
  if (_installed) {
    // 同一进程二次调用：共用记账表（不重复挂监听器，避免 exit 监听器堆积）
    return _installed;
  }
  const fatal = [];
  const describe = (e) => {
    try {
      if (e && e.stack) return String(e.stack).split('\n').slice(0, 4).join(' | ');
      return String((e && e.message) || e);
    } catch (_) { return '(unprintable)'; }
  };
  const record = (kind, label, e) => {
    const entry = { kind, label, message: describe(e) };
    fatal.push(entry);
    // 同步打到 stderr：既是人可见的失败证据，也是运行器边界的识别锚
    try {
      process.stderr.write(FATAL_MARKER + ' [' + suite + '] ' + kind + (label ? '(' + label + ')' : '') + ': ' + entry.message + '\n');
    } catch (_) { /* 写不出去也不能让护栏自己崩 */ }
  };
  const G = {
    suite,
    fatal,
    cleanups: 0,
    record,
    failed() { return fatal.length > 0 },
    summary() {
      if (!fatal.length) return 'no fatal test exception';
      return fatal.length + ' fatal test exception(s): ' + fatal.map((x) => x.kind + (x.label ? '/' + x.label : '')).join(', ');
    },
  };

  // ── ① 未捕获**同步**异常：记账，**不 rethrow**（让 finally 有机会跑完清理）──
  process.on('uncaughtException', (err) => { record('uncaughtException', '', err) });
  // ── ② 未处理的 Promise 拒绝：同样记账 ──
  process.on('unhandledRejection', (reason) => { record('unhandledRejection', '', reason) });

  // ── ③ 退出阶段统一裁决：凡有记账 ⇒ 强制非零退出码 ──
  //    实测：exit 监听器里改 process.exitCode **能覆盖** 显式 process.exit(0)。
  process.on('exit', (code) => {
    if (!fatal.length) return;
    if (code !== 0 && code !== undefined) return;   // 已经是非零，不必改
    try { process.exitCode = 1 } catch (_) {}
  });

  _installed = G;
  return G;
}

/**
 * 包一层清理动作：**吞掉异常但记账**，并**继续执行后续清理**。
 *
 * 为什么不是直接 try/catch 吞掉：规格要求「不得只在日志里输出错误后继续成功退出」——
 * 所以这里的 catch 必须同时 `record()`，由 exit 护栏把退出码改非零。
 *
 * @param {object} G installExitGuard 的返回值
 * @param {string} label 清理步骤名（进失败证据）
 * @param {Function} fn 清理动作
 * @returns {boolean} 该步骤是否成功
 */
export function guardCleanup(G, label, fn) {
  try {
    const r = fn();
    // 清理动作可能是 async：返回 Promise 时也要兜住 rejection
    if (r && typeof r.then === 'function') {
      r.then(null, (e) => { if (G) { G.cleanups++; G.record('cleanup', label, e) } });
    }
    if (G) G.cleanups++;
    return true;
  } catch (e) {
    if (G) { G.cleanups++; G.record('cleanup', label, e) }
    return false;
  }
}

export default { installExitGuard, guardCleanup, FATAL_MARKER };
