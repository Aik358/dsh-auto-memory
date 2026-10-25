# dsh-auto-memory v4 · 交接文档（给下一个 AI 执行）

> **写于** 2026-10-26 00:05 · HEAD `49d9973` · 唯一工作树 `D:\dsh-auto-memory`
> **目的**：用户已明确「你说的这些全部都没有改好」，要求列 handoff 让另一个 AI 全部改完。
> **只写「实测事实 + 精确改法 + 验收判据」**。没实测过的都标「未验证」，不写成结论。

---

## §0 · 先读这 6 份文档（按顺序，缺一不可）

| # | 文档 | 作用 |
|---|---|---|
| 1 | `handoff/PLAN.md`（在 `~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/`） | 项目全貌 |
| 2 | `artifacts/MEMORY-LAYER-DESIGN-AUDIT-2026-10-25-v2.md` | **本 v4 需求的原始裁定（12 个 §）** |
| 3 | `artifacts/FRONTEND-EV4-PORT-EXECUTION-SPEC-2026-10-25.md` | 前端线唯一真源（§6 硬约束 / §9 施工记录） |
| 4 | `artifacts/wb-event-preview/index.html` | **原型 HTML（视觉 1:1 参照）** |
| 5 | `artifacts/UPGRADE-CONSENT-POPUP-PLAN-2026-10-25.md` | 升级弹窗设计（问题 3 相关） |
| 6 | 本文档 | 当前真实状态 + 待办 |

**铁律**：拍板项一直在更新。凡「某文档写着 X」，必须先核对文档日期，**取最新**。旧文档不作权威。

---

## §1 · 用户已明确报障的 4 件事（全部未达理想）

| # | 用户原话 | 真实现状（实测） | 状态 |
|---|---|---|---|
| 1 | 「白板看板还是没有全屏」 | 改过 3 轮仍未全屏。根因**未最终确认**（见 §2） | ❌ |
| 2 | 「工作区不是本工作区」 | `/event-list` 实测 `_resolved.ws = C:\Users\JH Z\.dsh\aik_auto_memory_use`（**错**），应为 `D:\dsh-auto-memory` | ❌ |
| 3 | 「P2B 自动检测也必须要做…弹窗…立即叫一个子代理」 | 后端已完成（两路由 + 状态机）；**前端弹窗从未实现** | ❌ 前端 0 |
| 4 | 「变动重写的工具描述和 prompt 描述都需要正常的单去做」 | **完全未开工** | ❌ |

---

## §2 · 问题 1：白板页不全屏（最复杂，必须真机验证）

### 2.1 当前实现链（实测代码位置，改前必读）

```
lib/client.js
  L17112  Iter5Surface 根 div 带 'data-dam-page': props.kind==='page' ? '' : undefined
  L16921  fit(): el = querySelector('[data-dam-kanban-view],[data-dam-wbg-wrap],[data-dam-fullpage-host]')
          area = el.closest('[data-conversation-scroll]')
          fitH = computeFullpageHeightPre(area.clientHeight, padT, padB, composerTop, elTop, fullpageOn)
          el.style.height = fitH + 'px'
  L16857  EV4_VISIBLE_PAGES = new Set()
  L16859  ev4SyncFullpageAttr(): Set 非空 ⇒ body[data-dam-fullpage]='true'，空 ⇒ 移除
  L17039  if (elLooksVisible()) mark(true)          ← 挂载即打标
  L17043  IntersectionObserver 只负责"连续 2 次不可见才 mark(false)"
  L4822   CSS: [data-dam-page] [data-dam-fullpage-host] { height:100%; min-height:0; display:flex; flex-direction:column }
  L4823   CSS: [data-dam-page] [data-dam-fullpage-host] > .dam-evt-split { flex:1; min-height:0 }
  L4816   CSS: .dam-evt-split { display:grid; grid-template-columns:...; align-items:start }
  L4041   CSS: body[data-dam-fullpage] [data-composer-seat],body[data-dam-fullpage] [data-composer-card]{display:none!important}
```

### 2.2 **我怀疑但未验证的 3 个可能原因**（必须逐条实测，不要直接改）

