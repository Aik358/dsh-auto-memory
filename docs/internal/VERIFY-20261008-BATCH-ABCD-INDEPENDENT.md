# 独立复核 · 2026-10-08 · 批 A/B/C + #302 共 8 处修复

> 复核者立场：**不采信自述**。每条修复都先写出「它要防的行为」，再**真造场景**验证被防住，并在 `os.tmpdir()` 临时副本上做**回退式真变异**看断言是否必红。
> 复核时点：HEAD = `2d0330d`（另注：复核过程中 `lib/index.js` / `lib/client.js` 处于**其它车道在途修改**状态，见 §5）。
> **本文件是本次唯一写入仓库的文件**；所有探针脚本在仓库外 `D:\_verify-tmp\`，收尾删除。

## 0. 结论摘要

| # | 修复 | 独立复核结论 | 关键依据 |
|---|---|---|---|
| 1 | #285 硬触发身份透出 | **部分有效（有实质缺口）** | 后端字段透出 ✅ 真跑验证；**前端根本不消费 `hard`，用户仍拿不到确认卡** ❌ |
| 2 | #286 忙闲读权威回合状态 | **真有效** | running/unknown/无服务 ⇒ 推迟；idle ⇒ 执行；封顶 5 次后仍执行（不永久卡死） |
| 3 | #288 确认卡优先 | **真有效** | 独立场景（armed 0.9 + 6 分钟前 lastOk）⇒ 卡在；`armActive` 恒 false 变异 ⇒ **4 FAIL 必红** |
| 4 | #289 轮询代次 + 身份 | **真有效** | 切到 B 后 A 迟到响应不跳转；代次判据恒真变异 ⇒ **4 FAIL 必红** |
| 5 | #291 转写文件名 | **真有效** | 退回截断身份变异 ⇒ la4 断言必红（`strictEqual` 失败） |
| 6 | #302 长请求保全 | **真有效** | 写失败改 fail-soft 变异 ⇒ la5 必红（`TypeError` 于断言处） |
| 7 | #283 弹窗 box-sizing | **真有效** | 删两条规则变异 ⇒ c 套件 **2 FAIL 必红** |
| 8 | #282 旧档浮层 CSS | **真有效** | `LEGACY_OVERLAY_EXTRA` 只进 legacy 表；四族选择器 0/0/0/0 → 3/5/5/3 |
| 9 | #284 换肤共享样式 | **真有效** | 去监听变异 ⇒ c 套件 **2 FAIL 必红** |

**两个缺口（本道最有价值的产出）**：
1. **#285 只修了后端一半** —— 宿主把 `hard`/`hardReason`/`hardAt` 透出到 `st.armed` 与状态投影了，但 `lib/client.js` **全文 0 处**引用这三个字段；确认卡仍以 `ratio >= autoContinueThreshold` 为唯一门控 ⇒ 硬信号 arm 场景下**卡片依然不出现**（真跑复现，见 §1）。
2. **两条守卫的负路径「不红」** —— #288 的「armed 提前量」与 #289-① 的「跳转前重读」在**单独回退**时对应套件仍全绿（见 §3）。含义：#288 的核心断言实际锚在「lastOk 分支里的让位逻辑」而非「提前量」；#289-① 的第二层闸**可被删除而无人报警**（第一层仍拦得住，故不构成线上缺陷，但该层无独立保护）。

## 1. 逐条复核结论

### #285 硬触发身份透出 —— **部分有效**

**它要防的行为**：硬信号触发 arm 时，`ratio` 由 `armRatio = hard ? Math.max(ratio, threshold) : ratio` 抬到的是**动态水位建议阈值**，与前端 `autoContinueThreshold` 是两个量 ⇒ 旧实现前端只认比例门 ⇒ 卡被隐藏，用户没有同意/拒绝入口。

**后端半部分：真有效（真跑）**。直接以 5 参形态调 `armAutoContinue`（绕开上游资格判定），两组对照：

```
hard=true  ⇒ armedHard=true  armedReason="hard-reason-arg"  armedAt=1791437699985
              projHard=true  projReason="hard-reason-arg"    projAt=1791437699985
