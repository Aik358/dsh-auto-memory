/**
 * M9-3 Skill 导出层 · 宿主侧（IO 落地）。
 *
 * 纯渲染在 `skill-export.js`；本文件只负责**写盘**与**项目标注解析**。
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

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, readdirSync, statSync, lstatSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { renderSkillMarkdownPre, validateSkillMarkdownPre, parseFrontmatterScalarsPre } from './skill-export.js'

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

/**
 * ★#339（2026-10-13）：清理**同一 procedure 的历史导出目录**。
 *
 * 缺陷形态：目录名 = `mem-skill-<slug(title)>-<procId前12位>`（skill-export.js:84）⇒ 改一次标题就多一个
 * 目录，而旧的 SKILL.md 仍带着自检标记 ⇒ DSH 会把**同一条技能的两个旧版本**都当有效技能加载。
 * 实测：同一 procedureId 连续改两次标题 ⇒ `skillsRoot` 下留下 3 个 mem-skill- 目录，内容各不相同。
 *
 * 为什么在**落盘之后**才清扫（Lead 2026-10-13 加固要求①）：
 *   若先删后写、而新的写入失败，会变成「技能凭空消失」——比留个旧目录严重得多。
 *
 * 判据是**四个条件的交集**，缺一不删（加固要求②③）：
 *   ① `skillsRoot` 的**直属子目录**且目录名前缀 = `mem-skill-`；
 *   ② `SKILL.md` 含自检标记 `mem-skill-export-pre-v1`（⇒ 用户手写目录**一律不动**）；
 *   ③ `SKILL.md` 的「沉淀自」行里 procedure 的**全 id** 与本次**逐字相同**（不做前缀/短码匹配 ——
 *      本仓对 id 歧义的口径是 fail-closed，短码可能命中别的条目，那会**删掉别人的正常导出**）；
 *   ④ 目录名 ≠ 本次写入的目录名（本次那个刚写成功，绝不能删）。
 *
 * 删除前**再读一次** SKILL.md 复核标记与 id（加固要求⑤，防两次读之间目录被换掉的 TOCTOU）。
 *
 * @param {string} skillsRoot   技能根目录
 * @param {string} keepDirName  本次刚写入的目录名（排除对象）
 * @param {string} procedureId  本次 procedure 的**全 id**
 * @returns {{removed:string[], kept:Array<{dirName:string, reason:string}>}}
 *   kept 逐条带原因：`current`（就是本次的）/ `foreign`（非本插件产物或缺自检标记）/
 *   `other-procedure`（别的条目）/ `unreadable` / `remove-failed`。全部可见，不做静默丢弃。
 */
/**
 * ★#424（2026-10-17）：**本插件导出目录的归属判定** —— `sweepStaleSkillExportsPre` 与
 *   `retireSkillExportForPre` **共用这一份**，禁止第二套判据（本仓反复踩的「半修」坑）。
 *
 * 判据（四条件交集，缺一不认，与原 sweep 逐条同源）：
 *   ① `skillsRoot` 的**直属子目录**且目录名前缀 = `mem-skill-`；
 *   ② `SKILL.md` 含自检标记 `mem-skill-export-pre-v1`（用户手写目录一律不动）；
 *   ③ 「沉淀自」行里的 procedure **全 id**（由调用方做逐字相等比较，不做前缀/短码匹配）；
 *   ④ 目录名 ≠ 本次要保留/正在写入的目录名（由调用方在循环里判）。
 *
 * @returns {{kind:'skip'|'foreign'|'unreadable'|'ours', dirName:string, dir?:string, owner?:string, content?:string}}
 *   `skip` = 不是目录/不可访问（不产出 kept 条目，与旧实现逐字节一致）。
 */
