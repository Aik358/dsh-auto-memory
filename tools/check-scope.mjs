// 精确作用域检查: 只检查**指定名字**在**指定函数**内是否有定义。
// 用途: 新写代码里引入了哪些变量, 逐个确认在所在函数作用域内有声明。
//   (node --check 只查语法, 查不出未定义变量 —— 2026-09-20 在 CalendarTab 用 `zh` 踩过。)
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const lines = src.split(/\r?\n/)

// 顶层声明的名字(整个工厂闭包可见)
const topNames = new Set()
for (const line of lines) {
  let m
  if ((m = line.match(/^\s{0,6}(?:function|var|const|let)\s+([A-Za-z_$][\w$]*)/))) topNames.add(m[1])
}

function bodyOf(fnName) {
  const start = lines.findIndex((L) => new RegExp('^ {4}function ' + fnName + '\\(').test(L))
  if (start < 0) return null
  let depth = 0, end = -1
  for (let j = start; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
    if (depth === 0 && j >= start) { end = j; break }
  }
  return { start, end }
}

// 用法: node tools/check-scope.mjs <FnName> <var1> <var2> ...
const [fnName, ...vars] = process.argv.slice(2)
if (!fnName || !vars.length) {
  console.log('用法: node tools/check-scope.mjs <函数名> <变量1> [变量2 ...]')
  process.exit(2)
}
const b = bodyOf(fnName)
if (!b) { console.log('未找到函数 ' + fnName); process.exit(2) }

const lines_ = lines.slice(b.start, b.end + 1)
const declRes = [
  /(?:^|[\s(:,;{])(?:var|const|let)\s+([A-Za-z_$][\w$]*)/g,
  /function\s+([A-Za-z_$][\w$]*)/g,
  /function\s*\(([^)]*)\)/g,
  /(?:^|[\s(:,;{])([A-Za-z_$][\w$]*)\s*=>/g,
  /\.(?:map|filter|forEach|find|some|every|sort|reduce)\(\s*function\s*\(([^)]*)\)/g,
  /\.(?:then|catch)\(\s*function\s*\(([^)]*)\)/g,
]
const declared = new Set(topNames)
for (const L of lines_) {
  for (const re of declRes) {
    for (const m of L.matchAll(re)) {
      const raw = m[1]
      for (const part of String(raw).split(',')) {
        const t = part.trim().split(/[=:\s]/)[0]
        if (t && /^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t)
      }
    }
  }
}

let bad = 0
for (const v of vars) {
  const used = lines_.some((L) => new RegExp('(^|[^.\\w$])' + v.replace(/\$/g, '\\$') + '\\b').test(L))
  const ok = declared.has(v)
  console.log(`${ok ? '✅' : (used ? '❌' : '○ ')} ${v}  ${ok ? '已在 ' + fnName + ' 作用域内声明' : (used ? '被使用但**未声明**' : '未被使用')}`)
  if (used && !ok) bad++
}
console.log(bad ? `\n❌ ${bad} 个变量未声明` : `\n✅ 全部通过`)
process.exit(bad ? 1 : 0)
