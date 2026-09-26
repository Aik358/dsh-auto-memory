
## shadow-host

- **文件**：`lib/shadow-host.js`
- **规模**：20,281 B / 400 行 / 2 个导出符号
- **职责一句话**：**M4-3 Host Shadow Wiring** —— 把 M4-1 纯核心接到宿主的**并行观察**链路上（`docs/M4-CONTRACT.md` §5/§14/§15/§17）。

> ## 铁律适用声明（本节优先于全文其他表述）
>
> **JS 端语义模型 = 默认形态；Python 端 = 发烧友进阶项。两者是两项相对独立、可互相替换的功能，严禁互相联动。**
>
> **本模块与主检索的关系（源码 L4-L11 逐字核实）**：*"桥接 `lib/index.js`(M2 ContextObserver / M3 sidecar) 与 M4-1 纯核心 …… **默认关闭**：三开关任一为 false 时**零构造、零 IO、零留存**。"*
> ⇒ **影子链路是「并行观察」**：它**只记录**自己的审计与状态，**不改变**主检索的返回值；**也不是任何一端的前置依赖**。
> **术语辨析（关键）**：本模块 L4 的 "M3 sidecar"、L71 的 `sidecarDir`、L190 的 `sidecar` 全部指 **M3b 记忆文件 sidecar**（`memory-anchor.js:258` 的产物），**与 Python worker 无关**。脚本的命中属同名词。

### 术语辨析（**本模块第二个易误读点**）

| 术语 | 出现位置 | 实际含义 |
|---|---|---|
| "M3 sidecar" | L4 | **M3b 记忆文件 sidecar**（本地派生索引文件） |
| `sidecarDir` | L71 | `<dshHome>/memory/index/files` —— 本机目录 |
| `sidecar`（retention 语境） | L190 | 同上；retention **不动**它（只清 audit 分片） |
| "Python sidecar" / sidecar worker | **本文件不出现** | Python worker 进程（`python-sidecar-client.js:76`） |

⇒ **本模块与 Python 完全无关**。

### 数据流（M4-3 Host 接线：从 Segment 到审计落盘）

**定位（源码 L2-L4 原文）**：本模块**桥接** `lib/index.js`（M2 ContextObserver / M3 sidecar）与 **M4-1 纯核心**。

| 阶段 | 内容 | 同步/异步 |
|---|---|---|
| **① 触发** | `lib/index.js` 采到 **accepted Segment**（上下文观察器判定为可用的一段） | 同步 |
| **② 快照** | **同步捕获 paths 快照**（保证后续异步处理看到的是同一时刻的输入） | **同步** |
| **③ 调度** | **异步 latest-wins 调度**：`gate → corpus → lexical → audit` 四步流水 | 异步（latest-wins：新任务到达时旧任务作废） |
| **④ 状态** | per-runtime Shadow state：**`WeakMap` + lazy**；字段含 `enableEpoch` / `completedKeys` / `recentHits` / `cooldown` / `latch` | — |
| **⑤ 落盘（durable audit）** | `<DSH_HOME>/memory/retrieval-pre/audit/YYYY-MM-DD.jsonl` —— **engine 级串行**、**32 KiB 截断**、保留期 **14 天 / 32 MiB** | 异步 |
| **⑥ 观测** | `debugView`（``17` 最小投影）；**关闭时严格 `{enabled:false}`** | — |

**★ 隐私投影（本模块最该被团队化继承的设计）**：审计事件明确**无原文 / 无绝对路径 / 无 sessionId**，`term` **只存 digest**。
⇒ 这是**已经做对的隐私边界**，团队化**必须原样保留**（见 `团队化关系）。

**★ 默认关闭的三重门（L17 原文）**：
> 默认关闭：**三开关任一为 false 时零构造、零 IO、零留存。**

⇒ 这是**现成的"团队化开关"范式**：团队模式**不应**把本模块从"默认关闭"改成"默认开启"——要保持**用户显式开启才产生 IO**。

**★ 为什么"同步快照 + 异步处理"这个组合重要**：
若在异步阶段才去读磁盘，输入的 paths 可能**已经被改**（TOCTOU）。
⇒ 本模块**先在同步阶段固定输入快照**，再进异步流水——**这是正确的顺序**，团队化新增任何异步步骤都必须沿用。


### 逐段精读（带真实行号）

