/** INJ-2 验收：`fullEverySlims` 出厂默认 3 → 10 的**一次性配置迁移**（2026-10-06）。
 *
 * 用户原话：「给他默认都调到 10，这样更新以后，用户都能被覆盖，就做到修复的目的了」。
 *
 * ★ 本套件的核心不是「常量改成 10」，而是**老用户能否真的拿到它**：
 *   `saveConfig` 落盘的是**整个合并后的 config**（实测本机用户盘 154 键全在），所以老用户
 *   只要在设置页存过任何一项，`fullEverySlims: 3` 就已经被钉死在磁盘上 —— 配置值覆盖默认值，
 *   只改 `DEFAULT_CONFIG` 对老用户**完全无效**。必须配一次性迁移 `upgradeFullEverySlimsDefaultPre()`。
 *
 * ★★ 与容量迁移同型（2026-09-18 那批）的**结构性陷阱**，本套件专门设了回归锁（I4a/I4b/I4c）：
 *   `_mergeConfigPre` 是 `{...DEFAULT_CONFIG, ...parsed}`，而 `DEFAULT_CONFIG` 里**也有**版本号键
 *   ⇒ 合并结果永远带当前版本 ⇒ 守卫若读合并结果则 `ver >= VER` **恒真** ⇒ 迁移永不执行。
 *   修法：守卫读**磁盘原文**，调用方必须把 `JSON.parse(raw)` 原样传进来。
 *
 * 手法：真 import **完整生产引擎**（沿用本仓既有权威脚手架 tests/lib/audit-engine.mjs：读真实
 *   lib/index.js、相对导入改绝对、仅追加一行测试导出后再 import），真构造/真调用 loadConfigSync，
 *   断言**内存值 + 磁盘字节**。不重实现任何生产逻辑。
 *
 * 语料全在临时 HOME 里（每次 mkdtemp），**真实用户配置零接触**。
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }
const eq = (a, b, m) => assert(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']')

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const { MemoryEngine } = await import(pathToFileURL(path.join(repo, 'tests', 'lib', 'audit-engine.mjs')).href)
assert(typeof MemoryEngine === 'function', '★ 真 import 生产引擎失败（MemoryEngine）')

const SRC = readFileSync(path.join(repo, 'lib', 'index.js'), 'utf8')

/** 造临时 DSH_HOME + 磁盘原文 + 引擎实例（引擎的配置路径钉到本用例的临时文件） */
function fresh(initialConfig) {
  const dir = mkdtempSync(path.join(tmpdir(), 'inj2-e2e-'))
  process.env.DSH_HOME = dir
  const file = path.join(dir, 'dsh-auto-memory.json')
  if (initialConfig !== null) writeFileSync(file, JSON.stringify(initialConfig, null, 2), 'utf8')
  const eng = new MemoryEngine({})
  eng._configPath = file
  return { eng, file, read: () => JSON.parse(readFileSync(file, 'utf8')), clean: () => rmSync(dir, { recursive: true, force: true }) }
}

console.log('=== INJ-2 · fullEverySlims 出厂默认迁移（真 import / 真构造 / 真调用 / 磁盘副作用）===')

/* ── 0. 出厂默认与常量接线（守卫，非功能证据）── */
t('I0 守卫：DEFAULT_CONFIG.fullEverySlims 引用常量；旧默认与档位版本各自有常量', () => {
  const C = (n) => { const m = SRC.match(new RegExp('const ' + n + ' = (\\d+)')); assert(m, '未找到常量 ' + n); return Number(m[1]) }
  eq(C('DEFAULT_FULL_EVERY_SLIMS'), 10, '新出厂默认常量')
  eq(C('DEFAULT_FULL_EVERY_SLIMS_PREV'), 3, '旧默认常量（迁移判据）')
  eq(C('FULL_EVERY_SLIM_DEFAULTS_VERSION'), 1, '档位版本常量')
  const seg = SRC.slice(SRC.indexOf('const DEFAULT_CONFIG = {'), SRC.indexOf('const DEFAULT_CONFIG = {') + 20000)
  assert(/fullEverySlims:\s*DEFAULT_FULL_EVERY_SLIMS,/.test(seg), '★ DEFAULT_CONFIG.fullEverySlims 须引用常量（防双源漂移）')
  assert(/fullEverySlimsDefaultsVersion:\s*FULL_EVERY_SLIM_DEFAULTS_VERSION,/.test(seg), '★ DEFAULT_CONFIG 须带档位版本键且引用常量')
})

