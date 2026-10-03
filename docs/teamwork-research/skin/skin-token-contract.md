# dsh-auto-memory · Teamwork 企业版皮肤接口契约（Skin Token Contract）

> 版本 **1.0.0** ｜ 状态 **草案（可实施）** ｜ 适用原型：`docs/teamwork-research/skin/index.html`
> 读者：第三方皮肤开发者、客户 IT / 品牌团队、集成方前端。

---

## 1. 这份契约解决什么问题

同一套功能界面，要长出不同企业的"皮"：律所的低饱和深蓝、医院的超高对比、工程团队的深色专业、集团的品牌色与页脚水印。
做法是把**外观与结构解耦**：

| 层 | 谁负责 | 交付物 | 允许改什么 |
|---|---|---|---|
| 结构层（组件 DOM / 交互 / 路由） | 产品方 | 组件与页面 | 企业不得改写，只能通过插槽挂载 |
| **皮肤层（唯一可定制面）** | 皮肤作者 / 企业 IT | `--skin-*` CSS 变量 + `theme.json` + 插槽组件 | 颜色、字体、圆角、间距、动效、插槽内容 |
| 行为层（记忆读写 / 召回 / 审计） | 产品方 | 后端与插件 | 企业不得介入（合规需求走企业策略配置） |

四条硬约束（原型已自证）：

1. **零外部依赖**——主题包不引入 CDN、外链字体、构建步骤，双击 `index.html` 即可运行（本原型 `externalRefs = []`）。
2. **组件层不出现字面色值**——本原型组件区（CSS 第 1 节起）字面色值计数为 **0**，全部经 `var(--skin-*)` 消费。
3. **契约驱动**——换肤只改 token；缺失必需 token 即 **fail-closed**（回退默认皮肤并上报），而不是"看起来能跑但颜色乱掉"。
4. **只增不改语义**——token 一旦发布，语义不可变（见 §6）。

---

## 2. Token 命名空间

```
--skin-<domain>-<name>[-<variant>]
   │       │        └─ 变体：soft / strong / hover / active / 1..4
   │       └─ 语义名：brand / surface / radius-card / duration-base …
   └─ 域：space | radius | font | line-height | border-width | shadow |
          duration | ease | color | gradient | sidebar-width | z …
```

约定：

- 前缀固定为 `--skin-`；**企业自定义 token 必须使用 `--skin-ent-*` 前缀**，避免与未来官方 token 撞名。
- 一个 token 只表达一件事；不得用"主题名"做 token（如 `--skin-legal-blue` 是反例）。
- 颜色 token 一律"语义优先"：先 `--skin-color-brand`，再 `--skin-color-brand-strong`；**不出现 `--skin-color-blue-500` 这类色阶 token**。
- 尺寸 token 只从刻度取值（间距 4/8/12/16/20/24/32/48，圆角 4/8/12/16/20/pill）。企业可整体重映射刻度，但不应引入刻度之间的额外档位，否则组件间距会不齐。

---

## 3. Token 完整清单（92 项 · 由原型 CSS 自动导出，与实际皮肤一致）

> 默认值列 = `[data-skin="default"]` 与 `:root` 的实际取值。**"可覆盖=否"的 token 属保留项，企业覆盖会被校验器拒绝。**

#### 间距 / Spacing（8 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-space-1` | length/number | `4px` | 间距刻度 1 级（4px，用于图标与文字之间） | 是 |
| `--skin-space-2` | length/number | `8px` | 间距刻度 2 级（标签之间、紧凑列表） | 是 |
| `--skin-space-3` | length/number | `12px` | 间距刻度 3 级（卡片内元素） | 是 |
| `--skin-space-4` | length/number | `16px` | 间距刻度 4 级（栅格 gutter、卡片内边距） | 是 |
| `--skin-space-5` | length/number | `20px` | 间距刻度 5 级（面板内边距、区块间距） | 是 |
| `--skin-space-6` | length/number | `24px` | 间距刻度 6 级（页面左右留白） | 是 |
| `--skin-space-7` | length/number | `32px` | 间距刻度 7 级（大区块分隔） | 是 |
| `--skin-space-8` | length/number | `48px` | 间距刻度 8 级（页面底部留白） | 是 |

