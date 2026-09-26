
## semantic-decide

- **文件**：`lib/semantic-decide.js`
- **规模**：15,404 B / 299 行 / 3 个导出符号
- **职责一句话**：**JS 端激活判定核** —— 纯 JS、零依赖地完成"要不要激活"的全部判定（`js_activation_decide_pre_v1`）。

> ## ⚖️ 铁律适用声明（本节优先于全文其他表述）
>
> **JS 端语义模型 = 默认形态；Python 端 = 发烧友进阶项。两者是两项相对独立、可互相替换的功能，严禁互相联动。**
>
> **本模块的定位（源码 L265 逐字核实）**：
> *"加载并校验两个策略工件(fail closed)。**JS 端独立实现,不依赖 Python 运行时**。"*
> ⇒ **本模块在没有 Python、没装 sidecar 的机器上全功能可用**。
> ⚠️ 文件头大量出现"与 Python 逐字段对齐"——**其语义是「两套可互换实现在契约层对齐」**（保证换用任一套时行为一致），**不是**主从、兜底或降级关系。
> **风险点**：这些表述若被后继维护者读成"以 Python 为权威"，就会写出 JS 侧反向依赖 Python 的代码 ⇒ 本文件"改造点 SD0"专门处理。

### 数据流（谁调它、它读什么、决定什么）

| 方向 | 内容 |
|---|---|
| **上游输入** | 语义候选集 + 当前调用场景（是否已装 Python、配置开关、候选数量） |
| **本模块职责** | **只做「选哪一套语义实现」的判定**——输出一个决策结果，不执行语义计算本身 |
| **输出** | 决策对象（选中的实现 + 理由），供调用方分派 |
| **下游消费者** | `semantic-js.js`（JS 实现）与 Python 侧客户端——**由决策结果二选一** |
| **副作用** | **无**（纯判定，不写盘、不发网络、不启动进程） |

**关键推论（与铁律的关系）**：
- 本模块是**判定者**，不是**执行者**。⇒ 判定结果**不得**表达为"主用 X、X 不可用则降级到 Y"。
- 正确语义：**两套可互换实现在契约层对齐，任选其一**。
- 代码级判据：本模块的返回结构里**不得**出现 `fallback` / `degraded` / `primary` 之类字段名（会造成后继维护者按主从关系理解）。

### 逐段精读（带真实行号）

**L1-L14 · 文件头：与 Python 的三层契约对齐**

- **L4**：*"与 Python `m7_activation_features_pre_v2.decide_activation_v2` 逐字段对齐"*
- **L7**：*"echo veto / completeness / margin / delta 门 → `decision`(lane/reasonCodes **与 Python 一致**)"*
- **L12**：*"输入 features 与 Python 相同：`{text,denseTop,margin,containment,mark,nCand,candidateHit,hardGates,repetition,requiresRelayFlag,piiClass}`"*
- **L14**：*"输出与 Python `_pack` 相同：`{lane,decision,reasonCodes,features(snapshot),advisoryOnly,...}`"*

⇒ 四处都是**契约对齐**（同输入同输出），**不是调用关系**。⇒ 符合"两套可互换实现"表述。

**L20-L75 · token 级逐字对齐（issue #68 修复）**

- **L30-L31**：*"★ issue #68 修复（2026-09-19）：**加 `{2,}` 下限** —— Python 侧是 `\\b\\w\\w+\\b`（**≥2 字**），旧实现允许 1 字词 ⇒ 中文单字（如「好」「是」）在 JS 侧会生成 gram、Python 侧不会"*
- **L37-L43**：*"★ issue #68 修复：旧实现有三处分叉，现全部按 **Python 为权威** 对齐：① …… ② `isalnum()` 语义 …… ③ 不再额外压空白。修法用 `codePointAt` + `isAlnumPythonish()` 复刻 `isalnum()`"*
- **L45 / L67 / L70**：`isAlnumPythonish(cp)` 与按码点遍历的折叠实现。