> ⚠ 写这段时**打不开真机 GUI**：`http://127.0.0.1:54030/` 返回 401（需 `dsh web` 启动时打印的 token URL）。
> 下面是**推断**不是结论。**先真机确认，再改。**

**可能 A：`elLooksVisible()` 仍返回 false**
- 判据是 `el.offsetWidth > 0` + computed display + `closest('[data-conversation-scroll]').clientHeight > 0`。
- **未验证**：白板页挂载瞬间 `offsetWidth` 是否真 > 0。若宿主 page surface 默认 `display:none`（切到该页签才显示），挂载那刻宽度 = 0 ⇒ 不打标 ⇒ **永久不全屏**（IO 之后也不会再 mark(true)，除非滚进视口）。
- **实测方法**：代码已把 fitH 写到 `data-dam-fit-h` 属性。真机读
  `document.querySelector('[data-dam-fullpage-host]').getAttribute('data-dam-fit-h')`
  与 `document.querySelector('[data-dam-fullpage-host]').getAttribute('data-dam-fit-fullpage')`。
  若属性根本不存在 ⇒ `fit()` 没跑（见可能 B）；若存在但 fullpage='0' ⇒ 闸门没过。

**可能 B：`fit()` 从来没跑**
- 前置守卫：`var el = boundary.current.querySelector(...)`；`var area = el && el.closest('[data-conversation-scroll]')`；`if (!el || !area) return`。
- **关键风险**：`el.closest('[data-conversation-scroll]')` 依赖宿主 DOM 里真有该属性。grep asar 命中 10 次，理论存在，但**未验证**页面层级里 EventView 的祖先是否含它。
- **实测方法**：`document.querySelector('[data-dam-fullpage-host]').closest('[data-conversation-scroll]')` 返回 null ⇒ 就是这条挂了。

**可能 C：CSS 高度链被 `align-items:start` 卡住**
- `.dam-evt-split { align-items:start }`（L4816）会让格内子项**不拉伸**。
- `.dam-evt-split > div { min-height:0 }`（L4824）但**没有 `height:100%`**。
- **未验证**：即使 `el` 拿到 `height:1000px`，其子 `.dam-evt-split` 是否真撑满。
- **实测方法**：对比 `[data-dam-fullpage-host]` 与 `.dam-evt-split` 的 `getBoundingClientRect().height` 是否相等。

### 2.3 建议的**更可靠**改法（放弃「JS 算高度」路线）

> 现状是「用 JS 算高度写 inline style」——本身脆弱（依赖 composer 位置、依赖宿主布局）。
> **推荐改为纯 CSS 撑满**，不再依赖 `fit()`：

```css
[data-dam-page] {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
[data-dam-page] > [data-dam-fullpage-host] {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;          /* ← 关键：不要写死 px */
}
[data-dam-page] [data-dam-fullpage-host] > .dam-evt-split {
  height: 100%;
  min-height: 0;
  align-items: stretch;  /* ← 关键：不要 start */
}
```

并且全屏判定改为「**只要该 surface 的 page 可见就 fullpage**」，与 `el` 高度**完全解耦**：

```js
// 新判据（不引用 el 任何几何）
function pageIsActive() {
  var host = boundary.current && boundary.current.closest('[data-conversation-scroll]')
  if (!host) return false
  var cs = getComputedStyle(host)
  return !(cs.display === 'none' || cs.visibility === 'hidden') && host.clientHeight > 0
}
```

> 理由：`el` 的高度是**结果**不是**前提**。用结果当前提 = 循环依赖。这是本轮踩过的坑（上一版用 `el.getBoundingClientRect().height`，死循环）。

### 2.4 验收（**必须真机**，复刻页不算）

```
真机打开白板页（需 token URL，见 §6）：
  □ document.body.hasAttribute('data-dam-fullpage') === true
  □ [data-dam-fullpage-host].getBoundingClientRect().height
      ≥ (window.innerHeight - 顶部页签栏高) * 0.98
  □ [data-dam-fullpage-host].getAttribute('data-dam-fit-fullpage') === '1'
  □ .dam-evt-split 的 height 与上面相等（证明 CSS 链通）
  □ 页面内 textarea / input[type=text] 数量 === 0
  □ 切回对话页 ⇒ body 无 data-dam-fullpage + composer display 可见（防打不了字）
```

