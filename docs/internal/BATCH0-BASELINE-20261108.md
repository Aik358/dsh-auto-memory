# 批次 0 · 前置与保护 · 基线记录

> 2026-11-08 09:51 (Asia/Hong_Kong) · 由 Lead 直接执行（纯准备，零设计风险）
> 上游：[施工总表](file:///D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md) 批次 0（第 133-144 行）
> 本文件状态：**基线已建立**。0.4（工作树未提交改动处置）未做，见最后一节。

---

## 0.1 / 0.2 备份（已完成，逐字节校验）

备份目录：`C:/Users/JH Z/.dsh/memory/hub/backups/`

| 源文件 | 源字节数 | 备份字节数 | 字节相等 | sha256 相等 | sha256 前 16 位 | 备份路径 |
|---|---|---|---|---|---|---|
| `C:/Users/JH Z/.dsh/memory/hub/facts.json` | 88,972,380 | 88,972,380 | ✓ | ✓ | `A07827338BEBC6EC` | `hub/backups/facts.json.bak-20261108-095108` |
| `C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json` | 3,022,982 | 3,022,982 | ✓ | ✓ | `D6A061D67B7E4BEE` | `hub/backups/event-store.json.bak-20261108-095108` |
| `C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/index.json` | 7,315,603 | 7,315,603 | ✓ | ✓ | `2C0932FA8782C07C` | `hub/backups/index.json.bak-20261108-095108` |

> 判据（总表原文）：副本字节数 == 原文件；原文件未被改。两条均满足，且额外做了 sha256 全等校验。

**facts.json 增长速率现场取证**：09:49:28 实测 88,952,922 B → 09:51:08 实测 88,972,380 B，
**约 100 秒增长 19,458 B**（≈ 194 B/s ≈ 780 B/分钟的瞬时速率）。
该数字只作「仍在持续增长」的量级证据，不作日均推算依据（增长随会话写入量波动）。

---

## 0.3 三元组基线（后续每批收工对照）

| 对象 | 指标 | 基线值 |
|---|---|---|
| `D:/dsh-auto-memory/lib/index.js` | 行数 | **28,254** |
| `D:/dsh-auto-memory/lib/index.js` | 字节数 | **2,082,057** |
| `D:/dsh-auto-memory/lib/index.js` | sha256 前 16 位 | `36BE3335AED3128E` |
| `handoff/event-store.json` | 事件数 | **50**（active 46 / closed 4） |
| `handoff/event-store.json` | 检查点总数 | **706** |
| `handoff/event-store.json` | 顶层键 | `schema, events, updatedAt` |

**守恒判据（批次 2.4 归并时直接用这组数）**：归并只允许「事件数下降、检查点总数仍为 706」。
若归并后检查点数 ≠ 706，判定归并实现有损，必须按 2.4 的回滚步骤还原。

> 注意：706 是**本基线的快照值**。开工 2.4 前必须**当场重测**再比，不得拿本文件的 706 当绝对值
> ——中间每轮对话都可能新增检查点（本工作区一次刷新就写过 3 条）。

---

## 0.4 工作树未提交改动（**未做，需用户裁定**）

`git status --porcelain` 实测（2026-11-08 09:48，分支 preview / HEAD `4132510b` / 领先 origin/preview **24** 提交）：

**已跟踪、有改动（5 个）**

| 状态 | 文件 | 归属判断 |
|---|---|---|
| `M` | `lib/index.js` | #475 半成品 |
| `M` | `lib/tier-layer-inject.js` | #475 半成品（**已实测无冲突标记、node --check 通过**，仅未 git add） |
| `M` | `lib/tier0-catalog.js` | #475 半成品 |
| `M` | `tests/smoke/smoke-test-tier0-catalog.mjs` | #475 半成品 |
| `M` | `.gitignore` | 审计期追加 924 B，可保留 |

**未跟踪**

| 类别 | 内容 |
|---|---|
| 真新增源码 | `lib/tier0-usage.js`、`artifacts/probe_classiclf.mjs` |
| 疑似垃圾（shell 引号 bug 残留） | `n.endsWith('.mjs')`、`{console.log('ERR`、`{console.log('IMPORT-ERR`、`{if(l.includes(manual)`、`{if(l.includes(writeQueue)`、`"{if(l.includes(写队列)"`、`tests/smoke/smoke-test-zz-inject-legacy2-#536.mjs`、`tools/_run-smoke-mut536-*.mjs`（3 个） |

**总表原写「31 条变更 / 1 条冲突态」与本次实测不符**：实测无任何未合并状态（`UU` 已消失，
`git status` 显示 `M`），冲突标记数 = 0。总表第 28 行「其中 1 条是冲突态」与第 34 行
「`UU` / **未解决的合并冲突** —— 不处理开工必撞」**已被实测推翻**，需在总表订正。

**0.4 属待裁定项**（与总表 §十四 第 (1) 条同一件事）：`#475` 三文件走
A「解决冲突并完成并提交」还是 B「stash 后开工、完工恢复」。
本文件只登记现状，**未执行任何 git 操作**（未 add / 未 stash / 未 commit / 未删垃圾文件）。

---

## 复算命令（任一时刻可重跑核对）

```powershell
# 备份完整性
Get-ChildItem "$env:USERPROFILE\.dsh\memory\hub\backups" | Select Name,Length

# 三元组
(Get-Content 'D:/dsh-auto-memory/lib/index.js' | Measure-Object -Line).Lines
(Get-Item 'D:/dsh-auto-memory/lib/index.js').Length
(Get-FileHash 'D:/dsh-auto-memory/lib/index.js' -Algorithm SHA256).Hash.Substring(0,16)

# 事件/检查点数
node -e "const fs=require('fs');const p=process.env.USERPROFILE+'/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json';const ev=JSON.parse(fs.readFileSync(p,'utf8')).events||[];console.log('events='+ev.length+' checkpoints='+ev.reduce((s,e)=>s+(e.checkpoints||[]).length,0))"
```
