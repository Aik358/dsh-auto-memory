/**
 * L3.5 验收(2026-09-17) —— 「旧会话附件路径进转写/接续材料」的行为断言。
 *
 * 权威依据: docs/internal/BATTLE-PLAN-20260917.md §2 L3.5
 *
 * 为什么必须单独存在:
 *   DSH 附件是**内容寻址 blob**(非 base64 内嵌), 会话日志里存的是结构化 part
 *   `{type:'image'|'file', attachment:{attachmentId:'sha256:<hex>', ...}}`。
 *   旧实现 `foldSessionLogEvents` 里 `textOfContent(m.content)` **只取文本** ⇒ 附件字段
 *   在**源头就被丢弃**, 转写里完全没有"用户投过这张图/这个文件"的痕迹,
 *   接续会话于是根本不知道有这些材料可读 ⇒ 表现为"上一轮我给的东西新会话看不见"。
 *
 * 修法(用户批准的方案 A):
 *   ① foldSessionLogEvents 在源头带上 attachments 描述符;
 *   ② 转写文件里写明 blob 绝对路径(内容寻址 objects/<前2位>/<hex>);
 *   ③ 接续材料: 附件**清单**进 bulk(可截断的身体层), "去哪儿取"的**指令**进 nav(永不截断)。
 *
 * ★ 断言形态: 直接驱动真函数(均从 index.js 导出) + 源码守卫。
 */
import { foldSessionLogEvents, attachmentsOfContent, attachmentBlobPathsPre, renderAttachmentLinesPre, slimTranscriptPre } from '../../lib/index.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

console.log('=== L3.5 附件路径: 源头保留 + 转写落路径 + 接续带清单 ===')

const HOME = 'C:\\Users\\Tester\\.dsh'
const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678deadbeef00112233445566aa'
const imgPart = { type: 'image', attachment: { attachmentId: 'sha256:' + HASH, mediaType: 'image/png', width: 800, height: 600, bytes: 20480, name: 'shot.png' } }
const filePart = { type: 'file', attachment: { attachmentId: 'sha256:' + HASH.slice(0, 40), mediaType: 'application/pdf', bytes: 133120, name: '问卷.pdf' } }

// ─────────────────────────────────────────────────────────────
// L3.5-1 ★ 核心: 附件描述符从 content 里抽得出来(旧实现只取 text ⇒ 全丢)
// ─────────────────────────────────────────────────────────────
t('L3.5-1 ★ attachmentsOfContent 能从结构化 part 抽出图片附件(旧实现只取 text ⇒ 全丢)', () => {
  const atts = attachmentsOfContent([{ type: 'text', text: '看这张图' }, imgPart])
  assert(atts.length === 1, '应抽出 1 个附件, 实为 ' + atts.length)
  assert(atts[0].kind === 'image', 'kind 应为 image')
  assert(atts[0].id === HASH, 'sha256: 前缀应被剥离, 实为 ' + atts[0].id)
  assert(atts[0].ref === 'sha256:' + HASH, 'ref 应保留原始 attachmentId')
  assert(atts[0].bytes === 20480 && atts[0].width === 800 && atts[0].height === 600, '元数据应带全')
})

t('L3.5-2 attachmentsOfContent 处理文件类附件 + 同一 blob 去重', () => {
  const atts = attachmentsOfContent([filePart, filePart, { type: 'text', text: 'x' }])
  assert(atts.length === 1, '同 kind+id+name 应去重, 实为 ' + atts.length)
  assert(atts[0].kind === 'file', 'kind 应为 file')
  assert(atts[0].name === '问卷.pdf', 'name 应保留(中文文件名)')
})

t('L3.5-3 无附件/畸形输入 ⇒ 空数组, 绝不抛错', () => {
  assert(attachmentsOfContent([{ type: 'text', text: 'hi' }]).length === 0, '纯文本应无附件')
  assert(attachmentsOfContent(null).length === 0, 'null 应安全')
  assert(attachmentsOfContent([{ type: 'image' }]).length === 0, '无 attachment 字段应跳过')
  assert(attachmentsOfContent([{ type: 'image', attachment: { attachmentId: '' } }]).length === 0, '空 id 应跳过')
})

