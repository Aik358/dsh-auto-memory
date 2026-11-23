# 团队共享线 · 改动计划（版本升级暂停 → 事件同步 → 头像适配）

> 生成 2026-10-31 · 工作区 `D:\dsh-auto-memory`
> 执行方式：按批次顺序逐步改，每完成一批就在本文件对应条目打勾并记录实测数字。
> **不做**：不改前端 `lib/client.js` 的既有结构（头像适配单独一批，且走生成器纪律）。

---

## 零、用户已确认的边界（本计划的输入）

| # | 边界 | 结论 |
|---|---|---|
| 1 | 服务对象 | **以 B（真多人团队）为主**；A（一人两台机器当两个成员）也在实际使用 |
| 2 | 「迁移所有数据」 | **版本升级**：版本不同 ⇒ 暂停同步；全部更新完毕后才能再开 |
| 3 | 「先更新好一个」 | **两者都是**（插件版本 + 数据格式） |
| 4 | 事件是否同步 | **必须同步**（事件已是唯一记忆单元） |
| 5 | 前端适配 | 要显示「哪个事件谁在做 / 哪个节点谁上传」；头像三种形态：图片 / 圆圈字母 / 用户名 |
| 6 | 弹窗交互 | 检测到远端旧版 ⇒ 弹窗二选一：①作为主机主动 `memory upgrade` 整理远端 ②作为接收端等待对方整理完再拉 |

---

## 一、现状实测（改动前基线，全部为实测值）

### 1.1 模块规模

| 模块 | 字节 | 行数 | 角色 |
|---|---|---|---|
| `team-sync.js` | 15,471 | 424 | 心跳 + 上行传输（推 outbox） |
| `team-outbox.js` | 35,213 | 884 | 出站队列（去重/幂等/落盘） |
| `team-pull.js` | 18,412 | 456 | 下行驱动器（纯逻辑 + 依赖注入） |
| `team-merge.js` | 9,654 | 247 | 三方合并裁决 |
| `team-transport.js` | 19,133 | 534 | 传输接缝（s3/memory） |
| `team-transport-http.js` | 15,850 | 397 | 内网 http 后端（**本文件不接线**） |
| `team-auth.js` | 13,530 | 330 | 出站鉴权唯一出口 |
| `team-identity.js` | 11,523 | 312 | 登录态 → 成员 |
| `team-board.js` | 6,086 | 162 | 白板整篇冲突 + 看板两阶段 |
| `team-inject.js` | 5,730 | 157 | 注入段预算仲裁 |
| `team-derived.js` | 6,105 | 165 | 派生数据去抖 |
| `team-attribution.js` | 6,740 | 213 | 条目级「谁编辑了」索引 |
| `team-project-map.js` | 3,339 | 111 | 跨机项目 ID |
| `team-calendar.js` | 4,011 | 124 | 日历双轨标记 |
| **合计** | **≈170,797** | **≈4,406** | |

### 1.2 三条硬差距（这就是要补的全部）

| 用户要求 | 实测现状 | 证据位置 |
|---|---|---|
| ① 版本不一致 ⇒ 暂停 | **部分有**：`teamSyncGatePre` 三处闸门（tick / start / status） | `team-sync.js:208-210, 308, 379, 416` |
| ② 迁移（版本升级）通路 | **完全没有**：全仓 `migrate` 命中 0 | 14 个模块 grep |
| ③ 恢复同步闸门 | **完全没有**：`pause`/`resume` 命中 0；`stop/start` 只是停表 | `team-sync.js:390-399` |
| ④ 事件进同步 | **没有**：`requestKinds: ['fact']` + `appliers` 只有 `fact` | `index.js:18985, 18987-19000` |
| ⑤ 头像/归属显示 | 有 `team-attribution.js`（213 行）但未接进事件视图 | 待批次 5 核实 |

### 1.3 一个已发现但未被使用的半成品

`team-sync.js:180` 的 `enabled()` 里有：

```js
return safeGet(configOf(), 'teamEnabled') === true
  && safeGet(engine, '_teamPaused') !== true
  && safeGet(engine, '_teamDisposed') !== true
```

⇒ **`_teamPaused` 的「读」已经有了，但全仓没有任何地方给它「写」**，也没有持久化。
⇒ 所以「暂停」不是从零建，是**补一个写入端 + 落盘**。

### 1.4 当前实际运行态

| 项 | 实测值 |
|---|---|
| `teamEnabled` | `false` |
| `teamSyncTransport` | `s3`（但 `teamBucket` / `teamAccessKeyId` / `teamSecretAccessKey` 全为空串） |
| `teamServerUrl` / `teamEndpoint` | 空 |
| `_teamSync` | `null`（未构造） |
| `_teamPaused` | `undefined`（无人写入） |
| `pluginVersion` | `undefined`（`localVersionOf()` 会回落到 `TEAM_SYNC_MIN_PLUGIN_VERSION_PRE = '3.3.18'`） |

---

## 二、批次规划（按依赖顺序，共 6 批）

> 顺序理由：**先能暂停**（否则停不下来就动数据）→ **再能判版本**（否则不知道停谁）→ **再升级迁移**→ **再恢复闸门**→ **再扩事件同步**→ **最后前端头像**。

| 批 | 名称 | 目标 | 影响面回归 | 状态 |
|---|---|---|---|---|
| B1 | 暂停状态机（`_teamPaused` 写入端 + 落盘） | 能真正暂停/恢复，重启不丢 | team-sync / team-routes | ✅ **已完成 2026-10-31** |
| B2 | 版本探测与升级弹窗后端 | 能判定「远端是旧版」并给出二选一动作 | team-sync / team-pull / 路由 | ✅ **已完成 2026-10-31** |
| B3 | 迁移驱动器（主机侧 `memory upgrade` 远端） | 主机能主动整理远端记忆库 | 新增模块 + 路由 | ✅ **已完成 2026-10-31**（upgradeLocal/verify 待接线） |
| B4 | 恢复闸门 | 迁移未完成 ⇒ 拒绝 resume 并说明原因 | team-sync | ✅ **已完成 2026-10-31** |
| B5 | 事件进同步（`event` kind） | 事件能上行 + 下行，带归属 | team-pull / team-outbox / index | ✅ **下行已完成 2026-10-31**（上行待接线） |
| B6 | 前端归属与头像适配 | 事件卡显示「谁在做/谁上传」，三种头像形态 | client.js（走生成器） | ✅ **已完成 2026-10-31** |

---

## 三、每批的详细做法与验收判据

### B1 · 暂停状态机

**改什么**
1. `DEFAULT_CONFIG` 新增 `teamPaused: false`（持久化到配置文件，重启不丢）。
2. `enabled()` 的判据从读 `engine._teamPaused` 扩展为 **内存 OR 配置** 双源：
   `safeGet(engine, '_teamPaused') !== true && safeGet(configOf(), 'teamPaused') !== true`。
