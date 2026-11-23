# 批次3 · B3-NT / B3-BD / B3-FM 实施结果（最终帧共同施工）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-40）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`e33f1ab1`**（未 commit / 未 push）
> 依据：L1 §4.6 / §4.7 / §4.8、L2 §7
> **只在 `lib/injection/` 新增模块 + 接 facade**：未接 `lib/index.js`，未实施 EV / CO。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| **B3-NT** prepare / finalize / commit | 只读不消费 · 插件文本与候选身份 · 幂等 + 旧版本不清新待办 + 写盘失败可重试 |
| **B3-BD** `projectHandoffPre` | 去选择前 2000 预截断 · 按节/四段选择 · 保尾部失败原因与下一步 |
| **B3-FM** `composeFinalEnvelopePre` | 先成段再计量 · **四者相等等式内部断言** · 另记 UTF-8 bytes · 候选/实际分账 |
| 未决预算 / full-slim | **不擅定**：未给 cap ⇒ 不裁剪并进 `unresolved` |
| 验收 | 本单元 **93 PASS / 0 FAIL**；隔离变异 **16/16 CAUGHT** |
| 回归 | **697 PASS / 0 FAIL** |
| `lib/index.js` / `lib/rules-layer.js` | **均零改动** |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改** |
| `lib/rules-layer.js` | 44899 | 740 | `CF946F54D7D2643F` | **未改** |
| `lib/injection/notification.js` | 11473 | 258 | `AB97F500CE5F8E9E` | **新建**（NT） |
| `lib/injection/project-handoff.js` | 9992 | 223 | `6C7224C49171C189` | **新建**（BD） |
| `lib/injection/final-frame.js` | 9008 | 208 | `E18A65E32C712705` | **新建**（FM） |
| `lib/injection/index.js` | 2795 | 132 | `88BE42338124D27F` | 改（接入三模块） |
| `lib/injection/render-rules.js` | 8725 | 189 | `4DE1F438EEEFEC3A` | 未改 |
| `tests/smoke/smoke-test-batch3-final-frame.mjs` | 19766 | 279 | `0F75E31947FF7761` | **新建** |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 15697 | 186 | `5EB5CE956F33DD9A` | 改（三单元登记为已实现） |

新增模块合计 **30,473B / 689 行**（NT 11,473 + BD 9,992 + FM 9,008）。

---

## 2. B3-NT：通知与定稿（L1 §4.8）

### 2.1 prepare 只读（**不消费**）

| 断言 | 实测 |
|---|---|
| 调用后 `scanResult` **逐字节未变** | ✅ `JSON.stringify` 前后一致 |
| **不清** `planUpdatePending` | ✅ 仍为 true |
| **不发通知** | ✅ 返回值**无** `sent` / `delivered` 字段 |
| 输出 `PreparedNotification`（id/version/payload/commitToken） | ✅ |

### 2.2 runtimeScope / sessionId 必填（**不回落默认 runtime**）

```js
// 缺 runtimeScope ⇒ 显式拒绝（field='runtimeScope'）
// 缺 sessionId    ⇒ 显式拒绝（field='sessionId'）
```

### 2.3 finalize 不冒充宿主已交付

| 断言 | 实测 |
|---|---|
| `finalizeReceipt.hostObservation.projected` | **恒 `unknown`** ✅ |
| `retained` | **恒 `unknown`** ✅ |
| 只定稿插件文本 | `text` 原样返回 ✅ |
| 记录候选身份与版本 | `selectedNotificationIds` + `preparedVersions` ✅ |
| 记录 `textSha256`（64 hex） | ✅ |

### 2.4 commit：幂等 / 旧版本不清新待办 / 写盘失败可重试

| 反例（L2 §7.4） | 实测 |
|---|---|
| 同请求重复 commit | 首次 committed=1，二次 **committed=0 / skipped=1**（幂等） |
| **旧 commit 遇新 version** | committed **=0**；存储里版本**仍是新版本**（新待办未被清） |
| **写盘失败** | `errors` 含 `store-write-failed`、**committed=0**、存储**无残留**；**重试后成功** |

### 2.5 待办 / 水位 / 授予分开

