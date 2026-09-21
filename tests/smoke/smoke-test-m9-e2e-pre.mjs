// M9 端到端验收: 走**真实源码方法 + 真实文件 IO**, 而不是手搓 config 喂函数。
//
// ★ 为什么必须补这一层(2026-09-18 实测踩坑):
//   先前的 M9-3/4/5 用手搓 config 直接调迁移函数 ⇒ 自洽地绿了, 但真实链路上
//   **迁移从未执行**。根因: `_mergeConfigPre` 是 `{...DEFAULT_CONFIG, ...parsed}`,
//   而 DEFAULT_CONFIG 里也有 `capacityDefaultsVersion` ⇒ 合并结果恒带当前版本号
//   ⇒ 守卫 `ver >= VER` 结构性恒真 ⇒ 函数一进就 return。
//   教训: **凡"读合并后配置"做判断的逻辑, 测试必须走真实合并路径**;
//   手搓对象会掩盖这类"默认值污染判据"的缺陷(与 M8 注册闸门恒假同型)。
//
// 实现手法: 把源码里真实的方法体**写成一个临时模块文件再 import**。
//   (不用 new Function 拼字符串 —— 嵌套花括号/接口对象参数会把拼接搞崩, 已踩。)
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

const SRC = readFileSync(path.resolve('lib', 'index.js'), 'utf8')

/** 用花括号配平切出方法体(比正则可靠: 方法内可能有对象字面量/模板串)。 */
function sliceMethod(sig) {
  const i = SRC.indexOf(sig)
  assert(i >= 0, '未找到方法: ' + sig)
  let d = 0, started = false
  for (let k = i; k < SRC.length; k++) {
    const ch = SRC[k]
    if (ch === '{') { d++; started = true }
    else if (ch === '}') { d--; if (started && d === 0) return SRC.slice(i, k + 1) }
  }
  throw new Error('花括号未配平: ' + sig)
}
const C = (name) => {
  const m = SRC.match(new RegExp('const ' + name + ' = (\\d+)'))
  assert(m, '未找到常量 ' + name)
  return Number(m[1])
}
const NOTE = C('DEFAULT_NOTE_CAPACITY_CHARS'), USER = C('DEFAULT_USER_CAPACITY_CHARS')
const PREV = C('DEFAULT_CAPACITY_CHARS_PREV'), VER = C('CAPACITY_DEFAULTS_VERSION')

// 把真实方法体包进一个类里(方法间的 this 调用关系原样保留)
//
// ★#82（2026-09-20）：`loadConfigSync` / `persistConfigSyncPre` 现在调用 `config-io-pre.js`
//   的两个函数（读侧损坏隔离 + 写侧原子替换）。切片注入的模块**没有**这些符号 ⇒
//   ReferenceError 会被方法自身的 catch 吞掉，表现为「磁盘没落盘 / 用户值被覆盖」
//   （与 T7-a 的 autocont-host 同型：错误被 catch 掩盖，症状离真因很远）。
//   ⇒ 注入**真实实现**（import 本尊），而不是打桩 —— 打桩会让「原子写是否真的原子」
//     这一被测行为失去意义。
const modSrc = `
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
// ★#82：注入被测函数的真实实现（ESM 必须用 file:// URL，不能用裸盘符路径）
import {
  writeTextAtomicPreSync,
  writeTextAtomicPre,
  readJsonQuarantinePreSync,
} from '${pathToFileURL(path.resolve('lib', 'config-io-pre.js')).href}'
const DEFAULT_NOTE_CAPACITY_CHARS = ${NOTE}
const DEFAULT_USER_CAPACITY_CHARS = ${USER}
const DEFAULT_CAPACITY_CHARS_PREV = ${PREV}
const CAPACITY_DEFAULTS_VERSION = ${VER}
// 注意: capacityDefaultsVersion 也在此 —— 正是"默认值污染判据"的成因, 必须保真
const DEFAULT_CONFIG = {
  noteCapacityChars: DEFAULT_NOTE_CAPACITY_CHARS,
  userCapacityChars: DEFAULT_USER_CAPACITY_CHARS,
  capacityDefaultsVersion: CAPACITY_DEFAULTS_VERSION,
  boardMode: 'graph',
}
export class Engine {
  constructor(configPath) { this._configPath = configPath; this.config = { ...DEFAULT_CONFIG }; this._readError = null }
  ${sliceMethod('_mergeConfigPre(parsed) {')}
  ${sliceMethod('upgradeCapacityDefaultsPre(rawCfg) {')}
  ${sliceMethod('loadConfigSync() {')}
  ${sliceMethod('persistConfigSyncPre() {')}
}
`
const modDir = mkdtempSync(path.join(tmpdir(), 'm9mod-'))
const modFile = path.join(modDir, 'engine.mjs')
mkdirSync(modDir, { recursive: true })
writeFileSync(modFile, modSrc, 'utf8')
const { Engine } = await import(pathToFileURL(modFile).href)

