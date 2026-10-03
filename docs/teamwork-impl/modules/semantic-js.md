
## semantic-js

- **文件**：`lib/semantic-js.js`
- **规模**：29,440 B / 570 行 / 8 个导出符号
- **职责一句话**：**内置 JS 语义引擎宿主 + 语义资产下载器** —— 普通用户装完即可用的语义能力（`js_semantic_engine_pre_v1` / `js_semantic_dl_pre_v1`）。

> ## ⚖️ 铁律适用声明（本节优先于全文其他表述）
>
> **JS 端语义模型 = 默认形态（普通用户装的就是它）；Python 端 = 发烧友主动在设置里安装的进阶项。**
> 两者是**两项相对独立、可互相替换**的功能，**严禁混为一谈、严禁互相联动**：
> 1. 不得让「选一个」同时开关另一个；
> 2. 不得让「一个的存在」成为另一个生效的前提；
> 3. 凡涉及语义唤回（recall）的设计、实现与陈述，一律按「**两套可互换实现**」表述 —— **不准写成主从、兜底、或降级关系**。
>
> **本模块的定位（经源码核实）**：本模块是**独立可用的 JS 语义链路**。在没有 Python、没装 sidecar 的机器上，本模块的**全部功能（D6 融合 / 资产探测 / 引擎 / 下载器）照常工作**。
> ⚠️ **它不是「Python 不可用时的降级」** —— 它是**默认形态**。文中一切「与 Python 同一契约 / 逐字一致」的表述，**语义均为「两套可互换实现在契约层对齐」**，**不是**主从或兜底。

### 数据流（谁调它、它读什么、产出什么）

| 方向 | 内容 |
|---|---|
| **上游输入** | 文本（记忆条目 / 查询）+ 语义计算所需参数 |
| **本模块职责** | **在纯 JS 内完成语义计算**——不依赖任何外部进程 |
| **输出** | 语义结果（向量 / 打分 / 匹配），结构与 Python 侧**契约一致** |
| **下游消费者** | `semantic-decide.js` 选中的实现路径 → `recall-fusion.js` 融合 → 召回结果 |
| **外部依赖** | **无**。不需要 Python、不需要 sidecar worker、不需要网络 |
| **副作用** | 无写盘；计算开销在进程内 |

**关键推论（铁律的正面样本）**：
- 本模块是**默认形态**：**装了 Python 也走它、没装 Python 也走它**。
- ⇒ 它的存在**不依赖**任何其它引擎；它的**可用性也不因其它引擎的存在而改变**。
- ⚠️ 判据：本模块**不得**读取「Python 是否可用」这类标志来决定自身行为。若发现此类读取，即为**铁律违规**，应标为改造点。

### 逐段精读（带真实行号）

**L1-L16 · 文件头：D6 融合与两车道策略**

- **L6**：*"`fuseD6Pre` —— 与 Python sidecar **同一契约**的 minmax 加权融合(dense 0.7 / lexical 0.3, D6)"*。
  ⇒ 措辞是「**同一契约**」而非「依赖 Python」。**两套实现各自独立算出可互换的结果**。
- **L13**：*"「要不要打断」仍属两车道策略(**Python sidecar 在场时**)。全部函数对非法输入 fail closed。"*
  ⇒ ⚠️ **需按铁律解耦（表述层）**：此句把两车道策略说成"Python sidecar 在场时"才成立 ⇒ 读起来像**JS 侧的行为由 Python 是否在场决定**，构成事实上的主从表述。**源码核实**：两车道策略的实现在 `semantic-decide.js`（纯 JS、零依赖、L265 明写"JS 端独立实现,不依赖 Python 运行时"），**与 sidecar 是否在场无关**。⇒ **应改写为**：「两车道策略由 JS 端独立实现（`semantic-decide.js`）；Python 侧有可互换实现」。见"改造点 SJ0"。

**L23-L35 · 两个版本常量与 D6 融合**

| 行号 | 符号 | 说明 |
|---|---|---|
| L23 | `JS_SEMANTIC_ENGINE_VERSION` | `js_semantic_engine_pre_v1` |
| L24 | `JS_SEMANTIC_DL_VERSION` | `js_semantic_dl_pre_v1` |
| L26 | `D6_FUSION_WEIGHTS_PRE_V1` | dense 0.7 / lexical 0.3 |
| L35 | `fuseD6Pre(arms, weights)` | **纯 JS 融合实现** |

