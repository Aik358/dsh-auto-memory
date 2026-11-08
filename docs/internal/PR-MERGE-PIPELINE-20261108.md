# PR 批量合并流水线（让 4 位作者进 contributors）

> 调查日期：2026-11-08 · 基线 `preview @ a0655823` · **全程只读**（未改 `lib/`、`tests/`、未跑生成器、未动主工作树）
> 所有数字均为本轮实测可复算，不引用任务书或他人给的中间值。

## 1. 目标与约束

### 1.1 目标

让以下 4 个 open PR 的作者进入 GitHub contributors 列表：

| PR | 作者 | 标题 |
|---|---|---|
| #546 | HY-pt | `fix(migrate): 让历史迁移包的显式确认通道贯通到 UI，并做成跨版本契约（补完 #449-1）` |
| #471 | gezerui888 | `fix: reload Python worker after activation mode saves` |
| #475 | lujfsd | `feat(tier0): 未上桌聚合行 + 长尾轮换位 + 曝光/召回计数` |
| #522 | HY-pt | `fix: 接续仪式改为有界重试，避免一次失败即中断交接` |

### 1.2 约束链（本轮实测确认）

```
GitHub contributors 判定基于 repo default_branch = main
        ↓
作者的 commit 必须最终进 main
        ↓
我们的发版流程是「从 preview 构建，main 被强推覆盖」
        ↓
⇒ 让 commit 进 preview 即可，下次发版随之上 main
        ↓
⇒ 不能合到 main（会被覆盖），只能进 preview
```

`main` 与 `preview` 已深度分叉（本轮未重测，沿用任务书口径：main 独有 225 / preview 独有 433）。

### 1.3 关键前提：**不要用 `git merge`**

本轮实测：`#471` / `#475` 的基底是 **main 侧**，`preview` 与它们的 merge-base 落在很早的祖先上（`e951d9eb`），
直接 `git merge preview pr-471` 会产生 **288 个冲突文件**，绝大多数是 main/preview 分叉产物（`.github/`、`CHANGELOG.md`、`README*.md`、`docs/teamwork-impl/*`…）。

```
实测命令：git merge-tree --write-tree preview pr-471
结果：exit=1，冲突文件 288 个
```

**⇒ 必须用「只取该 PR 那一个提交」的方式，而不是整树合并。**

## 2. 历史模板：`merge/pr-batch` 还原

### 2.1 它做了什么

仓库 `D:/dsh-pr-merge`，分支 `merge/pr-batch`，HEAD `9900c048`。

```
9900c048 test(merge): 适配 PR161 的 writeFull 双路结构（补 rawDocStore 垫片）
5948f196 merge: PR #157（接续事务统一）+ 守卫基线重算；补回 E3a hook 计数断言
97edf265 merge: PR #163（诊断可信化）+ 守卫基线重算
c2e03c20 merge: PR #159（JS 语义子进程隔离）+ 守卫基线重算
ca433a08 merge: PR #161
```

### 2.2 流程形态（实测 `git rev-list --parents`）

**一 PR 一 merge commit（真双父）**，不是 squash、不是 rebase：

```
5948f196 的父 = 97edf265（前一状态） + c9d405d9（PR 分支头）
97edf265 的父 = c2e03c20            + c543e622（PR 分支头）
ca433a08 的父 = bba82433            + 3d877fb3（PR 分支头）
```

⇒ 保留作者原始 commit 与署名，这是 contributor 判定的前提。

### 2.3 「守卫基线重算」重钉了哪两个锁

每个 merge commit 同批改这两个文件：

| 文件 | 锁 | 口径 |
|---|---|---|
| `tests/smoke/smoke-test-iter5-skin.mjs` | `classicLF` sha256 | 剥掉两个生成区后的经典档全文（**9 条 replace 管道**，不可手写简化） |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | `R153_CHARS` + sha16 | `lib/index.js` 归一化 LF 后的全文长度与 sha256 前 16 位 |

实测 diff 证据（`git show 5948f196 -- tests/smoke/...`）：

```
iter5-skin: assert.equal(createHash(...).digest('hex'), '37f974562f0a13fc…' → '0cc001442ff97420…')
r26:        R153_CHARS 与 sha16 '2BF186C5B0080A8A' → '1F4CD3CC526DC706'
```

