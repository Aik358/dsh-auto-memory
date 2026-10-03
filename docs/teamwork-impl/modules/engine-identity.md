
## engine-identity

- **规模**：7,685 B / 150 行 / 12 个导出符号
- **交付形态**：**完整版**

### 职责

**引擎身份**（`engine_identity_pre_v1`）—— P2「引擎隔离」的**地基**（V2-P2 卡 / 评审 §3.5）。
**为什么需要它（权威依据，文件头逐字）**：*"V2-P2 卡明确指出：单个 `PROVIDER_ID_INT8`（`python-setup.js:55`）**不足以**标识模型内容 / tokenizer / 预处理；两层缓存若只凭 `chunkId` 或**裸输入哈希**读取，**仍会串用两套向量**（e5 384 维与 bge-m3 1024 维混进同一次排序 = T2-9 判失败）。因此身份必须够宽，至少覆盖：模型与权重摘要 · tokenizer 版本 · 精度格式 · 维度 · 池化 · 归一化 · 输入处理版本。"*

### 数据流

```
引擎描述（模型 / tokenizer / 精度 / 维度 / 池化 / 归一化 / 输入处理版本）
   │
   ▼
canonicalEngineDescPre(desc)   L52   规范化（字段顺序固定）
   │
   ▼
computeEngineIdentityPre(desc)  L69   ★ 身份派生（ENGINE_IDENTITY_PREFIX L31 + 哈希）
   ├─ ENGINE_IDENTITY_FIELDS  L34   **字段白名单**（够宽：覆盖 7 类）
   ├─ weightsDigestOfFilePre(file)  L111  权重文件摘要
   └─ describeEngineIdentityPre(id) L146  身份 → 可读描述
        │
        ▼
isEngineIdentityPre(id)      L75   形状判据
engineIdentityMatchesPre(a,b) L80  等价判据
aliasKeyPre(...)             L90   别名键
vectorKeyPre(...)            L100  向量键
        │
        ▼
内置描述：
  JS_E5_IDENTITY_DESC_PRE_V1  L118    （JS 默认小模型 e5）
  pyBgeM3IdentityDescPre(...) L131    （Python 进阶 bge-m3）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L28 / L31 / L34 | 版本 / 前缀 / **字段白名单** | 身份契约 |
| L52 | `canonicalEngineDescPre(desc)` | 规范化描述 |
| L69 | `computeEngineIdentityPre(desc)` | **身份派生** |
| L75 | `isEngineIdentityPre(id)` | 形状判据 |
| L80 | `engineIdentityMatchesPre(a, b)` | 等价判据 |
| L90 / L100 | `aliasKeyPre` / `vectorKeyPre` | 别名键 / 向量键 |
| L111 | `weightsDigestOfFilePre(file)` | 权重摘要 |
| L118 / L131 | 两个内置引擎描述 | JS e5 / Python bge-m3 |
| L146 | `describeEngineIdentityPre(id)` | 身份 → 描述 |

### 内部关键实现

**1. 身份必须"够宽"（文件头 + L34）**

七类字段：模型与权重摘要、tokenizer 版本、精度格式、维度、池化、归一化、输入处理版本。
⇒ **任何一个缺失都会导致串用**。团队化后这一条**从"可选优化"变成"硬门"**：成员 A 用 JS 小模型、成员 B 装 Python bge-m3，维度不同 ⇒ 混排会直接污染排序。

**2. 两级缓存键（L90 / L100）**

`aliasKeyPre`（别名键）与 `vectorKeyPre`（向量键）分开 ⇒ 支持"同一模型不同别名"与"不同模型同向量空间"的区分。团队化跨端复用向量必须走 `vectorKeyPre`。

**3. 两个内置描述（L118 / L131）**

JS 默认（e5）与 Python 进阶（bge-m3）各有一份描述 ⇒ **两套引擎身份是不同的**，这正是"两项相对独立、可互相替换"铁律的技术基础。

**4. 与 `l0-index` 的复用门（关键联动）**

`l0-index.js` 的跨端向量复用**必须先过本模块的身份门**（见 `l0-index.md` 的 `canReuseRemoteVectorPre`）。缺失身份 ⇒ 拒绝复用（fail closed）。

### 关联行号索引

- lib/engine-identity.js:28
- lib/engine-identity.js:52
- lib/engine-identity.js:69
- lib/engine-identity.js:111

### 与团队化的关系

**判定：S2 团队共享（身份必须随向量一起传递）+ 硬门。**

理由：身份是"这段向量属于哪个模型空间"的**唯一凭据**。团队共享向量时**必须连同身份一起传**，否则接收方无法判断能否复用 ⇒ **必然串用**。
**纪律**：身份**绝不能**由接收方"猜"（如按文件大小、按 provider 名）—— 必须随载荷显式携带。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| EI1 | `ENGINE_IDENTITY_FIELDS` L34 | 七类字段 | **不得缩减**；团队化若新增维度（如量化档）只能追加 | 纪律 |
| EI2 | `computeEngineIdentityPre` L69 | 本地派生 | 保持不变（确定性）；团队两端各自算 | 纪律 |
| EI3 | `engineIdentityMatchesPre` L80 | 等价判据 | 团队复用前**必须调用**（fail closed 前置门） | 接线 |
| EI4 | 新增 `assertVectorReuseAllowedPre` | 无 | 组合判定：身份 + 维度 + l0Hash 三者一致才允许复用 | 新增导出 |
| EI5 | 身份缺失处理 | 无 | **缺失即拒绝**（不得"默认同模型"） | 纪律 |

#### 可直接落地的代码片段

**片段 1**：向量复用总门（新增导出，放文件末尾）。**三个条件全过才放行。**

```js
/**
 * 团队向量复用总门 —— **三个条件全部满足才允许复用**，任一缺失即拒绝。
 *
 * 为什么必须是三个条件的**与**（而不是只看身份）：
 *   ① 身份一致    —— 保证向量空间可比（本模块的核心职责，见文件头 T2-9 案例）；
 *   ② 维度一致    —— 身份描述可能因描述串写错而不一致地生成，维度是**最后一道物理防线**
 *                    （384 vs 1024 混排会直接抛错或产生无意义的相似度）；
 *   ③ l0Hash 一致 —— 保证是**同一条内容**的向量（否则复用的是别人的内容向量）。
 *   ⇒ 只满足 ① 仍可能复用错内容；只满足 ③ 仍可能跨模型串用。
 *
 * fail closed：任一字段缺失（含身份为空串）⇒ 拒绝复用，宁可让本端重算。
 *
 * @param {{engineIdentity:string, dimension:number, l0Hash:string}} local
 * @param {{engineIdentity:string, dimension:number, l0Hash:string}} remote
 * @returns {{allowed:boolean, reason:string}}
 */
