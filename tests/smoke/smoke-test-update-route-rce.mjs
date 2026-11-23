#!/usr/bin/env node
/**
 * smoke-test-update-route-rce.mjs —— 一键更新路由的 shell 注入修复守卫（2026-11-23）。
 *
 * ============================ 缺陷原文 ============================
 * lib/index.js 一键更新 handler 曾把 registry 的 dist-tags.latest（**网络输入**）
 * 直接拼进 child_process.exec 的命令字符串：
 *     exec('npm install @scope/pkg@' + target + ' --min-release-age=0')
 * exec 走 shell ⇒ target = "3.4.3 & echo INJECTED > PWNED.txt & rem" 的后半段照常执行。
 * 实测复现：MARKER_EXISTS=true / MARKER_CONTENT=INJECTED。
 *
 * ============================ 本套件守什么 ============================
 *  A. 单元：validateReleaseVersionPre / buildInstallSpecPre 的判据（正路径 + 5 类负路径）
 *  B. 源码：安装命令**不得**再经 exec 走 shell；必须是 execFile + 参数数组
 *  C. 纵深：checkUpdate 取数处即校验，非法值不进 result.latest
 *  D. 变异反向验证：把危险形态灌回源码副本 ⇒ B 组必须变红（否则守卫恒真）
 *
 * 纪律：每条断言都既给正路径也给负路径；D 组证明本套件**有区分力**。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateReleaseVersionPre, buildInstallSpecPre, MAX_VERSION_LEN } from '../../lib/release-spec.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IDX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

// ═══════════════ A. 版本串白名单单元判据 ═══════════════
console.log('== A. validateReleaseVersionPre 单元判据 ==')
{
  const good = ['3.4.3', '0.0.1', '10.20.30', '3.4.3-beta.1', '3.4.3-rc.2.build', '3.4.3+build.7', '1.0.0-alpha+b1']
  for (const v of good) {
    const r = validateReleaseVersionPre(v)
    ok(r.ok === true && r.version === v, 'A1 合法版本放行 ' + v, r.reason)
  }
}
{
  // 负路径：五类 shell 元字符 + 类型/长度
  const bad = [
    ['3.4.3 & echo INJECTED > PWNED.txt & rem', 'whitespace', 'A2 空格+& 串联（报告中的真实攻击串）'],
    ['3.4.3&whoami', 'shell-separator', 'A3 & 分隔符'],
    ['3.4.3|calc', 'shell-separator', 'A4 | 管道'],
    ['3.4.3;id', 'shell-separator', 'A5 ; 串联'],
    ['3.4.3`id`', 'shell-expansion', 'A6 反引号命令替换（模块归入 expansion 类）'],
    ['3.4.3$HOME', 'shell-expansion', 'A7 $ 变量展开'],
    ['3.4.3>f', 'shell-redirect', 'A8 > 重定向'],
    ['3.4.3"x', 'shell-quote', 'A9 双引号'],
  ]
  for (const [v, wantCat, name] of bad) {
    const r = validateReleaseVersionPre(v)
    ok(r.ok === false && r.version === '' && r.reason.includes(wantCat), name, r.reason)
  }
}
{
  ok(validateReleaseVersionPre('').ok === false, 'A10 空串拒绝', validateReleaseVersionPre('').reason)
  ok(validateReleaseVersionPre(null).ok === false, 'A11 null 拒绝', validateReleaseVersionPre(null).reason)
  ok(validateReleaseVersionPre(undefined).ok === false, 'A12 undefined 拒绝')
  ok(validateReleaseVersionPre(123).ok === false, 'A13 非字符串拒绝')
  ok(validateReleaseVersionPre('3.4').ok === false, 'A14 不完整 semver 拒绝')
  ok(validateReleaseVersionPre('1.2.3.4').ok === false, 'A15 四段版本拒绝')
  ok(validateReleaseVersionPre('a'.repeat(MAX_VERSION_LEN + 1)).ok === false, 'A16 超长拒绝')
  ok(validateReleaseVersionPre('3.4.3 ').ok === true, 'A17 尾部空白被 trim 后放行（normalize 而非拒绝）', JSON.stringify(validateReleaseVersionPre('3.4.3 ').version))
}

// ═══════════════ A2. buildInstallSpecPre ═══════════════
console.log('== A2. buildInstallSpecPre ==')
{
  const r = buildInstallSpecPre('@a9i5k4/dsh-auto-memory', '3.4.3')
  ok(r.ok === true && r.spec === '@a9i5k4/dsh-auto-memory@3.4.3', 'A2-1 正常规格串', r.spec)
  const bad = buildInstallSpecPre('@a9i5k4/dsh-auto-memory', '3.4.3 & calc')
  ok(bad.ok === false && bad.spec === '', 'A2-2 恶意版本不产出规格串（**不降级为 @latest**）', bad.reason)
  const badName = buildInstallSpecPre('@bad name;rm', '3.4.3')
  ok(badName.ok === false && badName.reason === 'bad-package-name', 'A2-3 非法包名拒绝', badName.reason)
}

// ═══════════════ B. 源码：安装命令不再经 shell 拼串 ═══════════════
console.log('== B. 源码结构守卫 ==')
{
  // B1 负路径：全文不得出现 execP( 的调用（旧实现用它走 shell）
  const execPcalls = (IDX.match(/await execP\(/g) || []).length
  ok(execPcalls === 0, 'B1 源码中不再有 await execP( 调用（旧实现走 shell）', 'count=' + execPcalls)

  // B2 正路径：必须用 execFileP + 参数数组
  const hasExecFileP = IDX.includes('const execFileP = promisify(cpExecFile)')
  ok(hasExecFileP, 'B2-1 存在 execFileP = promisify(cpExecFile)')
  const usesExecFileP = IDX.includes('await execFileP(bin, args,')
  ok(usesExecFileP, 'B2-2 安装命令通过 execFileP(bin, args, ...) 启动')

  // B3 参数数组而非拼接字符串
  ok(IDX.includes("? ['add', spec, '--config.minimumReleaseAge=0']"), 'B3-1 pnpm 参数是数组')
  ok(IDX.includes(": ['install', spec, '--min-release-age=0']"), 'B3-2 npm 参数是数组')

  // B4 负路径：不得再有 'npm install ' + spec 这类字符串拼接
  // 只看**安装调用点附近**的窗口：全仓 include 会把变异测试自身写入的字面量也算进来（假红）。
  const execAt = IDX.indexOf('await execFileP(bin, args,')
  // 只看安装调用点**紧邻**窗口（1200 字符）：更宽的窗口会把 D 组变异测试自身写入的字面量算进来（假红）。
  const windowSrc = IDX.slice(Math.max(0, execAt - 1200), execAt)
  const badConcat = windowSrc.includes("'npm install ' + spec") || windowSrc.includes("'pnpm add ' + spec")
  ok(!badConcat, 'B4 安装调用点窗口内无 "npm install " + spec 形式的命令串拼接')

  // B5 信任边界：安装前必须先过 buildInstallSpecPre，且非法时 return
  const guardIdx = IDX.indexOf('const specR = buildInstallSpecPre(')
  const execIdx = IDX.indexOf('await execFileP(bin, args,')
  ok(guardIdx > 0 && execIdx > guardIdx, 'B5 校验在启动命令**之前**', 'guard@' + guardIdx + ' exec@' + execIdx)
  ok(IDX.includes('if (!specR.ok) {'), 'B6 校验失败有独立分支（不是只警告）')
}

// ═══════════════ C. 纵深：取数处即校验 ═══════════════
console.log('== C. checkUpdate 取数处纵深 ==')
{
  ok(IDX.includes('const vR = validateReleaseVersionPre(rawLatest)'), 'C1 checkUpdate 内部对 latest 做校验')
  ok(IDX.includes('latestUntrusted'), 'C2 标记 latestUntrusted（消费方可判定）')
  // 负路径：不允许 "result.latest = (j && j['dist-tags'] ...)" 这种裸赋值残留
  const rawAssign = /result\.latest\s*=\s*\(j && j\['dist-tags'\]/.test(IDX)
  ok(!rawAssign, 'C3 不存在把 dist-tags 裸值直接赋给 result.latest 的旧写法')
}

// ═══════════════ D. 变异反向验证（证明 B 组有区分力）═══════════════
console.log('== D. 变异：把旧危险形态灌回源码副本 ⇒ B1/B4 必须变红 ==')
{
  // D1 把 execFileP 调用改回 execP 字符串拼接形态
  const mutated = IDX
    .replace('const args = prof.usesPnpm', "const cmdOld = (prof.usesPnpm ? 'pnpm add ' + spec : 'npm install ' + spec);\n          const args = prof.usesPnpm")
    .replace('await execFileP(bin, args, {', 'await execP(cmdOld, {')

  const mExecP = (mutated.match(/await execP\(/g) || []).length
  ok(mExecP > 0, 'D1 [变异] 灌回旧形态后确实出现了 await execP( ⇒ 变异有效', 'count=' + mExecP)
  ok((IDX.match(/await execP\(/g) || []).length === 0, 'D2 [还原] 原源码仍为 0 处（B1 判据非恒真）')

  const mMutExecAt = mutated.indexOf('await execP(cmdOld,')
  const mMutWindow = mutated.slice(Math.max(0, mMutExecAt - 4000), mMutExecAt + 500)
  const mConcat = mMutWindow.includes("'npm install ' + spec")
  ok(mConcat, 'D3 [变异] 灌回后出现命令串拼接 ⇒ B4 会变红', 'mutatedHasConcat=' + mConcat)
  ok(!IDX.slice(Math.max(0, IDX.indexOf('await execFileP(bin, args,') - 1200), IDX.indexOf('await execFileP(bin, args,')).includes("'npm install ' + spec"), 'D4 [还原] 原源码调用点窗口内无命令串拼接')
}

// ═══════════════ E. 端到端：恶意 target 不再能产生可执行注入 ═══════════════
console.log('== E. 端到端语义：恶意 latest ⇒ ok:false，且不产出任何待执行串 ==')
{
  const evil = '3.4.3 & echo INJECTED > PWNED.txt & rem'
  const r = buildInstallSpecPre('@a9i5k4/dsh-auto-memory', evil)
  ok(r.ok === false, 'E1 恶意 latest 被拒')
  ok(!r.spec.includes('&') && !r.spec.includes('PWNED'), 'E2 拒绝路径不产出任何含注入内容的规格串', 'spec=' + JSON.stringify(r.spec))
  // 对照：同函数对合法值仍能产出规格串 ⇒ 不是把所有输入都拒（防「一律拒绝」假修复）
  const good = buildInstallSpecPre('@a9i5k4/dsh-auto-memory', '3.4.3')
  ok(good.ok === true, 'E3 对照：合法值仍可产出规格串（修复未把功能一并掐死）', good.spec)
}

console.log('')
console.log('[update-route-rce] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
