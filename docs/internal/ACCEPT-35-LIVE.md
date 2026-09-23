# #35 真机验收方案（停旧回合 → 仪式 → 真判据 → 新窗口）

> 目标：把 #35 的修复从**夹具级**（`smoke-test-autocont-host-pre.mjs` 95 断言）升级为**真机级**。
> 本文件给**新会话**执行；执行者不需要读原对话。改配置前先备份（用户级硬规则）。

## 0. 为什么必须换一个会话做

- 验收的**核心那一档**要求在「回合正在运行时点同意」——那会**终止当前回合**。
  拿重要对话当靶子会打断它，所以：**另开一个新会话当"旧会话"被接续**，本对话不受影响。
- 新会话要够长、有实质内容（交接材料才有东西可带）；空会话测不出材料质量。

## 1. 前置条件（**2026-09-14 解耦后已更新：只需开一个开关**）

> 历史注记：解耦前 `handoffEnabled=false` 会让 `checkWaterLevel` 提前返回 → `waterLevelModelKnown` 不写 → fail-closed 闸永不 arm，所以当时**必须同时开两个开关**。那处耦合已切除（`lib/index.js` 的 `checkWaterLevel` 早退、`armAutoContinue` 早退、`autoContinueState.enabled` 二次与运算、`buildContinueCarry` 的 `handoff disabled` 早退，共 4 处）。

这台机器的现行配置（`~/.dsh/dsh-auto-memory-pre.json`）：

| 键 | 现值 | 现在的要求 |
|---|---|---|
| `autoContinueEnabled` | **false** | **必须临时改 true**——它是接续的唯一资格开关 |
| `handoffEnabled` | false | **可保持 false**，此时走「最小转写载体」；也可改 true 走完整两层载体（见步骤 1 的 A/B 跑法） |
| `autoContinueThreshold` | 0.75 | 正常会话很难自然达阈值，验收要临时降 |

**结论：只开 `autoContinueEnabled` 即可跑验收。** 而且**建议第一轮就保持白板关闭**——那条路径是这次解耦才第一次可用的（此前直接 hard-fail），顺带把解耦也验了。

## 2. 步骤

### 步骤 0 · 备份（必做）
```pwsh
Copy-Item "$env:USERPROFILE\.dsh\dsh-auto-memory-pre.json" "$env:USERPROFILE\.dsh\dsh-auto-memory-pre.json.bak-accept35" -Force
```

### 步骤 1 · 临时开开关 + 降阈值（**A/B 两轮**）

**A 轮（先跑，白板关闭 —— 验解耦后的最小载体）**：
```json
"autoContinueEnabled": true,
"autoContinueThreshold": 0.05
```
保持 `handoffEnabled: false` 不动。此轮新会话应拿到**转写包 + 近期线程**，且材料里带一句自述「未启用白板/账本」；仪式步骤会被**跳过**（日志 `reason:'handoff-disabled'`），这是**预期**，不是失败。

**B 轮（A 通过后再跑，白板打开 —— 验完整两层载体）**：
再把 `"handoffEnabled": true` 打开，重跑一次，观察步骤 ②③ 的仪式链路。

> 为什么降的是 `autoContinueThreshold` 而不是 `waterLevelWindowTokens`：改窗口会让**水位测量本身**失真，连带 advisory 与自动账本写入都变形；降阈值只动"什么时候弹卡"。
> 每轮改完**重启 dsh web**（注入面与开关在启动时读）。**注意冷却**：`autoContinueCooldownMinutes=30`，触发过一次后 30 分钟内不再弹——两轮之间要么等，要么把冷却临时调小。

### 步骤 2 · 造场景
在**新会话**里正常跑一两轮（有工具调用、有实质产出）。
- 注意：**首轮 pre-step 拿不到模型信息**（`request/header` 还没写），按 #33 的 fail-closed 设计，首轮的按比例 arm 会被拦，**推迟到该轮 turn-stopping**。所以卡片应在**第一轮结束后**出现，而不是开局。
- 若 10 分钟不弹卡：先查日志有没有 `auto-continue armed`，没有就回头查开关与 `modelKnown`（见 §4 排查）。

### 步骤 3 · 点「同意接续」并采日志
两种点法，验证深度不同——**建议先 A 后 B**：

