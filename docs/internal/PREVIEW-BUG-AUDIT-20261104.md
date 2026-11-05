# preview bug report 全量复核 · 2026-11-04

> 基线：`preview` 分支，HEAD `b989a5f9`（v3.4.0-alpha.5）。工作树含 P9 未提交改动（`lib/index.js` 等），
> 行号凡涉及 `lib/index.js` 者给「工作树 / HEAD」两套口径。

> 取证方式：**全部真执行**。6 组核查员共写出 **122 个探针文件**，每条结论都有可复跑的脚本与日志；
> 退出码一律 `node x > log 2>&1; echo EXIT=$?` 直取（未经管道）。**没有任何 lib/ tools/ tests/ skins/ 文件被修改。**

---

## 一、结论速览

| # | 标题（截断） | 判定 | 级别 | 性质 | 组 |
|---|---|---|---|---|---|
| #531 | 匿名握手可替攻击者签署回调内容 | 仍存在 | P0 | 安全·真缺陷（端到端复现） | B |
| #538 | report/diag 鉴权接受 URL 任意位置令牌子串 | 仍存在 | P2 | 安全·真缺陷（需拍板兼容） | B |
| #534 | 团队接口 32 MiB 上限检查太晚 | 仍存在 | P1 | 真缺陷（64MiB 全读入） | E |
| #529 | 事件下行把永久失败包装成临时错误 | 仍存在 | P1 | 真缺陷（游标永久卡死） | C |
| #523 | 在跑任务参数名不一致，正常整理被判孤儿 | 仍存在 | P1 | 真缺陷（键名不一致） | D |
| #533 | 全屏页单次隐藏通知不清标记 | 仍存在 | P1 | 真缺陷（等不保证发生的第二次） | D |
| #532 | 身份轮询把字符串当函数调用 | 仍存在 | P1 | 真缺陷（TypeError 被吞） | D |
| #536 | curate-apply 测试收尾抛异常却退出 0 | 仍存在 | P1 | 测试基建·真缺陷 | Lead |
| #535 | 合法旧版事件能读却不能追加 | 机制存在/触发不成立 | **P3** | 真缺陷但无发布面（降级） | C |
| #544 | 白板「全部事件」入口在不可达分支 | 仍存在 | P2 | 真缺陷（套件是字符串守卫） | D |
| #542 | patch-h1-v1-retire 字符串缺引号 | 仍存在 | P2 | 工具·建议退役 | A |
| #541 | PNG 差异工具读取错误字段 | 仍存在 | P2 | 工具·另有两处错答 | A |
| #540 | 子代理回收命令导入旧 -pre 模块名 | 仍存在 | P2 | 工具·同族还有 1 处 | A |
| #539 | replayFromFile 调用未定义的 replay | 仍存在 | P2 | 真缺陷（一行接线错误） | A |
| #537 | QQ 反馈写入成功后被误判失败 | 仍存在 | P2 | 真缺陷（2 次 PATCH） | C |
| #530 | 语料健康把「日志未创建」判成 stale | 仍存在 | P2 | 真缺陷 ×2（判定错+回执假阳性） | D |
| #528 | 团队事件字段未完整透传 | 仍存在 | P2 | 真缺陷（三处白名单漂移） | C |
| #527 | memory_event rename 未入出站队列 | 仍存在 | P2 | 真缺陷（漏一次入队） | C |
| #526 | 事件 append 重放感知数组重复追加 | 仍存在 | P2 | 真缺陷（上层被告知已去重） | C |
| #525 | 整理上传意图无持久化，不能续传 | 仍存在 | P2 | 功能缺口/取舍偏缺陷 | D |
| #524 | 轮询收到终态未更新弹窗 | 团队模式仍存在 | P2 | 真缺陷；**个人模式那半报告有误** | D |
| #520 | 一键派子代理整理固定挂工作台 | 3 条根因仍存在 | P1 | 真缺陷（详见下） | 专属 |

### 不参与修复的两条

