# 2.3 模型独立复核、仲裁与困难负样本闭环（2026-11-16）

> 执行依据：`docs/internal/PROMPT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`
> 隔离目录：`artifacts/_event-attribution-review-20261116/`
> 性质：**模型复核闭环**，不是双人复核，不是 human-reviewed 金标，**未训练、未接入生产**。
> `trainingNotRun: true`
> 说明：`artifacts/_*` 在本仓 `.gitignore`（第 39 行）内，故隔离目录不出现在 `git status`；产物已实际落盘，路径见 §10。

## 0. 结论

1. **闭环按 Prompt 的六条验收全部执行完毕**：每个 case 有 A/B/仲裁三份独立上下文记录、输入指纹、输出与仲裁理由；困难负样本经独立复核；来源证据与归属证据分开；四态/closed/跨语言/多候选/无正确候选均有明确结果。
2. **标签等级 = `model-reviewed-v1`**。`sameModelDifferentContexts: true`；`humanReviewers: 0`；`humanConfirmed: 0`。**不得**把本批结果当作双人复核或人类金标，也不满足原训练门的双人复核条件。
3. **A/B 一致率 19/20，但一致不等于正确**：仲裁后与 benchmark 弱金标一致仅 **10/20**。一致错误的集中区是 `protocolConflict`（5/5 全不一致）和 `originTimeReplay`（4/5 不一致）。
4. **本轮最重要的发现不是模型对错，而是评测基线本身有两个缺陷**（见 §4）：
   - **记录原文在存储层跨事件重复**：14/20 case 的记录正文与其 provenance 检查点完全相同；**15/20** case 的某个可见候选在记录时刻前已存有同文检查点。在 `protocolConflict` 5 例上，这份同文副本落在白板事件上，而标签要求 `ambiguous`——与存储事实相反，模型 attach 是**有证据支持的**，不能记为模型误判。
   - **benchmark 的 `protocolConflict` 金标是协议构造，不是可验证归属**：由"历史弱标签 vs 另一事件同文"生成，本身无独立来源验证（`sourceVerified=0/20`）。
5. **困难负样本的严格结果是 8 条探针中 6 条期望可证、3 条通过、3 条失败，独立失败 2 条**：三条失败（`adv_01`、`adv_06`、`adv_07`）全部是"在没有任何候选存储同文的情况下仍然 attach"；其中 `adv_01` 与 §4.3 的 `case_origin_82c7d74c5cd1` 是同一场景复现，**净独立失败 = `adv_06`（跨语言误并）+ `adv_07`（伞事件误 attach）**。另有 2 条探针的期望标签在证据上不可证，按 Prompt §3.3 不计入负样本。详见 §5。
6. 本批**零真实写入、零合并、零归档、零生产启用**；五个上游源文件 SHA-256 逐一复验未变。

## 1. 隔离、身份与输入指纹

| 项 | 实测值 |
|---|---|
| 工作区 | `D:/dsh-auto-memory` |
| 开工 Git HEAD | `512559c0e20c6b8ef663cb8761a8cfc896e079d4`（未提交本次产物） |
| 隔离目录 | `artifacts/_event-attribution-review-20261116/` |
| 模型 provider | `worldcodes.online/v1`（OpenAI 兼容） |
| 模型 | `deepseek-v4.1-flash`，`temperature=0`，`response_format=json_object` |
| 同一模型不同上下文 | **是**（每次请求 stateless，无对话历史复用；A/B/仲裁/构造者互不可见） |
| 原始响应 | 93 份，**解析失败 0** |
| 累计 token | 1,085,567 |
| 累计单请求耗时 | 3,654,614 ms |

**provider 选择说明（如实记录）**：`~/.zcode/cli/config.json` 中登记的 `dshapi` provider 在开工时对该 key 返回 `401 INVALID_API_KEY`（`https://api.dshapi.icu`）；`new-provider-3/4`、`opencode.ai` 亦不可用（502/404/MissingSessionID）。可用的 OpenAI 兼容端点是 `worldcodes.online/v1`，本批全部模型调用走该端点。**未能**复现教师轮使用的 `dshapi-kimi/kimi-k3.1-pro` 身份，因此本批模型身份与教师轮**不同**，不能直接当作同模型复现。

### 输入指纹

`inputs/manifest.json` 记录五个上游源文件的路径、字节数与 SHA-256：

