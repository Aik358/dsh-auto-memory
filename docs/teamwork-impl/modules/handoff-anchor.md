
## handoff-anchor

- **规模**：5,321 B / 115 行 / 3 个导出符号
- **交付形态**：**完整版**

### 职责

P6（2026-09-09）**账本权重化截断纯核心**（`handoff_ledger_weight_pre_v1`）。
交接账本是**四段式**（任务状态 / 目标 / 已试方案与失败原因 / 进度与下一步）；当账本超过预算需要截断时，**不能简单地砍尾部** —— 各段的"信息价值"不同，必须**按权重决定谁先被截**。

### 数据流

```
账本全文（含 '# 交接账本 · …' 大标题 + 若干 '## ' 段）
   │
   ▼
parseHandoffLedgerPre(text)   L41
   ├─ 逐行：/^## (.+)$/ 开新段
   ├─ 首个标题前的内容 → preamble（大标题等）
   ├─ 每段：{ title（原样行，含 '## '）, body（原始行）, weight }
   └─ 无任何 '## ' 段或非法 → **null（fail closed）**
        │
        ▼
weightedTrimHandoffLedgerPre(text, budget)   L91
   ├─ 权重表 HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1  L18（降序）
   │    已试方案与失败原因 0.35 > 进度与下一步 0.30 > 目标 0.20 > 任务状态 0.15
   │    未知 '## ' 段 → UNKNOWN_WEIGHT = 0.05（最先被截）
   └─ 超预算 ⇒ 按权重从低到高截，插入 TRIM_MARK  L28
        │
        ▼
   截断后账本（保留 preamble 与高权值段）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L15 | `HANDOFF_LEDGER_WEIGHT_VERSION` | `handoff_ledger_weight_pre_v1` |
| L18 | `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` | **四段权重表（冻结）** |
| L41 | `parseHandoffLedgerPre(text)` | 解析为 preamble + sections |
| L91 | `weightedTrimHandoffLedgerPre(text, budget)` | 权重化截断 |

### 内部关键实现

**1. 权重表的设计意图（L18-23）**

| 段 | 权重 | 为什么 |
|---|---:|---|
| 已试方案与失败原因 | 0.35 | **最高** —— 防止下一个上下文窗口重蹈覆辙；这是交接最不可替代的信息 |
| 进度与下一步 | 0.30 | 次高 —— 决定能否继续干活 |
| 目标 | 0.20 | 中 —— 通常简短，且从标题可部分恢复 |
| 任务状态 | 0.15 | 最低 —— 最容易从其他段推断 |

**2. 未知段 = 0.05（最先被截）L27**

注释逐字：*"未知 '## ' 段:权重最低（最先被截），但仍保留标题与内容直到轮到它"*。⇒ **未知段不会被直接删除**，只是最后才轮到。

**3. 解析必须保留原样行（L36-37）**

*"title 保留原样行（含 '## ' 前缀，容忍尾随 ）；body 为两标题行之间的原始行（**不做 trim，保证原样回装**）"*。
⇒ 回装后对无 `\r` 输入**逐字节还原**。这与本仓 EOL 纪律（lib/*.js 纯 CRLF）直接相关。

**4. fail closed L39**

无任何 `## ` 段 ⇒ 返回 `null`（不猜、不造结构）。

**5. 与 `ledger-criteria.js` 的关系**

`ledger-criteria.js:20` import 本模块的 `parseHandoffLedgerPre`，`:23` 定义的四段权威标题与本地 `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` 同源。⇒ **两处共享同一份段名真源**（不得各写一份）。

### 与团队化的关系

**判定：S2 团队共享（交接账本是团队协作产物）。**

理由：交接账本的用途正是"给下一个上下文窗口续命"。团队场景下，**下一个窗口可能是另一名成员** ⇒ 账本的读者从"我自己"变成"队友"。权重表因此更关键：队友没有你的上下文，**"已试方案与失败原因"的价值进一步上升**。
**但**：账本中的 `type:dead-end` 等 tag 与看板泳道映射是本地渲染语义，不同步。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| H1 | `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` L18 | 四段固定权重 | **不改默认**；新增可选的团队权重覆盖（独立传参） | 新增参数 |
| H2 | `parseHandoffLedgerPre` L41 | 解析四段 | 保留未知段处理；团队扩展段（如「协作约定」）走 UNKNOWN 权重 | 兼容 |
| H3 | 新增 `teamViewOfLedgerPre` | 无 | 把账本投影成"队友可读"视图（补 actor 标注） | 新增导出 |
| H4 | 账本来源标注 | 无 | 记录"谁在什么时候写的这一段" | 新增字段 |
| H5 | 截断标记 | `TRIM_MARK` L28 | 团队场景下需标明"被截断的段在团队库里可查" | 文案扩展 |