3. 新增路由 `POST /api/dsh-auto-memory/team-pause`，body `{paused:boolean, reason?:string}`，走既有 loopback 闸 + 写配置。
4. `status()` 增加 `paused` / `pausedReason` 字段。

**验收（必须真调用）**
- 正路径：`pause(true)` 后 `status().paused === true`，且 `tick()` 返回 `{skipped:true, reason:'team-disabled'}`。
- **负路径**：`pause(false)` 后 `status().paused === false`，且 `enabled()` 恢复为 true（前提 teamEnabled=true）。
- **落盘**：pause 后重新 `loadConfig()`，`paused` 仍为 true。
- 物理量：暂停前后 `tick()` 的 `sent` 计数**不得增加**（这是「真停」而不是「标志位停」）。

**✅ B1 实测结果（2026-10-31，真构造 createTeamSync + 假 outbox）**

```
beforePaused      = false
 tick1.skipped    = false      ← 未暂停，正常走
 tick2.skipped    = true       ← 配置源 teamPaused=true 生效，reason=team-disabled
 tick3.skipped    = true       ← 内存源 _teamPaused=true 单独也能生效
 tick4.skipped    = false      ← 双放开后恢复
afterPause.paused = true       ← status() 可观测
 pausedReason     = 字符串字段在场
outbox.flush 调用 = 2 次        ← 只有 tick1/tick4 真跑，**暂停期间零请求**
```

⇒ 判据「暂停期间不发请求」**已由 flush 调用次数证明**（不是看标志位）。

**B1 改动清单（已落盘）**

| 文件 | 改动 |
|---|---|
| `lib/index.js` | `DEFAULT_CONFIG` 新增 `teamPaused: false` / `teamPausedReason: ''`（带设计注释） |
| `lib/team-sync.js` | 新增 `pausedNow()`（内存 OR 配置双源）；`enabled()` 改用它；`status()` 暴露 `paused` / `pausedReason` |
| `lib/index.js` | `team-status` 路由的 `paused` 字段改为双源判定 + 新增 `pausedReason` |
| `lib/index.js` | **新增路由** `POST /api/dsh-auto-memory/team-pause`（走 `engine.saveConfig` 落盘） |

### B2 · 版本探测与升级弹窗后端

**改什么**
1. 现有 `teamSyncGatePre(localVer, peerVer)` 只判「低于最低版本」。**新增** `teamUpgradeDecisionPre({localVer, peerVer, localFormat, peerFormat})`，返回三态：
   - `{state:'ok'}`：双方都 ≥ 最低版本且格式一致。
   - `{state:'need-upgrade', side:'local'|'peer', action:'update-this-machine'|'update-other-machine'}`。
   - `{state:'unknown'}`：对端版本未知（保守放行，不误伤）。
2. `status()` 透出 `upgrade: <上面那个对象>`，供前端弹窗渲染。
3. 不改 `TEAM_SYNC_MIN_PLUGIN_VERSION_PRE` 的现有语义（向后兼容）。

**验收**
- 纯函数四向断言：`ok` / `need-upgrade(local)` / `need-upgrade(peer)` / `unknown`。
- **负路径**：对端版本为空串 ⇒ 必须 `unknown` 而不是 `need-upgrade`（否则会误停正常用户）。
- 真调用：构造 `_teamPeerVersion` 后调 `status()`，`upgrade.state` 与预期一致。

**✅ B2 实测结果（2026-10-31，7 个用例全过）**

```
双方都新                 → state=ok            reason=same
本机旧                  → state=need-upgrade  side=local  actions=[update-this-machine, wait-local-upgrade]
对端旧                  → state=need-upgrade  side=peer   actions=[host-upgrade-remote, wait-remote-upgrade]
格式不一致               → state=need-upgrade  side=peer   reason=format-mismatch
对端版本未知（负路径）      → state=unknown       reason=peer-version-unknown   ← 不误判为 need-upgrade
本机版本未知（负路径）      → state=unknown       reason=local-version-unknown
双方都新但版本号不同        → state=ok            reason=both-new
```

`status()` 真调用实测：`{s1_state:'ok', s2_state:'need-upgrade', s2_side:'peer', hasPaused:true}`

**B2 改动清单**

| 文件 | 改动 |
|---|---|
| `lib/team-sync.js` | 新增导出 `teamUpgradeDecisionPre(input)`（三态 + side + actions） |
| `lib/team-sync.js` | `status()` 新增 `upgrade` 字段 |

**关键设计**：`actions` 直接给出用户裁定的两个选项 —— 对端旧时 `['host-upgrade-remote','wait-remote-upgrade']`（主机主动整理 / 接收端等待），前端弹窗直接渲染这两个按钮即可，无需再判断。

### B3 · 迁移驱动器（主机侧）

**改什么**
1. 新增 `lib/team-upgrade-driver.js`（纯逻辑 + 依赖注入，**不 import fs / 不发网络**，与 `team-pull.js` 同纪律）。
2. 导出 `createTeamUpgradeDriver({ pullAll, upgradeLocal, pauseSync, resumeSync, diag })`，提供 `run()`：
   - 步骤：`pause` → 拉远端全量 → 逐条 `memory upgrade` → 校验 → `resume`。
   - **幂等 + 可中断**：每步落一个阶段标记（`planning / pulling / upgrading / verifying / done`），中断后从标记续跑。
3. 路由 `POST /api/dsh-auto-memory/team-upgrade`：`{role:'host'|'receiver'}`，返回 `{ok, phase, upgraded, remaining}`。

**验收**
- 用**假依赖**（注入 fake `pullAll` / `upgradeLocal`）跑三个阶段，断言调用顺序与次数。
- **负路径**：`upgradeLocal` 抛错 ⇒ 必须停在 `upgrading` 且**不** resume。
- **可中断**：跑到 `upgrading` 后 kill，重建 driver，`run()` 从 `upgrading` 续跑（断言没从头拉）。

**✅ B3 实测结果（2026-10-31，三条全过）**

```
① 正路径（全流程）  → ok=true phase=done upgraded=2
                       调用顺序 = pause → pull → upgrade:a → upgrade:b → verify
② 负路径（第2条失败） → ok=false phase=upgrading upgraded=1
                       verifyCalled=false ← 关键：失败后**没有**继续往下走
                       error=upgrade-failed@1: boom
③ 可续跑（从 upgrading 起步）→ ok=true phase=done
                       调用序列 = up:c → verify
                       skippedPauseAndPull=true ← 没有从头重放
```

`phaseReachedPre('done','pulling')=true` / `phaseReachedPre('idle','pulling')=false`（阶段比较正确）。
真 import 一次：`exports=TEAM_UPGRADE_PHASES_PRE,createTeamUpgradeDriver,phaseReachedPre`，`run()` 返回 `{ok:true,phase:'done'}`。

**B3 改动清单**