hard=false ⇒ 三个字段均为 null（非硬路径不带身份）
```

**前端半部分：缺口（真跑复现缺陷）**。以 vm 真执行真组件体、喂入 `hard=true && ratio=0.62 (< thr 0.75)` 的 armed 快照：

```
hard=true 但 ratio(0.62) < thr(0.75) ⇒ confirmation = null   ← #285 目标场景，卡仍然不出
纯 armed（ratio 0.9）            ⇒ confirmation = { ratio:0.9, ... }（对照组：比例够时正常出卡）
```

**根因（file:line）**：`lib/client.js:17276` `var armActive = !!(armNow && Number(armNow.ratio) >= thr)` —— 判据只有 `ratio`；且 `grep` 全文 `armed.hard` / `hardReason` / `hardAt` 命中 **0**。

**为什么现有套件没抓到**：`smoke-test-la3-continuation-criteria.mjs:5` 自述「本道只做**后端**」，第 97 行甚至明确写下「仅凭 ratio 前端必然隐藏（故必须看 hard）」—— **判据写对了方向，但没有落到任何前端断言上**。⇒ 这是**覆盖缺口**，不是判据过期。

### #286 忙闲读权威回合状态 —— **真有效**

**它要防的行为**：旧实现用 `_globalLastActiveAt` 的 30 秒窗当空闲判据 ⇒ ①静默 >30s 的长工具调用（源回合仍在跑）被当空闲而 cancel；②其它会话的活动反而挡住该接续的源会话。

**真跑场景矩阵**（armed + awaitIdle + 已过期，`_agentSvc.get()` 返回受控 status）：

```
status=running        ⇒ executed=0  deferCount=1  延期到期日被+20s
status=unknown-x      ⇒ executed=0  deferCount=1  延期（保守侧：未知绝不当空闲）
无 agentSvc           ⇒ executed=0  deferCount=1  延期
status=idle           ⇒ executed=1  deferCount=0  放行执行
```

**封顶边界（防「永不接续」）**：

```
deferCount=4 + status=running ⇒ executed=0 deferCountAfter=5（继续等）
deferCount=5 + status=running ⇒ executed=1（封顶后仍执行，不永久卡死）
```

**变异**：`const busy = turnStatus !== 'idle'` → `const busy = false` ⇒ la3 **12 FAIL 必红**，还原复绿。

### #288 确认卡优先 —— **真有效**

**独立场景**（不复用实现者构造）：armed `ratio=0.9` + **6 分钟前**历史 lastOk ⇒ `confirmation` 非空（旧实现会被 lastOk 分支吞掉卡）。

**变异**：`armActive` 恒 `false`（模拟旧语义：只认比例、历史提示覆盖卡）⇒ a2 套件 **18 PASS / 4 FAIL 必红**，还原复绿。

（该条另有一个**不红**的变异，见 §3-①。）

### #289 轮询代次 + 身份 —— **真有效**

**独立场景**：
- ①：用户在 A 发起轮询后切到 B，A 的**迟到**响应回来 ⇒ `opened=[]`（不把 B 拉走）。
- ②：先回最新响应（无 armed）⇒ 无卡；再回**迟到**的旧 armed 响应 ⇒ 卡不复活（代次判据丢弃）。

**变异**：把 `acFresh` 的判据整体替换为 `return !!alive`（等价旧实现「不做代次/身份校验」）⇒ a2 套件 **18 PASS / 4 FAIL 必红**，还原复绿。

（该条也有一个**不红**的变异，见 §3-②。）

### #291 转写文件名 —— **真有效**

**它要防的行为**：`sid.slice(0,8)` + 秒级时间戳 ⇒ 同工作区、同秒、前 8 字符相同的两个来源落到**同一路径**、后写**覆盖**前一份，而先返回的 `transcriptPath` 仍指向该路径 ⇒ 新会话第 3 层读到别的来源。

**变异**（临时副本）：`'prev-session-' + sidHash + '-' + stamp + '-s' + contSeq` → `'prev-session-' + String(sid).slice(0,8) + '-s' + contSeq` ⇒ la4 套件 **exit=1，尾部为 `strictEqual` / `expected: 1` 断言失败**（有效红），还原 23/0 复绿。

### #302 长用户请求保全 —— **真有效**

**它要防的行为**：超长用户请求（>2000 字符）在转写与第 2 层双双被截断 ⇒ 新会话拿不到未完成目标却报成功。

**变异**：把 `await writeFile(userReqPath, …, { flag: 'wx' })` 包进空 `catch`（即回退成 fail-soft，写失败不中止）⇒ la5 套件 **exit=1，在 `:172` 处以 `TypeError` 失败**（断言处崩溃，非静默），还原 50/0 复绿。

### #283 弹窗 box-sizing —— **真有效**

**变异**：从生成表里删掉两条弹窗 `box-sizing` 规则（含后代 `*` 版本）⇒ c 套件 **15 PASS / 2 FAIL 必红**，还原 17/0 复绿。

### #282 旧档浮层 CSS —— **真有效**

**逐选择器计数**（从产物里按 JS 字符串字面量规则取出两张表；legacy 生效表 = 冻结表 + 运行时 `LEGACY_OVERLAY_EXTRA`）：

```
                     生效 legacy 表      变体表