#### 圆角 / Radius（7 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-radius-xs` | length/number | `4px` | 极小圆角（标签、页码按钮） | 是 |
| `--skin-radius-sm` | length/number | `8px` | 小圆角（按钮、输入框） | 是 |
| `--skin-radius-md` | length/number | `12px` | 中圆角（面板、抽屉、面包屑容器） | 是 |
| `--skin-radius-lg` | length/number | `16px` | 大圆角（品牌方标、导图中心节点） | 是 |
| `--skin-radius-xl` | length/number | `20px` | 超大圆角（保留档位） | 是 |
| `--skin-radius-pill` | length/number | `999px` | 胶囊圆角（开关、进度条、头像） | 是 |
| `--skin-radius-card` | length/number | `14px` | 卡片圆角（全局卡片默认，概念图 12–16px） | 是 |

#### 字体 / Typography（16 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-font-family` | string/其他 | `"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif` | 正文字体族（离线系统字体栈，禁止外链字体） | 是 |
| `--skin-font-family-heading` | string/其他 | `var(--skin-font-family)` | 标题字体族（律所示例改用宋体） | 是 |
| `--skin-font-mono` | string/其他 | `"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace` | 等宽字体族（ID、分数、路径） | 是 |
| `--skin-font-size-xs` | length/number | `11px` | 字号：辅助说明 11px | 是 |
| `--skin-font-size-sm` | length/number | `12px` | 字号：次要文本 12px | 是 |
| `--skin-font-size-md` | length/number | `13px` | 字号：正文 13px（无障碍主题放大到 16px） | 是 |
| `--skin-font-size-lg` | length/number | `15px` | 字号：小标题 15px | 是 |
| `--skin-font-size-xl` | length/number | `18px` | 字号：区块标题 18px | 是 |
| `--skin-font-size-2xl` | length/number | `22px` | 字号：统计数字 22px | 是 |
| `--skin-font-size-3xl` | length/number | `28px` | 字号：页面主标题 28px | 是 |
| `--skin-line-height` | length/number | `1.65` | 正文行高 | 是（谨慎） |
| `--skin-line-height-tight` | length/number | `1.28` | 标题行高 | 是（谨慎） |
| `--skin-font-weight-normal` | string/其他 | `400` | 字重：常规 | 是 |
| `--skin-font-weight-medium` | string/其他 | `500` | 字重：中等（标签、次级按钮） | 是 |
| `--skin-font-weight-bold` | string/其他 | `650` | 字重：加粗（标题、关键数字） | 是 |
| `--skin-letter-spacing` | string/其他 | `0` | 字距（默认 0；品牌字体可按需微调） | 是 |

#### 描边与阴影 / Border & Shadow（6 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-border-width-card` | string/其他 | `1px` | 卡片描边宽度（概念图为 1px 细边框） | 是 |
| `--skin-border-width-strong` | string/其他 | `1px` | 强调描边宽度（表格分隔、选中态） | 是 |
| `--skin-focus-ring-width` | string/其他 | `2px` | 键盘焦点外框宽度 | 是 |
| `--skin-focus-ring-offset` | string/其他 | `2px` | 焦点外框偏移 | 是 |
| `--skin-shadow-card` | string/其他 | `0 1px 2px rgba(23,32,60,.04), 0 10px 26px -18px rgba(23,32,60,.35)` | 卡片阴影（柔和、低透明度） | 是 |
| `--skin-shadow-pop` | string/其他 | `0 16px 40px -12px rgba(23,32,60,.28)` | 浮层阴影（下拉、主题切换面板、弹窗） | 是 |