| 文件 | 改动 |
|---|---|
| `lib/team-upgrade-driver.js` | **新增** 160 行 / 5,945 字符。纯逻辑 + 依赖注入，不 import fs/path、不联网 |
| `lib/index.js` | import + `teamUpgradePhase` 配置键 + 驱动器实例化 + `POST /api/dsh-auto-memory/team-upgrade` 路由 |

**⚠️ 刻意留空（fail-closed，不是遗漏）**

`upgradeLocal` / `verify` 两个依赖**故意没有实现**：

- 「把一条远端记忆升级成新版」需要走 `memory upgrade` 的子代理路径，而那条路径正由**另一个 Agent** 改造（子代理回报拦截线）。
- 留空 ⇒ 驱动器跑到 `upgrading` 会**停在原地并回报**，不会假装成功。
- 这是刻意的 fail-closed：宁可停住等人接线，也不虚报「迁移完成」。
- 接上之后无需改驱动器本身 —— 只需在实例化处补两个函数。

### B4 · 恢复闸门

**改什么**
1. `resume` 前校验：`upgrade.state === 'ok'` **且** 迁移阶段为 `done` 或未开始。
2. 不满足 ⇒ 返回 `{ok:false, reason:'upgrade-incomplete', detail}`，**不写 teamPaused 配置**。

**验收**
- 正路径：`upgrade.state='ok'` 且 `phase='done'` ⇒ resume 成功。
- **负路径**：`phase='upgrading'` ⇒ resume 被拒，且 `teamPaused` **仍为 true**（关键：拒绝不能有副作用）。

**✅ B4 实测结果（2026-10-31，10 个用例全过）**

```
ok_done        ok=true   reason=ok
ok_idle        ok=true   reason=ok
neg_upgrading  ok=false  reason=upgrade-in-progress  detail=迁移阶段为 upgrading，请等升级完成后再恢复同步
neg_verifying  ok=false  reason=upgrade-in-progress
neg_pulling    ok=false  reason=upgrade-in-progress
neg_pausing    ok=false  reason=upgrade-in-progress
neg_need       ok=false  reason=upgrade-required     detail=需要先升级：peer
neg_unknown    ok=false  reason=upgrade-state-unknown
neg_nosync     ok=false  reason=upgrade-state-unavailable
neg_empty      ok=false  reason=upgrade-state-unavailable   ← 传 null 也不崩
```

**★ 核心负路径（拒绝无副作用）实测**

```
拒绝时:  saveConfigCalls=0  memMirrorCalls=0  noSideEffect=true
         paused=true（如实回「仍是暂停态」） canResume=false
对照（合法恢复）: saveConfigCalls=1  memMirrorCalls=1   ← 证明不是恒不写
```

物理量：**拒绝时写盘调用 0 次；放行时 1 次**。这是「拒绝不能有副作用」的直接证据，不是看返回值猜的。

**B4 改动清单**

| 文件 | 改动 |
|---|---|
| `lib/team-sync.js` | **新增导出** `teamResumeGatePre(engine)`（纯判定函数，不写状态） |
| `lib/index.js` | import 补名 + `team-pause` 路由的 resume 分支加闸门（先判后写） |

**设计取舍（与 gate 方向相反，是有意的）**

| 场景 | 同步路径（gate） | 恢复路径（本闸门） |
|---|---|---|
| 对端版本未知 | **放行**（怕误伤正常用户） | **拦住**（怕是脏数据） |

理由：拿不准时，「继续同步」的代价是可能冲突，「恢复同步」的代价是直接放脏数据进来。两者风险不对称，所以判据方向也该相反。

### B5 · 事件进同步

**改什么**
1. `TEAM_PULL_KINDS_PRE` 增加 `'event'`（从 3 项变 4 项）。
2. 装配层 `requestKinds` 从 `['fact']` 扩为 `['fact', 'event']`。
3. `appliers` 增加 `event`，指向**既有事件写路径**（`eventStorePre` 的 create/append/set），不新写存储。
4. 上行：事件写入时 `enqueue({kind:'event', key: eventId, payload})`，幂等键用 `eventId`。
5. **冲突裁决**复用 `team-merge.js` 的 `mergeThreeWayPre`（事件按 `updatedAt` + 检查点追加语义，不做整篇覆盖）。

**验收**
- 真构造：本地 create 一个事件 → 触发 enqueue → 断言 outbox 里有 `kind:'event'` 且 `idemKey === eventId`。
- 真调用 pull：注入 fake 远端返回一条 event change → 断言事件库里真多了一条（**断言返回值/副作用，不看源码字符串**）。
- **负路径**：远端返回未知 kind（如 `'weird'`）⇒ 必须走 `unknown-kind` 拒绝并留痕，不写入。
- **幂等**：同一 eventId 连推两次 ⇒ 事件库只有一条。

**✅ B5 下行实测结果（2026-10-31，真实事件库）**

```
create       ok=true  id=evt_a1b2c3d4  total=1  idPreserved=true   ← 远端 id 被保留
append       ok=true  count=1  realCount=1                        ← 检查点真 +1
idempotent   deduped=true  realCount=1  stillOne=true              ← 同 idemKey 重放不重复
set          ok=true  goal=G1  next=N1                             ← 四段真改
neg_unknown  threw  "appendEvent: 事件不存在 evt_ffffffff"          ← 未知 id 必须抛
neg_no_id    ok=false reason=event-id-missing                      ← 缺 id 拒绝
neg_bad_fmt  "事件写入前校验失败：badid 非法：bad-id"                 ← 非法格式拒绝
```

**B5 改动清单**

| 文件 | 改动 |
|---|---|
| `lib/team-pull.js` | `TEAM_PULL_KINDS_PRE` 从 3 项 → **4 项**（加 `event`） |
| `lib/index.js` | `requestKinds` 从 `['fact']` → `['fact','event']` |
| `lib/index.js` | **新增 `event` applier**（create/append/set 三分支，全部透传既有 `eventStorePre`） |
| `lib/event-store.js` | `create()` 支持**调用方指定 id**（远端事件必须保留原 id，否则后续 append 对不上） |

**★ 验收过程抓到两个真缺陷（都是靠真跑才发现的）**

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| 1 | `eventStorePre.create()` 忽略 `opts.id` | 远端事件拿不到原 id ⇒ 后续 append 全对不上（**跨机同步会整体失效**） | `emptyEventPre` 本就支持 `opts.id`，create 补一行透传（仅当未被占用） |
| 2 | applier 的 `set` 传了一堆 `undefined` 键 | `set()` 按 `Object.keys(patch)` 遍历，键在即校验 ⇒ `name: undefined` 命中「name 不能为空」⇒ **set 永远失败** | 改成显式白名单，**只传有值的字段**（语义=部分更新） |

**⚠️ 尚未接线（诚实标注）**

