### 2026-09-25 · E6 守卫同步（新增 v2 形状守卫 · 回归升到 180 套）

**★立此守卫的实证依据（`guard-scout` 独立普查，非推测）**：`epochToken` / `drainStartedAt` / `_wbStateOf` / `wbOwnerOf` / `_wbTokenOf` / `version: 2` 在 `tests/` 下**全部 0 命中** —— v2 相位面的验证原本只在 `artifacts/` 五支探针里（E1 32/0、E1-fix 27/0、E2 16/0、E3 29/0、E4 19/0），而 `tools/run-smoke.mjs` **只扫 `tests/smoke/*.mjs`** ⇒ **五支探针都不在回归内**。E3/E4 再动 workbench 形状，`tests/` 给不出任何红。

**产出**：新增 `tests/smoke/smoke-test-workbench-v2-shape.mjs`（**39 PASS / 0 FAIL**），把该面纳入常驻回归。九组判据：

1. **v2 相位面字段齐备**：`version: 2` / `epochToken` / `phase` / `current`+`previous` 双槽 / `drainStartedAt` / `consentGranted`。
2. **唯一读入口与归属函数**：`_wbStateOf` / `wbOwnerOf` / `_wbTokenOf` 存在；**`_wbTokenOf` 体内无 `createHash` 与 `_workbenchEpochToken`**（不做派生兜底，否则归属门永不失配、形同虚设）；**`_wbStateOf` 体内不含 `sealTriedAt`**（E3 教训：节流必须读原始对象，不得扩大语义面契约）。
3. **期牌算法逐字一致** + 空输入返回空串（不凭空造牌）。
4. **E3 轮换门结构**：`_wbRotateTick` 是唯一写者且挂 15s 心跳、四常量真值、`_wbSetPhase` 计数 5、**`NO forced switch`**（超时纯防御）、**`treat as NOT quiet`**（异常取保守侧）、`old epoch still authoritative`、**`_verifyWorkbench` 体内零写盘**（只读契约）。
5. **E2 归属门**：`WB_GATED_JOBS` 恰六项、`wbOwnerOf` 要求 `=== 'current'`、`_wbTokenOf` 只读落盘、**仅「非空且不符」才拒**（迁移态放行）、门异常 fail-open。
6. **E4 父缓存绑定期牌**：赋值点仍 3、标签出现 6 次、**空标签放行**（判据以 `!!` 开头）、stale 并入既有门控。
7. **「只激活一次」幂等闸**：`visibleAt` 早退在 `sc.prompt` **之前**（**函数体内**比较）、发送后落盘、函数体内 prompt 恰 1 次。
8. **守卫 ⑰ 硬约束不回退**：`lib/subagent-gc.js` 内**不得出现 `workbench`**（源码级：GC 模块不认工作台）。
9. **纯逻辑重放**：归属三态（本期 ⇒ `current` 放行 / 上一期 ⇒ `sealed` 拒 / 无关 ⇒ `orphan` 拒 / 空状态 ⇒ `orphan` **不误放行**）。

**验证**：新守卫 **39 PASS / 0 FAIL**；**全量回归 180 PASS / 0 FAIL / TIMEOUT 0**（141.3 s，比基线 +1 套）。

**★本守卫自身一处缺陷（假红，非源码缺陷）**：期牌算法断言写成 `/epoch \+ '\|' \+ sessionId/`（**形参名**），而源码用**局部变量** `e + '|' + s` ⇒ 假红。改为直接断言 `+ '|' +` 结构，并新增「空输入返回空串」一条。**教训与 E4 同源：断言必须对真实标识符写，不得凭形参名猜。**

**产出**：`lib/index.js` 941,498 → **943,094 B**（PURE CRLF / CRLF=14,425 / bareLF=0 / `node --check` 绿）。备份 `lib/index.js.bak-20260925-224500-e4`。**未提交、未推送、未发布。**

**★先行取证纠正了 E4 的范围（结论：原任务书高估了工作量）**：

「只激活一次」在机制上**已经具备**，无需新建标记文件、也无需改 turn 语义：`_ensureWorkbenchVisible` 已用 `st.visibleAt` 做幂等闸 ——
① `L8898` 早退 `if (!sid || !st || st.visibleAt) return false`（在 `sc.prompt` **之前**）；
② 发送成功后 `st.visibleAt = new Date().toISOString()` + `_writeWorkbench` 落盘。
⇒ 每期只发一条「已激活」性质的初始化消息，之后该会话零 turn；工作台全生命周期唯一活动 ⇒ 用户口径已满足。
**E4 因此只做一件事：`_workbenchParent` 绑定期牌**（§9.4 末条 / §9.8 那条失效链）。

**实现（三处赋值点打标签 + 一处开工前比对）**：
- 新增实例字段 `_workbenchParentEpoch`，在**全部 3 处** `_workbenchParent` 赋值点同步写入当前期号：
  `_verifyWorkbench` 的 `rv.agent` 分支、`ensureWorkbench` 复用分支、`ensureWorkbench` 新建分支。
- `runSubagent` 开工前比一次：`const _wbParentStale = !!this._workbenchParentEpoch && String(this._workbenchParentEpoch) !== _wbEpochNow`，
  命中即并入既有门控 `if (!this._workbenchReady || _wbParentStale)` ⇒ 走既有 `ensureWorkbench` 刷新（**自愈，零新机制**）。
- **空标签 = 迁移态 ⇒ 放行**（与 E2 期牌门同一策略）：否则升级前进程永远补不上标签 ⇒ 门恒拒 ⇒ 全部后台任务停摆（E2 已证过这条死锁）。
- 拒绝/刷新路径全记 diag（`workbench parent cache stale: tag=… now=… -> refreshing`），可观测。

**★与 E3 的相容性（设计时即已对齐，非事后补丁）**：轮换的 draining/sealing 期，`workbench.json` 里**记录的仍是旧期号**，
而 `_verifyWorkbench` 判「旧期仍权威」⇒ 复用分支会把标签**重打为当前**期号（标签取自 `_workbenchEpoch(now)`，非落盘值）。
⇒ 「旧期仍权威」（E3，保记忆功能不停摆）与「父缓存不挂旧期」（E4，防挂到已封存会话）两条**同时成立、不打架**。

**验证**：
- 新探针 `artifacts/_e4-probe.mjs`：**19 PASS / 0 FAIL**，含 5 条真值表负路径（空标签放行 / undefined 放行 / 同期放行 / 翻页 stale / 旧格式 stale）。
- 回归：E1 32/0、E1-fix 27/0、E2 16/0、E3 29/0、迁移守卫 54/0、缺口守卫 51/0、**全量回归 179 PASS / 0 FAIL / TIMEOUT 0**（58.3 s）。

**★探针自身两处缺陷（均为假红，非源码缺陷 —— 记此以免重犯）**：
1. 补丁脚本把「行数增量」写死为 14，真值 15（漏算一处 4 行注释块）⇒ 改为 **`must()` 自累计 `lineDelta`**，断言与自身逻辑比对，不写死数字。
2. 探针用**全局** `indexOf` 比较「早退是否在 prompt 之前」，却命中了 `hostRefreshRitual`（L4485）里那句同形 `await sc.prompt({ sessionId: sid` ⇒ 假红。
   改为**在 `_ensureWorkbenchVisible` 函数体内**比较（花括号配平抽取），并顺带断言该函数体内 `prompt` 恰好 1 次。

**教训**：判据凡涉及「某函数内 X 在 Y 之前」，必须**先切片到该函数体**再比 —— 全仓 `indexOf` 会命中同形代码（本轮实证）。


### 2026-09-25 · E3 轮换门落地（§6 row 33 ☑）

**产出**：`lib/index.js` 930,383 → **941,498 B**（PURE CRLF / CRLF=14,410 / bareLF=0 / `node --check` 绿）。备份 `lib/index.js.bak-20260925-221500-e3`。**未提交、未推送、未发布。**

**结构（唯一写者 + 只读校验分离）**：
- **相位迁移的唯一写者 = `_wbRotateTick()`**（挂 15 秒心跳，与 subagentGcSweep / tickAutoContinue / sessionArchiveSweep / tickTime 并列，**四个既有任务一个未顶掉**）。新增 `_wbSetPhase` / `_wbCatalogChildIds` / `_wbChildMtimes` / `_wbFamilyQuiet` 四个辅助方法。
- **`_verifyWorkbench` 保持「只读、无副作用」原契约**：相位感知只加**一个分支** —— 期号不符时，若 `phase ∈ {draining, sealing}` 则**旧期仍是权威**（判为可复用），否则维持原 `epoch-mismatch` 返回。否则 `ready=false` 会让后台记忆任务在整个轮换窗口内停摆（规格 §9.3：draining 期不停记忆功能）。

**★主判据（含 E0/M3 修正）** —— `_wbFamilyQuiet`：
1. `_subagentInflight === 0`（插件自派子代理的权威在飞计数）；
2. 工作台 catalog 中**仍有磁盘目录**的 childId，其目录 mtime 均静默 `WB_QUIET_MS`（2 分钟）；**空 catalog ⇒ 静止**；**全幽灵 ⇒ 静止并记 `wb-quiet: ghosts=N`**。

**失败姿态：异常一律判「不静止」**（保守）—— 与 E2 归属门的 fail-open 相反，此处绝不能 fail-open：判「静止」会让门恒真、形同虚设。

**其余决定**：
- 超时 `WB_SEAL_TIMEOUT_MS`（30 分钟）**纯防御**：只记一行 diag「NO forced switch」，**绝不强切**（强切会造「半轮换」）。
- **sealing 建新期节流** `WB_SEAL_RETRY_MS`（60 秒）：未获批时不能每 15 秒重跑一次 `ensureWorkbench`（内部会调宿主 resolveAgent / prune 工作区）。
- **同意门（用户裁定「只弹一次，之后自动」）**：创建分支持久化 `consentGranted`，此后轮换以 `{consent:true}` 自动建；未获批则回落同意门（不擅自建）。

**验证**：
- 行为探针 `artifacts/_e3-probe.mjs`：**29 PASS / 0 FAIL**，含**六条负路径**：③ inflight=2 保持 draining ④ 全幽灵仍判静止且记 ghosts=N ⑤ 活条目未满静默窗保持 draining ⑦ 超时 31 分钟不切换 ⑧ 节流 5 秒内不重试 ⑧ 未获批不擅自建。
- 回归：E1 探针 32/0、E1-fix 27/0、E2 探针 16/0、迁移守卫 54/0、缺口守卫 51/0、**全量回归 179 PASS / 0 FAIL / TIMEOUT 0**（86.6 s）。

**★E3-fix（探针抓出的真实缺陷）**：`sealing` 节流原读 `st.sealTriedAt`，而 `_wbStateOf` 的归一化结果**只含归属/相位语义面、不含该键** ⇒ 恒为 0 ⇒ **节流形同虚设**（每 15 秒重跑 ensureWorkbench）。改为从**原始落盘对象**读取；未扩大 `_wbStateOf` 契约（以「与该函数入参逐字节相同」断言钉死）。

**★探针自身六处缺陷（全部为假红/假绿，非源码缺陷——教训记此）**：
1. **常量未注入**：抽出的函数体不在原模块作用域，`WB_QUIET_MS` 等抛 `ReferenceError` 被 catch 吞掉 ⇒ 污染后续全部断言。
2. **★假绿（最危险）**：`Object.assign(host, methods)` 在 `extra` **之后**执行 ⇒ 负路径的 `_wbCatalogChildIds` / `_wbChildMtimes` mock **被真源码方法覆盖** ⇒ ⑤ 恒走「空 catalog ⇒ 静止」。修法：`extra` 必须**最后**套用。
3. `extractConst` 用 `[^\n]+` 吃掉了行尾 `\r`（CRLF 文件）⇒ 常量比较恒假红。
4. 断言「记了 diag」实为**要求一条被刻意省略的日记** —— 非超时分支每 15 秒记一次会刷屏；改为断言判据函数返回值 + 反射断言「确实不记」。
5. `src.includes(心跳行片段)` 会命中多行 ⇒ 改用「含 `_wbRotateTick` 的那一行全文」做锚点并先断言**唯一性**。
6. 计数口径连错两次：`_wbSetPhase` 真值 **5**（1 定义 + 4 调用，漏算了 `sealTriedAt` 那次），`_wbStateOf` 函数体长度写死 804 而真值 806 ⇒ 改为**与入参自身逐字节比对**，不写死长度。

**教训（可复用）**：断言里凡出现「魔法数字/手写长度」，一律改为与**入参或真源码自身**比对；mock 与真方法共存时，**套用顺序**必须使 mock 生效——否则产出的是**假绿**，比假红危险得多。


### 2026-09-25 · E2 归属门接入（§6 row 32 ☑）

**产出**：`lib/index.js` 927,638 → **930,383 B**（PURE CRLF / CRLF=14,219 / bareLF=0 / `node --check` 绿）。备份 `lib/index.js.bak-20260925-215502-e2`。**未提交、未推送、未发布。**

**设计决定（关键：收口点而非逐点打补丁）**：
- **门接在 `runSubagent` 内部**，不在六个调用点各写一份。理由：六个写路径（greet / fold / summarize / consolidate / consolidate-logs / distill）**全部经 `runSubagent` 派单**，一处接入即全覆盖，且天然满足「同一语义只有一份判据」（§D8）。
- 仅对**白名单** `WB_GATED_JOBS` 生效；只读且时延敏感的 smart-kw / smart-ans / ws-map **不过门**（它们不写记忆，过门只会拖慢交互路径）。
- 判据唯一化：所有权经 `wbOwnerOf(sid, st)`（`current` 放行 / `sealed` / `orphan` 拒绝）；期牌经 `_wbTokenOf(st)`（**只读落盘值、不做派生兜底**）。

**★迁移态策略（若不这样定会死锁）**：拒绝条件**只有一条** —— 落盘期牌**非空**且与当前期牌不符。
若把「落盘期牌为空」也判拒绝，则：期牌是 v2 新增字段，升级前写入的 `version:1` 工作台没有它；而补期牌的唯一时机是「下一次真实写盘」⇒ **门拒 ⇒ 不写盘 ⇒ 期牌永远补不上 ⇒ 六个写路径永久停摆**。
故迁移态**放行并补发**（放行后那次 `bumpGenFor` 写盘经唯一写入口 `_writeWorkbench` 把期牌落盘），下一次派单即真正受门保护。
这与「`_wbTokenOf` 不做派生兜底」不矛盾：**不派生的是判据，补落盘是迁移动作**，两者分工明确。

**失败姿态**：门自身抛异常 ⇒ **fail-open 放行**并记 diag（宁可漏拦一次，也不因判据抛错而停摆全部记忆功能）。所有拒绝路径均写 diag（`owner=` / `epoch-token mismatch`）。

**验证**：
- 行为探针 `artifacts/_e2-probe.mjs`（抽真源码函数体**真跑**、临时 `DSH_HOME` 隔离、真实 `~/.dsh` 零接触）：**16 PASS / 0 FAIL**，含**四条负路径**：② `sealed` 被拒 ③ `orphan` 被拒 ④ **期牌错位时「本期会话」也拦得住** ⑤ 空期牌放行且随后补上期牌。
- 回归：E1 探针 **32/0**、E1-fix 探针 **27/0**、迁移守卫 **54/0**、缺口守卫 **51/0**、**全量回归 179 PASS / 0 FAIL / TIMEOUT 0**（67.8 s）。

**★探针自身两处断言 bug（非源码缺陷，已修）**：① 正则写小写 `owner` 而源码是 `_wbGateOwner`；② 调用点计数口径写错（`prompt,` 型为 7 处、总调用点 9 处，含 kwPrompt/ansPrompt）。
**教训**：断言必须对着**真实标识符**与**真实计数口径**写，凭印象写断言会产出假红——假红同样消耗排查成本。


