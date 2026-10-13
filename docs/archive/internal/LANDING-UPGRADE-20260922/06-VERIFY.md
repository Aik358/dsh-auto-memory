# 06 · VERIFY — 渲染取证验收

- **Status**: TODO
- **Commit**: `4af2421`
- **Severity**: —
- **Category**: 验收
- **依赖**: `01`–`05` 全部完成

---

## 0. 为什么必须做渲染取证（不是可选项）

本页是**单文件、内联 CSS + 内联 JS、零外部依赖**。这意味着：

- 静态 grep 只能证明「字符串写进去了」，**不能证明 CSS 生效**。
- 本仓库已有两次实证教训（2026-09-22，`docs/CONTRIBUTORS.html`）：`node --check` 与全部静态守卫**全绿**，而浏览器里数字只显示首位、渐变裁到空——因为 `background-clip:text` 只作用于元素**自身**的文字，而 `color:transparent` 会**继承**给后代；以及 `.stat b{display:block}` 的特异性 (0,2,1) 压过了 `.t-reel{display:inline-flex}` (0,1,0)。

⇒ **CSS 改动的验收判据是 `getComputedStyle` 的实测值 + 截图**，不是文本匹配。`improve-animations` 也明文要求计划必须带 feel-check。

---

## 1. 准备

### 1a. 确认 Chrome 路径

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
Test-Path $chrome
```

若不存在，用 `glob` 搜 `chrome.exe`，或退回 Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（命令行参数兼容）。

### 1b. 落盘探针脚本

把下面整段写入 **`.vision-tmp/landing-probe.cjs`**（该目录已在同步区外，可随时重建）：

```js
/* 落地页渲染取证：复制页面 → 注入探针 → headless dump-dom 读计算样式 → 截图 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SRC = path.resolve('docs/landing/index.html');
const OUT = path.resolve('.vision-tmp/landing-shots');
fs.mkdirSync(OUT, { recursive: true });

/* ① 复制到临时目录（保持相对路径 ../screenshots/promo/ 可用） */
const stage = path.join(os.tmpdir(), 'landing-probe-' + Date.now());
fs.mkdirSync(path.join(stage, 'docs', 'landing'), { recursive: true });
let html = fs.readFileSync(SRC, 'utf8');

/* ② 注入探针：等 load + 一帧，再把要测的量写进 <pre id="__probe"> */
const probe = `
<pre id="__probe" style="display:none"></pre>
<script>
(function(){
  function run(){
    var cs = getComputedStyle(document.documentElement);
    var pick = function(n){ return cs.getPropertyValue(n).trim(); };
    var imgs = [].slice.call(document.querySelectorAll('.promo-track img'));
    var dots = document.querySelectorAll('.promo-dots a');
    var stats = [].slice.call(document.querySelectorAll('.stat-cell .v'));
    var btns = [].slice.call(document.querySelectorAll('.copy-btn, #install-btn'));
    var md = document.getElementById('m-detail');
    var lang = document.querySelector('.lang');
    var out = {
      /* 01 FOUNDATION */
      cssVarsOk: ['--duration-stagger','--duration-quick','--duration-fast','--duration-medium','--duration-slow','--duration-very-slow','--ease-smooth-out','--distance-micro','--distance-base','--distance-medium','--scale-press','--blur-small']
        .every(function(k){ return pick(k) !== ''; }),
      tokenQuick: pick('--duration-quick'),
      tokenEase: pick('--ease-smooth-out'),
      tokenPress: pick('--scale-press'),
      tapHighlight: getComputedStyle(document.documentElement).webkitTapHighlightColor,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      /* 02 SCROLL */
      revealTotal: document.querySelectorAll('.js-reveal').length,
      rLgCount: document.querySelectorAll('.js-reveal.r-lg').length,
      rSmCount: document.querySelectorAll('.js-reveal.r-sm').length,
      jsRevealRule: (function(){
        for (var i=0;i<document.styleSheets.length;i++){
          var rs = document.styleSheets[i].cssRules || [];
          for (var j=0;j<rs.length;j++){
            if (rs[j].selectorText === '.js-reveal.in') return rs[j].style.transition;
          }
        }
        return null;
      })(),
      /* 03 COMPONENTS */
      mdTransition: md ? getComputedStyle(md).transitionProperty + ' ' + getComputedStyle(md).transitionDuration : null,
      langHasActive: !!(lang && lang.getAttribute('data-active')),
      langIndicator: lang ? getComputedStyle(lang, '::before').transform : null,
      flashGuard: String(flashCopied).indexOf('data-flashing') !== -1,
      /* 04 MOBILE */
      bodyOverscroll: getComputedStyle(document.body).overscrollBehaviorY,
      promoTouchAction: getComputedStyle(document.querySelector('.promo-track')).touchAction,
      btnUserSelect: btns.length ? getComputedStyle(btns[0]).userSelect : null,
      bodyUserSelect: getComputedStyle(document.body).userSelect,
      topbarPadTop: getComputedStyle(document.querySelector('.topbar')).paddingTop,
      wrapPadLeft: getComputedStyle(document.querySelector('.wrap')).paddingLeft,
      /* 05 CONTENT */
      brandTag: (document.querySelector('.brand-tag') || {}).textContent,
      promoFrames: imgs.length,
      promoDots: dots.length,
      promoObjectFit: imgs.length ? getComputedStyle(imgs[0]).objectFit : null,
      allPromosLoaded: imgs.every(function(i){ return i.complete && i.naturalWidth > 0; }),
      promoNatural: imgs.map(function(i){ return i.naturalWidth + 'x' + i.naturalHeight; }),
      v0130Count: (document.documentElement.outerHTML.match(/v0\\.1\\.30/g) || []).length,
      /* 既有资产未回归 */
      keyframesStillThere: ['blink','fill','cell-hit'].map(function(n){
        return [].some.call(document.styleSheets, function(ss){
          return [].some.call(ss.cssRules || [], function(r){ return r.type === 7 && r.name === n; });
        });
      }),
      hoverCount: (document.documentElement.outerHTML.match(/:hover/g) || []).length,
      statValues: stats.map(function(s){ return s.textContent.trim(); })
    };
    document.getElementById('__probe').textContent = 'PROBE_JSON=' + JSON.stringify(out);
  }
  if (document.readyState === 'complete') setTimeout(run, 300);
  else window.addEventListener('load', function(){ setTimeout(run, 300); });
})();
</script>
`;
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(stage, 'docs', 'landing', 'index.html'), html);

