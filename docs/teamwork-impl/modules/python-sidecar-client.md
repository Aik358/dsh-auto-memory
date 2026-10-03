## python-sidecar-client

- **规模**：34,507 B / 630 行 / 2 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**M7-0 JS SidecarClient**。no-shell `spawn` 标准库 Python fake worker；JSONL 单行帧；lazy start（仅在显式启用路径上被调用）。六条纪律：`request()` **永不 reject**（结构化失败，Python 不可用不影响基础对话）；`workerEpoch` 每次启动新 opaque epoch，入站帧 epoch 不匹配即丢弃（fail closed）；帧纪律（partial/multiple JSONL 重组、单行 256KiB 上限）；**四种身份不混用**（requestId/observationId/activationId/syncId）；timeout/AbortSignal/latest-wins/crash recovery/circuit breaker；★#107 看门狗（连续超时达阈值 ⇒ kill 旧进程 + 下次请求重生）。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L63 | `defaultWorkerScriptPathPre(...)` | worker 脚本路径 |
| L76 | `createPythonSidecarClientPre(...)` | 客户端工厂 |

### 数据流

```
调用方（显式启用路径）
   └─ request(req, opts)   ← **永不 reject**
        ├─ lazy start：spawn(no-shell) 标准库 Python worker
        │    └─ 新 workerEpoch（每次进程启动一个新的 opaque epoch）
        ├─ 写 JSONL 单行帧（≤256 KiB，超限 fatal）
        └─ 读回帧
             ├─ partial/multiple JSONL 行**重组**
             ├─ epoch 不匹配 → **丢弃**（fail closed）
             ├─ 坏 JSON / 坏 envelope / 未知 requestId / 重复或过期 response → 计账丢弃
             └─ 按时返回 ok=true
        │
        ▼
   timeout / AbortSignal(cancel) / latest-wins（由上层 M5 bridge 驱动）
   crash recovery / circuit breaker
   ★#107 看门狗：连续超时达阈值 ⇒ **kill 旧进程 + 下次请求重生新进程**
```

### 内部关键实现

**1. 六条纪律（文件头逐字）**

| 纪律 | 内容 |
|---|---|
| 永不 reject | `request()` 结构化失败；Python 不可用**不影响基础对话** |
| workerEpoch | 每次进程启动新 opaque epoch；入站帧 epoch 不匹配即丢弃（fail closed） |
| 帧纪律 | partial/multiple JSONL 重组、单行 256KiB 上限（超限 fatal）、坏 JSON/坏 envelope/错误 epoch/未知 requestId/重复或过期 response **全部计账丢弃，绝不注入上层** |
| 四身份不混用 | requestId(transport) / observationId(M5) / activationId(M6) / syncId(index) |
| 生命周期 | timeout / AbortSignal / latest-wins / crash recovery / circuit breaker |
| 看门狗 #107 | 连续超时（心跳缺失）达阈值 ⇒ kill + 重生 |

**2. 为什么"永不 reject"是硬契约**

若 Python 不可用时抛错，会**向上传播打断基础对话** —— 而 Python 引擎按用户铁律只是"发烧友进阶项"，**它的存亡不得影响主链路**。

### 可直接落地的代码片段

**插入位置**：python-sidecar-client.js:76 附近的 `createPythonSidecarClientPre`。

```js
/**
 * 团队索引同步**必须复用同一个 client**，不得另起一条 Python 通道。
 *
 * 两条理由：
 *   ① 用户铁律：「JS 端与 Python 端是两项相对独立、可互相替换的功能，严禁混为一谈、
 *      严禁互相联动」。团队化不得让"团队版"隐含要求 Python 引擎可用。
 *   ② 单一通道才能保证 epoch / 熔断 / 看门狗（#107）三套保护生效；
 *      另起通道会绕过这些保护，出现"旧 epoch 的过期索引被推到团队"。
 *
 * @param {object} client createPythonSidecarClientPre(...) 的实例
 * @param {object} plan buildIndexSyncPlansPre(...) 的输出
 * @param {{groupId:string, actorId:string}} meta
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function pushTeamIndexPre(client, plan, meta) {
  if (!client || typeof client.request !== 'function') return { ok: false, reason: 'no-client' }
  if (!plan || plan.ok === false) return { ok: false, reason: 'bad-plan' }
  const m = meta || {}
  // 复用既有握手：authorization 携带 groupId，服务端据此决定语料可见范围
  const r = await client.request({
    type: 'team_index_push',
    groupId: String(m.groupId || ''),
    actorId: String(m.actorId || 'local'),
    plans: plan.plans,
  })
  // request() 永不 reject ⇒ 这里只需透传结构化结果
  return (r && r.ok) ? { ok: true } : { ok: false, reason: String((r && r.reason) || 'push-failed') }
}
```

### 关联行号索引

- lib/python-sidecar-client.js:63
- lib/python-sidecar-client.js:76

### 与团队化的关系

**判定：私有（Private）· 设备级进程。**

Python worker 是**本机进程**，它的生命周期、epoch、熔断状态全部是设备本地的。团队化不改变这一点——但**索引内容**（`index_sync`）是会跨端同步的派生数据，那部分由 `index-sync.js` / `m7-index-sync-host.js` 负责。

### Teamwork 改造要点

1. **不得与 JS 语义引擎联动**：用户硬规则「JS 端语义模型 = 默认形态；Python 端 = 发烧友进阶项；两者是两项相对独立、可互相替换的功能，严禁混为一谈、严禁互相联动」。团队化 **不得**让"选了团队版"就强制 Python 引擎可用。
2. **epoch 纪律在团队场景更关键**：worker 重启后旧 in-flight 请求必须被丢弃，否则会把**过期索引**推给团队共享检索。
3. **熔断状态应上报团队诊断**：若某成员 Python 引擎持续熔断，管理员应能在团队面板看到。

### 风险与回归

- 回归：`request()` 永不 reject 是硬契约——团队化不得让它开始抛错。
- 单行 256KiB 上限：超限判 fatal，不得静默截断。
- 四种身份不混用是注释中的显式纪律，改动新增字段时必须沿用既有 ID 体系。