export function assertVectorReuseAllowedPre(local, remote) {
  const l = local || {}, r = remote || {}
  const li = String(l.engineIdentity || ''), ri = String(r.engineIdentity || '')
  if (!li || !ri) return { allowed: false, reason: 'engine-identity-missing' }
  if (li !== ri) return { allowed: false, reason: 'engine-identity-mismatch' }
  const ld = Number(l.dimension), rd = Number(r.dimension)
  if (!Number.isFinite(ld) || !Number.isFinite(rd)) return { allowed: false, reason: 'dimension-missing' }
  if (ld !== rd) return { allowed: false, reason: 'dimension-mismatch' }
  const lh = String(l.l0Hash || ''), rh = String(r.l0Hash || '')
  if (!lh || !rh) return { allowed: false, reason: 'l0hash-missing' }
  if (lh !== rh) return { allowed: false, reason: 'l0hash-mismatch' }
  return { allowed: true, reason: 'ok' }
}
```

**片段 2**：团队身份上报（**只上报身份，不上报一切细节**）。位置：`engine-identity.js` 文件末尾。

```js
/**
 * 生成可上报的身份摘要 —— 团队诊断用，**不泄露模型实现细节**。
 *
 * 为什么不让团队面板看完整身份串：身份串里含权重文件摘要与输入处理版本，
 * 属于实现细节（可能暴露用户装了哪个量化档/哪个权重）。
 * 团队真正需要知道的是"两名成员的向量空间是否可比"——
 * 一个**可比较的短摘要**就够。
 *
 * @param {string} engineIdentity
 * @returns {{comparableId:string, readable:string}}
 */
export function teamComparableIdentityPre(engineIdentity) {
  const id = String(engineIdentity || '')
  return {
    // 取身份哈希的短前缀作为"可比标识"：同前缀 ⇒ 可复用
    comparableId: id ? id.slice(-16) : '',
    readable: id ? describeEngineIdentityPre(id) : '未就绪',
  }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **跨模型串用向量** | 复用只看 l0Hash | 片段 1 三条件与门；对照文件头的 T2-9 失败案例 |
| **身份字段被缩减** | 为省载荷精简字段 | EI1 纪律；缩减会让"同名不同实"的模型通过身份判据 |
| **身份由接收方猜测** | 按文件大小/provider 名推断 | EI5：缺失即拒绝 |
| **身份含实现细节外泄** | 团队面板直接展示完整身份串 | 片段 2 只给短摘要 + 可读描述 |
| **两端各自偏差异常** | 描述串字段顺序不同 | `canonicalEngineDescPre`（L52）固定顺序；不得绕过它直接哈希 |

**既有测试/守卫**：`engine-identity` 的身份确定性与等价判据用例、两个内置描述用例。`l0-index` / `engine-switch` / `l0-index-sync` 三处都消费它 ⇒ 改动需多处联合验证。
