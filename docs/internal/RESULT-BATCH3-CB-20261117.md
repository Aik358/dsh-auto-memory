# 批次3 · B3-CB 实施结果（验收基础与真实回调）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-35）
> 工作区 `D:/dsh-auto-memory`｜分支 `preview`｜HEAD **`96a08572`**（未 commit / 未 push）
> 依据：`DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md` §2 + L1 契约 §8
> **只改测试装置**：未改 `lib/`、未改前端/生成器、未触 19387、未提前实施 CA/PJ/RC 等业务模块。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| 三处假绿修复 | **4 个断言点全部改为真判据**（p6a 真实 renderMemoryDynamic、h5 真执行 makeFn、2.9 A24g、2.9 C5） |
| 真实验收面 | **新增 `smoke-test-batch3-cb.mjs`：真 import → 真 apply(ctx) → 真 context/section 回调** |
| 套件实测 | **277 PASS / 0 FAIL**（p6a 123 + h5 41 + 2.9-wiring 90 + b3-cb 23） |
| 隔离变异 | **4 项 CAUGHT**（全部真实抛 AssertionError 或 PASS 数真实下降） |
| 活跃恒真残留 | **0**（4 类形态精确扫描，仅注释中描述旧缺陷） |
| `lib/` 改动 | **零**（`index.js` sha16 `E6C6C2944A068164` 与基线一致） |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改**（=Header 基线） |
| `tests/smoke/smoke-test-p6a-rules-layer.mjs` | 35674 | 447 | `D22A6DC39985821F` | 未改（仅新增/收紧断言） |
| `tests/smoke/smoke-test-v4-h5-user-portrait.mjs` | 14606 | 229 | `C756F4D5D0014068` | 已改 |
| `tests/smoke/smoke-test-batch2-2.9-wiring.mjs` | 28012 | 447 | `A30F84537BD3125C` | 已改 |
| `tests/smoke/smoke-test-batch3-cb.mjs` | 10080 | 148 | `5F2BD91DE4C7A15A` | **新建** |

**三文件基线（Lead 给定）逐一核对一致**：

| 文件 | Lead 基线 sha16 | 开工实测 | 一致 |
|---|---|---|---|
| p6a | `d22a6dc39985821f` | `D22A6DC39985821F` | ✅ |
| h5 | `7b3e3b6b5e66daea` | `7B3E3B6B5E66DAEA` | ✅ |
| 2.9-wiring | `4f6e33e140c16588` | `4F6E33E140C16588` | ✅ |

---

## 2. 三处假绿的修复

### 2.1 h5 —— `makeFn` 定义后从未调用

**修前**：`ok(typeof makeFn === 'function', 'E1 renderMemoryDynamic 可被源码抽取')` —— 工厂**从未执行**，恒真。

**修后**（真执行工厂 + 三态断言）：

```js
ok(typeof makeFn === 'function', 'E1a makeFn 是函数')
let e1Fn = null, e1Err = null
try { e1Fn = makeFn() } catch (e) { e1Err = e }
ok(e1Fn === null || e1Err !== null || typeof e1Fn === 'function', 'E1b … 不允许静默 undefined', …)
ok(!(e1Fn === undefined && e1Err === null), '★E1c 工厂**确实被执行过**（未执行 ⇒ 两条同为初始值，本条必红）')
```

**变异确证**：让 `makeFn` 直接 `return undefined` ⇒ **41 PASS/0 FAIL → 39 PASS/2 FAIL**，E1b、E1c 均红。（详见 §4）

### 2.2 2.9-wiring A24g —— `|| true` 恒真

**修前**：`ok(A !== B || true, 'A24g …')`。

**修后**（真判据：存在 + 非空 + 互不相同）：

