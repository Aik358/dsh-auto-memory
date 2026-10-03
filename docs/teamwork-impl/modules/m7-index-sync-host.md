
## m7-index-sync-host

- **规模**：13,950 B / 261 行 / 2 个导出符号
- **交付形态**：**完整版**

### 职责

**M7-8 Host Index Sync Orchestrator**（`docs/PYTHON-SIDECAR-CONTRACT.md` §19.10；修复 live blocker）。
**根因（M7-8 live Phase E 实证，文件头逐字）**：*"M7-1 的 `index_sync` 只实现了 plan/client 层,生产 Host **从未调用** `buildIndexSyncPlansPre`/`sendIndexSyncPlanPre` → Python worker 收不到全库语料,无法建库;`context_push` 的 memoryRefs(top-8 lexical)不足以做语义检索。"*
本模块把授权 corpus snapshot → `index_sync` begin/page/commit 的编排接进 Host。

### 数据流

```
授权 corpus snapshot（loadCorpus(paths) 得到的 M4 CorpusSnapshot）
   │
   ▼
createIndexSyncHostPre(opts)   L32   ★ 编排器
   ├─ **默认关闭零 IO**：四门全开才启用
   │     assoc ∧ bridge ∧ pythonBackend ∧ sink==='python'   enabled(...) L52
   ├─ **输入必须已授权**：绝不自行读文件
   ├─ keyOf(...)  L59   同步身份键
   │     = (workspaceRef, scope, memoryIndexVersion, workerEpoch)
   │     **每个键最多成功同步一次**；worker 重启/epoch 变化 ⇒ 重新同步
   ├─ ensureIndexReady(...)  L80   ★ **核心编排**
   │     ├─ 新 memoryIndexVersion latest-wins；旧 in-flight sync **abort/cancel**
   │     ├─ 同一 workspace 的 Workspace/User plans 按**确定顺序**发送
   │     ├─ 任一失败结构化记录，允许下一有效 Segment 重试
   │     ├─ **绝不向未 ready 的 index 发 context_push**
   │     └─ 禁止每个 Segment 重复全量 sync（成功后缓存 ready identity）
   ├─ ensureWorkspaceIndexReady(...)  L178
   ├─ debugView(...)  L190
   └─ 引擎切换联动：beginEngineSwitchPre L211 / cancelEngineSwitchPre L224
        / getEngineSwitchStatusPre L225 / reportEngineSwitchDone L226
        / setEngineSwitchTotal L227 / publishEngineSwitchReady L228 / failEngineSwitch L229
        requiresFullRebuild L231 / dispose L233 / _generationForTest L255
   M7_INDEX_SYNC_HOST_POLICY_VERSION L29
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L29 | `M7_INDEX_SYNC_HOST_POLICY_VERSION` | 策略版本 |
| L32 | `createIndexSyncHostPre(opts)` | **编排器工厂（唯一入口）** |

**实例方法**：`ensureIndexReady L80`、`ensureWorkspaceIndexReady L178`、`debugView L190`、`dispose L233`，以及 8 个引擎切换联动方法（L211–L229）。

### 内部关键实现

**1. "默认关闭零 IO"（文件头）**

*"默认关闭零 IO(assoc∧bridge∧pythonBackend∧sink='python' 四门全开才启用)"* ⇒ **四门**，比常规双门更严。团队化新增团队同步时也要**再加一门**，不复用这四门。

**2. 输入必须已授权（文件头）**

*"输入必须是 loadCorpus(paths) 得到的已授权 M4 CorpusSnapshot（**绝不自行读文件**）"* ⇒ 与 `index-sync.js:42` 的"JS 是唯一语料授权者"是同一条纪律的两端。

**3. 同步身份键含 workerEpoch（L59）**

`(workspaceRef, scope, memoryIndexVersion, workerEpoch)` ⇒ **worker 重启即重新同步**（因为新 worker 没有旧索引）。⇒ 这是"每个键最多成功同步一次"能安全成立的前提。

**4. "绝不向未 ready 的 index 发 context_push"（文件头）**

⇒ 防止"索引还没建好就推送上下文" ⇒ 会产生**基于空索引或陈旧索引的检索结果**。

**5. 禁止重复全量 sync（文件头）**

*"禁止在每个 Segment 重复全量 sync(成功后缓存 ready identity)"* ⇒ 防止性能退化（每个 Segment 都全量同步会拖垮）。

**6. 引擎切换联动（L211–L229）**

与 `engine-switch.js:39` 配合实现"切档 = 强制全量重建 + 进度条"，且 `requiresFullRebuild` 决定是否重建。

### 与团队化的关系

**判定：S2 团队共享（团队索引同步的编排层）+ S0（四门是本机能力）。**

理由：本模块是"把语料变成索引并让检索可用"的**唯一编排层**。团队化要让"团队记忆也参与语义检索"，就必须在这里接入 —— 且**必须复用同一套编排**（否则会出现"本地索引 ready 而团队索引没 ready"的时序漏洞）。
**关键**：`workerEpoch` 的存在说明"索引与 worker 生命周期绑定" ⇒ 团队索引若由服务端提供，需要**等价的身份键**（不能用 workerEpoch）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| MH1 | `enabled` L52 | 四门 | 团队**再加一门**（不复用 pythonBackend） | 新增门 |
| MH2 | `keyOf` L59 | 含 workerEpoch | 团队同步用**团队索引版本**替代 workerEpoch | 新增键 |
| MH3 | `ensureIndexReady` L80 | 本地编排 | 团队索引复用同一编排（**同 ready 语义**） | 接线 |
| MH4 | ready 门（文件头） | 未 ready 不 push | 团队索引 **同样**未 ready 不 push | 纪律 |
| MH5 | 新增诊断导出 | 无 | 上报同步身份键（诊断"为什么重复同步"） | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：团队同步身份键（**不混入 workerEpoch**）。位置：`m7-index-sync-host.js:59`（`keyOf` 定义处）。

```js
/**
 * 同步身份键 —— **本地键含 workerEpoch，团队键含 teamIndexVersion**，两者不混用。
 *
 * 为什么不复用同一个键：workerEpoch 的语义是"本机 worker 进程代"，
 *   它变化意味着"本机索引全部失效"。而团队索引的失效条件是
 *   **团队侧的索引版本**（服务端重建/成员变更），与本机 worker 无关。
 *   若混用一个键，会出现两种错误：
 *     ① 本机 worker 重启 ⇒ 误判团队索引也失效 ⇒ 全量重拉（浪费带宽）；
 *     ② 团队索引重建 ⇒ 本机不感知 ⇒ **继续用陈旧团队索引**（更严重）。
 *
 * @param {object} o { workspaceRef, scope, memoryIndexVersion, workerEpoch, teamIndexVersion, groupId }
 * @param {{team:boolean}} [opts]
 * @returns {string}
 */
