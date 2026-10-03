# dsh-auto-memory 架构说明（面向新 agent · 2026-09-20）

> **读者**：从没见过这个项目、要在这个仓库里干活的 agent。
> **性质**：讲**结构与机制**。条目级枚举（每个工具/路由/设置键的逐项清单）见并行交付物 `docs/internal/FEATURE-INVENTORY.md`；用户视角说明见 `README.zh-CN.md`。
> **取证口径**：本文所有关键数字与行号均为 2026-09-20 在 pre 线工作区（本仓库）只读实测，行号对应当时的工作区版本。`lib/` 是活代码、仍在演进，行号会漂移，**引用时先复核**。
> **边界提醒**：本仓 `lib/`、`tests/`、`tools/` 只读（活宿主代码，本地 profile 以 link 方式挂载，改一行正在运行的 DSH 宿主立刻受影响）；ZCode 线只写 `docs/` 与首页工程。

---

## 0. 30 秒总览

dsh-auto-memory 是 DSH（DeepSeek Harness）的**主动联想记忆插件**：把用户级记忆、项目笔记、每日日志等本地 Markdown 在每轮对话前自动注入模型上下文，提供检索工具、自动沉淀、技能固化与跨窗口接续。

它由「一个包、两个半边、一条可选引擎」组成：

| 组成 | 文件 | 运行在哪 | 一句话 |
| --- | --- | --- | --- |
| 宿主半边 | `lib/index.js`（14,426 行，2026-09-25 复测） | DSH 宿主 Node 进程内 | 记忆引擎本体：读写记忆文件、组装 `<memory_system>` 注入块、注册 19 个模型工具与 56 条 loopback 路由 |
| 浏览器半边 | `lib/client.js`（5,706 行） | DSH Web GUI（浏览器） | 手写 `__ModuleLoader__` 单文件 bundle，无构建链，注册 6 处界面插槽，经 loopback API 读宿主 |
| 可选语义引擎 | `python/worker_semantic_pre_v1.py` 等 | 宿主子进程（sidecar） | Python 高级档（bge-m3 int8）；损坏/缺席时逐级降级到内置 JS 语义档（e5-small q8），最终保底词法档 |

两条发布线：本仓是 **pre 开发线**（`package.json` `private:true`，不可发包），发版由 `tools/release.mjs` 把整棵树转换成**裸名正式版**写进 REL 发布线（`D:\dsh_debug\_publish_dsh-auto-memory`，本文只做文档层面描述，不访问其内容）。

宿主真正 import 的是 `lib/*-pre.js`（61 个模块）；同名的 `lib/*.js` 裸名文件是**陈旧副本，不生效**（唯一例外 `lib/ws-overview-rank.js`，它本来就没有 `-pre` 兄弟）。详见 §5。

---

## 1. 目录地图（本仓）

```
dsh-auto-memory/
├─ lib/                      # 活宿主代码（只读！本地 profile link 挂载）
│  ├─ index.js               # 宿主半边入口（Node ESM，零运行时依赖）
│  ├─ client.js              # 浏览器半边（手写 bundle，无构建链）
│  ├─ *-pre.js × 61          # 宿主侧功能模块（真正被 import 的一批）
│  └─ *.js（裸名，约 28 个）  # 陈旧副本孤岛，不生效（§5.3）
├─ python/                   # Python sidecar worker + 策略工件（只读）
├─ tests/smoke/              # 146 个回归套件（只读，不跑）
├─ tools/                    # run-smoke.mjs / release.mjs 等（只读）
├─ vendor/dsh-graph/         # 白板图工具 vendor 件（经 cordis.patch.yml 按开关接线）
├─ cordis.patch.yml          # 把插件行插进 DSH web profile 花名册的 bundle patch
├─ package.json              # pre 线身份：@a9i5k4/dsh-auto-memory，private:true，v3.0.0
└─ docs/internal/            # 内部文档（本文所在；ZCode 线可写区）
```

数据不在仓库里。运行时记忆数据按 §3.1 的布局写在 DSH_HOME 与各工作区下。

---

## 2. 三层结构

### 2.1 宿主半边：`lib/index.js`

Node ESM 单体（11,463 行），**零运行时依赖**（只用 node 内置模块；`@huggingface/transformers` 是 optionalDependencies，仅 JS 语义档用）。

对宿主框架（cordis）暴露的插件契约（`lib/index.js`）：

- `export const name = 'auto-memory-pre'`（`:146`）
- `export const inject = ['webServer', 'tools', 'systemPrompt', 'subagents', 'llm']`（`:149`）——声明挂载所需的宿主服务；框架据此把服务放进 `ctx` 再调 `apply`
- `export function apply(ctx, config)`（`:8947`）——挂载点：注册工具（`ctx.tools.register`，`:11449`）、路由（`ctx.webServer.register`，`:11451`）、提示词面（`:9833`/`:9958`/`:9968`），并用 `ctx.effect` 挂 disposer 链（`:11452`）

DSH 的插件 runner 对 `ctx` 是**白名单代理**：读取未在 `inject` 声明的属性会直接抛错（不是 undefined）。要探测可选服务必须用 `ctx.get('xxx')`（这一结论来自 DSH 线的其他插件实践，本仓代码里 `client.js:5456` 对 `ctx.remote` 的 try/catch 探测是同一纪律的体现）。

`apply` 内部组装一个 engine 对象，承载全部状态机：配置读写（`DSH_HOME/dsh-auto-memory.json`，原子写 + 损坏隔离走 `config-io-pre.js`，#82）、记忆文件缓存（`state.userText/notesText/logText`，`:4577` 处 refresh 落值）、三层检索臂、反思与沉淀钩子、接续/水位/白板等子系统。

