## dsh-home

- **规模**：6,445 B / 144 行 / 5 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**DSH_HOME 的唯一解析口径**（上游 issue #86-3）。修复前全仓有 **7 处独立解析** `process.env.DSH_HOME`，环境变量缺失时的回落各不相同（有退 `homedir()` 的、有退 `homedir()/.dsh` 的、有失败即抛的）⇒ 同一台机器上"记忆根在哪"存在多个答案。本模块把口径收敛成一个函数，其余全部改调它。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L52 | `DSH_HOME_ENV_PRE_V1` | 环境变量名常量 |
| L55 | `DSH_HOME_DIRNAME_PRE_V1` | 默认目录名 `.dsh` |
| L58 | `DSH_HOME_FALLBACK_PRE_V1` | 回落策略 |
| L86 | `resolveDshHomePre(env)` | 主解析函数 |
| L114 | `resolveDshHomeForEnginePre(env)` | 引擎侧解析 |

### 数据流

```
进程启动
  └─ resolveDshHomePre(process.env)   L86
       ├─ 命中 DSH_HOME_ENV_PRE_V1 → 直接用
       ├─ 否则 → homedir() + DSH_HOME_DIRNAME_PRE_V1  ('.dsh')
       └─ 失败 → DSH_HOME_FALLBACK_PRE_V1
            │
            ▼
       ~/.dsh/            ← 记忆根（唯一真源）
            │
            ├─ memory/          （datadir.js:memoryDir 收口）
            ├─ skills/          （skill-export-host.js:resolveSkillsRootPre）
            └─ sessions/        （subagent-gc.js 扫描）

消费方：index.js 全部路径构造点（修复前有 7 处各自解析）
```

### 内部关键实现

**1. resolveDshHomePre(env) L86 —— 优先级固定为 环境变量 > 默认目录 > 回落**

修复前 7 处解析的口径互不相同（分别见 index.js:808 / 9256 / 9613 等），其中多数环境变量缺失时回落 `homedir()/.dsh`，**但有两处回落 `homedir()`**（即把整个家目录当 DSH 根）⇒ 记忆文件会被写到 `~/memory/`。收敛后全部调用同一个函数，消除该分歧。

**2. resolveDshHomeForEnginePre(env) L114 —— 引擎侧单独出口**

引擎（语义 Python 侧）与宿主的根需要分开解析（引擎可能跑在 venv 里、cwd 不同）。**两个函数必须共享同一优先级**，任何一处改动都要同步另一处 —— 这正是 issue #86-3 想根除的"口径漂移"。

### 可直接落地的代码片段

**插入位置**：dsh-home.js:86 附近的 `resolveDshHomePre`。

```js
/**
 * 团队记忆根的相对化 —— 团队载荷**绝不携带绝对路径**。
 * 为什么：团队各端的 DSH 根不同（C:\Users\A\.dsh 与 /home/b/.dsh），
 * 绝对路径过去后无法互认；且绝对路径本身是隐私信息。
 * @param {string} absPath 本机绝对路径
 * @param {string} [dshHome] 缺省走 resolveDshHomePre()
 * @returns {{ok:boolean, rel:string|null, error?:string}}
 */
export function relativizeForTeamPre(absPath, dshHome) {
  const root = String(dshHome || resolveDshHomePre(process.env) || '')
  const p = String(absPath || '')
  if (!root || !p) return { ok: false, rel: null, error: 'empty-input' }
  // 统一分隔符后再比较：Windows 反斜杠与 POSIX 斜杠必须等价
  const norm = (s) => s.replace(String.fromCharCode(92) + String.fromCharCode(92), '/').replace(/\/+$/, '')
  const nRoot = norm(root), nP = norm(p)
  if (nP === nRoot) return { ok: true, rel: '.' }
  if (nP.indexOf(nRoot + '/') !== 0) {
    // 不在记忆根内 ⇒ 拒绝（不要把任意文件路径带进团队载荷）
    return { ok: false, rel: null, error: 'outside-dsh-home' }
  }
  return { ok: true, rel: nP.slice(nRoot.length + 1) }
}

/**
 * 反向：把团队载荷里的相对路径还原成本机绝对路径。
 * **必须做根校验**：防住 '..' 逃逸（团队载荷是不可信输入）。
 * @param {string} rel
 * @param {string} [dshHome]
 * @returns {{ok:boolean, abs:string|null, error?:string}}
 */
export function absolutizeFromTeamPre(rel, dshHome) {
  const root = String(dshHome || resolveDshHomePre(process.env) || '')
  const r = String(rel || '')
  if (!root || !r) return { ok: false, abs: null, error: 'empty-input' }
  if (r.indexOf('..') >= 0) return { ok: false, abs: null, error: 'traversal-rejected' }
  const sep = String.fromCharCode(92)
  const joined = root.replace(/[\\/]+$/, '') + sep + r.replace(/\//g, sep)
  return { ok: true, abs: joined }
}
```

### 与团队化的关系

**判定：团队共享（Shared）· 仅配置层。**

团队化后「记忆根」必须**全队一致**：若 A 的根是 `~/.dsh`、B 的根是 `~/自定义`，同步出来的路径无法互认。本模块本身不含记忆内容，但它决定了**所有物理路径的基准**，所以它的口径必须进同步契约（作为 groupId 的元数据）。

### Teamwork 改造要点

1. **把解析结果纳入团队元数据**：新账号入组时上报 `resolveDshHomePre()` 的结果（或其哈希），团队面板提示"你的记忆根与团队模板不一致"。
2. **同步时只传相对路径**：任何跨端载荷里的路径都应以 `resolveDshHomePre()` 为基做相对化，绝不传绝对路径（Windows 盘符/X 与 macOS `/Users/x` 互不认）。
3. **不改解析优先级**：团队改造不得引入"团队根优先"。用户的环境变量永远最高优先——这是 issue #86-3 修复的核心结论。

### 风险与回归

- 回归点：任何改动都可能让 7 处旧调用点中的某一处重新"自己解析"。必须断言全仓 `process.env.DSH_HOME` 直接读取点为 **1 处**（即本模块）。
- EOL 是混的（lib/*.js 纯 CRLF）⇒ 改本文件必须保持 CRLF 性质不变。