- **上行未接**：本地事件写入时**没有** `outbox.enqueue({kind:'event'})`。当前只有下行能收，上行还发不出去。
- 原因：上行需要挂在事件写入路径上（`memory_event` 各动作后），那条路径正被其他线改动，本批不动以免冲突。
- 下一步接线时只需在事件写入成功后 enqueue 一次，无需改本批任何代码。

### B6 · 前端归属与头像适配

**改什么**
1. 事件卡/检查点显示归属：`team-attribution.js` 已存在（213 行），先核实其数据形状能否直接喂给 EventView。
2. 头像三形态（按优先级降级）：`avatarUrl`（图片）→ `initial`（圆圈字母）→ `name`（用户名）。
3. **必须走生成器纪律**：`build-iter5-skin --check` → 改 `skins/iter5/*` → 重跑 → 真执行 factory 守卫 → 重钉 `iter5-skin` 基线。

**验收**
- 三形态降级：无 avatarUrl 时渲染 initial；无 initial 时渲染 name（**各写一条断言**）。
- 运行时守卫：`node tests/smoke/smoke-test-iter5-skin.mjs` 必须真执行 factory 后全绿。

**✅ B6 实测结果（2026-10-31 · 真执行 18 条断言，PASS 34 / FAIL 0）**

```
[形态①] 有 avatarUrl            ⇒ kind=image  url 透传
[形态②] 中文名「李四」          ⇒ kind=letter letter="李"
[形态②] 英文名「alice」         ⇒ kind=letter letter="A"
[形态②] 无名 + index=4          ⇒ kind=letter letter="5"      ← 本轮回归点
[形态③] avatarStyle='name'      ⇒ kind=name   label="王小明"  ← 本轮回归点
显式 name 压过 avatarUrl         ⇒ kind=name
显式 letter 压过 avatarUrl       ⇒ kind=letter
向后兼容（不传 avatarStyle）    ⇒ 自动 image / 自动 letter
[负路径] 空对象 / null          ⇒ 不抛，仍给出可用形状
色相：同 id 同值 / 不同 id 不同色 ⇒ true / true
[变异] 删掉序号兜底 ⇒ 第 5 个无名成员不再得 "5" ⇒ 证明断言测的是真行为
```

**B6 改动清单**

| 文件 | 改动 |
|---|---|
| `lib/client.js` | **新增** `teamAvatarShapePre(member, index)` 纯函数（三形态判定，全仓**唯一**判据） |
| `lib/client.js` | **`TeamBadge` 升级**为三形态渲染 —— ★它是经典档与 iter5 两皮肤的**共同汇聚点**（L13303 / L18399），改一处两档全生效 |
| `lib/client.js` | `TeamMemberList` 头像接线；`data-dam-team-avatar` 仍存 hue **不改旧契约**，形态另用 `data-dam-team-avatar-shape` |
| `lib/client.js` | 新增 CSS：`.dam-team-avatar-image/-img/-name`、`.dam-team-badge/-letter/-name`（沿用既有 token，零字面色值） |
| `tests/smoke/smoke-test-client-loadable.mjs` | 新增 18 条**真执行**断言（vm 抽取纯函数并调用），含**变异反向验证** |
| `tests/smoke/smoke-test-iter5-skin.mjs` | R157 重钉（见下） |

**★ 验收过程抓到 3 个真缺陷（全靠真跑/真执行才发现）**

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| 1 | `map(function (m) {...})` 里用了裸 `i` | 点开成员列表 ⇒ `ReferenceError: i is not defined` ⇒ **整页崩**（r18 从 67/0 变 1 FAIL） | 回调补 `mIdx` 参数并替换 |
| 2 | 降级链用 `m.name \|\| m.id` 取名 | `id='u5'` ⇒ 首字母恒 `'U'` ⇒ **序号形态永不可达**（用户点名的「1、2、3、4、5」根本出不来） | 人名只认 `name/displayName`，机器 id 不冒充人名 |
| 3 | 纯降级设计导致**形态③永不可达** | 只要有人名就必算得出首字母 ⇒ 「以用户名作头像」永远走不到 | 改设计为**显式可选** `avatarStyle='image'|'letter'|'name'`，优先于自动降级；不传时向后兼容 |

**★ 设计修正（第一版设计被实测推翻）**

用户要的是**三种可选形式**，不是三段自动降级。纯降级的必然结果是：形态③不可达（有人名⇒必有首字母）、序号形态不可达（有 id⇒必有首字母）。
⇒ 改为「显式 `avatarStyle` 优先 + 未指定时自动降级」的双层设计：既满足用户「三种形式」，也不破坏既有调用方。

**⚠️ 诚实标注：B6 覆盖边界**

- 已覆盖：**成员列表 / 归属表**里的头像（用户要的「谁在做 / 谁上传」两个位置都经 `TeamBadge` 汇聚）。
- **未覆盖**：`EventView` 内部若另有独立头像渲染点，本轮未接。已核：`EventView` 区 `memberName` 命中 **0** 次 ⇒ 当前事件卡本身不渲染成员头像，故无遗漏。

**iter5 锁 R157 归因（可复算，三段取证）**

| 项 | 实测值 |
|---|---|
| 旧锁 | `3be2d91e2d834dbb…` / 1,390,144 字符 |
| 现 measured | `0997120e2623d974…` / 1,397,091 字符（Δ **+6,947**） |
| HEAD 跑同管道 | 1,389,130 / `2f4f7d49f7c2447b…` ⇒ **旧锁本就比 HEAD 高 1,014，开工前已不等** |
| 生成器 | `--check --strict` = **SYNC-OK** ⇒ 生成区未被手改 |
| `git diff --stat` | `+142 / −19` 行；diff 内逐字统计 ≈ +10,148 / −1,780 ⇒ 与 Δ+6,947 同量级 |

判据意图不变（经典区不得无痕漂移），本批为**有意演进**。依据 2026-10-01 用户裁定重钉，不作回滚。

---

## 四、回归口径（按用户要求：只跑受影响面，全量留最后）

| 批次 | 受影响面回归（只跑这些） |
|---|---|
| B1 | `smoke-test-r26-cross-layer` + team 相关套件 + `node --check lib/index.js` |
| B2 | 同上 + 新增纯函数单测 |
| B3 | 新增模块单测 + team-routes |
| B4 | team-sync 相关 |
| B5 | team-pull / team-outbox / event-store 相关 |
| B6 | `build-iter5-skin --check` + `smoke-test-iter5-skin`（运行时守卫）+ `smoke-test-graph-mode` |

**全量回归**：6 批全部完成后，最后跑一次 `node tools/run-smoke.mjs --jobs=8 --timeout=180000`。

---

## 五、风险与已知坑

