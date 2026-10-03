# plan-R10 · 结构层消费 B（block 层 10 类外观 + 作者面 imagery）

> 依据（全量读）：70 卷 §四 R10（「10a 10 类块渲染接配置；10b 图片槽挂载」；判据「10 类块外观可配；**作者面 5 键（reorder/resize/visibility/aesthetics/imagery）全落**」）、28 卷 §3.1（作者操作面 ④ 改块外观/图片）、28 卷 §3.4（`data-dam-block="<kind>"` 取值受控 10 类）、28 卷 §3.5 方式 C（`--dam-block-style` 消费点）、28 卷 §3.6（`authorSurface.imagery` = `[data-dam-block][data-dam-kind=media|empty] background-image`）、62 卷 §二（零视觉变化 / 计数锁 / `data-dam-` 前缀）、62 卷 §三 L2-e、68 卷（block 10/10 已闭合）、56 卷 §三（配置文件形态）。

## 一、★本轮开工取证（决定 scope 的三条硬事实）

| 事实 | 实测 | 影响 |
|---|---|---|
| `data-dam-kind` 出现次数 | **0**（全仓 lib/client.js） | sha256 锁定的 schema 里 `imagery` / `aesthetics` 写的选择器是 `[data-dam-block][data-dam-kind="Z"]` ⇒ **纸面可写、实际不可命中**；R10 必须补该属性，否则「作者面 5 键全落」不成立 |
| `data-dam-block` | **10 行 / 10 个值**，值与 `LAYOUT_BLOCK_KINDS`（10 类）逐条吻合 | kind 已可从既有属性值取到；补 `data-dam-kind` 是**加别名**，不是新造语义 |
| CSS 段含 `data-dam-kind` / `data-dam-block` | **均 false**（段长 94,295 字符） | 新增属性无任何 CSS 规则命中 ⇒ **零视觉变化**（62 卷 §二纪律 1） |
| `normalizeLayoutConfig` 的段 | `regions` / `slots` / `tokens` / `hidden` —— **无 `blocks` 段** | 若前端直接读 `cfg.config.blocks` 会是**死接口** ⇒ 必须先扩契约，再消费（顺序不可颠倒） |

## 二、小轮清单

| 小轮 | 做什么 | 判据 |
|---|---|---|
| R10a | 扩 `lib/layout-config.js`：新增 `blocks` 段（按 blockKind 键，值 `{style, bg}`）+ `defaultLayoutConfig` 同步 + fail-safe 同款（未知 kind 忽略留告警、非对象忽略、空值忽略） | 真 import ⇒ 未知 kind 被忽略且 ok=false 带告警；默认 ⇒ blocks 为 10 个空对象；**删除该段 ⇒ 与默认深度相等** |
| R10b | 给 10 个 block 节点补 `data-dam-kind`（值 = 该节点既有 `data-dam-block` 的值） | 10 处；CSS 段逐字节零改动；其余锚点守恒 |
| R10c | 前端 `layoutBlockPlanPre(cfg)` + `applyLayoutBlocksPre(cfg)`：按 `[data-dam-block]` 读 kind ⇒ 写 inline `--dam-block-style` / `--dam-block-bg` | 默认 ⇒ 空计划、零 inline；显式 ⇒ 真写入；删配置 ⇒ 清空回默认 |
| R10d | 接线（同一 `useEffect([state])`）+ 暴露 2 个测试出口 | state 含 layoutConfig 即触发 |
| R10e | 新增验收套件 + 全量八项复核 | 见 §四 |

## 三、判据（70 卷 R10 + 28 卷 §3.6）

1. **正**：`blocks.<kind>.style` ⇒ 该 kind 的所有节点真拿到 `--dam-block-style`；其余 kind 不动
2. **正**：`blocks.<kind>.bg` ⇒ 该 kind 节点真拿到 `--dam-block-bg`（=`authorSurface.imagery` 的消费点）
3. **正**：删配置 ⇒ 回默认（两个变量被清空，零 inline）
4. **正**：`data-dam-kind` 真存在于 DOM ⇒ schema 的选择器 `[data-dam-block][data-dam-kind="media"]` 可命中（真构造 DOM 断言）
5. **负**：未知 blockKind ⇒ 不进计划、不崩
6. **负**：畸形入参（null / ok:false / blocks 非对象 / style 非字符串）⇒ 不抛、返回空数组
7. **负（守卫反向验证）**：真删 `layoutBlockPlanPre` 定义 ⇒ 套件必须变红
8. **★跨层不越权**：block 节点普遍同时带 region/slot（实测样本 L5521 三属性同节点）⇒ 本层**只写 `--dam-block-*` 两个自有属性**，不得触碰 R7/R8/R9 写过的 `order`/`display`/`--dam-region-*`；用「先由 R7/R9 写值，再由 R10 执行，断言那些值不变」来验
9. **守恒**：R7 27/0 + R8 37/0 + R9 32/0 **不降级**；`MEMORY_TABS()` 计数锁 = 2；CSS 段零改动；region 13 / slot 426 不变；block 属性 10→20（新增 10 个 kind 别名，**逐条归因**）

## 四、完工后八项复核（与 R7–R9 同规格）

`node --check` ×3 = 0 · 全量回归 FAIL 0 且 PASS 不降级 · 加载守卫真执行 factory · `verify-docs.mjs` 单跑 · `verify-layout-schema.mjs` · CR-10（真 import→真构造→真调用→断言 + 负路径 + 可复算物理量）· 守卫反向验证 · 留痕三件套。

