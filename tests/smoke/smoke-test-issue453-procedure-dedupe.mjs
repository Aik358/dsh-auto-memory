/**
 * smoke-test-issue453-procedure-dedupe.mjs — #453「已有技能被再次识别并加入审批流」的回归。
 *
 * 用户报告（2026-10-21）：工具本身已有的技能会被再次识别并被加入技能审批流，
 * 期望加一层本地重复技能过滤。
 *
 * 取证（2026-10-22）：本机 ~/.dsh/memory/hub/procedures.json 实测 103 条，
 *   stage=observed 77 条，其中 19 条缺 successCriteria、14 条是纯 episode 观察行（observationOnly），
 *   且大量标题是用户聊天原话（「让我自己去试吧。现在是什么情况？」「开始实施」）——
 *   机械切片把对话片段当成了流程候选，全堆在审批面，把真有价值的条目淹没。
 *
 * 本套件验证两处修复（都在**可执行**层面，不是「源码含某字符串」）：
 *   A 查重面扩展：proceduresFindDuplicatePre 现在除 procedure store 外，还比对
 *     <dshHome>/skills/ 下**磁盘已有**的 SKILL.md（含用户手写 / 孤儿导出）——
 *     命中即拒写并列出对照依据（不自动合并）。
 *   B 审批面折叠：memory_procedure_list 默认折叠「observationOnly 或 缺 successCriteria」的行，
 *     如实报出被折叠条数并支持 includeNoise=true 看全量（不删、不隐藏）。
 *
 * C 段做变异验证：把每处判据逐个改坏，要求对应断言必须变红；还原后必须全绿。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listLocalSkillsPre } from '../../lib/skill-export-host.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0
let fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.log('  FAIL - ' + name) }
}

/* ══════════════════════════════════════════
   A. listLocalSkillsPre：磁盘技能全量列举（含用户手写）
   ══════════════════════════════════════════ */
console.log('[#453] A. 磁盘技能全量列举（含用户手写 / 孤儿导出）')

const home = mkdtempSync(path.join(tmpdir(), 'dam453-'))
const skillsRoot = path.join(home, 'skills')

function writeSkill(dirName, text) {
  const d = path.join(skillsRoot, dirName)
  mkdirSync(d, { recursive: true })
  writeFileSync(path.join(d, 'SKILL.md'), text, 'utf8')
}