| # | 说明 |
|---|---|
| **#521** | **长期追踪 issue，不是待修缺陷**。正文自己写明「等 v4 主线动工时一并做」，且已列出 #469/#467 已完成的两半与 #465/#466/#468 的余下项。本轮不复核、不动。 |
| **#520** | 独立大项，三条根因分别取证，见下文 §三 |

---

## 二、关键结论：23 条里 **22 条仍然存在**

**没有一条是「已被某个提交修过」**。唯一需要下调级别的是 **#535**（见下）。

### #535 的特殊判定（唯一降级项）

机制真实且完全可复现：v1 事件（严格 16 顶层字段）读得动，但 `append/set/rename/close` **四条全部**抛「事件写入前校验失败」；补上 10 个 v2 字段后即可追加。

**但报告的触发前提不成立**：

```
git cat-file -e v3.4.0-alpha.1:lib/event-store.js  → 存在，且已是 26 字段
git cat-file -e v3.3.13:lib/event-store.js        → 不存在
git cat-file -e v3.3.17:lib/event-store.js        → 不存在
```
⇒ **没有任何已发布版本写过 v1 事件库**。真实用户从 alpha.N 升级不会遇到；只有 dev 树 10-24~10-27 期间的库、手工/恢复的库受影响。

⇒ 建议 **P1 → P3**，按「数据修复向」处理，而不是当作升级必踩。

---

## 三、分组详情


### A 组 · tools / CLI（#542 / #541 / #540 / #539）—— 4/4 仍存在


**#542** `tools/patch-h1-v1-retire.mjs`
- 报告说「第 15 行缺引号」，实测是 **`:15–:22` 共 8 行**行首都缺 `"`（行尾 `",` 都在）。只补 1 行仍 `EXIT=1`。
- **更重要**：该工具已退役。目标 `python/worker_semantic_v1.py` 已是退休后状态，补丁锚点命中 0；自带幂等守卫 `!py0.includes(M)` 为 false。
- **且补完引号也不该跑**：`:62` 的 `writeFileSync` 在 `:63-64` 的 fail 判定**之前** ⇒ 全红状态仍会改写 84,744 B 的语义引擎 python。
- 建议：`git rm`（`git grep` 在 tracked 文件 0 命中，无引用成本）。要保留则两件事同批：补 8 个行首引号 + 把写盘移到 fail 判定之后。

**#541** `tools/png-diff.mjs`
- 报告成立，但**根因只到表层**。`decodePNG` 返回 `{W,H,ch,colorType,bitDepth,data}`，而 diff 解构 `{width:w, height:h, px}` ⇒ 三个全 undefined。
- 只改字段名**不够**，另有两条错答：
  - 尺寸不等时报**无任何诊断、静默 exit 0**；
  - 灰度 vs RGB（视觉相同）报 **14 像素 / 87.50% 假阳性**（比较循环写死 3 通道差、按各自 ch 步进 ⇒ 索引错位）。
- 修法三处同批：`:9` 改解构；`:36` 加 `ch` 与尺寸前置判定 → 明确诊断 `exit 2`；`:41-43` 差值按实际 ch 分支。
- 影响面：`docs`/`tests` 对 png-diff **0 命中**，`tools/` 不进 npm 包 ⇒ 线上零影响。唯一约束：**别改 `png-analyze` 的返回字段**（会波及 4 个消费者）。

