# 注入档位体系 · 交叉检验工单（Double Check · v2）

> 生成：2026-10-28 23:1x | 仓库 `D:\dsh-auto-memory` | HEAD `6330616b`（本轮修复未提交）
> `lib/index.js` = 1,350,440 字符 / sha16 `CE69098A2203786A`
> **本工单不只是「能不能跑」，主要是「逻辑对不对」。**

---

## §0 一句话结论

`post_compact` 档**前两次都修错了**——第一版判据恒假，第二版有竞态。**第三版**才是对的。

| 版本 | 判据 | 为什么错 | 如何发现 |
|---|---|---|---|
| v1 | `rt.contextVersion` 回退 | 该字段全仓只递增，**永不回退** ⇒ 判据恒假 | 诊断日志 `post_compact` 计数 = 0 |
| v2 | `rt.lastCompactionSeen` 递增 | 该字段在 `checkWaterLevel` 的 `await` **之后**才写；调用方 `void ... .then()` 不等待 ⇒ **竞态** | 我自查 `checkWaterLevel` 是 async |
| **v3（当前）** | `scanPressureSignalsPre(events).compactionSeq` | **同步纯函数**，无 await | 真执行验证（见 §2） |

**全量回归：PASS 530 / FAIL 1**（`smoke-test-v4-c4-tool-description` 单跑 39/0，已知 libuv 退出竞态）。

---

## §1 逻辑模型（检验基准）

### 1.1 档位 = 「谁在说话」×「给多少」

```
                全量(完整帧)      克制(精简帧)
真人发声        human_full        human_slim
运行中          run_full          run_slim
```
正交特殊档：`handoff_carry` / `post_compact` / `hang_compensate` / `legacy`

### 1.2 用户逐字裁定（权威）

**P0-3（run_slim）**：
> 「run_slim 应该是「最克制，只有功能指导」—— 那事件卡和画像就不该给，这是 human_slim 和 run_full 该干的事」

**post_compact**：
> 「压缩之后的就是 post compact…这个应该和 human full 一样是尽量多地提供相关内容的」

### 1.3 实测矩阵（真执行 `renderMemoryDynamic`）

| 档位 | 完整帧总字符 | 规则 | 白板 | 事件卡 | 画像 |
|---|---|---|---|---|---|
| `post_compact` | **24,576** | 8,291 全文 | 1,889 | 3,149 | 480 |
| `human_full` | **24,576** | 8,291 全文 | 1,889 | 3,149 | 480 |
| `handoff_carry` | 24,576 | 8,291 全文 | 1,889 | 3,149 | 480 |
| `human_slim` | — | 4,142 摘要 | 1,825 | 3,149 | 480 |
| `run_full` | — | 4,142 摘要 | 1,825 | 3,149 | 0 |
| `run_slim` | — | 4,142 摘要 | **0** | 3,149 | 0 |

**精简帧**：`run_slim` = 1,999（无事件卡/画像）；其余 = 2,180。

---

## §2 检验项 1：`post_compact` 触发链（**本轮核心，请重点验**）

### 2.1 三个候选判据的对比（这是「逻辑正确」的关键）

| 判据 | 是否同步可得 | 语义正确性 | 结论 |
|---|---|---|---|
| `contextVersion` 回退 | ✅ 同步 | ❌ **语义错误**：该字段语义是「observer 产生有效 Segment」，与压缩正交 | 弃用 |
| `rt.lastCompactionSeen` | ❌ **有竞态** | ✅ 语义正确 | 弃用（竞态） |
| `scanPressureSignalsPre(events).compactionSeq` | ✅ **同步纯函数** | ✅ 语义正确 | **采用** |

### 2.2 为什么 v2 有竞态（请独立复核）

