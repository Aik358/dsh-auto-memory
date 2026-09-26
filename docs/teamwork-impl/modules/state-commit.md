
## state-commit

- **规模**：12,383 B / 246 行 / 12 个导出符号
- **交付形态**：**完整版**

### 职责

**统一状态提交契约**（`state_commit_pre_v1`）—— P1 主体（2026-09-15）。定义一次"状态提交"的**单据形状与校验**：`{ workspaceKey, boardId, txId, expectedDigest?, expectedStateVersion?, actor:{sessionId,contSeq?,kind}, writes:[...], stateChanges?:[...] }`，并派生 `memoryIndexVersion` 与 `boardId`。
**核心性质**：**fail-closed** —— 缺必填字段 / actor 形状非法 / writes 非数组 ⇒ 拒绝，不猜测、不补默认值。

### 数据流

```
提交请求
   │
   ▼
buildStateCommitPre(input)   L153
   ├─ 必填校验：COMMIT_REQUIRED_PRE_V1 L43 = ['workspaceKey','boardId','txId','actor']
   ├─ actor 形状校验（需 { sessionId, kind }）
   ├─ writes 必须是数组
   └─ 失败 ⇒ { ok:false, reason } + describeCommitReasonPre L56 文案
        │
        ▼
   commitConflictPre(...)  L202   冲突判定
   commitReceiptPre(...)   L230   回执
        │
        ▼
派生量：
   boardIdPre(workspaceKey, scope)  L134   ★ **刻意不接收 sessionId**
   memoryIndexVersionPre(projection) L104  MIV_PREFIX_PRE L31 = 'idx_pre_'
        │
        ▼
三种状态的**命名隔离**：MEMORY_STATUS_PRE L38 / TASK_STATE_PRE L39 / ARCHIVE_STATE_PRE L40
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L28 | `STATE_COMMIT_VERSION_PRE` | `state_commit_pre_v1` |
| L31 | `MIV_PREFIX_PRE` | `idx_pre_`（与 shadow-retrieval.js:144 口径一致） |
| L38 | `MEMORY_STATUS_PRE` | `['current','superseded','retracted']` |
| L39 | `TASK_STATE_PRE` | `['open','done','passed']` |
| L40 | `ARCHIVE_STATE_PRE` | `['active','archived']` |
| L43 | `COMMIT_REQUIRED_PRE_V1` | 必填字段 |
| L46 | `COMMIT_REASONS_PRE_V1` | 原因码 → 中文 |
| L56 | `describeCommitReasonPre(code)` | 原因码文案 |
| L104 | `memoryIndexVersionPre(projection)` | 语料版本（确定性） |
| L134 | `boardIdPre(workspaceKey, scope)` | **boardId 派生** |
| L153 | `buildStateCommitPre(input)` | 构造 + 校验单据 |
| L202 | `commitConflictPre(...)` | 冲突判定 |
| L230 | `commitReceiptPre(...)` | 回执 |

### 内部关键实现

**1. 三种状态"不得互转"（L33-40）**

注释逐字：*"三种状态的**命名隔离**（卡内要求"三种状态不能混"）。三者**不得互转**：记忆有效状态是"条目还算不算数"，任务进度是"活干完没有"，归档位置是"东西放哪儿"。`archived` 一词两义的问题以独立常量解决，**映射由白板线适配器负责**。"*
⇒ 三个枚举 + "映射归适配器"是**防止语义串线**的设计。

**2. boardIdPre 从签名上杜绝 sessionId（L128-133）**

注释逐字：*"⚠️ 入参**只接受 workspaceKey 与 scope**。刻意不接收 sessionId/agent 对象 —— **从签名上就杜绝"顺手把会话号掺进去"这个错误**。"*
⇒ 这是"用类型/签名约束正确性"的范例：板 ID 必须**工作区内稳定**，否则同一块板在不同会话里会变成两块。

**3. fail-closed（L148）**

注释逐字：*"**fail-closed**：缺必填字段 / actor 形状非法 / writes 非数组 ⇒ `{ok:false}`，不猜测、不补默认值。"*

**4. 向后兼容（L150-151）**

*"`expectedStateVersion` 与 `expectedDigest` 均为**可选**；不传时下游行为必须与本契约引入前**逐字节一致**（该校验由调用方在队列内执行）。"*
⇒ **新增可选字段不得改变老调用路径行为** —— 团队化必须沿用这条。

**5. miv 口径复用（L30）**

`MIV_PREFIX_PRE = 'idx_pre_'` 注释：*"与 `shadow-retrieval.js:144` 既有口径一致"* ⇒ 又一处"单一真源"。

### 与团队化的关系

**判定：S2 团队共享（提交契约必须全队一致）+ S3 派生重算（boardId / miv）。**

理由：`boardId` 是"同一块白板"的**团队级身份**。若两端对同一 workspaceKey 算出不同 boardId，团队白板会分裂成两块。
**关键**：`boardIdPre` 只依赖 `workspaceKey + scope` ⇒ **天然可跨端复现**（只要 workspaceKey 的口径一致，见 `evidence-store.js:29 canonicalWorkspaceKey`）。这正是团队化能复用它作为共享身份的原因。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| SC1 | `COMMIT_REQUIRED_PRE_V1` L43 | 四必填 | 团队提交**增加 groupId**（但不得改既有四项语义） | 枚举新增 |
| SC2 | `buildStateCommitPre` L153 | 本地校验 | 团队模式多校验 groupId；缺则拒（fail closed） | 新增分支 |
| SC3 | `boardIdPre` L134 | 不含 sessionId | **不改签名**（正确性关键）；团队靠 workspaceKey 对齐 | 无 |
| SC4 | `COMMIT_REASONS_PRE_V1` L46 | 本地原因码 | 新增 `'team-group-missing'` 等原因码 | 枚举新增 |
| SC5 | 新增 `commitReceiptForTeamPre` | 无 | 回执带 groupId + actorId，供团队审计 | 新增导出 |
| SC6 | `memoryIndexVersionPre` L104 | 本地语料版本 | 团队模式下应基于**合并后语料**重算（各端各自算，不传值） | 调用侧 |

#### 可直接落地的代码片段

**片段 1**：团队提交的 groupId 校验（新增导出 + 接入点说明）。位置：`state-commit.js` 文件末尾新增，调用点在 `buildStateCommitPre`（L153）内。

```js
/**
 * 团队提交的 groupId 校验 —— 独立函数，便于单测与复用。
 *
 * 为什么要独立而不是内联进 buildStateCommitPre：
 *   ① buildStateCommitPre 是**向后兼容关键路径**（L150-151 明文要求"不传时逐字节一致"），
 *      在其内部加分支会提高打红既有守卫的风险；
 *   ② 团队校验是**可选的前置门**，放外面可以让"非团队路径"完全不经过它。
 *
 * fail closed：团队提交缺 groupId ⇒ 拒绝（不猜"大概是默认组"）。
 *
 * @param {object} input 提交单据
 * @param {{teamMode?:boolean}} [opts]
 * @returns {{ok:boolean, reason?:string, detail?:string}}
 */
