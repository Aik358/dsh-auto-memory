# R8 · 配置层对外消费 B（区域尺寸 + 外观 token）· 已完工

> **状态**：已完工 · 2026-09-28（原文记录的最后一次执行日）
> **性质**：派工任务书（存档）—— 该轮已完工，本文保留为任务书原文，不再作为待执行计划。
> **落点**：`lib/client.js`（唯一改动文件，796,103 → 802,165 B，+6,062）；验收套件 `tests/smoke/smoke-test-r8-config-consume-b.mjs`。
> **验收**：R8 套件 **PASS 37 / FAIL 0**；R7 套件 27/0 不降级；全量回归 PASS 195 / FAIL 0 / TIMEOUT 0；已并入全量回归。

## 摘要

该轮在 R7 的 region `order`/`hidden` 之外补齐另外三面：region 尺寸（`--dam-region-w/h/min`）与外观 token（`--dam-*` / `--skin-*`），并保持非白名单前缀拒绝。四判据全绿；block 层背景图（`imagery`）因需先补 `data-dam-kind` 属性而顺延到 R10，6 素材槽位真实挂载顺延到 R20。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「本轮 / 待办 / 计划」等计划态措辞**是当时的任务描述**，不代表当前待办；**该轮已完工**，实际结果以页首「状态 / 落点 / 验收」为准，过程留痕见同目录对应轮工程记录。

---

> **过程留痕**：`75-R8轮工程记录.md`（含交付物物理量、CR-10 验收与变异反向验证）。


> 依据（全量读）：70 卷 §四 R8（8a 尺寸 / 8b 块外观与图片 / 背景图；判据「五面全部可配置；四判据全绿」）、28 卷 §3.1 皮肤作者操作面（② 改区域尺寸 = 覆写 `--dam-region-w` / `--dam-region-h` / `--dam-region-min`；④ 改块外观/图片 = 覆写 `--dam-*` token）、28 卷 §3.6 `authorSurface.resize` / `.aesthetics`、12 卷（素材槽位 key 约定，本轮不挂真实图）。

## 小轮清单

| 小轮 | 做什么 | 判据 |
|---|---|---|
| R8a | `layoutRegionSizePlanPre(cfg)` + `applyLayoutRegionSizesPre(cfg)`：region `w/h/min` ⇒ inline `--dam-region-w/h/min` | 默认 ⇒ 空计划；显式 ⇒ 该 region 三变量真写入 |
| R8b | `layoutTokenPlanPre(cfg)` + `applyLayoutTokensPre(cfg)`：`tokens` 段（`--dam-*` / `--skin-*`）⇒ 根元素 CSS 变量 | 默认 ⇒ 空计划；显式 ⇒ 真写入；**非白名单前缀拒绝**（normalize 已过滤，本层再兜一层） |
| R8c | 接线：把三个 apply 挂进既有 `useEffect([state])` | state 含 layoutConfig 即触发；无配置零改动 |
| R8d | 暴露 4 个测试出口 | 真调用可取到函数 |

## 判据（28 卷 §3.6 authorSurface + 56 卷 §三 四条）

1. **正**：改 `region.w` ⇒ 该 region 真拿到 `--dam-region-w`；其余 region 不动
2. **正**：改 `tokens['--dam-accent']` ⇒ 根元素真拿到该变量；`--skin-*` 同效
3. **正**：删配置 ⇒ 界面回默认（变量被清空，零 inline）
4. **负**：非白名单前缀（如 `color`）⇒ 不进计划，不崩
5. **负**：畸形入参（null / ok:false / regions 非对象 / 值非法）⇒ 不抛、返回空数组
6. **负（守卫反向验证）**：真删 `layoutTokenPlanPre` 定义 ⇒ R8 套件必须变红
7. **守恒**：R7 套件 27/0 **不降级**；属性锚点 region 13 / slot 426 / block 10 不变；`MEMORY_TABS()` 计数锁 = 2；CSS 段零改动

## 与 R7 的边界（不重复、不冲突）

- R7 已做：region `order` + `hidden`（函数 `layoutRegionPlanPre` / `applyLayoutRegionsPre`）—— **本行一行不改**，R7 套件 27 条继续作为回归防线。
- R8 新增：region 尺寸（新函数）、tokens（新函数）；接线处把三者并排调用。
- blockKind 的 `data-dam-kind` 背景图（28 卷 §3.6 `imagery`）**不在本轮**：它需要块级锚点补 `data-dam-kind` 属性，落 **R10**（结构层 block 消费）。
- 6 素材槽位真实挂载落 **R20**（皮肤层），本轮只保证 `--skin-*` token 通路可用。

