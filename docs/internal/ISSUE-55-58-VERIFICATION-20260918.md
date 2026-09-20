# 外部 issue #55–#58 核验报告（2026-09-18）

> **核验人**：执行 Agent　**核验方式**：逐条对照 pre 线源码，**只采信代码证据，不采信 issue 自述**
> **基线声明**：issue 自述基线 **v2.5.2 @ a972ebf**（本机确认该提交存在，`git describe` = `v2.5.2-14-ga972ebf`）
> **报告对象**：`Minervaowl7` 于 2026-09-18 21:05–21:08 提交的 4 个 issue，来源标注「bug-hunter 自动审计（scan-only）」

---

## 0. 一句话结论

**4 条全部为真，且全部存在于 pre 线。** 无一误报，无一因 3.0 重建而失效。
前 3 条（#55/#56/#57）是**同一族缺陷**：fail-soft 的 catch 吞掉了一个**本不该发生**的错误
（未定义标识符 / 缓存登记时机错 / 缺 schema 校验），把"代码写错了"伪装成"环境问题"。
第 4 条（#58）是**纯卫生问题**（慢性泄漏），性质不同。

**但有一个关键前提必须说明**：这 4 条的**触发条件都较窄**，作者的 Low 定级是合理的（见 §3）。

---

## 1. 逐条核验

### #55 · `storage-manage-pre.js` `readSidecarPrev` 引用未定义标识符　✅ **确认为真**

| 项 | 证据 |
|---|---|
| 声明 | `readSidecarPrev` 引用不在其作用域的 `docStore` |
| 实测 | `:117 function readSidecarPrev(file) {` → `:118 try {` → `:119  if (!docStore \|\| ...) return null` |
| 作用域 | `docStore` **只在** `:135 repair()` 与 `:169 deleteMemory()` 内 `const docStore = docStoreOf()` 定义 |
| 工厂层 | `:31 const docStoreOf = ...`（只有函数，没有变量） |
| 后果 | ESM 下必抛 `ReferenceError`，被 `:127 catch (_) { return null }` 吞掉 ⇒ **此函数结构上不可能返回非 null** |
| 调用点 | `:148 docStore.rebuildSidecar(file, readSidecarPrev(file) \|\| undefined)` ⇒ 恒传 `undefined` |

**作者额外发现的一个后果，我独立复核成立**：`rebuildSidecar` 拿不到 prev ⇒ 每次重建都产生新 epoch。
而 evidence 的 fresh/stale 判定按 `recordDigest + sourceVersion` 匹配（`evidence-store-pre.js:237`）
⇒ **「修复」功能反而把原本 fresh 的证据全部翻成 stale**。这是比"继承失效"更严重的实际影响。

> 作者的置信 96/100、定级 **Medium** 是全部四条里最高的，合理。

---

### #56 · `evidence-store-pre.js` 幂等缓存在落盘前登记　✅ **确认为真**

| 项 | 证据 |
|---|---|
| 声明 | `_appended.add(id)` 在写盘**之前**执行 |
| 实测 | `:112 if (id && this._appended.has(id)) { ...duplicate-evidence... }` → `:119 if (id) this._appended.add(id)` → `:120 this._chain = this._chain.then(() => this._writeLine(...))` |
| 失败路径 | `:134 this.stats.writeFailed++` / `:135 this.stats.lastWriteError = ...` —— **无任何 `delete(id)`** |
| 唯一清理 | `:187 this._appended.clear()`（在 `dispose()` 内） |
| 后果 | 一次瞬时写失败 ⇒ 同 id 进程内重试**恒被拒**，证据静默丢失；除 `stats.writeFailed` 外无信号 |

**修复建议复核**：作者说「`BoundedIdSet` 需补 `delete()`」——**我未验证该内部类是否有 delete**，
这条属下修实现细节，落地时须先确认（可能是已有等价操作）。

---

### #57 · `episodic-store-pre.js` `restore` 不校验 `current` 形状　✅ **确认为真**