/* ── 1. 正路径：老配置（磁盘 3、无版本键）⇒ 内存 10 + 磁盘 10 ── */
t('I1 ★正路径：磁盘 fullEverySlims=3(无版本键) ⇒ 真 loadConfigSync 后 内存=10 且**磁盘也=10**+版本号', () => {
  const h = fresh({ fullEverySlims: 3, locale: 'zh' })
  try {
    const cfg = h.eng.loadConfigSync()
    eq(cfg.fullEverySlims, 10, '★ 内存未抬升')
    eq(h.read().fullEverySlims, 10, '★★ 磁盘未回写（设置页读的是磁盘，会显示旧值被当成没生效）')
    eq(h.read().fullEverySlimsDefaultsVersion, 1, '★ 磁盘未写版本号 ⇒ 幂等守卫失效')
  } finally { h.clean() }
})

t('I1b ★返回值语义：迁移函数对 {fullEverySlims:3} 返回 ["fullEverySlims"]', () => {
  const h = fresh(null)
  try {
    h.eng.config.fullEverySlims = 3
    const changed = h.eng.upgradeFullEverySlimsDefaultPre({ fullEverySlims: 3 })
    assert(Array.isArray(changed) && changed.length === 1 && changed[0] === 'fullEverySlims',
      '应返回 [fullEverySlims]，实为 ' + JSON.stringify(changed))
    eq(h.eng.config.fullEverySlims, 10, '内存值未抬升')
  } finally { h.clean() }
})

/* ── 2. 负路径 A：尊重用户偏好 ── */
t('I2 ★负路径A：用户自设 5/20/1/3.5 ⇒ 内存与磁盘**都不动**（不得覆盖用户偏好）', () => {
  for (const v of [5, 20, 1, 3.5]) {
    const h = fresh({ fullEverySlims: v })
    try {
      const cfg = h.eng.loadConfigSync()
      eq(cfg.fullEverySlims, v, '★ 自设值 ' + v + ' 被篡改（内存）')
      eq(h.read().fullEverySlims, v, '★★ 自设值 ' + v + ' 被篡改（磁盘）')
    } finally { h.clean() }
  }
  const h = fresh(null)
  try {
    h.eng.config.fullEverySlims = 5
    eq(h.eng.upgradeFullEverySlimsDefaultPre({ fullEverySlims: 5 }).length, 0, '★ 自设值时不得报告改动')
  } finally { h.clean() }
})

/* ── 3. 负路径 B：只升一次 ── */
t('I3 ★负路径B：{fullEverySlims:3, fullEverySlimsDefaultsVersion:1} ⇒ 版本守卫拦下，保持不变', () => {
  const h = fresh({ fullEverySlims: 3, fullEverySlimsDefaultsVersion: 1 })
  try {
    const cfg = h.eng.loadConfigSync()
    eq(cfg.fullEverySlims, 3, '★ 版本守卫未生效，值被抬升')
    eq(h.read().fullEverySlims, 3, '磁盘被改')
    eq(h.eng.upgradeFullEverySlimsDefaultPre({ fullEverySlims: 3, fullEverySlimsDefaultsVersion: 1 }).length, 0, '应返回空数组')
  } finally { h.clean() }
})

t('I3b ★幂等：第二次 loadConfigSync 不再改动磁盘任何字节', () => {
  const h = fresh({ fullEverySlims: 3 })
  try {
    h.eng.loadConfigSync()
    const first = readFileSync(h.file, 'utf8')
    h.eng.loadConfigSync()
    eq(first === readFileSync(h.file, 'utf8'), true, '★ 第二次加载又改了磁盘（不幂等）')
    eq(h.read().fullEverySlims, 10, '值应为 10')
  } finally { h.clean() }
})

/* ── 4. 负路径 C：陷阱回归（守卫必须读磁盘原文，不得读合并结果）── */
t('I4a ★★陷阱回归(决定性)：内存已是当前版本 1、磁盘原文无版本键 ⇒ **仍必须迁移**', () => {
  const h = fresh(null)
  try {
    eq(h.eng.config.fullEverySlimsDefaultsVersion, 1, '前提：构造期合并结果已带当前版本号（正是陷阱成因）')
    h.eng.config.fullEverySlims = 3
    assert(h.eng.upgradeFullEverySlimsDefaultPre({ fullEverySlims: 3 }).length === 1,
      '★ 守卫读成了 this.config（恒等于当前版本）⇒ 迁移结构性永不执行')
    eq(h.eng.config.fullEverySlims, 10, '未抬升')
  } finally { h.clean() }
})