### 2.2 浏览器半边：`lib/client.js`

手写单文件 bundle，**没有构建步骤**，文件头即形态（`lib/client.js:1-13`）：

```js
window.__ModuleLoader__.load({
  id: '@a9i5k4/dsh-auto-memory',
  factory: (require) => { ... exports.inject = [...]; exports.apply = apply; ... }
})
```

硬约束（交接文档 §1 原话级约束）：**不得给 client.js 加构建链**；`require` 只能拿宿主 seed 表提供的包——本仓实际只 `require('react')` 与 `require('react-dom')`（`client.js:16,23`，后者失败时降级为容器内渲染）。全文件不 import 任何本地模块（实测 grep，0 处本地 import）。

它向宿主声明 `exports.inject = ['slots', 'sessions', 'remote', 'remote.session']`（`client.js:5702`），拿到服务后注册 6 处界面插槽（§4.2）、轮询 `/api/dsh-auto-memory-pre/*` 拉状态（away 检测/待展示总结/通知/更新检查），全部数据来自宿主路由，自己不落盘（只写 localStorage 偏好）。

### 2.3 可选 Python 语义引擎（sidecar）与降级链

**三个引擎档**由配置键 `semanticEngineMode` 决定（`index.js:525-526`，默认 `'auto'`）：

| 档位 | 引擎 | 载体 |
| --- | --- | --- |
| `lexical` | 仅词法臂（c1，保底档） | 纯 JS，永远可用 |
| `js` / `auto` | 词法臂 + 内置 JS 语义臂（c2，资产就绪才启用） | `semantic-js-pre.js`，e5-small q8 权重，经 optional 依赖 `@huggingface/transformers` 在宿主进程内跑 |
| `python` | 词法臂 + Python sidecar 高级档（c3，bge-m3 int8） | 独立子进程 `python/worker_semantic_pre_v1.py` |

档位解析在 `index.js:9435-9441`：`lexical → c1`；`python → c3`；`auto/js → 资产就绪用 c2，否则 c1`。语义臂任何失败（sidecar 抛错/超时/空结果/档位不符）一律返回 null，调用方 fail-soft 回退词法（`index.js:9478-9481` 注释明文）。**词法档是保底，语义档是增强**——所以 Python 缺席不损失基础记忆能力，只损失语义召回质量。

**sidecar 生命周期**（`python-sidecar-client-pre.js`，352 行，头部即契约文档）：

- **lazy start**：只在显式启用的调用路径上 `ensureStarted()`（`:78-132`）；`enabled=false` 时零进程零 IO
- **spawn 纪律**：no-shell `spawn('python', [worker脚本, '--expect-epoch', epoch])`（`:101`），stdio 三管道，stdout 只进协议解析器
- **帧协议**：JSONL 单行帧，单行 256KiB 上限（超限 fatal）；坏 JSON/坏 envelope/错误 epoch/未知 requestId/重复 activation 全部**计账丢弃**，绝不注入上层（`:162-203`）
- **epoch 门**：每次进程启动生成 opaque epoch，入站帧 epoch 不匹配即丢弃，且 `epoch === null` 时一律丢弃（fail-closed，#72 修复，`:169-178`）
- **request 永不 reject**：结构化失败 `{ok:false, code, reason}`（timeout/crashed/unavailable/protocol/line-oversize/circuit-open/backpressure/disposed），Python 不可用不影响基础对话（`:5-12, :242-288`）
- **熔断器**：连续失败达阈值后开路冷却，health 探针半开恢复（`:67-76, :249-252`）
- **身份代际**：restart/dispose 后旧 epoch 作废、旧 in-flight 全部拒绝；写帧时闭包捕获当时的 child 引用，换代帧作废（#75 修复，`:221-240`）

**安装向导**：`python-setup-pre.js` 四步链路（detect → venv → deps → model，对应路由 `py-setup-*`），把高级档从「开发机可达」降到「爱好者可达」。

**降级留痕**：`degrade-pre.js`（R3，2026-09-18）是跨臂统一台账——fail-soft 本身是对的，缺陷在「降级不可见」；它区分「预期内分支（不记）」与「预期外失败（记）」，回答「哪条臂没在工作」。台账落盘 `DSH_HOME/memory/degrade-pre/`（实测该目录存在于 `~/.dsh/memory/` 下）。

---

## 3. 数据流：记忆文件 → 注入面 → 检出 → 检索

### 3.1 记忆文件布局（写入侧）

| 层 | 路径 | 写法 |
| --- | --- | --- |
| 用户级记忆 | `DSH_HOME/memory/MEMORY.md`（另 `CALENDAR.md`、`archived-user.md`、归档目录） | 条目化，容量配额 |
| 项目笔记 | `{workspace}/.dsh-memory/MEMORY.md` | 条目化，容量配额 |
| 每日日志 | `{workspace}/.dsh-memory/YYYY-MM-DD.md` | **append-only** |
| 白板 | PLAN.md（整体重写）与 handoff-*.md（append-only 账本） | 由 `memory_note` 维护 |
| 反思/索引/sidecar | `DSH_HOME/memory/` 下：`hub-pre/`、`index-pre/files/`、`semantic-pre/`、`evidence-pre/`、`degrade-pre/` 等 | 各子系统自管 |

`DSH_HOME` 的解析收敛在 `dsh-home-pre.js` 一处（#86-3：此前全仓 7 处 4 种回落口径；现顺序 = 显式 override → `DSH_HOME` env → `os.homedir()/.dsh` → `USERPROFILE||HOME/.dsh` → `'.dsh'`，永不返回空串）。

