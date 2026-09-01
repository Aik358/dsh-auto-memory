# M6 JS Activation Inbox / Reference Tail 指导性契约

> 状态：M6-0 指导契约冻结；尚未实现 M6 运行时代码
>
> 前置：M5 Context/Evidence Bridge tested/live
>
> 后续：M7 Python Semantic Engine 实现真实 ContextSink 与 activation_request

## 1. 定位

M6 是 JS 工程的第二阶段。它先用 deterministic fake activation 实现完整投递轨道，使未来 Python 只需发送 activation_request，不需要理解或修改 DSH prompt 生命周期。

~~~text
Fake/Python ActivationRequestPre
  -> JS hard validator
  -> per-runtime Activation Inbox
  -> ReferenceTailPacketPre (TTL + provenance)
  -> agent/pre-step / user-message-pre-step packet surface
  -> next model request tail
  -> delivery acknowledgement -> M5 seen evidence
~~~

## 2. 不交付

- 不实现 embedding、向量/矩阵、reranker 或图算法。
- 不让 Python 直接写 systemPrompt、Inbox、Session 或 request。
- 不修改已发出的请求。
- 不把 reference tail 写成 system/developer 高优先级指令。
- 不在 provider 无安全 packet surface 时强制注入。

## 3. ActivationRequestPre

M6 输入对象先由 fake fixtures 生成；M7 后由 Python 发出：

~~~ts
interface ActivationRequestPre {
  schemaVersion: 1
  namespace: 'dsh-auto-memory-pre'
  kind: 'activation_request'
  activationId: string
  observationId: string
  workerEpoch: string

  sessionId: string
  agentId: string
  workspaceKey: string
  scope: 'Session' | 'Workspace' | 'User'
  contextVersion: number
  memoryIndexVersion: string

  threshold: {
    policyVersion: string
    score: number
    threshold: number
    reason: string
  }
  level: 'index' | 'hint' | 'excerpt' | 'checklist' | 'resource' | 'full'
  candidates: ActivationCandidatePre[]
  ttlSteps: number
  createdAt: number
  expiresAt: number
}

interface ActivationCandidatePre {
  candidateId: string
  memoryId: string
  anchorId: string
  scope: 'Workspace' | 'User'
  sourceRef: string
  sourceEpoch: string
  sourceVersion: number
  fileDigest: string
  recordDigest: string
  score: number
  excerpt?: string
  checklist?: string[]
}
~~~

## 4. JS hard validation

JS 不重新计算 Python 的语义 score，但必须拒绝：

- 未知/重复 activationId 或 observationId。
- workerEpoch、sessionId、agentId、workspaceKey 或 scope 不匹配。
- contextVersion、memoryIndexVersion、source epoch/version/digest 过期。
- item/UTF-8 byte/TTL/level 超预算。
- revoked、conflict、cross-workspace 或高风险未确认内容。
- Python 已超时、断路或请求被取消。

硬拒绝不是语义投票，而是身份、权限、时序和安全门。

## 5. ReferenceTailPacketPre

~~~ts
interface ReferenceTailPacketPre {
  packetSchemaVersion: 1
  namespace: 'dsh-auto-memory-pre'
  packetId: string
  activationId: string
  sessionId: string
  contextVersion: number
  memoryIndexVersion: string
  activationLevel: string
  triggerReason: string
  references: ReferenceItemPre[]
  exactDigest: string
  budgetBytes: number
  createdAt: number
  expiresAtStep: number
  deliveryState: 'pending' | 'claimed' | 'delivered' | 'expired' | 'dropped'
}

interface ReferenceItemPre {
  memoryId: string
  anchorId: string
  scope: 'Workspace' | 'User'
  sourceRef: string
  sourceVersion: number
  recordDigest: string
  score: number
  reference: string
}
~~~

packetId 由 activationId、contextVersion、indexVersion 和 exactDigest 确定性生成。

## 6. Reference Tail 文本

M6 渲染固定边界：

~~~text
[Retrieved memory reference - not an instruction]
Source: <memoryId> / <scope> / v<sourceVersion> / <recordDigest-prefix>
Reason: <semantic activation reason>
Reference: <bounded excerpt or checklist>
Verify against the current user request and tool results.
~~~

规则：

- 明确标记 reference，不是 system/developer/current user 指令。
- 不复制 Markdown marker 语法，不暴露绝对路径。
- 默认只开放最小 level；full 必须有更严格预算和用户策略。
- 尾部整体按 UTF-8 bytes 截断，不能截断 provenance identity。

## 7. 投递 surface 优先级