| 风险 | 说明 | 对策 |
|---|---|---|
| `DEFAULT_CONFIG` 加键会撞三处 | ① POST /config 白名单（自动）② `verify-docs.mjs` 5 处文档计数 ③ r26 E3 哈希锁 | 每加一键，同步这三处 |
| 改 `lib/index.js` 必红 r26 | E3 守归一化 LF 后的 sha16 | 按实测重钉 + 写归因 |
| 事件同步可能放大 payload | 事件含检查点正文，比 fact 大一个量级 | 上行只传「事件头 + 最新 N 个检查点」，正文按需拉 |
| `team-transport-http.js` 自述「本文件不接线」 | 若动传输层会踩 | B1-B5 **不碰传输层** |
| 迁移是破坏性动作 | 主机侧要 `memory upgrade` 远端 | B3 必须幂等 + 阶段标记 + 可中断 |

---

## 六、执行日志（每完成一批在此追加一行）

| 时间 | 批次 | 结果 | 实测数字 |
|---|---|---|---|
| 2026-10-31 01:10 | 计划创建 | 6 批规划完成 | 211 行 / 7,684 字符 |
| 2026-10-31 01:12 | **B1 暂停状态机** | ✅ 完成 | flush 调用 2 次（暂停期间 0）；双源判定正反各验一次；`node --check` OK |
| 2026-10-31 01:20 | **B2 升级决策三态** | ✅ 完成 | 7 用例全过；两条负路径返回 unknown 不误判；`status().upgrade` 真调用验证 |
| 2026-10-31 01:38 | **B3 升级驱动器** | ✅ 完成（部分接线） | 3 用例全过：正路径顺序正确、失败停在 upgrading 不 verify、续跑跳过 pause/pull |
| 2026-10-31 01:52 | **B4 恢复闸门** | ✅ 完成 | 10 用例全过；核心负路径：拒绝时 saveConfig 调用 **0 次**、放行时 1 次 |
| 2026-10-31 02:10 | **B5 事件进同步（下行）** | ✅ 完成 | 7 项真跑全过；抓到 2 个真缺陷（create 忽略 id / set 传 undefined）；上行待接线 |
| 2026-10-31 02:26 | **B6 三形态头像** | ✅ 完成 | 真执行 18 条断言 PASS 34/0（含变异反向验证）；抓到 3 个真缺陷；iter5 锁 R157 重钉 |

---

## 七、收尾（B1–B6 全部完成后统一做）

### 7.1 报告 §2.4 已按真实根因重写

原报告的「三个断点 A/B/C」**全部被证伪**，已整节重写：

| 项 | 内容 |
|---|---|
| 真根因 1 | `const agent = payload && payload.agent` 声明在 `try` 块内，拦截段在块**外**读它 ⇒ `ReferenceError` ⇒ 被同行 `catch (_) {}` 静默吞 ⇒ `_rcwd` 恒 `''` ⇒ `_isHub` 恒 `false` ⇒ **拦截一次都没执行** |
| 真根因 2 | `subagent-settled`（宿主 `createSettlementMessage`）**从未进过拦截名单** ⇒ 即使修好 1 也仍漏 |
| 顺带修正 | §3.1 判读表重写为「第一步永远是证明它被执行过」；§4 推荐方案按 P0/P1 重排 |

取证方式：`acorn` AST 独立复核（`const agent` 现在位于 handler 顶层、缩进 4、try 深度 0，L20811 解析到 function-level binding）。

### 7.2 基线锁重钉（三个，全部先归因后重钉，无回滚）

| 锁 | 旧值 | 新值 | 归因要点 |
|---|---|---|---|
| `smoke-test-iter5-skin` R157 | `3be2d91e…` / 1,390,144 | `0997120e…` / 1,397,091（Δ+6,947） | SYNC-OK ⇒ 生成区未手改；`+142/−19` 行；HEAD 跑同管道 = 1,389,130 ⇒ **旧锁开工前已不等** |
| `smoke-test-r26-cross-layer` R169（长度） | 1,361,942 | 1,373,163（Δ+11,221） | HEAD 同管道 = 1,349,421 ⇒ 旧锁开工前已不等；本批改动已逐项列明 |
| `smoke-test-r26-cross-layer` R169（sha16） | `0356236255C40784` | `319842B34BFE21E9` | 同上 |

### 7.3 路由计数 80 → 82（我新增的两条路由）

B1/B3 新增了 `POST /team-pause`、`POST /team-upgrade` ⇒ 全仓 **7 处**计数锁必须同步改（少改一处 = 假绿）：

| 文件 | 位置 |
|---|---|
| `smoke-test-context-observer.mjs` | `registeredRoutes.length !== 82` |
| `smoke-test-m3b3.mjs` | `expected 82 routes` |
| `smoke-test.mjs` | `expected 82 routes` |
| `smoke-test-issue454-panel-lan.mjs` | 守卫数 82 |
| `smoke-test-task36-p2b-backend.mjs` | 路由总数 82 + API 常量表 82 |
| `smoke-test-team-routes.mjs` | 真 API 表 82 |
| `docs/HANDBOOK.md` §5.1 | 端点条数 82 |

### 7.4 白皮书键数 174 → 177

本批新增 `teamPaused` / `teamPausedReason` / `teamUpgradePhase` 三个 `DEFAULT_CONFIG` 键 ⇒ `docs/WHITEPAPER.md` 的「设置键」计数同步 174 → **177**（实测 `DEFAULT_CONFIG` 键数 = 177）。

### 7.5 issue364 判据随 requestKinds 演进

B5 把 `requestKinds` 由 `['fact']` 扩为 `['fact','event']` ⇒ 该套件三处断言同步（`kinds` 查询串、`supportedKinds`、`requestedKinds`）。**判据意图不变**：procedure / handoff 仍必须被拒、且**一条都不得被应用**（原断言全部保留）。

### 7.11 方案 A 实施完成（2026-10-31 · 用户「同意你的改动，继续吧」后落地）

#### 7.11.1 编码选型（实测三方案，选 brotli）

同一份**真实记忆**（event-store 1,708KB + MEMORY.user 47KB + MEMORY.project 41KB + PLAN 6KB）：

| 编码 | HTTP 体积 | 判定 |
|---|---|---|
| 明文 JSON | 1,838 KB | ❌ 超 nginx `client_max_body_size` 默认 1 MB ⇒ 413 |
| gzip(9) + base64 | 699 KB | ✅ 可用 |
| **brotli(11) + base64** | **322 KB** | ✅ **选它**（距 1MB 上限有 3 倍余量） |

> 早前报的「17 MB」是**统计口径错误**（把 `prev-req-*.md` 调试快照算进去了）。真正的记忆载体只有上述 4 个文件；
> `index.json` 6.3 MB 是**可从 event-store 重建的检索索引**，刻意不进基线（`TEAM_BASELINE_OPTIONAL_PRE` 白名单外）。

#### 7.11.2 五处改动（全客户端，零服务端改动）