#### 动效 / Motion（6 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-duration-instant` | length/number | `90ms` | 动效时长：即时反馈 | 是 |
| `--skin-duration-fast` | length/number | `150ms` | 动效时长：hover / 开关 | 是 |
| `--skin-duration-base` | length/number | `220ms` | 动效时长：路由切换、换肤过渡 | 是 |
| `--skin-duration-slow` | length/number | `360ms` | 动效时长：大面积展开 | 是 |
| `--skin-ease-standard` | string/其他 | `cubic-bezier(.2,.8,.2,1)` | 缓动：标准（大多数过渡） | 是 |
| `--skin-ease-emphasized` | string/其他 | `cubic-bezier(.34,1.16,.64,1)` | 缓动：强调（页面进场） | 是 |

#### 布局与层级 / Layout & Z（7 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-sidebar-width` | length/number | `226px` | 左侧栏宽度（影响主区左边距） | 是 |
| `--skin-topbar-height` | length/number | `64px` | 顶栏高度 | 是 |
| `--skin-content-max` | length/number | `1380px` | 内容区最大宽度 | 是 |
| `--skin-z-sidebar` | length/number | `20` | 层级：左侧栏 | 是（谨慎） |
| `--skin-z-topbar` | length/number | `30` | 层级：顶部栏 | 是（谨慎） |
| `--skin-z-overlay` | length/number | `60` | 层级：浮层与弹窗 | 是（谨慎） |
| `--skin-opacity-disabled` | string/其他 | `.55` | 禁用态不透明度 | 是（谨慎） |

#### 品牌与文本色 / Brand & Text（9 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-color-text` | color | `#1b2333` | 正文主文本 | 是 |
| `--skin-color-text-muted` | color | `#5a6580` | 次要文本（说明、摘要） | 是 |
| `--skin-color-text-subtle` | color | `#8a94ab` | 最弱文本（时间戳、占位） | 是 |
| `--skin-color-text-inverse` | color | `#ffffff` | 反色文本（深底上的文字） | 是 |
| `--skin-color-brand` | color | `#4a5df9` | 品牌主色（按钮、选中、链接；蓝紫基调） | 是 |
| `--skin-color-brand-strong` | color | `#3a49d6` | 品牌主色加深（hover / active） | 是 |
| `--skin-color-brand-soft` | color | `#e8ecff` | 品牌浅底（图标底、选中背景） | 是 |
| `--skin-color-brand-softer` | color | `#f2f5ff` | 品牌极浅底（插槽、提示块背景） | 是 |
| `--skin-color-brand-contrast` | color | `#ffffff` | 品牌底上的对比文字色 | 是 |

#### 表面与描边色 / Surface & Border（16 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-color-bg-app` | color | `#eef1f8` | 应用最外层背景（浅灰蓝底） | 是 |
| `--skin-color-bg-canvas` | color | `#f7f9fd` | 内容画布背景 | 是 |
| `--skin-color-surface` | color | `#ffffff` | 卡片/面板表面色（概念图白色卡片） | 是 |
| `--skin-color-surface-2` | color | `#f4f7fd` | 次级表面（输入框、内嵌块、hover） | 是 |
| `--skin-color-surface-sunken` | color | `#e9eef8` | 下沉表面（分隔、骨架） | 是 |
| `--skin-color-sidebar-bg` | color | `#eef1f8` | 左侧栏背景（概念图为浅灰） | 是 |
| `--skin-color-sidebar-border` | color | `#e2e7f3` | 左侧栏分隔线 | 是 |
| `--skin-color-sidebar-brand` | color | `#4a5df9` | 左侧栏品牌色（Logo 方标渐变起点之基色） | 是 |
| `--skin-color-sidebar-item-bg-hover` | color | `#e3e9f6` | 侧栏菜单项 hover 背景 | 是 |
| `--skin-color-sidebar-item-bg-active` | color | `#dce5fb` | 侧栏菜单项选中背景 | 是 |
| `--skin-color-sidebar-text` | color | `#3d4658` | 侧栏常规文本 | 是 |
| `--skin-color-sidebar-text-muted` | color | `#7d879e` | 侧栏弱化文本（分组标题） | 是 |
| `--skin-color-sidebar-text-active` | color | `#3a49d6` | 侧栏选中文本 | 是 |
| `--skin-color-border` | color | `#e3e8f4` | 常规描边（卡片、表格行） | 是 |
| `--skin-color-border-strong` | color | `#ccd5ea` | 强描边（分区分隔、聚焦容器） | 是 |
| `--skin-color-overlay` | color | `rgba(20,28,50,.42)` | 遮罩层颜色（半透明） | 是 |

