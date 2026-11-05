/**
 * ★#469（2026-11-02）：smoke 测试的共享脚手架（deep harness）。
 *
 * 【为什么需要它】
 *   tests/smoke/ 下 550 个套件里，**423 个各自重写了一遍** ok/eq 计数器，
 *   隔离临时目录、DSH_HOME 隔离、平台能力探测（能否建 junction/symlink）也是逐文件复制。
 *   新写一个测试的边际成本是整段脚手架 —— 这就是「测试 seam 太浅」的具体表现。
 *
 * 【本模块的判据（Deep module：接口小、实现厚）】
 *   接口收成两档，正好覆盖现有全部用法：
 *     · 纯函数档：直接调卫星模块导出（现状主流）——用 T.ok / T.eq / T.skip 断言即可；
 *     · 引擎档：T.isolatedHome() 给隔离的 DSH_HOME，T.tmpdir() 给隔离工作目录。
 *   全部清理挂在 process exit 上，调用方不需要自己 rmSync。
 *
 * 【纪律】
 *   ① **零第三方依赖**（本仓交付物不得依赖第三方插件，测试同样遵守）；
 *   ② **绝不影响退出码语义**：T.done() 与现有 550 个套件逐字同款 —— fail>0 ⇒ exit 1，
 *      否则 exit 0。run-smoke.mjs 只看退出码。
 *   ③ **SKIP 绝不当通过**：跳过必须显式计数并打印原因（与既有纪律一致）；
 *      只要有 SKIP 而无 FAIL，退出码仍为 0，但汇总行会写明 skip 数，不会被误读成全绿。
 *   ④ **不改变已有行为**：本文件是**新增**模块，存量 423 个套件一个都不改（用户拍板：
 *      「只让新写的测试用它，不改造存量」）。因此它的接口必须能容纳两种风格而无需改写存量。
 *
 * 【用法】
 *     import { createHarness } from './_harness.mjs'
 *     const T = createHarness('my-suite')
 *     T.ok(cond, '断言名')
 *     T.eq(got, want, '断言名')
 *     const dir = T.tmpdir('my-suite-')          // 自动清理
 *     const home = T.isolatedHome()              // 隔离 DSH_HOME（自动清理）
 *     if (T.canLink()) { ... } else T.skip('链接段', '本平台无法创建目录链接')
 *     T.done()
 */
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** 模块级 cleanup 注册表：**整个进程只挂一个 exit 监听器**。
 *  旧写法每个 harness 实例各挂一个 process.once('exit') ⇒ 同一套件建多个 harness 时监听器累积
 *  （Node 默认 maxListeners=10 会告警，且每个实例的清理函数被重复持有）。 */
const _cleanupRegistry = new Set()
process.once('exit', () => {
  for (const fn of _cleanupRegistry) { try { fn() } catch (_) {} }
  _cleanupRegistry.clear()
})
function registerCleanup(fn) { _cleanupRegistry.add(fn) }

/** 平台能力探测结果缓存 —— 550 个套件各跑一遍是真实浪费（探测本身要建目录+链接）。 */
let _canLinkCache = null

/** 探测本平台能否创建目录链接（junction 优先，退回 dir 链接）。
 *  失败 ⇒ false。**调用方必须把相关段降级为 SKIP，绝不当通过**。 */
export function canCreateDirLink() {
  if (_canLinkCache !== null) return _canLinkCache
  try {
    const t = mkdtempSync(path.join(tmpdir(), 'dam-harness-probe-'))
    try {
      mkdirSync(path.join(t, 'd'), { recursive: true })
      try { symlinkSync(path.join(t, 'd'), path.join(t, 'j'), 'junction') }
      catch (_) { symlinkSync(path.join(t, 'd'), path.join(t, 'j'), 'dir') }
      _canLinkCache = lstatSync(path.join(t, 'j')).isSymbolicLink()
    } finally {
      try { rmSync(t, { recursive: true, force: true }) } catch (_) {}
    }
  } catch (_) { _canLinkCache = false }
  return _canLinkCache
}

/**
 * 创建一个套件的 harness。同一次进程内可创建多个（各自独立计数）。
 *
 * @param {string} [name] 套件名（仅用于输出前缀；可省）
 */
export function createHarness(name) {
  const tag = name ? '[' + name + '] ' : ''
  let pass = 0, fail = 0, skipped = 0
  const cleanups = []
  let finished = false

  // 退出时统一清理：正常路径由 done() 清理，异常路径由 exit 钩子兜底。
  const runCleanups = () => {
    for (const fn of cleanups.reverse()) { try { fn() } catch (_) {} }
    cleanups.length = 0
  }
  registerCleanup(runCleanups)

  const H = {
    get pass() { return pass },
    get fail() { return fail },
    get skipped() { return skipped },

    /** 断言通过/失败。第三参可选：失败时附加的「实得值」说明（便于排查）。 */
    ok(cond, label, extra) {
      if (cond) { pass++; console.log('  ok   - ' + label) }
      else { fail++; console.error('  RED  - ' + label + (extra === undefined ? '' : ' :: ' + extra)) }
      return !!cond
    },

    /** 深比较断言（JSON 口径，与存量套件的 eq 逐字同款语义）。 */
    eq(got, want, label) {
      const a = JSON.stringify(got), b = JSON.stringify(want)
      return H.ok(a === b, label, a === b ? undefined : 'got=' + a + ' want=' + b)
    },

    /** 跳过：**绝不当通过** —— 独立计数并打印原因。 */
    skip(label, reason) {
      skipped++
      console.log('  SKIP - ' + label + (reason ? ' (' + reason + ')' : ''))
    },

    /** 隔离临时目录（自动登记清理）。prefix 建议带上套件名以便残留可溯源。 */
    tmpdir(prefix) {
      const d = mkdtempSync(path.join(tmpdir(), prefix || (name ? name + '-' : 'dam-')))
      cleanups.push(() => { try { rmSync(d, { recursive: true, force: true }) } catch (_) {} })
      return d
    },

    /** 登记一个自定义清理动作（逆序执行）。 */
    onCleanup(fn) { if (typeof fn === 'function') cleanups.push(fn) },

    /** 平台能力：能否创建目录链接。false 时调用方**必须**走 skip。 */
    canLink() { return canCreateDirLink() },

    /**
     * 隔离的 DSH_HOME 目录（已建好 memory/ 子目录），并返回一个应用隔离环境的辅助函数。
     * 用法：const { home, applyEnv, restoreEnv } = T.isolatedHome()
     *      applyEnv(); ...跑被测代码...; restoreEnv()
     */
    isolatedHome() {
      const home = H.tmpdir('dam-home-')
      mkdirSync(path.join(home, 'memory'), { recursive: true })
      const saved = {}
      const KEYS = ['DSH_HOME', 'HOME', 'USERPROFILE']
      return {
        home,
        applyEnv() { for (const k of KEYS) { saved[k] = process.env[k]; process.env[k] = home } },
        restoreEnv() { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } },
      }
    },

    /** 收尾：打印汇总、清理、设定退出码。与存量 550 个套件逐字同款退出语义。 */
    done() {
      if (finished) return
      finished = true
      runCleanups()
      console.log('\n' + tag + (fail === 0 ? 'ALL PASS' : 'HAS FAILURE') +
        ' — PASS=' + pass + ' FAIL=' + fail + (skipped ? ' SKIP=' + skipped : ''))
      process.exitCode = fail === 0 ? 0 : 1
    },
  }
  return H
}

export default { createHarness, canCreateDirLink }
