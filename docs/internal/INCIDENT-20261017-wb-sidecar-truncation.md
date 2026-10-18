# 事故记录 · lib/wb-sidecar.js 被截断（2026-10-17 23:0x）

## 事故
B9（#434 白板卡片身份唯一化）执行期间，`lib/wb-sidecar.js` 从 **1351 行 / 38 exports** 被写成 **900 行 / 27 exports**。

```diff
@@ -839,513 +900 @@ function dateOfCardPre(c) {
```

一个 hunk 吞掉 513 行。丢失 451 行、11 个导出：

| 丢失的导出 | 用途 |
|---|---|
| `WB_RAIL_ITEMS_PRE_V1` | 看板左栏 8 项导航数据 |
| `buildRailPre` | 左栏构建 |
| `railToViewPre` | 左栏→视图映射 |
| `groupByDayPre` | 卡片按天分组 |
| `buildMemberListPre` | 团队成员列表 |
| `filterCardsPre` | 卡片过滤 |
| `foldCardsPre` | 卡片折叠 |
| `buildStatCardsPre` | 统计卡 |
| `buildKanbanPre` | 看板构建 |
| `ledgerDateOfPre` | 账本日期 |
| `buildKanbanMatrixPre` | 看板矩阵 |

其中 5 个（`buildKanbanMatrixPre` / `buildStatCardsPre` / `buildMemberListPre` / `filterCardsPre` / `foldCardsPre`）是 `lib/index.js:121` **直接依赖**的符号。

## 症状
```
$ node -e "import('./lib/index.js')"
IMPORT-FAIL: The requested module './wb-sidecar.js' does not provide an export named 'buildKanbanMatrixPre'
```

⇒ **凡 import lib/index.js 的套件全部红**。
⚠️ **`node --check lib/wb-sidecar.js` 仍然是 OK 的** —— 截断后的文件语法完整。这是本事故最关键的一点：**语法检查抓不到导出契约破坏**。

## 发现路径（值得复用）
1. runtime-fixer 跑既有套件 `m78-host` 红
2. 按纪律做归属实验：**不猜测试，先做最便宜的契约验证**
   ```
   node -e "import('./lib/index.js')"
   ```
3. 立刻拿到 `INDEX-IMPORT-FAIL`，定位到 `wb-sidecar.js` 导出缺失
4. 报给 Lead，不越界去修别人的写域

## 处置（可复用）
1. **先备份半成品**：`D:\wb-sidecar-halffix-BACKUP.js`（46,688 B）
2. 取唯一真源：`git show HEAD:lib/wb-sidecar.js` → `D:\wb-head.js`（1351 行）
3. **定位共同锚行**：LIVE 末尾是 ` ）*/`，HEAD 第 838 行也是 ` */`（`WB_RAIL_ITEMS_PRE_V1` 的 JSDoc 结尾）
4. **只补缺失段**：HEAD 第 840 行（`export const WB_RAIL_ITEMS_PRE_V1 = [`）起拼到 LIVE 末尾
5. **保留 HEAD 原有末尾换行形态**（本次 HEAD 无尾换行 ⇒ 拼接后也 trim）
6. 验证三连：`node --check` → `import('./lib/index.js')` → 导出数 = 38

结果：**1412 行 / 38 exports / IMPORT-OK**。1351 + 约 60 行（#434 净增）= 1412，合理。

## 关键教训（已写进用户级规则）

> **>500 行的文件禁止整文件 write**，只用定点 edit。必须重写全文时先 read **完整**文件（不带 limit），写后断言行数差 = 预期增量。

> **每次改动后跑两步**：`node --check` **加** `node -e "import('<消费者>')"`。前者只证语法，后者才证导出契约。

> **导出符号数守恒断言**：改前记 `^export (function|const)` 命中数，改后必须相同。

> **恢复时以 `git show HEAD:<file>` 为唯一真源，按共同锚行精确对齐后只补缺失段，不要整文件回滚**（会把已验证的改动一起丢掉）。

## 未受影响
- #434 已写的改动（`wbEntryIdPre(…, ordinal = 0)` + 旧字符串兼容分支）**完整保留**
- 拼接后复跑：`graph-mode` 35/0 · `p23-wb-sidecar` 10/0 · `g4-whiteboard` 11/0 · `m1-contract-line` 55/0 · `issue164-plan-cas` PASS

---

# 附：#434 语义变化的兼容性判据（water-fixer 实测对照，2026-10-17）

`wbEntryIdPre(ws, relPath, title, ordinal)` 把「文档内第几个同名标题」纳入身份。存量文件因此分**两类，行为不同且都正确**：

| 样本 | 逐字节相同 | 旧 id 唯一数 | 新 id 唯一数 |
|---|---|---|---|
| A `## 目标` + `## 状态`（**无**同名） | **true** | 2/2 | 2/2 |
| B 两个 `## 下一步`（**有**同名） | false | **1/2** | **2/2** |
| C 三个 `## 任务状态`（**有**同名） | false | **1/3** | **3/3** |

> **① 无同名标题** ⇒ `ordinal` 恒 0 ⇒ 走**完全相同的旧 hash 字符串** ⇒ 锚点**逐字节不变**。
> 本批 zero-diff 的 6 份真实文档（PLAN + 5 篇账本）全属此类，故 `added=0 updated=1 unchanged=7`。
>
> **② 有同名标题** ⇒ 第 2 个及以后拿到新 id ⇒ 锚点**有意变化**。
> **这不是回归，正是 #434 的修复**：旧值下这些文件的多张卡共用一个 id，单卡编辑恒报 conflict、看板点卡恒取第一张（`index.js:4086` 的 `find` 静默返回第一张）。
>
> **★判据纪律**：不得把「zero-diff 通过」理解为「任何文件都不许变」。正确口径是——
> **无同名标题的存量文件必须不变；有同名标题的存量文件应当变化，且变完 id 必须全局唯一。**
> 误用「绝对不许变」会把本 issue 的修复判成回归。
