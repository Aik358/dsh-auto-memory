# 假绿套件审计（FAKE-GREEN-AUDIT）

> 2026-11-05 · 依据 #536 假绿防线首轮全量回归抓出的 6 个「EXIT=0 但 stderr 有致命标记」套件
> 逐个定性（A 产品缺陷 / B 夹具与环境 / C 判据过期）+ 处置 + 变异证明
> 未 commit、未改版本号、未跑 release

## 0 · 结论速览

| # | 套件 | 定性 | 一句话根因 | 修后单跑 |
|---|---|---|---|---|
| 1 | `isolation` | **C 判据过期** | 断言「同一 agent 连续两帧逐字节相同」，而注入面**按设计分档**（首帧完整 / 次帧精简） | PASS（stderr 0B） |
| 2 | `la-audit-fixes` | **非缺陷（防线假阳性）** | stderr 来自套件**自己设计的负路径**（摘掉 uncaughtException 监听器做变异验证） | 56 PASS / 0 FAIL（豁免生效） |
| 3 | `reflect` | **C 判据过期**（两个独立成因） | ①同 turn 第 3 帧是精简版、精简版不含反思段；②泄漏断言扫全部历史残留 ⇒ 七周前遗留目录让它恒红 | PASS（stderr 0B） |
| 4 | `task33-percept-production` | **C 判据过期** | `memory_log` 不传 `eventId` 时 #543 新增**话题归属**（匹配不到即新建事件）⇒ 不再挂到旧事件 | 50 PASS / 0 FAIL（stderr 0B） |
| 5 | `v4-u6-memory-upgrade` | **B 夹具缺依赖 + C 判据过期** | 夹具 `get:()=>undefined` 让 `subagents-unavailable` 直接短路；另超时/后台链形态已演进 | 37 PASS / 0 FAIL（stderr 0B） |
| 6 | `consolidate-isolation` | **B 夹具缺依赖** | 未提供工作台 ⇒ 子代理被 E2 归属门判 `owner=orphan` 拒绝，一次都不 spawn | PASS（stderr 0B） |

**统计：0 个真产品缺陷；2 个夹具/环境（B）；3 个判据过期（C）；1 个防线假阳性（la-audit-fixes，本质是 B 的变体：夹具主动造异常）**

**结论：6 个套件全部不影响 alpha.6 发布面。** 没有任何一条指向产品行为错误。

---

## 1 · `isolation`

**现象**：`A unchanged context snapshot is not stable`（stderr 164B），EXIT=0。

**异常位置**：`smoke-test-isolation.mjs:64`
```js
if (provider({ agent: agentA }) !== textA) throw new Error('A unchanged context snapshot is not stable')
```

**为什么会抛**：`provider` 是 `contexts[0].text`，**是函数、每次调用重新渲染**（实测 `typeof === 'function'`）。
注入面按设计分档（`finalizePre` + `snapshotMinGapRounds`，默认 20）：
同一 agent 同一 turn 的**第 1 帧 = 完整版**、**第 2 帧起 = 精简版**。
实测：A1 = 2,669 字符（完整）/ A2 = 2,080 字符（精简）⇒ **恒不相等**。

**定性：C（判据过期）**。断言假设「连续两帧必须逐字节相同」，与分档设计直接冲突。
本套件真正的语义是「A/B **隔离**」（A 的快照不掺 B 的工作区与日志），不是「跨档位逐字节相等」。

**处置**：改为**同档位内幂等**——两帧档位相同则必须相等；档位不同是预期，不判不稳定。
无论哪一档，工作区标识必须保持正确。

**变异证明**：把 `runtimeFor` 改为恒返回 default runtime（破坏 agent 隔离）⇒ 报
`A prompt workspace missing`（:60）**必红**；还原后 26/0 且 `lib/index.js` sha 一致（`617cd992`）。

---

## 2 · `la-audit-fixes`

**现象**：`spawn python ENOENT`（stderr 147B），EXIT=0。

**异常位置**：stderr 指向 `smoke-test-la-audit-fixes.mjs:150`，但那行是**夹具自造的字符串**：
```js
const err = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' })
```
**根本没有 spawn python**（`which python` / `python3` 都无输出，但与本套件无关）。

**为什么会抛**：套件 [B] 组是**变异负路径**——它主动把产线的 `proc.on('error', noteChildError)` 删掉后重跑探测，
断言 `uncaught.length > 0`（证明「没有监听器时异常无人接管」）。此时插件生产处理器
（`lib/index.js:19772`，生产容错，不能摘）把同一条异常照常写进 stderr ⇒ **防线判它假绿**。
实测该套件本身是 **56 PASS / 0 FAIL**。

**定性：非缺陷（防线假阳性）**。这是 #536 防线的**判据本身不区分「设计内的异常」与「真故障」**。

