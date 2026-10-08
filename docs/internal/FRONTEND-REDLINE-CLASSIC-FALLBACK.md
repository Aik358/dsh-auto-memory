# 前端红线 · 经典档（legacy / classic）兜底规矩

> **强制约定**，2026-10-08 用户裁定。适用文件：`skins/iter5/legacy-native-overlays.css`（经典档浮层补丁，由生成器以 `LEGACY_OVERLAY_EXTRA` 追加进 `LEGACY_ITER5_CSS`）。
> 守卫脚本：`tests/smoke/smoke-test-lb1-classic-fallback.mjs`（A/B/C/D 四条）· `tests/smoke/smoke-test-lb1-negative.mjs`（负路径）· `tests/smoke/smoke-test-lb1-welcomeback-render.mjs`（真渲染验收）。

## 一、规矩内容（用户口径原文）

1. 经典档**禁止任何自定义属性的「定义」**（`--i5-*` / `--dam-*` 等 `--x:` 形式）——
   变量外泄会让**所有页面**被染上底色（用户实测：加定义即出现蓝底怪状）。只允许「读取」：`var(--token, 兜底值)`。
2. 遇到经典档**未定义**的令牌时，兜底一律取**经典档自己的**取值形态：蓝底实心 + 白字
   ⇒ `background: var(--i5-blue, #2563EB); color: var(--i5-surface, #FFFFFF);`
3. 任何新浮层样式都必须同时满足 1 与 2。

## 二、为什么（根因）

- **变量外泄**：经典档的样式表是**共享**的（`#dam-shared-ui-style` 全页面可见）。一旦在其中出现 `--x:` 定义，该变量会沿 DOM 继承链泄漏到经典档的**所有**组件，出现整页被染色的怪状。故经典档只能「消费」令牌，不能「生产」令牌。
- **兜底链必须落在经典档体系内**：经典档的令牌来自冻结表 `skins/legacy/iter5-325.js.frozen`，其中**只有 43 个**自定义属性有定义。若 `var()` 的兜底链里引用了**其它皮肤体系**的令牌（如 `--dsw-alias-fg-on-accent`），经典档解析时该令牌同样未定义 ⇒ 只能继续落到字面量；语义上不可靠，且一旦宿主改了同名令牌就会静默变色。
  ⇒ 规矩：**兜底链内只允许出现白名单（那 43 个）令牌与字面量**。

## 三、判据（守卫断言，跑在回归套件里）

| 编号 | 断言 | 位置 |
|---|---|---|
| **A** | `legacy-native-overlays.css` 中 `--x:` 形式的**定义计数 == 0**（硬红线） | `smoke-test-lb1-classic-fallback.mjs` §A |
| **B** | 每条 `var()` 的**兜底链内不得出现非白名单令牌**（白名单＝冻结 legacy 表里定义的 43 个；无兜底裸读同样违规） | 同 §B |
| **C** | primary 按钮形态锁死：`background: var(--i5-blue, #2563EB)` + `color: var(--i5-surface, #FFFFFF)` | 同 §C |
| **D** | 新增规则只落在 `welcomeBack`（其余四个弹窗零改动） | 同 §D |

负路径（`smoke-test-lb1-negative.mjs`，在 `os.tmpdir()` 副本上真变异）：
- 插一条 `--x:` 定义 ⇒ **A 必红**；
- 把 `--i5-blue` 的兜底改含 `--dsw-alias-brand-primary` ⇒ **B 必红**；
- primary 改回旧形态 ⇒ **C 必红**；三者还原均复绿。