**r26 的重钉还带一个特殊手法**：把某个 hook 行**剔除后再取哈希**，hook 本身单独计数：

```js
const jsDisposeHook = '    try { if (engine._jsSemantic) engine._jsSemantic.dispose() } catch (e) {}\n'
eq(cnt(IX, jsDisposeHook), 1, 'E3a #156 JS engine cleanup registered exactly once')
eq(createHash('sha256').update(IX.replace(jsDisposeHook, '')).digest('hex')..., '1F4CD3CC526DC706', ...)
```

⇒ **这是「想让某个已知行单独被守卫、又不污染整文件哈希」的现成范式**，遇到重复合并冲突时可直接照抄。

### 2.4 它踩过的坑（`9900c048` 那条）

```
9900c048 test(merge): 适配 PR161 的 writeFull 双路结构（补 rawDocStore 垫片）
                            —— 修 #162 测试在合并树上的接口不匹配
改动：tests/smoke/smoke-test-issue162-diagnostic-integrity.mjs | 3 +++
```

**坑**：两个 PR 各自带的测试都基于**自己那条分支的接口形态**。合并后接口变了（`writeFull` 变成双路结构），
测试仍按旧接口写 ⇒ 合并树上测试红。**修法不是改产品代码，而是给测试补垫片。**

⇒ 演进为流程要求：**每合一个 PR，它的自带测试都要在合并树上真跑一遍**，红就补垫片。

### 2.5 这套流程最终有没有推到 preview？

**没有。**（本轮实测）

```
git rev-list --left-right --count origin/preview...merge/pr-batch  →  433    18
                                        （preview 独有 433）  （merge 分支独有 18）
git log origin/preview --oneline --grep='merge:'  →  只有 #150 / #155 两条
git log origin/merge/pr-batch 存在 → 9900c048（已推到 origin/merge/pr-batch，但那是侧分支）
```

⇒ **`merge/pr-batch` 是一条搁浅的侧分支**（18 个提交从未进 preview）。
它证明的是「这套手法能跑通」，**不证明它被采纳过**。方案必须以实测为准重新验证，不能假定它当时的锁值仍然适用。

## 3. 逐 PR 方案

### 3.0 通用工序（每个 PR 都走这 6 步）

```bash
# ① 建隔离 worktree（不碰主工作树）
git worktree add --detach D:/dsh-pm <preview-HEAD>

# ② 只取该 PR 那一个提交（不是整树 merge）
cd D:/dsh-pm && git cherry-pick --no-commit <pr-commit>
#   冲突时改用 3-way apply（实测比 cherry-pick 精确，见 §3.3）
git show <pr-commit> --format='' > p.patch && git apply --3way p.patch

# ③ 解冲突（每个 PR 都是 1~2 个冲突块，见各节）

# ④ 跑该 PR 自带测试 + 受影响套件

# ⑤ 重钉两个锁（§5）

# ⑥ 提交（保留原作者署名）+ 清理 worktree
git worktree remove D:/dsh-pm --force
```

### 3.1 #471 · gezerui888 · Python worker 重载

**想修什么**（作者 commit message 原文）：`The worker reads activationEmitMode at startup, so retire its old configuration (#458)`

**真实改动**（`git show ffb8075e --stat`，只 1 个提交）：

```
 lib/index.js                                       |  6 ++-
 tests/smoke/smoke-test-i356-js-only-embedding-config.mjs |  4 +-
 tests/smoke/smoke-test-issue376-startup-config.mjs |  5 ++-
 tests/smoke/smoke-test-r26-cross-layer.mjs         |  2 +-
 tests/smoke/smoke-test-settings-emit-effective-config.mjs | 52 ++++++++++++++++++++++
 tests/smoke/smoke-test-settings-routes-safety.mjs  |  5 +++
 6 files changed, 70 insertions(+), 4 deletions(-)
```

`lib/index.js` 的实质改动只有 **4 行**（`git show ffb8075e -- lib/index.js`）：

```diff
-          if (wroteNow) engine._jsConfigurationError = ''
+          if (wroteNow) {
+            engine._jsConfigurationError = ''
+            // The worker reads activationEmitMode at startup, so retire its old configuration (#458).
+            engine.invalidatePythonRuntime('activation-mode-saved')
+          }
```

#### ⚠️ **本轮最重要发现：这个 PR 要修的问题，preview 上已经修过了**