| 文件 | SHA-256（前 12） | 复验 |
|---|---|---|
| `artifacts/_event-attribution-teacher-20261113/cases/benchmark-v4.json` | `25a1724dc0ff` | 未变 |
| `artifacts/_event-attribution-teacher-20261113/teacher/inputs.json` | `5ab14f0099e5` | 未变 |
| `artifacts/_event-attribution-teacher-20261113/cases/split-manifest-v4.json` | `05a96f43a3eb` | 未变 |
| `artifacts/_event-attribution-teacher-20261113/results/training-gate.json` | `c1e84a00a663` | 未变 |
| `artifacts/_event-attribution-teacher-20261113/review/review-queue-v4.json` | `93669ad44afe` | 未变 |

每个 case 的 pack SHA-256 见 `inputs/manifest.json` 的 `packSha256`；角色输出各自记录：

- `inputSha256`：该角色实际收到的完整 user prompt 哈希；
- `evidencePackageSha256`：**内容相同、与候选顺序无关**的证据包哈希（A/B 必须相同）；
- `presentationOrderSha256`：候选呈现顺序哈希（A 为别名升序，B 循环左移一位，用于避免同温度下完全同构的复述）；
- `systemPromptSha256`：角色系统提示词哈希。

**输入等价性校验**：20/20 case 的 A/B `evidencePackageSha256` 完全相同；`packLeaks: []`（pack 内无 `evt_` 真 ID、无 gold/labelVersion/needsReview/duplicateFamily/teacher 字样）。

## 2. 角色与隔离执行

| 角色 | 上下文 | 输入内容 | 目录 |
|---|---|---|---|
| 复核者 A | 全新独立请求 | 证据包（候选别名升序） | `roles/reviewerA/` |
| 复核者 B | 全新独立请求 | 同一证据包（候选顺序轮转） | `roles/reviewerB/` |
| 仲裁者 | 全新独立请求 | 同一证据包 + A/B 原始输出（`parsed` + `parseError`） | `roles/arbiter/` |
| 对抗构造者 | 本 Agent 自身会话 | base pack + 冻结事件库 | `adversarial/` |
| 跨语言翻译 | 独立请求 | 正文 + 候选名/摘要 | `cross-language/raw-translation/` |

**别名机制**：每个 case 内所有 `evt_` 标识（正文、候选名/摘要、证据片段）统一替换为 `cand_` + `sha256(salt|caseId|realId)[:6]`，salt 仅存在于脚本中。别名跨 case 不复用，候选清单按别名排序，**不允许**模型按真实 ID 顺序"认出"答案。

**禁止项执行情况**：

- 教师答案、benchmark gold、历史弱标签、`evaluationGroup`、`needsReview`、`duplicateFamily`、`split` 一律不出现在任何角色输入中（`gold-provability.json`、`labels/hidden.json` 只在本地汇总使用）。
- 候选清单外 ID：仲裁者与本批校验器均按 `eventId ∈ 候选别名` 校验，越界即 `invalid`。
- closed 追加：协议文本显式写明"attach-existing 只能指向 active 候选"，并在校验器中作为协议项检查。
- 输出中禁止 `human-reviewed`：仲裁器输出只允许 `model-reviewed | needs-human-review`，校验器对 `human-reviewed` 直接判非法。

## 3. 基础 case 复核结果

### 3.1 总量

| 指标 | 值 |
|---|---:|
| case 数 | 20 |
| **独立事件数** | **6** |
| **重复族数** | **16** |
| A 合法输出 | 20/20 |
| B 合法输出 | 20/20 |
| 仲裁合法输出 | 20/20 |
| A/B 决策+eventId 完全一致 | 19/20 |
| A/B 原始文本逐字相同 | **0/20** |
| 仲裁 `model-reviewed` | 19 |
| 仲裁 `needs-human-review` | 1 |
| 与 benchmark 弱金标一致（A/B/仲裁） | 10 / 10 / 10 |
| `sourceVerified=true` | 0 |
| `attributionVerifiedBy=model` | 19（1 为 `unresolved`） |

> **样本量口径**：20 个 case 只覆盖 6 个事件、16 个重复族，不能当 20 条独立证据。分组报告见下。

### 3.2 分组结果

