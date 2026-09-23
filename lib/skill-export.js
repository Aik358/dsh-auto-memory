/**
 * M9-3 Skill 导出层（procedure → SKILL.md 目录束）。
 *
 * ★ 2026-09-19 用户拍板（三项）：
 *   ⑪-1 形态：`SKILL.md` + **附上过程中用到的程序**（如 `.py`），且 SKILL.md 里
 *        必须明写：这些程序**只是参考性的** —— 若当前做的事情与之前**根本不同**，
 *        可以用来**迁移**，**不能直接运行**。
 *   ⑪-2 时机：**晋升为 `active` 后自动导出**。
 *   ⑪-3 目录：**用户级**（软件层面，可跨项目迁移）；但导出物**必须标注适用于哪个项目**，
 *        项目不一样时**只作参考，不能直接用**。
 *
 * 本模块是**纯渲染层**（无 IO、无状态），便于直接单测：
 *   - `renderSkillMarkdownPre(procedure, opts)` → SKILL.md 文本
 *   - `skillDirNamePre(procedure)` → 目录名（稳定、可预测）
 *   - `SKILL_USAGE_NOTICE_PRE_V1` → 使用约束条款（导出物必须原样包含）
 *
 * 设计纪律（与 procedure 引擎同源）：
 *   ① **不新增状态源** —— 导出物是 procedure 的**派生物**，不是新的事实来源；
 *   ② **不自动执行任何导出的程序** —— 程序是**参考资料**，不是可调用入口；
 *   ③ 全部 fail-soft，但**返回可观察结果**（ok/reason），不静默。
 */

// ★ T7-b（2026-09-20）：纯计算依赖，用于给「纯中文标题」生成稳定的 ASCII 目录名。
//   node 内建模块，不引入外部依赖、不做 IO、不持有状态 —— 与本模块「纯渲染层」定位不冲突。
import { createHash } from 'node:crypto'

/** 导出物的使用约束条款 —— **必须原样出现在每个 SKILL.md 中**（用户 ⑪-1 硬要求）。 */
export const SKILL_USAGE_NOTICE_PRE_V1 = [
  '> **⚠️ 使用约束（必读）**',
  '>',
  '> 本技能由 **dsh-auto-memory** 从一次真实工作过程**自动沉淀**而来，**不是通用最佳实践**。',
  '>',
  '> 1. **附带程序仅供参考**：本目录下的脚本（如 `.py`）是**当时那次工作用过的程序**，',
  '>    **不是可直接调用的工具**。它们可能依赖当时的路径、环境变量、数据格式或版本。',
  '> 2. **场景根本不同时 → 只做迁移，不要直接运行**：若当前任务与下方「来源」描述的场景',
  '>    **有根本差异**，请把附带的程序**当作思路参考**，按当前场景**重写**，而不是直接执行。',
  '> 3. **跨项目使用须先核对**：本技能的「适用项目」若与当前项目**不一致**，',
  '>    **一律只作参考**，不得直接套用其路径、命令与判据。',
  '> 4. **高风险步骤需人工确认**：涉及删除、发布、付费、外部发送等动作，必须先向用户复述确认。',
].join('\n')

/** SKILL.md 中必须出现的约束锚点（供套件断言，防止被后续改动悄悄删掉）。 */
export const SKILL_NOTICE_ANCHORS_PRE_V1 = Object.freeze([
  '使用约束（必读）',
  '附带程序仅供参考',
  '只做迁移，不要直接运行',
  '跨项目使用须先核对',
  '高风险步骤需人工确认',
])

const MAX_TITLE_LEN = 80