**写入原语**：工具/自动沉淀最终都走 `appendText`（`index.js:5849`）——先过内容卫生门（hygiene gate：拦乱码/复读/raw-json/base64），再分流：`memoryAnchorEnabled=true` 时经 `MemoryDocumentStore`（`memory-writer-pre.js`）做 **anchor 原子写入事务**，给每条记忆写入独占行锚点标记 `<!-- memory:mem_<32hex> -->`，并把记录的 `byteStart/byteEnd/lineStart/lineEnd/recordDigest` 落进 sidecar（`DSH_HOME/memory/index-pre/files/`）；anchor 关闭则回退纯文本追加（逐字节旧行为）。

### 3.2 注入面（读侧 · 三条 systemPrompt 面）

- **动态记忆快照** → `ctx.systemPrompt.context()`（`index.js:9833`）：渲染为 **user-role 追加在历史尾部**，内容变化才追加新快照、不变不重复注入（宿主 `project()` 去重）。这样**不击穿 DeepSeek 前缀缓存**——system prompt 前缀保持字节级稳定。快照由 `renderMemoryDynamic`（`index.js:5447`，注入调用点 `:9866`）产出：分项账本逐段 push（规则层 → 记忆地图 → Tier-0 目录 → 各证据层…，`index.js:5498` 起的注释块是该段的总设计书），最后交 `composeMemoryEnvelopePre`（`memory-envelope-pre.js`）做计量、限额与序列化（`:5642`），超额时先丢 low 优先级段、must 段永不丢。
- **静态纪律段** → `ctx.systemPrompt.section()`（`index.js:9958`）：不随状态变化的固定文本，是前缀缓存的锚。
- **M6 参考尾** → `ctx.systemPrompt.context()`（`index.js:9968`）：activation inbox 的参考条目尾面。

### 3.3 HTTP 路由与认证边界

- 插件**不自建 HTTP server**：56 条路由定义在 `const routes = [...]`（`index.js:13036–14329`，脚本计数 56 条），逐条 `ctx.webServer.register(route)`（`index.js:14409`）挂到**宿主的 web server** 上。路由路径前缀 `/api/dsh-auto-memory/`（`API` 表，`index.js:221` 起）。（2026-09-25 复测：`/api/dsh-auto-memory-pre/` 全仓出现 **0** 次。）
- **认证边界是 loopback-only**：每条路由 handler 第一行 `if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })`。`isLoopbackRequest`（`index.js:7969`）同时校验**远端地址**（127.0.0.1 / ::1 / ::ffff:127.0.0.1）与 **Host 头**（127.0.0.1 / localhost / [::1]），防 DNS rebinding。
- **403 vs 401**：插件层实测的拒绝码是 **403**（全仓 20+ 处，均为 `forbidden: loopback-only`）。交接文档写的「401 是预期」指的是**宿主 web 服务自身认证层**的行为（不带凭据访问 3080 会被宿主 401）——这在仓库内不可验证（宿主代码不在本仓），但两者不矛盾：401 = 宿主门，403 = 插件 loopback 门。从外面直接 curl 插件路由拿到 401/403 都**是预期行为，不是故障**。
- 浏览器半边（`client.js`）与宿主同源（页面就是宿主 3080 服务的），fetch 自家 loopback 路由天然通过。

### 3.4 「MEMORY.md 一份字节喂三条消费方」（★最关键的耦合约束）

同一份记忆文件（如项目笔记 `MEMORY.md`）的字节被**三个消费方**按**三种切法**消费：

| # | 消费方 | 切法 | 代码 |
| --- | --- | --- | --- |
| 1 | **整篇注入** | 全文（或按配额整理后）进 `<memory_system>` 快照 | `state.notesText/userText`（`index.js:4577`）→ 快照组装（`index.js:5470+`） |
| 2 | **L0 按锚点切条** | 正则按独占行锚点 `<!-- memory:mem_<32hex> -->` 切条，逐条抽 L0 摘要（标题→首句→截断三级降级） | `l0-extract-pre.js:34-35`（`MEM_ANCHOR_RE`）；检索时 `buildL0IndexPre`（`index.js:4065,6068,6302`） |
| 3 | **语义语料 recordDigest** | 按 sidecar 记录的 `[byteStart, byteEnd)` 字节切片取原文，`sha256` 即 recordDigest | 产出：`memory-anchor-pre.js:168`（`recordDigest: sha256Hex(b.subarray(byteStart, byteEnd))`）；校验：`m4-corpus-pre.js:107` |

**约束的含义**：消费方 2、3 都建立在「**文件的字节布局不漂移**」之上。sidecar 记录的是字节偏移与字节摘要，所以——

- **任何改变文件字节布局的操作都会使语义语料整体失配**：`m4-corpus-pre.js:96` 先做文件级 digest 校验（不等 → 整文件 `stale-source` 丢弃）；`:107` 再逐条校验 `sha256(body.subarray(byteStart, byteEnd)) !== recordDigest`（不等 → 该条 `record-stale` 丢弃）。丢弃是**静默的 fail-soft**（只进 `dropped` 清单），表现就是「召回突然变空」。
- 实际踩过的坑已固化在注释里：issue #66——BOM 使 `byteStart/byteEnd` 整体偏 3 字节 ⇒ 该文件全部记录恒 `record-stale`；修法是消费侧剥 BOM 后再切片（`m4-corpus-pre.js:97-102` 注释块）。
- **推论（给要动排版/写侧格式的你）**：改记忆文件的排版（换行风格、缩进、锚点格式、BOM）≠ 无害重构，它会同时打断 L0 切条与语义语料。正确路径只有两条：只经写入原语改内容（anchor 事务会同步重建 sidecar），或同时改三方消费逻辑并补字节等价性断言。相关既有守卫：`tests/smoke/` 的源码抽取型套件（用花括号配平切函数体）也依赖源码字节，注释里不能写裸 ASCII 双花括号（`index.js:5505-5507` 注释明文）。