| 组 | case | 独立事件 | A 与弱金标一致 | 说明 |
|---|---:|---:|---:|---|
| `historicalWeak` | 5 | 1（`evt_89786878`） | 4/5 | 同一事件 5 条视图；1 条因"唯一匹配候选 closed"被判 not-applicable |
| `protocolClosed` | 5 | 1（`evt_dfc30819`） | **5/5** | 唯一候选 closed，全部正确判 not-applicable |
| `protocolConflict` | 5 | 1（`evt_89786878`） | **0/5** | 全部 attach 到 umbrella 事件，弱金标要求 ambiguous |
| `originTimeReplay` | 5 | 5 | 1/5 | 4 条 attach 到同文 umbrella 事件，1 条判 ambiguous |

### 3.3 错例逐条（10 条，其中仅 3 条可确证为模型误判）

| case | 组 | 弱金标 | A/B/仲裁 | 判定 |
|---|---|---|---|---|
| `case_main_6e39d6902bdc` | conflict | ambiguous | attach `evt_89786878` | 见 §4.2 |
| `case_main_7aeacd25d4b2` | conflict | ambiguous | attach `evt_89786878` | 同上 |
| `case_main_8b4d657ea03e` | conflict | ambiguous | A/仲裁 attach，B not-applicable | 同上，A/B 首次分歧 |
| `case_main_b4e8badfe9ce` | conflict | ambiguous | attach `evt_89786878` | 同上 |
| `case_main_b89490a23995` | conflict | ambiguous | attach `evt_89786878` | 同上 |
| `case_main_a82e6858a824` | historicalWeak | attach `evt_89786878` | not-applicable | **模型推理确有缺陷**：只看到"唯一主题匹配候选 closed"，未继续核对另一个 active 候选（该项目白板事件正是这条记录的归属事件，且是 active） |
| `case_origin_45da70f9df26` | origin | create-new | attach `evt_89786878` | **真实误判**：白板候选只与正文结构相似（最高 50-gram 覆盖 0.308），不含该正文；模型以"白板是跨线汇总"推断归属 |
| `case_origin_82c7d74c5cd1` | origin | create-new | attach `evt_89786878` | **真实误判**：真实起源事件 `evt_761ad9ff` 被 LOO 隐藏，候选内无同文副本（唯一精确容器是隐藏事件本身）；模型据"白板检查点早 11 秒"归属 |
| `case_origin_a82e6858a824` | origin | create-new | not-applicable | 与 `case_main_a82e6858a824` 同正文同缺陷 |
| `case_origin_fb54a10808d6` | origin | create-new | A/B attach `evt_882dee05`，仲裁 ambiguous | 候选 `evt_882dee05` 存有本条交付的摘要（6 个共同指纹），但正文不被完整复刻（覆盖 0.052）。属**跨任务误并**：候选讲 issue 模板，正文讲 Super-agent B 卷（见 §4.4、§5.3） |

## 4. 本轮关键发现（评测基线的缺陷，不是模型失败）

### 4.1 记录正文在多个事件中重复存储（14/20）

`validation/gold-provability.json` 用确定性方法核对冻结库：

- **14/20** case 的正文**就是其 provenance 事件的检查点原文**（`ownership.exactSameText = true`）。这本身是 data leak：如果该检查点作为候选证据暴露，归属就退化为字符串匹配。
- 构建 pack 时已加入**自我泄漏过滤器**（正文 40-gram 覆盖率 > 0.35 的候选片段被丢弃），因此 A/B 的**可见**输入中不含完整正文副本。
- 记录正文与其 provenance 检查点**完全相同**的 case：**14/20**。
- **存储层跨事件同文**：**15/20** case 的某个可见候选在记录时刻前已存储同文检查点。按组拆解：
  - **`historicalWeak` 5 条**：持有正文的候选**正是 gold 的 attach 目标**——这是"记录属于该事件"的正面证据，模型 attach 正确；
  - **`protocolConflict` 5 条**：持有正文的是**白板事件**，而 gold 要求 `ambiguous`——与存储事实相反（见 §4.2）；
  - **`protocolClosed` 5 条**：持有正文的就是那个 **closed 事件本身**——与 gold 的 `not-applicable`（closed 不可追加）一致，模型正确。

> 关键差别：**"候选复刻了正文"应当支持 attach，而不是支持 create-new。** 因此 §4.2 的 5 个 `protocolConflict` case 上，`ambiguous` 标签与存储事实冲突。

