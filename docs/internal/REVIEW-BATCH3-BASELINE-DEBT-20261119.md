# 批次3 基线债清理复核（Lead）· 2026-11-19

性质：对 GPT 基线债清理回执的独立复核。**10/11 修到绿属实**；唯一保留项 `migration-optin-compat` 的归因**需更正**——不是「不敢改的产品缺陷」，而是 **PR #546 半落地**：契约层已进 HEAD，UI 接线从未合入。

## 0. 复核结论

| 项 | 结论 |
|---|---|
| 10 个套件转绿 | **通过**，逐个复跑计数与回执一致（见 §1） |
| `migration-optin-compat` 30/7 | **归因更正**：测试与契约模块都在 HEAD，但 `lib/client.js` 零处 `__damMigrationOptIn`；接线提交 `7188203e` 不祖先于 HEAD，只在 `pr-546` 分支 |
| 产品代码改动面 | `lib/index.js` 仅 1 处（`changeSet.items` 加 `required:['regionId','afterText']`），与回执一致 |
| 生成器一致性 | `--check --strict` = SYNC-OK；`shared-tokens.css` 为新增 LF 源，已并入 legacy 与变体表 |
| 计数 | verify-docs 22/87/182、导出 41、client-loadable 34/0 全部复现 |
| 回执里「未跑全量」 | 我补跑（见 §4）；2 个 TIMEOUT 与 1 个 FAIL 经单跑证明为并发/IO 假红 |

## 1. Lead 独立复跑（逐套）

| 套件 | 回执值 | Lead 实测 |
|---|---|---|
| bc-audit-fixes | 29/0 | 29/0 ✅ |
| g3-note-status-wire | 51/0 | 51/0 ✅ |
| handoff | 69/0 | 69/0 ✅ |
| issue164-plan-tools | PASS | PASS ✅ |
| issue368-write-contract-negative | 6/0 | PASS ✅ |
| p7-write-fix | 44/44 | PASS ✅ |
| r15-left-rail | 92/0 | 92/0 ✅ |
| switch-decouple | 54/54 | PASS ✅ |
| v314-gate-scope-j | 26/0 | 26/0 ✅ |
| v4-c1-wal-note | 29/0 | 29/0 ✅ |
| r26-cross-layer | 26/0（重钉 `6A01ADFE83DE9512` / 1,652,347） | 26/0 ✅ |
| **migration-optin-compat** | **30/7（未改）** | **30/7（同）** |

## 2. `migration-optin-compat` 的根因更正（本轮最重要一条）

回执写的是「未修复的产品缺陷，高风险只报告：六个真实迁移请求不携 `allowUnprovenUserFiles`，三个入口无用户级 opt-in」——**现象描述正确，但归因不完整**，导致把「有明确移植路径的未完成合并」误判成「不敢动的产品缺陷」。

### 实测事实（可复算）

```
git cat-file -e HEAD:lib/migration-optin-contract.js                    → exit 0   （契约模块在 HEAD）
git cat-file -e HEAD:tests/smoke/smoke-test-migration-optin-compat.mjs → exit 0   （套件在 HEAD）
git show HEAD:lib/client.js | Select-String __damMigrationOptIn        → 0 处     （接线不在 HEAD）
Get-Content lib/client.js -Raw | Select-String __damMigrationOptIn     → 0 处     （工作树也没有）
git merge-base --is-ancestor 7188203e HEAD                             → False    （接线提交不在 HEAD）
git branch -a --contains 7188203e                                     → pr-546 / remotes/pr546/{head,latest}
```

也就是说：**#546 有两个提交，只落地了前半截**。

