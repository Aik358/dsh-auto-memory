# Codex 任务书 · v4-collaboration 分支同步上传（含 README 施工进度表恢复）

日期：2026-11-20
执行者：外部代码线（GPT / Codex）
验收者：Lead（本地独立复核，不采信自报）

---

## 0. 一句话任务

把 D:\\dsh-auto-memory 工作树里**本批（批次 3 · P3-A2）**的代码、测试与施工文档同步到 GitHub 的 v4-collaboration 分支；**恢复被旧合并冲掉的 README 施工进度表**并更新到 2026-11-20；同时更新施工总表进度；最后推送到 origin/v4-collaboration。

---

## 1. 背景（必须先读懂，否则会做错）

v4-collaboration 这个分支的 README.md **不是产品 README**，而是**施工进度表**（说明分支目标、当前进度、可认领方向、文档入口、协作方式）。

上一次上传时用了「合并提交」的方式（tree 直接取 preview 树），导致：

| 事实 | 值 |
|---|---|
| origin/v4-collaboration 当前 tip | 3c8f384b（merge，父=792224ea + 23646c04） |
| 3c8f384b 的 tree | 6ae0b1c4… = **与 23646c04（preview）完全相同的 tree** |
| 结果 | README 变成 preview 的产品 README（**65,088 字符**），进度表被覆盖 |
| 进度表原文仍在 | git show 792224ea:README.md（**5,295 字符**，blob 71eb55ee…） |

⇒ **修复方式：从 792224ea 取回 README 原文，在新提交里覆盖回进度表，并更新进度。不要从 preview 分支「改 README」，也不要重新合并 preview。**

---

## 2. 硬约束（违反即返工）

