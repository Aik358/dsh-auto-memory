# R1 · 静默降级高危点普查报告

> 2026-09-18 定稿 · 只读普查（未改任何代码）
> 探针：`artifacts/_probe-silent-degrade.mjs`（全仓扫描）、`artifacts/_probe-r1-degrade.mjs`（逐点验证）
> 上游：`BATTLE-PLAN-20260917.md` §3.6（R 系列执行顺序）

---

## 0. 一句话结论

**10 处高危中：1 处确诊真缺陷（evidence 读写不对称）、1 处假警报已撤销（miv）、其余 8 处为设计内容错。**

**同时撤销 BATTLE-PLAN §3.5 的 M2.5c**（miv 疑点）——它是假警报，不得作为 M2.5a 的前置阻塞。

---

## 1. ★ 确诊：evidence 读写**不对称**（真缺陷）

### 证据链

**写入侧**（`evidence-store-pre.js:109-130`）：

```js
async append(evidence, opts = {}) {
  ...
  mkdirSync(this.eventsDir, { recursive: true })   // :126 —— 懒建目录
  appendFileSync(path.join(this.eventsDir, fname), line + '\n', 'utf8')
}
```
- 目录**只在首次 append 成功时才创建**
- 且 append 的调用**有条件**（`context-host-pre.js:164` 的 store 惰性创建 + 上游 feature gate）

**读取侧**（`index.js:5889-5897`）：

```js
const agg = aggregateEvidenceEventsPre(scanEvidenceEventsPre({
  listFiles: () => readdirSync(evDir).filter((x) => x.endsWith('.jsonl')),   // ← 无条件 readdirSync
  ...
}, {}))
} catch (eImp) { try { diag('evidence-agg 降级为中性(impMap 空): ' + ...) } catch (_) {} }
```
- **无条件扫描**，目录不存在即抛 ENOENT ⇒ 静默降级

### 本机实测（对照）

```
~/.dsh/memory/evidence-pre/events/
  2026-09-17.jsonl  5953 行  mtime=09-17 23:58
  2026-09-18.jsonl  1385 行  mtime=09-18 19:12   ← 仍在写
  共 21 个文件
```
⇒ **本机写入侧健康**（开发机长期有会话活动）。

### 用户侧（`C:\Users\Administrator\`）

报 **功能异常**，日志：
```
[dsh-auto-memory] evidence-agg 降级为中性(impMap 空):
ENOENT: no such file or directory, scandir 'C:\Users\Administrator\.dsh\memory\evidence\events'
```
- 路径**不是拼错**：`release.mjs:93` 有 `['memory/evidence-pre','memory/evidence']`（发布版重命名）
- ⇒ 该用户**从未成功 append 过**（目录不存在）⇒ 每次 recall 必走 ENOENT

### 缺陷本质

| 侧 | 行为 | 后果 |
|---|---|---|
| 写 | **懒建 + 有条件** | 新装/未触发该 feature 的用户永远无目录 |
| 读 | **无条件扫描** | 每次都 ENOENT ⇒ importance 恒中性（0.75） |

**⇒ importance 加权这类用户**出厂即死**，且没有任何提示。**
与 M8/M9 同族：**功能存在、代码在跑、输入永远为空**。

### 修法（R3 范围，候选）

| 方案 | 内容 |
|---|---|
| **E-1** | 读取侧先 `existsSync(evDir)`，不存在**静默返回空**（不报错）—— 消除噪音，但不解决"功能是死的" |
| **E-2** | **写入侧改为确定性建目录**（注册期即建），读取侧条件不变 —— 让两侧对称 |
| **E-3** | 两者都做 + 走 R3 留痕：**让"importance 恒中性"这件事可见**（面板/状态文件） |

**倾向 E-1 + E-3**：E-1 消除每次 recall 的异常开销；E-3 让用户能看见"这条臂没在工作"。
**E-2 需先查清 feature gate**（为何该用户没触发写入）——**尚未查证，不得当结论**。

---

## 2. ✖ 撤销：miv 两公式疑点（假警报）

### 原疑点
```js
index.js:5871            sha256([id, l0] 元组)
context-host-pre.js:537  sha256(recs.map(r => r.memoryId).join(','))
```
原判断：两者应一致，否则 worker 三重过滤拒绝 → 静默回退纯词法。

