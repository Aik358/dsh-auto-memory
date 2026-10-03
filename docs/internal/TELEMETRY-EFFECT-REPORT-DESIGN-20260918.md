# 用户端「效果统计与回传」设计（2026-09-18 立项稿）

> 状态：**设计定稿，实现后置**（排在「Surface 前端重构之后、S 层之前」）
> 用户原话：「我希望把这个统计功能扩展一下，也给用户们装上，让用户收集一下这个插件的效果，
> 比如有效性。用户可以选择是否通过 GitHub 或者通过 QQ 群发给我」

---

## 0. 一句话

**把已有的观测面（degrade 台账 + 配额探针 + tier0Meta）派生成一份「效果报告」，
用户在本地看一眼、自己决定要不要发回来。插件永远不主动联网。**

---

## 1. 三条硬红线（不可协商）

| # | 红线 | 理由 |
|---|---|---|
| **R1** | **插件自身绝不发起网络请求** | 这是**记忆插件**，数据面本身就是隐私面。回传只能是"用户手动搬运"，不能是"插件悄悄上报" |
| **R2** | **报告只含聚合量，绝不含内容** | 禁止出现：记忆正文、文件路径、查询词、会话 ID、模型名、分钟级时间戳。只允许：计数 / 比例 / **分桶** / 布尔 / schema 版本 |
| **R3** | **发送永远是显式动作** | 本地生成报告 = 随时可做（纯派生，无副作用）；**发出去** = 用户点按钮/复制粘贴，且事先能看到全文 |

> **为什么这么严**：本仓已发布 npm 3.0.0，有真实用户与年下载量。
> 普通插件的遥测泄漏是"行为数据"，记忆插件的遥测泄漏是**用户自己写下的东西**。量级不同。

---

## 2. 与既有观测面的关系（守 S10.4）

**不新建状态源** —— 报告是**纯函数派生**，数据全部来自已经存在的东西：

| 数据 | 来源 | 现状 |
|---|---|---|
| 降级频次/种类 | `degrade-pre/latest.json` 的 degrade 段 | ✅ R1–R3 已有 |
| 配额判定四档、各层丢弃率 | 同文件的 `quota` 段 | ✅ R4 第 2 批已有 |
| 注入侧 items/candidates/dropped/perLayer/tokens | `tier0Meta` | ✅ 已有 |
| 配置开关 | 配置快照，**只取布尔/枚举，不取值** | ✅ 已有 |
| 召回层分布、compaction 原因分布 | — | ⚠️ **需新增少量计数器** |

### 2.1 唯一的新增状态（有界计数器）

为回答「有效性」必须有的、目前**没有**的计数：

```
recall:      calls / withHits / emptyRate / layerMix{结论层,流水层,其他}
injection:   tokensPerTurn(均值) / droppedPerTurn(均值) / perLayerDropRate
compaction:  count / reasons{成功,no-removable,still-over-capacity} / recoveredChars
scale:       daysInstalled / sessions / entries / logLines   ← 全部**分桶**
```

全部落进**同一个有界计数器对象**（复用 `lib/degrade-pre.js`，与 `quota` 并列），
仍不新建文件、不新建配置键。**`layerMix` 是重点**：它直接回答
「R4-B 的分层展示有没有让结论层真的浮出来」。

---

## 3. 报告形态

```jsonc
{
  "reportSchemaVersion": "am_effect_report_v1",   // 必需：作者要能解析异构报告
  "generatedAt": "2026-09-18",                     // ★ 只到天
  "plugin": { "version": "3.1.0", "dshVersion": "x.y.z" },  // 版本必需，否则无法归因

  "scale": {                    // ★ 全部分桶，绝不给精确值（防指纹）
    "daysInstalled": "30-90",
    "sessions": "50-200",
    "entries": "100-500",
    "logLines": "500-2000"
  },

  "features": {                 // 只有布尔/枚举，没有具体数值
    "boardMode": "graph",
    "handoffEnabled": true,
    "semanticEngine": "js",
    "pythonBackendEnabled": false
  },

  "effectiveness": {
    "recall":     { "calls": 412, "withHits": 380, "emptyRate": 0.078,
                    "layerMix": { "project": 0.31, "log": 0.52, "whiteboard": 0.09, "other": 0.08 } },
    "injection":  { "tokensPerTurnAvg": 812, "droppedPerTurnAvg": 3.4,
                    "perLayerDropRate": { "log": 0.61, "reflection": 0.12 } },
    "compaction": { "count": 7, "reasons": { "ok": 6, "no-removable": 1 }, "recoveredChars": 18240 }
  },

  "health": {
    "degradeCounts": { "semantic-arm": 2, "tier0-catalog": 0 },
    "quotaVerdict": "balanced",
    "degradedArms": ["c3(python)→c2(js)"]
  },

  "userReport": {               // ★★ 主观部分 —— 这才是「有效性」的核心
    "rating": null,             // 1–5，默认空，用户填
    "helpedMost": "",           // 自由文本，默认空
    "broke": ""                 // 遇到的问题，默认空
  }
}
```

**关键设计**：`userReport` **默认全空**。有效性由**用户说**，不由插件猜 ——
插件只提供客观事实（计数、分布、健康度），主观评价留给填写。
这也顺带避免了"用行为指标冒充有效性"的构念效度问题。

---

## 4. 两条回传通道

### 4.1 GitHub
- 面板按钮「生成报告」→ 展示全文 → 「复制并打开 Issue」
- 打开预填 URL：
  `https://github.com/Aik358/dsh-auto-memory/issues/new?title=<enc>&body=<enc>`
- **本机凭据只有 `pull: true` 权限**，所以这条路**只能由用户点** —— 与设计天然一致。

### 4.2 QQ 群
- 同一份文本，前面附一段可删的说明模板，用户复制后自行粘贴。

### 4.3 附带：AI 侧工具
提供 `memory_telemetry_report`（无参）——用户对 AI 说「生成效果报告」即可产出，
比翻面板更顺手；输出与面板完全同源（同一派生函数），**不做第二套渲染**（沿用 M1 的纪律）。

---

## 5. 为什么建议「设计现在写、实现最后做」

1. **UI 要长在 `lib/client.js` 上，而你正要重构 Surface 前端** —— 今晚做按钮，重构后大概率返工。
2. **隐私面需要冷静设计** —— 凌晨赶工最容易漏字段；这条红线漏一次就无法挽回。
3. **依赖今晚的收尾** —— 要统计的「层分布」「compaction 原因分布」正是 R4/G3 正在改的地方，
   等它们定稿，计数器不用改两遍。
4. **设计文档现在写成本≈0**，且能把今天的讨论结论固定下来不丢。

→ **落位：Surface 前端重构之后、S 层之前**（正好是用户说的「万事俱备」那一刻）。

---

## 6. ⚠️ 若这批数据将来用于毕业论文，须额外注意

用户论文方向与本系统强相关（`docs/internal/THESIS-OUTLINE-20260918.md`）。
**真实用户效果数据对论文极有价值**（正好补上"无对外 baseline / 无真实用户数据"的缺口），
但因此**同意文本的措辞就变成研究伦理问题**，不是产品文案问题：

- 报告页需明确写：数据用于什么、谁会看到、是否匿名、能否撤回
- 分桶设计本身是良好的去标识化，但 `userReport` 的自由文本**可能含个人信息**
  → 该字段必须由用户**逐字确认**后再发，且提示"请勿填写隐私内容"
- 若要做正式研究，需要走伦理审查（见论文缺口分析的"伦理许可"项）
