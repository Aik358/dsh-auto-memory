// M9 验收: 容量出厂默认 12000 → 24000 + 老配置一次性迁移。
//
// 用户报障原话:「先把所有人的默认都改到 24000,好多人跟我抱怨写满了,写不进去了。」
//
// ★ 本套件的核心不是"常量改成 24000"这件事,而是**老用户能否真的拿到它**:
//   `saveConfig` 把**整个合并后的 config** 落盘(实测某实例 95 个键全在盘上),所以
//   老用户只要在设置页存过任何一项,`noteCapacityChars: 12000` 就已被钉死在磁盘里 ⇒
//   **只改常量对老用户完全无效**。必须配 `upgradeCapacityDefaultsPre()` 一次性迁移。
import { GUIDANCE } from '../../lib/index.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const CLI = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

// ⚠️ DEFAULT_CONFIG 未导出 ⇒ 从源码读它的两个容量字段(DEFAULT_CONFIG 里写的是常量引用, 故两处都要读)
const CONST = (name) => {
  const m = SRC.match(new RegExp('const ' + name + ' = (\\d+)'))
  assert(m, '未找到常量 ' + name)
  return Number(m[1])
}
const CFG_FIELD = (key) => {
  // 在 DEFAULT_CONFIG 字面量内找 `<key>: <IDENT>`
  const start = SRC.indexOf('const DEFAULT_CONFIG = {')
  const seg = SRC.slice(start, start + 20000)
  const m = seg.match(new RegExp(key + ':\\s*(\\w+)'))
  assert(m, 'DEFAULT_CONFIG 里未找到 ' + key)
  return m[1] // 返回标识符名(如 DEFAULT_NOTE_CAPACITY_CHARS)
}

console.log('=== M9 容量默认 12000 → 24000（含老配置迁移）===')

// ─────────────────────────────────────────────────────────────
// M9-1..2 出厂默认
// ─────────────────────────────────────────────────────────────
t('M9-1 ★ 出厂默认两个键都是 24000（新装用户直接拿到）', () => {
  assert(CONST('DEFAULT_NOTE_CAPACITY_CHARS') === 24000, 'DEFAULT_NOTE_CAPACITY_CHARS 应为 24000, 实为 ' + CONST('DEFAULT_NOTE_CAPACITY_CHARS'))
  assert(CONST('DEFAULT_USER_CAPACITY_CHARS') === 24000, 'DEFAULT_USER_CAPACITY_CHARS 应为 24000, 实为 ' + CONST('DEFAULT_USER_CAPACITY_CHARS'))
  // DEFAULT_CONFIG 必须引用这两个常量(而不是又写死一个数)
  assert(CFG_FIELD('noteCapacityChars') === 'DEFAULT_NOTE_CAPACITY_CHARS', 'DEFAULT_CONFIG.noteCapacityChars 须引用常量')
  assert(CFG_FIELD('userCapacityChars') === 'DEFAULT_USER_CAPACITY_CHARS', 'DEFAULT_CONFIG.userCapacityChars 须引用常量')
})

t('M9-2 ★ 旧默认 12000 被单独留作迁移判据常量（不是散落的魔法数字）', () => {
  assert(/const DEFAULT_CAPACITY_CHARS_PREV = 12000/.test(SRC), '★ 必须有 DEFAULT_CAPACITY_CHARS_PREV 常量作为"上一版默认"判据')
  assert(/const CAPACITY_DEFAULTS_VERSION = \d+/.test(SRC), '★ 必须有档位版本常量(保证只升一次)')
  assert(CFG_FIELD('capacityDefaultsVersion') === 'CAPACITY_DEFAULTS_VERSION', 'DEFAULT_CONFIG 须带 capacityDefaultsVersion 且引用常量')
})