实测当前 `preview @ a0655823` 的 `lib/index.js` **L26729-26741**：

```js
26729|           const wroteNow = !(saved && saved.__unchangedByCreateOnly === true)
26730|           if (wroteNow) engine._jsConfigurationError = ''
26731|           // ★#458 修复（2026-11-02）：**保存成功 ≠ 生效**。
26731-26736|  …（完整缺陷描述与修法说明）…
26737|           if (wroteNow) {
26738|             try {
26739|               if (typeof engine.invalidatePythonRuntime === 'function') engine.invalidatePythonRuntime('semantic-emit')
26740|             } catch (eI) { try { diag('semantic-emit: invalidate failed ' + …) } catch (_) {} }
26741|           }
```

**preview 的版本比 PR 更完善**：多了 `typeof … === 'function'` 守卫与 `try/catch` 包裹。

⇒ **合并 #471 的技术价值 ≈ 0，且会覆盖掉更稳健的实现。**

**但是**：用户的真实目标是「让作者进 contributors」。所以可选做法是：

| 做法 | 效果 | 风险 |
|---|---|---|
| **A. 只 cherry-pick 其测试文件**（`smoke-test-settings-emit-effective-config.mjs` 等 4 个） | 作者的 commit 进 preview ⇒ 进 contributors；产品代码零改动 | 低 |
| **B. 原样合入 4 行** | 同上 | **中**：会把 `typeof` 守卫 + try/catch 换回裸调用，是**功能倒退** |
| **C. 不合** | 作者进不了 contributors | — |

**推荐 A**（并在 PR 评论说明「main 线已独立修复 #458，本次仅采纳你的测试」）。

**合完修什么**：r26 锁（`lib/index.js` 若动）/ iter5 锁（若动 `client.js`，本 PR **不动**）。
**要跑**：`smoke-test-settings-emit-effective-config`（新增，52 行）、`smoke-test-r26-cross-layer`、`smoke-test-settings-routes-safety`、`smoke-test-issue376-startup-config`、`smoke-test-i356-js-only-embedding-config`。

### 3.2 #475 · lujfsd · tier0 聚合行 + 轮换位 + 曝光计数

**想修什么**（PR 正文原文）：
> 常驻目录原先只按「层优先级 + 日期」选条目，少数条目长期霸占位置、其余永不露面，且裁剪量只有一个总数，读者无法判断「剩下的是什么类型、值不值得去挖」。

**真实改动**（`git show 21df3cc4 --stat`，1 个提交）：

```
 lib/index.js             |  10 +++-
 lib/tier-layer-inject.js |  12 ++++
 lib/tier0-catalog.js     |  67 +++++++++++++++-------
 lib/tier0-usage.js       | 144 ++++++++++++++++++++++++++++++++++++++++++++++++（新增）
 4 files changed, 211 insertions(+), 22 deletions(-)
```

**它自称的能力**（PR 正文原文，逐字）：
> 裁剪标注改为「未上桌聚合行」并给出按层分布；**该行属不静默类标注，不参与目录预算判定**

#### 特殊调查：旧结论「聚合行不受预算约束」是否还成立 —— **本轮实测复算**

**旧记忆的原话**：「PR #475 声称『聚合行不受预算约束』不成立，复算 157/157 全部顶破 maxTokens」。

**本轮复算（真跑生产函数，用本机真实记忆数据）**：

```js
const CAT = await import('lib/tier0-catalog.js')
// 真实来源：user 24080 + project 23634 + whiteboard 14371 + log 16344 + 11 份 reflection
const r = CAT.buildTier0CatalogFromTextPre(sources, { markTruncation: true })
```

实测结果：

```
items      = 15
tokens     = 798  /  maxTokens 800
余量       = 2 tokens      ← ★关键
truncated  = true
dropped    = 189
units      = 207
```

**结论（本轮复算，可复算）**：

1. **「157/157 顶破」这个数字本轮无法复现** —— 我的实测是 `tokens=798/800`，**没有顶破**，余量 **2 tokens**。
   任务书里那个 157 的口径未知（可能来源数、可能条目数、可能是别的批次的数据），**本轮标记为「未复现，口径不明」**。