**白名单（43 个，自动取自冻结表，非手写）**：`--dam-accent --dam-scale --dsw-alias-bg-layer-1 --dsw-alias-bg-layer-2 --dsw-alias-border-l1 --dsw-alias-label-primary --dsw-alias-label-secondary --i5-bg --i5-blue --i5-compact-control --i5-compact-gap --i5-control-radius --i5-cyan --i5-dur-fast --i5-dur-press --i5-dur-quick --i5-dur-slow --i5-ease-drawer --i5-ease-in-out --i5-ease-out --i5-ease-pop --i5-error --i5-fill --i5-green --i5-indigo --i5-line --i5-muted --i5-ok --i5-orange --i5-pink --i5-purple --i5-radius --i5-secondary --i5-shadow --i5-side --i5-sidebar --i5-slate --i5-soft --i5-stagger --i5-surface --i5-tag-radius --i5-text --i5-warning`
> 守卫**不写死**该列表：它在运行时从冻结表解析，故表演进后判据自动跟随（避免判据过期）。

## 四、违反案例（本次实际发生）

**「欢迎回来」primary 按钮看不清（L-B1）**。
- 现象：经典档下右侧「打开记忆」按钮呈半透明空胶囊，文字看不见。
- 根因①：primary 原写成 `background: var(--dsw-alias-brand-primary,#4f7cff)` + `color: var(--i5-on-accent, var(--dsw-alias-fg-on-accent,#fff))` —— 这**三个令牌在冻结 legacy 表里定义数均为 0** ⇒ 落到 `#4f7cff` / `#fff` = **3.71:1**，低于 WCAG AA 的 4.5:1。
- ~~根因②（放大因素）：`AutoContinueHost` **无条件**渲染 `[data-native-continuation]`……~~ **★该条已证伪并撤回（2026-10-08，Lead 复核）**：调用点有外层守卫 —— `lib/client.js:17372` 处为 `if (acConfirm || acCd > 0 || acSt) {`，而 `:17392` 处 `return null` ⇒ 三者为空时组件**根本不挂载**。原取证是「直接调用组件函数」的结果，不等于产线渲染。故几何/z-index 改动已撤回，本卡保持原位右下角；`AutoContinueHost` 与 `aside.i5-native-notice` **z-index 完全相同**（2147483200）、都 portal 到 `body`、右下角几何必然重叠 ⇒ 后插入者压住卡片一角。
- 修法（零新增定义、零非白名单令牌）：形态改用经典档自有的 `--i5-blue` × `--i5-surface`（浅档 `#2563EB`/`#FFFFFF` = **5.17:1**；深档 `#9ABEFF`/`#1D293D` = **7.78:1**，两档均过 AA）；几何把 `welcomeBack` 改**上锚**（`top:20px; bottom:auto`）与常驻卡分属上下两条水平带，并给它更高 z-index 作双保险。
- 验收：`smoke-test-lb1-welcomeback-render.mjs` 真渲染 9/0（含 5.17:1 实算；几何相关断言已改为中性断言，见 §四之一）。


## 四之一、浮层避让规矩（★L-B2，2026-10-08 用户裁定）

**规矩**：右下角两张 native 浮层卡 —— 「接续卡」（`[data-native-continuation]`）与「欢迎回来卡」
（`[data-native-dialog=welcomeBack]` / `aside.i5-native-notice`）—— **同时存在时必须自动避让，绝不能叠**；
且**接续卡在上、欢迎回来卡在下**（用户原话：「接续最好在『欢迎回来』上面，或者就在它的平行上方」）。
两者**不同时存在**时，各自位置与原先完全一致（各回 `bottom:16px`）。

### 判据（几何不相交是**上界证明**，不是估计）

给欢迎卡一个 `max-height` 上界 `MAX = calc(224px * var(--dam-scale,1))`，避让位取 `MAX + 28px`：

```
欢迎卡 top 边距视口底 = 16 + h，且 h ≤ MAX          ⇒ top ∈ [16, 16+MAX]
接续卡 bottom 边距视口底 = MAX + 28                  ⇒ 恒在欢迎卡上方 ≥12px
⇒ 对**任意**内容高 h 都不相交（与视口高度 / 文案长度 / 语言无关）
```

