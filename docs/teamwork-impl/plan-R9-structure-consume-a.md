# plan-R9 · 结构层消费 A（slot 层 order + 显隐）

> 依据（全量读）：70 卷 §四 R9（「锚点→配置驱动（region/slot）」；判据「客户按锚点名配置即可生效；**锚点从「死标记」变「活接口」**」）、`layout-schema-v1.json` 的 18 个 slot 定义（各自带 `name` / `region` / `part` / `order` / `existingAnchor`）、`authorSurface.reorder`（「slot 级用 `[data-dam-slot="Y"] { order: N }`」）、`authorSurface.visibility`（「`[data-dam-slot="Y"] { display:none }`」）、`normalizeLayoutConfig` slots 段（L166–192 已产出 `slots.<名>.order` / `.hidden`）、62 卷 §二（零视觉变化纪律）。

## 小轮清单

| 小轮 | 做什么 | 判据 |
|---|---|---|
| R9a | `layoutSlotPlanPre(cfg)` + `applyLayoutSlotsPre(cfg)`：slot `order` / `hidden` ⇒ inline style | 默认 ⇒ 空计划；显式 ⇒ 该 slot 节点真拿到 order / display:none |
| R9b | 接线：在 R8 的 effect try 块内加一行 | state 含 layoutConfig 即触发；无配置零改动 |
| R9c | 暴露 2 个测试出口 | 真调用可取到函数 |

## 判据（70 卷 R9 + authorSurface）

1. **正**：改 `slots.head.order` ⇒ 该 slot 节点真拿到 `style.order`；其余 slot 不动
2. **正**：`slots.<名>.hidden=true` ⇒ 该 slot 节点 `display:none`；`hidden:[<slot名>]` 便捷写法同效
3. **正**：删配置 ⇒ 回默认（order/display 被清空，零 inline）
4. **负**：未知 slot 名 ⇒ 不进计划、不崩（normalize 层已过滤 + plan 层再兜一层）
5. **负**：畸形入参（null / ok:false / slots 非对象 / order 非法）⇒ 不抛、返回空数组
6. **负（守卫反向验证）**：真删 `layoutSlotPlanPre` 定义 ⇒ R9 套件必须变红
7. **守恒**：R7 27/0 + R8 37/0 **不降级**；属性锚点 region 13 / slot 426 / block 10 不变；`MEMORY_TABS()` 计数锁 = 2；CSS 段零改动

## 与前两轮的边界

- R7 做 region `order`/`hidden`；R8 做 region 尺寸 + token ⇒ **两轮函数一行不改**，其套件继续作为回归防线。
- R9 新增：slot 层 `order`/`hidden`（新函数 + 新选择器常量 `LAYOUT_SLOT_SEL`）。
- slot 的**尺寸**不在 schema 定义中（`authorSurface.resize` 只给 region 三元组）⇒ 本轮不做 slot 尺寸，不自创。
- block 层（`data-dam-block` + `data-dam-kind`）落 **R10**。