#### 状态色 / Status（9 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-color-success` | color | `#1f9d68` | 状态色：成功绿（已命中、已完成） | 是 |
| `--skin-color-success-soft` | color | `#e4f6ee` | 成功浅底 | 是 |
| `--skin-color-warning` | color | `#d9871a` | 状态色：警告橙（一般、待处理） | 是 |
| `--skin-color-warning-soft` | color | `#fdf1df` | 警告浅底 | 是 |
| `--skin-color-danger` | color | `#d94a4a` | 状态色：危险红（不相关、删除） | 是 |
| `--skin-color-danger-soft` | color | `#fdeced` | 危险浅底 | 是 |
| `--skin-color-info` | color | `#2f6fed` | 状态色：信息蓝（自动识别、提示） | 是 |
| `--skin-color-info-soft` | color | `#e9f0ff` | 信息浅底 | 是 |
| `--skin-color-focus-ring` | color | `#4a5df9` | 键盘焦点环颜色（无障碍主题须高对比） | 是 |

#### 图表与渐变 / Chart & Gradient（7 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-color-chart-track` | color | `#e6ebf7` | 图表轨道底色（环形图、进度条） | 是 |
| `--skin-color-chart-1` | color | `#4a5df9` | 图表色 1（主数据系列） | 是 |
| `--skin-color-chart-2` | color | `#7e9bff` | 图表色 2 | 是 |
| `--skin-color-chart-3` | color | `#b9c9ff` | 图表色 3 | 是 |
| `--skin-color-chart-4` | color | `#dbe4ff` | 图表色 4 | 是 |
| `--skin-gradient-banner` | color | `linear-gradient(120deg,#e7eeff 0%,#f3f7ff 48%,#e9f1ff 100%)` | 首页 AI 已整理横幅的柔性渐变 | 是 |
| `--skin-gradient-brand` | color | `linear-gradient(135deg,#5b6cff 0%,#3f52e8 100%)` | 品牌渐变（Logo 方标、头像底） | 是 |

#### 元信息 / Meta（1 项）

| Token | 类型 | 默认值（default 主题） | 作用 | 企业可覆盖 |
|---|---|---|---|---|
| `--skin-version` | string/其他 | `"1.0.0"` | 皮肤契约版本号（只读，用于运行时核对 specVersion） | 否（只读） |

---

## 4. 主题包（Theme Package）

### 4.1 目录结构

```
acme-legal-theme/                 # 包根目录（可放内网静态服务器或插件目录）
├── theme.json                    # 必需：主题清单（schema 见 §4.2）
├── tokens.css                    # 必需：token 覆盖（只允许 --skin-* / --skin-ent-* 声明）
├── assets/                       # 可选：图片、图标（不得外链）
│   └── logo.svg
├── components/                   # 可选：插槽组件（纯 JS + CSS，无构建）
│   ├── sidebar-brand.js
│   ├── home-banner.js
│   └── settings-section.js
└── README.md                     # 可选：给客户 IT 的说明
```

约束：包内不得出现远程 URL 引用（`https://`、`//cdn`）；不得包含 `<script src>` 外链；单包建议 ≤ 200 KB。

### 4.2 `theme.json` Schema