t('I4b ★★陷阱回归(反向)：磁盘原文带版本号=1、内存被置 0 ⇒ **必须不动**', () => {
  const h = fresh(null)
  try {
    h.eng.config.fullEverySlimsDefaultsVersion = 0
    h.eng.config.fullEverySlims = 3
    eq(h.eng.upgradeFullEverySlimsDefaultPre({ fullEverySlims: 3, fullEverySlimsDefaultsVersion: 1 }).length, 0,
      '★ 守卫读了 this.config(0<1) ⇒ 误迁移，说明判据来自内存而非磁盘原文')
    eq(h.eng.config.fullEverySlims, 3, '不应改动')
  } finally { h.clean() }
})

t('I4c ★★陷阱回归(端到端)：磁盘原文 版本号=1 + 值 3 ⇒ 真 loadConfigSync 后仍为 3', () => {
  const h = fresh({ fullEverySlims: 3, fullEverySlimsDefaultsVersion: 1 })
  try { eq(h.eng.loadConfigSync().fullEverySlims, 3, '★ 端到端被误迁移（守卫读到了合并结果）') } finally { h.clean() }
})

/* ── 5. fail-soft ── */
t('I5 ★fail-soft：null / 非对象 / this.config 为 null 均不抛且返回数组', () => {
  const h = fresh(null)
  try {
    for (const raw of [null, undefined, 0, '', [], { fullEverySlims: 3 }]) {
      assert(Array.isArray(h.eng.upgradeFullEverySlimsDefaultPre(raw)), 'raw=' + JSON.stringify(raw) + ' 返回值非数组')
    }
    const r2 = MemoryEngine.prototype.upgradeFullEverySlimsDefaultPre.call({ config: null }, {})
    assert(Array.isArray(r2) && r2.length === 0, 'this.config 为 null 时必须 fail-soft 返回 []')
  } finally { h.clean() }
})

/* ── 6. 新装用户 ── */
t('I6 ★新装用户（配置文件不存在）拿到 10，构造期默认亦为 10 + 版本号', () => {
  const h = fresh(null)
  try {
    const cfg = h.eng.loadConfigSync()
    eq(cfg.fullEverySlims, 10, '新装默认应为 10')
    eq(cfg.fullEverySlimsDefaultsVersion, 1, '新装应带当前档位版本')
  } finally { h.clean() }
  const eng0 = new MemoryEngine({})
  eq(eng0.config.fullEverySlims, 10, '构造期默认应为 10')
  eq(eng0.config.fullEverySlimsDefaultsVersion, 1, '构造期版本号应为 1')
})

/* ── 7. 与容量迁移共存（同一条 load 链路，互不吞）── */
t('I7 ★组合：同一份老配置同时缺两个版本键 ⇒ 两条迁移都在一次 load 内完成并落盘', () => {
  const h = fresh({ fullEverySlims: 3, noteCapacityChars: 12000, userCapacityChars: 12000 })
  try {
    const cfg = h.eng.loadConfigSync()
    eq(cfg.fullEverySlims, 10, '门槛未抬升')
    eq(cfg.noteCapacityChars, 24000, '容量未抬升（新接线吞掉了旧的？）')
    eq(cfg.userCapacityChars, 24000, '容量未抬升')
    const d = h.read()
    eq(d.fullEverySlims, 10, '磁盘门槛未落')
    eq(d.fullEverySlimsDefaultsVersion, 1, '磁盘门槛版本号未落')
    eq(d.noteCapacityChars, 24000, '磁盘容量未落')
    eq(d.capacityDefaultsVersion, 24, '磁盘容量版本号未落')
  } finally { h.clean() }
})

/* ── 8. 接线守卫（两条加载路径口径一致；守卫语义 = 调用点计数）── */
t('I8 守卫：同步与异步两条加载路径**都**调用新迁移且都传磁盘原文 parsed', () => {
  eq(SRC.split('this.upgradeFullEverySlimsDefaultPre(parsed)').length - 1, 2, '★ 调用点须恰为 2（同步 + 异步）')
  eq(SRC.split('this.upgradeCapacityDefaultsPre(parsed)').length - 1, 2, '容量迁移调用点不得被吞（应仍为 2）')
  eq(SRC.split('upgradeFullEverySlimsDefaultPre(rawCfg) {').length - 1, 1, '迁移函数定义应恰 1 处')
})

console.log('[inj2-full-every-slims-migrate] ' + pass + ' passed, ' + fail + ' failed (共 ' + (pass + fail) + ')')
if (fail > 0) process.exit(1)
