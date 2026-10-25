/* 2026-09-28 皮肤选择窗口 拼接脚本（组件块从独立文件读入，避免转义地狱）
 * ① 在 SkinCenterPanel 定义前插入 SkinPicker 组件
 * ② 皮肤分区：选择器置顶 + 文案改「皮肤选择」
 * ③ API 表加 skinLibraryFetch 路由键
 * 纪律：备份；唯一锚点断言；CRLF 保持。 */
const fs = require('fs')
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')
const CB = 'D:/dsh-auto-memory/lib/client.js'
let s = fs.readFileSync(CB, 'utf8')
const b0 = Buffer.byteLength(s, 'utf8')
const h0 = require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/client.js.r46-' + b0 + '-' + h0 + '.js', s, 'utf8')
const once = (n, t) => { let c = 0, i = -1; for (let p = 0; (p = s.indexOf(n, p)) >= 0; p += 1) { c++; if (i < 0) i = p } if (c !== 1) throw new Error(t + ' hits=' + c + ': ' + n.slice(0, 70)); return i }

// ① SkinPicker 组件插入（在皮肤中心状态卡的注释前）
{
  const a = '    /** 皮肤中心状态卡：来源层 / 槽位就绪数 / 告警与错误（**可关闭提示**，12 卷 §3.3-1）。 */'
  const i = once(s, a, 'P1')
  const block = crlf(fs.readFileSync('D:/dsh-auto-memory/artifacts/tmp-skinpicker-block.js', 'utf8').replace(/\r?\n$/, ''))
  s = s.slice(0, i) + block + '\r\n' + s.slice(i)
}
// ② 分区：选择器置顶
{
  const a = crlf([
    "        section('skin', sectionLabels.skin, [",
    "          // ★S2 皮肤(2026-09-27):6 槽位**真实渲染为 <img>**,取图走宿主只读路由",
    "          // /api/dsh-auto-memory/skin-asset?key=<槽位>(loopback-only + 白名单)。",
  ].join('\n'))
  const i = once(s, a, 'P2')
  const rep = crlf([
    "        section('skin', sectionLabels.skin, [",
    "          // ★2026-09-28（用户第 1 大点）：本分区升格为「皮肤选择（皮肤中心）」——选择器置顶；",
    "          //   下方 6 槽位素材预览保留（那是「换图」子功能，不再是本分区的主语义）。",
    "          h(SkinPicker, { onSwitch: function () { try { setNonce(function (n) { return n + 1 }) } catch (ePick) {} } }),",
    "          h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: 'calc(11.5px * var(--dam-scale))', opacity: .72, margin: '10px 0 6px' } },",
    "            locale === 'zh' ? '素材槽位（换图子功能）' : 'Asset slots (image swapping)'),",
    "          // ★S2 皮肤(2026-09-27):6 槽位**真实渲染为 <img>**,取图走宿主只读路由",
    "          // /api/dsh-auto-memory/skin-asset?key=<槽位>(loopback-only + 白名单)。",
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// ③ API 表加路由键（宿主侧同步新增）
{
  const a = "      skinAsset: ROUTE_PREFIX + '/skin-asset',"
  const i = once(s, a, 'P3')
  s = s.slice(0, i + a.length) + crlf("\n      skinLibraryFetch: ROUTE_PREFIX + '/skin-library-fetch',") + s.slice(i + a.length)
}
fs.writeFileSync(CB, s, 'utf8')
console.log('client.js:', b0, '->', Buffer.byteLength(s, 'utf8'),
  '| lone-LF:', (s.match(/(^|[^\r])\n/g) || []).length,
  '| SkinPicker:', (s.match(/function SkinPicker/g) || []).length,
  '| skinLibraryFetch:', (s.match(/skinLibraryFetch/g) || []).length)
