#!/usr/bin/env node
/* dsh-auto-memory · Teamwork 企业版 demo 自检脚本（可复跑）
 * 用法: node docs/teamwork-impl/demo/_gen/selfcheck.mjs
 * 判据全部来自可执行断言，不依赖目测。
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEMO = path.resolve(HERE, '..', 'index.html')
const src = fs.readFileSync(DEMO, 'utf8')
const results = []
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }

/* 1. 内联脚本语法（vm.Script 编译）*/
const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
let compileOk = true, compileErr = ''
for (const s of scripts) { try { new vm.Script(s) } catch (e) { compileOk = false; compileErr = e.message } }
check('内联脚本语法(vm.Script)', compileOk && scripts.length === 1, 'scripts=' + scripts.length + ' ' + compileErr)

/* 2. data-page 数 */
const pages = [...src.matchAll(/data-page="([a-z]+)"/g)].map(m => m[1])
check('data-page 数量 = 8', pages.length === 8, pages.join(','))

/* 3. 零外链 */
const ext = {
  scriptSrc: (src.match(/<script[^>]+src=/g) || []).length,
  linkHref: (src.match(/<link[^>]+href=/g) || []).length,
  imgSrc: (src.match(/<img[^>]+src=/g) || []).length,
  cssImport: (src.match(/@import/g) || []).length,
  urlHttp: (src.match(/url\(\s*['"]?https?:/g) || []).length,
  cdn: (src.match(/cdn\.|unpkg\.|jsdelivr\.|googleapis\.|fonts\.google/gi) || []).length
}
const extTotal = Object.values(ext).reduce((a, b) => a + b, 0)
check('零外链（script/link/img/@import/url()/CDN 域名）', extTotal === 0, JSON.stringify(ext))

/* 4. 裸硬编码色 = 0（lead 判据）*/
const totalHex = (src.match(/#[0-9a-fA-F]{3,6}\b/g) || []).length
const inFallback = (src.match(/var\([^)]*#[0-9a-fA-F]{3,6}[^)]*\)/g) || []).length
const bare = totalHex - inFallback
check('裸硬编码色 = 0', bare === 0, '总=' + totalHex + ' 兜底=' + inFallback + ' 裸=' + bare)

/* 5. 组件区零字面色值（令牌区之后）*/
const tokensEnd = src.indexOf('/* [TOKENS-END] */')
const tail = src.slice(tokensEnd)
const tailHex = (tail.match(/#[0-9a-fA-F]{3,6}\b/g) || []).length
const tailRgb = (tail.match(/\brgba?\(/g) || []).length
check('组件区零字面色值（[TOKENS-END] 之后）', tailHex === 0 && tailRgb === 0, 'hex=' + tailHex + ' rgb=' + tailRgb)

/* 6. 主题数 = 4，且四套定义同一 token 集合 */
const themeNames = [...new Set([...src.matchAll(/\[data-theme="(\w+)"\]/g)].map(m => m[1]))]
check('主题数 ≥ 3（实际 4）', themeNames.length >= 3, themeNames.join(','))

const themeTokens = {}
for (const t of themeNames) {
  const blk = src.match(new RegExp('\\[data-theme="' + t + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}'))
  const set = blk ? [...blk[1].matchAll(/(--skin-[a-z0-9-]+):/g)].map(m => m[1]) : []
  themeTokens[t] = set
}
const baseSet = themeTokens[themeNames[0]] || []
const setMismatch = themeNames.filter(t => themeTokens[t].length !== baseSet.length)
check('四套主题 token 集合一致', setMismatch.length === 0 && baseSet.length > 0,
  'base=' + baseSet.length + ' 不一致=' + (setMismatch.join(',') || '无'))

/* 7. 每个 --skin-* 消费点都有定义 */
const defined = new Set();
for (const t of themeNames) themeTokens[t].forEach(k => defined.add(k))
const structural = [...src.matchAll(/(--skin-(?:radius|space|font|line-height|duration|ease|focus|locus|layout)[a-z0-9-]*)\s*:/g)].map(m => m[1])
structural.forEach(k => defined.add(k))
const used = [...new Set([...src.matchAll(/var\((--skin-[a-z0-9-]+)/g)].map(m => m[1]))]
const undef = used.filter(k => !defined.has(k) && !k.startsWith('--skin-ent-'))
check('所有 var(--skin-*) 消费点均有定义', undef.length === 0, '未定义=' + (undef.join(',') || '无') + ' 消费点=' + used.length)

/* 8. 接口对照：每个 data-inspect 都有 reg() 词条 */
const scriptSrc = scripts[0] || ''
const regKeys = new Set([...scriptSrc.matchAll(/reg\('([^']+)'/g)].map(m => m[1]))
const inspectKeys = [...new Set([...scriptSrc.matchAll(/'data-inspect':\s*'([^']+)'/g)].map(m => m[1]))]
const unregistered = inspectKeys.filter(k => !regKeys.has(k))
check('接口对照：data-inspect 全部有词条', unregistered.length === 0 && regKeys.size >= 15,
  'reg=' + regKeys.size + ' inspect=' + inspectKeys.length + ' 缺=' + (unregistered.join(',') || '无'))

/* 9. 企业覆盖钩子（--skin-ent-*）与皮肤契约一致 */
const entMs = src.match(/--skin-ent-[a-z0-9-]+/g) || []
const entFallback = (src.match(/var\(--skin-ent-[a-z0-9-]+,\s*[^)]+\)/g) || []).length
check('企业覆盖钩子 var(--skin-ent-*, 默认值)', entMs.length > 0 && entFallback === entMs.length,
  'hook 引用=' + entMs.length + ' 带兜底=' + entFallback)

/* 10. 运行时冒烟（最小 DOM 桩，跑完 boot()）*/
function mkEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), children: [], attrs: {}, style: { setProperty(k, v) { this[k] = v } },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, dataset: {},
    textContent: '', innerHTML: '', value: '', selected: false, disabled: false, title: '', min: '', max: '',
    setAttribute(k, v) { this.attrs[k] = String(v) }, getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null },
    removeAttribute(k) { delete this.attrs[k] }, appendChild(c) { this.children.push(c); return c }, addEventListener() {},
    querySelector() { return null }, querySelectorAll() { return [] }, closest() { return null }, remove() {}, focus() {}
  }
}
const byId = new Map(), selCache = new Map()
const documentStub = {
  createElement: mkEl, documentElement: mkEl('html'),
  getElementById(id) { if (!byId.has(id)) byId.set(id, mkEl('div')); return byId.get(id) },
  querySelector(s) {
    if (s[0] === '#') { const id = s.slice(1); if (!byId.has(id)) byId.set(id, mkEl('div')); return byId.get(id) }
    if (!selCache.has(s)) selCache.set(s, mkEl('div')); return selCache.get(s)
  },
  querySelectorAll() { return [] }, addEventListener() {}
}
let runtimeOk = true, runtimeErr = ''
try {
  const sb = { document: documentStub, window: {}, setTimeout: (f) => { try { f() } catch (e) {} return 0 }, clearTimeout() {}, console }
  vm.createContext(sb)
  new vm.Script(scriptSrc).runInContext(sb)
} catch (e) { runtimeOk = false; runtimeErr = e.message }
check('运行时冒烟 boot() 无抛错', runtimeOk, runtimeErr)

/* 11. 主题真的会变（解析 var(--skin-ent-*, 默认) 链，比较四套取值）*/
function resolveVar(name, theme) {
  const blk = src.match(new RegExp('\\[data-theme="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}'))
  if (!blk) return null
  const m = blk[1].match(new RegExp(name + ':\\s*var\\(--skin-ent-[a-z0-9-]+,\\s*([^)]+)\\);'))
  return m ? m[1].trim() : null
}
const probeTokens = ['--skin-color-brand', '--skin-color-bg', '--skin-color-text']
const distinct = probeTokens.map(t => new Set(themeNames.map(th => resolveVar(t, th))).size)
check('切主题时颜色值确实改变', distinct.every(n => n === themeNames.length),
  probeTokens.map((t, i) => t + '=' + distinct[i] + '种').join(' '))

/* 输出 */
let pass = 0, fail = 0
for (const r of results) { r.ok ? pass++ : fail++; console.log((r.ok ? '  PASS ' : '  FAIL ') + r.name + (r.detail ? '  [' + r.detail + ']' : '')) }
console.log('\n' + DEMO)
console.log('结果: ' + pass + ' PASS / ' + fail + ' FAIL   (demo ' + Buffer.byteLength(src, 'utf8') + ' B)')
process.exit(fail ? 1 : 0)
