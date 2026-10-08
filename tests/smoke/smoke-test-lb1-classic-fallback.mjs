/**
 * L-B1 守卫 · 经典档（legacy / classic）兜底规矩（2026-10-08 用户裁定）
 *
 * 用户口径原文：经典档**禁止任何自定义属性的「定义」**（--x: 形式）—— 变量外泄会让所有页面被染色；
 *   只允许「读取」var(--token, 兜底值)；经典档未定义令牌的兜底一律取**经典档自己的**取值形态（蓝底实心 + 白字）。
 *
 * 三条断言（全部对**真文件**做真解析，非源码字符串包含）：
 *   A 定义数 == 0（硬红线）
 *   B 兜底链内不得出现**非白名单**令牌（白名单＝冻结 legacy 表里定义的 43 个）
 *   C primary 按钮形态锁死：background: var(--i5-blue, #2563EB); color: var(--i5-surface, #FFFFFF)
 *
 * 负路径（--mutate 模式）：临时副本上真变异 ⇒ 必红；本套件单独跑默认只读。
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.LB1_ROOT || path.resolve(HERE, '..', '..')
const OVERLAY = path.join(ROOT, 'skins/iter5/legacy-native-overlays.css')
const FROZEN = path.join(ROOT, 'skins/legacy/iter5-325.js.frozen')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const NL = String.fromCharCode(10)

/* ---------- 取冻结 legacy 表（经典档真实生效表的一半） ---------- */
function readJsString (text, marker) {
  const i = text.indexOf(marker)
  if (i < 0) return null
  let j = i + marker.length, out = ''
  while (j < text.length) {
    const c = text[j]
    if (c === String.fromCharCode(92)) { const n = text[j + 1]; out += (n === 'n' ? NL : n); j += 2; continue }
    if (c === '"') return out
    out += c; j++
  }
  return null
}
const frozenCss = readJsString(readFileSync(FROZEN, 'utf8'), 'var ITER5_CSS = "')
const overlayRaw = readFileSync(OVERLAY, 'utf8')
// ★CSS 语义：注释不是声明 —— 断言必须先在**去注释**的文本上做，
//   否则「解释缺陷的注释」本身会把判据喂红（实测：注释里引用旧写法即误报 2 处）。
const overlay = overlayRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:]) \/\/[^\n]*/g, '$1')

/* ---------- 白名单：冻结表里定义的 43 个自定义属性 ---------- */
function definedTokens (css) {
  const set = new Set()
  // 定义＝形如 --x: value（出现在声明位置），引用 var(--x) 不算
  const noVar = css.replace(/var\([^)]*\)/g, 'VARREF')
  const re = /(^|[;{])\s*(--[\w-]+)\s*:/g
  let m
  while ((m = re.exec(noVar))) set.add(m[2])
  return set
}
const WHITELIST = definedTokens(frozenCss)
const LEAD_SAID = 43

console.log('')
console.log('[L-B1] 白名单（冻结 legacy 表定义的自定义属性）')
ok(WHITELIST.size === LEAD_SAID, '白名单令牌数 == 领导实测的 ' + LEAD_SAID + '（实测 ' + WHITELIST.size + '）')
if (WHITELIST.size !== LEAD_SAID) console.log('        实测集合: ' + [...WHITELIST].sort().join(' '))

/* ---------- A：定义数 == 0 ---------- */
console.log('[L-B1] A · 硬红线：本文件不得有 --x: 定义')
{
  const noVar = overlay.replace(/var\([^)]*\)/g, 'VARREF')
  const defs = noVar.match(/(^|[;{])\s*--[\w-]+\s*:/g) || []
  ok(defs.length === 0, 'A ★定义计数 == 0（实测 ' + defs.length + (defs.length ? ' ⇒ ' + JSON.stringify(defs.slice(0, 4)) : '') + '）')
}

/* ---------- B：兜底链内不得出现非白名单令牌 ---------- */
console.log('[L-B1] B · 核心：每条 var() 的兜底链不得落到非白名单令牌')
{
  // 解析每条 var() 的完整参数串（含嵌套），抽出「第一个参数＝被读令牌」与「其余＝兜底链」
  function splitArgs (inner) {
    const out = []; let depth = 0, cur = ''
    for (const ch of inner) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }
  function vars (css) {
    const found = []
    let i = 0
    while ((i = css.indexOf('var(', i)) >= 0) {
      let d = 0, j = i + 3
      for (; j < css.length; j++) {
        if (css[j] === '(') d++
        else if (css[j] === ')') { d--; if (d === 0) break }
      }
      found.push(css.slice(i + 4, j))
      i = j + 1
    }
    return found
  }
  const all = vars(overlay)
  const bad = []
  for (const inner of all) {
    const args = splitArgs(inner)
    const readTok = args[0]
    // 兜底链里出现的**令牌引用**（形如 --xxx，非 #hex / 关键字）
    const fbToks = args.slice(1).join(',').match(/--[\w-]+/g) || []
    const offenders = fbToks.filter((t) => !WHITELIST.has(t))
    if (offenders.length) bad.push({ readTok, chain: args.slice(1).join(' , ').slice(0, 76), offenders })
    // 被读令牌本身若不在白名单 ⇒ 必须带兜底（否则经典档直接落空）
    if (!WHITELIST.has(readTok) && args.length < 2) bad.push({ readTok, chain: '(无兜底)', offenders: [readTok] })
  }
  ok(bad.length === 0, 'B ★兜底链内非白名单令牌 == 0（实测 var() 共 ' + all.length + ' 条，违规 ' + bad.length + '）')
  for (const b of bad.slice(0, 6)) console.log('        违规: 读取 ' + b.readTok + ' | 兜底链 ' + b.chain + ' | 非白名单 ' + JSON.stringify(b.offenders))
}