[data-native-continuation]    3            1
[data-native-dialog]          5            14
.i5-native-notice             5            8
.i5-continuation-heading      3            6
生效 legacy 表 = 66,435 → 71,515 字节
```

**关键守恒**：冻结表本身仍 0 命中 ⇒ 补丁**只来自附加表**，未改动冻结源；变体表计数与总长不变 ⇒ iter5 档未受影响。

### #284 换肤共享样式 —— **真有效**

**它要防的行为**：换肤经 `dam-skin-changed` 只触发重渲染、不重挂载，而共享样式 effect 依赖为 `[]` ⇒ `#dam-shared-ui-style` 滞留旧档内容。

**变异**：删除 `window.addEventListener('dam-skin-changed', damSyncShared)`（产物内命中 2 处，两个 Surface 各一）⇒ c 套件 **15 PASS / 2 FAIL 必红**，还原 17/0 复绿。

## 2. 复算命令与输出摘要

| 命令 | 输出摘要 |
|---|---|
| `node D:\_verify-tmp\v285c.mjs` | #285 后端：`armedHard=true / projHard=true`（hard=true）；三字段 null（hard=false） |
| `node D:\_verify-tmp\v285scenarios.mjs` | **`hard=true 但 ratio(0.62) < thr(0.75) ⇒ confirmation = null`**；纯 armed(0.9) ⇒ 有卡 |
| `node D:\_verify-tmp\v286.mjs` | running/unknown-x/无 svc ⇒ `executed=0 deferCount=1`；idle ⇒ `executed=1` |
| `node D:\_verify-tmp\v285cap.mjs`（封顶段） | deferCount 4 ⇒ 执行 0、计数→5；**deferCount 5 ⇒ 执行 1**（封顶生效） |
| `node D:\_verify-tmp\v288289.mjs` | #288 卡在；#289-①`opened=[]`；#289-②卡不复活 ⇒ 4 PASS |
| `node D:\_verify-tmp\vneg2.mjs` | 基线 5 套件全绿；M2 ⇒ `23/12` 红、M4 ⇒ `18/4` 红、M5 ⇒ exit=1、M6 ⇒ exit=1 |
| `node D:\_verify-tmp\vneg4.mjs` | M3e ⇒ `18/4` 红；**M3d ⇒ 22/0 不红**、**M4c ⇒ 22/0 不红**；M8 ⇒ `15/2` 红 |
| `node D:\_verify-tmp\vneg5.mjs` | M1/M5 均为 `AssertionError / strictEqual` 断言失败；M6 为断言处 `TypeError` |

产物物理量（复核时点）：`lib/index.js` 1,250,205 B / sha16 `1cc4dcea6799699c`；`lib/client.js` 2,166,895 B / sha16 `6e53206dc78da92d`。

## 3. ★ 负路径变异结果：**哪些不红**（重点发现）

共做了 9 组回退式变异（全部在 `os.tmpdir()` 副本上，真仓库只读）：

| 变异 | 目标 | 结果 | 判读 |
|---|---|---|---|
| M1 #285 arm 不写 hard | la3 | **红**（断言失败） | 后端判据有效 |
| M2 #286 busy 恒 false | la3 | **红**（23/12） | 有效 |
| M3e #288 `armActive` 恒 false | a2 | **红**（18/4） | 有效 |
| **M3d #288 删掉 armed 分支的卡写入** | a2 | **不红（22/0）** | ⚠ 见下 |
| M4 #289 `acFresh` 恒真 | a2 | **红**（18/4） | 有效 |
| **M4c #289-① 去掉跳转前重读** | a2 | **不红（22/0）** | ⚠ 见下 |
| M5 #291 退回截断身份 | la4 | **红**（strictEqual） | 有效 |
| M6 #302 写失败改 fail-soft | la5 | **红**（TypeError@172） | 有效 |
| M7 #283 删两条弹窗规则 | c | **红**（15/2） | 有效 |
| M8 #284 去换肤监听 | c | **红**（15/2） | 有效 |