```js
splitRuntimeSignalsPre(s) → {
  pending:  { planUpdatePending },        // NT 负责
  recall:   { recallJustDelivered },      // 只由真实 Reference Tail 交付路径写入（本层只读）
  cadence:  { waterPct, fullGranted, postCompact },  // 归 CA
}
```

实测三类**互不混入**（断言 `waterPct` 不在 pending、`planUpdatePending` 不在 cadence）。

---

## 3. B3-BD：白板/账本投影（L1 §4.6）

### 3.1 ★ 去「选择前 2000 预截断」

**夹具**：白板 3,226 字，关键结论位于 **>2000** 处。

| 断言 | 实测 |
|---|---|
| 关键结论**仍在**输出里 | ✅（若先截 2000 则必丢） |
| 显式声明 `view.preTruncated2000 === false` | ✅ |

> 段级上限 `sectionCapChars` **只在选择之后**作用于已选中的节。

### 3.2 ★ 按节/四段选择，保尾部失败原因与下一步

| 断言 | full | slim |
|---|---|---|
| 保留「失败原因」 | ✅ | **✅** |
| 保留「下一步」 | ✅ | **✅** |
| 四段齐全 | ✅ | 按 `SLIM_MUST_KEEP` 优先保留 |

`SLIM_MUST_KEEP = ['type:dead-end','type:progress']` —— 这两类是 slim 的**必保项**，不是可裁剪项。

### 3.3 ★ 无命中不回退全文（**这条逼出一个真实缺陷**）

| 输入 | 输出 |
|---|---|
| 空串 | `''`（不回退） |
| 纯空白 | `''` |
| **仅注释无正文** | `''`（见 §5.1 缺陷） |
| 无标签但有正文 | **保留正文**（不误判为无命中） |

### 3.4 截断保尾部

| 断言 | 实测 |
|---|---|
| 超段级上限 ⇒ `truncated=true` | ✅ |
| 有**显式截断标记** | ✅ `TRUNCATION_MARKER` |
| 保留**尾部**（关键结论在段尾） | ✅ |
| 未给上限 ⇒ **不截断** 且进 `unresolved` | ✅ |

---

## 4. B3-FM：最终帧（L1 §4.7）

### 4.1 ★ 四者相等（**内部断言，不是测试侧假设**）

```
text.length === chars.total === 分桶之和 === 最终段长度之和 + 分隔长度和
```

实测（5 段 / 4 个分隔符）：

| 量 | 值 |
|---|---|
| `text.length` | 59 |
| `chars.total` | 59 |
| 分桶之和 | 59 |
| 段长和 + 分隔 | 51 + 8 = 59 |

**实现里直接 `fail()` 断言**：等式不成立即抛 `injection-invalid-argument`（`internal accounting broken`），不静默产出错账。裁剪**之后**同样成立（实测 hard cap=30 时等式仍成立）。

### 4.2 先成段再计量

段类型（`SEGMENT_KINDS`）：`title` / `body` / `notification` / `reflection` / `degradationTail` / `separator`。
标题、分隔符、降级尾巴、通知、反思**都在计量前成为段**，分隔符长度**进分桶**（`byBucket.separator`），不会凭空多出字符。

### 4.3 另记 UTF-8 bytes；token 不冒称

| 断言 | 实测 |
|---|---|
| `chars.bytes` 为数值且 `>= chars.total` | ✅ 123 vs 59 |
| **`chars.tokens === null`** | ✅ 未实测 ⇒ 显式 null |

### 4.4 候选账 / 实际投递账分离

| 断言 | 实测 |
|---|---|
| `candidateAccount.total` = **全部候选数**（不受裁剪影响） | ✅ |
| 裁剪后 `candidateAccount.chars > deliveredAccount.chars` | ✅ |
| `deliveredAccount.chars === chars.total` | ✅ |

### 4.5 兼容计量 vs 硬上限；未决边界进 unresolved

| 模式 | 行为 |
|---|---|
| `compat` | **只计量不裁剪**，并声明「硬上限未启用」 |
| `hard` + 无 cap | **不裁剪**（不擅自定值），进 `unresolved` |
| `hard` + cap | 按优先级裁低优先段，记 `dropped` + degradation |

进 `unresolved` 的未决边界（L1 §4.7 明文要求，**全部不擅自定值**）：