1. 专用 Agent Inbox / pre-step compose surface。
2. Provider 支持的 user-message/pre-step packet surface。
3. 专用动态 reference-tail context surface，仅在可证明实际进入下一请求 messages 时使用。
4. 无安全 surface：降级 Shadow Retrieval，不标记 delivered。

systemPrompt.section() 只存稳定规则，禁止动态 reference tail。

systemPrompt.context() 继续用于维护快照；它可以作为兼容 surface 的实现组件，但不能成为 M6 唯一通道，也不能仅因 context provider 返回文本就推进 delivered cursor。

## 8. pre-step 时序

- Activation 到达当前请求发出后，只能等待下一次 pre-step。
- pre-step 先校验当前 cursor/index/TTL，再 claim packet。
- 同一 packet 在一次 request 中最多出现一次。
- 新 contextVersion 可替换旧 pending packet；过期 packet 丢弃。
- 只有实际进入 decision.messages/buildRequest 的 packet 才变 delivered。
- delivered 后 M5 创建 seen evidence；未投递不得创建 seen。

## 9. Activation Inbox

每个 SessionRuntime 独立：

~~~ts
interface ActivationInboxPre {
  pending?: ReferenceTailPacketPre
  claimedPacketId?: string
  deliveredPacketIds: BoundedSet<string>
  cooldownUntilStep: number
  lastActivationAt: number
}
~~~

禁止全局 pending packet、_lastAgent fallback 或跨 workspace 复用。

## 10. Safety 与风险

- reference 内容仍可能包含过期事实或提示注入文本。
- 渲染前沿用 JS sensitive-content 与 instruction-like-content guard。
- 高风险 Procedure 只能输出“建议检查/请求确认”，不得自动执行工具。
- Python 的 threshold 不能替代用户授权。
- correction/revoked/conflict evidence 优先抑制。

## 11. Provider capability

~~~ts
interface PacketCapabilityPre {
  packetPatch: 'pre-step' | 'user-message' | 'dynamic-context' | 'none'
  includeRuntimeContext: boolean
  maxPacketBytes: number
  supportsDeliveryAck: boolean
}
~~~

不得按模型名称硬编码；按 provider/model/version capability snapshot 决定。

## 12. 审计

每次 activation 必须记录：

- accepted/dropped reason。
- activationId/packetId/sessionRef/contextVersion/indexVersion。
- memoryId/sourceRef/version/digest/score。
- packet bytes/level/expiry/surface。
- claimed/delivered/expired 状态。

审计无原文、无绝对路径、无凭据。M6 audit 与 M4 Shadow audit 分开。

## 13. 实施分段

### M6-0 Contract Freeze

本文与 system-map 回写。

### M6-1 Pure Core

ActivationRequest validator、ReferenceTail renderer、packet identity、TTL/budget/dedupe；fake activation fixtures。

### M6-2 Per-runtime Inbox

pending/replace/expire/cooldown/dispose；仍不接真实 prompt surface。

### M6-3 Surface Adapter

接 agent/pre-step/user-message/dynamic-context capability；delivery ack；M5 seen evidence。

### M6-4 Live Verification

关闭基线、fake activation、下一请求 tail、provenance、零高优先级覆盖、无 surface 降级、关闭恢复。

## 14. 验收矩阵

1. 默认关闭 prompt/model-visible 零变化。
2. Activation schema/identity/version/scope 校验。
3. stale/duplicate/late/cancelled fail closed。
4. Reference Tail 固定边界与 UTF-8 budget。
5. packet TTL/replace/dedupe/cooldown。
6. A/B runtime 零串线。
7. pre-step 后才生效，当前请求不变。
8. delivered ack 才创建 M5 seen。
9. systemPrompt.section 永不承载动态 tail。
10. provider none 时 Shadow fallback。
11. high-risk confirmation gate。
12. audit privacy/no BOM/replay determinism。

## 15. M6 完成门

M6 live 后，JS 已能在没有 Python 的情况下用 fake activation 完整演示“上下文对象 → activation → 下一请求 Reference Tail → delivery evidence”。此时再由更强 Agent 冻结完整 M7 Python 契约并实现真实 sidecar。

## 16. 实施状态（M6-1 完成，2026-08-23）

状态：**M6-1 Pure Core 已完成并通过 D1-D9 测试**；纯模块 `lib/activation-inbox-pre.js`（零 IO、零依赖 node:crypto；无 spawn/net/http 引用静态锁定）；未接 Host、不碰 prompt/request。

