## official-compaction

- **规模**：9,102 B / 198 行 / 8 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**镜像官方压缩参数（唯一真源 · 零依赖）**。为什么不"读取"要"镜像"（2026-09-26 侦察硬证据）：官方 `@deepseek-ai/dsh-compaction-basic@0.1.7-rc.2` 只导出 `BasicCompactionEngine`；`resolveCompactSpec` 是**模块私有函数**不在 exports；引擎 `static inject = ["llm","tokenMeter","sessions"]` **不暴露 compaction 服务名**；插件拿不到实例句柄 ⇒ 任何插件都读不到当前生效的 ratio/headroom，只能镜像。姊妹插件 `dsh-context@0.56.2` 的注释自证同一结论。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L28 | `OFFICIAL_DEFAULT_RATIO` | 官方默认 ratio |
| L29 | `OFFICIAL_DEFAULT_HEADROOM` | 官方默认 headroom |
| L32 | `stripYamlCommentPre(...)` | YAML 注释剥离 |
| L42 | `parseScalarLinePre(...)` | 标量行解析 |
| L51 | `coerceScalarPre(...)` | 标量强制类型 |
| L71 | `parseCompactionFromYamlPre(...)` | 从 YAML 解析压缩配置 |
| L135 | `scanPresetCompactionsPre(...)` | 扫描 preset 压缩段 |
| L159 | `pickOfficialParamsPre(...)` | 挑选生效参数 |

### 数据流

```
配置来源（两处，按优先级）
   ├─ preset YAML：scanPresetCompactionsPre(...)  L135
   │      └─ parseCompactionFromYamlPre(...)  L71
   │            ├─ stripYamlCommentPre(...)  L32   去注释
   │            ├─ parseScalarLinePre(...)   L42   标量行
   │            └─ coerceScalarPre(...)      L51   类型强制
   └─ 官方默认：OFFICIAL_DEFAULT_RATIO L28 / OFFICIAL_DEFAULT_HEADROOM L29
        │
        ▼
   pickOfficialParamsPre(...)  L159   ← **唯一真源**（挑选当前生效参数）
```

### 内部关键实现

**1. 为什么是"镜像"而不是"读取"（2026-09-26 侦察硬证据）**

官方 `@deepseek-ai/dsh-compaction-basic@0.1.7-rc.2` **只导出** `BasicCompactionEngine`：
- resolveCompactSpec 是**模块私有函数**，不在 exports 里；
- 引擎的静态注入声明只含 llm / tokenMeter / sessions —— **不暴露 compaction 服务名**；
- 引擎实例上的 config 是解析后的策略，但**插件拿不到实例句柄**。

⇒ 任何插件都**读不到**当前生效的 ratio/headroom，只能镜像。
**佐证**：姊妹插件 `dsh-context@0.56.2` 的注释自证同一结论 —— *"DSH does not publish the configured ratio to plugins/clients, so the reserve band mirrors the default"*。

**2. 关联的实测教训（第二个真源导致的失效）**

插件水位阈值原为**固定 0.75**，而官方 rc.2 触发点是 `min(W × ratio, (W − O) − B)` —— 本机 W=1e6 / O=256e3 / B=65536 ⇒ **67.8%**。**0.75 > 0.678** ⇒ **插件交接建议永远晚于官方压缩**，只能靠 compaction-detected 硬信号被动兜底。
⇒ **判据：凡有两个可独立影响同一行为的输入，即未真正合并。** 团队化不得重蹈。

### 可直接落地的代码片段

**插入位置**：official-compaction.js:159 附近的 `pickOfficialParamsPre`。

```js
/**
 * 上下文预算的团队可见性 —— 压缩参数仍是**本机镜像**，不进团队同步。
 *
 * 为什么：压缩参数取决于本机模型与额度（窗口大小、provider），成员之间天然不同。
 * 同步它会把 A 的额度假设强加给 B，导致 B 侧水位判断错误。
 * 团队视图只需要一个**归一的摘要**用于解释"为什么某成员更早交接"。
 *
 * @param {object} params pickOfficialParamsPre(...) 的输出
 * @returns {{ratio:number|null, headroom:number|null, note:string}}
 */
export function summarizeCompactionForTeamPre(params) {
  const p = params || {}
  const ratio = Number(p.ratio)
  const headroom = Number(p.headroom)
  return {
    ratio: Number.isFinite(ratio) ? ratio : null,
    headroom: Number.isFinite(headroom) ? headroom : null,
    note: '本机镜像值，仅供参考；各成员按自身模型窗口独立计算，不可跨端套用。',
  }
}
```

### 关联行号索引

- lib/official-compaction.js:28
- lib/official-compaction.js:71
- lib/official-compaction.js:159

### 与团队化的关系

**判定：私有（Private）· 设备级。**

压缩参数是**本机模型与额度**相关的（窗口大小、provider），不同成员机器上不同。同步它没有意义。

### Teamwork 改造要点

1. **本模块与 Teamwork 无直接关系**，但它体现的判据值得沿用：**当上游契约不暴露能力时，镜像 + 单一真源优于多点猜测**。团队化读不到的服务（如团队同步服务名）应按同样思路处理。
2. **`pickOfficialParamsPre` 是唯一真源**：既有实测教训——插件水位阈值原为固定 0.75，而官方 rc.2 触发点是 `min(W×ratio, (W−O)−B)`（本机 67.8%）⇒ 0.75 > 0.678 ⇒ **插件交接建议永远晚于官方压缩**，只能靠硬信号被动兜底。团队化不得再引入第二个真源。
3. **纯解析、零依赖**：保持可单测。

### 风险与回归

- 回归：解析器面对官方 YAML 格式变化必须 fail-soft（回落默认）而不是抛错。
- 本模块是"镜像"，不保证与上游实时一致——任何依赖它的判定都要容忍偏差。