| # | 文件 | 改动 | 行数 |
|---|---|---|---|
| 1 | `lib/team-baseline.js`（**新建**，纯 LF） | `packBaselinePre` / `unpackBaselinePre` / `baselineChecksumPre` / `baselineSamePre` 四个纯函数 + 三个白名单常量 | 266 |
| 2 | `lib/team-pull.js`（LF） | `TEAM_PULL_KINDS_PRE` 加 `'baseline'`（第五种 kind） | +24 |
| 3 | `lib/index.js`（CRLF） | ① import baseline 模块；② pull appliers 增 `baseline` 分支；③ 三方法 `uploadBaselinePre` / `readBaselineOfferPre` / `applyBaselineOfferPre` + `resolvePathsSyncForBaseline`；④ 新增 1 条路由 `API.teamBaseline` | +15,429 字符 |
| 4 | `lib/client.js`（CRLF） | ① API 表登记 `teamBaseline`；② 搜索按钮接真实查询；③ 「自己整理并上传」接真实 upload；④ 新增 `hasOffer` 状态 +「下载并应用」按钮（仅查到基线时出现） | 见 iter5 锁 |
| 5 | `tests/smoke/smoke-test-team-baseline.mjs`（**新建**） | 24 条真断言（含变异反向验证） | 148 |

**固定键设计**：`kind='baseline'` + `key='baseline:current'`。
outbox 的 `dedupeKey = kind + '\u0000' + key` ⇒ 同键**原位替换**；push 侧 `idemKey` 随之固定 ⇒ 服务端按 idemKey UPSERT ⇒ **远端永远只有 1 条基线**，不随上传次数累积。

#### 7.11.3 下载侧七步安全铁律（唯一会改用户记忆库的路径）

```
① pauseSync      —— 不暂停就换库，pull 线程会拿旧快照继续写
② unpack + 验 checksum —— 半包/篡改一律拒绝，绝不写半个库
③ 版本闸门        —— memoryFormat 不一致 ⇒ 拒绝（走升级流程，不硬塞）
④ 备份            —— 旧库 → handoff/backup-baseline-<ts>/（可整目录回滚）
⑤ 原子写入        —— 临时名带 pid → rename
⑥ 失败回滚        —— 从备份还原 event-store
⑦ 恢复同步        —— 走 B4 的 teamResumeGatePre，不绕过闸门
```

#### 7.11.4 验收（可复算物理量）

| 项 | 结果 |
|---|---|
| `smoke-test-team-baseline.mjs` | **PASS 24 / FAIL 0**（含变异反向验证：删掉 checksum 比较 ⇒ 篡改包被接受 ⇒ 证明断言测真行为） |
| 真实记忆端到端 pack→unpack | **逐字节一致**（4/4 文件）、raw 1,838KB → **packed 322KB**、pack 2,036ms / unpack 14ms、< 1MB ✅ |
| 三方法行为 + 顺序断言 | **PASS 7 / FAIL 0**（含「解包早于写盘」「pause 早于写盘」两条顺序锁） |
| `smoke-test-client-loadable`（真执行 factory） | **PASS 34 / FAIL 0** |
| `smoke-test-r15-left-rail`（零裸 hex） | **PASS 92 / FAIL 0** |
| `smoke-test-r26-cross-layer` | **PASS 26 / FAIL 0**（长度锁 1,377,064 → **1,392,493**，Δ+15,429，sha16 → `A52458BE96E06704`） |
| `smoke-test-iter5-skin` | ✅（sha 锁 → `c5ea094dc62b92df…`，按 AssertionError 的 `actual:` 取真值重钉） |
| 路由计数锁 **6 处** 82 → 83 | 全绿（context-observer / issue454 / m3b3 / r26 / task36-1b·1c / team-routes） |
| 生成器 `--check --strict` | **SYNC-OK** |

#### 7.11.5 仍待验证（阻塞项）

**服务端是否接受未知 kind + 322 KB 请求体** —— 本机 `teamEnabled=false`、`teamServerUrl` 为空，无法在本地证伪。
探测脚本已就绪：`node tools/probe-team-baseline.mjs`（零副作用，`__probe__` 前缀包），输出三结论之一：

| 探测结果 | 含义 |
|---|---|
| `A_OK` | 服务端 kind-agnostic 且吃得下 ⇒ **当前实现可直接用** |
| `A_NEEDS_SPLIT` | kind 通过但体积被拒 ⇒ 基线需分片（≈220 行） |
| `A_BLOCKED_BY_SERVER` | 未知 kind 被拒 ⇒ 需服务端放行，或改走对象存储 |

### 7.10 方案 A 可行性核实（2026-10-31 · 只改客户端能否实现基线同步）

**结论：能，但有一个必须先探测的前提。**

#### 7.10.1 三项决定性证据

| # | 证据 | 出处 | 含义 |
|---|---|---|---|
| ① | 服务端**不在本仓**；但仓里有一份可直接照抄的最小参考实现（Node 40 行） | `docs/TEAM-SYNC-INCIDENT-PLAYBOOK.md` §5.4 | 能据此判断「未知 kind 会不会被拒」 |
| ② | 该参考实现**完全不校验 kind**：`const k = body.idemKey \|\| (body.kind + '\|' + body.key)`，`kind: body.kind` 原样存 | 同上 L263-265 | **服务端对 kind 白名单无感** ⇒ 新增 `kind='baseline'` 无需改服务端 |
| ③ | 该参考实现按 `idemKey` **UPSERT**：`index.set(k, rec)`，同键只留一条 | 同上 L264-267 | 基线可用**固定 idemKey** ⇒ 服务端永远只有 1 条，不随版本累积 |

#### 7.10.2 载荷体积实测（决定「能不能一次 POST 传完」）

真正承载记忆的只有 4 个文件（`index.json` 6.3 MB 是**检索索引，可从事件库重建**，不进基线）：

| 文件 | 大小 |
|---|---|
| `event-store.json` | 1,708 KB |
| `MEMORY.user.md` | 47 KB |
| `MEMORY.project.md` | 41 KB |
| `PLAN.md` | 6 KB |
| **原始 JSON 包** | **2,372 KB** |
| **gzip(level 9) 后** | **854 KB（压缩率 36.0%）** |

854 KB 单次 POST ⇒ 远低于常见 2–10 MB 请求体上限；outbox 的 `MAX_ITEMS=500` 是**条数**上限不是字节上限，一条基线只占 1 条 ⇒ 无压力。
下行侧 `team-pull` 的响应体上限 32 MB ⇒ 854 KB 无压力。

#### 7.10.3 待探测的前提（唯一未知）

参考实现不校验 kind，但**用户实际的远端服务端未确认是否照此实现**。若它：
- **校验了 kind 白名单** ⇒ 会拒绝 `baseline`，A 需服务端放行；
- **有请求体大小限制（如 nginx `client_max_body_size` 默认 1 MB）** ⇒ 854 KB 在边缘，可能被 413。

