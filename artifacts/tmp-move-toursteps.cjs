/* TOUR_STEPS 定义+暴露整体上移到 DialogHost 早退之前(2026-09-27 真机实锤修复)
 * 症状:v4 welcome 第2/3页空白——TOUR_STEPS 暴露行在 `if (!dialogState) return null` 之后,
 *      v4 模式无弹窗 ⇒ 早退 ⇒ 全局永不赋值 ⇒ steps=[] ⇒ 分页正文空。
 * 修法:块整体上移到早退前(定义只依赖模块级 locale,求值安全);经典档行为零改动。 */
const fs = require('fs')
const SRC = 'D:/dsh-auto-memory/lib/client.js'
const src = fs.readFileSync(SRC, 'utf8')
const lines = src.split('\n')
const find = (pred, what) => {
  const hits = []
  for (let i = 0; i < lines.length; i++) if (pred(lines[i])) hits.push(i)
  if (hits.length !== 1) throw new Error(what + ' hits=' + hits.length + ' lines=' + hits.join(','))
  return hits[0]
}
const iDef = find(l => l.trim() === 'var TOUR_STEPS = [', 'TOUR_STEPS def')
const iExp = find(l => l.includes("window['dsh-auto-memory.TOUR_STEPS'] = TOUR_STEPS"), 'exposure')
const iRet = find(l => l.replace(/\r$/, '') === '      if (!dialogState) return null', 'early return')
console.log('def@', iDef + 1, 'exposure@', iExp + 1, 'earlyRet@', iRet + 1)
if (!(iRet < iDef && iDef < iExp)) throw new Error('order wrong')
const bytes0 = Buffer.byteLength(src, 'utf8')
const block = lines.splice(iDef, iExp - iDef + 1)
block.unshift("      // dam-skin(2026-09-27):TOUR_STEPS 定义+暴露整体上移到早退之前——真机实锤:v4 模式无弹窗时",
             "      // DialogHost 在此早退,原位置(早退后)永不执行,v4 welcome 拿不到步骤(批次2 第2页空白)。",
             "      // 单源不变;定义求值只依赖模块级 locale,经典档行为零改动(每次渲染刷新 locale 的语义保留)。")
lines.splice(iRet, 0, ...block)
const out = lines.join('\n')
fs.writeFileSync(SRC, out, 'utf8')
const chk = fs.readFileSync(SRC, 'utf8')
const loneLF = (chk.match(/(^|[^\r])\n/g) || []).length
console.log('bytes:', Buffer.byteLength(chk, 'utf8'), '(was', bytes0 + ')', 'lone-LF:', loneLF,
  'def now @', chk.split('\n').findIndex(l => l.trim() === 'var TOUR_STEPS = [') + 1)