### 3.5 检索链（`memory_recall`）

词法臂 + 语义臂（c1/c2/c3 见 §2.3）+ 时间臂（中文时间表达解析 `temporal-parse-pre.js`）+ 重要性加权（evidence 事件聚合 → `memory-importance-pre.js`），多臂结果在 rank-space 做 RRF 融合（`recall-fusion-pre.js`），L0 两档呈现（命中摘要 → 需要证据时按 id 下钻原文块，展开时带 `文件:行号 + digest` 溯源头，`index.js:6382-6405`）。白板 graph 档另有两个遍历工具（`memory_expand`/`memory_trace`，`boardMode=graph` 才注册，`index.js:10304-10313`）。

---

## 4. 插槽系统（浏览器半边的挂载面）

### 4.1 API 语义

`ctx.slots` 是宿主给浏览器插件的服务（宿主 seed 包 `@deepseek-ai/dsh-client-ui-slots` 提供，其实现不在本仓）。本仓可实证的用法模式（`client.js:5664-5688`）：

```js
slots.inject(name, () => slots.register({ name, id, order, label }, renderComponent))
```

- `inject(slotName, factory)` —— 订阅某个插槽面；`factory` 返回值应是一个 disposer。inject 本身也返回 disposer。
- `register(descriptor, render)` —— 在该插槽面上挂一个具体部件；descriptor 常用字段 `{ name, id, order, label }`（label 可为函数以支持动态语言），`render(props) => ReactNode`。
- **同一插槽面可多次注册，靠 `id` 区分**：本插件在 `shell.overlay` 上就注册了三个不同 id 的部件（面板/弹窗宿主/接续宿主）。

**「one handle one scope」**：交接文档提到这条宿主约束，但**该措辞在本仓库内检索不到**（lib/、docs/、tests/ 均无），宿主源码也不在仓内，无法给出权威定义。从代码可实证的等价机制是：每处注册各自持有 disposer、句柄不复用；语言切换等需要重挂的场景，插件是**先逐个 dispose 再整体重注册**（`refreshSurfaces()`，`client.js:5693-5698`），而不是原地改属性。请以「一个注册句柄只服务一个注册范围、重挂必须走 dispose 重注册」为操作纪律。

### 4.2 本插件的 6 处注册点（实测 `client.js:5664-5688`）

| # | 插槽面 | id | order | 承载组件 | 作用 |
| --- | --- | --- | --- | --- | --- |
| 1 | `sidebar.footer.action` | `auto-memory-pre` | 5 | SidebarButton | 侧栏左下角「记忆」入口按钮 |
| 2 | `shell.overlay` | `auto-memory-pre` | 5 | MemoryPanel | 440×560 浮层面板（12 页签） |
| 3 | `shell.overlay` | `auto-memory-pre-dialogs` | 6 | DialogHost | 全部弹窗（7 种 kind + 首启向导状态机） |
| 4 | `shell.overlay` | `auto-memory-pre-autocont` | 7 | AutoContinueHost | 自动接续宿主（水位触发的确认卡/倒计时） |
| 5 | `settings.section` | `auto-memory-pre` | 25 | SettingsPage | 原生设置页分区 |
| 6 | `conversation.view` | `auto-memory-pre-kanban` | 80 | KanbanView | 会话页顶栏整页白板看板（「双承载面」） |

注册失败整体 fail-soft（catch 后仅 console.warn，`client.js:5689-5691`）；宿主没有 slots 服务时直接放弃并告警（`client.js:5452-5453`）。

### 4.3 插槽目录规模：61 还是 58？（数字对账）

- 交接文档（2026-09-20）口径：**61 个插槽**。来源是 DSH 线做过的插槽调查，宿主侧结论，**本仓库内不可验证**（宿主包 `dsh-cordis-client-runner` 不在仓内，node_modules 里也没有）。
- 旧预研（`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md:186`，2026-09-10）口径：**约 58 个**，注明「从 dsh-cordis-client-runner 提取」。
- 本仓能验证的只有：插件**实际使用 5 个插槽面**（上表 6 处注册落在 5 个面上）。历史文档（09-10 时点）说「只用了 3 个」。
- **结论**：写「宿主插槽目录约 58–61 个」并注明两个口径与出处；如需精确清单，须到 DSH 线/宿主包重新提取，本仓无法复核。

---

## 5. 双线结构与文件名约定

### 5.1 pre 开发线（本仓）

- 身份（`package.json:2,4,5`）：`"name": "@a9i5k4/dsh-auto-memory"`、`"version": "3.0.0"`、**`"private": true`** —— **不可从本线直接 `npm publish`**。
- 本线的模块、工具名、存储目录、版本常量普遍带 `-pre` / `_pre_v1` / `_PRE_V1` 身份；这是「预览线」的命名契约，也被测试当守卫断言。
- 本地 profile 用 `link:` 挂载本仓 `lib/`，**本仓就是正在运行的那个插件**——这也是 `lib/` 只读的根本原因。

### 5.2 REL 发布线（不访问，仅流程描述）

`tools/release.mjs`（611 行）把 pre 线整树转换为裸名正式版写入 `D:\dsh_debug\_publish_dsh-auto-memory`（可用 `DSH_AUTO_MEMORY_REL` 覆盖）。流程（行号指 `tools/release.mjs`）：

