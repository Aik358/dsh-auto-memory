
## context-host

- **规模**：54,260 B / 892 行 / 2 个导出符号
- **交付形态**：**完整版**

### 职责

**M5-3 Context Bridge Host Wiring**（`docs/M5-CONTRACT.md` §12 M5-3）。它是 `context-bridge.js`（纯核心）的 **Host 半边**：把纯逻辑接到真实宿主能力上 —— 会话观察、证据落盘（经 `evidence-store`）、context_push 下发、ACK 回执、以及**纠正归因**（`selectCorrectionAttributionPre`）。

### 数据流

```
宿主事件（会话轮次 / 工具回包 / 记忆注入）
   │
   ▼
createContextHost(opts)   L98   ★ 工厂（注入 ctx / 各 store / sink）
   │
   ├─ 观察：把会话段交给 context-bridge.validateContextSegmentPre（L67）
   ├─ 证据：createAccessEvidencePre（context-bridge L244）→ evidence-store 落盘
   ├─ 下发：buildContextPushEnvelopePre（L426）→ sink（js / python）
   ├─ 回执：validateContextAckPre（L399）
   └─ 纠正归因：selectCorrectionAttributionPre(...)  L66   ★ 本模块独有
        └─ 用 CORRECTION_LEXICON_PRE_V1（context-bridge L54）判定"模型纠正了哪条记忆"
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L66 | `selectCorrectionAttributionPre(...)` | **纠正归因**：把"纠正"归到具体记忆 |
| L98 | `createContextHost(opts)` | Host 工厂（**唯一入口**） |

### 内部关键实现

**1. 只有两个导出 —— 刻意的"薄 Host"**

892 行只导出 2 个符号 ⇒ 其余全是内部实现。⇒ Host 层**不暴露内部结构**，团队化只能在**注入点**（`createContextHost` 的 `opts`）上做文章，不能改内部流程。这是低风险改造的前提。

**2. 纠正归因是本模块独有能力（L66）**

`selectCorrectionAttributionPre` 把"用户纠正了模型的回答"这个事件，**归因到具体是哪条记忆导致的**。⇒ 这是 `correction` 类证据的来源，而 correction 是 importance 公式里的**唯一负向项**（`memory-importance.js:48` 的 `negGain * correctionRate`）。
**团队化含义**：纠正归因若在团队间共享，会让他人的纠正影响你的记忆排序 —— 这是一个需要**显式治理决策**的点。

**3. 证据经 evidence-store 落盘**

本模块不自己写证据文件，而是交给 `evidence-store.js:115` 的 `EvidenceEventStore`（append-only JSONL + 隐私投影 + retention）。

**4. 与 procedure-switch 的耦合（`context-host.js:537`）**

`procedure-switch.js` 文件头明确引用：*"`context-host.js:537` → `skillEnabled = memoryHubEnabled && procedurePromotionEnabled !== false`（决定技能是否**注入上下文**）"*。⇒ **本文件 537 行是技能注入的开关点**，团队化接线必须从这里改。

### 与团队化的关系

**判定：S1 个人云 / S2 混合（证据可共享，纠正归因需治理决策）。**

理由：`seen/read/reuse` 这类证据是**客观行为**，跨端共享能真实反映"这条记忆在团队里被用得多"；但 `correction` 是**主观判断**（某人认为模型错了），直接共享会让"别人的纠正"改变你的排序。
⇒ 建议：**共享 seen/read/cite/reuse/success，correction 需显式开启**（独立开关，缺省关）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| CH1 | `createContextHost(opts)` L98 | 本地注入 | 增加 `opts.team = { groupId, actorId, shareCorrection }` | 纯新增 |
| CH2 | `context-host.js:537` | 技能注入开关点 | 叠加团队技能候选（见 procedure-switch 片段 2） | 接线点 |
| CH3 | 证据落盘 | 只写本地 | 落盘后投递团队证据（**correction 按开关**） | 新增 |
| CH4 | `selectCorrectionAttributionPre` L66 | 本地归因 | 团队纠正需带 actorId；**默认不参与他人排序** | 新增字段 |

#### 可直接落地的代码片段

**片段 1**：团队证据分流（新增内部函数 + 接线说明）。位置：`context-host.js:98`（`createContextHost` 内，证据落盘回调处）。

```js
  /**
   * ★ Teamwork：证据的团队分流。
   *
   * 必读的两条纪律：
   *   1. **本地落盘永远先做、且永远做** —— 团队投递是附加动作，失败不影响本地
   *      （对照 hub-io.js 修复前的教训：失败被吞会导致"三条线全绿而磁盘没写上"）。
   *   2. **correction 默认不共享** —— 它是主观判断（"某人认为模型错了"），
   *      直接共享会让**别人的纠正改变你的记忆排序**（importance 的 negGain 项）。
   *      这是一个需要显式治理决策的点，因此走独立开关 shareCorrection，缺省 false。
   *
   * @param {object} ev 已构造好的证据对象
   * @returns {{local:boolean, team:boolean, reason?:string}}
   */
  function routeEvidencePre(ev) {
    const e = ev || {}
    const t = opts.team || null
    if (!t || !t.stage) return { local: true, team: false, reason: 'team-disabled' }
    const kind = String(e.kind || '')
    if (kind === 'correction' && t.shareCorrection !== true) {
      // 明确记录"为什么不共享"——避免后人以为漏了同步
      return { local: true, team: false, reason: 'correction-not-shared-by-policy' }
    }
    try {
      t.stage({ v: 1, entity: 'access-evidence', groupId: t.groupId, actorId: t.actorId || 'local',
                op: 'append', payload: e, at: Date.now() })
      return { local: true, team: true }
    } catch (err) {
      // 失败不抛：本地证据已经落盘，团队投递是尽力而为
      if (typeof t.onError === 'function') { try { t.onError('context-host:team-evidence', String(err && err.message)) } catch (_) {} }
      return { local: true, team: false, reason: 'stage-threw' }
    }
  }