```js
// lib/index.js:5871
async checkWaterLevel(agent) {
  // ...
  const winInfo = await this.resolveWaterWindow(...)   // ← L5928，异步让出
  // ...
  if (cseq > rt.lastCompactionSeen) {                  // ← L6042，写入发生在这里
    compacted = true; rt.lastCompactionSeen = cseq
  }
}

// lib/index.js:6267
void this.checkWaterLevel(agent).then(...)   // ← L6267，不 await，立即返回

// lib/index.js:20522
try { engine.checkWaterLevelAtStep(agent) } catch (eWL) {}   // ← 返回时 lastCompactionSeen 仍是旧值
```

**⇒ 若在 L2070x 读 `rt.lastCompactionSeen`，读到的是「上一次」的值，压缩当帧会漏判。**

**请核实**：`checkWaterLevelAtStep`（L6255）是否真的不含 `await`（它自己不是 async，内部用 `void ... .then()`）。

### 2.3 v3 实现（当前）

```js
try {
  const _evPC = sessionEventsOf(agent && agent.session) || []
  const _cseqNow = Number(scanPressureSignalsPre(_evPC).compactionSeq) || 0
  const _cseqSeenPre = Number(_stTier._compactSeqSeenPre) || 0
  if (_cseqNow > _cseqSeenPre) {
    _stTier._compactSeqSeenPre = _cseqNow        // 记基线，防重复触发
    if (_tierGuess !== INJECT_TIERS.HANDOFF_CARRY) {   // 保 isCarry 最高优先
      _tierGuess = INJECT_TIERS.POST_COMPACT
      _stTier._postCompactPending = true
    }
  }
} catch (_ePC0) {}
```

### 2.4 五条真执行用例（抽源码原文执行，非复刻）

```
抽取：lib/index.js L20723-20735 原文，new Function 执行
PASS ① 无压缩 0v0         → human_full
PASS ② 首次压缩 seq7 v0   → post_compact
PASS ③ 同帧重入 7v7       → human_full        （不重复触发）
PASS ④ 二次压缩 9v7       → post_compact
PASS ⑤ CARRY 保护 7v0     → handoff_carry     （契约未推翻）
结果: PASS 5 / FAIL 0
```

### 2.5 变异验证（**关键：证明用例真能抓错**）

```
变异A 去掉 > 比较（恒真）      → 必红 PASS 3 / FAIL 2  ✓
变异B 删 HANDOFF_CARRY 保护    → 必红 PASS 4 / FAIL 1  ✓
变异C 不记基线（永久触发）      → 单帧用例**未红** ✗
```

**⚠️ 变异 C 逃逸了，必须补状态机用例**：
```
真源码        : ["post_compact","human_full","human_full"]  ✓
变异C(不记基线): ["post_compact","post_compact","post_compact"]  ← 被抓住
```

**请判断**：单帧断言不足以验证有状态判据。**还有哪些状态遗漏？**
（我未覆盖：会话切换、插件重载、多 agent 并发、`_stTier` 被 reset 的场景）

---

## §3 检验项 2-5（其余改动）

### 3.1 `planCap` 与白板预算耦合（我引入过的回归）

**缺陷**：白板**渲染预算**提到 8,000，但桶**预留** `planCap` 仍是 1,200 ⇒ 桶超限 ⇒ 白板被 drop 成 0。

**当前修法**：让 `planCap` 与 `_planBudgetBase` 同源。

**逻辑质疑（请判断）**：
1. 这只是「抬高桶上限」还是「消除了真实的预算冲突」？
2. 更正确的做法是不是让 `_planBudget` 反过来受 `planCap` 约束？
3. 两个变量是否应合并成单一真源？

### 3.2 `event-cards` 从 `normal` 升为 `must`

**动机**：修前 `human_full` 事件卡被裁成 0，而 `run_slim` 反而保住——与设计意图相反。

**副作用**：`must` 不参与 drop ⇒ 同桶低优先级段（`recent-logs`/`reflection`/`event-catalog`）被挤掉。