#### 可直接落地的代码片段

**片段 1**：队友视图投影（新增导出，放文件末尾）。

```js
/**
 * 把交接账本投影成**队友可读**的视图。
 *
 * 为什么不直接共享账本原文：账本里有提问者与我的私有语境（如本地路径、个人习惯表述），
 * 且原文可能很长。队友真正需要的是"目标 + 卡在哪 + 下一步"。
 * ⇒ 投影时**只保留高权重语义段**，并按队友视角重排（先目标、再失败、再下一步）。
 *
 * 注意：本函数**不裁剪**，只重排与标注 —— 裁剪仍由 weightedTrimHandoffLedgerPre 负责，
 * 避免"两处截断"造成语义混乱（对照 ledger-criteria 与 sanitizeForWrite 的"先于它执行"纪律）。
 *
 * @param {string} text 账本全文
 * @param {{actorId?:string, at?:number}} [meta]
 * @returns {{ok:boolean, preamble:string, sections:Array<{title:string,body:string[],weight:number}>, by:string, reason?:string}}
 */
export function teamViewOfLedgerPre(text, meta) {
  const parsed = parseHandoffLedgerPre(text)
  if (!parsed) return { ok: false, preamble: '', sections: [], by: '', reason: 'unparseable-ledger' }
  const m = meta || {}
  // 队友视角排序：目标(先知道要干什么) → 已试方案与失败原因(别重蹈) → 进度与下一步(接着干) → 其他
  const order = ['目标', '已试方案与失败原因', '进度与下一步', '任务状态']
  const rank = (title) => {
    const name = String(title || '').replace(/^##\s*/, '').replace(/\s+$/, '')
    const i = order.indexOf(name)
    return i < 0 ? order.length : i
  }
  const sections = parsed.sections.slice().sort((a, b) => rank(a.title) - rank(b.title))
  return {
    ok: true,
    preamble: parsed.preamble.join(String.fromCharCode(10)),
    sections,
    by: String(m.actorId || 'unknown'),
  }
}
```

**片段 2**：团队场景下的截断标记（**保留信息可查的提示**）。位置：`handoff-anchor.js:28`（`TRIM_MARK` 常量处）。

```js
// ★ Teamwork：团队场景下的截断标记必须**指出被截内容还能去哪找**。
//   单机场景里 '全文见 handoff/ 最新账本' 就够（本机文件系统里就有）；
//   团队场景里队友**没有你的 handoff/ 目录** ⇒ 必须指向团队库，否则队友会以为那段从未存在过。
const TRIM_MARK = '…(已按预算截断,全文见 handoff/ 最新账本)'
const TRIM_MARK_TEAM_PRE_V1 = '…(已按预算截断,全文见**团队共享库**的该账本;本机 handoff/ 仅有本地版本)'

/**
 * 选取截断标记（团队模式与否）。
 * @param {{team?:boolean}} [opts]
 * @returns {string}
 */
export function trimMarkOfPre(opts) {
  return (opts && opts.team) ? TRIM_MARK_TEAM_PRE_V1 : TRIM_MARK
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **权重表被改** | 顺手调四段权重 | H1 只允许**传参覆盖**，默认不动；权重影响"哪段先丢"，直接关系交接质量 |
| **回装不逐字节** | 解析时 trim 了 body | 注释 L36-37 明文"不做 trim，保证原样回装"；回归必须有逐字节还原断言 |
| **两处段名真源** | 团队扩展段另写一份段名表 | H2 走 UNKNOWN 权重；段名真源仍在 `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` |
| **两处截断** | 投影时又裁一次 | 片段 1 只重排不裁剪 |
| **EOL 破坏** | 处理 CRLF 文本时丢了 \r | 本模块容忍尾随 \r；回归覆盖纯 CRLF 输入 |

**既有测试/守卫**：`handoff-anchor` 的解析/回装/权重截断用例（含 `\r` 容忍）。`ledger-criteria` 依赖本模块的解析结果 ⇒ 两模块需联合验证。