| 提交 | 内容 | 是否在 HEAD |
|---|---|---|
| `a21f3b1c` feat(#546): 迁移 opt-in 契约模块与探针工具 | `lib/migration-optin-contract.js`(103行) + 套件(141行) + 3 个工具 | **是** |
| `7188203e` fix(migrate): 让显式确认通道贯通到 UI | `lib/client.js` +85、`smoke-test-migrate-host-wiring` +62 | **否**（仅 pr-546） |

所以套件 7 条红全部落在 C6a–C6g（HELPER 内联/6 请求点/3 勾选框），而 C1–C5（契约语义、后端字段识别、形态探测）全绿——**契约层完好，缺的是 UI 接线**。这与「产品不敢改」是两种完全不同的处置。

### 为什么不能直接打 `lib/client.js`

在隔离副本 `C:\Users\JH Z\AppData\Local\Temp\dam-optin-probe`（lib/tests/tools/skins 全量拷贝 + node_modules junction）实测：

```
node tools/apply-migration-optin.mjs            → APPLIED，终检 ok:true，6 请求点/3 勾选框全命中
node tests/smoke/smoke-test-migration-optin-compat.mjs → pass=37 fail=0   （套件变绿）
node tools/build-iter5-skin.mjs --check --strict → ✗ Expected exactly one settings seam:
                                                     apiPost(API.migrateInspect, { packPath: migPack, ...
```

根因：`tools/build-iter5-skin.mjs:488` 的 `replaceOnce` 要求「`apiPost(API.migrateInspect, { packPath: migPack, targetWs: currentWs() || undefined, onConflict: migConflict })`」在源码里**恰好出现一次**；补丁把它改成 `Object.assign({...}, ...body(...))` 后锚点消失 ⇒ 生成器硬停（exit 1）。

**结论：正确修法是改 `skins/iter5/*` 源 + 生成器 seam 同步升级，不是改 client.js 产物。**回执里那句「修复需同时调整生成源、生成器和三面/frozen」是对的，但被写成了「所以本轮不改」，而没有指出「这是 PR #546 未合完，不是产品设计缺陷」。

## 3. 其它需要记录的两点

1. **r15 的新增 token 源是正确的做法**：回执新增 `skins/iter5/shared-tokens.css`（6 行，195 B，`--dam-conflict-dot-*` 四色值），legacy 与变体两张表都并入；裸色判据未改，仍从 8 降回 0。这符合「色值必须集中成 token」的原意，不是放宽判据。
2. **`lib/index.js` 的 181 字符增长已解释清楚**：`memory_note.changeSet.items` 增加 `required:['regionId','afterText']` + enum，属真实 schema 补全（原来只声明 `type:'array'`，`items` 完全缺失 ⇒ 前端把 `undefined` 当 items 传入也能过）。r26 按自身 LF 管道重钉为 `6A01ADFE83DE9512` / 1,652,347，我复跑 26/0 确认。

## 4. 全量回归（Lead 补跑）

回执明确「本轮没有跑全量回归」，我补跑 `--jobs=8 --timeout=180000`，共 3 轮（前两轮用来定位假红与重车道登记值）：

| 轮次 | 结果 | 说明 |
|---|---|---|
| R1 | PASS 631 / FAIL 1 / TIMEOUT 2 / FLAKY 9 | 与我自己的隔离探针并发，机器被我占满 |
| R2 | PASS 639 / FAIL 1 / TIMEOUT 1 / FLAKY 3 | 登记 `r4-p4-2`(9000)、`r4-read-side`(130000) 后 |
| **R3** | **PASS 641 / FAIL 1 / TIMEOUT 0 / FLAKY 2**（357.0s） | 唯一 FAIL = `migration-optin-compat`；2 FLAKY 串行重跑全过 |

### 4.1 关键发现：`HEAVY_MS` 登记值 < 240000 时**完全无效**

A1c 为 `r4-p4-3-brief-scan` 按单跑 11.4s 登记了 `11400`，但 `pickTimeout` 取 `max(heavyTimeoutMs, HEAVY_MS[n])` = `max(240000, 11400)` = **240000** ⇒ 那条登记对超时**毫无作用**，只是把它挪进重车道。R1/R2 因此连续 TIMEOUT。

⇒ 判据：**重车道的登记值若小于 240000，等于没登记**。要么给 ≥240000 的真值，要么就该留在轻车道并用 `--timeout` 抬高。本轮已把 `r4-p4-3` 改为 `420000`（与 la5 同档），R3 起 TIMEOUT 归零。

### 4.2 单跑复核（判定哪些是假红）

| 套件 | 全量结果 | 单跑 | 判定 |
|---|---|---|---|
| r4-p4-2-panels | TIMEOUT 180s→240s | **7.4s / 14-0 / 9 变异全 CAUGHT** | 并发假红；已登记 9000 进重车道 |
| r4-p4-3-brief-scan | TIMEOUT 240s | **15.8s / 20-0 / 3 变异全 CAUGHT** | 并发假红；登记值改 420000 后 R3 通过 |
| v4-e8-double-check | FAIL（`UNKNOWN: open artifacts/e8-visual/e8-7-double-check.json`） | **4.5s / 15-0** | 并发写同一 artifact 文件；单跑绿，R2/R3 未复现 |
| r4-read-side | 回执称「26 断言过但 100s 未退出」 | **126.3s / 3 变异 CAUGHT / RESTORED GREEN / exit 0** | 实际通过；回执判「不记 PASS」偏严；已登记 130000 进重车道 |

**根本原因是这类套件在仓库内写大体积变异副本 + spawnSync 起多个 node 子进程**：`r4-p4-2` 4 个子进程、`r4-p4-3` 4 个子进程 × 2.1MB，`--jobs=8` 下 I/O 与 CPU 争抢把 8–16s 的套件推到 240s 以上。
## 5. 未完成 / 待裁定

1. `migration-optin-compat` 的正确修法（移植 #546 后半截到 `skins/iter5/*` + 生成器 seam）**未做**；需要先定「是否要这个功能」——它允许导入校验未通过的历史包（用户日历），属安全边界决策，应由用户裁定。
2. ~~`r4-p4-2` / `r4-p4-3` 的重车道登记值需要按「并发实测」重定~~ —— **已修**：`r4-p4-2`=9000（挪进重车道即 240s）、`r4-p4-3`=420000、`r4-read-side`=130000；R3 TIMEOUT 0。
3. ~~`r4-read-side` 应进重车道~~ —— **已修**（130000）。
4. 真实宿主、真实迁移、真实模型轮注入仍未验证。
5. 工作树仍未提交（HEAD `96bfded8`，120 项改动）。
