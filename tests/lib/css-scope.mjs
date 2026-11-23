/**
 * EV4 CSS 作用域收口变换器（E1 收尾）
 *
 * 输入：原型变换后的 EV4_CSS 文本（已做 :root/html/body → .dam-ev4）
 * 输出：**所有规则的选择器都以 .dam-ev4 开头**，且 @keyframes 全部改名 ev4-*
 *
 * ## 为什么必须做
 * EV4_CSS 被 ensureStyle() 拼进**全局 style 标签**，不管 EventView 有没有渲染都生效。
 * 原型里 389 条规则是裸 class（.card / .panel / .badge / .col / .legend …）。
 * 一旦 E2/E5 给根节点加上 .dam-ev4，这些规则会**全部激活** ⇒ 污染本插件其它界面与宿主。
 * 现在「看起来没事」只是因为还没有 .dam-ev4 容器（命中不了）—— **是运气不是设计**。
 *
 * ## 关键实现约束（本轮实测踩到）
 * **不能用「按行解析」**：EV4_CSS 里有多条规则写在**同一行**（如
 *   `.dam-ev4{--line:#8a93a3;...}.dam-ev4[data-theme="dark"]{...}`），
 * 按行切会把前一条的 `}` 留在后一条的 prelude 里 ⇒ 前缀加不上去（实测 389 条裸选择器一条没变）。
 * ⇒ 必须**按字符流**解析：遇到 `{` 取其前面的 prelude，按 `}` 配平取 body。
 */

const SCOPE = '.dam-ev4'

/** 把一组选择器（逗号分隔）逐段加作用域前缀 */
function scopeSelectorList (selText) {
  return selText.split(',').map((one) => {
    const s = one.trim()
    if (!s) return ''
    if (s.startsWith(SCOPE)) return s
    return SCOPE + ' ' + s
  }).filter(Boolean).join(',')
}

/** 按字符流把 CSS 切成顶层节点 [{prelude, inner}] */
function parseTopLevel (css) {
  const nodes = []
  let i = 0
  let buf = ''
  while (i < css.length) {
    const c = css[i]
    if (c === '{') {
      const prelude = buf.trim()
      buf = ''
      i++
      // 配平读 inner
      // ★depth 必须从 **1** 起（已消费掉开头的 '{'）。从 0 起会让第一个 '}' 变成 -1，
      //   永远到不了 0 ⇒ 把整个后续文本吞成一个块（实测：选择器总数从 402 掉到 4）。
      let depth = 1
      const start = i
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') { depth--; if (depth === 0) break }
      }
      const inner = css.slice(start, i)
      i++ // 跳过 }
      if (prelude) nodes.push({ prelude, inner })
      continue
    }
    if (c === '}') { i++; buf = ''; continue } // 顶层多余闭括号，丢弃
    buf += c
    i++
  }
  return nodes
}

const KEYFRAMES = /^@(?:-webkit-)?keyframes\s+/i
const AT_RECURSE = /^@(?:media|supports|layer|container|scope|document)\b/i

/**
 * 递归作用域化
 * @param {string} cssText
 * @param {Map<string,string>} kfMap keyframes 原名 → 新名（用于后续 renameAnimationRefs）
 */
export function scopeCss (cssText, kfMap) {
  const out = []
  // ★必须先剥块注释：注释会粘进下一条规则的 prelude（如 `/* card-in */ @keyframes card-in{...}`），
  //   导致 @keyframes / 选择器前缀判断失配 —— 实测 card-in 就是这样漏改名的。
  const clean = String(cssText).replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const node of parseTopLevel(clean)) {
    const prelude = node.prelude.trim()
    if (!prelude) continue

    if (KEYFRAMES.test(prelude)) {
      const oldName = prelude.replace(KEYFRAMES, '').trim()
      const newName = 'ev4-' + oldName
      if (kfMap) kfMap.set(oldName, newName)
      // keyframes 内部的 from/to/百分比**不加作用域**（它们不是选择器）
      out.push('@keyframes ' + newName + '{' + node.inner + '}')
      continue
    }
    if (AT_RECURSE.test(prelude)) {
      out.push(prelude + '{' + scopeCss(node.inner, kfMap) + '}')
      continue
    }
    out.push(scopeSelectorList(prelude) + '{' + node.inner + '}')
  }
  return out.join('\n')
}

/** 同步改 animation / animation-name 里的 keyframes 引用 */
export function renameAnimationRefs (cssText, kfMap) {
  let out = cssText
  for (const [oldName, newName] of kfMap) {
    const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(
      new RegExp('(animation(?:-name)?\\s*:[^;}]*)(' + esc + ')(?![\\w-])', 'g'),
      (_m, prefix, name) => prefix + newName
    )
  }
  return out
}

/** 统计：返回 { total, scoped, bare[] } */
export function countSelectors (cssText) {
  const sels = []
  const push = (selText) => {
    for (const one of selText.split(',')) { const s = one.trim(); if (s) sels.push(s) }
  }
  // 跳过 @keyframes 内部（from/to/%）
  const walk = (css) => {
    for (const node of parseTopLevel(css)) {
      const p = node.prelude.trim()
      if (KEYFRAMES.test(p)) continue
      if (AT_RECURSE.test(p)) { walk(node.inner); continue }
      push(p)
    }
  }
  walk(cssText)
  const bare = sels.filter((s) => !s.startsWith(SCOPE))
  return { total: sels.length, scoped: sels.length - bare.length, bare }
}