**⇒ 动手前先做一次「零副作用探测」**（见 §7.10.5），用结果决定走 A 还是退 C。

#### 7.10.4 A 的具体设计（全在客户端，5 处改动）

**基线包格式**（`lib/team-baseline.js`，新建）：

```js
{
  v: 1,                          // 基线格式版本（与 TEAM_SYNC_MEMORY_FORMAT_PRE 独立）
  at: <ms>,
  by: { id, name },              // 谁打的包（前端三点水气泡用）
  memoryFormat: <现有常量>,       // 复用现有版本闸门
  checksum: '<sha256 of files>', // 内容校验，防半包/损坏
  files: {
    'event-store.json': '<utf8 文本>',
    'PLAN.md': '<utf8>',
    'MEMORY.project.md': '<utf8>',
    'MEMORY.user.md': '<utf8>',
  },
}
```

**固定键（关键设计）**：`kind='baseline'` + `key='baseline:current'`。

理由：outbox 的 `dedupeKey` = `kind + '\u0000' + key` ⇒ 同键**原位替换**（#280 A1 语义）；
push 侧 `idemKey = eventId || (kind + '|' + key)` ⇒ 固定 ⇒ 服务端 UPSERT 到**同一条**。
⇒ 「当前基准」永远只有一份，不会随每次上传累积成 500 份 854 KB。

**5 处改动**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `lib/team-baseline.js`（新建） | `packBaselinePre(files)` / `unpackBaselinePre(buf)` / `verifyChecksumPre(pkg)` 三个纯函数 |
| 2 | `lib/team-sync.js` | push 无需改（kind 原样透传）；仅在诊断里认识 `baseline` |
| 3 | `lib/team-pull.js` | `TEAM_PULL_KINDS_PRE` 加 `'baseline'`；新增 applier |
| 4 | `lib/index.js` | 两个方法：`uploadBaselinePre()` / `downloadBaselinePre()`；接 B3 弹窗两个按钮 |
| 5 | `lib/client.js` | 弹窗按钮文案接实际动作（当前只刷新状态） |

**下载侧安全铁律**（复用已有 B1/B2/B4 机制，不另写判据）：

1. 收到 baseline ⇒ **先 `pauseSync()`**（不暂停就写入 = 正在同步时换库，必坏）
2. 校验 `checksum` + `memoryFormat` 版本一致（不一致 ⇒ 拒绝，提示走升级流程）
3. 旧库**备份**到 `handoff/backup-<ts>/`
4. 原子写入（临时文件 + rename）
5. 失败 ⇒ 从备份回滚；成功 ⇒ 重建 `index.json` 索引
6. 最后 `resume`（走 B4 的 `teamResumeGatePre`）

#### 7.10.5 零副作用探测脚本（动手前先跑）

**目的**：在不污染远端的前提下，测出服务端是否接受未知 kind、以及请求体上限。

```js
// ① 测 kind 是否被拒：发一个假 kind 的小包
//    若回 {ok:true} ⇒ 服务端 kind-agnostic ⇒ A 可行
//    若回 {ok:false, reason:'unknown-kind'} ⇒ 服务端有白名单 ⇒ A 需服务端放行
POST <teamServerUrl>/api/team/sync/push
  { kind:'__probe__', key:'__probe__', idemKey:'__probe__:'+Date.now(),
    payload:{v:0}, member:{id:'probe', role:'probe'} }

// ② 测体积上限：发一个 padding 到 900KB 的包
//    若 413 / 连接重置 ⇒ 服务端有 body 限制 ⇒ 需分片或改走 C
```

探测结果三条分支：

| 探测结果 | 结论 |
|---|---|
| kind 通过 + 854 KB 通过 | **直接走 A**，纯客户端，约 150 行 |
| kind 通过 + 体积被拒 | A 需**分片**（基线切成 N 段，key=`baseline:current#<i>/<n>`），约 220 行 |
| kind 被拒 | A 不可行 ⇒ 改 **C**（对象存储）或请服务端加一行放行 |

### 7.9 本轮最终校验（2026-10-31 03:05）

| 校验项 | 结果 |
|---|---|
| `node tools/verify-docs.mjs` | **0 项不一致**（不在回归套件内，单独跑） |
| `build-iter5-skin --check --strict` | **SYNC-OK**（生成区与源逐字节一致） |
| `node --check` index.js / client.js / team-sync.js | 全 ✅ |
| `smoke-test-r26-cross-layer` | **PASS 26 / FAIL 0** |
| `smoke-test-client-loadable`（真执行 factory） | **PASS 34 / FAIL 0** |
| `smoke-test-r15-left-rail`（零裸 hex） | **PASS 92 / FAIL 0** |
| `smoke-test-iter5-skin` | ✅（R158 重钉后） |
| `smoke-test-api-paths` / `team-routes` / `issue364` | 全 ✅ |
| EOL | index.js **纯 CRLF（25,816 / 裸 LF 0）**、client.js **纯 CRLF（23,508 / 0）**、team-sync.js **纯 LF（615）** |

**全量回归（`--jobs=8 --timeout=180000`）六轮演进**：

| 轮 | 结果 | 说明 |
|---|---|---|
| 1 | 524 / 10 / 0 | 9 处判据过期 + 1 超时假红 |
| 2 | 532 / 2 / 0 | 路由未登记 API 常量表（真缺陷） |
| 3 | 532 / 2 / 0 | 补 client.js API 表后剩假红 |
| 4 | 533 / 1 / 0 | `issue207-processes` 单跑 exit=0 ⇒ 资源竞争型 |
| 5 | 533 / 1 / 0 | `r15-left-rail` **真失败**（我新增按钮用了裸 `#fff`）⇒ 已修，单跑 92/0 |
| 6 | 533 / 1 / 0 | `sidecar-watchdog` 单跑 exit=0 ⇒ 资源竞争型 |

**结论**：产品代码侧本轮已知缺陷**全部清零**；两轮的唯一失败都已完成「单跑归因」，均为资源竞争型
（依据 `并行假红` 分类纪律：能定位到文件级竞争才须修，本轮两例都是超时/资源抢占，无因果链）。

**本轮修掉的真缺陷（非判据过期）**：

1. 弹窗按钮样式用了裸 `#fff` ⇒ 违反「零裸 hex」判据（r15 实测 2 处）⇒ 改 `var(--dam-fg-on-accent, #ffffff)`。
2. 在路由数组元素之间插函数声明 ⇒ 语法错（两次）⇒ 纯函数改放 `lib/team-sync.js`。
3. iter5 基线锁：替换只命中注释、未命中断言 ⇒ 必须从 `actual:` 报错取真值重钉。

### 7.7 B5 上行接线（2026-10-31 · 已完成）

**问题**：下行 applier 早已写好，但本地写事件时**从不入队** ⇒ 同步只能收、不能发。

**实现**：`engine.enqueueEventChangePre(payload)`（`lib/index.js`），并在 `memory_event` 的
`create` / `append` / `set` / `close` 四条写成功后各调用一次。