1. **清空 REL 树**：除 `.git`/`.gitignore` 全部删除（`:37-40`）→ **坑 ①：REL 里未提交的东西会被这步直接销毁**，发版前必须确认 REL 干净。
2. 复制源树：`lib/`（排除 `*.bak`）、`tests/`、`python/`（排除 `__pycache__`/`bench`，bench 含 539MB 模型夹具）+ 根部清单文件（`:50-56`）。
3. **pre→正式反转**：~160 条精确替换表（工具名、路由段、存储目录名、npm 包名、localStorage 键、版本常量 `_pre_v1→_v1`…，`:59-219`）；随后 **lib 模块改名** `xxx-pre.js → xxx.js`（先改写全部 import 引用再重命名，`:221-285`）。完整性自检 fail-closed：DEV 树里每个 `*-pre.js` 都必须已登记，漏登记直接点名报错退出（`:286-304`）——npm 曾因此长期停在 2.5.3（`:199-204, :239-243` 注释实录）。
4. 重新生成正式 `package.json`（**剥掉 `private`**，`:391-413`）。
5. **版本回写开发树**：把版本号写回本仓 `package.json`（`:419-433`）→ **坑 ②：回写后 DEV 树出现未提交变更，需要另行补提交**。
6. 验证闸门（全部 fail-closed）：`node --check`（`:443-446`）；版本标识一致性（CHANGELOG 小节 + client 内更新说明字典 + 界面指纹行三处必须同步，`:452-468`）；BOM 扫描（`:497-503`）；残留扫描（整棵 staging 树不得再出现任何 `-pre`/`_pre_`/`_dev` 身份，`:510-539`）；凭据泄露闸门（`:547-592`）；python 运行时完整性（`:594-601`）。
7. **到此为止**：`git add/commit/push/tag` 与 `npm publish` 只打印提示、**必须由用户明确要求才执行**（`:605-611`）。

**坑 ③（T7-e 教训，`:73-80` 与 `:514-517` 注释）**：新增工具/身份必须**同时**登记进 transforms 表与 residual 残留表——漏任何一边都不报警，残留会静默随包发布（`memory_expand`/`memory_trace`/`memory_procedure` 实际踩过）。

### 5.3 文件名约定：`lib/*-pre.js` 是真身，`lib/*.js` 裸名是陈旧副本

**验证方法与结果**（2026-09-20 实测，脚本扫 `lib/index.js` 全部 52 处本地 import，其中 14 处为动态 `await import('./…')`）：

- index.js 的本地 import **全部**指向 `./xxx-pre.js`，唯一例外 `./ws-overview-rank.js`（`index.js:57`）——它**没有** `-pre` 兄弟，本身就是真身（模块内导出名带 `Pre` 后缀，如 `rankWorkspacesByMemoryRecencyPre`）。
- 仓库内 `lib/*-pre.js` 恰好 **61 个**（`ls lib/*-pre.js | wc -l`）。
- 与之同名的 28 个裸名 `lib/*.js`（如 `memory-writer.js`、`context-host.js`）构成一个**孤岛**：它们互相 import（30 条边），但**没有任何活代码 import 它们**——index.js、client.js、tools/、python/ 均无引用（脚本全仓扫证）。它们是旧命名时代的残留副本，改它们**不改变任何运行行为**。
- `client.js` 是浏览器 bundle，不 import 任何本地文件（0 处），与此无关。
- **判别口诀**：看一个 `lib/*.js` 是否生效，去 `lib/index.js` 的 import 里找它的 `-pre` 名；裸名生效当且仅当它没有 `-pre` 兄弟（当前唯一：`ws-overview-rank.js`）。
- **与发布流的互动**（解释这批副本为何存在且能自愈）：REL 构建会把 `-pre.js` 重命名成裸名（§5.2 第 3 步），`cpSync` 覆盖同名文件——所以正式包里的 `lib/*.js` 裸名文件是真身；而 pre 线上的裸名文件是改名时代的遗物，两线命名约定相反。**「PR merge 成功 ≠ 修复落地」这条纪律的结构性根源就在这**：外部 PR 常照裸名文件改，改的是死副本，必须人工移植到 `-pre` 真身。

### 5.4 61 个 `*-pre.js` 模块一句话职责表

（按字母序；职责摘自各文件头注释，均为只读提取）