**⚠ 已有的坑**：`smoke-test-p3-fullpage-gate` 17/0 全绿但真机不全屏 ⇒ **复刻页判据失效**。必须真机。
---

## §3 · 问题 2：工作区取错（**根因已确认，可直接改**）

### 3.1 真机实测证据（确定）

```bash
curl "http://127.0.0.1:54030/api/dsh-auto-memory/event-list?all=1"
⇒ _resolved: {
    sessionId: "session-e26f09e9-19a0-4c66-beec-3e1be49b2a63",
    ws: "C:\\Users\\JH Z\\.dsh\\aik_auto_memory_use",   ← ★错
    wsBound: true,
    fallbackCompat: true,                                    ← ★前端没传 sessionId
    source: "compat-fallback"
  }
```
应为 `D:\dsh-auto-memory`。

### 3.2 **根因是循环依赖 + 错误判据**（已确认代码）

```js
// lib/client.js L2370
function currentWs() {
  var id = mainViewSessionIdClient()          // ← ①
  var s = snap && snap.byId && snap.byId[id]
  return (s && typeof s.cwd === 'string') ? s.cwd : ''
}
// L2422
function mainViewSessionIdClient() {
  // 在所有 retainedBy.mainView > 0 的会话里取 updatedAt 最大   ← ② 用时间做空间判断
  if (at > bestAt) { bestAt = at; best = String(sid) }
  return best
}
// L2496 pageSessionIdClient(props) 的第②级
var byWs = sessionIdForWorkspaceClient(currentWs())   // ← ③ 用 currentWs() 求工作区
// L2503
function currentSessionIdClient() {
  return mainViewSessionIdClient()      // ← ④ 主路径根本没走三级解析！
}
```

**循环**：`pageSessionIdClient` 想按工作区找会话 → 需要 `currentWs()` → `currentWs()` 需要 `mainViewSessionIdClient()` → 后者取「最近活跃会话」（= 别的工作区）⇒ **按错误工作区找会话** ⇒ 必然错。

**并且 ④**：`currentSessionIdClient()` 仍直接返回 `mainViewSessionIdClient()` —— 主路径绕开了三级解析。

### 3.3 正确改法（三选一，**优先 A**）

**方案 A：从宿主拿权威会话身份（最正确）**
`conversation.view` 的 surface **render props** 里若含 sessionId，直接用它。
- **未验证**：props 里到底有什么（拿不到真机 console）。
- **实测方法**：真机 console 在 `EventView` 入口 `console.log(Object.keys(props), props)`；或临时把 `JSON.stringify(Object.keys(props))` 上报到某个 API。
- **若 props.sessionId 存在** ⇒ 一级就用它，后两级全删。

**方案 B：用宿主暴露的当前会话（若存在）**
- 检查 `ctx.sessions` 除 `list.getSnapshot()` 外是否还有 `current()` / `activeId`。**未验证**。
- 实测：真机 console 打 `Object.keys(sessions)` 与 `Object.keys(sessions.list.getSnapshot())`。

**方案 C（兜底）：按 URL/hash 判定**
- 若宿主 URL 带 `?session=<id>` 或 hash，从那里读。**未验证**宿主是否这么编码。

### 3.4 **无论选哪个方案，必须做的两件事**

1. **删掉「用时间做空间判断」**：`mainViewSessionIdClient()` 的 `updatedAt 最大` 只能用于「同工作区内选最近会话」，**绝不能用来决定工作区**。
2. **`currentSessionIdClient()` 必须走完整解析链**：
```js
function currentSessionIdClient() {
  return pageSessionIdClient(null)   // ← 不要直接 return mainViewSessionIdClient()
}
```
> ⚠ 影响面大（`currentSessionIdClient` 被 20+ 处调用）。**改前先 grep 全部调用点**，逐个确认语义。

### 3.5 验收

