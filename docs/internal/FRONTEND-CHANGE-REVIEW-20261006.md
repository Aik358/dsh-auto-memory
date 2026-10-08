# 前端线改动审核清单（人工审核用 · 未动代码）

> 生成于 2026-10-06 ｜ 基线 HEAD = \`a04d416\`（工作树干净，未 push）
> **本文件只描述「将要改什么」，不含任何已落地的改动。** 请逐项审核后给出「做/不做/改法」的裁定。

---

## 结论速览：前端要动的其实只有 4 类、合计 ~15 行 + 1 次提交

| # | 项目 | 改动规模 | 风险 | 需你裁定？ |
|---|---|---|---|---|
| **Y** | 批次 Y 正式提交 | **0 行代码**（只改提交信息） | 极低 | 否（已获你同意） |
| **238** | 梦幻皮肤下浮窗消失 | **+4 行**（1 处文件） | 低（纯 CSS/ARIA 属性） | 否 |
| **226** | 异常监听卸载不注销 | **~10 行**（1 处文件） | **中（行为契约变更）** | **是** |
| **223** | graph 档侧栏按钮 | 方案 A 5 行 / 方案 B 中等 | 低 | **是（产品决策）** |

> 其余「前端相关」的 PR#215/#237 前端部分与 PR#221 生成器部分**本清单不含**——它们属独立的大工程，与上面三项不同批。**本次只做 Y / 238 / 226，223 等你裁定。**

---

## 一、批次 Y 正式提交（0 行代码）

**现状（实测）**：
- \`node tools/build-iter5-skin.mjs --check\` ⇒ \`SYNC-OK: sources × generator == lib/client.js\`（生成器源与产物逐字节一致）
- \`node tests/smoke/smoke-test-batch-y-frontend.mjs\` ⇒ **73 assertions PASS**
- F2 已裁决：断言为 \`=== 6\`，注释写明理由（三面 × window/handoff 两分区，legacy 面此前缺 handoff 分区，重生成补上）；\`lib/client.js\` 实测命中数也是 **6**
- 当前提交信息：\`d734f01 checkpoint(batch-Y): 批次 Y 前端检查点入库（施工前 provenance 隔离，未转正）\`

**将要做的事**：把工作树中批次 Y 的内容（\`lib/client.js\` / \`skins/legacy/iter5-325.js.frozen\` / \`lib/index.js\` / 3 支测试）**以一个正式批次 Y 提交落库**，提交信息从 \`checkpoint(…未转正)\` 改写为正式描述。

**需要你知道的判断**：批次 Y 的内容**已在 d734f01 里**，不是「再改一遍」。此步是**重写提交信息 + 确认范围**，不改代码语义。
**待你确认**：是**重写** d734f01（\`git rebase\`/amend，会改写历史）还是**追加一个正式提交**说明「Y 转正」？—— 我倾向**追加**（不改写已有历史，风险更低）。

---

## 二、#238 浮窗消失 —— +4 行，单文件

### 现场证据（\`lib/client.js\`）
\`\`\`js
// :16074  浮窗样式对象
var floatStyle = {
  left: g.left + 'px',
  top: g.top + 'px',
  width: g.width + 'px',
  height: g.height + 'px',
  '--dam-scale': FONT_SCALE_VALUES[fontScale] || '1',
  '--dam-accent': ACCENT_VALUES[accentTheme] || ACCENT_VALUES.deepseek,
}
// :16082  浮窗节点
nodes.push(h('div', {
  key: 'float',
  'data-dam-region': 'float', 'data-dam-panel': '',
  'data-pos': 'float', 'data-compact': String(compact[0]),
  ...
  style: floatStyle,
\`\`\`

**缺陷机理**：梦幻皮肤把 \`[data-dam-panel]\` 当成 composer 候选，后注入 \`position:relative\`（普通特异性，无 \`!important\`），把浮窗从 \`fixed\` 挤进文档流 ⇒ 浮窗移出视口。现位 \`floatStyle\` **没有** inline \`position\`，所以挡不住。

### 将要改的 4 行（逐字）
\`\`\`diff
 var floatStyle = {
+  // #238: late host/skin composer rules must not move this overlay into document flow.
+  position: 'fixed',
   left: g.left + 'px',
   ...
 nodes.push(h('div', {
   key: 'float',
   'data-dam-region': 'float', 'data-dam-panel': '',
+  // A named non-modal dialog also keeps its editors out of chat-composer discovery.
+  role: 'dialog', 'aria-label': t('autoMemory'),
\`\`\`
（原文取自 PR#239 的 \`lib/client.js\` diff，\`git diff e260677..pr-239 -- lib/client.js\`）

### 为什么这样改是对的（要点审核）
1. **inline 样式**同优先级下压过外部样式表的普通规则 ⇒ 皮肤那条 \`position:relative\` 失效。与既有 \`left/top/width/height\` 全用 inline 的写法**一致**。
2. \`role:'dialog'\` 命中梦幻皮肤 composer 候选的**排除条件** ⇒ 从源头不再被误标记（治本，不只看样式）。
3. 与拖拽用的 inline \`left/top\` 天然兼容；不改任何布局数值。
4. **不需要重跑生成器**（这段在手写区，不在生成区间）。

### 风险与副作用
- 低。唯一需注意：页面里另有两处 \`closest('[role=dialog]')\`（\`:11025\`、\`:13528\`）属工作台 slot，**不受影响**（它们是向上查找祖先，本处是新增节点属性）。
- 验收：真机（DSH web + dream 皮肤）开浮窗 → 切「笔记」→ 断言 \`getBoundingClientRect\` 仍在视口内；探针须从 FAIL 转 PASS。

**待你确认**：这 4 行照做？（我建议照做，与上游 PR#239 完全一致，且已通过其真机回归）

---

## 三、#226 异常监听 —— ~10 行，**需你拍板（行为契约变更）**

### 现场证据（\`lib/index.js\`）
\`\`\`js
// :13644
try {
  if (!process.__damFatalDiagGuard) {
    process.__damFatalDiagGuard = true
    damSwallowStreamErrors(process.stderr)
    damSwallowStreamErrors(process.stdout)
    process.on('uncaughtException', (err) => { damSafeDiag(...) })   // ← :13649
    process.on('exit', (code) => { damSafeDiag(...) })               // ← :13650
  }
} catch (e) {}
// :13654 另一块：unhandledRejection 也有独立 guard 与处理器（:13664）
\`\`\`
**卸载路径**：\`ctx.effect(() => () => { ... })\` 在 **\`:17729\`**，其中 \`clearInterval\` 一堆定时器，但**没有任何 \`removeListener\`**；全文件 \`removeListener\` 命中 **0 处**。

**后果**：插件卸载/重载后监听仍在 ⇒ 无关的致命异常被吞、进程 exit 0 ⇒ 以退出码判定 PASS 的 34 支 smoke **假绿**（\`run-smoke.mjs:242/:285\`）。

### 将要改的两处
**改法 A（保守，推荐）** —— 只加注销，不动注册语义：
\`\`\`js
// ① 注册处：把两个处理器提成具名常量（否则无法注销）
const onFatal = (err) => damSafeDiag(process.stderr, '[dsh-auto-memory] uncaughtException: ' + damDiagLine(err))
const onExit  = (code) => damSafeDiag(process.stdout, '[dsh-auto-memory] process exit code=' + code)
process.on('uncaughtException', onFatal)
process.on('exit', onExit)
// （unhandledRejection 同法）

// ② :17729 的卸载块内追加：
try { process.removeListener('uncaughtException', onFatal) } catch (e2) {}
try { process.removeListener('exit', onExit) } catch (e2) {}
try { process.removeListener('unhandledRejection', onRej) } catch (e2) {}
try { process.__damFatalDiagGuard = false; process._dshAutoMemoryRejectionGuard = false } catch (e2) {}
\`\`\`
> ⚠️ **复位两个 process 级 guard 标志是必须的**（它们是 \`process.__damFatalDiagGuard\` / \`process._dshAutoMemoryRejectionGuard\`）——否则同一进程内重新 apply 时 \`if (!guard)\` 判假，**监听永不重装**。

**改法 B（更彻底，改动面更大）** —— 把 \`uncaughtException\` 换成 \`uncaughtExceptionMonitor\`：只观测不抑制，**保留 Node 默认致命退出语义**。

### 这是**行为契约变更**，请你在两者中选
| | 改法 A（加注销 + 复位 guard） | 改法 B（换 monitor） |
|---|---|---|
| 插件自身异常 | 仍被吞（与今天一致） | 恢复 Node 默认：**进程可能退出** |
| 卸载后监听残留 | 修好 | 修好 |
| smoke 假绿 | 修好 | 修好 |
| 风险 | **低**（不改现有运行时行为） | **中**（可能改变 dsh web 崩溃行为，需确认 2026-09-14 EPIPE 三层防护足够） |
| 发版说明 | 可轻提 | **必须显著说明** |

**我的建议**：**先做改法 A**（保守、可逆、不动运行时语义），把 B 留作后续独立评估——因为它牵涉「插件异常是否该连带杀死宿主」这一产品决策。

**待你确认**：A / B / 暂不做？

---

## 四、#223 侧栏「记忆(pre)」按钮 —— **需你产品裁定**

**现状**：\`lib/client.js:18448-18450\` 无条件注册侧栏按钮（\`id=auto-memory-pre\`，\`order 5\`）；而 \`boardMode\` 自 3.0.0 起**出厂默认就是 \`graph\`** ⇒ 几乎全部用户都在新版看板下，按钮隐藏后左下角浮层入口只剩它……

**两个方案**：
- **方案 A（最小，约 5 行）**：localStorage 本地开关 / 或直接绑 \`boardMode==='graph'\`。优点：改动极小、立即见效；缺点：不可发现（localStorage）、或对默认档用户砍掉唯一浮层入口。
- **方案 B（正式，中等成本）**：新增配置键（如 \`sidebarEntryEnabled\`，默认 true）+ 设置页开关。需动**三面**（client.js 经典 + 生成区变体 + \`frozen\`）+ 三语字典 + settings-parity 键扩位 + 哈希锁重钉。

**待你裁定**：① 做不做；② 若做，graph 默认档下按钮该**默认隐藏**还是**保持显示**？③ 走 A 还是 B？

---

## 五、明确**不在**本次范围的前端大工程（避免误解）

| 项目 | 为什么先不动 |
|---|---|
| **PR#215 前端**（client.js +7002/−5045、新增 settings-schema/settings-source） | 换掉整个设置页结构；且**含 #220 空串缺陷**；与批次 Y 正面冲突 ⇒ 属独立大工程，须单独排期 |
| **PR#237 前端**（移动端设置 UI + \`skins/compat/mobile.css\`） | 触碰三面 + frozen + 新增 CSS 目录；且其 \`.gitattributes\` 变更需你单独裁定 |
| **PR#221 生成器部分**（客户端字典由宿主真源生成） | 改生成器 ⇒ 触发 \`--check\` 判据与哈希锁；属 D-1 批次 |
| **#238 的 iter5-skin 哈希锁重钉** | 若只改手写区（本清单第二节）**无需重跑生成器**；哈希锁仅在改生成区时才动 |

---

## 六、我建议的执行顺序与你的确认点

1. **[需你确认]** 批次 Y：**追加**正式提交 vs 重写历史
2. **[需你确认]** #238 四行：照做？
3. **[需你确认]** #226：改法 A（保守）/ B（激进）/ 暂不做
4. **[需你裁定]** #223：做不做 + 默认档行为 + A/B
5. 以上确认后，我按序施工，每步**Lead 亲自跑闸门**（\`run-smoke\` + 相关单套件），并同步更新记忆与白板

> 全部改动合计（不含 #223 与 PR 大件）：**1 次提交 + 约 14 行代码**，涉及 2 个文件。