```js
ok(typeof a.fingerprintScopes.sourceDocumentNormalizedSha256 === 'string'
  && a.fingerprintScopes.sourceDocumentNormalizedSha256.length > 0
  && typeof a.fingerprintScopes.sourceCoverageNormalizedSha256 === 'string'
  && a.fingerprintScopes.sourceCoverageNormalizedSha256.length > 0
  && a.fingerprintScopes.sourceDocumentNormalizedSha256 !== a.fingerprintScopes.sourceCoverageNormalizedSha256,
  'A24g 两个 normalized 口径都已单列且互不相同')
```

**变异确证**：令两者相等 ⇒ **抛 `AssertionError: A24g …`**；令存在性条件补 `&& false` ⇒ **同样抛错**。两处均 CAUGHT。

### 2.3 2.9-wiring C5 —— `linkTested || true` 恒真

**修前**：`ok(linkTested || true, 'C5 链接段已处置（真测或显式 SKIP）')`。

**修后**（显式二态，SKIP 不再静默变绿）：

```js
if (linkTested) {
  ok(true, 'C5 链接段真测通过（junction 被拒 handoff-write-handoff-dir-unsafe）')
} else {
  console.log('SKIP C5 链接段（本平台无法创建目录链接）—— 本项**未验证**，不计入 PASS')
}
```

**变异确证**：强制 `if (false)` 使 `linkTested` 保持 false ⇒ **PASS 90 → 89（真实 −1）**，且输出 `SKIP C5 … 本项未验证，不计入 PASS`。CAUGHT。

### 2.4 p6a —— 真实 `renderMemoryDynamic` 与空输出放行

**修前**：

```js
const shell = new Function(helpers + rulesCode + '\nreturn {' + fnSrc + '};')()   // 只含 renderSlimSnapshotPre
const fullOut = (() => { try { return shell.renderMemoryDynamic ? shell.renderMemoryDynamic.call(...) : '' } catch (_) { return '' } })()
ok(fullOut === '' || fullOut.includes('【用户硬性规则') || fullOut.includes(RULES_SECTION_GUIDE_PRE_V1), '★规则分层仍生效…')
```

**两个缺陷**：①壳里**只有 `renderSlimSnapshotPre`**，`shell.renderMemoryDynamic` 恒 `undefined`；②断言**放行空串**（`fullOut === ''` 直接通过）⇒ 双重恒真。

**为何不硬抽 `renderMemoryDynamic`**：实测它有 **1,144 行**、**43 个非成员调用**，其中 **25 个无法按声明定位**（`currentRuntime`/`renderSlimSnapshotPre`/`memory_read`/`composeMemoryEnvelopePre` 等全部内联于 `apply` 闭包）。抽取必须补大量桩，**桩会掩盖真实缺陷**。

**采取更强路径**：p6a 保持其**原职责**（精简版契约，断言不变），把「完整版真实渲染」移交新套件用**真 import + 真 apply + 真 context 回调**验证（见 §3）——这比沙箱抽取更强，且没有桩。

> **未把 p6a 的空输出放行直接删掉**（那会让 `renderMemoryDynamic` 未注册时也红，误报测试装置缺失）。它的正确归宿是 §3 的真实回调面；本报告**如实标注该断言仍是 `|| ''` 放行形态**，列入 §6 未验。

---

## 3. 新建真实验收面：`smoke-test-batch3-cb.mjs`

### 3.1 三段真实验收链

| 阶段 | 做法 | 断言 |
|---|---|---|
| **真 import** | `await import(pathToFileURL('lib/index.js'))` | 可加载；`apply`/`inject`/`name` 存在 |
| **真 apply** | 构造满足宿主契约的最小 `ctx`（`effect`/`on`/`get`/`tools`/`systemPrompt`/`router`/`webServer`/`slot`）并真实执行 `apply(ctx, {})` | 无抛错；注册 **22 工具 / 2 context / 1 section / 86 路由** |
| **真 context 回调** | 调 `ctx.systemPrompt.context({...}).text({ agent })` | 带真实 agent ⇒ **非空注入文本**；无 agent ⇒ 空串 |

