# dsh-auto-memory 团队协作现状白皮书（TEAMWORK-GUIDE）

> 面向：想启用团队协作、或评估本插件团队能力的用户与集成方。
> 承诺：**单机（未启用团队）全功能可用**；团队开关关闭时行为与纯本机版本**逐字节一致**。
> 本文所有键名/路由/边界均与 lib/index.js、lib/team-*.js 实际代码对拍（2026-09-28）。

---

## 0. 一句话现状

团队协作 = **在既有本机记忆之上，加一层「出站队列 + 下行合并 + 归属追踪」的同步层**。
当前实装：本机身份的登记、S3/HTTP 双传输通道的出站同步与心跳、条目级冲突三方合并（带冲突中心）、
「谁改动」归属索引、成员在场/筛选 UI、团队技能审批、多端日历双轨。
**未实装**：服务端协议的多端 presence（others 恒空，如实标注）、端到端加密（`teamE2E` 仅做「明示不可用」，不加密）。

---

## 1. 设计纪律（三条硬规则，先读）

1. **单机零影响**：`teamEnabled !== true` ⇒ 零网络、零同步元数据、零 UI 变化。所有团队组件在该档下不渲染（或渲染为「本机态」说明条，见 §6）。回归守卫：`smoke-test-r17-dual-surface.mjs` / `smoke-test-r29-team-layer.mjs`。
2. **开关正交**：任一团队子开关不得顺带改变其他功能的行为（用户明确要求）。例：`teamInjectEnabled` 只管注入文本是否带团队快照，不影响本机注入。
3. **不可用必须明示，严禁静默降级**：能力没实装（如 E2E）就回 `{ok:false, reason:'e2e-unsupported'}`，绝不假装已加密/已同步。

---

## 2. 配置项（全部在 设置 → 团队协作；键 = lib/index.js DEFAULT_CONFIG）

| 键 | 默认 | 说明 |
|---|---|---|
| `teamEnabled` | `false` | **总开关**。关闭 = 纯单机，零网络零元数据。 |
| `teamSyncTransport` | `'s3'` | 传输通道：`s3`（S3 兼容，含内网 MinIO）/ `http`（T2 自建服务端，涉密内网） |
| `teamEndpoint` | `''` | 同步服务端点（空 = 不出站） |
| `teamBucket` / `teamRegion` | `''` | S3 桶与区域 |
| `teamPathStyle` | `true` | 阿里云 OSS / MinIO 需 true；AWS 原生 false |
| `teamAccessKeyId` / `teamSecretAccessKey` | `''` | S3 凭据 |
| `teamProjectId` | `''` | 团队项目 ID（空 = 由 git remote 派生） |
| `teamSyncIntervalMs` | `5000` | 同步心跳最小间隔（防抖，非轮询周期） |
| `teamOutboxMaxItems` | `500` | 出站队列上限（超限丢最旧并记降级） |
| `teamMaxConflicts` | `200` | 冲突中心上限 |
| `teamConflictPolicy` | `'keep-both'` | 冲突策略：`keep-both` 只记录不覆盖 / `ask` / `mine` / `theirs` |
| `teamInjectEnabled` | `false` | 注入层是否携带团队快照（默认关 = 注入文本逐字节不变） |
| `teamShowMemberBadges` | `true` | 成员头像/标记/「谁改动」摘要显示开关（2026-09-28 正式接线） |
| `teamE2E` | `'off'` | `'unsupported'` = 客户声明要求 E2E 但未实装 ⇒ 团队功能明示不可用（**不加密任何数据**） |
| `teamUsageReport` / `teamUsageLog` | `false` / `''` | 行为数据上报（默认关；开也只写本机文件，**零出网**） |
| `teamDerivedDebounceMs` | `2000` | 派生量重算防抖 |

---

## 3. 数据流（一张图）

```
本机记忆写入 ──► 归属索引 team-attribution.json（谁·改了什么·何时，条目级）
                    │
                    ▼
             出站队列 team-outbox（上限 500，超限丢最旧）
                    │  按 teamSyncIntervalMs 防抖
                    ▼
     传输层 team-transport（s3 | http）──► 团队端 / 桶
                    │
                    ▼
     下行拉取 team-pull ──► 三方合并 team-merge ──► 冲突中心（人工裁决）
                    │
                    ▼
     派生重算 team-derived（成员聚合/筛选/统计，防抖 2s）
```

- **归属索引落盘**：`~/.dsh/team-attribution.json`（纯本地文件，**不碰任何 Markdown**）。
- **合并冲突**：默认 `keep-both`（只记录不覆盖）；裁决入口在 记忆面板 → 团队 → 冲突中心。

---

## 4. 路由（10 条，全部 loopback-only；`teamEnabled=false` 时仍 200 + `enabled:false`）

