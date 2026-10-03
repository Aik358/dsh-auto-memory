
## context-sink-python

- **规模**：4,272 B / 91 行 / 2 个导出符号
- **交付形态**：**完整版**

### 职责

**M7-0/M7-1 `PythonContextSinkPre`**（`docs/PYTHON-SIDECAR-CONTRACT.md` §5.2/§8.2/§13.1）。
实现 M5 `ContextSinkPre` 接口：消费现有 `ContextPushEnvelopePre` **原样字段（零 schema 改动）**，在 `deadlineAt` 预算内返回兼容 `ContextAckPre`；worker 主动推送的 `activation_request` 帧经 `onActivation` 上抛（交给现有 M6 validator/inbox 路径，**本模块不构建 Packet**）。
**失败映射为结构化 `ContextAckPre`（`accepted:false` + reason 枚举）；异常绝不冒泡到基础对话。**
**本模块不 spawn**：进程生命周期完全属于共享的 `SidecarClient`。

### 数据流

```
宿主 context_push
   │
   ▼
createPythonContextSinkPre(opts)   L29   ★ 唯一入口
   ├─ kind = PYTHON_CONTEXT_SINK_KIND_PRE('python')  L12
   ├─ 消费 ContextPushEnvelopePre **原样字段**（零 schema 改动）
   ├─ 在 deadlineAt 预算内请求 worker
   │    └─ 失败 ⇒ { accepted:false, reason:<枚举> }  ★ **结构化，不抛**
   ├─ 返回兼容 ContextAckPre（校验 context-bridge.validateContextAckPre L399）
   │    └─ 与 observation 匹配 m7-wire.ackMatchesObservationPre L258
   └─ worker 主动帧 activation_request ⇒ onActivation 上抛
        （交给 M6 validator/inbox；**本模块不构建 Packet**）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L12 | `PYTHON_CONTEXT_SINK_KIND_PRE` | `'python'` |
| L29 | `createPythonContextSinkPre(opts)` | **工厂（唯一入口）** |

**依赖**：`context-bridge.js` 的 `validateContextAckPre`（L399）；`m7-wire.js` 的 `ackMatchesObservationPre`（L258）。

### 内部关键实现

**1. 零 schema 改动（文件头）**

文件头逐字：*"消费现有 `ContextPushEnvelopePre` **原样字段（零 schema 改动）**"* ⇒ 本模块是**纯适配器**：不改契约、不新增字段。团队化新增字段必须改**上游契约**（`context-bridge.js:426 buildContextPushEnvelopePre`），不能在这里偷偷加。

**2. 异常绝不冒泡（文件头）**

*"失败映射为结构化 `ContextAckPre`（`accepted:false` + reason 枚举）；**异常绝不冒泡到基础对话**。"*
⇒ 与 `python-sidecar-client.js:76` 的"`request()` 永不 reject"是**同一纪律的两层**：client 层不 reject，sink 层不冒泡。⇒ Python 不可用**不影响基础对话**。

**3. 不 spawn（文件头）**

*"本模块不 spawn：进程生命周期完全属于共享的 `SidecarClient`。"* ⇒ **单一进程所有者**，避免多路径 spawn 出多个 worker（团队化会提高并发，多 worker 会争抢模型）。

**4. 只上抛不构建（文件头）**

`activation_request` 帧**上抛**给 M6 路径 ⇒ **职责边界**：sink 只做传输，不做激活语义。⇒ 团队化不得在 sink 层插入激活判定。

**5. ACK 与 observation 匹配（L258）**

`ackMatchesObservationPre` 校验 ACK 与 observation 对应 ⇒ 防止"张冠李戴的回执"。

### 与团队化的关系

**判定：S0 私有（本机 Python 通道适配器）。**

理由：Python worker 是**本机进程**（见 `python-setup.js:62` 的 venv/模型安装），其通道自然是设备级。
**但它的产物（团队索引）是共享的** —— 那部分走 `index-sync.js:69` / `m7-index-sync-host.js:32`，与本模块无关。
**纪律**：团队化**不得**让本模块承担团队推送职责（否则会把"团队同步"绑进"Python 可用性"，违反用户铁律"JS 端与 Python 端是两项相对独立、可互相替换的功能，严禁联动"）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| CS1 | `createPythonContextSinkPre` L29 | 本地推送 | **不改职责**（团队推送走 index-sync） | 纪律 |
| CS2 | 失败 reason 枚举 | 本地枚举 | 团队相关失败（如有）必须**复用同一枚举** | 兼容 |
| CS3 | `kind` L12 | `'python'` | 保持（团队不要新 kind，避免 sink 二义） | 纪律 |
| CS4 | 新增 `teamSinkPreflightPre` | 无 | **只读预检**：判断团队索引通道是否可用 | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：团队通道预检（新增导出，放文件末尾）。**只读、不改本 sink 行为。**

```js
/**
 * 团队索引通道预检 —— **只读探测**，绝不改变本 sink 的行为。
 *
 * 为什么要独立预检而不是在本 sink 里加"团队模式"：
 *   用户铁律：JS 端语义模型是默认形态，Python 端是发烧友进阶项，
 *   两者**相对独立、可互相替换，严禁互相联动**。
 *   若在本 sink 里加团队分支，就会出现"团队功能要求 Python 可用"的隐含依赖
 *   —— 正是该铁律禁止的联动。
 * ⇒ 团队索引通道的可用性由调用方（宿主）用本函数**单独判断**，
 *    本 sink 继续只做它原本的事（本机 context_push）。
 *
 * @param {{clientOk:boolean, workerEpoch?:number, sinkKind?:string}} probe
 * @returns {{available:boolean, reason:string, note:string}}
 */