> **文件**：`docs/internal/WORKBENCH-MODEL-CONTINUABLE-SPEC.md`
> **建立**：2026-09-24
> **用法**：上下文被压缩后，**先完整读一遍本文件**再继续动手；每完成一项到 §6 打勾；全部完成后按 §5 逐条验收。
> **纪律**：本文件里的行号是"取证时的坐标"，改代码后可能漂移 —— 用前先 `grep` 复核锚点文本，不要盲信行号。

---

## §0 压缩后必读（30 秒版）

本轮要解决两件事，用户已拍板：

1. **模型/思考强度的作用域要落到"记忆中枢工作区（`aik_auto_memory_use`）下所有会话的默认"**，
   并在设置页**说清楚**这件事。当前实现只在工作台会话"可见性补发"那条路径上尝试 `selectModel`，
   且条件是 `subagentProvider && subagentModel` **都非空**才调用；两者实测皆空 ⇒ **从不调用**。
2. **可复用子代理要换成 `startContinuable`**（用户原话"能少点就少点"），减少每次 spawn 新建持久会话。

用户明确**不做**的事：历史欠账（1159 条备份残留）不清理 —— "越管越乱"。**不要再提这件事。**

**关键结论（会颠覆直觉，务必记住）**：
- 子代理的会话行在**宿主架构上删不掉**，只降级为灰色不可用行（`manager.js:593-616`）。
  ⇒ 记忆中枢工作区**不能撤**，它把"删不掉的东西"收敛到一处。
- 插件设置里的三个全局键**管不到"特定工作区的特定对话"**；真正的杠杆是 `sessionController.selectModel`
  **按 sessionId** 生效，而子代理继承的是**工作台会话**的路由（不是你的对话）。

---

## §1 目标与已定决策

| 编号 | 决策 | 来源 | 状态 |
|---|---|---|---|
| D1 | 插件设置里的 model / reasoningEffort 作用域 = **记忆中枢工作区下所有会话的默认**，并在设置页写明 | 用户 2026-09-24 | 待实施 |
| D2 | 历史欠账（备份库 1159 条 / 父会话幽灵条目）**不清理** | 用户 2026-09-24 | 已定，不再讨论 |
| D3 | 可复用子代理**要做**，目标是"能少点就少点"（减少持久会话产出） | 用户 2026-09-24 | 待实施 |
| D4 | 其余按既有判断（低风险先行：模型继承 + 必要的兼容修复；架构改动单独评估） | 用户 2026-09-24 | 生效 |
| D6 | 宿主重启**不得**新建工作台会话；轮换只由 `epoch`（半月/月）驱动 | 用户 2026-09-24 追加报障 | ☑ 已实施 |
| D5 | 工作台会话（记忆中枢）**保留**，不因"能否删干净"而撤 | 由 §2.3 证据推出 | 生效 |

---

## §2 技术事实（已验证 · 附源码证据）

### 2.1 模型链路：三层，且都不是 per-workspace

| 层 | 位置 | 内容 | 实测值 |
|---|---|---|---|
| L1 部署默认 | `~/.dsh/profiles/web/cordis.patch.yml:62-67` | `agent-default-model` → `provider: dshapi` / `model: deepseek-v4.1-flash` / `reasoningEffort: max` | 生效中 |
| L2 插件设置 | `~/.dsh/dsh-auto-memory.json` | `subagentModel` / `subagentProvider` / `subagentReasoningEffort`（+ 分层 `…Long` / `…Short`） | **三者皆空串 ⇒ 跟随 L1** |
| L3 官方子代理设置 | `dsh-tool-subagent/lib/model-selection-settings.js:44` | `subagent-model-selection`，`enabled` 默认 **false** | **对本插件无效**（只作用于官方 `subagent` 工具） |

**注意**：`settings.yaml` **在本机已不存在**（只剩 `.bak-*` 与 `.imported`）。
但插件多处仍读 `path.join(dshHome(), 'settings.yaml')`（`lib/index.js:3386/8926`、`lib/water-window.js`）
⇒ 这些读取**已静默失效**，属已知旁支问题，不在本计划范围内（记在这里免得下次重新踩）。

### 2.2 子代理继承的是「工作台会话」的路由，不是你的对话

**证据一** —— 子代理路由解析以 `parent` 打底、被 `requested` 覆盖：

```js
// dsh-subagent/lib/types/child-agent.js:75-88
export function resolveChildAgentOptions(parent, requested, childDepth) {
    const parentOptions = parentAgentOptionsForDelegation(parent);   // 父会话活路由
    ...
    ...requested,                                                    // 我们的 agentOptions 覆盖
    subagentDepth: childDepth,
}
```

**证据二** —— 插件把 parent 钉成工作台会话：

```js
// lib/index.js:8877
const parent = this._workbenchParent || agent || this._lastAgent
```

⇒ **子代理模型 = 工作台会话路由**（再被 L2 设置覆盖）。与你"当前在哪个工作区 / 哪个对话"**无关**。

### 2.3 前端可见性：子代理**在架构上不可移除**（决定"记忆中枢"必须保留）

```js
// dsh-api-session-controller/lib/types/client/sessions/manager.js:593-616
handleSessionRemoved(sessionId) {
    const durableSubagent = this.subagentAddress(sessionId) !== undefined
        || this.summaries.some(s => s.sessionId === sessionId && s.origin === 'subagent');
    this.recordMutation(durableSubagent
        ? { kind: 'status', sessionId, running: false, agentAvailable: false }   // 子代理：只降级
        : { kind: 'remove', sessionId });                                        // 普通会话：真移除
    ...
    const catalog = this.projectionStores.get(sessionId)?.values().subagentCatalog;
    if (!durableSubagent && (catalog === undefined || catalog.length === 0)) {
        this.projectionStores.delete(sessionId);                                 // 子代理：永不删投影
    }
}
```

| | 普通会话 | `origin==='subagent'` |
|---|---|---|
| 移除时 | `{kind:'remove'}` **真移除** | `{kind:'status'}` **只降级，行还在** |
| 投影 store | 空时删除 | **永不删** |

**推论（重要）**：
- `durableSubagent` 的第一项判据是 `subagentAddress(sessionId) !== undefined` —— 那正是 continuable 子代理的地址表
  ⇒ **改成可复用的子代理同样属于 durable，同样删不掉**。换 API 解决不了可见性。
- 插件侧**唯一**能做的清除是 `purgeSubagentCatalog`：把 childId 从**父会话**的
  `projectionsBySession[parentId].values.subagentCatalog` 数组里剔掉
  ⇒ 父会话（你的对话）侧的下拉里没有那一行；但子代理**自身的会话行**仍在侧栏。
- ⇒ **把子代理全挂到一个工作台会话下 = 把删不掉的东西收敛到一处**。
  撤掉工作台 = 让这些状态行重新散回你每一个真实对话里。**与目标相反，故 D5：保留。**

**前端读取点（唯一数据源）**：
`dsh-client-ui-subagent/lib/client.js:354-363` 读 `state.projectionsBySession[parentId].values.subagentCatalog`。

### 2.4 可复用子代理契约（`ctx.subagents.startContinuable`）

**签名与返回**（`dsh-subagent/lib/types/index.d.ts:133-142`、`continuation.d.ts:101-107`）：

```ts
startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
// ContinuableStartSpec = { provider, label, childId?, request: Omit<SubagentStartRequest,'label'|'signal'|'outputSchema'>, signal }
// ContinuableStart      = { childId: SessionId, messageId: MessageId }
```

**与 `start` 的根本差异**：

| | `subagents.start()`（现用） | `subagents.startContinuable()`（拟用） |
|---|---|---|
| 返回 | `SubagentRun`，含 `result` / `dispose` | `{ childId, messageId }`，**无 run、无 result** |
| 生命周期 | 一次委派 = 一个会话，结束即终态 | 持久会话 + 可重复激活，id 跨激活稳定 |
| 结果回程 | `await run.result` | **必须另找通道**（见 §4 U2） |
| 证据 | `types.d.ts:283-318` | `index.d.ts:133-142` |

**关键事实（逐条已从源码确认）**：

1. **内置 provider 支持**：`dsh-subagent-spawn-in-process/lib/index.js:37` 有 `prepareContinuable()` ⇒ 技术可行。
2. **`agentOptions` 在 continuable 路径同样生效**：`continuation.js:112-115` 调同一个
   `resolveChildAgentOptions(parent, request.agentOptions, childDepth)`，并写进 descriptor（`:116-125`）。
   ⇒ **现有 `subAgentOptions(config, lane)` 可原样复用，模型/强度分层不丢**。
3. **childId 不能重复建**：`continuation.js:147-155` —— 若 `spec.childId` 已持久化存在，
   抛 `SubagentError('...already exists', 'DUPLICATE_CHILD')`。
   ⇒ **复用 = 存下 childId，之后走 `sendMessage`，绝不要再次 `startContinuable` 同一 id**。
4. **冷启动可唤醒**：`index.d.ts:145-147` —— `sendMessage` 对"absent direct child"会
   **cold-resumes from persistence**。⇒ 即使子代理不在内存/进程重启，持久 childId 仍可用。
5. **结果回信依赖 `send_message` 工具**：`continuation.js:172-174` ——
   只有在检测到 `send_message` 工具时才追加 `withContinuableReturnGuidance(parent.id, prompt)`。
   ⇒ **没有该工具，子代理不会回信**（这是 §4 U2 必须实测的原因）。
6. **`sendMessage` 需要"精确存活的 sender agent"**：`continuation.js:193-197` ——
   `this.ctx.agents.get(sender.id) !== sender` 即抛 `UNAUTHORIZED`。
   ⇒ 发送方必须是**活着的** Agent 对象，不能用缓存的过期引用。
7. **有并发容量上限**：`SubagentRuntime.Config.maxActiveSubagents`（默认 **8**，`index.d.ts:101-107`）。
   ⇒ 可复用方案天然有上限保护，但需确认本机配置。

### 2.5 现有代码改造点（`lib/`）

| # | 位置 | 现状 | 需要改成 |
|---|---|---|---|
| C1 | `lib/index.js:8577-8581`（`_ensureWorkbenchVisible`） | `if (mp && mm) await sc.selectModel(...)` —— 两键都空则**从不调用** | 抽成统一的工作台路由应用函数，创建/复用两条路径都调用 |
| C2 | `lib/index.js:8607+`（`ensureWorkbench` 复用分支 `:8625-8634`） | 复用分支**不应用**路由 | 复用分支也要应用（防止用户改了设置但会话路由陈旧） |
| C3 | `lib/index.js:8836-8981`（`runSubagent`） | 单一路径 `subagents.start` | 增加 continuable 分支 + 按 job 维护 childId + 结果回程 |
| C4 | `lib/index.js:8761-8780`（`bumpGenFor`） | 满阈值只**改展示名**（`-gNN`），仍新建会话 | 改成：满阈值 ⇒ `drainContinuableChildren` 释放旧 + 下轮 `startContinuable` 建新 |
| C5 | `lib/subagent-gc.js:166-167` | `if (mode === 'continuable') return {hit:false,...}` —— **显式跳过** | **必须改**，否则可复用子代理**永不回收**（重演爆炸） |
| C6 | `lib/index.js:8985+`（`recycleSubagentSession`） | 结束即搬目录 | 可复用子代理**活着时不能搬**；判据改为"该 childId 已 drain" |
| C7 | `lib/subagent-gc.js:208` | 兜底候选写死 `session.v3.jsonl.zstd` / `session.jsonl.zstd` | 本机实测 `session.jsonl.zstd`（116 个 `session-` 目录）与 `session.v4.jsonl.zstd`（3 个工作台）并存 ⇒ 候选要覆盖 v4 |
| C8 | `lib/client.js:7664-7667`（设置页文案） | 说明"用于时段总结、问候语、自动沉淀、蒸馏等 subagent 功能" | 按 D1 改写成"**记忆中枢工作区下所有会话的默认模型与思考强度**" |

**守卫硬约束（改之前必读，别踩）**：
- `PLUGIN_LABEL_PREFIX = 'auto-memory-'`（`subagent-gc.js:29`）是插件会话的**唯一判据**，守卫 G8 断言 `startsWith`
  ⇒ **前缀一改，子代理永不回收**（2026-09-08 爆炸同款事故）。
- 守卫 ⑰ 钉死"无删除调用 + 子代理 GC 不触碰工作台" ⇒ 只移动、不删除。
- `lib/*.js` 是**纯 CRLF**；`lib/wb-sidecar.js` 是**纯 LF**；`docs/*.md` 是**纯 LF**。
  打补丁时判据是"**EOL 性质不变**"，不是"CRLF 计数不变"。

---

## §3 实施方案

### 阶段 A（低风险 · 先落地）—— 模型继承 + 必要兼容修复

**A1. 抽出统一的工作台路由应用函数**

新增一个内部方法（名字待定，例如 `_applyWorkbenchRoute(sid, st)`），职责：

1. 读 `subagentProvider` / `subagentModel`（L2 设置）；
2. **两者皆空时**：不覆盖，让工作台会话走 L1 部署默认（`agent-default-model`）—— 这是当前行为，保持不变；
3. **任一非空时**：调 `sessionController.selectModel({ sessionId: sid, provider, model })`
   把路由**钉死在工作台会话上**（子代理随之继承，见 §2.2）；
4. 思考强度：`agentOptions.reasoningEffort` 已在子代理侧下发（`subAgentOptions`），**无需**在会话上设置；
   但要在设置页写明"强度只作用于本插件的子代理，不改主对话"。

**A2. 创建与复用两条路径都调用 A1**

- `ensureWorkbench` 复用分支（`lib/index.js:8625-8634`）：补调用；
- 新建分支（`lib/index.js:8711+`，写完 workbench 状态后）：复用 `_ensureWorkbenchVisible` 里已有的调用，
  但要**从"可见性补发"里解耦**（可见性失败不应连带路由失败，反之亦然）。

**A3. 设置页文案改写（C8）**

依据 D1，中文写成单行、含义明确：

> 这里的模型与思考强度是**记忆中枢工作区（`aik_auto_memory_use`）下所有会话的默认**；
> 子代理挂在工作台会话下，因此也跟随这一路由。留空则跟随宿主部署默认（`agent-default-model`）。

**A4. 兼容修复（与可复用无关，但必须一起做）**

- C7：`subagent-gc.js` 的会话文件名候选补 `session.v4.jsonl.zstd`；
- 复核 `settings.yaml` 已消失导致的静默失效点（`lib/index.js:3386/8926`、`lib/water-window.js`）——
  **只记录不断言**，是否修另议（它不影响本计划两项主目标）。

### 阶段 B（架构改动 · 先实验后落地）—— 可复用子代理

**B0. 最小真机实验（必须先做，拿到实测数据再改生产代码）**

实验内容（写成独立只读/临时脚本，不碰 `lib/`）：

1. 用 `startContinuable` 建 1 个可复用子代理，记录 `childId`；
2. 隔一会儿用 `sendMessage` 派第二次活 —— **验证 id 复用是否成立**；
3. 验证**结果回程**：子代理的最终文本是否回到父会话（`subagent-settled` 通知）；
4. 验证重复 `startContinuable` 同 id 抛 `DUPLICATE_CHILD`（确认 §2.4-3）；
5. **实测 `send_message` 工具是否存在**（决定 §2.4-5 的 return guidance 会不会被注入）；
6. 记录 `maxActiveSubagents` 实际值。

**B0 的产出**决定 B1/B2 的具体写法。**若结果回程不可用，B 阶段整体暂停并回报用户**。

**B1. `runSubagent` 增加 continuable 分支**

- 按 `job` 维护 `childId` 映射（落盘到工作台状态文件，复用现有 `st.gen` 结构附近）；
- 有 `childId` ⇒ `sendMessage`；无 ⇒ `startContinuable` 并落盘；
- 仍保留 `agentOptions: subAgentOptions(config, lane)`（§2.4-2 证明可用）；
- **不适用可复用的任务**（`smart-kw` / `smart-ans` / `ws-map`，时延敏感）继续走 `start`。

**B2. 换代语义修正（C4）**

满阈值不再"只改名"，而是：
`drainContinuableChildren(parent, [childId])` 释放 → 清空落盘 childId → 下轮 `startContinuable` 建新。

