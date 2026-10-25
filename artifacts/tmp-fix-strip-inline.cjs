/* 行内 type: 前缀剥离(真机实锤:账本格式「type:state 正文…」同行) */
const fs = require('fs')
const P = 'D:/dsh-auto-memory/lib/wb-sidecar.js'
let s = fs.readFileSync(P, 'utf8')
const once = (n, t) => { let c = 0, i = -1; for (let p = 0; (p = s.indexOf(n, p)) >= 0; p += 1) { c++; if (i < 0) i = p } if (c !== 1) throw new Error(t + ' hits=' + c); return i }

// 1) 升级剥离函数:行内前缀剥掉留正文,纯标记行整行删
{
  const a = "export function stripTypeMarkLinesPre(text) {\r\n  return String(text || '').split('\\n').filter((l) => !WB_TYPE_MARK_LINE_PRE.test(l)).join('\\n')\r\n}"
  const i = once(a, 'S1')
  const rep = [
    "export function stripTypeMarkLinesPre(text) {",
    "  // 行内前缀型(「type:state 正文…」)剥前缀留正文;纯标记行整行删。",
    "  const PREF = /^\\s*[-*]?\\s*type:\\s*(goal|state|dead-end|progress|archive)\\s+/i",
    "  return String(text || '').split('\\n')",
    "    .map((l) => l.replace(PREF, ''))",
    "    .filter((l) => !WB_TYPE_MARK_LINE_PRE.test(l))",
    "    .join('\\n')",
    "}",
  ].join('\r\n')
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// 2) 语义标题行同样剥前缀
{
  const a = "  return sem ? sem.slice(0, 60) : ''"
  const i = once(a, 'S2')
  const rep = "  const sem2 = sem ? sem.replace(/^\\s*[-*]?\\s*type:\\s*(goal|state|dead-end|progress|archive)\\s+/i, '') : ''\r\n  return sem2 ? sem2.slice(0, 60) : ''"
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
fs.writeFileSync(P, s, 'utf8')
const c = fs.readFileSync(P, 'utf8')
console.log('bytes:', Buffer.byteLength(c, 'utf8'), '| lone-LF:', (c.match(/(^|[^\r])\n/g) || []).length, '| PREF:', c.split('PREF').length - 1)
