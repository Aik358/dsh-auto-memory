// T9 守卫（#84 诊断留痕 + #86-3 DSH_HOME 统一口径）
//
// #84 事故：两处「静默丢弃/静默记录」——volatileEvents 超限直接 shift（诊断面看不到事件，
//          且无法区分「压根没产生」与「被挤掉」）；unhandledRejection 只打一行日志（无计数）。
// #86-3 事故：全仓 7 处独立解析 DSH_HOME，4 种不同回落 ⇒ 不同子系统可能写不同根目录。
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const rd = (p) => readFileSync(path.join(ROOT, p), 'utf8')
const IDX = rd('lib/index.js')
const ACT = rd('lib/activation-host-pre.js')
const HOME_SRC = rd('lib/dsh-home-pre.js')
const M = await import(pathToFileURL(path.join(ROOT, 'lib', 'dsh-home-pre.js')).href)

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log('  ok - ' + n) } catch (e) { fail++; console.log('  FAIL - ' + n + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

console.log('=== T9-a #84 诊断留痕 ===')

t('T9a-1 ★★ volatileEvents 丢弃必须计数（否则「看不到事件」无法区分没产生/被挤掉）', () => {
  assert(/volatileDropped/.test(ACT), '★ 无 volatileDropped 计数')
  const m = ACT.match(/if \(volatileEvents\.length > [^)]+\) \{[\s\S]{0,200}?volatileDropped\+\+/)
  assert(m, '★ shift 截断处未计数（仍静默丢弃）')
})

t('T9a-2 ★ 上限 16 必须是具名常量（不得魔数散落）', () => {
  assert(/VOLATILE_MAX_PRE_V1 = 16/.test(ACT), '缺少 VOLATILE_MAX_PRE_V1 = 16')
  assert(!/volatileEvents\.length > 16\b/.test(ACT), '★ 仍在用魔数 16')
})

t('T9a-3 ★★ unhandledRejection 必须计数（原实现只打一行日志）', () => {
  assert(/_dshAutoMemoryRejectionStat/.test(IDX), '★ 无 rejection 计数对象')
  const m = IDX.match(/rejStat\.count\+\+[\s\S]{0,80}/)
  assert(m, '★ 未自增计数')
  assert(/firstAt/.test(IDX) && /lastAt/.test(IDX), '★ 未记录首次/最近时间（无法判断是否频繁）')
})

t('T9a-4 ★ 计数必须暴露在诊断面（只计数不可见等于没留痕）', () => {
  assert(/unhandledRejection guard #' \+ rejStat\.count/.test(IDX), '日志未带序号')
  assert(/process\._dshAutoMemoryRejectionStat = rejStat/.test(IDX), '未挂到 process 供诊断读取')
})

console.log('\n=== T9-b #86-3 DSH_HOME 统一口径 ===')

t('T9b-1 ★★ 全仓不得再有独立的 process.env.DSH_HOME 解析（除统一模块本身）', () => {
  const files = ['lib/index.js', 'lib/semantic-js-pre.js', 'lib/activation-host-pre.js', 'lib/context-host-pre.js', 'lib/shadow-host-pre.js']
  const offenders = []
  for (const f of files) {
    const s = rd(f)
    // 允许：注释里提到；不允许：真的读环境变量
    s.split('\n').forEach((l, i) => {
      if (/process\.env\.DSH_HOME/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) offenders.push(f + ':' + (i + 1) + ' ' + l.trim())
    })
  }
  assert(offenders.length === 0, '★ 仍有独立解析：\n      ' + offenders.join('\n      '))
})

t('T9b-2 ★★ 五个站点都已改调统一入口', () => {
  assert(/resolveDshHomePre\(\)/.test(rd('lib/index.js')), 'index.js 未接线')
  assert(/resolveDshHomePre\(\)/.test(rd('lib/semantic-js-pre.js')), 'semantic-js 未接线')
  assert(/resolveDshHomeForEnginePre\(engine\)/.test(rd('lib/activation-host-pre.js')), 'activation-host 未接线')
  assert(/resolveDshHomeForEnginePre\(engine\)/.test(rd('lib/context-host-pre.js')), 'context-host 未接线')
  assert(/resolveDshHomeForEnginePre\(engine\)/.test(rd('lib/shadow-host-pre.js')), 'shadow-host 未接线')
})

t('T9b-3 ★★★ 优先级必须与原实现一致：**env 优先于 __homedirFn**', () => {
  // ⚠️ 这条是踩坑后补的：首版把 __homedirFn 提到 env 之前 ⇒ 用 process.env.DSH_HOME
  //    注入的测试被真实 homedir 覆盖，数据写到**真实用户目录**（症状是 evidence=0，离真因很远）。
  const oldEnv = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'ENV_WINS_PRE'
    const got = M.resolveDshHomeForEnginePre({ __homedirFn: () => 'H:/homedir' })
    assert(got === 'ENV_WINS_PRE', '★ env 未优先（得到 ' + got + '）')
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldEnv
  }
})

t('T9b-4 ★ resolveDshHomePre 永不抛、永不返回空串', () => {
  const oldEnv = process.env.DSH_HOME
  try {
    delete process.env.DSH_HOME
    const v = M.resolveDshHomePre()
    assert(typeof v === 'string' && v.length > 0, '返回了空串/非字符串')
    assert(M.resolveDshHomePre('') .length > 0, '空 override 时返回空')
    assert(M.resolveDshHomePre(null).length > 0, 'null override 时返回空')
    assert(M.resolveDshHomePre(undefined).length > 0, 'undefined override 时返回空')
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldEnv
  }
})

t('T9b-5 ★ override 优先级最高（给测试注入留口）', () => {
  const oldEnv = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'ENV_VALUE'
    assert(M.resolveDshHomePre('OVERRIDE') === 'OVERRIDE', 'override 未优先于 env')
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldEnv
  }
})

t('T9b-6 ★ __homedirFn 语义保持「基准目录」⇒ 仍拼 .dsh', () => {
  const oldEnv = process.env.DSH_HOME
  try {
    delete process.env.DSH_HOME
    const got = M.resolveDshHomeForEnginePre({ __homedirFn: () => path.join('X:', 'home') })
    assert(got.endsWith('.dsh'), '★ 未拼 .dsh（M4-4 那个 bug 的形态：audit 写到错误位置）')
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldEnv
  }
})

t('T9b-7 ★ 模块零运行时依赖（只 node:）', () => {
  const imports = [...HOME_SRC.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  const ext = imports.filter((s) => !s.startsWith('node:'))
  assert(ext.length === 0, '★ 有外部依赖：' + ext.join(', '))
})

t('T9b-8 ★ 不缓存（测试会中途改 process.env，缓存会导致串染）', () => {
  const oldEnv = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'FIRST'
    const a = M.resolveDshHomePre()
    process.env.DSH_HOME = 'SECOND'
    const b = M.resolveDshHomePre()
    assert(a === 'FIRST' && b === 'SECOND', '★ 发生了缓存（' + a + ' / ' + b + '）')
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldEnv
  }
})

console.log('\n[t9] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
