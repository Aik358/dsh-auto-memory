// T7-a 断言锁：把「水位/自动接续默认值必须常量化且互不耦合」锁死。
// 为什么需要：这是"死代码/漏改"类问题的反面——常量化的价值全在于**没有漏站点**，
// 没有断言就只是"这次改对了"，下次有人加一处 `|| 0.75` 谁也不会发现。
import { readFileSync } from 'node:fs'

const L = (f) => readFileSync(new URL('../../lib/' + f, import.meta.url), 'utf8')
const SRC = L('index.js')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); console.log('  ok - ' + name); pass++ }
  catch (e) { console.log('  FAIL - ' + name + ': ' + (e && e.message)); fail++ }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

console.log('=== T7-a 水位/接续默认值常量化（上游 #86-4）===')

t('T7-1 两个常量都已导出且取值 0.75', () => {
  assert(/export const DEFAULT_WATER_LEVEL_THRESHOLD = 0\.75/.test(SRC), '须导出 DEFAULT_WATER_LEVEL_THRESHOLD')
  assert(/export const DEFAULT_AUTO_CONTINUE_THRESHOLD = 0\.75/.test(SRC), '须导出 DEFAULT_AUTO_CONTINUE_THRESHOLD')
})

t('T7-2 ★ 内联兜底 `|| 0.75` 已归零（除注释外）', () => {
  // 逐行扫，跳过注释行（注释里出现"0.75"是说明文字，不算漏站点）
  const offenders = SRC.split(/\r?\n/)
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => {
      const s = line.trim()
      if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return false
      return /\|\|\s*0\.75/.test(line)
    })
  assert(offenders.length === 0,
    '★ 仍有内联 `|| 0.75` 兜底 ' + offenders.length + ' 处：' + offenders.map((o) => 'L' + o.no).join(', '))
})

t('T7-3 ★ 两个 DEFAULT_CONFIG 键都引用各自常量（真源不残留字面量）', () => {
  assert(/waterLevelThreshold: DEFAULT_WATER_LEVEL_THRESHOLD,/.test(SRC), 'waterLevelThreshold 须引用常量')
  assert(/autoContinueThreshold: DEFAULT_AUTO_CONTINUE_THRESHOLD,/.test(SRC), 'autoContinueThreshold 须引用常量')
})

t('T7-4 ★★ 两开关**不得共用同一常量**（防耦合成一个开关）', () => {
  // 这条是本批最容易做错的地方：初版脚本把 autoContinueThreshold 的兜底也绑到 WATER 常量上，
  // 那会让"只调水位、不动自动接续"变成不可能 —— 违反本仓「功能开关必须解耦」纪律。
  const autoLines = SRC.split(/\r?\n/).filter((l) => /autoContinueThreshold/.test(l))
  const bad = autoLines.filter((l) => /DEFAULT_WATER_LEVEL_THRESHOLD/.test(l))
  assert(bad.length === 0, '★ autoContinueThreshold 相关行不得引用 DEFAULT_WATER_LEVEL_THRESHOLD：' + bad.join(' | '))
})

t('T7-5 水位侧引用点数量符合预期（≥6 处，防被误删）', () => {
  const n = (SRC.match(/DEFAULT_WATER_LEVEL_THRESHOLD/g) || []).length
  assert(n >= 6, '★ DEFAULT_WATER_LEVEL_THRESHOLD 引用点实测 ' + n + ' 处，少于预期 6 处')
})

console.log('[t7a] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