1. **禁止** git push --force；**禁止**推到 main / preview / 任何 tag；只推 v4-collaboration。
2. **禁止**在主工作树 D:\\dsh-auto-memory 里 checkout / reset / stash —— 该工作树当前在 preview 分支且**有未提交改动**（就是本批成果），任何 checkout 都可能丢工作。**必须用 git worktree 在独立目录操作。**
3. **禁止**提交以下内容：
   - artifacts/e8-visual/e8-7-double-check.json（每次跑套件都会重写的生成物）
   - output/、report.json、prototypes/.sidecar-mutation-*/、tools/_run-smoke-mut536-*.mjs
   - 文件名畸形的那条：{if(l.includes(写队列)
   - 任何真实记忆数据、凭据、日志、隔离宿主目录、模型权重
4. **禁止**改动除 README / 施工总表 / 下述白名单之外的任何文件内容。
5. 不要改版本号、不要发版、不要动 package.json。

---

## 3. 事实基线（照抄，不要自己重算）

- 主工作树：D:\\dsh-auto-memory，HEAD 23646c04，分支 preview
- 远端：origin https://github.com/Aik358/dsh-auto-memory.git
- 本机 git 身份已配置（user.name=r / user.email=r@l），推送凭据可用
- 计数基线（Lead 已复跑）：**22 tools / 87 routes / 182 config keys**
- 全量回归基线：**647 PASS / 0 FAIL / 0 TIMEOUT / 0 FLAKY（242.7s）**
- r26 锁：**26/0**，lib/index.js 归一化长度 **1,655,058**，SHA16 **E13A88D0409EE3AA**
- lib/index.js：2,216,970 B / 30,466 行 / 纯 CRLF
- lib/client.js：3,038,864 B / 27,353 行 / 纯 CRLF，sha16 9154599d272c142（**本批未改**）

---

## 4. 执行步骤

### 4.1 建独立工作树（不要碰主工作树）

```powershell
cd D:\\dsh-auto-memory
git fetch origin
git worktree add D:\\dsh-v4-sync origin/v4-collaboration
```

（D:\\dsh-v4-sync 可换成任意空闲目录；若已存在先删除。）

### 4.2 复制本批文件到工作树

**修改的已跟踪文件（3 个）**

```
lib/index.js
lib/injection/policy-v2.js
tests/smoke/smoke-test-r26-cross-layer.mjs
```

**新增代码 / 测试（6 个）**

```
lib/injection/unit-policy.js
lib/injection/unit-adapters.js
lib/injection/unit-shadow.js
tests/smoke/smoke-test-batch3-unit-policy.mjs
tests/smoke/smoke-test-batch3-unit-adapters.mjs
tests/smoke/smoke-test-batch3-unit-shadow.mjs
```

**新增施工文档（19 个，全部在 docs/internal/）**

```
PROMPT-CODEX-U1-UNIT-POLICY-20261120.md
PROMPT-CODEX-U1-1-UNIT-POLICY-FIX-20261120.md
PROMPT-CODEX-U1-2-UNIT-POLICY-FIX-20261120.md
PROMPT-CODEX-U12-U2-ADAPTERS-20261120.md
PROMPT-CODEX-U2-1-QUOTA-FAMILY-20261120.md
PROMPT-CODEX-U3A-SHADOW-WIRING-20261120.md
PROMPT-CODEX-U3A-2-SHADOW-RECEIPT-20261120.md
PROMPT-CODEX-U3A-3-REAL-IDENTITY-20261120.md
RECEIPT-BATCH3-U1-UNIT-POLICY-20261120.md
RECEIPT-BATCH3-U1-1-UNIT-POLICY-20261120.md
RECEIPT-BATCH3-U12-U2-ADAPTERS-20261120.md
RECEIPT-BATCH3-U2-1-QUOTA-FAMILY-20261120.md
RECEIPT-BATCH3-U3A-SHADOW-20261120.md
RECEIPT-BATCH3-U3A-2-SHADOW-RECEIPT-20261120.md
RECEIPT-BATCH3-U3A-3-REAL-IDENTITY-20261120.md
RECEIPT-HOST-E2E-546-OPTIN-20261120.md
TASKPACK-HOST-E2E-546-OPTIN-20261120.md
REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md
RULING-BATCH3-U3A-SOURCES-20261120.md
```

复制用逐个文件 Copy-Item（保留字节），**不要**整目录 robocopy —— 否则会把垃圾文件带进来。

### 4.3 恢复 README 进度表

```powershell
cd D:\\dsh-v4-sync
git checkout 792224ea -- README.md
```

确认：README.md 字节数应在 5,295 附近（UTF-8，**不是** 65 KB）。

### 4.4 更新 README 进度（按 §5 替换）

### 4.5 更新施工总表（按 §6）

### 4.6 提交与推送

```powershell
cd D:\\dsh-v4-sync
git add -A
git status --porcelain          # 逐条核对：只应有白名单文件
git commit -m "chore(collab): 批次3 P3-A2 U0/U1/U2/U3a 落地 + 恢复 v4-collaboration 施工进度 README"
git push origin HEAD:v4-collaboration
```

推送后同步本地分支指针（推荐）：

```powershell
cd D:\\dsh-auto-memory
git fetch origin
git branch -f v4-collaboration origin/v4-collaboration
```

清理工作树：

```powershell
cd D:\\dsh-auto-memory
git worktree remove D:\\dsh-v4-sync
```

---

## 5. README 更新要求（唯一允许的改法）

保留 792224ea 版本的**全部原有小节**（目标 / 批次 1 / 批次 2 / R4 独立线 / 可认领方向 / 文档入口 / 协作方式 / 产品与既有界面资料），只做下列修改。

### 5.1 标题行日期

把 「## 当前进度（2026-11-13）」 改为 「## 当前进度（2026-11-20）」。

### 5.2 替换「批次 3」小节

把原来的 「### 批次 3 · 调查与施工细则已交付，生产实现未开始」 整节替换为：

| 范围 | 当前状态 |
|---|---|
| 3.0 · 注入投递基础修复 | P1 已落地并接线：整帧运输/预算、presets、cadence/triggers、diagnostics；模块级开关与单位配额仍仅预览生效 |
| #546 opt-in UI 移植 | 已落地（手写区 + frozen 源 + 生成器 seam 三处同改）；套件 40 PASS / 0 FAIL，全量回归无新增红 |
| P3-A2 · U0 契约 | 已交付 **v1.3**，含 A1–A7 七条裁定：diagnostics 不进 Unit 模型 / budget=总额且 S8 优先 / F13 quota-bypass / overcommit 先判 enabled / 配额按 scope 家族共享 / ruleModule 归属 / 用真实身份 |
| P3-A2 · U1 选择器 | 已交付 lib/injection/unit-policy.js：**32 PASS / 0 FAIL**，变异 12/12 CAUGHT；F3 同模块重复 (unit,scope) 判非法 |
| P3-A2 · U2 六处 adapter | 已交付 lib/injection/unit-adapters.js：**35 PASS / 0 FAIL**，变异 5/5 CAUGHT；分层为 RawUnit → bindUnits → Unit，adapter 零 IO、不读 policy |
| P3-A2 · U3a 影子观测 | 已交付 lib/injection/unit-shadow.js：**14 PASS / 0 FAIL**，变异 6/6 CAUGHT；仅在 policy.modules.diagnostics.enabled 时计算，回执经 POST /preview 与 debugInfo() **只读**暴露，注入正文零变化；影子使用真实身份，身份塌缩会如实报 duplicate-id |
| P3-A2 · U3b | **未开工**：on 接管、deliveryModule 实产、真实宿主逐轮对比 |
| 3.1–3.4 | 细则已给，生产未逐项验收 |

### 5.3 在「文档入口」列表末尾追加

```markdown
- [P3-A2 U0 契约（含 A1–A7 裁定）](docs/internal/REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md)
- [U3a 三个阻塞问题的裁定](docs/internal/RULING-BATCH3-U3A-SOURCES-20261120.md)
- [U1 回执](docs/internal/RECEIPT-BATCH3-U1-UNIT-POLICY-20261120.md) · [U2 回执](docs/internal/RECEIPT-BATCH3-U12-U2-ADAPTERS-20261120.md) · [U3a-3 回执](docs/internal/RECEIPT-BATCH3-U3A-3-REAL-IDENTITY-20261120.md)
```

### 5.4 修正文末计数

把 「当前产品计数校验：**22 tools / 86 routes / 181 config keys**」 改为 「**22 tools / 87 routes / 182 config keys**」。

### 5.5 追加验证基线（放在文末计数之后）

```markdown
本次同步的验证基线（2026-11-20，Lead 本机复跑）：全量回归 **647 PASS / 0 FAIL / 0 TIMEOUT / 0 FLAKY**（--jobs=8 --timeout=180000，242.7s）；r26 跨层锁 **26/0**（lib/index.js 归一化 1,655,058 / SHA16 E13A88D0409EE3AA）。
```

**注意**：README 里不得出现「已发版 / 已生产启用 / 已全部完成」这类表述；U3b 未开工必须如实写「未开工」。

---

## 6. 施工总表更新要求

文件：docs/internal/CONSTRUCTION-PLAN-20261108.md（工作树版本已是 67,580 字符，直接复制过去，但要**追加/更新**进度段）。

1. 顶部版本行更新为：初建 2026-11-08 · 更新 **2026-11-20（Asia/Hong_Kong）**：批次 3 P3-A2 的 U0/U1/U2/U3a 已落地并本地提交；U3b（on 接管 + deliveryModule + 真实宿主）未开工 · 已同步 v4-collaboration
2. 在「接续须知」区块内新增一段 **P3-A2 当前状态**，写清：U0 契约 v1.3（A1–A7）；U1 unit-policy.js 32/0、U2 unit-adapters.js 35/0、U3a unit-shadow.js 14/0；影子仅 diagnostics.enabled 时计算、只读暴露、注入正文零变化；U3b 未开工；计数 22/87/182、全量 647/0/0/0、r26 26/0。
3. 不要删改历史段落；只在合适位置追加与更新版本行。

---

## 7. 验收出口（逐条贴证据）

1. git log --oneline -1 新提交存在，父为 3c8f384b（**单父普通提交**，不是 merge）。
2. git show --stat HEAD 路径数 = 30（3 改 + 6 新增代码/测试 + 19 文档 + README + 施工总表）；逐条与白名单一致，无垃圾文件。
3. git show HEAD:README.md 字符数在 **5,000–9,000** 区间（进度表量级，**不是 65,000**）。
4. git show HEAD:README.md 首行是 「# dsh-auto-memory · V4 协作分支」。
5. README 内含 2026-11-20、22 tools / 87 routes / 182 config keys、U3b。
6. git show HEAD:lib/client.js 的 blob 哈希 = 9154599d272c142dbb3be83bf3b7d0608ce90575c0091e443920f39f57aecd8（client.js 未改）。
7. 工作树里跑 node tools/verify-docs.mjs ⇒ 22 / 87 / 182 全部一致。
8. 工作树里跑 node tests/smoke/smoke-test-r26-cross-layer.mjs ⇒ 26 PASS / 0 FAIL。
9. 工作树里跑三个 batch3-unit 套件 ⇒ 32/0、35/0、14/0。
10. git push origin HEAD:v4-collaboration 成功；git ls-remote origin v4-collaboration 与新 HEAD 一致。
11. 主工作树 D:\\dsh-auto-memory 的 git status 与开工前**完全一致**（未提交改动仍在，未被触碰）。

---

## 8. 回执要求

写 docs/internal/RECEIPT-V4-COLLAB-SYNC-20261120.md（随本批一起提交）：

- 新提交 SHA、父提交 SHA、文件清单（30 条）与字节数
- README 恢复证据：旧 blob 255ee3d7（65,088）→ 新 blob（进度表，约 7 KB）
- 第 7 节 11 条验收的逐条输出
- 明确写「**未** force push；**未** 触碰 main/preview；**未** 动主工作树」
- 未验证项：远端 GitHub 页面渲染效果未截图（可选）

---

## 9. 常见错误（会返工）

- ❌ 直接在主工作树 git checkout v4-collaboration —— 会丢未提交改动。
- ❌ 用 merge preview 的方式再「合一次」—— 会把产品 README 再带回来。
- ❌ 只改 README 不改施工总表，或反之。
- ❌ git add -A 前不核对 git status，把 output/、report.json、prototypes/.sidecar-mutation-*、tools/_run-smoke-mut536-* 带进提交。
- ❌ 把 artifacts/e8-visual/e8-7-double-check.json 一起提交（每次跑套件都变，会造成无意义 diff）。
- ❌ 写「批次 3 全部完成 / U3b 已实现」——U3b 明确未开工。
- ❌ git push --force。