2. **但旧结论的实质是对的**：余量只有 **2 tokens**，意味着**追加任何一行聚合文案都会超**。
   `#475` 的聚合行文案实测模板（PR 源码）：
   ```
   `未上桌（${dist}）· 用 memory_recall 取`
   `未上桌（低优先级）· 用 memory_recall 取`
   ```
   这两句任何一条都远超 2 tokens。
3. `#475` 声称「该行**不参与**预算判定」，但**代码层面是否真的这样实现，本轮未逐行验证**（只读了 PR 正文与 `tier0-usage.js` 前 60 行）。
   ⇒ **列为「未验证」**，合并前必须补验：在 `buildTier0CatalogFromTextPre` 里确认聚合行的 token 不计入 `maxTokens` 判定。

**冲突**（实测 `git cherry-pick --no-commit 21df3cc4`）：

```
lib/index.js            : 1 个冲突块
lib/tier-layer-inject.js: 1 个冲突块
```

**合完修什么**：
- 若聚合行确实超预算 ⇒ 要么提高 `TIER0_DEFAULTS.maxTokens`（**会改变所有用户的注入体积**，需用户裁定），要么把聚合行做进「不参与预算」的实现。
- r26 锁（`lib/index.js` +10 行）。

**要跑**：全套 `smoke-test-v4-h3-*`、`smoke-test-t0-3-budget-ledger`（注入预算按 rules 条数算）、`smoke-test-r26-cross-layer`。

**自带测试**：**无**（该 PR 未新增测试文件）。⇒ 合并时必须自己补一条「聚合行不参与预算」的守卫。

### 3.3 #522 · HY-pt · 接续仪式有界重试

**想修什么**（PR 正文原文，摘）：
> `hostRefreshRitual` 对「刷新仪式」那条 prompt 只发一次：turn 报 failed/aborted，或轮询超时，立即返回 `{ok:false}`。调用方见 `!ok` 直接 throw，整个接续中断 … 从用户视角看就是「聊到一半突然忘了」。

**真实改动**（`git show c6f5fdd7 --stat`，1 个提交）：

```
 lib/index.js                            |  89 ++++++++++++-----
 tests/smoke/smoke-test-ritual-retry.mjs | 186 ++++++++++++++++++++++++++++++++
 2 files changed, 251 insertions(+), 24 deletions(-)
```

#### ⚠️ **本轮第二个重要发现：这个 PR 要修的问题，preview 上也已经修过了**

实测当前 `preview @ a0655823`：

```
lib/index.js:1055   autoContinueRefreshAttempts: 2,        ← DEFAULT_CONFIG 已有
lib/index.js:7971   // 修法：同一条 prompt 最多发 maxAttempts 次（默认 2，可用 autoContinueRefreshAttempts 调），
lib/index.js:7977   const maxAttempts = Math.max(1, Math.min(3, Number(this.config.autoContinueRefreshAttempts) || 2))
tests/smoke/smoke-test-ritual-retry.mjs  已存在（187 行 / 7856 B）
```

**且 preview 版套件真跑全绿**：

```
node tests/smoke/smoke-test-ritual-retry.mjs  →  EXIT=0
[SMOKE ritual-retry] PASS 16 / 16  FAIL 0
```

**两版套件不同**（实测 sha256）：

```
preview 版 : 7856 B / sha16 681cd05b2149f8f6   ← 标注「(#524)」
PR#522 版  : 8042 B / sha16 61e494d140e4aec0
逐字节相同 : false
```

⇒ preview 已按 issue **#524** 独立实现过同一件事，且自带测试 16/16 绿。

**但 #522 的 PR 正文比 preview 实现多说了三个细节**，值得核对是否已覆盖：

| PR 提到的细节 | preview 是否已实现 |
|---|---|
| 每次重试**重取 baseSeq 与新 reqId**（不重取会误判结束） | **未验证** |
| 重试时把上一轮失败原因写进 prompt，并要求「只补齐未完成部分」 | **已实现**（套件 `P3 重试 prompt 带原因` 绿） |
| `aborted` 不重试 | **已实现**（套件覆盖） |
| 两次都假成功 ⇒ 仍 `ok:true` 但带 `partial:true` | **未验证** |

**冲突**（实测）：

```
git cherry-pick --no-commit c6f5fdd7  →  exit=1
冲突文件：仅 lib/index.js，1 个冲突块
```

