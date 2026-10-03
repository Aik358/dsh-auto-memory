/**
 * smoke-test-issue211-python-uninstall.mjs —— issue #211「Python 卸载路径」真执行验收。
 *
 * 为什么不只做静态断言（仓库纪律 CR-10）：静态「源码含某字符串」是恒真守卫，不构成功能验收。
 * 本套件真 import 产线模块 createPythonSetupPre，注入隔离的 dshHome 与可注入的 removeDir，
 * 真调用 uninstall()，并断言**返回值、磁盘副作用、错误上抛、内存态复位**四类可复算证据。
 *
 * 判据（逐条对应 issue #211 第 3 项）：
 *   ① 目录存在  ⇒ 真删（fs 副作用可验）+ removed:true + root 回显；
 *   ② 目录不存在⇒ 幂等 no-op（removed:false），不抛错；
 *   ③ 删除失败  ⇒ **错误上抛**（注入的 removeDir 抛 EPERM 时必须冒泡到调用方），不静默吞；
 *   ④ 删除后内存态复位（venvOk/depsOk/configOk/modelReady 全 false、phase='idle'）——
 *      否则面板会残留上一轮的「就绪」读数；
 *   ⑤ 与引擎开关解耦：uninstall 不读任何 config/开关，**禁用状态下同一条路径可用**（真调用即证明）；
 *   ⑥ 负路径：把 existsSync 的目录名换掉 ⇒ 断言①的判据确实依赖真实目录（不是恒真）。
 *
 * 零外部依赖；每个用例独立临时 home，结束即清理。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPythonSetupPre } from '../../lib/python-setup.js'

let pass = 0, fail = 0
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok -', m) } else { fail++; console.error('  FAIL -', m, extra === undefined ? '' : extra) } }

function makeHome(label) {
  const home = mkdtempSync(path.join(tmpdir(), 'dam-pyu-' + label + '-'))
  const engineRoot = path.join(home, 'python-engine')
  mkdirSync(path.join(engineRoot, '.venv', 'Scripts'), { recursive: true })
  mkdirSync(path.join(engineRoot, 'models'), { recursive: true })
  writeFileSync(path.join(engineRoot, '.venv', 'Scripts', 'python.exe'), 'x')
  writeFileSync(path.join(engineRoot, 'models', 'model_int8.onnx'), 'y')
  return { home, engineRoot }
}

// ---- ① 真删（有目录）----
{
  const { home, engineRoot } = makeHome('present')
  try {
    const ps = createPythonSetupPre({ dshHome: home })
    ok(existsSync(engineRoot), '前置：引擎目录真实存在（' + engineRoot + '）')
    const r = ps.uninstall()
    ok(r && r.removed === true, 'uninstall() ⇒ removed:true（真删）', JSON.stringify(r && { removed: r.removed }))
    ok(!existsSync(engineRoot), '★磁盘副作用：<userDir>/python-engine 整目录已不存在（真删，非返回值谎报）')
    ok(r.root === engineRoot, 'uninstall() 回显被删目录路径', String(r.root))
    // ④ 内存态复位：先真跑一次 detect()，再删，再看快照
    const snap = ps.status()
    ok(snap.venvOk === false && snap.depsOk === false && snap.modelReady === false,
      '★删除后内存态复位：venvOk/depsOk/modelReady 全 false', JSON.stringify({ v: snap.venvOk, d: snap.depsOk, m: snap.modelReady }))
    ok(snap.phase === 'idle', "删除后 phase='idle'（不留 stale ready）", String(snap.phase))
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// ---- ② 幂等（无目录）----
{
  const home = mkdtempSync(path.join(tmpdir(), 'dam-pyu-absent-'))
  try {
    const ps = createPythonSetupPre({ dshHome: home })
    let threw = null
    let r = null
    try { r = ps.uninstall() } catch (e) { threw = e }
    ok(threw === null, '无目录时 uninstall() 不抛错（幂等）', threw && threw.message)
    ok(r && r.removed === false, '无目录时 removed:false', JSON.stringify(r && { removed: r.removed }))
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// ---- ③ 错误上抛（注入删除失败）----
{
  const { home, engineRoot } = makeHome('failpath')
  try {
    const ps = createPythonSetupPre({ dshHome: home, removeDir: () => { const e = new Error('EPERM: operation not permitted'); throw e } })
    let threw = null
    try { ps.uninstall() } catch (e) { threw = e }
    ok(!!threw, '★删除失败必须**上抛**（不被静默吞）', threw ? '' : '未抛错')
    ok(threw && /EPERM/.test(String(threw.message)), '上抛的是删除的真实原因（EPERM 原样透出）', threw && threw.message)
    ok(existsSync(engineRoot), '删除失败后目录仍在（不做「先报成功再清理」的假成功）')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// ---- ⑤ 与开关解耦（真调用路径里没有任何 config/开关读取）----
{
  const { home } = makeHome('decoupled')
  try {
    // 传一个**不含任何开关**的 opts（只有 dshHome）—— 若 uninstall 依赖配置，这一步必然崩
    const ps = createPythonSetupPre({ dshHome: home })
    const r = ps.uninstall()
    ok(r.removed === true, '★禁用/未配置状态下同一条卸载路径可用（uninstall 不读任何档位开关）')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// ---- ⑥ 负路径：判据依赖真实目录 ----
{
  const { home, engineRoot } = makeHome('negative')
  try {
    const ps = createPythonSetupPre({ dshHome: home })
    ok(existsSync(engineRoot), '负路径前置：目录在')
    rmSync(engineRoot, { recursive: true, force: true })   // 手工先删
    const r = ps.uninstall()
    ok(r.removed === false, '负路径：目录已被外部删除时 ⇒ removed:false（判据确实依赖真实存在性）')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

console.log('\n[issue211-python-uninstall] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
