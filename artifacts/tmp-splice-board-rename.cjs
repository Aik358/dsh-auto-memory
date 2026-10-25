/* 2026-09-28 白板读感三修 + 皮肤改名「新款→开发版」
 * ① wb-sidecar.js:preview 剔 type:* 标记行(展示层;泳道路由仍消费原文 tags,口径零改动)
 *   + 纯时间戳标题取正文首行语义化(id/section/归并主键不变)
 * ② client.js:KanbanMatrixCard 加来源徽章(白板/账本/归档,c.kind 现成字段此前未渲染)
 * ③ client.js:「新款」→「开发版」(入口按钮/头部/err 行/placeholder)
 * 纪律:改前备份;锚点唯一性断言;CRLF 保持;改后计数验证。 */
const fs = require('fs')
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

// ── A. wb-sidecar.js ──
const SB = 'D:/dsh-auto-memory/lib/wb-sidecar.js'
let sb = fs.readFileSync(SB, 'utf8')
const bytesSb0 = Buffer.byteLength(sb, 'utf8')
const hashSb0 = require('crypto').createHash('sha256').update(sb).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/wb-sidecar.js.r43-' + bytesSb0 + '-' + hashSb0 + '.js', sb, 'utf8')

const once = (s, needle, tag) => {
  const i = s.indexOf(needle)
  if (i < 0) throw new Error(tag + ': anchor missing: ' + needle.slice(0, 60))
  if (s.indexOf(needle, i + 1) >= 0) throw new Error(tag + ': anchor not unique: ' + needle.slice(0, 60))
  return i
}

// A1. 语义标题/标记剔除 helper(插在 buildSectionCardsPre 定义前)
{
  const a = 'export function buildSectionCardsPre(workspaceKey, docs, opts = {}) {'
  const i = once(sb, a, 'A1')
  const helper = crlf([
    '// ★2026-09-28 白板读感修复(用户实测「读得有问题」):①预览不再裸显 type:* 机器标记行——',
    '//   标记按 lib/index.js:918 约定由模型写入标题/正文供落泳道;泳道路由(tags 抽取)照常消费**原文**,',
    '//   仅在 preview/语义标题的**展示层**剔除,匹配口径零改动。②纯时间戳标题(如「交接账本 · 2026-09-26 07:31」)',
    '//   取本节正文首个非标记非标题行作语义标题(id/section 仍用原小节标题 ⇒ 主键与归并口径不变)。',
    'const WB_TYPE_MARK_LINE_PRE = /^\\s*[-*]?\\s*type:\\s*(goal|state|dead-end|progress|archive)\\s*$/i',
    'export function stripTypeMarkLinesPre(text) {',
    "  return String(text || '').split('\\n').filter((l) => !WB_TYPE_MARK_LINE_PRE.test(l)).join('\\n')",
    '}',
    'export function sectionSemanticTitlePre(secTitle, docTitle, body) {',
    "  const core = (t) => String(t || '').replace(/20\\d{2}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?/g, '').replace(/\\d{1,2}:\\d{2}/g, '').replace(/[·—–\\-_:：\\s]+/g, '')",
    "  const hasDate = /20\\d{2}[-/.]\\d{1,2}[-/.]/.test(String(secTitle || ''))",
    "  if (!hasDate) return ''",
    '  const c1 = core(secTitle)',
    "  if (c1.length > 6) return ''",
    "  if (c1.length && docTitle && core(docTitle).indexOf(c1) < 0 && c1.indexOf(core(docTitle)) < 0) return ''",
    "  const lines = String(body || '').split('\\n').map((l) => l.trim())",
    "  const sem = lines.find((l) => l && !WB_TYPE_MARK_LINE_PRE.test(l) && !/^#{1,6}\\s/.test(l) && !/^\\|/.test(l))",
    "  return sem ? sem.slice(0, 60) : ''",
    '}',
    '',
  ].join('\n'))
  sb = sb.slice(0, i) + helper + sb.slice(i)
}

// A2. 循环体内算语义标题(插在 secText 行后)
{
  const a = "        const secText = s.body || ''"
  const i = once(sb, a, 'A2')
  sb = sb.slice(0, i + a.length) + crlf("\n        const semTitle = sectionSemanticTitlePre(secTitle, docTitle, secText)") + sb.slice(i + a.length)
}

