
## m4-corpus

- **规模**：10,045 B / 176 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**M4-2 Corpus Adapter** —— SourceCatalog / M3b sidecar 校验 / CorpusRegistry（`docs/M4-CONTRACT.md` §7/§8）。
**纯适配层**：输入为受控 source paths 与磁盘 shadow-copy；**不接触 live Host、不做 audit、不注入**。
三条职责（文件头逐字）：
1. `buildSourceCatalog({workspaceKey, userMemoryPath, workspaceMemoryPath, todayLogPath})`：固定顺序三源 catalog（user / workspace / workspace-log），canonical 化，sourceRef 稳定相对引用；
2. `canonicalScopeGuard`：`sidecar.sourceFile` 必须与 catalog canonical **完全一致**；**symlink / reparse 解析真实路径不得逃逸允许根**（`realpathSync`）；
3. `loadCorpusSnapshot(catalog, fsApi)`：逐源 `parseSidecar` → stat/read → `fileDigest` 比对。

### 数据流

```
受控 source paths（user / workspace / workspace-log）
   │
   ▼
buildSourceCatalog(opts)   L40   ★ 固定顺序三源
   ├─ canonicalize(path)   L26   规范化
   ├─ canonicalScopeGuard(catalog, sidecar)  L59
   │     ├─ sidecar.sourceFile 必须与 catalog canonical **完全一致**
   │     └─ realpathSync 解析后**不得逃逸允许根**（symlink / reparse 防护）
   └─ sourceRef 稳定**相对**引用
        │
        ▼
loadCorpusSnapshot(catalog, fsApi)   L75
   ├─ 逐源 parseSidecar（memory-anchor.parseSidecar L308）
   ├─ stat / read → fileDigest 比对
   └─ dropped 分类（stale / missing / invalid）
        │
        ▼
sourceFingerprint(...)  L145   → 语料指纹
CorpusRegistry  L153          → 语料注册表
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L26 | `canonicalize(p)` | 路径规范化 |
| L40 | `buildSourceCatalog(opts)` | **三源 catalog** |
| L59 | `canonicalScopeGuard(catalog, sidecar)` | **作用域守卫（防逃逸）** |
| L75 | `loadCorpusSnapshot(catalog, fsApi)` | **语料快照加载** |
| L145 | `sourceFingerprint(...)` | 语料指纹 |
| L153 | `CorpusRegistry` | 语料注册表 |

### 内部关键实现

**1. canonicalScopeGuard 是安全边界（L59）**

两条硬约束：① `sidecar.sourceFile` 与 catalog canonical **完全一致**（不是前缀匹配）；② `realpathSync` 解析真实路径**不得逃逸允许根**。
⇒ 防 **symlink / Windows reparse point** 绕过作用域。**团队化会放大该风险**：共享来的 sidecar 若指向任意路径，会导致读入他人机器上的任意文件。

**2. 纯适配层、不接触 live Host（文件头）**

*"不接触 live Host、不做 audit、不注入"* ⇒ 可被独立单测（`fsApi` 注入）。

**3. sourceRef 是稳定相对引用（文件头）**

*"sourceRef 稳定相对引用"* ⇒ 不含绝对路径 ⇒ **可直接进团队载荷**（与 `dsh-home.js:86` 的相对化纪律一致）。

**4. dropped 分类被 storage-manage 复用**

`loadCorpusSnapshot` 的 dropped 分类被 `storage-manage.js:28` 的语料健康扫描**复用**（见该模块文件头："语料健康扫描 = 逐源 sidecar ↔ 正文 fileDigest 比对（复用 M4-2 loadCorpusSnapshot 的 dropped 分类）"）⇒ **一处分类、两处消费**。

**5. 固定顺序三源（L40）**

顺序固定 ⇒ catalog 的 canonical 形态确定 ⇒ 两端可比较。

### 与团队化的关系

**判定：S3 派生重算（catalog / 快照）+ 安全边界（必须全队一致）。**

理由：catalog 是"哪些文件参与语料"的**授权清单**，完全由本机路径派生 ⇒ 不同步。
**但 canonicalScopeGuard 的判据必须全队一致**：若 A 端允许、B 端拒绝同一份 sidecar，团队语料同步会出现"A 能发、B 不能收"的分叉。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| MC1 | `canonicalScopeGuard` L59 | 本地作用域 | 团队 sidecar **必须过同一守卫**（绝不放宽） | 纪律 |
| MC2 | `buildSourceCatalog` L40 | 三源 | 团队语料作为**第四类源**（独立 catalog 项） | 新增项 |
| MC3 | `sourceFingerprint` L145 | 本地指纹 | 团队语料指纹用于"是否需要重新同步"判据 | 接线 |
| MC4 | 新增 `assertTeamCorpusScopedPre` | 无 | 团队载荷作用域断言（fail closed） | 新增导出 |
| MC5 | `dropped` 分类 | 本地 | 团队语料的 dropped 必须**可观察上报** | 接线 |

#### 可直接落地的代码片段

**片段 1**：团队语料作用域断言（新增导出，放文件末尾）。**复用既有守卫，不另写判据。**

```js
/**
 * 团队语料作用域断言 —— **复用 canonicalScopeGuard，不另写一套判据**。
 *
 * 为什么必须复用（本仓反复出现的纪律："同一语义若在多个函数里各写一份判据，
 * 改动必须一次改全，只改部分会进入半修状态"）：
 *   canonicalScopeGuard L59 里那两条硬约束（sourceFile 完全一致 + realpathSync 不逃逸）
 *   是**安全边界**。团队载荷是**外部输入**，若为它另写一份更宽松的判据，
 *   等于开了一个可以读任意文件的通道。
 *   ⇒ 团队语料与本地语料走**同一个**守卫；本函数只负责"把它调起来 + 给出团队语义的错误码"。
 *
 * @param {object} catalog buildSourceCatalog 的输出
 * @param {object} sidecar 待校验的 sidecar（可能来自团队）
 * @returns {{ok:boolean, reason?:string, detail?:string}}
 */