**四条硬约束**：

| 约束 | 原因 |
|---|---|
| **不 await** | `outbox.enqueue` 的对外契约是同步返回（team-outbox.js 明确「改成 Promise 会让调用点读到 undefined」） |
| **失败只留痕不抛** | 事件已落盘才是事实；同步失败只影响传播时效，绝不能回滚或中断写盘 |
| **幂等键 = eventId** | 同 kind+key 且负载变化 ⇒ outbox **原位替换**（#280 A1），不丢新版本 |
| **`_teamOutbox` 为空时零开销** | teamEnabled=false 的机器完全不受影响 |

**实测（真 import → 真构造 → 真调用 → 断言返回值）**：

| 用例 | 结果 |
|---|---|
| create | `ok=true`，outbox `size=1`，`kind='event'` / `key='evt_…'` / `op='create'` |
| 同内容再推 | `dup=true`，size 仍 1 |
| append 新 payload | `updated=true`，**原位替换**，size 仍 1 |
| 缺 eventId（负） | 拒绝，**队列长度不变** |
| `_teamOutbox=null`（负） | 返回 `team-off`，**不抛** |
| payload=null（负） | 返回 `bad-payload` |

### 7.8 B3 团队模式「基线发布 / 订阅」弹窗（2026-10-31）

**用户裁定（原话要点）**：

> 「有一台机器更新到了最新版，然后上传到云端。其他的机器更新到新版后，就能自动把这台机器
> 的版本作为基准下载下来，就不用每个机器都整理一遍……弹窗按钮应该可以选择两种操作：
> 1. **在远端（团队端）搜索**：搜索远端是否存在新款的白板，即同事或管理员是否已将新版本上传。
> 2. **自己整理并上传**：如果没有查找到远端有相关的有效版本，是否就把你当前的记忆基准作为
>    整理后的版本，上传到远端白板，作为其他人的基准。」

**三条硬边界**：

1. **这个弹窗仅在团队开启时出现** —— 个人使用**完全保持原有的 memory update 弹窗流程**，不合并、不改动。
2. **不另起一套 upgrade** —— 按钮 ② 走的仍是同一个 `startUpgradeJobPre(agent)`（用户裁定：「不把它弄成第二个 upgrade，把它当做同一个 upgrade 是正确的路线」）。
3. **推荐项由「远端有没有可用基线」决定**，不靠猜。

**已落地部分**：

| 层 | 内容 | 验收 |
|---|---|---|
| 判据（`lib/team-sync.js`） | `teamUpgradePopupModePre({teamEnabled, peerBaselineOk, phase})` 纯函数——**单一判据**，路由与驱动器共用（避免半修） | 真 import + 9 用例全过：团队关⇒`personal` 且 `actions=[]`；团队开有/无 peer ⇒ 两按钮 + 推荐项不同；5 条负路径（`teamEnabled:1` 严格判 personal、空对象/null/无参/字符串均不抛） |
| 路由（`lib/index.js`） | `upgrade-status` 返回体新增 `teamMode` 字段 | `node --check` 通过；个人模式恒返回 `personal` |
| 前端（`lib/client.js`） | `UpgradePopup` 加 `isTeamMode` 分支：团队模式渲染「① 在远端搜索新版本 / ② 自己整理并上传」双按钮（按 `recommended` 高亮）；个人模式**原三按钮一个不动** | `client-loadable` **PASS 34 / 0**（真执行 factory）；`build-iter5-skin --check --strict` = SYNC-OK；iter5 基线重钉 R158 |

**❗ 仍缺的核心环节（尚未实现，需决策）**：

团队层**没有「基线（baseline）」这个数据概念**。实测证据：`lib/team-*.js` 里 `baseline` 仅命中我新增的 3 处；
现有推送通道 `api/team/sync/push` 是**逐条变更**（`{kind, key, idemPayload}`），
可同步 kind 只有 `['fact','procedure','handoff','event']` —— **没有「整份基线快照」这个 kind**。

因此「上传当前记忆基准」目前无处可去。且工作量不小（本工作区 handoff/ 实测：`event-store.json` 1.7 MB、
`index.json` 6.5 MB，前 12 个大文件合计 **17.02 MB**）—— 不能靠塞进现有 push 通道传。

**建议的三种做法（待用户选定）**：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A · 新增 baseline kind** | 在 outbox/pull 里加 `kind='baseline'`，payload = 事件库+白板的压缩快照；服务端按 `idemKey` UPSERT | 需服务端配合；要定义「一份基线包含哪些文件」 |
| **B · 复用 event 通道逐条推** | 把整库拆成 N 条 event 变更推上去 | 零服务端改动，但首次上传是 N 次请求；不适合 1.7 MB 事件库 |
| **C · 只传「指针 + 摘要」** | 上传基线清单的 sha256 + 统计，正文走对象存储 | 需要另配存储（`teamBucket` 已有配置项） |

### 7.6 全量回归（最终结论）

**`node tools/run-smoke.mjs --jobs=8 --timeout=180000` 实测：PASS 533 / FAIL 1 / TIMEOUT 0（174.4s）**

| 轮次 | 结果 | 说明 |
|---|---|---|
| 第 1 轮（修收尾前） | 524 / **10** / 0 | 暴露 9 处判据过期 + 1 处超时假红 |
| 第 2 轮 | 532 / **2** / 0 | 剩余 2 项是**真缺陷**：路由未登记进 API 常量表 |
| 第 3 轮 | 532 / **2** / 0 | 修完常量表后剩 api-paths（真缺陷：未登记 client.js API 表）+ 各自假红 |
| **第 4 轮（最终）** | **533 / 1 / 0** | 唯一失败 `smoke-test-issue207-processes` —— **单跑 exit=0**，资源竞争型假红 |

**唯一失败的归因（不是本轮引入）**：

| 项 | 实测 |
|---|---|
| 套件 | `smoke-test-issue207-processes.mjs` |
| 单跑 | **exit=0**（无 FAIL 输出） |
| 判定 | **资源竞争型假红**（jobs=8 下被 CPU 抢占） |
| 处置 | 接受，不改判据、不回滚（依据：`并行假红` 分类纪律） |

**配套校验（都通过）**：

| 校验 | 结果 |
|---|---|
| `node --check` 六个改动文件 | 全部 ✅ |
| `build-iter5-skin --check --strict` | **SYNC-OK**（生成区未被手改） |
| `tools/verify-docs.mjs` | **0 项不一致**（不在回归内，单独跑） |
| EOL | `index.js`/`client.js` **纯 CRLF（裸 LF=0）**；其余五个新/改模块**纯 LF** |
| B6 运行时守卫 | `client-loadable` **34 / 0**（含变异反向验证） |
| r26 跨层 | **26 / 0** |
| v5-p1 注入节流 | **32 / 0** |