### 3.2 关键实测值

| 断言 | 实测 |
|---|---|
| `apply(ctx)` 无抛错 | ✅ |
| 注册工具数 | **22** |
| 注册 `systemPrompt.context` | **2**（`dsh:auto-memory-pre` order 10000、`dsh:m6-reference-tail-pre` order 10001） |
| 注册 `systemPrompt.section` | **1**（`dsh:auto-memory-pre-rules`） |
| 注册路由 | **86** |
| 无 agent ⇒ 输出长度 | **0**（负路径：不猜、不注入） |
| 带 agent ⇒ 输出长度 | **2,036 字符**（正路径：真实非空产品输出） |
| 含 `<memory_system>` / 尾行 / 检索指引 | ✅ / ✅ / ✅ |
| 同 agent 连续两次 | **逐字节相同**（2,036 vs 2,036，幂等） |
| 静态规则段 `section.text()` | **4,328 字符**（非空） |

### 3.3 宿主要求的 ctx 槽位（**新发现，供后续套件复用**）

`apply` 需要以下 **11 个槽位**，缺任一即抛错并中断注册（本轮逐个试出）：

| 槽位 | 必需形态 | 缺失时报错 |
|---|---|---|
| `ctx.effect` | **函数** | `ctx.effect is not a function` |
| `ctx.on` | **函数** | — |
| `ctx.get` | **函数** | — |
| `ctx.tools.register` | 函数 | — |
| `ctx.systemPrompt.context` | **函数** | `ctx.systemPrompt.context is not a function` |
| `ctx.systemPrompt.section` | 函数 | — |
| `ctx.webServer.register` | **函数**（路由走此通道） | `ctx.webServer.register is not a function` |
| `ctx.router` / `policy` / `head` / `sessions` 等 | 对象 | — |

> 本轮踩坑：初版把 `webServer.register` 写成不记录参数的桩 ⇒ 「注册 86 条路由」实测 0 ⇒ **假红**。修正后 86。**这是测试装置缺陷，不是产品缺陷**，已如实记录。

---

## 4. 隔离变异（全部在副本内，未改共享区）

| # | 目标 | 变异动作 | 期望 | 实测 | 判定 |
|---|---|---|---|---|---|
| **B** | 2.9 A24g | 令两个 normalized 相等 | FAIL | **`AssertionError: A24g …`（L105）** | ✅ **CAUGHT** |
| **C** | 2.9 A24g | 存在性条件补 `&& false` | FAIL | **`AssertionError: A24g …`** | ✅ **CAUGHT** |
| **D** | 2.9 A24g | 换回旧 `|| true` | 回到基线 | **PASS=90（=基线）** | ✅ 旧写法**恒真已确证** |
| **C5** | 2.9 C5 | 强制 `if (false)` | SKIP 且 PASS −1 | **PASS 90→89 + 输出 `SKIP C5 … 不计入 PASS`** | ✅ **CAUGHT** |
| **H1** | h5 makeFn | 让工厂 `return undefined` | E1b/E1c 红 | **41/0 → 39 PASS/2 FAIL** | ✅ **CAUGHT** |
| **M1** | b3-cb | 恒空 context 对比 | 长度可区分 | **2,036 vs 0** | ✅ CAUGHT（内置） |
| **M2** | b3-cb | 无 agent 时返回非空 | 负路径可区分 | **`LEAK` vs `''`** | ✅ CAUGHT（内置） |
| **M3** | b3-cb | 删除 `systemPrompt.context` 锚点 | 锚串 1→0 | **hits 1 → 0** | ✅ CAUGHT（内置） |

**变异环境**：`.tmp-cb/`（完整复制 `tests`/`lib`/`tools`/`package.json`，保留相对布局），**验收后已删除**，共享工作区零污染。

