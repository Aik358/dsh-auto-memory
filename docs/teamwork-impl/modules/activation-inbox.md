
## activation-inbox

- **规模**：26,898 B / 474 行 / 24 个导出符号
- **交付形态**：**完整版**

### 职责

**M6-1 Activation Inbox / Reference Tail 纯核心**（`docs/M6-CONTRACT.md` §3-§6）。零 IO、零依赖（仅 `node:crypto`）；**不接 Host、不碰 prompt/request、不启动 Python**。
七部分组成：①策略/预算常量（注入卫生 guard v2）；②`ActivationCandidatePre` / `ActivationRequestPre` validator（**JS 硬校验；不重算语义分**）；③候选去重（跨 memoryId 同 `recordDigest` 保最高分）；④Reference Tail 渲染器（固定边界；**provenance 身份行永不截断**；整体 UTF-8 **byte** 预算）；⑤`ReferenceTailPacketPre` validator + `packetId`/`exactDigest` canonical identity；⑥TTL 纯函数；⑦fake activation fixtures（确定性 `act_pre_*` id）。

### 数据流

```
候选（来源于 M4 检索 / Python 推送）
   │
   ▼
validateActivationCandidatePre(c)  L73   JS 硬校验（**不重算语义分**）
        │
   dedupeCandidates(list)  L142   跨 memoryId 同 recordDigest → 保最高分
        │
        ▼
validateActivationRequestPre(req)  L102
        │
        ▼
renderReferenceTail(req)  L274   ★ 渲染尾注
   ├─ sanitizeTailText  L172   注入卫生（防 prompt 注入）
   ├─ clipBytes         L195   按 **UTF-8 字节**裁剪（不是字符）
   ├─ TAIL_MARKER_LINE_PRE_V1 L58 / TAIL_VERIFY_LINE_PRE_V1 L60 / TAIL_FETCH_HINT_LINE_PRE_V1 L63
   └─ **provenance 身份行永不截断**
        │
        ▼
buildReferenceTailPacketPre(...)  L373
   ├─ buildPacketId  L322       packetId 身份
   ├─ computeExactDigest  L328  exactDigest（渲染一致性校验）
   ├─ validateReferenceTailPacketPre  L333
   └─ isExpired  L366           TTL 纯函数
   常量：ACTIVATION_POLICY_VERSION L23 / PACKET_SCHEMA_VERSION L24 / PACKET_ID_PREFIX L25
        / ACTIVATION_ID_PREFIX L26 / REFERENCE_TAIL_BUDGET_PRE_V1 L29 / SKILL_TAIL_BUDGET_PRE_V1 L47
        / ACTIVATION_LEVELS_PRE_V1 L54 / DELIVERY_STATES_PRE_V1 L56
   fixtures：makeFakeActivationRequestPre L435（M7 前唯一激活来源）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L23–L63 | 策略常量与预算 | 版本、前缀、两类预算（reference/skill）、激活级别、投递状态、三行固定文案 |
| L73 | `validateActivationCandidatePre(c)` | 候选校验 |
| L102 | `validateActivationRequestPre(req)` | 请求校验 |
| L142 | `dedupeCandidates(list)` | **候选去重** |
| L172 | `sanitizeTailText(text)` | **注入卫生** |
| L195 | `clipBytes(text, n)` | **按字节裁剪** |
| L210 | `validateActivationSkillPre(s)` | 技能校验 |
| L274 | `renderReferenceTail(req)` | **渲染尾注** |
| L322 / L328 | `buildPacketId` / `computeExactDigest` | canonical 身份 |
| L333 | `validateReferenceTailPacketPre(p)` | packet 校验 |
| L366 | `isExpired(p, now)` | TTL |
| L373 | `buildReferenceTailPacketPre(...)` | **构造 packet** |
| L435 | `makeFakeActivationRequestPre(...)` | 确定性 fixture |

### 内部关键实现

**1. "不重算语义分"是职责边界（文件头）**

文件头逐字：*"ActivationCandidatePre / ActivationRequestPre validator(**JS 硬校验;不重算语义分**)"* ⇒ JS 只做**形状与预算**校验，语义打分归 M4/Python。团队化不得在这里引入第二套打分逻辑（否则两端排序会分叉）。

**2. provenance 身份行永不截断（文件头）**

*"Reference Tail 渲染器(固定边界;**provenance 身份行永不截断**;整体 UTF-8 byte 预算)"* ⇒ 即使预算紧张，**身份行必须保留** —— 否则模型看到的内容无法溯源，且"superseded 必须标记"的产品语义会失效。

**3. 按 UTF-8 字节裁剪（L195）**

`clipBytes` 用**字节**而非字符 —— 中文一字三字节。⇒ 预算口径与"模型能承受多少字节"对齐。团队化后多语言混排更常见，这条纪律更关键。

**4. sanitizeTailText 是注入卫生（L172）**

尾注会进入 prompt ⇒ 必须清洗（防记忆内容里的指令被当系统指令执行）。⇒ **团队共享记忆是外部输入**，这条卫生检查在团队场景下从"锦上添花"变成"必需"。

**5. exactDigest 保证"渲染即投递"一致（L328）**

投递时重渲染并校验 `exactDigest`，一致才算真的进入 messages（见 `activation-host.js` 文件头逐字："渲染即投递:专用 context 组件……重渲染并校验 exactDigest,一致则返回尾注文本(=已实际进入 messages)并 markDelivered"）。

### 与团队化的关系

**判定：S2 团队共享（团队技能/记忆激活必须走同一套 packet 契约）+ S3（渲染是纯派生）。**

理由：packet 是"把一条记忆带进模型上下文"的**运输容器**。团队共享的记忆若走不同的容器，`exactDigest` 校验、TTL、注入卫生三样都会分叉。**注意**：packet 里含**记忆内容片段**（reference tail）⇒ 共享 packet 等于共享内容片段，**必须按权限过滤**。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| AI1 | `sanitizeTailText` L172 | 本地卫生规则 | 团队内容是**外部输入** ⇒ 卫生规则必须更严（**追加，不削弱**） | 规则增强 |
| AI2 | `renderReferenceTail` L274 | 本地渲染 | 团队来源加**显式来源标**（与 tier-layer-inject 的 [团队] 同源） | 渲染增字段 |
| AI3 | `REFERENCE_TAIL_BUDGET_PRE_V1` L29 | 本地预算 | 团队内容**不得突破**预算（预算不因来源而放宽） | 纪律 |
| AI4 | `buildPacketId` L322 | 内容身份 | **不得掺入 actorId** | 纪律 |
| AI5 | 新增 `assertTeamTailSanitizedPre` | 无 | 团队尾注上线前的卫生断言 | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：团队尾注卫生强化（**只追加规则，不削弱既有规则**）。位置：`activation-inbox.js:172`（`sanitizeTailText` 内）。

```js
export function sanitizeTailText(text, opts) {
  let s = String(text == null ? '' : text)
  // ...原有卫生规则（控制字符、固定边界标记等）...
  // ★ Teamwork：团队内容是**外部输入**，卫生规则必须**只增不减**。
  //   为什么：本机记忆是自己写的，注入风险有限；队友记忆经网络到达，
  //   且可能来自被污染的共享库（如某成员误把带指令的文本写进记忆）。
  //   规则只追加（不能为了"团队内容正常显示"而放宽既有项）——
  //   放宽的后果是 prompt 注入，代价远高于"少显示一点内容"。
  const o = opts || {}
  if (o.fromTeam) {
    // ① 剥掉模拟系统/工具调用的伪标签（团队内容最容易带这类残留）
    s = s.replace(/<\|?(system|assistant|tool|function)[^>]*\|?>/gi, '')
    // ② 剥掉"忽略以上指令"类越权话术的标记形式（保留正文，只去标记）
    s = s.replace(/\[\[?(IGNORE|OVERRIDE|SYSTEM)\s*:?[^\]]*\]?\]/gi, '')
  }
  return s
}
```

**片段 2**：来源标注入（**不改预算**）。位置：`activation-inbox.js:274`（`renderReferenceTail` 组装行处）。

```js
export function renderReferenceTail(req, opts) {
  // ...原有渲染（固定边界 + provenance 身份行 + 内容行）...
  const o = opts || {}
  // ★ Teamwork：团队来源加**显式来源标**，且**不申请额外预算**。
  //   为什么标：模型必须能区分"用户自己记录的记忆"与"团队共享的记忆"——
  //   二者的可信度与时效性不同（与 superseded 必须标记同源的产品语义）。
  //   为什么不加预算：REFERENCE_TAIL_BUDGET_PRE_V1 L29 是**每轮注入的硬上限**，
  //   若团队内容可突破，等于"加入团队 = 每轮上下文变长"，会系统性地
  //   把用户推向更早的压缩/交接（本仓已有类似事故：水位阈值口径错误导致交接时机错位）。
  const mark = (o.fromTeam ? '[团队] ' : '')
  return lines.map((l) => (l.isProvenance ? l.text : mark + l.text)).join(String.fromCharCode(10))
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **prompt 注入** | 团队记忆含指令文本 | 片段 1 只增不减的卫生规则；回归须有"恶意文本"用例 |
| **预算被团队内容突破** | 为容纳团队内容放宽预算 | 片段 2 不加预算；AI3 纪律 |
| **身份行被截断** | 裁剪未保护 provenance 行 | 文件头明文"永不截断"；回归覆盖"预算极紧"场景 |
| **packetId 掺入身份** | 为区分来源改身份 | AI4 纪律；packetId 是跨端一致性凭据 |
| **语义分被重算** | 在 JS 侧二次打分 | 文件头职责边界；会导致两端排序不一致 |

**既有测试/守卫**：`activation-inbox` 的 validator / 去重 / 渲染 / TTL / 身份用例。`activation-inbox-state.js` 与 `activation-host.js` 均消费本模块 ⇒ 改动需三模块联合验证。
