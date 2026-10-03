# HANDOFF：双皮肤块收尾（CSS 分派 bug）+ 设置页实时同步 —— 2026-09-30

> 交接对象：DeepSeek Harness 内的 DSH 助手。本文件自包含，按顺序执行即可。
> 工作区：`D:\dsh-auto-memory`（开发树，宿主经符号链接直读 ⇒ 改 lib/*.js 需重启 dsh web 生效；client.js 刷新页面即生效）。
> 当前 HEAD：`8cfe677`（双皮肤块 + 守卫适配，全量回归 237/237，真阳性已验）。

---

## 〇、背景（30 秒版）

用户裁定（2026-09-30）：**默认皮肤 = 3.2.5 的「新款」**（下称 legacy 块），PR #150 的三套变体
（仪器/编辑/活水）经**顶部下拉**选择；三套新皮肤里的「返回」回**旧款**（不是回经典），
旧款里的「返回经典皮肤」保持原样——两者语义不同，不得合并。

已实现（commit `1d451e5` + `c4b1239` + `8cfe677`）：
- `tools/build-iter5-skin.mjs`：从**冻结文件** `skins/legacy/iter5-325.js.frozen`（= ecd3a44/v3.2.5
  的生成块原文，旧款皮肤的单一真源）读 legacy 块，整体包 IIFE（内部保留原 `Iter5*` 名字 ⇒
  与三套变体块零冲突），只导出 `Legacy5Page` 与 `LEGACY_ITER5_CSS`；
- 挂载点双分派：`damSkinLegacy() ? Legacy5Page : Iter5Page`；
- 旋钮：`dam-skin-style` ∈ {legacy(默认), instrument, editorial, water}，
  `damSkinStyleGet/Set/damSkinLegacy` 定义在 client.js（`damSkinSet` 之前）；
- `skins/iter5/style-choice.js`：四款注册（`ITER5_ALL_SKINS`，legacy 置首）+ 默认 legacy +
  切换时互相同步（`iter5SetStyle` 里调 `damSkinStyleSet`）；
- `skins/iter5/ui.js`：三套变体的 `exitClassic` 改为 `iter5SetStyle('legacy')`；
- 守卫适配 9 个套件（各带归因注释）；全量回归 237/237。

---

## 一、P0 bug：CSS 按皮肤分派缺失（我验证时抓到，尚未修完）

### 症状
`lib/client.js` 的 `damSkinEnsureCss()`（约 12160 行附近）现状：

```js
function damSkinEnsureCss() {
  try {
    var el = document.getElementById('dam-skin-v4-style')
    if (el) return                                  // ← bug B：切皮肤后样式永不刷新
    el = document.createElement('style')
    el.id = 'dam-skin-v4-style'
    el.setAttribute('data-dam-skin-css', 'v4')
    el.textContent = '/* dam-skin:begin (v4) */\n' + DAM_SKIN_V4_CSS + '\n' + ITER5_CSS + '\n/* dam-skin:end (v4) */'
    // ↑ bug A：永远注入**新款**样式表；legacy 块渲染时没有自己的 CSS
  } catch (eSkin) {}
}
```

### 后果
默认皮肤（legacy 块）渲染时套的是**新款样式表** ⇒ 旧款观感错误；
且 `if (el) return` 使切皮肤后样式永不更新。

### 修法（已在隔离克隆验证过前半，按此重做即可）
1. 新增 `damSkinCssText()`（放在 `damSkinEnsureCss` 之前）：
```js
function damSkinCssText() {
  if (damSkinActive() === 'iter5') return '/* dam-skin:begin (iter5) */\n' + LEGACY_ITER5_CSS + '\n/* dam-skin:end (iter5) */'
  return '/* dam-skin:begin (v4) */\n' + DAM_SKIN_V4_CSS + '\n' + ITER5_CSS + '\n/* dam-skin:end (v4) */'
}
```
   注意：legacy 块激活时 `damSkinActive()` 需返回 `'iter5'`——见下「状态模型」。
2. `damSkinEnsureCss()` 改为：
```js
function damSkinEnsureCss() {
  try {
    var cur = damSkinActive()
    var want = damSkinCssText()
    var el = document.getElementById('dam-skin-v4-style')
    if (el && el.getAttribute('data-dam-skin-css') === cur) return
    if (el && el.parentNode) el.parentNode.removeChild(el)
    if (!want) return
    el = document.createElement('style')
    el.id = 'dam-skin-v4-style'
    el.setAttribute('data-dam-skin-css', cur)
    el.textContent = want
    document.head.appendChild(el)
  } catch (eSkin) {}
}
```
3. **状态模型补齐**：`damSkinActive()` 现在只认 `'classic'|'v4'`（默认 `'v4'`）。需改为三值：
   - `dam-skin` = 'classic' → 'classic'
   - `dam-skin` = 'v4'（显式）→ 'v4'（三套变体，样式取 `dam-skin-style`）
   - **未选过 / 其它 → 'iter5'（默认旧款）**
   即：`function damSkinActive() { try { var raw = localStorage.getItem(DAM_SKIN_KEY); if (raw === 'classic') return 'classic'; if (raw === 'v4') return 'v4'; return 'iter5' } catch (e) { return 'classic' } }`
   （现有调用点 `damSkinActive() === 'v4'` 的分支语义不变——只有显式选过 v4 才进三套变体。）
4. `damSkinRemoveCss()` 里的 `document.documentElement.removeAttribute('data-i5-deep')` 保留；
   切到 legacy 时新块的 `data-i5-deep`/`data-i5-style` 属性随 DOM 一起消失，无需额外处理。

### 验收
- 默认（清 localStorage）→ 旧款观感 = 3.2.5 的「新款」（侧栏版）；
- 下拉切 仪器/编辑/活水 → 三套变体观感正确、切换即时生效（不刷新页面）；
- 三套里点「返回」→ 回旧款；旧款里点「返回经典皮肤」→ 回经典；
- 守卫：`node tools/run-smoke.mjs` 237/237（r21/r23/r26/r28/style-variants/iter5-skin 全绿）。

---

## 二、第四项工程：设置页一一对应 + 实时同步（调查已完成，待修）

调查结论（Explore 深查，证据齐全）：

1. **好消息**：插件设置页与宿主「自动记忆」设置页是**同一套组件挂两个入口**
   （`Iter5Settings`，client.js:11486；宿主入口 `Iter5HostSettings` @10766 → 直接渲染同一组件）。
   配置键**完全一致（81 键，双向差集为空）**。不存在「两套 UI 需对齐」的问题。
2. **实时同步不成立**（要修的核心）：
   - 两个入口各持独立配置快照，只在**挂载时**读一次（I5 @11690 `useEffect(...,[])`）；
   - 保存后**不广播**：`saveConfigPatch`（client.js:3162，唯一写出口）不 emit；
     `controller.emit()` 只由本地 UI 动作触发（主题/密度/拖拽/开合）；
   - 宿主设置面板与工作台设置页**可同时存在**（生成器特意做了实例隔离），
     此时 A 保存后 B 的开关仍是旧值，直到 remount 或手动刷新。
   - **修法建议**：`saveConfigPatch` 成功后调用 `controller.emit()`（既有订阅机制，
     `useTick` 的组件会重渲染）——注意 I5 的 `useEffect` 依赖是 `[]`，需改为订阅
     controller 或把重取逻辑挂到 tick；同时 I5 保存前补「重取远端 + 冲突检测」
     （经典模板 `SettingsPage.save` @14410 已有先例：先 GET 再 diff 再提交，I5 丢了这层）。
3. **5 个 team 键写入被静默丢弃**（真 bug）：`teamServerUrl` / `teamId` / `teamMemberName` /
   `teamConflictPolicy` / `teamAuditEnabled` 出现在 `TEAM_SETTING_KEYS`（client.js:8973）且
   `renderTeamSettings` 有守恒断言，但**不在 `DEFAULT_CONFIG`**（index.js:455-918）⇒
   宿主白名单 `const allowed = Object.keys(DEFAULT_CONFIG)`（index.js:15801）把它们**静默丢弃**；
   而宿主确实读 `teamConflictPolicy`（index.js:14780、14884）与 `teamServerUrl`（team-auth.js:107）。
   **修法**：把这 5 键补进 `DEFAULT_CONFIG`（带合理默认值），并在守卫里锁「TEAM_SETTING_KEYS ⊆ DEFAULT_CONFIG」。
4. **提示词层镜像漂移**：`DEFAULT_PROMPT_LAYERS_CLIENT`（client.js:2242-2265）12 层 vs
   服务端 `DEFAULT_PROMPT_LAYERS`（index.js:924-1022）23 层；共享键中 `snapshotHead` 与
   `snapshotWelcomeBody` 是**截断版**（46/49 字符 vs 302/149）。client.js:2255 注释自己写着
   「必须逐字一致」。**修法**：以服务端为准补齐 23 层 + 逐字一致；守卫从「只锁 1 键」
   （smoke-test-g4-whiteboard.mjs:108 的 G4-6b）扩为「逐键比对 + 键集相等」。
5. **折叠要求（用户口头裁定）**：新设置页的分区折叠**可以**，但展开后**所有设置项都必须可见**。
   现状：81 键全在（已核实），折叠只是收纳 ⇒ 已满足；补一条守卫锁住
   「展开态字段数 ≥ 81 且 ⊇ 经典档键集」，防止将来折叠时丢项。

---

## 三、执行顺序与纪律

1. 先修「一」（P0，~30 行），跑全量回归 237/237，**commit**；
2. 再修「二」的 3（5 键白名单，小）、2（实时同步，中）、4（镜像，中）、5（守卫，小），
   **每项单独 commit**（用户要求「这样好恢复」）；
3. 全程纪律：
   - client.js/index.js **纯 CRLF**（S2 §7.3 守卫会抓裸 LF）；生成器输出的块内容用 LF 拼装、
     最后统一转 CRLF（`legacyWrapped` 内部用 `'\n'` 拼装是刻意设计，别改成 newline 变量——会产出 `\r\r\n`）；
   - 生成器必须幂等：`node tools/build-iter5-skin.mjs && node tools/build-iter5-skin.mjs --check` 都要过；
   - **生成块不能手改**（`--check` 判 stale 覆盖）：改 `skins/iter5/*` 源或 client.js 的源组件（StatsTab 等），
     再跑生成器；
   - 隔离克隆里验证（`D:\dsh_debug\skin-refactor` 有一份，可复用或重建），落开发树用
     `git merge --ff-only`；**别用 `git checkout HEAD -- .` 做诊断**（会连未跟踪/已修改一起冲掉，
     本轮已实测丢过一次工作，靠重放脚本恢复）；
   - 写脚本批改文件时：本机 Git Bash 的 heredoc **连 quoted 形式都会吃一层反斜杠**（`\\n`→`\n`），
     Python 里写含 `\n`/正则的补丁必须事后 Read 校验，或用 `chr(92)`/`String.fromCharCode` 构造；
   - commit 信息中文、说清「为什么」；push 需用户确认。

---

## 四、其它在途事项（非本 handoff 范围，备忘）

- GitHub：PR #150/#155 已 merged（贡献者 Minervaowl7 已记）；issue #151/#152/#153/#154 已修复
  （#152-154 已回帖，**未关闭**——等发版后关闭）；issue #156（Windows sharp/libvips DLL 同名冲突）
  **待处理**（建议先做其方案 D：插件 activate 时自检 + 明确告警）。
- 发版：等用户在 DSH 里审阅完四款皮肤后走 release 流程（三件套 + release.mjs 标准序）。
- DEV 分支未 push（本地领先 main 多个提交，push 需用户确认）。
