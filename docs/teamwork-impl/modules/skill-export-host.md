## skill-export-host

- **规模**：6,811 B / 154 行 / 9 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**Skill 导出层的宿主侧（IO 落地）**。纯渲染在 `skill-export.js`，本文件负责写盘与项目标注解析。用户拍板：⑪-2 晋升 `active` 后自动导出（host 在 activate 成功后调 `exportSkillForPre()`）；⑪-3 目录 = 用户级 `<dshHome>/skills/`。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| — | — | 无对外导出（纯内部结构） |

### 数据流

```
activate（procedure 晋升成功）
   └─ exportSkillForPre(...)  L78
        ├─ resolveSkillsRootPre(...)  L32    → <dshHome>/skills/
        ├─ projectNameFromPre(...)    L40    → 项目标注（⑪-3 要求）
        ├─ collectProgramsPre(...)    L48    → 收集附带程序
        ├─ 渲染（委托 skill-export.js 的 renderSkillMarkdownPre）
        └─ 写盘：tmp = <dir>/.SKILL.md.tmp-<pid>-<Date.now()>   L116  ← 唯一名（正确写法）
                 └─ rename → SKILL.md
   └─ listExportedSkillsPre(...)  L128   列出已导出
```

### 内部关键实现

**1. fail-soft 但可观察（设计纪律①）**

返回结构化失败（ok=false + reason），**不抛出、不静默**。这是本仓反复出现的纪律："失败必须留下可观察痕迹"（对比 `fact-store.js` 的 A-8、`hub-io.js` 的健康度记账）。

**2. tmp 名带 pid + 时间戳 L116（正确写法的正例）**

形如 `'.SKILL.md.tmp-' + process.pid + '-' + Date.now()` —— 与 `config-io.js:50` 同款。
**反例对照**：`hub-io.js:110` 与 `recall-stats.js:123` 仍是固定名。

**3. 目录是用户级、可跨项目**

`<dshHome>/skills/` 是 DSH 的**四条技能发现路径之一** ⇒ 导出即被 DSH 原生识别，**不需要额外注册**。这决定了团队技能共享可以走"共享 SKILL.md"这条低耦合路径。

### 可直接落地的代码片段

**插入位置**：skill-export-host.js:78 附近的 `exportSkillForPre`。

```js
/**
 * 团队技能导出到用户级 skills 目录 —— 复用既有 fail-soft 写盘。
 *
 * 关键纪律：临时名必须带 pid + 时间戳（L116 已是正确写法），
 * 团队高频导出会显著提高并发写同一技能的几率 ⇒ 固定名 tmp 必然撞车
 * （对照 hub-io.js:110 与 recall-stats.js:123 的同型缺陷）。
 *
 * @param {object} skill 渲染好的 SKILL.md 内容
 * @param {{groupId:string, projectName?:string}} meta
 * @returns {{ok:boolean, dir?:string, reason?:string}}
 */
export function exportTeamSkillPre(skill, meta) {
  const m = meta || {}
  if (!skill || !skill.markdown) return { ok: false, reason: 'no-content' }
  const v = validateSkillMarkdownPre(skill.markdown)
  if (!v || v.ok === false) return { ok: false, reason: 'markdown-invalid' }
  // 复用既有导出入口：目录解析、项目标注、tmp 命名全部沿用，避免第二套写盘逻辑
  return exportSkillForPre({
    title: skill.title,
    markdown: skill.markdown,
    programs: skill.programs || [],
    projectName: m.projectName || '',
    // 团队标：让导出物自身携带来源，便于用户分辨
    sourceTag: 'team:' + String(m.groupId || ''),
  })
}
```

### 与团队化的关系

**判定：团队共享（Shared）· 写盘出口。**

团队技能库的落地端。若做"团队共享技能"，本模块的 `resolveSkillsRootPre` 是**路径注入点**——团队技能可写到 `<dshHome>/skills/team-<groupId>/` 或直接写用户级并打团队标。【推断】

### Teamwork 改造要点

1. L23,SKILL_EXPORT_PREFIX_PRE_V1,导出前缀
2. L25,SKILL_EXPORT_STAMP_PRE_V1,时间戳标记
3. L32,resolveSkillsRootPre(...),技能根目录解析
4. L40,projectNameFromPre(...),项目名解析（标注用）
5. L48,collectProgramsPre(...),收集附带程序
6. L78,exportSkillForPre(...),导出入口
7. L128,listExportedSkillsPre(...),列出已导出技能

### 风险与回归

- **fail-soft 但可观察**：设计纪律①（文件头）明确"返回 `{ok:false, reason}`，不抛出、不静默"。团队导出失败必须进降级台账（`degrade.js`），否则成员看不到"技能没同步过去"。
- **临时名已带 pid + 时间戳**（`L116`：`.SKILL.md.tmp-<pid>-<Date.now()>`）——这是正确的写法，**团队化新增的任何写盘点必须照抄该模式**（对比 `hub-io.js:110` 的固定 `.tmp` 反例）。
- **导出是"晋升"的副作用**：团队治理下"晋升"可能由他人触发，导出物必须记录 `actorId`。