export function assertTeamCorpusScopedPre(catalog, sidecar) {
  if (!catalog || !sidecar) return { ok: false, reason: 'missing-input' }
  const g = canonicalScopeGuard(catalog, sidecar)
  if (g && g.ok === false) {
    return { ok: false, reason: 'team-scope-rejected:' + String(g.reason || 'unknown'), detail: String(g.detail || '') }
  }
  return { ok: true }
}
```

**片段 2**：团队语料的 dropped 上报。位置：`m4-corpus.js:75`（`loadCorpusSnapshot` 返回处）。

```js
  // ★ Teamwork：团队语料的 dropped 必须**可观察**。
  //   为什么：本地 dropped 只影响自己（少几条语料，用户可能察觉不到）；
  //   团队 dropped 意味着"队友看到的语料比实际少"，会直接影响团队语义检索质量，
  //   且症状是"团队检索好像不太准"—— 与 degrade.js:33 记录的 R2 事故同型（降级不可见）。
  //   ⇒ 走 degrade 台账（arm='team'），而不是只记本地 diag。
  const out = { ok: true, records: records, dropped: dropped, sources: sources }
  if (dropped && dropped.length && opts.degrade && typeof opts.degrade.note === 'function') {
    try {
      opts.degrade.note({ arm: 'team', kind: 'corpus-dropped', reason: 'dropped=' + dropped.length, at: Date.now() })
    } catch (_) {}
  }
  return out
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **symlink/reparse 逃逸** | 团队 sidecar 指向任意路径 | 片段 1 复用守卫（不放宽）；回归须有逃逸负路径用例 |
| **第二套作用域判据** | 为团队另写更宽松的门 | 片段 1 强制复用 |
| **团队 dropped 不可见** | 只记本地 diag | 片段 2 进 degrade 台账 |
| **catalog 顺序错乱** | 团队新增源插到前面 | MC2：独立项；回归断言既有三源顺序不变 |

**既有测试/守卫**：`m4-corpus` 的 catalog / 作用域 / 快照用例（含 symlink 逃逸负路径）。`storage-manage` 复用其 dropped 分类 ⇒ 改动需两模块联合验证。
