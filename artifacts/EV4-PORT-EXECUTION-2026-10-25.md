# 原样移植（不再重写）· 执行报告 2026-10-25

## 一、四个 bug 的根因（都已定位到行）

| # | 现象 | 根因 |
|---|---|---|
| 1 | 左下角弹窗 | `client.js` L22-28 `createPortal(..., document.body)` —— 所有浮窗送 body；你点 log 框 ⇒ 详情被 portal 到 body ⇒ 无定位上下文 ⇒ 掉左下角。**原型里详情是 grid 第三列，根本不是浮层。** |
| 2 | 不是全屏 | E8-6 只做「隐藏输入框 + 引用计数打标」，但 `[data-dam-page]` 只挂记忆页，白板页 surface 根没有 ⇒ 高度链 CSS 不生效 |
| 3 | 只有一个事件 | **不是 bug 是数据**：event-store.json 真的只有 2 个事件（113 + 26 检查点）|
| 4 | 迁移没做完 | 仓里 833 篇账本 + 197 条记忆条目，只聚出 2 个事件 ⇒ 迁移脚本没跑过 |

## 二、交付物 1：lib/ev4-prototype-blocks.js（126,343 B）

**里面没有一个字节是我写的 UI 代码**，全部从 artifacts/wb-event-preview/index.html 原样切出：

| 常量 | 大小 | 来源行 |
|---|---|---|
| EV4_PROTO_HEAD | 421 B | L1–L7 |
| EV4_PROTO_THEME_SCRIPT | 396 B | L8 |
| EV4_PROTO_CSS | 44,439 B | L9–L663（412 条规则 / 176 class）|
| EV4_PROTO_BODY_SHELL | 3,768 B | L664–L713 |
| EV4_PROTO_RUNTIME | 62,103 B | L717–L2189（81 函数 / 39 处 getElementById）|

**为什么拆五块**：①payload 每次刷新换数据 ②套件能单独断言 CSS 412 条 / 运行时 81 函数 ③五块各管一段，拼装顺序可断言。

**第一版踩的坑**：我把 `<style>` 重复拼了（shell 里本来就含 L9-L663），靠断言「built 里 `<style>` 出现 1 次」抓出来。

## 三、交付物 2：真 Chrome 实测（artifacts/_ev4port/）

```
iframe HTML 285,296 B → artifacts/_ev4-iframe-preview.html
真 Chrome 1600x1000：
  .card = 2    .tick = 2    .cp = 26（首屏）/ 113（点开）
  .panel = 678    .dtl = 1    .src = 113
  顶栏 chips = 文档 197 / 事件 2 / 检查点 139 / 最大事件 113 点
```

**关键发现**：原型顶栏 chips 是**写死在 HTML 里**的（839/127/839/26 点/24.4%）。直接扔上去会显示「事件 127」= 假数据。已加 `patchShellStatsPre()` 在拼装时按真实 stats 替换（实测残留 `839` = 0）。

## 四、为什么必须是 iframe（不是 Shadow DOM / 不是 React）

| 方案 | 可行性 |
|---|---|
| iframe srcdoc | ✅ 原型代码一字不改直接跑 —— **选它** |
| Shadow DOM | ❌ `document.getElementById` 查不到 shadow 内元素 ⇒ 必须改 JS ⇒ 不是 1:1 |
| React 重写 | ❌ **这就是前三次犯的错** |

## 五、交付物 3：celebration-art.js v2（5,423 B）

用户裁定「只画一个 complete，其他就文字」⇒ 改成：

```
── WELCOME ──

 ████  ███  █   █ ████  █     █████ █████ █████
█     █   █ ██ ██ █   █ █     █       █   █
█     █   █ █ █ █ █   █ █     █       █   █
█     █   █ █   █ ████  █     ████    █   ████
█     █   █ █   █ █     █     █       █   █
█     █   █ █   █ █     █     █       █   █
 ████  ███  █   █ █     █████ █████   █   █████
▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄

欢迎来到面向持续人机交互的
情景化主动记忆时代

—— 你的记忆已从流水账升级为事件，并已归位到人之上的层。
```

**v1 为什么难看**：阴影用 ▓░ 叠在字形右侧/下方 ⇒ 糊成一片；中文三行投影 ⇒ 像重影。「立体」被我理解成「堆阴影」，加错阴影等于毁可读性。v2 只留一个实心词 + 一行底边。

## 六、执行顺序

```
S0  先查：iframe 塞进宿主 React 树，宿主会给它足够高度吗？（决定 S2 只是加 ResizeObserver 还是要改槽位）
S1  EventView 改成 iframe（替换自研渲染）
S2  ResizeObserver 同步高度 → 解决「不是全屏」
S3  数据刷新：/event-list → postMessage → iframe 内替换 EV 重渲染
S4  删自研 EventView 全部组件（renderRailPre / renderDetailPanePre / renderEv4CardPre / renderStreamViewPre…）
S5  左下角弹窗：详情已在 iframe 内，天然不掉出来
S6  跑迁移（833 篇账本 → 事件）
S7  真 Chrome 截图 vs 原型逐像素对比
```