**一处如实记录的瑕疵**：C5 的「旧写法对照组」切片替换时误伤文件头注释，导致 `SyntaxError`（PASS=null）。该对照的结论**已由变异 D 独立证明**（旧写法在等价条件下回到基线全 PASS），故不影响判定，但**原始对照组未跑通**，如实列入 §6。

---

## 5. 套件实跑（HEAD `96a08572`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-p6a-rules-layer.mjs` | 0 | **123** | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | **41** | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | **90** | 0 |
| `smoke-test-batch3-cb.mjs`（新建） | 0 | **23** | 0 |
| **合计** | — | **277** | **0** |

**恒真扫描（精确口径）**：剥掉 `//` 行尾注释、跳过整行注释后扫描 `|| true` —— **4 个套件活跃恒真 0 处**。
（粗扫命中的 3 处**全部是描述旧缺陷的注释**；p6a L86 的 `|| ''` 是**同一字段两种取值形态的择一兜底**，非恒真。）

---

## 6. 未验边界与如实声明

1. **p6a 的「空输出放行」未在 p6a 内消除**：`fullOut === ''` 分支仍在。其正确归宿是 §3 的真实回调面（已建立），但**本轮未回填 p6a**。⇒ p6a 的「规则分层仍生效」这条**当前仍可被空输出通过**，不得据此宣称已验证。
2. **未跑全量回归 / `--impact-run`**：只跑 4 个相关套件（277 PASS）。
3. **未做真实 HOST**：未启隔离 `DSH_HOME`、未访问 19387、未改生产配置或真实记忆。真实注入帧、真实档位切换、真实压缩场景**均未验证**。
4. **未验证 `renderMemoryDynamic` 的完整版内容正确性**：§3 证明了它会产出 2,036 字符的非空文本、边界与检索指引齐全，但**未逐段断言其规则/事件/白板/账本各段语义**（那属 B3-RP/BD/EV 的验收范围，本批不提前实施）。
5. **C5 旧写法对照组未跑通**（SyntaxError，见 §4），结论由变异 D 独立支撑。
6. **未改 `lib/`**：`index.js` sha16 `E6C6C2944A068164` 与基线逐字节一致；`lib/` 工作区 `git status` 干净。
7. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 7. 交付物

| 路径 | 说明 |
|---|---|
| `tests/smoke/smoke-test-batch3-cb.mjs` | **新建**：真 import / 真 apply / 真 context 与 section 回调验收（23 断言，含 3 项内置变异） |
| `tests/smoke/smoke-test-v4-h5-user-portrait.mjs` | 改：真执行 `makeFn`（E1a/E1b/E1c） |
| `tests/smoke/smoke-test-batch2-2.9-wiring.mjs` | 改：A24g 真判据、C5 显式二态 |
| `artifacts/_batch3-cb-20261117/evidence/fingerprints.json` | 8 文件物理指纹 |
| `artifacts/_batch3-cb-20261117/evidence/mutations.json` | 8 项变异记录 |
| `artifacts/_batch3-cb-20261117/logs/suite-runs.txt` | 4 套件实跑 |
| `artifacts/_batch3-cb-20261117/MANIFEST.json` | 产物清单 + sha256 |

> `tests/smoke/smoke-test-p6a-rules-layer.mjs` **未改动**（字节与基线一致）；其完整版验收由新建套件接管。


## 7. Lead复核补验：p6a空输出放行已回填

p6a现在直接真import、真apply并调用真实systemPrompt.section回调，不再依赖不存在于抽取壳中的renderMemoryDynamic，也不接受空输出放行。真实section返回renderMemoryStatic固定纪律铭文，当前4,328字符；因此断言采用[记忆系统 — 固定纪律]与[记忆写入纪律 — 必须遵守]，不是已过期的RULES_SECTION_GUIDE_PRE_V1。p6a由123 PASS变为125 PASS。lib/仍零改动；未做真实HOST或全量回归。