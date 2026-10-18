#!/usr/bin/env node
// ★#427（2026-10-17）回归锁定：SKILL.md frontmatter 必须**真能被 YAML 解析**，而不只是「那两行存在」。
//
// 真实缺陷（施工前已用真渲染复现）：
//   renderSkillMarkdownPre({ title: 'SOP: 大型修复批编排' })
//     →  description: SOP: 大型修复批编排      ← 裸拼接
//   validateSkillMarkdownPre(...)  →  {ok:true, problems:[]}   ← 假绿
//   真 YAML 解析                    →  throw: Nested mappings are not allowed in compact mappings
// 宿主加载器（dsh-skill-filesystem）解析抛错就 warn 并**丢弃该文件** ⇒ 技能静默加载不到。
// 连带破损同源：# 起始 ⇒ description 解析成 null；- dash ⇒ 抛错；a # b ⇒ 被截成 a（静默丢字）。
//
// 修法：frontmatter 两个字段一律走 yamlScalarPre()（双引号标量 + 转义），
//       validate 改为「frontmatter 必须能被 parseFrontmatterScalarsPre 解析 + name/description 非空 +
//       双向 round-trip 逐字节相等」。
//
// 本文件锁死：
//   [A] 正路径：title='SOP: x # y' ⇒ round-trip 逐字节相等 + validate ok
//   [B] 负路径①：人为去掉引号的变异输入 ⇒ validate 必红
//   [C] 负路径②：'# comment' ⇒ 不得解析成 null
//   [D] 负路径③：'- dash' ⇒ 不得抛
//   [E] 负路径④：'a # b' ⇒ 解析值完整保留
//   [F] 负路径⑤：空 frontmatter / 缺 key ⇒ 红
//   [G] 编解码器本身的边界：控制符 / 反斜杠 / 引号 / 换行 / tab 全往返
import {
  renderSkillMarkdownPre, validateSkillMarkdownPre, yamlScalarPre,
  parseYamlScalarTokenPre, parseFrontmatterScalarsPre,
} from '../../lib/skill-export.js'
import { listExportedSkillsPre, exportSkillForPre } from '../../lib/skill-export-host.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + String(extra))) }
}

const PID = 'proc_pre_' + 'a'.repeat(32)
const render = (title) => renderSkillMarkdownPre(
  { procedureId: PID, title, steps: ['第一步'], successCriteria: ['可判定'] },
  { projectName: 'p' },
)

console.log('[A] 正路径：标题含 ": " 与 "#" ⇒ round-trip 逐字节相等 + validate ok')
{
  const title = 'SOP: x # y'
  const r = render(title)
  ok(r.ok === true, '夹具自检：渲染成功', r.reason)
  const fm = parseFrontmatterScalarsPre(r.content)
  ok(fm.ok === true, '★ frontmatter 可被解析（修复前这里连解析器都没有）', JSON.stringify(fm.problems))
  ok(fm.data.description === title, '★ description 解析回原值、逐字节相等', JSON.stringify(fm.data.description))
  // 取值前先兜住 undefined：变异（回退裸拼接）时 raw.description 不存在（因为标量不可解析），
  // 直接 .startsWith 会抛 TypeError 把整套件变成「崩溃」而不是「干净的红」。
  const rawDesc = String(fm.raw.description == null ? '' : fm.raw.description)
  ok(rawDesc.startsWith('"'), '★ frontmatter 里确实是双引号标量', JSON.stringify(fm.raw.description))
  const v = validateSkillMarkdownPre(r.content, { projectName: 'p' })
  ok(v.ok === true, '★ validate 通过（真解析 + round-trip 都成立）', JSON.stringify(v.problems))
  // 期望值比对路径（validate 的 expect.description）
  ok(validateSkillMarkdownPre(r.content, { description: title }).ok === true, '★ expect.description 相符 ⇒ ok')
  ok(validateSkillMarkdownPre(r.content, { description: title + 'X' }).ok === false, '★ expect.description 不符 ⇒ 红')
  // name 也要能被解析
  const fmName = String(fm.data.name == null ? '' : fm.data.name)
  ok(fmName.startsWith('mem-skill-'), '★ name 解析出来不带引号', fm.data.name)
  ok(!fmName.includes('"'), '★ name 不含引号字符')
}

