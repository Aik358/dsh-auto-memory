# 长期记忆系统 逻辑审计报告 · 第 3 批：宿主接线一致性与 `-pre` 双份漂移

> 审计日期：2026-09-21 · 对象 `D:\dsh-auto-memory`（pre 线）
> 取证方式：全仓 import 图静态核对 + 26 对同名文件（`-pre` / 非 `-pre`）体量与 mtime 比对
>
> **本报告只做诊断，未改任何代码。**

---

## 0. 结论先行

`lib/` 下存在 **26 对同名的 `-pre` / 非 `-pre` 文件**，**全部漂移**，且**非 `-pre` 的那一批正在被其它非 `-pre` 文件互相引用**。
这不只是「历史遗留」，而是一个**活的双实现仓库**：

- 宿主 `lib/index.js` 全量走 `-pre`（已核对 30 条 import，无一条指向非 `-pre`）；
- 但 `lib/` 下另有 **13 个非 `-pre` 文件**互相 import 那批旧副本（见 §2）。

⇒ 任何改在旧副本上的修复**不会生效**（历史事故已发生过一次）；而阅读代码的人**无法从文件名判断哪份是活的**。

---

## 1. 漂移全量基线（26 对，全部不一致）

旧文件 mtime **统一为 09-07 13:06**（或 09-10/09-08 的少数几个），即一批「快照式」冻结。

| 文件 | `-pre` | 旧版 | 差值 | `-pre` mtime |
|---|---:|---:|---:|---|
| context-host | 52,902 | 42,281 | **+10.4 KB** | 09-20 06:10 |
| memory-writer | 30,094 | 19,941 | **+9.9 KB** | 09-16 23:56 |
| activation-host | 32,129 | 22,689 | **+9.2 KB** | 09-20 06:10 |
| memory-hub | 21,888 | 12,537 | **+9.1 KB** | 09-20 05:38 |
| procedure-store | 27,090 | 19,678 | **+7.2 KB** | 09-20 05:38 |
| python-setup | 17,812 | 12,795 | +4.9 KB | 09-10 16:27 |
| semantic-js | 27,670 | 22,752 | +4.8 KB | 09-20 04:52 |
| fact-store | 24,181 | 19,662 | +4.4 KB | 09-19 17:23 |
| m7-index-sync-host | 13,967 | 9,431 | +4.4 KB | 09-19 05:06 |
| episodic-store | 17,169 | 13,855 | +3.2 KB | 09-19 04:01 |
| memory-anchor | 23,362 | 20,401 | +2.9 KB | 09-19 16:14 |
| python-sidecar-client | 16,659 | 14,010 | +2.6 KB | 09-19 18:01 |
| semantic-decide | 15,404 | 13,038 | +2.3 KB | 09-19 16:38 |
| storage-manage | 12,185 | 10,591 | +1.6 KB | 09-19 16:35 |
| activation-inbox | 24,517 | 23,096 | +1.4 KB | 09-15 00:15 |
| index-sync | 8,750 | 7,894 | +0.8 KB | 09-19 04:01 |
| m4-corpus | 10,057 | 9,311 | +0.7 KB | 09-19 16:35 |
| evidence-store | 12,643 | 12,169 | +0.5 KB | 09-19 00:59 |
| context-bridge | 31,970 | 31,605 | +0.4 KB | 09-19 00:45 |
| shadow-retrieval | 39,389 | 39,108 | +0.3 KB | 09-10 00:00 |
| m7-wire | 14,620 | 14,397 | +0.2 KB | 09-10 03:29 |
| memory-index | 7,378 | 7,167 | +0.2 KB | 09-20 06:10 |
| activation-inbox-state | 12,243 | 12,215 | +0.03 KB | 09-08 13:58 |
| context-sink-python | 4,280 | 4,272 | +0.01 KB | 09-08 13:58 |
| **shadow-host** | 18,023 | **18,131** | **−0.1 KB** | 09-20 04:52 |
| **intent-clean** | 3,856 | **3,903** | **−0.05 KB** | 09-17 00:12 |

