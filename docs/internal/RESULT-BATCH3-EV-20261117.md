# 批次3 · B3-EV 实施结果（事件视图与来源指针）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-41）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`9e7108e6`**（未 commit / 未 push）
> 依据：L1 §4.9、L2 §8
> **只在 `lib/injection/` 新增模块 + 接 facade**：**未改 event schema / 写入口**，未接 `lib/index.js`，未实施 CO。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| 四个函数 | `projectEventSectionsPre` / `renderCheckpointPreviewPre` / `selectEventProjectionPre` / `renderEventSourcePointersPre` |
| 四段不混映射 | 事件头 **goal/doing/deadend/next**；检查点 **goal/state/dead/next** |
| 预览 | 首尾保留 / 按四段分配；**不改原文** |
| activeLimit | **来自 `eventMaxActiveInInject`（实测默认 2）**；未给 ⇒ `null` 且**不展开** |
| 标签语义 | 无 `currentEventIds` ⇒ 一律「最近更新」，**不冒充当前任务** |
| 指针 | **只生成指针**（`content` 恒 null）；路径失效**显式标注** |
| 验收 | 本单元 **86 PASS / 0 FAIL**；隔离变异 **16/16 CAUGHT** |
| 回归 | **784 PASS / 0 FAIL** |
| `lib/index.js` / `lib/rules-layer.js` | **均零改动** |

---

## 1. 物理指纹

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改** |
| `lib/rules-layer.js` | 44899 | 740 | `CF946F54D7D2643F` | **未改** |
| `lib/injection/event-view.js` | 17515 | 408 | `A9C0A9E488C87C65` | **新建** |
| `lib/injection/index.js` | 3189 | 149 | `CB37132B22F1EC0E` | 改（接入 EV，80→93 导出） |
| `tests/smoke/smoke-test-batch3-events.mjs` | 17182 | 270 | `AC38873E0256E751` | **新建** |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 15899 | 188 | `15CC3302100C7604` | 改（EV 登记为已实现） |

新增 `event-view.js` **17,515B / 408 行**。

---

## 2. 四段不混映射（L1 §4.9 首条）

| 常量 | 值 |
|---|---|
| `EVENT_HEAD_KEYS` | `goal, doing, deadend, next` |
| `CHECKPOINT_KEYS` | `goal, state, dead, next` |

**关键断言**：给事件头喂 `state`/`dead` 字段 ⇒ **不予读取**；给检查点喂 `doing`/`deadend` ⇒ 同样不读。两条都有独立断言（变异 E1/E2 分别 CAUGHT）。

> 注意 `deadend`（事件头）与 `dead`（检查点）是**两个不同字段**，不是同一个的别名 —— 这正是「不混映射」要防的。

---

## 3. 检查点预览

### 3.1 1400 字首尾

夹具：1420 字（开头关键信息 + 大量填充 + 尾部结论「EPERM是根因」），预算 300。

| 断言 | 实测 |
|---|---|
| `truncated=true` | ✅ |
| **保留开头** | ✅ head 含「开头关键信息」 |
| **保留尾部** | ✅ tail 含「EPERM是根因」 |
| 省略量如实 | ✅ `omittedChars=1120` |
| **不改检查点原文** | ✅ 调用前后逐字节一致 |

### 3.2 按四段分配

`budget.mode='sections'` ⇒ 从四段里按预算取，实测四段都能出现（`sections.length===4`），只选段不重写。

### 3.3 未给预算 ⇒ 不截断、不擅自定值

`budget:{}` ⇒ `truncated=false`、原文照出，且进 `unresolved`。

---

## 4. 事件选择与目录

### 4.1 ★ activeLimit 来自 `eventMaxActiveInInject`

**实测来源**：`lib/index.js:802` `eventMaxActiveInInject: 2`（注释：「T2 卡片段放几个 active 事件（契约 §3.2 说「1–2 个」，默认 2）」）；取数点 `lib/index.js:10397`。

| 输入 | 实测 |
|---|---|
| `activeLimit: 2` | 展开 2 个 active |
| `activeLimit: 99`（>active 数） | 只展开**实际 7 个** |
| `activeLimit: 0` | 不展开，全进目录 |
| **未给** | **`activeLimit === null`、cards = 0**、进 `unresolved` |

> **不擅自增加**：未给时**不展开任何 active**，而不是悄悄用默认 2。这是变异 E6/E7 锁死的点。

