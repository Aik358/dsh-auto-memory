
## l0-index-sync

- **规模**：11,848 B / 196 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**L0 索引接线**（`l0_index_sync_pre_v1`）—— 三层检索契约 C3。
**背景**：`lib/l0-index.js`（L0 自己的向量索引，增量）**长期零引用** —— 文件在、能力在、就是没人调用它。本模块是它的**接线口**：把「工作区语料里的 L0 摘要」按层增量写成索引文件，供后续语义检索读回向量，而不必每次现场重嵌（S1.3 的增量精神：只重算变化条）。
**文件布局与命名（契约 C3）**：`<dir>/l0-index-<workspaceKey 短哈希>-<layer>.json`
例：`~/.dsh/memory/semantic/l0/l0-index-9f2c1ab34de5-project.json`

### 数据流

```
工作区语料（四类来源 + L0 摘要）
   │
   ▼
createL0IndexSyncPre(opts)   L73   ★ 工厂（IO / 嵌入 / 读文本 全注入）
   ├─ 工厂级配置错误**直接抛**（调用方组装错，不属运行期 fail-soft）L83-89
   │    io.readJson/io.writeJson 必需；embedder.embedPassages 必需
   ├─ engineIdentity / engineIdentityGate / crossIdReuse（**P2 T2-9**）L80-82
   │    "不传身份 ⇒ 索引层不启用身份门（旧行为）"
   ├─ safeDiag(msg)  L91   诊断（截断 200 字符，自身 try/catch）
   ├─ indexPathOf(dir, workspaceKey, layer)  L94
   │    = path.join(dir, l0IndexFileNamePre(workspaceKey, layer))
   └─ sync(...)  L112    ★ 同步一次（**幂等、可重复调用**）
        │
        ▼
   写入 <dir>/l0-index-<wsHash>-<layer>.json
   命名：workspaceKeyShortHashPre(ws, chars)  L51 / l0IndexFileNamePre L57
   L0_INDEX_SYNC_VERSION L40 / L0_INDEX_FILE_PREFIX L43 / L0_INDEX_WS_HASH_CHARS L46
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L40 | `L0_INDEX_SYNC_VERSION` | `l0_index_sync_pre_v1` |
| L43 | `L0_INDEX_FILE_PREFIX` | `l0-index-` |
| L46 | `L0_INDEX_WS_HASH_CHARS` | 工作区短哈希长度 |
| L51 | `workspaceKeyShortHashPre(wsKey, chars)` | 工作区 → 短哈希 |
| L57 | `l0IndexFileNamePre(workspaceKey, layer, chars)` | **文件名派生** |
| L73 | `createL0IndexSyncPre(opts)` | **工厂** |

### 内部关键实现

**1. 为什么按层各一份文件（文件头）**

文件头逐字：*"为什么**按层各一份文件**、而不是「一个工作区一份合并文件」（与任务书的字面表述有偏差，这是**能力边界**而非偷懒，见下）：`l0-index-pre` 的 `buildFull`/`update` 每次调用只接受**单一 layer**（内部是 `buildL0IndexPre(text, { layer })` → 该次调用产出的**全部**条目同层）。"*
⇒ **上游能力边界决定了下游的文件布局**，并**显式说明与任务书字面表述的偏差**（"这是能力边界而非偷懒"）。这是工程诚实性的范例。

**2. 工厂级配置错误直接抛（L83-89）**

注释逐字：*"工厂级配置错误直接抛（调用方组装错，不属运行期 fail-soft 范畴）——与 l0-index-pre 同口径。"*
⇒ **组装错误与运行错误分野**：组装错立刻炸（早暴露），运行期错 fail-soft（不拖垮会话）。

**3. 身份门与跨 id 复用是可选开关（L78-82）**

*"★P2（T2-9）：透传引擎身份与两个开关到索引层（身份门 + 跨 id 复用）。**不传身份 ⇒ 索引层不启用身份门（旧行为）**；宿主接线时传真实宽身份。"*
⇒ **默认关闭、显式开启** 的开关纪律（与团队化所有改造同款）。

**4. 文件名用工作区短哈希而非 slug**

`workspaceKeyShortHashPre` ⇒ 文件系统安全（规避路径字符）+ 稳定。⇒ 团队化时用**同一个哈希**即可让各端文件名一致（**但路径前缀不同**）。

**5. sync 幂等（L112）**

*"同步一次（**幂等、可重复调用**）"* ⇒ 团队化重试安全。

### 与团队化的关系

**判定：S3 派生重算（本地重建）+ S2（可选共享向量文件）。**

理由：索引文件完全可由 L0 + embedding 重建。团队化最有价值的是**共享向量**（省掉昂贵的嵌入计算），但必须过引擎身份门。
**文件命名用工作区短哈希** ⇒ 各端对同一工作区会得到**同名文件** ⇒ 便于团队侧按名归并（但**路径前缀各自不同**，不能直接同步路径）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| LS1 | `l0IndexFileNamePre` L57 | ws 短哈希 + layer | 保持（确定性）；团队文件加 `team` 前缀区分 | 命名扩展 |
| LS2 | `sync` L112 | 本地同步 | 增加团队**只读合并**（不覆盖本地文件） | 新增分支 |
| LS3 | `engineIdentityGate` L81 | 可选 | 团队跨端复用**必须开启**该门 | 前置门 |
| LS4 | `safeDiag` L91 | 本地诊断 | 团队同步失败进 degrade 台账 | 接线 |
| LS5 | 工厂校验 L83-89 | 配置错即抛 | 团队配置缺失时**也归类为组装错**（早暴露） | 纪律 |

#### 可直接落地的代码片段

**片段 1**：团队索引文件命名（**与本地命名空间隔离**）。位置：`l0-index-sync.js:57`（`l0IndexFileNamePre` 内）。

```js
export function l0IndexFileNamePre(workspaceKey, layer, chars = L0_INDEX_WS_HASH_CHARS) {
  const l = LAYER_SET.has(String(layer)) ? String(layer) : 'log'
  return L0_INDEX_FILE_PREFIX + workspaceKeyShortHashPre(workspaceKey, chars) + '-' + l + '.json'
}

