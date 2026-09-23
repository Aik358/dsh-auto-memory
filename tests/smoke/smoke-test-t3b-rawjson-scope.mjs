// tests/smoke/smoke-test-t3b-rawjson-scope-pre.mjs
// T3b：RAW_JSON_MARK 判据范围守卫（2026-09-23）
//
// 背景：该正则的 `updatedAt` 分支原为**裸词**，会把"正常讨论该字段名的中文正文"一并拒写
//   （实测复现：「投影行补带 updatedAt 与 createdAt」被拦）。它常年无守卫覆盖 —— 本套件补上。
//
// 本套件钉三件事：
//   A. 正向：真画像 JSON 仍被拒（不能把闸门改废 —— 这是防外部画像混入的防线）
//   B. 反向：裸词散文必须放行（本次误伤修复不得回退）
//   C. 守恒：`hygieneGateForPrimitive` 仍**不含**该判据（T3-1 决策，防下沉误伤）
//
// 判据写法纪律：断言锚点用**行为**而非源码文本拼接，避免"守卫引到注释上"（工程纪律 31）。
import { sanitizeForWrite, hygieneGateForPrimitive } from '../../lib/index.js'

let pass = 0, fail = 0
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name) }
  else { fail++; console.log('XX FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}
const gate = (s) => sanitizeForWrite(s, { maxEntryChars: 200000 })
const isRawJson = (s) => { const g = gate(s); return g.ok === false && g.reason === 'raw-json' }

console.log('— A. 正向：真画像仍是 raw-json（闸门没被改废）—')
t('A1 完整画像 JSON（含引号 updatedAt）拒写',
  isRawJson('{"uid":"abc","updatedAt":"2026-08-18","role":"user"}'))
t('A2 仅带引号 uid 拒写', isRawJson('{"uid":"abc"}'))
t('A3 memoryBlock 整段混入拒写', isRawJson('xxx memoryBlock {content} "role":"user"'))
t('A4 仅 role:user 形态拒写', isRawJson('{"role":"user"}'))
t('A5 role:assistant 形态拒写', isRawJson('{"role":"assistant"}'))
t('A6 仅带引号 updatedAt + 冒号 拒写', isRawJson('{"updatedAt":"latest"}'))
t('A7 空格式变体（带引号 updatedAt 配空格）拒写', isRawJson('{ "updatedAt" : 1700000000000 }'))

console.log('— B. 反向：裸词散文必须放行（本次修复的核心）—')
t('B1 中文正文提到裸字段名 — 放行',
  gate('投影行补带 updatedAt 与 createdAt（否则次键恒为零）').ok === true)
t('B2 单独出现裸字段名 — 放行', gate('把 updatedAt 加进投影行').ok === true)
t('B3 记忆正文里讨论该字段 — 放行',
  gate('这条记忆里提到了 updatedAt 字段，是正常讨论').ok === true)
t('B4 不带引号的 uid 散文 — 放行', gate('配置里有 uid 这样的字段名').ok === true)
t('B5 技术文档段落（多字段名混排）— 放行',
  gate('索引条目字段：id / updatedAt / createdAt / l0Hash，均为字符串或数字。').ok === true)
t('B6 干净长条目 — 放行',
  gate('- 这是一条干净的长条目'.repeat(40)).ok === true)

console.log('— C. 守恒：原语层判据范围未被牵连（T3-1 决策）—')
const primitive = (s) => hygieneGateForPrimitive(s)
t('C1 原语层对完整画像 JSON 仍放行（它本就不含该判据）',
  primitive('{"uid":"abc","updatedAt":"x","role":"user"}').ok === true)
t('C2 原语层对裸字段名散文放行', primitive('提到了 updatedAt 字段').ok === true)
t('C3 原语层乱码仍拦（自身判据未被削弱）',
  primitive('涓婁紶鏂囦欢娴嬭瘯').ok === false)
t('C4 原语层复读仍拦', primitive('风。风。风。风。风。风。').ok === false)

console.log('— D. 判据分工不串味 —')
t('D1 raw-json 的 reason 精确可辨（不被 mojibake 抢占）',
  gate('{"uid":"abc"}').reason === 'raw-json')
t('D2 乱码优先于 raw-json（判据顺序未被改动）',
  (() => { const g = gate('涓婁紶 {"uid":"abc"}'); return g.ok === false && g.reason === 'mojibake' })())

console.log('\nPASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)
