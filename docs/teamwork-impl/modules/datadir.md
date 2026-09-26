## datadir

- **规模**：4,174 B / 96 行 / 1 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

记忆数据目录的唯一收口（去 pre 后统一裸名）。历史目录名带 `-pre` 后缀，本模块负责**目录名解析 + 迁移补齐**。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L64 | `memoryDir(...)` | 记忆根目录解析（唯一收口） |

### 数据流

```
resolveDshHomePre()  →  ~/.dsh
                          └─ memoryDir(name)  L64
                               └─ ~/.dsh/memory/<name>
                                    （name 缺省 = 裸名；历史名为 <name>-pre）

迁移（去 pre，2026-09-23）：
  旧：~/.dsh/memory/facts-pre/facts.json
  新：~/.dsh/memory/facts/facts.json
  策略：**不 move，只增量补齐** —— 逐文件判"新位置是否已有语义上等价的文件"
```

### 内部关键实现

**1. 为什么是"逐文件语义判据"而不是"目录是否存在"（L40-52 三条实测依据）**

| 依据 | 实测事实 | 若用"目录存在"判据的后果 |
|---|---|---|
| ① 活宿主仍在写旧目录 | 改名后 `hub-pre/facts.json` 仍有写入 | move 会**分脑丢数据** |
| ② 裸名目录已存在 | `memory/hub/` 创建于 09-01、含 3 个 0 条 JSON 空壳 | "新目录不存在才复制"**整条跳过** |
| ③ 后果 | — | 56 条 procedures（108 KB）+ 9.3 MB facts **重启后全部不可见**（数据丢失级） |

**2. memoryDir 是唯一收口 L64**

`python-setup.js` 直接 import 本模块的 `memoryDir`（见该文件第 1 行）。任何新增的团队目录也必须经此收口，不得自行拼路径。

### 可直接落地的代码片段

**插入位置**：datadir.js:64 附近的 `memoryDir`。

```js
/**
 * 团队记忆目录 —— 与个人记忆**同构**，复用同一套 store 的 io 注入点。
 *
 * 为什么用 memory/team/<groupId>/ 而不是另起一个根：
 *   三个 store（facts / procedures / episodes）的 io 由宿主按目录注入，
 *   若团队目录与个人目录结构同构，则**同一份 store 代码**可以服务两者，
 *   不需要为团队版再写一套 store。这是本仓"能力复用优先"的一贯做法。
 *
 * @param {string} groupId 团队标识（须为 path-safe 短串）
 * @returns {{ok:boolean, dir:string|null, error?:string}}
 */
export function teamMemoryDirPre(groupId) {
  const g = String(groupId || '').trim()
  if (!g) return { ok: false, dir: null, error: 'empty-group-id' }
  // path-safe 校验：groupId 会拼进文件路径 ⇒ 必须拒绝分隔符与上跳
  if (g.indexOf('..') >= 0 || /[\\/:*?"<>|]/.test(g)) {
    return { ok: false, dir: null, error: 'unsafe-group-id' }
  }
  return { ok: true, dir: memoryDir('team' + String.fromCharCode(47) + g) }
}
```

### 关联行号索引

- lib/datadir.js:64

### 与团队化的关系

**判定：团队共享（Shared），但迁移策略是本地行为。**

目录解析决定"数据放哪"，团队化后必须让"团队记忆目录"与"个人记忆目录"可区分（如同 `memory/team/<groupId>/` 与 `memory/`）。迁移逻辑本身**不应跨端执行**——每台机器各自补齐一次即可。

### Teamwork 改造要点

1. **引入团队子目录**：建议 `~/.dsh/memory/team/<groupId>/`，与个人记忆同构，便于复用现有 store 的 io 注入点。
2. **迁移必须保持"不 move、只增量补齐"**：文件头 L40-52 的三条实测依据（活宿主仍在写旧目录 / 裸名目录可能已存在空壳 / 判据必须逐文件而非"目录是否存在"）在团队场景下**更容易踩**——多台机器同时迁移会放大分脑风险。
3. **逐文件语义判据不可退化为目录存在性判据**：注释记载过一次数据丢失级缺陷（56 条 procedures / 9.3 MB facts 在重启后全部不可见）。

### 风险与回归

- 回归：迁移用例必须覆盖"裸名目录已存在但为空壳"的负路径（这是实测出过事故的路径）。
- 不要新增第二个目录真源——所有 `memoryDir` 调用点必须继续只走本模块。