### 4.2 `protocolConflict` 金标是协议构造，不是可验证归属

这 5 个 case 的 gold 由"历史弱标签 + 另一事件同文"构造为 `ambiguous`，本身没有独立来源验证。而实际存储中：

| case | 可见候选含记录正文 | containment |
|---|---|---|
| `6e39d6902bdc` | `cand_669fd6`（项目白板） | 1.000 |
| `7aeacd25d4b2` | `cand_c6658f`（项目白板） | 1.000 |
| `8b4d657ea03e` | `cand_34893f`（项目白板） | 1.000 |
| `b4e8badfe9ce` | `cand_325101`（项目白板） | 1.000 |
| `b89490a23995` | `cand_c3dc98`（项目白板） | 0.955 |

即：模型 attach 到的白板事件**当时确实已收录这段正文**。把它们记为"模型判错"不成立；更准确的结论是**这 5 条 conflict 视图不适合作为歧义金标**，除非把"同文跨事件"本身定义为数据缺陷并先修复。

### 4.3 可确证的模型误判（3 条）

| case | 现象 | 归属证据 |
|---|---|---|
| `case_origin_82c7d74c5cd1` | 记录是 `evt_761ad9ff` 的起源检查点（LOO 隐藏），候选中无任何事件存储这段正文 | 唯一精确容器是被隐藏的真实事件；`duplicateOwners: []` |
| `case_origin_45da70f9df26` | 白板候选只与正文结构相似（最高 50-gram 覆盖 **0.308**） | `duplicateOwners: []`；白板摘要写的是别的批次进度 |
| `case_main_a82e6858a824` / `case_origin_a82e6858a824` | 真正的归属事件 `evt_89786878` 是 **active** 且就是该记录的容器，模型却判 `not-applicable` | 该事件 cp0 与正文完全相同（`ownership.exactSameText: true`） |

前两条是**基于时间邻近/等级结构的过度归属**；后一类是**"只核对了 closed 候选就停下"**：模型确实看了另一个 active 候选（`cand_db2af2`），但只比对了候选**摘要**（"511/0/0、§2.x"）与正文（"482 PASS、H3"）的进度数字，就断定不是同一目标，没有追问"该 active 事件是否已收录这条记录"。这是可复现的推理缺陷，最值得在下一代提示词或分类器中针对性修正。

### 4.4 上游数据污染实例

`evt_882dee05`（GitHub issue 模板事件）的 cp7 存的是**另一个任务**（Super-agent B 卷取证）的交付摘要：`task-2（B 卷）交付：artifacts/superagent-iteration-20261031/B-prototype-mechanisms.md，384 行 / 31,181 B / sha256 d255d04f…bf798f`。

- 它与 B 卷记录正文**并非同文**（50-gram 包含度 **0.052**），因此**不构成**"同文即归属"的证据支持。
- 但它含**6 个与正文共享的指纹**（`384`、`31,181`、`d255d04f` 等），足以让模型认定"同一交付物"（见 `adv_06` 的 `identifier`/`sourceRef` 证据）——这是**真实的、可解释的误并**，不是数据幻觉。
- 上游卫生问题成立：**把别的任务的交付摘要挂进本事件检查点**，会让任何归属器（模型或规则）把后续记录误吸到该事件。冻结库应先做"跨任务内容审计"再用于评测/训练。

## 5. 困难负样本闭环

`adversarial/` 下 8 条探针，覆盖 Prompt 要求的四类并额外两类。**判读不采用"构造者自定期望"**，而是用 `validation/adversarial-evaluation.json` 的确定性规则重新判定期望标签是否可证：

- `create-new` 仅在**没有**可见候选在记录时刻前存储同文时成立；
- `not-applicable` 仅在候选集合内**无 active 目标**时成立；
- `attach-existing` 仅在存在同文候选时成立；
- `ambiguous` 仅在**同时**存在 closed 同文与 active 同文（协议构造）时成立；
- 不可证的探针标 `evidence-insufficient`，**不进入通过/失败统计**。

### 5.1 统计（严格口径）