### 4.2 ★ 目录排除已展开事件

| 断言 | 实测 |
|---|---|
| 目录中**不含**任何已在 cards 里的 id | ✅ |
| `cards.length + catalog.length === 全部事件数` | ✅ 2 + 8 = 10（无重复无丢失） |

### 4.3 四种状态分别验证（L2 §8.2）

| status | 展开 | 目录 |
|---|---|---|
| `active` | **1** | 0 |
| `paused` / `closed` / `archived` | **0** | 1 |

### 4.4 ★ currentEventIds 真实输入（不冒充当前任务）

| 输入 | 标签 | `isCurrentTask` |
|---|---|---|
| `currentEventIds:['evt_...05']` | 该条「**当前任务**」，其余「最近更新」 | 恰 1 个 true |
| **未给** | **全部「最近更新」** | **全部 false** |
| `currentEventIds: []`（空数组） | 全部「最近更新」 | 全部 false |

另返回 `labelSemantics.hasCurrentEventIds` 显式声明语义来源，便于审计。

### 4.5 重复 id / 缺 id

| 情形 | 处理 |
|---|---|
| 重复 id | 去重（`unique=1`）+ `duplicate-id` warning |
| 缺 id | **跳过，不伪造 id** + `missing-id` warning |

### 4.6 预算

目录预算未给 ⇒ 进 `unresolved`；给了 ⇒ 截断并记 `catalogOmitted` + degradation。最终帧预算未给 ⇒ 进 `unresolved`（**不擅自定值**，L2 §8.1「不把 300 等现值写成新批准值」）。

---

## 5. 来源指针（L1 §4.9 末三条）

### 5.1 ★ 只生成指针，不注入整篇

| 断言 | 实测 |
|---|---|
| `injectedContent === false` | ✅ |
| **每个指针 `content` 恒 null** | ✅ |

### 5.2 ★ quoteRef 是引文不是路径

```js
// 即便 quoteRef 的内容**看起来像路径**（"lib/injection/index.js"）
// 也一律 kind='quoteRef'、sourceKind='quote'、resolved=null（不做路径解析）
// hint: '这是引文，不是路径（勿按路径解析）'
```

### 5.3 ★ sourceRef 可能是账本/日志，不冒充施工文档

| sourceRef 示例 | 归类 |
|---|---|
| `handoff/2026-11-17.md` | `ledger` |
| `.dsh-memory/2026-11-17.md` | `log` |
| `docs/internal/DETAIL-*.md` | `doc` |

断言直接锁：**ledger / log 的 `sourceKind !== 'doc'`**。

### 5.4 ★ 路径失效显式标未解析

| 断言 | 实测 |
|---|---|
| 失效路径 `resolved === false` | ✅ |
| `hint` 明说「路径未解析」 | ✅ |
| 记 `unresolved-path` warning | ✅ |
| **失效路径仍在 `pointers` 里**（不静默丢弃） | ✅ |
| 未注入 `resolvePath` ⇒ 一律 `resolved:false`（不假装已解析） | ✅ |

---

## 6. 隔离变异：16/16 CAUGHT（套件崩溃 0 次）

| # | 变异 | 实测 |
|---|---|---|
| E1 | 事件头改读检查点字段 | 86→79 / FAIL 7 |
| E2 | 检查点改读事件头字段 | 86→81 / FAIL 5 |
| E3 | 空字段也输出 | 86→84 / FAIL 2 |
| E4 | 预览只保头丢尾 | 86→85 / FAIL 1 |
| E5 | 预览改原文（就地截断） | 86→83 / FAIL 3 |
| **E6** | **缺 activeLimit 擅自默认 2** | 86→84 / FAIL 2 |
| **E7** | **缺 activeLimit 也回显 2** | 86→85 / FAIL 1 |
| E8 | 目录不排除已展开 | 86→83 / FAIL 3 |
| **E9** | **无上下文也标「当前任务」** | 86→81 / FAIL 5 |
| E10 | 非 active 也展开 | 86→80 / FAIL 6 |
| **E11** | **quoteRef 当路径解析** | 86→83 / FAIL 3 |
| E12 | sourceRef 不识别账本 | 86→85 / FAIL 1 |
| **E13** | **未解析路径静默丢弃** | 86→80 / FAIL 6 |
| E14 | 指针带正文（注入整篇） | 86→84 / FAIL 2 |
| E15 | 重复 id 不去重 | 86→84 / FAIL 2 |
| E16 | 缺 id 伪造 | 86→85 / FAIL 1 |