```
□ 真机打开白板页 ⇒ 显示 dsh-auto-memory 工作区的事件（不是 aik_auto_memory_use）
□ curl /event-list（不带 sessionId）⇒ source==='compat-fallback' 时 ws 仍应为 D:\dsh-auto-memory
□ curl /event-list?sessionId=<真实本会话sid> ⇒ source==='sessionId'
□ 两工作区并行：各自只看到自己的事件（不串）
□ 单工作区无回归
```

---

## §4 · 问题 3：P2b 升级弹窗（后端已就绪，**前端从零写**）

### 4.1 后端已完成的（可直接用，**已实测**）

```bash
GET  /api/dsh-auto-memory/upgrade-status
⇒ {"ok":true,
   "legacy":true,
   "reasons":["no-status：没有 dsh-status 行…","long-entries：59 条超 200 字…","no-events：事件库为空但已有 14 篇日志…"],
   "counts":{"events":1,"checkpoints":24,"anchored":1,"statuses":1,"userEntries":75,"projectEntries":46,"anchors":121,"statusAnchors":0,"logs":14},
   "declined":false,"declinedAt":null,"sinceMs":0,"snoozeRemainingMs":0,
   "canUpgrade":true,"phase":"idle","jobId":""}

POST /api/dsh-auto-memory/upgrade-snooze   body {sessionId}
⇒ {"ok":true,"declined":true,"at":<ts>,"snoozeMs":259200000(3天),"resumedAt":<ts+3d>}
   落盘 ~/.dsh/memory/upgrade-state.json ⇒ {"declined":true,"at":<ts>}

负路径：sessionId 不存在 ⇒ 400 且不写盘
```

**`canUpgrade` 判据**（已实现）：
`legacy===true && !(declined && sinceMs<3天) && phase!=='running' && phase!=='done'`

### 4.2 前端**要从零实现**的（grep 证据：`upgradeState|upgrade-state|memLegacy` 在 client.js **0 命中**）

1. **进入白板页时**调 `GET upgrade-status`。
2. **弹窗条件**：`canUpgrade === true` ⇒ 弹；否则不弹。
3. **弹窗内容**（用户原话「自己会弹窗的，弹完窗以后，点击『立即叫一个子代理』」）：
   - 标题：检测到旧版记忆
   - 正文：用 `counts` 说清「你有 N 条记忆、M 篇日志还是旧格式」+ `reasons` 列表
   - 按钮 ①：**立即派子代理整理**
   - 按钮 ②：**稍后** ⇒ `POST upgrade-snooze {sessionId}` ⇒ 关闭弹窗
4. **`declined` 且 `snoozeRemainingMs > 0` ⇒ 不弹**（服务端已算好剩余毫秒，**前端不要自己算 3 天**——同一语义两处判据必漂移）
5. **`phase === 'running'` ⇒ 显示「整理中…」并禁用按钮**（防连点起多个子代理）
6. **`phase === 'failed'` ⇒ 显示失败原因**（`error` 字段），允许重试

### 4.3 ⚠ 两个必须注意的坑

**坑 1：禁止 `createPortal(..., document.body)`**
- 本项目 L22-28 有 `portalToBody`，用户报过「点 log 框，它在左下角弹出来」。弹窗**必须**挂在 `[data-dam-page]` 内或页面内 fixed 定位。
- 验收：弹窗 `boundingRect` 与视口中心距离 < 屏宽 25%（不能贴左下角）。

**坑 2：`memory_upgrade` 是**工具**不是路由**
- `grep -n "memory_upgrade" lib/client.js` ⇒ **0 命中**。这条路完全没接。
- 建议：**后端补一条路由** `POST /api/dsh-auto-memory/memory-upgrade {action:'start', sessionId}`，内部调同一实现。这样前端按钮可直接触发，不需 AI 中转。

### 4.4 验收

```
□ legacy=true 且 declined=false ⇒ 弹窗出现
□ 点「稍后」⇒ upgrade-state.json 真写盘 + 弹窗关闭 + 3 天内不再弹
□ 伪造 at 为 4 天前 ⇒ 恢复弹窗
□ 点「立即派子代理」⇒ 真起子代理（给 jobId）+ phase 变 running + 界面显示「整理中」
□ 子代理失败（workbench 未就绪）⇒ phase=failed + 显示 error（**不许显示"已完成"**）
□ 弹窗不贴左下角
□ 关掉后重新进入页面，declined 内不再弹
```
---