```
budgetPolicy.capChars / fullExit / compression / 50K / segmentLevel / frameLevel
```

---

## 5. 施工中实测发现并修复的真实缺陷

### 5.1 ★ 纯注释内容被当成「有命中」

**暴露方式**：加强 B2 变异夹具时（把空串换成「仅含 HTML 注释锚点」）。

**现象**：`planPart` 返回了 `<!-- memory:mem_aaaa… -->` —— 一段**只有注释锚点、没有任何正文**的输入被判定为「有内容」，于是**整段原文被回退输出**。

**根因**：`parseSections` 把无标签行归入「前言节」，此前的过滤只判 `tag !== null`，纯注释行 `tag===null` 但 body 非空 ⇒ 被当作有效内容。

**修法**：新增 `isMeaningful()`（先剥 HTML 注释再压空白后判非空），`filter(s.tag !== null || isMeaningful(s.body))`。

> 这条直接对应 L1 §4.6「**无命中不得擅自回退全文**」—— 若没做这个加强夹具，缺陷会漏到接线阶段。

### 5.2 复用已冻结 DTO 被保留字段检查拒绝

`makeFinalizeReceipt` 内部会**再次**调用 `makeHostDeliveryObservation(o.hostObservation)`；如果直接传 `makeUnknownHostObservation()` 的产物（已冻结、带 `dtoKind`），会命中 `RESERVED_FIELD_NAMES` 检查而抛 `field name reserved by contract: dtoKind`。
**修法**：传**普通对象**而非 DTO 实例。**这不是放宽检查**，而是正确的复用方式。

### 5.3 DeliveryReceipt 的 `skipped` 是字符串数组

DTO 定义 `skipped: requireStringArray(...)` ⇒ 只能放 id 字符串。原本传 `{id,reason}` 对象会抛错。
**修法**：`skipped` 放 id；详细原因另放返回值上的 `skippedDetail`（**非 DTO 字段**，诚实标注）。

---

## 6. 隔离变异：16/16 CAUGHT

变异全在 `.tmp-fm*` 副本内，**已删除**，逐项完整还原（复原校验 `true`）。

| 组 | # | 变异 | 实测 |
|---|---|---|---|
| FM | F1 | `chars.total` 漏分隔符 | 93→89 / FAIL 4 |
| FM | F2 | 分隔符不计入分桶 | **内部断言抛错**（accounting broken） |
| FM | F3 | 候选账 = 实际账 | 93→91 / FAIL 2 |
| FM | F4 | token 冒称填 0 | 93→92 / FAIL 1 |
| FM | F5 | hard 无 cap 时擅自裁剪 | 93→91 / FAIL 2 |
| FM | F6 | 未决边界不写 unresolved | 93→88 / FAIL 5 |
| BD | **B1** | **选择前 2000 预截断** | 93→92 / FAIL 1 |
| BD | **B2** | 无命中回退全文 | 93→92 / FAIL 1 |
| BD | B3 | slim 省略 dead-end/progress | 93→91 / FAIL 2 |
| BD | B4 | 截断保头丢尾 | 93→92 / FAIL 1 |
| BD | B5 | 纯注释也算有内容（**真实缺陷回归**） | 93→92 / FAIL 1 |
| NT | N1 | prepare 清 planUpdatePending | 93→91 / FAIL 2 |
| NT | N2 | finalize 冒充已交付 | 93→92 / FAIL 1 |
| NT | **N3** | 旧版本覆盖新版本 | 93→90 / FAIL 3 |
| NT | N4 | 写盘失败被吞 | 93→91 / FAIL 2 |
| NT | N5 | 缺 runtimeScope 放行 | 93→92 / FAIL 1 |

### 6.1 ★ 两个首轮 MISSED 的归因（都是**夹具无区分力**）

| 变异 | 首轮 | 归因 | 处置 |
|---|---|---|---|
| **B1** | MISSED | 夹具把「尾部关键结论」放在**第 19 位** ⇒ 预截断到 2000 根本切不到它 ⇒ 断言恒真 | 把填充内容前置，使关键结论位置 **>2000**（并补一条断言锁住该位置），CAUGHT |
| **B2** | MISSED | 夹具是**空串** ⇒ 「回退全文」得到的也是空串 ⇒ 无区分力 | 加「纯空白」与「**仅注释无正文**」两个夹具；后者**顺带暴露了真实缺陷 §5.1**，CAUGHT |

