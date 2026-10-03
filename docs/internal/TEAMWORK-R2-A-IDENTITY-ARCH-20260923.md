# teamwork R2 · A 卷：企业级身份与登录接入 + 前后端适配（架构调研报告）

> **文件定位**：本卷是**架构方案**，不是决策记录。前置材料：
> [C 卷 · 团队共享版结论](TEAMWORK-CONCLUSION-20260923.md) ·
> [B 卷 · 实时同步与向量编排](TEAMWORK-RESEARCH-B-SYNC-VECTOR-20260923.md) ·
> [R2 诊断](TEAMWORK-R2-DIAGNOSIS-20260923.md)
>
> **发布边界（已实测，非推断）**：`docs/internal/` 不在发布包内，本卷可写内部信息
> （`tools/release.mjs:370` 的 `files` 白名单含 `'!docs/internal'`，注释见 `:361`）。
> `docs/` 其它子目录**会**随包发布 —— 本卷是内部材料，只能放 `internal/`。
>
> **证据分级**：`【实证】`= 可复核的代码行号 / 本机命令输出 / URL；`【推断】`= 外推，未验证；
> `【未验证】`= 查不到权威来源或无法在本机复核；`【待拍板】`= 需要人定。

---

## 卷首 · 本轮已拍板的前提（不再论证）

产品负责人已拍板三项，本卷全部设计必须与之相容：

1. **引入成员身份** —— 当前系统是单人设计（除 `addedBy` 字符串外没有"谁写的"概念，取证见 §0.3）；
2. **通用库写入只留痕不审批** —— 不做审批流；权限只控"能不能写库"；
3. **「失败与弯路」的书写摩擦强制** —— 不再让"失败"成为可选项。

以及上一轮已定的技术主线（本卷不推翻）：**权威服务端 + 事件日志 / CDC**；对象存储快照作第一步与降级路径；
**CRDT 暂不采用**；实时性指标 **文本+状态 ≤5s / 词法 ≤5s / 向量 ≤5min 异步**；
三个现成资产升格为同步原语 —— 单调状态（`lib/state-commit.js:38`）、两阶段提交 + 每写读回校验 + 整体回滚
（`lib/hub-io.js:390-398` / `:420-429` / `:498-514`）、幂等提交单据（`lib/state-commit.js:179-191`，**已带 `actor`**）。

**本卷的核心结论（一句话）**：在这套宿主约束下，**唯一能同时满足"企业交付"与"插件形态"的身份落地路径是
「把 dsh web 宿主当作企业内网的 Web 应用」——OIDC Authorization Code + PKCE，回调落在 3080 自身，
插件不新增端口、不新增鉴权中间件、不改 `/config` 契约**。所有"让插件自己起服务"或"用 localhost 回调接公网 IdP"
的方案都会撞上宿主硬约束（§0.2 已取证）。

---

## 第 0 部分 · 本地取证

> 本节全部结论**先取证再下判断**；凡未读到代码/未跑命令的，一律标注【推断】或【未验证】。

### 0.1 插件如何注册路由？路由长什么样？宿主就是 3080 那个进程吗？

**注册机制**【实证】

- 路由表是插件内一个普通数组：`const routes = [...]`（`lib/index.js:11576`），逐项形状 `{ kind, path, handler }`。
- 注册语句只有一处：`for (const route of routes) disposers.push(ctx.webServer.register(route))`（`lib/index.js:12903`）。
- 路由数量：源码中 `kind: 'exact'` 出现 **54 次**（本机 `regex` 计数实测），与既有口径"五十四条路由"一致。
- 路径前缀：`export const API = { ... }`（`lib/index.js:218`），首项 `state: '/api/dsh-auto-memory/state'`（`:219`），
  全表 54 条 `'/api/dsh-auto-memory/...'`（本机计数 54，与路由数相等 ⇒ **一条路由一个 API 常量，无动态拼接**）。

**路由的契约来自宿主，不是插件自己定的**【实证，宿主源码】

`@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts`：

- `WebRoute = { kind: 'exact' | 'prefix'; path: string /* 绝对路径，无尾斜杠 */; handler: (req, res) => void | Promise<void> }`（`:33-39`）
- `WebServer.register(route): () => void`，`(kind, path)` 重复会 **throw**（`:85-90`）
- `WebServer.port` 是 **getter**（`:81`）；`host` 取值仅 `'127.0.0.1' | '0.0.0.0'`，`port: number`（`:50-52`）
- 另有 `registerUpgrade`（WebSocket 升级）、`registerFallback`（兜底，**只允许一个所有者**）、`tapIndex`（index.html 变换）（`:97-114`）

**鉴权中间件：没有**【实证】

- 插件层**不存在**任何鉴权中间件；鉴权是**逐 handler 手写的 loopback 守卫**：
  `if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })`
  （样本：`lib/index.js:11581`、`:11589`、`:12534`）。
- 守卫实现 `isLoopbackRequest(req)`（`lib/index.js:9040-9052`）四道判据：① `req.socket.remoteAddress` ∈ {`127.0.0.1`,`::1`,`::ffff:127.0.0.1`}；② `Host` 头可解析且 hostname ∈ {`127.0.0.1`,`localhost`,`[::1]`}；③ `sec-fetch-site !== 'cross-site'`；④ `Origin` 缺省即放行，存在则必须与 `Host` 同源。
- **这条守卫就是当前系统全部的安全边界**，也是"团队共享版"必须重构的第一处 —— 它把"同一台机器上的任何浏览器页面"都当成可信。

**宿主就是 3080 那个进程吗？是，但它是 `0.0.0.0`，不是 `127.0.0.1`**【实证，本机命令】

```
Get-NetTCPConnection -LocalPort 3080 -State Listen
  LocalAddress  LocalPort  OwningProcess
  0.0.0.0       3080       13748
```

⇒ 监听在**全接口**。这与"GUI 跑在 `127.0.0.1:3080`"的既有描述**并不矛盾**（本机访问走 127.0.0.1），
但含义完全不同：**3080 已经对所有网卡开放**。这一点直接决定第 1 部分的方案选型（见 §1.2）。

### 0.2 插件能否自己起 HTTP 服务 / 监听额外端口？DSH 给插件哪些能力？

**结论：不能通过宿主契约监听额外端口**【实证】。`WebServer` 暴露的是 `register / registerUpgrade / registerFallback / tapIndex`
与只读 `port`，**没有 `listen()`、没有第二个 server 的创建入口**（`dsh-host-webserver/lib/types/index.d.ts:67-140`）。
`Service.init()` 由宿主自己在激活时调用（`:115-116`）。

**【推断】** 插件在技术上仍可以用 `node:http` 自行 `listen()`（同进程、有 `node:*` 权限，见下），
但那是**绕过宿主契约**：端口不可被宿主感知、生命周期不受 `dispose` 管理、也不会被 `dsh web` 的部署/打包/远程能力覆盖。
**本卷不建议走这条路**，理由在 §2.5 与 §1.2 展开。

**插件实际拿到的东西**（全部来自本仓代码，逐条可复核）：

| 能力 | 取证 |
|---|---|
| 注册 HTTP 路由 | `ctx.webServer.register(route)` — `lib/index.js:12903` |
| 注册模型工具 | `ctx.tools.register(tool)` — `lib/index.js:12901`（19 个工具） |
| 读宿主服务 | `ctx.get('sessionQuery' / 'subagents' / 'sessions' / 'agents' / 'llm' / 'workspaceRegistry' / 'sessionPersistence' / 'sessionController' / 'tokenMeter')` — `lib/index.js:10753-10770`、`:8461`、`:3539`、`:3891` |
| 监听宿主事件 | `ctx.on('agent/session-start' / 'agent/turn-stopping' / 'agent/pre-step' / 'agent/disposed' / 'session/disposed' / 'session/event' / 'tools/result' / 'dispose')` — `lib/index.js:10803-10923`、`:10760` |
| 注册清理钩子 | `ctx.effect(() => () => {...})` — `lib/index.js:12904-12909` |
| `ctx.remote` | 已用到的只有 `ctx.remote.directoryPicker`（`lib/index.js:12417-12419`，注释里给了标准形态 `await ctx.remote.directoryPicker.pick()`） |
| **发网络请求** | **能**。用的是运行时全局 `fetch`：`fetch('https://registry.npmjs.org/...')`（`lib/index.js:4951`）、`fetch(NOTICES_URL)`（`:4990`，`NOTICES_URL = 'https://raw.githubusercontent.com/.../notices.json'`，`:212`）。⇒ **接 OIDC 所需的 token/userinfo 请求在能力上没有障碍** |
| 读写 `~/.dsh` 之外 | **能**（Node 文件 API 无沙箱）。但**配置层有一道闸**：`/config` POST 对 `memoryRoot` / `userMemoryDir` 做 fail-closed 校验，展开后必须落在 `dshHome()` 之下（`lib/index.js:12571-12579`，用 `path.relative` 判，防前缀兄弟目录）。⇒ **"数据资产必须留在 `~/.dsh` 之下"是当前唯一被代码强制的路径约束**，团队版要利用它 |

**宿主注入的客户端清单**（决定了前端能拿到什么）【实证】：`package.json:27-37` 的 `dsh.client.inject` 六项 ——
`dsh-api-remotes` / `dsh-client-runtime` / `dsh-client-connection` / `dsh-client-ui-slots` / `dsh-client-ui-settings` / `dsh-client-ui-sidebar`，`platform: 'web'`。

**顺带发现（重要，非本卷任务但影响身份方案）**【实证】：
DSH 宿主已经存在**与身份直接相关的能力缝**，插件此前完全没用过：

- `ctx.authorization` —— "获取一个无法仅由配置提供的凭据，因为拿到它需要与人对话：打开这个页面、粘贴那个码、选那个账号"，
  且明确设计了 `registerFlow({ key, label, methods, async run(session) })`，`session.notify({ message, url })` 用于**让用户去浏览器完成**
  （`@deepseek-ai/dsh-authorization/lib/types/index.d.ts:1-32`）。**这正是 OAuth 设备授权码流程的宿主原生形态。**
- `ctx.credentials` —— 凭据**引用**（settings 里只放 `CredentialRef` 这种 POSIX 环境变量名），值由 provider 拥有
  （`@deepseek-ai/dsh-credentials/lib/types/index.d.ts:1-9`）。
- `.anonymous-user-id` —— 宿主 home 级匿名 UUID（`$DSH_HOME > ~/.dsh`），**明确声明不从主机名/网络地址/git remote 派生**
  （`@deepseek-ai/dsh-anonymous-user-id/lib/types/index.d.ts`）。本机实测文件内容为一行 UUID。
  ⇒ 它是**当前唯一的"用户标识"**，但它是**匿名且 home 级**的，不是身份。
- **`~/.dsh/remote-web-ui-registry/web.json`** 实测存在且含 `{ id, secret }`（本机文件 90 字节）——
  说明"远程访问自助端"这条链路在宿主侧已有注册表。**【未验证】**：该 secret 的用途、签发与校验路径未读宿主实现，本卷不据此下结论。

### 0.3 当前有没有任何"用户"概念？前端怎么标识自己？`actor` 填什么、谁填？

**结论：没有用户概念。当前只有三种"标识"，且都不是身份**【实证】。

| 标识 | 形态 | 谁填 | 取证 |
|---|---|---|---|
| `actor`（侧车事件） | **字面量字符串** `'engine'` | 引擎自己硬编码 | `lib/index.js:2674`、`:2717` — `appendSidecarEventPre(projectDir, { actor: 'engine', event: 'written', ... })` |
| `addedBy`（技能库条目） | **自由字符串**，缺省 `''` | 调用方给，没人给就是空串 | 校验 `lib/procedure-store.js:140`、`:176`；落库 `:272`；兼容回填 `:757`；投影 `lib/memory-hub.js:303`、`:339`；渲染 `lib/client.js:3887` |
| 提交单据 `actor`（同步原语） | **对象** `{ sessionId, contSeq?, kind }` | 由会话上下文构造 | 必填字段表 `lib/state-commit.js:43`；形状校验 `:165-170`；组装 `:184-188`；冲突文案里的 `冲突方=` `:208-209`、`:221-225` |

