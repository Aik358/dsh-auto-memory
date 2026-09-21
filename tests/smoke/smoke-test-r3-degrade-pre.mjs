/**
 * R3 · 降级留痕层（degrade-pre.js）
 *
 * 背景：
 *   全仓 70 处 catch 只 diag 不抛，其中 10 处自述为降级；检索链四条臂各自静默失效。
 *   fail-soft 是对的，**缺陷在降级不可见**。本层让「哪条臂没在工作」可查询。
 *
 * 本套件锁定四件事：
 *   ① 记录与聚合正确（counts / recent / 快照结构）
 *   ② **元规则**：留痕失败绝不影响主流程（变异演示：故意让内部抛错）
 *   ③ 有界（cap 生效，且淘汰数可见 —— 不静默丢数据）
 *   ④ 判据：臂健康快照的正确性（非法状态 fail-closed 归 'unknown'，不得当正常）
 */
import {
  createDegradeSinkPre, deriveArmsHealthPre, persistDegradeLedgerPre,
  DEGRADE_SCHEMA_PRE_V1, DEGRADE_CAP_PRE_V1, DEGRADE_REASON_MAX_PRE_V1,
  ARM_STATES_PRE_V1, DEGRADE_KINDS_PRE_V1,
} from '../../lib/degrade-pre.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n) } }
const eq = (a, b, n) => ok(a === b, n + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

console.log('=== R3 · 降级留痕层 ===\n')

// ── 1. 基本记录与聚合 ─────────────────────────────────────────────
console.log('[1] 记录与聚合')
{
  let t = 1758000000000
  const sink = createDegradeSinkPre({ now: () => t })
  ok(sink.isEmpty(), '初始为空')
  eq(sink.countOf('semantic-arm'), 0, '未记录的 kind 计数为 0')

  sink.record('semantic-arm', 'worker 拒绝 → 回退词法')
  t += 1000
  sink.record('semantic-arm', 'js 引擎异常')
  t += 1000
  sink.record('l0-sync', '索引同步失败')

  eq(sink.countOf('semantic-arm'), 2, 'semantic-arm 累计 2')
  eq(sink.countOf('l0-sync'), 1, 'l0-sync 累计 1')
  ok(!sink.isEmpty(), '非空')

  const snap = sink.snapshot()
  eq(snap.schemaVersion, DEGRADE_SCHEMA_PRE_V1, '快照带 schemaVersion')
  eq(snap.counts['semantic-arm'], 2, '快照 counts 正确')
  eq(snap.recent.length, 3, '快照 recent 含 3 条')
  ok(/^\d{4}-\d{2}-\d{2}T/.test(snap.updatedAt), 'updatedAt 是 ISO 字符串')
  ok(/^\d{4}-\d{2}-\d{2}T/.test(snap.recent[0].at), 'recent[].at 是 ISO 字符串（可读）')
  eq(snap.recent[0].kind, 'semantic-arm', 'recent 保持插入顺序（首条）')
}

// ── 2. ★ 元规则：留痕失败绝不二次失败 ────────────────────────────
console.log('\n[2] ★ 元规则：留痕自身 fail-soft（不得影响主流程）')
{
  // 变异 1：now 抛出 → record 必须不抛
  const bad = createDegradeSinkPre({ now: () => { throw new Error('clock exploded') } })
  let threw = false
  try { bad.record('k', 'r') } catch (_) { threw = true }
  ok(!threw, 'now() 抛错时 record 不抛（元规则）')
  // snapshot 也必须不抛（且返回结构性合法对象）
  let snapThrew = false, snapVal = null
  try { snapVal = bad.snapshot() } catch (_) { snapThrew = true }
  ok(!snapThrew, 'now() 抛错时 snapshot 不抛')
  ok(snapVal && snapVal.schemaVersion === DEGRADE_SCHEMA_PRE_V1, '快照仍返回结构性合法对象（非 undefined）')
  ok(Array.isArray(snapVal.recent), '快照 recent 仍是数组（读取方不会 TypeError）')

  // 变异 2：传入怪异 kind / reason → 不得抛
  const s2 = createDegradeSinkPre()
  let t2 = false
  try {
    s2.record(undefined, undefined)
    s2.record(null, null)
    s2.record({ weird: true }, { also: 'weird' })
    s2.record('k', 'x'.repeat(5000))
  } catch (_) { t2 = true }
  ok(!t2, '异常 kind/reason 不抛（fail-soft）')
  // undefined 与 null 都归一到 'unknown'（两者不区分 —— 归一化是刻意的：
  // 缺失 kind 一律视为"来源未标注"，比让它们各自成为独立键更利于聚合）
  eq(s2.countOf('unknown'), 2, 'undefined/null kind 均归一为 unknown（共 2 条）')
  eq(s2.countOf('undefined'), 0, '不产生字面量 "undefined" 键（防悄悄分裂计数）')
  // 显式对象 kind 会被 String() 化为 "[object Object]" —— 记录该行为，防回归成抛错
  eq(s2.countOf('[object Object]'), 1, '对象 kind 被 String() 化（不抛，且可聚合）')
  const longReason = s2.snapshot().recent.find((r) => r.kind === 'k')
  eq(longReason.reason.length, DEGRADE_REASON_MAX_PRE_V1, '超长 reason 被截断（防撑爆状态文件）')

  // 变异 3：countOf 对怪异输入不抛
  let t3 = false
  try { s2.countOf(undefined); s2.countOf(Symbol ? 'x' : 'x') } catch (_) { t3 = true }
  ok(!t3, 'countOf 对怪异输入不抛')
}

// ── 3. 有界性（cap 生效，且淘汰可见）──────────────────────────────
console.log('\n[3] 有界性')
{
  const small = createDegradeSinkPre({ cap: 5 })
  for (let i = 0; i < 12; i++) small.record('k' + (i % 2), 'r' + i)
  const snap = small.snapshot()
  eq(snap.recent.length, 5, 'recent 长度被 cap 限制为 5')
  eq(snap.cap, 5, '快照带 cap')
  eq(snap.evicted, 7, '★ 淘汰 7 条且**可见**（不静默丢数据）')
  eq(snap.counts['k0'], 6, 'counts 不受环形淘汰影响（累计仍是 6）')
  eq(snap.counts['k1'], 6, 'counts 累计 6')

  // 默认 cap
  eq(createDegradeSinkPre()._capForTest, DEGRADE_CAP_PRE_V1, '默认 cap = ' + DEGRADE_CAP_PRE_V1)
  // 非法 cap 回退默认
  eq(createDegradeSinkPre({ cap: -1 })._capForTest, DEGRADE_CAP_PRE_V1, '非法 cap(-1) 回退默认')
  eq(createDegradeSinkPre({ cap: 0 })._capForTest, DEGRADE_CAP_PRE_V1, '非法 cap(0) 回退默认')
}

// ── 4. reset 与不可变性 ──────────────────────────────────────────
console.log('\n[4] reset 与快照不可变性')
{
  const s = createDegradeSinkPre()
  s.record('a', 'x'); s.record('b', 'y')
  s.reset()
  ok(s.isEmpty(), 'reset 后为空')
  eq(s.snapshot().recent.length, 0, 'reset 后 recent 空')
  eq(s.snapshot().evicted, 0, 'reset 后 evicted 归零')

  // 快照是副本：外部改它不得影响内部
  const s2 = createDegradeSinkPre()
  s2.record('k', 'v')
  const snap = s2.snapshot()
  snap.recent.push({ kind: '注入', reason: 'evil', at: 'x' })
  snap.counts['k'] = 999
  eq(s2.countOf('k'), 1, '★ 改快照不影响内部计数（返回副本）')
  eq(s2.snapshot().recent.length, 1, '★ 改快照不影响内部 recent')
}

// ── 5. 臂健康快照（E-3 落地）─────────────────────────────────────
console.log('\n[5] 臂健康快照（E-3：让"哪条臂没在工作"可见）')
{
  const h = deriveArmsHealthPre({
    semantic: 'active',
    evidence: 'no-input',   // ← R2 的实例：无证据事件是**合法状态**
    temporal: 'on-demand' === 'x' ? 'x' : 'active',
    l0Sync: 'ok',
  })
  eq(h.semantic, 'active', '合法状态保留')
  eq(h.evidence, 'no-input', '★ no-input 被保留（合法状态，非降级）')

  // ★ fail-closed：非法状态必须归 'unknown'，绝不能当正常
  const bad = deriveArmsHealthPre({ a: 'banana', b: '', c: null, d: undefined, e: 'ACTIVE' })
  eq(bad.a, 'unknown', '★ 非法状态 → unknown（不得当正常）')
  eq(bad.b, 'unknown', '空字符串 → unknown')
  eq(bad.c, 'unknown', 'null → unknown')
  eq(bad.d, 'unknown', 'undefined → unknown')
  eq(bad.e, 'unknown', '大小写不符 → unknown（枚举精确匹配）')

  // fail-soft
  let t = false
  try { deriveArmsHealthPre(null); deriveArmsHealthPre(undefined) } catch (_) { t = true }
  ok(!t, 'null/undefined 入参不抛')
  eq(Object.keys(deriveArmsHealthPre(null)).length, 0, 'null 入参 → 空对象')
}

// ── 6. 常量完整性（枚举类必须配断言 —— 本仓铁律）─────────────────
console.log('\n[6] 常量完整性')
{
  eq(DEGRADE_SCHEMA_PRE_V1, 'degrade_pre_v1', 'schema 常量正确')
  eq(DEGRADE_CAP_PRE_V1, 200, 'cap 常量 = 200')
  eq(DEGRADE_REASON_MAX_PRE_V1, 200, 'reason 上限 = 200')
  ok(ARM_STATES_PRE_V1.includes('no-input'), '★ 臂状态含 no-input（合法状态，区别于 degraded）')
  ok(ARM_STATES_PRE_V1.includes('degraded'), '臂状态含 degraded')
  ok(ARM_STATES_PRE_V1.includes('unknown'), '★ 臂状态含 unknown（fail-closed 出口）')
  ok(Object.isFrozen(ARM_STATES_PRE_V1), 'ARM_STATES 被冻结（防运行时篡改）')
  ok(Object.isFrozen(DEGRADE_KINDS_PRE_V1), 'DEGRADE_KINDS 被冻结')
  eq(DEGRADE_KINDS_PRE_V1.length, 3, '已知 kind 3 个（仅文档用途，不限制新 kind）')

  // 不限制新 kind：record 可接受未知 kind（向前兼容）
  const s = createDegradeSinkPre()
  s.record('brand-new-arm', 'future')
  eq(s.countOf('brand-new-arm'), 1, '未知 kind 可记录（不限制，向前兼容）')
}

// ── 7. R3-②：状态文件落盘（读驱动写） ─────────────────────────────
console.log('\n[7] R3-② 落盘：持久化台账到可查询状态文件')
{
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-r3b-'))
  const file = path.join(tmpRoot, 'degrade-pre', 'latest.json')

  const sink = createDegradeSinkPre()
  sink.record('semantic-arm', 'worker 拒绝')
  sink.record('l0-sync', '同步失败')
  const okWrite = persistDegradeLedgerPre({
    file, snapshot: sink.snapshot(), mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync,
  })
  ok(okWrite, '落盘返回 true')
  ok(fs.existsSync(file), '★ 文件真实存在（含父目录自动创建）')
  {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'))
    eq(o.schemaVersion, DEGRADE_SCHEMA_PRE_V1, '落盘内容含 schemaVersion')
    eq(o.counts['semantic-arm'], 1, '落盘内容含 counts')
    ok(Array.isArray(o.recent) && o.recent.length === 2, '落盘内容含 recent（2 条）')
    ok(!JSON.stringify(o).includes('绝密'), '落盘内容不含原文类字段（隐私：只存 kind/reason/时间）')
  }

  // ★ 元规则：落盘失败必须返回 false 且**不抛**（不得打断 debugInfo）
  let threw = false, r = null
  try {
    r = persistDegradeLedgerPre({
      file: path.join(tmpRoot, 'x', 'y.json'),
      snapshot: {}, mkdirSync: () => {}, writeFileSync: () => { throw new Error('disk full') },
    })
  } catch (_) { threw = true }
  ok(!threw, '★ 写盘抛错时不向外抛（元规则）')
  eq(r, false, '写盘失败返回 false')

  // 参数缺失 / 注入缺失 ⇒ 一律 false，不抛
  let t2 = false
  try {
    eq(persistDegradeLedgerPre(null), false, 'null 入参 → false')
    eq(persistDegradeLedgerPre({}), false, '缺 file → false')
    eq(persistDegradeLedgerPre({ file: 'x.json', snapshot: {} }), false, '缺注入 fs → false（不误用全局 fs）')
  } catch (_) { t2 = true }
  ok(!t2, '异常入参一律不抛')

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}

// ── 8. 源码级接线断言（R3-② 接进 index.js）────────────────────────
console.log('\n[8] 接线断言：index.js 已把台账接进 debugInfo（同一出口）')
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

  ok(SRC.includes('createDegradeSinkPre({})'), 'sink 已挂到引擎实例')
  ok(SRC.includes('degrade: this._degradeViewSnapshot()'), '★ debugInfo 暴露 degrade（与各 host debugView 同出口）')
  ok(SRC.includes('_degradeViewSnapshot() {'), '视图方法已定义')
  ok(SRC.includes("'memory', 'degrade-pre', 'latest.json'"),
    '★ 落盘路径 = <dshHome>/memory/degrade-pre/latest.json')
  ok(SRC.includes('persistDegradeLedgerPre'),
    '视图方法调用持久化函数')

  // 顺序：视图方法定义必须在 debugInfo 之前（否则 this.xxx 在调用时不存在）
  const iView = SRC.indexOf('_degradeViewSnapshot() {')
  const iDebug = SRC.indexOf('async debugInfo() {')
  ok(iView > 0 && iDebug > 0 && iView < iDebug, '视图方法定义先于 debugInfo')

  // 元规则：落盘被 try 包裹
  {
    const i = SRC.indexOf('persistDegradeLedgerPre({')
    const seg = SRC.slice(Math.max(0, i - 300), i + 200)
    ok(/try\s*\{[\s\S]*persistDegradeLedgerPre[\s\S]*\}\s*catch/.test(seg),
      '★ 落盘处于 try/catch（失败不得打断诊断）')
  }

  // 观察点：temporal 段刻意不记（预期内分支）——锁定这个决定，防回归
  {
    const i = SRC.indexOf('temporal-parse 降级')
    const seg = SRC.slice(Math.max(0, i - 300), i + 300)
    ok(!seg.includes('degradeSink'),
      '★ temporal 段未接留痕（无时间表达=预期内分支，刻意不记）')
  }

  // ★★ 防回归：禁止裸 join()（本文件是 `import path from 'node:path'` 默认导入，无裸 join）
  //   实机事故（2026-09-18）：曾写裸 join ⇒ ReferenceError ⇒ 被 fail-soft catch 静默吞掉
  //   ⇒ 落盘长期失效而诊断面板毫无提示。同族事故第三次（dshHome / evDir / join）。
  //   注意：必须同时排除 `//` 行注释与 `*`/`/*` 块注释，否则 JSDoc 示例会造成假阳性。
  {
    const lines = SRC.split(/\r?\n/)
    const bare = []
    let inBlock = false
    lines.forEach((l, i) => {
      let code = l
      if (inBlock) {
        const close = code.indexOf('*/')
        if (close < 0) return                    // 整行都在块注释里
        code = code.slice(close + 2); inBlock = false
      }
      code = code.replace(/\/\*[\s\S]*?\*\//g, '')   // 同行内闭合的块注释
      const open = code.indexOf('/*')
      if (open >= 0) { code = code.slice(0, open); inBlock = true }
      code = code.replace(/\/\/.*$/, '')            // 行注释
      code = code.replace(/^\s*\*.*$/, '')          // 块注释续行（以 * 开头）
      if (/(^|[^\w.$])join\s*\(/.test(code)) bare.push((i + 1) + ': ' + l.trim().slice(0, 80))
    })
    ok(bare.length === 0,
      '★ 全仓无裸 join() 调用（默认导入 path ⇒ 裸 join 必 ReferenceError）' +
      (bare.length ? '  违规: ' + bare.join(' | ') : ''))
  }

  // ★★ 防回归：落盘结果必须**可见**（persisted 字段），杜绝再次静默失败
  ok(SRC.includes("persisted = persistDegradeLedgerPre(") ,
    '★ 落盘返回值赋给 persisted（失败可被观察）')
  ok(SRC.includes('Object.assign({}, snap, { persisted })'),
    '★ 视图返回值携带 persisted（面板/响应一眼可见落盘是否成功）')

  // ★★ 防回归：落盘路径必须用 path.join（已验证非裸 join）
  ok(SRC.includes("path.join(dshHome(), 'memory', 'degrade-pre', 'latest.json')"),
    '★ 落盘路径使用 path.join（非裸 join）')
}

console.log('\n=== R3-degrade: PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exitCode = 1