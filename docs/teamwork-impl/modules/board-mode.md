
## board-mode

- **规模**：1,746 B / 31 行 / 3 个导出符号
- **交付形态**：**完整版**

### 职责

`board-mode-pre` —— **WB-GRAPH 白板线总开关**（`board_mode_pre_v1`）。裁定来源：WB-GRAPH-DECISIONS-20260914.md §E + 用户 2026-09-16 凌晨原话「一口气全做完，但是线先别着急接。可以先在设置里，或者在接续面板上设置一个按钮，一键切换旧版和新版。」
**设计（硬纪律）**：`boardMode` = `legacy`（默认）| `graph`（新版看板 dsh-graph + sidecar + 遍历工具）；**开关解耦**（用户硬性规则）—— 它只决定"白板线新能力是否激活"，**不顺带改变任何其他功能行为**；legacy 模式下一切行为与 P5 收官时**字节级一致**；`graph_*` 工具与 `memory_expand`/`memory_trace`（P3）仅在 graph 时注册；P2 sidecar 仅在 graph 时写盘；**fail closed**：非法值一律按 legacy（旧行为），绝不猜。

### 数据流

```
配置 cfg.boardMode（原始值，可能非法/缺失）
   │
   ▼
resolveBoardModePre(raw)   L24
   ├─ 'graph'            → { mode:'graph',  graphEnabled:true,  source:'config' }
   ├─ 'legacy' | ''      → { mode:'legacy', graphEnabled:false, source:'config' | 'default' }
   └─ 其他（非法）        → { mode:'legacy', graphEnabled:false, source:'fallback' }   ★ fail closed
        │
        ▼
   调用方按 graphEnabled 决定：
     · 是否注册 graph_* / memory_expand / memory_trace 工具
     · 是否写 wb-sidecar（P2）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L16 | `BOARD_MODE_VERSION` | `board_mode_pre_v1` |
| L17 | `BOARD_MODES_PRE_V1` | 冻结枚举 `['legacy','graph']` |
| L24 | `resolveBoardModePre(raw)` | 解析模式（fail closed） |

### 内部关键实现

**1. fail closed：非法值按 legacy 并留痕 L28-29**

`source:'fallback'` 是**给调用方记 diag 用的信号**（注释逐字："调用方可把 source==='fallback' 记 diag"）。⇒ 非法配置**不会静默变成 graph**（那会激活一整条新能力线），而是退回旧行为并留下痕迹。

**2. 开关解耦是本模块存在的全部理由**

三处"仅在 graph 时"（工具注册 / sidecar 写盘 / 遍历工具）都挂在**同一个** `graphEnabled` 上 ⇒ 单一开关、单点判定。用户硬规则的落地。

**3. 31 行的极简模块**

本模块刻意不做任何业务逻辑，只做**一个解析函数**。⇒ 团队化要加"团队级白板模式"时，必须**新建一个解析层级**而不是在这里加分支（否则会把"个人偏好"与"团队策略"混在一个真源里）。

### 关联行号索引

- lib/board-mode.js:16
- lib/board-mode.js:24
- lib/board-mode.js:17

### 与团队化的关系

**判定：S0 私有（设备/个人级开关）。**

理由：`boardMode` 是**用户个人对新旧白板线的偏好**（"我先用旧版"）。团队化若把它变成团队策略，会导致"团队管理员强制切换后，成员的既有白板行为突变" —— 直接违反本模块的"开关解耦"纪律。团队若有白板格式要求，应当作为**独立的新键**（如 `teamBoardSchema`）而不是复用本键。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| BM1 | `resolveBoardModePre` L24 | 单一真源 | **不改**（保持个人开关语义纯净） | 无 |
| BM2 | 新增 `resolveTeamBoardSyncPre(cfg)` | 无 | **独立**的团队白板同步开关（新键） | 新增导出 |
| BM3 | 团队白板模式默认值 | 无 | 缺省 `'off'` ⇒ 未开启团队版零变化 | 新增 |
| BM4 | `source` 留痕 | 已有 | 团队键沿用同款 fail-closed + source 留痕 | 复用模式 |

#### 可直接落地的代码片段

**片段 1**：独立的团队白板同步开关（新增导出）。位置：`board-mode.js` 文件末尾（`resolveBoardModePre` L24 之后）。

```js
// ★ Teamwork：团队白板同步的**独立开关** —— 刻意不复用 boardMode。
//
// 为什么必须独立（用户硬规则「单一开关不得顺带改变其他功能的行为」）：
//   boardMode 是"用旧版还是新版白板线"的**个人偏好**；
//   团队白板同步是"我的白板要不要进团队"的**治理选择**。
//   两者语义无关：可以"用旧版白板 + 参与团队同步"，也可以"用新版白板 + 个人独用"。
//   若复用同一键，开团队版会连带切换白板线 ⇒ 正是该规则禁止的行为。
export const TEAM_BOARD_SYNC_MODES_PRE_V1 = Object.freeze(['off', 'push', 'push-pull'])