```

**片段 2**：纠正归因带来源标（**但不参与他人排序**）。位置：`context-host.js:66`（`selectCorrectionAttributionPre` 返回对象处）。

```js
export function selectCorrectionAttributionPre(input, opts) {
  // ...原有归因逻辑...
  const att = { /* ...原有字段：memoryId / confidence / matchedLexicon 等... */ }
  // ★ Teamwork：标注这条纠正来自谁，但**不改变归因结果本身**。
  //   为什么必须标：团队场景下"这条记忆被 3 个人纠正过"与"被我纠正过 1 次"
  //   在治理上是完全不同的事；不标则无法区分，用户会以为都是自己历史行为。
  const o = opts || {}
  if (o.actorId) att.actorId = String(o.actorId)
  att.origin = (o.origin === 'team') ? 'team' : 'local'
  return att
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队投递影响本地落盘** | 把投递放在落盘之前或抛错传播 | 片段 1 先本地后团队 + try/catch；回归覆盖"stage 必抛"负路径 |
| **他人纠正污染自己的排序** | correction 默认共享 | 片段 1 的 shareCorrection 缺省 false + reason 留痕 |
| **技能注入开关点漏改** | 只改了 store 没改 537 行 | CH2 明确接线点；procedure-switch 文件头也标注了该行号 |
| **Host 内部结构被侵入** | 团队化直接改内部流程 | 只有 2 个导出 ⇒ 一律走 opts 注入；零破坏前提 |
| **证据重复计数** | 团队重投 | 由 `context-bridge` 的确定性 ID + `evidence-store` 去重兜住 |

**既有测试/守卫**：`context-host` 的 Host 接线用例（M5-3 契约）。**本文件 537 行被 `procedure-switch.js` 以行号硬引用** ⇒ 若因重构使该行号漂移，两份文档需同步勘误。
