/**
 * #449-1 迁移显式确认 · 版本契约层（同构，零依赖）
 *
 * 为什么存在：
 *   第一版修复把 `allowUnprovenUserFiles` 这个字段名和「按包路径绑定」判据
 *   硬编码进 client.js 的 6 个请求点 —— 那只是 alpha.6 的快照。
 *   alpha.7 及以后只要改参数名、把确认通道挪进 diag()、或干脆取消了
 *   #449 的历史包限制，这 6 处就会静默失效：请求照发、后端不认，
 *   UI 却还显示「仍要导入」勾选框，而且 CI 全绿看不出来。
 *
 * 本层做的事：
 *   1. 单一真源：字段名 + 判据只定义一次，6 个请求点统一调用 body()。
 *   2. 能力协商：宿主/后端可注入 __DAM_MIGRATION_OPTIN__ = { field, required }
 *      覆盖契约；未注入时严格回退 alpha.6 默认契约。
 *   3. fail-closed：任何未知形态都不会变成无条件放行；
 *      required=false 时干脆不传字段、不显示勾选框，避免误导用户。
 *
 * 同构用法：
 *   · 浏览器：tools/apply-migration-optin.mjs 提取 HELPER 区间，原样内联到
 *     client.js 最顶部（挂 globalThis.__damMigrationOptIn）。
 *   · Node：import { installHelper, extractHelperSource } 做单测/契约校验。
 *   · 契约守护：smoke-test-migration-optin-compat.mjs 断言两处 HELPER 区间
 *     逐字一致，防止「改了契约模块却忘了重新生成 bundle」。
 *
 * 纪律：HELPER 区间内不得出现 export/import/Node API，否则浏览器侧会炸。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* === HELPER-BEGIN === */
;(function (g) {
  'use strict'
  var DEFAULT_FIELD = 'allowUnprovenUserFiles'
  var FIELD_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

  function caps() {
    var a = g.__DAM_MIGRATION_OPTIN__
    var b = g.__DAM_MIGRATION_CAPABILITIES__ && g.__DAM_MIGRATION_CAPABILITIES__.migrationOptIn
    var raw = a || b || null
    return (raw && typeof raw === 'object') ? raw : null
  }

  function contract() {
    var raw = caps()
    var field = DEFAULT_FIELD
    var required = true
    var source = 'default'
    if (raw) {
      if (typeof raw.field === 'string' && FIELD_RE.test(raw.field)) { field = raw.field; source = 'override' }
      if (raw.required === false || raw.notRequired === true) { required = false; source = 'override' }
      else if (raw.required === true) { required = true; source = 'override' }
    }
    return { field: field, required: required, source: source }
  }

  // 唯一判据：默认 false；仅当「当前包路径」与「已确认包路径」逐字相等才 true。
  // 换包 / 清空路径 / 能力未知 ⇒ 一律 false，绝不无条件放行。
  function value(pack, confirmedPack) {
    if (!contract().required) return undefined
    return !!(pack && confirmedPack && confirmedPack === pack)
  }

  function body(pack, confirmedPack) {
    var c = contract()
    if (!c.required) return {}
    var out = {}
    out[c.field] = value(pack, confirmedPack)
    return out
  }

  g.__damMigrationOptIn = {
    contract: contract,
    value: value,
    body: body,
    required: function () { return contract().required },
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
/* === HELPER-END === */

export const OPTIN_DEFAULT_FIELD = 'allowUnprovenUserFiles'
export const OPTIN_HELPER_BEGIN = '/* === HELPER-BEGIN === */'
export const OPTIN_HELPER_END = '/* === HELPER-END === */'

/** 取出含首尾标记的完整 HELPER 块（用于内联与逐字比对）。 */
export function extractHelperSource(src) {
  const a = src.indexOf(OPTIN_HELPER_BEGIN)
  const b = src.indexOf(OPTIN_HELPER_END)
  if (a < 0 || b < 0 || b <= a) return null
  return src.slice(a, b + OPTIN_HELPER_END.length)
}

export function selfSource() {
  return readFileSync(fileURLToPath(import.meta.url), 'utf8')
}

/** Node 侧沙箱装载：把 helper 装到传入对象上，不污染真 globalThis。 */
export function installHelper(g, capabilities) {
  if (capabilities !== undefined) g.__DAM_MIGRATION_OPTIN__ = capabilities
  const src = extractHelperSource(selfSource())
  if (!src) throw new Error('HELPER 区间缺失')
  new Function('globalThis', src)(g)
  return g.__damMigrationOptIn
}