**B3. GC 适配（C5 + C6）**

- `isPluginOneShotSubagent` 必须**不再无条件跳过 `continuable`**；
- 但要区分"活着"与"已 drain"：**活着的不动**，已 drain 的可搬；
- 判据必须基于**磁盘现状**（目录是否还在），不得依赖某一时刻快照
  （否则会重演"catalog 指向不存在目录"的幽灵条目）。

### 阶段 D（用户新增报障 · 须先于 B）—— 重启不得新建工作台会话

**报障原话**：「现在每次打开都会弹这个弹窗，既不美观，也出现了问题，明明这个工作区已经存在了，
他还让我建立工作区。建立完之后，现在这个记忆中枢工作区里面有两个会话，这个理应是每半个月或者
一个月才会刷新的。」

**真机证据（两次独立复现，硬数据）**：

| 宿主启动 | 启动后工作台会话创建时刻 | 间隔 |
|---|---|---|
| 16:31:36（PID 53876） | `session-a555a6ce…` 16:31:54 | **+18s** |
| 23:05:36（PID 65488） | `session-89499bd9…` 23:06:04 | **+28s** |

两次 `workbench.json` 的 `epoch` 都是 `W1479`（**期号并未轮换**），`sessionId` 被改写成新建的那个。
⇒ 与用户直觉一致：**这不该天天发生，只有期号轮换（半月/月）才该换**。

**根因（三层，缺一层都修不好）**：

1. **判据把「未加载」当「不存在」**：`_verifyWorkbench` 用 `agents.get(sid)` 判会话存活，
   宿主重启后**不会**预加载持久会话 ⇒ 恒 `session-missing` ⇒ `ensureWorkbench` 落到新建分支。
   这与本项目既有纪律同源：**判据必须基于磁盘/持久现状，不得依赖某一时刻的内存快照**。
2. **暂时态与终态未分流**：`session-missing` 同时表示「还没加载」与「真不存在」，无法区分 ⇒ 只能一律新建。
3. **UI 反向误导**：弹窗四行状态算的是「本行是不是本次失败原因」而非「本行过没过」，
   于是**四行全 ✓ 却写着「工作台会话不存在」**（用户截图实证），看不出坏在哪；
   且该相位给出「同意并建立」按钮 ⇒ 点一下再多一个会话。

**修法（D1–D5，已落地）**：

- **D1** 新增 `_resolveWorkbenchAgent(sid)`：调宿主 `SessionController.resolveAgent(sid)`
  （契约 `{agent}` | `{error.code}`，源码 `dsh-api-session-controller/lib/types/agent.d.ts:31-38`、`index.d.ts:66`）。
  `_verifyWorkbench` 在判缺失**之前**先 resume：拿到 `agent` ⇒ 继续三重校验（复用，不新建）；
  `session/not-found` ⇒ `session-gone`（确实没了，才允许新建）；其余错误 ⇒ `session-not-loaded`（暂时态）。
- **D2** `ensureWorkbench`：`session-not-loaded` **直接返回**（不写盘、不建会话、标记可重试）。
  ⇒ 重启不再产生新会话，轮换只由 `epoch` 驱动（默认 `biweekly`，即用户说的「每半个月或一个月」）。
- **D3** 弹窗四行状态改为**真实通过态**：`✓` 过 / `✗` 本行即失败原因 / `·` 尚未校验到（按真实校验顺序定级）。
- **D4** 暂时态**不再进入 offer 相位**，不提供任何「建立」入口；状态行照实说明「尚未加载、自动恢复、不会新建」。
- **D5** 已产生的重复会话**不删**（与 D2「历史欠账不清理」一致；守卫 ⑰ 亦钉死「子代理 GC 不触碰工作台」）；
  需要清理由用户在官方 UI 手动删除。

**不做**：不新增删除调用；不改 `epoch` 语义；不动 GC 判据。

### 阶段 C（收尾）

- 全量回归 `node tools/run-smoke.mjs`（基线 **179 PASS / 0 FAIL**）；
- `node --check` 双文件；
- EOL 性质守恒断言；
- 更新白板与账本（见 §7）。

---

## §4 未决问题与风险

| # | 问题 | 影响 | 处置 |
|---|---|---|---|
| U1 | `selectModel` 对**已存在**的工作台会话是否生效（复用分支） | A2 有效性 | A2 实施后写只读探针验证 |
| U2 | **可复用子代理的结果回程** | **B 阶段成败** | **B0 必须实测**；不可用则暂停 B |
| U3 | 把 `sendMessage` 当"发送新任务"用时，回程语义是否与一次性一致 | 影响 consolidate 等落盘时机 | B0 实测 |
| U4 | `startContinuable` 在"工作台不是活跃 turn"时能否调用 | 后台任务场景（greet/consolidate 常无 turn） | B0 实测 |
| U5 | 可复用子代理的会话名/展示名是否仍带 `auto-memory-` 前缀 | **GC 判据**（§2.5 守卫 G8） | B1 保持 label 前缀不变 |
| U6 | `maxActiveSubagents` 默认 8 是否够用 | 容量 | B0 记录实测值 |
| U7 | 插件设置三个键**管不到"特定对话"**（只能到工作台） | 用户预期 | 按 D1 在设置页**写明**，不假装支持 |

**风险 R1（最高）**：U2 不成立 ⇒ 可复用方案需要自建回程通道（例如从子代理会话日志里捞最终文本）。
届时**不要硬上**，先回报用户重新拍板。

**风险 R2**：B3 若判据写错 ⇒ 可复用子代理永不回收（重演 2026-09-08 爆炸）。
⇒ B3 必须配**独立只读探针**验证"活着不动 / 已搬可回收"，且跑全量回归。

---

## §5 验收标准（做完后逐条核对）

**阶段 A**

- [ ] A-1　`ensureWorkbench` **复用分支**与**新建分支**都会应用工作台路由（两处都改了，不是半修）
- [ ] A-2　`subagentProvider` / `subagentModel` 非空时，`selectModel` 被调用且参数为 `{sessionId, provider, model}`
- [ ] A-3　两键为空时行为与改动前**逐字相同**（不调用 selectModel，走部署默认）
- [ ] A-4　设置页文案已按 D1 改写，且**中文单行**、明确"记忆中枢工作区下所有会话的默认"
- [ ] A-5　`subagent-gc.js` 文件名候选含 `v4`
- [ ] A-6　`node --check lib/index.js lib/client.js` 通过
- [ ] A-7　EOL 性质守恒（两文件仍纯 CRLF，bareLF 0→0）
- [ ] A-8　全量回归 **179 PASS / 0 FAIL / 0 TIMEOUT**

**阶段 B**

- [ ] B-1　B0 实验报告产出（6 项实测数据齐全），U2 结论明确
- [ ] B-2　可复用任务实际产生**较少**的持久会话（对比改动前后同等工作量的会话数）
- [ ] B-3　同一 `childId` 被复用，**未**触发 `DUPLICATE_CHILD`
- [ ] B-4　`smart-kw` / `smart-ans` / `ws-map` **仍走一次性**（时延敏感不退化）
- [ ] B-5　满阈值时**释放旧的 + 建新的**（不再只改展示名）
- [ ] B-6　`isPluginOneShotSubagent` 不再无条件跳过 continuable
- [ ] B-7　活着的不回收、已 drain 的可回收（探针证明）
- [ ] B-8　`auto-memory-` 前缀保持不变（守卫 G8 绿）
- [ ] B-9　无新增删除调用（守卫 ⑰ 绿）
- [ ] B-10　全量回归 179 通过

**阶段 D**

- [ ] D-1　`_verifyWorkbench` 在判缺失**之前**先 `resolveAgent`；拿到 `{agent}` ⇒ 复用，不进新建分支
- [ ] D-2　`session-not-loaded`（暂时态）**绝不新建**工作台会话（`ensureWorkbench` 直接返回、不写盘）
- [ ] D-3　真不存在（`session/not-found` ⇒ `session-gone`）仍能正常重建
- [ ] D-4　弹窗四行状态不再「全 ✓ 却报工作台会话不存在」（未校验到的行显示 `·`）
- [ ] D-5　暂时态不提供「同意并建立」入口（相位收口为 exists）
- [ ] D-6　`epoch` 仍是唯一轮换触发：两次重启 `epoch` 不变、会话数不增
- [ ] D-7　`node --check` 双绿 + EOL 性质守恒（两文件仍纯 CRLF，bareLF 0→0）
- [ ] D-8　全量回归 179 PASS / 0 FAIL / 0 TIMEOUT

**阶段 D7（2026-09-25 真机取证新增）**

- [ ] D-9　`verify.ok=true` 时顶层 `ready` 必须为真（复用分支不得用 `agents.get()` 覆盖 `resolveAgent` 已解析的父 agent）
- [ ] D-10　弹窗相位以 **`verify.ok` 为先**（verify 通过 ⇒ 一律 exists，不提供任何建立入口）
- [ ] D-11　重启后工作台会话数**不增**（第三次重启同样成立）
- [ ] D-12　`node --check` 双绿 + EOL 守恒 + 全量回归 179 PASS / 0 FAIL

**阶段 C**

- [ ] C-1　`node --check` 双绿 + EOL 守恒
- [ ] C-2　已写 `memory_note(kind=handoff)` 四段式账本
- [ ] C-3　已写 `memory_log`
- [ ] C-4　**未**提交 / 未推送 / 未发布（等用户指令）
- [ ] C-5　已告知用户"需手动重启 dsh web 生效"

---

## §6 执行计划表（按序勾选）

| 序 | 任务 | 触及文件 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | 阶段 A1：抽出 `_applyWorkbenchRoute` | `lib/index.js` | — | ☑ |
| 2 | 阶段 A2：创建 + 复用两条路径都调用 | `lib/index.js` | 1 | ☑ |
| 3 | 阶段 A3：设置页文案改写 | `lib/client.js` | — | ☑ |
| 4 | 阶段 A4：GC 文件名候选补 v4 | `lib/subagent-gc.js` | — | ☑ **经查无需改**（见下） |
| 5 | 阶段 A 验收（A-1…A-8） | — | 1-4 | ☑ 179/0/0 |
| 6 | 阶段 B0：最小真机实验 + 报告 | 新增只读探针 | 5、14 | ☐ **阻塞已解除**（用户 23:05 重启宿主，阶段 A 已上线） |
| 7 | **决策点**：U2 成立才继续 | — | 6 | ⏸ 待 B0 |
| 8 | 阶段 B1：`runSubagent` continuable 分支 | `lib/index.js` | 7 | ☐ |
| 9 | 阶段 B2：换代语义修正 | `lib/index.js` | 8 | ☐ |
| 10 | 阶段 B3：GC 适配（C5+C6） | `lib/subagent-gc.js`、`lib/index.js` | 8 | ☐ |
| 11 | 阶段 B 验收（B-1…B-10） | — | 8-10 | ☐ |
| 12 | 阶段 C 收尾 + 记忆写入 | — | 11 | ☐ |
| 13 | 阶段 D：重启不再新建工作台会话 + 弹窗状态修正（用户 23:3x 追加报障） | `lib/index.js`、`lib/client.js` | — | ☑ |
| 14 | 阶段 D 验收（D-1…D-8） | — | 13 | ☑ **178 PASS / 0 FAIL**（D-7/D-8 成立） |
| 15 | 阶段 B0：插件侧**只读契约探针**（含真实签名取证） | `lib/index.js` | 14 | ☑ **已生效并取证完成** |
| 16 | 阶段 B0：四步行为实验（建 / 复用 / 回程 / 同 id 重名） | `lib/index.js` | 15 | ☐ 待真实签名到手 |
| 17 | **决策点 U2**：结果回程不可用 ⇒ 暂停 B 并回报 | — | 16 | ⏸ 倾向「不可用」，待复核 |
| 18 | 阶段 D7：`verify` 为真值（修 `ready` 被内存注册表打回 + 相位以 verify 为先） | `lib/index.js`、`lib/client.js` | 15 | ☑ **真机验收通过**（`ready` 已转真、后台任务开始计数） |
| 19 | 路由计数锁同步（55→56；纪律第五十六条） | `docs/HANDBOOK.md`、`tests/smoke/smoke-test-api-paths.mjs` | 15 | ☑ |
| **20** | **B0b：`maxActiveSubagents` 读法修正（是 `{get}` 对象，须调 `.get()`）** | `lib/index.js` | 15 | ☑ **已重启验收：`.get()` = 8** |
| **21** | **B0c：四步行为实验（建 / 复用 / 回程 / 同 id 重名）** | `lib/index.js` | 20 | ☑ **四步全过**（见 §8） |
| **22** | **决策点 U2 复核** | — | 21 | ☑ **U2 成立 ⇒ B 线放行** |
| **23** | 白板 PLAN.md 整体重写（M1 保护门：先 read 原文件、逐条抄回锚点） | 白板 | 18 | ☐ 长期挂账 |
| **24** | **B1：`runSubagent` continuable 分支** | `lib/index.js` | 22 | ☐ **可开工** |
| **25** | B2：换代改 drain + rebuild（不只 rename） | `lib/index.js` | 24 | ☐ |
| **26** | B3：GC 适配（`isPluginOneShotSubagent` 不得无条件跳过 `continuable`；判据用磁盘现状） | `lib/subagent-gc.js` | 24 | ☐ |
| **27** | **D8：弹窗误弹根治 —— 抽出唯一判据 `wbExistsPre(st)`，开窗门与渲染相位同源；服务端 `ready` 报真值 + `readySource`** | `lib/client.js`、`lib/index.js` | — | ☑ 178/1（唯一红为已知并发抖动） |
| **28** | **D8b：期号轮换耦合（`ready` 与内存态取或 ⇒ stale-true 掩盖 `epoch-mismatch` ⇒ 漏报）** | `lib/index.js` | 27 | ☑ 其「清位」已被 29 取代为**受门控保护**的形式 |
| **29** | **D9：同意门落到服务端（`ensureWorkbench({consent})`，门只拦「需要新建」）+ 守卫同步（gaps +3、migration 抽取器去空参并加固）** | `lib/index.js`、`tests/smoke/smoke-test-workbench-gaps.mjs`、`tests/smoke/smoke-test-workbench-migration.mjs` | 27、28 | ☑ **179 PASS / 0 FAIL / 0 TIMEOUT** |

### E 线（轮换门 · 2026-09-25 立线 · 权威方案见 §9，用户架构决定见 §9.10）