**L120-L191 · 资产解析与探测（全本地）**

| 行号 | 符号 | 说明 |
|---|---|---|
| L120 | `resolvePeerTransformersDir(...)` | 跨 peers 解析 transformers 目录 |
| L151 | `deepScanPeerTransformers(...)` | 深度扫描（兼容多种安装布局） |
| L191 | `probeJsSemanticAssets(...)` | **资产探测**（纯本地文件系统） |

⇒ 三个函数**只读本机文件系统**，无任何网络/进程间依赖。**没有 Python 时它们照常工作**。

**L245 · 引擎工厂**

| 行号 | 符号 | 说明 |
|---|---|---|
| L245 | `createJsSemanticEnginePre(opts)` | **JS 引擎工厂**（`embedPassages` 等） |

⇒ 这是 JS 语义链路的**主入口**。**独立可用**。

**L435-L452 · 下载器（与引擎解耦）**

| 行号 | 符号 | 说明 |
|---|---|---|
| L435 | `E5_SMALL_Q8_MANIFEST_PRE_V1` | E5 小模型 q8 manifest |
| L443 | `SEMANTIC_DL_MIRRORS_PRE_V1` | 下载镜像列表 |
| L452 | `createSemanticDownloaderPre(...)` | **下载器** |

⇒ 下载器独立于引擎 ⇒ **下载失败不影响引擎已就绪时的使用**。

### 对外接口（导出符号表）

| 行号 | 符号 | 类型 |
|---|---|---|
| L23 | `JS_SEMANTIC_ENGINE_VERSION` | const |
| L24 | `JS_SEMANTIC_DL_VERSION` | const |
| L26 | `D6_FUSION_WEIGHTS_PRE_V1` | const（冻结） |
| L35 | `fuseD6Pre` | function |
| L120 | `resolvePeerTransformersDir` | function |
| L151 | `deepScanPeerTransformers` | function |
| L191 | `probeJsSemanticAssets` | function |
| L245 | `createJsSemanticEnginePre` | function（工厂） |
| L435 | `E5_SMALL_Q8_MANIFEST_PRE_V1` | const |
| L443 | `SEMANTIC_DL_MIRRORS_PRE_V1` | const（冻结） |
| L452 | `createSemanticDownloaderPre` | function（工厂） |

### 与团队化的关系

**判定：S0 私有（引擎与资产是设备级）+ S3（embedding 是派生量）。**

理由：引擎与模型资产是设备级的（数十~数百 MB，平台相关）。团队化的正确接法是共享**向量/索引**（受 `engine-identity.js:69` 身份门约束），**而不是**共享引擎或资产。
**铁律约束（正面）**：团队化**不得**让 JS 语义链路依赖团队服务端 —— 否则"团队服务端故障 = 本地语义检索消失"，等于让外部存在成为 JS 端生效的前提（违反铁律 ②）。

### Teamwork 改造点（附可直接复制的代码）

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| **SJ0** | **L13 文件头** | 「两车道策略(Python sidecar 在场时)」 | **需按铁律解耦（表述层）**：改为"两车道策略由 JS 端独立实现" | 注释；不改行为 |
| SJ1 | `createJsSemanticEnginePre` L245 | 本机引擎 | **不改**；团队化不得使它依赖团队服务端 | 纪律 |
| SJ2 | `probeJsSemanticAssets` L191 | 本机探测 | 团队诊断**只读**读取其就绪状态 | 接线 |
| SJ3 | `SEMANTIC_DL_MIRRORS_PRE_V1` L443 | 公网镜像 | **不得**把团队服务端作为语义资产镜像 | 纪律 |
| SJ4 | 新增 `describeLocalEngineForTeamPre` | 无 | 上报本机引擎就绪度（**可互换实现**口径） | 新增导出 |
| SJ5 | `fuseD6Pre` L35 | 既有融合 | 团队化**不替换**它（与 `recall-fusion` 并存，由调用方选） | 纪律 |

#### 片段 1：铁律解耦的注释改写。位置：`semantic-js.js:13`（文件头第 13 行）

