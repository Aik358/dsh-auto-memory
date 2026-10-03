
## water-window

- **规模**：15,623 B / 264 行 / 7 个导出符号
- **交付形态**：**完整版**

### 职责

**上下文窗口解析**（2.2.4，2026-09-08）。水位 = 当前上下文占用 / 模型窗口。占用取官方 `tokenMeter`（与聊天框 context ring 同源）；窗口此前有四条来源：手动覆盖 > 官方 request/context 的 contextWindow > settings.yaml 解析 > fallback。
**实测发现两条路同时失效**，导致窗口恒为 fallback 131072（真实模型 1M），水位被算成 **150%+**：
1. 官方 `request/context` **只在会话早期追加**（本会话 2999 个事件里仅 2 条），而旧代码只扫最近 256 条 ⇒ **永远扫不到**；
2. `settings.yaml` 的 llm-deepseek 段是 **flow 风格 YAML**，旧解析器只认 block 风格 ⇒ 整段解析不出来。

### 数据流

```
四条来源（优先级从高到低）
   ├─ ① 手动覆盖（用户显式设置）
   ├─ ② 官方 request/context 的 contextWindow
   │      └─ findOfficialContextWindowPre(...)  L176   （**全量扫描**，不只最近 256 条）
   ├─ ③ settings.yaml → 模型窗口映射
   │      └─ parseModelWindowsPre(yamlText)  L62   （**兼容 flow 与 block 两种风格**）
   └─ ④ fallback（131072）
        │
        ▼
pickWindowPre(provider, model, map)   L92   按 provider/model 选窗口
        │
        ▼
findSessionModelPre(session)  L132   从会话事件定位当前模型
scanPressureSignalsPre(...)   L132   压力信号扫描
reusableWindowCachePre(...)   L220   可复用缓存
shouldArmAutoContinuePre(...) L259  是否武装自动续接
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L19 | `parseModelWindowsPre(yamlText)` | **flow + block 双风格** YAML 解析 |
| L62 | `pickWindowPre(provider, model, map)` | 按 provider/model 选窗口 |
| L92 | `findSessionModelPre(session)` | 定位会话模型 |
| L132 | `scanPressureSignalsPre(...)` | 压力信号扫描 |
| L176 | `findOfficialContextWindowPre(...)` | 官方窗口（**全量扫描**） |
| L220 | `reusableWindowCachePre(...)` | 可复用缓存 |
| L259 | `shouldArmAutoContinuePre(...)` | 是否武装自动续接 |

### 内部关键实现

**1. 只有 2 条事件 + 只扫 256 条 = 永不命中（文件头）**

这是**两个各自正确的假设叠加成 bug** 的典型：官方"只在早期追加"是设计，旧代码"只扫最近 256 条"是优化 —— 两者各自合理，合起来必然失效。⇒ 团队化评估"某数据可否只扫最近 N 条"时必须做同样的**交集分析**（`memory-index.js:57` 的 5MiB 上限与 `evidence-agg.js` 的"末 N 行"都有同型风险）。

**2. flow YAML 解析（文件头）**

`parseModelWindowsPre` 必须同时吃 flow 与 block 两种风格。⇒ 依赖外部格式的解析器必须**覆盖实际观测到的全部写法**，不能只按规范实现。

**3. 纯函数化（文件头）**

*"本模块把「settings.yaml → 模型窗口映射」与「按 provider/model 选窗口」抽成纯函数，**便于 smoke 覆盖**"* ⇒ 从"只能实机验证"变成"可回归断言"。

**4. fallback 131072 的危险性**

窗口恒为 fallback ⇒ 水位算成 150%+ ⇒ **插件误判压力并触发交接/压缩**（本仓既有实测：插件水位阈值原为固定 0.75，而官方触发点是 67.8% ⇒ 插件交接建议永远晚于官方压缩）。⇒ fallback 值错误会**系统性改变插件行为**。

### 关联行号索引

- lib/water-window.js:19
- lib/water-window.js:62
- lib/water-window.js:92

### 与团队化的关系

**判定：S0 私有（设备/模型级）。**

理由：模型窗口取决于**本机使用的 provider 与模型**，成员之间不同。同步它会把 A 的窗口假设强加给 B，导致 B 的水位计算错误 —— 与团队记忆无关。**团队视图只应看归一后的水位百分比**，而非窗口绝对值。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| WW1 | `findOfficialContextWindowPre` L176 | 本地扫描 | **不改**（已是全量扫描） | 无 |
| WW2 | `parseModelWindowsPre` L19 | 双风格 | 团队若引入新 preset 格式，必须同步支持 | 兼容 |
| WW3 | 新增 `pressureRatioForTeamPre` | 无 | 只上报**归一水位**（百分比），不上报窗口绝对值 | 新增导出 |
| WW4 | fallback | 131072 | 团队化不得改 fallback（改了会连带改变单机行为） | 纪律 |

#### 可直接落地的代码片段

**片段 1**：归一水位上报（新增导出，放文件末尾）。

```js
/**
 * 团队可见的"压力水位" —— **只上报归一比例，不上报窗口绝对值**。
 *
 * 为什么不上报窗口：窗口取决于本机的 provider/model（见 pickWindowPre L62）。
 * 把 A 的 1M 窗口同步给 B 毫无意义，且会诱导 B 用错误的分母计算水位
 * ⇒ 直接改变 B 的交接/压缩时机（这正是本模块文件头记录的那类事故）。
 *
 * 为什么不顺带改 fallback：本模块的 fallback 值会**连带改变单机行为**
 * （窗口错 ⇒ 水位错 ⇒ 交接时机错）。按用户硬规则「单一开关不得顺带改变
 * 其他功能的行为」，团队化不得触碰它。
 *
 * @param {{used:number, window:number, source?:string}} w 水位输入
 * @returns {{ratio:number|null, band:'low'|'mid'|'high'|'unknown', source:string}}
 */
export function pressureRatioForTeamPre(w) {
  const x = w || {}
  const used = Number(x.used)
  const win = Number(x.window)
  if (!Number.isFinite(used) || !Number.isFinite(win) || win <= 0) {
    return { ratio: null, band: 'unknown', source: String(x.source || 'unknown') }
  }
  const ratio = used / win
  // 三波段（不暴露精确窗口值，避免团队成员据此反推他人模型配置）
  const band = ratio >= 0.75 ? 'high' : (ratio >= 0.4 ? 'mid' : 'low')
  return { ratio: Number(ratio.toFixed(4)), band, source: String(x.source || 'unknown') }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **窗口来源再次失效** | 上游改变 request/context 追加时机 | 保持全量扫描（WW1）；加"命中为 0 时必须留痕"的守卫 |
| **fallback 被改** | 团队化顺手调整 fallback | WW4 纪律；回归断言 fallback 常量不变 |
| **同步窗口绝对值** | 诊断面板图省事传 window | 片段 1 只传 ratio + band |
| **flow YAML 回归** | 上游切换 preset 写法 | 保持双风格解析；新增风格必须补断言 |

**既有测试/守卫**：`water-window` 的 smoke 用例（flow/block 解析、四来源优先级）。文件头明确"抽成纯函数便于 smoke 覆盖" ⇒ 已有回归保护。