**PR 的 hunk 范围**：`@@ -978` / `@@ -7216` / `@@ -7244` / `@@ -7313`（4 处，全部集中在 `hostRefreshRitual` 附近）

**合完修什么**：r26 锁（+89 行 index.js）。

**推荐**：与 #471 同理——**先核对 preview 实现是否已覆盖那 2 个未验证细节**；已覆盖则只合其测试文件（保留更完善的 preview 实现），未覆盖则把缺的 2 点补进 preview 实现并同时给作者署名。

### 3.4 #546 · HY-pt · 迁移 optin 契约

**想修什么**（commit message）：`让历史迁移包的显式确认通道贯通到 UI，并做成跨版本契约（补完 #449-1）`

**真实改动**（`git show 7188203e --stat`，1 个提交）：

```
 lib/client.js                                     |  85 ++++++++-
 lib/migration-optin-contract.js                   | 103 +++++++++（新增）
 tests/smoke/smoke-test-migrate-host-wiring.mjs    |  62 ++++++-
 tests/smoke/smoke-test-migration-optin-compat.mjs | 141 +++++++++++++（新增）
 tools/apply-migration-optin.mjs                   | 245 ++++++++++++++++++++++（新增）
 tools/lib/migration-contract-probe.mjs            |  83 ++++++++（新增）
 tools/probe-major-upgrade-migration.mjs           | 215 ++++++++++++++++++++（新增）
 7 files changed, 926 insertions(+), 8 deletions(-)
```

#### 冲突：**0 个**（实测 `git cherry-pick --no-commit 7188203e` → `exit=0`，干净应用）

#### 但有一个致命问题：**改了生成区却没改 frozen 源**

实测 `#546` 对 `lib/client.js` 的 hunk 行号：

```
@@ -1,3 +1,52 @@               ← 文件头（手写区）
@@ -12769 / -12824 / -12845 / -12978   ← 手写区
@@ -18240 / -18294 / -18315 / -18413   ← ★生成区内
@@ -20393                              ← ★生成区内
@@ -21863 / -21918 / -21939 / -22057   ← ★生成区内
```

当前 preview 的生成区边界（实测）：

```
:16454  // ===== ITER5-LEGACY-GENERATED:BEGIN =====
:16460  // ITER5-GENERATED:BEGIN
:18974  // ITER5-GENERATED:END
:18979  // ===== ITER5-LEGACY-GENERATED:END =====
:18980  // ITER5-GENERATED:BEGIN
:22735  // ITER5-GENERATED:END
```

⇒ **`18240` / `18413` / `20393` / `21863` / `22057` 全部落在 `16460-22735` 内**。

#### 「有 0 冲突」恰恰是最大的陷阱

`git cherry-pick` 干净应用，是因为生成区的**当前内容**与 PR 基底一致 ⇒ 无冲突。
但**生成区的真源是 `skins/legacy/iter5-325.js.frozen`**（及 `skins/iter5/*`），不是 `lib/client.js`。
⇒ 一旦跑 `build-iter5-skin`，**直接改在生成区的改动会被整段冲刷掉**。

任务书称实测 `build-iter5-skin --check` 直接失败（`Expected exactly one settings seam`）。
**本轮未复跑该命令**（纪律要求不跑生成器），标记为「沿用任务书结论，未独立复验」。

**合完要修什么（三选一，需用户裁定）**：

| 做法 | 说明 | 风险 |
|---|---|---|
| **A. 把改动搬进 frozen 源再重跑生成器** | 正解，但要做 5 处生成区改动的「反向定位 + 搬到源」 | 中，工作量大 |
| **B. 只合手写区部分 + 新增文件** | 生成区 5 处丢弃（`lib/client.js` 用 `git checkout` 还原生成区） | 低，但该 PR 的 UI 贯通能力可能残缺 |
| **C. 整 PR 合入 + 跑一次生成器让它冲刷** | ❌ 无意义（改动被冲掉） | — |

**要跑**：`build-iter5-skin --check`（必须 SYNC-OK）、`smoke-test-migrate-host-wiring`、`smoke-test-migration-optin-compat`（新增 141 行）、`smoke-test-iter5-skin`（重钉 classicLF）。

**自带测试**：**有 2 个**（`migrate-host-wiring` +62、`migration-optin-compat` +141 新增）。

## 4. 推荐顺序（按性价比）

