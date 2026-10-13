# 05 · CONTENT — 内容真值（版本号 / 轮播幕数 / 资源引用）

- **Status**: TODO
- **Commit**: `4af2421`
- **Severity**: HIGH（观感影响最大、风险最低）
- **Category**: 正确性（非动效类目）
- **Estimated scope**: 1 file，HTML 约 +4 行 / 改 12 行，i18n 字典 4 处
- **依赖**: 无（可独立执行，且**建议最先做**——零风险、立刻见效）

---

## Problem

### P1 — 品牌徽章版本号停留在 `v0.1.30`，仓库已到 `3.1.4`

```html
<!-- L576 -->
<span class="brand-tag" data-i18n="brand.tag">v0.1.30</span>
```

i18n 字典里还有两份同值（`L1316` 的 `zh`、`L1451` 的 `en`）：

```js
"brand.tag":"v0.1.30",
```

取证：该页最后修改于 `a4c12b2`（2026-09-01），当时 `package.json.version` 确为 `0.1.30`（`git show a4c12b2:package.json` 复核）。**四笔发布之后（3.1.0 → 3.1.4）从未同步。** 当前 `package.json.version === "3.1.4"`。

### P2 — 轮播少两幕，首帧用的是被替换掉的老 banner

```html
<!-- L783–788 — 当前 6 帧 -->
<img id="promo-1" src="../screenshots/promo/promo-0-banner-v2.png" ... />
<img id="promo-2" src="../screenshots/promo/promo-2-tour.png" ... />
<img id="promo-3" src="../screenshots/promo/promo-3-recall.png" ... />
<img id="promo-4" src="../screenshots/promo/promo-4-unattended.png" ... />
<img id="promo-5" src="../screenshots/promo/promo-5-external.png" ... />
<img id="promo-6" src="../screenshots/promo/promo-6-greeting.png" ... />
```

三个问题：

1. **首帧是 `promo-0-banner-v2.png`** —— 仓库已有 `v3` / `v4`，README 用的是 **`v4`**（`README.md:13`、`L17`）。
2. **缺 `promo-1-hero.png`** —— 第一幕。
3. **缺 `promo-1b-auto-recall.png`** —— 第二幕（新增幕）。

**同时，标签文案与实际计数不符**：

```html
<!-- L791 -->
<span class="promo-cap" data-i18n="promo.cap">GALLERY · 六幕</span>
<!-- L793 — 6 个圆点 -->
<a href="#promo-1" aria-label="1"></a>…<a href="#promo-6" aria-label="6"></a>
```

### P3 — `object-fit:cover` + 混合宽高比 ⇒ 会裁掉画面

```css
/* L353–357 — 当前 */
.promo-track img{
  width:100%;height:auto;display:block;
  scroll-snap-align:start;scroll-snap-stop:always;
  aspect-ratio:16/9;object-fit:cover;background:var(--paper-2);
}
```

实测各图真实尺寸（PNG IHDR 读取）：

| 文件 | 尺寸 | 宽高比 |
|---|---|---|
| `promo-0-banner-v2.png` | 1280×721 | 1.775 ≈ 16:9 |
| `promo-0-banner-v3.png` | 1536×1024 | **1.500（3:2）** |
| `promo-0-banner-v4.png` | 1536×1024 | **1.500（3:2）** |
| `promo-1-hero.png` | 1280×720 | 1.778 = 16:9 |
| `promo-1b-auto-recall.png` | 1536×1024 | **1.500（3:2）** |
| `promo-2-tour.png` | 1059×591 | 1.792 ≈ 16:9 |
| `promo-3-recall.png` | 1280×720 | 16:9 |
| `promo-4-unattended.png` | 1280×720 | 16:9 |
| `promo-5-external.png` | 1280×720 | 16:9 |
| `promo-6-greeting.png` | 1280×720 | 16:9 |

⇒ **1536×1024 的两张（含要新增的 `1b`）在 `16:9` + `cover` 下会被上下各裁掉约 11%**。promo 图上通常有标题/角标贴近边缘，裁掉会切字。

**关键线索**：CSS 里**已经**写了 `background:var(--paper-2)`——纸色底只有在 `contain`（letterbox）下才有意义；`cover` 根本不会露出背景。这说明**原意可能就是 `contain`**，`cover` 是后来顺手写的。