/**
 * 解析团队白板同步模式。**fail closed**：非法/缺省一律 'off'（与 resolveBoardModePre 同款纪律）。
 * @param {string|undefined} raw
 * @returns {{mode:'off'|'push'|'push-pull', enabled:boolean, source:'default'|'config'|'fallback'}}
 */
export function resolveTeamBoardSyncPre(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase()
  if (s === 'push') return { mode: 'push', enabled: true, source: 'config' }
  if (s === 'push-pull') return { mode: 'push-pull', enabled: true, source: 'config' }
  if (s === 'off') return { mode: 'off', enabled: false, source: 'config' }
  if (s === '') return { mode: 'off', enabled: false, source: 'default' }
  // 非法值：退回 off 并**留痕**（调用方应把 source==='fallback' 记 diag）
  return { mode: 'off', enabled: false, source: 'fallback' }
}
```

**片段 2**：把 fallback 留痕接到诊断面。位置：调用侧（宿主），或本模块新增一个纯辅助函数 —— 放在 `board-mode.js` 末尾。

```js
/**
 * 把解析结果的 source 转成诊断行（**统一出口，避免各处自己拼**）。
 * 为什么值得单列：'fallback' 是"用户配置写错了"的唯一信号，
 * 若各处自己判断，容易出现"某个调用点忘了记 diag" ⇒ 配置错误静默生效。
 * @param {{mode:string, enabled:boolean, source:string}} r
 * @param {string} label 开关名（'boardMode' / 'teamBoardSync'）
 * @returns {string|null} null 表示无需记 diag
 */
export function describeBoardSwitchDiagPre(r, label) {
  const x = r || {}
  if (x.source !== 'fallback') return null
  return '[board-mode] ' + String(label || 'switch') + ' 配置值非法，已按 fail-closed 退回缺省（mode=' +
    String(x.mode) + '）'
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **复用 boardMode 承载团队语义** | 图省事把团队开关塞进同一键 | 片段 1 独立键 + 注释说明；违反用户硬规则 |
| **非法值静默变 graph** | 解析逻辑写成"非 legacy 即 graph" | 保持白名单式判定；回归覆盖"非法值 ⇒ legacy + source=fallback" |
| **legacy 模式下行为漂移** | 新增逻辑未按 graphEnabled 门控 | 本模块是唯一判定点；回归断言 legacy 下工具注册与 sidecar 写盘均未发生 |
| **枚举漏加** | 新增模式未同步 `BOARD_MODES_PRE_V1` 同款断言 | 新枚举 `TEAM_BOARD_SYNC_MODES_PRE_V1` 必须配断言 |

**既有测试/守卫**：`board-mode` 的解析用例（三种 source）。本模块被 WB-GRAPH 相关守卫引用；legacy 与 graph 的**行为等价性**很可能有断言（"legacy 下字节级一致"），改动必须保持该性质。