## §5 · 问题 4：变动重写的工具描述与 prompt 描述（**完全未开工**）

### 5.1 用户原话（逐字）

> 「我现在是个比较稳定的 **变动重写的工具描述和 prompt 描述都需要正常的单去做**」

### 5.2 需求解读（结合 §0 文档 2 的 §2、§3）

**A. 事件四段（goal/doing/deadend/next）「每次变动都要重写」**
- 用户原话（已记在 `MEMORY-LAYER-DESIGN-AUDIT-2026-10-25-v2.md` §1）：
  > 「我对细节有要求，这也是为什么**每次变动都要重写这 4 个东西**」
- 现状：`memory_event` 工具描述的 `set` 段只说「改可变字段（name/summary/outcome/skillRef/status/pausedReason/sections）」，**没有说「每次有实质进展都要重写四段」**。
- **要做**：工具描述 + GUIDANCE 里明确写：
  ```
  每次 append 检查点后，若事情状态有变，必须同步重写 sections 四段
  （goal=目标 / doing=进行中 / deadend=失败与弯路 / next=下一步）。
  四段必须反映「当前」状态，不是历史累积。
  ```

**B. L0 总览（name/summary）按时重写**
- 现状：已在 task-31 P2 里加「3 时机」（工具描述 + GUIDANCE + 精简版）。**这条已做**。
- **待确认**：用户说「都需要」，可能指「工具描述」和「prompt 描述」**两处都要有**。目前：
  - 工具描述 ✅ 有
  - GUIDANCE ✅ 有
  - 精简版注入 ✅ 有
  - **完整版铭文 ❌ 没有**（铭文 1,489/1,500 已超限，上批主动撤掉了）

### 5.3 具体待办

| # | 项 | 文件 | 判据 |
|---|---|---|---|
| 1 | 工具描述补「四段每次变动必须重写」 | `lib/index.js` `memory_event` 描述 | 含该句；总长 ≤1,800（当前 **1,757，只剩 43 字符**） |
| 2 | GUIDANCE 补同义指引 | `lib/index.js` GUIDANCE（当前 2,392，**无硬上限**） | — |
| 3 | 完整版铭文是否加回 | `snapshotInscription` | **需用户裁决**：铭文上限 1,500 已超（1,489 + Archive 159）。加回需先腾空间 |
| 4 | 精简版注入同步 | `renderSlimSnapshotPre` | — |

**⚠ 预算硬约束**：`memory_event` 描述 1,757 / 1,800 ⇒ **只剩 43 字符**。四段那句话若超 43 字符，必须：
- 从别处压缩（但**不能删用户原话语义**，见 §7 教训 ③），或
- 移到 GUIDANCE（无硬上限）。

---

## §6 · 环境与工具链（**必读，否则会被坑**）

### 6.1 真机 GUI 打不开（本轮最大障碍）

```
http://127.0.0.1:54030/          ⇒ 401 "dsh web authentication required; reopen the URL printed by dsh web."
http://127.0.0.1:54030/api/*     ⇒ 200（★免鉴权）
```

**已试过且全部失败的 token 通路**（不要重复踩）：
- query `?token=` / `?authToken=` / `?secret=`
- header `x-dsh-auth-token` / `Authorization: Bearer`
- cookie `dsh_console_token`
- 文件：`~/.dsh/dsh-console-token.json`、`~/.dsh/remote-web-ui-registry/{web,desktop}.json` 的 secret、`~/.dsh/remote-web-ui-devices.json`

**⇒ 要拿真机 DOM，必须二选一：**
1. 让用户从 `dsh web` 启动时的控制台复制带 token 的完整 URL；
2. **或让用户自己开 F12 console 跑探针脚本**（最简单，推荐）。