| 序 | 任务 | 触及文件 | 依赖 | 状态 |
|---|---|---|---|---|
| **30** | **E0：剩余取证** —— M3（`subagentCatalog` 跨重启是否从磁盘重建）/ M4（`_workbenchParent` 全部赋值点）/ M5（「已激活」落地形态：真消息 vs 标记文件）/ M6（子代理父归属复核） | 只读探针，落 `artifacts/` | 29 | ◐ **M3/M4/M6 已完成（见 §8 末条）**；仅余 M5 |
| **31** | **E1：数据模型** —— `workbench.json` 升为 `{epoch, epochToken, phase, current, previous}`；`epochToken = sha256(epoch + '\|' + sessionId).slice(0,16)`（即用户提的「哈希值」）；`wbOwnerOf` 唯一归属判据 | `lib/index.js` | 30 | ☑ |
| **32** | **E2：归属门接入** —— 六个写路径（greet / fold / summarize / consolidate / consolidate-logs / distill）开工前先比期牌，对不上即拒绝并记 diag。**收口在 `runSubagent`**（六路径唯一汇聚点，一处接入即全覆盖）；白名单常量 `WB_GATED_JOBS`；判据只用 `wbOwnerOf` + `_wbTokenOf`；**迁移态（落盘期牌为空）放行**，否则「门拒 ⇒ 不写盘 ⇒ 期牌永远补不上」成死锁 | `lib/index.js` | 31 | ☑ |
| **33** | **E3：轮换门** —— `active → draining → sealing`；主判据＝「全部子代理静止」；超时纯防御（不切换、继续等、记 diag）。**实测落地**：唯一写者 `_wbRotateTick`（15 秒心跳）；主判据 `_wbFamilyQuiet` = ① `_subagentInflight===0` ② catalog 中**仍有磁盘目录**的 childId 目录 mtime 均静默 2 分钟（**空 catalog / 全幽灵一律判静止**并记 `wb-quiet: ghosts=N`，E0/M3 修正；**异常判「不静止」**，不 fail-open）；相位迁移只影响门，`_verifyWorkbench` 保持只读且**旧期在 draining/sealing 期仍权威**（不停记忆功能）；60 秒 sealing 重试节流；同意门「只弹一次」（`consentGranted`） | `lib/index.js` | 32 | ☑ |
| **34** | **E4：工作台只激活一次** —— 新期回一句「已激活」，其余全交子代理；`_workbenchParent` 绑定 `epochToken` | `lib/index.js` | 33 | ☑ |
| **35** | **E5：期号口径** —— `'W' + floor(weeks / 2)` → `'B' + floor(days / 2)`。⚠️ **必须最后做**：口径一改即触发一次性轮换 | `lib/index.js` | 34 | ☑ |
| **36** | **E6：收尾** —— ① 守卫同步：**新增 `tests/smoke/smoke-test-workbench-v2-shape.mjs`（39/0）**，把 v2 相位面纳入常驻回归（此前 `tests/` 对该面**零覆盖**）；migration 54/0、gaps 51/0 均绿 ② 全量回归 **180 PASS / 0 FAIL / TIMEOUT 0** ③ 文档勘误：**`errata-scout` 51 条 + `guard-scout` 94 条**普查 → **`errata-writer` 已改 24 个文件**（含 `tools/verify-docs.mjs` 假绿修复：期望值由写死 17/49/98 改为「文档声明值 === 代码实测值」，判定项 4→15，`exit 0`）④ CHANGELOG 已补 E1–E4 段并更正「尚未开工」旧记载。**★勘误关键纠正**：`SPEC:46-47`「会话行删不掉」**正确、零改动** —— 它与宿主 `handleSessionRemoved` 对 `origin==='subagent'` 只降级 status、不删投影 store **同源**（`CHANGELOG.md:70-76` 佐证）；原任务书「需改写 §0」的假设**已推翻**。**★口径纠正**：`docs/` 并非全 PURE LF —— 实测 9 个文档为 PURE CRLF（`USER-GUIDE.zh-CN`/两份 README/`WHITEPAPER` 等），判据一律是「EOL 性质不变」 | 守卫、`docs/`、`CHANGELOG.md` | 35 | ☑ |

**每完成一项**：把该行 ☐ 改成 ☑，并在 §8 追加一行时间戳记录。

### A4 更正（2026-09-24，推翻 §2.5 的 C7）

**§2.5 的 C7「兜底候选写死 v3」判断有误。** 实测 `lib/subagent-gc.js` 早在 v3.1.3 已改成
**扫描目录取任意 `session.*\.jsonl[.zstd]`**（正则 `/^session[.-].*\.jsonl(\.zstd)?$/i`），
硬编码候选只留在 `hits.length ? hits : [...]` 的**回退分支**里；
且守卫 `tests/smoke/smoke-test-v313-guide-sessname.mjs:48` 已断言「v4 命名被优先选中」。
⇒ **不需要改**。教训：引用行号前先 grep 复核当期实现，不要凭早期笔记立项。

### B0 阻塞点（必须在动手 B1 前解决）

**B0 无法在本轮独立完成**：它需要 `ctx.subagents`（活的插件宿主上下文）来真调
`startContinuable` / `sendMessage`，而：
1. 插件代码改动**只在宿主重启后生效**（用户硬规则：AI 不得重启宿主）；
2. 独立 node 脚本拿不到 `ctx.subagents`（那是宿主注入的服务）。

**两条可行路径（择一，由用户决定）**：
- **路径甲（推荐）**：先让用户重启宿主加载阶段 A 改动 → 然后我把 B0 做成**插件侧只读诊断路由**，
  由用户在面板/HTTP 触发一次，产出 6 项实测数据；拿到数据再动 B1。
- **路径乙**：把 B0 探针写进 `tests/`，用**假 provider**（mock `ctx.subagents`）验证
  契约层（id 复用、DUPLICATE_CHILD、回程消息形状），**但无法证明真实回程可用**
  ⇒ 不足以支撑 B1 的架构决策，只能作为补充。

**在 B0 结论出来前，不要开始 B1/B2/B3。**

---

## §7 记忆写入纪律（本轮特有）

- 改动落在 `lib/` ⇒ **必须**写 `memory_note(kind=handoff)` 四段式账本；
- 白板"当前进度"与事实不符 ⇒ `memory_note(kind=plan)` 重写；
- 本轮有一条**稳定架构判据**（"子代理不可移除 ⇒ 记忆中枢必须保留"）⇒ 追加进项目笔记。

---

## §8 进度日志（追加式）

### 2026-09-25 · E1-fix 期牌落盘缺口（v2 收敛收口在唯一写入口）

**触发**：用户重启宿主后做 E1 真机验证。**E1 确认已生效**（`workbench` 路由回传 `phase`/`epochTokenNow`/`wbCurrent` 三个新字段；`epochTokenNow = 5993a42678d9dfc1` 与本地 `sha256('B10358|session-81fa8b3b…').slice(0,16)` **逐字符一致**；期号已由 `W1479` 轮换为 `B10358`；`verify.ok=true`、`reason=ok`；兼容面 `epochNow`/`periodDays`/`greetCount`/`state.sessionId` 全部照旧）。宿主进程启动 **21:37:10**，晚于 `lib/index.js` mtime **21:21:03** ⇒ 新代码确已加载。

**但发现一处真实缺陷**：路由回传 `epochToken = ""`（空串）。**取证结论（代码证据）**：
- 落盘状态是重启前由 F 线写入的旧形状（`version:1`，无 `epochToken`）；
- 重启后走 `ensureWorkbench` 的**复用分支**（`v.ok === true`）⇒ **直接 return、不写盘**；
- 另一条会写盘的路径 `bumpGenFor`（L8977）**只读 `st.sessionId`** 就 `_writeWorkbench(st)` 原样回存，**没有** `epochToken`。

⇒ **只有「新建工作台」才会写出期牌**；在**既有工作台**上，即使后台任务真的跑了、`bumpGenFor` 真的写盘了，落盘文件也会**永远停在旧形状**。
**为什么是硬伤**：E2 归属门的判据是「比对期牌」，而 `_wbTokenOf` 按设计**只读落盘值、不做派生兜底**。落盘期牌恒为空 ⇒ E2 无论怎么实现都会判「对不上」⇒ **全部写路径被拒绝、后台记忆任务全停**。

**修法（遵循「一处收口优先于多处打补丁」）**：把 v2 收敛**收口在唯一写入口 `_writeWorkbench`** —— 凡经它落盘，一律补齐 `version / epochToken / phase / current / previous / drainStartedAt`，**兼容面与其它键原样保留**。
- 关键约束：`epochToken` **只在能从既有状态确定 `epoch + current.sessionId` 时补**，**不做无中生有**（否则等于把归属门判据架空 —— 由 ④ 号负路径验证）。
- 由此 `bumpGenFor` 与 `_ensureWorkbenchVisible` 两条「读旧态 → 改键 → 回存」路径**自动收敛**，两处**均未逐点打补丁**（静态断言 ⑤ 钉死）。

**验证**：
- `lib/index.js` 925,925 → **927,638 B**（PURE CRLF / CRLF=14,186 / bareLF=0 / `node --check` 绿）；备份 `lib/index.js.bak-20260925-214735-e1fix`。
- 行为探针 `artifacts/_e1fix-probe.mjs`（抽真源码函数体**真跑**、临时 `DSH_HOME` 隔离、真实 `~/.dsh` 零接触）：**27 PASS / 0 FAIL** —— ①旧形状回存收敛到 v2（含 9 项兼容面逐键比对）②`bumpGenFor` 式路径同样收敛且不抹期牌 ③期牌已存在时原样保留 ④**无 sessionId 时不凭空造 v2 面（防空转门负路径）** ⑤收敛点只在唯一写入口。
- 原有 E1 探针 **32/0**、迁移守卫 **54/0**、缺口守卫 **51/0**、**全量回归 179 PASS / 0 FAIL / TIMEOUT 0**（59.2 s）。

**★探针自身连踩三次（记为新纪律，非源码缺陷）**：① 抽出的函数体含 `await` ⇒ 必须用 `AsyncFunction` 构造器（`new Function` 直接语法错）；② 用 `fn.slice(fn.indexOf('('))` 切签名会**把 `async` 关键字剥掉** ⇒ 方法变非 async ⇒ `await` 报错（**正解：直接用完整函数文本当对象方法简写**）；③ `AsyncFunction` 调用返回 **Promise** ⇒ 必须 `await` 才拿到对象。

### 2026-09-25 · E1 数据模型（`workbench.json` 升级 + 期牌 + 唯一归属判据）

**产出**：`lib/index.js` 920,743 → **925,925 B**（PURE CRLF / CRLF=14,164 / bareLF=0 / `node --check` 绿）。
备份 `lib/index.js.bak-20260925-211203-e1`。**未提交、未推送、未发布。**

**改动（单文件 `lib/index.js`，一处成批）**：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `_workbenchEpochToken(epoch, sessionId)`（新增） | `sha256(epoch + '\|' + sessionId).slice(0,16)` —— 用户提的「哈希值」；一个字段同时编码**期号 + 会话**。纯函数、空参返回 `''` 不抛 |
| 2 | `_wbStateOf(st)`（新增，**唯一读入口**） | 把旧「单值形状」`{sessionId}` 与新「相位形状」`{current,previous,phase}` 读成同一份语义。纪律来源 D8：同一语义不得两处各写一份判据 |
| 3 | `wbOwnerOf(sessionId, st)`（新增） | 规格 §9.4 的唯一归属判据：`current` 放行 / `previous` ⇒ `sealed` / 其余 ⇒ `orphan` |
| 4 | `_wbTokenOf(st)`（新增） | **只认落盘值，不做派生** —— 刻意不做「epoch+sessionId 现算」兜底，否则等于永不失配、把 E2 归属门架空 |
| 5 | `_verifyWorkbench` | 改走 `const st = this._wbStateOf(raw)`；函数内 **9 处** `st.sessionId` → `st.current.sessionId` |
| 6 | `ensureWorkbench` 写入点 | `version: 1` → `version: 2`；新增 `epochToken` / `phase:'active'` / `current` / `previous` / `drainStartedAt`；旧期自动提升为 `previous` |
| 7 | `workbenchSessionIds()` | 兼容旧单值形状：`if (j && j.sessionId) out.add(...)` —— 否则守卫 ⑰ 的真语义对象在迁移期被架空 |
| 8 | `workbenchStatus()` | 增补只读诊断：`phase` / `epochToken` / `epochTokenNow` / `wbCurrent` / `wbPrevious` |

**兼容面刻意保留（删掉即多处半修）**：顶层 `sessionId` / `cwd` / `permission` / `createdAt` / `greetCount` / `periodDays` 全部原样。读它们的有：前端 `workbenchStatus` 回显、缺口守卫的 `greetCount: 0,` 断言、F 线 `workbenchSessionIds`。

**★实测抓出三处缺陷（两处是我自己引入的，全部由 `node --check` 拦下）**：
1. **`createHash` 早已在 L144 单独导入** —— 我先前的 grep 用了 `-First 25` 被截断，误判为「未导入」而加了第二行 ⇒ `Identifier 'createHash' has already been declared`。**教训：补丁前枚举必须全量、不得截断。**
2. **`epochNow` 不是 `workbenchStatus` 的局部变量** —— 我在诊断字段里引用它 ⇒ `ReferenceError`（**静态守卫完全查不出**，只有 `node --check`／真跑才暴露）。修法：改调 `this._workbenchEpoch(now)`。
3. **9 处 `st.sessionId` 我首轮只改了 5 处** —— 归一后其余 4 处（`workspace-unregistered` / `no-permission-service` / `permission-mismatch` / `ok-return`）会取到 `undefined` ⇒ 典型的**半修**。由切片判据（花括号配平扫描 `_verifyWorkbench`，要求其中 `st.sessionId === 0` 且 `st.current.sessionId ≥ 9`）钉死。

**验证**：
- `--dry` 跑到**最后一条守恒断言**才退出（含结构断言与切片判据）；fail-closed 已实证两次（断言失败时字节数不变）。
- 行为探针 `artifacts/_e1-probe.mjs`（从真源码抽函数体**真跑**）：**32 PASS / 0 FAIL** —— 覆盖算法逐字一致、期牌同时编码期号与会话、两种形状归一、归属三态、`_wbTokenOf` 不派生、切片内无旧字段。
- 迁移守卫 **54/0**、缺口守卫 **51/0**、**全量回归 179 PASS / 0 FAIL / TIMEOUT 0**（53.7 s）。
- EOL 性质守恒（PURE CRLF，bareLF=0）。

**遗留（供 E2 起用，非本项缺陷）**：`_workbenchParent` 尚未绑定期牌（规格 §9.4 要求「携带 epoch」）—— 该绑定属 **E4**；E1 只负责造出期牌与唯一的归属函数。

### 2026-09-25 · E5 提前执行（期号口径 → 2 天一期 + 设置页周期改天数）

**触发**：用户实机验收后指出「轮换周期还是两周一换的口径，没有换成现在的（2 天）」，并要求排查是否与 F3 的归档/删除设置项构成耦合。

**排查结论（附硬证据）**：
1. **不是代码耦合**。`workbenchPeriod` 在 `lib/client.js` 里只出现 2 处（设置页下拉 + 向导 toggle），在 `lib/index.js` 里只出现在 `_workbenchEpoch` 与两处只读回显；F3 新增的 5 个控件（`sessionArchive*` / `autoArchive*` / `autoDelete*`）**从不读写** `workbenchPeriod`。两者在设置页相隔 30 行、中间另有 5 个既有控件。
2. **但用户的直觉指出了一个真实语义串行**：`autoArchiveCandidates` 按「最后活动时间」判定归档，而挂在工作台会话下的子代理会**持续刷新**它的 `lastActivity` ⇒ 该会话永不静默 ⇒ **轮换周期必须 ≤ 归档阈值**，否则 2 天归档节奏对它永不触发。旧口径（两周）恰好破坏了这条链。
3. 规格 §9（L685）早已记录用户「2 天一期」的口径，但 §6 row 35（E5）**从未开工** ⇒ 属**未偿还的口径债**，不是新 bug。

**改动（3 个文件，一次成批）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `lib/index.js` | 期号 `'W'+floor(weeks/2)` → `'B'+floor(days/per)`；新增 `_workbenchPeriodDays()`；`workbenchPeriod:'biweekly'` → `workbenchPeriodDays:2`；两处回显 `period` → `periodDays`；lane 注释同步 |
| 2 | `lib/client.js` | 设置页「工作台轮换周期」**下拉 → 数字输入框「（天）」默认 2**（含文案重写）；**移除向导第 4 步的 `workbenchPeriod` 开关** |
| 3 | 守卫 | ⑥「支持 biweekly 与 monthly」→「期长可配 + 同一基准」；⑬ 三条旧枚举/旧键判据 → 新口径判据 + 新增「防口径回退」；再加 1 条时区防回归 |

**★同批修掉的一个既存真 bug（用户未报，测绘时发现）**：向导第 4 步把 `workbenchPeriod` 放进 `toggles`，而 `tourToggleOn` 的判据是 `!!c[key]` ⇒ **非空字符串恒判「开」**，点击还会把布尔写进配置（真实值 `'biweekly'` 被覆盖成 `true`/`false`）。开关形态只对布尔键成立。
**同型问题仍在**：`workbenchRoot`（目录路径，也是字符串键）同样在向导 toggles 里。**本轮未连带改动** —— 缺口守卫 `smoke-test-workbench-gaps.mjs:71` 正锁着 `key: 'workbenchRoot'`（当作设置页搜索索引条目），连带删会误伤无关守卫。**列为待处置项。**