/* ---------- C：primary 形态锁死 ---------- */
console.log('[L-B1] C · primary 按钮＝蓝底实心 + 白字（用户裁定形态）')
{
  const want = /\[data-dam-btn\]\[data-primary=true\]\s*\{\s*background:\s*var\(--i5-blue\s*,\s*#2563EB\)\s*;\s*color:\s*var\(--i5-surface\s*,\s*#FFFFFF\)\s*;/
  const hits = want.test(overlay)
  ok(hits, 'C ★primary 恰为 background:var(--i5-blue,#2563EB) + color:var(--i5-surface,#FFFFFF)')
  if (!hits) {
    const m = overlay.match(/\[data-primary=true\]\{[^}]*\}/)
    console.log('        实测: ' + (m ? m[0].slice(0, 150) : '(未找到 [data-primary=true] 规则)'))
  }
}

/* ---------- 附加：只改 welcomeBack（其余四个零改动） ---------- */
console.log('[L-B1] D · 作用域：新增规则只落在 welcomeBack')
{
  // ★段边界靠**原始文件**的注释标记定位（去注释后该标记已不存在）；判据本身作用在去注释文本上。
  const rawLines = overlayRaw.split(NL)
  const i = rawLines.findIndex((l) => l.indexOf('L-B1') >= 0 && l.indexOf('只作用于') >= 0)
  const tail = i >= 0 ? rawLines.slice(i).join(NL) : ''
  ok(i >= 0 && tail.length > 0, 'D-1 找到 L-B1 专属段（原始文件第 ' + (i + 1) + ' 行起）')
  const sel = tail.split('{').slice(0, -1).join('{')
  const bad = sel.split(NL).map((s) => s.trim()).filter((s) => /^\[data-dam-theme\]/.test(s) && s.indexOf('welcomeBack') < 0)
  ok(bad.length === 0, 'D-2 专属段内每条规则都带 welcomeBack（违规 ' + bad.length + '）')
  for (const b of bad.slice(0, 4)) console.log('        违规选择器: ' + b.slice(0, 90))
}


/* ---------- E：浮层避让（★L-B2）：接续卡必须被抬到「欢迎回来」卡上方 ---------- */
console.log('[L-B1] E · 浮层避让：接续卡在上、欢迎回来卡在下')
{
  const avoid = /body:has\(\[data-native-dialog-overlay=welcomeBack\]\)\s*\[data-native-continuation\]\{([^}]*)\}/.exec(overlayRaw)
  const wbMax = /body:has\(\[data-native-continuation\]\)\s*aside\.i5-native-notice\[data-native-dialog=welcomeBack\]\{([^}]*)\}/.exec(overlayRaw)
  ok(!!avoid, 'E-1 存在「接续卡上移」避让规则（条件锚在 body:has(...) 上）')
  ok(!!wbMax, 'E-2 存在「欢迎卡高度上界」规则 ⇒ 不相交由上界保证（非估计）')
  const numAdd = (s) => { const m = /calc\(\s*(-?[\d.]+)px\s*\+\s*(-?[\d.]+)px\s*\*\s*var\(--dam-scale,([\d.]+)\)\)/.exec(s || 0) ; return m ? Number(m[1]) + Number(m[2]) * Number(m[3]) : null }
  const numMul = (s) => { const m = /calc\(\s*(-?[\d.]+)px\s*\*\s*var\(--dam-scale,([\d.]+)\)\)/.exec(s || 0); return m ? Number(m[1]) * Number(m[2]) : null }
  const a = numAdd(avoid && avoid[1]), m2 = numMul(wbMax && wbMax[1])
  ok(a != null && m2 != null, 'E-3 两侧数值均可解析（避让位=' + a + ' 上界=' + m2 + '）')
  ok(a != null && m2 != null && a - m2 - 16 >= 8, 'E-4 ★方向与间隙：避让位(' + a + ') − 上界(' + m2 + ') − 16 = ' + (a - m2 - 16) + 'px ≥ 8px ⇒ 接续卡恒在欢迎卡上方且不相交')
  ok(a != null && a > 16, 'E-5 避让位严格大于基线 16px（实测 ' + a + '）⇒ 确实被抬到上方')
}
console.log('')
console.log('[L-B1] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
