/**
 * M9-3 Skill 导出层 · 宿主侧（IO 落地）。
 *
 * 纯渲染在 `skill-export-pre.js`；本文件只负责**写盘**与**项目标注解析**。
 *
 * ★ 用户 2026-09-19 拍板：
 *   - ⑪-2 **晋升为 `active` 后自动导出** ⇒ 由 host 在 `activate` 成功后调用 `exportSkillForPre()`。
 *   - ⑪-3 目录 = **用户级**（`<dshHome>/skills/`，DSH 四条发现路径之一，可跨项目迁移）；
 *          导出物**必须标注适用项目**。
 *
 * 设计纪律：
 *   ① **fail-soft 但可观察**：返回 `{ok:false, reason}`，不抛出、不静默；
 *   ② **不自动执行**任何导出程序（程序只是参考资料）；
 *   ③ 写盘走**临时文件 + rename**（避免半截文件被 DSH 当成合法 SKILL.md）；
 *   ④ 不覆盖**非本插件产出**的同名目录（有 `mem-skill-` 前缀 + 自检标记才接管）。
 */

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderSkillMarkdownPre, validateSkillMarkdownPre } from './skill-export-pre.js'

/** 导出目录前缀（用于识别"这是本插件的产物"，避免误覆盖用户手写技能）。 */
export const SKILL_EXPORT_PREFIX_PRE_V1 = 'mem-skill-'
/** 自检标记：出现在 SKILL.md 里即证明是本插件导出物。 */
export const SKILL_EXPORT_STAMP_PRE_V1 = 'mem-skill-export-pre-v1'

/**
 * 解析技能导出根目录。
 * 优先级：opts.skillsRoot > <dshHome>/skills
 * （`<dshHome>` 由调用方从 DSH 环境取得；本函数不猜路径。）
 */
export function resolveSkillsRootPre(opts = {}) {
  if (opts.skillsRoot) return String(opts.skillsRoot)
  const home = String(opts.dshHome || '').trim()
  if (!home) return null
  return join(home, 'skills')
}

/** 从项目根路径推出一个稳定的项目名（用于 ⑪-3 的「适用项目」标注）。 */
export function projectNameFromPre(projectPath) {
  const p = String(projectPath || '').trim().replace(/[\\/]+$/, '')
  if (!p) return ''
  const base = p.split(/[\\/]/).filter(Boolean).pop() || ''
  return base
}

/** 收集可附带的程序文件（⑪-1）：只收**明确的程序后缀**，不递归、不猜。 */
export function collectProgramsPre(projectPath, names) {
  const out = []
  if (!Array.isArray(names) || !names.length) return out
  for (const n of names) {
    const s = String(n || '').trim()
    if (!s) continue
    // 只认相对文件名，防目录穿越
    if (s.includes('..') || /^[\\/]/.test(s) || /^[a-zA-Z]:/.test(s)) continue
    out.push(s)
  }
  return out
}

function readIfExists(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : null } catch (_) { return null }
}

/**
 * 导出一个 procedure 为 `<skillsRoot>/<dirName>/SKILL.md`。
 *
 * @param {object} procedure  procedure 记录（stage 应为 active）
 * @param {object} opts
 * @param {string} opts.skillsRoot  技能根目录（必填；见 resolveSkillsRootPre）
 * @param {string} opts.projectPath 项目根绝对路径
 * @param {string} opts.projectName 项目名（缺省由 projectPath 推导）
 * @param {string[]} opts.programs  附带程序相对路径列表
 * @param {string} opts.exportedAt  ISO 时间
 * @param {boolean} opts.force      为 true 时允许覆盖**非本插件**的同名目录
 * @returns {{ok:boolean, reason?:string, dir?:string, file?:string, bytes?:number}}
 */
export function exportSkillForPre(procedure, opts = {}) {
  try {
    const skillsRoot = String(opts.skillsRoot || '')
    if (!skillsRoot) return { ok: false, reason: 'no-skills-root' }

    const projectPath = String(opts.projectPath || '')
    const projectName = String(opts.projectName || '').trim() || projectNameFromPre(projectPath)
    if (!projectName) return { ok: false, reason: 'no-project-name' }

    const programs = collectProgramsPre(projectPath, opts.programs)
    const r = renderSkillMarkdownPre(procedure, {
      projectName,
      projectPath,
      programs,
      exportedAt: opts.exportedAt || new Date().toISOString(),
    })
    if (!r.ok) return { ok: false, reason: r.reason }

    // 自带标记 + 完整性自检（判据 = 用户 ⑪-1/⑪-3 的硬要求）
    const content = r.content + '\n<!-- ' + SKILL_EXPORT_STAMP_PRE_V1 + ' -->\n'
    const v = validateSkillMarkdownPre(content, { projectName, hasPrograms: programs.length > 0 })
    if (!v.ok) return { ok: false, reason: 'notice-incomplete:' + v.problems.join('|') }

    const dir = join(skillsRoot, r.dirName)
    // 防误覆盖：目录已存在且**不是**本插件产物 ⇒ 拒绝（除非 force）
    if (existsSync(dir) && !opts.force) {
      const old = join(dir, 'SKILL.md')
      const prev = readIfExists(old)
      const isOurs = prev != null && prev.includes(SKILL_EXPORT_STAMP_PRE_V1)
      const isOursByName = r.dirName.startsWith(SKILL_EXPORT_PREFIX_PRE_V1)
      if (!isOurs && isOursByName) {
        // 按名字是我们的，但内容不是 ⇒ 用户手写过，别动
        if (prev != null) return { ok: false, reason: 'dir-occupied-by-foreign' }
      }
    }

    mkdirSync(dir, { recursive: true })
    // 临时文件 + rename ⇒ 避免半截文件被 DSH 扫描到
    const tmp = join(dir, '.SKILL.md.tmp-' + process.pid + '-' + Date.now())
    const file = join(dir, 'SKILL.md')
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, file)

    return { ok: true, dir, file, bytes: Buffer.byteLength(content, 'utf8'), dirName: r.dirName }
  } catch (e) {
    return { ok: false, reason: 'export-failed:' + String((e && e.message) || e) }
  }
}

/** 列出已导出的技能（供诊断/GUI）。 */
export function listExportedSkillsPre(skillsRoot) {
  const root = String(skillsRoot || '')
  if (!root || !existsSync(root)) return []
  const out = []
  let entries = []
  try { entries = readdirSync(root) } catch (_) { return [] }
  for (const name of entries) {
    if (!name.startsWith(SKILL_EXPORT_PREFIX_PRE_V1)) continue
    const dir = join(root, name)
    try { if (!statSync(dir).isDirectory()) continue } catch (_) { continue }
    const prev = readIfExists(join(dir, 'SKILL.md'))
    if (prev == null || !prev.includes(SKILL_EXPORT_STAMP_PRE_V1)) continue
    const nameLine = /^name:\s*(.+)$/m.exec(prev)
    const projLine = /适用项目\*\*：`([^`]+)`/.exec(prev)
    out.push({
      dirName: name,
      dir,
      name: nameLine ? nameLine[1].trim() : name,
      project: projLine ? projLine[1] : '',
      bytes: Buffer.byteLength(prev, 'utf8'),
    })
  }
  return out
}

export { renderSkillMarkdownPre, validateSkillMarkdownPre } from './skill-export-pre.js'
