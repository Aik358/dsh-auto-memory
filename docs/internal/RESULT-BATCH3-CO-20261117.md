# 批次3 · B3-CO 实施结果（Consolidation 扩读取面）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-42）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`ae385676`**（未 commit / 未 push）
> 依据：L1 §4.10、L2 §9
> **只在 `lib/injection/` 新增模块 + 接 facade**：未接 `lib/index.js`，未碰真实记忆。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| **collect** | 日志 + 事件 + 白板 + 账本 + **反思**五类 + `sourceProof`；**只读** |
| **build** | prompt / counts / truncation / sourceProofs；**逐类统计字符**，**不沿用历史 12.7%** |
| **apply** | **只经注入的 writer**；USER 候选**只进待确认区**；四类失败态**零写入** |
| unreadable | **不当空来源**，三态（ok/empty/missing/unreadable）显式区分 |
| 不承担 | 事件归并 / 四段补全 / 2.4（返回值显式 `did*: false`） |
| 验收 | 本单元 **66 PASS / 0 FAIL**；隔离变异 **15/15 CAUGHT**（另剔除 2 个无效变异） |
| 回归 | **852 PASS / 0 FAIL** |
| `lib/index.js` / `lib/rules-layer.js` | **均零改动** |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改** |
| `lib/rules-layer.js` | 44899 | 740 | `CF946F54D7D2643F` | **未改** |
| `lib/injection/consolidation.js` | 15634 | 361 | `364ABDADC2F8177A` | **新建** |
| `lib/injection/index.js` | 3487 | 160 | `B9A8DCE81DB55467` | 改（接入 CO，93→101 导出） |
| `tests/smoke/smoke-test-batch3-consolidate.mjs` | 15853 | 237 | `07EE398E8F0D04AC` | **新建** |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 16114 | 188 | `A371E823B7913D5B` | 改（CO 登记 + 空清单断言） |

新增 `consolidation.js` **15,634B / 361 行**。

---

## 2. ★ 先做的存量审查（L1 §4.10 末条要求「同时审查三条路径」）

按契约要求，施工前**实测**了既有 `consolidateMemory`（`lib/index.js:19281-19392`）的实际读取面：

| 来源 | 现有 consolidateMemory 是否读取 |
|---|---|
| 日志 | ✅ `listDailyLogs` + `readTextSafe` |
| **事件** | **0 命中** |
| **白板** | **0 命中** |
| **账本** | **0 命中** |
| **反思** | **0 命中** |
| `sourceProof` | **0 命中** |

⇒ 现有实现是**日志单源**，且无来源证明。这正是 B3-CO 要补的「扩读取面」。

**已被现有实现满足的部分**（未重复造）：

| 契约 | 现有实现实测 |
|---|---|
| 超时/空正文/`(无)` 不写入 | ✅ 三条独立分支，且超时与空正文**报错可区分**（#560） |
| USER 候选不直写全局 | ✅ 落 `PENDING-USER-MEMORY.md` |

> 本模块**不替换**现有实现（未接 `lib/index.js`），只提供可独立验收的读取面 + 写入分流层。

---

## 3. collect：五类来源 + unreadable 不当空

### 3.1 四态显式区分

| 状态 | 含义 | 是否算「读到了」 |
|---|---|---|
| `ok` | 读到非空内容 | ✅ |
| `empty` | 文件存在但内容为空 | 否，但**不是错误** |
| `missing` | 未提供路径 | 否 |
| **`unreadable`** | **有路径但读不到**（无 readFile / 抛错 / 返回空值） | **否，且必须留痕** |

### 3.2 ★ unreadable 不得当空来源

| 断言 | 实测 |
|---|---|
| 通道含读取失败 ⇒ `state='unreadable'`（**不是 empty/missing**） | ✅ |
| 逐项 `unreadable` warning | ✅ |
| 通道级 `channel-unreadable` warning | ✅ |
| `counts.unreadable` 如实计数 | ✅ |
| **可读的那条仍被收进来**（不因一条失败全通道作废） | ✅ |
| 有路径但无 `readFile` ⇒ **unreadable** | ✅ |

### 3.3 sourceProof 双口径

每条可读来源产 `{sourceRef, bytes, rawSha256, normalizedSha256, revision}`。
**CRLF 夹具实测**：`rawSha256 !== normalizedSha256`（两个口径都真算，不是复制）。

---

## 4. build：统计与裁剪（不沿用历史比例）

### 4.1 ★ 逐类统计输入字符