export function teamSinkPreflightPre(probe) {
  const p = probe || {}
  const kind = String(p.sinkKind || '')
  if (kind !== PYTHON_CONTEXT_SINK_KIND_PRE) {
    return { available: false, reason: 'sink-not-python', note: '团队索引通道需要 python sink；JS 引擎路径不受影响。' }
  }
  if (p.clientOk !== true) {
    return { available: false, reason: 'sidecar-unavailable', note: 'worker 不可用；团队索引同步将暂停，本地记忆功能不受影响。' }
  }
  return { available: true, reason: 'ok', note: '团队索引通道可用。' }
}
```

**片段 2**：失败 reason 复用既有枚举（**不新增第二套**）。位置：`context-sink-python.js:29`（`createPythonContextSinkPre` 内构造失败 ACK 处）。

```js
      // ★ Teamwork：团队相关的失败也走**同一个** reason 枚举与同一个 ACK 形状。
      //   为什么不新增团队专用 reason：ACK 的消费方（宿主）按 reason 分类处理，
      //   新增未登记的 reason 会落到 default 分支 ⇒ 症状是"团队失败被当成普通失败静默处理"。
      //   与 state-commit.js:46 的 COMMIT_REASONS_PRE_V1 同款纪律：原因码是封闭枚举。
      const ack = {
        accepted: false,
        reason: reasonOfFailure,     // 复用既有枚举值
        // ...原有字段（observationId 对应等）...
      }
      try { validateContextAckPre(ack) } catch (_) {}   // 形状自检（失败也不冒泡）
      return ack
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **异常冒泡打断对话** | 新增分支抛错 | 文件头纪律；回归覆盖"worker 不可用"路径 |
| **团队与 Python 联动** | 在 sink 里加团队模式 | 片段 1 独立预检；用户铁律 |
| **第二套 reason 枚举** | 团队失败自造 reason | 片段 2 复用枚举；对照 state-commit 的封闭枚举纪律 |
| **多进程 spawn** | 团队同步另起 worker | 文件头"不 spawn"；单一 SidecarClient 所有者 |
| **schema 被私改** | 在本模块加字段 | 文件头"零 schema 改动"；新字段必须改上游契约 |

**既有测试/守卫**：`context-sink-python` 的 ACK 兼容性用例（与 `validateContextAckPre` 对接）、失败映射用例。本模块 import 了 `context-bridge.js` 与 `m7-wire.js` ⇒ 两处契约变化都会影响它。