---

## Target

### T1 — 版本号三处同步改为 `3.1.4`

| 位置 | 改前 | 改后 |
|---|---|---|
| `L576` HTML 静态值 | `<span class="brand-tag" data-i18n="brand.tag">v0.1.30</span>` | `<span class="brand-tag" data-i18n="brand.tag">v3.1.4</span>` |
| `L1316` zh 字典 | `"brand.tag":"v0.1.30",` | `"brand.tag":"v3.1.4",` |
| `L1451` en 字典 | `"brand.tag":"v0.1.30",` | `"brand.tag":"v3.1.4",` |

> **只改这三处。** 页面里另有 `v0.1.30` 的**历史陈述**（见 §Boundaries），改它们是篡改事实。

### T2 — 轮播补齐为 7 幕，顺序按文件编号

**2a.** 替换 `L783–788` 六个 `<img>` 为下面七个（**保留每行原有 alt 文案风格；`1-hero` 与 `1b` 的 alt 需新写**）：

```html
          <img id="promo-1" src="../screenshots/promo/promo-1-hero.png" alt="dsh-auto-memory 主视觉：不用吩咐，她自己记得" />
          <img id="promo-2" src="../screenshots/promo/promo-1b-auto-recall.png" alt="主动唤起：记忆不靠调用，自己被唤回" />
          <img id="promo-3" src="../screenshots/promo/promo-2-tour.png" alt="欢迎向导：每个功能、当场看懂、当场开关" />
          <img id="promo-4" src="../screenshots/promo/promo-3-recall.png" alt="唤起与固化：对话凝成技能，每一步有迹可循" />
          <img id="promo-5" src="../screenshots/promo/promo-4-unattended.png" alt="无人值守模式：整夜安静跑，零寒暄，零打扰" />
          <img id="promo-6" src="../screenshots/promo/promo-5-external.png" alt="外部记忆继承：你的其他 AI，也在喂她记忆" />
          <img id="promo-7" src="../screenshots/promo/promo-6-greeting.png" alt="定时暖心问候：让每一天都被记得" />
```

> ⚠️ **`id` 必须重排**：`.promo-dots a` 的 `href="#promo-N"` 与 `:target` 翻页（`L376`）都依赖 id。旧的 `promo-2…6` 现在要变成 `promo-3…7`。**若漏改 id 而只加标签，圆点会跳到错误的帧。**
>
> **`promo-0-banner-v4.png` 不进轮播。** 它是 README 顶部的 hero 主视觉（`README.md:13`），不是分幕；页面里原有的 `banner-v2` 是历史遗留的混用。轮播 = 「分幕 7 张」。

**2b.** 圆点从 6 个补到 7 个（改 `L793`）：

```html
            <a href="#promo-1" aria-label="1"></a><a href="#promo-2" aria-label="2"></a><a href="#promo-3" aria-label="3"></a><a href="#promo-4" aria-label="4"></a><a href="#promo-5" aria-label="5"></a><a href="#promo-6" aria-label="6"></a><a href="#promo-7" aria-label="7"></a>
```

**2c.** 标签文案改「六幕」→「七幕」（`L791` 静态值 + 两份字典）：

- `L791`：`GALLERY · 六幕` → `GALLERY · 七幕`
- zh 字典 `promo.cap`：同步改
- en 字典 `promo.cap`：把 `SIX`/`6` 一类的数字改成对应七幕表述（**按该键现有文案风格改，不要重写成别的句式**）

> **`go()` 的 JS 无需改**：`L1612–1636` 全部按 `track.querySelectorAll('img')` 与 `dots.length` 动态取长度。但 `go(0)`（`L1635`）与 `cur` 逻辑依赖 `frames.length`，第 7 帧会自动纳入。**验证时必须实测能点到第 7 个圆点。**

### T3 — `object-fit` 改 `contain`，消除裁图

替换 `L353–357`：

```css
  .promo-track img{
    width:100%;height:auto;display:block;
    scroll-snap-align:start;scroll-snap-stop:always;
    aspect-ratio:16/9;object-fit:contain;background:var(--paper-2);
  }
```

