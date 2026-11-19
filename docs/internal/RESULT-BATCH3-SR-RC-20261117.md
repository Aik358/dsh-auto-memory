# 批次3 · B3-SR + B3-RC 实施结果（来源聚合与规则完整读取）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-37）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`973d1155`**（未 commit / 未 push）
> 依据：L1 §4.1 / §4.2、L2 §4
> **只在 `lib/injection/` 新增模块并接已有 facade**：未改 `lib/index.js`、真实记忆、前端、19387。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| **B3-RC** `readRulesAggregatePre` | **已实现**，含 `candidatePath`/`ownerSessionId`/`sessionKey`/`readFile` 全注入 |
| **B3-SR** `readInjectionSourcesPre` | **已实现**，rules 委托 RC，其余 5 通道注入式 reader |
| 覆盖 | user+project 双层；rule/note/candidate/reference/retired **五类分别计数** |
| 不可读 | **不静默为空**（EPERM ⇒ `unreadable` + 显式 warning） |
| 旧 CAS 兼容 | 保留层内 `entryIndex`/`itemIndex`/`revision`，**不造跨层统一索引** |
| 验收 | 本单元 **64 PASS / 0 FAIL**；变异 **6/6 CAUGHT** |
| 回归 | **419 PASS / 0 FAIL** |
| `lib/index.js` | **零改动**（`E6C6C2944A068164`、导出 41 守恒） |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改** |
| `lib/rules-layer.js` | 44899 | 740 | `CF946F54D7D2643F` | **未改**（复用其解析） |
| `lib/injection/index.js` | 1755 | 77 | `1A28C6CACA3F3C51` | 改（+SR/RC 导出） |
| `lib/injection/dto.js` | 15834 | 337 | `E721E73BBB152313` | 未改 |
| `lib/injection/errors.js` | 2399 | 65 | `9BF29079EC239AAA` | 未改 |
| `lib/injection/profile.js` | 2540 | 56 | `E82A0ED5944302B4` | 未改 |
| `lib/injection/ports.js` | 3814 | 100 | `E9C78C401FD4C6D7` | 未改 |
| `lib/injection/read-rules.js` | 13655 | 312 | `AEC04DE28EFE4406` | **新建** |
| `lib/injection/read-sources.js` | 7152 | 158 | `43715318C06B0B57` | **新建** |
| `tests/smoke/smoke-test-batch3-sources.mjs` | 12912 | 216 | `8B7962181ABB4DF5` | **新建** |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 13223 | 153 | `97CAD7C25A026F26` | 改（判据重钉） |

**`lib/index.js` 与开工基线逐字节一致**：2,185,452B / 30,050 行 / `E6C6C2944A068164` / 导出 **41**。
**`lib/rules-layer.js` 未改**：44,899B / `CF946F54D7D2643F` —— 复用其既有解析，不另造一套。

新增模块：`read-rules.js` **13,655B / 312 行** + `read-sources.js` **7,152B / 158 行** = **20,807B / 470 行**。

---

## 2. B3-RC：`readRulesAggregatePre`（L1 §4.2 逐条）

### 2.1 签名（照抄 L1 §4.2）

```text
readRulesAggregatePre({userFile, notesPath, candidatePath, ownerSessionId, sessionKey, readFile})
  → {rules, candidates, references, retired, counts, chars, proofs, warnings}
```

**全部 6 个参数均为调用方注入**；`userFile`/`notesPath` 可缺省，`readFile` 缺失即显式降级。

### 2.2 实现要点（逐条对应契约）

| 契约条款 | 落地 |
|---|---|
| userFile/notesPath **可缺省** | 缺省 ⇒ `status=missing`（不是 unreadable，更准确） |
| candidatePath/ownerSessionId/sessionKey/readFile **由调用方注入，不从全局状态猜** | 全部从入参取；`readFile` 缺失**不 fallback 到真实 fs** |
| 覆盖 user+project 完整有效正文与多行限定 | 复用 `splitMemoryEntriesPre` + `splitRuleItemsPre`，正文原样保留 |
| rule/note/candidate/reference/retired **分别计数** | `counts` 含五类 + `byLayer.user`/`byLayer.project` 分列 |
| 区分「两条 bullet」与「一条多行规则」 | 复用既有 `splitRuleItemsPre` 的 **`<2 bullet 不拆`** 硬约束 |
| 保留层内 index/expect/revision 与跨层 CAS 拒绝 | 每条带 `layer` + `entryIndex`/`itemIndex`/`segmentIndex` + `revision`；**无跨层统一索引** |
| 候选**不因措辞自动升格** | 候选层产出一律 `kind:'candidate'`；含语境标记 ⇒ `candidate` 而非 `rule` |
| owner/session 缺失保留边界，**不跨会话读取** | `ownerBoundary.crossSessionRead` **恒为 false** + `owner-session-missing` 降级 |
| revision(user) 与 revision(project) **不同命名空间** | `revisions:{user, project}` 分别给出，不合并 |
| 只读，不改现有写入 | 全程无写操作；测试断言「调用前后夹具字节不变」 |