⇒ ⚠️ **需按铁律解耦（表述层）**：L37 用了「**Python 为权威**」四个字。在**契约对齐**语境下这是合理的技术选择（需要一个基准），但**字面**违反铁律第 3 条"不准写成主从"。⇒ 建议改述为「**以 Python 侧实现为对齐基准**（基准是工程手段，两套实现地位对等）」，见改造点 SD0。

**L111 · 意图头（读工件）**

- **L111**：`RecallIntentHead` 读 `recall_intent_lr_pre_v1.json` ⇒ **JS 端自己读、自己算**。

**L198-L274 · 主决策与工件加载**

- **L198**：`decideActivationV2` —— *"主决策(与 Python `decide_activation_v2` 逐字段对齐)"*
- **L265**：*"加载并校验两个策略工件(fail closed)。**JS 端独立实现,不依赖 Python 运行时**。"* ← **铁律的直接证据**
- **L267 / L274**：*"configHash 是 Python 导出工件时用其 `json.dumps` 细节算的内部标记；JS 端作为**独立实现**……若未来需要与 Python 严格对齐哈希，可另加 `stableJson` 实现（纯 JS，含 int/float 语义）。"*

⇒ L267/L274 明确把"与 Python 严格对齐哈希"列为**未来可选项**、且实现方式仍是**纯 JS** ⇒ 再次证明**无运行时耦合**。

### 对外接口（导出符号表）

| 行号 | 符号 | 类型 | 说明 |
|---|---|---|---|
| L18 | `JS_ACTIVATION_DECIDE_VERSION` | const | `js_activation_decide_pre_v1` |
| L202 | `decideActivationV2(features, policy)` | function | **主决策**（纯函数） |
| L276 | `loadAndVerifyPolicy(json)` | function | 工件加载（**fail closed**，抛错） |

### 与团队化的关系

**判定：S2（判定契约须两端一致）+ S0（策略工件是本机资产）。**

理由：判定核决定"这条记忆要不要被激活"。**两套实现必须同结论**（这是"可互换"的定义）⇒ 契约一致是必要条件。
**但策略工件**（`recall_intent_lr_pre_v1.json`）是**本机资产** ⇒ 不同步；团队若要统一策略，必须**共享工件本身**（带 configHash），**而不是**"期望两端自然一致"。

### Teamwork 改造点（附可直接复制的代码）

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| **SD0** | **L37 注释** | 「现全部按 **Python 为权威** 对齐」 | **需按铁律解耦（表述层）**：改述为"以 Python 侧实现为**对齐基准**" | 注释；不改行为 |
| SD1 | `decideActivationV2` L202 | 两套实现契约对齐 | **不改判据**；团队一致性靠"两端同版本" | 纪律 |
| SD2 | `loadAndVerifyPolicy` L276 | fail closed | 团队策略工件**必须过 configHash 校验** | 纪律 |
| SD3 | 新增策略身份诊断导出 | 无 | 上报本机策略版本（团队一致性诊断） | 新增导出 |
| SD4 | 团队策略 | 无 | 共享**工件 + configHash**，不靠"自然一致" | 新增 |
| SD5 | 回退路径 | 抛错后调用方回退 | 团队场景回退**必须留痕**（否则静默降级） | 接线 |

#### 片段 1：铁律解耦的注释改写。位置：`semantic-decide.js:37`

```js
 * ★ issue #68 修复（2026-09-19）：旧实现有三处分叉，现全部**以 Python 侧实现为对齐基准**收敛
 *   （说明：此处「基准」是**契约对齐的工程手段**，用于保证两套可互换实现行为一致；
 *    JS 侧仍是**独立实现**，不依赖 Python 运行时 —— 见 loadAndVerifyPolicy 的注释）：
```

#### 片段 2：策略一致性诊断（新增导出，放文件末尾）。**回答"为什么两个成员行为不同"**

