
## memory-index

- **规模**：7,378 B / 148 行 / 5 个导出符号
- **交付形态**：**完整版**

### 职责

`MemoryFileIndex` —— **只读**记忆文件索引（M3a，系统地图 M-06 契约）。对记忆 Markdown（用户级 / 项目笔记 / 每日日志 / 反思 / 日历）**按标题行切块**，建立 UTF-8 **半开字节区间** `[byteStart, byteEnd)`、行号 locator、`recordDigest` 与文件级 `sourceVersion`。
**不修改任何 Markdown** —— 它是纯读取投影层。
`stale` 判定 = 当前文件在该字节区间的切片 digest 与记录不一致（含前置插入导致的位移）；**`stale ≠ coverage=0`**（文件头 L8-9）。

### 数据流

```
输入：记忆 Markdown 文件字节（Buffer）
        │
        ▼
  buildIndex(sourceFile, content, prev)  L55
    ├─ 超限跳过 L57-61：> INDEX_MAX_FILE_BYTES(5MiB) ⇒ { skipped:true, records:[] }
    ├─ fileDigest = sha256(整个文件)  L62
    ├─ sourceVersion 递推 L63：digest 未变则沿用，变了则 prev.sourceVersion+1
    ├─ splitByteLines(buf)  L22   按 \n 切并记录每行 [start,end) 字节区间
    ├─ HEADING_RE 切块 L68       ^#{1,6}\s 开头为块起点，块尾延到下一标题前
    └─ 逐块回填 L89-104：bytes / chars（手工 UTF-8 解码计数）/ recordDigest
        │
        ▼
  records[] ──▶ verifyRecord(record, current) L117    fresh/stale 判定
                coverage(record, current, readRange) L137  覆盖率
        │
        ▼
  消费方：宿主读记忆文件时按字节区间精确取块，避免整文件重读
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L14 | `INDEX_MAX_FILE_BYTES` | 5 MiB 硬上限 |
| L22 | `splitByteLines(buf)` | 按行切并记录字节区间 |
| L55 | `buildIndex(sourceFile, content, prev)` | **构建索引**；prev 用于 sourceVersion 递推 |
| L117 | `verifyRecord(record, current)` | `{fresh, bytes, digest, fileLevel}` |
| L137 | `coverage(record, current, readRange)` | `{status, matchedBytes, totalBytes, ratio}` |
| L147 | `export { buildIndex, verifyRecord, coverage, splitByteLines, INDEX_MAX_FILE_BYTES }` | **汇聚导出点** |

### 内部关键实现

**1. sourceVersion 递推 L63**

`const sourceVersion = prev && prev.fileDigest === fileDigest ? (prev.sourceVersion || 1) : (prev ? (prev.sourceVersion || 1) + 1 : 1)`
文件内容没变 → 版本不动（让缓存命中）；变了 → +1。**注释 L58-59 记录过一次移植坑**：宿主缓存只写 `sourceVersion`，而旧读代码读 `prev.version` ⇒ 生产路径恒 `undefined` ⇒ 版本封顶 2、未变重读回退 1。

**2. 手工 UTF-8 解码计数 L94-99**

`js
for (let i = safeStart; i < safeEnd;) {
  const c = buf.readUInt8(i)
  const n = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4
  i += n
  rec.chars += 1
}
`
按首字节高位判断码元长度。**边界**：不做合法性校验 —— 遇到截断的多字节序列会**越过 `safeEnd`** 多读（`i += n` 未夹紧）。【推断】因切块边界落在标题行行首（合法 UTF-8 边界）而实际不触发，但若 `readRange` 从中间切入则可能计数偏差。

**3. 文件级 stale 语义 L110-112**

记录携带构建时 `fileDigest`；只要当前文件整体 digest 不一致，**本文件所有记录一律 stale**（哪怕该块字节没动）。无 `fileDigest` 的旧记录退化为只做切片比对（向后兼容）。这是 **fail-safe 选择**：宁可多判 stale（多读一次）也不给陈旧内容。

### 关联行号索引

- lib/memory-index.js:14
- lib/memory-index.js:117

### 与团队化的关系

**判定：S3 派生重算（Derived-recompute）。**

理由：索引完全由记忆文件内容派生（`fileDigest`/`recordDigest` 都是哈希），**同步索引没有意义** —— 把文件同步过去，各端本地重建即可，而且重建成本极低（一次 sha256 + 线性扫描）。
若同步索引，反而引入**版本漂移风险**：两端 `sourceVersion` 递推起点不同会永久错位。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| MI1 | `buildIndex` L55 返回值 | `{sourceFile, fileDigest, sourceVersion, records}` | 增加 `origin`（仅元数据，**不影响 digest**） | 结构新增 |
| MI2 | `verifyRecord` L117 | 只比 digest | **不动**（团队无关） | 无 |
| MI3 | 新增 `mergeTeamIndexPre` | 无 | 多端共享文件的索引合并（**同 digest 去重**） | 新增导出 |
| MI4 | `INDEX_MAX_FILE_BYTES` L14 | 5 MiB 硬上限 | 团队共享文件可能超限 ⇒ **建议可配置** | 常量→参数 |

> **MI4 说明**：当前超限直接 `skipped:true`（静默降级为"无索引"）。团队共享的 `MEMORY.md` 若超 5 MiB，所有成员都拿不到索引却**没有任何提示**。

#### 可直接落地的代码片段

**片段 1**：索引合并（新增导出，放 L147 导出汇聚点之前）。

```js
/**
 * 合并多端对同一逻辑文件构建的索引。
 * 为什么按 fileDigest 去重而不是按 sourceFile：团队各端的**绝对路径不同**
 * （C:\Users\A\.dsh 与 /home/b/.dsh），路径不能作身份；文件内容哈希才是。
 *
 * @param {Array<{sourceFile:string,fileDigest:string,sourceVersion:number,records:Array}>} indexes
 * @returns {{fileDigest:string|null, versions:number[], records:Array, divergent:boolean}}
 *          divergent=true 表示各端内容不一致 —— **不自动选一个**，交由调用方决定
 */