console.log('\n[B] 负路径①：人为去掉引号的变异输入 ⇒ validate 必红')
{
  const r = render('SOP: 大型修复批编排')
  const quotedLine = r.content.split('\n').find((l) => l.startsWith('description: '))
  ok(quotedLine !== undefined && quotedLine.startsWith('description: "'), '夹具自检：渲染产物是带引号的', quotedLine)
  // 精确复现修复前的裸拼接形态
  const mutated = r.content.replace(quotedLine, 'description: SOP: 大型修复批编排')
  const v = validateSkillMarkdownPre(mutated, {})
  ok(v.ok === false, '★ 裸拼接 mutation ⇒ validate 必须红', JSON.stringify(v.problems))
  ok(v.problems.some((p) => p.startsWith('frontmatter-unparsable:')), '★ 问题码指向 frontmatter 不可解析', JSON.stringify(v.problems))
  // 负路径也必须“真解析器同向”：我们的解析器拒绝的，正是真 YAML 会抛的形态
  const fm = parseFrontmatterScalarsPre(mutated)
  ok(fm.ok === false && fm.problems.some((p) => p.includes('plain-scalar-nested-mapping')), '★ 解析器判定为嵌套映射（与真 YAML 报错同因）', JSON.stringify(fm.problems))
}

console.log('\n[C] 负路径②：标题以 # 起始 ⇒ 不得解析成 null')
{
  const r = render('# comment')
  const fm = parseFrontmatterScalarsPre(r.content)
  ok(fm.ok === true, '解析成功（不抛）', JSON.stringify(fm.problems))
  ok(fm.data.description !== null && fm.data.description !== undefined, '★ 不得是 null（修复前会被当注释）', JSON.stringify(fm.data.description))
  ok(fm.data.description === '# comment', '★ 值完整保留', JSON.stringify(fm.data.description))
  ok(validateSkillMarkdownPre(r.content).ok === true, 'validate 通过')
}

console.log('\n[D] 负路径③：标题以 "- " 起始 ⇒ 不得抛')
{
  let threw = null
  let r = null
  try { r = render('- dash') } catch (e) { threw = e }
  ok(threw === null, '★ 渲染不得抛', threw && threw.message)
  const fm = parseFrontmatterScalarsPre(r.content)
  ok(fm.ok === true && fm.data.description === '- dash', '★ 解析值 = "- dash"', JSON.stringify(fm.data.description))
  // 裸形态（修复前产物）必须被判红，而不是被当成序列项静默吞掉
  const bare = r.content.replace(/description: .*/, 'description: - dash')
  ok(validateSkillMarkdownPre(bare).ok === false, '★ 裸 "- dash" 形态 ⇒ validate 红（序列项歧义）')
}

console.log('\n[E] 负路径④：标题含 "a # b" ⇒ 解析值完整保留（不得被截成 "a"）')
{
  const r = render('a # b')
  const fm = parseFrontmatterScalarsPre(r.content)
  ok(fm.data.description === 'a # b', '★ 值完整保留，不被当注释截断', JSON.stringify(fm.data.description))
  const bare = r.content.replace(/description: .*/, 'description: a # b')
  // 对照：修复前的裸形态，**真 YAML** 会把它当注释截成 "a"（静默丢字）。
  // 本仓的解析器口径是 fail closed —— 不猜真 YAML 会截成什么，直接判「注释歧义」并拒绝，
  // 因此 data.description 取不到值（undefined），而不是静默给出 "a"。
  const bareFm = parseFrontmatterScalarsPre(bare)
  ok(bareFm.data.description === undefined, '（对照）裸形态的值被判为不可解析，不会被静默截断', JSON.stringify(bareFm.data.description))
  ok(bareFm.problems.some((p) => p.includes('plain-scalar-comment')), '★ 裸形态被识别为「注释歧义」', JSON.stringify(bareFm.problems))
  ok(validateSkillMarkdownPre(bare).ok === false, '★ 裸形态 validate 红（注释歧义）')
}