### 追查结果：**两条公式服务两个不同消费者，各自自洽**

**① `index.js:5865` 注释的对照对象是 `index-sync`，不是 `context-host-pre:537`**：
```
// pyCorpus:与 context-host index-sync 同源的 corpus 快照(workspaceKey/scope/miv 须与已同步索引一致,...
```

**② `index-sync-pre.js:62` 只是【接收】miv，不自己计算**：
```js
const miv = String((input && input.memoryIndexVersion) || (snap ? snap.memoryIndexVersion : '') || '')
if (!miv.startsWith('idx_pre_')) return { ok: false, reason: 'memoryIndexVersion' }
```
⇒ 它校验的是**前缀**，公式由调用方给定 ⇒ **不存在"两侧公式不一致"这一说**。

**③ `context-host-pre.js:537` 是另一个域（技能/procedures）**：
```
:526  // 2026-08-28 P1⑥:优先 C2 稠密匹配(技能标题+步骤进嵌入索引,miv=技能集指纹,
:527  // 集合不变则缓存命中);不可用回退词法 2-gram。
:538  const rank = await engine._jsSemanticRank({ memoryIndexVersion: miv, records: recs }, ...)
```
⇒ 消费者是**直接调用**，miv 由本处生成、本处使用，**自洽**。

### 结论
**M2.5c 撤销。** 该疑点不成立；M2.5a 无此前置阻塞。
（教训：注释里的「context-host」指**模块族**而非某一个文件；我最初把 `context-host-pre.js:537` 当成了注释所指的对照点——**推断当结论，已更正**。）

---

## 3. 其余 8 处：判定为**设计内容错**

| 位置 | 降级内容 | 判定 | 理由 |
|---|---|---|---|
| `index.js:5877` | 语义臂择优降级 | 🟡 **设计内，但需可见** | py→JS→词法三级择优是刻意设计（P13）；异常回退词法属预期 |
| `index.js:5908` | temporal-parse 无时间臂 | 🟡 设计内 | 查询无时间表达时**本就该关**（`tr=null` 是正常路径，非异常） |
| `index.js:8795` | l0-index sync 降级 | 🟡 设计内 | 同步失败不阻塞主流程 |
| `index.js:3873` | buildPrevSessionPack → null | 🟡 设计内 | 接续材料失败不该阻断会话 |
| `index.js:1941` | config migrate failed | 🟢 正常容错 | 迁移失败已有 `console.error` |
| `index.js:9154` | agent lifecycle | 🟢 正常容错 | 生命周期钩子 |
| `client.js:2825` | session rename 失败 | 🟢 正常容错 | UI 层 |

**关键区分**：
- **"正常路径"的降级**（如 `:5908` 无时间表达）**不是缺陷** —— 不该报错；
- **"异常路径"的降级**（如 `:5897` ENOENT、`:5877` 引擎失败）**才是** —— 用户应当能知道。

⇒ **R3 留痕层的判据应是**：区分「**预期内分支**」与「**预期外失败**」。
只对后者留痕，否则会淹没在正常路径中。

---

## 4. 对执行顺序的影响

| 序 | 项 | 变化 |
|---|---|---|
| **R1** | 本报告 | ✅ **完成** |
| **M2.5a** | L0 质量门 | ⚠️ **前置 M2.5c 已撤销 ⇒ 立即可开工，无阻塞** |
| **M2.5c** | ~~miv 验证~~ | ❌ **撤销（假警报）** |
| **R2** | 静默降级深查 | ✅ **本报告已覆盖 10 处高危；R2 可缩为"验证 E-2 的 feature gate"** |
| **R3** | 降级留痕层 | 设计要点已明确（见 §3 判据） |

---

## 5. 待办（未下结论的观察点）

1. **为何该用户从未成功 append？**（feature gate / 配置 / 权限三者未分）
   ⇒ 需 user 侧配置或再问用户；**本机无法复现**（本机写入健康）。
2. **`evidence` 与 `evidence-pre` 两套目录在发布版是否都存活？**
   ⇒ `release.mjs:169` 有 `['evidence-store-pre.js','evidence-store.js']`，
   `lib/` 下**两者并存**（探针输出可见）—— 需确认哪一套是发布版实际加载的。
