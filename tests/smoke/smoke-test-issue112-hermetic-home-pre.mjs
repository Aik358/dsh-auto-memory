/**
 * issue #112 回归锁：冒烟套件不得依赖执行者的家目录。
 *
 * 三个套件此前直接读**真实 `~/.dsh`**（`lib/semantic-js.js` 经 `resolveDshHomePre()` 探资产、
 * 另有一个套件手拼 `USERPROFILE/.dsh/...`），于是"同一份代码，在装过语义模型的机器上红、
 * 在干净机器上绿"，CI 与本地永远对不上——这正是"回归全绿"失去可信度的机制。
 *
 * 本套件钉的是**形状**（不再手拼家目录 + 家目录口径唯一），不是运气。
 * 运行：node tests/smoke/smoke-test-issue112-hermetic-home-pre.mjs
 */
import { resolveDshHomePre, DSH_HOME_ENV_V1 } from '../../lib/dsh-home.js'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}

console.log('[H1] 家目录口径唯一：resolveDshHomePre 认 DSH_HOME 且不缓存')
{
  const before = process.env[DSH_HOME_ENV_V1]
  const a = mkdtempSync(path.join(tmpdir(), 'dam-h1-'))
  const b = mkdtempSync(path.join(tmpdir(), 'dam-h2-'))
  try {
    process.env[DSH_HOME_ENV_V1] = a
    ok(resolveDshHomePre() === a, 'DSH_HOME 生效（返回给定目录）')
    process.env[DSH_HOME_ENV_V1] = b
    ok(resolveDshHomePre() === b, '★ 中途改 DSH_HOME 立刻生效（不缓存）⇒ 测试可自我隔离')
    const spaced = a + '   '
    process.env[DSH_HOME_ENV_V1] = spaced
    ok(resolveDshHomePre() === a, '尾部空白被 trim（不因环境变量抄写差异分叉）')
  } finally {
    if (before === undefined) delete process.env[DSH_HOME_ENV_V1]; else process.env[DSH_HOME_ENV_V1] = before
    rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
  }
}

console.log('[H2] 三个曾经的越界套件必须走 DSH_HOME，不再手拼家目录')
{
  const FILES = [
    'tests/smoke/smoke-test-peer-probe-pre.mjs',
    'tests/smoke/smoke-test-m81-c2-wiring-pre.mjs',
    'tests/smoke/smoke-test-m81-fact-metadata-pre.mjs',
  ]
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '')
  for (const f of FILES) {
    const src = strip(read(f)) // 去注释：修复说明里必然提到旧写法，留着会永久假红
    ok(!/USERPROFILE|process\.env\.HOME/.test(src), f + ' 不再用 USERPROFILE/HOME 手拼 ~/.dsh 路径')
    ok(!/['"]\.dsh['"]/.test(src), f + ' 不出现字面量 .dsh 目录段（一律经 resolveDshHomePre/DSH_HOME）')
    ok(/DSH_HOME|resolveDshHomePre/.test(src), f + ' 显式声明了自己的家目录来源')
  }
}

console.log('[H3] 真实数据的断言不许把"前提"写成硬断言')
{
  const src = read('tests/smoke/smoke-test-m81-fact-metadata-pre.mjs')
  ok(!/facts\.length >= 1/.test(src), '★ 不再要求真实库 ≥1 条（空库是合法状态 ⇒ 换台机器就红）')
  ok(/无可实测记录,跳过/.test(src), '无记录时显式跳过并说明，而不是失败也不是静默假绿')
  ok(/restored, data\.facts\.length/.test(src), '真正要保的语义不变：有记录时零丢弃')
}

console.log('\n--- issue #112 套件隔离 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
