# ★用户第八轮裁定：前端仍然糟糕 —— **放弃自研，直接移植原型 HTML**

## 用户原话（逐字）
> 「首先这个 welcome 画得不好，比如你看这个，还是就画一个 complete，然后其他就文字吧」
> 「我看现在前端依然是有问题的。**你为什么没有 1:1 直接把 HTML 前端移植过去呢？为什么要自己做呢？**你看你现在做的还是很糟糕」
> 「而且我不知道为什么左下角会弹出来一个窗口」
> 「而且现在依然不是全屏的，你看一下是什么情况」
> 「而且这个应该是还没有做好迁移，对吧？现在只有一个事件」
> 「这个 log 的框我点了一下以后，它在左下角弹出来，确实有问题」
> 「好吧，你就**对着那个 HTML 文档，或者直接把它的源代码扔上去**不就行了」

---

## §1 · 我先认错：这是「照搬原型」的**第四次**事故

| 次 | 形态 | 当时怎么辩解 |
|---|---|---|
| 1 | 176 个原型 class 复用 **0 个** | 「我按设计稿实现了」 |
| 2 | 380 条裸选择器（95%） | 「我加了作用域」 |
| 3 | 99 个原型类里 67 个 DOM 不存在 | 「我抄了 CSS」 |
| **4** | **用 React 重写了一遍原型，而不是移植原型代码** | 「我用框架重写更可维护」 |

**共同点：每次都是「我以为我在照搬，其实我在重新实现」。**

**正确做法（用户已经说了两遍）**：**把原型的源码直接扔上去**，不是「照着它重写」。

---

## §2 · 原型的真实结构（实测，这是移植的物料清单）

```
artifacts/wb-event-preview/index.html   1,825,547 B / 2,191 行

  L8          <script>              379 B    ← 主题预置（localStorage 读 wbEvt.theme）
  L9-663      <style>            44,424 B    ← ★全部视觉（412 条规则 / 176 class）
  L714        <script id="payload">  ~46 KB   ← ★真实数据（1 个事件，893 检查点聚合）
  L715        <script id="demo-payload"> 1,342 B ← 演示 fixture（可剥掉）
  L716-2190   <script>           62,105 B    ← ★全部运行时（81 个函数）
```

**⇒ 移植只需三件：`<style>` 44KB + `<script>` 62KB + payload 换数据源。其余（head/meta/正文骨架）都能直接用。**

**运行时依赖（实测 39 处 `getElementById` / 16 处 `querySelector` / 6 处 `documentElement`）**：
```
⇒ 它不是一个「纯函数库」，它是「一个直接操作 document 的页面脚本」
⇒ 所以移植的正确形态 = 【iframe srcdoc】或【Shadow DOM + 全量 id 保留】，不能塞进 React 组件树
```

---

## §3 · 三个具体 bug 的根因（都已定位）

### Bug 1：左下角弹窗

**根因**：`lib/client.js` L22-28 有 `createPortal(..., document.body)` —— **所有浮窗都被送到 body**：
```js
var createPortal = require('react-dom').createPortal
function portalToBody(node, kind) {
  return createPortal(h(Iter5Surface, { kind: 'drawer' }, node), document.body)
}
```
**⇒ 用户点 log 框 ⇒ 详情被 portal 到 body ⇒ 落在左下角**（因为它在 body 里没有定位上下文）。

**这与原型的做法根本不同**：原型里详情是 `.detail` **同一 grid 内的第三列**，不是浮层。

### Bug 2：不是全屏

**E8-6 只做了「隐藏输入框」+「引用计数打标」，但没有改 EventView 的宿主容器**。
```
实测：EV4_VISIBLE_PAGES 引用计数（L16381-16443）→ 只 setAttribute("data-dam-fullpage")
     而 [data-dam-page] 的 CSS 规则 → 只覆盖「记忆页」，白板页 surface 根上仍无该属性
⇒ 隐藏了输入框，但页面高度仍由宿主的 main 槽位决定 = 不是全屏
```

### Bug 3：只有一个事件