**落地中发现并修掉的真缺陷**：首版日桶用本地午夜 `new Date(y,m,d)`，其 UTC 时刻含负时区偏移 ⇒ 非 UTC 时区下 `floor` 整体少一天（基准日算出 `B-1`）。修法：改用 `Date.UTC(y,m,d)`。**静态守卫全绿、只有行为探针打出** ⇒ 已加守卫 ⑥ 一条防回归判据，并在三时区（UTC / Asia/Shanghai / America/Los_Angeles）真跑验证。

**实测**：全量回归 **179 PASS / 0 FAIL / TIMEOUT 0**（54.2 s）；行为探针 `artifacts/_e5-probe.mjs` 全绿（基准 `B0/B0/B1`、非法值回落、旧口径 `W1479` → 新 `B10359` 确认构成一次性轮换）；迁移守卫 53→54 项全过；缺口守卫 51/0。
**备份**：`lib/index.js.bak-20260925-202627-e5`、`lib/client.js.bak-20260925-202627-e5`、`lib/index.js.bak-20260925-204025-e5fix`。
**未提交、未推送、未发布。需用户手动重启宿主生效。**

- 2026-09-24　建立本文件。取证完成：§2 全部事实已用源码行号固化。阶段 A/B 待实施（用户已拍板 D1–D5）。
- 2026-09-24　**阶段 A 完成并全绿**。A1 新增 `_applyWorkbenchRoute`（含一处真实缺陷修复：旧内联调用被 `st.visibleAt` 早退挡住 ⇒ 改设置后路由永不重应用）；A2 创建/复用两分支各接一次（新建分支放在可见性补发**之前**）；A3 设置页文案按 D1 改写（作用域写明「记忆中枢工作区下所有会话的默认」+ 强度只管插件子代理）；A4 经查**无需改**（见上）。验收：`lib/index.js` 889,788 B / PURE CRLF / bareLF 0；`lib/client.js` 722,868 B / PURE CRLF / bareLF 0；两文件 `node --check` OK；**全量回归 179 PASS / 0 FAIL / 0 TIMEOUT（58.9s）**。未提交、未推送、未发布；**需用户重启宿主生效**。
- 2026-09-24　**B0 待办**：受宿主重启阻塞（见上方「B0 阻塞点」）。**B1–B3 不得先动。**
- 2026-09-24　**用户已重启宿主（PID 53876→65488，23:05:36）⇒ 阶段 A 已上线、B0 阻塞解除。**
- 2026-09-24　**阶段 D 完成（用户追加报障，优先于 B）**。D1 新增 `_resolveWorkbenchAgent`（调宿主 `SessionController.resolveAgent`，
  按 `{agent}` / `{error.code}` 分流「仍在 / 确实没了 / 暂时态」）；D2 `ensureWorkbench` 对 `session-not-loaded` **直接返回不建会话**；
  D3 弹窗四行状态改真实通过态（✓/✗/·，按校验顺序定级）；D4 暂时态不再进 offer 相位；D5 重复会话不删（与 D2 一致 + 守卫 ⑰）。
  根因有两次独立复现的硬数据（重启后 18s / 28s 各多建一个 `记忆中枢 #W1479`，`epoch` 两次都是 W1479 未轮换）。
  验收：`lib/index.js` 892,904 B / PURE CRLF / bareLF 0；`lib/client.js` 724,525 B / PURE CRLF / bareLF 0；两文件 `node --check` OK。
   **未提交、未推送、未发布；需用户再次重启宿主生效。**
- 2026-09-24　**教训（已入纪律）**：给源码插入新方法时，锚点必须**连同上一段注释块的 `/**` 一起锚定** ——
  只锚 `* 三重校验…` 会把新方法插进注释块内部，新方法自己的 `*/` 提前关掉外层注释，后续行变裸代码 ⇒ `SyntaxError`。
  `--dry` **没能**发现它（dry 只做文本替换不做语法检查）⇒ 补丁流程必须把 `node --check` 作为 dry 之后、写盘之前的强制一步。
- 2026-09-24　**阶段 D 验收通过**：全量回归 **178 PASS / 0 FAIL / 1 TIMEOUT**；唯一超时
  `smoke-test-c4-fresh-install.mjs`（62.0s vs 60000ms 上限）**经归因实验证伪为负载抖动** ——
  单跑仅 **9s / PASS 8/8**。⇒ D-7（`node --check` 双绿 + EOL 守恒）、D-8（回归）成立。
- 2026-09-24　**修 3 条字符串锚定守卫的魔法窗口**（回归出红后的归属实验）：④ 与 ⑧ 用
  `idx.slice(fn, fn+2600)` / `cli.slice(i, i+6000)` 这类**魔法长度**切片，阶段 D 的新增代码把
  `permission-mismatch` / `data-dam-wb-risk` / `data-dam-wb-dir` 推出窗口 ⇒ **假红**。
  判定：**守卫守的语义（三重校验三条都在；弹窗必须含风险说明与目录落点）不变，窗口只是实现细节**
  ⇒ 改成**真实边界**（④ 用下一个方法的锚点；⑧ 用下一个 dialog 分支的锚点）。本文件 ③/⑤ 早有同款先例。
- 2026-09-24　**阶段 B0 第一步落盘**：新增 `subagentProbeContract()` + 只读路由
  `POST /api/dsh-auto-memory/subagent-probe`（不带 `action` ⇒ 零副作用）。产出项：
  `ctx.subagents` 上 `start/startContinuable/sendMessage/drain` 的存在性 → 三者**真实源码首段**
  （免得凭猜测写 B1 调用）→ `maxActiveSubagents`（U6）→ `send_message` 工具存在性与
  **相邻代理标记**（U2 静态半边）→ 工作台父 agent 是否活着（U4 前提）。
  `lib/index.js` 897,672 B / PURE CRLF / `node --check` OK。**待用户重启后触发取证**；
  拿到真实签名再写第二步（四步行为实验），**B1–B3 仍不得先动**。
- 2026-09-25　**用户第二次重启（PID 65488→65028，00:10:07）⇒ 阶段 D 真机验收通过**：
  `workbench.json` 的 `sessionId` **未被改写**（仍 `session-89499bd9…`），工作台会话目录**仍是 3 个**
  （4:50 / 16:31 / 23:06）——**这次重启没有新增第 4 个**。对照前两次（+18s / +28s 必多建一个）⇒ **D-6/D-11 成立**。
- 2026-09-25　**B0 契约探针取证完成**（`POST /api/dsh-auto-memory/subagent-probe`，不带 `action` = 零副作用）：
  - ✅ `ctx.subagents` **存在**，`start` / `startContinuable` / `sendMessage` / `drainContinuableChildren` **四个都是 function** ⇒ 可复用契约技术可行。
  - ✅ `workbenchParentLive: true`，父 agent id = 当前工作台会话 ⇒ **U4 前提成立**。
  - ⚠️ `sendMessageToolPresent: true` 但 **`sendMessageToolMarked: false`** ⇒ `returnGuidanceWillInject: false`
    ⇒ **U2 静态半边不利**：子代理拿不到「如何回信」的指引（待复核读法，因该服务是 remote 代理，`.toString()` 只回 `[native code]`，**无法用反射取真实签名**）。
  - ⚠️ `maxActiveSubagents` 首轮读回 `{}`（该字段是 schema 对象非数字）⇒ 已改逐路径探测，**下一轮取证见分晓**。
- 2026-09-25　**★当场抓出第三缺陷 D7（这才是「每次打开都弹窗」的直接原因）**：真机诊断显示
  **`verify.ok: true` 却顶层 `ready: false`**。根因：`_verifyWorkbench`（D1）已用 `resolveAgent` 解析出活 agent 并写进
  `_workbenchParent`，但复用分支紧跟一句 `this._workbenchParent = this._agentBySessionId(v.sessionId)`
  ——用**重启后为空的 agents 内存注册表**把它**覆盖回 null** ⇒ ① 客户端按 `ready` 判相位 ⇒ 弹窗照旧弹；
  ② `runSubagent` 门控读到 `ready=false` ⇒ **后台记忆任务被全部暂停**。
  修法：服务端「**同一会话**已解析出父 agent 就不覆盖」；客户端相位改以 **`verify.ok` 为先**（verify 是只读真值，ready 只是内存态）。
- 2026-09-25　**路由计数锁同步（第二处踩坑记录 → 纪律第五十六条复现）**：新增 1 条路由 ⇒ 端点 54→55→**56**，
  同一条数字散落 **9 处**：`docs/HANDBOOK.md` 5 处（术语表 / 架构图 / §5.1 标题 / 校验命令期望输出 / 末尾对照表）
  + `smoke-test-api-paths.mjs` 白名单 1 处（新增端点必须登记并注明非界面消费者）
  + **3 个测试硬锁**（`smoke-test.mjs:75`、`smoke-test-m3b3.mjs:47`、`smoke-test-context-observer.mjs:112`，均 `!== 55`）。
  教训：**加路由前先 `grep 55` 数一遍落点**，否则回归会以「3 个套件 0.3s 秒挂 + 5 条 HANDBOOK 断言红」的形式报出来。
- 2026-09-25　**★D7 真机验收通过（比预期更强的证据）**：用户切到**桌面端**后，宿主端口从 3080 变为 **19387**
  （`DeepSeek Harness` 主进程监听；3080 已无监听 ⇒ 探针脚本必须端口自适应，已产出 `artifacts/_probe-any-port.mjs`）。
  桌面端探针读到：

  | 字段 | 修复前 | 现在 |
  |---|---|---|
  | `verify.ok` | true | true |
  | **`ready`** | **false** | **true** ✔ |
  | `greetCount` / `gen` 计数 | 空转 | **5 条 lane 在计数**（greet 4 / consolidate 7 / fold 4 / summarize 3 / ws-map 1）|

  ⇒ **两个后果都消失了**：弹窗不再误弹；且 `runSubagent` 门控放开，**后台记忆任务真的在跑**（这是第一次观察到计数增长）。
- 2026-09-25　**第三次重启的 D-11 也成立**：`workbench.json` 的 `sessionId` 仍 `session-89499bd9…`（`createdAt` 仍 23:06:04），
  工作台会话目录**仍是 3 个** ⇒ 连续三次重启零新增。
- 2026-09-25　**maxActiveSubagents（U6）确证**：新增的 `configProbe` 显示它是 **`{ get }` 对象**而非数字
  ⇒ 必须调 `sa.config.maxActiveSubagents.get()`。首轮读回 `{}`/`null` 是读法错，不是字段缺失。