```js
/**
 * 上报本机判定策略身份 —— 团队行为一致性诊断。
 *
 * ★ 铁律口径：本函数只描述「本机这套实现所用的策略工件」，
 *   **不暗示**另一套实现更权威、也不表示"本机是替补"。
 *   字段名用 policyVersion / configHash（中性），**不用** fallbackKind 一类词。
 *
 * 为什么需要它：两套实现要求"同输入同结论"。团队化后"两端"变成"N 端"——
 *   任意两名成员若策略工件版本不同，就会对同一查询给出不同结论，
 *   而**用户只会觉得"团队版行为不一致"**，无法归因到"策略工件不同"。
 *
 * @param {{policyVersion?:string, configHash?:string, policyLoaded?:boolean}} info
 * @returns {{stable:boolean, policyVersion:string, configHash:string, note:string}}
 */
export function describePolicyCompatPre(info) {
  const p = info || {}
  const ver = String(p.policyVersion || '')
  const hash = String(p.configHash || '')
  const loaded = p.policyLoaded !== false
  const stable = loaded && !!ver && !!hash
  const note = stable
    ? ('判定策略 ' + ver + '（configHash ' + hash.slice(0, 8) + '）')
    : ('判定策略工件未加载或缺少版本标记' + (loaded ? '（缺版本/configHash）' : '（加载失败）') +
       '。这会导致与团队其他成员的行为差异，且不是记忆内容的问题。')
  return { stable: stable, policyVersion: ver, configHash: hash, note: note }
}
```

#### 片段 3：工件加载失败**必须留痕**（不能静默）。位置：`semantic-decide.js:276` 旁

```js
/**
 * 工件加载失败登记 —— 调用方会回退到规则路径，**这次回退必须留下可观察痕迹**。
 *
 * ★ 铁律口径（重要）：**不把"规则路径"叫成降级/兜底**。
 *   规则路径是**既定判定路径之一**，JS 端判定核本身始终可用；
 *   这里记录的只是"LR 工件没读到 ⇒ 本次用规则路径"，**不是**"JS 端降级了"。
 *
 * 为什么不能静默：若无人知道发生过工件加载失败，就会长期走规则路径，
 *   而表现只是"激活得不太准" —— 与 degrade.js:33 记录的 R2 事故同型
 *   （"四条臂各自独立降级、各自静默 ⇒ 可同时失效而使用者只感到检索不太对"）。
 *   ⇒ 进 degrade 台账（arm 用 'semantic'，与既有四臂并列）。
 *
 * @param {object} sink createDegradeSinkPre(...) 的实例（可为 null）
 * @param {string} reason
 * @returns {{ok:boolean}}
 */
export function notePolicyLoadIssuePre(sink, reason) {
  try {
    if (sink && typeof sink.note === 'function') {
      sink.note({ arm: 'semantic', kind: 'policy-artifact-unreadable',
                  reason: String(reason || '').slice(0, 200), at: Date.now() })
    }
    return { ok: true }
  } catch (_) { return { ok: false } }
}
```

### 风险与守卫

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **"Python 为权威"被判成主从** | L37 字面表述 | 片段 1 改写；SD0 |
| **JS 端反向依赖 Python** | 后人按"权威"读法写调用 | L265 是现成反证；SD0 注释强化 |
| **两端结论不一致** | 策略工件版本不同 | 片段 2 诊断出口；SD4 共享工件 + configHash |
| **静默走规则路径** | 工件加载失败无人知 | 片段 3 进 degrade 台账 |
| **fail closed 被改成默认权重** | 为"不抛错"而用默认值 | 文件头明文：抛错让调用方回退 ⇒ 不得用错误权重做判定 |

**既有守卫**：`semantic-decide` 的判定用例（两车道 / 四道门 / reasonCodes 对齐）、工件加载 fail closed 用例。**issue #68 的三处对齐修复很可能被逐条断言**（含中文单字、全角数字、多空格三组）。
**铁律相关的回归缺口（建议补）**：建议补一条守卫断言 **"`semantic-decide.js` 全文不 import/require 任何 Python 桥接模块，也不读 sidecar 状态"**，把"独立实现"钉成可静态断言的事实。