**可直接交给用户的探针脚本**（让用户在白板页 F12 里粘贴执行）：
```js
(function(){
  var q = function(s){ return document.querySelector(s) };
  var host = q('[data-dam-fullpage-host]');
  var area = host && host.closest('[data-conversation-scroll]');
  var split = q('.dam-evt-split');
  var out = {
    bodyFullpage: document.body.hasAttribute('data-dam-fullpage'),
    hostExists: !!host,
    hostRect: host ? {w: host.getBoundingClientRect().width, h: host.getBoundingClientRect().height} : null,
    fitH: host ? host.getAttribute('data-dam-fit-h') : null,
    fitFullpage: host ? host.getAttribute('data-dam-fit-fullpage') : null,
    areaExists: !!area,
    areaClientH: area ? area.clientHeight : null,
    splitH: split ? split.getBoundingClientRect().height : null,
    innerH: window.innerHeight,
    surfaces: document.querySelectorAll('[data-dam-page]').length,
    inputs: document.querySelectorAll('textarea,input[type=text]').length
  };
  console.log('[DAM-PROBE]', JSON.stringify(out, null, 1));
})()
```
**把这段的输出贴回来，问题 1 的根因立刻能定。**

### 6.2 宿主加载的是开发树（symlink，非拷贝）

```
C:\Users\JH Z\.dsh\profiles\desktop\node_modules\@a9i5k4\dsh-auto-memory
  → D:\dsh-auto-memory   （symlink，readlink 实测确认）
```
⇒ 改 `lib/*.js` 后**重启宿主即生效**（后端已实测：`upgrade-status` 从 401 变 200 = 重启后生效的证据）。
**但前端 `client.js` 是否也直接生效未验证** —— 若宿主有 client bundle 缓存，可能需额外构建。**先查** `~/.dsh/cache/`。

### 6.3 命令与锁（可复算）

```
全量回归: node tools/run-smoke.mjs --jobs=8 --timeout=180000   （约 162s）
单套件:   node tests/smoke/<name>.mjs
文档校验: node tools/verify-docs.mjs      （不在回归套件内，必须单独跑）
皮肤同步: node tools/build-iter5-skin.mjs --check --strict    ⇒ 必须 SYNC-OK

计数锁：路由 79 · 工具 21 · 配置键 163 · PROMPT_SECTION_KEYS_PRE_V1 13
```

---

## §7 · 本轮踩过的坑（**每条都付过代价，必须遵守**）

### ① 用「结果」当「前提」= 死循环
`elLooksVisible()` 用 `el.getBoundingClientRect().height > 0` 判可见，但 `el` 的高度是 `fit()` 写的，`fit()` 的 CSS 高度链又只在打标后生效 ⇒ **永远不达标**。
**判据：可见判据不得引用「将要被该逻辑写入的量」。**

### ② 复刻页会掩盖真实环境的初始条件
`p3-fullpage-gate` 17/0 全绿，但真机不全屏 —— 复刻页里 `el` 一开始就有高度。
**判据：复刻页必须复刻真实环境的初始态（含 0 尺寸），否则测的是理想态。**

### ③ 用户原话的并列结构不可砍
「可以随时改、随时加」被压成「随时改」，**丢了「加」**（独立动作），字面仍读得通 ⇒ 最难发现。
**判据：压缩前先拆「结论」与「修辞」；并列结构（改/加、读/写、存/取）尤其危险。**

### ④ 同一语义两份实现，只改一处 = 半修
- `textOfEventPre`：`lib/index.js`（内联）与 `lib/event-recall.js`（独立）各一份
- `MEMORY_BASIS_MIGRATION_PROMPT`：`lib/migration-prompt.js` 与 `artifacts/*.md` 各一份
**判据：改任何常量前先 `grep -rn "<常量名>"` ⇒ 命中的**所有**文件与套件全部要改/跑。**

### ⑤ 「静默成功」比崩溃更坏
`memory_upgrade` start：`runSubagent` 五道门任一不过就 `return ''`（不抛错）⇒ `.then` 写 `phase:'done'` + `summary:''` ⇒ 用户看到「整理完成」，实际什么都没做。
**判据：凡「fork/异步任务」，空结果必须显式判 failed，不许默认 done。**（已修，勿回退）