```js
 *  2) 两车道激活策略（要不要打断）由 **JS 端独立实现于 semantic-decide.js**，
 *     零依赖、不读 Python 运行时；Python 侧另有**可互换实现**（m7_activation_features_pre_v2）。
 *     ★ 两者是**两项相对独立、可互相替换**的功能：JS 端不因 Python 是否在场而改变行为。
 *  3) 全部函数对非法输入 fail closed。
```

#### 片段 2：本机引擎就绪度上报（新增导出，放文件末尾）。**只读、可互换口径**

```js
/**
 * 上报本机 JS 语义引擎就绪度 —— 团队诊断用（**只读，不改变引擎行为**）。
 *
 * ★ 铁律口径（必须遵守）：
 *   本函数描述的是「**JS 端这套实现**就绪与否」，**不是**「Python 不在所以降级了」。
 *   字段名刻意用 kind:'js'|'none'，**不用** 'fallback' / 'degraded' 一类词 ——
 *   那会把 JS 端说成兜底实现，违反「两套可互换实现」的表述纪律。
 *
 * 为什么团队需要它：成员的检索质量天然不同（有人已下载 JS 资产、有人还没）。
 *   若不解释，用户会把差异归因于**记忆同步没生效**。acceptance.js:13 同款纪律：如实记录。
 *
 * @param {{probe?:object, engineIdentity?:string}} input
 * @returns {{ready:boolean, kind:'js'|'none', note:string}}
 */
export function describeLocalEngineForTeamPre(input) {
  const x = input || {}
  const p = x.probe || {}
  const ready = p.ok === true || p.ready === true
  const note = ready
    ? ('本机 JS 语义引擎已就绪（身份 ' + String(x.engineIdentity || '').slice(-8) +
       '）。这是默认形态，全功能可用。')
    : ('本机 JS 语义引擎资产**未就绪**（尚未下载或探测失败）。' +
       '下载完成后即为全功能语义链路；当前团队记忆仍可读取与检索。')
  return { ready: ready, kind: ready ? 'js' : 'none', note: note }
}
```

#### 片段 3：镜像列表**不得**混入团队端点。位置：`semantic-js.js:443`

```js
// ★ 铁律纪律：语义资产下载镜像**只允许公网/官方镜像**。
//   为什么明确禁止把团队服务端当镜像：
//     ① 铁律 ②：JS 端是**默认形态**，其可用性**不得**依赖任何外部服务
//        （否则团队服务端一挂，普通用户的语义检索也没了 ⇒ 外部存在成了 JS 端生效的前提）；
//     ② 模型资产体积大（E5 小模型 q8 亦达数十 MB），走团队通道会挤占同步带宽；
//     ③ 资产有版本与完整性要求（manifest + 校验），团队通道不承担该职责。
//   ⇒ 团队化只共享「向量/索引」（受 engine-identity.js:69 身份门约束），**不共享资产**。
export const SEMANTIC_DL_MIRRORS_PRE_V1 = Object.freeze([
  // ...既有镜像列表保持不变（不得追加团队端点）...
])
```

### 风险与守卫

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **JS 端被写成兜底/降级** | 文案或字段名用 fallback/degraded | 片段 1 改写 L13；片段 2 字段名只用 `'js'`/`'none'`' |
| **JS 端依赖团队服务端** | 为"统一引擎"接入团队 | SJ1/SJ3 纪律 + 铁律 ② |
| **JS 端依赖 Python 在场** | 沿用 L13 的旧表述实现分支 | SJ0 解耦；回归断言"Python 缺失时 JS 链路行为逐字节不变" |
| **替换而非并存融合** | 直接改掉 `fuseD6Pre` | SJ5：与 `recall-fusion` 并存（该文件头明文"不替换"） |
| **资产走团队通道** | 把团队端当镜像 | 片段 3 明文禁止 |

**既有守卫**：`semantic-js` 的资产探测 / 引擎工厂 / 下载器用例；`D6_FUSION_WEIGHTS_PRE_V1` 与 `E5_SMALL_Q8_MANIFEST_PRE_V1` 是**冻结常量**，改动会打红守卫。
**铁律相关的回归缺口（建议补）**：现有用例未覆盖"Python/sidecar 完全缺失时，`fuseD6Pre` / `createJsSemanticEnginePre` / `probeJsSemanticAssets` 行为不变" ⇒ 建议补一条**负路径守卫**，把铁律钉成可断言事实。
