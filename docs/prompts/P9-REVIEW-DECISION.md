# P9 排查报告 · 规划侧评审与裁决（2026-09-09 20:53）

> 依据：实读 `lib/context-host-pre.js`、`lib/context-bridge-pre.js`、`lib/index.js`、`lib/memory-importance-pre.js`，非采信报告。

## 一、报告核实结果

| 结论 | 核实 | 判定 |
|---|---|---|
| reuse 无生产者 | grep 全 `lib/`，`'reuse'` 仅出现在枚举/白名单/聚合处，无 create 函数 | ✅ 成立，根因 (a) 正确 |
| correction 条件过严 | `createCorrectionEvidencesFromText` = 纠正词典 AND `createCiteEvidencesFromText`（文本须含完整 memoryId） | ✅ 成立，根因 (b) 正确 |
| success 根因 | 见下 | ❌ **误判** |

## 二、success 根因误判（重要修正）

报告称 success 触发链 =「被 read/cite 的 memoryId ∩ 某 procedure 的 sourceMemoryIds，交集稀疏」。

实读 `lib/index.js:4583-4595`：

```js
for (const e of cited) {
  for (const p of allProcs) {
    if (!(p.sourceMemoryIds || []).includes(e.memoryId)) continue
    procs.addEvidence(p.procedureId, { kind: 'success', sessionRef: sr })  // ← 交集只 gate 这一行
  }
  const r = createSuccessEvidencePre({ ... memoryId: e.memoryId ... })      // ← 这行在交集判断之外
  if (r.ok) successEvs.push(r.evidence)
}
```

**`createSuccessEvidencePre` 在内层 procedure 循环之外**——它对 `cited` 里的**每一条**都建 success 事件，**不要求 procedure 交集**。因此：

- 报告的核心根因「sourceMemoryIds 覆盖面极小」**不成立**——交集只影响 procedure 晋升，不影响 success 事件。
- **真正根因**：① 整块包在 `memoryHubEnabled === true` 门内（`lib/index.js:4576`），该开关 **M8-3 今天才开**，此前这段代码从未执行；② `cited` 来自 `recentEvidenceForSuccess(5×60×1000)` = **近 5 分钟内**的 read/cite 事件（`context-host-pre.js:691`），而 read/cite 全量才 82/286，5 分钟窗口天然稀疏。

**裁决：success 不改代码，降级为「观察」。** M8-3 已开门，先跑一周看真实产出；若一周后仍 ≈0，再单独加「放宽窗口/来源」小段。报告建议的「把匹配面扩到 cite 过的记忆」是**基于误判的方案，无需执行**。

## 三、P9a 方案自身的漏洞（需重设计）

报告方案：「用户段同时存在 cites 时，若命中纠正词典，把已建的 cite 证据就地升级为 correction」。

但 `emitTextEvidence`（`context-host-pre.js:490-501`）里，`cites` 也是从 `seg.text`（**用户自己消息**）算的。既然用户消息几乎不含完整 memoryId，`cites` 在 user 段也≈0 → **「用户段同时存在 cites」这一前提本身就不会成立**，照做仍然零触发。

**正确设计**：correction 的归因对象应是**最近被 cite 的记忆**（来自 assistant 段的 cite 事件），不是用户消息里新找的 id。即：user 段命中纠正词典 → 查 store 里**最近一条 cite/read**（复用 `recentEvidenceForSuccess` 已有的 store 读取思路）→ 对那**一条**记忆发 correction，且**保留 cite 不改写**。

## 四、importance 公式的精确诊断（比报告更准）

报告说「importance 由 seen 绝对主导」。实读 `lib/memory-importance-pre.js`，公式是：

```
pos = 0.5 × min(1, distinctSessions/3) + 0.5 × min(1, (success+reuse)/4)
importance = clamp01(0.5 + 0.3 × pos − 0.5 × correctionRate)
```

**seen/read/cite 根本不直接进分子**——它们只进 `total`（稀释 correctionRate）和 `distinctSessions`（跨会话数）。真正的正向驱动是 **distinctSessions 和 success+reuse** 两项。

当前 success+reuse=0 ⇒ `pos = 0.5 × diversity` ⇒ importance = 0.5 + 0.15 × min(1, sessions/3)，上限 0.65、中性 0.5、correction 拉低至 0.30——**与实测 [0.30, 0.65] 完全吻合**。