console.log('\n[F] 负路径⑤：空 frontmatter / 缺 key ⇒ 红')
{
  const notice = render('x').content.slice(render('x').content.indexOf('---\n', 4) + 4)
  const noFm = notice
  ok(validateSkillMarkdownPre(noFm).ok === false, '无 frontmatter ⇒ 红', JSON.stringify(validateSkillMarkdownPre(noFm).problems))
  const emptyFm = '---\n---\n' + notice
  const vEmpty = validateSkillMarkdownPre(emptyFm)
  ok(vEmpty.ok === false, '空 frontmatter ⇒ 红', JSON.stringify(vEmpty.problems))
  ok(vEmpty.problems.includes('no-name') && vEmpty.problems.includes('no-description'), '★ 问题码含 no-name + no-description', JSON.stringify(vEmpty.problems))
  const nullFm = '---\nname:\ndescription:\n---\n' + notice
  const vNull = validateSkillMarkdownPre(nullFm)
  ok(vNull.ok === false, '★ 键存在但值为空 ⇒ 红（不得当成“字段存在”就放行）', JSON.stringify(vNull.problems))
  ok(vNull.problems.includes('empty-name') && vNull.problems.includes('empty-description'), '★ 问题码 empty-name/empty-description', JSON.stringify(vNull.problems))
  const onlyName = '---\nname: mem-skill-x\n---\n' + notice
  ok(validateSkillMarkdownPre(onlyName).ok === false, '缺 description ⇒ 红', JSON.stringify(validateSkillMarkdownPre(onlyName).problems))
  // 缩进/序列/重复键 ⇒ 红（fail closed）
  const indented = '---\nname: mem-skill-x\n  description: nested\n---\n' + notice
  ok(validateSkillMarkdownPre(indented).ok === false, '缩进行 ⇒ 红（嵌套映射）', JSON.stringify(validateSkillMarkdownPre(indented).problems))
  const dup = '---\nname: mem-skill-x\nname: mem-skill-y\ndescription: d\n---\n' + notice
  ok(validateSkillMarkdownPre(dup).ok === false, '重复键 ⇒ 红', JSON.stringify(validateSkillMarkdownPre(dup).problems))
}

console.log('\n[G] 编解码器边界：控制符 / 反斜杠 / 引号 / 换行 / tab / 中文 全部往返')
{
  const cases = [
    'plain',
    'with "quotes"',
    'with \\ backslash',
    'with\\"mixed',
    'tab\there',
    'line\nbreak',
    'crlf\r\nbreak',
    'bell\u0007del\u007f',
    'cjk 中文 · 全角：符号',
    '# leading hash',
    '- leading dash',
    'a: b',
    '  leading spaces  ',
    '"fully quoted"',
    'emoji 🚀 ok',
  ]
  let bad = []
  for (const c of cases) {
    const enc = yamlScalarPre(c)
    const dec = parseYamlScalarTokenPre(enc)
    if (!(dec.ok === true && dec.value === c)) bad.push({ c, enc, dec })
    if (!enc.startsWith('"') || !enc.endsWith('"')) bad.push({ c, enc, why: 'not-double-quoted' })
  }
  ok(bad.length === 0, '★ 全部边界值往返逐字节相等', JSON.stringify(bad.slice(0, 3)))
  // 编码器必须转义这几类
  ok(yamlScalarPre('a\nb').includes('\\n'), '换行被转义为 \\n')
  ok(yamlScalarPre('a"b').includes('\\"'), '双引号被转义成 \\"')
  ok(yamlScalarPre('a\\b').includes('\\\\'), '反斜杠被转义成 \\\\')
  ok(yamlScalarPre('a\u0001b').includes('\\u0001'), 'C0 控制符被转义成 \\uXXXX')
  // 未知转义 ⇒ fail closed（不得静默放过）
  ok(parseYamlScalarTokenPre('"a\\qb"').ok === false, '未知转义 \\q ⇒ 拒（fail closed）')
  ok(parseYamlScalarTokenPre('"unterminated').ok === false, '未闭合引号 ⇒ 拒')
}

console.log('\n[H] 下游同步：listExportedSkillsPre 走新解析器（GUI 显示不得带引号）')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a07-'))
  try {
    const e = exportSkillForProbe(root)
    ok(e.ok === true, '夹具自检：真导出成功', e.reason)
    const list = listExportedSkillsPre(root)
    ok(list.length === 1, '夹具自检：列表 1 条', list.length)
    // 变异（回退裸拼接）时导出会直接失败 ⇒ list 为空；先兜住 undefined，
    // 否则 item.name 会抛 TypeError 把整套件变成「崩溃」而不是「干净的红」。
    const item = list[0] || {}
    const itemName = String(item.name == null ? '' : item.name)
    ok(itemName.startsWith('mem-skill-'), '★ name 来自新解析器', JSON.stringify(item.name))
    ok(!itemName.includes('"'), '★ GUI 显示的 name **不带引号**（旧正则会把引号带出来）', JSON.stringify(item.name))
    ok(itemName === e.dirName, '★ name 与目录名一致（同一函数算出）', JSON.stringify({ name: item.name, dirName: e.dirName }))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function exportSkillForProbe(root) {
  return exportSkillForPre(
    { procedureId: PID, title: 'SOP: 大型修复批编排', stage: 'active', riskLevel: 'low', steps: ['s'], checks: ['c'], successCriteria: ['k'], preconditions: [], rollback: [], sourceEpisodes: [] },
    { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' },
  )
}

console.log('\n' + (fail === 0 ? 'PASS ' + pass + ' / FAIL 0' : 'PASS ' + pass + ' / FAIL ' + fail))
process.exit(fail === 0 ? 0 : 1)
