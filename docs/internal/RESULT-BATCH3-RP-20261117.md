# 批次3 · B3-RP 实施结果（规则呈现）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-39）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`4492070f`**（未 commit / 未 push）
> 依据：L1 §4.5、L2 §6
> **只在 `lib/injection/` 新增模块 + 接 facade**：未接 `lib/index.js`，**未改 `lib/rules-layer.js` 公开语义**，未实施 BD/FM/NT/EV/CO。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| **B3-RP** `renderRulesForTierPre` | 已实现，签名 `({rules,tier}) → {text,counts,chars,mode}` |
| 契约条目 | **5/5 全部落地**（摘要指针 / human_full 完整正文 / note 中性前缀 / legacy 少给 / snapshotSlimMaintain 仅 human_slim） |
| 施工中实测发现并修复**3 个真实缺陷** | 见 §3（note 整类丢失 / 前缀重复 / 双列表前缀） |
| 验收 | 本单元 **66 PASS / 0 FAIL**；隔离变异 **11/11 CAUGHT** |
| 回归 | **599 PASS / 0 FAIL** |
| `lib/index.js` | **零改动**（`E6C6C2944A068164`、导出 41 守恒） |
| `lib/rules-layer.js` | **零改动**（`CF946F54D7D2643F`）—— 公开语义未动 |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改** |
| `lib/rules-layer.js` | 44899 | 740 | `CF946F54D7D2643F` | **未改**（约束） |
| `lib/injection/render-rules.js` | 8214 | 184 | `380494E200F4F4CA` | **新建** |
| `lib/injection/index.js` | 2307 | 106 | `8AAE9CDB06E2D5A8` | 改（接入 RP） |
| `lib/injection/cadence.js` | 16545 | 318 | `DE7BBDC9FA6CABCA` | 未改 |
| `lib/injection/projection.js` | 9741 | 215 | `99CBCD08996A128D` | 未改 |
| `tests/smoke/smoke-test-batch3-rules-render.mjs` | 16855 | 230 | `DC33C19AED9DC6F9` | **新建** |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 15383 | 182 | `931CCF8237730FE0` | 改（RP 登记为已实现） |

---

## 2. 契约逐条落地（L1 §4.5 / L2 §6）

### 2.1 摘要档一行指针

| tier | `mode` | 行数 | `counts.rendered` | 输出 |
|---|---|---|---|---|
| `slim` | `pointer` | **1** | **0** | `（规则已按摘要档省略：完整正文用 memory_rules op=list）` |

断言锁：恰好一行、不含任何规则正文、`rendered===0`、**空规则时不产空指针**。

### 2.2 human_full 完整有效正文（不只首行、不逐条 200）

| 断言 | 实测 |
|---|---|
| 多行限定的**最后一条**（第6条）出现 | ✅ |
| 全文**不含省略号 `…`** | ✅ |
| **不含截断指针** | ✅ |
| 最长条目的**末行**完整出现 | ✅（该条 > 200 字，能区分是否截断） |

> 对照：`run_slim` 每条恰好一行、不展开多行限定，且字符数显著小于 `full`。

### 2.3 note 保留中性前缀（不冒充硬规则）

| 断言 | 实测 |
|---|---|
| note 行带「（说明）」 | ✅ |
| **恰好一个**前缀（不重复拼接） | ✅ |
| note 行首严格为 `- （说明）` | ✅ |
| 硬规则行**不带**中性前缀 | ✅ |
| **无前缀的 note 正文 ⇒ 实现主动补** | ✅（证明不是靠正文自带，见 §3.2） |
| 无前缀的 rule 正文 ⇒ **不补**前缀 | ✅ |

### 2.4 legacy 少给

| 断言 | 实测 |
|---|---|
| 非 legacy 全量渲染 10 条 | ✅ |
| legacy 只渲染前 `LEGACY_MAX_ITEMS=3` 条 | ✅ |
| `counts.omittedLegacy=7` 如实报数 | ✅ |
| 第 10 条只在非 legacy 出现 | ✅ |
| 输出显式说明「另有 N 条未展开」 | ✅ |

### 2.5 snapshotSlimMaintain 只在 human_slim

| tier | `snapshotSlimMaintain` | `mode` | 含维护块 |
|---|---|---|---|
| `human_slim` | **true** | `slim-maintain` | **是** |
| `run_slim` | false | `slim` | **否** |
| `human_full` | false | `full` | 否 |

### 2.6 retired 不进有效规则

| 断言 | 实测 |
|---|---|
| `retired=true` 条目被排除 | ✅ |
| `status=retracted/superseded` 被排除 | ✅ |
| **仅** `retired=true`（status=current）也被排除 | ✅（独立判据，不靠 status 兜底） |
| **仅** `status=superseded`（retired=false）也被排除 | ✅ |
| `counts.excludedRetired` 如实报数 | ✅ |

