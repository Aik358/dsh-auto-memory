## intent-clean-safe

- **规模**：16,812 B / 259 行 / 3 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**运行时信封剥离器 —— 结构判据版**（R5）。只在**未被引用/未被代码块包裹的行**上剥离信封，保护字面示例与代码块。根因（issue #30 / Hermes 遗留 H-3）：旧实现在 `:17` 用**一条字面量行首白名单**识别信封 ⇒ 只能挡住两个当期已知形态；真机取证（`procedures.json` 10 条 procedure 里 7 条 observed、其中 4 条 title 就是运行时信封）实测漏网 4 类，含 `Approval prompts are disabled…`、工具回包 JSON 转储、中文「当前运行时上下文。」。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L149 | `looksRuntimeResiduePre(...)` | 残留判据（结构式） |
| L191 | `stripRuntimeIntentPre(...)` | 剥离函数（主入口） |
| L249 | `RUNTIME_ENVELOPE_PRE_V1` | 信封模式集（结构判据） |

### 数据流

```
候选 intent 文本
   └─ stripRuntimeIntentPre(text, opts)   L191   ← 主入口
        ├─ 逐行判断：
        │    ├─ 行**被引用**（前缀 > / 缩进引用）→ **不剥离**（保护字面示例）
        │    ├─ 行**在代码块内**（三反引号围栏）    → **不剥离**（保护代码）
        │    └─ 其他行 → looksRuntimeResiduePre(line)  L149  结构判据
        │                  命中 RUNTIME_ENVELOPE_PRE_V1  L249 中的形态 → 剥离
        └─ 返回剥离后文本
```

### 内部关键实现

**1. 根因：字面白名单只能挡住"当期已知形态"（issue #30 / H-3）**

旧实现在 `:17` 用**一条字面量行首白名单**（匹配 "current runtime context." 或 "current dsh file policy:"）识别信封。
真机取证（`~/.dsh/memory/hub-pre/procedures.json`）：**10 条 procedure 里 7 条 observed、其中 4 条 title 就是运行时信封**。实测漏网 4 类：

| 漏网形态 | 样例 |
|---|---|
| 审批提示 | `Approval prompts are disabled in this session: …` |
| 工具回包 JSON | `{"path":"D:\\…` |
| 中文信封 | 「当前运行时上下文。」 |
| （第 4 类） | 见源码注释 |

**2. 结构判据取代字面白名单**

`RUNTIME_ENVELOPE_PRE_V1`（L249）是**结构模式集合**，不再依赖"已知字符串列表"。⇒ 新形态应加进该集合，**而不是新加白名单分支**。

**3. 保护引用与代码块是安全边界**

只在**未被引用/未被代码块包裹**的行上剥离 ⇒ 防止误删用户正文中的字面示例与代码。

**4. 被直接依赖**

`procedure-store.js` 顶部 import 本模块的 `stripRuntimeIntentPre`；`memory-hub.js` 同时 import `stripRuntimeIntentPre` 与 `looksRuntimeResiduePre`。

### 可直接落地的代码片段

**插入位置**：intent-clean-safe.js:191 附近的 `stripRuntimeIntentPre`。

```js
/**
 * 团队信封形态登记 —— 新形态加进**结构判据集合**，不加新白名单分支。
 *
 * 根因（issue #30 / H-3）：旧实现用"一条字面量行首白名单"，只能挡住当期已知形态，
 * 实测漏网 4 类（含中文信封与工具回包 JSON）⇒ title 直接变成运行时信封。
 * 团队化会引入新的信封形态（如"你正在以团队成员身份工作…"），
 * 若再走白名单，必然重蹈同一事故。
 *
 * @param {string} line 单行文本
 * @returns {{residue:boolean, kind:string|null}}
 */
export function classifyTeamEnvelopeLinePre(line) {
  const s = String(line || '')
  if (!s.trim()) return { residue: false, kind: null }
  // 结构判据（与 RUNTIME_ENVELOPE_PRE_V1 同款思路）：
  //   ① 已知前缀  ② "以…身份" 类角色声明  ③ 纯 JSON 对象转储  ④ 中文信封
  if (looksRuntimeResiduePre(s)) return { residue: true, kind: 'known-envelope' }
  if (/^你是[^\n]{0,40}(身份|成员|角色)/.test(s)) return { residue: true, kind: 'role-declaration' }
  if (/^\s*[\{\[]/.test(s) && /"[a-z_]+"\s*:/.test(s)) return { residue: true, kind: 'json-dump' }
  if (/^\s*(当前运行时上下文|运行时环境|系统提示)/.test(s)) return { residue: true, kind: 'cjk-envelope' }
  return { residue: false, kind: null }
}
```

### 关联行号索引

- lib/intent-clean-safe.js:149
- lib/intent-clean-safe.js:191
- lib/intent-clean-safe.js:249

### 与团队化的关系

**判定：派生重算（Derived）· 纯函数。**

同 `intent-clean`：采集端加工，无同步状态。但**本模块是当前应当使用的那一版**，团队化的一切采集清洗都应基于它。

### Teamwork 改造要点

1. **结构判据必须持续扩展**：本次事故的根因就是"字面白名单只能挡住当期已知形态"。团队化会引入**新的信封形态**（如"你正在以团队成员身份工作…"），必须把新形态加进 `RUNTIME_ENVELOPE_PRE_V1` 而不是新加一个白名单分支。
2. **保护引用与代码块的性质不可退化**：只在未被引用/未被代码块包裹的行上剥离——这是防止误删用户内容的安全边界。
3. **被 `procedure-store` / `memory-hub` 直接依赖**（见 `procedure-store.js` 顶部 import），改动会影响技能污染判定。

### 风险与回归

- 回归：4 类实测漏网形态（含中文与 JSON 转储）必须都有断言。
- `RUNTIME_ENVELOPE_PRE_V1` 是结构判据集合，新增成员需同步测试（字符串枚举静默忽略问题）。