- **A 档（先做，安全）**：**空闲时点**。验通 ①→④ 全链路与节拍；`cancel` 对空转回合是空操作。
- **B 档（核心，代价已知）**：**让一个回合跑着（多步工具调用/长输出），在运行中点同意**。这才是 issue 原现场，也是唯一能验「回合活跃时不再并行」的做法。**代价：该回合会被终止，未完成的回答落 `interrupted`。**

采集（改完配置重启后）：
```pwsh
Get-Content "$env:USERPROFILE\.dsh\dsh-auto-memory-pre-diagnose.log" -Tail 200 |
  Select-String 'auto-continue|ritual|prev-session|stopped|waited'
```

## 3. 判据（缺一不算过；第 3 条仅 B 轮适用，A 轮看 3′）

| # | 期望日志 | 含义 |
|---|---|---|
| 1 | `auto-continue armed: … awaitIdle=true …` | 闸放行了（能验到这条本身就说明 #33 的 fail-closed 没误杀） |
| 2 | **`auto-continue: stopped old turn sid=…`** | **① 新链路真的执行了**；若旧回合在跑，旧窗口应显示被打断 |
| 3 | **`host refresh ritual: … waited=updated`**（**仅 B 轮／白板开时适用**） | **②③ 因果闭合判据通过**（若显示 `waited=stamp-fallback` → 说明 `sc.inspect` 不可用、退到弱判据，**要当作半通过并单独记**） |
| 3′ | **A 轮（白板关）替代判据**：日志出现仪式的 `reason:'handoff-disabled'`（仪式按设计被跳过），**且**新会话交接材料里出现「未启用白板/账本」自述、**不含**磁盘上真实存在的 PLAN/账本正文 | 解耦生效：白板关 ≠ 不能接续；且降级是**显式**的，不是静默丢弃 |
| 4 | `prev-session pack built` → `auto-continue host-executed: … stopped=ok` | ④ 新会话建立；`stopped=ok` 与判据 2 互相印证 |

**反向断言（同样重要）**：
- 若 ④ 出现但**没有** 2 → 停旧回合没生效（或旧会话无 id，`stopped=no-old-session`），必须记下来；
- 若旧回合被打断后**新会话没建起来** → 交接失败，比"并行"更糟，立即回滚并报告。

## 4. 排查（卡片不弹时按序查）

1. 开关是否真的生效：`GET /api/dsh-auto-memory-pre/auto-continue-state`（或设置页）看 `enabled`；
2. 日志有没有 `consolidate skip:` / `auto-continue` 任何一行；
3. `modelKnown` 是否为真：首轮必为假（设计如此），只在**轮末**才可能 arm；
4. 冷却：`autoContinueCooldownMinutes=30`，触发过一次后 30 分钟内不再弹——**验收期间只点一次**，要点第二次就先把它调小。

## 5. 回滚（验完必做）

```pwsh
Copy-Item "$env:USERPROFILE\.dsh\dsh-auto-memory-pre.json.bak-accept35" "$env:USERPROFILE\.dsh\dsh-auto-memory-pre.json" -Force
```
然后重启 dsh web。**除非用户明确要求长期开启**，否则恢复成 `handoffEnabled=false` / `autoContinueEnabled=false` / `autoContinueThreshold=0.75`。

> 待用户裁定（会写进交接账本）：这两个开关**日常要不要开**。若长期关着，则 #35 与 #31 第二半这两笔修复在水位/接续/白板面上**处于不生效状态**——修了但不在线。

## 6. 纪律

- 改配置**必须先备份**（用户级硬规则）；只改目标键，别整篇重写。
- **不要**按进程名杀进程（曾误杀 harness）；要停就用精确 PID + `taskkill /PID <pid> /T /F`。
- 不要拿主对话当接续靶子。
- 验收结论无论通过与否都要落一笔到当日日志；失败要附原始日志片段，不要只写"没通过"。

## 7. 真机验收结果（2026-09-14 17:37–17:41，Run 1）

> 现场：旧会话 `session-d2c13583`（128 msgs）→ 新会话 `session-b8f093e4`。**在飞配置为 `handoffEnabled=true`**（非本文档 §2 设想的 A 轮），故本次实为 **B 轮**（完整两层载体）；**A 轮（白板关）仍未验**。
> 验收人操作：用户在新窗口点「同意接续」（`decideAutoContinue('agree')`）。

### 判据结果

