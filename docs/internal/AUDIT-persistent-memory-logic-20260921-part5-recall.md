# 长期记忆系统 逻辑审计报告 · 第 5 批：召回与注入链路

> 审计日期：2026-09-21 · 对象 `D:\dsh-auto-memory`（pre 线）
> 取证方式：独立子代理只读静态审计 + Lead 核实关键行
> **只诊断，未改任何代码。** 本次审计同时回答了此前遗留的「召回链路空白」。

---

## 0. 结论先行

召回/注入链路的**设计基调是 fail-soft**：全链路 **12 处静默降级、2 处可见失败、0 处阻断**。
这本身合理（记忆不灵不该卡住对话），但**静默点过多且不成体系**，导致「记忆不太灵」时用户与日志都无感。

三条最重的发现，其中**第 1 条直接违反用户既有铁律**。

---

## 1. P0 ★ 违反「JS / Python 两引擎独立、可互换、严禁联动」铁律（3 处硬耦合）

> 用户铁律原文（2026-09-10）：「两者是**两项相对独立、可互相替换**的功能，**严禁混为一谈、严禁互相联动**
> （不得让选一个就开关另一个，不得让一个的存在成为另一个生效的前提）」

**这是一条明确的既有约束，不是新设计意见。以下三处逐条违反：**

### 1.1 选一个就开关另一个（`:2051-2061`）

```js
if (mode === 'python') {
  this.config.activationSource = 'python'
  this.config.contextSinkMode = 'python'
  this.config.pythonBackendEnabled = true
} else {
  this.config.activationSource = 'js'
  this.config.contextSinkMode = 'null'
  this.config.pythonBackendEnabled = false
}
```
⇒ 一次设置改动**顺带改写三处引擎状态**。选 JS 会把 `pythonBackendEnabled` 置 false；选 Python 反向。
这正是「不得让选一个就开关另一个」的字面违反。

### 1.2 一方存在即决定另一方是否生效（`:9575`、`:9602`）

```js
if (tier !== 'c2') return null                                    // :9575  Python 档下 JS 臂恒 null
if (tier !== 'c3' && !(autoProbe && await engine._pythonModelReady())) return null  // :9602  JS 档下 Python 臂恒 null
```
⇒ 两臂在同一档位下**互斥**，构成「一个的存在成为另一个生效的前提」。

### 1.3 Python 档反过来依赖 JS 资产（`:9430`）

```js
embedder: { embedPassages: (texts) => engine._jsSemantic.embedPassages(texts) }
```
⇒ L0 索引的嵌入**写死 JS 引擎**，Python 档仍依赖 JS 模型资产。
**后果**：纯 Python 用户（未装 JS 模型）L0 索引长期静默失效。

**修法建议**（需拍板）：删掉 `saveConfig` 的三处联动，改为各自独立字段；
`_semanticRankBest` 按显式档位只调对应臂、不做隐式回退（回退另设开关）；
L0 embedder 按当前档位取引擎，或在 Python 档下显式降级留痕。

---

## 2. P1（5 条）

### 2.1 RRF 的 divisor 把秩贡献压成常数（排序实质退化）

- 位置：`lib/recall-fusion-pre.js:19-22`（`k = divisor = 60`）、`:131-132`、调用 `index.js:6289`
- 代码：`const rrfDense = rd === undefined ? 0 : 1 / (k + rd / divisor)`
- 问题：标准 RRF 是 `1/(k+rank)`（k=60 时 rank1 与 rank100 相差约 2.6 倍）；
  此处**再除 divisor=60** ⇒ rank1 与 rank100 的臂贡献为 `0.016667` vs `0.016390`，**只差 1.7%**。
  这与该文件头 `:50-53` 自述的「候选<3 不退化 / rank-space 关键性质」直接矛盾。
- 影响：融合序近似等价于「命中臂数 + memoryId 升序」，**语义臂与词法臂都丧失区分度**；
  `index.js:6294` 的 `finalRank` 随之失真，输出的 `#N` 名不副实。
- 修法：改回 `1/(k+rank)`，或明确改为加权 RRF 并同步文档；补一条「rank1 与 rankN 分差 ≥ X」的性质测试。
- ⚠️ 未确认：是否有意设计（注释与实现不符）；`recall-fusion-pre.js:31-33` 提到的常量一致性守卫套件**未在 `tests/` 定位到**。

### 2.2 注入总预算不是硬门（设置页的 8000 不构成约束）

- 位置：`index.js:5713`（`budgetChars` 算出来只当报告值传 `:5733`）、`:5724-5725`、`memory-envelope-pre.js:228-236`
- 问题：`injectBudgetChars` **只写进账本元数据**；超额时只产 `inject:false` 的降级（`memory-envelope-pre.js:229-236`），
  该行随后被过滤掉 ⇒ **模型看不到超额**。而 `otherDynamic`（外部记忆+日历+工作区图+铭文+框架行）**默认不设上限**（`:5724-5725`）。
