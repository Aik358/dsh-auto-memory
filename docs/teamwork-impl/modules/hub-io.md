
## hub-io

- **规模**：28,346 B / 571 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**M8 记忆中枢（Memory Hub）持久化 IO —— 带健康度记账的 io 适配器**（#110，2026-09-22）。
**背景（为什么需要这个模块）**：hub 三店（episodes / facts / procedures）的 `io` 由 `index.js` 内联的 `hubIo()` 提供，旧实现三个方法各自 `catch (_) {}` 把异常**吞在适配器这一层**：
1. 上层三店在 A-8 里写好的 `try { io.save(snapshot()) } catch (e) { … ok:false … }` **永远走不到 catch 分支** ⇒ store 照样返回 `{ ok:true, persisted:true }`，`persistFailures` 恒为 0、`lastPersistError` 恒为 null ⇒ **三条线全绿而磁盘没写上**；
2. 用户侧表现为「记忆看着存上了，重启清零」，日志、计数、面板三处都拿不到信号。
⇒ 现在语义收紧为三条：`save` / `clear` 失败**照原样抛出**，失败**逐文件记 health**（含 errno 人话）并走 `onError`。

### 数据流

```
store（三店）──▶ io.save(snapshot)  L131
                  ├─ 批内（beginBatch 之后）→ 只登记 pendingWrites（**批内合并落盘**）L105-106
                  └─ 批末 endBatch → flushPendingPre()  L114 → atomicWrite()  L108
                       ├─ mk(dir, {recursive:true})
                       ├─ tmp = file + '.tmp'      ← ⚠️ **固定名（见风险）**
                       ├─ wf(tmp, JSON.stringify(data))
                       └─ rn(tmp, file)            原子替换
                  io.load()  L145 / io.clear() L162

健康度：createHubIoHealthPre()  L55 → notePre L63（逐文件记 errno 人话）
        hubIoHealthSnapshotPre() L186   ★ 可查询状态
        HUB_IO_ERRNO_MESSAGES_PRE_V1 L30 / explainHubIoErrorPre L46

工作区作用域：createScopedHubIoPre(opts)  L257
        ├─ ioFor(dir)  L271   每目录一个既有工厂（**复用其原子写与 health 记账**）
        ├─ wsNow()     L283   取当前工作区；异常退化为未知 ⇒ 走"不写"约束
        ├─ readOne(dir) L294  读一份；**文件存在但解析失败 ⇒ 记入 corrupt（供 save 拒写）**
        ├─ save L326 / clear L374 / migrate L403 / list L404
        └─ 拒写统计：skippedUnknownWs / skippedForeign / refusedCorrupt（L278-280）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L30 | `HUB_IO_ERRNO_MESSAGES_PRE_V1` | errno → 中文人话映射 |
| L46 | `explainHubIoErrorPre(e)` | 错误解释 |
| L55 | `createHubIoHealthPre()` | 健康度记账器 |
| L87 | `createHubIoPre(opts)` | **单目录 io 工厂** |
| L186 | `hubIoHealthSnapshotPre(...)` | 健康度快照（可查询状态） |
| L257 | `createScopedHubIoPre(opts)` | **工作区作用域 io** |

### 内部关键实现

**1. 批内合并落盘（L98-104）**

注释逐字：*"★#110：**批内合并落盘**（消除写放大）。背景：hub 一次喂数会连续写同一份快照 N 次（每行判据 upsert 一次 ⇒ 一次整份写盘）。做法：批内只记「最后一次的整份数据」，批末统一原子落盘。**语义无损** —— 每份快照都是全量，最后一次即最终状态。"
**明确声明的代价**（L102-103）：*"批未落盘时进程被杀，本批持久化会丢。这批是「机器切出来的流程观察行」，源头 judgement-shadow 文件仍在、可重放，**不涉及用户数据**。"*
⇒ **"可重放"是接受该代价的前提**。团队化新增任何批语义，都必须在注释里同样声明"丢了能不能重放"。

**2. 失败不静默（L104）**

*"失败**不静默**：逐文件记 health（含 errno 人话）并走 onError；返回值把 ok/written/errors 交出去。"*

**3. 固定名 tmp（L110）—— 已确认缺陷**

`const tmp = file + '.tmp'`：tmp 名**只由目标路径决定**。这与 `config-io.js:50` 已修复的缺陷（issue #82）**同型**，也与用户既有判据一致：*"固定名 .dam-tmp 属同型缺陷第三次出现（lib/config-io.js 曾以 issue #82 修过），原子写临时文件名必须带 pid + 序号"*。
同一缺陷在仓内第三次出现的位置还包括 `recall-stats.js:123`。

**4. corrupt 拒写（L294-300）**

`readOne` 发现"文件存在但解析失败" ⇒ 记入 `corrupt` 集合 ⇒ 后续 `save` **拒写**该目录。
⇒ 这是**防止把损坏覆盖成"看起来正常"**的保护：坏文件先保留现场，不静默重建。

**5. 作用域约束的"不写"三态（L278-280）**

`skippedUnknownWs`（工作区解析失败）/ `skippedForeign`（不属于本作用域）/ `refusedCorrupt`（目录损坏）—— 三种**拒绝写入**都有计数，不做静默跳过。

### 与团队化的关系

**判定：S0 私有（本地 IO 适配器）+ S2（团队目录需独立的 hub-io 实例）。**

理由：hub-io 是**本机文件 IO 的适配器**（路径、原子写、健康度），本身不含记忆内容 ⇒ 不同步。
**但团队化需要第二个实例**：`createHubIoPre({ dir: teamMemoryDir(groupId) })` —— 复用同一套原子写与健康记账，**不新建第二套 IO 实现**（本模块 L269 就是这么做的："每目录一个既有工厂（复用其原子写与 health 记账；不新建第二套 IO 实现）"）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| HI1 | `atomicWrite` L108 | **固定名 tmp** | 改为带 pid + 序号（与 config-io:50 同款） | **修复既有缺陷**，必做 |
| HI2 | `createScopedHubIoPre` L257 | 单作用域 | 增加团队目录作为**第二作用域**（不是把团队混进个人） | 新增参数 |
| HI3 | 健康度 L55 / L186 | 本地 | 团队 io 的健康度**并入同一 snapshot**（带 scope 标） | 结构新增 |
| HI4 | `corrupt` 集合 L276 | 本地拒写 | 团队目录损坏时**必须上报**（否则团队成员看不到） | 接线 |
| HI5 | 批语义 L98-104 | 明确声明可重放 | 团队批次的"可重放性"必须逐条声明 | 纪律 |

#### 可直接落地的代码片段

**片段 1**：修复固定名 tmp（**这是本模块的既有缺陷修复，团队化前必做**）。位置：`hub-io.js:108`（`atomicWrite` 函数内）。

```js
// ★ 修复（与 config-io.js:50 同款纪律）：原子写的 tmp 名必须**唯一**。
// 病症：tmp 名原先只由目标路径决定（file + '.tmp'）⇒ 对同一目标并发保存时，
//       两个调用写同一个 tmp，一个 rename 后另一个 rename 会 ENOENT 或写错内容。
// 团队化会把并发写概率显著提高（同步回写 + 本地写入可能同时发生），
// 因此这条修复是团队化的**前置条件**，不是可选优化。
let _hubTmpSeqPre = 0