function classifySkillExportDirPre(root, name) {
  if (!name.startsWith(SKILL_EXPORT_PREFIX_PRE_V1)) return { kind: 'foreign', dirName: name }
  const dir = join(root, name)
  try { if (!lstatSync(dir).isDirectory()) return { kind: 'skip', dirName: name } } catch (_) { return { kind: 'skip', dirName: name } }
  const content = readIfExists(join(dir, 'SKILL.md'))
  // ② 无自检标记 ⇒ 不是本插件产物（用户手写）⇒ 不碰
  if (content == null || !content.includes(SKILL_EXPORT_STAMP_PRE_V1)) return { kind: 'foreign', dirName: name }
  const idMatch = /- \*\*沉淀自\*\*：[^\r\n]*procedure `([^`]+)`/.exec(content)
  // ③ id 解析不出 ⇒ unreadable（保守保留，与旧 sweep 的 reason 取值一致）
  if (!idMatch) return { kind: 'unreadable', dirName: name, dir: dir, content: content }
  return { kind: 'ours', dirName: name, dir: dir, owner: idMatch[1], content: content }
}

/**
 * ★#424：**退休一个可证归属的导出**（sweep 与 retire 共用同一动作，不写第二份）。
 * 动作沿用既有语义（保字节优先）：
 *   · manifest 里的 sha256 == 当前 SKILL.md 的 sha256 ⇒ 内容**可证是我们生成的**、无用户改动
 *     ⇒ 删 SKILL.md + manifest；
 *   · 否则（历史版本 / 用户编辑过）⇒ rename 成 `.SKILL.md.retired-<uuid>`，**绝不丢用户字节**。
 * 目录本身由调用方 rmdir（ENOTEMPTY ⇒ 里面还有用户资源，保留目录）。
 */
function retireGeneratedExportPre(dir, content) {
  // Only SKILL.md is generated here. Other resources belong to the user.
  const manifest = readIfExists(join(dir, '.dam-skill-export.json'))
  let generatedHash = ''
  try { generatedHash = JSON.parse(manifest).sha256 } catch (_) {}
  if (generatedHash && generatedHash === createHash('sha256').update(content).digest('hex')) {
    rmSync(join(dir, 'SKILL.md'))
    rmSync(join(dir, '.dam-skill-export.json'))
    return { action: 'deleted' }
  }
  // Legacy or edited files cannot be proven generated; retire without losing bytes.
  renameSync(join(dir, 'SKILL.md'), join(dir, '.SKILL.md.retired-' + randomUUID()))
  return { action: 'renamed' }
}

export function sweepStaleSkillExportsPre(skillsRoot, keepDirName, procedureId) {
  const removed = []
  const kept = []
  const root = String(skillsRoot || '')
  const keep = String(keepDirName || '')
  const pid = String(procedureId || '')
  // id 缺失即**不清扫**：判据③依赖它做精确匹配，拿空串去比会把不匹配的全放过（反而安全）或误伤。
  if (!root || !pid) return { removed, kept }
  let entries = []
  try { entries = readdirSync(root) } catch (_) { return { removed, kept } }
  for (const name of entries) {
    if (name === keep) { kept.push({ dirName: name, reason: 'current' }); continue }
    // ①②③ 统一由 classifySkillExportDirPre 判定（与 retireSkillExportForPre 共用，不写第二套）。
    const cls = classifySkillExportDirPre(root, name)
    if (cls.kind === 'skip') continue
    if (cls.kind === 'foreign') { kept.push({ dirName: name, reason: 'foreign' }); continue }
    if (cls.kind === 'unreadable') { kept.push({ dirName: name, reason: 'unreadable' }); continue }
    // ③ 全 id 精确相等才认；别的条目 ⇒ 保留
    if (cls.owner !== pid) { kept.push({ dirName: name, reason: 'other-procedure' }); continue }
    const dir = cls.dir
    try {
      // ⑤ 删除前复核（TOCTOU 窗口收窄）：再读一次，标记与 id 仍须同时成立
      const recheck = readIfExists(join(dir, 'SKILL.md'))
      if (recheck == null || !recheck.includes(SKILL_EXPORT_STAMP_PRE_V1)) { kept.push({ dirName: name, reason: 'foreign' }); continue }
      const re = /- \*\*沉淀自\*\*：[^\r\n]*procedure `([^`]+)`/.exec(recheck)
      if (!re || re[1] !== pid) { kept.push({ dirName: name, reason: 'other-procedure' }); continue }
      retireGeneratedExportPre(dir, recheck)
      try { rmdirSync(dir) } catch (e) {
        if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e
        kept.push({ dirName: name, reason: 'user-resources-preserved' })
      }
      removed.push(name)
    } catch (_) {
      kept.push({ dirName: name, reason: 'remove-failed' })
    }
  }
  return { removed, kept }
}

