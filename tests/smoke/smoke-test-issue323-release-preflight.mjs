/**
 * issue #323 回归锁 —— **行为级**（真起子进程跑 release.mjs；断言的是**发布目标是否被保住**）。
 *
 * 缺陷形态（上游对照 16 PASS / 4 FAIL / 5 SKIP，v3.2.13 残留）：
 *   tools/release.mjs 的源侧校验（源是不是目录 / 必需目录 / 必需工具 / Python 运行时 / 可读性）
 *   全部发生在**清空发布目标之后**。于是「源是普通文件 / 缺一个必需目录 / 缺一个必需工具 /
 *   缺 Python 运行时 / 必需文件读不动」这些**一眼就能判死的输入**，也会先把 REL 里的旧内容
 *   循环删掉，然后才报错退出 ⇒ **一次失败的发布毁掉上一版发布基座**。
 *   修法：所有能判「这棵树不能用来构建」的检查前置到 mkdirSync/rmSync 之前，fail closed。
 *
 * ★验收判据不是退出码，而是**目标是否逐字节保住**（上游对照的关键洞察）：
 *   旧实现「非零退出」同样成立，但目标已经被删空 —— 只断言退出码会放过这条缺陷。
 *   故每个负路径都断言：REL 的哨兵文件**还在** + .git/.gitignore 未被碰 + 报错点名缺什么。
 *
 * ⚠️ 全程只对**临时夹具**验证：REL 一律落在 mkdtemp 目录里，绝不指向真实发布基座。
 *
 * 运行：node tests/smoke/smoke-test-issue323-release-preflight.mjs
 * 退出码：有 FAIL 即 1。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
// RELEASE_PATH 只给**变异复现**用：指向一份被故意回退的 release.mjs（见文件末 §C 的说明），
// 让「回退 ⇒ 必红」这条能被任何人一条命令复算，而不是只能相信套件内部的自证。
const REAL_RELEASE = process.env.RELEASE_PATH ? path.resolve(process.env.RELEASE_PATH) : path.join(ROOT, 'tools', 'release.mjs')
// 变异复现模式下跳过 §C 自身（否则会拿变异版再去变异一次，语义混乱）
const MUTANT_MODE = !!process.env.RELEASE_PATH
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-323-preflight-'))
const VERSION = '9.9.9'

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }

/** 一棵**完整**的源夹具（每条负路径只破坏其中一处；正路径要能真的走起来）。 */
function sourceAt(dir) {
  for (const d of ['lib', 'tests', 'python', 'tools']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  const files = {
    'lib/index.js': 'export const fixture = true\n',
    'lib/client.js': 'export const fixture = true\n',
    'lib/marker.txt': 'source-must-survive\n',
    'cordis.patch.yml': '- id: auto-memory\n  package: "@a9i5k4/dsh-auto-memory"\n',
    'CHANGELOG.md': '## [' + VERSION + ']\n',
    'locale/sentinel.json': '{"sentinel":"323"}\n',
    'tools/run-smoke.mjs': '// fixture\n',
    'tools/smoke-impact.mjs': '// fixture\n',
    'tools/build-iter5-skin.mjs': '// fixture\n',
    'tools/reconcile-upstream.mjs': 'console.log(JSON.stringify({ artifacts: [], unregistered: [] }))\n',
  }
  for (const f of ['worker_v1.py', 'worker_semantic_v1.py', 'm7_activation_features_v2.py', 'm7_embedding_v1.py']) {
    files['python/' + f] = '# fixture\n'
  }
  for (const [name, text] of Object.entries(files)) put(path.join(dir, name), text)
  // release.mjs **本体**拷进夹具，使其相对解析的 DEV == 夹具自身
  fs.copyFileSync(REAL_RELEASE, path.join(dir, 'tools', 'release.mjs'))
  return dir
}

/** 目标侧：一个「有旧内容」的发布基座（哨兵 + .git + .gitignore，三者都必须活下来）。 */
function targetAt(dir, script) {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  put(path.join(dir, 'old.txt'), 'old-release-must-survive\n')
  put(path.join(dir, '.git', 'sentinel'), 'keep-git\n')
  put(path.join(dir, '.gitignore'), 'keep-ignore\n')
  if (script) fs.copyFileSync(script, path.join(dir, '__script.md'))
  return dir
}
const snapshot = (dir) => {
  const out = []
  const walk = (base) => {
    for (const name of fs.readdirSync(base).sort()) {
      const p = path.join(base, name)
      const st = fs.lstatSync(p)
      if (st.isDirectory()) { out.push([path.relative(dir, p), 'dir']); walk(p) }
      else out.push([path.relative(dir, p), crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])
    }
  }
  walk(dir)
  return out
}

function run(dev, rel, base, script, extraEnv) {
  const r = spawnSync(process.execPath, [script, VERSION], {
    cwd: base, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: {
      ...process.env, DSH_AUTO_MEMORY_DEV: dev, DSH_AUTO_MEMORY_REL: rel,
      TMP: base, TEMP: base, TMPDIR: base, DSH_HOME: path.join(base, 'isolated-home'),
      ...(extraEnv || {}),
    },
  })
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

/** 负路径通用断言：目标**逐字节未变** + 非零退出 + 报错点名原因。 */
function rejectCase(name, { break: breakFn, reason, script }) {
  const base = path.join(FIXTURE, 'case-' + name)
  fs.mkdirSync(base, { recursive: true })
  const dev = sourceAt(path.join(base, 'source'))
  const rel = targetAt(path.join(base, 'rel'))
  const scriptToRun = script || path.join(dev, 'tools', 'release.mjs')
  breakFn(dev)
  const before = snapshot(rel)
  const r = run(dev, rel, base, scriptToRun)
  ok(r.status !== 0, '#323 [' + name + '] 非零退出（源不可用必须拒绝构建）', 'status=' + r.status)
  const after = snapshot(rel)
  ok(JSON.stringify(after) === JSON.stringify(before),
    '★#323 [' + name + '] **发布目标逐字节未变**（旧实现:先清空 REL 再报错 ⇒ 上一版基座被毁）',
    'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after))
  ok(fs.existsSync(path.join(rel, 'old.txt')), '★#323 [' + name + '] 旧发布内容仍在（哨兵文件 alive）')
  ok(fs.existsSync(path.join(rel, '.git', 'sentinel')) && fs.existsSync(path.join(rel, '.gitignore')),
    '★#323 [' + name + '] .git / .gitignore 未被碰（清空循环的原有豁免仍成立）')
  // 报错里带 ANSI 反色转义，按**语义片段**断言（点名了缺什么），不做逐字匹配
  ok(new RegExp(reason).test(r.out), '#323 [' + name + '] 报错点名原因 /' + reason + '/', r.out.slice(-400))
  ok(!/staging 目录/.test(r.out), '#323 [' + name + '] 非 dry-run 不得走 staging')
  return { base, dev, rel, out: r.out }
}

console.log('=== issue #323 release.mjs 源侧预检前置（真跑子进程，判据=目标是否保住）===')

// =====================================================================
// A. 负路径矩阵：源不可用 ⇒ 拒绝构建且**不碰目标**
// =====================================================================
{
  // ★这条的脚本不能放在 dev 里：源被换成普通文件后，<dev>/tools/release.mjs 也不复存在，
  //   子进程会以 MODULE_NOT_FOUND 退出 —— 那是「找不到脚本」，不是「拒绝构建」，鉴别力为零。
  //   故用夹具外的一份副本运行，让被测的是**预检本身**。
  const base = path.join(FIXTURE, 'case-source-is-file')
  fs.mkdirSync(base, { recursive: true })
  const dev = path.join(base, 'source')
  const rel = targetAt(path.join(base, 'rel'))
  const script = path.join(base, 'release-outer.mjs')
  fs.copyFileSync(REAL_RELEASE, script)
  put(dev, 'not-a-directory\n')          // 源 = 普通文件
  const before = snapshot(rel)
  const r = run(dev, rel, base, script)
  ok(r.status !== 0, '#323 [source-is-file] 非零退出', 'status=' + r.status)
  ok(JSON.stringify(snapshot(rel)) === JSON.stringify(before),
    '★#323 [source-is-file] 发布目标逐字节未变', 'after=' + JSON.stringify(snapshot(rel)))
  ok(fs.existsSync(path.join(rel, 'old.txt')), '★#323 [source-is-file] 旧发布内容仍在')
  ok(fs.existsSync(path.join(rel, '.git', 'sentinel')) && fs.existsSync(path.join(rel, '.gitignore')),
    '★#323 [source-is-file] .git / .gitignore 未被碰')
  ok(/不是目录|源输入检查失败|源目录/.test(r.out), '#323 [source-is-file] 报错点名原因', r.out.slice(-300))
}
rejectCase('missing-required-dir', {
  break: (dev) => fs.rmSync(path.join(dev, 'tests'), { recursive: true, force: true }),
  reason: '必需目录: tests|tests',
})
// ⚠️ 正则里**不能**写裸的 Windows 路径字面量：这条报错是 '…\source\lib\client.js'
//   形式，正则中的 'lib/client.js' 永不命中（本仓路径取证的老坑：字符类/字面量要容忍反斜杠）。
rejectCase('missing-required-file', {
  break: (dev) => fs.rmSync(path.join(dev, 'lib', 'client.js'), { force: true }),
  reason: 'client\\.js',
})
rejectCase('missing-required-tool', {
  break: (dev) => fs.rmSync(path.join(dev, 'tools', 'reconcile-upstream.mjs'), { force: true }),
  reason: 'reconcile-upstream',
})
rejectCase('missing-python-runtime', {
  break: (dev) => fs.rmSync(path.join(dev, 'python', 'worker_v1.py'), { force: true }),
  reason: 'worker_v1',
})

// 可读性：存在但读不动（EACCES）⇒ 同样必须前置拒绝
{
  const base = path.join(FIXTURE, 'case-unreadable')
  fs.mkdirSync(base, { recursive: true })
  const dev = sourceAt(path.join(base, 'source'))
  const rel = targetAt(path.join(base, 'rel'))
  const preload = path.join(base, 'inject-read-failure.mjs')
  const target = path.join(dev, 'lib', 'client.js')
  fs.writeFileSync(preload,
    'import fs from "node:fs"\n'
    + 'import { syncBuiltinESMExports } from "node:module"\n'
    + 'const original = fs.readFileSync, target = ' + JSON.stringify(target) + '\n'
    + 'fs.readFileSync = function (file, ...args) {\n'
    + '  if (String(file) === target) { const e = new Error("fixture EACCES: " + target); e.code = "EACCES"; throw e }\n'
    + '  return original.call(this, file, ...args)\n'
    + '}\n'
    + 'syncBuiltinESMExports()\n')
  const before = snapshot(rel)
  const r = run(dev, rel, base, path.join(dev, 'tools', 'release.mjs'), { NODE_OPTIONS: '--import ' + pathToFileURL(preload).href })
  ok(r.status !== 0, '#323 [unreadable-required-file] 非零退出', 'status=' + r.status)
  ok(JSON.stringify(snapshot(rel)) === JSON.stringify(before), '★#323 [unreadable-required-file] 目标逐字节未变')
  ok(/EACCES|源输入检查失败/.test(r.out), '#323 [unreadable-required-file] 报错可见(EACCES/源输入检查失败)', r.out.slice(-300))
}

// =====================================================================
// B. 正路径：源齐全 ⇒ 预检通过**之后**才允许清空目标（用哨兵消失证明顺序）
// =====================================================================
{
  const base = path.join(FIXTURE, 'case-positive')
  fs.mkdirSync(base, { recursive: true })
  const dev = sourceAt(path.join(base, 'source'))
  const rel = targetAt(path.join(base, 'rel'))
  const r = run(dev, rel, base, path.join(dev, 'tools', 'release.mjs'))
  ok(/源侧预检: OK/.test(r.out), '★#323 正路径：源齐全 ⇒ 打印「源侧预检: OK」', r.out.slice(0, 300))
  ok(!fs.existsSync(path.join(rel, 'old.txt')), '★#323 正路径：预检通过后旧内容**才**被清掉（证明前置顺序正确）')
  ok(fs.existsSync(path.join(rel, '.git', 'sentinel')) && fs.existsSync(path.join(rel, '.gitignore')),
    '★#323 正路径：清空循环仍豁免 .git / .gitignore（原有语义未改坏）')
  ok(fs.existsSync(path.join(rel, 'lib', 'marker.txt')), '#323 正路径：源内容确实复制进目标（构件真的产出了）')
  console.log('  [正路径取证] exit=' + r.status + ' 输出尾:\n' + r.out.split('\n').slice(-6).join('\n'))
}

// =====================================================================
// C. 变异反向验证：把「拒绝构建」那一步去掉 ⇒ 目标必被毁（证明这条锁真有鉴别力）
//    复算方式：复制 release.mjs → 删掉「源输入检查失败」分支里的 process.exit(1) →
//    RELEASE_PATH=<该副本> node tests/smoke/smoke-test-issue323-release-preflight.mjs ⇒ 必红。
// =====================================================================
if (!MUTANT_MODE) {
  const real = fs.readFileSync(REAL_RELEASE, 'utf8')
  // ★变异用**语义等价的最小回退**，不做整块剪贴：
  //   整块剪贴要自己找「块尾」——本仓已记过教训：块边界借邻接物当终点，会把中间内容一起吞掉
  //   （本次实测正是如此：剪出来的变异文件语法坏掉，变异红成了「崩溃红」，鉴别力归零）。
  //   最小回退 = 把「非 dry-run 时拒绝构建」的那一步去掉 —— 其余检查全留着，
  //   于是「检查发现了问题，却仍然往下走去清空目标」，正是 #323 的旧行为。
  const MUT_ANCHOR = [
    '    console.error(\'[release] ❌ 源输入检查失败，**未创建/未清空发布目标**:\')',
    '    for (const p of sourceProblems) console.error(\'   · \' + p)',
    "    console.error('   修法:补齐上面点名的源侧文件/目录后重跑；本脚本在源侧预检通过前不会碰发布基座。')",
    '    process.exit(1)',
  ].join('\r\n')
  const mutHits = real.split(MUT_ANCHOR).length - 1
  ok(mutHits === 1, '变异定位:#323「拒绝构建」整块锚点恰命中 1 次', 'hits=' + mutHits)
  if (mutHits === 1) {
    const mutated = path.join(FIXTURE, 'mutated-323-release.mjs')
    fs.writeFileSync(mutated, real.replace(MUT_ANCHOR, MUT_ANCHOR.replace('    process.exit(1)', '')))
    const syn = spawnSync(process.execPath, ['--check', mutated], { encoding: 'utf8' })
    ok(syn.status === 0, '变异文件语法可用', String(syn.stderr || '').slice(0, 200))

    // 变异后重跑「缺 Python 运行时」这条：源不可用，但旧实现会把目标清掉
    const base = path.join(FIXTURE, 'case-mutant')
    fs.mkdirSync(base, { recursive: true })
    const dev = sourceAt(path.join(base, 'source'))
    const rel = targetAt(path.join(base, 'rel'))
    // ★用**独立脚本副本**跑变异，不要覆盖 dev/tools/release.mjs：
    //   ① 变异版缺预检，若它同时充当「源里的 release.mjs」，后续相位会把它当成源文件核对，
    //      失败原因会变成别的（假红）；② 保持正路径夹具干净。
    const mutScript = path.join(base, 'release-mutant.mjs')
    fs.copyFileSync(mutated, mutScript)
    fs.rmSync(path.join(dev, 'python', 'worker_v1.py'), { force: true })
    const before = snapshot(rel)
    const r = run(dev, rel, base, mutScript)
    const after = snapshot(rel)
    ok(r.status !== 0, '★变异(摘掉预检)仍非零退出 —— 这正是「只看退出码会放过本缺陷」的实证', 'status=' + r.status)
    ok(JSON.stringify(after) !== JSON.stringify(before),
      '★★变异必红:摘掉预检后**目标被清空**(old.txt 消失)', 'after=' + JSON.stringify(after))
    ok(!fs.existsSync(path.join(rel, 'old.txt')),
      '★★变异必红:旧发布内容被毁(修复前正是这个形态)')
    console.log('  [变异取证] 摘掉预检 -> exit=' + r.status + ' old.txt存在=' + fs.existsSync(path.join(rel, 'old.txt')))
  }
}

fs.rmSync(FIXTURE, { recursive: true, force: true })
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
