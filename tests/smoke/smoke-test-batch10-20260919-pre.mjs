#!/usr/bin/env node
/**
 * smoke-test-batch10-20260919-pre.mjs —— 第十批（⑪ skill 导出层）
 *
 * **用户 2026-09-19 三项拍板**：
 *   ⑪-1 形态 = `SKILL.md` + **附上过程中用到的程序**；且 SKILL.md 里必须明写：
 *        程序**只是参考性的**，场景**根本不同**时可**迁移**，**不能直接运行**。
 *   ⑪-2 时机 = **晋升为 `active` 后自动导出**。
 *   ⑪-3 目录 = **用户级**（可跨项目迁移），但**必须标注适用项目**；跨项目**只作参考**。
 *
 * 本套件把上述三条**当作判据本身**来断言（不是断言实现细节）：
 *   - 约束条款五条锚点必须**原样出现**（防止后续改动悄悄删掉）
 *   - 缺项目名 ⇒ **必须拒绝导出**（⑪-3 是硬要求，不是可选装饰）
 *   - 附带程序必须被「不要直接运行」包裹，而不是只列个名
 *   - **真机写盘**：用临时目录实测导出 + 校验目录结构 + 防覆盖
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SKILL_USAGE_NOTICE_PRE_V1, SKILL_NOTICE_ANCHORS_PRE_V1,
  renderSkillMarkdownPre, validateSkillMarkdownPre, skillDirNamePre,
} from '../../lib/skill-export-pre.js'
import {
  SKILL_EXPORT_STAMP_PRE_V1, resolveSkillsRootPre, projectNameFromPre,
  collectProgramsPre, exportSkillForPre, listExportedSkillsPre,
} from '../../lib/skill-export-host-pre.js'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
const codeOnly = (t) => String(t).split(/\r?\n/)
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) }).join('\n')

const PROC = {
  procedureId: 'proc_pre_0123456789abcdef0123456789abcdef',
  title: 'GitHub 批量 issue 闭环流程',
  stage: 'active',
  riskLevel: 'medium',
  preconditions: ['存在一批待回复/待关闭的上游 issue'],
  steps: ['逐条核验 issue 是否适用于当前版本', '本地修复并跑全量回归', '写回复正文脚本并执行', '确认全部关闭'],
  checks: ['关闭数 = 计划数'],
  successCriteria: ['全部 issue 处于 closed 状态'],
  rollback: ['回复错误则补一条更正评论'],
  sourceEpisodes: ['epi_pre_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  evidence: { seen: 3, success: 2, correction: 0 },
}

console.log('\n[1] ⑪-1 约束条款：五个锚点必须原样出现')
for (const a of SKILL_NOTICE_ANCHORS_PRE_V1) {
  ok(SKILL_USAGE_NOTICE_PRE_V1.includes(a), '条款含锚点: ' + a)
}
const r1 = renderSkillMarkdownPre(PROC, { projectName: 'dsh-auto-memory', projectPath: 'D:\\dsh-auto-memory' })
ok(r1.ok === true, '渲染成功', JSON.stringify(r1).slice(0, 120))
ok(r1.fileName === 'SKILL.md', '文件名 = SKILL.md')

console.log('\n[2] ⑪-3 缺项目名 ⇒ 必须拒绝（硬要求，不是可选装饰）')
const r2 = renderSkillMarkdownPre(PROC, {})
ok(r2.ok === false && r2.reason === 'no-project-name', '无 projectName ⇒ 拒', JSON.stringify(r2))

console.log('\n[3] frontmatter 与必需小节')
const c1 = r1.content
ok(/^---\r?\n/.test(c1), '有 frontmatter 起始')
ok(/^name:\s*\S+/m.test(c1), '有 name')
ok(/^description:\s*\S+/m.test(c1), '有 description')
ok(c1.includes('## 来源'), '有「来源」小节（⑪-3 项目标注位）')
ok(c1.includes('`dsh-auto-memory`'), '标注了适用项目')
ok(/## 步骤[\s\S]*1\. /.test(c1), '步骤编号渲染')
ok(c1.includes('## 成功判据'), '成功判据小节')

console.log('\n[4] ⑪-1 附带程序必须被「不可直接运行」约束包裹')
const r4 = renderSkillMarkdownPre(PROC, { projectName: 'p', programs: ['scripts/fix.py', 'tools/run.mjs'] })
ok(r4.ok === true, '带程序渲染成功')
ok(r4.content.includes('scripts/fix.py') && r4.content.includes('tools/run.mjs'), '程序被列出')
ok(r4.content.includes('**参考性**'), '明确标注参考性')
ok(r4.content.includes('不要直接运行'), '明确禁止直接运行')

console.log('\n[5] 校验器：判据 = 用户硬要求本身')
const v1 = validateSkillMarkdownPre(c1, { projectName: 'dsh-auto-memory' })
ok(v1.ok === true, '合法产物通过校验', JSON.stringify(v1.problems))
const broken = c1.replace('只做迁移，不要直接运行', '随便跑')
const v2 = validateSkillMarkdownPre(broken, { projectName: 'dsh-auto-memory' })
ok(v2.ok === false && v2.problems.some((p) => p.includes('notice')), '删掉约束条款 ⇒ 校验失败')
ok(validateSkillMarkdownPre('', {}).ok === false, '空内容 ⇒ 失败')
ok(validateSkillMarkdownPre(c1, { hasPrograms: true }).ok === false, '声明有程序但没有 ⇒ 失败')

console.log('\n[6] 目录名稳定且可预测')
const d1 = skillDirNamePre(PROC)
ok(d1.startsWith('mem-skill-'), '带 mem-skill- 前缀', d1)
ok(d1 === skillDirNamePre({ ...PROC }), '同样输入 ⇒ 同样目录名（确定性）')
ok(skillDirNamePre({ procedureId: 'proc_pre_ffffffffffffffffffffffffffffffff', title: '别的流程' }) !== d1, '不同 procedure ⇒ 不同目录名')
// ★T7-b（2026-09-20 用户报「所有中文技能都叫 untitled」）：
//   旧断言锁的是**回落字面量 'untitled'** —— 那条"有意设计"正是本轮要推翻的东西，
//   它保证了"不产生空 slug"，却让每个中文技能都失去可辨识名字。
//   新断言改为：①**不得**再出现 untitled；②中文标题走哈希回落 `t-<8位十六进制>`；
//   ③★关键：整名必须满足 **DSH 宿主的 SKILL_NAME 硬校验** `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
//     （宿主 index.js:481 对不合规 name 直接 throw ⇒ 技能加载失败）。
const cn1 = skillDirNamePre({ procedureId: 'proc_pre_x', title: '中文标题' })
const cn2 = skillDirNamePre({ procedureId: 'proc_pre_x', title: '中文标题' })
ok(!cn1.includes('untitled'), '★ 纯中文标题不得再回落 untitled（T7-b 修复）', cn1)
ok(/^mem-skill-t-[0-9a-f]{8}-/.test(cn1), '★ 纯中文标题走哈希回落 mem-skill-t-<hex8>-', cn1)
ok(cn1 === cn2, '★ 哈希回落必须稳定（同 title ⇒ 同名字，重导出不产生新目录）')
ok(cn1 !== skillDirNamePre({ procedureId: 'proc_pre_x', title: '另一个中文标题' }), '★ 不同中文标题 ⇒ 不同名字（不再堆成一堆 untitled）')
// DSH 宿主 SKILL_NAME 硬校验（name 字段必须能通过，否则加载抛错）
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
ok(SKILL_NAME_RE.test(skillDirNamePre(PROC)), '★ ASCII 标题的名字满足 DSH SKILL_NAME 校验')
ok(SKILL_NAME_RE.test(cn1), '★★ 中文标题产出的名字也满足 DSH SKILL_NAME 校验（否则技能加载直接抛错）')

console.log('\n[7] 工具函数')
ok(projectNameFromPre('D:\\dsh-auto-memory') === 'dsh-auto-memory', 'Windows 路径推项目名')
ok(projectNameFromPre('D:\\a\\b\\') === 'b', '尾部斜杠被剥')
ok(projectNameFromPre('') === '', '空路径 ⇒ 空名')
ok(resolveSkillsRootPre({ skillsRoot: 'X:\\s' }) === 'X:\\s', '显式 skillsRoot 优先')
ok(resolveSkillsRootPre({ dshHome: 'X:\\dsh' }).endsWith(join('skills')), '缺省 = <dshHome>/skills')
ok(resolveSkillsRootPre({}) === null, '都没有 ⇒ null（不猜路径）')
ok(collectProgramsPre('D:\\p', ['a.py', '../evil.py', 'D:\\abs.py', '  ']).join(',') === 'a.py', '程序列表过滤目录穿越与绝对路径')

console.log('\n[8] ★ 真机写盘：导出 → 目录结构 → 内容 → 防覆盖')
const tmp = mkdtempSync(join(tmpdir(), 'dsh-skill-export-'))
try {
  const e1 = exportSkillForPre(PROC, {
    skillsRoot: tmp, projectName: 'dsh-auto-memory', projectPath: 'D:\\dsh-auto-memory',
    programs: ['scripts/fix.py'], exportedAt: '2026-09-19T12:00:00.000Z',
  })
  ok(e1.ok === true, '导出成功', JSON.stringify(e1).slice(0, 140))
  // ★ 变异演示发现：导出失败时 e1.file 为 undefined，existsSync 会**抛异常**导致整套件崩溃，
  //   而非干净地报 FAIL（看起来像"假绿"）。这里显式守卫：失败也必须是**可断言的红**。
  if (!e1.ok) {
    ok(false, '导出失败 ⇒ 后续落盘断言无法继续（已记为 FAIL 而非崩溃）', String(e1.reason))
  } else {
  ok(existsSync(e1.file), 'SKILL.md 落盘')
  const onDisk = readFileSync(e1.file, 'utf8')
  ok(onDisk.includes(SKILL_EXPORT_STAMP_PRE_V1), '含自检标记（可识别为本插件产物）')
  ok(validateSkillMarkdownPre(onDisk, { projectName: 'dsh-auto-memory', hasPrograms: true }).ok === true, '落盘内容过校验')
  ok(existsSync(join(tmp, e1.dirName, 'SKILL.md')), '目录结构 = <root>/<dirName>/SKILL.md')
  // 无临时残留
  const leftovers = readdirNames(tmp)
  ok(!leftovers.some((n) => n.includes('.tmp-')), '无 .tmp 残留', JSON.stringify(leftovers))

  // 防误覆盖：先造一个「非本插件」的同名目录
  const foreign = join(tmp, skillDirNamePre(PROC))
  rmSync(foreign, { recursive: true, force: true })
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'SKILL.md'), '# 用户手写的技能\n', 'utf8')
  const e2 = exportSkillForPre(PROC, { skillsRoot: tmp, projectName: 'dsh-auto-memory' })
  ok(e2.ok === false && String(e2.reason).includes('foreign'), '不覆盖用户手写技能', JSON.stringify(e2))
  ok(readFileSync(join(foreign, 'SKILL.md'), 'utf8').includes('用户手写'), '用户内容未被破坏')

  console.log('\n[9] 列出已导出（供诊断/GUI）')
  const list = listExportedSkillsPre(tmp)
  ok(Array.isArray(list), '返回数组')
  ok(!list.some((x) => x.dirName === skillDirNamePre(PROC)), '手写目录不出现在列表（只认本插件产物）')

  const e3 = exportSkillForPre(PROC, { skillsRoot: tmp, projectName: 'dsh-auto-memory', force: true })
  ok(e3.ok === true, 'force=true 可覆盖', JSON.stringify(e3).slice(0, 120))
  const list2 = listExportedSkillsPre(tmp)
  // ★ 守卫（同 e1.ok 的处理）：列表为空时 `list2[0].xxx` 会抛，导致整套件崩溃而非干净报 FAIL。
  ok(list2.length === 1 && !!(list2[0] && list2[0].project === 'dsh-auto-memory'), '覆盖后列表含 1 条且项目名正确', JSON.stringify(list2))
  ok(!!(list2[0] && list2[0].bytes > 200), '统计字节数合理', String(list2[0] && list2[0].bytes))
  }   // ← 关闭 `if (!e1.ok) ... else {` 守卫

  console.log('\n[10] fail-soft：异常输入不抛出、返回可观察 reason')
  ok(exportSkillForPre(PROC, {}).ok === false, '无 skillsRoot ⇒ 拒')
  ok(exportSkillForPre(PROC, { skillsRoot: tmp }).ok === false, '无项目名 ⇒ 拒（⑪-3）')
  ok(exportSkillForPre(null, { skillsRoot: tmp, projectName: 'p' }).ok === false, 'null procedure ⇒ 拒')
  ok(exportSkillForPre({}, { skillsRoot: tmp, projectName: 'p' }).ok === false, '空 procedure ⇒ 拒')
  ok(exportSkillForPre(PROC, { skillsRoot: tmp, projectName: 'p' }).ok === true, '最小可用参数 ⇒ 成功')
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n[11] 源码接线锁（防"只声明未使用"）')
const host = codeOnly(src('skill-export-host-pre.js'))
ok(host.includes('renderSkillMarkdownPre('), 'host 调用了渲染器')
ok(host.includes('validateSkillMarkdownPre('), 'host 在落盘前做校验')
ok(host.includes('renameSync('), '用 rename 原子落盘（防半截文件）')
ok(host.includes('SKILL_EXPORT_STAMP_PRE_V1'), '写入自检标记')
const pre = codeOnly(src('skill-export-pre.js'))
ok(!/\bwriteFileSync\b|\bmkdirSync\b/.test(pre), '渲染层确实不含写盘 API（保持纯函数）')

console.log(`\n=== PASS ${pass} / FAIL ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)

function readdirNames(dir) {
  try { return readdirSync(dir) } catch (_) { return [] }
}