| 项 | 证据 |
|---|---|
| 声明 | `restore()` 对 `current` 零校验 |
| 实测 | `:292 current = data.current \|\| null` —— **孤零零一行，无任何形状检查** |
| 崩点 | `:202 if (current.segments.length < cfg.minSegments)` —— `current` 若为 `{}` ⇒ `TypeError` |
| 对比 | `episodes` 走 `:222 validateEpisodePre(ep)`，`current` 完全没有对应校验 |
| 后果 | `current` 损坏（手改/半损坏但可解析）⇒ restore "成功" ⇒ 之后每次 consolidate 都 TypeError ⇒ **巩固链路静默停摆直到重启** |

**这条最符合本仓已记录的病害模式**：`restore` 声称成功（`{ ok: true, restored: N }`），
但恢复出来的状态**结构上不可用** —— 与 M8/M9「结构性恒假」同族：**成功信号与真实可用性脱钩**。

---

### #58 · `activation-host-pre.js` 清理为零调用 + 键格式错配　✅ **确认为真（两处均成立）**

**根因 1 — 清理函数零调用方**：
- 全仓 grep `activationHost.disposeRuntime|disposeSession|disposeAll` 只命中 **1 处**：
  `index.js:10869 disposeAll('plugin disposed')`（仅插件整体卸载）
- `index.js:1083` 的 runtime 释放路径只有 `this._shadowHost.disposeRuntime(runtime)`，
  **没有** `this._activationHost.disposeRuntime(...)`
- ⇒ 每会话遗留一条 `runtimeState`/`stepsByRuntime`/`pathsByKey`/inbox 记录，进程存活期内不释放

**根因 2 — 键格式错配**：
```
:352  const key = sessionId + '|ws:' + workspaceKey      ← 写入键（stepFor）
:510  stepsByRuntime.delete(String(runtimeKey))          ← 删除键（disposeRuntime）
```
两个键格式不同 ⇒ **即使接线，删除也是空操作**。作者这句话是准的。

**定级**：单条很小、需长时间运行 + 频繁开关会话才显现 ⇒ Low 合理。

---

## 2. 与 pre 线的关系（重要）

| 问题 | 结论 |
|---|---|
| 这些文件在 pre 线存在吗？ | ✅ 四个都在（`*-pre.js` 变体，2752–28524 B） |
| 3.0 重建修掉了它们吗？ | ❌ **没有**。四条缺陷在 pre 线**逐行可复现** |
| pre 线是否已有修复？ | ❌ 未见任何对应补丁 |
| issue 里的行号能直接用吗？ | ⚠️ **不能**。issue 行号是 2.5.2 的；pre 线行号已漂移（如 #55 的 `:117-128` 在 pre 线是 `:117-119`，`docStoreOf` 在 `:31` 而非 `:31` 附近需重定位） |

**⇒ 这四条是「已发布版本存量缺陷 + pre 线同样存在」，需要在 pre 线修，随下个版本发出。**

---

## 3. 严重性再评估（我的判断，供决策）

作者的定级是 Low/Medium。**我同意 Low 的技术定级，但要补一条**：

**#55 应升级为 Medium-High。** 理由不是"泄漏"，而是**功能反向**：
设置页的「修复」按钮**不但没修，还把证据新鲜度全污染了**。这是一个**用户主动点击才会触发的、结果与按钮语义相反**的行为 ——
比"缓慢泄漏"更值得优先。作者给 Medium，我认为偏保守（他大概只估了"epoch 继承失效"，
没把"fresh→stale 反向污染"算进去；但这一条**作者自己在正文里写了**，所以是定级偏保守，不是漏判）。

**四条的共同特征（本仓值得记的判据）**：

> 这四条**没有一条**会被现有 smoke 抓到，也**没有一条**会在正常使用中报错。
> 三条是 fail-soft 的 catch **吞掉了本该炸的错误**（未定义标识符 / 时机错 / 缺校验），
> 一条是"删除键写错 ⇒ 删除静默失败"。
> ⇒ **fail-soft 是本仓的铁律，但它的代价在这里集中兑现了**：
> catch 把"代码 bug"降级成"无明显症状"，只有专门的静态审计才能捞出来。
> 这正好印证用户的原话：「用 GPT 找到 bug」——这类 bug 靠跑是跑不出来的。

---

