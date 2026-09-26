# TASK-A · 三个新模块（纯新增文件，零重叠）

> 执行者：teammate。**不碰任何既有文件**。**禁止创建下级子代理。**

## 硬约束（违反即失败）
1. **行尾必须是 CRLF**（本仓 lib/*.js 是 PURE CRLF）。写完用 `node --check` 验证。
2. **模块语法**：本仓零构建、ESM。用 `import { createHash } from 'node:crypto'` + `export function`。
3. **绝不修改**：lib/index.js、lib/client.js、lib/procedure-store.js、package.json、任何 tests/。
4. **不新增任何 npm 依赖**。
5. 每个文件写完后跑 `node --check <file>`，必须 exit 0。

## 文件 1：lib/team-identity.js

职责：把宿主登录态映射成团队成员（actor）。**不自建账号体系**。

要求：
- `export function createTeamIdentity({ ctx, engine, diag })`
- 返回对象含 `currentMember()`：读 `ctx.deepauthAccount` 的 `state()`；未登录/读不到 → **返回 null，绝不抛**
- 返回对象含 `describe()`：返回 `{ ok, memberId, role, source }`
- 全程 try/catch；任何异常都降级为 null + 记 diag（diag 可能未传，要容错）
- 稳定 id 用 `user.id || user.sub || user.email`，**不用显示名**（显示名可改）

参考实现（照抄结构，可精简）：`docs/teamwork-impl/03-集成架构与新增模块.md` 的 `2.1 team-identity.js`

## 文件 2：lib/team-auth.js

职责：出站鉴权 fetch 包装。

要求：
- `export function createTeamFetch({ ctx, identity, diag })`
- 返回 `async function teamFetch(url, opts)`
- **四种情形均返回 `{ ok:false, reason }`，零抛出**：未配置 / 未登录 / 超时 / 非 2xx
- 超时用 AbortController，默认 10s，可传 opts.timeoutMs
- 非 2xx 时返回 `{ ok:false, reason:'http-'+status }`

参考：`docs/teamwork-impl/01-门控与守卫全量清单.md` 的 `7.1 createTeamFetch`

## 文件 3：lib/skin-assets.js

职责：皮肤资源清单（**纯数据 + 一个取值函数**）。

要求：
- `export const SKIN_ASSETS = Object.freeze({...})` 含**恰好 6 个 key**（见下）
- `export function assetOf(key)`：未就绪返回 `{ placeholder:true, key, alt }`，**不抛、不留白**
- **代码里不得出现任何图片路径字面量以外的资源引用方式**；`file` 初始为 `''`

6 个 key（与 `docs/teamwork-impl/12-皮肤资源插口清单.md` 完全一致）：
| key | alt | size |
|---|---|---|
| hero.welcome | 欢迎主视觉 | [1600,1000] |
| empty.library | 记忆库空状态 | [800,600] |
| empty.timeline | 时间线空状态 | [800,600] |
| empty.recall | 召回审查空状态 | [800,600] |
| bg.mindmap | 思维导图背景 | [2000,1400] |
| illust.sync | 同步示意 | [600,400] |

每个 value 形状：`{ file:'', alt:'…', size:[w,h], status:'pending' }`

## 交付
1. 三个文件写好在 `D:\dsh-auto-memory\lib\`
2. 每个都过 `node --check`
3. 回报：三个文件的 字节数 + `node --check` 结果 + 遇到的不确定点

## 完成后必须留痕
在本文件末尾追加一节 `## TASK-A 完成回报`，写：文件 / 字节 / node --check 结果 / 未决问题。
## TASK-A 完成回报

**执行者**:teammate `wave0-modules` —— 未创建任何下级子代理/工作流;未修改任何既有文件。

### 交付物(3 个全新文件,PURE CRLF / `node --check` exit 0)

| 文件 | 字节 | CRLF | bare LF | node --check |
|---|---:|---:|---:|---|
| `lib/team-identity.js` | **7130** | 180 | 0 | **exit 0** |
| `lib/team-auth.js` | **11200** | 267 | 0 | **exit 0** |
| `lib/skin-assets.js` | **3225** | 51 | 0 | **exit 0** |

git 证据:`git status --porcelain` 三条均为 `??`(纯新增);`lib/index.js`、`lib/client.js`、`lib/procedure-store.js`、`package.json`、`tests/` 未被本任务改动;仓库内无临时脚本残留。

### 行为自检(77 断言 / 0 失败,退出码 0)

以 `node` 直接 import 三个模块跑一次性脚本(临时脚本落在仓库外,跑完即删):

- **team-identity(26 条)**:无依赖 / `state()` 抛错 / 宿主 getter 抛错 / `state()` 返回 null / 非对象 seam → 一律 `currentMember() === null`,且 `describe()` 恒为 `{ok, memberId, role, source}` 四键;`user.id → sub → email` 回退链正确;**仅显示名可用时返回 null**(不用显示名当 id);`signedIn:false` → null,未给该字段但有 user → 成员;`ctx.deepseekAccount` 兼容名可用;`currentActor()` 带 teamId/device/ws;`ctx.on` 抛错时 `install()` 不抛。
- **team-auth(26 条)**:未配置 / 未登录 / 超时 / 非 2xx 四情形全部 `{ok:false, reason}` 零抛出,reason 分别为 `not-configured` / `not-authenticated` / `timeout` / `http-500`;`timeoutMs` 可覆盖(实测 40ms 触发);调用方 `signal` 联动 → `aborted`;三件套头正确(`Bearer <token>` / `x-dam-team` / `x-dam-client: dsh-auto-memory/<version>`);token 来源顺序 identity seam → `ctx.credentials` → `ctx.authorization` → 配置;`fetch` 缺失 → `fetch-unavailable`;204 / 非 JSON 体 / 读体抛错 → 仍 `ok:true` 且不抛。
- **skin-assets(25 条)**:恰好 6 个 key,key/alt/size 与 `12-皮肤资源插口清单.md` §2 表逐条一致;`file=''` / `status='pending'`;`Object.freeze` 生效;`assetOf` 对已知未就绪 key、未知 key、`undefined`/`null`/数字 key 全部返回确定性占位 `{placeholder:true,...}`,不抛不留白。

### 自检发现并已修复的两处缺陷(附证据)

1. **`team-auth.js` 的超时在「唯一待决句柄」场景失效**:初版在参考实现之外多加了 `timer.unref()`,导致事件循环在计时器到期前退出(自检表现为 `Warning: Detected unsettled top-level await` + `EXIT=13`)。已删除 `unref`,并写明「计时器不能 unref,泄漏风险由 `finally` 的 `clearTimeout` 兜住」。
2. **`team-identity.js` 的 diag 在「宿主 seam 抛错」时丢失**:初版在内层 `try/catch` 静默吞错,而规格要求「任何异常都降级为 null **+ 记 diag**」。已改为内层不吞错、由 `currentMember` 的统一降级路径记 diag;复测 `diag: ["team-identity: proxy-dead"]` 已记录。

### 未决 / 不确定点(需 Lead 裁决)

1. **账号 seam 名冲突**:TASK-A 写 `ctx.deepauthAccount`,而 `03-集成架构与新增模块.md` §2.1 写 `ctx.deepseekAccount`。本实现按规格以 `deepauthAccount` 为权威名、`deepseekAccount` 为兼容回退;`describe().source` 会如实回报实际命中的 seam 名(`deepauthAccount` / `deepseekAccount` / `none`)。**若宿主真名是第三个名字,接线时改常量 `SOURCE_PRIMARY` 一行即可。**
2. **`ctx.sessions` 未做二次核验**:`01-门控与守卫全量清单.md` 留有「拿真 client 跑一次 `ctx.sessions`」的待办,但本任务禁读宿主包、也无法在插件侧真机执行,故模块内**任何路径都未调用 `ctx.sessions`**(无此依赖)。
3. **`lib/*.js` 并非 PURE CRLF**:实测 72 个既有文件中约半数为纯 LF、4 个为 MIXED(`lib/index.js` / `client.js` 确为纯 CRLF)。本任务按 TASK-A 硬约束,**三个新文件一律纯 CRLF**(bare LF = 0),与两个单写者入口的 EOL 性质一致;若后续要并入纯 LF 模块组,请先裁定。
4. **未纳入的工程接缝**(超出三文件范围):`assetOf()` 的 `url` 返回 `SKIN_ASSETS[key].file` 原值 —— 是相对路径还是绝对路径、最终由前端以何为基准拼接?建议在接线任务里钉死。
5. **并发写观察(非本任务改动)**:核查期间 `lib/index.js` mtime 17:50:13、**963,818 B**(白板记载 962,241 B),`lib/team-project-map.js` 17:48:48 新增 —— 均属**其他会话线/teammate**,不是本任务产物;本任务只新建 3 个文件。

### 按边界未做

未改 `lib/index.js`(故 `createTeamIdentity` / `createTeamFetch` 目前没有任何调用点)、未改 `package.json`、未加 tests、未跑仓库全量回归(会与其他线的并发写冲突)。插件记忆(日志/账本/白板)由 Lead 统一落盘,避免多线并发写同一记忆文件。