- 影响：实际可超 8000 字符而无任何拦截或可见提示；长会话成本高于设置页承诺。
- 修法：把总门下沉到 `composeMemoryEnvelopePre`，对 `chars.total` 做截断并生成 `inject:true` 的**可见**降级；
  或给 `otherDynamic` 一个由 `injectBudgetChars` 推导的默认上限。

### 2.3 两套 token 口径并存，水位线用了低估的那套

- 位置：`index.js:3676-3683`（`tokens += Math.ceil(text.length / 4) + 4`，被 `:3094` 水位使用）
  vs `tier0-catalog-pre.js:135-144`（`Math.max(Math.ceil(s.length / 2), repo)`，保守 ÷2）
- 矛盾点：`tier-layer-inject-pre.js:643-644` 自称「保证全链路只有一个 token 口径（契约 §4.6）」
- 影响：中文语料下按 ÷4 估算明显偏低 ⇒ 水位/自动接续触发滞后。
  ⚠️ **幅度为推断**（最多约 2 倍），取决于 CJK 占比；未实测。
- 修法：水位与注入统一走 `estimateTokensPre`；或明确记录两套口径各自的用途并加断言。

### 2.4 融合路径静默吞错（与同文件纪律自相矛盾）

- 位置：`index.js:6299` `} catch (eRrf) {}`
- 对照：同文件 `:6216-6219` 与 `:6254-6258` 都是 **diag + `_degradeSink.record`**；此处破例。
- 影响：动态 import 失败或融合函数抛错（真代码缺陷）被完全吞掉，静默回落 legacy 字典序（`:6301-6305`）。
- 修法：与 `:6216` 同款处理。

### 2.5 importance 在入融合前乘到 dense（违反模块自述的"禁止 score-space 加权"）

- 位置：`index.js:6289` `dense: c.sem * (0.5 + 0.5 * (impMap.get(c.id) ...))`
- 冲突：`recall-fusion-pre.js:15` 明令「无 score-space 加权（禁止项）」
- 问题：importance 因子（0.5~1.0，逐条不同）在**入融合前**乘到 `sem` 上，改变臂内次序 ⇒ 与契约冲突；
  同时 `:6224` 的 `sc >= 0.5` 被当成准入而非决策门。
- 修法：importance 只做二级平局因子，或显式建模为第三臂并更新两处契约文档。

---

## 3. P2（5 条）

| # | 缺陷 | 位置 | 要点 |
|---|---|---|---|
| 1 | 融合输出未按 memoryId 去重 | `index.js:6285`、`:6298` | 语料中同 id 两条 ⇒ 重复注入同一候选、`finalRank` 重复 |
| 2 | `semanticArm` 恒为 `true` | `index.js:5289` | Python 档下 JS 臂恒 null 时仍标称语义臂可用 ⇒ `tier-layer-inject-pre.js:379` 降级分支**永不触发** |
| 3 | `extBudget` 算了不用（dead config） | `index.js:5672` | 设置页「外部记忆注入预算」改此值**零效果**且不报错 |
| 4 | 预算注释三方漂移 | `index.js:298`(0.25) / `:5646`(0.4) / `:5222`(再被 `:5244-5245` 二次封顶为 400 token) | 按注释推断必然出错 |
| 5 | `memory-importance-pre.js:21-23` 自述「未接线」但已接线 | `index.js:6247-6252` | 文档与事实不符 |

### 静默吞错 / fire-and-forget 清单（`void` 与空 catch）

- 有注释可接受：`:6193`（白板取不到就跳过）
- **无留痕**：`:6370`（外部记忆）、`:6378`（历史会话）、`:6381`（跨工作区）、`:6458`（语义节）、
  `:5445`（`renderSlimSnapshotPre` 整块变空）、`:10063/:10071/:10085`（三个注入回调 `catch → ''`）
- 未 await：`:9476 void engine.syncL0IndexPre(...).catch(() => {})`（连 catch 都空）、
  `:4707 void this.external.discover(true)`、`context-host-pre.js:706 void persistEvidence(evidences)`
  （**对照 `:660` 是 await 的** ⇒ evidence 写入与后续 recall 之间存在竞态）
- 修法：统一走 `diag + _degradeSink.record`（沿用 `:6216` 模板）。

---

## 4. 召回链路逐环节（函数 + 行号，标注失败行为）

