# 迁移功能 · 功能架构（2026-09-22）

> 状态：**架构已定，待用户拍板后填充**
> 依据：三轮只读取证（`.vision-tmp/recon-migration{,2,3}.cjs`），全部结论附实测证据。
> 用户原话：「同意你把这个迁移功能的逻辑理清楚，做成一个功能架构，然后再去填充」

---

## 0. 一句话目标

把「A 机上某个工作区的全部记忆」搬到「B 机」，**搬到之后在新路径下能正常读取与继续累积**；路径相同则零风险，路径不同则自动重写内部引用。

---

## 1. ★先纠正三个事实判断（取证推翻了我此前的口头结论）

| # | 我此前说的 | 实测结论 | 证据 |
|---|---|---|---|
| 1 | slug 是「可逆纯函数」 | **不可逆**。规则是 `'--' + path.replace(/[\\/:*?"<>|]/g,'-') + '--'`，替换**全部 9 个 Windows 非法字符**（不只 `:` 和 `\`）⇒ 原路径里的 `-` 与替换产物 `-` 无法区分，含空格/连字符的路径会产生连续 `--` 与分隔符歧义 | `lib/index.js` 实现 + `.vision-tmp/recon-migration3.cjs` §5 |
| 2 | 迁移要先做 slug 重算 + 路径重写 | **同路径迁移零代码就已经能用** —— 因为数据是「按 slug 分目录」存的，slug 只由路径决定，与机器无关。`C:\proj` 在 A/B 机都得到同一个 slug | §2 目录结构 |
| 3 | 从零设计迁移 | **宿主已有迁移地基**：`saveConfig()` 在 `memoryRoot` 变化时把整个 `workspaces/<slug>/` 目录 `copyDir` 到新根（旧文件保留不删） | `lib/index.js:2183-2201` |

**★ 由此得出架构的核心分界**：

```
路径不变 → 直接拷贝 workspaces/<slug>/ 即可   （零重写，零风险）
路径改变 → 必须 ①重算 slug 目录名 ②重写文件内路径引用 ③合并全局索引
```

用户问的「A 机 → B 机」**绝大多数是路径不变**（都放在 `D:\proj`），这条路径必须做到**零思考、一键完成**。

---

## 2. 数据面：一个工作区的记忆到底在哪（实测）

### 2.1 主体：按 slug 分目录（**这是唯一的主体**）

```
~/.dsh/memory/workspaces/<slug>/
├── MEMORY.md                  项目笔记
├── YYYY-MM-DD.md              每日日志（append-only）
├── reflections/               每日反思
├── summaries/                 时段摘要
├── greetings/                 问候
├── archive/notes-archived.md  容量超限归档
└── handoff/
    ├── PLAN.md                白板
    ├── handoff-*.md           交接账本
    ├── events.jsonl           事件流
    ├── index.json             ★251 KB，索引（含 79 处绝对路径 + 4 处 slug）
    ├── archive/               历史白板
    └── prev-session-*.md      上会话快照
```

实测本工作区该目录 **3,813 KB**（是本机 8 个工作区里最大的）。

### 2.2 ★同时散落在全局目录里的引用（**这是风险所在**）

| 全局位置 | 是否含本工作区路径 | 是否含 slug | 文件数 | 迁移影响 |
|---|---|---|---|---|
| `workspaces-summary.json` | **★ 是（`path` 字段，权威路径来源）** | 否 | 1 | **必须处理**：导入要 merge 而非覆盖 |
| `hub-pre/episodes.json` 等 3 个 | 否 | 否 | 3 | 无需处理 |
| `index-pre/`（语义索引） | **★ 是（9 文件）** | **★ 是（52 文件）** | 146 | 路径变了必须处理，或整体重建 |
| `semantic-pre/` | 是（2 文件：`derived-corpus.json`/`embedding-config.json`） | 是 | 28 | 同上 |
| `summaries/`（全局那份） | 是（1 文件） | 否 | 33 | 同上 |
| `evidence-pre/` `greetings/` `retrieval-pre/` `degrade-pre/` | 否 | 否 | 30 | 无需处理 |
| `~/.dsh/sessions/` | 由 DSH 宿主管理，**不属于本插件** | — | 8 | **明确不在范围内** |

**★ 关键推论**：全局目录里的引用全部可以由**同一条规则**重写 ——
把「旧路径（4 种形态：`D:\x`、`D:/x`、`D:\\x`(JSON 转义)、`file:///D:/x`）」和「旧 slug」替换为新的。
不需要为每个文件写特例。

### 2.3 体积实测（决定导出格式）