const url = 'file:///' + path.join(stage, 'docs', 'landing', 'index.html').replace(/\\/g, '/');

/* ③ dump-dom 取探针 JSON */
const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=3000',
  '--dump-dom', url
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const m = dom.match(/PROBE_JSON=(\{[\s\S]*?\})<\/pre>/);
if (!m){ console.error('✗ 探针未产出，页面可能 JS 报错'); process.exit(1); }
const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
console.log(JSON.stringify(data, null, 2));

/* ④ 截图（桌面 + 手机） */
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,2400',
  '--virtual-time-budget=4000', '--screenshot=' + path.join(OUT, 'desktop.png'), url
], { stdio: 'inherit' });
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=390,844',
  '--virtual-time-budget=4000', '--screenshot=' + path.join(OUT, 'mobile.png'), url
], { stdio: 'inherit' });
console.log('screenshots → ' + OUT);
```

### 1c. 运行

```powershell
node .vision-tmp/landing-probe.cjs
```

---

## 2. 判据表（全部必须满足）

### 01 FOUNDATION

| 键 | 期望 | 失败含义 |
|---|---|---|
| `cssVarsOk` | `true` | 有 token 没写进 `:root` |
| `tokenQuick` | `150ms` | token 值被改错 |
| `tokenEase` | `cubic-bezier(0.22, 1, 0.36, 1)` | 缓动被替换成弱曲线 |
| `tokenPress` | `0.97` | 按压比例被改 |
| `tapHighlight` | `rgba(0, 0, 0, 0)` 或 `transparent` | 点击高亮未抑制 |

### 02 SCROLL

| 键 | 期望 |
|---|---|
| `revealTotal` | `32`（±0；若为 0 说明 `IntersectionObserver` 分支未跑） |
| `rLgCount` | `2`（hero-copy + schematic） |
| `rSmCount` | `≥5`（4 个 stat-cell + links-row） |
| `jsRevealRule` | 含 `500ms`（或 token 展开值），**不含 `0.55s`** |

### 03 COMPONENTS

| 键 | 期望 |
|---|---|
| `mdTransition` | 含 `opacity` / `transform` / `filter`，时长为 `0.4s` |
| `langHasActive` | `true` |
| `flashGuard` | `true`（`data-flashing` 守卫在位） |

### 04 MOBILE

| 键 | 期望 |
|---|---|
| `bodyOverscroll` | `none` |
| `promoTouchAction` | `pan-y` |
| `btnUserSelect` | `none` |
| `bodyUserSelect` | **不是** `none`（正文必须可选） |
| `topbarPadTop` | `0px`（桌面无安全区）或含 inset 计算值 |
| `wrapPadLeft` | `24px`（`max(24px, 0px)`） |

### 05 CONTENT

| 键 | 期望 |
|---|---|
| `brandTag` | `v3.1.4` |
| `promoFrames` | `7` |
| `promoDots` | `7` |
| `promoObjectFit` | `contain` |
| `allPromosLoaded` | `true`（**含新增的 `1b`**；`false` 说明路径错） |
| `promoNatural` | 7 项，其中 2 项为 `1536x1024` |
| `v0130Count` | **恰好 `3`**（三处历史陈述；为 0 = 误改了历史事实） |

### 既有资产未回归

| 键 | 期望 |
|---|---|
| `keyframesStillThere` | `[true, true, true]`（`blink`/`fill`/`cell-hit` 一个都不能少） |
| `hoverCount` | `≥15`（不得因加门控而删除 hover 规则） |
| `statValues` | `["0次","3级","R@5 0.925","100%"]`（**数值未被动画改动**） |

---

## 3. 截图复核（人工，不可省）

打开 `.vision-tmp/landing-shots/desktop.png` 与 `mobile.png`，逐条核对：

- [ ] 首屏 Hero 完整：大标题两行不断错、`.soul` 左侧橙线在位、CTA 按钮成对
- [ ] 统计带四格可见，数字**是完整的**（不是只显示首位——这是本仓库踩过的坑）
- [ ] 「01 管线」的 `.pipe-flow` 三栏与深色 `.arch` 区块正常
- [ ] 轮播显示**第 1 帧**（`promo-1-hero`），圆点共 7 个、第 1 个为橙色
- [ ] 「十二个能力」12 个 feature 全在
- [ ] 「七张实机截图」7 个 `.g-card` 全在
- [ ] 手机版（390px）：无横向溢出（底部不应出现横向滚动条）

---

## 4. 交互复核（DevTools，人工）

1. **按压反馈在 pointer-down**：按住任一按钮，**松手前**就已缩到 97%。
2. **hover 门控**：Device Toolbar 切 iPhone，点一次 `.link-chip` → 背景不残留深色。
3. **面板进出不对称**：点开里程碑 → 面板淡入上移；点关闭 → **更快**淡出。快速连点 5 次不闪不卡。
4. **文案切换**：点复制按钮 → 文字上出下进；连点 5 次 → 不出现 `copiedcopied`。
5. **语言指示器**：切 EN → 深色块**滑**到右格；切回 → 滑回。
6. **入场分级**：滚到统计带 → 四格**依次**浮起；滚过 12 个 feature → 各自独立触发，不整屏齐动。
7. **reduced-motion**：Rendering 面板勾 `prefers-reduced-motion: reduce` →
   - 元素**不消失**（`01` 的 T2 把 duration 归零）
   - 按压缩放**消失**，hover 换色**仍在**
   - 面板开合变瞬时
8. **第 7 个圆点**：点击 → 滚到 `promo-6-greeting`，圆点高亮同步。
9. **慢放**：Animations 面板播放速度 10%，确认入场是「快起慢收」而非「慢起」（慢起 = 误用了 `ease-in`）。

---

## 5. 真机交底（**必须转达用户，不得声称已验证**）

以下 5 项**在 Chrome 设备模拟里完全不成立**（`mobile-native` 核心判据：「Emulation cannot reproduce sticky hover, tap delay, rubber-banding, safe areas, or the keyboard」）。执行者**只能**保证代码层面正确，**必须**把这份清单交给用户在手机上确认：

1. 点按后 hover 是否还粘住
2. 点击高亮是否真的消失
3. 点按是否真的变快（300ms 延迟）
4. 下拉橡皮筋是否被抑制
5. 刘海/Home 指示条区域内容是否被裁

**真机验证方法**（`mobile-native` §11）：手机 USB 连接 → 本地起静态服务（`npx serve docs` 或 `python -m http.server`，**不要动 3080**）→ 手机访问局域网 IP → iOS 用 Safari 的 Develop 菜单 / Android 用 `chrome://inspect`。**建议用一台几年前的手机测，不要用最新旗舰。**

---

## 6. 交付清单

完成后向用户报告：

1. 探针 JSON 全量输出（机械判据）
2. `desktop.png` / `mobile.png` 两张截图
3. 交互复核 9 条的逐条结论
4. **真机待确认 5 条**（明确标注「未验证」）
5. 改动摘要：动了哪个文件、哪些行、共几处
6. **回滚方式**：`git checkout -- docs/landing/index.html`（因只改单文件）

> **不要**在真机确认前宣称「移动端已修好」。**不要**用模拟器截图冒充真机验证。