**L1-L11 · 文件头：四条核心行为**

- **L4**：*"桥接 `lib/index.js`(M2 ContextObserver / M3 sidecar) 与 M4-1 纯核心"*
- **L5-L6**：*"**per-runtime Shadow state**（WeakMap，lazy；enableEpoch / completedKeys / recentHits / cooldown / latch）"*
- **L6**：*"accepted Segment → **同步捕获 paths 快照** → **异步 latest-wins 调度**（gate → corpus → lexical → audit）"*
- **L6-L8**：*"durable audit：`<DSH_HOME>/memory/retrieval/audit/YYYY-MM-DD.jsonl`（engine 级串行，32KiB 截断，**隐私投影：无原文 / 无绝对路径 / 无 sessionId / term 只存 digest**）+ retention（14 天 / 32MiB）"*
- **L9**：*"debugView（§17 最小投影；关闭时严格 `{enabled:false}`）"*
- **L10-L11**：*"**默认关闭**：三开关任一为 false 时**零构造、零 IO、零留存**"*

**L31 / L67 / L71 / L190 · 四个关键点**

| 行号 | 符号/位置 | 说明 |
|---|---|---|
| L31 | `truncateAuditEvent(ev, limit)` | 审计单条截断（32KiB） |
| L67 | `createShadowHost(opts)` | **唯一入口**（per-runtime state + 调度 + audit + debugView） |
| L71 | `sidecarDir` | `memory/index/files` ⇒ **M3b sidecar 目录**，纯本地、与 Python 无关 |
| L190 | retention | *"只清 audit 分片，**不动 Markdown/sidecar**"* ⇒ 再次确认 sidecar = M3b 本地文件 |

### 对外接口（导出符号表）

| 行号 | 符号 | 类型 | 说明 |
|---|---|---|---|
| L31 | `truncateAuditEvent` | function | 审计事件截断 |
| L67 | `createShadowHost` | function（工厂） | **Host 入口** |

### 与团队化的关系

**判定：S0 私有（Shadow state 是 runtime 级）+ S2（审计面可共享，因已脱敏）。**

理由：Shadow state（enableEpoch / completedKeys / recentHits / cooldown / latch）是**每 runtime** 的 ⇒ 天然本机。
**审计面可共享**：隐私投影已剥离原文 / 绝对路径 / sessionId（L6-L8，term 只存 digest）⇒ 团队可用它做检索质量分析。
**铁律约束（正面）**：影子链路是**并行观察**，团队化**不得**让它成为"团队功能生效"的前置条件，也**不得**让它改变主检索返回值。

### Teamwork 改造点（附可直接复制的代码）

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| SH1 | L10-L11 三开关 | 默认关闭零副作用 | 团队**再加一门**（不复用既有三开关） | 新增门 |
| SH2 | L6 同步快照 | paths 快照 | 团队相关状态**同样先快照后异步** | 纪律 |
| SH3 | `truncateAuditEvent` L31 | 32KiB 截断 | 团队审计**沿用同一截断**（只能更严） | 纪律 |
| SH4 | L190 retention | 14 天 / 32MiB | 团队审计**独立 retention**（不挤占本地） | 新增配置 |
| SH5 | L9 debugView | 关闭时严格 `{enabled:false}` | 团队模式**不得**放宽该严格性 | 纪律 |
| SH6 | L4 术语 | "M3 sidecar" 易误读 | **注明"M3b 记忆文件 sidecar（非 Python）"** | 注释 |

#### 片段 1：术语歧义消解 + 团队门。位置：`shadow-host.js:10`（文件头 L10-L11 附近）

```js
 * 术语说明（团队化补充）：本文所有 sidecar 均指 **M3b 记忆文件 sidecar**
 *   （memory-anchor.js:258 buildSidecarPre 的产物，与 Markdown 同目录的派生索引）；
 *   不是 Python worker（那由 python-sidecar-client.js:76 管理）。
 *   两者同名不同物，团队化改造时不要把本模块的 sidecar 概念与 Python 通道混为一谈。
 *
 * 团队化门：新增一门 teamShadowEnabled，不复用下面三开关。
 *   理由（用户硬规则「单一开关不得顺带改变其他功能的行为」）：
 *   本模块三开关控制的是"本机影子观察"；团队影子共享是对外动作，语义不同。
 *   复用同一开关会导致"开启团队共享就顺带打开本地影子审计"。
 *   默认关闭：三开关任一 false 或 teamShadowEnabled 未显式开启，都保持零构造、零 IO、零留存。
```