| 路由 | 方法 | 返回要点 |
|---|---|---|
| `/team-state` | GET | 原始团队状态（sync/pull/outbox/已知本机成员）；UI 与 attribution/conflicts/debug 四路单飞读取 |
| `/team-control` | POST | `{action:"pause",paused:boolean}` 本实例暂停；`{action:"reset-cursor",confirm:true}` 重置下行游标，不清空出站队列；仅 loopback |
| `/team-members` | GET | `{enabled, self, members, project}` —— 本机只知道「自己是谁」，**不编造其他成员** |
| `/team-presence` | GET | `{enabled, self, others, note}` —— `others` 恒空（多端 presence 需服务端协议，如实为空） |
| `/team-attribution` | GET | `{enabled, actor, calendar, attribution:{size,writes,items:[{key,memberId,memberName,at,op}]}}` —— **「谁改动」的数据源** |
| `/team-conflicts` | GET | `{enabled, policy, counts, conflicts}` |
| `/team-sync-debug` | GET | 诊断：identity/sync/outbox/board/derived/inject/transportError |
| `/team-sync-now` | POST | 立即触发一次同步（本机动作） |
| `/team-handoffs` | GET | `{enabled, pending, size}` |
| `/team-skills` | GET | `{enabled, count, candidates}` —— 团队技能审批候选 |
| `/team-compliance` | GET | 合规面（E2E 声明 / 上报状态等明示字段） |

---

## 5. 模块地图（lib/team-*.js，14 个）

| 模块 | 职责 |
|---|---|
| `team-identity.js` | 本机成员身份（id/name/role 的登记与解析） |
| `team-project-map.js` | 项目映射（由 git remote 派生 projectId） |
| `team-outbox.js` | 出站队列（上限/丢最旧/降级记录） |
| `team-transport.js` / `team-transport-http.js` | 传输层（S3 兼容 / 自建 HTTP） |
| `team-pull.js` | 下行拉取 |
| `team-merge.js` | 条目级三方合并 + 冲突中心 |
| `team-sync.js` | 同步心跳与编排（status/start/stop） |
| `team-attribution.js` | 「谁编辑了」条目级旁挂索引（Map 保序 + 原子写） |
| `team-derived.js` | 派生量（成员聚合/筛选/统计，防抖重算） |
| `team-board.js` | 团队看板投影 |
| `team-calendar.js` | 日历双轨（本机轨 / 团队轨） |
| `team-inject.js` | 团队注入段的预算仲裁（纯函数；关闭时注入逐字节不变） |
| `team-auth.js` | 凭据与授权面 |

---

## 6. 单机模式（未加入团队时的行为）

**单机全功能可用**——团队页不会因缺少团队配置而报错或白屏：
- 页面顶部挂「单机模式」说明条：本机记录（归属轨迹、冲突中心、技能审批）照常展示；
- 成员区显示「单机：暂无其他成员（本机记录照常可用）」而非「未加入团队」的死胡同；
- 多人同步与成员在场需要团队端点，说明条里如实指出配置位置。

---

## 7. 启用步骤

1. 设置 → 团队协作 → 打开 `teamEnabled`；
2. 填传输通道：`s3`（endpoint/bucket/region/凭据）或 `http`（endpoint）；
3. 填 `teamProjectId`（留空则自动由 git remote 派生）；
4. 回记忆面板 → 团队：先看**同步状态条**（phase/待同步数/上次同步/冲突数），再按需裁决冲突。

---

## 8. 已知边界（如实清单）

| 项 | 状态 |
|---|---|
| 多端 presence（看到谁在线） | **未实装**（需服务端协议；`others` 恒空并在 `note` 里说明） |
| 端到端加密 | **未实装**（`teamE2E` 只做「声明不可用」的明示，不加密数据） |
| 多端成员可见性 | 本机只见自己；多成员需服务端 upsert 后可见 |
| 团队皮肤分发 | 支持：放 `~/.dsh/memory/skins/team-<teamId>/`，作为团队层覆盖个人（见 SKIN-GUIDE / skins/README.md） |

---

## 9. 验收与守卫

- `tests/smoke/smoke-test-team-routes.mjs`：10 条路由真执行 + API 表计数锁。
- `smoke-test-r17-dual-surface.mjs`：两个承载面（会话页/浮层）数据同源 + 单机态一致。
- `smoke-test-r29-team-layer.mjs`：`teamFromState` 门控（无 state ⇒ null；单机 ⇒ localOnly 本机态）。
- `smoke-test-l3-team.mjs`：团队段零字面色值（§9.2）+ 复用既有定时器（零新增 setInterval）。
- `smoke-test-r18-fe02-screens.mjs`：fe02 八屏契约（锚点/顺序/接线点恰 1 处）。

---
*维护约定：改团队键/路由/模块，同提交更新本文；对不上以代码为准并回改本文。*

团队开关更改后需要重新加载宿主以构造或移除组件。卸载停止上/下行调度、使在途结果失效并中止鉴权通道请求；已发出的远端请求可能已执行，不能撤销其远端副作用。暂停/关闭之后不会再由该批发起后续请求、应用响应或推进游标。前端挂载面共享订阅及五秒只读轮询，最后一处卸载时停轮询。历史出站错误保留在诊断中，不据此将已恢复的当前同步状态判为离线。成员列表只映射已知自己，不编造远端 presence。

出站 HTTP 成功之后，还必须成功原子持久化出队快照，才能从内存出队并报告同步成功。rename/序列化/写盘失败时保留原磁盘与内存待恢复条目（包括请求期间新增条目），本次失败透传 sync/UI；恢复后重试成功才正常显示。历史错误继续保留诊断。HTTP 已确认但本机出队未提交的候选可能再次发送，未新增远端幂等协议。