实测（scale=1）：`MAX=224`、接续卡 `bottom=252`、间隙 **12px**；对 `h ∈ {0,60,112,224,448,1120}` 六档全部成立
（超过上界时被 `max-height` 夹住 ⇒ 上界性质仍成立，代价只是卡片内出现滚动条）。

### 两条规则（`skins/iter5/legacy-native-overlays.css` 文末）

```css
body:has([data-native-dialog-overlay=welcomeBack]) [data-native-continuation]{bottom:calc(28px + 224px * var(--dam-scale,1));}
body:has([data-native-continuation]) aside.i5-native-notice[data-native-dialog=welcomeBack]{max-height:calc(224px * var(--dam-scale,1));overflow:auto;}
```

### ★条件必须挂在 `body` 上，不能挂 `[data-dam-theme]`（结构性理由）

两张卡**不在同一个 `[data-dam-theme]` 根里**：它们各由一个 slot 挂一个 `Iter5Surface` ——
`lib/client.js` 的 `auto-memory-pre-dialogs`(kind=`dialogs`) 与 `auto-memory-pre-autocont`(kind=`autocont`) 是两次独立注册，
`skins/iter5/surfaces.js:45` 每个 Surface 自渲一个 `[data-dam-theme]`（值＝kind），`:49-50` 又把这两种 kind 分别 `createPortal` 到 `document.body`。
⇒ 两者是 `body` 下的**兄弟**，没有任何 `[data-dam-theme]` 元素同时包含它们，
故 `[data-dam-theme]:has([data-native-continuation]) [data-native-dialog=welcomeBack]` **恒不命中**。

### `:has()` 可用性（实证，非猜测）

本档**自己的产线表**已在用 `:has()`：冻结经典表 **3 处**、变体表 **9 处**（如 `[data-iter5] .i5-engine-choice:has(:checked)`）；
同表另有 `color-mix()` 32 处、`100dvh` 4 处 ⇒ 渲染器版本足以解析。

### 守卫与负路径

- 守卫 `smoke-test-lb1-classic-fallback.mjs` **§E**：避让规则存在 + 方向正确（避让位 − 上界 − 16 ≥ 8px）；
- 几何套件 `smoke-test-lb2-overlay-avoidance.mjs`：真解析规则值 + 真算盒模型纵轴区间（14/0）；
- 负路径 `smoke-test-lb1-negative.mjs`：**M-D** 删避让规则 ⇒ 必红；**M-E** 避让位改回 16px（等于没抬）⇒ 必红；
  **M-F** 方向倒挂（欢迎卡在上）⇒ 必红；三者还原均复绿。

### 未采用 z-index 压人的理由

错开后不需要靠 z 序压人；抬高 z-index 只会在「避让失效」时把问题**藏起来**而不是解决。故 `2147483300` 已撤回，
守卫 `lb2` §4b/4c 断言它不再出现。

### 边界

若日后新增第三张右下角浮层，需把它纳入同一套「上界 + 错开」体系；本道不处理。

## 五、新增浮层样式时的检查清单

1. 文件里**没有**任何 `--x:` 定义（跑 §A）；
2. 每条 `var()` 都带兜底，且兜底链里**只有白名单令牌 + 字面量**（跑 §B）；
3. 主按钮遵守「蓝底实心 + 白字」形态（跑 §C）；
4. 改动只落在目标弹窗，不波及其余四个（跑 §D）；
5. 裸色值只允许出现在 `var()` 的**兜底位**（与 r15 / `tools/lib/appearance-scan.mjs` 同口径）。

## 六、免责与边界

- 本规矩只管**经典档浮层补丁文件**。冻结源 `skins/legacy/iter5-325.js.frozen` 的存量定义（59 处）是既有事实，**不在本规矩约束范围，也不得由本道改动**。
- `skins/iter5/native-secondary.css` 属**变体表**，不作用于经典档，不适用本规矩。