```js
inputChars: { logs, events, plan, handoff, reflections }   // 逐类
inputTotalChars = 各类之和
promptChars = prompt.length
truncatedChars = 被裁量
truncatedRatio = truncatedChars / inputTotalChars   // **实测可复算**
```

| 断言 | 实测 |
|---|---|
| `inputTotalChars === 各类之和` | ✅ |
| `promptChars === prompt.length` | ✅ |
| 未裁剪时 `truncatedRatio === 0` | ✅ |
| **输出里不含 `0.127` / 12.7%** | ✅ |
| 裁剪时 `truncatedRatio` **可复算**（= 裁剪量/输入量） | ✅ |

> L2 §9.2 明确要求「不沿用历史 12.7%」。本模块**从不预设比例**，只算实测值；变异 C12 把 ratio 写死成 `0.127` 会被 3 条断言抓住。

### 4.2 未给预算 ⇒ 不裁剪

`capChars === null`、`truncated=false`，并进 `unresolved`（**不擅自定值**）。

### 4.3 unreadable 单列

`unreadableChannels` 显式列出；但**可读部分仍计入字符**（不因通道 unreadable 而清 0）。

---

## 5. apply：零写入与 USER 待确认

### 5.1 ★ 四类失败态零写入

| 状态 | 结果 |
|---|---|
| `timeout` | **零写入** |
| `empty` | **零写入** |
| `none`（`(无)`） | **零写入** |
| `parse-error` | **零写入** |
| 空正文（status 缺失） | **零写入** |
| 畸形分节（有头无条目） | **零写入** |

> 所有失败态下 `writer` 的三个方法调用次数均为 **0**（不只是返回 `written=[]`）。

### 5.2 ★ USER 候选只进待确认区

| 断言 | 实测 |
|---|---|
| USER 候选走 `writeUserPending` | ✅ 1 次 |
| **`writeUserGlobal` 从未被调用** | ✅ **0 次**（write 计数 2 而非 102） |
| `written` 标 `pendingConfirm: true` | ✅ |
| `skipped` 显式说明 `userGlobal` 未写 | ✅ |
| **writer 缺 `writeUserPending` ⇒ 不写、不降级到全局** | ✅（记 skipped） |

### 5.3 只经现有 writer

| 断言 | 实测 |
|---|---|
| 无 writer ⇒ **显式拒绝**（`field='writer'`） | ✅ 本层**不自带写权限** |
| writer 抛错 ⇒ `errors` 显式报错、**不谎报成功** | ✅ |

### 5.4 不承担归并/四段补全/2.4

返回值显式 `didRegroup: false` / `didSectionFill: false` / `didConsolidate24: false`，各有一条断言（变异 C15 改 true 会被抓）。

---

## 6. 隔离变异：15/15 CAUGHT（套件崩溃 0 次）

| # | 变异 | 实测 |
|---|---|---|
| **C1** | **unreadable 静默当 empty** | 66→61 / FAIL 5 |
| **C2** | **unreadable 静默当 missing** | 66→65 / FAIL 1 |
| C3 | 通道状态忽略 unreadable | 66→61 / FAIL 5 |
| C4 | unreadable 不产 warning | 66→65 / FAIL 1 |
| **C5** | **timeout 仍写入** | 66→65 / FAIL 1 |
| C6 | 空正文仍写入 | 66→64 / FAIL 2 |
| **C7** | **(无) 仍写入** | 66→65 / FAIL 1 |
| **C9** | **USER 走全局写入** | 66→64 / FAIL 2 |
| C10 | USER 缺 writer 时降级全局 | 66→65 / FAIL 1 |
| **C11** | **五类来源只读日志** | 66→53 / **FAIL 13** |
| **C12** | **build 沿用历史 12.7%** | 66→63 / FAIL 3 |
| C13 | sourceProof 缺双口径 | 66→65 / FAIL 1 |
| C14 | 未给预算也裁剪 | 66→63 / FAIL 3 |
| C15 | apply 做事件归并 | 66→65 / FAIL 1 |
| C16 | 写失败被吞 | 66→65 / FAIL 1 |

### 6.1 ★ 三个首轮 MISSED 的归因（两类问题）