**结论**：当前 importance 实质 = **跨会话重现度（distinctSessions）**，这是一个**还不错的信号**（不是纯曝光）；真正死掉的是公式里的「有用性半区」`success+reuse`。这修正了「曝光度」的说法，也重新定位了 P10：P10 不是"降 seen 权重"（seen 本就不直接加权），而是"待 success/reuse/correction 流动后，标定 `IMPORTANCE_WEIGHTS`（升版本）"。

## 五、最终裁决与顺序

| 段 | 裁决 | 说明 |
|---|---|---|
| **P9a** correction | ✅ **批准，重设计** | 归因到"最近被 cite 的记忆"（单条），保留 cite 另发 correction；见 `FIX-AGENT-P9a.md` |
| **P9b** success | ⏸️ **降级为观察** | 不改代码；跑一周，产出观察清单（见下） |
| **P9c** reuse | ⏳ **延后** | 确认无生产者；与 success 同属公式里的同一饱和项 `(success+reuse)/4`，可合为一个「有用性信号补全」段，等 P9a + success 观察后再定 |
| **P10** 定标 | ⏸️ **顺序后移** | 需等 success/reuse/correction 有真实数据；届时改 `memory-importance-pre.js`（**解除 M8-2b 锁定，P10 是该模块合法 owner**）+ 标定 w |

### success 观察清单（一周，无需代码，交用户/执行侧）

- [ ] M8 启用后，`success` 事件是否开始产出（`~/.dsh/memory/evidence-pre/events/` 里 `"kind":"success"` 计数）
- [ ] 若有：日均量级 vs read+cite（预期 1-5%）
- [ ] 若仍 ≈0：确认是否因 `recentEvidenceForSuccess` 的 5 分钟窗口太窄（此时才需要放宽窗口/来源）

## 七、追加：success 是**结构性断裂**（2026-09-09 23:10，规划侧自我修正）

P9a 执行中发现并经我实证核实：

- **磁盘事件实样**：顶层字段为 `['anchorId','event','evidenceId','kind','memoryId','namespace','policyVersion','recordedAt','schemaVersion','scope','source','storePolicyVersion','workspaceRef']` —— **无 `ts`、无 `createdAt`**，`ts` 在 `event.ts`（值 `1788932690285`）。
- **缺陷代码**：`lib\context-host-pre.js` 的 `recentEvidenceForSuccess` 内 `const ets = e.ts || e.createdAt || 0` → 恒为 0 → `0 < cutoff` → **全部跳过 → 恒返回空数组**。
- **唯一调用方**：`lib\index.js:4576` 的 M9 success 块 → `cited` 恒空 → **success 永远为 0**。
- **对照**：P9a 新增的 `selectCorrectionAttributionPre`（同文件 68/77 行）已用正确口径 `Number(e.event && e.event.ts) || Number(e.ts) || Number(e.createdAt) || 0`——可见正确写法已在库内，只是老函数未同步。

**结论修正（我的责任）**：本文 §二曾判定 success「主因是开关今天才开 + 5 分钟窗口稀疏」，并据此把 P9b 降级为"观察一周"。**该结论不完整**——即使开关打开，由于时间戳取值错误，`cited` 仍恒为空，success **永远**不会产出。观察一周只会得到 0。

**success 零产出的完整三因**：
1. `memoryHubEnabled` 门控（M8-3 今日已开，已消除）
2. **`recentEvidenceForSuccess` 时间戳取值错误（结构性，阻断）** ← P9a 附带发现，已实证
3. 5 分钟窗口 vs consolidation 周期（~30 分钟）不匹配（**稀疏性**，需在 2 修复后实测判断）

**裁决：立即补 P9d 修复段**（1 行 + 断言），见 `FIX-AGENT-P9d.md`。**本段优先级高于一切观察类动作。** 窗口是否放宽，待 P9d 用真实数据给出 5/30 分钟命中量级后再定，**不在 P9d 内改**。

## 六、给执行侧的一句提醒

P9 报告整体质量高（实测复现、三选一框架、理想触发场景清单），**唯一需要纠正的是 success 的根因**——`createSuccessEvidencePre` 早已接好且不依赖 procedure 交集，它没产出的真正原因是"开关今天才开 + 5 分钟窗口稀疏"。后续修复段据此调整，不必做「扩匹配面」。