// ─────────────────────────────────────────────────────────────
// L3.5-4 ★ blob 路径推导 —— 官方落盘规则逐字复现
//   图片 :290  join(root,'objects', sha256.slice(0,2), sha256)
//   文件 :661  join(root,'files',  sha256.slice(0,2), sha256, ref.name)
// ─────────────────────────────────────────────────────────────
t('L3.5-4 ★ 图片走 objects/<前2位>/<hex>, 文件走 files/<前2位>/<hex>/<name>(官方两条规则)', () => {
  const pi = attachmentBlobPathsPre({ kind: 'image', id: HASH, name: 'shot.png' }, HOME)
  assert(pi.objectPath.endsWith('attachments\\v1\\objects\\a1\\' + HASH) || pi.objectPath.endsWith('attachments/v1/objects/a1/' + HASH),
    '图片对象路径应为 objects/a1/<hex>, 实为 ' + pi.objectPath)
  assert(pi.filePath === '', '图片不该给 files/ 路径')

  const fid = HASH.slice(0, 40)
  const pf = attachmentBlobPathsPre({ kind: 'file', id: fid, name: '问卷.pdf' }, HOME)
  assert(pf.filePath.indexOf('files') >= 0 && pf.filePath.endsWith('问卷.pdf'), '文件路径应以文件名结尾, 实为 ' + pf.filePath)
  assert(pf.objectPath.indexOf('objects') >= 0, '文件也应有 objects 候选路径')
})

t('L3.5-5 路径推导 fail-soft: 非法 id / 空输入 ⇒ 双空串, 绝不抛', () => {
  const a = attachmentBlobPathsPre({ id: 'not-a-hash!!' }, HOME)
  assert(a.objectPath === '' && a.filePath === '', '非法 hex 应返回双空')
  const b = attachmentBlobPathsPre(null, HOME)
  assert(b.objectPath === '' && b.filePath === '', 'null 应返回双空')
  const c = attachmentBlobPathsPre({ kind: 'file', id: HASH.slice(0, 40), name: '' }, HOME)
  assert(c.filePath === '', '文件缺 name 时不该编造 files 路径')
})

// ─────────────────────────────────────────────────────────────
// L3.5-6 ★ 核心: foldSessionLogEvents 在源头带上 attachments(旧实现在这里丢的)
// ─────────────────────────────────────────────────────────────
const J = (o) => JSON.stringify(o)
t('L3.5-6 ★ foldSessionLogEvents 的 user/message 带 attachments(旧实现只 push {role,text})', () => {
  const folded = foldSessionLogEvents([
    J({ agentPreset: 'p', cwd: 'D:\\x' }),
    J({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '看这张图' }, imgPart] } } }),
  ])
  const m = folded.msgs[0]
  assert(m && m.role === 'user', '应有一条 user 消息')
  assert(m.text === '看这张图', '文本应保留')
  assert(Array.isArray(m.attachments) && m.attachments.length === 1, '★ 附件必须带上(这正是旧实现丢掉的东西)')
  assert(m.attachments[0].id === HASH, '附件 id 应可推导路径')
})

t('L3.5-7 ★ 纯文本消息保持原样形状 {role,text}(不新增字段, 守 legacy 逐字节兼容)', () => {
  const folded = foldSessionLogEvents([
    J({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '只有文字' }] } } }),
  ])
  const m = folded.msgs[0]
  assert(m.text === '只有文字', '文本应保留')
  assert(Object.prototype.hasOwnProperty.call(m, 'attachments') === false,
    '★ 无附件的消息不得新增 attachments 字段(否则 legacy 输出形状改变)')
  assert(Object.keys(m).sort().join(',') === 'role,text', '键集必须恰为 role,text, 实为 ' + Object.keys(m).join(','))
})

t('L3.5-8 纯附件消息(无文本)也要保留 —— 否则"只投了图没写字"整条消失', () => {
  const folded = foldSessionLogEvents([
    J({ type: 'user/message', data: { message: { role: 'user', content: [imgPart] } } }),
  ])
  assert(folded.msgs.length === 1, '★ 纯附件消息必须保留(旧实现 txt 为空 ⇒ 整条被 continue 丢掉)')
  assert(folded.msgs[0].text === '', '文本为空串')
  assert(folded.msgs[0].attachments.length === 1, '附件应在场')
})

// ─────────────────────────────────────────────────────────────
// L3.5-9 渲染行可读且含绝对路径
// ─────────────────────────────────────────────────────────────
t('L3.5-9 renderAttachmentLinesPre 输出含「附件标记 + 绝对路径 + 体积」(模型据此 read)', () => {
  const atts = attachmentsOfContent([imgPart])
  const lines = renderAttachmentLinesPre(atts, HOME)
  assert(lines.length === 1, '应渲染 1 行')
  assert(/\[附件 图片\]/.test(lines[0]), '应有中文附件标记, 实为 ' + lines[0])
  assert(lines[0].indexOf(HASH) >= 0, '★ 必须含 blob 绝对路径(可被 read)')
  assert(/20 KB|20KB/.test(lines[0]), '应含可读体积')
  assert(lines.length === 0 || renderAttachmentLinesPre([], HOME).length === 0, '空输入应返回空数组')
})