| 交付 | 说明(契约 §) |
| --- | --- |
| REFERENCE_TAIL_BUDGET_PRE_V1 | 冻结预算(maxCandidates 8/maxPacketBytes 4096/maxReferenceItemBytes 600/excerpt 480B/checklist ≤8×120/ttlStepsMax 10/reason 160/deliveredIds 256;activationPolicyVersion=activation_pre_v1) |
| ActivationRequestPre validator | §4 JS 硬校验矩阵:schema/namespace/kind/activationId、observationId 必须 obs_pre_*、workerEpoch 必填(Python 身份门)、scope 枚举、contextVersion≥0、memoryIndexVersion 必须 idx_pre_+32hex、threshold 形状+reason≤160、level 六级枚举、candidates 1..8 全过候选校验、ttlSteps 1..10、expiresAt≥createdAt——不重算语义分,仅身份/版本/时序/预算门 |
| ActivationCandidatePre validator | memoryId 严格/anchorId/scope Workspace\|User/sourceRef 相对引用白名单/sourceVersion/fileDigest/recordDigest hex64/score∈[0,1]/excerpt≤480B/checklist 形状 |
| dedupeCandidates | 跨 memoryId 同 recordDigest 折叠保最高分(平局 memoryId 字典序);score 降序输出 |
| Reference Tail 渲染器 | 固定边界逐字一致(TAIL_MARKER_LINE_PRE_V1/Source: id / scope / vN / digest 前 16 / Reason / Reference)+全局 Verify 收尾行恰好一次;sanitizeTailText guard v1(控制符剔除/注释语法剥离/多空格折叠/换行折叠 '; ');超预算整条丢弃最低分项(tail-budget 计账),provenance 三行身份永不截断;全放不下 fail closed packet-oversize |
| packet identity | packetId=pkt_pre_+first32(sha256(activationId+contextVersion+indexVersion+exactDigest));exactDigest=渲染文本逐字节 sha256;两者确定性且对输入敏感 |
| ReferenceTailPacketPre validator | 全 schema 校验(packetSchemaVersion/packetId 前缀/references 形状与单项 ≤600B/budgetBytes>0/expiresAtStep 整数/deliveryState 五态枚举) |
| TTL 纯函数 | isExpired(packet,nowStep)=nowStep≥expiresAtStep(§8 过期丢弃判定) |
| fake fixtures | makeFakeActivationRequestPre:同 seed 确定性 act_pre_*/cand_pre_* id,产物通过自身 validator——M7 前唯一激活来源 |

测试 smoke-test-m61-pre.mjs D1-D9 共 **53 断言 exit 0**(常量冻结/硬校验正反例 13 项/去重语义/固定边界逐字符/卫生剥离/byte 预算整条弃用/exactDigest+packetId 确定性与敏感性/TTL 边界/fixtures 确定性/replay 逐字段一致/静态卫生)。全量回归 **17 项**(M0-M5 十六项+M6-1)18.4s 全部 exit 0;syntax/diff-check/BOM/_dev 扫描全净。

**实现注记**：
1. excerpt 超 480B 在 REQUEST 层即被 validator 拒绝(schema 门);渲染层预算丢弃只处理合法尺寸候选——两层预算职责分离,request 层是硬拒绝,packet 层是整条弃用。
2. checklist 渲染为 '; ' 连接的单行列表(注入注释剥离后空格折叠),不做多行——保证固定边界块结构恒为四行/条。
3. 下一步 **M6-2 Per-runtime Inbox**:pending/replace/expire/cooldown/claim/dispose,per-runtime WeakMap state,禁止全局 pendingPacket 与 _lastAgent fallback。

## 17. 实施状态（M6-2 完成，2026-08-23）

状态：**M6-2 Per-runtime Inbox 已完成并通过 E1-E9 测试**；纯模块 `lib/activation-inbox-state-pre.js`（纯内存状态机；无 spawn/net/http；静态扫描确认无 `_lastAgent` fallback、无全局 pendingPacket——状态仅存在于实例内）。

| 交付 | 说明(契约 §) |
| --- | --- |
| createActivationInboxPre | 单 runtime 收件箱状态机:offerActivation(JS 硬校验→身份门 sessionId/agentId/workspaceKey 完全一致→重复门 activationId/observationId 已见即拒→抑制名单(correction/revoked 记忆整单拒)→cursor 门(落后 contextVersion=stale-context)→index 门(miv 不匹配=stale-index)→构建 packet)→latest-wins 替换语义(同 packetId 幂等拒绝重放;更高 cv 替换旧 pending 并记录 replacedContextVersion) |
| claim 四重门 | cooldown(nowStep<cooldownUntilStep 拒绝并报剩余步数)→TTL(isExpired→expired 丢弃)→currentContextVersion 不一致→stale-context 丢弃→memoryIndexVersion 不一致→stale-index 丢弃;全过则 pending→claimed |
| markDelivered | claimed→delivered 唯一路径;启动 REFERENCE_TAIL_COOLDOWN_STEPS_PRE_V1=2 步冷却;deliveredIds 有界集(256,先进先出);只有此时上游才允许建 seen(M6-3 接线点) |
| setCursor/suppressMemories | 游标前进使落后 pending 失效;抑制名单 API 供 M5 correction 聚合喂入 |
| ActivationInboxRegistry | 严格身份键 'session:<id>\|ws:<ws>' 分桶;无可靠身份 keyOf=null(禁止 default 兜底桶);disposeSession/disposeAll |
| dispose | 清空 pending/claimed/delivered/seen/抑制全部状态,disposed 后拒单 |