/**
 * 目录名 / `name:` 字段：`mem-skill-<slug>-<procId前12位>` —— 稳定、可预测、不冲突。
 *
 * ★ T7-b（2026-09-20 用户报「所有中文技能都叫 untitled」）修复：
 *   **根因**：原实现 `title.replace(/[^a-z0-9]+/g,'-')` 只保留 ASCII ⇒ **纯中文标题 slug 成空串**
 *   ⇒ 一律回落字面量 `'untitled'`。后果是每个中文技能都叫 `mem-skill-untitled-<id>`，
 *   用户看到的技能列表名字毫无意义（实测：本机导出的
 *   `~/.dsh/skills/mem-skill-untitled-aa2153f33507/SKILL.md`）。
 *
 *   **为什么不能用「保留中文」这个修法**：DSH 宿主对 skill name 是**硬校验**，不是建议 ——
 *   `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（宿主 `index.js:17`），且
 *   `:481` 直接 `throw new Error('loaded skill has invalid name "…"')`。
 *   ⇒ 中文进 name 会让**技能加载直接失败**（比 untitled 更糟）。故必须产出 ASCII 安全名。
 *
 *   **采用的修法**：slug 为空时，取标题的 **sha1 前 8 位十六进制**做 `t-<hash>` 前缀。
 *   - ASCII 安全：`t-1a2b3c4d` 完全符合上面的 SKILL_NAME 正则；
 *   - 稳定：同一 title ⇒ 同一 hash ⇒ 目录名不变（自动化重导出不会产生新目录）；
 *   - 可区分：不同标题 hash 不同，不再出现「一堆 untitled」；
 *   - 中文原文**不丢**：仍完整出现在 SKILL.md 的 `# <title>` 与 `description` 里，
 *     用户/模型在技能列表看到的是中文标题，name 只承担「唯一标识」职责。
 *
 *   ⚠️ 哈希算法用 node 内建 `createHash('sha1')`（纯计算，不引入 IO/状态），
 *   与 FNV-1a 那种"自造哈希"区分开 —— 本仓有过 sha256Hex 同名异义的教训（#86-1）。
 */
export function skillDirNamePre(procedure) {
  const id = String((procedure && procedure.procedureId) || '')
  const short = id.replace(/^proc_pre_/, '').slice(0, 12)
  const title = String((procedure && procedure.title) || '')
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  // 纯中文（或纯符号）标题：ASCII slug 为空 ⇒ 用标题哈希代替，绝不留 'untitled'
  const stem = slug || ('t-' + createHash('sha1').update(title, 'utf8').digest('hex').slice(0, 8))
  return 'mem-skill-' + stem + '-' + (short || 'noid')
}

/** 一句话摘要（取步骤首条或标题）——用于 SKILL.md 的 description。 */
/**
 * 一句话摘要 —— 用于 SKILL.md 的 `description:` 字段。
 *
 * ★ T7-b（2026-09-20）修正取值优先级：**title 优先，steps[0] 兜底**（原来是反的）。
 *   为什么反了不行：`description` 是模型在技能目录里看到的那句话，应当回答
 *   「这个技能**是干什么的**」—— title 正是这件事；而 steps[0] 是**第一个动作**
 *   （实测导出的描述成了「备份：Copy-Item lib/index.js …」，完全看不出技能用途）。
 *   仅当 title 缺失时才用 steps[0] 兜底（此时有总比没有好）。
 */
function summaryOfPre(p) {
  const t = String(p.title || '').trim()
  const step = Array.isArray(p.steps) && p.steps.length ? String(p.steps[0]).trim() : ''
  const s = t || step
  return s.length > MAX_TITLE_LEN ? s.slice(0, MAX_TITLE_LEN - 1) + '…' : s
}

/**
 * 渲染 SKILL.md。
 *
 * @param {object} procedure  procedure 记录（stage 应为 active）
 * @param {object} opts
 * @param {string} opts.projectName   适用项目名（**必填**，⑪-3）
 * @param {string} opts.projectPath   项目根绝对路径（用于溯源）
 * @param {string[]} opts.programs     附带程序文件名列表（⑪-1，仅列名）
 * @param {string} opts.exportedAt    导出时间（ISO 字符串；缺省由调用方给）
 * @returns {{ok:true, fileName:string, dirName:string, content:string} | {ok:false, reason:string}}
 */
