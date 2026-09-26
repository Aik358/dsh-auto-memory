
## engine-switch

- **规模**：11,952 B / 248 行 / 2 个导出符号
- **交付形态**：**完整版**

### 职责

**引擎切换状态机**（`engine_switch_pre_v1`）—— P2 / T2-9 切档隔离与进度条（V2-P2 卡 points 4/5）。
**权威依据（评审 §3.5 采纳条目 + V2-P2 卡），文件头六条纪律**：
- **切档 = 强制全量重建 + 进度条**（用户裁定）：每次**实际切换**创建**新 rebuild generation**，目标重建**不复用旧代一二级缓存**（含 e5→BGE→e5）；完成后恢复日常增量；
- **进度只能有一个真实所有者**：本模块持有唯一进度状态；`semantic-status` 与向导只**投影**它，不自行维护第二套计数；
- **保存后才启动切换**：调用方在配置落盘后调 `beginEngineSwitchPre`，不由下拉框未保存值驱动；
- **进度只能来自实际完成量**：`done` 由 `reportScopeDone` 逐项累加；**manifest 发布前不得显示整体完成**；
- **A 未完成又发起 B**：B 使 A 作废（superseded）；**A 迟到不能发布 B 的 ready**（switchId 校验）；
- **同一 switchId 重试不重复编码**：已完成（ready）的同 id 再次 begin 直接返回现状，不重跑。

### 数据流

```
beginEngineSwitchPre(desc)   → 新 rebuild generation（switchId）
   ├─ 若同 switchId 已 ready ⇒ **直接返回现状，不重跑**
   └─ 若前一个未完成 ⇒ 前一个 **superseded**
        │
        ▼
setEngineSwitchTotal / reportScopeDone / reportEngineSwitchDone
   └─ done 逐项累加（**进度只能来自实际完成量**）
        │
        ▼
publishEngineSwitchReady(switchId)
   ★ **switchId 校验**：A 迟到不能发布 B 的 ready
   ★ phase 未到 'ready' 前 indexReady 恒 false（即便 done==total）
        │
        ▼
failEngineSwitch / cancelEngineSwitchPre / getEngineSwitchStatusPre
requiresFullRebuild(...)  → 是否需强制全量重建
dispose()  清空状态
   ENGINE_SWITCH_VERSION L25
   状态查询：getEngineSwitchStatusPre（**唯一进度所有者**，供 semantic-status 投影）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L25 | `ENGINE_SWITCH_VERSION` | `engine_switch_pre_v1` |
| L39 | `createEngineSwitchPre(opts)` | **工厂（唯一进度所有者）** |

**实例方法**：`beginEngineSwitchPre`、`cancelEngineSwitchPre`、`getEngineSwitchStatusPre`、`reportEngineSwitchDone`、`setEngineSwitchTotal`、`publishEngineSwitchReady`、`failEngineSwitch`、`requiresFullRebuild`、`dispose`。

### 内部关键实现

**1. "进度只能有一个真实所有者"（文件头）**

*"`semantic-status` 与向导只**投影**它，不自行维护第二套计数（python-setup 的 status 只读投影，见 index.js semantic-status 接线）。"*
⇒ **单一真源**。这正是用户既有判据的正面案例："凡有两个可独立影响同一行为的输入，即未真正合并。"

**2. "manifest 发布前不得显示整体完成"（文件头）**

`phase` 未到 `'ready'` 前 `indexReady` 恒 false，**即便 `done==total` 也须等 `publish`**。
⇒ 防"进度条 100% 但实际没建好"的**假完成**。

**3. "A 迟到不能发布 B 的 ready"（文件头）**

用 `switchId` 校验 ⇒ 旧代的迟到回调不会污染新代状态。⇒ 这是**并发状态机的核心正确性**。

**4. "同一 switchId 重试不重复编码"（文件头）**

已完成（ready）的同 id 再次 begin **直接返回现状，不重跑** ⇒ 幂等。

**5. 切档必须强制全量重建（文件头）**

*"每次**实际切换**创建**新 rebuild generation**，目标重建**不复用旧代一二级缓存**（含 e5→BGE→e5）"*
⇒ e5→BGE→e5 回到原点**也必须重建**（因为中途 BGE 可能污染了缓存）。**团队化后这条更重要**：跨端索引混合会加剧缓存污染风险。

### 关联行号索引

- lib/engine-switch.js:25
- lib/engine-switch.js:39

### 与团队化的关系

**判定：S0 私有（本机引擎切换态）+ S2（切换完成后产生的索引可共享）。**

理由：切换进度、generation、superseded 关系都是**本机运行态**（跟本机的引擎安装情况绑定）。团队化不改变这一点。
**但**：切换产生的**索引**是可共享产物（受 `engine-identity` 门约束）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| ES1 | `getEngineSwitchStatusPre` | 本地投影 | 团队面板**只读投影**（沿用"唯一所有者"纪律） | 接线 |
| ES2 | `beginEngineSwitchPre` | 本地切换 | 切换后**必须重算**团队可复用向量（身份变了） | 接线 |
| ES3 | 新增 `invalidateTeamVectorsOnSwitchPre` | 无 | 引擎切换 ⇒ 失效跨端复用的向量缓存 | 新增导出 |
| ES4 | `requiresFullRebuild` | 本地判定 | 团队索引也需重建（**不得复用旧身份向量**） | 接线 |
| ES5 | 进度真源（文件头） | 单一所有者 | 团队进度展示**不得**新建计数 | 纪律 |

#### 可直接落地的代码片段

**片段 1**：引擎切换导致的团队向量失效（新增导出，放文件末尾）。**关键：切换后旧身份向量一律不可复用。**

```js
/**
 * 引擎切换 ⇒ 团队可复用向量缓存**必须整体失效**。
 *
 * 为什么不能"只失效变化的那些"：
 *   引擎切换意味着**向量空间整体改变**（模型 / 维度 / 池化 / 归一化任一变化，
 *   见 engine-identity.js:34 的字段白名单）。旧身份下的**全部**向量在新空间里都不可比，
 *   不存在"部分仍有效"的情况。
 *   ⇒ 整体失效，让下次同步按新身份重新拉取/重算。
 *
 * 为什么必须显式做（而不是依赖身份门兜底）：
 *   身份门能挡住**复用**，但缓存条目会一直占着空间与同步带宽
 *   （团队索引可能很大）；显式失效才能释放。
 *
 * @param {object} cache { byIdentity: Map<string, any[]> } 或等价结构
 * @param {string} newIdentity 切换后的引擎身份
 * @returns {{ok:boolean, removedIdentities:number, keptIdentities:number}}
 */