测试 smoke-test-m62-pre.mjs E1-E9 共 **36 断言 exit 0**:空箱/offer-claim-deliver 全链路(cooldown=now+2)/duplicate 双 id 门/身份门+registry 分桶隔离+keyOf 空身份拒绝/cursor+index 双 stale 门/latest-wins 替换与同 activationId 重放硬拒绝/TTL 过期/dispose/抑制门/A-B 零串线/静态卫生(含无 _lastAgent)。全量回归 **18 项**(M0-M6-1 十七项+M6-2)18.5s 全部 exit 0;syntax/diff-check/BOM/_dev 扫描全净。

**实现注记**：
1. 门序:身份→重复→抑制→时序(cursor/index)→构建。同 activationId 重放的幂等语义=§4 硬拒绝(duplicate-activation),而非重复接受;模块内 duplicate-packet 分支仅为不同 activationId 渲染出同一 packet 的理论路径保留。
2. cooldown 步数固化为策略常量(=2),不与 softInjection 旧参数 injectionCooldownSteps 混用;变更须升级 activationPolicyVersion。
3. 下一步 **M6-3 Surface Adapter**:capability 快照(pre-step/user-message/dynamic-context/none)、专用 systemPrompt.context 组件渲染 pending packet、claim→render→delivered 同步链、delivery ack 后调 M5 seen 创建、systemPrompt.section 保持零动态。

## 18. 实施状态（M6-3 完成，2026-08-23）

状态：**M6-3 Surface Adapter 已完成并通过 F1-F9 测试**；`lib/activation-host-pre.js` 接入 lib/index.js(八处最小接线)；仍默认双门关闭；live 验证待 M6-4。

| 交付 | 说明(契约 §) |
| --- | --- |
| lib/activation-host-pre.js | createActivationHost({engine}):严格身份键 ActivationInboxRegistry 分桶;per-runtime step 计数;claimed packet 缓存于 runtime 态(无全局 pendingPacket) |
| capability 快照 | detectPacketCapabilityPre(ctxLike)(§11):按宿主 surface 形状判定——本 DSH 有 systemPrompt.context(user-role 快照追加历史尾部,可证明进入 messages)→'dynamic-context'+supportsDeliveryAck=true;无 context→'none'(降级 Shadow 不标 delivered);不按模型名硬编码;capabilityVersion=capability_pre_v1 |
| pre-step 时序 | §8:engine agent/pre-step 钩子内 bumpStep→setCursor(runtime cv+corpus miv)→claim 四重门(cooldown/TTL/cursor/index);claimed 缓存等渲染面消费 |
| 渲染即投递 | 专用 systemPrompt.context 组件 'dsh:m6-reference-tail-pre'(order=10001):重渲染 claimed packet 并校验 exactDigest 一致 → 返回尾注文本(=实际进入 messages)→ markDelivered + 异步创建 seen evidence;digest 不一致/未声明 → 空串零注入。section 组件保持字节级稳定,永不承载动态 tail(F7 实测) |
| delivery ack → seen | renderTailFor 成功后按 references 逐条经 contextHost.findProvenance(memoryId+recordDigest)补全 sourceEpoch/fileDigest → createAccessEvidencePre(kind='seen') → contextHost.appendEvidence 落盘 evidence-pre events(隐私投影同 M5);查不到 provenance 则跳过(fail closed) |
| 注入路由 | POST /api/dsh-auto-memory-pre/activation-inbox-pre {action:'inject'|'status'}:loopback-only;inject 为 fake 来源唯一入口('python' 拒绝),status 返回 debugView+memoryIndexVersion |
| index.js 八处接线 | import/initCapability/host 创建/refreshAll capturePaths/pre-step claim 钩子/debug activationInbox 字段/disposers/DEFAULT_CONFIG 新增 activationInboxEnabled=false、activationSource='fake' |