```json
{
  "$schema": "https://dsh-auto-memory.local/skin/theme.schema.json",
  "specVersion": "1.0.0",
  "id": "acme-legal",
  "name": "Acme 律所皮肤",
  "version": "2.3.0",
  "extends": "default",
  "description": "低饱和深蓝 + 宋体标题，用于合规与案件材料场景",
  "author": { "name": "Acme IT", "contact": "it@acme.example" },
  "tokens": {
    "file": "tokens.css",
    "overrides": { "--skin-radius-card": "8px" },
    "locked": ["--skin-space-4"]
  },
  "supports": { "modes": ["light", "dark"], "locales": ["zh-CN", "en-US"] },
  "slots": [
    {
      "slotId": "sidebar-brand",
      "component": "components/sidebar-brand.js",
      "context": "*",
      "order": 10,
      "permissions": ["read:brand"]
    },
    {
      "slotId": "settings-section",
      "component": "components/settings-section.js",
      "context": "settings",
      "order": 20,
      "permissions": ["read:policy", "write:policy(local)"]
    }
  ],
  "features": { "auditRetentionDays": 180, "disableExternalExport": true }
}
```

字段说明：

| 字段 | 必需 | 说明 |
|---|---|---|
| `specVersion` | 是 | 本契约版本；主版本不匹配 → 拒绝加载（fail-closed） |
| `id` | 是 | 稳定标识，用于 `?skin=` 与 `data-skin`；变更等于换主题 |
| `extends` | 否 | 继承的主题（默认 `default`），未覆盖 token 回落父主题 |
| `tokens.file` | 是 | 相对路径的 CSS 文件；`tokens.overrides` 为内联补充（优先级更高） |
| `tokens.locked` | 否 | 本包**拒绝**被下游二次覆盖的 token（用于集团统管场景） |
| `supports.modes` | 否 | 声明支持 light/dark；未声明则跟随主题本体 |
| `slots[]` | 否 | 插槽挂载声明，见 §5 |
| `features` | 否 | 只影响企业侧的展示与策略提示，**不改变记忆读写行为** |

### 4.3 本原型的 4 套内置主题

| id | 名称 | 设计取向 | 可验证差异 |
|---|---|---|---|
| `default` | Default | 浅色底 + 蓝紫主色、白卡 + 细边框 + 柔和阴影、圆角 12–16px（对齐概念图基调） | 基准 |
| `enterprise-blue` | Enterprise Blue | 低饱和深蓝（`#274a7a`）+ 宋体标题 + 侧栏深色 + 圆角收紧到 8px | 律所/金融；`--skin-font-family-heading` 改为宋体 |
| `dark-pro` | Dark Pro | 深色专业（`#0d1016`/`#161b24`）+ 高对比文本 + 阴影改深 | 工程/夜间 |
| `a11y-contrast` | 高对比无障碍 | 纯黑白描边 2px + 字号整档放大 + `--skin-duration-*` 全部 0ms | 医院/政务；动效关闭 |

演示入口：`index.html?skin=enterprise-blue`，或页面右上角「皮肤切换器」。

---

## 5. 三种接入方式

### 方式 ①：直接覆盖 CSS 变量（最快，零代码）

在应用样式表之后插入一段覆盖即可；适用于客户 IT 只改颜色/圆角的场景。

```html
<link rel="stylesheet" href="acme-legal-tokens.css"><!-- 必须在皮肤基座样式之后 -->
```

```css
/* acme-legal-tokens.css —— 只声明 token，不写组件选择器 */
:root, [data-skin] {
  --skin-color-brand: #274a7a;
  --skin-color-brand-strong: #1b3559;
  --skin-radius-card: 8px;
}
```

**禁止**在覆盖文件里写组件选择器（`.card { ... }`、`.btn { ... }`）——那会绕过契约，使后续升级产生不可预期的覆盖冲突；校验器会拒绝此类文件（见 §7）。

### 方式 ②：加载主题包 JSON（推荐给企业定制）

```js
// 1) 读取 theme.json → 2) 校验 → 3) 注入 tokens.css → 4) 挂载插槽
const res = await fetch('./themes/acme-legal/theme.json');
const theme = await res.json();
window.dshAutoMemorySkin.applyTheme(theme);   // 原型 API：见下方清单
```