export function renderSkillMarkdownPre(procedure, opts = {}) {
  const p = procedure || {}
  if (!p.procedureId) return { ok: false, reason: 'no-procedure-id' }
  if (!p.title) return { ok: false, reason: 'no-title' }
  const projectName = String(opts.projectName || '').trim()
  if (!projectName) return { ok: false, reason: 'no-project-name' }   // ⑪-3 硬要求：必须标项目
  const projectPath = String(opts.projectPath || '').trim()
  const programs = Array.isArray(opts.programs) ? opts.programs.filter(Boolean).map(String) : []
  const exportedAt = String(opts.exportedAt || '')

  const L = []
  L.push('---')
  L.push('name: ' + skillDirNamePre(p))
  L.push('description: ' + summaryOfPre(p).replace(/\r?\n/g, ' '))
  L.push('---')
  L.push('')
  L.push('# ' + String(p.title).trim())
  L.push('')
  L.push(SKILL_USAGE_NOTICE_PRE_V1)
  L.push('')

  // ── 来源（⑪-3：必须标注适用于哪个项目）──
  L.push('## 来源')
  L.push('')
  L.push('- **适用项目**：`' + projectName + '`' + (projectPath ? '（`' + projectPath + '`）' : ''))
  L.push('- **沉淀自**：dsh-auto-memory 技能库（procedure `' + p.procedureId + '`）')
  if (p.riskLevel) L.push('- **风险等级**：`' + p.riskLevel + '`' + (p.requiresApproval ? '（需人工批准）' : ''))
  if (exportedAt) L.push('- **导出时间**：' + exportedAt)
  L.push('')
  L.push('> 若你的当前项目**不是** `' + projectName + '`，请**只作参考**，不要直接套用下方路径与命令。')
  L.push('')

  // ── 适用条件 ──
  if (Array.isArray(p.preconditions) && p.preconditions.length) {
    L.push('## 何时适用')
    L.push('')
    for (const x of p.preconditions) L.push('- ' + String(x))
    L.push('')
  }

  // ── 步骤 ──
  if (Array.isArray(p.steps) && p.steps.length) {
    L.push('## 步骤')
    L.push('')
    p.steps.forEach((s, i) => L.push(String(i + 1) + '. ' + String(s)))
    L.push('')
  }

  // ── 检查点 ──
  if (Array.isArray(p.checks) && p.checks.length) {
    L.push('## 检查点')
    L.push('')
    for (const x of p.checks) L.push('- [ ] ' + String(x))
    L.push('')
  }

  // ── 成功判据 ──
  if (Array.isArray(p.successCriteria) && p.successCriteria.length) {
    L.push('## 成功判据')
    L.push('')
    for (const x of p.successCriteria) L.push('- ' + String(x))
    L.push('')
  }

  // ── 回滚 ──
  if (Array.isArray(p.rollback) && p.rollback.length) {
    L.push('## 回滚')
    L.push('')
    for (const x of p.rollback) L.push('- ' + String(x))
    L.push('')
  }

  // ── 附带程序（⑪-1）──
  if (programs.length) {
    L.push('## 附带程序（**参考性**）')
    L.push('')
    L.push('以下文件是**当时那次工作用过的程序**，随本技能一起导出：')
    L.push('')
    for (const f of programs) L.push('- `' + f + '`')
    L.push('')
    L.push('> **不要直接运行**。先读一遍，判断它与当前场景的差异；')
    L.push('> 若场景根本不同，请**按当前场景迁移重写**；确需运行时，先向用户说明并确认。')
    L.push('')
  }

  // ── 证据 ──
  if (Array.isArray(p.sourceEpisodes) && p.sourceEpisodes.length) {
    L.push('## 依据')
    L.push('')
    L.push('- 来源 episode 数：' + p.sourceEpisodes.length)
    if (p.evidence && typeof p.evidence === 'object') {
      const ev = p.evidence
      const parts = []
      if (Number.isFinite(ev.seen)) parts.push('seen=' + ev.seen)
      if (Number.isFinite(ev.success)) parts.push('success=' + ev.success)
      if (Number.isFinite(ev.correction)) parts.push('correction=' + ev.correction)
      if (parts.length) L.push('- 证据统计：' + parts.join(' / '))
    }
    L.push('')
  }

  return { ok: true, fileName: 'SKILL.md', dirName: skillDirNamePre(p), content: L.join('\n') + '\n' }
}

/**
 * 导出完整性校验（供套件与调用方共用）。
 * **判据是"用户 ⑪-1/⑪-3 的硬要求"本身**，不是实现细节。
 */
export function validateSkillMarkdownPre(content, expect = {}) {
  const s = String(content == null ? '' : content)
  const problems = []
  if (!s.trim()) problems.push('empty')
  for (const a of SKILL_NOTICE_ANCHORS_PRE_V1) if (!s.includes(a)) problems.push('missing-notice:' + a)
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(s)) problems.push('no-frontmatter')
  if (!/^name:\s*\S+/m.test(s)) problems.push('no-name')
  if (!/^description:\s*\S+/m.test(s)) problems.push('no-description')
  if (expect.projectName && !s.includes('`' + expect.projectName + '`')) problems.push('no-project-tag')
  // ⑪-1：附带程序必须被运行约束**包裹**，而不是只列个名。
  // ★ 判据必须锚定属于「程序块」的形态：
  //   顶层约束条款里也出现「不要直接运行」四字（后接 `**：`），
  //   只用该四字做判据会**同义反复**（永远为真）——套件 [5] 组已实跑抓到这一版缺陷。
  //   程序块独有形态 = 加粗短语**后紧跟句号**：`**不要直接运行**。`
  if (expect.hasPrograms && !/\*\*不要直接运行\*\*。/.test(s)) problems.push('programs-not-constrained')
  return { ok: problems.length === 0, problems }
}
