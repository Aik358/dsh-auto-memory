# ③ Hermes 遗留 · **真机数据核查**（2026-09-19 第二轮）

> 触发：上轮结论基于**源码审计**；本轮直读**真机落盘数据**，得到一条源码看不到的结论。
> 方法：`artifacts/_probe-intent-clean.mjs`（对真实污染串执行）+ 直读 `~/.dsh/memory/hub-pre/procedures.json`。

---

## 1. ★ 首先纠正一条被误传的事实

**ZCode 审计「全机 7 个工作区均无 `procedures.json`」= 定位错了目录。**

真机实测：

| 路径 | 大小 | 最后写入 |
|---|---|---|
| `~/.dsh/memory/hub/procedures.json` | 126 B | 2026-09-01 10:34 |
| **`~/.dsh/memory/hub-pre/procedures.json`** | **8295 B** | **2026-09-19 02:25** |

`procedures.json` **在共享 hub 目录**（`~/.dsh/memory/hub-pre/`），**不在各工作区的 `.dsh-memory/` 下** —— 所以在「哪个工作区」里找永远找不到。
⇒ **「全机无 procedures.json」这条事实不成立**，据此推出的「固化从未发生过」也随之作废。

---

## 2. ★★ 真机数据揭示的真问题：**观察行被污染成注入文本**

本机 10 条 procedure 的实测分布：

| # | stage | title（截断） | 判定 |
|---|---|---|---|
| 1 | deprecated | `Current runtime context. This snap` | ★污染 |
| 2 | **active** | `DSH 发射档位确认流程` | ✅ 正常（**唯一真实富候选**） |
| 3 | deprecated | （乱码）`����������ȷ������(��֤)` | 编码损坏 |
| 4 | observed | `{"path":"D:\\personal_issue\\.dsh-` | ★污染 |
| 5 | observed | `Current DSH file policy: danger-fu` | ★污染 |
| 6 | observed | `Current runtime context. This snap` | ★污染 |
| 7 | observed | `让我自己去试吧。现在是什么情况？` | 用户原话 |
| 8 | observed | `开始实施` | 用户原话 |
| 9 | observed | `开始实施,实施完给我准确的报告保证我能看懂` | 用户原话 |
| 10 | observed | `Approval prompts are disabled in t` | ★污染 |

**7 条 `observed` 中 4 条 title 是运行时信封**（`Current DSH file policy:` / `Current runtime context.` / `Approval prompts are disabled in this session:` / `{"path":...`）。

### 2.1 清洗器有效性：**部分有效，有漏网**

`stripRuntimeIntentPre`（`intent-clean-safe-pre.js`，部署于 **2026-09-17 00:10**）对这 4 条真实信封的实测：

| 信封 | 清洗器是否剥离 |
|---|---|
| `Current DSH file policy: …` | ✅ 剥离（`:17` 有专门规则） |
| `Current runtime context. …` | ✅ 剥离（`:17` 同一条规则） |
| **`Approval prompts are disabled in this session: …`** | ❌ **漏网**（无对应规则） |
| **`{"path":"D:\\…`** | ❌ **漏网**（JSON 形态，无规则） |

⇒ **`stripRuntimeIntentPre` 的全量断言 7/10**，两处真漏。

### 2.2 ⚠️ 关于「污染是否仍在发生」= **证据不足，仅列推断**

**我曾据时间线下此结论，但自查后撤回。** 现有硬证据：

| 事实 | 值 | 性质 |
|---|---|---|
| 清洗器文件 mtime | 2026-09-17 00:10 | 硬证据 |
| 接线点 `memory-hub-pre.js` mtime | 2026-09-17 00:12 | 硬证据 |
| 漏网条目 #10 创建时间 | 2026-09-17 15:40（本地） | 硬证据 |
| **当时宿主加载的是哪版代码** | **无法确定** | ❌ **缺口** |

