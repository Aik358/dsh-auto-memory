# 报告：为什么「统一修了两轮」的三条 P1 在 pre 线仍然存在

日期：2026-09-22 · 范围：issue #103 / #104 / #105 对应修复（PR #118 / #119 / #120）
结论：**修复确实做过而且做对了，但它们全部落在 GitHub `main` 一侧；`pre` 开发线与 `main` 自 2026-09-07 起就是两条分叉历史，随后 `main` 又被 3.1.0 发布强推覆盖 ⇒ 三处修复在两条线上同时消失。** 而**发布包是从 pre 线构建的**，所以用户侧从未拿到过这些修复。

---

## 一、现象（当前 pre 线实测，均已复核）

| # | 位置 | 现状 | 后果 |
|---|---|---|---|
| **#105** | `lib/python-setup-pre.js:281` | `resp.body.on('data', …)`（还有 `'error'` / `'end'` / `.destroy()`）；第 279 行建的 `stream` 全程**没有 `stream.write()`** | `fetch()` 返回的是 WHATWG `ReadableStream`，**没有 `.on()`** ⇒ 一调用即抛。Python 档模型下载必崩 |
| **#104** | `lib/index.js:1324` / `:1329` | `this._shadowHost` / `this._activationHost` —— 这两个属性**全仓只在 `engine` 上赋值**（`:9374` / `:9389`）；`class SessionRuntimeStore`（`:1266` 起）从未被赋过 | 两处 `if` **恒假** ⇒ 会话释放的 per-runtime 激活态 / shadow 态**永不回收**，随会话数单调增长 |
| **#103** | `lib/index.js:9545` | `const start = prev && lines.length >= prev.count ? prev.count : lines.length` | `judgement-shadow.jsonl` 写满 256 行后 `lines.length === prev.count` 恒成立 ⇒ `start === prev.count` ⇒ **学习面永久静默停摆**（`:9688` 60s 定时器与 `:9692` 启动调用都在真实运行） |

三处**都不是死代码**：`downloadWithResume` 在 `:231` / `:242` 被真实调用；`dispose` 是常规释放路径；`hubFeedTick` 有定时器与启动调用。
三处**也无守卫覆盖**：pre 线不存在 `smoke-test-issue103-hub-feed-cursor-pre.mjs`、`smoke-test-issue105-python-setup-download-pre.mjs`、`smoke-test-issue55-58-pre.mjs`。

## 二、这三个修复是什么时候做的、做在哪

| PR | 标题 | 合并时间 | 合并提交 | 改的文件 |
|---|---|---|---|---|
| **#118** | `fix(lifecycle): 恢复会话释放 host 回填 + 消费/生产双锁 (#104)` | 2026-09-21 16:47:29 | `c010eaf3` | `lib/index.js`、`tests/smoke/smoke-test-issue55-58-pre.mjs` |
| **#119** | `fix(memory-hub): judgement-shadow 游标改行内容指纹，修环形截断致停摆 (#103)` | 2026-09-21 16:47:34 | `eb858efd` | `lib/index.js`、**新增** `lib/jsonl-tail-cursor.js`、`tests/smoke/smoke-test-issue103-hub-feed-cursor-pre.mjs` |
| **#120** | `fix(python-setup): 重写模型下载链路 + 内容校验与坏产物清除 (#105)` | 2026-09-21 16:47:37 | `8d843b39` | `lib/python-setup.js`、`tests/smoke/smoke-test-issue105-python-setup-download-pre.mjs` |

三条**都是 `base=main` 且 `merged=True`**——这是"你修了两轮"的实证，且修复形态是对的（见下节）。同一批还有 #125（#111 文档）、#126（#113–116 webhook）、#127（#112 测试隔离，未合并）。

## 三、修复原本的正确形态（从被冲掉的快照 `475abfe` 取出，可作为移植参考）

**#104**（`lib/index.js`，接在 `engine._activationHost = …` 之后）：
```js
// issue#58 + issue#104:把两个 host **回填给 runtime 释放路径**。`SessionRuntimeStore.dispose()` 里按
// `this._shadowHost` / `this._activationHost` 清理 per-runtime 态,而这两个属性只挂在 engine 上 ⇒
// 不回填则两处 `if` 恒假、清理恒不执行(激活态与 shadow 态随会话数单调增长)。
// runtimes 在引擎构造期创建,早于各 host ⇒ 只能在此处回填。
// ★回归警示:3.0.1 发布提交 53d20e7 曾整行删掉 activation 侧的回填,而旧测试只断言 dispose
//   函数体里的字符串 ⇒ 静默回退。现由 smoke-test-issue55-58-pre.mjs 的「消费侧行为 + 生产侧成对」
//   双锁住守,删任一侧必红。
engine.runtimes._shadowHost = engine._shadowHost
engine.runtimes._activationHost = engine._activationHost
```
另在该 PR 里新增 `export { SessionRuntimeStore }`，让 dispose 接线能被**行为测试**直接驱动，而不是断言源码字符串。

