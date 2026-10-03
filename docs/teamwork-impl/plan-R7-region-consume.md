# plan-R7 · 配置层对外消费 A（区域 order + 显隐）

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

