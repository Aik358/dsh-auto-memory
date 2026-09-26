## migrate-pack

- **规模**：21,526 B / 441 行 / 18 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**迁移包引擎**：把一个工作区的记忆打包/搬包/导入。三个设计要点（有实测取证）：①**零依赖**（不用 zip，`node:zlib` 无 zip 容器；引第三方违反零依赖铁律）⇒ 单 JSON 文件、可选 gzip；②**纯逻辑与 IO 分离**（本模块不碰真实磁盘）；③**路径重写是必需的** —— slug 规则 `'--' + path.replace(...) + '--'` **不可逆**，新路径只能重新计算且文件内旧路径必须逐处重写，否则 B 机全是死链。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L27 | `MIGRATE_PACK_FORMAT_PRE` | 包格式版本 |
| L28 | `MIGRATE_PACK_CHECKSUM_ALGO_PRE` | 校验算法 |
| L30 | `MIGRATE_PACK_MAX_FILES_PRE` | 文件数上限 |
| L31 | `MIGRATE_PACK_MAX_BYTES_PRE` | 字节上限 |
| L37 | `workspaceSlugPre(p)` | 工作区 slug（不可逆） |
| L47 | `pathVariantsPre(p)` | 路径变体枚举（跨平台重写用） |
| L68 | `rewritePathsInTextPre(text,...)` | 正文内路径重写 |
| L119 | `packChecksumPre(pack)` | 包校验和 |
| L139 | `buildPackPre(...)` | 打包 |
| L186 | `validatePackPre(pack)` | 校验 |
| L234 | `rewritePackForTargetPre(...)` | 面向目标机重写 |
| L267 | `planImportPre(...)` | 导入计划 |
| L321 | `renameForConflictPre(...)` | 冲突重命名 |
| L341 | `mergeSummaryRecordPre(...)` | 摘要记录合并 |
| L378 | `calendarMergePre(...)` | 日历合并 |

### 数据流

```
导出侧（本模块**不碰真实磁盘**，只做纯函数）：
  工作区文件集 ──▶ buildPackPre(...)  L139
                     ├─ workspaceSlugPre(path)  L37   （不可逆！）
                     ├─ pathVariantsPre(path)   L47   （跨平台变体）
                     ├─ rewritePathsInTextPre(text, ...)  L68   **逐处重写**
                     └─ packChecksumPre(pack)   L119
                          ▼
                     pack（单 JSON，可选 gzip）

搬迁/导入侧：
  validatePackPre(pack)  L186
      └─▶ planImportPre(...)  L267
            ├─ renameForConflictPre(...)  L321   冲突重命名
            ├─ mergeSummaryRecordPre(...)  L341   摘要记录合并
            └─ calendarMergePre(...)       L378   日历合并
                 ▼
            rewritePackForTargetPre(...)  L234   ← **面向目标机重写路径**
```

### 内部关键实现

**1. 为什么不用 zip（零依赖铁律）**

`node:zlib` **只有 gzip/deflate，没有 zip 容器**；引第三方库违反本仓零依赖铁律 ⇒ 单 JSON 文件 + 可选 gzip 一层。

**2. 路径重写为什么"必需"（实测）**

slug 规则见文件头 L22（形如：两段固定前后缀 + 把路径里的非法字符逐个替换为连字符）。它**不可逆** —— 原路径里的连字符与替换产物无法区分 ⇒ 新路径的 slug **只能由新路径重新计算**，且**文件内出现的旧路径必须逐处重写**，否则 B 机全是死链。

**3. 纯逻辑与 IO 分离**

本模块不碰真实磁盘 ⇒ 导出/重写/计划三步都能在守卫里用**真数据直接单测**，不必起宿主。

### 可直接落地的代码片段

**插入位置**：migrate-pack.js:139 附近的 `buildPackPre`。

```js
/**
 * 把迁移包转为团队同步基线 —— **复用既有打包，不另造序列化**。
 *
 * 为什么复用：本模块已解决跨机器搬记忆的全部硬问题（路径重写、校验、冲突重命名、
 * 合并策略），且经过真实迁移验证。团队首次入组的"全量基线"本质就是一次迁移。
 *
 * @param {object} pack buildPackPre(...) 的输出
 * @param {{groupId:string, actorId:string, at?:number}} meta
 * @returns {{ok:boolean, envelope:object|null, error?:string}}
 */
export function toTeamBaselineEnvelopePre(pack, meta) {
  if (!pack || typeof pack !== 'object') return { ok: false, envelope: null, error: 'no-pack' }
  // 校验先于封装：坏包不得进入团队通道（否则会把损坏扩散到全员）
  const v = validatePackPre(pack)
  if (!v || v.ok === false) {
    return { ok: false, envelope: null, error: 'pack-invalid:' + String((v && v.reason) || 'unknown') }
  }
  const m = meta || {}
  return {
    ok: true,
    envelope: {
      v: 1,
      kind: 'team-baseline',
      groupId: String(m.groupId || ''),
      actorId: String(m.actorId || 'local'),
      at: Number(m.at) || Date.now(),
      checksum: packChecksumPre(pack),
      pack: pack,
    },
  }
}
```

### 关联行号索引

- lib/migrate-pack.js:37
- lib/migrate-pack.js:139
- lib/migrate-pack.js:234

### 与团队化的关系

**判定：团队共享（Shared）· 这是团队化的现成地基。**

**这是全仓与 Teamwork 最接近的模块**：它已经解决了"跨机器搬记忆"的全部硬问题（路径重写、校验、冲突重命名、合并策略）。团队同步本质上就是一次**持续的增量 migrate-pack**。

### Teamwork 改造要点

1. **直接复用为同步载荷格式**：把 `buildPackPre` 的输出作为"首次入组全量基线"，后续走增量补丁。**不要**另造一套序列化。
2. **`rewritePackForTargetPre` 就是"接受端适配器"**：团队各端根目录不同，接收方先用它把路径重写到本机，再落盘。这条路径已被迁移场景验证过。
3. **`mergeSummaryRecordPre` / `calendarMergePre` 是现成的合并策略模板**：团队同步的冲突合并应沿用同一套语义（而不是每类记忆各造一套）。

### 风险与回归

- 回归：路径重写有**逐处重写**的完整性要求（文件头 L22-26 记载 slug 不可逆、漏一处即死链）。团队化高频同步会让这个缺陷**从一次性变成常态化**，必须补守恒断言。
- 包有 `MAX_FILES/MAX_BYTES` 上限——团队全量基线很容易超限，需要分片策略【推断】。
