# 批次3 · U2 公共契约实施结果（DTO / profile / 依赖注入）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-36）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`0dbe3ef8`**（未 commit / 未 push）
> 依据：L1 契约 §5.1/§5.2/§9、L2 细则 §3
> **只建公共契约**：未实现 SR/RC/CA/PJ 业务模块，未改 `lib/index.js`、前端、生成器，未触 19387。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| 8 个 DTO | **全部实现**，真构造 + JSON 往返 + 冻结 |
| profile | **单一 `policyVersion`**，无平行版本字段 |
| 依赖注入 facade | 5 个 port，**缺 port 显式降级** |
| 非法/版本不符 | **显式抛 `InjectionContractError`**（非静默纠正） |
| 套件 | **75 PASS / 0 FAIL**（仅本单元） |
| 隔离变异 | **5/5 CAUGHT** |
| `lib/index.js` | **零改动**（sha16 `E6C6C2944A068164`，导出 41 守恒） |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | 未改 |
| `lib/injection/index.js` | 1505 | 65 | `56DA797B13E97F98` | 新建 |
| `lib/injection/dto.js` | 15834 | 337 | `E721E73BBB152313` | 新建 |
| `lib/injection/profile.js` | 2540 | 56 | `E82A0ED5944302B4` | 新建 |
| `lib/injection/ports.js` | 3814 | 100 | `E9C78C401FD4C6D7` | 新建 |
| `lib/injection/errors.js` | 2399 | 65 | `9BF29079EC239AAA` | 新建 |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 12436 | 142 | `B8C30730F365F3E3` | 新建 |

**`lib/index.js` 与开工基线逐字节一致**：2,185,452B / 30,050 行 / `E6C6C2944A068164` / 导出 **41**。

**`lib/injection/` 合计**：**26092B / 623 行**（index 1,505 + dto 15,834 + profile 2,540 + ports 3,814 + errors 2,399 = 26092B，逐文件求和可复算）。

---

## 2. 8 个公共 DTO（L1 §5.1 逐条落地）

| DTO | 字段（照抄 L1 §5.1） | 构造器 |
|---|---|---|
| **SourceProof** | sourceRef、bytes、rawSha256、normalizedSha256、revision | `makeSourceProof` |
| **ProjectionCandidate** | id、kind、bucket、priority、text、sourceIdentity、contentVersion | `makeProjectionCandidate` |
| **ContentSpec** | §4.4 所列 14 段枚举 + 预算/来源字段 | `makeContentSpec` |
| **CadenceDecision** | tier、fullGranted、slimAllowed、grants、reasons、requestKey | `makeCadenceDecision` |
| **PreparedNotification** | id、version、payload、commitToken | `makePreparedNotification` |
| **FinalizeReceipt** | requestId、textSha256、selectedNotificationIds、preparedVersions、hostObservation | `makeFinalizeReceipt` |
| **DeliveryReceipt** | requestId、finalizedText、selectedNotificationIds、committed、skipped、errors | `makeDeliveryReceipt` |
| **HostDeliveryObservation** | requestId、projected、retained、observedAt、evidenceRef | `makeHostDeliveryObservation` |

### 2.1 ContentSpec 的 14 个段（逐字照抄 L1 §4.4）

| 段 | 合法值 |
|---|---|
| `rules` | none / pointer / summary / full |
| `plan` | none / core / full |
| `handoff` | none / sections / full |
| `events` | none / cards / cards+catalog |
| `portrait` | none / short / full |
| `semantic` | none / full |
| `logs` | none / tail / full |
| `calendar` | none / current / full |
| `externalMemory` | none / full |
| `workspaceMap` | none / brief / full |
| `recentLogs` | none / tail / full |
| `reflection` | none / recent / full |
| `diagnostic` | none / brief / full |
| `maintenance` | none / slim-maintain |

**契约要求的强约束**：14 段**全部必填** —— 缺任一段即 `missing-field` 报错，**不允许各模块自填默认值**（防止「各写一套默认」）。