**反问**：「当前在做什么」优先于「历史日志」是否成立？若模型需要回溯旧事而 `memory_recall` 未被调用，是否造成缺失？

### 3.3 `run_slim` 的取舍

`run_slim` 砍白板（0）+ 砍事件卡 + 砍画像，只留规则摘要。

**反问**：作为「最克制，只有功能指导」，**砍白板是否比砍事件卡更合理**？（当前实现砍了白板，保留事件卡）

### 3.4 `hang_compensate` 不做画像

**证据**：本段注释自述「运行档不该投画像…挂机自跑时投画像纯烧上下文」；`hang_compensate` 只在 `hangCompensateEnabled && isUnattendedNow()` 触发 = 正是挂机自跑场景。

**修法**：负向列举 → 正向名单（与 semantic-recall 同源）。实测画像 480 → 0。

---

## §4 历史欠条（**用户明确指出「有点多」，这是第二重点**）

### 欠条 1：`decideInjectTierPre` 的优先级契约 3/5 是死代码

```js
// 声明 5 级优先级：isCarry > postCompact > hangComp > isHuman > isFull
const decideInjectTierPre = (p) => {
  if (o.isCarry) return HANDOFF_CARRY        // ← 永不可达
  if (o.postCompact) return POST_COMPACT     // ← 永不可达
  if (o.hangComp) return HANG_COMPENSATE     // ← 永不可达
  if (o.isHuman) return o.isFull ? HUMAN_FULL : HUMAN_SLIM
  return o.isFull ? RUN_FULL : RUN_SLIM
}

// 全仓唯一调用点（L20694）：只传 2 个参数
let _tierGuess = decideInjectTierPre({ isHuman: _isHumanNow, isFull: true })
// ⇒ 只能产出 HUMAN_FULL / RUN_FULL
```

**真实优先级是在调用之后手工拼接的**：
```js
if (hangCompensateEnabled && unattended) _tierGuess = HANG_COMPENSATE;   // L20700
if (!ws && globalLedgerPath)             _tierGuess = HANDOFF_CARRY;     // L20705
if (cseq 递增)                            _tierGuess = POST_COMPACT;      // L20729（本轮新增）
```

**⇒「同一语义两份判据」**：函数里的优先级注释是谎言，真实顺序在调用点。

**请判断**：
- 方案 A：三个覆盖并入 `decideInjectTierPre` 入参，恢复函数为唯一真源
- 方案 B：删函数内 3 个死分支 + 改注释说明「只管 human/run 四档」
- 我倾向 B（改动小），但 A 架构更正确。**你选哪个？**

### 欠条 2：注释引用不存在的函数

`L20914`：`// 见 refreshWaterLevel。`
**全仓 grep `refreshWaterLevel` = 1 处（这条注释本身）**。真名是 `checkWaterLevelAtStep`（L6255）。

### 欠条 3：`contextVersion` 语义被误用

已删压缩判据。但请复核**其余 22 处引用**是否还有同类误用：
- `L9158/9483/9534/9537`：缓存复用判据
- `L13589/13611`：segment 记录
- `L16268`：event 记录

**关键**：它的语义是「observer 产生有效 Segment 时递增」，**与「上下文是否压缩」正交**。做缓存失效判据合理，做压缩信号错误。

### 欠条 4：`planCap` / `_planBudget` 语义重叠

两个变量都控制白板字符量，一个在桶预留层、一个在渲染截断层。**修 bug 的方式是「让两者相等」——这更像掩盖而非根治。**

### 欠条 5：`snapshotReinjectOnCompact` 开关已被架空

`L1047: snapshotReinjectOnCompact: true`，注释「压缩后是否强制重注入」。

**现状**：强制重注入实际由 `_postCompactPending → _postCompactForceFull`（L2145x）实现，**完全不看该开关**。
⇒ 设为 `false` 现在**什么都不会发生**。

