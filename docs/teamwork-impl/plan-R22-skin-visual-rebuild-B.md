# plan · R22 视觉重构 B（bg.mindmap + illust.sync + 深浅色）

> 依据：70 卷 L113「R22 视觉重构 B（bg.mindmap + illust.sync + 深浅色）｜22a bg.mindmap；22b illust.sync + 深色版
> ｜权威 53 全文 / 47｜判据：**深色版走 `cutWhite` 规范；两套主题均可读**」；12 卷 §二（页面归属）；64 卷（`fileDark` + 回落规则）。

## 零、开工实测（决定本轮落点）

| 项 | 实测 | 判定 |
|---|---|---|
| `bg.mindmap` 落点 | `[data-dam-graph]` 渲染于 **L5952**（导图画布容器） | 真实挂载点确定 |
| `illust.sync` 落点 | `TeamStatusBar`（**L6871** 定义 / **L6877** 渲染同步状态条） | 真实挂载点确定 |
| 深色素材 | `slots-dark/` 2 个 WebP（hero/bg.mindmap，cutWhite 产出） | 已就绪 |
| 深浅色链路 | 仅设置页有**手动**开关（`SkinSection` 的 `deepOn`）；**真实页面无自动跟随** | ❌ **本轮缺口** |

## 一、小轮清单

| 小轮 | 内容 | 判据 |
|---|---|---|
| **22a** | `bg.mindmap` 挂到导图画布（作为**背景层**，不得遮挡节点）| 背景可交互穿透（`pointerEvents:none`）|
| **22b** | `illust.sync` 挂到同步状态条 + **深浅色自动跟随** | 两套主题均可读；★53 卷 `cutWhite` 规范 |

## 二、★深浅色判定的口径（53 卷 + 64 卷）

1. **素材选定**：`assetOf(key, deep)` —— `deep=true` 时取 `fileDark`；**空串则回落浅色**（64 卷已定，不产占位）。
2. **`deep` 从哪来**：真实页面**必须自动跟随宿主主题**，不能要求用户去设置页手点。
   ⇒ 本轮新增 `useDeepTheme()`：读宿主主题标记（`document.documentElement` 的暗色类/属性），**缺失时 fail-safe 回浅色**。
3. **53 卷 `cutWhite` 规范**：深色素材是「白→透明」的 WebP，**必须贴在深色底上**才可读 ⇒
   深色模式下给挂载点加**深色底**（`--dam-skin-dark-base`），否则白底 + 透明图 = 不可读。
   ★这是「两套主题均可读」判据的**关键实现点**。

## 三、零改动约束
- 追加式：新段插在 `S2-skin:end` 之前；**既有行零删除零移动**
- ES5 · 零字面色值 · 零新增定时器 · ★**零新增路由**
- ★导图画布既有交互（拖拽/缩放）不得被背景层拦截

## 四、判据可脚本化清单
1. `bg.mindmap` / `illust.sync` 各有真实挂载表达（非设置页）
2. ★背景层 `pointerEvents: 'none'`（不拦截导图交互）
3. ★`deep` 贯通：`assetOf(key, true)` 对 4 个无深色素材的槽位**回落浅色**（负路径）
4. ★深色底 token 存在（53 卷可读性前提）
5. 守恒：`MEMORY_TABS()`=2 · region 18 · R21 段零路径字面量仍成立
6. 负路径：删任一挂载点 ⇒ 断言变红

