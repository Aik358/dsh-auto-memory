## temporal-parse

- **规模**：10,919 B / 192 行 / 2 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**中文时间表达解析**（P12 后新增时间检索臂 Phase 1）。把查询里的"上周""三天前""最近一周""上个月"等解析为 `[startMs, endMs)` 区间，供检索的软性第三臂（time arm）做 rank-space 提升。查询无时间表达 → 返回 `null` → **调用方零行为变更**。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L94 | `parseTemporalQueryPre(...)` | 时间表达解析主入口 |
| L169 | `labelToDateMsPre(...)` | 中文标签→毫秒 |

### 数据流

```
查询文本
   └─ parseTemporalQueryPre(query, { now })   L94
        ├─ 无时间表达 → 返回 **null** → 调用方**零行为变更**
        └─ 命中（"上周" / "三天前" / "最近一周" / "上个月" 等）
             └─ labelToDateMsPre(...)  L169
                  └─ 返回 [startMs, endMs)
        │
        ▼
   检索的软性第三臂（time arm）→ 做 **rank-space 提升**
```

### 内部关键实现

**1. 边界（文件头逐字）**

*纯函数、零 IO、零依赖；**禁止 LLM / 第三方日期库**；确定性（同输入同 now 逐字节相同输出）。时刻必须经 opts.now 注入（缺省 Date.now() 仅为便利；测试一律注入）。*

**2. 时区假设是显式声明的**

*全部自然日/周/月/年边界用宿主**本地时间**计算（new Date(y,m,d) 系列本地方法）。部署机时区为 Asia/Shanghai（CST，UTC+8，无夏令时）。*
⇒ 该假设在**单机单时区**下成立；跨时区团队使用前必须重新评估。

**3. 无时间表达返回 null 是契约**

保证"调用方零行为变更" —— 即该臂的引入对既有检索路径**完全透明**。

### 可直接落地的代码片段

**插入位置**：temporal-parse.js:94 附近的 `parseTemporalQueryPre`。

```js
/**
 * 团队检索的时间口径 —— **必须显式声明参照系**，不得默认。
 *
 * 为什么：本模块文件头已显式声明"全部自然日/周/月/年边界用宿主**本地时间**计算"，
 * 并注明部署机时区为 Asia/Shanghai。单机假设在团队下失效：
 * 成员分布在不同时区时，"上周"是**谁的**上周？
 * ⇒ 团队检索必须把参照系做成显式参数（'local' | 'utc' | <固定偏移>），
 *    并在结果里回传用了哪个参照系，避免两端算出不同区间却都自称正确。
 *
 * @param {string} query
 * @param {{now:number, tzMode?:'local'|'utc', tzOffsetMin?:number}} opts
 * @returns {{startMs:number, endMs:number, tzMode:string}|null}
 */
export function parseTemporalQueryTeamPre(query, opts) {
  const o = opts || {}
  const mode = String(o.tzMode || 'local')
  const base = parseTemporalQueryPre(query, { now: o.now })
  if (!base) return null
  const shift = mode === 'utc'
    ? (-new Date(o.now).getTimezoneOffset() * 60000)   // 本地 → UTC 的平移量
    : (Number.isFinite(o.tzOffsetMin) ? Number(o.tzOffsetMin) * 60000 : 0)
  return {
    startMs: Number(base.startMs) - shift,
    endMs: Number(base.endMs) - shift,
    tzMode: mode,
  }
}
```

### 关联行号索引

- lib/temporal-parse.js:94
- lib/temporal-parse.js:169

### 与团队化的关系

**判定：派生重算（Derived）· 纯函数。**

纯解析函数，无状态。团队化后可用于"按时间筛选团队记忆"，但解析结果本身不需要同步。

### Teamwork 改造要点

1. **团队检索的时间语义需要明确口径**：成员分布在不同时区时，"上周"是**谁的**上周？本模块**显式声明**用宿主本地时间（注释：部署机时区 Asia/Shanghai CST UTC+8 无夏令时）⇒ 团队化必须显式定义用查询方本地时间还是 UTC，**不得默认**。
2. **确定性是硬约束**：注释要求"同输入同 now 逐字节相同输出"，时刻必须经 `opts.now` 注入。团队化不得引入 `Date.now()` 直读。
3. **禁止 LLM / 第三方日期库**：保持零依赖与确定性。

### 风险与回归

- 回归：确定性由 `opts.now` 注入保证，测试一律注入 rather than 依赖真实时间。
- 无时间表达必须返回 `null` —— 这是"调用方零行为变更"的契约。
- 时区假设是显式声明的，跨时区团队使用前必须重新评估。
