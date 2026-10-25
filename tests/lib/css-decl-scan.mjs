/**
 * CSS 声明级扫描器（v4 E1 引入）
 *
 * ## 为什么必须「按声明」而不是「按文本正则」
 * r15 的 ㊵/㊶ 守卫要求「非默认档零裸色值」。判断一个色值是「token 定义」还是「裸用」，
 * 唯一正确的口径是看它所在的**声明**首字符是不是 `--`：
 *   `--bg:#f4f6f9;`      ⇒ token 定义（色值集中管理，正是守卫生效的形态）
 *   `background:#fff;`   ⇒ 裸用（色值散落在选择器里，这才是要拦的）
 *
 * 文本正则会犯两类错（本轮实测踩到）：
 *   ① 块内注释粘到紧随其后的第一条声明：`/* 层叠阴影 *\/\n  --sh1:0 1px rgba(...)`
 *      ⇒ 整条以 `/*` 开头 ⇒ 判成裸用 ⇒ **多算 6 个 rgba**
 *   ② `@media` 嵌套块不按深度切分 ⇒ 整段 `@media` 体被当成一条声明
 *
 * ## 用法
 *   import { scanDeclarations } from '../lib/css-decl-scan.mjs'
 *   const decls = scanDeclarations(cssText)   // [{ prop, value, isToken, raw }]
 */

/** 剥掉块注释（保留字符串内的 /* 不可能出现，CSS 无需处理） */
export function stripComments (css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * 递归切块，取**每一层**的直接声明（带深度计，@media / @supports 内也能正确取到）。
 * 返回 [{ prop, value, isToken, raw }]
 */
export function scanDeclarations (cssText) {
  const css = stripComments(cssText)
  const out = []

  // 从 i 开始（已是 { 之后），返回 [块结束位置, 该块直接声明列表]
  function parseBlock (start) {
    const decls = []
    let buf = ''
    let i = start
    let depth = 0
    for (; i < css.length; i++) {
      const c = css[i]
      if (c === '{') {
        // 进入嵌套块：buf 是选择器（at-rule 头也算），先丢弃
        depth++
        const [end, nested] = parseBlock(i + 1)
        // 嵌套块内部的声明不归属本层，但仍要递归收集（颜色值在 @media 内也生效）
        out.push(...nested)
        i = end
        buf = ''
        continue
      }
      if (c === '}') {
        if (depth === 0) {
          const d = buf.trim()
          if (d) decls.push(d)
          return [i, decls]
        }
        depth--
        continue
      }
      if (c === ';' && depth === 0) {
        const d = buf.trim()
        if (d) decls.push(d)
        buf = ''
        continue
      }
      if (depth === 0) buf += c
    }
    const d = buf.trim()
    if (d) decls.push(d)
    return [i, decls]
  }

  // 顶层：逐个块解析
  let i = 0
  let prelude = ''
  while (i < css.length) {
    const c = css[i]
    if (c === '{') {
      const [end, nested] = parseBlock(i + 1)
      out.push(...nested)
      i = end + 1
      prelude = ''
      continue
    }
    prelude += c
    i++
  }

  const result = []
  for (const raw of out) {
    const m = raw.match(/^([^:]+):([\s\S]*)$/)
    if (!m) continue
    const prop = m[1].trim()
    const value = m[2].trim()
    result.push({ prop, value, isToken: /^--[\w-]+$/.test(prop), raw })
  }
  return result
}

/** 统计色值：hex / rgb(a)，区分 token 定义与裸用 */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
const RGB_RE = /rgba?\(/g

export function countColors (decls) {
  const r = {
    hex: 0, rgba: 0,          // 全量
    tokenHex: 0, tokenRgba: 0,
    bareHex: 0, bareRgba: 0,
    tokenDeclCount: 0,
    bareDecls: [],
  }
  for (const d of decls) {
    const h = (d.value.match(HEX_RE) || []).length
    const g = (d.value.match(RGB_RE) || []).length
    r.hex += h
    r.rgba += g
    if (d.isToken) {
      r.tokenDeclCount++
      r.tokenHex += h
      r.tokenRgba += g
    } else {
      r.bareHex += h
      r.bareRgba += g
      if (h || g) r.bareDecls.push(d)
    }
  }
  return r
}