**关键洞察**【实证 + 推断】：
`state-commit.js` 的 `actor` 已经是对象且**含 `sessionId`** ⇒ 从"会话级 actor"升级到"成员级 actor"是**加字段**，
不是改结构。而 `procedure-store` 的 `addedBy` 是**自由字符串**，是本次升级里**唯一需要做数据迁移的字段**（§2.1）。

**前端如何标识自己**【实证】：

- **没有** session cookie、没有 `Authorization` 头、没有 `credentials: 'include'`；
  前端所有请求都是裸 `fetch(path)`（GET：`lib/client.js:1519-1524`；POST：`:1525-1530`，只加 `content-type: application/json`）。
- 前端的"身份"完全是 **localStorage 键**，全部带 `dsh-auto-memory.` 前缀（实测 15+ 处）：
  `PIN_KEY`（`:43`）、`POS_KEY`（`:56`）、`GEOM_KEY`（`:116`）、`dsh-auto-memory.lastActive`（`:173`）、
  `.accentTheme.v1`（`:841`）、`.graphDensity.v1`（`:842`）、`.tourDismissed`（`:1353`）、`.pyGpu`（`:3285`）、
  `.autoCont.last`（`:4437`）、`.semWizardDone`（`:6256`）、`.seenVersion`（`:6267`）、`.seenNotices`（`:6403`）、
  `.semDetectSnoozeUntil`（`:6450`）、`.fontScale.v2`（`:7331`）、`.firstRunDone`（`:7510`）、`MAJOR_TOUR_KEY`（`:7508`）。
  `:1434-1450` 还有一段 `dsh-auto-memory-pre.*` → `dsh-auto-memory.*` 的**一次性迁移**（首次读时迁移并删除旧键）。
- **会话 id 是"被请求方"而不是"请求方"**：前端把当前会话 id 当**查询参数**发给宿主
  （`apiGet(API.kanbanBoard, { sessionId: currentSessionIdClient() })` — `lib/client.js:2500`、`:2883`；`:2191`、`:6547`），
  从不作为身份凭据。

⇒ **含义**：前端"身份"目前是**纯本地偏好**，换浏览器即丢、跨端不同步。"谁写的"在数据面上只能靠
`sessionId`（会话级）与 `addedBy`（自由字符串）近似，**不可归因到人**。这是 teamwork 的第一块地基缺口。

### 0.4 前端如何拿到配置？这条约定对「新增身份相关 UI」意味着什么？

**既有约定（唯一真源）**【实证，用户级约定已在代码中落地】：

- 路由 `API.config = '/api/dsh-auto-memory/config'`（`lib/index.js:232`），handler 在 `:12530-12589`。
- `GET` 应答体固定三件套：`{ config, path, promptSections, promptSectionMust }`（`:12541-12546`），
  注释原话：「把『可关的注入分区』清单**从宿主常量发给前端**——设置页二级页据此枚举开关，前端不得硬编码第二份清单（守卫断言集合相等）。
  **搭本路由的便车而非新开路由**：避免 API 路径锁（A1/A2/A4）三处同步的额外风险」。
- `POST/PUT` 走**白名单 + 三类闸**：键必须在 `DEFAULT_CONFIG` 里（`:12552`）；
  `semanticEngineMode` 枚举闸（`:12556`）；`injectExcludeSources` 必须是非空字符串数组（`:12559-12563`）；
  `memoryRoot`/`userMemoryDir` 必须落在 `dshHome()` 下（`:12571-12579`）。非法值**静默丢弃**（fail-closed，不猜测）。
- 前端唯一解包出口是 `configOf`（`lib/client.js:1553-1556`，注释明写"任何 `apiGet(API.config)` 的返回值都必须经这层解包，禁止直读外壳上的配置键"），
  写配置唯一出口是 `saveConfigPatch`（`:1537-1552`）。

**对新增身份 UI 的五条含义**（每条都直接约束第 1 部分的实现）：

1. **不要新开路由来下发身份配置**。全量 54 条路由的路径常量在插件里是**单一真源**，但用户级约定明确"新开路由方案被否"。
   ⇒ 身份相关的**枚举/清单**（可用的 IdP 列表、角色清单、SSO 强制开关的可选值）应搭 `/config` GET 便车。
2. **但"当前登录者是谁"不能塞进 `/config`**。`/config` 是**配置读写**语义（POST 会落盘），把会话态混进去会让
   "读配置"变成"读会话"，且 `saveConfigPatch` 的回传会被污染。⇒ **身份必须有自己的少量只读端点**，
   建议 2 个：`identity-session`（GET，返回当前身份 + 角色 + 能力位）与 `identity-login`（GET/POST，启动/完成登录）。
   这是对"不新开路由"约定的**受控例外**，理由与风险在 §2.5 给出。
3. **前端不得硬编码 IdP 清单**。与 `promptSections` 同款：宿主常量 → `/config` → 前端只提供文案
   （现有范式 `PROMPT_SECTION_TEXT`）。⇒ Google / 阿里云 / 钉钉 / 企业微信的**显示名与顺序**必须由宿主下发。
4. **`/config` 的路径闸要复用**。将来 `memoryRoot` 要指向团队共享目录时，**不要**放宽 `:12571-12579` 的闸，
   而应在闸内增加"允许的团队根"白名单 —— 这条闸是当前唯一被代码强制的数据边界（§0.2）。
5. **前端 ES5 / 零构建约束不变**（白板口径：`client.js` 手写模块加载器、ES5 `var` + `createElement` 别名 `h`）。
   ⇒ 登录页不能引任何框架/构建产物，只能用现有 `h(...)` 与 `fetch` 写。

### 0.5 数据落在哪：`~/.dsh/memory/` 的物理边界

**本机实测目录结构**【实证，`Get-ChildItem ~/.dsh/memory`】：

```
~/.dsh/memory/
├─ MEMORY.md                    (40,677 B)  用户级记忆（跨项目，每轮无条件注入的 Tier-0 面）
├─ CALENDAR.md                  (5,363 B)   用户级日历
├─ archived-user.md             (1,043 B)   归档区
├─ workspaces-summary.json      (7,905 B)   跨工作区总览缓存（含 path，**权威路径源**）
├─ recall-stats.json / recall-stats-pre.json 召回统计（按 source 分流）
├─ notices-cache.json / update-check.json / polling-heartbeat.json / auto-continue-done.json / cont-seq.json
├─ workspaces/                  ← 按 slug 分目录：--D--dsh-auto-memory--、--D--personal_issue--、
│                                  --E--dsh_dynamic_adjust--、--C--Windows-System32-- 等 16 个
├─ hub/                         团队/全局库唯一实库**单文档**：
│     facts.json 9,802,928 B（含 .bak 8.6 MB / .m8r2bak 8.8 MB）
│     procedures.json 113,141 B（含 .bak-depre）
│     episodes.json 46,117 B / flush-state.json
├─ semantic/                    向量与语义工件：
│     vectors-<hash>.json ×5（68 KB … 2.4 MB）
│     embedding-config.json / engine-switch-state.json / l0/
│     activation-shadow*.jsonl / judgement-shadow.jsonl / candidates-shadow.jsonl / fv2-debug.log 7.5 MB
├─ index/                       语料侧车（files/）
├─ evidence/events/             append-only 证据事件（按日分片）
├─ summaries/ · greetings/ · degrade/（-pre 旧目录：archive、hub-pre、index-pre、semantic-pre、evidence-pre、retrieval-pre、degrade-pre）
```

**配置项强制的根**【实证】：`memoryRoot: '~/.dsh/memory/workspaces'`（`lib/index.js:333`）；
`memoryDir(name, homeFn)` 负责 `~/.dsh/memory/<name>`（`lib/datadir.js:64-93`，含 `-pre` → 无后缀的一次性合并迁移）；
`dshHome()`（`lib/index.js:952-955`）。

**向量工件的"身份"字段已实测**【实证，读 `~/.dsh/memory/semantic/vectors-0674174145346b88.json` 首行】：

```json
{"schemaVersion":1,"namespace":"dsh-auto-memory-pre","policyVersion":"semantic_vectors_pre_v1",
 "identity":{"schemaVersion":1,"namespace":"dsh-auto-memory-pre","policyVersion":"semantic_vectors_pre_v1",
   "provider":"bge-m3-onnx-int8-pre-v1","model":"bge-m3-int8","modelRevision":"hash","dimension":1024,
   "normalization":"l2_normalize","dtype":"int8-dynamic-onnx","chunkPolicyVersion":"m7_chunk_pre_v1",
   "configHash":"cfgh_b2d020f9f25039aca6bbd2c571839fa9fe63182d94bcf009d31c7096318b761c"},
 "workspaceRef":"wsr_89590c642ad09bff02b64cc76c5029eb","scope":"Workspace",
 "memoryIndexVersion":"idx_pre_6dd0b332294ccff0a0b2fc87c6bd7a62","chunks":[...]}
```

**隐私投影已存在**【实证】：`workspaceRefOf(workspaceKey)` 把工作区绝对键投影为稳定 ref，**明确"不落盘任何绝对路径"**
（`lib/evidence-store.js:38-39`，模块头 `:3` 声明 append-only + sessionRef/workspaceRef 哈希 + 无原文/无绝对路径）。
`hub/` 的 `facts.json` 里每条 fact 自带 `scope: "Workspace" | "Global"`（实测首行）。

**⇒ 私有 / 共享的天然候选（这张表是第 2 部分"数据边界映射"的输入）**：

| 目录/文件 | 语义 | 天然归属 | 依据 |
|---|---|---|---|
| `workspaces/<slug>/`（`MEMORY.md`、日志、白板 `PLAN.md`、账本 `handoff/`） | 单项目知识 | **私有（随人）**，但 `PLAN.md`/账本是**团队接续资产** | 目录按 slug 分、slug 仅由路径决定（既有迁移结论） |
| `hub/facts.json`（9.8 MB 单文档） | 跨项目事实库 | **团队共享** | `scope: 'Global'` 条目 + 单文档 ⇒ **团队同步的冲突热点**（§2.5 风险 5） |
| `hub/procedures.json` | 技能库（双库：global + workspace） | global 条 → **团队共享**；workspace 条 → 随项目 | `lib/hub-io.js:483`、`lib/memory-hub.js:303` 的 `scope`/`workspaceRef` |
| `hub/episodes.json` | 情景记忆 | 混合 | 同上（按 `workspaceRef` 分流） |
| `semantic/vectors-*.json` | 向量工件 | **可重建的派生数据**，不随人走 | 带 `identity`+`workspaceRef`+`scope`，换模型/维度/切块策略天然隔离 |
| `semantic/*.jsonl`（shadow 观测）、`fv2-debug.log`（7.5 MB） | 调试/观测 | **不进团队** | 体积大、无协作价值 |
| `index/`、`evidence/`、`summaries/`、`degrade/` | 索引/证据/摘要/降级 | 派生数据，本地重建 | 同上 |
| `MEMORY.md`（用户级）、`CALENDAR.md`、`archived-user.md` | 私人规则与日程 | **严格私有** | 位于 `~/.dsh/memory/` 根，非 `workspaces/` 下 |

**最关键的物理事实（决定了整个团队方案的形状）**【实证】：
**团队共享库是"单文档 JSON"**（`facts.json` 9.8 MB、`procedures.json` 113 KB），
而私有项目知识是**按 slug 分目录**的。⇒ *共享面 = 少数大文件*（冲突集中、整文件级冲突），
*私有面 = 天然分片*（无冲突）。这与既有结论"用户改判为物理分文件，因为单文件在团队同步时整个文件都落在冲突面上"
（`hub-io` 的 `createScopedHubIo` 迁移改造，`lib/hub-io.js:390-514`）**方向一致但尚未覆盖 `facts.json` 本体**。

---

## 第 1 部分 · 登录接入的工程方案

### 1.1 协议选型：OIDC / OAuth2 / SAML2

**推荐 OIDC，且不做纯 OAuth2，SAML2 只作为企业客户的"兼容入口"而非自研主线。**