function atomicWrite(file, name, data) {
  mk(dir, { recursive: true })
  // 唯一段 = pid + 进程内自增序号（跨进程靠 pid 区分，同进程靠序号区分）
  const tmp = file + '.tmp-' + process.pid + '-' + (++_hubTmpSeqPre)
  wf(tmp, JSON.stringify(data), 'utf8')
  rn(tmp, file)
}
```

**片段 2**：团队目录作为独立作用域（新增导出，放文件末尾）。**复用同一工厂，不新建 IO 实现。**

```js
/**
 * 团队作用域的 hub io —— **复用 createHubIoPre，不新建第二套 IO 实现**。
 *
 * 为什么必须复用（见 L269 的既有注释"每目录一个既有工厂（复用其原子写与 health 记账；
 * 不新建第二套 IO 实现）"）：另写一套会立刻产生第二个真源 ——
 * tmp 命名、健康记账、fail-soft 抛错语义都会分叉，
 * 而本仓已有教训：同一语义两处实现 ⇒ 会出现"有的路径能解析、有的恒判失败"的半修状态。
 *
 * @param {{teamDir:string, health?:object, onError?:Function, fsApi?:object}} opts
 * @returns {{ok:boolean, io:object|null, reason?:string}}
 */
export function createTeamHubIoPre(opts) {
  const o = opts || {}
  const dir = String(o.teamDir || '')
  if (!dir) return { ok: false, io: null, reason: 'no-team-dir' }
  // 直接复用单目录工厂：原子写、health 记账、抛错语义全部继承
  const io = createHubIoPre({ dir: dir, health: o.health, onError: o.onError, fsApi: o.fsApi })
  return { ok: true, io: io }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **失败被吞（模块存在的理由）** | 新增代码再次 catch 后不抛 | L104 纪律；回归覆盖"写失败必须抛" |
| **固定名 tmp 撞车** | 并发写同一目标 | 片段 1 修复（**必做**）；对照 config-io:50 与 recall-stats:123 |
| **批内丢失无声明** | 新增批次未说明可重放性 | HI5 纪律；L102-103 是范例 |
| **团队目录损坏被静默重建** | 复用 corrupt 判据时跳过 | HI4：团队损坏**必须上报** |
| **第二套 IO 实现** | 另写团队专用 IO | 片段 2 复用工厂；L269 注释是既有纪律 |

**既有测试/守卫**：`hub-io` 的原子写用例、health 记账用例、scoped io 的拒写三态用例。**片段 1 改变了 tmp 名格式** ⇒ 若有守卫断言 `file + '.tmp'` 字面量会打红（需同步更新，这是**修复不是破坏**）。