| 指标 | 值 |
|---|---:|
| 探针总数 | 8 |
| 期望标签可证 | **6** |
| 期望标签不可证 | 2（`adv_05`、`adv_08`） |
| 三角色全对 | **3**（`adv_02`、`adv_03`、`adv_04`） |
| 三角色全错 | **3**（`adv_01`、`adv_06`、`adv_07`） |
| 其中独立失败（非复现） | **2**（`adv_06`、`adv_07`） |
| 部分正确 | 0 |
| 诱饵被三角色一致选中 | **1**（`adv_06`） |
| 诱饵被任一角色选中 | 2（`adv_06`、`adv_07`） |

### 5.2 逐条

| probe | 类型 | 模式 | 期望 | 可证？ | A | B | 仲裁 | 结论 |
|---|---|---|---|---|---|---|---|---|
| `adv_01` | same-template | existing | create-new | 可证（无候选同文） | attach（无证据） | attach | attach | **全错** |
| `adv_02` | multi-valid | decision-only | attach | 可证（有同文目标） | attach | attach | attach | **全对** |
| `adv_03` | closed | existing | not-applicable | 可证（无 active） | ✓ | ✓ | ✓ | **全对** |
| `adv_04` | cross-language | replace | create-new | 可证（无候选同文） | ✓ | ✓ | ✓ | **全对** |
| `adv_05` | wrong-explicit-id | existing | ambiguous | **不可证** | attach（有证据） | not-applicable | ambiguous | 证据不足 |
| **`adv_06`** | cross-language | replace | create-new | 可证（无候选同文） | **attach 诱饵** | **attach 诱饵** | **attach 诱饵** | **全错（真阳性）** |
| **`adv_07`** | no-valid | existing | create-new | 可证（无候选同文） | **attach 诱饵** | **attach 诱饵** | ambiguous | **全错（真阳性）** |
| `adv_08` | wrong-explicit-id | record-patch | ambiguous | **不可证** | attach（有证据） | attach（有证据） | attach（有证据） | 证据不足 |

### 5.3 关键判读

- **3 条真失败（`adv_01`、`adv_06`、`adv_07`）全部表现为"选中了没有存储证据的候选"**：三个角色的 A/B/仲裁 pick 在冻结库中的同文包含度均为 0，即属于时间/主题邻近驱动的过度归属，不是被同文诱导。
- **`adv_06` 我一度误判为"诱饵含同文、attach 有证据"，复核后推翻**：诱饵 `evt_882dee05` 的 cp7 只是 B 卷交付的**摘要描述**，与正文 50-gram 包含度仅 **0.052**，不构成同文。因此这条是**真实的跨任务/跨语言误并**：中文正文 vs 英文候选，模型被"同日 + 同一交付文件路径 + 相同 sha 前缀 `d255d04f` / 相同行数字节数（384 行 / 31,181 B）"带走。**其证据链本身是真的**（诱饵 cp7 确实记录了这批交付物的摘要），错的只是"记录摘要出现在某事件的检查点里 ⇒ 记录属于该事件"这一步推断。这也是本批最有价值的负样本，且它暴露的是**上游检查点归属卫生问题**：别人的交付摘要被挂进了 issue 模板事件的检查点。
- `adv_05`、`adv_08` 的期望 `ambiguous` 在证据上不可证（记录确有同文容器），按 Prompt §3.3 **不得当负样本**。

**重复族隔离与独立性**：8 条探针各自基于 8 个不同 base case。但 `adv_01` 与 §4.3 的 `case_origin_82c7d74c5cd1` 是**同一场景的复刻**，**不能**当成第 4 条独立失败证据；它是"同一误判在负样本口径下再次出现"的**复现**，恰好说明该缺陷稳定可重。`adv_06`/`adv_07` 分别与 `case_origin_fb54a10808d6`/`case_origin_45da70f9df26` 同源，只与自身 base 同族，无跨 split（manifest §7）。

**净独立失败数：2**（`adv_01` 判为复现、不重复计数；`adv_06`＝跨语言误并；`adv_07`＝伞事件误 attach）。

**真实负样本 vs 构造负样本分开报告**：本批**真实负样本 0 条**（没有人工确认的错误标签）；构造负样本 8 条，其中可证 6 条、通过 3 条、失败 3 条。**不得**把 8 条当覆盖量，也不得把 3 条失败说成"模型整体不可用"——它们集中在"无同文证据时仍倾向 attach"这一具体模式。

## 6. 跨语言子集

3 条 zh→en 变体（正文 + 候选名/摘要翻译，标识/时间/状态不变）：

