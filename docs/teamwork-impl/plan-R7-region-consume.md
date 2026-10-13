# R7 · 配置层对外消费 A（区域 order + 显隐）· 已完工

> **状态**：已完工 · 2026-09-28（原文记录的最后一次执行日）
> **性质**：派工任务书（存档）—— 该轮已完工，本文保留为任务书原文，不再作为待执行计划。
> **落点**：`lib/client.js`（唯一改动文件，792,275 → 796,103 B，+3,828）；验收套件 `tests/smoke/smoke-test-r7-region-consume.mjs`。
> **验收**：R7 套件 **PASS 27 / FAIL 0**；全量回归 PASS 195 / FAIL 0 / TIMEOUT 0；已并入全量回归。

## 摘要

该轮要解决的是布局 schema 里的 region 锚点只是「死标记」、客户按锚点名配置了也不生效的问题。方案是新增纯函数 `layoutRegionPlanPre` 产出显式配置的 `{name,order,hidden}`，再由 `applyLayoutRegionsPre` 给 `[data-dam-region]` 节点打 inline 样式，默认配置一个属性都不写以保证视觉逐字节不变。落地后区域排序与显隐可配且默认零改动，R7 套件 PASS 27 / FAIL 0。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「本轮 / 待办 / 计划」等计划态措辞**是当时的任务描述**，不代表当前待办；**该轮已完工**，实际结果以页首「状态 / 落点 / 验收」为准，过程留痕见同目录对应轮工程记录。

---

> **过程留痕**：`74-R7轮工程记录.md`（含交付物物理量、CR-10 验收与变异反向验证）。


> 依据（全量读）：56 卷 §二/§三（客户能做的 5 件事之 ①排序 ③显隐；验收判据四条）、62 卷 §二（零视觉变化纪律/属性已挂）、68 卷 §八（下游：前端把 normalize 结果消费成 `order` / `display:none`）、70 卷 R7。schema：`frontend/layout-schema-v1.json` regions 7 个。

## 小轮清单

| 小轮 | 做什么 | 判据 |
|---|---|---|
| R7a | 纯函数 `layoutRegionPlanPre(cfg)`：只对**显式配置**的 region 产出 `{name,order,hidden}` | 默认（`{}`）⇒ **空数组**；`{page:{order:3}}` ⇒ 1 项 |
| R7b | DOM 应用 `applyLayoutRegionsPre`：按 plan 给 `[data-dam-region="X"]` 打 inline `order` / `display:none` | 真调用后节点 `style.order==='3'`、`style.display==='none'` |
| R7c | 接线：state 变化时调用（useEffect） | state 含 layoutConfig 即触发；无配置零改动 |
| R7d | 暴露给测试：`exports._layoutRegionPlanPre` | 真调用可取到函数 |

## 判据（56 卷 §三 四条 + 负路径）

1. **正**：改一个 region 的 order ⇒ 该区域换位置，**其余不动**
2. **正**：删掉配置文件 ⇒ 界面与默认**完全一致**（零 inline 样式）
3. **负**：配置写了不存在的 region 名 ⇒ **不崩**，忽略并留告警（normalize 层已过滤，plan 层须再兜一层）
4. **负**：配置 JSON 语法错 ⇒ 回落默认（R6 已验收）
5. **负（守卫反向验证）**：真删 `layoutRegionPlanPre` 定义 ⇒ R7 套件必须变红

## 零视觉变化策略（62 卷 §二 纪律 1）

- **不新增 CSS 规则**（实测 CSS 段 94,295 字符中 `data-dam-region` 出现 **0** 次 ⇒ 现有 DOM 无规则命中）
- 只在**客户显式配置**时写 inline style；默认配置 ⇒ 一个属性都不写 ⇒ 视觉逐字节不变

## 范围边界

- 本轮**只做** region 的 `order` + `hidden`（70 卷 R7 定义）。region 尺寸 `w/h/min` → R8；slot 层 → R9；block 层 → R10。
- slots 段虽已被 normalize 产出，但消费留到 R9（避免一轮改两处语义）。