/**
 * ★#424（2026-10-17）：**procedure 被明确弃用时，退休它已导出的 SKILL.md**。
 *
 * 根因：退休逻辑此前只挂在「导出成功之后」这一条路径上（`exportSkillForPre` 末尾的 sweep），
 * 而 `deprecate()` 只改 stage ⇒ **弃用这条入口从未触发退休**。于是明确弃用的技能在
 * `<dshHome>/skills/` 里仍是带自检标记的合法 SKILL.md，DSH 宿主照样加载 —— 用户以为已经停用，
 * 模型仍会看到并照做（高风险流程尤其危险）。真机证据：8 个 `mem-skill-*` 目录里 7 个在真源已无对应 procedure。
 *
 * 边界：
 *   · 编排放宿主层，**store 保持纯状态机**（procedure-store 不知道 skillsRoot）；
 *   · 只动「前缀 + 自检标记 + 沉淀自全 id 逐字相等 + 非用户手写」的目录 ——
 *     判据完全复用 classifySkillExportDirPre，**不写第二套**；
 *   · 删/改名复用 retireGeneratedExportPre（可证生成才删，否则 rename 保字节）；
 *   · 目录里还有用户资源（ENOTEMPTY）⇒ **保留目录**，只退休 SKILL.md，kept 报 user-resources-preserved；
 *   · 全程 fail-soft：任何异常都收敛成 `{ok:false, reason}` / kept 条目，**绝不抛、绝不阻断弃用本身**。
 *
 * @param {string} skillsRoot 技能根目录
 * @param {string} procedureId 目标 procedure 的**全 id**（短码/空串一律 fail closed）
 * @returns {{ok:boolean, reason?:string, procedureId:string, scanned:number, retired:Array<{dirName:string, action:string}>, kept:Array<{dirName:string, reason:string}>}}
 */
export function retireSkillExportForPre(skillsRoot, procedureId) {
  const out = { ok: false, procedureId: String(procedureId || ''), scanned: 0, retired: [], kept: [] }
  const root = String(skillsRoot || '')
  const pid = String(procedureId || '')
  if (!root) { out.reason = 'no-skills-root'; return out }
  if (!pid) { out.reason = 'no-procedure-id'; return out }
  let entries = []
  try { entries = readdirSync(root) } catch (_) { out.reason = 'skills-root-unreadable'; return out }
  for (const name of entries) {
    let cls
    try { cls = classifySkillExportDirPre(root, name) } catch (_) { out.kept.push({ dirName: name, reason: 'unreadable' }); continue }
    if (cls.kind === 'skip') continue
    out.scanned++
    if (cls.kind === 'foreign') { out.kept.push({ dirName: name, reason: 'foreign' }); continue }
    if (cls.kind === 'unreadable') { out.kept.push({ dirName: name, reason: 'unreadable' }); continue }
    if (cls.owner !== pid) { out.kept.push({ dirName: name, reason: 'other-procedure' }); continue }
    try {
      const act = retireGeneratedExportPre(cls.dir, cls.content)
      try { rmdirSync(cls.dir) } catch (e) {
        if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e
        // 目录里还有用户资源 ⇒ 只退休 SKILL.md，保留目录本身。
        out.kept.push({ dirName: name, reason: 'user-resources-preserved' })
      }
      out.retired.push({ dirName: name, action: act.action })
    } catch (e) {
      out.kept.push({ dirName: name, reason: 'remove-failed:' + String((e && e.code) || (e && e.message) || e) })
    }
  }
  out.ok = true
  return out
}