| case | 方向 | 翻译 QA | 基础决定 | A | B | 仲裁 | 是否同基础 |
|---|---|---|---|---|---|---|---|
| `xl_case_main_3ccbb3e9a98a` | zh→en | PASS | not-applicable | 同 | 同 | 同 | 是 |
| `xl_case_main_a0b39c31022a` | zh→en | PASS | attach-existing | 同 | 同 | 同 | 是 |
| `xl_case_origin_82c7d74c5cd1` | zh→en | PASS | attach-existing（错） | 同 | 同 | 同 | 是 |

翻译 QA 判据：所有 `evt_`/`cand_` 标识原样保留（0 缺失）；数字保真度 100%（允许英文数词，如 `6 个` → `Six`）。**结论：本批模型的决定对 zh→en 翻译不敏感（3/3 一致）**，但样本仅 3 条且其中 1 条基础判断本身错误，**不能据此声称跨语言稳健**。

## 7. Split manifest

`validation/split-manifest.json`：

- 16 个重复族、6 个事件，逐一列出 `family → split` 与 `eventId → split`；
- **违反数 = 0**：同一 family、同一 eventId 均未跨 split；
- 跨语言变体继承 base case 的 split（`crossLanguageViolations: []`）；
- 规则：`同一 duplicateFamily 与同一 provenance.eventId 不得跨 split；跨语言变体继承 base case 的 split。`

> 注意：本批 20 个 case **全部是 `split=test`**（教师轮已冻结的划分），本批不产生训练集，因此不存在"训练/测试共享同族"的现实风险；manifest 仅作可复算记录。

## 8. 确定性校验门

`validation/validation-report.json` 逐 case 记录 A/B/仲裁的合法性与问题清单：

| 检查项 | 结果 |
|---|---|
| JSON 解析失败 | 0 / 93 |
| 缺 rationale / 反假设 / unknowns | 0 |
| 非法 decision 枚举 | 0 |
| attach 缺合法候选别名 | 0 |
| 非 attach 携带 eventId | 0 |
| 候选清单外 ID | 0 |
| 仲裁输出 `human-reviewed` | 0 |
| 仲裁 `reviewers.length=2` 且类型=model | 20/20 |
| 仲裁复述的 A/B inputSha256 与实文件一致（机械字段审计） | 19/20 精确；1 条复述时漏 1 字符（`case_main_b89490a23995` 的 B，63 vs 64 字符），权威值取自 reviewerB 文件，原始复述值保留在 `validation/arbiter-fingerprints.json` |
| A/B 证据包哈希一致 | 20/20 |
| pack 泄漏（真 ID / gold 字样） | 0 |
| `humanReview.reviewers` 虚增 | 未发生（仍为 0） |

**来源与归属分离**：`sourceVerified=true` 为 **0/20**；`attributionVerifiedBy` 19 条为 `model`、1 条 `unresolved`。本批**没有任何** case 获得了独立来源验证，因此全部标签只是模型判断。

## 9. 停机与边界

| 项 | 值 |
|---|---|
| `trainingNotRun` | **true** |
| 真实写入 / 真实记忆写入 | 0 / 0 |
| attach / merge / archive 执行 | 0 / 0 / 0 |
| 生产 `lib/` 修改 | 0 |
| 19387 / 2.4 / 2.9 / SidecarStore 操作 | 0 |
| 上游五源文件 SHA-256 | 未变（逐一复验） |
| commit / push | 未执行 |

**是否达到"模型复核闭环完成"**：是（Prompt §5 六条逐条满足），但**不满足原训练门的双人复核**，也**不支持据此训练**。若要继续训练，必须：

1. 先修上游数据：删除跨事件同文检查点，或显式标注为"同文跨事件"并排除出 conflict 金标；
2. 由**两名独立人工复核者 + 人仲裁**重做 `protocolConflict` 与 `originTimeReplay` 两组；
3. 以修复后的真实金标重跑同一 A/B/仲裁与负样本闭环，再谈 E 臂分类器。

## 9.1 验收门

`validation/acceptance-checks.json`：**21/21 PASS**。逐项覆盖 A/B/仲裁三份记录齐备、93 份原始输出含 raw/parsed/parseError、A/B 证据包同哈希、上游五源未变、无 gold/teacher/真 ID 泄漏、无 `human-reviewed` 伪标、`humanReview.reviewers` 未虚增、无 split 违规、四类负样本齐备、跨语言 QA 通过、来源与归属分离、零生产写入、`trainingNotRun` 已记录、9 项交付物存在。