**#103**：新增模块 `lib/jsonl-tail-cursor.js`，宿主侧改用
`import { createJsonlTailCursorPre } from './jsonl-tail-cursor.js'` + `const hubFeedCursor = createJsonlTailCursorPre({ maxSeen: 1024 })`，
把游标从「行数」改成「行内容指纹」，并在注释里明确写「旧实现 `start = lines.length >= prev.count ? prev.count : lines.length` 在文件写满后…」。

**#105**：`python-setup.js` 里下载改为
`await pipeline(src, createWriteStream(part, { flags: resumeFrom > 0 ? 'a' : 'w' }))`（即真实的流管道 + 断点续传标志），并附内容校验与坏产物清除。

## 四、根因：三条修复为什么在 pre 线不存在

### 4.1 pre 线与 main 是两条分叉历史（决定性证据）

```
git merge-base HEAD origin/main          → 89bd636 @ 2026-09-07 22:38:53
git rev-list --left-right --count HEAD...origin/main  → 135  72
  （pre 独有 135 个提交；main 独有 72 个提交）
git merge-base --is-ancestor 0615414 HEAD → exit=1（不在 pre 线）
pre 线是否存在 tests/smoke/smoke-test-issue58-activation-dispose-pre.mjs → 不存在
```
⇒ 自 **2026-09-07** 起，两条线各自演进。所有 `base=main` 的修复 PR（#118/#119/#120/#125/#126）**从来没有进过 pre 线**。

### 4.2 main 侧随后又被强推覆盖

3.1.0 发布把 `main` 推成了 **pre 线的内容**（`origin/main` 现在 = `d80461f`，正是 pre 线的提交）。于是那三个合并提交 `c010eaf3` / `eb858efd` / `8d843b39` 在本机 `git merge-base --is-ancestor … origin/main` 返回 **128（对象不存在）**，只在 GitHub 侧还能查到 API 记录。PR #126 的合并提交 `475abfe` 同样成了孤儿（`is-ancestor HEAD exit=1`），它所在的快照是目前**唯一还完整保存这三条修复 + 三个守卫**的地方。

### 4.3 于是形成"修了、但又没了"的闭环

```
你修了两轮 ──► 提交进 main（PR #118/119/120，09-21 16:47 全部 merged=True）
                     │
                     ├─ pre 开发线：自 09-07 分叉，从未收到这些提交 ⇒ 三处现状仍是 bug
                     │
                     └─ main 线：3.1.0 发布强推 = 换成 pre 线内容 ⇒ 三个合并提交被冲成孤儿
                     │
发布包从 pre 线构建 ──► 用户侧从来没有过这些修复
```
`lib/python-setup-pre.js` 的 mtime 至今是 **2026-09-10 16:27:45**（自该向导引入后再没被触碰过）——这是"pre 线确实一次都没改过它"的直接证据。

### 4.4 为什么回归没拦住

pre 线的三个守卫文件**根本不存在**（它们随修复一起只在 main 侧）。而 issue #58 那条老守卫 `smoke-test-issue55-58-pre.mjs` 在 pre 线的对应版本只断言 dispose 函数体里的**字符串**，不驱动**行为**——这正是 #118 的注释里点名的失败模式：「旧测试只断言 dispose 函数体里的字符串 ⇒ 静默回退」。⇒ **断言调用存在 ≠ 断言可达性**。

## 五、结论与建议

1. **不是你改错了，是改在了不发货的那条线上。** 修复形态经复核是正确的（回填、指纹游标、pipeline 流管道），只是落点不对。
2. **修复必须落在 pre 线**（用户已明确裁定），因为**发布包由 pre 线构建**（`tools/release.mjs` 从 DEV 树生成 REL 树），main 只是门面。
3. 建议按 pre 线惯例各带**红→绿实证 + 永久守卫**，其中：
   - #104 的守卫必须**驱动行为**（`export { SessionRuntimeStore }` 后直接调 dispose 并断言清理发生），不得只断言源码字符串；
   - #103 的守卫必须**真喂一个写满 256 行的环形文件**，断言仍能拿到新行；
   - #105 的守卫应断言下载链路**真实写盘**（不能用 `resp.body.on` 这条路径）。
4. **长期风险（建议单独立项）**：两条线分叉已达 135/72 提交且靠强推同步 ⇒ 任何"在 main 修"的工作都会周期性丢失。要么把上游修复**回流 pre 线**成惯例，要么让两条线定期对账（可复用的取证命令就是本报告 §4.1 那四条）。