// ─────────────────────────────────────────────────────────────
// M9-3..5 迁移语义 —— 本套件的重点
// ─────────────────────────────────────────────────────────────
// 从源码重建迁移函数(纯函数式, 只读 this.config 与入参 ⇒ 可直接单测)
// ⚠️ 切出来的文本**已含函数自身的收尾 `}`** ⇒ 拼装时不能再补一个 `}`(多一个会 SyntaxError)。
// ⚠️ 2026-09-18 起签名是 `(rawCfg)`: 守卫必须读**磁盘原文**而不是合并结果
//    (合并结果里版本号恒等于当前版本 ⇒ 迁移会结构性永不执行)。
//    故这里把"磁盘原文"与"合并后的 config"分开传:老断言语义是"手搓 config 直接喂",
//    对它们而言两者同值;真实老用户(磁盘上根本没有版本键)的差异由 M9E 端到端套件覆盖。
const migrateSrc = SRC.match(/upgradeCapacityDefaultsPre\(rawCfg\) \{[\s\S]*?\n  \}/)
assert(migrateSrc, 'upgradeCapacityDefaultsPre 应能从源码提取')
const migrateBody = migrateSrc[0].replace(/^upgradeCapacityDefaultsPre\(rawCfg\) \{/, '')
assert(/\}\s*$/.test(migrateBody), '切出的函数体应以 } 收尾')
const CAP = { PREV: 12000, NOTE: 24000, USER: 24000, VER: 24 }
const migrate = new Function('DEFAULT_CAPACITY_CHARS_PREV', 'DEFAULT_NOTE_CAPACITY_CHARS', 'DEFAULT_USER_CAPACITY_CHARS', 'CAPACITY_DEFAULTS_VERSION',
  'return function (rawCfg) {' + migrateBody)(CAP.PREV, CAP.NOTE, CAP.USER, CAP.VER)
const run = (cfg, rawCfg = cfg) => { const o = { config: cfg }; return { changed: migrate.call(o, rawCfg), config: o.config } }

t('M9-3 ★ 老配置仍是 12000 ⇒ 抬到 24000（不迁移的话老用户永远被钉在 12k）', () => {
  const { changed, config } = run({ noteCapacityChars: 12000, userCapacityChars: 12000 })
  assert(config.noteCapacityChars === 24000, '★ noteCapacityChars 须抬到 24000, 实为 ' + config.noteCapacityChars)
  assert(config.userCapacityChars === 24000, '★ userCapacityChars 须抬到 24000, 实为 ' + config.userCapacityChars)
  assert(changed.length === 2, '须报告 2 个键被改, 实为 ' + changed.length)
  assert(config.capacityDefaultsVersion === 24, '须落档位版本')
})

t('M9-4 ★ **用户自设值一律不动**（12000/24000 之外的值是用户偏好, 不得覆盖）', () => {
  for (const v of [8000, 50000, 500, 99999]) {
    const { changed, config } = run({ noteCapacityChars: v, userCapacityChars: v })
    assert(config.noteCapacityChars === v && config.userCapacityChars === v,
      '★ 自设值 ' + v + ' 被篡改成了 ' + config.noteCapacityChars)
    assert(changed.length === 0, '自设值时不该报告改动')
  }
})

t('M9-5 ★ 幂等：只升一次 —— 用户日后手动改回 12000 不再被覆盖', () => {
  // 第一遍: 老配置 → 抬升
  const first = run({ noteCapacityChars: 12000, userCapacityChars: 12000 })
  assert(first.config.noteCapacityChars === 24000, '第一遍应抬升')
  // 第二遍(已带档位版本): 不得再动
  const second = run({ ...first.config })
  assert(second.changed.length === 0, '★ 第二遍必须无改动(幂等)')
  assert(second.config.noteCapacityChars === 24000, '第二遍不改值')
  // 用户手动改回 12000 后: 档位已是 24 ⇒ 不再覆盖(尊重用户选择)
  const manual = run({ ...first.config, noteCapacityChars: 12000 })
  assert(manual.config.noteCapacityChars === 12000, '★ 用户手动设回 12000 必须被尊重, 实为 ' + manual.config.noteCapacityChars)
  assert(manual.changed.length === 0, '不该报告改动')
})