两项一度 FAIL、均已按事实处理而非放宽标准：

1. **仲裁复述指纹 1 条短 1 字符**（`case_main_b89490a23995` 的 B）。指纹是机械字段不是判断，改为从 reviewerB 文件取权威值并保留原值审计，`validation/arbiter-fingerprints.json` 记录 19 exact + 1 transcription-short + 0 mismatch。
2. **`not-applicable` 出现在存在 active 候选的 case 上**（`case_main_a82e6858a824`）。这不是完整性缺陷，而是 §4.3 已登记的**推理缺陷本身**；验收项改为"逐条列为发现"，不再当作静默通过。

## 10. 产物清单

| 路径 | 内容 |
|---|---|
| `inputs/manifest.json` | 五个源文件 SHA-256、20 个 pack SHA-256、Git HEAD |
| `inputs/packs/*.json` | 20 个去泄漏证据包（别名、截断、self-leak 过滤） |
| `labels/hidden.json` | 真实 eventId、弱金标、分组、split（**仅本地汇总用**） |
| `roles/reviewerA|reviewerB|arbiter/*.json` | 64 份基础角色输出（含 raw / parsed / parseError / 指纹 / usage） |
| `adversarial/adversarial-candidates.json` | 8 条构造候选及可证伪理由 |
| `adversarial/packs/*.json`、`expected/*.json` | 探针输入与期望（期望**不进入**评审输入） |
| `adversarial/manifest.json` | 探针清单、类型、模式、诱饵别名 |
| `roles/*-adversarial/*.json` | 24 份对抗角色输出 |
| `cross-language/raw-translation/*.json` | 3 份翻译原文 |
| `cross-language/packs/*.json`、`qa.json` | 跨语言输入与 QA |
| `roles/*-cross-language/*.json` | 9 份跨语言角色输出 |
| `validation/validation-report.json` | 全量确定性校验与逐 case 判定（含分组统计） |
| `validation/gold-provability.json` | 金标可证明性审计（§4 的证据） |
| `validation/split-manifest.json` | 重复族 / 事件 split manifest |
| `validation/adversarial-evaluation.json` | 8 条探针的**可证性**与三角色判定（严格口径） |
| `validation/arbiter-fingerprints.json` | 仲裁复述指纹的权威值对照（1 条转录短 1 字符，judgment 未改） |
| `validation/acceptance-checks.json` | 21 项验收门逐项 PASS/FAIL 与证据 |
| `scripts/01-build-packs.mjs` … `09-repair-fingerprints.mjs` | 可复算脚本 |

**模型身份记录**：每个角色输出的 `provider` 字段为
`worldcodes.online/v1 · deepseek-v4.1-flash · temperature=0 · response_format=json_object`，
`modelEcho` 为上游返回的 `deepseek-v4.1-flash`。provider API key 仅运行期从配置读取，**未写入任何产物**。

**复算方式**：

```bash
cd D:/dsh-auto-memory
node artifacts/_event-attribution-review-20261116/scripts/01-build-packs.mjs
node artifacts/_event-attribution-review-20261116/scripts/03-build-negatives.mjs
node artifacts/_event-attribution-review-20261116/scripts/04-build-cross-language.mjs   # 复用已存翻译
node artifacts/_event-attribution-review-20261116/scripts/02-run-reviewers.mjs A
node artifacts/_event-attribution-review-20261116/scripts/02-run-reviewers.mjs B
node artifacts/_event-attribution-review-20261116/scripts/02-run-reviewers.mjs arbiter
node artifacts/_event-attribution-review-20261116/scripts/05-validate.mjs
node artifacts/_event-attribution-review-20261116/scripts/06-gold-provability.mjs
node artifacts/_event-attribution-review-20261116/scripts/07-evaluate-adversarial.mjs
node artifacts/_event-attribution-review-20261116/scripts/09-repair-fingerprints.mjs
node artifacts/_event-attribution-review-20261116/scripts/08-acceptance.mjs
```

模型调用非确定性：重跑会得到不同 raw 文本与不同 `inputSha256` 里的顺序差异，但 `evidencePackageSha256` 可复算一致。**不要**用重跑来"挑一个满意的答案"。
