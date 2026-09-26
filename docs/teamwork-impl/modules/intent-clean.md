## intent-clean

- **规模**：3,852 B / 71 行 / 3 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**M8 采集侧 intent 清洗**。episode 的 intent 来自"本轮最后一条 user 文本"，而该文本在真实运行时常被三种形态污染（已实录于 `~/.dsh/memory/hub-pre/episodes.json`）：①harness 注入的上下文快照（以 `Current runtime context. This snapshot supersedes…` 开头）；②工具回包（role 也是 user，但 `eventType='tool/result'`，正文是 JSON 转储）；③行号引用文本。抽出为纯函数后，真实形态全部变成可重复执行的断言。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L41 | `stripInjectedBlockPre(...)` | 剥离注入块（基础版） |
| L46 | `isInjectedContextTextPre(...)` | 注入文本判据 |
| L56 | `pickConsolidationTextPre(...)` | 挑选可巩固文本 |

### 数据流

```
consolidateTurn 取到「本轮最后一条 user 文本」
        │  （三种污染形态）
        ├─ ① harness 注入的上下文快照（以 "Current runtime context. …" 开头）
        ├─ ② 工具回包（role 也是 user，但 eventType = 'tool/result'，正文是 JSON 转储）
        └─ ③ 行号引用文本（同属工具回包，形如 "436: ## 2026-08-25"）
        │
        ▼
  pickConsolidationTextPre(...)  L56   ← 挑选可巩固文本
        ├─ isInjectedContextTextPre(...)  L46   注入判据
        └─ stripInjectedBlockPre(...)     L41   剥离
        │
        ▼
  干净的 intent → episodic-store.append(seg)
```

### 内部关键实现

**1. 为什么抽成纯函数（文件头）**

三层修复原本**内联在 `lib/index.js` consolidateTurn 的 for 循环里**，只能靠「用户自然对话两轮」实机验证，**无法回归锁定**。抽出后，上述真实形态全部变成**可重复执行的断言**。

**2. 三种污染形态都有实录用例**

出处：`~/.dsh/memory/hub-pre/episodes.json`（真实运行记录，非构造样本）。

**3. 已被结构判据版取代**

本模块是**基础版**（字面白名单）。`intent-clean-safe.js` 是 R5 的**结构判据版**，实测基础版漏网 4 类形态。⇒ 团队化应基于 safe 版，本模块仅作兼容保留。

### 可直接落地的代码片段

**插入位置**：intent-clean.js:56 附近的 `pickConsolidationTextPre`。

```js
/**
 * 清洗器版本随投影外传 —— 团队两端必须用**同一版清洗规则**。
 *
 * 为什么必须带版本：同一段文本在 A 端与 B 端若被清洗成不同结果，
 * 会产出不一致的 intent ⇒ 下游 fact/procedure 提取在两端出现分叉，
 * 且症状是"同一个会话在两台机器上总结出不同结论"，极难定位。
 *
 * @param {object} proj 投影对象
 * @returns {object} 带 cleanerVersion 的投影
 */
export function withCleanerVersionPre(proj) {
  const p = (proj && typeof proj === 'object') ? Object.assign({}, proj) : {}
  // 基础版标识：结构判据版（intent-clean-safe.js）用 'safe-v1'，本模块用 'basic-v1'
  p.cleanerVersion = 'basic-v1'
  return p
}

/**
 * 版本兼容检查 —— 不一致时**拒绝合并**（fail closed），而不是尽力而为。
 * @param {string} localV
 * @param {string} remoteV
 * @returns {{ok:boolean, reason?:string}}
 */
export function assertCleanerCompatPre(localV, remoteV) {
  const a = String(localV || ''), b = String(remoteV || '')
  if (!b) return { ok: false, reason: 'remote-cleaner-version-missing' }
  if (a === b) return { ok: true }
  return { ok: false, reason: 'cleaner-version-mismatch:' + a + '!=' + b }
}
```

### 关联行号索引

- lib/intent-clean.js:41
- lib/intent-clean.js:46
- lib/intent-clean.js:56

### 与团队化的关系

**判定：派生重算（Derived）· 纯函数。**

清洗是**在采集端**做的，属于数据加工步骤，不产生需要同步的状态。团队化后各端各自清洗即可——但**清洗规则版本必须一致**，否则同一段文本在 A/B 端会被清洗成不同结果。

### Teamwork 改造要点

1. **清洗规则需版本化**：团队成员的清洗器版本若不同，会产出不一致的 intent ⇒ 影响后续 fact/procedure 提取的一致性。建议在投影里带 `cleanerVersion`。
2. **优先使用 `intent-clean-safe.js`（结构判据版）**：本模块是基础版（字面白名单），已被 R5 版本取代。团队化不应基于基础版新写逻辑。
3. **不参与同步**。

### 风险与回归

- 回归：三种污染形态各有实录用例，必须保持可断言。
- `pickConsolidationTextPre` 的挑选顺序（最后一条有效 user 文本）是行为契约，改动会影响 episode intent 质量。