#### 片段 2：团队审计（**独立 retention + 沿用同一脱敏与截断**）。位置：`shadow-host.js:67`（`createShadowHost` 内）

```js
  /**
   * Teamwork：团队可见的审计事件 —— 复用同一脱敏与截断，只换落点与保留期。
   *
   * 三条纪律：
   *   ① 脱敏不能另写 —— L6-L8 的隐私投影（无原文 / 无绝对路径 / 无 sessionId /
   *      term 只存 digest）是审计面能被共享的唯一原因。另写一份更宽松的脱敏
   *      等于把原文/路径泄进团队库（对照 m4-corpus.js:59 的 symlink 逃逸风险）。
   *   ② 沿用 truncateAuditEvent L31 —— 32KiB 截断防单条撑爆；
   *      团队通道带宽更紧，截断只能更严、不能更松。
   *   ③ 独立 retention —— 团队审计量是 N 倍（N 名成员），
   *      共用 14 天/32MiB（L190）会让本地审计被挤掉。
   *      注意：无论本地还是团队 retention，都只清 audit 分片，不动 Markdown/sidecar（L190 明文）。
   *
   * @param {object} ev 已脱敏的审计事件（必须已过本地脱敏流水线）
   * @returns {{ok:boolean, reason?:string}}
   */
  function writeTeamAuditPre(ev) {
    if (!opts.team || opts.team.enabled !== true) return { ok: true, reason: 'team-disabled' }
    try {
      // ② 沿用既有截断（不新写截断逻辑）
      const safe = truncateAuditEvent(ev, 32 * 1024)
      opts.team.stage({ v: 1, entity: 'shadow-audit', groupId: opts.team.groupId,
                        actorId: opts.team.actorId || 'local', op: 'append', payload: safe, at: Date.now() })
      return { ok: true }
    } catch (e) {
      // 审计失败不得影响主流程（fail-soft），但必须留痕
      if (typeof opts.onError === 'function') {
        try { opts.onError('shadow-host:team-audit', String(e && e.message)) } catch (_) {}
      }
      return { ok: false, reason: 'stage-threw' }
    }
  }
```

#### 片段 3：同步快照纪律。位置：`shadow-host.js:67`（accepted Segment 处理处）

```js
    // Teamwork：团队相关状态同样必须先同步快照、再异步处理。
    //   原因（文件头 L6 既有纪律）：异步执行时，路径/状态可能已被后续 Segment 改变。
    //   团队场景下这个窗口更长（涉及网络往返），若异步阶段才去读 opts.team，
    //   可能读到"已经被下一次同步改过的"版本，导致审计与决策对应错位。
    const teamSnap = (opts.team && opts.team.enabled === true)
      ? { groupId: String(opts.team.groupId || ''), actorId: String(opts.team.actorId || 'local'),
          indexVersion: String(opts.team.indexVersion || '') }
      : null
    // ...异步调度（gate -> corpus -> lexical -> audit）里只用 teamSnap，不再读 opts.team...
```

### 风险与守卫

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **sidecar 术语被读成 Python** | L4 / L71 / L190 出现 sidecar | 术语辨析表 + 片段 1 |
| **影子链路成为前置依赖** | 主检索等影子就绪 | 铁律 + L10-L11（默认关闭零副作用） |
| **脱敏被另写** | 团队审计走独立脱敏 | 片段 2 强制复用 |
| **异步读到污染状态** | 网络往返期间状态被改 | 片段 3 先快照 |
| **团队审计挤掉本地** | 共用 retention | SH4 独立 retention（且只清 audit） |
| **debugView 泄露** | 团队模式放宽严格性 | SH5：关闭时严格 `{enabled:false}` |

**既有守卫**：`shadow-host` 的 state 隔离用例、latest-wins 调度用例、隐私投影用例（断言无原文 / 无绝对路径）、默认关闭零副作用用例。**"三开关任一 false 则零构造零 IO 零留存"（L10-L11）很可能被断言**。
**建议补的铁律守卫**：断言"影子链路关闭时，主检索结果与开启时逐字节相同" —— 把"并行观察、不影响模型行为"钉成可验证事实。