---

## 3. ★ 实施中发现并修复的一个真实设计缺陷

### 问题：DTO 判别字段与业务字段**撞名**

L1 §5.1 规定 `ProjectionCandidate` 有业务字段 **`kind`**。而 DTO 通用外壳原本也用 `kind` 作**类型判别字段**：

```js
// 原实现
function buildDto(kind, fields) {
  const out = { kind, schemaVersion: 1 };   // ← 判别值
  for (const k of Object.keys(fields)) out[k] = fields[k];  // ← 业务 kind 覆盖它
  return deepFreeze(out, kind);
}
```

**实测症状**：`makeProjectionCandidate({kind:'rules', …})` 返回的 `kind` 是 **`rules`**（业务值），判别身份**丢失**；`JSON 往返保持身份` 断言随之失败。

### 修法：判别字段改名 `dtoKind`，并把**保留字段检查**前移到入口

```js
export const RESERVED_FIELD_NAMES = Object.freeze(['dtoKind', 'schemaVersion']);

function requireObject(value, field) {
  /* …类型检查… */
  for (const k of RESERVED_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(value, k)) {
      fail(INVALID_ARGUMENT, 'field name reserved by contract: ' + k, { field: k });
    }
  }
  return value;
}
```

**为什么检查要放在 `requireObject` 而不是 `buildDto`**：各 DTO 只把**白名单字段**传给 `buildDto`，若只在 `buildDto` 检查，调用方塞进来的 `dtoKind` 会被白名单**静默丢弃**，看起来「没拒绝」⇒ 检查形同虚设。这个坑是本轮实测踩到的（第一版就放在 `buildDto`，对应断言 FAIL）。

**修后实测**：`{dtoKind:'ProjectionCandidate', kind:'rules', …}` —— 判别身份与业务值**各自独立**。

---

## 4. profile：单一 `policyVersion`（L1 §5.2）

| 字段 | 取值域 |
|---|---|
| `policyVersion` | **单一版本号**（=1；不符即 `version-mismatch`） |
| `sourceIdentity` | 非空字符串 |
| `tier` | full / slim / run_slim / human_slim / human_full |
| `budgetUnit` | **js-chars / utf8-bytes**（`token` **刻意不开放**） |
| `representationVersion` | 非空字符串 |
| `degradePolicy` | explicit / silent-none |

**两条刻意的拒绝**（均有负路径断言）：

1. **不建平行版本字段** —— 不导出 `promptVersion`/`inputNormalizationVersion` 等；测试断言 `!('promptVersion' in prof)`。
2. **`budgetUnit: 'token'` 被拒** —— L1 §4.7 明确「token 未实测不得冒称」，故不开放该枚举值。

---

## 5. 依赖注入 facade：缺 port **显式降级**

| port | 职责 | 本批是否实现业务 |
|---|---|---|
| `sources` | B3-SR 全来源读取 | ❌ 仅留接口 |
| `rules` | B3-RC 规则完整读取 | ❌ 仅留接口 |
| `cadence` | B3-CA 帧节奏 | ❌ 仅留接口 |
| `projection` | B3-PJ 投影 | ❌ 仅留接口 |
| `clock` | 时钟（测试可注入，避免真实时间进断言） | ✅ 纯注入点 |

**核心语义**（契约要求）：

```js
const r = callPort(registry, 'sources', [])
// 缺 port ⇒ **不抛异常、不返回 undefined**，而是：
// { ok: false, value: null, degradation: { code: 'port-missing', scope: 'sources', recoverable: true } }
```

**与「静默跳过」的区别有断言锁死**：`missingCall.ok === false`、`missingCall.value === null`（不是 `undefined`）、`degradation.code === 'port-missing'`、`degradation.scope === 'sources'`。

port 自身抛错 ⇒ 包装为 `injection-degraded` 契约错误并**保留原 message**（不吞）。

---

## 6. HostDeliveryObservation：不得伪造 `hostDelivered`