原型已内置的运行时 API（`window.dshAutoMemorySkin`，v1.0.0）：

| 方法 | 作用 | 返回 |
|---|---|---|
| `useTheme(id)` / `applySkin(id)` | 切换皮肤（等价于 `?skin=`） | `void`；未知 id 自动回退并记录 |
| `setMode('light'｜'dark')` | 切换明暗模式（与皮肤正交） | `void` |
| `setLang('zh'｜'en')` | 切换界面文案（`data-i18n` 键） | `void` |
| `getToken(name)` | 读取 token 计算值 | `string` |
| `verifyTokens()` | 契约校验 | `{ missing: string[], required: string[] }` |
| `mountSlot(slotId, html, { context })` | 挂载插槽内容 | 命中的插槽数（未知 slotId 返回 0 并告警） |
| `slotIds` / `themes` | 能力清单 | `string[]` |
| `rejected()` | 被拒绝/回退的记录（合规取证） | `Array<{requested, fallback, at, source}>` |

### 方式 ③：挂载自定义组件插槽（企业功能扩展）

插槽是**结构层的预留空洞**；企业组件只负责往洞里放内容，不修改既有 DOM。

| slotId | 位置 | 默认 context 取值 | 典型用途 |
|---|---|---|---|
| `sidebar-brand` | 侧栏品牌区（Logo 与菜单之间） | `*`（全局唯一） | 企业 Logo、合规徽标、环境水印（测试/生产） |
| `home-banner` | 首页横幅区（AI 已整理横幅之上） | `home` | 合规公告、数据分级提醒、版本公告 |
| `memory-card-foot` | 记忆卡尾部（每张记忆卡/白板卡列尾部） | `preference`｜`project`｜`skill`｜`handoff-board`｜记忆 id | 「禁止导出」标签、密级章、责任人 |
| `settings-section` | 设置页扩展分区（页面标题之下、卡片之上） | `settings` | 企业策略面板（审计留存、导出策略） |
| `detail-actions` | 详情面板动作条（原有按钮之前） | `recall`｜`library`｜`external` | 「导出审计包」「上报合规」「提交复核」 |

挂载示例：

```js
dshAutoMemorySkin.mountSlot('detail-actions',
  '<button class="btn btn--sm" data-acme-export>导出审计包</button>',
  { context: 'recall' });          // 只在召回详情面板出现
```

规则：
- 插槽内容必须复用宿主组件类（`.btn` / `.card` / `.chip` …）并只消费 token，**不得内联 brand 色值**；
- 同一 `slotId` 同一 `context` 只保留最后一次挂载（后挂载者胜），避免出现两份策略条；
- 插槽组件抛异常时宿主**只丢弃该插槽内容**，不影响页面其余部分（失败隔离）；
- 插槽不可用于修改记忆数据：任何写入必须走宿主既有 API（企业侧无直连写权限）。

---

## 6. 版本兼容策略

**契约版本号 `specVersion`（本文件 = 1.0.0）与皮肤包版本 `theme.version` 相互独立。**

| 规则 | 内容 |
|---|---|
| 只增不改 | 已发布 token 的**语义与类型不可变**；新增 token 必须带默认值，且默认值下视觉与旧版一致 |
| 语义不变式 | 例如 `--skin-color-danger` 永远表示"危险/错误"，不得在 2.x 里改为装饰色 |
| 废弃期（deprecation） | 需要下线 token 时：① 标记 deprecated 并保留 **≥2 个 minor 版本（建议 ≥6 个月）**；② 期间新旧 token 同时生效、值自动同步；③ 仅在 **major 版本**移除，且在 CHANGELOG 与迁移表列出替代 token |
| 主版本边界 | 结构性变化（组件类名、插槽 id、`theme.json` 字段语义）才升主版本 |
| 降级兼容 | 主版本不匹配时**不猜测**：拒绝加载该主题包并按 §7 fail-closed 处理，保留内置 `default` |
| 企业侧锁定 | 企业可用 `tokens.locked` 声明"本包内这些 token 不接受下游二次覆盖"（集团统管子公司场景） |