export function mergeTeamIndexPre(indexes) {
  const list = (Array.isArray(indexes) ? indexes : []).filter((x) => x && Array.isArray(x.records))
  if (!list.length) return { fileDigest: null, versions: [], records: [], divergent: false }
  const byDigest = new Map()
  for (const idx of list) {
    const d = String(idx.fileDigest || '')
    if (!byDigest.has(d)) byDigest.set(d, { versions: [], records: idx.records })
    byDigest.get(d).versions.push(Number(idx.sourceVersion) || 1)
  }
  let best = null
  for (const [digest, v] of byDigest) {
    if (!best || v.records.length > best.records.length) best = { digest: digest, versions: v.versions, records: v.records }
  }
  return {
    fileDigest: best.digest || null,
    versions: [...new Set(best.versions)].sort((a, b) => a - b),
    records: best.records,
    divergent: byDigest.size > 1,
  }
}
```

**片段 2**：超限可观测化。位置：`memory-index.js:57-61`。

```js
  if (buf.length > INDEX_MAX_FILE_BYTES) {
    // ★ Teamwork：超限不再静默。团队共享文件更可能撞上限，
    //   而"没有索引"与"文件为空"在调用方看来是一样的 —— 必须留下可观察痕迹。
    return {
      sourceFile: sourceFile, fileDigest: '', sourceVersion: (prev && prev.sourceVersion) || 1,
      skipped: true, records: [],
      skippedReason: 'file-oversize',
      skippedBytes: buf.length,
      skippedLimit: INDEX_MAX_FILE_BYTES,
    }
  }
```

### 风险与回归

| 风险 | 说明 | 缓解 |
|---|---|---|
| **路径不可作身份** | 团队各端绝对路径不同 | 片段 1 按 `fileDigest` 去重 |
| **sourceVersion 跨端错位** | 递推起点不同 | 该字段**不同步**（派生量）；只同步文件内容 |
| **超限静默** | 5 MiB 上限无提示 | 片段 2 透出 `skippedReason` |
| **UTF-8 计数越界** | 非对齐区间可能多读【推断】 | 保持切块落在标题行首；回归加"区间从中间切入"用例 |

**既有测试/守卫**：`memory-index` 单测（切块 / fresh-stale / coverage）。本次为纯新增导出 + 返回值增字段，预计不红；但**凡断言 `buildIndex` 返回对象 key 全等的用例会红**（片段 2 新增 2 个 key）。