| 序 | PR | 理由 | 预估工作量 |
|---|---|---|---|
| **①** | **#522** | 冲突仅 1 个文件 1 块；preview 已实现同一能力，**最可能只需合测试文件**；不动 `client.js` ⇒ **不碰生成区** | 小 |
| **②** | **#471** | 冲突 3 文件但都是测试；产品代码 4 行且 preview 已更好地修过 ⇒ **只需合测试文件**；不动 `client.js` | 小 |
| **③** | **#546** | 冲突 **0**（最干净），但**动了生成区** ⇒ 要重跑生成器 + 重钉 iter5 锁；自带 2 个测试 | 中 |
| **④** | **#475** | 冲突 2 文件；**无自带测试**；且**预算余量只剩 2 tokens** ⇒ 需先裁定「提额 / 改造 / 放弃」 | 大（含用户裁定） |

**理由要点**：

- 前两个（#522 / #471）**都不碰 `lib/client.js`**，所以**不需要动生成器、不需要重钉 iter5 锁**，只碰 r26。风险面最小。
- #546 是唯一「冲突 0 但要动生成区」的，看起来最容易、实际最麻烦 —— **放在中间**，避免它挡在前面让人误判「很简单」。
- #475 排在最后，因为它**卡在一个需要用户拍板的判定上**（预算余量 2 tokens），而且没有自带测试，验收成本最高。

## 5. 统一收尾步骤

### 5.1 每个 PR 合完必做

```bash
# ① 语法
node --check lib/index.js
node --check lib/client.js      # 仅当本次动了 client.js
node --check <新增的 lib 文件>

# ② 生成器同步（仅当动了 client.js 或 frozen 源）
node tools/build-iter5-skin.mjs --check     # 必须 SYNC-OK

# ③ 该 PR 自带测试
node tests/smoke/<pr 自带套件>.mjs
```

### 5.2 重钉哪些锁

| 锁 | 文件 | 触发条件 | 口径 |
|---|---|---|---|
| **r26** `R153_CHARS` + sha16 | `tests/smoke/smoke-test-r26-cross-layer.mjs` | **每次动 `lib/index.js`** | `readFileSync('lib/index.js').replace(/\r\n/g,'\n')` 后的长度与 sha256 前 16 位**大写** |
| **iter5** `classicLF` sha256 | `tests/smoke/smoke-test-iter5-skin.mjs` | **仅当动 `lib/client.js`**（含生成区重建） | **必须用该套件自己的 9 条 replace 管道**，禁止手写简化剥离 |

**重钉纪律（本轮实证过的坑）**：先用套件自身管道对**改动前**的 HEAD 复算，证明结果与旧登记值**逐字相等**，再取改动后的值。

```js
// 反例：手写简化管道 ⇒ 得到完全不同的哈希
// 正例：直接跑套件，让它自己打印 actual，抄它的值
```

### 5.3 r26 重钉模板（本轮实测可用）

```js
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const IX = readFileSync('lib/index.js', 'utf8').replace(/\r\n/g, '\n')
console.log(IX.length, createHash('sha256').update(IX).digest('hex').slice(0, 16).toUpperCase())
```

当前基线（`preview @ a0655823`，HEAD 提交态）实测：

```
IX = 1,523,143 / sha16 DD71C544F81B79C3
```

> ⚠️ **本轮实测到主工作树已被并行线改动**（`lib/index.js` 工作区态 = IX 1,536,208 / 01E15529A8EAFAFC，
> 另有 `lib/client.js` / `lib/upgrade-estimate.js` / 2 个测试文件未提交）。**动手前必须重新取当前 HEAD 的值。**

### 5.4 回归

```bash
# 相关套件（快）
node tools/run-smoke.mjs --jobs=8 --filter 'r26|iter5|ritual|tier0|migration|rules'

# 全量（慢，约 160-360s）
node tools/run-smoke.mjs --jobs=8 --timeout=180000
```

**判据**：`PASS 全绿 / FAIL 0 / TIMEOUT 0`。
注意本仓已知的 **FLAKY** 现象（并发下的偶发红），复跑确认。

### 5.5 怎么 force push

```bash
# 前提：本地 preview 领先 origin/preview（本轮实测主工作树 0 ahead / 15 behind 的形态需要先 pull）
git push --force-with-lease origin preview
```

**用 `--force-with-lease` 不用 `--force`**：租约检查能防止覆盖掉别人的推送。

