# 裁定 · P3-A2 · U3a 影子接线的三个阻塞问题（2026-11-20）

依据：U3a Phase 0 测绘回执 `docs/internal/RECEIPT-BATCH3-U3A-SHADOW-20261120.md`，并经 Lead 逐条回源码复核（本文件 §1 为复核记录）。

## 1. Lead 复核：测绘结论**成立**，且比任务书假设更不利

| 测绘主张 | 我回源核对的证据 | 结论 |
|---|---|---|
| 入口无结构化六源 | `lib/index.js:24172` 只有 `snap = renderMemoryDynamic(context)`；:24012-24017 拿 config 与 `stateFor(agent)` | 成立 |
| events 只留文本投影 | :10427 `const events = …` 是局部；:10430 写 `state.eventCardsText`；:10442 写 `slimEventT1`；:10438-10440 注释明确「不写 `state.events`，会长期驻留 100+ 检查点」 | 成立 |
| 诊断段在 renderer 内 | :13702-13709 在 `renderMemoryDynamic` 内 `pushPart('otherDynamic','diagnostic',…)` | 成立 |
| full/slim 两候选 | :24172 生成 `snap`；:24194-24204 先把档位降为 slim；:24205 生成 `slimText`；最终选谁在更下游 | 成立 |
| 预算为 renderer 局部 | :13716 `budgetChars` 局部；:12980 `_slimBudget`；:12982 `_fullTierBudget`；callback 只读得到 `config.injectBudgetChars`(:920) | 成立 |

**并且**：我原以为「preview 端点已有统一 sources」——回源后也不成立。`lib/index.js:29242-29256` 的 sources 是**文本拼装**（`eventCardsText`/`planText`/`latestHandoffText`/`calendarText`），只有 rules 是真 aggregate。⇒ 两条路径都没有结构化 events/portrait DTO。

⇒ 任务书「影子直接吃六源 DTO、并把行注入诊断段」的前提**推翻**。执行者停手而非造桥，处理正确。

## 2. 三条裁定

### R1：sources 由哪一层提供 ⇒ **refresh 内就地消费，不新增常驻 DTO**

- 计算点放 `refreshEventStatePre()`（:10415 起）：这里 events 是局部、`picks`、`userPercept`、rules aggregate、`planText`、`latestHandoffText` 全在同一帧可用。
- **不**把六源 DTO 存进 state（原因见 :10438-10440 的既有裁决：常驻内存代价）。ry
- **只**存**有界回执** `state._unitShadowPre`：字段见 §3，序列化 ≤ 4 KB，最多 40 个 unitId；不含任何正文。
- 失败语义：任一步异常 ⇒ 回执 `computed:false` + `degradations`，refresh 照常结束（refresh 是 fire-and-forget 热路径，绝不因影子抛错）。

### R2：receipt 如何同步传进 renderer ⇒ **U3a 不传**（放弃往诊断段插行）

- 往 renderer 诊断段插行需要跨层传参或后处理字符串，两种都脆弱；而诊断段本身是 **renderer 内部**产物（:13702）。
- ⇒ U3a 的观测面改为**已存在的只读端点**：`POST /preview`（:29230 起）响应增加 `unitShadow` 字段（读 `runtime.state._unitShadowPre`）；`debugInfo()` 同源追加。
- 收益：**注入正文一个字节都不变**（比「只在诊断块内加一行」更强），且不需要改 renderer/诊断逻辑。
- 诊断行如仍需要，留到 U3b 与 on 接管一起做（那时本就要改 renderer 组装）。

### R3：shadow 按最终投递帧还是按候选 ⇒ **U3a 按单一显式假设，不跟两候选**

- refresh 发生在档位判定之前（:24035 fire-and-forget vs :24160 档位），**物理上**拿不到本轮最终 tier。
- ⇒ shadow 以 `phase = 'human_full'`、`budget = config.injectBudgetChars` 计算，并在回执里写 `assumed:{phase,budget,reason:'refresh-before-tier'}`。
- **不**对 full/slim 各算一遍（两候选没有共同精度收益，只是双倍成本与双份歧义）。
- 精确帧级影子/接管属 U3b：届时 renderer 按单位组装，tier 已在手。

## 3. 回执形状（U3a 唯一新增的跨层数据）

```js
{
  version: 1,
  computed: true,            // false = 降级（见 degradations）
  at: 1700000000000,          // 仅观测用，不参与选择
  assumed: { phase: 'human_full', budget: { jsChars: 8000, utf8Bytes: 24000 }, reason: 'refresh-before-tier' },
  covered: ['events','rules','plan','handoff','portrait','calendar'],
  counts: { raw: 0, selected: 0, deferred: 0, rejected: 0 },
  cost: { jsChars: 0, utf8Bytes: 0 },
  truncatedBy: 'budget' | 'quota' | null,
  budgetOvercommit: false,
  unitIds: [],                // ≤ 40，形如 'events:event:event:evt_x'
  degradations: [{ source: 'events', code: 'invalid-source', message: '...' }]
}
```

## 4. 对 U3a 任务书的修订（覆盖原 §2/§3/§4 冲突处）

1. **取消**新增 `unitPolicyMode` 配置键（不新增键 ⇒ 182 不变、无锁变更）。
2. **门槛**：仅当 `policy.modules.diagnostics.enabled === true` 时计算（diagnostics 本就是诊断/观测开关，语义对齐；默认关闭 ⇒ 零开销）。
3. **取消**诊断段插行（见 R2）。
4. 新增观测出口：`POST /preview` 响应 `unitShadow` + `debugInfo().unitShadow`。
5. `on` 接管与 `deliveryModule` 明确留 U3b，不在本任务出现。
