## config-io

- **规模**：9,814 B / 210 行 / 8 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

配置文件的**原子写**与**损坏隔离**（上游 issue #82）。解决两个病：①写侧非原子 ⇒ 半截 JSON ⇒ 下次启动 `JSON.parse` 抛错 ⇒ 静默回落出厂默认、用户设置丢失；②读侧静默 ⇒ 配置坏了用户看不到。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L35 | `ATOMIC_TMP_SUFFIX_PRE_V1` | 原子写临时后缀 `.tmp` |
| L59 | `CORRUPT_QUARANTINE_PREFIX_PRE_V1` | 损坏隔离前缀 |
| L77 | `quarantineFilePreSync(...)` | 同步隔离坏文件 |
| L94 | `writeTextAtomicPreSync(...)` | 同步原子写 |
| L145 | `writeTextAtomicPre(...)` | 异步原子写 |
| L170 | `readJsonQuarantinePreSync(...)` | 读侧隔离 |
| L193 | `looksTruncatedJsonPre(...)` | 截断 JSON 识别 |
| L201 | `isNonEmptyFilePreSync(...)` | 非空判据 |

### 数据流

```
写侧：配置对象 ──▶ writeTextAtomicPreSync(path, text)  L94
                     ├─ tmp = path + ATOMIC_TMP_SUFFIX_PRE_V1 + '-' + pid + '-' + (++_tmpSeqPre)   L38-55
                     ├─ writeFileSync(tmp)
                     └─ renameSync(tmp, path)      ← 原子替换

读侧：文件 ──▶ readJsonQuarantinePreSync(path)  L170
                ├─ JSON.parse 成功 → 返回
                └─ 失败
                     ├─ looksTruncatedJsonPre(text)  L193  判定是否"半截"
                     └─ 移入 CORRUPT_QUARANTINE_PREFIX_PRE_V1 前缀文件   L59 / L77
                        （**不再静默回落出厂默认**）

消费方：index.js 配置加载/保存、embedding-config.json
```

### 内部关键实现

**1. tmp 名的唯一段 = pid + 进程内自增序号 L38-55**

注释记录了病症：tmp 名原先**只由目标路径决定**（目标路径 + 固定后缀）⇒ 对同一目标并发保存时，两个进程/两次调用写同一个 tmp ⇒ 一个 rename 后另一个 rename **ENOENT 或错乱**。处方：每次调用生成独立 tmp 名，跨进程靠 pid 区分。代价是进程崩溃会留下 `.tmp-<pid>-<n>` 垃圾文件。

**2. 读侧"损坏隔离"替代"静默重置" L170-193**

旧实现两个 load 函数的 catch 一律返回出厂默认（`_mergeConfigPre(null)`），错误只塞进 `this._readError` ⇒ 用户看不到"我的配置坏了、已被重置"。现改为**隔离 + 可见**。

**3. 与 hub-io.js 的对比（同一缺陷类）**

`config-io.js:50` 已修（pid + 序号）；而 `hub-io.js:110` 至今仍是固定名 `file + 后缀`，`recall-stats.js:123` 同样是固定名。**同型缺陷在仓内已第三次出现**。

### 可直接落地的代码片段

**插入位置**：config-io.js:94 附近的 `writeTextAtomicPreSync`。

```js
/**
 * 团队配置的原子写 —— **复用既有原子写**，不另造一套。
 *
 * 为什么必须复用：issue #82 修复的正是"裸 writeFileSync 留下半截 JSON ⇒
 * 下次启动静默回落出厂默认 ⇒ 用户设置丢失"。团队配置若裸写，会重蹈同一事故，
 * 而且影响面从"一个人丢设置"扩大到"全队配置损坏"。
 *
 * @param {string} filePath 团队配置文件绝对路径
 * @param {object} obj 配置对象
 * @returns {{ok:boolean, error?:string}}
 */
export function writeTeamConfigAtomicPre(filePath, obj) {
  try {
    // 复用本模块的原子写（tmp 名已带 pid + 序号，见 ATOMIC_TMP_SUFFIX_PRE_V1 与 tmpNamePre）
    writeTextAtomicPreSync(filePath, JSON.stringify(obj, null, 2))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : String(e) }
  }
}
```

### 与团队化的关系

**判定：私有（Private）· 设备级。**

配置是**设备与用户级**的（路径、开关、模型选择、端口），同步它会把 A 的机器环境强加给 B。团队化只需要同步**一个显式的团队配置块**（groupId、同步开关、治理策略），其余本机配置继续私有。

### Teamwork 改造要点

1. **团队配置走独立文件**：新增 `team-config.json`，复用本模块的 `writeTextAtomicPreSync`，**不要**把团队键塞进现有 config（会触发"单一开关不得顺带改变其他行为"的规则）。
2. **临时名必须带 pid + 序号**：本模块 L38-55 已修过（唯一段 = pid + 进程内自增序号）。**这是全仓第 N 次踩同型缺陷**（`hub-io.js:110` 至今仍是固定 `.tmp`）。团队化后并发写会更多，所有新写入点必须复用本模块的 tmp 命名，不得自己拼。
3. **损坏隔离要在团队面板可见**：配置被隔离（quarantine）是关键事件，应作为团队诊断项上报。

### 风险与回归

- 回归点：`lib/config-io.js:35` 的 `ATOMIC_TMP_SUFFIX_PRE_V1` 是**被外部断言的常量**，改名会打红守卫。
- 本模块的两条修复路径（issue #82）都有实测用例，新增团队配置**必须复用**而不是另写一套原子写。