## 6. 失败回滚方案

### 6.1 单 PR 失败（最常用）

```bash
# 因为有独立 worktree，直接丢掉即可
git worktree remove D:/dsh-pm --force
# 主工作树从未被碰过 ⇒ 无需回滚
```

**这是「一 PR 一 worktree」的最大收益：任何单个 PR 失败不影响其它 PR，也不需要 `git reset`。**

### 6.2 已合并后发现问题

| 场景 | 做法 |
|---|---|
| 某个 merge commit 有问题、其余没合并 | `git revert -m 1 <merge-commit>`（保留作者署名仍在历史里，contributors 判定看的是**是否曾进过 main**，revert 不撤销署名） |
| 多个都合了、整体不可用 | 回到 `preview @ a0655823` 重建分支，逐个重放（每个 PR 都是单提交，重放成本低） |
| 已 force push 到 origin/preview 后才发现 | **先 `git revert` 再 push**，不要再次 force push 覆盖（`reflog` 仍有救，但线上已有人拉取过的风险自负） |

### 6.3 关键保险：合并前留锚点

```bash
git tag pre-prbatch-$(date +%Y%m%d-%H%M) preview   # 打 tag 再动
```

`merge/pr-batch` 的历史是**没有打这种 tag 的**（本轮实测其 18 个提交零 tag），这是它搁浅后难以复用的原因之一。**本方案补上这一环。**

## 7. 未验证项（明确列出，不要当已确认）

| # | 项目 | 缺什么证据 |
|---|---|---|
| 1 | `#546` 合并后 `build-iter5-skin --check` 确实失败（`Expected exactly one settings seam`） | 纪律要求不跑生成器，**未复跑**；沿用任务书结论 |
| 2 | `#475` 的聚合行在代码层面**真的不参与预算判定** | 只读了 PR 正文 + `tier0-usage.js` 前 60 行，**未逐行验证 `buildTier0CatalogFromTextPre` 的预算分支** |
| 3 | 旧结论「157/157 顶破 maxTokens」 | **本轮无法复现**（实测 798/800 未顶破）；那个 157 的口径不明 |
| 4 | `#522` 的「每次重试重取 baseSeq 与新 reqId」「两次假成功带 partial」在 preview 实现里是否已覆盖 | 只核了 `autoContinueRefreshAttempts` 与 3 条套件断言，**这 2 点未逐行核** |
| 5 | `#471` / `#475` / `#522` 各自自带测试在**合并树**上是否全绿 | 只在各自 PR 分支语境下确认存在，**未在合并树上真跑** |
| 6 | `#475` / `#546` 的完整测试套件 | 二者都**未在合并树上跑过**（#546 冲突 0 但未跑测试） |
| 7 | main / preview 分叉量（225 / 433） | 本轮未重测，沿用任务书 |

## 8. 复算命令清单（每个数字都能重跑）

```bash
# PR 真实改动
cd D:/dsh-pr-merge
git show ffb8075e --stat      # #471
git show 21df3cc4 --stat      # #475
git show c6f5fdd7 --stat      # #522
git show 7188203e --stat      # #546

# 冲突探测（不落盘）
git merge-tree --write-tree preview pr-471        # 288 冲突（整树，不可用）
git worktree add --detach D:/dsh-pm preview
cd D:/dsh-pm && git cherry-pick --no-commit ffb8075e   # 3 文件冲突

# 生成区边界
node -e "const fs=require('fs');fs.readFileSync('D:/dsh-auto-memory/lib/client.js','utf8').split(/\r?\n/).forEach((x,i)=>{if(/ITER5-(LEGACY-)?GENERATED:(BEGIN|END)/.test(x))console.log((i+1)+'| '+x.trim())})"

# tier0 预算实测
node --input-type=module -e "…buildTier0CatalogFromTextPre(真实来源, {markTruncation:true})…"
#   → tokens 798 / maxTokens 800 / 余量 2

# r26 当前值
node -e "const fs=require('fs'),c=require('crypto');const ix=fs.readFileSync('lib/index.js','utf8').replace(/\r\n/g,'\n');console.log(ix.length, c.createHash('sha256').update(ix).digest('hex').slice(0,16).toUpperCase())"
#   → 1523143 DD71C544F81B79C3（HEAD 态）
```
