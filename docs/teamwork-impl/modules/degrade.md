## degrade

- **规模**：18,339 B / 386 行 / 14 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**降级留痕层**（R3）。全仓普查发现 70 处 `catch` 只写 diag 不抛出，其中 10 处自述"降级/回退/中性"；检索链上**四条臂各自独立降级、各自静默** ⇒ 可同时失效而使用者只感到"检索不太对"。本模块不消灭降级，而是让"**哪条臂没在工作**"从推断变成**可查询的状态**。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L33 | `DEGRADE_SCHEMA_PRE_V1` | schema 版本 |
| L36 | `DEGRADE_CAP_PRE_V1` | 台账条数上限 |
| L49 | `ARM_STATES_PRE_V1` | 臂状态枚举 |
| L52 | `DEGRADE_KINDS_PRE_V1` | 降级种类枚举 |
| L65 | `createDegradeSinkPre(...)` | 降级汇（记录） |
| L131 | `deriveArmsHealthPre(...)` | 由台账推导各臂健康 |
| L159 | `persistDegradeLedgerPre(...)` | 台账落盘 |
| L195 | `QUOTA_PROBE_SCHEMA_PRE_V1` | 配额探针 schema |
| L207 | `QUOTA_VERDICTS_PRE_V1` | 配额裁定枚举 |
| L229 | `createQuotaProbePre(...)` | 配额探针 |
| L307 | `deriveQuotaVerdictPre(...)` | 配额裁定 |

### 数据流

```
检索链四条臂（semantic / python / lexical / time）各自 fail-soft
        │ 每次降级
        ▼
  createDegradeSinkPre(...)   L65   ← 记录 {arm, kind, reason, at}
        │  （有界：DEGRADE_CAP_PRE_V1 L36；reason 截断：L39）
        ▼
  persistDegradeLedgerPre(...)  L159  →  ~/.dsh/memory/degrade-ledger.json
        │
        ▼
  deriveArmsHealthPre(...)  L131   ← **把"哪些臂没在工作"变成可查询状态**
        │
        ▼
  诊断面 / 面板

配额探针（另一条线）：
  createQuotaProbePre(...)  L229 → deriveQuotaVerdictPre(...)  L307
     QUOTA_VERDICTS_PRE_V1 L207 / QUOTA_THRESHOLDS_PRE_V1 L210
```

### 内部关键实现

**1. 定性："fail-soft 本身是对的，缺陷在降级不可见"（文件头）**

全仓普查：70 处 `catch` 只写 diag 不抛出，其中 **10 处自述为"降级/回退/中性"**。检索链上**四条臂各自独立降级、各自静默** ⇒ 可**同时失效**而使用者只感到"检索不太对"。

**2. 实证案例（R2）**

evidence 读侧误判目录缺失 ⇒ **importance 加权对某类用户出厂即死**，而表现只是每次 recall 写一行 diag。⇒ 若没有本模块，这个缺陷可以长期存在而不被发现。

**3. 有界 + 截断**

`DEGRADE_CAP_PRE_V1` 限制台账条数、`DEGRADE_REASON_MAX_PRE_V1`（L39）限制单条 reason 长度 ⇒ 防止降级风暴把磁盘写满。

### 可直接落地的代码片段

**插入位置**：degrade.js:65 附近的 `createDegradeSinkPre`。

```js
/**
 * 团队同步臂 —— 接入既有的降级台账，**不另建一套健康判定**。
 *
 * 为什么：本模块的定性就是"fail-soft 是对的，缺陷在降级不可见"。
 * 团队同步是最可能静默失效的新增臂（网络抖动、令牌过期、服务端限流），
 * 若不上报，用户只会感到"记忆好像没同步过来"，与 R2 事故的表现完全一致。
 *
 * @param {object} sink createDegradeSinkPre(...) 的实例
 * @param {{kind:string, reason?:string, at?:number}} e
 * @returns {{ok:boolean}}
 */
export function noteTeamSyncDegradePre(sink, e) {
  if (!sink || typeof sink.note !== 'function') return { ok: false }
  const x = e || {}
  // arm 名固定 'team'：与既有 semantic/python/lexical/time 四臂并列，
  // 这样 deriveArmsHealthPre 无需改动就能把团队臂纳入健康推导。
  return sink.note({
    arm: 'team',
    kind: String(x.kind || 'unknown'),
    reason: String(x.reason || '').slice(0, 200),
    at: Number(x.at) || Date.now(),
  })
}
```

### 关联行号索引

- lib/degrade.js:65
- lib/degrade.js:131
- lib/degrade.js:159

### 与团队化的关系

**判定：派生重算（Derived）· 本地诊断。**

降级状态是**本机的健康状况**（"我的证据目录读不到"），同步它没有意义，但**团队需要聚合视图**：管理员应能看到"3 个成员的语义臂全部降级" ⇒ 这是团队配置问题。⇒ 只上报摘要，不同步原始台账。

### Teamwork 改造要点

1. **新增团队臂**：多一条 `team` 臂（同步可用/不可用、上次成功时间），复用 `createDegradeSinkPre` ⇒ 团队成员立刻能看到"同步没在工作"而不是"记忆好像不太对"。
2. **团队诊断卡片直接消费 `deriveArmsHealthPre`**：不要另写一份健康判定（本仓已多次因"同一语义两处实现"进入半修状态）。
3. **配额探针在团队场景下要先量后控**：团队成员多、同步量大，`QUOTA_*` 的阈值需要按 groupSize 调整——但按用户既有纪律，**先只记录不加权**（同 `recall-stats` 的分步走原则）。

### 风险与回归

- 回归：`ARM_STATES_PRE_V1` / `DEGRADE_KINDS_PRE_V1` 是封闭枚举，新增成员必须同步测试断言（字符串枚举写错编译器不报错、静默忽略）。
- 台账有 `DEGRADE_CAP_PRE_V1` 上限——新增团队臂不得挤掉既有臂的配额。
