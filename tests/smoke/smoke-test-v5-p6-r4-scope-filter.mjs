/**
 * smoke-test-v5-p6-r4-scope-filter.mjs
 *
 * ★R4 验收（2026-10-27）：看板事件范围筛选（用户裁定 Q7）。
 *
 * 用户裁定原文：「看板适配（默认筛 active + 时间轴）是否需要保留『全部事件』入口
 *              → **建议保留（折叠而非删除）**」。
 *
 * 【为什么必须测「真执行」】**
 *   这是前端 vm 抽取类测试的典型坑：只断言「源码含 filterEventsByScopePre」= 恒真守卫。
 *   必须**真调用**函数并断言返回值。
 */
import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const ROOT = 'D:/dsh-auto-memory'
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

// ── 从源码抽取三个纯函数，在沙箱里真执行（照抄本仓既有的 vm/MakeRuntime 手法）──
function extractFn(name) {
  const marker = 'function ' + name + '('
  const i = SRC.indexOf(marker)
  if (i < 0) return null
  let d = 0, started = false, end = i
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j]
    if (c === '{') { d++; started = true }
    else if (c === '}') { d--; if (started && d === 0) { end = j + 1; break } }
  }
  return SRC.slice(i, end)
}

const fnFilter = extractFn('filterEventsByScopePre')
const fnRead = extractFn('readEventScopePre')
const fnWrite = extractFn('writeEventScopePre')

ok(!!fnFilter, 'P-1 filterEventsByScopePre 存在')
ok(!!fnRead, 'P-2 readEventScopePre 存在')
ok(!!fnWrite, 'P-3 writeEventScopePre 存在')

// 在沙箱里真求值（只注入它们自身需要的符号）
const SB = new Function(
  'var EVENT_SCOPE_KEY = "wbEvt.scope";' +
  fnFilter + ';' + fnRead + ';' + fnWrite + ';' +
  'return { filterEventsByScopePre: filterEventsByScopePre, readEventScopePre: readEventScopePre, writeEventScopePre: writeEventScopePre };'
)()

const EV = (id, status) => ({ id, status, name: id, updatedAt: 1 })

console.log('')
console.log('== A. filterEventsByScopePre（真调用）==')
{
  const all = [
    EV('e1', 'active'),
    EV('e2', 'paused'),
    EV('e3', 'closed'),
    EV('e4', 'archived'),
    EV('e5', undefined),
  ]
  const act = SB.filterEventsByScopePre(all, 'active')
  const ids = act.map((x) => x.id)
  ok(ids.indexOf('e1') >= 0, 'A-1 active 保留', ids.join(','))
  ok(ids.indexOf('e2') >= 0, 'A-2 ★paused 保留（暂时停下，用户仍在跟进）', ids.join(','))
  ok(ids.indexOf('e3') < 0, 'A-3 closed 默认不显示')
  ok(ids.indexOf('e4') < 0, 'A-4 archived 默认不显示')
  // ★★2026-10-27 加固：不只查「在列表里」，还要查**默认档**（不传 scope）也含它 ——
  //   这是「用户升级上来旧事件无 status 字段也不会从看板消失」的直接保障。
  ok(ids.indexOf('e5') >= 0, 'A-5a ★status 缺省按 active（不能隐藏当前工作）', ids.join(','))
  ok(SB.filterEventsByScopePre(all).map((x) => x.id).indexOf('e5') >= 0, 'A-5b ★★默认档也含 status 缺省的事件（旧数据不消失）')
  ok(act.length === 3, 'A-6 默认档只留 3 个', act.length)

  const allScope = SB.filterEventsByScopePre(all, 'all')
  ok(allScope.length === 5, 'A-7 ★★「全部」档返回全部 5 个（用户裁定：保留入口）', allScope.length)
  ok(allScope.map((x) => x.id).indexOf('e4') >= 0, 'A-8 ★archived 在「全部」里可见（折叠而非删除）')

  // 负路径 / 边界
  ok(SB.filterEventsByScopePre([], 'active').length === 0, 'A-9 空输入不炸')
  ok(SB.filterEventsByScopePre(null, 'active').length === 0, 'A-10 null 不炸')
  ok(SB.filterEventsByScopePre(all, '垃圾值').length === 3, 'A-11 ★未知 scope 回落 active（fail-safe）', SB.filterEventsByScopePre(all, '垃圾值').length)
  ok(SB.filterEventsByScopePre(all, undefined).length === 3, 'A-12 undefined scope 按默认 active')
  // ★★2026-10-27 加固（变异 1 漏网抓到）：A 组都**显式传 'active'**，测不到「默认值」本身。
  //   必须真测「不传 scope / 传 undefined」的默认行为 —— 那才是用户裁定「默认筛 active」的落点。
  const def1 = SB.filterEventsByScopePre(all)
  ok(def1.length === 3, 'A-14 ★★不传 scope ⇒ 默认只留 active（用户裁定「默认筛 active」）', def1.length)
  ok(def1.map((x) => x.id).indexOf('e4') < 0, 'A-15 ★默认档不含 archived')
  // 不修改原数组
  const before = all.length
  SB.filterEventsByScopePre(all, 'active')
  ok(all.length === before, 'A-13 ★不修改原数组（避免污染数据源）')
}

