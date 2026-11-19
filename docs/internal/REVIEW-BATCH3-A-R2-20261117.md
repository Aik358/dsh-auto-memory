# A 批 r2 验收结论：大幅改善，仍不合并（待 r3）

## 一、落盘检查：全部通过

| 项 | 结果 |
|---|---|
| 锚点唯一命中（含 eol） | **49/49** |
| 改动 `lib/index.js` | **否** |
| 全模块 `node --check` | 通过 |
| 导出 41 | 不变 |
| 语法/import | 通过 |

## 二、套件对照（8 个此前失败 → 现 5 个全绿）

| 套件 | A 批首次 | r2 落盘后 | 结论 |
|---|---|---|---|
| events | 80/6 | **86/0** | ✅ 恢复 |
| consolidate | 抛错 | **66/0** | ✅ 恢复 |
| event-frame | 抛错 | **通过** | ✅ 恢复 |
| notification-store | 抛错 | **通过** | ✅ 恢复 |
| consolidation-boundaries | 抛错 | **通过** | ✅ 恢复 |
| sources | 63/1 | **64/0** | ✅ 恢复（含 Lead 授权项） |
| cadence-projection | 68/29 | **79/18** | ⚠ 部分 |
| final-frame | 抛错 | **仍抛错** | ❌ 未解决 |

## 三、Lead 本轮做的 4 处补充（不属于 GPT 交付）

### 1. sources 授权项落盘（已批准）

`tests/smoke/smoke-test-batch3-sources.mjs:85` 补 `ownerSessionId/sessionKey`。
理由：F08 安全边界优先，判据过期。**已在此前自我纠正报告 §四.5 批准。**

### 2. ★CA 真人门扩展（实现侧，重要）

**发现的问题**：`cadence.js` 只认 `signals.isHumanTurn`，但生产入口 `lib/index.js:24591`
用的是 `_waterFire.fire && (isHuman || _humanPendingNow)`，即信号名是 **`isHuman` / `_humanPending`**。

**后果**：若公共 CA 直接接管生产，**生产水位 full 永远不会触发**——而夹具全绿也发现不了。

**已修**（`lib/injection/cadence.js`）：扩为
`isHumanTurn | isHuman | state.humanTurn | state._humanPending | state._humanPendingNow`。

**验证**：无信号 → `slim`；`isHumanTurn`/`isHuman`/`_humanPending`/`_humanPendingNow` → 均 `full`。

### 3-4. CA 夹具 2 处（水位正例补真人前提）

`smoke-test-batch3-cadence-projection.mjs` 的 `d26`/`d51` 补 `signals:{isHumanTurn:true}`。
理由：F12 要求"水位 + 真人"AND 门，旧用例按纯水位设计 ⇒ 判据过期，**批准**。

## 四、剩余问题与裁定

### ★P1（阻塞）：公共 CA 丢失「真人即 full」旁路

**实测**：`REAL state + signals.isHumanTurn=true` ⇒ `tier=slim`，
原因 `reasons = ["精简帧节流；要求间隔 99，实际 0"]`。

**即**：当前只实现「真人 **且** 水位跨阈值 ⇒ full」，没有「真人 ⇒ full」这条独立旁路。

**这违反 L1 §4.3**（`cadence.js` 头注自述覆盖「首帧、**真人/运行**、fullGap、slimEvery、25/50 水位」）。

**裁定**：
- **不是判据过期，是功能缺口** —— 不得改测试；
- 必须由实现在 cadence 内补「真人旁路」：真人请求 ⇒ full（受既有 fullGap/幂等闸约束，但不被水位条件吞掉）；
- 涉及 5 条旧断言：`真人发言 ⇒ full`、`首观测 + 真人 ⇒ full`、`空 state + 真人 ⇒ full`、
  `reinject=false 仍评估 human`、`对照 99% 水位投 full`。

### P2：`final-frame` 存储结构变化未说明

`store.mem["r-1"].versions` 为 undefined（测试 248 行）。
r2 改了 commit 后存储形状，但未在交付说明列出 ⇒ **要求说明或恢复兼容形状**。

### P3：PJ 4 项

`请求三段都产出候选` / `不同 ContentSpec ⇒ 不同候选集` / `plan=none 不投影` / `省略须显式 degradation`。
需确认是 F10/F11 的实现缺口还是判据过期。

## 五、当前状态（未提交）

- `lib/injection/*` 已应用 r2 49 补丁 + Lead 的 cadence 扩名；**未提交**
- `tests/` 有 3 处 Lead 批准的修改（sources 1 + CA 2）
- 仓库 HEAD 仍为 `96bfded8`
- **B 批继续挂起**

## 六、给 GPT 的 r3 要求

1. **补 CA 真人旁路**（P1），并说明它与 fullGap/幂等闸的优先级；
2. **说明或修复 final-frame 的存储形状变化**（P2）；
3. **PJ 4 项**给出定性（实现缺口 / 判据过期），后者须逐条列依据；
4. 保留本轮已做对的部分：锚点 eol、不动 `lib/index.js`、sources/F08 身份前置、F14 抛不可满足、F19 版本校验；
5. 交付后仍需自测：8 个套件恢复 0 FAIL，且**逐条说明为什么某条可以改测试**。