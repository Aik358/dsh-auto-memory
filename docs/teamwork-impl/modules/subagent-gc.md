## subagent-gc

- **规模**：17,074 B / 370 行 / 10 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**子代理痕迹回收**。DSH 为每个子代理创建持久化会话 `~/.dsh/sessions/<工作区>/<裸 uuid>/session.jsonl.zstd`；本插件高频产生 `auto-memory-*` 一次性子代理。实测全机 686 个子代理会话中 638 个（93%）来自本插件，数量上千后拖慢会话列表与投影缓存加载。本模块扫描并回收。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L29 | `PLUGIN_LABEL_PREFIX` | `auto-memory-` 前缀判据 |
| L32 | `DEFAULT_KEEP_MS` | 默认保留时长 |
| L40 | `scanZstdFrames(...)` | 扫描 zstd 帧 |
| L86 | `decodeZstdFrames(...)` | 解码帧 |
| L107 | `decodeZstdFramesHead(...)` | 仅解头部（性能） |
| L128 | `parseSessionHead(...)` | 解析会话头 |
| L152 | `isPluginOneShotSubagent(...)` | **归属判据** |
| L178 | `scanPluginSubagentSessions(...)` | 扫描 |
| L254 | `recycleSessions(...)` | 回收 |
| L309 | `purgeSubagentCatalog(...)` | 清 catalog 投影 |

### 数据流

```
扫描：~/.dsh/sessions/<工作区>/<uuid>/session.jsonl.zstd
   └─ scanZstdFrames(...)  L40     （性能：decodeZstdFramesHead L107 **只解头部**）
        └─ parseSessionHead(...)  L128
             header 形如 {origin:'subagent', parentSession, delegationDepth}
                  │
                  ▼
             isPluginOneShotSubagent(...)  L152   ← ★ 归属判据
               origin === 'subagent'
               && descriptor.label 以 PLUGIN_LABEL_PREFIX('auto-memory-') 开头
               && descriptor.mode === 'one-shot'
                  │ 命中
                  ▼
             scanPluginSubagentSessions(...)  L178
                  └─ recycleSessions(...)  L254
                       └─ purgeSubagentCatalog(...)  L309  清投影缓存
```

### 内部关键实现

**1. 规模事实（实测 2026-09-08）**

全机 **686** 个子代理会话（**302 MB**），其中 **638 个（93%）来自本插件**。数量上千后拖慢会话列表与投影缓存加载，并可能触发子代理目录诊断报错。

**2. 归属判据是安全边界 L152**

只认 `auto-memory-` 前缀 ⇒ **只清理自己产生的会话**。凡 label 不是该前缀的一律判 `foreign-label` 跳过。**放宽判据会误删其他插件/用户的子代理会话**。

**3. 只解头部的性能优化 L107**

会话文件可能很大，扫描时只解码 zstd 头部即可拿到 header ⇒ 避免全量解压。

### 可直接落地的代码片段

**插入位置**：subagent-gc.js:152 附近的 `isPluginOneShotSubagent`。

```js
/**
 * 归属判据的**团队扩展** —— 新前缀必须显式登记，绝不放宽既有判据。
 *
 * 为什么不能把判据改成 startsWith('auto-memory') 或更宽：
 *   该判据是安全边界，放宽会**误删其他插件/用户的子代理会话**。
 *   正确做法是给团队子代理一个**新的、明确的前缀**并登记进来。
 *
 * @param {string} label 会话 descriptor.label
 * @returns {{owned:boolean, owner:'local-plugin'|'team-plugin'|'foreign'}}
 */
export function classifySubagentOwnershipPre(label) {
  const l = String(label || '')
  if (l.indexOf(PLUGIN_LABEL_PREFIX) === 0) return { owned: true, owner: 'local-plugin' }
  // 团队子代理走独立前缀，避免与本地判据混用
  if (l.indexOf('auto-memory-team-') === 0) return { owned: true, owner: 'team-plugin' }
  return { owned: false, owner: 'foreign' }
}
```

### 关联行号索引

- lib/subagent-gc.js:29
- lib/subagent-gc.js:152
- lib/subagent-gc.js:178

### 与团队化的关系

**判定：私有（Private）· 设备级。**

纯本地磁盘清理。团队成员的会话目录互不可见，也不应互相清理。

### Teamwork 改造要点

1. **归属判据不得放宽**：`isPluginOneShotSubagent` 只认 `label.startsWith('auto-memory-')`；凡不是该前缀的一律判 `foreign-label` 跳过。这确保了**只清理自己产生的会话**。团队化后若引入团队级子代理，必须用**新的前缀**并显式登记，绝不放宽本判据。
2. **`purgeSubagentCatalog` 的幽灵问题**：既有实测发现投影缓存里 25 条 catalog **全部无对应磁盘目录**（100% 幽灵）。团队化增加子代理调用量会放大该问题，属于同步改造前必须先解决的**既有缺陷**。
3. **不参与团队同步**。

### 风险与回归

- 回归：`isPluginOneShotSubagent` 是安全边界（防止误删其他插件的子代理会话），改动必须配负路径用例。
- `decodeZstdFramesHead` 是性能优化路径，别为了功能改动破坏"只解头部"的性质。