测试 smoke-test-m63-pre.mjs F1-F9 共 **23 断言 exit 0**(默认关闭/开关矩阵/capability 形状/注入接受+重放拒/pre-step claim/固定边界渲染含 provenance 身份/渲染即投递且二次为空/**delivery ack 后 seen 落盘 n=2**/冷却门 live/TTL 过期 live/section 字节稳定+任何组件零尾注/关闭恢复)。既有基线同步:路由 25→26(context-observer/m3b3/main)、prompt 组件 2→3(m53 C8)。全量回归 **19 项** 20.7s 全部 exit 0;syntax/diff-check/BOM/_dev 扫描全净。

**实现注记**：
1. 冷却语义收紧为「nowStep≤cooldownUntilStep 当步仍拒」(state-pre 同步修改,E2 断言不变)——投递后至少空 2 个完整步,消除边界歧义。
2. miv 来源=activation host 自有 CorpusRegistry(fingerprint 缓存),与 context host 各自独立但同源 sidecar 目录。
3. seen 创建在 contextBridge 关闭时依然可用(evidence store 与 bridge 解耦);provenance 缺失跳过并计 seenSkippedNoProv。
4. M6-4 已完成并 live verified；当前进入 M7 Python Semantic Engine 外部 Agent 交接。Python 必须走自然 pre-step claim，不改变 M6 validator、delivery 或 seen 语义。

## 19. 实施状态（M6-4 Live Verification 通过，2026-08-23 —— M6 整体完成）

状态：**M6-4 live 验证通过，M6 整体完成并已恢复默认关闭**(assoc=false/activationInboxEnabled=false；anchor=true 保持)。用户重启现有 3080 后实测:

| 步骤 | 结果 |
| --- | --- |
| 新构建加载 | debug 出现 activationInbox 字段;capability=capability_pre_v1/dynamic-context/supportsDeliveryAck=true ✓ |
| 关闭基线 | {enabled:false} 严格投影;evidence events 字节基线记录;真实记忆 SHA 基线记录 ✓ |
| 开启+预热 | assoc∧inbox 双开后,一次 pre-step 即完成 miv 懒加载(idx_pre_1de0…)与 inbox 注册 ✓ |
| fake 注入 | POST activation-inbox-pre → offer ok/pending,pkt_pre_a602f2aa…;同 activationId 重放拒(duplicate) ✓ |
| **注入即泵** | finishInject 立刻以请求自声明版本过四重门 claim,claimed 挂到目标 runtime 态(pump event 实证 runtimeKey=session:cc245cf1);**下一步自然 compose 时尾注字面渲染进本 agent 的 model-visible messages(本次对话直接可见两条引用块:mem_af41…/mem_6667… 各四行+Verify 收尾)** ✓ |
| delivery ack | rendered=1/delivered=1;markDelivered 启动冷却;同一 packet 二次渲染为空 ✓ |
| **seen 落盘** | seenCreated=2 → evidence-pre/events 增 2 条 kind=seen(ev_pre_168c…/ev_pre_522b…),provenance 由 findProvenance 从 corpus 补全,sesr_/wsr_ 隐私投影 ✓ |
| 隐私扫描 | 全部事件无裸 sessionId/workspaceKey/绝对路径/tail 文本泄漏 ✓ |
| prompt 零变化 | section 字节级稳定(F7 单元+live 组件输出核对);尾注只经专用 context 面 ✓ |
| 关闭恢复 | POST 恢复默认 → {enabled:false} 严格投影;events bytes 2491→2491 零新增写入 ✓ |
| 真实记忆完整性 | 三文件 anchor 链 conflicts=0/sidecar FRESH(SHA 漂移=窗口期自动沉淀合法写入,日志 23→24 条) ✓ |

**时序偏差说明（fake 来源限定）**：live 会话 cv 每步自增(assistant segment),跨步注入的 packet 必被 cursor 门判 stale——这是 §8 时序门的正确行为。fake 来源因此采用「**注入即泵**」：finishInject 在 offer 后立刻以请求自声明版本过四重门 claim,claimed 挂到目标 runtime 态,下一次自然 compose 渲染并 markDelivered(+seen);新增 rollbackClaim 兜底。**真实 Python 推送仍走 pre-step 自然 claim 路径(代码同路径保留)**;泵仅为确定性演示路径。

**M6 完成门对照（§15）**：JS 已能在没有 Python 的情况下用 fake activation 完整演示「上下文对象→activation→下一请求 Reference Tail→delivery evidence」✓。M7 完整契约、实施报告和 Agent handoff 已于 M5/M6 live 后冻结；Python 尚未启动。