| 维度 | OIDC | 纯 OAuth2 | SAML 2.0 |
|---|---|---|---|
| 定位 | **认证**（叠加 JWT `id_token`）| 仅**授权** | 认证（XML 断言） |
| 是否给"这个人是谁"的标准答案 | **给**（`sub` 稳定唯一标识 + `email`/`name`） | **不给**（拿到的只是 access token，要自己再调 userinfo 猜） | 给（`NameID` + Attribute） |
| 本插件落地成本 | **低**：纯 `fetch` + JWT 解析，无 XML | 中：要自己定义"用户"语义 | **高**：XML 签名校验、证书轮转、Metadata |
| 企业客户常见支持度 | 高（Google / 阿里云 IDaaS / Okta / Azure AD 都支持） | 高但语义弱 | **最高**（传统企业 IdP 常只给 SAML） |
| 已有生态证据 | 阿里云 IDaaS 官方文档原话：**「OIDC 协议在现代身份体系中具备最佳的配置集成体验和表现」**([链接](https://help.aliyun.com/zh/idaas/eiam/user-guide/applications-using-standard-protocols)) | 同页：「OIDC 协议的能力范围包含了 OAuth 协议。**在 IDaaS 中，可使用 OIDC 协议代替 OAuth 协议的功能**」 | 同页：「由于历史原因，其底层基于 XML 实现，在一些边缘场景中适应性较差」 |

**为什么在本插件里 OIDC 不只是"更好"，而是"唯一合理"**【实证 + 推断】：

1. **插件没有 XML 栈**。本仓依赖面极窄：`peerDependencies` 只有 `@deepseek-ai/cordis`，`optionalDependencies` 只有 `@huggingface/transformers`
   （`package.json:50-55`）；README 自述 "zero deps"。引入 SAML 意味着引入 XML 解析 + XML-DSig 校验 + 证书管理，
   **这与"zero deps、零构建"的既有形态直接冲突**。【推断】更大的问题是 XML-DSig 是经典漏洞高发区（签名包裹攻击等），
   自研实现几乎必然出错 —— 而本项目的既有纪律是"未通过编译与产物校验的构建一律不得部署"，安全原语上更不该自研。
2. **OIDC 的 `sub` 正好补上当前最大的缺口**（§0.3：系统没有"谁写的"概念）。`id_token` 里的 `sub` 是
   **IdP 内稳定不变的用户唯一标识**，`email` 用于归并（§1.4）。
3. **纯 OAuth2 不够**：它只回答"这个应用能代表用户做什么"，不回答"用户是谁"。用 OAuth2 + 手调 userinfo 也能拿到人，
   但那等于自己重新发明 OIDC 的一个子集，且失去 `nonce`、`at_hash` 等防重放保护。

**SAML2 的务实定位**：**不在插件里实现 SAML SP**，而是让企业客户在**前置的 IdP 侧做协议转换**——
即客户用阿里云 IDaaS / Azure AD / Okta 把上游 SAML IdP 联邦进来，对插件**只暴露 OIDC**。
阿里云 IDaaS 的版本表正好支持这个用法：**SAML 入方向 IdP 仅企业版支持**，而 **OIDC 入方向 IdP 免费版即支持**
（[IDaaS 计费文档](https://www.alibabacloud.com/help/zh/idaas/eiam/product-overview/pricing)）。
⇒ 一句话：**插件说 OIDC，SAML 由客户的 IdP 网关在插件之外解决。**

### 1.2 Google 登录：具体流程、回调地址怎么落地

**标准流程 = Authorization Code + PKCE（S256）**【实证，Google 官方】：

1. 生成 `code_verifier`（**43–128 字符**，字符集 `[A-Za-z0-9-._~]`）与 `code_challenge = BASE64URL(SHA256(verifier))`；
2. 把浏览器**重定向**到 `https://accounts.google.com/o/oauth2/v2/auth`，参数：
   `client_id`、`redirect_uri`、`response_type=code`、`scope=openid email profile`、`state`、`login_hint`(可选)、
   `code_challenge`、`code_challenge_method=S256`；
3. 用户同意后 Google 回跳 `redirect_uri?code=...&state=...`；
4. 服务端 `POST https://oauth2.googleapis.com/token`，body：`client_id`、`code`、`code_verifier`、
   `grant_type=authorization_code`、`redirect_uri`（**必须与第 2 步逐字符一致**，否则 `redirect_uri_mismatch`）；
5. 应答含 `access_token` / `expires_in` / **`id_token`（仅当请求了身份 scope 时返回）** / `refresh_token` / `scope`。

以上参数名与约束出自 Google 官方文档
[针对 iOS 和桌面应用的 OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/native-app?hl=zh-cn)（PKCE 生成、`code_challenge`/`code_challenge_method`、
`state` 的 CSRF 作用、令牌交换字段表）与
[回送 IP 地址流程迁移指南](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration?hl=zh-tw)。

**callback URI 在本插件宿主约束下怎么落地 —— 这是本卷最关键的一节。**

**先说清楚约束**【实证，逐条可复核】：
① 宿主监听 `0.0.0.0:3080`（§0.1 实测）；② 插件**不能**通过宿主契约新开端口（§0.2）；
③ 插件路由**全部是 3080 上的路径**，前缀 `/api/dsh-auto-memory/`（§0.1）；④ 现有安全边界是 `isLoopbackRequest`
（`lib/index.js:9040-9052`），它认定"请求来自本机 + 同源"即可信。

**⇒ 推荐路径：把 callback 直接落在 3080 自身的插件路由上，形态为
`http://<企业内网可达的 host>:3080/api/dsh-auto-memory/identity/callback`。**

这里必须把**两个完全不同**的部署场景分开，混在一起谈会导致方案互相打架：

| 场景 | 3080 的可达性 | Google 回调能不能落 | 落地形态 |
|---|---|---|---|
| **A. 单机 / 本地开发** | 仅本机（或 `0.0.0.0` 但无公网入口） | **不能**（Google 授权服务器在公网，无法回连内网地址） | **Device Authorization（设备授权码）** 或 **loopback**（见下） |
| **B. 企业内网部署（teamwork 目标形态）** | **内网 DNS 可达**，如 `https://memory.corp.example.com`（TLS 由企业网关终结，反代回 3080） | **能** | **Authorization Code + PKCE，callback = 上述 HTTPS 地址** |

**为什么场景 B 用「web 应用」而不是「桌面应用」客户端类型**【实证 + 推断】：

- Google 的 loopback 流程**只对"桌面应用"客户端类型继续支持**，对 iOS / Android / Chrome 应用类型已于 2022 年封禁；
  且官方明确 loopback 流程**易受中间人攻击**（同机恶意程序可抢占同一回环接口截获授权码），
  迁移指南原文：*「回送 IP 位址流程...容易遭受中間人攻擊。在某些作業系統上，惡意應用程式可能會存取相同的迴路介面，
  攔截授權伺服器傳送至指定重新導向 URI 的回應，並取得授權碼」*
  （[迁移指南](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration?hl=zh-tw)）。
- 而 teamwork 的本质是**多人共用一套权威服务端**，服务端本来就该持有 client secret（它跑在企业内网的服务器上，
  不是分发给每个员工的桌面程序）。⇒ **用「Web 应用」客户端类型 + 服务端换码**才是语义正确的选择。
- 【推断】此处有一个必须正视的张力：**DSH 是本地 Agent 工具，每个成员各自在自己机器上跑一个 dsh web**。
  于是"服务端"其实有两个候选：**(i) 每台成员机自己的 3080**；**(ii) 团队自建的共享权威服务端**（B 卷主线的那个）。
  见 §2.4 的分步迁移 —— **第一步用 (i) 让单机先能登录**，**第二步才把令牌交换与身份校验搬到 (ii)**。
  在 (i) 形态下 client secret 会落到每台成员机上，**这是第一步的已知降级**（§2.5 风险 1 会正面讨论）。

**Google Cloud Console 要配什么**【实证，来自官方文档的"创建授权凭据"节】：

1. **配置 OAuth 同意屏幕（OAuth consent screen）**：应用名、**支持邮箱**（官方特别提醒：该邮箱用于在应用被拦截时向用户显示）；
   **用户类型**选 Internal（仅本 Google Workspace 组织内）或 External；
2. **创建 OAuth 客户端**：类型选 **Web 应用**（场景 B）/ **桌面应用**（场景 A）；
3. **Authorized redirect URIs**：逐个**精确登记**（必须与请求中的 `redirect_uri` 完全一致，否则 `redirect_uri_mismatch`）；
   场景 A 登记 `http://127.0.0.1:<port>` 形态（Google 明确接受 `127.0.0.1` / `[::1]` / `localhost` 三种回环写法）；
4. **Authorized JavaScript origins**：如果用前端 JS 直接发请求才需要；本方案**不需要**（全程服务端换码）；
5. **scope**：`openid email profile` 三个即可（`openid` 才让 Google 返回 `id_token`）；
6. **验证（Verification）**：官方明确 —— 公开应用若使用**允许访问用户数据**的 scope，**必须完成验证流程**，
   否则用户会看到"未经验证的应用"提示。`openid email profile` 属基础身份 scope，**【推断】**通常不触发敏感 scope 审查，
   但"未经验证的应用"提示是否出现，取决于发布状态与用户类型，**上线前需实测确认**（标注【未验证】）。

**本地开发怎么办 —— 三条可用路径**：

1. **Device Authorization（设备授权码流程）** —— **本卷首选**。原因不只是"能跑通"，而是它**与宿主的原生能力缝完全对齐**：
   - 流程：`POST https://oauth2.googleapis.com/device/code`（`client_id` + `scope`）→ 拿到
     `device_code` / `user_code` / `verification_url` / `expires_in`（示例值 1800 秒）/ `interval`（示例值 5 秒）；
     界面显示 `verification_url` 与 `user_code`，用户**在另一台设备**上访问并输入；
     插件轮询 `POST https://oauth2.googleapis.com/token`，`grant_type=urn:ietf:params:oauth:grant-type:device_code`；
     用户未完成时返回 **HTTP 428 + `authorization_pending`**；拒绝返回 **403 + `access_denied`**；轮询过频返回 **403 + `slow_down`**。
   - 允许的 scope 白名单明确包含 **`openid` / `email` / `profile`**（官方"允许的范围"表）。
   - 出处：[适用于 TV 应用和受限输入设备应用的 OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/limited-input-device?hl=zh-cn)。
   - **与宿主的对齐点**【实证】：`ctx.authorization.registerFlow({ key, label, methods, async run(session) {...} })`
     的整个存在理由就是"获取需要人参与才能拿到的凭据"，且示例里正是
     `session.notify({ message: 'Continue in your browser', url }); await commitThroughCredentials(await exchange(session.signal))`
     （`@deepseek-ai/dsh-authorization/lib/types/index.d.ts:14-32`）。
     ⇒ **设备码流程几乎是为这条缝量身定做的**：把 `verification_url` 交给 `session.notify` 的 `url`，
     把轮询循环放进 `run(session)`，并尊重 `session.signal` 的取消语义。
     **这比自建 callback 路由更贴宿主，也不会污染 §0.4 的 `/config` 契约。**
2. **loopback（桌面应用客户端类型）**：请求 `http://127.0.0.1:<随机端口>`。
   **⚠️ 关键细节**：Google 官方对回环流程的说明是「查询平台以获取相关的回环 IP 地址，**并在随机可用的端口上启动 HTTP 监听器**」
   —— 也就是说**回环流程本来就要临时起一个监听器**（这是 Google 规定的流程形态，不是本插件的架构选择）。
   在本插件里这意味着：登录期间临时占用一个随机端口，登录结束即关闭。
   **【推断】** 这与"插件不新增端口"的纪律并不冲突（它是**登录期间的临时监听 + 立刻关闭**，不是常驻服务），
   但**必须写进实现说明并让用户知晓**；且它是**降级路径**，首选仍是设备码。
3. **开发期最简**：直接在 Google Cloud Console 里另建一个"桌面应用"客户端，只在本机开发时用，生产用 Web 应用客户端。
   **不要把开发用 client_id 打进发布包**（§2.5 风险 1 会说明为什么）。

### 1.3 阿里云登录：有没有标准 OIDC/OAuth 身份提供方

**有，而且正好是标准协议。结论：阿里云的对应产品是「应用身份服务 IDaaS · EIAM 云身份服务」，它是一个
同时支持 OIDC / SAML 2.0 / OAuth 2.0 / （CAS 未来版本）的 IdP**【实证】。

**官方依据**：[IDaaS 支持的标准协议有哪些](https://help.aliyun.com/zh/idaas/eiam/user-guide/applications-using-standard-protocols)
（阿里云帮助中心「应用身份服务 (IDaaS) → EIAM 云身份服务 → 操作指南 → 应用管理 → 普通应用 → 开通应用 → 标准协议」）。
原文要点：*「IDaaS 允许任意支持标准协议的应用，通过配置对接单点登录」*；*「选择 SAML 2.0 应用或者 OIDC 应用」*。

**关键规格（版本能力矩阵，逐条摘自 [产品计费](https://www.alibabacloud.com/help/zh/idaas/eiam/product-overview/pricing)）**：

| 能力 | 免费版 | 标准版 | 企业版 |
|---|---|---|---|
| 实例最大账户数 | **10** | 按配额 | 按配额 |
| 实例最大应用数 | **3** | 10 | 1,000 |
| **日志审计留存** | **7 天** | 7 天 | **366 天** |
| 服务可用性承诺 | **不保障** | **99.9%** | **99.9%** |
| 技术支持 | 工单 | 工单（24h 内反馈）+ 8×5 沟通答疑 | 同标准版 |
| **OIDC 入方向 IdP（联邦认证、手动绑定账户）** | **支持** | 支持 | 支持 |
| OIDC 入方向 IdP（自动绑定/创建/更新，联动 Azure AD/Okta） | 不支持 | 支持 | 支持 |
| **SAML 入方向 IdP** | 不支持 | 不支持 | **仅企业版** |
| 钉钉入方向 IdP（扫码登录、全量同步） | **支持** | 支持 | 支持 |
| 钉钉入方向 IdP（工作台免登、增量/敏感数据同步） | 不支持 | 支持 | 支持 |
| 飞书入方向 IdP | 不支持 | 支持 | 支持 |
| **AD/LDAP 入方向 IdP** | 不支持 | **不支持** | **仅企业版** |
| 企业微信入方向 IdP（扫码登录、工作台免登、数据同步） | 不支持 | 不支持 | **仅企业版，且需结合专属端点** |
| **标准/自研应用（SAML/OIDC 等单点登录）** | **不支持** | **支持** | **支持** |
| 组和扩展字段能力 | 不支持 | 支持 | 支持 |
| OTP/短信/邮件二次认证 | 不支持 | 支持 | 支持 |
| 高级密码能力（初始密码、定期改密、密码历史、忘记密码） | 不支持 | 支持 | 支持 |
| 条件访问控制（基于上下文的动态决策与二次认证） | 不支持 | 不支持 | **企业版增值能力（+40%）** |
| 品牌化（图标、名称、自定义域名） | 不支持 | 不支持 | 支持 |
| 专属端点（对接企微或私网连接 AD/LDAP） | 不支持 | 不支持 | **企业版增值能力（+30%，最多 1 个）** |

**计费方式**【实证，同上文档，更新时间 Aug 04, 2026】：
总费用 = **版本基础费（含账户配额）+ 增值能力费（可选）+ 机器身份管理费（可选，独立计费）**；
新购**唯一选项是"活跃账户数计费"**（按过去一个自然月内有过至少一次登录/认证行为的独立用户数计费，**不再限制同步总账户数**）；
超配额自动触发**弹性后付费**（默认开通、不可单独关闭），
**中国内地弹性单价：标准版 $1.8/账户/月，企业版 $5/账户/月**（非中国内地：$5 / $17）。
**欠费影响明确**：欠费超 24 小时服务可能暂停，**"所有通过 IDaaS 进行身份认证的应用将无法正常登录"**；欠费超 7 天可能终止、配置数据保留 30 天。
⇒ **这是甲方必须知道的可用性耦合：身份系统欠费 = 全员登录不了**（§3 的 SLA 条目会回到这一点）。

**给 dsh-auto-memory 的最小可用采购建议**【推断，价格以售卖页为准】：
**标准版 + 活跃账户数计费**。理由：免费版**不支持"标准/自研应用"**（即插件无法作为应用接入）且**仅 10 账户 / 3 应用**，
**服务可用性不保障** —— 三条都过不了企业采购线。标准版提供 99.9% SLA、标准/自研应用、二次认证、高级密码能力，正是本方案所需。

**阿里云 vs Google 的对接差异（这是用户点名要的）**：

| 维度 | Google | 阿里云 IDaaS | 对本方案的影响 |
|---|---|---|---|
| 协议 | OIDC（Web 应用 / 桌面应用 / 设备码） | OIDC / SAML / OAuth / CAS | 插件只需要实现**一套** OIDC，两家通吃 |
| **国内合规 / 数据跨境** | 用户身份数据出境到 Google | **境内**；IDaaS 可选中国站 | 【推断】若客户有等保/数据出境要求，**Google 登录在这类客户处不可用**，须以阿里云 IDaaS（或客户自有 IdP）为主 |
| **网络可达性** | `accounts.google.com` / `oauth2.googleapis.com` 在境内**不稳定**（【推断】未实测） | 境内直连 | **必须把 IdP 当成可插拔项**，不能把 Google 写死成默认 |
| 企业目录 | Google Workspace（`hd` 域限制 / Internal 用户类型） | **AD/LDAP 仅企业版**、钉钉/飞书/企微入方向 | 传统企业（AD 域）→ 走 IDaaS 企业版联邦，**插件侧仍是 OIDC** |
| **交互形态** | 网页跳转 / 设备码 | **钉钉扫码登录是免费版就支持的入方向 IdP** | **扫码是"工厂/车间/门店"场景的实际首选**（无邮箱、手机为主） |
| 账户模型 | Google 账号（邮箱为强标识） | IDaaS 账户 + 多身份源绑定 | 直接影响 §1.4 的归并策略 |
| 审计日志留存 | Google Workspace 管理端（需 Workspace 订阅） | **7 天（免费/标准）/ 366 天（企业）** | **标准版 7 天日志不足以做企业审计 ⇒ 审计必须落在插件自己的库里**（§3） |
| SLA | 另议 | 免费版**不保障**；标准/企业 99.9% | 见上 |

**钉钉 / 企业微信作为"扫码入口"的性质**【实证 + 未验证】：
阿里云文档明确把"钉钉扫码登录"列为 IDaaS 的入方向 IdP 能力（免费版即支持扫码登录 + 全量同步），
并把 OAuth 2.0 描述为"常见微信登录、钉钉扫码登录等，均使用 OAuth 2.0 协议实现"（同 §1.1 引用页）。
**【未验证】**：钉钉开放平台与企业微信的第三方网站扫码登录的**具体接入形态与回调域名要求**未在本轮逐条核实到官方规格页
（检索到的官方入口：[钉钉 - 使用钉钉账号登录第三方网站](https://open.dingtalk.com/document/orgapp-server/use-dingtalk-account-to-log-on-to-third-party-websites-1.md)、
[企业微信 - 自建应用可信域名说明](https://open.work.weixin.qq.com/help2/pc/21316)）。
**⇒ 工程建议**：**不要让插件直接对接钉钉/企微**，而是**统一经 IDaaS 联邦**（钉钉/企微 → IDaaS → OIDC → 插件）。
理由：① 插件只维护一套 OIDC 实现；② 客户换 IM 时插件零改动；③ 企业微信入方向在 IDaaS 侧需要企业版 + 专属端点，
这是**客户的基础设施决策**，不该由插件的代码形态来绑定。

### 1.4 多 IdP 并存：账号怎么归并

**核心问题：同一个人用 Google 登录一次、用阿里云登录一次，会不会变成两个用户？**
**会 —— 除非显式做归并。** 这是多 IdP 系统最常见的生产事故，必须在数据模型层面解决，不能靠约定。

**归并的三条原则**（按可信度降序，任一命中即归并，**不允许"猜测式"归并**）：

1. **`(provider, subject)` 是唯一的身份锚**。OIDC 的 `sub` 在**同一 issuer 内**永久稳定 ⇒ 用它做主键的一半。
   **⚠️ 绝不能用邮箱当主键**：Google 的邮箱可改、可被 Workspace 管理员重分配；企业邮箱会随离职回收并可能被复用 ⇒
   邮箱相同的两个人会被错误合并（**这是安全事故，不是体验问题**）。
2. **邮箱归并必须带"已验证"前提**。只有 IdP 明确声明该邮箱已验证（Google 的 `email_verified`）时才允许用它自动关联到既有成员。
3. **企业客户强制走"组织内归并"**。若客户用 Google Workspace / IDaaS，则**建议开启"域白名单 + 首次登录即绑定"**，
   并在**同一封企业邮箱**下自动归并 —— 但**必须留管理员手工拆分入口**（见 §3 的移交条目）。

**表设计（建议 schema，标注与现有代码的接口）**：

```sql
-- 租户（一个企业客户 = 一个 tenant）
tenant(id, slug, name, created_at, status)

-- 成员 = 人（与登录方式解耦）
member(id, tenant_id, display_name, primary_email,
       email_verified      bool,          -- 是否经 IdP 验证
       status              enum('invited','active','suspended','departed'),
       created_at, departed_at)

-- 身份 = 一个人的一个登录方式（**一个 member 可以有 N 条 identity**）
identity(id, member_id, tenant_id,
         provider            text,        -- 'google' | 'aliyun-idaas' | 'dingtalk' | 'password' | ...
         issuer              text,        -- OIDC issuer，必须存（同一 provider 可能多实例）
         subject             text,        -- OIDC sub（password 类型时为空，见下）
         email_at_idp        text,
         email_verified_at_idp bool,
         raw_profile         json,        -- 只存必要字段，不存令牌
         created_at, last_login_at,
         UNIQUE (issuer, subject)          -- ★ 归并的第一道闸
       )

-- 邮箱验证凭据（自建账号用；SSO 账号不需要）
email_verification(member_id, email, token_hash, expires_at, consumed_at)

-- 密码凭据（**单独一张表**，因为 SSO 账号没有密码）
password_credential(member_id PK, algo, params json, hash, updated_at, must_change bool)

-- 会话（见 §1.6）
session(id, member_id, tenant_id, issued_at, expires_at, last_seen_at,
        revoked_at, ua_hash, ip_hash, refresh_token_hash)

-- 审计（**必须自建，不依赖 IdP 的 7 天日志**，见 §3）
audit_log(id, tenant_id, member_id, action, target_type, target_id,
          before_digest, after_digest, at, request_id)
```

**关键约束（写进建表语句，别只写在文档里）**：

- `UNIQUE (issuer, subject)` —— **同一 IdP 的同一个人只会有一条 identity**；
- **`identity` 表不允许 `UNIQUE (email)`** —— 邮箱只用于**归并建议**，不作唯一键；
- `password_credential` 与 `identity` **分表** ⇒ **"自建账号"与"SSO 账号"在数据层就共存**，
  一个人可以**同时**有 password 凭据和 Google identity，登录时任选其一，**归并到同一个 `member_id`** —— 这正是用户要的"除去自建之外还要接 SSO"。

**归并流程（登录时的判定顺序，必须固定，否则行为不可预测）**：

```
1) 按 (issuer, subject) 查 identity
   命中 → 登录成功，member = identity.member_id          【主路径，永远优先】
2) 未命中，且 IdP 声明 email_verified = true：
   2a) 按 primary_email 查 member
       命中 → 新建 identity 挂到该 member（**归并**），记审计 'identity.linked'
       未命中 → 新建 member + identity
3) 未命中，且 email 未验证（或 IdP 不给 email）：
   → 一律新建独立 member（**宁可多一个，不可错合并**），
     并在管理端标记「待归并」，由管理员手工 merge/split
```

**⚠️ 主动防御**：若某次登录的 `(issuer, subject)` 未变但**邮箱变了**，**不得**据此改 `member.primary_email`，
只更新 `identity.email_at_idp` 并记审计 —— 否则一次邮箱变更就能把身份指向别人。

### 1.5 自建账号（"除去自建身份账户系统之外" = 自建仍要有）

**密码存储**【推断 + 行业惯例，参数需在目标机器上标定】：

- 算法 **argon2id**（当前密码哈希的第一选择）。建议初始参数（**必须在部署机实测后再定稿**，标注【未验证】）：
  `m = 64 MiB`（`memoryCost = 65536 KiB`）、`t = 3`、`p = 1`、`hashLength = 32`、`saltLength = 16`；
  目标：**单次验证 50–200 ms**（企业内网登录体验与该区间相容）。
- **参数必须存进库**（`password_credential.params`），以便将来提高强度时**逐用户透明升级**（登录成功时发现参数低于当前基线即重算）。
- **绝不**存明文/可逆加密；**绝不**用快速哈希（MD5/SHA-*）或未加盐哈希。
- 依赖现实问题**【实证 + 推断】**：本仓 `package.json` **没有** argon2 类依赖，
  而 `peerDependencies` 只有 cordis ⇒ 引入 `argon2` 原生模块会带来**跨平台预编译二进制**问题
  （本仓支持 Windows，且 `optionalDependencies` 里的 `@huggingface/transformers` 已说明作者能接受可选重依赖）。
  **本卷的判断**：**自建密码应当落在权威服务端（Node 服务），而不是落在插件里** ——
  服务端可以用任意依赖、任意 CPU 预算；插件只做"把凭据转发给服务端"。
  这同时解决了 §2.4 的"第一步 vs 第二步"张力。

**邮箱验证**：注册后签发一次性 token（**存哈希，不存原文**），有效期建议 24h，`consumed_at` 幂等消费；
**未验证不影响登录，但影响权限**（见 §1.7：未验证邮箱的成员不得写团队库）。

**找回密码**：走 `email_verification` 同款的一次性 token（**必须与验证 token 用不同的用途域，防止串用**），
有效期建议 30–60 分钟，**消费即失效**，且**必须写审计**。
【推断】风险：邮件通道本身可能不在企业内网 —— 需要配置企业 SMTP 或走 IdP 的找回路径（若客户用 SSO，
**应把找回密码引导到 IdP**，而不是自建一套平行的找回流程）。

**与 SSO 账号如何共存（这是问题的核心）**：

| 场景 | 行为 |
|---|---|
| 同一邮箱先自建、后用 Google 登录（email_verified=true） | **归并**：把 Google identity 挂到已有 member，**保留密码**作为备用登录方式 |
| 企业启用 SSO 强制后 | **不删除**已有 password 凭据，但**登录入口隐藏密码表单**；管理员可配置"SSO 强制"开关（§1.7） |
| SSO 用户想设密码 | 【推断】建议**不允许**（企业合规通常禁止 SSO 账号另设本地密码 —— 它绕过 IdP 的 MFA 与离职回收）。**建议做成可配开关，默认禁止** |
| 成员离职（IdP 侧停用） | **插件必须主动同步**：不能依赖"他登不进来"——已签发的 session 仍在。见 §3 离职条目 |

### 1.6 会话与令牌

**结论：session cookie 存服务端会话状态 + 短时 access token（若需跨服务）；不用纯 JWT 做浏览器会话。**

| | session cookie（**推荐**） | 纯 JWT |
|---|---|---|
| 吊销 | **能**（服务端删记录即失效） | **不能**（签发即有效直到过期；除非维护黑名单 —— 那又回到服务端状态） |
| 离职即时生效 | **能** | 不能（须等 TTL 到期） |
| 体积 | 小 | 大（且每次请求都带） |
| 与现有前端相容性 | **高**（前端本来就是裸 `fetch`，同源 cookie 自动带上，`client.js:1519-1530` 零改动） | 需改前端加 `Authorization` 头 ⇒ **违背"最小改动接入"** |

**cookie 属性（逐条给理由）**：

- `HttpOnly` —— 防 XSS 窃取。**注意**：本插件前端是 `client.js` 手工渲染，**没有**任何理由让 JS 读会话 cookie。
- `SameSite=Lax` —— **本方案的最优选**。理由：登录的**顶层跳转回跳**（`GET .../callback`）在 `Lax` 下**会**携带 cookie，
  而 `Strict` 不会（会导致回跳后看起来"没登录上"）；`Lax` 同时能挡掉跨站 POST。**若必须 `None`（跨站场景）则必须同时 `Secure`。**
- `Secure` —— 场景 B（企业内网 HTTPS）**必须**；场景 A（`http://127.0.0.1`）浏览器允许对回环地址使用非 Secure cookie，
  **【推断】** 但 `SameSite=None` 在 http 下会被拒 ⇒ 再次说明**场景 A 应走设备码而非 cookie 回跳**。
- `Path=/api/dsh-auto-memory` —— 收窄作用域，避免与宿主其它路由互相干扰。
- **不需要 `Domain`**（同源即 3080，见下）。

**CSRF**：只读 GET 不需要；**所有写操作必须带 CSRF token**。
**关键优势【实证 + 推断】**：**同一个 `Origin`**。`/config` 的 POST 已经在用 `isLoopbackRequest` 校验
`Origin` 必须与 `Host` 同源（`lib/index.js:9049-9051`）⇒ **现成的同源判据可以升级为 CSRF 的第一道防线**，
再叠加 double-submit token 即可。**这比跨域架构少了一整类问题。**

**插件宿主下 cookie 的作用域问题 —— 用户点名要"说明白"，这里说明白：**

> **GUI 在 3080，插件路由也在 3080 —— 这是优势，不是约束。**

- 浏览器访问 `http://127.0.0.1:3080/` 拿到 GUI；GUI 里的 `fetch('/api/dsh-auto-memory/state')` 是**同源请求**；
- 登录跳转出去（`accounts.google.com`）再回跳到 `3080/api/dsh-auto-memory/identity/callback`，
  回跳后**落在同一个 origin** ⇒ cookie 天然生效，**不需要 CORS、不需要 `credentials: 'include'`、不需要第三方 cookie**；
- 对比"插件跑在 A 端口、GUI 跑在 B 端口"的架构：那种情况下会立刻遇到
  `SameSite` / `Secure` / CORS 预检 / `Origin` 白名单四件事，**而本插件一件都不会遇到**。
- **唯一的例外是场景 A 的 loopback 回跳**：Google 可能回跳到 `http://127.0.0.1:<另一个端口>`（临时监听器），
  那是**另一个 origin**，cookie 不通 ⇒ 需要"一次性 code 换回跳"（临时监听器收到 code 后，
  **只在内存里**把它交给 3080 的进程，再由 3080 写 cookie）。**【推断】** 这是可实现的，但复杂度明显高于设备码 ⇒ 首选设备码。

**refresh 与吊销**：

- **refresh token 只存哈希**（`session.refresh_token_hash`），原文只发一次给客户端；
- **refresh 轮换（rotation）+ 重用检测**：旧 refresh 被再次使用时，**立即吊销整条会话链**并记审计（这是 OAuth 的推荐做法）；
- **吊销入口有三个，缺一不可**：① 用户主动登出（`POST .../logout`，服务端删 session）；② 管理员强制下线（按 member 批量吊销）；
  ③ **IdP 侧同步**：离职/停用后由管理员操作或 SCIM/目录同步触发批量吊销（见 §3）；
- **access token 有效期建议 ≤ 15 分钟**，session 绝对有效期建议 ≤ 12 小时 + 滑动续期（`last_seen_at`）。

### 1.7 多租户与权限

**层级**：`tenant(企业) → team(团队/部门) → workspace(项目，对应现有 slug) → member(成员)`。

**与现有代码的接缝**【实证】：现有"工作区"是**按路径 slug 分目录**（`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/`，
§0.5 实测），且 `workspaceRefOf()` 已提供**不落绝对路径的稳定投影**（`lib/evidence-store.js:38-39`）。
⇒ **建议：团队版的 workspace 主键就用 `workspaceRef`，而不是 slug 或路径。**
理由：① slug 是路径的函数（换机器/换路径即变），ref 是哈希投影，天然跨机稳定；② 它已经在向量工件里被当身份字段用
（`vectors-*.json` 的 `workspaceRef`，§0.5 实测）⇒ **同一把钥匙开两把锁，不引入第二套身份**。

**RBAC 最小角色集（4 个，不再多）**：

| 角色 | 读私有 | 读团队库 | **写团队库** | 成员管理 | 租户设置 | 说明 |
|---|---|---|---|---|---|---|
| **owner** | ✅ | ✅ | ✅ | ✅（含改角色） | ✅ | 客户方负责人；**至少保留 1 个**，不可自我删除 |
| **admin** | ✅ | ✅ | ✅ | ✅ | ❌ | 日常管理员；**不能改 owner**，不能改计费 |
| **member** | ✅ | ✅ | ✅ | ❌ | ❌ | 普通成员：**读+写团队库，这正是"只留痕不审批"的落点** |
| **viewer** | ✅ | ✅ | **❌** | ❌ | ❌ | 只读（外部审计、实习生、离职交接期） |

**与"通用库写入只留痕不审批"的相容性（这条是硬约束，必须写清）**：

- 权限只回答一个二值问题：**这个 member 有没有 `write:team` 能力**。有就写，没有就 403。
- **不引入任何审批状态机**：`audit_log` 是**追加型记录**（谁、什么时候、改了什么、前后摘要），
  与 §2.2 的幂等提交单据（`lib/state-commit.js:179-191`，已带 `actor`）是**同一条通路** ⇒
  **"留痕"直接复用现有提交单据的 `actor` 字段**，不新增第二套写入路径。这正是既有纪律"不要重复建设通路"的延续。
- **不可逆的边界**：**不提供"待审批"状态、不阻塞写入、不让写入进入 pending 队列**。
  唯一允许的"阻挡"是**能力缺失（403）**，不是"等待批准"。
- **`viewer` 的存在意义**：它是"不引入审批流"之后，唯一还能表达"这个人的写入需要更谨慎"的手段 ——
  想更严，就把他降为 viewer（**这是人的决策，不是系统的流程**）。
- **未验证邮箱的成员**默认**没有** `write:team`（相当于 viewer），邮箱验证后自动升为 member。**这把 §1.4/§1.5 与权限串起来了。**

**SSO 强制开关**：租户级布尔项。开启后：密码登录入口隐藏（但不删除凭据，便于回退）；
**必须在 UI 显式警告"开启后若无可用 IdP，全员将无法登录"**（回到 §1.3 的欠费停服教训）。

### 1.8 前端要做什么、后端要做什么（用户点名要）

> 判据：**凡"必须被信任"的都在后端；凡"只是显示"的都在前端。** 前后端都不许"顺手做点安全"。

| 功能 | 前端（`lib/client.js`） | 后端（宿主 `lib/index.js` + 权威服务端） | 理由 / 现状 |
|---|---|---|---|
| **登录页** | **渲染**：IdP 按钮列表、"用邮箱登录"入口、错误文案 | 下发可用 IdP 清单（**搭 `/config` 便车**，§0.4）；不下发任何密钥 | 前端零构建、ES5，只能用 `h(...)`；清单单一真源在宿主常量 |
| **发起跳转** | `location.href = .../identity/login?provider=google` 或 `fetch` 后拿 `url` 再跳 | ① 生成 `state` + `code_verifier`，**存服务端会话**；② 拼授权 URL；③ 设备码模式下调 `/device/code` 并把 `user_code` 回给前端 | **PKCE 的 verifier 绝不能出现在前端**，否则 PKCE 白做 |
| **回调落地** | **不做任何事**（回调是后端路由，浏览器只是被重定向） | 校验 `state`、用 `code_verifier` 换码、验 `id_token`（签名/`iss`/`aud`/`exp`/`nonce`）、建/归并 identity、写 session cookie | 回调必须由**能信任的进程**处理；前端无密钥 |
| **设备码模式 UI** | **显示** `user_code` 与 `verification_url`，提供"我已授权，继续"与轮询进度 | 轮询 Google token 端点；把 `authorization_pending`(428) / `slow_down`(403) / `access_denied`(403) 映射为前端可读状态 | 前端只显示，不判断结果 |
| **令牌续期** | **不做**（cookie 自动携带；服务端滑动续期） | session 滑动续期 + refresh rotation + 重用检测 | 前端不该持有任何长期令牌（否则 XSS 即接管） |
| **登出** | 按钮 → `POST .../identity/logout`，成功后刷新界面状态 | 删 session、清 cookie、记审计；可选调 IdP 的 end-session | — |
| **身份展示（"谁写的"徽标）** | **渲染**徽标；数据来自接口返回的 `actor` 投影 | 在**读取**类接口（`state`/`handoff-state`/`kanban-board`/`memory-hub`…）的应答里**带上 `actor` 的展示投影** | 与 §2.1 的 actor 升级配套；**前端不得自行推断身份** |
| **权限相关 UI 隐藏** | **只做显示层隐藏**（无权限的按钮不渲染） | **必须独立再校验一次**，403 是唯一权威 | 前端隐藏是体验，不是安全；本条是硬纪律 |
| **`viewer` 的只读态** | 隐藏写入按钮 + 顶部只读提示 | 所有写接口校验 `write:team` | 同上 |
| **个人信息 / 改密码** | 表单渲染 | 验旧密码、argon2 重算、失效其它 session、记审计 | 自建账号专属；SSO 账号隐藏该入口 |
| **成员管理（owner/admin）** | 列表 + 角色下拉 + 移除 | 校验 `manage:members`；**不可把最后一个 owner 降级** | 防"自锁"事故 |

**既有前端如何最小改动接进去（三条硬约束 + 一条建议）**：

1. **不改 `apiGet`/`apiPost` 的调用形态**（`lib/client.js:1519-1530`）。它们已经是裸 `fetch`，
   **同源 cookie 会自动携带** ⇒ 登录态接入**零改动**。
2. **不改 `/config` 契约**（`lib/client.js:1553-1556` 的 `configOf` 解包层保持不变）。
   身份信息**不进 `config`**（§0.4 含义 2）。
3. **不加构建步骤**。ES5 + 手写模块加载器不变；登录页用现有 `h(...)` 写。
4. **建议：身份展示走"投影"而不是"新字段"** —— 即后端在既有应答里把 `actor` 从
   `"engine"` / `""` **投影成 `{ display, memberId, badge }`**，前端 `lib/client.js:3887` 那处
   `p.addedBy ? ' · ' + p.addedBy : ''` 的渲染点**只需改取值路径，不改渲染结构**。

---

## 第 2 部分 · 与现有架构的接口（不推翻重来）

### 2.1 `actor` 字段如何从"字符串"升级为"成员引用"（向后兼容）

**现状三处，性质各不相同**【实证，§0.3 已列】：

| 位置 | 现状 | 兼容难度 |
|---|---|---|
| `lib/state-commit.js:43` / `:165-190` 的提交单据 `actor` | **已是对象** `{ sessionId, contSeq?, kind }`，且是**必填**（缺任一 fail-closed 拒绝） | **低** —— 加字段即可 |
| `lib/index.js:2674` / `:2717` 的侧车事件 `actor: 'engine'` | 字面量字符串 | **低** —— 加一个并行字段 `memberId`，保留 `actor` |
| `lib/procedure-store.js:140/176/272/757` 的 `addedBy` | **自由字符串**，缺省 `''`，前端直接拼进标题（`lib/client.js:3887`） | **中** —— 需要"历史数据无法回溯"的明示 |

**升级方案（三步，均为纯增量）**：

**第 1 步：扩展提交单据 `actor`（不动必填集）**

```js
actor: {
  sessionId,            // 保持不变（必填，:184-188 现行逻辑）
  contSeq,              // 保持不变（可选）
  kind,                 // 保持不变（必填）
  memberId,             // ★ 新增（可选）：把 sessionId 映射到"人"
  tenantId,             // ★ 新增（可选）
}
```

- **为什么不把 `memberId` 加进 `COMMIT_REQUIRED_PRE_V1`（`lib/state-commit.js:43`）**：
  那条常量是**必填字段表**，加进去会让**所有老调用方立刻 fail-closed**（`:168-173` 直接返回 `actor-invalid`），
  等价于破坏向后兼容。⇒ **`memberId` 一律可选**；由下游按"有则用、无则降级"处理。
- 【推断】这与该文件自述的兼容契约完全一致：`buildStateCommitPre` 的注释（`:150-151`）明确写了
  *「`expectedStateVersion` 与 `expectedDigest` 均为可选；不传时下游行为必须与本契约引入前逐字节一致」*
  ⇒ **新字段沿用同一判据：不传 = 行为不变。**

**第 2 步：`addedBy` 的向后兼容（老数据没有 memberId 怎么办）**

- **保留 `addedBy` 不动**（它是已发布 schema 的一部分，`procedure-store.js:140/176` 对它有类型校验）。
- **新增可选字段 `addedByRef`**：`{ memberId, tenantId, displayAtWrite }`。
- **读取侧统一投影**（建议放在 `lib/memory-hub.js:303` / `:339` 这两处已有的投影点，**不新增通路**）：
  ```
  addedBy 有值、addedByRef 无 → { display: addedBy, memberId: null, badge: 'legacy' }
  addedByRef 有值            → { display: addedByRef.displayAtWrite, memberId, badge: 'member' }
  两者都无（历史数据）        → { display: '未知（旧数据）', memberId: null, badge: 'unknown' }
  ```
- **⚠️ 最诚实的一条**：**历史数据无法回溯**。老条目从写入那天起就没有"人"的信息，
  **任何"补全"都是伪造**。⇒ **必须显式显示 `badge: 'legacy' / 'unknown'`，绝不允许回填猜测值。**
  这条纪律与项目既有的"根因结论必须附证据、推断必须显式标注"是同一族。

**第 3 步：前端渲染点**（`lib/client.js:3887`）

现状：`'[' + (isWs ? t('hubScopeWorkspace') : t('hubScopeGlobal')) + (p && p.addedBy ? ' · ' + p.addedBy : '') + ']'`
⇒ **只改取值，不改结构**：把 `p.addedBy` 换成投影后的 `p.actorBadge.display`，并给 `legacy/unknown` 加视觉弱化样式。
**这是全前端唯一必须改的身份相关行**（其余身份 UI 都是新增，不是修改）。

### 2.2 与「权威服务端 + CDC」主线的衔接

**身份在哪一层校验 —— 答案：三层，各管一件事，不重叠。**

| 层 | 校验什么 | 在哪 | 依据 |
|---|---|---|---|
| **L1 传输/来源** | 请求是否来自可信来源（同源、非跨站） | 插件路由入口，**复用并收紧现有 `isLoopbackRequest`**（`lib/index.js:9040-9052`） | 现状已有四道判据（remoteAddress / Host / sec-fetch-site / Origin） |
| **L2 会话/身份** | 这个请求属于哪个 `member`（cookie → session → member） | 插件侧**只做验签/查会话，不做身份推导**；权威判定在服务端 | §1.6 |
| **L3 授权/能力** | 这个 member 有没有 `write:team` / `manage:members` | **服务端**（插件侧的 403 只是"服务端已拒"的转发与前端体验优化） | §1.7 |

**关键设计判断**【推断，但依据充分】：
**worker / 子代理不应各自持身份**。本仓已存在的形态是"引擎 + 每 agent 一个 runtime"
（`lib/index.js:12892-12900`：`tool.execute` 被包成 `engine.withAgent(agent, () => rawExec(...))`）。
⇒ **身份应在会话进入时绑定（`ctx.on('agent/session-start', ...)`，`lib/index.js:10803`），
在整条会话生命期内不变**；工具执行与提交单据都**从绑定的会话上下文取 `memberId`**，
**绝不允许由模型/工具参数传入** —— 否则"谁写的"就变成模型可以随便填的字段，等于没有。

**事件载荷里的 `actor` 怎么保证不可伪造 —— 四道措施，逐条对应现有代码**：

1. **`actor` 不由写入方构造，由提交边界注入。**
   现有 `buildStateCommitPre(input)`（`lib/state-commit.js:153-196`）已经是"组装提交单据"的边界函数；
   升级后**在这里覆盖/补齐 `memberId`**（从会话上下文取），
   **忽略调用方传入的 `memberId`** —— 这与该函数现有做法同源（它已经在规范化 `actor` 的形状，`:184-188`）。
2. **cookie 侧**：`HttpOnly` + 服务端会话（§1.6）⇒ 浏览器 JS 无法读也无法伪造会话；
   **CSRF token 逐写请求校验** ⇒ 第三方页面无法代发写请求。
3. **提交单据侧**：沿用现有幂等 + 冲突检测 —— `txId`（必填，`:162-163`）、
   `expectedDigest` / `expectedStateVersion` 可选但**两阶段提交 + 每写读回校验 + 整体回滚**已在
   `lib/hub-io.js:390-398` / `:498-514` / `:420-429` 落地。
   ⇒ **`actor` 与该单据是同一个原子边界**：单据被拒（`commitConflictPre`，`:202-227`），`actor` 也就不落账。
4. **审计侧**：`audit_log` 与提交单据**共用 `txId`**（单据已有 `txId`，回执 `commitReceiptPre` 也回带 `txId`，`:236`）
   ⇒ **从审计行可以反查到提交单据，从单据可以反查到审计行**。这条"双向可追"是企业审计的真正要求。

**⚠️ 必须承认的边界**：以上保证的是**"写入路径上的 actor 不可伪造"**，
**不是"磁盘上的文件不可篡改"**。任何能读到 `~/.dsh/memory/hub/facts.json` 的进程都能直接改文件绕过单据。
【推断】真正的防篡改需要事件日志 + 哈希链/签名，B 卷主线（事件日志/CDC）是其前提。
**本卷明确标注：在只做快照的阶段，追溯力是"审计级"而非"防篡改级"。** 对甲方必须这么讲，不能含糊。

### 2.3 数据边界映射：哪些随用户走（私有）、哪些上团队（共享）

> 依据 §0.5 的物理结构实测 + `scope` / `workspaceRef` 字段实测。

| 路径（相对 `~/.dsh/memory/`） | 内容 | 归属 | 传输形态 | 理由与依据 |
|---|---|---|---|---|
| `MEMORY.md` | 用户级跨项目规则（Tier-0，每轮无条件注入） | **严格私有** | **不上传** | 位于 `memory/` 根，非 `workspaces/` 下；含个人偏好与本地路径 |
| `CALENDAR.md` / `archived-user.md` | 日程 / 归档 | **严格私有** | 不上传 | 同上 |
| `workspaces/<slug>/MEMORY.md` | 项目笔记（可复用结论） | **私有为主，可选择性共享** | 默认不上传；项目级"发布到团队库"动作另说 | 与 `hub` 的 global 条是两条通路 |
| `workspaces/<slug>/<date>.md` | 每日日志 | **私有** | 不上传 | 原始工作流水，含敏感上下文 |
| `workspaces/<slug>/handoff/PLAN.md` + `handoff/*.md` | **白板 + 交接账本** | **团队共享（最高价值）** | **上传（≤5s 同步）** | 这是"新人接手"的核心资产（C 卷卖点 3） |
| `workspaces/<slug>/reflections/` | 每日反思 | **私有** | 不上传 | 反思含个人判断 |
| `hub/facts.json`（9.8 MB 单文档） | 跨项目事实库 | **团队共享** | **上传（分片/事件化后）** | 带 `scope: 'Global' \| 'Workspace'`；**单文档是冲突热点**（§2.5 风险 5） |
| `hub/procedures.json` | 技能库 | `scope=global` → **共享**；`scope=workspace` → **随项目** | 按 `scope` 分流上传 | `lib/memory-hub.js:303` 的 `scope`/`workspaceRef` 已可分流 |
| `hub/episodes.json` | 情景记忆 | 混合 | 按 `workspaceRef` 分流 | 同上 |
| `semantic/vectors-*.json` | 向量工件 | **不随人走（派生数据）** | **不上传，各端本地重建** | 带 `identity`(model/dimension/chunkPolicy/configHash) + `workspaceRef` + `scope` ⇒ 换模型/维度自动隔离；**上传它会制造"谁的向量算准"的伪问题** |
| `semantic/*.jsonl`（shadow / judgement / candidates） | 决策观测 | **私有** | 不上传 | 调试与灰度观测，无协作价值 |
| `semantic/fv2-debug.log`（7.5 MB） | 调试日志 | **私有** | 不上传 | 体积大、含原文片段 |
| `semantic/embedding-config.json` | 嵌入配置 | **私有**（但**团队应统一**） | 不上传，改由**团队配置下发** | 【推断】若各成员嵌入模型不一致，向量库无法共享 —— 建议团队层强制统一 |
| `index/`、`evidence/`、`summaries/`、`degrade/` | 索引 / 证据 / 摘要 / 降级 | **派生数据，本地重建** | 不上传 | 除 `evidence/`（append-only 证据事件）可能需**汇总级**上传，见 §3 审计 |
| `recall-stats.json` | 召回统计 | **私有** | 不上传 | 个人使用数据 |
| `workspaces-summary.json` | 跨工作区总览（含 `path`） | **私有** | **不上传（含绝对路径）** | `lib/index.js:7241/7481` 写它；**已确认含 path 字段** |
| `-pre` 遗留目录（`hub-pre/`、`semantic-pre/` 等 7 个） | 迁移遗留 | **私有** | 不上传 | `lib/datadir.js:64-93` 的迁移逻辑负责合并；团队版不应把它们纳入同步面 |

**一句话总结边界**：**共享面 = `handoff/`（接续资产）+ `hub/` 按 `scope=global` 筛出的条目**；
**其余全部私有**；**向量与索引永远不上传**（可重建）。

**⚠️ 一处必须提醒甲方的事实**【实证】：`hub/facts.json` 当前 **9.8 MB 且是单文档**。
企业客户会问"多少个团队、多少条记忆、多大" —— **当前物理形态下，团队共享库的规模上限受"单文件读写 + 内存解析"约束**。
这是 §2.4 第一步**必须**先做的事（分片），否则一切同步方案都建在流沙上。

### 2.4 迁移路径：从"单人本地"到"企业多租户"

**总原则：每一步都能单独上线、都能回退，且不破坏单人用法。**

| 步 | 名称 | 做什么 | 交付判据 | 依赖 |
|---|---|---|---|---|
| **S0** | **基线冻结 + 契约登记** | 冻结本卷 §0 的取证结论；把 `actor` / `addedBy` / `scope` / `workspaceRef` 四处的 schema 写进一份 `IDENTITY-SCHEMA.md`；为"未来要加字段"预留**可选字段**位 | 文档 + `node --check` 全绿；**零行为变更** | 无 |
| **S1** | **单人登录（最小可用）** | 只做两件事：① `identity-session`（GET 当前身份）+ `identity-login`（发起）；② **一个 IdP**（Google 设备码流程，复用 `ctx.authorization.registerFlow`）。**默认关闭**：开关为 false 时**行为与本步之前逐字节一致** | 本机能登录、能登出、界面显示自己的名字；**关掉开关 = 完全回到现状** | S0 |
| **S2** | **`actor` 升级（留痕）** | 提交单据加 `memberId`/`tenantId`（**可选**）；`addedByRef` 写入；读取侧投影 + `legacy/unknown` 徽标；前端只改 `client.js:3887` 一处取值 | 新条目能显示"谁写的"；老条目显示"未知（旧数据）"；**老数据零改动、零回填** | S1 |
| **S3** | **团队库分片（**这一步是硬前提**）** | 把 `hub/facts.json`（9.8 MB）从单文档改为**按 `workspaceRef` + `scope` 分片**；复用已有的两阶段提交 + 读回校验 + 整体回滚（`lib/hub-io.js:390-514`）与作用域 IO（`createScopedHubIo`，`:394` 起） | 分片后读写行为与分片前**语义等价**（有交叉读盘计数断言）；冲突面从"整库"缩小到"单条" | S0（可与 S2 并行） |
| **S4** | **权威服务端接入（CDC 主线）** | 身份校验、会话、审计、权限判定搬到服务端；插件侧只做"验签 + 转发 + 投影"。**此步开始才真正多租户** | 两台成员机写同一团队库，冲突被单据拒绝并可见（不是静默覆盖） | S2 + S3 |
| **S5** | **多 IdP + 自建账号** | 加阿里云 IDaaS / 钉钉（经 IDaaS 联邦）/ 自建账号（argon2id，落在服务端）；`identity` 表 `UNIQUE(issuer,subject)` + 邮箱归并 | 同一人两种登录方式归并到同一 member；`identity.linked` 审计可见 | S4 |
| **S6** | **企业交付项** | 审计导出、SLA、备份/恢复、离职流程、SAML via IdP 网关（§3） | §3 清单逐条可演示 | S4-S5 |

**第一步最小可用（S1）具体到"今天就能动手"的清单**：

1. 新增两个路由常量到 `API`（`lib/index.js:218-275` 那张表）：
   `'identity-session': '/api/dsh-auto-memory/identity/session'`、`'identity-login': '/api/dsh-auto-memory/identity/login'`
   —— **这是对"不新开路由"约定的受控例外**，例外理由与风险见 §2.5 风险 2。
2. 两者都加**与现有 54 条路由完全一致的** `isLoopbackRequest` 守卫（`lib/index.js:9040-9052`）——
   **先与现状持平，再谈提升**，不要一上来就改变安全语义。
3. IdP 清单**搭 `/config` 便车**下发（`lib/index.js:12541-12546` 的应答体加一项），前端不硬编码。
4. 登录流程**用 `ctx.authorization.registerFlow`**（`@deepseek-ai/dsh-authorization/lib/types/index.d.ts:14-32`），
   **不自建 callback 路由** —— 这是 S1 里最关键的一条：它把"回调落地"这个最难的问题**交给宿主已有的能力缝**。
5. **开关默认 false**，且与既有功能**完全解耦**（既有用户级纪律：单一开关不得顺带改变其它功能行为）。
6. `dispose` 时清干净（`ctx.effect`，`lib/index.js:12904`），不留定时器/监听器。

### 2.5 风险与坑（≥5 条，逐条给触发条件与对策）

**风险 1 · 令牌交换的密钥落在每台成员机上（第一步的固有缺陷）**
- 事实：DSH 是本地 Agent，每个成员各自跑一个 3080；S1 在成员机上完成换码 ⇒ client secret（若用 Web 应用客户端）落在成员机。
- **触发条件**：S1 部署即存在。
- **对策**：① 若必须单机跑，**用"桌面应用"客户端类型 + PKCE 且不配 secret**（Google 明确对已安装应用把 `client_secret` 标为**可选**）；
  ② 更彻底的是 S4 —— 换码搬到权威服务端；③ **绝不把开发用 client_id/secret 打进 npm 包**（本仓发布流程已有 tarball 卫生扫描，须把凭据扫描升级为**强制项**，见 `tools/release.mjs` 的精神）。

**风险 2 · `isLoopbackRequest` 不是身份，且 3080 已监听 `0.0.0.0`**
- 事实：守卫只看"来源 IP + Host + Origin"（`lib/index.js:9040-9052` 四道判据），
  而实测 `0.0.0.0:3080`（§0.1）。⇒ **同网段任何机器的浏览器都能访问 3080**；
  而 `Host` 检查接受 `localhost`/`127.0.0.1`/`[::1]` —— **对内网用户 `localhost` 就指向他自己的机器**（不构成风险），
  但**若通过内网 IP 访问（场景 B），`Host` 头是内网 IP，会被判 false ⇒ 现有 54 条路由全部 403**。
- **这是被大多数人忽略的关键事实**：**当前所有路由在"内网 IP 访问"下都会拒绝服务**。
  ⇒ 团队版第一步的隐性前置是**放宽/替换 `isLoopbackRequest`**，而**放宽它就等于拆掉当前唯一的安全边界**。
- **对策**：**不要放宽，而是替换** —— 用"同源 + 会话"取代"回环"，即：请求必须带有效 session cookie 且 `Origin` 同源。
  此时 `isLoopbackRequest` 从"身份判据"降级为"CSRF 辅助判据"。**这条改动必须与 §1.6 同批上线，不可分两次**（否则中间态是敞开的）。

**风险 3 · 回调/跳转的 origin 断裂（跨端登录态冲突）**
- 触发条件：成员在"内网域名 A"登录，却在"IP 地址 B"或 `localhost` 打开 GUI ⇒ cookie 作用域不同，表现为"登录了但界面说没登录"。
- **对策**：① **团队版强制单一入口域名**（并在文档里写明"不要用 IP 访问"）；
  ② cookie 不设 `Domain`（保持 host-only，最小作用域）；
  ③ 会话 cookie 只在 3080 这一个 origin 生效 ⇒ 天然避免跨域泄露。
- 【推断】更隐蔽的一种：成员同时开两个浏览器/两个 profile，各自登录不同账号 ⇒ 团队库会出现"同一台机器两个身份交替写"。
  对策：审计里记录 **session + member 双字段**（不要只记机器），让这种情况在审计里**看得见**。

**风险 4 · 离线可用性（本地优先的传统被打破）**
- 事实：本仓 README 自述 **"Local-first"**（`package.json:3` 的产品描述里就写着 `Local-first, model-agnostic, zero deps`）。
- 触发条件：S4 之后身份与权限判定依赖服务端 ⇒ **服务端不可达 = 无法写团队库**。
- **对策（这是设计题，不是运维题）**：
  ① **阶梯降级**：服务端不可达时，**私有记忆功能必须完全不受影响**（`MEMORY.md`/日志/白板全部继续本地可用）；
  ② 团队库写入进入**本地待提交队列**（复用幂等 `txId` 单据，天然可重放），恢复后按 `txId` 去重提交；
  ③ **禁止**"离线时先写本地团队库副本再静默合并"——那会造成**无法察觉的分叉**，与 B 卷"承诺不漏写入"的目标冲突。
  ⇒ **离线只允许"排队"，不允许"分叉"。**

**风险 5 · 单文档大库的冲突与体积（S3 的硬理由）**
- 事实：`hub/facts.json` **9,802,928 B 单文档**（§0.5 实测）；已有 `.bak` 8.6 MB / `.m8r2bak` 8.8 MB 两份副本。
- 触发条件：S4 一上线就会遇到 —— 两个人同时写团队库，冲突粒度是**整文件**。
- **对策**：**S3 必须早于 S4**（§2.4 已把它列为 S4 的前置）。
  分片键建议 `workspaceRef + scope`（既有字段，无需新造身份），并复用既有作用域 IO 与两阶段提交。
  **【推断】** 分片后单个条目级冲突才能被 `expectedDigest` 精确表达 —— 这正是 `lib/state-commit.js:150-151` 的兼容契约存在的意义。

**风险 6 · 合规与审计（数据驻留、PII、日志留存）**
- 事实：① 阿里云 IDaaS **标准版日志仅留存 7 天**（§1.3）；② 本仓记忆是**明文 Markdown**（插件 GUIDANCE 自述"限制：记忆文件为明文 Markdown"）；
  ③ `hub/facts.json` 里存的是**业务知识原文**，可能含 PII；④ Google 登录意味着**身份数据出境**。
- **对策**：① **审计必须自建**（不能依赖 IdP 的 7 天）；② 记忆内容**加密是产品级决策**【待拍板】——
  加密后向量检索与前端全文渲染都要改，成本高，本卷**不建议在 S1-S4 做**，但**必须显式告知甲方"当前是明文"**；
  ③ 提供**数据驻留开关**（team 级 `dataRegion`，只影响权威服务端选址，不影响插件本地目录）；
  ④ 提供**导出与删除**接口（GDPR/个保法的"可携带/被遗忘"），并保证删除是**真删**而不是标记（注意：本项目记忆语义里
  `superseded`/`retracted` 是"**返回但标记**"，那是**知识有效性**语义；**合规删除必须是物理删除**，两者不可混淆 ——
  这是本项目一个真实且容易踩的语义冲突，必须在 UI 上把"作废"与"删除"分成两个不同操作的措辞）。

**风险 7 · 依赖与形态倒退**
- 事实：本仓零依赖（`peerDependencies` 仅 cordis，`package.json:50-52`），零构建前端（白板口径）。
- 触发条件：为做身份而引入 `express` / `passport` / `next-auth` / argon2 原生模块。
- **对策**：**服务端可以自由选型；插件侧必须守住"零新增运行时依赖"**。
  这也正是 §1.5 把自建密码放到服务端的理由之一。**若插件侧非要加依赖，必须走用户级发版纪律并显式告知。**

---

## 第 3 部分 · 企业交付清单

> 逐条给"**当前产品的缺口**"与"**补法**"。这一节的读者是采购与技术负责人。

| # | 采购会问 | 当前缺口（附证据） | 补法 |
|---|---|---|---|
| **1** | **审计日志：谁在什么时候改了什么？** | **完全没有**。① `actor` 只在侧车事件里是字面量 `'engine'`（`lib/index.js:2674`、`:2717`）；② `addedBy` 是自由字符串且可为空（`lib/procedure-store.js:272`）；③ **没有统一的追加型审计流**；④ 提交单据里虽有 `txId`（`lib/state-commit.js:162-163`）但**没有持久化的审计表** | ① S2 上线 `memberId` 留痕；② 建 `audit_log` 表，字段 = `tenant/member/action/target/before_digest/after_digest/at/request_id/txId`；③ **复用提交单据的 `txId` 双向可追**（§2.2）；④ 提供**导出为 CSV/JSONL** 与**按 member/时间段过滤**的只读页面 |
| **2** | **数据驻留与合规（境内/境外）** | ① 插件数据全在**各成员本机 `~/.dsh/memory/`**（§0.5）⇒ **天然分布式**，"数据在哪"没有单点答案；② 记忆是**明文 Markdown**；③ Google 登录 = 身份数据出境 | ① 明确三类数据：**本地私有（不出机）/ 团队共享（进客户指定区域的服务端）/ 身份数据（IdP）**，并写进合同附件；② 提供 team 级 `dataRegion`；③ 提供**物理删除 + 导出**接口，并把"作废（retracted）"与"删除"在 UI 上分开（§2.5 风险 6）；④ 若客户要求境内，**Google 登录不开**，走阿里云 IDaaS 或客户自有 IdP |
| **3** | **SSO 强制 + 离职处理** | ① **没有 SSO**（无任何身份概念）；② **没有"成员"实体** ⇒ 谈不上"离职"；③ 会话不存在 ⇒ 也谈不上吊销 | ① S5 加 `identity` 表与多 IdP；② team 级 `sso_enforced` 开关（开启时隐藏密码入口，**并显式警告"无可用 IdP 则全员无法登录"**）；③ **离职三件事**：IdP 侧停用 → 插件侧**批量吊销该 member 全部 session** → **其私有记忆的处置策略**（见 #4） |
| **4** | **成员离职后数据怎么办？（最容易被忽略的一条）** | **无任何机制**。当前数据按**机器/工作区**组织，不按人（`~/.dsh/memory/workspaces/<slug>/`，§0.5）⇒ 人走了，数据仍在**别人的机器上**（因为每个人各有一份） | 分三类明确策略并**写成产品设置**：① **团队库贡献**（`handoff/`、`hub` global 条）→ **保留**（这是资产，且已留痕到人）；② **其私有目录**（`MEMORY.md`、日志、反思）→ 默认**随人走**（本机数据，不在团队服务端）；③ 若雇主合规要求回收 → **提供"交接导出"动作**：把指定成员在该项目下的 `handoff/` 与 `hub` 贡献打包交给接手人。**⚠️ 必须明说：团队服务端不应默认保存任何人的私人日志。** |
| **5** | **备份与恢复** | ① 现有备份是**文件级**（实测 `facts.json.bak-*`、`MEMORY.md.bak-*` 等多份手工备份，无保留策略）；② **无一致性快照**（多文件写入过程中备份会拿到撕裂状态）；③ **无恢复演练** | ① S3 之后，服务端侧做**一致性快照**（基于提交单据的序号/`txId` 做点位）；② 定义保留策略（如日备保留 30 天、月备保留 12 月）并**自动化**；③ **必须定期做恢复演练**并留记录（企业采购会要这个记录）；④ 客户端侧：`~/.dsh/memory/` 的**私有部分由用户自担**（写进文档），团队部分由服务端担保 |
| **6** | **SLA / 可用性** | ① 当前**无 SLA**（本地插件，跑在用户机上）；② **身份依赖第三方**：阿里云 IDaaS 免费版**服务可用性"不保障"**（§1.3），且**欠费 24h 即可能暂停认证**；③ 单文档 `facts.json` 9.8 MB 的读写会成为延迟尖刺 | ① **区分两条 SLA**：**本地记忆功能**（本机，无 SLA 需求）/ **团队同步与身份**（服务端，可承诺）；② **身份链路必须有降级**：IdP 不可用时**已登录会话继续有效**（不要把"每次请求都问 IdP"写成实现）；③ 采购时选**标准版及以上**（99.9% 承诺 + 标准/自研应用）；④ S3 分片是消除大文件尖刺的前提 |
| **7** | **（附加）多租户隔离证明** | 无租户概念 | 租户隔离必须在**数据查询层**强制（每条 SQL 带 `tenant_id`），并提供**隔离测试用例**作为交付物 —— 采购会要"你怎么证明 A 公司看不到 B 公司" |

**企业交付的最小演示清单（建议给甲方演示这 6 个动作）**：
① 用 Google 登录 → 看到自己的名字；② 写一条团队记忆 → 另一台机器 ≤5s 看到，且**显示"谁写的"**；
③ 老数据显示"未知（旧数据）"而不是编造的名字；④ 用 viewer 账号尝试写入 → **403 且前端按钮已隐藏**；
⑤ 管理员下线某成员 → 该成员**下一个请求即失效**；⑥ 导出审计 → **能看到上面 5 个动作的时间线**。

---

## 附录 A · 本卷取证索引（关键结论 → 证据）

| 结论 | 证据 |
|---|---|
| 插件路由注册入口唯一 | `lib/index.js:12903` |
| 路由表 54 条、API 前缀表 54 项 | `lib/index.js:11576` / `:218-275`（本机 regex 计数各 54） |
| 宿主路由契约（kind/path/handler、register 抛重、port getter） | `@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts:30-39`、`:81`、`:85-90` |
| 插件不能通过宿主契约新开端口 | 同上 `:67-140`（仅 register/registerUpgrade/registerFallback/tapIndex/port） |
| 逐 handler loopback 守卫；无鉴权中间件 | `lib/index.js:9040-9052`（实现）、`:11581`（样本） |
| 3080 监听 `0.0.0.0` | 本机 `Get-NetTCPConnection -LocalPort 3080 -State Listen` |
| 插件能发网络请求 | `lib/index.js:4951`、`:4990`（`fetch` + 超时） |
| 配置路径闸（`memoryRoot` 必须在 `dshHome()` 下） | `lib/index.js:12571-12579` |
| `/config` GET 三件套契约 | `lib/index.js:12541-12546` |
| 前端裸 fetch、无凭据 | `lib/client.js:1519-1530` |
| 前端身份=localStorage 键（15+ 处） | `lib/client.js:43,56,116,173,841,842,1353,3285,4437,6256,6267,6403,6450,7331,7508,7510` |
| `actor` 现为字符串 `'engine'` | `lib/index.js:2674`、`:2717` |
| 提交单据 `actor` 为对象且必填 | `lib/state-commit.js:43`、`:165-190` |
| 提交单据可选字段的兼容契约 | `lib/state-commit.js:150-151` |
| 冲突描述三要素 + 冲突方 | `lib/state-commit.js:202-227` |
| 两阶段提交 / 读回校验 / 整体回滚 | `lib/hub-io.js:390-398`、`:498-514`、`:420-429` |
| 作用域 IO + 迁移 | `lib/hub-io.js:394`、`:483` |
| 记忆单调状态三值 | `lib/state-commit.js:38` |
| `addedBy` 校验 / 落库 / 回填 / 渲染 | `lib/procedure-store.js:140,176,272,757`；`lib/memory-hub.js:303,339`；`lib/client.js:3887` |
| `workspaceRef` 隐私投影（不落绝对路径） | `lib/evidence-store.js:3`、`:38-39` |
| 向量工件含 identity/workspaceRef/scope | 实测 `~/.dsh/memory/semantic/vectors-0674174145346b88.json` 首行 |
| `hub` 为单文档且带 `scope` | 实测 `~/.dsh/memory/hub/facts.json`（9,802,928 B）首行 |
| `memoryRoot` 默认值 | `lib/index.js:333` |
| `memoryDir` + `-pre` 合并迁移 | `lib/datadir.js:64-93` |
| 宿主 `ctx.authorization` 能力缝 | `@deepseek-ai/dsh-authorization/lib/types/index.d.ts:1-32` |
| 宿主 `ctx.credentials` 引用语义 | `@deepseek-ai/dsh-credentials/lib/types/index.d.ts:1-9` |
| 宿主匿名用户 id（home 级、非身份） | `@deepseek-ai/dsh-anonymous-user-id/lib/types/index.d.ts`；实测 `~/.dsh/.anonymous-user-id` |
| `docs/internal` 不入包 | `tools/release.mjs:370`、`:361` |
| 零依赖 / 零构建形态 | `package.json:50-55`（peer 仅 cordis）；`package.json:3`（Local-first） |
| Google PKCE / 令牌交换 / 设备码 / 回环迁移 | [native-app](https://developers.google.com/identity/protocols/oauth2/native-app?hl=zh-cn)、[limited-input-device](https://developers.google.com/identity/protocols/oauth2/limited-input-device?hl=zh-cn)、[loopback-migration](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration?hl=zh-tw) |
| 阿里云 IDaaS 标准协议 | [applications-using-standard-protocols](https://help.aliyun.com/zh/idaas/eiam/user-guide/applications-using-standard-protocols) |
| 阿里云 IDaaS 版本/计费/SLA/日志留存 | [pricing](https://www.alibabacloud.com/help/zh/idaas/eiam/product-overview/pricing) |
| 钉钉/企微扫码（未逐条核实规格） | [钉钉 - 第三方网站登录](https://open.dingtalk.com/document/orgapp-server/use-dingtalk-account-to-log-on-to-third-party-websites-1.md)、[企业微信 - 可信域名](https://open.work.weixin.qq.com/help2/pc/21316) |

## 附录 B · 未验证 / 待拍板事项（不得当结论使用）

**【未验证】**
1. `~/.dsh/remote-web-ui-registry/web.json` 里 `{id, secret}` 的用途与校验路径（未读宿主实现）—— **可能是团队版现成的远程访问凭据，值得下一步优先查**。
2. Google 在境内网络的可达性与稳定性（未实测）。
3. 钉钉 / 企业微信第三方网站扫码登录的**具体回调域名要求与接口规格**（只查到官方入口，未逐条核实）。
4. `openid email profile` 三 scope 是否会触发 Google 的"未经验证的应用"提示（取决于发布状态与用户类型）。
5. argon2id 建议参数在目标部署机上的实测耗时（未标定）。
6. 宿主 `ctx.authorization` 的 flow 在 **web 平台**（非桌面/远程形态）下的 UI 呈现方式（未验证）。
7. `isLoopbackRequest` 在"内网 IP + 反代"形态下的实际行为（**推断会 403**，未实测）。

**【待拍板】**
1. **第一步落在哪台机上**：S1 在成员机（快、但密钥分散）vs 直接上权威服务端（慢、但一次到位）。
2. **记忆内容是否加密**：本卷建议 S1–S4 不做，但必须向甲方披露"当前明文"。若客户合规硬要求，则**须重估工作量**（向量检索与前端渲染都会受影响）。
3. **自建账号的定位**：是"企业的后备登录方式"还是"面向无 IdP 的小客户的主路径"——这决定它是 S5 还是更早。
4. **`viewer` 是否默认开放给外部人**（审计员/实施顾问），以及其可见范围是否包含 `handoff/`。
5. **团队库的 embedding 配置是否强制统一**（否则向量库无法跨成员共享）。

---

*本卷为纯调研产出：零 `lib/` 代码改动、零配置改动、零发布动作。*
*唯一写盘文件：`docs/internal/TEAMWORK-R2-A-IDENTITY-ARCH-20260923.md`（`docs/internal/` 已被 `tools/release.mjs:370` 排除，不随发布包发出）。*