/** 造临时配置文件 + 引擎实例 */
function fresh(initialConfig) {
  const dir = mkdtempSync(path.join(tmpdir(), 'm9e2e-'))
  const file = path.join(dir, 'cfg.json')
  if (initialConfig !== null) writeFileSync(file, JSON.stringify(initialConfig, null, 2), 'utf8')
  const eng = new Engine(file)
  eng.loadConfigSync = Engine.prototype.loadConfigSync
  return { eng, file, read: () => JSON.parse(readFileSync(file, 'utf8')), clean: () => rmSync(dir, { recursive: true, force: true }) }
}

console.log('=== M9 端到端: 真实合并路径 + 真实落盘 ===')

t('M9E-1 ★★ 老配置(磁盘 12000、无版本键) 走 loadConfigSync: 内存=24000 且**磁盘也=24000**', () => {
  // 真实老用户形态: saveConfig 落过盘 ⇒ 两个容量键在, 但**没有** capacityDefaultsVersion
  const { eng, read, clean } = fresh({ noteCapacityChars: 12000, userCapacityChars: 12000 })
  try {
    const cfg = eng.loadConfigSync()
    assert(cfg.noteCapacityChars === 24000, '★ 内存未抬升, 实为 ' + cfg.noteCapacityChars)
    assert(cfg.userCapacityChars === 24000, '★ 内存未抬升, 实为 ' + cfg.userCapacityChars)
    const disk = read()
    assert(disk.noteCapacityChars === 24000, '★★ 磁盘未落盘, 仍为 ' + disk.noteCapacityChars)
    assert(disk.userCapacityChars === 24000, '★★ 磁盘未落盘, 仍为 ' + disk.userCapacityChars)
    assert(disk.capacityDefaultsVersion === VER, '★ 磁盘未写版本号 ⇒ 幂等守卫失效')
  } finally { clean() }
})

t('M9E-2 ★ 幂等: 第二次 loadConfigSync 不再改动磁盘内容', () => {
  const { eng, read, clean } = fresh({ noteCapacityChars: 12000, userCapacityChars: 12000 })
  try {
    eng.loadConfigSync()
    const first = JSON.stringify(read())
    eng.loadConfigSync()
    const second = JSON.stringify(read())
    assert(first === second, '★ 第二次加载又改了磁盘(不幂等)')
  } finally { clean() }
})

t('M9E-3 ★ 用户自设值走完整链路不被覆盖(8000 / 50000 原样保留)', () => {
  const { eng, read, clean } = fresh({ noteCapacityChars: 8000, userCapacityChars: 50000 })
  try {
    const cfg = eng.loadConfigSync()
    assert(cfg.noteCapacityChars === 8000, '★ 8000 被改成 ' + cfg.noteCapacityChars)
    assert(cfg.userCapacityChars === 50000, '★ 50000 被改成 ' + cfg.userCapacityChars)
    const disk = read()
    assert(disk.noteCapacityChars === 8000 && disk.userCapacityChars === 50000, '★ 磁盘上的自设值被篡改')
  } finally { clean() }
})

