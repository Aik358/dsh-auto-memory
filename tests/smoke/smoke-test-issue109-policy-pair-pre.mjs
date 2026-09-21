/**
 * issue #109 回归锁：冻结策略工件双份（lib/policies ↔ python/policies）的一致性。
 *
 * 缺陷形状：D1–D11 承诺冻结的激活/检索参数被存成两份，JS 侧优先读 `lib/policies`、回落到
 * `python/policies`，而 Python worker 只读自己那份。`loadAndVerifyPolicy()` 只验**单份内部**自洽
 * （goldDigest/runId 互校），**不验两份相等**，且全仓无任何测试引用 `policies/` ⇒ 重新标定时
 * 只改一份，JS 档与 Python 档对同一输入给出不同的激活决策，运行时零告警、事后不可复原。
 *
 * 运行：node tests/smoke/smoke-test-issue109-policy-pair-pre.mjs
 */
import { checkPolicyPairConsistencyPre } from '../../lib/semantic-decide.js'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}

const NAMES = ['activation_policy_v2.json', 'recall_intent_lr_v1.json']
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

console.log('[P1] 现状锁：仓库里两份必须逐字节相同（只改一份 ⇒ 本条立刻红）')
{
  const jsDir = path.join(ROOT, 'lib', 'policies')
  const pyDir = path.join(ROOT, 'python', 'policies')
  ok(existsSync(jsDir) && existsSync(pyDir), '两个 policies 目录都存在（否则本锁失去意义）')
  const r = checkPolicyPairConsistencyPre(NAMES, [jsDir, pyDir])
  ok(r.skipped === 0, `两份都在册（skipped=${r.skipped}；一侧缺失属合法降级部署，但当前仓库应齐全）`)
  ok(r.ok === true, '★ 逐文件摘要一致；漂移=' + JSON.stringify(r.drift))
  // 独立复核（不用被测函数自己），避免"函数与测试同时错"
  for (const n of NAMES) {
    const a = createHash('sha256').update(readFileSync(path.join(jsDir, n))).digest('hex')
    const b = createHash('sha256').update(readFileSync(path.join(pyDir, n))).digest('hex')
    ok(a === b, n + ' 独立 sha256 复核一致')
  }
}

console.log('[P2] 纯函数语义：漂移要报、单侧缺失不算漂移')
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'dam-policy-pair-'))
  try {
    const A = path.join(tmp, 'a'); const B = path.join(tmp, 'b')
    mkdirSync(A); mkdirSync(B)
    writeFileSync(path.join(A, NAMES[0]), '{"v":1}', 'utf8'); writeFileSync(path.join(B, NAMES[0]), '{"v":1}', 'utf8')
    writeFileSync(path.join(A, NAMES[1]), '{"v":7}', 'utf8'); writeFileSync(path.join(B, NAMES[1]), '{"v":9}', 'utf8')
    const drift = checkPolicyPairConsistencyPre(NAMES, [A, B])
    ok(drift.ok === false, '内容不同 ⇒ ok:false')
    ok(drift.drift.length === 1 && drift.drift[0].name === NAMES[1], '只点名漂移的那一份：' + JSON.stringify(drift.drift.map((d) => d.name)))
    ok(/^[0-9a-f]{12}$/.test(drift.drift[0].digestA) && /^[0-9a-f]{12}$/.test(drift.drift[0].digestB),
      '摘要前缀可用于人眼比对（12 hex 双列）')
    // 单侧缺失：纯 JS 安装没有 python/，旧部署可能只有 python/policies ⇒ 不算漂移
    rmSync(path.join(B, NAMES[0]))
    const half = checkPolicyPairConsistencyPre(NAMES, [A, B])
    ok(half.skipped === 1 && half.drift.length === 1 && half.drift[0].name === NAMES[1],
      '一侧缺文件 ⇒ 只记 skipped 不报漂移（合法降级部署不误伤），另一份的真实漂移仍照常点名')
    rmSync(path.join(A, NAMES[1])); rmSync(path.join(B, NAMES[1]))
    const none = checkPolicyPairConsistencyPre(NAMES, [A, B])
    ok(none.ok === true && none.skipped === 2, '两侧都缺 ⇒ 全 skipped 且 ok（无对照不等于有漂移）')
    const empty = checkPolicyPairConsistencyPre([], [A, B])
    ok(empty.ok === true, '名单为空 ⇒ ok（不抛）')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

console.log('[P3] 接线守卫：真的在加载前对照，漂移可见且不改变优先级')
{
  const raw = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // 去注释：防"注释里提到旧写法"造成假绿
  ok(/import \{[^}]*checkPolicyPairConsistencyPre[^}]*\} from '\.\/semantic-decide\.js'/.test(code),
    'index.js 以裸名 import 该对照函数')
  const i = code.indexOf('ensureJsDecide = () =>')
  ok(i > 0, '已定位到 ensureJsDecide（守卫范围）')
  const body = code.slice(i, i + 2600)
  ok(/checkPolicyPairConsistencyPre\(/.test(body), '★ 策略加载路径上真的调用了对照（不是只写在别处）')
  ok(body.indexOf('checkPolicyPairConsistencyPre(') < body.indexOf('loadAndVerifyPolicy(intentPath'),
    '对照发生在加载之前（漂移先于使用被记录）')
  ok(/_policyPairDrift = pair\.ok \? null : pair\.drift/.test(body), '一致时清空、漂移时留名单')
  ok(/\[降级\][\s\S]{0,120}policy 双份不一致/.test(body), '★ 漂移打 [降级]（I7：绝不静默丢弃）')
  ok(/policyPairDrift: this\._policyPairDrift \|\| null/.test(code), 'debugView 暴露 policyPairDrift（面板与 /debug 可读）')
  ok(!/if \(pair\.ok === false\) (throw|return null)/.test(body), '不擅自改成硬失败（不加载/抛错属参数治理决策，留给维护者）')
}

console.log('[P4] 纯核心边界：对照函数不引入宿主依赖')
{
  const src = readFileSync(path.join(ROOT, 'lib', 'semantic-decide.js'), 'utf8')
  const imps = [...src.matchAll(/^import [^;]*from '([^']+)'/gm)].map((m) => m[1])
  const external = imps.filter((s) => !s.startsWith('./'))
  ok(external.every((s) => s.startsWith('node:')), '非相对依赖全是 node: 内置：' + external.join(', '))
  ok(!/from '\.\/(index|client)\.js'/.test(src), '不 import 宿主 index.js / 浏览器 client.js')
}

console.log('\n--- issue #109 策略双份一致性 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