### 不红 #1：`applyArmCard(arm)` → `void 0`（#288 的「armed 提前量」）

把 `lib/client.js` 里 armed 分支的卡写入整句去掉（保留分支与 `return`），a2 仍 **22 PASS / 0 FAIL**。

**判读：不是线上缺陷，是断言锚点问题**。真跑三组场景证明行为实际由**另一处**保障：

```
纯 armed（无 lastOk）        ⇒ confirmation = { ratio:0.9, ... }   ← 走的正是被删掉的那句
armed + error 并存           ⇒ confirmation = { ratio:0.9, ... }   ← #288 把 armed 提到 error 早返回之前，防的就是这个
```

⇒ 结论：**行为正确**（两条路径都出卡），但 a2 套件里**没有一条断言覆盖「纯 armed（lastOk 为 null）」或「armed + error 并存」**，所以该句被删不会报警。属于**保护缺口**，建议补一条「纯 armed ⇒ 出卡」与一条「armed + error ⇒ 仍出卡」。

### 不红 #2：`sidNowJump` 恒等于 `sidQ`（#289-① 的「跳转前重读」）

把跳转前的重读结果固定成请求期捕获值（等价删掉该层），a2 仍 **22 PASS / 0 FAIL**。

**判读：不是线上缺陷，是第二层无独立保护**。第一层 `acFresh()`（代次 + 身份）仍会把「已切走」的响应整份丢弃，所以单独去掉第二层不会让错误行为发生 —— 这与我此前在实现阶段的实测一致（当时补了 ⑥ 节想单独照出该层）。

⚠ 需注意：a2 的 ⑥ 节**当前形态并不具备鉴别力**（本次实测该变异仍 22/0）。它断言的是「受控取到值序列里出现过 sid-B」这类**间接特征**，而这些读点会被其它路径/多轮 tick 满足 ⇒ 断言恒真。**建议改为行为级判据**（例如：构造「第一层放行、跳转瞬间会话已切走」的单次响应，断言 `sessions.open` 未被调用），而不是断言取样序列的形状。

## 4. 其它缺口 / 边界 / 未覆盖场景

1. **#285 是本批唯一「用户可见缺陷仍未消除」的一条**（见 §1）。建议落点：`lib/client.js:17276` 的 `armActive` 判据并入 `hard`（如 `!!(armNow && (armNow.hard || Number(armNow.ratio) >= thr))`），并补前端断言（喂 `hard=true && ratio<thr` 断言出卡）。**注意**：`hard` 是布尔透出，前端还应确认「非硬路径不带身份」不被误判（la3 已覆盖 `hard=false` 的投影形态）。
2. **#288 的两个保护缺口**：无「纯 armed」与「armed + error 并存」断言（§3-①）。
3. **#289-① 第二层无独立保护**，且 ⑥ 节断言恒真（§3-②）。
4. **复核时点存在在途改写**：复核过程中 `lib/index.js` / `lib/client.js` 处于其它车道的**未提交修改**状态（`git status` 显示 ` M`），`client.js` 内已出现 `acOkDismissHas` 等**非本批**标识（疑为 #287 车道在写）。⇒ 本报告的所有结论对应**该时点的工作树**；若后续合并/改写，`#288` 相关行号需重新定位（本报告一律附可 grep 的符号名，便于重定位）。
5. **未覆盖**：本次未做浏览器/桌面端到端（与前几批同口径）；#285 的前端结论来自 vm 真执行真组件体 + 受控 hooks，非真实浏览器。

## 5. 只读确认

· **本次未修改仓库任何产品文件**。所有探针脚本写入仓库外 `D:\_verify-tmp\`（`v286.mjs` / `v285cap.mjs` / `v285c.mjs` / `v285-frontend.mjs` / `v288289.mjs` / `vneg*.mjs` / `v285scenarios.mjs`），交付后删除；本文件是**唯一**写入仓库的文件。
· 所有变异都在 `os.tmpdir()` 的整树副本（`lib/ + skins/ + tools/ + tests/`）上执行，真仓库只读；每组变异均**还原并复跑确认复绿**。
· 未做任何 git 写操作（未 add / commit / push / stash / reset / clean）。
· 复核时点 `git status --porcelain -- lib` 显示 ` M lib/client.js` 与 ` M lib/index.js` —— **这是其它车道的在途修改，非本道产生**（本道的探针全部写在仓库外）。