export function invalidateTeamVectorsOnSwitchPre(cache, newIdentity) {
  const c = cache || {}
  const byId = c.byIdentity
  if (!byId || typeof byId.forEach !== 'function') return { ok: false, removedIdentities: 0, keptIdentities: 0 }
  const keep = String(newIdentity || '')
  const toRemove = []
  byId.forEach((_v, k) => { if (String(k) !== keep) toRemove.push(k) })
  for (const k of toRemove) {
    if (typeof byId.delete === 'function') byId.delete(k)
  }
  let kept = 0
  byId.forEach(() => { kept++ })
  return { ok: true, removedIdentities: toRemove.length, keptIdentities: kept }
}
```

**片段 2**：切换完成后的重建触发（接线说明 + 代码）。位置：`engine-switch.js` 的 `publishEngineSwitchReady` 成功分支。

```js
    // ★ Teamwork：引擎切换**正式 ready 之后**才触发团队向量失效。
    //   为什么必须放在 publish 之后、而不是 begin 时：
    //     begin 只是"开始切换"，此时若切换失败/被 superseded，旧身份其实仍然有效
    //     （用户可能还在用旧引擎）。过早失效会让用户在**切换失败后**也没有可用向量。
    //   ⇒ 只有 phase 真正到 'ready'（文件头：manifest 发布后才算完成）才失效。
    //   同时注意 switchId 校验（文件头纪律：A 迟到不能发布 B 的 ready）——
    //   本分支只在 switchId 校验通过后才执行，天然满足。
    const inv = invalidateTeamVectorsOnSwitchPre(teamVectorCache, newEngineIdentity)
    diag('team vectors invalidated: removed=' + inv.removedIdentities + ' kept=' + inv.keptIdentities)
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **两套进度计数** | 团队面板自建进度 | ES5 纪律（文件头"唯一真实所有者"） |
| **假完成** | done==total 即显示完成 | 文件头：phase 到 ready 前 indexReady 恒 false |
| **旧代迟到污染** | A 的迟到回调发布 ready | switchId 校验（既有能力，改动不得绕过） |
| **切换后复用旧向量** | 只失效变化项 | 片段 1 整体失效 |
| **切换失败也失效** | 在 begin 时就失效 | 片段 2 放在 publish 之后 |

**既有测试/守卫**：`engine-switch` 的状态机用例（generation / superseded / switchId 校验 / 幂等重试 / 假完成防护）。文件头六条纪律**很可能被逐条断言**。
