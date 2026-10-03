## skill-export

- **规模**：12,560 B / 240 行 / 5 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**M9-3 Skill 导出层**（procedure → SKILL.md 目录束）。用户 2026-09-19 拍板三项：⑪-1 形态 = `SKILL.md` + 附上过程中用到的程序，且必须明写"只是参考性的、不能直接运行"；⑪-2 时机 = **晋升为 `active` 后自动导出**；⑪-3 目录 = **用户级**（跨项目迁移），但必须标注适用项目。本模块是**纯渲染层**（无 IO、无状态）。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L28 | `SKILL_USAGE_NOTICE_PRE_V1` | 使用须知文案（必含） |
| L43 | `SKILL_NOTICE_ANCHORS_PRE_V1` | 须知锚点（供守卫断言） |
| L77 | `skillDirNamePre(title)` | 技能目录名 |
| L115 | `renderSkillMarkdownPre(proc,...)` | 渲染 SKILL.md |
| L223 | `validateSkillMarkdownPre(md)` | 渲染结果校验 |

### 数据流

```
procedure（stage = 'active'）
   └─ renderSkillMarkdownPre(proc, programs, ...)  L115   ← 纯渲染，无 IO
        ├─ skillDirNamePre(title)  L77
        ├─ SKILL_USAGE_NOTICE_PRE_V1  L28   **必含**（"只是参考性的，不能直接运行"）
        ├─ SKILL_NOTICE_ANCHORS_PRE_V1 L43  供守卫断言的锚点
        └─ validateSkillMarkdownPre(md)  L223   ← 质量门
             ▼
        SKILL.md 文本
             │（IO 由 skill-export-host.js 负责）
             ▼
        <dshHome>/skills/<技能名>/SKILL.md     ← DSH 四条发现路径之一
```

### 内部关键实现

**1. 用户 2026-09-19 拍板三项（文件头逐字）**

| 项 | 内容 |
|---|---|
| ⑪-1 形态 | `SKILL.md` + 附上过程中用到的程序（如 `.py`）；**必须明写**这些程序只是参考性的 —— 若当前做的事与之前**根本不同**，可用来**迁移**，**不能直接运行** |
| ⑫-2 时机 | **晋升为 `active` 后自动导出** |
| ⑬-3 目录 | **用户级**（软件层面，可跨项目迁移）；但导出物**必须标注适用于哪个项目**，项目不一样时**只作参考，不能直接用** |

**2. 纯渲染层（无 IO、无状态）**

文件头明确"便于直接单测"。这是本模块能被回归锁定的原因，也是它适合被团队化复用的原因（加参数即可，不需要 mock 网络）。

**3. SKILL_NOTICE_ANCHORS_PRE_V1 是守卫锚点**

既有约定：给"已被字符串锚定守卫固化的 UI 段"做改造，首选追加式覆盖。本模块的锚点常量正是为这类守卫服务。

### 可直接落地的代码片段

**插入位置**：skill-export.js:115 附近的 `renderSkillMarkdownPre`。

```js
/**
 * 团队技能的来源与验证范围标注 —— ⑪-3 要求"标注适用项目"的团队扩展。
 *
 * 为什么必须标注验证范围：共享 SKILL.md 的核心风险是"别人照着做但环境不同"。
 * 把 procedure.evidence 的跨会话多样性渲染出来，读者才能判断可信度。
 *
 * @param {object} proc procedure 条目
 * @returns {string} 追加到 SKILL.md 末尾的标注段
 */
export function renderTeamProvenancePre(proc) {
  const p = proc || {}
  const ev = p.evidence || {}
  const sessions = Number(ev.sessions) || 0
  const success = Number(ev.success) || 0
  const correction = Number(ev.correction) || 0
  const lines = []
  lines.push('')
  lines.push('## 团队来源与验证范围')
  lines.push('- 来源成员：' + String(p.originActorId || '未标注'))
  lines.push('- 跨会话验证：' + sessions + ' 个独立会话，成功 ' + success + ' 次，纠正 ' + correction + ' 次')
  lines.push('- **适用范围**：仅在与来源项目同类环境时参考；环境不同请按当前实际情况调整步骤。')
  return lines.join(String.fromCharCode(10))
}
```

### 关联行号索引

- lib/skill-export.js:28
- lib/skill-export.js:115
- lib/skill-export.js:223

### 与团队化的关系

**判定：团队共享（Shared）· 团队技能库的天然载体。**

**这是团队化的高价值出口**：`procedure` 晋升为 `active` 后导出成 `SKILL.md`，团队成员共享后可直接被各自 DSH 发现（`<dshHome>/skills/` 是 DSH 四条发现路径之一）。⇒ 团队技能库可以**复用 DSH 原生技能发现机制**，不必自造。

### Teamwork 改造要点

1. **团队技能标注必须扩展**：⑪-3 已要求"标注适用项目"，团队场景还要标注**来源成员与验证范围**（"该技能由 A/B/C 三人验证，跨 3 个会话"）——这正好可以复用 `procedure.evidence`。
2. **渲染保持纯函数**：无 IO、无状态是它能被直接单测的原因。团队化新增字段只应加参数，不得让渲染层去读网络或文件。
3. **`validateSkillMarkdownPre` 是质量门**：团队共享前必须过这道校验，防止缺"使用须知"的技能流入团队库。

### 风险与回归

- 回归：`SKILL_NOTICE_ANCHORS_PRE_V1` 被守卫锁定（文案锚点），改动文案会打红。
- 导出物会被 DSH 原生加载 ⇒ 渲染结果的格式错误会直接影响技能发现。