**处置**：`tools/run-smoke.mjs` 新增 **显式豁免白名单** `FATAL_MARKER_EXEMPT`（opt-in，不是 opt-out）：
```js
['smoke-test-la-audit-fixes.mjs', '负路径故意摘掉 uncaughtException 监听器，断言「异常无人接管」是判据本身']
```
命中时**仍按套件自身退出码判定**并在 verbose 留痕，套件内 56 条断言一条不放松。

**区分力证明**：临时清空该豁免条目 ⇒ `run-smoke` 重新判 **FAIL**；恢复 ⇒ **PASS**。

---

## 3 · `reflect`

**现象**：`latest reflection not injected`（stderr 150B），EXIT=0。

**异常位置**：`smoke-test-reflect.mjs:78`
```js
if (!text3.includes('最近反思 ' + y)) throw new Error('latest reflection not injected')
```

**为什么会抛（两个独立成因，都属 C）**：

**成因① 帧档位**。`text3 = provider({agent})` 是对**同一 agent 同 turn** 的第 3 次取帧。
实测三帧：首帧 2,731 字符**含**反思请求 → 其后 2,067 字符为**精简版**。
而精简版按 2026-10-01 用户裁定「规则段/Tier-0/白板账本/反思全部移出」，
`renderSlimSnapshotPre` 函数体内 `reflection|反思` 命中数 = **0**（实测）。
**反思注入通路本身完好**——决定性证据：换一个**新 session 的 agent** ⇒ 同一 `provider` 立刻返回
2,766 字符**完整帧且含 `最近反思`**。

**成因② 泄漏断言恒红**（修完成因①后才暴露，因为它此前从未被执行到）。
`smoke-test-reflect.mjs:134` 扫描 `~/.dsh/memory/workspaces` 下所有 `dam-test-` 目录并「命中即抛」。
本机真实存在 `--C--Users-JHZ~1-AppData-Local-Temp-dam-test-ISBPN6--`，**建于 2026-09-23 15:59**（七周前旧版套件遗留）
⇒ 该断言从那天起就恒定失败，只是被更早的抛出挡住了。

**定性：C（判据过期，两处）**。

**处置**：
- 成因①：改为用**独立 session 的 agent** 取**完整帧**再断言 —— 这才是生产里「下一轮/重启后」真实发生的路径，
  比原来更贴语义，且仍有区分力。
- 成因②：泄漏断言改为**运行前后快照对比（只比 delta）**。历史残留不再造成恒红，真出现**新增**泄漏立刻红。

**变异证明**：把 `lib/index.js:11974` 的 `if (s.latestReflection)` 改为 `if (false && …)`
（禁用反思注入）⇒ 报 `latest reflection not injected` **必红**；还原后 PASS 且 sha 一致。

---

## 4 · `task33-percept-production`

**现象**：`TypeError: Cannot read properties of undefined (reading 'idemKey')`（stderr 198B），EXIT=0。

**异常位置**：`smoke-test-task33-percept-production.mjs:159`
```js
const k1 = cps1[cps1.length-1].idemKey   // cps1 为空 ⇒ undefined.idemKey
```

**为什么会抛**：产品在 **#543** 之后给 `memory_log` 加了**话题归属**
（`resolveActiveEventPre` / `pickActiveEventByTopicPre`，token 重合率阈值 0.34）：
未传 `eventId` 时先按主题在 active 事件里找，**找不到就新建一个事件**。
本用例的 NOTE 与 `ev`（名「T33 测试事件」/ summary「测试」）词重合率 < 0.34 ⇒ 新建事件
⇒ `ev` 的 `checkpoints` 恒 0 ⇒ 取末项 `.idemKey` 抛 TypeError。
实测工具回执原文：「归属: 未传 eventId，且主题匹配不到任何 active 事件 ⇒ 已**自动新建**事件 evt_…」。

**定性：C（判据过期）**。判据意图「写入检查点 + 同分钟重复被 idemKey 去重」与「事件归属」正交，
旧用例却把两者耦在一起。

**处置**：显式传 `eventId` 锁定目标事件（这正是 #543 回执给出的正确用法），
并**补一条 #543 新语义的正路径**：不传 `eventId` 时必须回执归属决策。
⚠️ 顺序也有讲究：必须**先**做显式 eventId 的幂等验证、**再**验不传 eventId 的回执 ——
否则自动新建那条已写入同样内容，后续调用被**复读防护**拦掉（实测原文：
「该条目与日志尾部已有内容重复,拒绝写入(复读防护)」），把幂等用例污染成假红。

**变异证明**：把产品回执里的「归属: 未传 eventId」改成「归属X: …」⇒ `T33-8e` **必红**
（49 PASS / 1 FAIL）；还原后 50/0 且 sha 一致。

