# R2 · 静默降级深查报告（evidence 读写不对称）

> 2026-09-18 · 承接 `R1-DEGRADE-AUDIT-20260918.md`
> 探针：`artifacts/_probe-r2-evidence.mjs`
> 状态：**根因已定位到代码级**；用户侧触发条件**未复现**（本机无法重放），列明待确认项

---

## 0. 一句话结论

**读侧无条件扫描 + 写侧有条件写入 ⇒ 对满足「写入条件永不成立」的用户，每次 recall 都必然 ENOENT 且静默降级。**

**关键新发现**：**正确的守卫函数 `evidenceRootExists()` 已经存在，却没有用在读侧守卫上** ——
它只被 `:785` 的**展示统计**（`durableEventsOnDisk`）使用。**这是「有正确工具但没接到该接的地方」。**

---

## 1. 读侧：确认无守卫（附行号）

```js
// index.js:5889-5897
const evDir = path.join(dshHome(), 'memory', 'evidence-pre', 'events')   // :5891
const agg = aggregateEvidenceEventsPre(scanEvidenceEventsPre({
  listFiles: () => readdirSync(evDir).filter((x) => x.endsWith('.jsonl')),   // :5893 ← 无条件
  readFile: (name) => readFileSync(path.join(evDir, name), 'utf8'),          // :5894
}, {}))
} catch (eImp) { try { diag('evidence-agg 降级为中性(impMap 空): ' + ...) } catch (_) {} }  // :5897
```
- **无 `existsSync` 前置**；目录不存在 ⇒ `readdirSync` 抛 ENOENT ⇒ catch ⇒ `impMap` 空
- 后果：`computeImportancePre` 全体中性（0.5）⇒ dense 臂因子恒 0.75 ⇒ **importance 加权对该用户完全无效**

**★ 同时存在的正确守卫（未被用于此处）**：
```js
// context-host-pre.js:167-170
function evidenceRootExists() {
  const p = path.join(dshHome(), 'memory', 'evidence-pre')
  try { return existsSync(p) } catch (_) { return false }
}
// 唯一调用点 :785（展示用）
//   durableEventsOnDisk: evidenceRootExists() ? storeFor().loadEvents().events.length : 0,
```
⇒ **同一文件里既有正确守卫、又知道要防目录不存在，却没把它用到读侧**。

---

## 2. 写侧：确认「有条件」（附行号）

```js
// context-host-pre.js:709-717
async function persistEvidence(list) {
  if (!list.length) return                    // ← 条件1：列表非空
  const st = storeFor()
  for (const ev of list) { const r = await st.append(ev) ... }
```
```js
// evidence-store-pre.js:109-130
async append(evidence, opts = {}) {
  ...
  mkdirSync(this.eventsDir, { recursive: true })   // :126 ← 懒建：只在首次成功 append 时创建
  appendFileSync(path.join(this.eventsDir, fname), line + '\n', 'utf8')
}
```

**两个调用点都带内容前置条件**：
| 位置 | 函数 | 前置条件（读源码所得） |
|---|---|---|
| `:653` | `emitTextEvidence`（`:614`） | 需 `cites`/`corrections`/`attributed` 至少一类非空；`attributed` 还需 P9a 归因命中 |
| `:699` | 覆盖观察（`observeToolResult` 链路） | 需 `ok=true` **且** `resultPreview` 含**完整 memoryId token** **且**该 token 在**当前授权 corpus** 中，且 coverage>0 |

**接线本身完整**：`index.js:8531` 无条件 `createContextHost({ engine })`；
`:9223` 每次工具结果都调 `observeToolResult`；`:1702` 每次 segment 都调 `onToolResult`。
⇒ **不是"没接线"，而是"接了线但内容条件永不满足"**。

---

## 3. 本机 vs 用户侧（硬证据对照）

| | 本机（开发机） | 用户侧（`C:\Users\Administrator\`） |
|---|---|---|
| `evidence-pre/events/` | **存在，21 个文件**，09-18 仍在写 | **不存在** ⇒ 从未成功 append |
| 推测原因 | 长期有会话活动 ⇒ 内容条件被满足过 | 新装 / 用法未触发任一条件 |
| 表现 | 无报错 | **每次 recall 都 ENOENT** + 用户可感知功能异常 |

**★ 路径不是拼错**：`release.mjs:93` 有 `['memory/evidence-pre','memory/evidence']`（发布版重命名）
⇒ 用户报的 `evidence\events` 是**发布版正确路径**。

---

## 4. 缺陷定性

**不是「设计内降级」，是「读写不对称」**：

| 侧 | 契约应是 | 实际是 |
|---|---|---|
| 写 | 有内容才写；目录**可不存在** | ✅ 懒建，符合预期 |
| 读 | 目录可能不存在 ⇒ **必须先判存在** | ❌ **无条件扫描** |

⇒ **两侧对"目录可能不存在"这一事实没有共识**。写侧把"不存在"当正常态（懒建），
读侧把"不存在"当异常（抛 ENOENT）。**这是契约缺口，不是容错不足。**

与 M8/M9 同族：**功能存在、代码在跑、输入永远为空**。

---

## 5. 修法（候选，待用户批准后实施）

| 方案 | 内容 | 评价 |
|---|---|---|
| **E-1** | 读侧加守卫：`existsSync(evDir)` 为假 ⇒ **静默返回空**（不报错、不计降级） | ✅ 消除噪音与异常开销；**与写侧契约对齐** |
| **E-2** | 写侧改为**注册期确定性建目录** | ⚠️ 需先确认是否该让所有用户都建（**未验证**） |
| **E-3** | 走 R3 留痕：把「importance 恒中性（因无证据事件）」变成**可见状态** | ✅ 让"这条臂没在工作"可查 |

**倾向 E-1 + E-3**：
- E-1 是**契约对齐**（读侧承认"目录可不存在"），非补丁
- E-3 满足 R3 判据（这属**预期外失败**还是**预期内分支**？
  ⇒ 判定为**预期内分支**：无证据事件是合法状态，**不该报错**；但**"这条臂未生效"应当可见**）

**E-2 暂缓**：为何该用户从未触发写入**未查清**（内容条件依赖真实用法，本机无法重放）。
在未查清前改写入时机有风险（可能改变既有用户的数据行为）。

---

## 6. 待确认（未下结论，不得当结论用）

1. **用户侧内容条件为何永不满足？** 三个候选，**均未验证**：
   (a) 新装无历史 ⇒ `corpus` 为空 ⇒ memoryId token 匹配不上
   (b) 用法不触发（纯对话、无工具结果引用记忆）
   (c) 其他配置/版本差异
   ⇒ 需用户侧配置或复现步骤；**本机无法重放**。
2. `evidence` 与 `evidence-pre` 两套目录在发布版是否都存活？
   ⇒ 本机只有 `evidence-pre`（无 `evidence`）；`release.mjs:169` 有文件重命名映射。
   （**待查**：发布版是否也把目录名一并改掉，即用户侧应是 `evidence` 而非 `evidence-pre` —— 报障路径显示是 `evidence`，**与重命名一致**。）

---

## 7. 对后续的影响

- **R3 留痕层的判据在此得到实例**：E-1 属「预期内分支」（静默、不留痕）；
  但**"importance 臂整体未生效"应作为状态可见**（E-3）。
- **优先级**：本项不阻塞 M2.5b（layer 臂）；但**建议与 R3 同批**，因为留痕层正好覆盖它。
