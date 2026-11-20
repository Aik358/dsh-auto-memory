# Codex 任务书 · P3-A2 · U3a-3：影子必须用**真实身份**（修 D4）

前置：U3a-2 已交付并经 Lead 复核 —— 接线（gate/落点/无渲染改动/无新键/回执有界/降级/观测出口）**全部通过**；但复核发现 **D4：影子重写了实体的身份标识，导致它会在「真实路径会失败」的数据上报告成功**。本任务只修这一点。

## 1. D4 证据（Lead 实测，不可辩驳）

构造两个身份塌缩的 checkpoint（真实存在过的缺陷形态：`checkpointId` 字面量 `'unknown'`，其余字段相同）：

```
真实路径：
  adaptEvents → sourceRef: ["event:evt_collapse",
                            "event:evt_collapse:checkpoint:unknown",
                            "event:evt_collapse:checkpoint:unknown"]
  bindUnits   → id 重复
  selectUnits → 抛 UnitPolicyError('duplicate-id')          ← on 模式会失败

影子路径（当前 unit-shadow.js）：
  buildUnitShadow → computed: true, selected: 3,
                    unitIds: ["...checkpoint:shadow-checkpoint-0-0",
                              "...checkpoint:shadow-checkpoint-0-1", ...],
                    degradations: []                          ← 报告成功
```

原因：`unit-shadow.js` 里的三个投影函数（`eventIdentityProjection` :93、`portraitIdentityProjection` :111、`calendarIdentityProjection` :119）把真实身份替换成 `shadow-*`。

**这正是本批次最该被观测到的缺陷类别**（cp:unknown 身份塌缩是本项目已记录的既有缺陷）。影子把它抹掉，等于「仪表保证绿灯」——比没有影子更危险，因为 U3b 的决策要依赖这份数据。

## 2. 修法

### 2.1 删除三个身份投影（用真实数据）

- 删 `eventIdentityProjection` / `portraitIdentityProjection` / `calendarIdentityProjection`，调用处直接传原对象：
  `adaptEvents({ events: source.events })`、`adaptPortrait({ portraitItems: source.portraitItems })`、`adaptCalendar({ entries: source.calendarEntries })`。
- 元数据（`id/checkpointId/sourceRef/idemKey/opId`）**一个字段都不许改写**。
- 若真实数据有身份塌缩 ⇒ `selectUnits` 会抛 `duplicate-id`，被现有 `catch` 转成 `computed:false` + `degradations:[{source:'selection',code:'duplicate-id'}]`。**这就是期望行为。**

### 2.2 `rulesInput` 的合成必须显式披露

`extractRulesLayerPre` 的输出可能没有 document revision，因此 `rulesInput` 目前合成 `refresh-local-v*` 与若干下标。要求：

- 若条目自带 `revision`（字符串且非空）⇒ **用真实值**；
- 凡发生合成（revision 或 entryIndex/itemIndex/segmentIndex 缺失被补）⇒ 回执 `degradations` 追加一条
  `{ source:'rules', code:'rules-identity-synthesized', message:'rules revision/segment tuple synthesized for shadow' }`；
- 该披露**不置 computed:false**（真实规则源本就可能缺元数据），但必须可见。

### 2.3 不得为了让测试过而回退

- 不允许把 `duplicate-id` 改成 warning；
- 不允许在 `bindUnits`/`selectUnits` 里加「影子专用」去重分支。

## 3. 允许改动（三个文件）

| 文件 | 动作 |
|---|---|
| `lib/injection/unit-shadow.js`（LF） | 删三个投影 + rules 合成披露 |
| `tests/smoke/smoke-test-batch3-unit-shadow.mjs`（LF） | 新增 S-11/S-12/S-13 + MV-05/MV-06 |
| 回执 | 新建 |

**不得**改 `lib/index.js`（接线已验收；改了就要重钉 r26）、`lib/client.js`、`unit-adapters.js`、`unit-policy.js`、生成器、配置键。

## 4. 新增用例

- **S-11 身份塌缩必须变红**：两个 checkpoint 均 `checkpointId:'unknown'` 且其余相同 ⇒ `computed:false`，`degradations` 含 `code:'duplicate-id'`，且 `counts.selected` 不因失败而被伪造成 0（保留真实计数或按现有实现口径，需在回执说明）。
- **S-12 真实身份不得被改写**：真实 store 夹具（含 2–3 个有 id/checkpointId/sourceRef 的 checkpoint）⇒ `unitIds` 中 checkpoint 条目**不含 `shadow-` 子串**，且等于 `events:checkpoint:event%3A<eventId>%3Acheckpoint%3A<checkpointId>` 形状（按 adaptEvents 实际编码断言，不硬编码猜测）。
- **S-13 真实数据常规路径**：上述夹具 + rules/plan/handoff/portrait/calendar 正常 ⇒ `computed:true`、`degradations` 中**不含** `duplicate-id`、`counts.raw` 覆盖 checkpoint 数量。
- **S-14 rules 合成披露**：喂缺少 `revision` 的 rules 条目 ⇒ `degradations` 含 `rules-identity-synthesized`，但 `computed:true`。

## 5. 新增变异

- **MV-05**：把 `checkpointId` 改写成 `shadow-*`（即恢复旧投影）⇒ S-11 必红（computed 变 true）。
- **MV-06**：删掉 rules 合成披露 ⇒ S-14 必红。
- 既有 MV-01..MV-04 保留并重跑。

## 6. 验收出口

1. `node --check` 两个文件。
2. 影子套件 ⇒ **14 PASS / 0 FAIL**（S-01..S-14），变异 **6/6 CAUGHT / 0 MISSED**。
3. `batch3-unit` 两套件仍 **32/0** 与 **35/0**。
4. 全量回归 ⇒ **FAIL 0**（TIMEOUT 单跑复验）。
5. `verify-docs` ⇒ **22 / 87 / 182**（配置键不变）。
6. `r26` ⇒ **26/0 且锁值不变**（本任务不改 `lib/index.js`；若改了就说明越界，返工）。
7. `lib/client.js` sha256 与开工前相同。

## 7. 回执

`docs/internal/RECEIPT-BATCH3-U3A-3-REAL-IDENTITY-20261120.md`：修复前后对同一塌缩夹具的**真实 vs 影子对照输出**（贴原始 JSON）、S-11..S-14 结果、MV-05/MV-06 证据、物理量、未做项（on/deliveryModule/宿主仍未做）。
