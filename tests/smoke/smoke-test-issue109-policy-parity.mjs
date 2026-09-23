/**
 * #109 守卫 —— 双份冻结策略目录的**一致性锁**（2026-09-22）。
 *
 * ── 被守卫的缺陷 ──
 * 同一批冻结策略工件同时存在于两个目录：
 *   · `lib/policies/`      —— JS 侧优先探测路径（纯 JS 部署必达，npm 包 JS-only 也含）
 *   · `python/policies/`   —— Python 侧 / 旧部署回退路径
 * 宿主 `lib/index.js` 的运行时探测是「JS 侧优先，缺失回落 python 侧」（:9712 一带）。
 * 问题在于：**当前两处摘要相同只是巧合，全仓没有任何测试或运行时校验比对两者** ——
 * 于是「重标定只改一份」会静默分叉：纯 JS 用户与装了 Python 的用户跑出**两套不同的判定策略**，
 * 而没有任何出口会报出来。
 *
 * 本套件就是那道锁：**任何一份共享策略工件在两侧不一致，本套件立刻变红。**
 * 判定口径：一致性 ≠ 有锁；要的是「不一致会被发现」。
 *
 * 附：`python/policies/` 允许存在 JS 侧没有的 **决策记录**（`decision-record-*.json`，
 * 它们是 Python 侧的审计痕迹，不是运行时策略）；本套件同时对「只加在一侧的策略文件」设防。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const JS_DIR = path.join(ROOT, 'lib', 'policies')
const PY_DIR = path.join(ROOT, 'python', 'policies')

/** 决策记录是 Python 侧审计痕迹，允许只存在于 python 侧。 */
const PY_ONLY_ALLOWED = /^decision-record-.*\.json$/i

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')

console.log('== ① 两个策略目录都必须存在（缺一侧即探测链断掉） ==')
ok(existsSync(JS_DIR), 'lib/policies 存在（JS 侧优先探测路径）')
ok(existsSync(PY_DIR), 'python/policies 存在（回退路径）')

console.log('== ② 同名策略工件必须逐字节一致（这是本 issue 的核心防线） ==')
const jsFiles = readdirSync(JS_DIR).filter((n) => n.endsWith('.json'))
const pyFiles = readdirSync(PY_DIR).filter((n) => n.endsWith('.json'))
ok(jsFiles.length > 0, 'JS 侧至少有一份策略工件（否则断言会空转）')

for (const name of jsFiles.sort()) {
  const p2 = path.join(PY_DIR, name)
  if (!existsSync(p2)) {
    ok(false, `★两侧分叉：${name} 只存在于 lib/policies（python 侧缺失）`)
    continue
  }
  ok(sha(path.join(JS_DIR, name)) === sha(p2), `两侧一致：${name}`)
}

console.log('== ③ python 侧多出的文件只能是决策记录（防止「策略偷偷只加一边」） ==')
for (const name of pyFiles.sort()) {
  if (jsFiles.includes(name)) continue
  ok(PY_ONLY_ALLOWED.test(name), `python 侧独有文件是决策记录：${name}`)
}

console.log('== ④ 一致性锁本身必须可用（自证不是空转） ==')
{
  // 反向自证：造两份内容不同的临时副本，比对函数必须判「不一致」。
  const a = path.join(PY_DIR, '__parity_probe_a.json')
  const b = path.join(PY_DIR, '__parity_probe_b.json')
  try {
    writeFileSync(a, '{"v":1}', 'utf8')
    writeFileSync(b, '{"v":2}', 'utf8')
    ok(sha(a) !== sha(b), '内容不同 ⇒ 摘要不同（比对函数能真正分辨差异）')
    writeFileSync(b, '{"v":1}', 'utf8')
    ok(sha(a) === sha(b), '内容相同 ⇒ 摘要相同（不会误报）')
  } finally {
    for (const f of [a, b]) { try { rmSync(f, { force: true }) } catch (_) {} }
  }
  ok(!existsSync(a) && !existsSync(b), '探针文件已清理干净（不留垃圾文件污染策略目录）')
}

console.log('== ⑤ 运行时确实两条路径都探测（回落链没被删） ==')
{
  const INDEX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  ok(/lib['"],\s*['"]policies|'policies'/.test(INDEX), 'index.js 探测 JS 侧 policies 目录')
  ok(/python['"],\s*['"]policies|['"]python['"],\s*['"]policies['"]/.test(INDEX), 'index.js 探测 python 侧 policies 目录（回退链）')
}

console.log('\n== #109 结果 == PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