/**
 * ★ Teamwork：团队索引文件名 —— **与本地命名空间显式隔离**。
 *
 * 为什么要隔离而不是同目录区分：本地文件与团队文件都由同一个工厂写，
 * 若同目录且命名只差层名，一次"层名写错"就会让团队索引覆盖本地索引
 * （反之亦然）。加一个固定的 team 段后，两族文件名**不可能碰撞**。
 *
 * 注意 workspaceKey 仍用同一套短哈希 ⇒ 各端对同一工作区得到同名文件，
 * 便于团队侧按名归并；但**路径前缀各自不同**（见 dsh-home.js:86 的根口径），
 * 因此**绝不同步路径**，只同步文件内容。
 *
 * @param {string} workspaceKey
 * @param {string} layer
 * @param {string} groupId 团队标识（短、path-safe）
 * @param {number} [chars]
 * @returns {{ok:boolean, name:string|null, error?:string}}
 */
export function teamL0IndexFileNamePre(workspaceKey, layer, groupId, chars = L0_INDEX_WS_HASH_CHARS) {
  const g = String(groupId || '').trim()
  if (!g) return { ok: false, name: null, error: 'empty-group-id' }
  if (g.indexOf('..') >= 0 || /[\\/:*?"<>|]/.test(g)) return { ok: false, name: null, error: 'unsafe-group-id' }
  const l = LAYER_SET.has(String(layer)) ? String(layer) : 'log'
  return {
    ok: true,
    name: 'l0-index-team-' + g + '-' + workspaceKeyShortHashPre(workspaceKey, chars) + '-' + l + '.json',
  }
}
```

**片段 2**：团队同步失败必须进降级台账。位置：`l0-index-sync.js:91`（`safeDiag` 旁新增）。

```js
  /**
   * ★ Teamwork：团队同步失败必须**同时**进本地 diag 与降级台账。
   *
   * 为什么不能只 safeDiag：safeDiag 是"截断 200 字符的本地日志"，
   * 用户看不到；而团队同步失败是**用户必然会感知**的事（"记忆没同步过来"）。
   * degrade.js 的定性正是"fail-soft 本身是对的，缺陷在降级不可见"
   * ⇒ 团队臂必须出现在可查询的健康状态里（degrade.js:65 的 sink）。
   */
  function noteTeamFailure(kind, msg) {
    safeDiag('team-sync ' + String(kind) + ': ' + String(msg))
    try {
      if (opts.degrade && typeof opts.degrade.note === 'function') {
        opts.degrade.note({ arm: 'team', kind: String(kind), reason: String(msg).slice(0, 200), at: Date.now() })
      }
    } catch (_) {}
  }
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队覆盖本地索引** | 命名空间未隔离 | 片段 1 加 team 段，两族名不可能碰撞 |
| **同步路径而非内容** | 直接传 filePath | 片段 1 注释：只同步内容 |
| **跨引擎复用** | 未开身份门 | LS3：团队场景**必须开启** |
| **失败不可见** | 只写本地 diag | 片段 2 同时进 degrade 台账 |
| **组装错被当成运行错** | 团队配置缺失时静默降级 | LS5：归为组装错（早暴露） |

**既有测试/守卫**：`l0-index-sync` 的命名派生用例、sync 幂等用例、工厂校验用例（缺 io/embedder 必须抛）。`l0-index.js` 是它的下游（本模块是"接线口"）。