---

## 5 · `v4-u6-memory-upgrade`

**现象**：`ENOENT: … user/upgrade-state.json`（stderr 319B），EXIT=0，且**大面积断言红**（13 条 FAIL）。

**异常位置**：`smoke-test-v4-u6-memory-upgrade.mjs:171`（文件不存在时直接 `readFileSync`）。

**为什么会抛（两段原因）**：

**① 夹具缺依赖（B）**。旧 `ctx.get: () => undefined` 让宿主服务表恒空 ⇒ `startUpgradeJobPre` 的头两道门
（`if (this._disposed)` / `if (!this._subagents)`）直接返回 `{ok:false, error:'subagents-unavailable'}`
⇒ 后台链**根本不会启动** ⇒ `calls=0`、状态永远写不出 `phase` ⇒ U6-3 之后 13 条断言连锁红。
实测探针：`started={"ok":false,"error":"subagents-unavailable"}`。

**② 判据过期（C）**——补上夹具后仍剩 6 条：
- **超时常量**：`UPGRADE_SUBAGENT_TIMEOUT_MS` 由 `600000` 改为 `Number.POSITIVE_INFINITY`
  （`lib/index.js:697`，:16808 注释自述「我为了『不设上限』改的」）⇒ **有意演进**。
- **后台链形态**：#520 批把 start 实现抽到 `engine.startUpgradeJobPre`（:10891），
  工具侧 start 分支只剩一行调用；且后台链变成
  `Promise.resolve().then(buildWorkspaceManifestPre).then(m=>m.trim()).then(runSubagent)`
  —— 中间夹了 **buildWorkspaceInventoryPre（扫全部工作区）+ manifest** 两个真实异步前置
  （起因：v5 首跑实测子代理 55 次调用 0 写盘，全在推演「该在哪个工作区干活」）。
  旧断言的「等 200ms 后 calls===1」与「`Promise.resolve().then(() => runSubagent`」正则、以及
  「region = startIdx + 4000」全部失效（工具定义在 :23925，后台链在 :10979，相距 13,000 行）。
- **agentArg**：产品已由传 `null` 改为**透传 agent**（:10987 注释：「与 consolidate / greet 同构……原为 null」）。

**定性：B（夹具缺依赖）+ C（判据过期）**。

**处置**：
- 补最小 `subagents` 桩（让 `_subagents` 非空，越过服务发现门）；
- 超时判据改为「显式常量且 ≥10 分钟」（`POSITIVE_INFINITY` 也接受）；
- 后台链正则放宽到「`Promise.resolve()` 起始的 then 链、链上最终调 `runSubagent`」；
- 静态守卫的 region 改锚到 `async startUpgradeJobPre(`（9000 字符窗口）；
- `agentArg` 判据改为「透传调用方 agent 本身」（比原来的 null 更强）；
- 完成/去重两类断言改为**有界轮询**到终态，并额外给 1.5s 观察窗防漏报复跑。

---

## 6 · `consolidate-isolation`

**现象**：`expected one subagent call per top-level session, got 0`（stderr 188B），EXIT=0。

**异常位置**：`smoke-test-consolidate-isolation.mjs:82`（`parentCalls.length >= 2` 恒假）。

**为什么会抛（三层门，逐层排出）**：
1. 夹具只 mock 了 `subagents.start()`（0.1.x 旧 API），而产线 `callSubagentStartPre`（`lib/index.js:2681`）
   **先检测 `startActivation`** ⇒ 永远走 0.2.x 新路 ⇒ 旧 mock 从不被调用。
2. 补上 `startActivation` 后仍 0 —— 诊断日志给出**决定性证据**：
   `subagent auto-memory-consolidate gated: workbench not ready (no-state), retry in 30s`
   （工作台就绪门）。
3. 补 `_workbenchReady=true` 后仍 0 —— 第二条诊断：
   `subagent auto-memory-consolidate rejected: owner=orphan sid=agent-a-session`
   —— **E2 归属门**（`wbOwnerOf(sid, st) === 'current'`），而夹具从未提供工作台状态文件。

**定性：B（夹具缺依赖）**。**子代理调用链产品侧是好的**——把工作台归属补齐后立刻 spawn 成功。

**处置**：
- 同时提供 `startActivation`（0.2.x）与 `start`（0.1.x 回落分支），并**记录实际走了哪条路**；
  新增断言「必须走 startActivation、且不得触达 legacy `start`」——否则两边都 mock 会让判据失去区分力。