★ 末两行是**旧版比新版更大** —— 说明它们不是简单「新版=旧版+补丁」的线性演进，
而是**双向分叉**（两边各自改过）。这比单向漂移更危险：无法靠「以 `-pre` 为准」一句话判定。

---

## 2. 非 `-pre` 文件仍在互相 import 旧副本（活的双实现）

grep 取证（`from './xxx.js'`，非 `-pre`）：

| 引用方（非 `-pre`） | 被引用（非 `-pre`） |
|---|---|
| `activation-inbox.js:16` | `shadow-retrieval.js` |
| `context-bridge.js:19` | `shadow-retrieval.js` |
| `context-host.js:24` | `evidence-store.js` |
| `context-host.js:26` | `shadow-retrieval.js` |
| `context-host.js:27` | `semantic-js.js` |
| `index-sync.js:12` | `evidence-store.js` |
| `m4-corpus.js:19/20` | `memory-anchor.js` / `shadow-retrieval.js` |
| `m7-index-sync-host.js:24` | `evidence-store.js` |
| `memory-anchor.js:22` | `memory-index.js` |
| `memory-writer.js:20/21` | `memory-anchor.js` / `memory-index.js` |
| `shadow-host.js:19` | `shadow-retrieval.js` |
| `storage-manage.js:20` | `memory-anchor.js` |

⇒ **12 个文件、13 条边**构成一个平行的旧世界。宿主不 import 它们，但只要有人顺着这些文件读下去，
就会读到**没有 T1/T4/T10/issue#30 任何修复**的旧逻辑。

### 与已知事故的因果链

历史事故（用户级记忆有载）：**PR 改了 `lib/*.js` 陈旧副本 ⇒ 宿主只 import `-pre.js` ⇒
「PR merge 成功 ≠ 修复落地」**。本批取证说明：**该事故的结构性原因是仓库同时保留了两个可编译的世界，
且旧世界内部自洽（能 import、能过语法检查），所以改动看起来"成功"了。**

---

## 3. P1 级（3 条）

### P1-1 无「哪份是活文件」的机器可读标记

- 问题：文件名后缀 `-pre` 是**约定**，不是**断言**。已出现旧版更大的双向分叉（§1 末两行），
  说明约定本身已不足以判定。
- 修法建议：① 顶层加 `lib/README-ACTIVE.md` 列出活跃文件白名单；② 或直接删/重命名旧副本（见 P1-2）；
  ③ 最稳的是加一条 CI 断言：**`lib/` 下非 `-pre` 的 `.js` 不得被非 `-pre` 文件 import**（或干脆禁止其存在）。

### P1-2 `-pre` 擦除只发生在发布期，pre 线永久背负双份

- 取证：发布流程 `tools/release.mjs` 会把 `_pre` 后缀擦掉（历史记忆有载，实测 REL 产物中
  模型可见工具名残留 0）。但**pre 开发线**始终保持双份。
- 问题：开发/审计时的认知负担永久存在；每次新的改动都要重新判断"该改哪个"。
- 修法建议：**需用户拍板**。可选：
  A. pre 线也删旧副本（最干净，但需确认无外部引用）；
  B. 保留但在旧副本头部加醒目 `@deprecated 本文件不生效，勿改`；
  C. 移到 `lib/_legacy_v1/` 子目录（物理隔离，import 路径会断 ⇒ 顺带证明无人引用）。

### P1-3 运行时数据同样双份，且旧目录是空壳

- 取证：
  ```
  ~/.dsh/memory/hub/       episodes.json 138 B / facts.json 131 B / procedures.json 126 B   (09-01 10:34)
  ~/.dsh/memory/hub-pre/   episodes.json 35,688 B / facts.json 4,973 B / procedures.json 38,912 B  (09-21)
  ```
  旧 `hub/` 三个文件合计 **395 B**，且 `procedures.json` 内容为 `{"procedures":[]}`；
  `namespace` 分别为 `dsh-auto-memory`（旧）与 `dsh-auto-memory-pre`（新）。
- 影响：排查时极易看错目录（本次审计第一轮就踩了：先查 `hub/` 得到"0 条"的错误印象）。
- 修法建议：旧目录改名 `.migrated` 或删除；并在文档里写明活跃路径。

---