- 2026-09-25　**★B0 真契约取证（改从宿主类型定义取，反射取不到）**：`.toString()` 对 remote 代理只回 `[native code]`，
  改读 `C:\Users\JH Z\.dsh\profiles\node_modules\@deepseek-ai\dsh-subagent\lib\types\`（**桌面端可读路径**，非 asar）：

  ```ts
  // types.d.ts:26-51
  interface ContinuableStartSpec {
    provider: string                     // ctx.subagents 的 provider 名
    label: string                        // 初始委派的短 description，持久化为子代理创建标签
    childId?: SessionId                  // 可选：调用方预留的稳定子 id（省略则由 manager 分配 UUID）
    request: Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>
    signal: AbortSignal
  }
  interface ContinuableStart { childId: SessionId; messageId: MessageId }

  // index.d.ts:157 / 208
  sendMessage(sender: Agent, targetId: SessionId, content: ContentBlock[], options: SubagentSendMessageOptions): Promise<MessageId>
  drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>
  ```

  另有 `assertChildIdAvailable(childId)`（continuation-activation.d.ts:152）**就是「同 id 重复建应抛错」的判据源**；
  父会话 catalog 条目经 `catalog.d.ts:21` 的 `childId` 关联（B3 的 GC 适配要读它）。**入参形状已定，B0c 可写。**
- 2026-09-25　**B0b + B0c 落盘**：`lib/index.js` **899,617 → 905,955 B**（补丁脚本内部按字符计为 715,585 → 721,219，
  二者一致——CRLF 加中文使字节数大于字符数），`node --check` 绿，PURE CRLF / bareLF 0，
  全量回归 **179 PASS / 0 FAIL / 0 TIMEOUT（62.4s）**；**未新增路由 ⇒ 9 处计数锁不受影响**。

  1. **B0b**：`maxActiveSubagents` 补 `.get()` 调用 —— 真机证实该字段是 `{ get }` 对象
     （`configProbe.maxActiveSubagentsKeys: ['get']`），首轮读回 `{}`/`null` 是**读法错**而非字段缺失。
  2. **B0c**：新增 `subagentProbeRun(opts)` + 路由分支 `if (action === 'run')`。**四步**：
     ① `startContinuable({provider,label,childId,request:{prompt,parent},signal})` → 记 `childId`/`messageId`；
     ② `sendMessage(parent, 同一 childId, content, {signal})` → 验「复用」而非「新建」；
     ③ **同 id 重发** → 期望被拒（`assertChildIdAvailable` 是判据源），记录原始报错串；
     ④ `drainContinuableChildren(parent,[childId])` **尽力回收**（无论前面成败）。
     设计约束：自定 `childId`（`session-b0c-<ts36>`）是**必须**的 —— 省略则由 manager 分配 UUID，第②③步无从验证复用与重名；
     每步 fail-soft 记录原始错误串；60s AbortController 兜底；**默认路径仍零副作用**（只有显式 `action='run'` 才动手）。
  - ⚠️ **该补丁需用户重启宿主才生效**，重启后触发 `POST .../subagent-probe {"action":"run"}` 即得 B0c 四步实测数据。

  判据沉淀（可复用）：**验证「复用」类契约时，必须由调用方指定身份**；让 manager 自分配 id 会让「复用」与「新建」在观测上不可区分。

- 2026-09-25　**★★ B0c 四步实测通过 ⇒ 决策点 U2 判定为「成立」，B 线放行。**
  取证方式（宿主重启后）：`GET /api/dsh-auto-memory/debug` 先取 provider 名单，再
  `POST /api/dsh-auto-memory/subagent-probe {"action":"run","provider":"spawn"}`。

  | 步 | 结果 | 关键返回 |
  |---|---|---|
  | ① `startContinuable` | ✓ | `{childId:'session-b0c-mufrk7tt', messageId:'ab7d5dd5-…'}`，**`childIdReused=true`** |
  | ② `sendMessage(parent, 同一 childId, …)` | ✓ | `messageId='b7cbbbf8-…'` |
  | ③ 同 id 重复 `startContinuable` | ✓ 被拒 | `subagent "session-b0c-mufrk7tt" already exists` |
  | ④ `drainContinuableChildren` | ✓ | `drained` |

  **整轮耗时 0.1s** ⇒ `startContinuable` 只把首条消息投进 inbox 就返回，**不阻塞**等子代理跑完
  （与类型定义注释「owning the operation only until inbox acceptance」一致）。

  **三条结论**：
  1. **调用方可预留身份** —— 自定 `childId` 被原样接受并回传，这是 B1 按 job 维护 id 映射的前提；
  2. **可复用契约成立** —— 向「已存在的同一 childId」追加消息成功，无需重建子代理；
  3. **幂等保护有效** —— 同 id 重发被显式拒绝（`assertChildIdAvailable`），不会因并发/重试意外产生孪生代理。

  **U2 的担忧被证伪**：`sendMessageToolMarked=false` 只影响**子代理侧**的 return guidance 注入，
  不影响「父→子追加消息」这条能力本身 ⇒ 不构成 B 线阻塞项。

  **附带修正两处读法错误（都是「类型/形状假设错」而非功能缺失）**：
  - `subagents.list()` 返回**字符串数组**（provider 名），默认名 `'spawn'`。写 `ls[0].name || ls[0].id`
    对字符串取属性得 `undefined` ⇒ 误报 `no provider resolved`。**修法：照抄 `runSubagent` 的权威解析段**；
  - `maxActiveSubagents` 是 `{get}` 对象 ⇒ 调 `.get()` 得 **8**（U6 答案）。

  **回归**：178 PASS / 1 FAIL。唯一红 `smoke-test-peer-probe-live.mjs` **单跑 pass=8 fail=0 / 12.9s / exit=0**
  ⇒ 归因**并发负载抖动**（它真加载 118MB 语义模型，4 路并发时被拖到 33.4s），非真红。

  **纪律沉淀（可复用）**：**「形状假设」是最隐蔽的一类契约错**——`list()` 返回对象还是字符串、
  配置项是数字还是 `{get}` 包装，错了都不报错、只静默给 `undefined`/`{}`。
  ⇒ 凡要读外部依赖的返回值，**先去宿主包的 `.d.ts` 或调用点抄现成写法**，不要凭命名猜形状。

---

- 2026-09-25　**★★ D8/D8b/D9：弹窗误弹根治 + 期号轮换耦合 + 同意门落到服务端（179 PASS / 0 FAIL）。**

  **一、D8 —— 用户报障「四项校验全 ✓、状态 ok，却仍弹『建立「记忆中枢」』，且一聚焦窗口就重弹」。**
  根因是**两层叠加**（本仓纪律「同一语义不得两处各写一份判据」再次复现）：
  1. 客户端 `checkWorkbenchPre` 的**开窗门**用 `st.ready`（宿主进程内内存态，重启后恒 `undefined`);
  2. 而 **D7 修的渲染相位**用 `verify.ok`（只读真值）—— 但开窗时 `openDialog({phase:'offer'})` **显式传了 phase**，
     `dialogState.phase || (...)` 的右侧**永不求值** ⇒ **D7 那次修复是死代码**。
  3. `focus` 与 `visibilitychange` 两个监听器都调它，而去重键只挡「同时显示」⇒ **关掉后再聚焦即重弹**。

  **`ready` 恒 false 的原因**：`ensureWorkbench` 全仓仅 3 处（定义 / 客户端 `action:'setup'` / `runSubagent` 惰性门控），
  重启后无人主动算 `_workbenchReady`；而 `_verifyWorkbench` 早已解析出**活的父 agent**（探针 `workbenchParentLive:true`）
  ⇒ 工作台其实一直可用。**判据技巧**：`reason` 显示 `ok` 但取值是 `this._workbenchReason || v.reason` ⇒ 显示 ok 说明
  `_workbenchReason` 为空 ⇒ 证明 `ensureWorkbench` 从未跑完。

  **修法**：客户端抽出唯一判据 `wbExistsPre(st) = !!(st.ready || (st.verify||{}).ok)`，开窗门与渲染相位共用；
  服务端 `workbenchStatus()` 改报真值（**只修「怎么报」，不动任何会话创建行为**）。

  **二、D8b —— 期号轮换耦合（用户点名怀疑「半个月轮换时会否耦合」，判断正确）。**
  方向是**漏报**而非误报：轮换后 `v.ok=false`（`epoch-mismatch`），但 `_workbenchReady` 往往是**上一期遗留的 stale true**
  ⇒ `ready` 仍报 true ⇒ ① 客户端判「已存在」不提示轮换；② `runSubagent` 门控 `if (!this._workbenchReady)` 读到 true
  ⇒ **跳过 `ensureWorkbench`** ⇒ 本期会话永不重建、后台任务持续写上一期。
  **纪律沉淀**：**把「内存态」与「只读真值」取或，等于把真值降级为兜底。**

  **三、D9 —— 「未经同意不新建工作区」这道门控的真实边界 + 把它落到服务端。**
  取证四条：① 只读检测零副作用（`client.js:1482` 发 `{}` 不带 `action`）；
  ② **唯一建立入口** = `client.js:6419` 的 `{action:'setup'}`，只在 `wbRun` 内、只绑弹窗「同意并建立」按钮（**门控本体**）；
  ③ 但 `runSubagent` 的惰性路径会 `ensureWorkbench()`，后者不读任何同意标志 ⇒ **可绕过**；
  ④ `needPrompt` 是**死字段**（3 处返回、零消费者）；配置中亦无 `consent/approved` 键。
  ⇒ 对话框承诺「建立完成前所有后台任务都会暂停；只有你点了「同意并建立」才会写入」——**前半句成立、后半句不成立**。

  **自省**：**D8b 的「验证不过就清 `_workbenchReady`」恰好激活了这条绕过路径**（清位 ⇒ `runSubagent` 重新调
  `ensureWorkbench` ⇒ 不经同意就建）。用户警告「你要贸然改，可能会造成耦合」——**正确**。

  **修法（先 A 再 B）**：A 先撤回 D8b 清位；B 给 `ensureWorkbench(opts)` 加 `opts.consent`，**同意门放在「复用」与「瞬态」
  两个分支之后** —— 只拦「需要新建」那条路（`session-not-loaded` 返回 `transient/retry`，拦了会把「重启后会话未加载
  ⇒ 加载完自动复用」的自愈堵死）；路由 `action:'setup'` 传 `{consent:true}`（全仓唯一同意来源，已 grep 核实）；
  门到位后**恢复清位**（受门控保护：清了也建不了，只会「暂停 + 提示」，而不清会让轮换后门控整段被跳过）。

  **四、守卫同步（两处，均按「先判定守卫守的什么」纪律）。**
  - `smoke-test-workbench-gaps.mjs`：S8 守的不变量是「**启动路径就绪必须静默撤窗**」而非 `st.ready` 字面量
    ⇒ 判据改写、不变量保留，并**加固**为「`wbExistsPre` 定义 + 两处引用 ≥3」+「`ready` 不得与内存态取或」+「验证不过须清位」
    +「同意门：未同意不得新建」。**51 PASS / 0 FAIL**。
  - `smoke-test-workbench-migration.mjs`：**改函数签名会连带打红「按签名抽函数体」的守卫** ——
    `async ensureWorkbench()` → `(opts)` 使 `indexOf` 返回 -1 ⇒ `seg.length=0` ⇒ ③⑤⑭ **六条 `len=0` 全假红**。
    六条不变量（busy 闸 / `finally` 释放 / 建立后设 `danger-full-access` / 建立后复检 / 两方法存在 / 路由走 engine）
    **在源码里全部仍成立** ⇒ 改判据侧不改源码；抽取器锚点改为**只锚函数名前缀** `'async ensureWorkbench('`
    （今后再加形参不会再假红）；并将 ⑭ 的「路由走 `engine.ensureWorkbench()`」**加固为「必须传 `{consent:true}`」**
    —— 同意门本体就此被守卫钉住。守恒回验写入补丁脚本 `_d9c` 内（`seg=22278`）。**49 PASS / 0 FAIL**。

  **纪律沉淀（可复用）**：**凡守卫用 `indexOf('完整签名字面量')` 抽取函数体，改签名前先 grep 抽取器；
  抽取器应只锚函数名前缀。**

  **验收**：`lib/index.js` 724,588 字符（PURE CRLF，bareLF 0）、`lib/client.js` 733,202 B、两处 `node --check` 绿；
  全量回归 **179 PASS / 0 FAIL / 0 TIMEOUT（60.6s）**。补丁脚本（均带 `--dry`）：`_d8-unify-wb-predicate.cjs`、
  `_d8-guard-sync.cjs`、`_d8b-epoch-coupling.cjs`、`_d9a-revert-clear.cjs`、`_d9b-consent-gate.cjs`、`_d9c-guard-signature.cjs`。
  **需用户重启宿主生效**。未提交、未推送、未发布。

- 2026-09-25　**★E0 取证：M3 / M4 / M6 三项完成（全部只读、零副作用、未重启宿主），并当场推翻了 §9.10 的判据②。**

  **M3 —— catalog 跨重启是否会重建？答：catalog 是父会话事件流的投影，重启可重建，但实测露出更严重的一条。**
  - 投影定义 `dsh-subagent/lib/catalog.js:74-84`：`key:'subagentCatalog'`，`apply` 只做
    `{...state, head: appendChunkedList(state.head, …)}` —— **只追加、无删除 API**；
  - 事件产生点 `catalog.js:93` `parent.append('subagent/catalog', …)` ⇒ 事件写在**父会话事件流**里；
  - 实测工作台会话事件流（`session.v4.jsonl.zstd`，150,279 B / **44 个 zstd 帧** / 解压 433,562 字符 / 75 行）：
    事件类型 `subagent/catalog` **26 条**、`childId` **26 条**，而字面量 `subagentCatalog` **0 次**
    ⇒ catalog 数据确实持久化在父会话里 ⇒ **重启后投影可重建，「族静止」判据跨重启有效**；
  - **⚠️ 但同一实验暴露致命缺陷**：投影缓存 `~/.dsh/storages/session_projcache/sessions/<父sid>.json`
    实测 **25 条 catalog 条目，25 条全部没有对应磁盘目录**（1 条 continuable `session-b0c-mufrk7tt` +
    24 条 one-shot `auto-memory-*`；子代理一次性跑完即被 GC 回收）。
    ⇒ §9.10 判据②原文「全部 childId 的会话目录 mtime 均静默 N 秒」**在任何时刻都恒真**
    ⇒ 门会**永远**判「家族静止」⇒ **主判据被架空，等于没有门**。
    **已修正 §9.10 判据②**（只对「仍有磁盘目录」的条目取 mtime；空 catalog 或全幽灵时判静止并记 `wb-quiet: ghosts=N`）。

  **M4 —— `_workbenchParent` 赋值点恰好 3 处，无散落**：`lib/index.js` L8502（`_verifyWorkbench`）、
  L8715 与 L8844（均在 `ensureWorkbench`）⇒ E1 给父 agent 绑 `epochToken` 只需动这 3 处，**不需要新机制**。

  **M6 —— 子代理父仍挂工作台，「用户会话零 catalog 条目」未被破坏**：catalog 全部 25 条都存在于
  工作台会话（`session-89499bd9…`）的投影里。

  **工具教训（跨会话复用，已入库）**：`zlib.zstdDecompressSync` 对**多帧 zstd 追加流**只解**第一帧**
  —— 实测 150,279 B 只解出 222 字符，造成 `subagentCatalog 命中 0` 的**假阴性**（差点据此得出反向结论）。
  会话事件流必须按 zstd 帧魔数 `28 B5 2F FD` 切帧后逐帧解压；
  `lib/subagent-gc.js:36` 早已踩过该坑并实现了 `decodeZstdFramesHead` ⇒ **写新探针时照抄它**。

  **守卫冲突检查（E1 前必读）**：`lib/subagent-gc.js:309` `purgeSubagentCatalog()` 读写的路径是
  `.record.rows.subagentCatalog.val.head.values[].childId` —— 与 E1 的 `workbench.json` 升级
  **不同文件、不冲突**，但它印证了「catalog 是只追加列表」这条事实。

  **产出**：只读探针 `artifacts/_e0-m3-catalog-probe.mjs`（v1，有单帧缺陷）与
  `artifacts/_e0-m3-catalog-probe2.mjs`（v2，按帧切分，正确）。
  **E0 剩余**：仅 **M5**（「已激活」落地形态）—— 须等 E4 实现后真机验证，或先做只读的设计评审。
  `lib/` 本轮**零改动**；未提交、未推送、未发布。

---

## §9 轮换门设计（2026-09-25 新增 · 待拍板后开工）

> 起因：用户提出「记忆中枢从半月一期改为 **2 天一期**，过期自动归档、打开新的」，并要求想清楚三件事：
> **轮换流程的门**、**新旧归属**、**问候 / consolidation 如何跟随最新对话**。

### 9.1 现状取证（代码事实）

| 项 | 位置 | 事实 |
|---|---|---|
| 期号算法 | `lib/index.js:8419-8428` | `'W' + floor(weeks / 2)`，基准 `Date.UTC(1970,0,5)`（周一），单位 = 周 ⇒ 半月一期 |
| 子代理父 | `runSubagent` | `const parent = this._workbenchParent \|\| agent \|\| this._lastAgent`；注释原文「**子代理统一挂到工作台会话(用户会话零 catalog 条目)**」 |
| 未就绪门控 | 同函数头部 | `if (!this._workbenchReady) { … return '' }`（带 30s 退避 + `_workbenchFailedAt`） |

### 9.2 真正的冲突点

**「子代理统一挂到工作台」与「工作台要定期封存」直接冲突。**

- 挂工作台的目的：用户会话零 catalog 条目；
- 代价：工作台的活动被**所有**子代理刷新 ⇒ 永不安宁 ⇒ 通用清理（按 `lastActivity` 判定）永远够不着；
- 且 `_workbenchParent` 是**缓存对象** —— 换代若不同步，子代理会继续挂到**旧**工作台 ⇒ 旧会话永不静默、新会话永远空。

### 9.3 轮换门（状态机 · 拟）

`workbench.json` 由单值升级为带相位：

```json
{ "epoch": "B1479", "phase": "active",
  "current":  { "sessionId": "...", "openedAt": 0, "lastRealActivityAt": 0 },
  "previous": { "sessionId": "...", "sealedAt": null },
  "drainStartedAt": 0 }