## 4. 修复建议（按性价比排序）

| 序 | issue | 修法 | 风险 | 建议时机 |
|---|---|---|---|---|
| 1 | **#55** | `readSidecarPrev` 内加 `const docStore = docStoreOf()`（与 `repair`/`deleteMemory` 一致）；补一条 smoke：repair 后 epoch/version 应继承 | 极低（一行 + 断言） | **立即** |
| 2 | **#56** | 写入成功后才 `add(id)`（在 `.then((written) => ...)` 内判 `written === true`）；或失败时 `delete(id)` | 低（需确认 `BoundedIdSet` 能否 delete） | **立即** |
| 3 | **#57** | `restore` 对 `current` 补形状校验（`sessionRef` 字符串 / `startedAt` 有限 / 三个数组），不合格置 `null`（**丢弃优于卡死**） | 低 | **立即** |
| 4 | **#58** | ① `dispose(agent)` 补 `_activationHost.disposeRuntime(runtime.key)`；② `disposeRuntime` 改按 `stepFor` 实际键格式删除（或建条目时记下 key） | 中（键格式统一要**同时**核对所有读写点，否则二次错配） | 紧随 |

**共同纪律**：四条都**必须先写"能失败"的套件**（当前 4 条全都零测试覆盖），
且 #58 修完要**用变异演示确认键格式真的对齐**（正是"改了一处、另一处还是旧键"的典型）。

---

## 5. 与今晚在做的 I5/R4-A 是否同一问题？——**不是，完全无关**

用户问「这个和刚才改的东西是否针对的是同一个问题」——**明确不相干**：

| | issue #55–#58 | 今晚在做的 R4-A / I5 |
|---|---|---|
| 对象 | `storage-manage` / `evidence-store` / `episodic-store` / `activation-host` | `l0-extract-pre` 的 `status` 谓词 |
| 层面 | **存储与生命周期**（谁在何时清理、何时登记、何时校验） | **检索呈现**（作废条目该过滤还是该标记） |
| 用户可见性 | 设置页「修复」按钮失效、证据静默丢失、巩固停摆 | 检索结果里能不能看到"这条已过时" |
| 关系 | **无任何代码交叠** | — |

**唯一的间接联系**：四条 issue 所在的模块（evidence-store / episodic-store / activation-host）
正是 R1「静默降级普查」点过名的高危区，而 #55/#56/#57 三条**又是 fail-soft 吞错**同一族。
⇒ **可以确认：R1 普查的方向是对的，但覆盖面不全** —— 它按"降级点"枚举，
而这次是**按"标识符作用域/缓存时机"**这类静态缺陷找出来的，是另一个证据面。
建议把「静态审计」列为 R 系列的补充分支（见 §6）。

---

## 6. 建议（供用户决策，不自行执行）

1. **立即修 #55/#56/#57**：三条都是低风险、一行到几行的修，且**用户可感知**（尤其 #55 的修复按钮反向污染）。
2. **#58 紧随其后**，但键格式统一要**一并核对全部键读写点**再动手。
3. **建议把「静态审计分支」正式写进作战计划**：本仓已有 R1（降级普查）与本次（外部审计），
   但**缺少常态化的静态检查**（未定义标识符、键格式一致性、缓存登记时机）。
   这次 4 条里有 3 条属于"跑不出来、只能看代码看出来"的类型，值得一条独立防线。
4. **本次 issue 的作者质量值得肯定**：4/4 全真、行号级证据、给出建议修法、并**如实标注了 Low（没有夸大）**。
   这是外部贡献里质量很高的一批。

---

## 附：核验方法与可复核性

- 提交存在性：`git describe --tags a972ebf` → `v2.5.2-14-ga972ebf`
- 文件存在性：4 个 `lib/*-pre.js` 全部存在（含字节数）
- 逐条 grep + 上下文窗口读取（`Select-String -Context`），对照 issue 声明的行号与代码形态
- **未执行**：未跑复现脚本（#56/#57 需构造瞬时写失败/损坏 JSON，#58 需长时间运行观测）；
  本次为**静态核验**，结论基于代码结构，不基于运行时观测 —— 如需运行时证据，应另写探针。