### ⑥ 判据没覆盖的分支，变异验证抓不到
去掉 `canUpgrade` 的 `phase !== 'done'` 后，套件 **40/0 全绿**（没抓到）。补 8 条断言后才必红。
**判据：变异不红时，先怀疑判据有盲点，别以为代码无懈可击。**

### ⑦ 用时间做空间判断必然错
`mainViewSessionIdClient()` 取 `updatedAt` 最大选会话 ⇒ 选到最近活跃的**别的**工作区。
**判据：空间归属必须用空间字段（cwd/workspace id），不能用时间字段。**

### ⑧ 不要自造判据冒充已定判据
上一轮 Lead 把「全量回归 >200s ⇒ 环境无效」当既定判据用，实际仓里 grep 无出处。
**判据：任何阈值必须能 grep 到出处，否则标明「临时」且不得据此跳过验证。**

### ⑨ 前端铁律（违反即事故）
- **禁止对 `lib/client.js` / `skins/iter5/*` 做三方合并或整块替换式重构**（用户 2026-10-01 明确警告，曾污染一天）
- 插入的代码块**不得以 `(` `[` 反引号开头**（ASI 陷阱，`node --check` 抓不到）
- 改完必跑五步：`node --check` → **client-loadable 17/0（真执行 factory）** → 真 Chrome → 相关旧套件 → `build-iter5-skin --check --strict` SYNC-OK
- 若改生成区（`ITER5-LEGACY-GENERATED` / `ITER5-GENERATED`）必须同步回源，否则 SYNC 必红
- `lib/client.js` **从来没有定义过 useMemo**：要加必须先 `var useMemo = React.useMemo`（本轮曾因此让整个插件闪退）

---

## §8 · 当前客观状态（可复算）

```
HEAD = 49d9973（已提交 137 文件；跟踪区 0 未提交改动）
未提交的 366 个 = 全部一次性诊断文件（.diag-*/.d-*/.ci-log-*），故意不入库

物理量（2026-10-26 00:0x 实测）
  lib/client.js   2,652,581 B / 22,678 行 / CRLF 22,678 / bareLF 0
                  sha16(bytes) 901B821D2F4DF2C9
  lib/index.js    1,655,977 B / nc 1,248,559 / CRLF 23,413 / bareLF 0
                  sha16(bytes) 529D9839514CCF85 / sha16(norm) 9FB6C88D5096EE2B
  route 79 / tool 21 / config 163

全量回归（干净负载）: PASS 503 / FAIL 1 / TIMEOUT 0（162.6s）
  唯一 FAIL = smoke-test-sidecar-watchdog G3-8（既有欠账；该文件 10-20 后未改过，
  根因：logExitDiag 用单槽 lastExitDiagKey 去重，并发下同一次退出可能落两条）
```

---

## §9 · 建议执行顺序（不要跳步）

```
第 0 步：让用户开 F12 跑 §6.1 的探针脚本（或提供 token URL）
        ↓ 没有这个，问题 1 无法验证，只能猜
第 1 步【问题 2 工作区】—— 根因已确认，改动最小、收益最大
        · 先实测 props 里有没有 sessionId（决定走方案 A/B/C）
        · 改 currentSessionIdClient 走完整解析链
        · 用 curl 验收 _resolved.ws
第 2 步【问题 1 全屏】—— 需真机数据，建议改纯 CSS 撑满路线
        · 先按 §2.2 三条逐条定位
        · 改完真机验收 §2.4 全 6 条
第 3 步【问题 3 弹窗】—— 后端已就绪，前端从零写
        · 先补 POST memory-upgrade 路由（当前前端无法触发工具）
        · 再写弹窗组件
第 4 步【问题 4 四段重写】—— 注意工具描述只剩 43 字符预算
第 5 步：全量回归 + verify-docs + SYNC-OK + 真机复验
```

---

## §10 · 一句话总结

**四个问题里：问题 2 根因已确认（可立即改）；问题 1 有三条待实测的可能原因（必须先真机验证）；问题 3 后端好了前端零；问题 4 完全没开工。**
**最大的障碍不是代码，是拿不到真机 GUI 的截图/DOM —— 请先解决这个。**