> 这与前两轮的经验一致：**MISSED 先查「变异是否真改生效路径 / 断言是否有区分力 / 是否被并列判据短路」**，三者都不是产品缺陷，但都让验证失真。

---

## 7. 套件实跑（HEAD `e33f1ab1`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-final-frame.mjs`（本单元） | 0 | **93** | 0 |
| `smoke-test-batch3-rules-render.mjs` | 0 | 68 | 0 |
| `smoke-test-batch3-cadence-projection.mjs` | 0 | 97 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | **96** | 0 |
| `smoke-test-batch3-sources.mjs` | 0 | 64 | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **697** | **0** |

### 7.1 结构性判据第三次发挥预期作用

contract 套件本轮红 **4** 条，全部正确：

| 断言 | 提示 |
|---|---|
| 未实现单元符号 0 泄漏 | `泄漏: projectHandoffPre,composeFinalEnvelopePre,prepareNotificationPre,commitNotificationPre` |
| B3-BD / B3-FM / B3-NT 仍在 doesNotImplement | 三条实现与声明不一致 |

处置：三单元移入 implements + `REQUIRED_BY_UNIT` 登记各自关键符号（BD 5 个 / NT 4 个 / FM 4 个）。**未改判据形态、未放宽强度**，96 PASS。

---

## 8. 未验边界与如实声明

1. **未接生产入口**：`lib/index.js` **没有** import `lib/injection/`。
2. **未做真实 HOST**、未读写真实记忆、未跑全量 / `--impact-run`。
3. **未使用共享锁 / CAS / 原子替换**：L1 §4.8 要求「持久写入复用现有队列/锁/CAS/原子替换」，本层**只定义 `store` 接口由调用方注入**，自己**不碰 fs** ⇒ 锁/CAS **未接线也未验证**。这是本轮最大的未验项。
4. **`commit` 的幂等只在内存 store 上验证**：未验证跨进程/并发同请求的行为。
5. **BD 的「既定章节」是通用解析**：按 `type:*` 标签与 `## ` 标题切节，**未与 2.5 生成器的真实输出格式逐字核对**。
6. **BD 的 `sectionCapChars` 语义是自定**：L1 只要求「选择后再交 FM」，**段级上限该不该存在、取多少，属未定**（已进 `unresolved`）。
7. **FM 的段优先级（title/degradationTail 必保，其余按 priority 淘汰）是本模块约定**，**未与真实 profile / 3.0-B 预算策略对齐**。
8. **FM 的 `50K` / `full` 出口 / 压缩 / 段级 / 整帧边界全部未定**，已如实写入 `unresolved`，**未擅自定值**。
9. **token 计量未实测**（`chars.tokens` 恒 null），未引入任何 tokenizer。
10. **`skippedDetail` 是 DTO 之外的附加字段**：DTO 的 `skipped` 只能放字符串，故详细原因放在外层对象上 —— **这是契约边界上的妥协**，接线时需确认消费方是否接受。
11. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 9. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/notification.js` | **新建**：B3-NT（11,473B / 258 行） |
| `lib/injection/project-handoff.js` | **新建**：B3-BD（9,992B / 223 行） |
| `lib/injection/final-frame.js` | **新建**：B3-FM（9,008B / 208 行） |
| `lib/injection/index.js` | 改：接入三模块（62→80 导出） |
| `tests/smoke/smoke-test-batch3-final-frame.mjs` | **新建**：93 断言（19,766B / 279 行） |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 改：三单元登记为已实现 |
| `artifacts/_batch3-final-frame-20261117/` | fingerprints / mutations / suite-runs / MANIFEST |


## Lead复核补验

- 新增 notification-store.js：withSharedStateLock 内读取、revision CAS、纯提交、writeTextAtomicPreSync 原子替换；隔离目录验证同请求幂等、revision 冲突、写失败原文不变/重试与同 revision 竞争串行。
- 纯通知读失败改 fail-closed；skippedDetail 仅返回级诊断，L1已明确不改DTO。
- 生产入口仍未接；未做真实HOST/全量。
