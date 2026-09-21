# R3 · 降级留痕层 设计定稿（待批准）

> 2026-09-18 · 上游：`R1-DEGRADE-AUDIT-20260918.md`、`R2-EVIDENCE-DEEP-AUDIT-20260918.md`、`BATTLE-PLAN-20260917.md §3.6`
> **状态：设计待用户批准，尚未写代码**

---

## 0. 一句话目标

**让「某条臂静默失效」从"用户只感到检索不太对"变成"可查询的状态"。**
不是消灭降级（fail-soft 是对的），而是**让降级可见**。

---

## 1. 核心判据（R1/R2 已得出，这里是设计前提）

**必须区分两类，绝不能一律报：**

| 类别 | 定义 | 实例 | 处置 |
|---|---|---|---|
| **预期内分支** | 该状态是**合法业务状态** | 无证据事件（R2-E1）、查询无时间表达（`tr=null`） | **静默，不报** |
| **预期外失败** | 该状态**不该发生** | 引擎抛错、目录 ENOENT、worker 拒绝 | **留痕** |

**若一律报** ⇒ 每次 recall 都会刷"无时间臂"（因为绝大多数查询不含时间表达）⇒ **噪音淹没信号**。

---

## 2. 形态选择（三选一，我推荐 A）

| | 方案 | 评价 |
|---|---|---|
| **A** | **内存环形缓冲 + 状态文件**：`degrade()` 写内存（有界 N 条）+ **定时/按需 flush 到一个 JSON 状态文件**；面板读该文件 | ✅ **零新增常驻状态机**（符合 S10.4）；面板与宿主解耦，不要求宿主常驻 |
| B | 纯内存 + debugView 暴露 | ❌ 宿主重启即丢；用户报障后无法回看 |
| C | 每次降级直接写日志文件 | ❌ 高频写盘 + 与既有 diag 重复 |

**推荐 A 的理由**：本项目已有同类先例 —— `.dsh/memory/` 下的状态文件（如 `evidence-pre/`、`l0-index-*.json`）
都是**可查询的磁盘状态**。留痕层应复用这个范式，而不是新造一个状态机。

---

## 3. 接口设计

```js
// lib/degrade-pre.js（新文件，纯函数 + 一个有界收集器）
export function createDegradeSinkPre({ now, cap = 200 })
  → {
      record(kind, reason, detail)   // kind: 'semantic-arm' | 'evidence-arm' | 'temporal-arm' | 'l0-sync' | ...
      snapshot()                     // 返回当前缓冲（含 counts + 最近 N 条）
      counts()                       // { kind: n } 便于断言
      reset()
    }
```

**纪律（写进代码注释与套件）**：
1. **只记录、不阻断** —— `record()` 内部整体 try/catch，任何异常都被吞掉
2. **不得因留痕失败而二次失败** —— 留痕自身 fail-soft 到静默（这是 R3 的元规则）
3. **有界** —— cap=200 + 每 kind 计数（防内存增长）
4. **不含原文** —— 只存 kind/reason/时间/计数，**隐私边界与既有 diag 一致**
5. **不新增配置键用于开关** —— 默认开启（这是观测面，不是业务功能）

---

## 4. 接线点（最小集，先接 4 条臂）

| 位置 | 现有代码 | 改为 |
|---|---|---|
| `index.js:5877` | `catch (eBest) { diag('recall 语义臂择优降级…') }` | `+ sink.record('semantic-arm', ...)` |
| `index.js`(evidence 段) | `catch (eImp) { diag('evidence-agg 降级…') }` | `+ sink.record('evidence-arm', ...)` |
| `index.js:5908` | `catch (eTr) { diag('temporal-parse 降级…') }` | **不动**（预期内分支） |
| `index.js:8795` | `catch (e) { diag('l0-index sync 降级…') }` | `+ sink.record('l0-sync', ...)` |

**注意 `:5908` 不动** —— 这是判据的实际应用：无时间表达是**正常路径**，记它只会制造噪音。
**但**：若 `parseTemporalQueryPre` **本身抛错**（而非返回 null），那是预期外 ⇒ 应当记。
⇒ 需在实现时**把"返回 null"与"抛错"分开**（当前两者混在同一个 catch 里，这本身也是个小缺陷）。

---

## 5. 可见性（面板/状态文件）

**产出物**：`<dshHome>/memory/degrade-pre/latest.json`
```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-09-18T20:10:00+08:00",
  "counts": { "semantic-arm": 3, "evidence-arm": 0, "l0-sync": 1 },
  "recent": [ { "kind": "semantic-arm", "reason": "...", "at": "..." } ]
}
```

**E-3 落地方式**：额外记录一条**臂健康快照**（不是降级，是状态）：
```json
"arms": { "semantic": "active", "evidence": "no-input", "temporal": "on-demand", "l0Sync": "ok" }
```
⇒ 这样用户/面板能直接看到「**evidence 臂 = no-input**」，
而不是靠"每次 recall 都 ENOENT"来推断。

---

## 6. 与既有机制的边界（防重复建设）

| 已有 | 关系 |
|---|---|
| `diag()` | **保留**。diag 是**过程日志**（滚动、即时）；degrade 是**状态**（可查询、可聚合）。两者互补，不替代 |
| `_lastIndexDegrade`（index.js:5015 提到） | **需先查清**它是否已是一个同类机制 ⇒ 若是，R3 应**并入**而非新建（避免第二个状态源） |
| 白板 lint「只读+留痕」 | **同源纪律**：lint 只读不写盘但留痕；degrade 同理 |
| S10.4「不建状态机」 | ✅ 本设计是**观测面**，不参与业务判断 |

**★ 建前必做（已完成 2026-09-18 20:05）**：查 `_lastIndexDegrade` 与 `debugView()`，确认不重复造轮子。

**前置检查结论（已证实无需并入，可新建）**：

| 查什么 | 实证结果 | 判定 |
|---|---|---|
| `_lastIndexDegrade` | `context-host-pre.js:112` `let lastIndexDegrade = null` + `:373` 赋值 —— 是 **单值兼容投影**（供旧读取方），**非收集器** | ❌ 不是同类机制 |
| `debugView()` | 存在于 7 个 host（shadow/context/activation/activation-inbox/index-sync/rerank/python-sink），各返回**本域局部状态** | ❌ 非跨臂统一台账 |
| `createDegrade*` / `recordDegrade` 等 | 全仓 grep **零命中** | ✅ 无重复 |

⇒ **R3 是新建，与既有机制互补**：
- `diag()` = **过程日志**（滚动、即时、人读）
- `debugView()` = **各域局部状态**（分散、按 host）
- `degrade` = **跨臂统一台账**（聚合、可查询、面向"哪条臂失效了"）

---

## 7. 验收

1. 新增套件 `smoke-test-r3-degrade-pre.mjs`：接口契约 / fail-soft / 有界 / 隐私 / 计数正确
2. **变异演示**：故意在 `catch` 里抛错 ⇒ 断言**主流程不受影响**（留痕自身 fail-soft 生效）
3. 断言 `:5908`（无时间表达）**不产生留痕**（判据的正确性）
4. 全量回归维持 **PASS 115+ / FAIL 0**

---

## 8. 待用户拍板的三个点

1. **形态 A（内存+状态文件）是否认可？** 还是希望纯面板内存（B）？
2. **状态文件位置**：`<dshHome>/memory/degrade-pre/latest.json` 是否合适？
3. **是否同意"**先查 `_lastIndexDegrade` 再动手**"作为硬前置**？