| 位置 | 大小 | 是否随工作区迁移 |
|---|---|---|
| 本工作区 `workspaces/<slug>/` | **3,813 KB** | ★ 主体，必带 |
| `index-pre/`（全局语义索引） | 1,114 KB | 可重建，**建议不带** |
| `semantic-pre/` | 20,900 KB | 可重建，**建议不带** |
| `evidence-pre/` | 32,321 KB | 与工作区无关，不带 |
| `archive/` | 32,244 KB | 历史归档，建议不带 |
| `hub-pre/` | 484 KB | 与工作区无关，不带 |

⇒ **导出包只需带 `workspaces/<slug>/`（约 3.8 MB）+ 一条 `workspaces-summary.json` 里的记录**。
语义索引到 B 机后**自动重建**（既有机制：索引随文件 mtime/摘要失效自动刷新）。

---

## 3. 功能架构（三层）

### 3.1 分层

```
┌─ L3 界面层 ────────────────────────────────────────────┐
│ 工作区页签（现有 WorkspaceTab）新增两个按钮：            │
│   [导出这个工作区]  [导入工作区]                          │
│ 导入是**三步向导**（不是一键直灌）：                      │
│   ① 选包 → ② ★预览差异 → ③ 确认执行                     │
└────────────────────────────────────────────────────────┘
┌─ L2 迁移引擎（新模块 lib/migrate-pack-pre.js）──────────┐
│  exportPack()  → 生成 .dam-pack（zip 风格，零依赖）      │
│  inspectPack() → 只读解析 + 计算「将要发生什么」          │
│  importPack()  → 按 inspect 的计划执行（可 dry-run）      │
│  ★所有函数纯函数式：入参=路径与选项，出参=计划/结果       │
└────────────────────────────────────────────────────────┘
┌─ L1 宿主路由（2 条新路由，搭既有 loopback 守卫）─────────┐
│  POST /migrate-pack/export   { ws, outPath }            │
│  POST /migrate-pack/inspect  { packPath, targetWs }     │
│  POST /migrate-pack/import   { packPath, targetWs, plan }│
└────────────────────────────────────────────────────────┘
```

### 3.2 打包格式（`.dam-pack`）——**零依赖**

不用 zip（`node:zlib` 只有 gzip/deflate，没有 zip 容器；引第三方库违反本仓零依赖铁律）。改为：

```
<packPath>（单个 .json，UTF-8）
{
  "format": "dam-pack-v1",
  "createdAt": 1758...,
  "source": { "ws": "D:\\proj", "slug": "--D--proj--", "host": "A" },
  "runtime": { "pluginVersion": "3.1.0" },
  "summaryRecord": { ...workspaces-summary 里那条 path=源的记录... },
  "files": {
     "MEMORY.md": "<UTF-8 文本>",
     "2026-09-22.md": "...",
     "handoff/index.json": "...",
     ... 全部按相对 slug 目录的相对路径
  },
  "stats": { "fileCount": 214, "bytes": 3904512 },
  "checksum": { "algo": "sha256", "value": "…（对 files 规范化后摘要）" }
}
```

**为什么是单 JSON 而不是 tar**：
- 零依赖（`node:zlib` 的 gzip 可选再压一层，仍单文件）
- 可**流式校验**：`checksum` 让损坏的包在 inspect 阶段就被拒，不会污染现场
- 可**人眼读**：出问题时用户能自己打开看（可调试性 > 体积）
- 体积：3.8 MB 文本 → gzip 后约 300-500 KB（可选开关，默认开）

### 3.3 导入三步（**核心设计：必须先预览**）

```
① 选包     → 读 .dam-pack 头 + 校验 checksum，不碰现场
② 预览     → inspectPack() 产出「差异计划」：
     · 目标工作区：<slug>      （来自包内 source.ws 在 B 机的路径，可手改）
     · 路径是否变化：是/否
     · 将新增文件：N 个（列前 10）
     · ★将覆盖文件：M 个（逐个列出 + 旧文件字节数/新文件字节数）
     · ★冲突策略：保留B机 / 用A机覆盖 / 都改名（三选一）
     · 全局引用重写：workspaces-summary 追加 1 条 / index-pre 失效标记 N 个
     · 预计体积、执行时长
③ 确认执行 → 先整体备份目标目录（.bak-<ts>）→ 再落盘 → 写回执
```

**★ 为什么必须「预览」**：这是不可逆操作（覆盖 B 机既有记忆）。架构里强制：
- 预览接口是**唯一**能算出「将发生什么」的地方，import 只接受**预览产出的 plan**（防 TOCTOU）
- 执行前**必定备份**（复用既有 `copyDir`）
- 冲突**默认不覆盖**（默认=B 机保留），要覆盖必须用户显式选

---

