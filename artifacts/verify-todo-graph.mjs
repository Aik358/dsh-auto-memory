// 校验 TODO-GRAPH.html:①无 BOM ②内联脚本可解析可执行 ③渲染出的条目清单
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'docs/internal/TODO-GRAPH.html'
const buf = readFileSync(p)
const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
const html = buf.toString('utf8')

const m = html.match(/<script>([\s\S]*?)<\/script>/)
if (!m) { console.log('❌ 找不到内联脚本'); process.exit(1) }
const js = m[1]
writeFileSync('artifacts/_tmp-todo-graph.js', js)

let mountHtml = '', subText = '', subs = []
global.document = {
  getElementById(id) {
    return {
      set innerHTML(v) { if (id === 'mount') mountHtml = v },
      get innerHTML() { return '' },
      set textContent(v) { if (id === 'sub') subText = v },
      get textContent() { return '' },
      addEventListener() {}, setAttribute() {}, getAttribute() { return '' },
      style: {}, select() {}, value: '',
    }
  },
  addEventListener() {}, querySelectorAll() { return [] }, execCommand() { return true },
}
global.localStorage = { getItem() { return null }, setItem() {} }
global.prompt = () => null
global.alert = () => {}
global.confirm = () => false

let err = null
try { new Function(js)() } catch (e) { err = e }

console.log('BOM = ' + (bom ? '❌ 有 BOM' : '✅ 无'))
console.log('脚本字节数 = ' + js.length)
console.log('执行结果 = ' + (err ? '❌ ' + err.message : '✅ 正常渲染'))
if (err) process.exit(2)

const cards = mountHtml.split('class="card"').length - 1
const slots = mountHtml.split('class="slot"').length - 1
console.log('渲染卡片 = ' + cards + ' 张;待入池空位 = ' + slots + ' 个')
console.log('副标题 = ' + subText.slice(0, 120) + '…')
console.log('')

const phases = mountHtml.split('<section class="phase"').slice(1)
for (const ph of phases) {
  const t = (ph.match(/<h2>([^<]*)<\/h2>/) || [])[1] || '?'
  const lv = [...ph.matchAll(/<span class="lvl">([^<]*)<\/span>/g)].map((x) => x[1])
  const titles = [...ph.matchAll(/<span class="title">([^<]*)<\/span>/g)].map((x) => x[1])
  console.log('▌' + t + '   (' + titles.length + ' 条)')
  titles.forEach((x, i) => console.log('   ' + String(lv[i] || '·').padEnd(6) + ' ' + x))
}