function keyOf(o, opts) {
  const x = o || {}
  const parts = [String(x.workspaceRef || ''), String(x.scope || ''), String(x.memoryIndexVersion || '')]
  if (opts && opts.team) {
    // 团队：用团队侧的索引版本（缺失视为不可同步 —— fail closed）
    parts.push('team:' + String(x.groupId || ''))
    parts.push('tv:' + String(x.teamIndexVersion || ''))
  } else {
    // 本地：保持既有语义（workerEpoch）
    parts.push('we:' + String(x.workerEpoch || ''))
  }
  return parts.join('|')
}
```

**片段 2**：ready 门对团队同样生效。位置：`m7-index-sync-host.js:80`（`ensureIndexReady` 内 push 前置判定处）。

```js
    // ★ Teamwork：团队索引**同样**必须 ready 才允许 context_push。
    //   文件头明文："绝不向未 ready 的 index 发 context_push"。
    //   若对团队索引放宽这条，会产生"基于空团队索引的检索结果"——
    //   模型看到的是"团队里没有相关记忆"，而真相是"索引还没建好"。
    //   这种错误**无法从输出区分**（空结果与无匹配结果长得一样），
    //   因此必须靠结构性门禁而非人工判断来防。
    const readyLocal = isIndexReady(localIdentity)
    const readyTeam = teamEnabled ? isIndexReady(teamIdentity) : true
    if (!readyLocal || !readyTeam) {
      // 如实记录"哪一边没 ready"，便于诊断（degrade 台账）；不静默跳过
      return { ok: false, reason: !readyLocal ? 'local-index-not-ready' : 'team-index-not-ready' }
    }
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队索引未 ready 就 push** | 放宽 ready 门 | 片段 2 结构性门禁；回归覆盖"团队未 ready"负路径 |
| **身份键混用** | 团队用 workerEpoch | 片段 1 分离两种键；注释说明两种误判 |
| **重复全量同步** | 键不稳定 | MH2 + MH5 可观察性 |
| **团队门复用 python 门** | 图省事 | MH1：再加一门（用户铁律：JS/Python 不得联动） |
| **自行读语料** | 团队同步绕开授权 | 文件头纪律：输入必须已授权 |

**既有测试/守卫**：`m7-index-sync-host` 的编排用例（四门 / 身份键 / ready 门 / latest-wins / abort）。本模块与 `index-sync.js:69`、`engine-switch.js:39` 三处联动 ⇒ 改动需联合验证。