## 4. 路径变化的处理（三种情形，逐级降风险）

### 情形 A：路径完全相同（**最常见，零重写**）

A、B 机都把项目放在 `D:\proj`。
→ slug 相同，**直接解包到 `workspaces/<slug>/`**；`workspaces-summary.json` 合并那条记录。
→ **不做任何文本替换**（避免误改用户内容里恰好出现的相似字符串）。

### 情形 B：路径不同（**需重写**）

A 机 `D:\proj` → B 机 `C:\work\proj`。
→ ① 目录名改为新 slug；② 逐文件重写 4 种路径形态 + 旧 slug；③ 全局索引合并。

**★ 重写的安全边界（必须写进实现）**：
- 只重写**结构化位置**（`workspaces-summary.json` 的 `path`/`slug` 字段、`handoff/index.json` 的 `ws` 字段、`semantic-pre/embedding-config.json` 的路径字段）
- 用户**正文**里的路径（日志/笔记正文提到 `D:\proj\lib\index.js`）**默认也重写**，但**预览里逐条列出改了多少处、改在哪几个文件**，让用户能看见
- 提供开关：「只改结构化字段（保守）」/「连正文一起改（完整）」，**默认完整**（否则 B 机日志里的路径全是死链）

### 情形 C：包来自更高版本插件（**必须拦**）

包内 `runtime.pluginVersion` > 当前版本 → **拒绝导入并说明**（不尝试兼容未知结构）。

---

## 5. 必须在架构里钉死的 6 条安全规则

| # | 规则 | 理由（实测依据） |
|---|---|---|
| S1 | **导入前必定整体备份**目标 slug 目录 | 覆盖不可逆；复用既有 `copyDir` |
| S2 | **冲突默认保留 B 机**，覆盖需显式选择 | 用户最容易误操作的一步 |
| S3 | **checksum 校验失败即拒**，不写任何文件 | 半损坏包会污染现场且难排查 |
| S4 | **`workspaces-summary.json` 用 merge 不用 replace** | 实测它有 7 条记录（含其它 6 个工作区），整体覆盖会丢别人的 |
| S5 | **语义索引不带，到 B 机标记失效重建** | 实测 `index-pre` 146 文件 / 1.1 MB，且含 52 处 slug 引用；重建比搬迁便宜且不会留下错引用 |
| S6 | **不碰 `~/.dsh/sessions/`** | 那是 DSH 宿主的数据，不属本插件，越界会破坏宿主 |

---

## 6. 落地计划（填充顺序）

| 步 | 内容 | 产出 | 风险 |
|---|---|---|---|
| P1 | `lib/migrate-pack-pre.js`：`exportPack` / `inspectPack` / `importPack` 三函数 | 新模块（零依赖，登记 `libModuleRenames`） | 低 |
| P2 | 宿主 3 条路由（含 loopback 守卫 + 方法校验） | `index.js` | 低（**需同步路由数硬锁 50→53**） |
| P3 | 守卫 `tests/smoke/smoke-test-migrate-pack-pre.mjs` | 真行为断言：导出→导入→**读回内容逐字节比对**；路径变化时 slug 与引用真的被重写；checksum 损坏被拒；冲突默认不覆盖 | 低 |
| P4 | 前端：WorkspaceTab 两个按钮 + 导入三步向导 | `client.js` + i18n | 中（前端是大项目，按「记忆拟合」逐步收敛） |
| P5 | 文档：`docs/HANDBOOK.md` 增一节 + 本文件转 `docs/internal/` | 文档 | 低 |

**P1-P3 可以先做完并全绿**（后端能力），P4 界面按你的反馈迭代。

---

## 7. 需要你拍板的 4 个点

1. **导出范围**：只带 `workspaces/<slug>/`（约 3.8 MB，推荐）还是连语义索引一起带（+1.1 MB，但到 B 机仍需重建）？
2. **正文路径重写**：默认「完整重写」（连日志正文里的 `D:\proj\...` 一起改，避免死链）还是「只改结构化字段」（更保守）？
3. **入口位置**：放现有的「工作区」页签（`WorkspaceTab`）里，还是设置页新增一个「迁移」分区？
4. **同步 vs 一次性**：这一期只做**一次性搬包**（推荐，简单可靠）；「两台机器持续同步」是否留到以后？

---

## 附：取证脚本（可复跑复核）

- `.vision-tmp/recon-migration.cjs` —— slug 实现、目录结构、全局引用扫描
- `.vision-tmp/recon-migration2.cjs` —— summary 字段、hub 结构、体积统计
- `.vision-tmp/recon-migration3.cjs` —— **逐文件**路径/slug 命中、slug 可逆性证伪