| 模块 | 职责 |
| --- | --- |
| acceptance-pre.js | P5 分档运行验收清单（7 必需项 + 兼容门 + release-ready 门，纯数据结构） |
| activation-host-pre.js | M6-3 Surface Adapter：桥接 index.js 与激活收件箱纯核心 |
| activation-inbox-pre.js | M6-1 激活收件箱/参考尾纯核心（零 IO） |
| activation-inbox-state-pre.js | M6-2 每 runtime 激活收件箱内存状态机 |
| board-mode-pre.js | 白板线总开关解析（legacy/graph 双档） |
| config-io-pre.js | 配置原子写 + 损坏隔离（#82；损坏文件改名 `.corrupt-<ts>` 保留） |
| context-bridge-pre.js | M5-1 上下文/证据桥纯核心（成功证据捕获，零 IO） |
| context-host-pre.js | M5-3 Context Bridge 宿主接线（事件流 → 证据） |
| context-sink-python-pre.js | M7-0/M7-1 Python ContextSink 适配（消费 ContextPushEnvelope） |
| degrade-pre.js | R3 降级留痕层：跨臂统一台账，「哪条臂没在工作」可查询 |
| dsh-home-pre.js | DSH_HOME 唯一解析口径（#86-3；逐级回落、永不空串） |
| engine-identity-pre.js | P2 引擎身份（模型/权重指纹/tokenizer/维度…宽身份） |
| engine-switch-pre.js | P2 引擎切换状态机（切档隔离与进度条） |
| episodic-store-pre.js | M8-1 情节存储纯核心（纯内存状态机，IO 可注入） |
| evidence-agg-pre.js | M8-2b evidence 事件扫描聚合 → importance 输入契约 |
| evidence-store-pre.js | M5-2 证据存储（append-only JSONL 按日分片 + 隐私投影） |
| fact-store-pre.js | M8-0 事实存储纯核心（Semantic/Profile 层） |
| fs-retry-pre.js | 有界 rename 重试（#48；Windows 瞬时句柄争用） |
| handoff-anchor-pre.js | P6 交接账本权重化截断纯核心（替代位置式 slice(0,8000)） |
| index-sync-pre.js | M7-1 授权 index_sync 构造执行（JS 是唯一语料授权者） |
| intent-clean-pre.js | M8 采集侧 intent 清洗（本轮末条 user 文本净化） |
| intent-clean-safe-pre.js | R5 运行时信封剥离器（结构判据版，保护代码块/字面示例） |
| l0-extract-pre.js | L0 抽取纯核心：锚点切条 + 三级降级摘要 + 分层归属（C1） |
| l0-index-pre.js | L0 向量索引（只存 URI+向量+元数据，不含原文） |
| l0-index-sync-pre.js | C3 接线：L0 索引增量同步（按层分索引，5 分钟节流） |
| ledger-criteria-pre.js | WB-GRAPH P1 判据校验中间件核心（纯函数、fail closed） |
| m4-corpus-pre.js | M4-2 Corpus Adapter：SourceCatalog/sidecar 校验/CorpusRegistry |
| m7-index-sync-host-pre.js | M7-8 Host 索引同步编排器（修 live blocker） |
| m7-wire-pre.js | M7-0 线缆协议纯核心（帧构造/校验/预算，零 IO） |
| memory-anchor-pre.js | M3b-1 Anchor/Sidecar/Dry-run Planner（锚点解析与记录摘要） |
| memory-envelope-pre.js | T0-3 记忆注入信封：分项账本 + 优先级限额 + 序列化 |
| memory-hub-pre.js | M8-3 记忆中枢编排器（三层记忆串成一条链） |
| memory-importance-pre.js | M8-2 evidence → importance 纯核心 |
| memory-index-pre.js | M3a 只读记忆文件索引（按标题切块，不改文件） |
| memory-mutation-pre.js | P0 记忆写入保护门（共同提交与保护入口，丢卡/用户区/重复 id） |
| memory-writer-pre.js | M3b-2 原子写入基础设施（MemoryDocumentStore/anchor 事务） |
| note-status-apply-pre.js | G3 结论层状态·条目级应用（把 status 落到指定条目末尾，不写盘） |
| note-status-pre.js | G3 结论层状态纯函数核心（形态候选，未接线） |
| procedure-observation-pre.js | procedure 观察态标记（已验证/激活/用户自著/废弃史的语义保持） |
| procedure-store-pre.js | M8-2 程序性存储纯核心（技能/流程记忆） |
| python-setup-pre.js | M7.6 Python 一键向导宿主半（detect→venv→deps→model 四步链路） |
| python-sidecar-client-pre.js | M7-0 JS SidecarClient（lazy start/epoch 门/熔断/结构化失败） |
| recall-fusion-pre.js | P3 rank-space RRF 融合（替代 minmax 加权） |
| rerank-host-pre.js | P4 精排多级档位 + 有界异步窗口（纯状态机，模型调用注入） |
| rules-edit-pre.js | R7 用户级硬性约束条目级增删改（纯逻辑，IO 走 writeFull 事务） |
| rules-layer-pre.js | P6A 规则层抽取与渲染（规则类与参考类分开措辞） |
| semantic-decide-pre.js | JS 端激活判定核（与 Python 判定逐字段对齐，工件 fail closed） |
| semantic-js-pre.js | C2 内置语义引擎宿主 + 资产下载器（e5-small q8） |
| shadow-host-pre.js | M4-3 影子检索宿主接线 |
| shadow-retrieval-pre.js | M4-1 影子检索纯核心（只读、零 IO） |
| skill-export-host-pre.js | M9-3 Skill 导出宿主侧（写盘 + 项目标注解析） |
| skill-export-pre.js | M9-3 Skill 导出渲染（procedure → SKILL.md 目录束） |
| state-commit-pre.js | P1 统一状态提交契约（读→改→写原子边界） |
| storage-manage-pre.js | M10 存储管理组装（三个既有接线点装起来） |
| subagent-gc-pre.js | 子代理持久化会话扫描与回收（zstd 帧解码） |
| temporal-parse-pre.js | 中文时间表达解析（「上周/三天前」→ 时间窗） |
| tier-layer-inject-pre.js | C5 三层注入装配（Tier-0 常驻 + 闸门下探 + 配额 + 降级标注） |
| tier0-catalog-pre.js | C4 Tier-0 常驻目录生成器（每条 1 行，≤800 token） |
| water-window-pre.js | 水位/窗口解析（官方 tokenMeter 同源，多级来源回落） |
| wb-contract-pre.js | 白板格式适配器（判据/保护段/marker，白板线唯一格式真源） |
| wb-sidecar-pre.js | WB-GRAPH P2 结构化 sidecar + 看板派生（新版看板数据面） |

另有 `ws-overview-rank.js`（裸名、真身）：工作区按记忆新近度排序，供概览页用（`index.js:57`）。

---

## 6. 测试体系

### 6.1 smoke 套件

- `tests/smoke/*.mjs` 实测 **146 个**（`ls tests/smoke/*.mjs | wc -l`），交接口径 146 一致；旧预研的 69 是 2026-09-10 口径，早已翻倍。
- 运行器 `tools/run-smoke.mjs`（零第三方依赖）：