/**
 * ★#424：**只读诊断** —— 列出「真源已无此 procedure」的孤儿导出目录。
 *
 * 与 retireSkillExportForPre 的分工（对应既有裁定「技能库条目的删除或回退必须经用户批准」）：
 *   · 本函数**只列不删**，供面板提示用户确认；
 *   · 真正退休走 retireSkillExportForPre，由「弃用」这个**明确的用户动作**触发。
 *
 * @param {string} skillsRoot 技能根目录
 * @param {string[]|Set<string>} knownIds 真源现存 procedure 的**全 id** 集合
 * @returns {{ok:boolean, reason?:string, scanned:number, orphans:Array<{dirName:string, procedureId:string}>, unknown:Array<{dirName:string}>}}
 */
export function auditExportedSkillsPre(skillsRoot, knownIds) {
  const out = { ok: false, scanned: 0, orphans: [], unknown: [] }
  const root = String(skillsRoot || '')
  if (!root) { out.reason = 'no-skills-root'; return out }
  const known = knownIds instanceof Set ? knownIds : new Set(Array.isArray(knownIds) ? knownIds.map(String) : [])
  let entries = []
  try { entries = readdirSync(root) } catch (_) { out.reason = 'skills-root-unreadable'; return out }
  for (const name of entries) {
    let cls
    try { cls = classifySkillExportDirPre(root, name) } catch (_) { continue }
    if (cls.kind === 'skip' || cls.kind === 'foreign') continue
    out.scanned++
    if (cls.kind === 'unreadable') { out.unknown.push({ dirName: name }); continue }
    if (!known.has(String(cls.owner))) out.orphans.push({ dirName: name, procedureId: String(cls.owner) })
  }
  out.ok = true
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
    if (procedure && procedure.requiresApproval && !procedure.approved) return { ok: false, reason: 'high-risk-awaiting-approval' }
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
    const manifestTmp = tmp + '.manifest'
    writeFileSync(manifestTmp, JSON.stringify({ sha256: createHash('sha256').update(content).digest('hex') }), 'utf8')
    renameSync(manifestTmp, join(dir, '.dam-skill-export.json'))
    renameSync(tmp, file)

    // ★#339：**新导出确认落盘之后**才清扫同一条目的历史目录（Lead 加固要求①）。
    //   procedureId 取全 id（加固要求②）：清扫函数内部只做逐字全等匹配，绝不用前缀/短码。
    const sweep = sweepStaleSkillExportsPre(skillsRoot, r.dirName, String(procedure && procedure.procedureId || ''))
    return { ok: true, dir, file, bytes: Buffer.byteLength(content, 'utf8'), dirName: r.dirName, removed: sweep.removed, kept: sweep.kept }
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
    // ★#427（2026-10-17）：**必须走新解析器**。旧实现用 /^name:\s*(.+)$/m 取裸值，
    //   frontmatter 改成双引号标量后，这里会把**两侧引号**一并带进 GUI 显示
    //   （列表里出现 name = "mem-skill-..."）。改走 parseFrontmatterScalarsPre：
    //   解析失败（真 YAML 也读不了的历史脏文件）⇒ 回落目录名，绝不显示引号。
    const fm = parseFrontmatterScalarsPre(prev)
    const parsedName = fm.ok && typeof fm.data.name === 'string' ? fm.data.name.trim() : ''
    const projLine = /适用项目\*\*：`([^`]+)`/.exec(prev)
    out.push({
      dirName: name,
      dir,
      name: parsedName || name,
      project: projLine ? projLine[1] : '',
      bytes: Buffer.byteLength(prev, 'utf8'),
    })
  }
  return out
}

export { renderSkillMarkdownPre, validateSkillMarkdownPre, parseFrontmatterScalarsPre, yamlScalarPre, parseYamlScalarTokenPre } from './skill-export.js'