> **理由**：7 帧里有 2 帧是 3:2，5 帧是 16:9。`contain` 让两者都完整可见，用已有的纸色底（`--paper-2`）做 letterbox——**这正是那行 `background` 原本的用途**。视觉上比「切掉标题」好得多。
>
> **代价**：3:2 的两帧左右会出现纸色留白（约各 5.5%）。这在本页的现代主义版式里是可接受的（本就是纸色 + 细线框的语言），比裁字安全。

---

## Repo conventions to follow

- **双语字典结构**：`L1316` 起是 `zh` 字典、`L1451` 起是 `en` 字典，形如 `"key":"value",`。**新增/修改必须两个字典同时改**，否则切换语言会出现空值或残留中文。
- **`data-i18n` 机制**：`L1595–1601` 的 `applyLang()` 按 `data-i18n` 键名查字典；`HTML_OK[k]` 为真的键走 `innerHTML`，否则走 `textContent`。**改字典值时不要引入 HTML 标签**，除非该键已在 `HTML_OK` 里。
- **图片路径**：页面在 `docs/landing/`，图片在 `docs/screenshots/promo/`，故用相对路径 `../screenshots/promo/xxx.png`。**保持这个前缀，不要改成绝对路径**（否则 `htmlpreview.github.io` 的 raw 代理会失效）。
- alt 文案风格：中文短句 + 冒号 + 一句解释（见 `L783–788` 现有 6 条）。

---

## Steps

1. T1：改三处 `brand.tag`（`L576` / `L1316` / `L1451`）。
2. T2a：替换 `L783–788`，**同时重排 id**（新 7 行）。
3. T2b：改 `L793` 的圆点（6 → 7 个）。
4. T2c：改 `L791` 与两份字典的 `promo.cap`。
5. T3：改 `L355` 的 `object-fit:cover` → `contain`。
6. 跑 `06-VERIFY.md`：确认 `promoFrames === 7`、`dots === 7`、`brandTag === 'v3.1.4'`、7 张图的 `naturalWidth > 0`（全部加载成功）。
7. **逐个点击第 1…7 个圆点**，确认每一帧都能到位且圆点高亮同步。

---

## Boundaries

- ⛔ **不要改** `L923` / `L1375` / `L1510` 的「3.3 · 欢迎向导（v0.1.30 大更新）」——**这是历史事实**，不是陈旧数据（该向导确实于 v0.1.30 引入）。
- ⛔ **不要改** `L930` / `L1380` 的「v0.1.30 起所有用户升级后自动播放一次」——同上，README `L388` 原文同义。
- ⛔ **不要改**「十二个能力」（`L846` 附近）——实测 `.feature` 恰 **12** 个，**是正确的**。
- ⛔ **不要改**「七张实机截图」（`L1141` 附近）——实测 `.g-card` 恰 **7** 个，**是正确的**。
- ⛔ **不要动** `.promo-track` 的 `scroll-snap-type`（见 `03-COMPONENTS.md` P4 的裁定）。
- ⛔ **不要删** `promo-0-banner-v2/v3.png` 文件——本次只改引用，删文件属另一件事（且它们是历史版本，可能被别处引用）。
- 若行号与本文不符（说明已被 01–04 改动推移），**以内容锚点定位，不要按行号硬改**。

---

## Verification

- **Mechanical**：探针输出
  - `brandTag === 'v3.1.4'`（且 zh/en 两份字典同值）
  - `promoFrames === 7` 且 `promoDots === 7`
  - `allPromosLoaded === true`（7 个 `<img>` 的 `complete && naturalWidth > 0`）
  - `promoCap` 文案在 zh/en 下都含「七」/ seven 之意
  - `promoObjectFit === 'contain'`
- **Mechanical（防回归）**：`v0.1.30` 在全页仍出现 **3 次**（三处历史陈述），**不得为 0**。
- **Feel check**：
  - 点第 7 个圆点 → 滚到最后一帧（`promo-6-greeting`），圆点高亮在第 7 个。
  - 手动横向滑动到最右 → 圆点同步到第 7 个（`L1628` 的 scroll 监听）。
  - 切到 EN 再回来 → 标签文案与 alt 都正确，无中文残留。
  - 在 390px 宽下看轮播 → 7 帧都能滑到，且 `contain` 后没有裁掉画面标题。
- **Done when**：7 幕齐备、圆点与 id 对齐、版本号三处一致、两张 3:2 图不被裁。