**请判断**：接线（让 `_postCompactPending` 尊重开关）还是删配置（同步前端设置页）？

---

## §5 我可能错在哪（请尝试推翻）

| # | 我的判断 | 反驳方向 |
|---|---|---|
| 1 | `contextVersion` 永不回退 | 我只 grep 了 `lib/index.js` 与 `lib/`。若宿主注入或其它模块改写 `runtime.contextVersion`，结论错。 |
| 2 | `scanPressureSignalsPre` 同步无竞态 | 它本身同步，但 `sessionEventsOf` 是否有惰性投影/缓存刷新延迟？**请核实它是否可能返回过期事件数组**。 |
| 3 | 压缩当帧就能读到 compaction 事件 | 若宿主的 `compaction/start` 事件在**压缩之后**才追加，则当帧仍读不到（会晚一帧）。**这是我最不确定的一点**。 |
| 4 | `post_compact` == `human_full` | 用户说「尽量多」。也可能要「比 human_full 更多」。**建议直接向用户确认**。 |
| 5 | 变异 C 用状态机已补足 | 真实还有会话切换/插件重载/多 agent 并发未测 |

---

## §6 复现命令

```bash
cd /d/dsh-auto-memory

# ① 语法/导入
node --check lib/index.js
node -e "import('./lib/index.js').then(m=>console.log('IMPORT_OK',Object.keys(m).length))"

# ② 全量回归（约 162 秒）
node tools/run-smoke.mjs --jobs=8 --timeout=180000

# ③ 各档位渲染实测
node artifacts/_verify-pc2.mjs
#   期望 post_compact 与 human_full 逐项相同（24,576）

# ④ 判据真执行（抽源码原文，非复刻）
node artifacts/_verify-pc7.mjs   # 期望 PASS 5 / FAIL 0 + 变异A/B 必红
node artifacts/_verify-pc8.mjs   # 期望状态机 PASS 2 / FAIL 0（抓变异C）

# ⑤ 压缩信号源真执行
node artifacts/_verify-pc6.mjs   # 期望同步返回、无竞态

# ⑥ 生产日志
grep -c 'post_compact'          ~/.dsh/dsh-auto-memory-diagnose.log   # 修复前 = 0
grep -c 'compaction-detected'   ~/.dsh/dsh-auto-memory-diagnose.log   # = 17（真信号活着）
```

---

## §7 交叉检验清单

- [ ] **核实 §2.2 竞态论证**：`checkWaterLevel` 的 `await`（L5928）是否在 `lastCompactionSeen` 写入（L6042）之前
- [ ] **核实 §5-3**：宿主 `compaction/start` 事件的**追加时机**（压缩当帧 or 下一帧）——这是 v3 能否当帧生效的关键
- [ ] 核实 `sessionEventsOf` 是否可能返回过期数组
- [ ] 独立重跑 §6 ④⑤⑥，确认数字一致
- [ ] **§4 五条欠条逐条判定：成立 / 不成立 / 部分成立**
- [ ] **§5 五条自我反驳逐条尝试推翻**
- [ ] 决定 §4-1（死分支）方案 A 还是 B
- [ ] 决定 §4-5（开关）接线还是删配置
- [ ] 找**第 6 条欠条**

---

## §8 已知未修 / 未验

| 项 | 状态 | 说明 |
|---|---|---|
| `post_compact` 生产实测 | **未验** | 修复后尚未再发生真实压缩。验证：下次压缩后 `grep 'post_compact 档'` 应非 0 |
| `docs/WHITEPAPER.md` L271-284 | **过时** | 仍写 `human_slim`/`run_full` 规则=全文 |
| `event-store 读取失败` JSON 错误 | **存量**（10-26 起） | 76 次；定位在 `memory/global-brief/` 但重读正常，疑写入竞态 |
| 事件写路径无串行化 | 未修 | 需照抄 `_configSaveChain` 模式 |