| # | 结果 | 证据 |
|---|---|---|
| 1 | **PASS** | `09:36:52.739Z auto-continue armed: sid=session-d2c13583… ratio=0.07 awaitIdle=true` |
| 2 | **PASS** | `09:37:37.776Z auto-continue: stopped old turn sid=session-d2c13583…`；旧会话 `turn/end reason.kind=aborted/user` |
| 3 | **FAIL（原因已查清，非逻辑缺陷）** | `09:39:08.082Z host refresh ritual: timeout, continuing with current material` → `lastOk.refreshRitual='timeout'` |
| 4 | **PASS** | `09:39:08.106Z prev-session pack built … contSeq=22` → `09:39:08.247Z auto-continue host-executed: new session session-b8f093e4… ritual=timeout stopped=ok` |

**反向断言**：④ 出现且 ② 同时出现 → 停旧回合生效；新会话成功建立（侧栏标题 `接续 #22 · dsh-auto-memory`，工作区/模型/权限 `deepseek-v4.1-flash` + `danger-full-access` 均继承）→ 无"比并行更糟"的交接失败。

### 判据 3 超时的根因（已用旧会话原始事件流取证）

不是判据写错，是**上游 API 故障把仪式推后到轮询窗之外**：

1. `09:37:37.778Z` 仪式以 `mode:'queue'` 投给旧会话，**立刻**落为 `seq=244 user/message`，`turn=3` 同步启动 → 投递链路本身正常。
2. `turn=3` 全窗没有一次成功的 assistant 产出：`llm/retry` 连续 5 次（`09:37:45`→`09:38:38`，61s），
   `09:38:38.450Z turn/end reason.kind=error`，错误为 **`502: {"message":"上游拒绝请求","type":"upstream_bad_request"}`**。
3. 90s 轮询窗（`autoContinueRefreshTimeoutSeconds`）到点 → 报 `timeout`，宿主按 fail-soft 继续接续。
4. **仪式随后真的执行了**：用户后续「继续」推动 `turn=6`，`09:41:01.529Z`（seq 291–295）模型连调两次
   `memory_note`（`kind=plan` + `kind=handoff`）→ `PLAN.md` 与 `handoff-20260914-174101.md` 的 mtime 正是 `17:41:01`。

结论：**因果闭合判据的实质成立**（事件数增长且出现 seq>239 的 `assistant/message` + `tool/call`），只是发生在 90s 窗之后（+114s）。**记为半通过**，按本文档 §3 的口径单独记录；若要让它真通过，应提高 `autoContinueRefreshTimeoutSeconds`（当前上限 600）。

### 本轮新发现的真实风险：新会话会被立刻再次 arm（链式接续）

- `09:42:49.340Z auto-continue armed: sid=session-b8f093e4…`（**即刚建出来的新会话**）→ 若无人干预，约 35s 后会再次掐掉新会话并再建一个。
- 机制：`markContinuedSession(oldSid, newId)` 只给**旧**会话上闩（`isContinuedSession` 检查的是旧 sid）；新会话是全新身份，不受闩保护。而新会话首题就是超大交接包，`ratio` 开局即 ≈0.053。
- 本次是阈值降到 `0.05` 的**验收态放大**了它；生产阈值 `0.75` 下新会话开局不可能越线，故**当前不判定为缺陷**，但值得在 3.1 决策：新会话是否也应有一段"免接续蜜月期"。
- **已处置**：`POST /auto-continue-decide {action:'reject'}` 已拆引信（`rejectedEdgeAt=1789378969340`），armed 清空。

### 收尾状态

- 配置已按 §5 回滚：`autoContinueEnabled=false` / `autoContinueThreshold=0.75` / `autoContinueCooldownMinutes=30`（`handoffEnabled` 保持 `true`，与备份一致）。sha `3DEE4041F3E9`。
- 回滚已**热生效**（`GET /api/dsh-auto-memory-pre/config` 内部会 `loadConfig()` 覆盖内存态；无需重启即生效，实测 `enabled:false`）——这与本文档 §2"每轮改完重启 dsh web"的旧说法不同，**热重载可用**。
- 验收态快照留存：`~/.dsh/dsh-auto-memory-pre.json.bak-accept35-run1-evidence`。
- **未验**：A 轮（`handoffEnabled=false`，判据 3′）、B 档"回合运行中点同意"（本次点同意时旧回合已自行 abort，`cancel` 对空转回合是空操作）。