L1 §5.1 原文：「未观测时明确 unknown，**不得伪造 hostDelivered**」。落地：

| 检查 | 实测 |
|---|---|
| `makeUnknownHostObservation()` 默认值 | `projected:'unknown'`、`retained:'unknown'` |
| DTO 中是否存在 `hostDelivered` 字段 | **不存在**（断言 `!('hostDelivered' in obs)`） |
| `projected:'delivered'` | **被拒**（`invalid-enum`，只允许 unknown/projected/retained） |

---

## 7. 隔离变异：5/5 CAUGHT

变异全部在 `.tmp-u2/` 副本内（完整复制 lib/tests/tools/package.json），**验收后已删除**。

| # | 变异动作 | 期望 | 实测 | 判定 |
|---|---|---|---|---|
| **M1** | `deepFreeze` 改成直接 `return`（不冻结） | 冻结断言红 | **PASS 75→66 / FAIL 0→9** | ✅ CAUGHT |
| **M2** | 缺 port 时返回 `ok:true`（静默通过） | 降级断言红 | **PASS 75→73 / FAIL 0→2** | ✅ CAUGHT |
| **M3** | 去掉 `policyVersion` 不符检查 | 版本断言红 | **PASS 75→74 / FAIL 0→1** | ✅ CAUGHT |
| **M4** | 未观测默认成 `projected`（伪造语义） | unknown 断言红 | **PASS 75→73 / FAIL 0→2** | ✅ CAUGHT |
| **M5** | 去掉保留字段 `dtoKind` 检查 | 保留字段断言红 | **PASS 75→74 / FAIL 0→1** | ✅ CAUGHT |

**变异体逐项完整还原**，复原校验 `true`（两文件字节一致）。

---

## 8. 套件实跑（HEAD `0dbe3ef8`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-contract.mjs`（本单元） | 0 | **75** | 0 |
| `smoke-test-batch3-cb.mjs`（回归） | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs`（回归） | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs`（回归） | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs`（回归） | 0 | 90 | 0 |
| **合计** | — | **354** | **0** |

> 新增 `lib/injection/` **不影响**既有套件：`lib/index.js` 未 import 它，导出数仍 41。

---

## 9. 未验边界与如实声明

1. **契约层未被生产接线**：`lib/index.js` **没有** `import` `lib/injection/`。本批只建契约，**不代表任何目标 API 已可用**（L1 §9 末句）。
2. **未实现任何业务模块**：`sources`/`rules`/`cadence`/`projection` 四个 port **只有接口没有实现**，调用一律返回 `port-missing` 降级。
3. **未做真实 HOST**：未启隔离 `DSH_HOME`、未访问 19387、未改生产配置或真实记忆。
4. **未跑全量回归 / `--impact-run`**：只跑 5 个相关套件（354 PASS）。
5. **`ContentSpec` 的语义正确性未验**：只验证了「14 段存在 + 枚举合法 + 缺段报错」，**未验证某个具体组合投影出的内容是否正确**（那属 B3-PJ 实现，本批不提前做）。
6. **`preparedVersions` 的键语义未约束**：当前接受任意字符串键 + 非负数值，**未与 `selectedNotificationIds` 做一致性校验**（属 B3-NT 实现范围）。
7. **未验证 `budgetPolicy.cap` 的实际计量**：只规定 `cap` 可为 `null`（未定）或非负数值，**不实现预算**（属 B3-FM）。
8. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 10. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/index.js` | 包入口（37 导出） |
| `lib/injection/dto.js` | 8 个 DTO 构造器 + 校验助手 + ContentSpec 枚举表 |
| `lib/injection/profile.js` | 单一 `policyVersion` profile |
| `lib/injection/ports.js` | 5 port 的 DI facade + 缺 port 显式降级 |
| `lib/injection/errors.js` | `InjectionContractError` + 错误码 + 降级构造 |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 75 断言（含负路径与内置变异） |
| `artifacts/_batch3-u2-20261117/` | fingerprints / mutations / suite-runs / MANIFEST |
