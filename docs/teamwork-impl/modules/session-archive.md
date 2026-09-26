## session-archive

- **规模**：19,542 B / 495 行 / 24 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**会话归档与删除的自持实现**（F 线）。含 Apache-2.0 来源声明（derived from `@linxin666/dsh-session-archive` v0.4.1）。提供自动归档候选挑选、自动删除种子候选、删除计划、RDB 会话处理、projcache 读取。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L31 | `DAY_MS` | 日毫秒常量 |
| L34 | `AUTO_ARCHIVE_DAYS_MAX` | 自动归档天数上限 |
| L35 | `AUTO_DELETE_DAYS_MAX` | 自动删除天数上限 |
| L37 | `CHECK_INTERVAL_MIN_MAX` | 巡检间隔上限 |
| L38 | `CHECK_INTERVAL_MIN_MIN` | 巡检间隔下限 |
| L44 | `DEFAULT_AUTO_CONFIG` | 默认自动配置 |
| L57 | `validateDays(...)` | 天数校验 |
| L68 | `resolveAutoConfig(...)` | 配置解析（唯一真源） |
| L97 | `autoArchiveCandidates(...)` | 归档候选 |
| L125 | `autoDeleteSeedCandidates(...)` | 删除种子候选 |
| L146 | `descendantsOf(...)` | 后代枚举 |
| L180 | `planDelete(...)` | 删除计划 |
| L244 | `canonicalSessionId(...)` | 规范化会话 ID |
| L293 | `indexSessionDirs(...)` | 会话目录索引 |
| L356 | `removeSessionDir(...)` | 删除会话目录 |
| L399 | `deleteRdbSession(...)` | 删 RDB 会话 |
| L442 | `readProjcacheIndex(...)` | 读投影缓存 |

### 数据流

```
配置：resolveAutoConfig(cfg)  L68   ← **唯一真源**
        （校验：validateDays L57；上下限：L34/L35/L37/L38）
          │
          ▼
  ① 自动归档：autoArchiveCandidates(...)  L97
       按 lastActivity 挑超期会话
  ② 自动删除：autoDeleteSeedCandidates(...)  L125  → planDelete(...)  L180
       ├─ descendantsOf(...)  L146   后代枚举（**父子会话级联**）
       ├─ canonicalSessionId(...)  L244
       └─ removeSessionDir(...)  L356
  ③ RDB 侧：rdbDbPaths L366 / isSessionRdb L371 / deleteRdbSession L399
  ④ projcache：readProjcacheIndex L442 / titleFromProjcache L453 / readProjcacheFile L469
  ⑤ 目录索引：indexSessionDirs(...)  L293
```

### 内部关键实现

**1. Apache-2.0 来源声明（文件头 L1-31）**

*Portions of this file are derived from @linxin666/dsh-session-archive v0.4.1 (Apache-2.0); modified by dsh-auto-memory.*
实测记录：原包 license 为 **Apache-2.0**（非 MIT；以 package.json.license 与 LICENSE 首两行**双证据**核实）；原包**无 NOTICE 文件** ⇒ 无额外 NOTICE 传递义务；原包 author/repository/homepage 三字段皆空 ⇒ 署名只能引用包名与版本。**§4(a)(b) 要求版权与许可保留 + §4(b)「已修改」标注**。

**2. 删除的级联性（descendantsOf）**

删除父会话必须连带处理后代（子代理会话挂在其下），否则留下孤儿目录 —— 这解释了为什么 `planDelete` 需要先 `descendantsOf`。

**3. 配置真源唯一**

用户既有硬规则：*"轮换周期必须 ≤ 自动归档天数（2 天）"*，且 *"autoArchiveDays 为唯一真源，不得保留『老键更小则采纳』类隐藏第二旋钮"*。

### 可直接落地的代码片段

**插入位置**：session-archive.js:68 附近的 `resolveAutoConfig`。

```js
/**
 * 团队保留策略**并入唯一真源** —— 不新增第二个旋钮。
 *
 * 判据（用户既有硬规则）：「凡有两个可独立影响同一行为的输入，即未真正合并」
 *   —— 轮换周期与归档阈值是同一生命周期的两阶段，autoArchiveDays 为唯一真源。
 * 团队化若新增"团队级保留天数"，必须**并入** resolveAutoConfig，而不是并列判断。
 *
 * @param {object} cfg 插件配置
 * @param {{teamRetentionDays?:number}} [team] 团队策略（可选）
 * @returns {object} 与 resolveAutoConfig 同形状的最终配置
 */
export function resolveAutoConfigWithTeamPre(cfg, team) {
  const base = resolveAutoConfig(cfg)
  const t = team || {}
  const d = Number(t.teamRetentionDays)
  // 未给团队值 ⇒ 逐字节沿用本地解析结果（零破坏）
  if (!Number.isFinite(d) || d <= 0) return base
  // 给了 ⇒ **取更小者**（更保守），且不改动其他字段 —— 不制造第二真源
  const merged = Object.assign({}, base)
  if (Number.isFinite(base.autoArchiveDays)) {
    merged.autoArchiveDays = Math.min(base.autoArchiveDays, d)
  }
  return merged
}
```

### 关联行号索引

- lib/session-archive.js:68
- lib/session-archive.js:97
- lib/session-archive.js:180

### 与团队化的关系

**判定：私有（Private）· 设备级。**

会话归档是**本机会话文件的生命周期管理**（磁盘占用、会话列表渲染负担），与团队记忆无关。团队化不应同步会话档案——那是每个人自己的工作痕迹。

### Teamwork 改造要点

1. **团队共享会话是禁忌**：若未来要做"团队共享某个会话"，应走**显式导出**（如 migrate-pack）而不是把 `session-archive` 的目录级操作扩展到团队目录——后者的删除语义（`planDelete` + `removeSessionDir`）在共享目录上会造成**误删他人数据**。
2. **`resolveAutoConfig` 是配置唯一真源**：既有约定"轮换周期 ≤ 自动归档天数（2 天）"。团队化若引入团队级保留策略，必须并入同一个真源，不得新增第二个旋钮（用户既有硬规则）。
3. **不参与同步**：本模块产出的任何统计/候选都不需要进团队载荷。

### 风险与回归

- 回归：本文件有 **Apache-2.0 来源声明**，任何改写都要保留版权与许可头（§4(a)(b) 要求），不得删减归属声明。
- `autoArchiveDays` / `autoDeleteDays` 是**唯一真源**，不得被团队配置覆盖成第二个来源。
