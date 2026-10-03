# ⑨ 漏网追加取证（2026-09-19 22:40 · 真机实测）

> **性质**：⑨ 修复后**新产生**的脏数据。不是存量，是**活的漏网证据**。
> **发现方式**：用户截图「技能审批队列 (5)」，主代理实测宿主内存发现数字**真的回到了 5**。

---

## 0. 实测数据（`GET /api/dsh-auto-memory-pre/memory-hub`）

| 指标 | ⑨ 清理后（20:15） | **现在（22:40）** |
|---|---|---|
| `procedures.size` | 12 | **14** |
| `pipeline`（会进注入路径） | **3** | **5** |
| `active` | 1 | 1 |

**pipeline 逐条**（`obs=True` 即 `observationOnly`）：

```
[observed] 让我自己去试吧。现在是什么情况？              obs=True   ← 旧（真人文本）
[observed] 开始实施                                      obs=True   ← 旧（真人文本）
[observed] 开始实施,实施完给我准确的报告保证我能看懂      obs=True   ← 旧（真人文本）
[observed] Source: me                                    obs=True   ← ★ 新漏网
[observed] Reference: ## 2026-09-18 - dsh-auto-memo       obs=True   ← ★ 新漏网
```

**⇒ ⑨ 修好的判据挡住了 8 条存量，但挡不住这两个新形态。**

---

## 1. 根因：判据「太具体」——把「前缀」和「内容」绑死了

⑨ 落地的 F3（`lib/intent-clean-safe-pre.js`）：

```js
const PLUGIN_TAIL_MARKER_RE = /^\[?Retrieved memory ref
  |^Verify against the current user request
  |^If a reference hints at what you need
  |^Source:\s*mem_[0-9a-f]{32}      // ← ★ 问题在这
  |^Reason:\s*fv2 lane=
  |^Score:\s*[0-9.]+ \(rank \d+\/\d+\)/i
```

**`^Source:\s*mem_[0-9a-f]{32}`** —— 它要求 `Source:` **后面必须紧跟合法的 `mem_<32hex>`**。

而漏网的这条是 **`Source: me`**：
- `Source:` 后面不是 `mem_<32hex>`
- ⇒ **判据不匹配 ⇒ 放行**

**同理**：`Reference: ## 2026-09-18 - dsh-auto-memo` —— F3 里**根本没有 `^Reference:` 这一条**
（只有 `^\[?Retrieved memory ref`，那是召回块的**首行**，不是 `Reference:` 行）。

---

## 2. ★ 这两条是怎么产生的（推断，附证据方向）

**推断（基于形态）**：它们来自**召回块被截断后的残片**。
召回块的完整形态包含 `Source: mem_<32hex> / <scope> / v<n> / <digest>` 与 `Reference: <正文片段>` 两类行。
当这些行**作为 intent 的一部分被截断**（`slice(0, 40)`，见 `memory-hub-pre.js:155`）时：

- `Source: mem_abc123...` 被截 → `Source: me`
- `Reference: ## 2026-09-18 - dsh-auto-memo...` 被截 → 标题即截断结果

**⇒ 截断让「内容判据」失效**，但**前缀 `Source:` / `Reference:` 仍然完好**。

**关键教训（与 ⑨ 的 F3 设计初衷直接冲突）**：
> ⑨ 的注释里明写「**判据是族（family）+ 形状，不是整句前缀** ⇒ 框架换措辞仍能被同一个族覆盖」。
> **但 F3 的实际实现把「前缀」和「后缀内容」绑死了** ⇒ 一旦被截断，就漏。
> **这正是 ⑨ 自己批评过的错误模式，在 F3 上复发了一次。**

---

## 3. 修法（**尚未动手，待与 ⑩ 一并处理**）

**方向**：F3 应改为 **「前缀即判据」**，不要求后缀形态：

```js
// 现状（过严，被截断即漏）
|^Source:\s*mem_[0-9a-f]{32}

// 应为（前缀族，后缀不约束）
|^Source:\s*\S          // 或更严格：^Source:\s*(mem_|me\b|epi_|session)
|^Reference:\s*\S      // ← 新增，F3 目前完全没有这一条
```

**⚠️ 必须同时守住误伤边界**（⑨ 套件 [4] 组守的就是这条）：
- 「帮我看看 `[Retrieved memory reference]` 这个标记是干嘛的」**不得被删**
- ⇒ 前缀判据必须**要求 `Source:`/`Reference:` 位于行首**（`^` 锚定保留），
  且**不得**把正文里出现的普通 `Source:` 误判
- ⇒ 建议**加 `\s*\S`（后面必须跟非空内容）**，避免把孤立的 `Source:` 也吞掉

**验收要求**：
1. 新增套件用例：`Source: me` / `Reference: ## 2026-09-18 - dsh-auto-memo` **必须被判脏**
2. 反向用例：正文中的 `Source:` / `Reference:` **不得**被误删（沿用 ⑨ 套件 [4] 组口径）
3. 变异演示真红
4. 全量回归 0 失败

---

## 4. 与既有计划的关系

| 项 | 关系 |
|---|---|
| **⑨** | **判定为「修得不完整」** ⇒ 需追加一轮 F3 判据修正（本文件即其取证） |
| **⑩-a / ⑩-b** | **同源**：fact 分支同样未清洗 ⇒ 本次一并修 |
| **存量 2 条新脏** | 与 ⑩-b 的「存量 3 条 fact」处置同源 ⇒ **同样走路 C（靠卫生门堵住）** |

**⇒ 建议把「F3 前缀判据修正」并入 ⑩ 那一批一起做**，因为它们都在 `memory-hub-pre.js` 的同一条链路上。

---

## 5. 取证边界
- 本文所有 `procedures.size / pipeline / title` 均为**实测**（`GET /api/dsh-auto-memory-pre/memory-hub`，2026-09-19 22:40）。
- 「这两条来自召回块截断残片」为**推断**，依据是形态与 `memory-hub-pre.js:155` 的 `slice(0, 40)`；
  未逐条回溯其 `sourceEpisodes` 确认。