---

## 3. ★ 施工中实测发现并修复的 3 个真实缺陷

这三个不是设计取舍，是**写的时候没想到、被测试逼出来的**。每一个都有对应的回归变异（D1/D2/D3）锁住。

### 3.1 D1：note **整类丢失**（最严重）

**现象**：首轮跑 `note 条目带中性前缀` 断言时 `(未找到)`，`counts.note=0`。

**根因**：B3-RC 的聚合结果**把 note 单独放在 `notes` 字段**，`rules` 数组里**只有 kind='rule'**。

```js
// RC 实测返回
rc.rules = [ {kind:'rule', text:'- 必须用单引号写 Windows 路径'} ]
rc.notes = [ {kind:'note', text:'（说明）这条是说明，不冒充硬约束'} ]   // ← 不在 rules 里！
```

原实现只读 `rules` ⇒ **note 一条都渲染不出来** ⇒ L1 §4.5「note 保留中性前缀」这条契约在**输出上根本无法成立**。

**修法**：合并 `rules + notes` 再过滤。

### 3.2 D2：前缀**重复拼接**

**现象**：修完 D1 后立刻暴露 —— 渲染出 `- （说明）（说明）这条是说明…`。

**根因**：RC 的 `notes[i].text` **本身已经带「（说明）」**（`rules-layer` 的 `splitRuleItemsPre` 打的），实现又无条件加一次。

**修法**：仅在缺失时补（`isNote && !body.startsWith(NOTE_PREFIX)`）。

> **连带教训**：这个缺陷在第一版测试里**抓不到** —— 因为夹具的 note 正文自带前缀，
> 「实现加的」与「正文自带的」在输出上无法区分。补了**不带前缀的 note 夹具**后才有区分力（见 §4.1）。

### 3.3 D3：双列表前缀 `- - xxx`

**现象**：渲染出 `- - （说明）…`（两个短横）。

**根因**：RC 的 note 文本以 `- ` 开头，渲染时又加了一次 `- `。

**修法**：渲染前剥掉正文自带的列表前缀。

### 3.4 附带：过滤逻辑双写 → 收敛为单一函数

发现 `{rules:[...]}` 数组路径与 RC 对象路径**各自内联了一遍** retired/status 过滤。两份逻辑迟早改一处漏一处，已收敛到唯一的 `filterEffective()`。
（这个问题是在变异 M4 反复 MISSED 时被顺藤摸出来的，见 §4.2。）

---

## 4. 隔离变异：11/11 CAUGHT

变异全在 `.tmp-rp*` 副本内，**已全部删除**，逐项完整还原（复原校验 `true`）。

| # | 变异动作 | 实测 | 判定 |
|---|---|---|---|
| **D1** | 只读 `rules` 不合并 `notes`（原缺陷） | 66→61 / FAIL 5 | ✅ CAUGHT |
| **D2** | 无条件加前缀（重复前缀） | 66→65 / FAIL 1 | ✅ CAUGHT |
| **D3** | 不去列表前缀（`- - `） | 66→65 / FAIL 1 | ✅ CAUGHT |
| M1 | `human_full` 逐条 200 截断 | **66→60 / FAIL 6** | ✅ CAUGHT |
| M2 | 摘要档也渲染正文 | **66→60 / FAIL 6** | ✅ CAUGHT |
| M3 | 维护块误入 `run_slim` | 66→62 / FAIL 4 | ✅ CAUGHT |
| M4 | `retired` 不排除 | 66→64 / FAIL 2 | ✅ CAUGHT |
| M4b | `status` 过滤失效 | 66→63 / FAIL 3 | ✅ CAUGHT |
| M5 | legacy 不少给 | 66→62 / FAIL 4 | ✅ CAUGHT |
| M6 | note 不补前缀 | 66→64 / FAIL 2 | ✅ CAUGHT |
| M7 | 非法档位静默降级 | 66→64 / FAIL 2 | ✅ CAUGHT |

### 4.1 ★ 两个「首轮 MISSED」的归因（都是**测试侧**问题）

| 变异 | 首轮 | 归因 | 处置 |
|---|---|---|---|
| D2/M6（前缀） | MISSED | **夹具自带前缀** ⇒ 「实现加」与「正文自带」输出无法区分 | 补**不带前缀的 note 夹具**，断言改为「行首严格 `- （说明）` + 恰好一个前缀」；D2、M6 均 CAUGHT |
| D3（`- - `） | MISSED | 断言只查 `includes('这条是说明')`，`- - xxx` 也满足 ⇒ **断言太弱** | 补「全文无任何 `- - ` 行」+ 行首严格断言；CAUGHT |

### 4.2 ★ M4「MISSED」的两次归因（都不是产品缺陷）