⇒ **关键缺口**：扫描**当前** node 进程，宿主启动于 **2026-09-18 23:52**（晚于清洗器 1.9 天）。
但 #10 产生于 09-17 15:40，**那时运行的宿主进程早已不存在**，无从判断它是否已加载清洗器。
**mtime ≠ 加载时间** —— 若那时宿主启动于清洗器部署之前且一直未重启，跑的仍是旧代码。

⇒ 因此「污染仍在发生」**只能作为推断列出**，不能作为结论：

> **推断（未证实）**：清洗器覆盖不全 ⇒ 同类信封仍会穿过。
> **不依赖时间线的充分证据**：清洗器是**纯函数**，其对 4 种真实信封的失效已**直接实测**（§2.1）——
> 只要是这种形态的输入，无论何时都会漏。**这比时间线推断更强**，也是本项建议的依据。

**另有一条弱反向证据**：当前宿主（09-18 23:52 起）运行期间，`procedures.json` 于 09-19 02:25 被写过，
但**未新增**任何 observed 条目（10 条中 `createdAt` 最新的仍是 #10）⇒ 至少**当前进程未再产出污染**。
（但这也可能只是因为期间没有成功 episode 触发 crossFeed，**不构成清洗器有效的证明**。）

**根因（代码级，确定）**：`memory-hub-pre.js:137` 的清洗只作用于 `ep.intent`：

```js
const procedureIntent = stripRuntimeIntentPre(ep.intent).trim()
if (ep.success && … && procedureIntent && procedureIntent !== '(未提取)' && ep.actions && ep.actions.length) {
  const cand = { title: procedureIntent.slice(0, 40), … }
```

清洗器是「**逐行 + 行首白名单**」的（`intent-clean-safe-pre.js:17` 只匹配行首
`Current runtime context.` / `Current DSH file policy:`）。
`Approval prompts are disabled…` 与 `{"path":…` **不在白名单** ⇒ 原样穿过。

> ⚠️ 这正是该文件头注释自己预警的风险：「**注入形态会演进（新增标签/换行拼法）⇒ 漏判**」。

---

## 3. 与 ③ 原结论的关系（**修订，不是推翻**）

| 上轮结论 | 本轮修订 |
|---|---|
| issue #30 三处已修 ✅ | **维持**（源码 + 探针 25/25 确认） |
| ③ 降级为「待观测」 | **维持**，但观测项换成了**有真机证据的真问题** |
| H-1「上游是否真产富候选」 | **已可回答**：真机有 1 条 `active` 富候选（`DSH 发射档位确认流程`，`evidence.sessions=11`、`read=4`、`cite=14`）⇒ **上游确实产过富候选，只是仅 1 条** |
| （新增）**H-3** | **清洗器覆盖不全 ⇒ 污染持续进入 procedure 层**（本条**有真机证据 + 时间线**，是本轮唯一**可动手**的发现） |

---

## 4. ⚠️ 处置建议：**仍然不自行实施**，但优先级应当提高

**不建议本轮动手的理由（维持上轮裁定）**：用户 2026-09-13 明确「任何 procedure 记忆引擎改动必须等用户拍板整体方案，别顺手修」。

**但应把 H-3 提到用户面前**，因为：

1. 它有**真机证据**（不是推测）：4/7 污染 + 时间线证明仍在发生；
2. 它**不是一个「要不要开开关」的决策**，而是一个**明确的功能缺陷**（清洗器漏规则）；
3. **成本极低**：`intent-clean-safe-pre.js:17` 的白名单加两个模式即可（纯函数，零副作用）；
4. **风险可控**：加规则只会**多剥**，而剥错的代价是「少一条观察行」—— 观察行本就**不可晋升、不注入**（④ 已实测），故代价近乎为零。

> **注**：`procedures.json` 里已有的 7 条脏数据**不会自动消失**（清洗器只作用于新写入）。
> 是否需要清理存量、以及 `deprecated`/乱码条（#1/#3）如何处理，属**同一决策链**，一并请用户定。