### 2.3 ★ 实施中发现并修复的一个真实缺陷

**问题**：既有 `splitRuleItemsPre` 在「**< 2 个 bullet**」时**不拆分**（这是向后兼容硬约束，保证单 bullet 条目渲染逐字不变）。于是「一条规则 + 一行（说明）」会整块返回、`kind` 一律 `rule`。

**实测症状**：project 层那条 `（说明）这条是说明，不冒充硬约束` **没有进入 note**，反而被我的整块分类器判成 `candidate` ⇒ `note` 计数恒 0、`candidate` 虚高。

**修法**：**不改 `rules-layer.js` 的公开语义**（那会影响既有 21 个套件），改在 RC 层做**只读细分** —— 新增 `splitItemSegments()`，把每个 item 的正文按「语境行」（`（说明）`/`说明：`/`注：`/`例如`/`所谓`/`历史`/`曾经`/`原文`/`引用`/`参考`）切成多片区，语境行起归 `note`，其前仍按 `rule` 判。

**修后实测**：`counts.rule=3, counts.note=1`，说明行正确归入 note 且**原文完整保留**（不剔除、不丢字）。

### 2.4 读取四态（L1 §4.1「不得静默转空」）

| 情形 | 判定 | warning |
|---|---|---|
| 路径未提供 | `missing` | 无（这是合法的「没有」） |
| 文件不存在（`ENOENT`） | `missing` | `read-failed` |
| 权限/IO 失败（`EPERM` 等） | **`unreadable`** | `read-failed` + `recoverable` |
| 读到全空白 | `empty` | 无 |
| 读到非字符串 | `invalid` | `invalid-content` |
| **未注入 `readFile` 但给了路径** | **`unreadable`** | `readfile-not-injected` |

> **两种「没有」被严格区分**：未给路径 = `missing`；给了路径但读不了 = `unreadable`。这是本轮实测后修正的语义（初版把两者混为 unreadable）。

---

## 3. B3-SR：`readInjectionSourcesPre`（L1 §4.1）

### 3.1 签名与来源

```text
readInjectionSourcesPre({paths, state, policyVersion, readFile, rules})
  → {rules, events, plan, handoff, reflections, logs, proofs, warnings}
```

| 来源 | 提供方式 |
|---|---|
| `rules` | **委托 B3-RC**（不重写解析；L1 §4.1 明确「rules 来自 B3-RC」） |
| `events` / `plan` / `handoff` / `reflections` / `logs` | 注入式 reader（`{reader:()=>string}`）或 `{path}` + 注入 `readFile` |

**不要求 Prototype 作数据源、不新增事实源** —— 全部来源都是调用方注入。

### 3.2 返回

- 每个通道：`{status, text, proof, relativePath?, sourceIdentity?}`
- `proofs`：合并 `rules.user` / `rules.project` / `rules.candidate` 与各通道 proof
- `statuses`：逐通道四态 + `statuses.rules` 为 RC 的三层状态
- `warnings`：所有降级（含从 RC 透传的）

### 3.3 双口径指纹（raw / normalized）

**实测证据**：对含 CRLF 的输入，`rawSha256 ≠ normalizedSha256`；对纯 LF 输入两者相等（正确行为）。测试用**两条断言**分别锁定：

```js
// 纯 LF：两口径相等是正确的（不是缺陷）
ok(p.rawSha256.length === 64 && p.normalizedSha256.length === 64, ...)
// 含 CRLF：必须真的不同 ⇒ 证明两个口径独立可算
ok(q.rawSha256 !== q.normalizedSha256, ...)
ok(sr2.plan.text === '# 白板\n- 当前任务\n', '返回 text 已归一化为 LF')
```

---

## 4. 接入既有 facade

`lib/injection/index.js` 新增 6 个导出（37 → **43**）：

`readRulesAggregatePre` · `RULE_LAYERS` · `READ_STATUS` · `readInjectionSourcesPre` · `createSourcesPort` · `SOURCE_CHANNELS`

`INJECTION_CONTRACT_INFO` 同步更新：

```js
implements: ['contract-only', 'B3-SR', 'B3-RC']
doesNotImplement: ['B3-CA','B3-PJ','B3-RP','B3-BD','B3-FM','B3-NT','B3-EV','B3-CO']
```