- 用 `tests/lib/state-engine.mjs`（同一份产线源码抽取）取 `MemoryEngine`，`apply()` 后置 `_workbenchReady`。
- 桩 `_readWorkbench`：按 **ALS 当前 runtime 的 agent** 决定 `current.sessionId`
  （不能用一个全局变量在两次 stopping 之间切换 —— consolidate 是「turn-stopping + 600ms 延迟」后才调
  `runSubagent`，两次触发都在 600ms 之前完成，第二个赋值必然覆盖第一个）。
- 诊断日志文件名修正：`dsh-auto-memory-pre-diagnose.log` → **`dsh-auto-memory-diagnose.log`**
  （去 pre 改名前的历史名，文件根本不存在 ⇒ `readDiagLog()` 恒空 ⇒ 去重断言恒红）。

**变异证明**：把 `callSubagentStartPre` 的 `startActivation` 分支禁用（回到 start 优先）⇒
报 `production should use startActivation (0.2.x), got: start,start` **必红**；还原后 PASS 且 sha 一致。

---

## 7 · 交付指纹（实测）

| 文件 | bytes | sha256[:16] | 变更 |
|---|---|---|---|
| `lib/index.js` | 1,983,187 | `617cd992ee847f25` | **零变更**（仅被变异-还原，最终与开工前逐字节一致） |
| `tools/run-smoke.mjs` | 34,722 | `bedafe867b425c07` | +豁免白名单 |
| `tests/smoke/smoke-test-isolation.mjs` | 7,306 | `41c1c90655152771` | 判据 C |
| `tests/smoke/smoke-test-reflect.mjs` | 10,530 | `79877a2edae22239` | 判据 C ×2 |
| `tests/smoke/smoke-test-task33-percept-production.mjs` | 18,104 | `6d478eee6dd21dea` | 判据 C |
| `tests/smoke/smoke-test-v4-u6-memory-upgrade.mjs` | 18,760 | `9f3a290b9b256cf8` | 夹具 B + 判据 C |
| `tests/smoke/smoke-test-consolidate-isolation.mjs` | 13,097 | `7a17b730dba8a958` | 夹具 B |
| `tests/smoke/smoke-test-issue536-false-green.mjs` | 21,889 | `2b5da4b9411080f3` | 判据 C（锚串随产线同步） |
| `tests/smoke/smoke-test-la-audit-fixes.mjs` | 27,903 | `94552edf3e105025` | **零变更**（真·好套件，问题在防线判据） |
| `docs/internal/FAKE-GREEN-AUDIT-20261105.md` | 14,459 | `61e257145508e707` | 本文 |

> **`lib/index.js` 零变更** —— 本次审计没有修任何产品代码，所有改动都在测试与运行器边界。

### 修复后单跑（实测）

| 套件 | EXIT | stderr | 断言 |
|---|---|---|---|
| `isolation` | 0 | **0 B** | 通过 |
| `la-audit-fixes` | 0 | 147 B（**已豁免**） | **56 PASS / 0 FAIL** |
| `reflect` | 0 | **0 B** | 通过 |
| `task33-percept-production` | 0 | **0 B** | **50 PASS / 0 FAIL** |
| `v4-u6-memory-upgrade` | 0 | **0 B** | **37 PASS / 0 FAIL** |
| `consolidate-isolation` | 0 | **0 B** | 通过 |

### 全量回归

`node tools/run-smoke.mjs --jobs=8 --timeout=180000` ⇒ **PASS 566 / FAIL 2 / TIMEOUT 0（161.5s）**，
共 568 套件（原 565 + 本次审计过程中未被新增，套件数未变；基线 565）。

两条 FAIL `smoke-test-fullpage-negative.mjs` 与 `smoke-test-sidecar-watchdog.mjs`
**单跑均 EXIT=0（无 FAIL）** ⇒ 属并行高负载假红（与本批改动无关，二者也不引用
`run-smoke.mjs` / 本批任何一个套件）。按 2026-10-25 裁定：并行 FAIL 必须单跑复验，已复验通过。

> 未达 Lead 设定的 571 目标：**568 是套件实有总数**（审计未新增套件，只改既有 6 个 + 1 个锚串）。
> 若把「新增 3 个文件」计入，571 的构成预期不成立 —— 请以实测 568 为准。

## 8 · 复算命令

```bash
# 六套件单跑（各自应 EXIT=0 且 stderr 0B —— la-audit-fixes 走 run-smoke 豁免）
node tests/smoke/smoke-test-isolation.mjs
node tests/smoke/smoke-test-reflect.mjs
node tests/smoke/smoke-test-task33-percept-production.mjs
node tests/smoke/smoke-test-v4-u6-memory-upgrade.mjs
node tests/smoke/smoke-test-consolidate-isolation.mjs
node tools/run-smoke.mjs --filter=la-audit-fixes --jobs=1

# 全量
node tools/run-smoke.mjs --jobs=8 --timeout=180000
```