---

## 7. 冲突与优先级、校验与 fail-closed

### 7.1 优先级（后者胜，从低到高）

```
1. 皮肤基座默认值（:root）
2. --skin-version 主版本（[data-skin="default"]）
3. 企业包 tokens.css（.theme）
4. 企业包 theme.json → tokens.overrides
5. 用户本地偏好（仅限 mode / 界面字号 / 语言；不承载品牌）
6. 无障碍强制层（操作系统 prefers-reduced-motion、强制高对比 → 只覆盖动效与对比，不覆盖品牌色）
```

同优先级同特异性时，后加载者胜（CSS 既有规则）。**明暗模式层与皮肤主题层正交**：先按 `data-skin` 取形状与品牌，再按 `data-theme-mode` 覆盖色值。

### 7.2 冲突裁决

| 冲突 | 裁决 |
|---|---|
| 企业包与用户本地偏好都改颜色 | 企业包胜（偏好层只允许改 mode/字号/语言） |
| 插槽组件内联了字面颜色 | 校验失败 → 拒绝该组件，其余插槽照常 |
| 两个插槽组件挂同一 slotId+context | 后挂载者胜，并在 `rejected()` 记录被替换者 |
| 企业包声明了只读 token（`tokens.locked`）却被下游再覆盖 | 保留企业包值，记录越权尝试 |

### 7.3 校验清单（加载前执行）

1. `theme.json` 可解析、必需字段齐全、`specVersion` 主版本匹配；
2. `tokens.css` 内容仅含 `--skin-*` / `--skin-ent-*` 声明与注释（**出现组件选择器即拒绝**）；
3. 必需 token 子集存在且非空（原型实测集合）：
   `--skin-color-brand`、`--skin-color-text`、`--skin-color-surface`、`--skin-color-border`、`--skin-radius-card`、`--skin-space-4`、`--skin-font-family`、`--skin-duration-base`、`--skin-shadow-card`；
4. 类型匹配（颜色 token 不得被赋成 `12px`；长度 token 不得被赋成颜色）；
5. 包内无远程 URL。

### 7.4 fail-closed 行为（不静默降级）

| 失败点 | 行为 |
|---|---|
| 未知 `?skin=xxx` / 未知 `id` | **不套用半成品**；回退 `default`，控制台告警 + 界面提示条，写一条 `rejected()` 记录（原型实测：`?skin=lawfirm-x → default`，并在 URL 中把 `skin` 归一为 `default`） |
| `theme.json` 校验失败 | 拒绝整包（不部分应用 token），保留当前皮肤 |
| 必需 token 缺失 | 回退 `default` 并上报缺失清单（原型：`verifyTokens().missing`） |
| 插槽组件抛错 | 丢弃该插槽内容，页面其余可用 |
| 每一条失败都**必须可见**：控制台 + 屏幕提示条 + 可查询记录，避免"静默变回默认色"被当成产品 bug |

---

## 8. 企业定制示例

### 示例 A：律所「Acme Legal」——低饱和深蓝 + 宋体标题

```json
{
  "specVersion": "1.0.0", "id": "acme-legal", "name": "Acme 律所皮肤",
  "version": "2.3.0", "extends": "default",
  "tokens": { "file": "tokens.css" },
  "supports": { "modes": ["light"], "locales": ["zh-CN"] }
}
```

