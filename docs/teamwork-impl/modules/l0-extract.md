
## l0-extract

- **规模**：25,842 B / 479 行 / 18 个导出符号
- **交付形态**：**完整版**

### 职责

**L0 抽取纯核心**（`l0_extract_pre_v1`）—— **分层语义唤回的地基**。
目的：为每条记忆生成廉价摘要（L0），使检索可先在小空间收敛候选，再按 id 下钻原文，从而把 token 开销与索引构建成本降约**一个数量级**（实测：条目平均 814 字符 → L0 约 118 字符，**压缩比 6.9:1**）。
组成：`parseMemoryItemsPre`（按锚点切分记忆条目）、`extractL0Pre`（单条抽取，**三级 fallback**）、`buildL0IndexPre`（文件级索引，确定性排序）、`classifyLayerPre`（来源 → 分层归属，三层契约 C1）。

### 数据流

```
记忆 Markdown
   │
   ├─ parseMemoryItemsPre(text)   L322   按 memory 锚点注释切分条目
   │
   ▼
extractL0Pre(item)   L352   ★ 单条 L0 抽取（三级 fallback）
   │
   ├─ classifyLayerPre(sourceId)  L134   ★ 来源 → 分层归属
   │     L0_LAYERS L96 = { user | project | log | reflection | whiteboard }
   │     （userMemoryPath → user；workspaceMemoryPath 与旧版 {ws}/.dsh-memory/MEMORY.md → project）
   ├─ isCurrentPre(...)      L235   现行判据
   ├─ isRetrievablePre(...)  L269   可检索判据
   ├─ supersededMarkPre(...) L295   作废标记
   │     L0_SUPERSEDED_MARK_PRE_V1 L278 / L0_RETRACTED_MARK_PRE_V1 L279
   └─ groupL0ByLayerPre(...) L194   按层分组（显示序 L163 / 标签 L168 / 未知标签 L177）
        │
        ▼
buildL0IndexPre(text, opts)   L406   ★ 文件级 L0 索引（确定性排序）
        │
        ▼
   消费：tier0-catalog / tier-layer-inject / l0-index（向量索引）
   L0_EXTRACT_VERSION L32 / L0_DEFAULTS L89 / L0_STATUSES L99
   L0_DEFAULT_LAYER L103 / L0_LAYER_VERSION L106
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L32 | `L0_EXTRACT_VERSION` | `l0_extract_pre_v1` |
| L89 | `L0_DEFAULTS` | 默认参数 |
| L96 | `L0_LAYERS` | **层枚举** |
| L99 | `L0_STATUSES` | 状态枚举 |
| L103 | `L0_DEFAULT_LAYER` | 缺省层 |
| L106 | `L0_LAYER_VERSION` | 分层规则版本 |
| L134 | `classifyLayerPre(sourceId)` | **来源 → 层** |
| L163 / L168 / L177 | 显示序 / 标签 / 未知标签 | 渲染常量 |
| L194 | `groupL0ByLayerPre(...)` | 按层分组 |
| L235 | `isCurrentPre(...)` | 现行判据 |
| L269 | `isRetrievablePre(...)` | 可检索判据 |
| L278 / L279 | 作废 / 撤回标记常量 | 产品语义落地 |
| L295 | `supersededMarkPre(...)` | 作废标记 |
| L322 | `parseMemoryItemsPre(text)` | 锚点切条 |
| L352 | `extractL0Pre(item)` | **单条抽取** |
| L406 | `buildL0IndexPre(text, opts)` | **文件级索引** |

### 内部关键实现

**1. 压缩比 6.9:1 是架构基础（文件头）**

文件头逐字：*"目的：为每条记忆生成廉价摘要（L0），使检索可先在小空间收敛候选，再按 id 下钻原文，从而把 token 开销与索引构建成本降约一个数量级（实测：条目平均 814 字符 → L0 约 118 字符，压缩比 6.9:1）。"*
⇒ 这是"先在小空间收敛候选、再按 id 下钻原文"能成立的前提。团队化会让候选池显著变大，**这个压缩比的价值反而更高**。

**2. 分层归属按来源判定（文件头 + L134）**

文件头逐字：*"分层归属与状态（2026-09-14 · THREE-LAYER-CONTRACT §2 / C1）：`layer` ∈ { user | project | log | reflection | whiteboard }，由**来源标识**判定。"*
⇒ 层不是内容判断，而是**路径判断** —— 确定性、可断言。团队化新增层只能靠**新的来源标识**。

**3. 三级 fallback（文件头）**

`extractL0Pre` 对一条记忆做三级降级抽取 ⇒ 即使条目格式异常也能产出可用 L0。**这对团队内容尤为重要**：队友写的记忆格式可能与本机不同。

**4. superseded / retracted 标记常量（L278-279 + L295）**

把用户裁定的产品语义（"**返回但标记**，不剔除、不降权"）**落成常量与函数**，供渲染层统一使用。⇒ 团队化后"队友标记为过时的结论"同样走这条路径。

### 与团队化的关系

**判定：S3 派生重算（L0 完全由正文派生）+ S2 共享（层的语义）。**

理由：L0 是**纯派生**（同样的正文 → 同样的 L0），各端本地重算即可，同步它只会引入版本漂移。
**但 `L0_LAYERS` 与分层规则（`L0_LAYER_VERSION`）必须全队一致**：若 A 把团队记忆归到 `project`、B 归到 `team`，目录层的配额分配与显示分组都会错位。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| LE1 | `L0_LAYERS` L96 | 五层 | 新增 `team` 层（**追加**） | 封闭枚举新增 |
| LE2 | `classifyLayerPre` L134 | 按来源标识 | 团队来源路径 → `team` 层 | 新增分支 |
| LE3 | `L0_LAYER_LABELS_PRE_V1` L168 | 五标签 | 新增团队标签 | 同步 LE1 |
| LE4 | `L0_LAYER_DISPLAY_ORDER_PRE_V1` L163 | 显示序 | 团队层**排最后**（不插队） | 顺序纪律 |
| LE5 | `isCurrentPre` L235 | 本地状态 | 团队条目的状态**由团队裁决**（不本地臆断） | 新增字段 |

#### 可直接落地的代码片段

**片段 1**：新增 team 层（**追加 + 四处同步**）。位置：`l0-extract.js:96`（`L0_LAYERS` 定义处）。

```js
// ★ Teamwork：新增 team 层 —— **追加在末尾，不改既有五层顺序**。
//
// 同步清单（漏一处就会出现"分组对了但标签是未知"这类半修状态 ——
// 本仓已有教训：同一语义两处实现，只改一处会留下部分路径恒判失败）：
//   ① L0_LAYERS L96            ← 本片段
//   ② L0_LAYER_LABELS_PRE_V1 L168
//   ③ L0_LAYER_DISPLAY_ORDER_PRE_V1 L163（追加到最后）
//   ④ tier0-catalog.js:391 TIER0_QUOTA_DEFAULTS（新增 team 份额，缺省 0）
export const L0_LAYERS = Object.freeze(['user', 'project', 'log', 'reflection', 'whiteboard', 'team'])
```

**片段 2**：分层归属的团队分支。位置：`l0-extract.js:134`（`classifyLayerPre` 内判定链末尾）。

```js
export function classifyLayerPre(sourceId) {
  const s = String(sourceId || '')
  // ...原有判定链（userMemoryPath → user；workspaceMemoryPath → project；…）...
  // ★ Teamwork：团队来源路径 → team 层。
  //   判据用**路径前缀**而不是内容特征 —— 与既有五层同款纪律
  //   （文件头："layer 由来源标识判定"）。内容判断会让同一段文本在两台机器上
  //   因措辞差异归到不同层 ⇒ 目录配额与显示分组在两端不一致。
  //   两条分隔符都判：Windows 反斜杠与 POSIX 斜杠（对照 dsh-home.js:86 的相对化纪律）
  const SEP = String.fromCharCode(92)
  if (s.indexOf('memory/team/') >= 0 || s.indexOf('memory' + SEP + 'team' + SEP) >= 0) {
    return { layer: 'team', source: 'team-path' }
  }
  return { layer: L0_DEFAULT_LAYER, source: 'default' }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **枚举漏同步** | 只加 L0_LAYERS 未加标签/显示序 | 片段 1 列出四处同步清单；补断言"三个枚举都含 team" |
| **层判定用内容** | 为省事按关键词判断 | 文件头纪律：按来源标识；回归断言"改措辞不改层" |
| **团队层插队** | 显示序里插到中间 | LE4：追加到最后；回归断言既有五层顺序不变 |
| **fallback 不足** | 队友格式异常 | 三级 fallback 是既有能力，团队化必须保持 |
| **状态本地臆断** | 团队条目状态本地判 | LE5：状态由团队裁决（"指引层不臆断"的延伸） |

**既有测试/守卫**：`l0-extract` 的切条/抽取/分层用例（层归属很可能被逐路径断言）。`tier0-catalog` 与 `tier-layer-inject` 消费本模块的层枚举 ⇒ 新增层必须三模块联合验证。
