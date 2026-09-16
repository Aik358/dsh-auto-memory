// 三层契约 C2/I5 冒烟：current 过滤谓词 + 抽取层输出确实带 layer/status
// 断言风格与仓库其它 smoke 一致：node tests/smoke/smoke-test-layer-filter-pre.mjs（退出码 0 = 通过）
// 教训（2026-09-14）：本文件初版用 ~40 字短文本，抽取器因 minChars 返回 0 条，
//   而 `items.every(...)` 在空数组上"真空通过"→ 假绿。故本版：①正文用真实长度条目 ②每条断言先查 length ≥ 1。
import { isCurrentPre, buildL0IndexPre, L0_LAYERS, L0_STATUSES } from '../../lib/l0-extract-pre.js'

let pass = 0
let fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.log('  FAIL - ' + name) } }

// 一项真实长度的记忆条目（≈260 字），确保能过 minChars；锚点 id 必须是 mem_<32 hex>（提取器的硬格式）
const MEM_A = 'mem_' + 'a'.repeat(32)
const BODY = [
  '<!-- memory:' + MEM_A + ' -->',
  '',
  '## 2026-09-14',
  '- 结论：会话检索施工口径采用 C+B —— 先就地修复 51 个文件，再给索引器加「跳过 + 计数」保险。',
  '- 证据：副本实验实测 49/51 可机械救回；硬规则是「禁删行」，seq 必须严格等于行序号。',
  '- 下一步：全库复测通过后由用户重启 dsh web，观察索引建立与 `scope=sessions` 是否返回命中。',
  '',
].join('\n')

// ① 谓词语义
ok('undefined → current（向后兼容）', isCurrentPre(undefined) === true)
ok('null → current', isCurrentPre(null) === true)
ok('空对象 → current（无 status 字段）', isCurrentPre({}) === true)
ok("status='' → current", isCurrentPre({ status: '' }) === true)
ok('status=null → current', isCurrentPre({ status: null }) === true)
ok("status='current' → true", isCurrentPre({ status: 'current' }) === true)
ok("status='superseded' → false", isCurrentPre({ status: 'superseded' }) === false)
ok("status='retracted' → false", isCurrentPre({ status: 'retracted' }) === false)
ok('未知 status 值 → 不放行', isCurrentPre({ status: 'bogus' }) === false)
ok('非对象（字符串）→ 放行（容错）', isCurrentPre('x') === true)

// ② 反向对照（证明断言真的能红）
const rec = { id: 'mem_x', l0: 'abc', status: 'current' }
ok('反向对照：current 通过', isCurrentPre(rec) === true)
ok('反向对照：改成 superseded 被挡下', isCurrentPre({ ...rec, status: 'superseded' }) === false)

// ③ 抽取层输出必须带 layer/status，且全部通过 current 过滤（先证明非空）
const logPath = '~/.dsh/memory/workspaces/--D--x--/2026-09-14.md'
const items = buildL0IndexPre(BODY, { layer: logPath })
ok('抽取层产出 ≥1 条（非空断言，防空数组真空通过）', Array.isArray(items) && items.length >= 1)
ok('每条都带合法 layer', items.length >= 1 && items.every((it) => L0_LAYERS.includes(it.layer)))
ok('每条都带合法 status', items.length >= 1 && items.every((it) => L0_STATUSES.includes(it.status)))
ok('每条都通过 current 过滤', items.length >= 1 && items.every((it) => isCurrentPre(it) === true))
ok('日志来源 → layer=log', items.length >= 1 && items.every((it) => it.layer === 'log'))

// ④ 层判定经由路径生效（project / user / reflection / whiteboard 各一）
const cases = [
  ['~/.dsh/memory/MEMORY.md', 'user'],
  ['~/.dsh/memory/workspaces/--D--x--/MEMORY.md', 'project'],
  ['~/.dsh/memory/workspaces/--D--x--/reflections/2026-09-13.md', 'reflection'],
  ['~/.dsh/memory/workspaces/--D--x--/handoff/PLAN.md', 'whiteboard'],
]
for (const [p, want] of cases) {
  const got = buildL0IndexPre(BODY, { layer: p })
  ok('路径判定 ' + want + '（产出 ≥1 条且层正确）', got.length >= 1 && got.every((it) => it.layer === want))
}

console.log('[layer-filter-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