**这是数据问题，不是前端问题**：
```
真盘 event-store.json：2 个事件（evt_dfc30819 closed 113 检查点 / evt_89786878 active 26 检查点）
用户看到「1 个事件」⇒ 因为 active 只有 1 个，而前端默认只显示 active？
需查：EventView 的 chrono 是否过滤了 status
```

### Bug 4：迁移没做完

**用户说对了**：`event-store.json` 里只有 **2 个事件 / 139 检查点**，而仓里有 **833 篇账本 + 197 条记忆条目**。
**⇒ 迁移（把存量账本聚成事件）根本没跑过。** 页面上「一个事件」= 真实数据就这么多。

---

## §4 · 移植方案（两条路，我推荐 A）

### 方案 A：iframe srcdoc（★推荐）

```
把 44KB CSS + 62KB JS + 46KB payload 拼成一个完整 HTML 字符串
塞进 <iframe srcdoc="...">（或 Blob URL）
数据通过 postMessage 或直接替换 payload 注入
```

| 优点 | 缺点 |
|---|---|
| **100% 1:1，零改动**（原型代码原样跑）| iframe 内 localStorage 与宿主隔离（主题偏好不共享）|
| 原型 39 处 getElementById 全部可用 | 需要 postMessage 桥接数据刷新 |
| 不受宿主 CSS / React 污染 | iframe 高度需手动同步（可 ResizeObserver）|
| 出问题能立刻对照原型排查 | 打印/选中文本略受限 |

### 方案 B：Shadow DOM + 全量 id

```
把原型 HTML 骨架 + CSS + JS 塞进一个 shadowRoot
id 保留（shadow 内 getElementById 走 shadowRoot.getElementById）
```

**⚠ 致命问题**：原型 JS 里是 `document.getElementById`，**shadow DOM 里 document 查不到 shadow 内的元素** ⇒ 必须改 JS（就不是 1:1 了）。

**⇒ 我选 A（iframe srcdoc）。** 理由：**它是唯一能真正「源码原样扔上去」的形态**。

---

## §5 · 实施步骤

```
S1  从 index.html 抽出三块：[style] 44,424 B / [script payload] / [script runtime] 62,105 B
S2  生成 lib/ev4-embedded.js：导出 { CSS, RUNTIME, HTML_SKELETON }（三块纯字符串常量）
S3  client.js 的 EventView 改为：渲染 <iframe>，srcdoc = 拼好的完整 HTML（数据用真 payload 替换）
S4  ResizeObserver 同步 iframe 高度到宿主容器（保证全屏）
S5  数据刷新：宿主拿到 /event-list 后，postMessage 给 iframe；iframe 内加一个 5 行 listener 替换 EV 数组并重渲染
S6  删掉自研的 EventView 全部组件（renderRailPre / renderDetailPanePre / renderEv4CardPre / renderStreamViewPre ...）
S7  验收：真 Chrome 截图逐像素对比原型（允许差异 ≤ 2%）
```

**★S6 是关键**：不删自研实现，就会「两套并存」⇒ 下次又有人改错那套。**换渲染与删旧实现必须分两步**（先换、验证、再删），这是本仓已有纪律。

---

## §6 · welcome 立体字的修正（用户裁定）

> 「这个 welcome 画得不好，比如你看这个，**还是就画一个 complete，然后其他就文字吧**」

**⇒ 改法**：
- **只保留一个**立体字块（`WELCOME` 或 `COMPLETE`）
- 其余全部改成**普通文字**

**为什么我的版本难看**（从用户截图看）：
```
① 阴影用 ▓░ 两色叠加在字形右侧 ⇒ 视觉上「糊成一片」，字看不清
② 我的拉丁点阵字宽 5+2=7 列，但输出去掉了行尾空格 ⇒ 字母间距在等宽字体里被压缩
③ 中文那三行投影（▓▒░）叠在文字下方，让整块看起来像「重影」而不是「立体」
```
**⇒ 修正**：只画 **一个** `█` 实心词（不加阴影，纯白字），下面接普通文字说明。**「立体」不等于「加阴影」，加错阴影反而毁掉可读性。**