console.log('')
console.log('== B. read/writeEventScopePre（持久化，真调用）==')
{
  // 假 storage
  const mkStore = (init) => {
    const m = Object.assign({}, init || {})
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, _m: m }
  }
  ok(SB.readEventScopePre(mkStore({})) === 'active', 'B-1 ★空 storage 默认 active（用户裁定：默认筛 active）')
  ok(SB.readEventScopePre(mkStore({ 'wbEvt.scope': 'all' })) === 'all', 'B-2 恢复 all')
  ok(SB.readEventScopePre(mkStore({ 'wbEvt.scope': '垃圾' })) === 'active', 'B-3 垃圾值回落 active')
  ok(SB.readEventScopePre({ getItem: () => { throw new Error('denied') } }) === 'active', 'B-4 storage 抛异常 ⇒ active（fail-soft）')
  const st = mkStore({})
  ok(SB.writeEventScopePre('all', st) === 'all', 'B-5 写 all 返回 all')
  ok(st._m['wbEvt.scope'] === 'all', 'B-6 真的写进 storage')
  ok(SB.writeEventScopePre('垃圾', st) === 'active', 'B-7 写非法值规整为 active')
}

console.log('')
console.log('== C. 接线（源码结构，守卫非功能证据）==')
{
  // ★明确标注：C 组是**守卫**，不是功能验收（功能在 A/B 组真调用里）
  ok(SRC.indexOf('var all = filterEventsByScopePre(allRaw, evScope)') >= 0, 'C-1 [守卫] 筛选接在排序之前')
  ok(SRC.indexOf("'data-dam-scope-btn': 'active'") >= 0, 'C-2 [守卫] 「活跃」按钮存在')
  ok(SRC.indexOf("'data-dam-scope-btn': 'all'") >= 0, 'C-3 [守卫] 「全部」按钮存在（用户裁定）')
  ok(SRC.indexOf('EVENT_SCOPE_KEY') >= 0, 'C-4 [守卫] 持久化键存在')
  // 顺序：筛选必须在 sort 之前（否则「先取前 N 再筛」会假空）
  const iFilter = SRC.indexOf('var all = filterEventsByScopePre(allRaw, evScope)')
  const iSort = SRC.indexOf('var sorted = all.slice().sort(function (a, b) {')
  ok(iFilter >= 0 && iSort >= 0 && iFilter < iSort, 'C-5 ★筛选在排序**之前**（否则前 N 被筛光会假空）', iFilter + ' < ' + iSort)
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)