// A3. title 用语义标题(显示层;id/section 不动)
{
  const a = '          title: secTitle.slice(0, 120),'
  const i = once(sb, a, 'A3')
  sb = sb.slice(0, i) + crlf('          title: (semTitle || secTitle).slice(0, 120),') + sb.slice(i + a.length)
}

// A4. preview 剔标记行
{
  const a = "          preview: secText.replace(/\\s+/g, ' ').trim().slice(0, 400),"
  const i = once(sb, a, 'A4')
  sb = sb.slice(0, i) + crlf("          preview: stripTypeMarkLinesPre(secText).replace(/\\s+/g, ' ').trim().slice(0, 400),") + sb.slice(i + a.length)
}
fs.writeFileSync(SB, sb, 'utf8')
console.log('A. wb-sidecar.js:', bytesSb0, '->', Buffer.byteLength(sb, 'utf8'), 'B')

// ── B. client.js ──
const CB = 'D:/dsh-auto-memory/lib/client.js'
let cb = fs.readFileSync(CB, 'utf8')
const bytesCb0 = Buffer.byteLength(cb, 'utf8')
const hashCb0 = require('crypto').createHash('sha256').update(cb).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/client.js.r43-' + bytesCb0 + '-' + hashCb0 + '.js', cb, 'utf8')

// B1. 来源徽章(矩阵卡;锚点唯一性动态校验)
{
  const a = "          kxBadge(c.criteria, zh),"
  let n = 0, i = -1
  for (let p = 0; (p = cb.indexOf(a, p)) >= 0; p += 1) { n++; if (i < 0) i = p }
  if (n !== 1) throw new Error('B1: kxBadge(c.criteria) hits=' + n + ' — 需换更长锚点')
  const badge = crlf([
    "          h('span', { key: 'src',",
    "            title: zh ? (c.kind === 'plan' ? '来自白板 PLAN' : c.kind === 'archive' ? '来自归档' : '来自交接账本') : (c.kind === 'plan' ? 'from PLAN' : c.kind === 'archive' ? 'from archive' : 'from ledger'),",
    "            style: { flexShrink: 0, fontSize: '10px', padding: '0 5px', borderRadius: '3px', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))', color: 'var(--dsw-alias-label-secondary)' } },",
    "            c.kind === 'plan' ? (zh ? '白板' : 'PLAN') : c.kind === 'archive' ? (zh ? '归档' : 'ARC') : (zh ? '账本' : 'LEDGER')),",
  ].join('\n'))
  cb = cb.slice(0, i + a.length) + '\r\n' + badge + cb.slice(i + a.length)
}

// B2. 改名(逐处唯一断言)
const renames = [
  ["'切换皮肤(经典 / 新款)'", "'切换皮肤(经典 / 开发版)'"],
  ["damSkinActive() === 'v4' ? '经典' : '新款'", "damSkinActive() === 'v4' ? '经典' : '开发版'"],
  ["'新款皮肤 · 批次2 逐屏对齐参考图'", "'开发版皮肤 · 对齐参考图'"],
  ["'v4 skin · screens land in batch 2'", "'dev skin · aligned to reference'"],
  ["'搜索…(批次2 接线)'", "'搜索…'"],
  ["'新款皮肤渲染失败,已回落经典'", "'开发版皮肤渲染失败,已回落经典'"],
]
for (const [from, to] of renames) {
  const i = once(cb, from, 'B2 ' + from.slice(0, 24))
  cb = cb.slice(0, i) + to + cb.slice(i + from.length)
}
fs.writeFileSync(CB, cb, 'utf8')
console.log('B. client.js:', bytesCb0, '->', Buffer.byteLength(cb, 'utf8'))

// ── 验证 ──
for (const [p, name] of [[SB, 'wb-sidecar'], [CB, 'client']]) {
  const chk = fs.readFileSync(p, 'utf8')
  const loneLF = (chk.match(/(^|[^\r])\n/g) || []).length
  console.log(name, 'lone-LF:', loneLF,
    '| stripTypeMark:', chk.split('stripTypeMarkLinesPre').length - 1,
    '| semTitle:', chk.split('sectionSemanticTitlePre').length - 1,
    '| 新款残留:', chk.split('新款').length - 1,
    '| 开发版:', chk.split('开发版').length - 1,
    '| 来源徽章:', chk.split("key: 'src'").length - 1)
}