| 轮次 | 现象 | 归因 | 处置 |
|---|---|---|---|
| 第 1 轮 | MISSED | **变异打错位置**：只改了 `effectiveRulesOf`（对象路径），而 `{rules:[...]}` 走的是**另一份内联过滤** ⇒ 变异无效 | 顺带发现**过滤逻辑双写**，收敛为 `filterEffective()` |
| 第 2 轮 | 仍 MISSED | **变异被短路掩盖**：夹具 `retired:true` **同时** `status:'superseded'` ⇒ 删掉 retired 检查后 status 检查仍挡住它，两条判据互为兜底 | 补「**仅** retired（status=current）」与「**仅** status」两条独立夹具，使各判据成为唯一拦截面；CAUGHT |

> 这三条合起来是一条可复用的判据：**变异 MISSED 先查三件事** —— ①变异是否真改了生效代码路径；②断言是否有区分力；③是否被其它并列判据短路兜底。**三种都不是产品缺陷**，但都让验证失真。

---

## 5. 套件实跑（HEAD `4492070f`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-rules-render.mjs`（本单元） | 0 | **66** | 0 |
| `smoke-test-batch3-cadence-projection.mjs` | 0 | 97 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | **93** | 0 |
| `smoke-test-batch3-sources.mjs` | 0 | 64 | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **599** | **0** |

### 5.1 结构性判据**再次证明有效**（不是又一次人工重钉）

contract 套件本轮红 2 条，红得**正确**：

| 断言 | 提示 |
|---|---|
| 「未实现单元符号必须 0 泄漏」 | `泄漏: renderRulesForTierPre` |
| 「B3-RP 仍在 doesNotImplement」 | 实现与声明不一致 |

这两条正是上轮把计数锁改结构性时设计的**一致性检查**：实现落盘了但契约声明没跟 ⇒ 真红。
处置：把 `B3-RP` 从「未实现」移到「已实现」，并在 `REQUIRED_BY_UNIT` 登记其 4 个关键符号。**没有改判据形态、没有放宽强度**。

---

## 6. 未验边界与如实声明

1. **未接生产入口**：`lib/index.js` **没有** import `lib/injection/`。RP 是可独立调用与验收的纯呈现函数，不代表注入链路已切换。
2. **未改 `lib/rules-layer.js`**：其公开语义（含 `renderRulesSectionPre`、`ruleSummaryPre` 的 200 截断、`RULE_NOTE_PREFIX_PRE_V1`）**逐字节未动**（`CF946F54D7D2643F` 不变）。RP 只**引用**其措辞与产出，不替换它。
3. **`NOTE_PREFIX` 是复制常量而非 import**：值与 `rules-layer` 的 `RULE_NOTE_PREFIX_PRE_V1` 相同，但**未做运行时绑定**。若上游改值，两边会漂移 —— **未加漂移检测**（可考虑后续加一条跨模块一致性断言）。
4. **`LEGACY_MAX_ITEMS=3` 是本模块约定值**，**未与既有 legacy 路径实际取数条数核对**。
5. **`SUMMARY_POINTER` / `SLIM_MAINTAIN_BLOCK` 措辞是本模块新写**，未与既有注入文案做一致性核对，也**未验证用户是否容易理解**。
6. **指针「能回读两层完整内容」未端到端验证**：L2 §6 要求「指针能回读两层完整内容」，本单元只验证了指针**文本上给出处**（`memory_rules op=list`），**未真正调用该工具回读**。
7. **未做真实 HOST**、未读写真实记忆、未跑全量回归 / `--impact-run`。
8. **未验证 `human_full` 与既有 `renderRulesSectionPre` 的输出差异**：两者都会产生「- 规则」行，但**是否应当完全一致未定案**（RP 有意不逐条 200 截断，与既有行为不同）。
9. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 7. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/render-rules.js` | **新建**：B3-RP（8,214B / 184 行） |
| `lib/injection/index.js` | 改：接入 RP（**56→63** 导出，+7） |
| `tests/smoke/smoke-test-batch3-rules-render.mjs` | **新建**：66 断言（16,855B / 230 行） |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 改：RP 登记为已实现 |
| `artifacts/_batch3-rp-20261117/` | fingerprints / mutations / suite-runs / MANIFEST |


## Lead复核修订

- legacy 改为只给指针（含 tier=legacy），不重新引入完整规则条目；slim/run_slim/human_slim 不渲染规则正文，human_slim 额外携带维护块。
- NOTE_PREFIX/TRUNC_POINTER 改为从 rules-layer 导入，避免双写漂移。
- human_slim 支持调用方注入真实 maintainText；默认仅作兼容提示，生产接线须传 DEFAULT_PROMPT_LAYERS.snapshotSlimMaintain。
- 支持 post_compact/handoff_carry/hang_compensate 完整档。
- Lead复跑相关八套件601 PASS/0 FAIL；未做真实HOST/全量，未接生产入口。