```
node tools/run-smoke.mjs                    # 全量；默认 --jobs=4 并行、单套件 60s 墙钟超时
node tools/run-smoke.mjs --filter=handoff   # 只跑文件名含该子串的套件
node tools/run-smoke.mjs --jobs=1           # 回退串行（排查偶发 TIMEOUT 时用）
node tools/run-smoke.mjs --timeout=0        # 关超时（不建议）
```

- 退出码：任何 FAIL/TIMEOUT → 非 0；全绿 → 0。
- 运行器存在的理由（文件头长注释，值得读）：单个套件曾忙等 29 分钟且永不退出——插件装了 `uncaughtException` 监听抑制致命退出 + 定时器不收尾 + 断管道 EPIPE 自激循环。因此运行器**先杀子进程、再收管道**，每套件独立计时，绝不整体挂住。
- 并行度说明（`--jobs` 默认 4，2026-09-20 T7-f 用户裁定）：4 并发实测全绿且 3.4× 提速；残余风险是墙钟超时在重负载下可能偶发 TIMEOUT（单独跑就过）——先降 `--jobs` 复验再下结论。
- **本任务约束：不要跑 tests**（ZCode 线任务书明令；且 `lib/` 是活宿主，跑全套有副作用面）。

### 6.2 已知缺口：前端行为断言极薄

146 个套件绝大多数断言的是宿主半边（`lib/index.js` 及 `-pre` 模块）行为或**源码文本**。`client.js`（5,700 行的整个界面）的行为级断言只有 **4 个套件**（实测：`smoke-test-startup-dispatch-pre` / `smoke-test-away-popup-fix-pre` / `smoke-test-autocont-host-pre` / `smoke-test-continue-chain-pre`，都是「花括号配平抽函数体 + `new Function` 重建执行」的方式）；另有 18 个套件仅对 client.js 做**源码文本扫描**（路径表一致性锁、字符串存在性等）。交接文档写「约 3 个」，实测 4 个，量级一致。含义：**改 client.js 的界面行为基本没有回归网**，靠亮/暗主题截图与人工走查兜底；这也正是 L1 渲染解耦缺陷（`smoke-test-l1-render-decouple-pre.mjs` 头注释实录的「结构性假绿」）能存活到用户报障的原因。

### 6.3 在这仓库干活必须知道的规矩

工程纪律（交接 §3.3 三条 + 本仓 §5.2 惯例）：

1. **fail-soft 必须留痕**——可以降级，不许静默。新代码的 catch 分支要有可观察信号（diag 行 / degrade 台账 / debugView 投影）；先分清「预期内分支（不记）」与「预期外失败（必记）」，参照 `degrade-pre.js` 头注释的判据。
2. **变异测试必须真红**——验证守卫时把条件改成常量，守卫必须真的失败。JS 三元被变异后**仍会渲染假分支、字符串还在文件里** ⇒ 断言要先定位分支（花括号配平取函数体）再断言，不能只查「字符串存在」。
3. **PR merge 成功 ≠ 修复落地**——外部 PR 常改裸名陈旧副本（§5.3 的孤岛），必须人工移植到 `-pre` 真身并实跑核验；上游 issue 的根因描述也可能整体过时（多基于 `main@d816497 v3.0.0` 之前），处理前先实跑。
4. **文件 CRLF、无 BOM**——本仓源文件全 CRLF；改动后校验 LF-only 计数必须为 0。发布闸门会扫 BOM（`release.mjs:497-503`）。
5. **别用固定字符窗口做源码断言**——曾因 `SRC.slice(idx, idx+900)` 越界进相邻函数误判；要花括号配平精确取函数体。同理：新写的 `index.js` 注释里不要出现裸 ASCII 双花括号（会破坏抽取型测试的配平，`index.js:5505-5507` 明文）。
6. **改动文件先备份后改**——本仓惯例是 `<file>.bak-<date>-<tag>` 同目录留存（lib/ 下大量 .bak 即此惯例的痕迹）。
7. **绝不停止/重启 3080 端口的 DSH web 宿主；绝不无差别杀 node 进程**——宿主关了用户会话思维链直接断；DSH harness 与插件宿主都跑在 node 上，`Get-Process node | Stop-Process` 会连带杀死正在运行的会话（2026-09-14 实际发生过）。

---

## 7. 「我要改 X 该找哪」速查表

| 想做的事 | 去哪 | 注意 |
| --- | --- | --- |
| 加/改模型工具 | `lib/index.js` 的 `const tools = [...]`（`:9981` 起）；graph 档条件工具在 `:10310` 附近 | 新工具名要**同时**登记 `release.mjs` transforms 表与 residual 表（§5.2 坑 ③）；每加一个，前端工具说明文案在 `client.js` |
| 加/改 HTTP 路由 | `lib/index.js` routes 数组（`:10320-11384`）+ `API` 表（`:161`） | 每条 handler 第一行必须是 loopback 403 门；`client.js` 的 `API` 镜像表与其保持一致（路径表一致性锁） |
| 加/改设置键 | `DEFAULT_CONFIG`（`index.js:328-715`，2026-09-25 实测 115 键）+ `client.js` 设置页分组 | 改默认值=老用户行为突变，慎用；幽灵键先 grep 宿主侧引用数（先例：`pythonGpu` 零引用被删） |
| 改注入文案/预算 | `renderMemoryDynamic`（`index.js:5447`）+ `memory-envelope-pre.js` + `tier-layer-inject-pre.js` | 保持前缀缓存友好性：内容不变则字节不变；`promptLayerOverrides` 可整层覆盖 |
| 改记忆写入格式 | 只经写入原语（`appendText` → anchor 事务）；**禁止手改排版** | 字节布局一动，L0 切条与语义语料同时失配（§3.4） |
| 改面板 UI | `lib/client.js`（只读红线：本线不许改，列「待 DSH 线处理」清单） | 无构建链、依赖仅宿主 seed 表（react/react-dom）；令牌体系见预研 §2.6 |
| 加新界面落点 | `client.js` 的 `registerSurfaces()`（`:5662-5698`） | 插槽面来自宿主目录（约 58–61 个，§4.3）；重挂必须 dispose 后重注册 |
| 换/加语义引擎 | `semanticEngineMode` 档位解析（`index.js:9435-9441`）+ `semantic-js-pre.js` / `python-sidecar-client-pre.js` | 词法臂是保底，语义臂失败必须 fail-soft 回退并留痕 |
| 发版 | `node tools/release.mjs <版本> --dry-run` 先行，真跑由 DSH 线 | 发版前 CHANGELOG 三处同步（§5.2 第 6 步）；publish 必须用户明确要求 |
| 修配置读写 | `config-io-pre.js`（原子写/损坏隔离） | 读侧损坏隔离：`.corrupt-<ts>` 改名保留，不静默重置 |