| # | 环节 | 位置 | 失败行为 |
|---|---|---|---|
| 1 | 入口 `recall()` | `index.js:6073` | — |
| 2 | `expand` 短路 → `expandMemoryRecordPre` | `:6075` / `:6468` | 读不到返回提示文本（**可见**） |
| 3 | `scope=handoff` / `sessions` | `:6084` / `:6091` | sessions 分支 catch 后返回**错误文本**（**可见** `:6096-6098`） |
| 4 | 状态行解析器动态 import | `:6108` | 顶层声明（注释 `:6102-6107` 说明放分支会 ReferenceError 被吞） |
| 5 | 白板语料 `searchHandoffCorpus` | `:6129` | — |
| 6 | L0 语料构建 `buildL0IndexPre` / 分层 import / `isRetrievablePre` | `:6152` / `:6157` / `:6162` | `pushL0` `:6166-6194`，白板段 try/catch **静默** `:6193` |
| 7 | 词法打分 | `:6197-6202` | `c.lex = hitTerms.length`（**无 IDF / 无长度归一**） |
| 8 | 语义臂择优 | `:6206-6220` | diag + degradeSink（**可见** `:6216-6219`） |
| 9 | 语义分准入 | `:6221-6226` | `sc >= 0.5` |
| 10 | evidence→importance | `:6230-6259` | 目录缺失**有意静默** `:6242-6244`；真异常**可见** `:6254-6258` |
| 11 | 命中集 `l0Hits` | `:6260` | — |
| 12 | 时间臂 | `:6264-6276` | import 失败 diag `:6270` |
| 13 | **RRF 融合** | `:6284-6298` | ★ **失败静默** `:6299` → legacy 兜底 `:6301-6305` |
| 14 | 输出 L0 摘要 + 分层分组 | `:6306-6324` | — |
| 15 | 非 L0 分支 `scanFile` | `:6325-6339` / `:6109` | — |
| 16 | 跨工作区 / 外部记忆 / 历史会话 / 非 L0 语义节 | `:6342-6459` | 四段**全静默**：`:6381` / `:6370` / `:6378` / `:6458` |
| 17 | 返回 | `:6461-6462` | — |

**注入侧**：`systemPrompt.context` `:9942-10065`（text 同步返回，无法 await；`void engine.refresh` `:9963`）
→ `renderMemoryDynamic` `:5531`（规则段 fail-soft `:5576`；envelope `:5726`）
→ Tier-0 目录 `buildTierLayerInjection` `:5225`（装配 `tier-layer-inject-pre.js:497`；自身 fail-open 但**可见** `:5334-5341`）
→ 命中投影 `activation-host-pre.js:177-226`（**静默** `:225`）
→ 复用五道门 `tier-layer-inject-pre.js:236-285`
→ 静态纪律 `renderMemoryStatic` `:5762`（走 `systemPrompt.section` `:10067`）、M6 唤回尾 `:10077-10087`。

---

## 5. `-pre` 漂移复核（补强第 3 批）

宿主 import 侧确认：`index.js:29-85` **全部 `-pre.js`（37 处）**，
唯一非 pre 是 `:57 ws-overview-rank.js`（该文件本身无 pre 版）。
**反向验证：无任何 `-pre.js` import 非 `-pre`** ⇒ 非 pre 是早世代的**自洽死代码**。

**真实漂移（非仅命名）**：

| 项 | `-pre`（活） | 非 pre（死） |
|---|---|---|
| 证据库目录 | `memory/evidence-pre`（`context-host-pre.js:166/170/791`） | `memory/evidence`（`context-host.js:114/118/647`） |
| 写入失败去重 | `evidence-store-pre.js:126` `if (!written && id) this._appended.delete(id)` | **无此行**（失败仍占着去重集合） |
| 分词对齐 Python | `semantic-decide-pre.js:33` `{2,}` + `:45-73 isAlnumPythonish`（issue #68 已修） | `semantic-decide.js:30` 仍是单字词版本（**未修**） |
| 降级可见性 | `semantic-js-pre.js:194` `ready: filesReady && !degraded`（issue #70 已修） | `semantic-js.js:172` `ready: Boolean(assetPresent && peerDir)`（**模型损坏仍显示就绪**） |
| 无同名裸版（pre-only 新模块） | `recall-fusion-pre.js`、`memory-importance-pre.js`、`evidence-agg-pre.js`、`l0-extract-pre.js`、`l0-index-pre.js`、`tier-layer-inject-pre.js`、`tier0-catalog-pre.js` | — |
| 仅命名漂移 | `shadow-retrieval-pre.js` vs 裸版（26 处差异全为 `_PRE_`→`_V1`） | — |

⇒ **两个世界的数据目录与算法已实质分叉**：任何打在 `lib/*.js`（非 pre）上的修复都不会进入活宿主。

---

## 6. 未能确认

1. RRF divisor 是否为**有意设计**（注释与实现不符）；其常量一致性守卫套件未在 `tests/` 定位到
   （仅 `artifacts/_probe-m25b-layerfield.mjs` 探针与 `lib/recall-fusion-pre.js.bak-20260918-M25b`）。
2. 水位是否真用官方 tokenMeter（`water-window-pre.js:3` 如此自述，而 `:3094` 用 `estimateSessionTokens`）
   —— 未下钻，故「低估 2 倍」标为**推断**。
3. Python worker 侧（`python/worker_pre_v1.py`）不在本次范围 ⇒ c3 档实际可用性**未实测**。
4. 全程只读静态取证，**未运行任何测试**。

---

## 7. 对修复顺序的影响

本批把**铁律违反（§1）列为最高优先级**——它不是「屎山」问题，而是**用户明确拍过板的约束被代码违反**，
且后果真实（纯 Python 用户 L0 索引静默失效）。

建议：§1 与第 1 批的 P0（批准通路）并列为**最优先**，且 §1 需**用户先定形态**
（「严格独立」vs「允许自动回退」是产品决策，不是纯技术选择）。