```css
/* acme-legal/tokens.css —— 可直接粘贴 */
:root, [data-skin] {
  --skin-font-family: "Songti SC","SimSun","Source Han Serif SC","Noto Serif SC",
                      "PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --skin-font-family-heading: var(--skin-font-family);
  --skin-font-size-md: 14px;            /* 正文略放大，长文更耐读 */
  --skin-radius-card: 8px;              /* 与律所 VIS 一致：方正 */
  --skin-radius-md: 8px;
  --skin-radius-sm: 5px;
  --skin-shadow-card: 0 1px 1px rgba(16,28,48,.06), 0 6px 16px -14px rgba(16,28,48,.30);

  --skin-color-brand: #274a7a;          /* 低饱和深蓝 */
  --skin-color-brand-strong: #1b3559;
  --skin-color-brand-soft: #e6ecf5;
  --skin-color-brand-softer: #f0f4fa;
  --skin-color-sidebar-bg: #1e2b41;     /* 深色侧栏，突出版权归属 */
  --skin-color-sidebar-text: #d7dfea;
  --skin-color-sidebar-item-bg-active: #32456a;
  --skin-color-sidebar-brand: #c8a96b;  /* 低饱和金，作为品牌点缀 */
  --skin-color-border: #d9dfe7;
  --skin-color-text: #1a2433;
  --skin-color-text-muted: #4c5a70;
}
```

预期效果：侧栏深蓝、卡片方正、正文宋体、金色仅用于品牌点缀（面积 < 2%）。

### 示例 B：医院「MedCare」——高对比 + 大字号无障碍

```css
/* medcare/tokens.css —— 可直接粘贴 */
:root, [data-skin] {
  --skin-font-size-xs: 13px; --skin-font-size-sm: 14px; --skin-font-size-md: 16px;
  --skin-font-size-lg: 18px; --skin-font-size-xl: 21px; --skin-font-size-2xl: 26px;
  --skin-font-size-3xl: 32px;
  --skin-line-height: 1.8;              /* 大字号需更大行距 */
  --skin-font-weight-medium: 600;
  --skin-border-width-card: 2px;        /* 描边加重，提升边界可辨性 */
  --skin-border-width-strong: 2px;
  --skin-focus-ring-width: 3px;         /* 键盘焦点更醒目 */
  --skin-focus-ring-offset: 3px;

  --skin-color-bg-app: #ffffff;         /* 纯白底，避免浅灰造成的低对比 */
  --skin-color-surface: #ffffff;
  --skin-color-border: #000000;
  --skin-color-text: #000000;           /* 正文对比度 ≥ 7:1 */
  --skin-color-brand: #0b3fbf;
  --skin-color-success: #0a6b3d;
  --skin-color-warning: #8a4b00;
  --skin-color-danger: #a80000;         /* 状态色一律加深，保证文字可读 */
  --skin-color-focus-ring: #0b3fbf;

  --skin-duration-instant: 0ms;         /* 关闭动效（前庭安全） */
  --skin-duration-fast: 0ms;
  --skin-duration-base: 0ms;
  --skin-duration-slow: 0ms;
}
```

配套建议：`theme.json` 中声明 `"supports": { "modes": ["light"] }`（高对比主题不提供暗色变体），并在 `slots` 里挂载 `sidebar-brand` 的「无障碍模式已启用」徽标。

---

## 9. 验收清单（客户 IT 可用）

- [ ] `?skin=<企业 id>` 打开后，页面**无字面品牌色残留**（抽查按钮、选中态、图表）。
- [ ] 断开网络后仍可打开（零外链）。
- [ ] `grid` 布局在 1440 / 1280 / 1024 / 860 宽度下不破版（860 以下侧栏收起）。
- [ ] `dshAutoMemorySkin.verifyTokens().missing.length === 0`。
- [ ] `dshAutoMemorySkin.rejected()` 为空或仅含预期内的回退记录。
- [ ] 五个插槽按 `context` 挂载正确，设置页出现企业策略分区。
- [ ] 键盘 `Tab` 走查：焦点环可见、对比达标；开启系统"减少动态效果"后无过渡动画。
- [ ] 暗色模式与品牌色正交：切 `dark` 后品牌色仍是企业色相。

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | （本次交付） | 首版契约：92 项 token、`theme.json` schema、三种接入方式、五个插槽、版本与 fail-closed 策略、2 个企业示例 |