---

## 8. 术语表

| 术语 | 含义 |
| --- | --- |
| pre 线 / REL 线 | 本仓预览开发线（`-pre` 身份、private）/ 发布线（裸名正式包，`release.mjs` 产出） |
| 宿主 / harness | DSH 本体：Node 侧框架（cordis 插件系统）+ Web GUI（React，3080 端口） |
| `__ModuleLoader__` | 宿主浏览器端插件加载器；client.js 是它消费的手写 bundle |
| 插槽（slot） | 宿主 GUI 暴露的界面挂载点；`inject` 订阅面、`register` 挂部件 |
| 锚点（anchor） | 写入原语给每条记忆加的独占行标记 `<!-- memory:mem_<32hex> -->`，是切条/寻址的基础 |
| sidecar | 记录字节偏移与摘要的伴生索引（`DSH_HOME/memory/index-pre/files/`）；也泛指 Python worker 子进程（语境区分） |
| L0 | 每条记忆的廉价摘要（≤~140 字符，6.9:1 压缩），检索的第一收敛层 |
| Tier-0/1/2 | 三层检索契约：常驻目录（≤800 token）/ 摘要候选层 / 原文证据块（`THREE-LAYER-CONTRACT.md`） |
| c1/c2/c3 | 检索语义臂档位内部名：词法 / 内置 JS 语义（e5-small q8）/ Python sidecar 语义（bge-m3 int8）（`index.js:9435-9441`）。注意与 `THREE-LAYER-CONTRACT.md` 的 C1–C7 施工项编号无关 |
| 水位（water level） | 上下文占用/模型窗口比值；阈值 0.75 触发接续建议/自动接续 |
| 接续（auto-continue/handoff） | 窗口将满时把任务状态写成交接账本、开新会话续做的机制 |
| 白板（whiteboard） | PLAN.md（稳定事实）+ handoff-*.md（动态账本）；graph 档另有结构化 sidecar 与看板 |
| 反思（reflect） | 每日「昨天有日志未生成反思」检测 → 注入反思请求 → `memory_reflect` 落盘 |
| 沉淀（consolidate） | turn-stopping 时自动评估本轮内容、写日志/升格笔记 |
| shadow / canary / active | 唤起注入模式三档：影子（只记不注）→ 金丝雀 → 主动 |
| 分项账本（envelope） | 注入快照的逐段计量/限额/序列化层（`memory-envelope-pre.js`） |
| 降级台账（degrade ledger） | 跨检索臂的「哪条臂失效」可查询状态（`degrade-pre.js`） |

---

## 9. 与交接口径的数字对账（实测 vs 交接）

| 项 | 交接口径 | 本文实测 | 结论 |
| --- | --- | --- | --- |
| `lib/index.js` 行数 | 11,460 | **11,463** | 微漂移，交接后文件又有改动，以实测为准 |
| `lib/client.js` 行数 | 5,701 | **5,706** | 同上 |
| smoke 套件数 | 146 | **146** | 一致 |
| HTTP 路由数 | 49 | **49**（routes 数组脚本计数） | 一致；预研的 46 是 09-10 旧口径 |
| 模型工具数 | 17 | **15 基础 + 2 条件（boardMode=graph）= 17** | 一致；注意 graph 关闭时只有 15 |
| 插槽注册点 | 6 处 | **6 处**（落在 5 个插槽面） | 一致 |
| 插槽目录规模 | 61 | 仓库内**不可验证**；预研口径约 58 | 写「约 58–61」并标注来源差异 |
| 设置键数 | 85（8 组） | **`DEFAULT_CONFIG` 115 键**（`index.js:328-715`，2026-09-25 实测） | **85 是 2026-09-10 快照、98 是 2026-09-22 快照**；以 115 为当前代码事实，UI 口径以 FEATURE-INVENTORY 复核为准 |
| 路由拒绝码 | 「401 是预期」 | 插件层是 **403 loopback-only**（20+ 处） | 不矛盾：401=宿主自身认证层（仓内不可验证），403=插件 loopback 门；两者都是预期，不是故障 |
| 前端行为断言套件 | 约 3 个 | **4 个**（startup-dispatch / away-popup-fix / autocont-host / continue-chain） | 量级一致，以 4 为准 |
| `-pre` 模块数 | （未给） | **61** | 本文新证；与「61 插槽」是无关巧合 |

> 本文行号均为 2026-09-20 实测；`lib/` 活代码继续演进后行号必然漂移，引用前用 `grep -n` 复核。