### 6.1 ★ 首轮暴露的**测试侧**问题：套件裸索引崩溃

首轮跑变异时 E10、E13 的 PASS 骤降（40、72）但**不是真实检出** —— 是套件在 `unresolved[0].hint`、`pt.pointers[0].resolved` 等**裸索引**处抛 `TypeError` 直接中断。

**处置**：加固 8 处断言改为**先判长度再取值**（如 `srcs.length === 3 && srcs[0].sourceKind === 'ledger'`）。重跑后 E10/E13 均为**干净 FAIL（6 条）**，全轮 **0 崩溃**。

> 判据补充：**变异的 PASS 骤降若伴随崩溃，不能算 CAUGHT** —— 必须先确认是「断言失败」而不是「套件挂了」。否则一个健壮的实现看起来与崩溃无法区分。

---

## 7. 套件实跑（HEAD `9e7108e6`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-events.mjs`（本单元） | 0 | **86** | 0 |
| `smoke-test-batch3-final-frame.mjs` | 0 | 93 | 0 |
| `smoke-test-batch3-rules-render.mjs` | 0 | 68 | 0 |
| `smoke-test-batch3-cadence-projection.mjs` | 0 | 97 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | **97** | 0 |
| `smoke-test-batch3-sources.mjs` | 0 | 64 | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **784** | **0** |

### 7.1 结构性判据第四次发挥预期作用

contract 套件红 2 条且正确：`泄漏: selectEventProjectionPre,renderCheckpointPreviewPre` + `B3-EV 仍在 doesNotImplement`。处置：EV 移入 implements + 登记 4 个符号，`forbidden` 清单清空（EV 符号已全部实现）。**未改判据形态、未放宽强度**，97 PASS。

---

## 8. 未验边界与如实声明

1. **未接生产入口**：`lib/index.js` 没有 import `lib/injection/`。
2. **未改 event schema / 写入口**（任务硬约束）：本模块**只读**，不碰 event-store。
3. **未做真实 HOST**、未读写真实事件库、未跑全量 / `--impact-run`。
4. **`eventMaxActiveInInject` 只读到了默认值 2**：本模块**不自己读配置**（由调用方注入 `activeLimit`）。配置项到 `activeLimit` 的**真实取数链路未接线也未验证**。
5. **`currentEventIds` 的真实来源未接线**：L1 要求「来自真实会话上下文」，本模块只接受**已算好的数组**；**上下文提取逻辑未实现**。
6. **`resolvePath` 是注入的**：路径是否真实存在**未在本层验证**（测试用桩）；未与真实文件系统比对。
7. **`sourceKind` 的分类用正则启发式**：`ledger`/`log`/`doc` 等判定基于路径特征，**遇到非常规路径会落到 `unknown`**（这是有意保守，但**分类规则未与既有事件库实际路径分布核对**）。
8. **`catalogChars` / `finalBudget` 的取值全部未定**：只做了「未给就不裁」，**未与 FM 的段级/整帧预算联验**（L2 §8.1 要求联验，本轮未做）。
9. **预览的 head/tail 切分比例（各半，尾部多数 1 字）是本模块约定**，**未与既有 T2 预览的真实切分口径核对**。
10. **`sections` 模式下的段选择顺序**按 `goal/state/dead/next` 固定序，**未按「最新检查点优先」排序**（L2 §8.1 有此要求，本轮只对单检查点验证，**多检查点排序未实现**）。
11. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 9. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/event-view.js` | **新建**：B3-EV（17,515B / 408 行） |
| `lib/injection/index.js` | 改：接入 EV（80→93 导出） |
| `tests/smoke/smoke-test-batch3-events.mjs` | **新建**：86 断言（17,182B / 270 行） |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 改：EV 登记为已实现 |
| `artifacts/_batch3-ev-20261117/` | fingerprints / mutations / suite-runs / MANIFEST |


## Lead复核补验

- 新增 event-frame.js：多检查点按 at/updatedAt（同值按后置顺序）最新优先预览；事件卡片/目录经 composeFinalEnvelopePre 统一预算与计量，不另建预算。
- currentEventIds/resolvePath仍由调用方注入，不猜来源；activeLimit由适配器读取eventMaxActiveInInject。
- Lead复跑EV、最终帧与相关回归，未做真实HOST/全量。