**DI 联验**：`createSourcesPort(() => input)` 经 `createPortRegistry` + `callPort` 调用成功，返回 `InjectionSources`；缺 `rules`/`cadence`/`projection` 三个 port 时 `describePortCoverage().missing === 3`。

---

## 5. 隔离变异：6/6 CAUGHT

变异全在 `.tmp-srrc/` 副本内（完整复制 lib/tests/tools/package.json），**验收后已删除**，逐项完整还原（复原校验 `true`）。

| # | 变异动作 | 期望 | 实测 | 判定 |
|---|---|---|---|---|
| **M1** | `EPERM` 也当成 `missing`（静默转空） | 四态断言红 | **PASS 64→62 / FAIL 0→2** | ✅ CAUGHT |
| **M2** | 去掉 `readFile` 注入检查（fallback 空） | 注入断言红 | **64→62 / FAIL 2** | ✅ CAUGHT |
| **M3** | 两个 `revision` 合并成同一命名空间 | 命名空间断言红 | **64→63 / FAIL 1** | ✅ CAUGHT |
| **M4** | `crossSessionRead` 改成 `true`（跨会话读） | 边界断言红 | **64→63 / FAIL 1** | ✅ CAUGHT |
| **M5** | 说明行不切片（`note` 恒 0、误判 candidate） | 计数断言红 | **64→62 / FAIL 2** | ✅ CAUGHT |
| **M6** | reader 抛错静默成空 text | 负路径断言红 | **64→62 / FAIL 2** | ✅ CAUGHT |

---

## 6. 套件实跑（HEAD `973d1155`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-sources.mjs`（本单元） | 0 | **64** | 0 |
| `smoke-test-batch3-contract.mjs`（判据已重钉） | 0 | **76** | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **419** | **0** |

### 6.1 ★ 两个计数锁重钉（判据过期，非回归缺陷）

`smoke-test-batch3-contract.mjs` 首跑出现 **2 FAIL**，归因为**判据过期**（产品有意演进）：

| 断言 | 原判据 | 实测 | 归因 | 处置 |
|---|---|---|---|---|
| 导出符号数 | `=== 37` | **43** | SR/RC 新增 6 个导出（36+RESERVED=37，37+6=43） | 重钉为 43，并在注释里记完整演进链 36→37→43 |
| `doesNotImplement` | `length === 4` | **8** | SR/RC 已实现并移出列表 | 改判据为「**仍未实现**的模块必须显式列出」，不再锁长度 |

> 按项目纪律：带计数锁的仓库，锁红先归因「真缺陷」或「判据过期」。此处属**后者**，且**未放宽**判据强度（第二条反而更严格：从「数长度」改为「必须含 CA/PJ」）。

---

## 7. 未验边界与如实声明

1. **未被生产接线**：`lib/index.js` **没有** `import` `lib/injection/`。本批只交付可独立调用与验收的模块，**不代表注入链路已切换**。
2. **未做真实 HOST**：未启隔离 `DSH_HOME`、未访问 19387、**未读写任何真实记忆文件**（全部用注入式夹具）。
3. **未跑全量回归 / `--impact-run`**：只跑 6 个相关套件（419 PASS）。
4. **未验证真实 user/project 文件的解析结果**：夹具覆盖了多行、说明行、retired、候选四类形态，但**未对仓库外真实 MEMORY.md / 项目笔记做对照**。
5. **`expect` 字段未实现**：L1 §4.2 提到「保留 applyRuleEditPre 的层内 index/expect/revision」，本模块提供 `index`/`revision` 与层内定位键，但 **`expect` 值需由调用方从既有 `applyRuleEditPre` 取**，RC 只读、不生成 expect。
6. **跨层 CAS 拒绝未在本模块重实现**：该语义仍在既有 `applyRuleEditPre` 中；本模块**不复制、不替换**它（避免两套 CAS）。
7. **SR 的 5 个非规则通道只做透传与四态判定**：不做内容解析（那是各自 Reader 的职责，本批未实现）。
8. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 8. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/read-rules.js` | **新建**：B3-RC 完整实现（13,655B / 312 行） |
| `lib/injection/read-sources.js` | **新建**：B3-SR 完整实现（7,152B / 158 行） |
| `lib/injection/index.js` | 改：接入 SR/RC 导出（37→43） |
| `tests/smoke/smoke-test-batch3-sources.mjs` | **新建**：独立验收（64 断言） |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 改：2 处计数锁重钉 |
| `artifacts/_batch3-sr-rc-20261117/` | fingerprints / mutations / suite-runs / MANIFEST |
