/**
 * celebration-art.js —— 「记忆整理完成」庆祝用立体字（纯常量 + 纯函数，零依赖）。
 *
 * ★用户裁定（2026-10-25 第八轮，逐字）：
 *   「首先这个 welcome 画得不好…**还是就画一个 complete，然后其他就文字吧**」
 *
 * ★v2 相对 v1 的改动（用户否定了 v1）：
 *   v1: 中文 3 行投影 + 英文 4 行块字 + 多层阴影 → 用户说「画得不好」
 *   v2: **只保留一个立体词**（COMPLETE），其余全部普通文字
 *   ★为什么 v1 难看：阴影用 ▓░ 叠在字形右侧/下方 ⇒ 视觉上「糊成一片」，字反而看不清。
 *     「立体」不等于「堆阴影」，加错阴影会毁掉可读性。
 *
 * ★零依赖、零 IO、纯常量。
 */

/** 5×7 点阵（只收大写字母 + 空格） */
const GLYPHS = Object.freeze({
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ####', '#    ', '#    ', '#  ##', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['#####', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
})

/**
 * 单个词的立体字：实心 █ + 一行底边（不做多色阴影 —— 用户裁定 v1 的阴影毁可读性）。
 * @param {string} text 只支持 A–Z 与空格
 * @returns {string[]}
 */
export function word3dPre(text) {
  const t = String(text == null ? '' : text).toUpperCase()
  const pitch = 6 // 5 字形 + 1 间距
  const C = Math.max(1, t.length) * pitch
  const R = 8
  const grid = Array.from({ length: R }, () => new Array(C).fill(' '))
  for (let i = 0; i < t.length; i++) {
    const g = GLYPHS[t[i]] || GLYPHS[' ']
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] === '#') grid[r][i * pitch + c] = '\u2588'
    }
  }
  // 第 8 行：底边投影（单色 ▄，只给非空列加）
  for (let c = 0; c < C; c++) {
    let has = false
    for (let r = 0; r < 7; r++) if (grid[r][c] === '\u2588') { has = true; break }
    if (has) grid[7][c] = '\u2584'
  }
  return grid.map((row) => row.join('').replace(/\s+$/, ''))
}

/** 庆祝文案（用户裁定：一个立体词 + 其余普通文字） */
export const CELEBRATION_WORD = 'COMPLETE'

/**
 * 生成完整庆祝文本。
 * @returns {string}
 */
export function renderCelebrationArtPre() {
  const out = []
  out.push('\u2500\u2500 WELCOME \u2500\u2500')
  out.push('')
  for (const row of word3dPre(CELEBRATION_WORD)) out.push(row)
  out.push('')
  out.push('\u6b22\u8fce\u6765\u5230\u9762\u5411\u6301\u7eed\u4eba\u673a\u4ea4\u4e92\u7684')
  out.push('\u60c5\u666f\u5316\u4e3b\u52a8\u8bb0\u5fc6\u65f6\u4ee3')
  out.push('')
  out.push('\u2014\u2014 \u4f60\u7684\u8bb0\u5fc6\u5df2\u4ece\u6d41\u6c34\u8d26\u5347\u7ea7\u4e3a\u4e8b\u4ef6\uff0c\u5e76\u5df2\u5f52\u4f4d\u5230\u4eba\u4e4b\u4e0a\u7684\u5c42\u3002')
  return out.join('\n')
}

/**
 * 其他语言（俄文/日文等）的**现画约定** —— 用户裁定「让 AI 按照他们的文字来画」。
 */
export const CELEBRATION_OTHER_LANG_GUIDE = [
  '\u82e5\u7528\u6237\u8bb0\u5fc6\u7684\u4e3b\u8981\u8bed\u8a00\u4e0d\u662f\u4e2d\u6587/\u82f1\u6587\uff0c\u8bf7\u6309\u4ee5\u4e0b\u7ea6\u5b9a\u73b0\u753b\uff08\u4e0d\u8981\u7ffb\u8bd1\u6210\u82f1\u6587\uff09\uff1a',
  '1. \u7528\u5b9e\u5fc3 \u2588\uff08U+2588\uff09\u62fc\u51fa\u76ee\u6807\u6587\u5b57\uff0c\u5b57\u5f62\u4fdd\u7559\u4e0d\u70b9\u9635\u5316\uff1b',
  '2. \u5e95\u90e8\u52a0\u4e00\u884c \u2584\uff08U+2584\uff09\u4f5c\u6295\u5f71\uff1b\u4e0d\u8981\u5806\u591a\u5c42\u9634\u5f71\uff08\u4f1a\u6bc1\u53ef\u8bfb\u6027\uff09\uff1b',
  '3. \u603b\u5bbd\u63a7\u5236\u5728 60 \u663e\u793a\u5217\u4ee5\u5185\u3002',
].join('\n')

export default { word3dPre, renderCelebrationArtPre, CELEBRATION_WORD, CELEBRATION_OTHER_LANG_GUIDE }