// ─────────────────────────────────────────────────────────────
// L3.5-10 ★ 源码守卫: 三处接线必须真的在
// ─────────────────────────────────────────────────────────────
const src = readFileSync('lib/index.js', 'utf8')

t('L3.5-10 ★ 转写体里写了附件清单 + 消息内联附件行', () => {
  assert(/## 附件清单\(/.test(src), '★ 转写文件必须含「附件清单」小节')
  assert(/renderAttachmentLinesPre\(allAtts\)/.test(src), '清单须由渲染函数产出')
  // ★L3.6(2026-09-17): 内联改由 slimTranscriptPre 的 decorate 回调产出(转写瘦身重构) ——
  //   判据本身不变: **每条消息附近必须内联其附件行**。改为驱动真实行为断言, 比 grep 更牢。
  const withAtt = slimTranscriptPre(
    [{ role: 'user', text: '这张图是啥', attachments: [{ kind: 'image', id: HASH, bytes: 20480 }] }],
    { decorate: (m) => renderAttachmentLinesPre(m.attachments).map((x) => '  - ' + x).join('\n') }
  )
  assert(withAtt.body.includes('  - '), '★ 每条消息附近须内联其附件行(实为 ' + withAtt.body + ')')
  assert(withAtt.body.indexOf('这张图是啥') < withAtt.body.indexOf('  - '), '内联行须紧随该条消息之后')
  assert(/attachmentCount: allAtts\.length/.test(src), 'pack 须把附件数回传(供接续材料判断)')
})

t('L3.5-11 ★ 接续材料: 清单进 bulk, 指令进 nav(方案 A 的分层不得写反)', () => {
  const bulkIdx = src.indexOf('第2.5层 · 旧会话附件清单')
  assert(bulkIdx > 0, '★ 附件清单段必须存在')
  assert(/bulkParts\.push\('【第2.5层 · 旧会话附件清单/.test(src), '★ 清单必须进 bulkParts(可截断的身体层)')
  assert(!/navParts\.push\('【第2.5层 · 旧会话附件清单/.test(src), '★ 清单**不得**进 nav(否则长清单挤占逃生通道配额)')
  assert(/guide\.push\('- 旧会话里带有/.test(src), '★ "去哪儿取"的指令必须进 guide(→ nav, 永不截断)')
})

t('L3.5-12 旧行为未被破坏: 转写仍写 role 与单条截断, 总长上限仍在', () => {
  // ★L3.6(2026-09-17): 原为源码 grep(字面量随瘦身重构迁入 slimTranscriptPre) —— 改为**行为断言**:
  //   这些是"旧行为不得被破坏"的契约, 用行为锁比用实现字面量锁更准确。
  const bodyOf = (r) => r.body
  // ① role 前缀格式保持
  const r1 = bodyOf(slimTranscriptPre([{ role: 'user', text: 'hi' }]))
  assert(r1 === '**user**: hi', 'role 前缀格式应为 **role**: text, 实为 ' + JSON.stringify(r1))
  // ② 单条超长被截断(默认 2000)
  const long = 'x'.repeat(5000)
  const r2 = bodyOf(slimTranscriptPre([{ role: 'assistant', text: long }]))
  assert(r2.length < 5000 && r2.startsWith('**assistant**: '), '单条超长应被截断, 实长 ' + r2.length)
  assert(r2.length === '**assistant**: '.length + 2000, '默认单条截断到 2000 字符')
  // ③ 总长上限仍在(超限即停并置 trimmed)
  const many = Array.from({ length: 100 }, () => ({ role: 'user', text: 'y'.repeat(1900) }))
  const r3 = slimTranscriptPre(many, { totalChars: 60000 })
  assert(r3.trimmed === true, '★ 超总长须置 trimmed(供上层写"已截断"提示)')
  assert(r3.body.length <= 60000, '总长不得超过 60000, 实为 ' + r3.body.length)
  assert(r3.keptMsgs < 100, '超限后应停止收录, 实收录 ' + r3.keptMsgs)
})

const total = pass + fail
console.log('[l35-attachment] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
if (fail) process.exit(1)