**#540** `tools/subagent-gc.mjs`
- `EXIT=1 ERR_MODULE_NOT_FOUND 'lib/subagent-gc-pre.js'`。`lib/subagent-gc.js` 的三个导出全在，**只差路径**。
- **报告漏了同族第二处**：全仓扫 tools+lib 249 文件 → 3 处不可解析，除本 CLI 还有 `tools/migrate-m3b4.mjs` 的两个 `-pre` 导入。
- **更关键的是守卫缺口**：`tools/guard-tracked-imports.mjs` 只扫 `lib`（`:23/26/30`），**完全不覆盖 tools/** ⇒ 所以这类问题一直没被发现。
- 修法：改 3 处 import + **把守卫扫描面扩到 `[lib, tools]`**（扩完应直接顶出这 3 处）。
- ⚠️ **需你拍板的口径冲突**：`docs/USER-GUIDE`（zh:342 / en:341）称 GC「已判废停用、默认关」，但 `lib/index.js:1015` 默认 `subagentGcEnabled: true`、`:17187` 每日巡检仍在跑。**两条口径不该长期并存** —— 以文档为准就该删 CLI，以代码为准才该修 import。

**#539** `lib/shadow-host.js`
- `node --check` 查不出（运行时 ReferenceError）。真构造 + 真调用：`replayFromFile` → `ReferenceError: replay is not defined`。
- 根因：导入时重命名为 `replayCore`（`:19`），函数体 `:399` 仍写旧名 ⇒ **重命名只改了一半**。
- 修法：`:399` → `return replayCore(fixture)`；同时在 `smoke-test-m4.mjs` F12 后补正/负路径（现 `grep replayFromFile` = **0 次**，完全没有覆盖）。
- 影响面：`lib/index.js` 对 `replayFromFile` **0 命中**，纯诊断入口，线上零影响。

### B 组 · 安全（#531 / #538）—— 2/2 仍存在


**#531 匿名握手替攻击者签名（P0）** —— **完整攻击链在真实 HTTP handler 上端到端复现**：
```
步骤2  无签名业务回调              → 401（正常）
步骤3  匿名 op=13，plain_token=业务事件原串 → 200 + 可与回调互用的签名
步骤4  重放该签名到业务回调        → 200
       假 gist 出现 {"u":"attacker","m":"…（伪造）"}
       LLM trap 命中 1 次  ← verified 被伪造后匿名流量走到烧 key 的路
```
另证：握手对被签字节**零校验** —— 20 万字符任意串也返回可用签名。
- 位置：`index.js:413-419`（签名 `:416`）、`:803-805`（op=13 跳过验签）、`:810`（回调验签，同构）、`:122`。
- 根因：握手与回调共用同一个「对 `ts||body` 做 Ed25519」的签名函数，而握手把**请求者完全可控**的 `plain_token` 原样当被签字节串。
- **修法必须四处同批**：`:414-416` 加挑战校验（string/长度/纯数字 ts/`plain_token` 不得含 JSON 结构字符 `[{}[\]"]`，失败回 400）＋ `:803-806` 把免验签收窄到**最小握手信封** ＋ 补 113-116 套件攻击链 ＋ 重打包 `index.zip`。
- ⚠️ **不能**改成「握手也验签」—— op=13 是平台强制要求的免验签入口。
- **覆盖假象（实测）**：`smoke-test-issue113-116` **66 PASS/0**、`issue324` **80 PASS/0** 全绿，但 op=13 只测了良性挑战 `pt-123`，**不含握手签名重放**。`index.zip` 与源逐字节一致 ⇒ 线上包同样带这个洞。

**#538 routeAuth URL 子串放行（P2）** —— 直接调用真实 `routeAuth()` 返回 `{"ok":true,"legacy":true}`；`ROUTE_TOKEN=report` 时 `GET /?report=1` **无凭据 200 并读出群聊原文**；令牌 `diag` 时 `/?diag=1` 同样 200。
- 位置：`:622-630`，违规行 **`:627-628`**。高熵令牌负对照实测 403 ⇒ 缺口依赖「令牌值与 URL 偶然重合」。
- ⚠️ **需你拍板**：`:627-628` 是**为已写入文档的 `/<ROUTE_TOKEN>/` 部署形态**保留的兼容分支（`GROUP-WEBHOOK-SETUP.md:46,65` 就是这么教用户部署的）。两个选项：
  - **A（按 issue 验收）**：删分支 → 代码与文档必须**同批**改，否则按文档部署的既有用户直接 403；
  - **B（保兼容）**：改成路径段精确匹配 → 但这不满足 issue 验收第 2 条。

> 两条修复落在同一文件相邻两段（`:416/:803` 与 `:628`），建议**同批落盘 + 一次重打包 index.zip**。

### C 组 · 事件与团队同步（#535 / #529 / #528 / #527 / #526 / #537）—— 5 条仍存在 + #535 降级


**#529 永久失败堵死同步游标（P1）**
- 永久非法变更（`name:''`）连拉 5 次：每次都 `retryable:true, since:0`，**游标始终 0**。
- 更隐蔽：批内 append+close 已成功、后续条目临时失败 ⇒ 重拉时 append 撞 `事件已 closed` ⇒ **故障恢复后该批永远过不去**。
- 负路径已锁：真 EACCES 仍 transient；业务拒绝（未知 kind）仍正确推进游标。
- 位置：`index.js:20016-20019`（catch 一律字符串）、`team-pull.js:233-252/:359-372/:574-593`、`event-store.js:763`（**closed 检查在 idemKey 之前**）。
- 修法三处同批：applier 分类（fs 码 → transient；业务前缀 → `invalid-event-change`/非 transient）＋ team-pull 业务表加码并**先 honor 显式 `res.transient`** ＋ event-store 把 idemKey 检测提到 closed 之前。

**#528 字段透传（P2）** —— 上行 create payload **缺 `outcomes`/`skills`**；下行 create 同样缺；下行 set 的 `FIELDS` 白名单缺 `skills` ⇒ 单发 set skills 得到 `noop/empty-patch`、同批发 summary 时 **skills 静默丢弃**。
- 根因：**共享字段契约有三份副本**（上行 payload / 下行 create 实参 / 下行 set 白名单），v2 加字段时只改了 store 层与工具层。
- 修法：三处同批 + **把字段表提成模块级常量**，由 store 的 ALLOWED 与 applier 的 FIELDS 共用。

**#527 rename 不入队（P2）** —— `rename` 成功后队列条目数 2→2（未增）；对照 `set{name}` 入队 true。
- 修法：`:24074` 成功后 `enqueueEventChangePre({ op:'set', eventId, name })`。
- ⚠️ **必须用 `op:'set'`** —— 发 `op:'rename'` 会落到下行 default create 分支**把事件重建一遍**。

**#526 重放重复追加感知（P2）** —— 同一 payload 打三次：检查点 1/1/1（去重有效），但 `userPercept` **1→2→3**、四类感知全翻倍；而 applier **还返回 `deduped:true`** —— **上层被告知已去重，数据却已变形**。
- 根因：去重身份只挂在 `checkpoint.idemKey`；四类感知没有身份，「整条远端操作」的边界在 append 内不存在。
- 修法：`append(..., { opId })` + 台账落 **store 顶层** `appliedOps`（上限 500 按 at 淘汰）。
- ⚠️ **不能放事件第 27 字段** —— `validateEventPre` 判 `unknown:` 硬拒；顶层键已实测安全。
- **需拍板**：`team-sync.js:359` 对 event 的 idemKey 仍取 `eventId`（一事件一条记录）。若服务端按 idemKey UPSERT，多次操作会被折叠 —— 改不改是设计决定。

**#537 QQ 反馈重复（P2）** —— 真 spawn 云函数 + 进程内真 HTTP 假 GitHub（ETag/If-Match/412），在「A PATCH 成功之后、A 回读之前」注入 B 的追加：
```
PATCH 次数 2 / 412 冲突 0 / GET 4 / A 的行出现 2 次 / B 1 次 / POST 应答 200
最终文件：A / B / A
```
- 根因：用「整份文件逐字节相等」判成功；别人的合法追加破坏相等 ⇒ 判失败 ⇒ 重读后再追加一遍。**CAS 没造成重复，重复是应用侧重试造成的。**
- 修法：`:456` 加稳定身份 `k: sha1(id|text)`；mutate 幂等化；`:352` 回读判据改「本行在不在」，**不得放宽 CAS 条件头**。
- ⚠️ 改源必须**同步重打包 index.zip**（c310 套件有「zip 与源逐字节一致」锁）。

### D 组 · 前端（#544/#533/#532/#530/#525/#524/#523）—— 7/7（#524 有修正）


**#544 白板「全部事件」入口不可达（P2）**
- 真渲染 `EventView`：`data-dam-ev4-iframe=1 / data-dam-scope-btn=0 / data-dam-event-scope=0`；全 closed 时空态「还没有事件」且按钮 0。
- 根因：按钮块 `client.js:9342-9360` 被 `:9267` 的 `if(!ev4SrcDoc)` 包住，而 `buildEv4IframeHtmlSafePre` 恒返回真串 ⇒ **从引入起就在结构不可达分支里**。
- **套件是源码字符串守卫**（`smoke-test-v5-p6-r4-scope-filter.mjs:126-127`）⇒ 字符串恰在不可达块内 ⇒ **长期误判为通过**。
- 修法：抽 `renderEventScopeBarPre`，主路径 / 降级分支 / 空态 **三处同批**复用；套件改运行期断言。

**#533 全屏标记单次不清（P1）**
- 真渲染 + 可控 IO：**1 次** `isIntersecting=false` 后 `body[data-dam-fullpage]` 仍是 `"true"`，第 2 次才清。
- 根因：IO 只在状态变化时回调，隐藏后不再发第二次；`missStreak>=2` 在等一个**不保证发生**的事件。
- ⚠️ **现有套件把缺陷钉成绿**：`smoke-test-p3-default-fullscreen.mjs:35/:88/:110` 断言 `missStreak>=2` 与「单次不可见不摘标记」，**必须同批改判据**，否则会误判成回归。
- 修法：单次隐藏 + **250ms 有上限可见性复核**（clearRecheck 在 visible/cleanup 清）。

**#532 字符串当函数调用（P1）**
- 传字符串（真实调用点 `identity[0]` 形态）⇒ setter **0 次**；传 getter ⇒ 1 次；裸调用 `TypeError: "ws-a" is not a function`。
- 位置：`skins/iter5/ui.js:20-26` 与 `surfaces.js:280-286`（**两份定义**）+ 4 个调用点 + 生成侧 4 处。
- 根因：形参名 `readState` 却按函数调用，实参是字符串；非空字符串为真 ⇒ TypeError 被 try/catch 静默吞。
- 修法：删 `readState` 形参，统一函数式更新 `setter(prev => prev === next ? prev : next)`；两处定义 + 四调用点同批改后重生成。

**#530 语料健康误判（P2，两条独立缺陷）**
- 缺陷 1：源文件不存在 ⇒ `dropped.reason = sidecar-missing`（**无 source-missing 分类**）⇒ `status=stale` 且**列入可修集合**；但修复必须先读到正文 ⇒ **永不可修**，按钮恒空转。
- 缺陷 2：repair 回执 `{ok:true, repaired:0, attempted:1, results:[{ok:false,reason:'missing'}]}` —— **顶层 ok:true 但一条没修成**；前端只读顶层 `ok` ⇒ 界面显示 `repair: ok`。
- 负路径已证：写出日志后 `repaired:1` 且该行转 ok ⇒ 根因确实是「源不存在」而非权限。
- 修法四处同批：`m4-corpus.js:89` 前加 absent 判定 ＋ `DROP_REASONS` 补枚举 ＋ `storage-manage.js:92-100` 判 `absent`（`:27` 白名单**不加**）＋ 前端三处同源副本显示 `repaired/attempted`。

**#525 上传意图无持久化（P2，功能缺口）**
- 重挂时 status 为 done ⇒ 组件 `return null`、**零恢复入口**、零自动补 upload；超时分支提示「本次不打包」且 interval 清零；源码无任何 intent 持久化键。
- 修法：`onStart` 成功即持久化 `{jobId, ws}`；挂载时 `jobId===intent.jobId && phase==='done'` ⇒ 提供「仅上传」动作；失败**绝不上传**；保证恰好一次。

**#524 轮询终态不更新弹窗（P2）—— 团队模式仍存在，个人模式那半「报告有误」**
- 真渲染：轮询到 done 后标题仍「正在整理记忆…」、按钮 `disabled=true`（upload 只发 1 次 ⇒ #518 主链是通的）。
- 根因：`finish` 只回调不写 state，`phase` 停在 `onStart` 的 `'running'`。
- 修法：`finish` 内 `setSt` 回写；**同批加 sticky 可见**（否则 phase=done 会让弹窗当场卸载）。
- ⚠️ **个人模式不适用**：`:7501` 已早退（向导接管），实测返回 null ⇒ 报告该维度**有误**。

**#523 在跑任务参数名不一致（P1）**
- judge 两种键名实测：`inflightJobIds` ⇒ `orphan/jobid-not-inflight/restart`；`inflightIds` ⇒ `genuinely-running/reuse`。
- 真调用 `startUpgradeJobPre`（桩引擎、同世代 + 在飞）：返回**新 jobId**、写盘 `["failed","running"]`、`runSubagent` 1 次（**旧任务不取消**）⇒ 正常整理被误判为孤儿并重启。
- 修法：`lib/index.js:10842` 改 `inflightIds`（与 `team-baseline.js:461` JSDoc 一致），**不做双键兼容**。

### E 组 · 核心（#543 / #534）


**#534 32 MiB 上限太晚（P1）**
- 真 import + 无 Content-Length 的 64×1MiB ReadableStream：
```
RESULT = {"ok":false,"reason":"response-too-large","bytes":67108864,"maxBytes":33554432}
PULLS = 65 / CHUNKS = 64 / ENQUEUED = 64 MiB / CANCELLED = false
DECLARED_PATH = {... "bytes":67108864, "cancelled":false}   ← 有 Content-Length 路径也不释放 body
BOUNDED_PROTOTYPE = {"tooLarge":true,"bytes":34603008,"pulls":33,"cancelled":true}  ← 有界实现可行
```
- 根因：`readBodyText` 无条件 `await response.text()`，上限只在字符串**已分配之后**事后判断。
- **现有回归是假绿**：`smoke-test-team-sync-livelock.mjs:226-229` 用 `'x'.repeat(33MiB)` 字符串桩——测试替身自己先造了 33 MiB，**无法观察流式读取**；`:269` 的 M5 变异只关 Content-Length 预检。
- 修法：`:106-108` 改有界流式（`getReader()` 逐块累计、超限 `cancel`、读完**一次性** decode）；`:271-274` 返回前补 `body.cancel()`。
- **同批必须改全的同类点**（否则只修一个入口，另两条仍可 OOM）：`team-transport.js:383`（S3 无界 `res.text()`）、`team-transport-http.js:227`（`arrayBuffer()` 无界，而同文件 `baseRequest:180-200` 有界）。

**#543 memory_log 兜底并入不相关事件**
- 6 条跨主题日志**全部**并入唯一 active 事件 A（其中 4 条与 A 主题无关）；A 的 name/summary/四段**从未更新**；`updatedAt` 被无关日志刷新（**正反馈**：并入 → 刷新 → 继续保持「最近更新」）。
- 对照：显式 `eventId` 正常落 B、A 不增长 ⇒ **缺陷只在无 eventId 兜底路径**。
- 根因：`resolveActiveEventPre` 只按 `updatedAt` 取唯一 active 事件，调用点**无主题判据**。
- **性质是设计取舍，不是实现走样** —— 这是 #483 当时**明确保留**的兼容判据。
- 修法：新增 `resolveEventForLogPre(store, text)`，按 bigram 签名对**全部** active 事件取最大重合，`>=2` 才返回（与 `event-plan.js:125` 同口径），否则 **null ⇒ 新建事件（宁建勿挂）**。
- ⚠️ **签名不得包含 checkpoints**（否则一次误挂会让签名自我强化，正是上述正反馈）。
- ⚠️ **不要改 `resolveActiveEventPre` 本体** —— handoff（`:536`）与 plan（`:630`）自挂仍依赖「最近 active」语义，改共享函数会连带改账本/白板归属。
- ⚠️ **必须同批**更新两处静态守卫：`smoke-test-issue482-483-log-binding.mjs:60`、`smoke-test-v4-h1b-memory-log.mjs:44`。

### 专属 · #520（三条根因，均仍存在）


**根因 1：子代理 parent 恒定取「工作台」**
- 决定性行 `lib/index.js:16641`（HEAD 16346）：`const parent = this._workbenchParent || agent || this._lastAgent`。
- 实测：工作台 parent 存在 + 调用方 agent 正确 ⇒ 实际 parent = 中枢；**两个不同 sessionId 调用 ⇒ 两次 parent 都是中枢** ⇒ **sessionId 根本不参与判定**（这正是报告「带不带一样」的机制）。
- ⚠️ **关键反证（变异探针实测）**：把优先级整体改成 `agent || _workbenchParent || _lastAgent` 虽修好了 upgrade，但会让 `auto-memory-consolidate` **spawn 0 次、返回空串** —— `wbOwnerOf` 判 orphan、E2 归属门拒绝，`WB_GATED_JOBS` 的 6 个（greet/fold/summarize/consolidate/consolidate-logs/distill）**全中**。
- ⇒ **正确修法**：保留全局优先级不动，给 `runSubagent` 加第 5 参 `opts`，**只 upgrade 传 `preferCallerParent=true`**。

**根因 2：目标工作区事件库零变化**
- 落点 = 子代理会话头 `cwd`（`:4530`），而 cwd 由 parent 派生 ⇒ 恒为中枢。
- 实测：子代理不传 workspace ⇒ 落中枢（这就是 sha256 逐字节不变的全部机制）；显式传用户区 ⇒ `cross-workspace-write-requires-hub`；`hubSessionIdsPre()` 只含工作台父会话，**整理子代理自己不是中枢会话**（WIP 新增的 workspace 参数对它无效）。
- ⚠️ **必须与根因 1 同批**改 `:10448-10460`（原文「第 5 步**只对中枢这一个工作区做**」）—— 否则修好代码后提示词仍叫子代理跳过，**制造假新 bug**。
- 「一次整理覆盖清单全部工作区」是**独立能力缺口**（要放宽跨区写权限，需单独评审）。

**根因 3：`$HOME` 硬编码跨库读**
- `lib/migration-prompt.js:23` 含 `D="$HOME/.dsh/memory/workspaces/$W"`，全 lib **仅此 1 处**。
- **真跑 bash 证明**：从常量里按代码块原样切出第 1 步，HOME=fake-home / DSH_HOME=fake-dshhome ⇒ exit 0，读到 **GLOBAL-REAL**、读不到 **INSTANCE-OWN**；同进程 `resolveDshHomePre()` 返回实例根 ⇒ 两目录不同。
- ⚠️ **第二真源** `artifacts/MEMORY-BASIS-MIGRATION-PROMPT-2026-10-25.md:62` 同含该行，被 `smoke-test-v4-h3-c3:36` 与 `v5-p7:33` **逐字比对** ⇒ 必须两处同改。
- 修法：manifest 表格加一列绝对路径（绝对根已存在），提示词改 `D="<清单该区绝对路径>"`，**彻底去掉 `$HOME`**。第 10 节仍有 `~/.dsh/memory/person/...` 字样，一并改。
- `MEMORY_BASIS_MIGRATION_PROMPT_CHARS` 是 `.length` 派生，无需重钉数值锁。

---

## 四、修复编组建议


### 必须先拍板的 5 个决策点

| # | 决策点 | 选项 |
|---|---|---|
| 1 | **#538 routeAuth 兼容分支** | A 删分支（代码+文档同批，既有 `/<tok>/` 部署会 403）／ B 改路径段精确匹配（不满足验收第 2 条） |
| 2 | **#540 GC 该修还是该删** | 以 `USER-GUIDE`（已判废默认关）为准 → 删 CLI ／ 以 `lib/index.js:1015`（默认 true 且巡检在跑）为准 → 修 import 并订正文档 |
| 3 | **#542 补丁工具留不留** | `git rm`（0 引用成本）／ 保留则需补 8 引号 + 移写盘到 fail 判定之后 |
| 4 | **#543 兜底判据换不换** | 换（主题签名匹配，匹配不上即建新事件，属行为语义变更）／ 维持 #483 兼容 |
| 5 | **#526 team-sync idemKey 是否改 `eventId\|opKey`** | 改（能逐操作去重，但改变服务端记录条数语义）／ 不改（多次操作会被 UPSERT 折叠） |

### 可独立成批（互不耦合）

| 批次 | 内容 | 说明 |
|---|---|---|
| **T1 工具链** | #542 + #541 + #540 + #539 | 全部 `tools/` 与诊断入口，**线上零影响**；顺带把 `guard-tracked-imports.mjs` 扩到 tools |
| **T2 安全** | #531 + #538 | 同一文件相邻两段，一次落盘 + 一次重打包 index.zip |
| **T3 事件同步** | #529 + #528 + #527 + #526 + #537 | 共用 append 重放语义与字段契约，**必须同批**（#526/#529 共用 closed 判定；#528 非法 skills 会落到 #529 分类器） |
| **T4 前端** | #544 + #533 + #532 + #530 + #524 + #523 | 改 `skins/` 必须重生成；#533/#544 需同批改「把缺陷钉成绿」的套件 |
| **T5 核心** | #534 + #543 | #534 有界流式（同批带上 team-transport 两处）；#543 待决策 4 |
| **T6** | #520 | 根因 1+2 第一层同批（含提示词文案），根因 3 独立｜根因 2 第二层需单独评审 |
| **T7** | #535 | P3，数据修复向，可最后做 |
| **#525** | 归 T4 | 功能缺口，需新增持久化键 + UI 入口 |

### 共同风险（每批都要处理）

1. **`lib/client.js` 两道基线锁**：经典区 sha256（`smoke-test-iter5-skin.mjs:525` = `f7dd6e4a…`）与 `R153_CHARS`（`smoke-test-r26-cross-layer.mjs:841` = `1460491`，仅 index.js）。`R153` 另有 sha16 `BD65E27F3BF56098`。
2. **改 `skins/iter5/*` 必须** `node tools/build-iter5-skin.mjs` 重生成 + `--check --strict` = **SYNC-OK**；**禁止手改生成区**（R2 保护门会拦）。
3. **`index.zip` 漂移锁**：改 `.github/cloud/qq-webhook/index.js` 必须重打包，否则 c310 / issue324 套件红（**那是应有的红**）。
4. **锁红先归因**：真缺陷 → 改代码；判据过期 → 重钉并写明归因。**不回滚整批成果**。
5. **`tools/verify-docs.mjs` 不在回归套件内**，每批单独跑。

---

## 五、证据索引


| 内容 | 路径 |
|---|---|
| 23 条 issue 原文（JSON） | `artifacts/preview-bugs/<编号>.json` |
| 分组建材（供核查员读） | `artifacts/preview-bugs/briefs/*.md` |
| 各组成员报告 | `artifacts/preview-bugs/reports/{A-tools-cli,D-frontend,E-core-team,520}.md` |
| **全部探针与日志** | `artifacts/preview-bugs/probes/`（**122 个文件**） |

所有探针均可复跑：`node artifacts/preview-bugs/probes/<name>.mjs > out.log 2>&1; echo EXIT=$?`

---

**本文件不代表任何代码已被修改**。全部 lib/ tools/ tests/ skins/ 文件未改动；未提交、未改版本号、未进发布线。