```

相位转移：`active --epoch 变--> draining --族静默--> sealing --新会话就绪--> active(新期)`

- **draining 期仍用 current**（不能因要换代就停记忆功能），只是开始探测静默；
- **族静默判据必须基于磁盘 / 权威现状，不得用内存快照**（D3 教训）：
  ① 工作台 `subagentCatalog` 全部 childId 的会话目录 mtime 均 N 秒未变；
  ② 插件 `_subagentInflight === 0`；
  ③ 宿主侧无 pending turn（能否拿到见 M2）。
- **超时（拟 30 分钟）不静默 ⇒ 保持 draining、不切换、记 diag + UI 可见。绝不强切** —— 强切会造「半轮换」（旧的还有人在写、新的已经开始）。

### 9.4 新旧归属：唯一判据

纪律来源 = §D8 教训（同一语义不得两处各写一份判据）：

```js
function wbOwnerOf(sessionId, st) {
  if (st.current  && st.current.sessionId  === sessionId) return 'current'
  if (st.previous && st.previous.sessionId === sessionId) return 'sealed'
  return 'orphan'
}
```

- 所有写路径（`greet` / `fold` / `summarize` / `consolidate` / `consolidate-logs` / `distill`）**必须先过它**；
- `current` 放行；`sealed` / `orphan` **拒绝并记 diag**；
- **`_workbenchParent` 必须携带 epoch**，与 `st.epoch` 不符即视为未就绪（复用既有门控与退避，零新机制）。

### 9.5 问候 / consolidation 如何跟随最新对话

现状是**对象与挂载分离**：

| 任务 | 真正的工作对象 | 现状父 |
|---|---|---|
| `consolidate` | **用户会话**的本轮消息 | 工作台 |
| `greet` / `fold` / `summarize` / `distill` / `consolidate-logs` | 磁盘记忆库 | 工作台 |

⇒ 任何一次用户对话都会去**刷新工作台的活动**，这是轮换被无限推迟的机制根源。

两条候选（**取决于 M1 实测**）：

- **A**：`consolidate` 挂回它观测的用户会话 ⇒ 工作台立即可静默；代价 = 用户会话多出 catalog 条目，与「能少点就少点」相冲突。
- **B（推荐）**：保留统一挂工作台，但 `current` 增加 `lastRealActivityAt`，**只由「中枢自省类」任务刷新**，`consolidate` 不计入；轮换门按它判静默。

### 9.6 职责边界（定调）

```
dsh-auto-memory    ：轮换 + 封存（保证旧会话不再被写、不再被唤醒）
host 官方 API      ：归档（archiveSession）
dsh-session-archive：删除（物理删除 + 保留期自动清理）
```

**不新增任何删除调用** —— 守卫 ⑰ 合规。

### 9.7 期号口径迁移

`'W' + floor(weeks / 2)` → `'B' + floor(days / 2)`（同一基准）。

**一次性副作用**：升级那一刻期号突变 ⇒ 立刻触发一次轮换（多出一个工作台会话）。必须走完整门，且**写进 CHANGELOG**，否则会重演 D6 那类「怎么又建了一个」的惊讶。

#### 9.7.1 落地记录（2026-09-25 · E5 提前执行）

| 项 | 落地 |
|---|---|
| 算法 | `lib/index.js` `_workbenchEpoch(nowMs)`：`'B' + String(Math.floor(days / per))`，`per = this._workbenchPeriodDays()` |
| 基准 | **不变**，仍是 `Date.UTC(1970, 0, 5)` |
| 配置键 | `workbenchPeriod: 'biweekly'` → **`workbenchPeriodDays: 2`**（区间 1–3650，非法值回落 2 且不抛） |
| 工期可配 | 新增 `_workbenchPeriodDays()`；三个读点（`periodDays` 回显 ×2、期号算法 ×1）一次改全 |
| 设置页 | 「工作台轮换周期」**下拉** → **「工作台轮换周期（天）」数字输入框**（默认 2）；向导第 4 步里的 `workbenchPeriod` 开关**移除** |
| 守卫同步 | `smoke-test-workbench-migration.mjs` ⑥ / ⑬（旧枚举 `biweekly`/`monthly` 代理判据 → 新口径判据，语义不削弱）+ ⑬ 新增「防口径回退」 |
| 实测 | 全量回归 **179 PASS / 0 FAIL / TIMEOUT 0**；行为探针 `artifacts/_e5-probe.mjs` 全绿 |

**★执行顺序偏离（有意为之，需记录）**：§6 row 35 原写「**必须最后做**」。实际在 **E1 之前**执行 —— 理由是 E1 尚未开工，此刻改口径**不会**产生任何「半新半旧」的口径不一致，反而避免 E1–E4 完成后回头返工。偏离已由本节记录，规格 §6 该行同步打勾。

**★落地中发现并修掉的一个真缺陷（行为探针才发现，静态守卫全绿）**：
首版把日桶写成 `new Date(d.getFullYear(), d.getMonth(), d.getDate())` —— 这是**本地午夜**，其 UTC 时刻等于「真实天数 × 86400000 − 时区偏移」。在 UTC+8 下 `Math.floor(... / 86400000)` 会**整体少一天**（基准日算出 `B-1` 而非 `B0`）。
修法：日桶改用 `new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))`（**本地日历日的 UTC 表示**），使天数差是精确整数。
验证：在 `TZ=UTC` / `Asia/Shanghai` / `America/Los_Angeles` 三个时区真跑，均为 `B0 / B0 / B1`，且同一本地日历日的 00:30 与 23:30 同期。
已加守卫 ⑥ 一条防回归判据。

**★探针自身的纪律（同轮踩到）**：期号按「**本地日历日**」切期（§9「按系统墙钟」）⇒ 探针**不能**直接拿 `Date.UTC(1970,0,5)` 那个瞬间当本地日：在 UTC−7 下，该瞬间的本地日历日其实是 **1 月 4 日**，会误判算法错。探针必须用 `new Date(y, m, d, h)` 本地构造。

### 9.8 必须实测的分叉点（M 系列 · 未测不得设计）

| # | 待测 | 决定什么 |
|---|---|---|
| M1 | `consolidate` 运行时，**工作台会话目录 mtime 变不变** | 变 ⇒ 需要 A/B 方案；不变 ⇒ 只需门自己的判据（**已降级为知情项**） |
| M2 | 插件能否拿到会话活动查询（`workspaceRegistry` / `sessionController`） | 静默判据 ③ 能否用官方 API（**已降级**） |
| M3 | `subagentCatalog` 宿主重启后是否从磁盘重建 | ✅ **已测（2026-09-25）**：catalog 是**派生缓存**（父会话事件流里的 `subagent/catalog` 事件 → 投影 `appendChunkedList`），重启后重建 ⇒ 跨重启判定**成立**。⚠️ 但实测露出**更严重的一条**：catalog 里 25 条**全部**无磁盘目录 ⇒ §9.10 判据②原文恒真，**已修正** |
| M4 | `_workbenchParent` 的缓存更新时机 | ✅ **已测**：全仓**恰好 3 处赋值**（`lib/index.js` L8502 `_verifyWorkbench`、L8715 + L8844 `ensureWorkbench`），均在既有两道方法内 ⇒ 换代只需改这两处，无散落 |

### 9.8.1 E0 取证结论（2026-09-25 · M3/M4/M6 已完成，仅余 M5）

**M3 —— 结论：catalog 不从磁盘重建，它是父会话事件流的投影；跨重启有效。**

证据链：
1. 投影定义 `dsh-subagent/lib/catalog.js:74-84`：`key:'subagentCatalog'`，`apply` 只做
   `{ ...state, head: appendChunkedList(state.head, …) }` —— **只追加，无删除 API**；
2. 事件产生点 `catalog.js:93`：`parent.append('subagent/catalog', …)` ⇒ 事件写在**父会话事件流**里；
3. 实测工作台会话事件流（`session.v4.jsonl.zstd`，150,279 B / **44 个 zstd 帧** / 解压 433,562 字符 / 75 行）：
   `subagent/catalog` **26 条**、`childId` **26 条**、`subagentCatalog` 字面量 **0 次** ⇒ catalog 数据确实持久化在父会话里。
4. 投影缓存 `~/.dsh/storages/session_projcache/sessions/<父sid>.json` 实测：**25 条 catalog**

⇒ **重启后投影可由事件流重建，`subagentCatalog` 不会丢** ⇒ 「族静止」判据跨重启有效。

⚠️ **但同一个实验暴露了 §9.10 判据②的致命缺陷（必须记住）**：
那 25 条 catalog 条目里，**25 条全部没有对应磁盘目录**（子代理一次性跑完即被 GC 回收）。
⇒ 判据②原文「全部 childId 的会话目录 mtime 均静默 N 秒」在**任何时刻都恒真**，
门会**永远**认为「家族静止」⇒ 主判据被架空，等于没有门。
**已按上文修正**（只对「仍有磁盘目录」的条目取 mtime；全幽灵时视为静止并记 diag）。

**M4 —— 结论：赋值点恰好 3 处，无散落。**
`_workbenchParent` 全部写入点：`lib/index.js` L8502（`_verifyWorkbench`）、L8715 与 L8844（均在 `ensureWorkbench`）。
⇒ E1 给 `_workbenchParent` 绑 `epochToken` 只需动这 3 处，**不需要新机制**（复用既有门控 + 退避）。

**M6 —— 结论：子代理父仍挂工作台，既有设计未被破坏。**
catalog 全部 25 条条目都存在于**工作台会话**（`session-89499bd9…`）的投影里，
其中 1 条是 continuable（`session-b0c-mufrk7tt`，label `b0c-probe` —— B0c 实验遗留），
24 条是 one-shot（label 全为 `auto-memory-long-*` / `auto-memory-short-*`）。
⇒ 用户会话 catalog 仍为 0 条。

**M5 —— 仍未测**：本轮不动 `lib/`，无法在活宿主里产生一次「已激活」消息，
须等 E4 实现后真机验证（或先做一次只读的落地形态设计评审）。

**工具教训（跨会话复用）**：`zlib.zstdDecompressSync` 对**多帧 zstd 追加流**只解**第一帧**
（实测 150,279 B 只解出 222 字符，`subagentCatalog` 命中 0 的**假阴性**）。
会话事件流必须按 zstd 帧魔数 `28 B5 2F FD` 切帧后逐帧解压。
`lib/subagent-gc.js:36` 早已踩过这个坑并实现了 `decodeZstdFramesHead` —— **写新探针时照抄它**。

**守卫冲突检查（E1 前必读）**：`lib/subagent-gc.js:309` `purgeSubagentCatalog()` 读写的路径是
`.record.rows.subagentCatalog.val.head.values[].childId` —— 与 E1 的 `workbench.json` 升级
**不同文件、不冲突**；但它印证了「catalog 是只追加列表」这条事实。

---

### 9.9 与既有守卫 / 裁定的冲突检查

1. 守卫 ⑰「无删除调用 + 子代理 GC 不触碰工作台」— **不冲突**（本方案不新增删除）；
2. `smoke-test-workbench-migration.mjs` / `-gaps.mjs` 会读 `workbench.json` 形状与 `ensureWorkbench(` 签名 ⇒ **改结构须同批改守卫**（纪律：抽取器只锚函数名前缀）；
3. 路由计数锁 9 处 ⇒ 若加诊断路由须一次改全 9 处；
4. **D6「轮换只由 `epoch` 驱动」— 不违背**：门是轮换的**内部相位**，不是新的触发源。

### 9.10 用户架构决定（2026-09-25 · **取代 9.5 的 A/B 方案，并简化 9.3**）

**用户原话要点**：①「现在不会有『工作未完成就直接被换下』的流程，流程排好就不会出现」；
②「三个状态没毛病，**把所有子代理都静止的时候，再开始这个流程**」；
③「登记表这个办法是对的，**通过哈希值或者其他的判断**」；
④「**问候和沉淀在这种情况下也可以归为子代理了**」；
⑤「**记忆中枢只在新对话激活的时候回复一句「已激活」，剩下的都由子代理处理**」；
⑥「做梦等等的长期未来规划也不影响」；⑦「子代理有完全权限没问题」。

**决定（本方案从此按此执行）**：

```
工作台会话 = 空壳。全生命周期只有一次活动：新期建立时回一句「已激活」。
之后所有实际工作（问候 / 沉淀 / 蒸馏 / 折行 / 总结 / 未来的「做梦」离线提炼）
一律由子代理承担；工作台不再产生任何 turn。
```

**这条决定消掉的东西（重要，避免重复设计）**：

| 原设计 | 现状 |
|---|---|
| 9.5 的 A/B 两方案（consolidate 挂回用户会话 / 两本账 `lastRealActivityAt`） | **整体作废**。既然工作台只激活一次，就不存在「被问候和沉淀刷新活动」的问题 |
| 9.3 的静默判据 ①（工作台目录 mtime）与 ③（宿主 pending turn） | **降级为参考**。门的**唯一主判据** = **全部子代理静止** |
| 9.8 的 **M1**（consolidate 是否刷新工作台 mtime） | **降级为知情项，不再阻塞设计** |
| 9.8 的 **M2**（能否拿到会话活动查询） | **降级**：判据走磁盘 + inflight，不强依赖官方 activity API |
| 「30 分钟超时」 | **保留但降级为纯防御**：不切换、继续等、记一行 diag。理由：万一有子代理卡死，没有兜底就永远不会轮换 |

**新增：期牌（epoch token）= 用户提的「哈希值」**

登记表里除 `epoch` / `sessionId` 外，增加一个不可伪造的期牌：

```
epochToken = sha256( epoch + '|' + sessionId ).slice(0, 16)
```

- 写入 `workbench.json`；**每个子代理开工前必须拿当前期牌比对**，对不上 ⇒ 判为「旧期 / 未激活」⇒ **拒绝干活**；
- 好处有三：① 一个字段同时编码期号与会话 ② 以后改期号口径不影响判据形式 ③ 归属判据（9.4）从「查两个 id」简化为「比一个 token」。

**子代理的父不变**：仍挂工作台（保持「用户会话零 catalog 条目」这条既有设计）。因为门的判据已不看工作台 activity，父挂谁不再影响轮换。

**门的主判据（新 9.3 主判据）**：

```
族静止 ⟺ ① 插件 _subagentInflight === 0
        ② 【E0/M3 修正】工作台 subagentCatalog 中**在磁盘上仍有目录的** childId，
           其会话目录 mtime 均静默 N 秒
        ③ （可选）宿主侧无 pending turn
```

⚠️ **判据②已于 E0/M3 修正（2026-09-25），原文有缺陷**：原文写「全部 childId 的会话目录 mtime 均静默」，
而实测工作台 catalog **25 条 100% 无磁盘目录**（子代理一次性跑完即被 GC 回收）⇒ 原文**恒真**，
门会永远认为「家族静止」，等于把主判据架空。

修正后的语义：
- **空 catalog**（一条都没有）⇒ 视为静止（真的没有子代理在跑）；
- **有 catalog、但全部条目都无磁盘目录** ⇒ 静止，同时记一行 diag `wb-quiet: ghosts=N`（不阻塞）；
- **有 catalog 且存在「仍有磁盘目录」的条目** ⇒ 取这些目录的 **mtime 最大值** 作为家族活动上界，
  静默 N 秒才判静止。

仍遵守既有纪律：**判据基于磁盘现状，不得用某一时刻的内存快照**（D3 教训）。
跨重启的有效性：**M3 已实测，catalog 是派生缓存、重启后由父会话事件流重建，故本判据跨重启有效**（见 §8 E0 条）。

**新增待测 M5 / M6（取代 M1 的位置）**：

| # | 待测 | 决定什么 |
|---|---|---|
| **M5** | 「已激活」这句的落地形态：发一条真消息（会产生一次 LLM turn）**还是**只写一个标记文件（零成本）？ | 若走真消息，需确认之后工作台确实不再被唤醒；若走标记，则工作台零 turn，连这一句都不花 token |
| **M6** | 子代理是否仍挂在工作台（复核 `_workbenchParent` 的实际取值） | 确认「用户会话零 catalog 条目」未被破坏 |

**已立线**：§6 计划表新增 **E 线 row 30–36**（E0 取证 → E1 数据模型 → E2 归属门 → E3 轮换门 → E4 只激活一次 → E5 期号口径 → E6 收尾）。

---

## §10 归档与删除自持（2026-09-25 用户拍板 · **F 线**）

### 10.1 用户拍板点（原话要点）

1. 「这个归档和删除需要**走我自己的插件里的设置页面**」；
2. 「因为**客户的机器不一定装了这个插件**」（= 不能依赖 `@linxin666/dsh-session-archive`）；
3. 「你可以**照抄 dsh-session-archive 它的相关代码**，因为它是 MIT 协议」。

⇒ **决定**：归档 + 删除从「外挂插件职责」改为**本插件自持**，在**本插件设置页**暴露开关与天数；
`dsh-session-archive` 降级为**可选并存**（装了不冲突，本插件不再依赖它）。这**取代 §9.6 的职责边界**。

### 10.2 ⚠️ 许可证更正（必须按此执行，不得沿用「MIT」表述）

**实测（2026-09-25，`package.json` + `LICENSE` 两份文件）**：

| 项 | 实测值 |
|---|---|
| `package.json` → `license` | **`Apache-2.0`** |
| `LICENSE` 文件首两行 | `Apache License` / `Version 2.0, January 2004` |
| 包内 `NOTICE` 文件 | **不存在** |
| `package.json` → `author` / `repository` / `homepage` | **三字段皆为空** |

**结论不变**（Apache-2.0 与 MIT 同为宽松许可，可抄、可改、可商用、可用于闭源分发），**但义务不同，必须履行**：

- **§4(a)(b)** 须保留版权与许可声明：源码注释 + 本仓 `LICENSE`/`THIRD-PARTY` 说明中写明来源；
- **§4(b)** 修改过的文件须**显著标注「已修改」**；
- **§4(d)** 原包**无 NOTICE 文件** ⇒ 无额外 NOTICE 传递义务；
- `author`/`repo` 皆空 ⇒ **署名只能引用包名与版本**，写法固定为：

```
Portions of this file are derived from @linxin666/dsh-session-archive v0.4.1
(licensed under the Apache License, Version 2.0); modified by dsh-auto-memory.
```

### 10.3 待抄函数清单（实测行号，全部位于该包 `lib/index.js`）

| 行 | 函数 | 用途 |
|---|---|---|
| L943 | `autoArchiveCandidates` | 按**最后活动时间**挑出该归档的会话 |
| L966 | `autoDeleteSeedCandidates` | 按「**已归档 + 记录的归档时间**」挑出该删的 |
| L986 | `descendantsOf` | 取后代（级联删除的族判定） |
| L1010 | `planDelete` | 生成删除计划（**含保护判据**，本线要复用其形状） |
| L1113 / L1124 | `validateDays` / `resolveAutoConfig` | 天数校验（1–3650）与默认值兜底 |
| L1153 | `canonicalSessionId` | 会话目录名 → 会话 id |
| L1156 | `dirSize` | 目录体积（用于「释放空间预览」） |
| L1172 / L1176 | `isInside` / `relativeWithin` | **路径逃逸防护** |
| L1189 | `indexSessionDirs` | 会话目录索引（含 `<sid>` 与 `session-<uuid>` 双命名兼容） |
| L1245–L1292 | `rdbDbPaths` / `isSessionRdb` / `deleteRdbSession` | session-rdb 侧清理 |
| L1294 | `removeSessionDir` | **物理删除**（realpath 校验必须在 `$DSH_HOME/sessions` 内，拒绝逃逸符号链接） |
| L1316–L1336 | `readProjcacheIndex` / `titleFromProjcache` / `readProjcacheFile` | 投影缓存读取（标题与体积） |

配套默认值（同文件 `DEFAULT_AUTO_CONFIG`）：`autoArchiveEnabled:false`、`autoArchiveDays:7`、`autoDeleteEnabled:false`、`autoDeleteDays:7`、`checkIntervalMin:60`（校验下限 15）。
**用户口径的目标值**：`autoArchiveDays = 2`、`autoDeleteDays = 7`，两条 `auto*Enabled` **都要开**。

### 10.4 ★守卫 ⑰ 必须同批改写（本线最大的一处冲突）

⑰ 原文：「**无删除调用** + 子代理 GC 不触碰工作台」。
它把真语义「**不得删除工作台会话**」写成了代理判据「**一条删除调用都不许有**」。
本线新增删除能力 ⇒ **代理判据必然被打破**，但真语义不变。

按既有纪律（删除能力引入时，守卫按「**守的语义未变、对象被有意移除**」处理 + 补**保留面**断言）：

1. **保留真语义**，把 ⑰ 改成**行为断言**：删除入口对工作台会话（`workbench.json` 的 `current` / `previous`）必须**拒绝**；
2. **补保留面**：删除计划必须含「受保护集合」——运行中的会话、当前正在查看的会话、**有运行中子会话的会话**、正在其他归档操作中的会话（四条照抄该包既有口径）；
3. **补路径断言**：删除必须经 `realpath` 且在 `sessions` 根内（照抄 `removeSessionDir` 的既有防护）；
4. **补幂等断言**：无可删项时**完全不写盘**。

**★实测依据（2026-09-25 只读探针，`artifacts/_f4-guard17-probe.mjs`）**——改写不是「为了好看」，而是有硬证据：

| 事实 | 数值 |
| --- | --- |
| 现有 ⑰ 判据 | `smoke-test-workbench-migration.mjs:174` 在 **`ensureWorkbench` 起 6600 字符切片内**匹配 `/agents\.(remove\|delete\|destroy)\|sessionController\.(remove\|delete)\|rmSync\(\|rmdirSync\(\|unlinkSync\(/` |
| 该切片实际范围 | `lib/index.js` **L8699 – L8810** |
| F2 新增删除能力的落点 | `async sessionArchiveSweep` 在 **L9433**（`planDelete` / `removeSessionDir` 亦在其内） |
| 切片内是否命中删除正则 | **false** |

⇒ **⑰ 现在的「PASS」是范围性的运气绿**：它盯的是代理调用（`agents.*`），而本线的删除走 `removeSessionDir`，
且物理位置在切片之外。**真语义（不得删除工作台会话）此刻没有任何断言在守** —— 这正是必须改写的实据。

**改写口径（判据替换而非删除，保留原防的事故不变量）**：
- **保留**原有两条不变量：①轮换不删旧工作台会话目录（`ensureWorkbench` 切片内仍不得出现该切片可及的删除调用）；
  ②子代理 GC 段内不得出现 `workbench`（GC 不得接管工作台）。
- **新增**四条（§10.4 的 1–4），落在**全仓**范围而非切片，从而覆盖 L9433 的新能力：
  ① **行为断言**：删除入口必须把工作台会话（`workbench.json` 的 `current`/`previous`）**拒掉**
     —— 断言 `workbenchSessionIds()` 被用于构造 `protectedReason`，且 `planDelete` 的第三参即该 Map；
  ② **保留面**：受保护集合至少覆盖 `workbench` 与 `live` 两类理由；
  ③ **路径断言**：物理删除必须经 `removeSessionDir(dir, root)`（两个实参都在），根外拒绝由 `removeSessionDir` 内部 realpath 保证；
  ④ **幂等断言**：`plan.targets.length === 0` 时**提前 return**，不写账本（`saveArchiveLedger` 只在该 return 之后调用）。
- **行为级回归**由 `artifacts/_f2-guard-proof.mjs`（**17 通过 0 失败**）承担：它是**真跑**断言，
  比字符串守卫更强，故 ⑰ 的字符串层只需钉住「结构没被绕过」。

### 10.5 职责边界（取代 §9.6）

```
dsh-auto-memory      ：轮换 + 封存 + 归档 + 删除（自持，设置页可配）
host 官方 API        ：归档（archiveSession）—— 仍保留，可作可逆归档
dsh-session-archive  ：可选并存；本插件不再依赖它
```

### 10.6 F 线计划表

| 序 | 任务 | 触及文件 | 依赖 | 状态 |
|---|---|---|---|---|
| **F0** | **取证与授权落地**：抄写范围核对 + Apache-2.0 署名与「已修改」标注就位 | `lib/`、`LICENSE`/`THIRD-PARTY` | — | ☑ **2026-09-25 完成**：12 项函数/行号逐条复核通过；署名与「已修改」标注已写入模块头 |
| **F1** | **移植核心函数**（10.3 表全部）到本插件（建议新模块，勿塞 `index.js`） | 新增 `lib/session-archive.js` | F0 | ☑ **2026-09-25 完成**：19,542 B / 494 行 / PURE LF / `node --check` 绿 / 24 项导出 / 自测 **54 通过 0 失败** |
| **F2** | **接线**：归档 + 删除两条自动策略 + 心跳节流（`checkIntervalMin`） | `lib/index.js` | F1 | ☑ **2026-09-25 完成**：910,900 → **919,857 B**（PURE CRLF 守恒）/ `node --check` 绿 / 备份 `.bak-20260925-192849-f2` / 守卫 ⑰ 行为证明 **17 通过 0 失败** |
| **F3** | **设置页暴露**（本插件设置页，不依赖外部插件）：归档开关/天数、删除开关/天数、释放空间预览 | `lib/client.js` | F2 | ☑ **2026-09-25 完成**：733,202 → **737,231 B**（PURE CRLF 守恒）/ `node --check` 绿 / 备份 `.bak-20260925-193727-f3` / 撞锁测绘**零撞锁** / **[S2] 37 passed 0 failed** |
| **F4** | **守卫 ⑰ 改写**（按 10.4 四条）+ 全量回归 + CHANGELOG | 守卫、`tests/` | F2、F3 | ☑ **2026-09-25 完成**：⑰a/⑰b 保留 + **⑰c1–c4 新增**；**变异红证明 5/5**；**全量回归 179 PASS / 0 FAIL / TIMEOUT 0**；另修 1 处哨兵名碰撞（见 §10.9） |

**依赖关系**：F1–F3 必须在 **E6（E 线收尾）之前**完成——因为守卫 ⑰ 的改写是 E6 的既定项，两条线在这里交汇，**⑰ 只改一次**。

### 10.6.1 F1 实现细化（落地时相对 10.3 的三处有意偏离，均已实测）

1. **保护判据外置**：`planDelete(rows, directIds, protectedReason)` —— 迁移版**不读 `workbench.json`、不认识"工作台会话"**，
   受保护集合由调用方算好注入。理由：让守卫 ⑰ 的「删除入口对工作台会话必须拒绝」落在**可单测的纯函数边界**上，
   而 F2 负责把 `current`/`previous` 填进那个 Map。
2. **`node:sqlite` 延迟取**：来源模块顶层 `import { DatabaseSync } from 'node:sqlite'`；
   迁移版改为 `createRequire(import.meta.url)('node:sqlite')`。理由：本机 node v24.18.0 实测可用，
   但宿主 node 一旦被裁剪掉该内置模块，**静态 import 会让整个插件起不来**；延迟后缺失只表现为"rdb 清理跳过"。
3. **本机无 session-rdb**：实测 `~/.dsh/sessions/sessions.sqlite` 与 `~/.dsh/sessions.sqlite` **皆不存在** ⇒
   `isSessionRdb`/`deleteRdbSession` 必须容错（已做，返回 false 而非抛）。

**一处源码语义边界（如实记录，未"修正"）**：`descendantsOf` 的 docstring 写 "excluding the id itself"，
那是**对无环图的描述**；`childIds` 成环（`z → root`）时自身会被收进结果。迁移版**保持与源码逐字一致的行为**，
只把「防死循环」作为必保不变量（真实数据是树，且 `planDelete` 用 Set 收家族，重复 id 无害）。

### 10.7 重启后的真机核验（2026-09-25 19:0x）

- 用户已重启宿主；`DeepSeek Harness` 进程启动时间 **19:07–19:08**，**晚于**配置改动时间 18:05:43 ✅
- `~/.dsh/dsh-auto-memory.json` 实测 `subagentGcEnabled = false` ✅
- diag 日志最后一条 GC 记录停在 **17:58**（旧进程），重启后**未再出现** ✅
⇒ **GC 停用已生效**（早退点 `lib/index.js` L9299 / L9402，心跳 L13866 立即返回 `{ok:false, reason:'disabled'}`）。

---

### 10.9 F3+F4 落地记录（2026-09-25 · F 线收口）

**F3（设置页暴露）**
- `lib/client.js` **733,202 → 737,231 B**（PURE CRLF 守恒：8,186 → 8,223），`node --check` 绿，备份 `.bak-20260925-193727-f3`。
- **撞锁测绘**（技能 `mem-skill-dsh-auto-memory-ui-…` 的成功判据）：实测 **179 套件 / 45 个读 `client.js`**；
  筛出 4 处相关守卫，逐条判定 **零撞锁**——`s2-settings-panels:102` 只看 `section('key', sectionLabels.key, [` **调用形态**；
  `:117` 的「块行数 100~130」其块边界 = `MARK_START`(engine 内)→`t('gotIt')`，与 `auto` 分区**物理不重叠**；
  `panel-position:42/44` 锁的是 `MemoryTabBody`/`MEMORY_TABS` 调用次数，本批不调用它们。
- 新增 **5 个 field**（纯追加，不删不改既有行）：`sessionArchiveEnabled` / `autoArchiveEnabled` / `autoArchiveDays`(2) /
  `autoDeleteEnabled` / `autoDeleteDays`(7)，落在既有 `auto` 分区末尾。

**F4（守卫 ⑰ 改写 + 全量回归）**
- 改写依据（只读探针 `artifacts/_f4-guard17-probe.mjs`）：旧 ⑰ 仅在 `ensureWorkbench` 起 **6600 字符切片**
  （L8699–L8810）内匹配，而新增删除能力在 **L9433** ⇒ 物理不重叠 ⇒ 旧 PASS 是**范围性运气绿**。
- 改写后：**⑰a/⑰b 保留**（原两条不变量）+ **⑰c1–c4 新增**（§10.4 四条，全仓判定）。
- **变异红证明**（`artifacts/_f4-mutation-proof.cjs`，5 通过 0 失败）：移走「工作台进受保护集合」一行 ⇒ FAIL 计数 0→2、
  ⑰c1/⑰c2 报红；还原后 SHA256 逐字节一致且重新全绿。
- **全量回归：179 PASS / 0 FAIL / TIMEOUT 0（51.0 s）**。

**★哨兵名碰撞（本轮修掉，值得记住）**
首轮全量回归 1 红：`smoke-test-r4-budget-lockup.mjs:154` 用「全仓 `reason:'throttled'` 生产者数 === 0」
钉「记忆预算链路的 throttled 是死分支」。F2 的 `sessionArchiveSweep` 是**另一子系统却撞了同名哨兵**。
**判定：守卫真语义未被打破 ⇒ 改本插件命名、守卫零改动** ⇒ 改为 `reason:'interval-not-elapsed'`。
（教训：跨子系统复用同一 `reason` 字面量会与「全仓计数型」守卫相撞；此类字面量宜带子系统前缀。）

**F 线遗留（非本轮引入）**：`lib/` 下有 ~230 个历史 `.bak-*`，未清理。

- **产出**：`lib/index.js` **910,900 → 919,857 B**（PURE CRLF 守恒：13,908 → 14,075，bareLF 恒 0）；
  `node --check` 绿；备份 `lib/index.js.bak-20260925-192849-f2`；补丁脚本 `.vision-tmp/patch-f2.cjs`
  （`--dry` 已覆盖到最后一条守恒断言才退出）。
- **四点改动**：P1 import（九函数，带 Apache-2.0 署名注释）；P2 六个配置键
  （`sessionArchiveEnabled:true` / `autoArchiveEnabled:true` / `autoArchiveDays:2` /
  `autoDeleteEnabled:true` / `autoDeleteDays:7` / `autoArchiveCheckMin:60`）；
  P3 引擎四方法；P4 心跳挂钩（L13866 同址，按 `checkIntervalMin` 内部节流）。
- **★两处推翻旧记账（重要）**：
  1. **路由数实为 56，不是 55**。证据：`lib/index.js` 内 `'/api/dsh-auto-memory/` 出现 **56** 次；
     `node tests/smoke/smoke-test-context-observer.mjs` 打印 `engine + 19 tools + injection + 56 routes`；
     三处硬锁（`smoke-test.mjs:72` / `smoke-test-m3b3.mjs:45` / `smoke-test-context-observer.mjs:112`）皆为 56。
     本线**未新增路由** ⇒ 9 处计数落点零改动。
  2. **`workspaceRegistry` 不进 `inject` 数组**。本插件 `inject = ['webServer','tools','systemPrompt','subagents','llm']`；
     归档动作只能经 `workspaceRegistry.archiveSession`。**裁定用 `ctx.get('workspaceRegistry')` 机会式获取** ——
     若写进 `inject`，客户机缺该服务时**整个插件都不会加载**；降级应止于「归档不可用」，不得放大。
- **★新增自持件**：`~/.dsh/auto-memory-archive-ledger.json`（归档时间账本）。
  因「归档时间未知 ⇒ **永不自动删除**」是迁移模块的安全默认（§10.6.1 已记），本插件必须自己记归档时刻。
- **★守卫 ⑰ 行为证明**：`artifacts/_f2-guard-proof.mjs` **17 通过 / 0 失败**（临时 `DSH_HOME` 隔离，真实 `~/.dsh` 零接触），
  逐条覆盖 §10.4 四条，且**每条都配了对照**（「非保护会话可删」「根内目录可正常删」「过 3 天不删」）
  以排除「恒拒绝/恒通过」的假绿；并覆盖「工作台会话绝不进归档候选」。
- **守卫复核**：`smoke-test-context-observer.mjs` 与 `smoke-test-m3b3.mjs` 均 exit 0 ✅。

### 10.8 F0+F1 落地记录（2026-09-25 · 与 §8 同源，因紧接 F 线故列于此）

- **F0 取证**：§10.3 的 12 项函数/行号**逐条复核通过**，实际内容与预期一致。
  新增实测：来源模块 import 含 `node:sqlite`（L4）；本机 node **v24.18.0**、`node:sqlite` **可用**；
  本机**不存在** `sessions/sessions.sqlite` 与 `sessions.sqlite` ⇒ rdb 清理必须容错。
- **F1 产出**：新建 `lib/session-archive.js` —— **19,542 B / 494 行 / PURE LF / `node --check` 绿 / 24 项导出**；
  自测 `artifacts/_f1-selftest.mjs` **54 通过 / 0 失败**（纯内存 + 只读，未删任何文件）。
- **自测已覆盖守卫 ⑰ 的核心语义**：`planDelete` 对「直接选中工作台会话」⇒ `targets` 为空且家族不碰；
  对「家族含受保护成员」⇒ **整族跳过、绝不半删**；空输入 ⇒ 零目标零跳过（幂等断言的函数侧）。
- **未接线**：模块此刻**未被 `lib/index.js` import**，宿主行为零变化。
- 两处实现细化与一处源码语义边界见 §10.6.1。
- `lib/index.js` / `lib/client.js` **零改动**；未提交、未推送、未发布。