| 变异 | 首轮 | 归因 | 处置 |
|---|---|---|---|
| **C5 / C7** | MISSED | **夹具被短路掩盖**：只传 `{status:'timeout'}`（不带 text）⇒ 删掉 NO_WRITE 后仍被「空正文」分支拦住 ⇒ **该状态从不是唯一拦截面** | 夹具改为**带一份可解析的有效正文**，使该状态成为唯一拦截面 → 均 CAUGHT |
| **C8 / C17** | MISSED | **变异本身无效**：删掉「解析失败」守卫后，后面 `if(projectPts.length)` / `if(userPts.length)` 两个分支也都不会进入（两者都是空数组）⇒ **产物零写入不变** | 判为**无效变异并剔除**，不计入 CAUGHT；另补「畸形分节」用例覆盖该路径 |

### 6.2 ★ 套件崩溃假象（第二次出现）

C11 首轮 `PASS=11` 看似「检出」，实为套件在 `emptySrc.reflections.length`、`[src.logs,...].map(a=>a.length)` 等**裸索引**处抛 `TypeError` 中断。

**处置**：加固 6 处断言为 `Array.isArray(...)` 保护后，C11 变为**干净的 FAIL 13**。

> 与 task-41 同一条判据：**变异导致的 PASS 骤降若伴随崩溃，不能算 CAUGHT**。本轮再次验证了它的必要性。

---

## 7. 套件实跑（HEAD `ae385676`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-consolidate.mjs`（本单元） | 0 | **66** | 0 |
| `smoke-test-batch3-events.mjs` | 0 | 86 | 0 |
| `smoke-test-batch3-final-frame.mjs` | 0 | 93 | 0 |
| `smoke-test-batch3-rules-render.mjs` | 0 | 68 | 0 |
| `smoke-test-batch3-cadence-projection.mjs` | 0 | 97 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | **99** | 0 |
| `smoke-test-batch3-sources.mjs` | 0 | 64 | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **852** | **0** |

### 7.1 结构性判据第五次发挥预期作用 —— 且**批次3 全部单元已清账**

contract 套件红 1 条且正确：`B3-CO 仍在 doesNotImplement（未实现）`。
处置：CO 移入 implements + `REQUIRED_BY_UNIT` 登记 4 符号；因**批次3 全部单元已实现**，`doesNotImplement` 变为空数组，断言改为「**清单必须为空**」（强度不降反升：将来若误加回任何单元会立刻红）。

---

## 8. 未验边界与如实声明

1. **未接生产入口**：`lib/index.js` **没有** import `lib/injection/`；既有 `consolidateMemory` **未被替换、未被修改**（`E6C6C2944A068164` 不变）。
2. **未碰真实记忆**：所有来源均为注入夹具，**未读写任何真实日志/事件库/白板/账本**。
3. **`readers` 的路径来源未接线**：本模块只接受调用方算好的 `{path}` 列表；**「从项目目录枚举五类来源」的逻辑未实现**（需复用 SR 的真实解析，未做）。
4. **`writer` 接口是本模块约定**：`writeProjectNote` / `writeUserPending` 的**真实实现未对接**，**未验证**与既有 `appendText` / `PENDING-USER-MEMORY.md` 的语义一致。
5. **`days` 参数未生效**：collect 接受 `days` 但**未做日期过滤**（由调用方在 readers 里筛好），**未验证**与实际「最近 N 天」语义一致。
6. **prompt 的正文模板未与既有 consolidate prompt 对齐**：本模块新写（含五类分节），**未逐字比对**既有 `L19293-19317` 的措辞与规则条目。
7. **裁剪策略是「保尾部」**：未与 FM 的段级/整帧预算**联验**（L2 §9.2 未强制要求，但 §8.1 对 EV 有此要求）。
8. **`(无)` 判定用 `includes`**：若模型正文里正常引用「(无)」二字会被误判为无内容 —— **这是已知的宽松判定**，未收紧。
9. **未做真实 HOST**、未跑全量回归 / `--impact-run`（只跑 11 个相关套件 852 PASS）。
10. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 9. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/consolidation.js` | **新建**：B3-CO（15,634B / 361 行） |
| `lib/injection/index.js` | 改：接入 CO（93→101 导出） |
| `tests/smoke/smoke-test-batch3-consolidate.mjs` | **新建**：66 断言（15,853B / 237 行） |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 改：CO 登记 + `doesNotImplement` 空清单断言 |
| `artifacts/_batch3-co-20261117/` | fingerprints / mutations / suite-runs / MANIFEST |


## Lead复核修订

- days按日志文件名日期过滤，clock注入；非日期命名来源保留，events/plan/handoff/reflections不按days过滤。
- `(无)`仅整行/全文标记时拒绝写入，正文正常讨论该字样不再误判。
- 未知模型状态 fail-closed，不写。
- writer真实映射/来源枚举仍属生产接线，未做真实HOST/全量。