t('M9E-4 ★ 新装用户(配置文件不存在) 拿到 24000, 不因迁移报错', () => {
  const { eng, clean } = fresh(null) // 不写文件 ⇒ 走 ENOENT 分支
  try {
    const cfg = eng.loadConfigSync()
    assert(cfg.noteCapacityChars === 24000, '新装默认应为 24000, 实为 ' + cfg.noteCapacityChars)
    assert(cfg.userCapacityChars === 24000, '新装默认应为 24000, 实为 ' + cfg.userCapacityChars)
  } finally { clean() }
})

t('M9E-5 ★ **默认值污染判据**回归锁: 守卫读 rawCfg, 不得读 this.config', () => {
  const up = sliceMethod('upgradeCapacityDefaultsPre(rawCfg) {')
  // ⚠️ 断言前先剥注释 —— 方法里的**说明注释**恰好写到了这句反例,
  //    不剥会把"文档里提到反例"误判成"代码里在用反例"。
  const upCode = up.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // ⚠️ 只查**守卫那一行**, 不能查整个方法体: 方法末尾有一句**合法的**写入
  //    `this.config.capacityDefaultsVersion = CAPACITY_DEFAULTS_VERSION`(落版本号),
  //    全局搜 this.config 会把这句误判成违规(本断言第二版就这么假红过)。
  // ⚠️ 守卫那一行是 `if (Number.isFinite(onDiskVer) && onDiskVer >= CAPACITY_DEFAULTS_VERSION)`,
  //    它用的是**派生局部变量 onDiskVer**, 不含 rawCfg 字面量 ⇒ 光看守卫行会误判。
  //    正确做法: 断言"守卫行的判据来自 onDiskVer" + "onDiskVer 派生自 rawCfg" 两条链。
  const lines = upCode.split('\n')
  const guardLine = lines.find(l => /^\s*if \(/.test(l) && /CAPACITY_DEFAULTS_VERSION/.test(l))
  assert(guardLine, '未找到守卫分支')
  assert(/onDiskVer|rawCfg/.test(guardLine), '★ 守卫判据必须来自磁盘原文, 实际: ' + guardLine.trim())
  assert(!/this\.config/.test(guardLine),
    '★ 守卫不得读 this.config —— 合并后恒等于当前版本, 迁移会永不执行。实际: ' + guardLine.trim())
  const deriveLine = lines.find(l => /const\s+onDiskVer\s*=/.test(l))
  assert(deriveLine, '未找到 onDiskVer 的派生行')
  assert(/rawCfg/.test(deriveLine), '★ onDiskVer 必须派生自 rawCfg(磁盘原文), 实际: ' + deriveLine.trim())
  assert(!/this\.config/.test(deriveLine), '★ onDiskVer 不得派生自 this.config, 实际: ' + deriveLine.trim())
  const sync = sliceMethod('loadConfigSync() {')
  assert(/upgradeCapacityDefaultsPre\(parsed\)/.test(sync), '★ loadConfigSync 必须传 parsed')
  const ai = SRC.indexOf('async loadConfig()')
  const asyncSeg = SRC.slice(ai, ai + 900)
  assert(/upgradeCapacityDefaultsPre\(parsed\)/.test(asyncSeg), '★ loadConfig 必须传 parsed')
})

t('M9E-6 ★ 注册期路径必须**同步**落盘(loadConfigSync 是唯一真正跑的那条)', () => {
  const sync = sliceMethod('loadConfigSync() {')
  assert(/persistConfigSyncPre\(\)/.test(sync), '★ loadConfigSync 必须调用同步落盘')
  assert(!/await /.test(sync), '★ 同步路径里不得出现 await(apply 不是 async)')
  assert(/persistConfigSyncPre\(\) \{/.test(SRC), 'persistConfigSyncPre 方法应存在')
})

const total = pass + fail
console.log('[m9-e2e] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
rmSync(modDir, { recursive: true, force: true })
if (fail > 0) process.exit(1)