// ─────────────────────────────────────────────────────────────
// M9-6..7 接线与落盘
// ─────────────────────────────────────────────────────────────
t('M9-6 ★ 迁移接在两个加载路径上（同步路径是注册期真正跑的那条）', () => {
  // ⚠️ 2026-09-18 起调用是 `this.upgradeCapacityDefaultsPre(parsed)`(必须传磁盘原文);
  //    同步路径还要**自己落盘**(persistConfigSyncPre) —— 它是注册期唯一真跑的那条。
  //
  // ★2026-09-20（#82）：窗口从 900 放宽到 1800。
  //    原因：`loadConfigSync` 现在多了一段**损坏隔离读取**（`readJsonQuarantinePreSync`
  //    + 两分支 _readError 文案），把 `persistConfigSyncPre()` 挤出了原 900 字符窗口
  //    ⇒ 断言以「找不到」的形式失败（症状离真因很远：报的是"必须同步落盘"）。
  //    ⚠️ 教训：**用固定字符窗口截方法体的断言，会因为无关改动而静默失效**。
  //    这里放宽窗口并保留断言强度；若要更稳，应改为按方法体边界切片（见 sliceMethod）。
  const sync = SRC.slice(SRC.indexOf('loadConfigSync()'), SRC.indexOf('loadConfigSync()') + 1800)
  assert(/this\.upgradeCapacityDefaultsPre\(parsed\)/.test(sync), '★ loadConfigSync 必须调用迁移并传 parsed')
  assert(/persistConfigSyncPre\(\)/.test(sync), '★ loadConfigSync 必须同步落盘')
  const asyncAt = SRC.indexOf('async loadConfig()')
  const asyncSeg = SRC.slice(asyncAt, asyncAt + 1800)
  assert(/this\.upgradeCapacityDefaultsPre\(parsed\)/.test(asyncSeg), '★ loadConfig 也必须调用迁移并传 parsed')
  assert(/persistConfigPre/.test(asyncSeg), '★ 异步路径须把抬升结果落盘(否则设置页显示 12000 与实际不一致)')
})

t('M9-7 迁移 fail-soft：异常输入不得抛出（空 config 只跳过, 不炸插件启动）', () => {
  // 空 config ⇒ 第一行读 this.config.capacityDefaultsVersion 就抛 ⇒ 必须被 catch 吞掉并返回 []
  let threw = false
  let r = null
  try { r = run(null) } catch (e) { threw = true }
  assert(!threw, '★ 空 config 不得抛出(否则挡住插件启动)')
  assert(Array.isArray(r.changed) && r.changed.length === 0, '空 config 应返回空改动列表')
  // 源码里必须有 try/catch 兜底
  assert(/try \{[\s\S]*?\} catch \(e\) \{\s*return changed\s*\}/.test(migrateSrc[0]), '迁移须有 fail-soft catch')
})

// ─────────────────────────────────────────────────────────────
// M9-8..9 文案与设置页同步(否则界面还写着 12000, 用户以为没生效)
// ─────────────────────────────────────────────────────────────
t('M9-8 ★ 设置页与提示文案同步为 24000（zh + en 各 2 处）', () => {
  const cliHits = (CLI.match(/默认 24000|default 24000/g) || []).length
  assert(cliHits >= 4, '★ client.js 四处文案(zh/en × note/user)都须写 24000, 实为 ' + cliHits)
  assert(!/默认 12000|default 12000/.test(CLI), '★ 不得残留"默认 12000"的活动文案')
  const ph = (CLI.match(/\? 24000 : cfg\.\w+CapacityChars/g) || []).length
  assert(ph === 2, '★ 两个输入框的占位默认值须为 24000, 实为 ' + ph)
})

t('M9-9 ★ 给模型的注入说明也同步（否则模型以为上限是 12000）', () => {
  assert(/默认各 \*\*24000\*\* 字符/.test(SRC), '★ 注入纪律行须写 24000')
  assert(/noteCapacityChars,默认 24000/.test(SRC), '★ memory_note_pre 描述须写 24000')
  assert(/userCapacityChars,默认 24000/.test(SRC), '★ memory_user_pre 描述须写 24000')
  assert(!/默认各 12000|noteCapacityChars,默认 12000|userCapacityChars,默认 12000/.test(SRC), '不得残留 12000 的活动说明')
})

// ─────────────────────────────────────────────────────────────
// M9-10 历史 changelog 不得被改(是"当时的发布记录", 篡改即伪造历史)
// ─────────────────────────────────────────────────────────────
t('M9-10 历史 changelog 的 12000 保留原样（那是 2.4.0 的发布记录, 不是活动文案）', () => {
  const hist = CLI.slice(CLI.indexOf("'2.4.0': { zh: ["), CLI.indexOf("'2.4.0': { zh: [") + 900)
  assert(/默认各 12000 字符/.test(hist), '★ 2.4.0 changelog 里的 12000 必须原样保留(改它=伪造发布历史)')
})

const total = pass + fail
console.log('[m9-capacity-default] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
if (fail > 0) process.exit(1)