export function assertTeamCommitShapePre(input, opts) {
  const o = input && typeof input === 'object' ? input : {}
  const teamMode = !!(opts && opts.teamMode)
  if (!teamMode) return { ok: true }   // 非团队路径：完全不介入，零影响
  const g = String(o.groupId || '').trim()
  if (!g) {
    return { ok: false, reason: 'team-group-missing', detail: '团队提交必须携带 groupId' }
  }
  // groupId 会进入团队路由与路径拼装 ⇒ 必须 path-safe（与 datadir 同款校验）
  if (g.indexOf('..') >= 0 || /[\\/:*?"<>|]/.test(g)) {
    return { ok: false, reason: 'team-group-unsafe', detail: 'groupId 含非法字符' }
  }
  return { ok: true }
}
```

**片段 2**：接入 `buildStateCommitPre`。位置：`state-commit.js:153`（函数体开头，`const o = ...` 之后）。

```js
export function buildStateCommitPre(input) {
  const o = input && typeof input === 'object' ? input : null
  if (!o) return { ok: false, reason: 'not-object', detail: describeCommitReasonPre('not-object') }

  // ★ Teamwork：团队前置门（**可选**，由 opts.teamMode 打开）。
  //   放在最前面：团队单据形状不合法时，不应继续走后续的本地字段校验
  //   —— 否则错误码会指向"缺 txId"这类无关字段，掩盖真正的问题（缺 groupId）。
  const teamCheck = assertTeamCommitShapePre(o, { teamMode: o.teamMode === true })
  if (!teamCheck.ok) {
    return { ok: false, reason: teamCheck.reason, detail: teamCheck.detail || describeCommitReasonPre(teamCheck.reason) }
  }

  const missing = []
  // ...原有逻辑不变（workspaceKey / boardId / txId / actor / writes 校验）...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **破坏向后兼容** | 在 buildStateCommitPre 内强行要求 groupId | 片段 1 的 teamMode 门**缺省 false** ⇒ 老路径零影响；回归断言"不传 teamMode 时输出逐字节一致" |
| **boardId 掺入会话** | 有人为团队改签名 | L128-133 明文"从签名上杜绝"；改签名会打红守卫 |
| **三状态互转** | 用 archived 同时表示记忆与归档 | L33-40 三个独立枚举 + 映射归适配器 |
| **groupId 非 path-safe** | 含分隔符 | 片段 1 校验；参照 datadir 同款判据 |
| **miv 口径分叉** | 团队另写一份 idx 前缀 | L30 与 shadow-retrieval.js:144 同源 |

**既有测试/守卫**：`state-commit` 的单据校验用例（含 fail-closed 负路径、向后兼容断言）。本模块与 `boardIdPre` 的**签名稳定性**很可能是守卫断言对象（注释明确说明"刻意不接收"）。