## 4. P0 级（1 条，与第 1 批互相印证）

### P0-1 宿主接线处存在「声明了但接线不完整」的开关（已在前两批取证）

第 1 批已记：`procedurePromotionEnabled`（`index.js:546`）被 `context-host-pre.js:537` /
`activation-host-pre.js:330` 读取，但**默认 false 且语义是"注入总闸"**。
本批补充：**这正是双实现结构的典型病灶**——
- `context-host-pre.js` 与 `context-host.js` 两份都读这个开关（`:537` vs `:454`），
  但**只有 `-pre` 那份是活的**；
- 若有人按旧文件（`:454`）判断语义，会得到与线上不一致的结论。

⇒ **双份漂移不是"整洁度问题"，它已经在制造错误的因果判断。**

---

## 5. 未能确认 / 待补充

1. 非 `-pre` 文件是否被 `tests/` 或 `tools/` 引用（部分测试可能针对旧实现，如历史记忆提到的
   `hub-episodic-import`、`issue58-activation-dispose` 两个套件断言旧实现内部细节）。
   本批只 grep 了 `lib/`，**未覆盖 `tests/` 与 `tools/`** —— 删除旧副本前必须补这一步。
2. 26 对文件里哪些是**语义等价仅格式不同**、哪些是真分叉，需要逐对 diff 才能定性（本批只做了体量基线）。
3. `intent-clean` / `shadow-host` 双向分叉的具体差异点未逐行比对。

---

## 6. 三批汇总：缺陷全景与建议顺序

| 序 | 缺陷 | 批次 | 严重度 | 类型 |
|---|---|---|---|---|
| 1 | `procedurePromotionEnabled` 语义错配 + 默认 false | 1/3 | **P0** | 配置 |
| 2 | 高风险条目「批准」无任何实现通路 | 1 | **P0** | 功能缺失 |
| 3 | 清洗器漏网 `Reference: - HH:MM [kind:x]` 残片 | 2 | **P0** | 逻辑 |
| 4 | 前端晋升按钮条件 ≠ 真实门限 | 1 | **P0** | 逻辑 |
| 5 | `promote()` 与 `evaluatePromotion()` 双份门限（授权维度已不一致） | 1 | P1 | 架构 |
| 6 | 模型直写 `sourceMemoryIds` 恒空 ⇒ 成功证据永为 0 | 1 | P1 | 逻辑 |
| 7 | 清洗逻辑散在三处，口径不一 | 2 | P1 | 架构 |
| 8 | 存量脏数据无清理/标记机制（实测 10 条中 3 条垃圾） | 2 | P1 | 数据 |
| 9 | 对话发言直接当 fact subject（无事实性判据） | 2 | P1 | 产品 |
| 10 | `candidate` 死状态 / `stats.candidates` 死统计 / `applyAutomaticTransitions` 死函数 | 1 | P1 | 卫生 |
| 11 | `validateProcedurePre` 不校验 `evidence`（NaN 静默通过） | 1 | P1 | 健壮性 |
| 12 | **26 对 `-pre`/非 `-pre` 全部漂移 + 旧世界内部自洽** | 3 | P1 | 架构 |
| 13 | M8-1 认识论字段零落地（10/10 缺失） | 2 | P1 | 逻辑 |
| 14 | 运行时数据双份（`hub/` 空壳仍在） | 3 | P1 | 卫生 |
| 15 | `promote()` 拒绝也返回 `ok:true`；`restore()` 静默跳过无计数 | 1/2 | P2 | 卫生 |

### 修复批次建议（待拍板）

**第 A 批（立即见效、低风险）**：1、3、10、11、14
**第 B 批（需设计决策）**：2（批准通路形态）、9（事实性判据）、13（认识论字段默认值）
**第 C 批（架构收敛，动面最大）**：5、7、12（双份合一）
**第 D 批（数据操作，需备份）**：8（存量脏数据标记/清理）

> ⚠️ 用户既有硬规则：**涉及 procedure 记忆引擎（含清洗器）的改动，须经用户拍板方可实施。**
> ⚠️ 第 12 项（删旧副本）删除前必须补完 §5 第 1 条（tests/tools 引用核对）。