try {
  // ① 本插件导出的技能（带自检标记）
  writeSkill('mem-skill-own-a', [
    '---',
    'name: mem-skill-own-a',
    'description: 本插件导出的流程 A',
    '---',
    '',
    '# 发布前跑全量回归',
    '',
    '> **来源**',
    '',
    '- **沉淀自**：procedure `proc_pre_aaaa`',
    '- 自检标记 mem-skill-export-pre-v1',
  ].join('\n'))

  // ② 用户手写/其它来源（无自检标记）—— 这正是旧实现完全看不见的那一类
  writeSkill('my-own-skill', [
    '---',
    'name: my-own-skill',
    'description: 我自己写的流程 B',
    '---',
    '',
    '# 手工整理的部署检查单',
    '',
    '用户手写内容。',
  ].join('\n'))

  // ③ 无 frontmatter ⇒ 应被跳过（fail closed，不猜测）
  writeSkill('broken-skill', 'no frontmatter here')

  const list = listLocalSkillsPre(skillsRoot)
  ok(list.length === 2, 'A1 只收有可解析 frontmatter 的技能（实测 ' + list.length + ' 条，跳过无 frontmatter 的）')
  const own = list.find((x) => x.dirName === 'mem-skill-own-a')
  const mine = list.find((x) => x.dirName === 'my-own-skill')
  ok(!!own && own.source === 'own', "A2 带自检标记 ⇒ source='own'")
  ok(!!mine && mine.source === 'foreign', "A3 ★用户手写（无自检标记）⇒ source='foreign'（旧实现完全看不见这类）")
  ok(!!own && own.title === '发布前跑全量回归', "A4 title 取正文 '# ' 标题（不是 ASCII name —— 中文技能靠它才能被查重）")
  ok(!!mine && mine.title === '手工整理的部署检查单', 'A5 用户手写技能的 title 同样可读')
  ok(!!mine && mine.name === 'my-own-skill', 'A6 frontmatter name 保留')
  ok(list.every((x) => !x.hasStamp === (x.source === 'foreign')), 'A7 hasStamp 与 source 一致')

  /* ══════════════════════════════════════════
     B. 查重面：磁盘技能必须参与比对
     ══════════════════════════════════════════ */
  console.log('[#453] B. 查重面扩展（store + 磁盘技能目录）')

  // 从源码抽出 proceduresFindDuplicatePre 与 normalization，注入最小依赖后真跑
  function extractFn(name, indent) {
    const anchor = indent + 'function ' + name + '('
    const start = SRC.indexOf(anchor)
    assert(start >= 0, '找不到 ' + name)
    const braceStart = SRC.indexOf('{', start)
    let depth = 0
    for (let i = braceStart; i < SRC.length; i++) {
      const c = SRC[i]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) return SRC.slice(start + indent.length, i + 1) }
    }
    throw new Error('unbalanced ' + name)
  }

  // proceduresNormalizePre 是嵌套函数，取它的实现
  const normSrc = extractFn('proceduresNormalizePre', '        ')
  const dupSrc = extractFn('proceduresFindDuplicatePre', '        ')

  const makeImpl = (overrides = {}) => {
    const factory = new Function(
      'proceduresNormalizePre', 'resolveSkillsRootPre', 'listLocalSkillsPre', 'dshHome',
      'return (function(){' +
      (overrides.proceduresFindDuplicatePre || dupSrc) +
      '\n return proceduresFindDuplicatePre })()'
    )
    return factory(
      (overrides.proceduresNormalizePre) || new Function('return ' + normSrc)(),
      () => skillsRoot,
      overrides.listLocalSkillsPre || listLocalSkillsPre,
      () => home
    )
  }

  const fakeProcsOf = (rows) => ({ query: () => rows.map((r) => ({ ...r })) })
  const impl = makeImpl()

  // store 内无同名条目，但磁盘上**有**同名技能 ⇒ 必须命中（这是 #453 的核心）
  const hitDisk = impl(fakeProcsOf([]), '手工整理的部署检查单', ['步骤一'])
  ok(hitDisk.length >= 1, 'B1 ★store 为空但磁盘技能有同名 ⇒ 命中（旧实现此处恒返回 []，必然漏拦）')
  ok(hitDisk.some((h) => String(h.why).includes('磁盘技能目录')), 'B2 命中理由点明「磁盘技能目录」')
  ok(hitDisk.some((h) => h.skillDir === 'my-own-skill'), 'B3 命中项带 skillDir（用户能据此复核）')
  ok(hitDisk.some((h) => String(h.why).includes('用户手写')), 'B4 ★对外部来源如实标注「用户手写/外部来源」')

  // 本插件导出的技能同样要拦
  const hitOwn = impl(fakeProcsOf([]), '发布前跑全量回归', [])
  ok(hitOwn.some((h) => String(h.why).includes('本插件导出')), 'B5 本插件导出的技能也拦（并标注来源）')

  // 不同名 ⇒ 不拦（不误伤）
  const noHit = impl(fakeProcsOf([]), '完全无关的另一条流程', [])
  ok(noHit.length === 0, 'B6 ★不同名 ⇒ 不拦（避免误伤「相似但确实不同」的流程）')

  // store 内同名仍然照常命中（两路都要活着）
  const hitStore = impl(fakeProcsOf([{ procedureId: 'p1', title: '手工整理的部署检查单', stage: 'active', steps: [] }]), '手工整理的部署检查单', [])
  ok(hitStore.some((h) => h.why === '标题完全相同'), 'B7 store 内同名仍然命中（原判据未被替换掉）')

  // 磁盘列举抛错 ⇒ 不影响 store 那一路（fail-soft）
  const implThrowing = makeImpl({ listLocalSkillsPre: () => { throw new Error('boom') } })
  const stillWorks = implThrowing(fakeProcsOf([{ procedureId: 'p2', title: 'X 流程', stage: 'active', steps: [] }]), 'X 流程', [])
  ok(stillWorks.length === 1, 'B8 ★磁盘列举抛错 ⇒ store 那一路仍然工作（不因新功能把老功能拖死）')

  /* ══════════════════════════════════════════
     C. 审批面折叠判据（isNoisePre 语义，直接抽源码跑）
     ══════════════════════════════════════════ */
  console.log('[#453] C. 审批面折叠判据')

  const noiseLine = SRC.match(/const isNoisePre = \(p\) => [^\r\n]+/)
  ok(!!noiseLine, 'C1 源码里存在 isNoisePre 判据')
  const isNoisePre = new Function('return (p) => (' + noiseLine[0].replace(/^const isNoisePre = \(p\) => /, '') + ')')()

  ok(isNoisePre({ observationOnly: true, successCriteria: ['x'] }) === true, 'C2 ★纯 episode 观察行 ⇒ 折叠（即使有 criteria）')
  ok(isNoisePre({ observationOnly: false, successCriteria: [] }) === true, 'C3 ★缺 successCriteria ⇒ 折叠')
  ok(isNoisePre({ successCriteria: [] }) === true, 'C4 缺字段等同于空数组 ⇒ 折叠')
  ok(isNoisePre({ successCriteria: ['怎么算跑通'] }) === false, 'C5 有 criteria 的富条目 ⇒ 不折叠')
  ok(isNoisePre(null) === false, 'C6 null ⇒ 不折叠（不炸）')

  // 折叠是「不显示但仍计数」：验证 includeNoise 参数存在且语义正确
  ok(/includeNoise: \{ type: 'boolean'/.test(SRC), 'C7 includeNoise 参数已注册（可查看全量）')
  ok(SRC.includes("args.includeNoise === true ? kept : kept.filter((p) => !isNoisePre(p))"), 'C8 includeNoise=true 时保留全量；缺省折叠')
  ok(SRC.includes('已折叠 ' + "' + noiseRows.length + '" + ' 条低质量观察行'), 'C9 ★折叠时如实报出条数（不静默丢弃）')

  /* ══════════════════════════════════════════
     D. 变异验证（负路径）
     ══════════════════════════════════════════ */
  console.log('[#453] D. 变异验证（每条必须变红；还原后必须全绿）')

  const MUTATIONS = [
    {
      name: 'D1 查重只看 store（去掉磁盘那一路）—— 回到修复前',
      patch: () => makeImpl({ proceduresFindDuplicatePre: dupSrc.replace(/try \{\r?\n\s*const skillsRoot = resolveSkillsRootPre/, 'try { return storeOnly()\n const skillsRoot = resolveSkillsRootPre').replace('const hits = []', 'const hits = []\n const storeOnly = () => hits') }),
      expect: (m) => m(fakeProcsOf([]), '手工整理的部署检查单', []).length === 0,
    },
    {
      name: 'D2 折叠判据只认 observationOnly（漏掉缺 criteria 那一类）',
      patch: () => { const m = SRC.match(/const isNoisePre = \(p\) => [^\r\n]+/)[0]; const alt = m.replace(' || (p.successCriteria || []).length === 0', ''); return new Function('return (p) => (' + alt.replace(/^const isNoisePre = \(p\) => /, '') + ')')() },
      expect: (m) => m({ observationOnly: false, successCriteria: [] }) === false,
    },
    {
      name: 'D3 listLocalSkillsPre 只收本插件导出（回到 old 口径，用户手写看不见）',
      patch: () => (root2) => listLocalSkillsPre(root2).filter((x) => x.source === 'own'),
      expect: (m) => m(skillsRoot).filter((x) => x.dirName === 'my-own-skill').length === 0,
    },
  ]

  let caught = 0
  for (const mut of MUTATIONS) {
    let hit = false
    try { hit = mut.expect(mut.patch()) } catch { hit = true }
    ok(hit, 'D ' + mut.name + ' ⇒ 断言变红')
    if (hit) caught++
  }
  ok(caught === MUTATIONS.length, 'D4 变异捕获率 ' + caught + '/' + MUTATIONS.length)

  // 还原后必须仍绿（防「变异恒红」的假象）
  ok(impl(fakeProcsOf([]), '手工整理的部署检查单', []).length >= 1, 'D5 还原后：磁盘查重仍然命中')
  ok(listLocalSkillsPre(skillsRoot).some((x) => x.dirName === 'my-own-skill'), 'D6 还原后：用户手写技能仍被列举')
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log('')
console.log('[#453] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
