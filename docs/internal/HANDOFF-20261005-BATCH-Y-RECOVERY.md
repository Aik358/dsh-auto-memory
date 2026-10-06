# HANDOFF — 批次 Y 事故恢复交接包（2026-10-05）

> **给下一位接手的模型（DeepSeek harness）**：这是一次 `git checkout -- lib/client.js` 事故后的恢复现场交接。
> 请先通读本文件，再自行在仓库中核对；本文所有结论都带可复跑的证据命令。
> 仓库：`D:\dsh-auto-memory`，分支 `wip/20260926-teamwork`，HEAD=`e3498c6`（恢复检查点，未 push）。

---

## 0. 你要完成的任务（一句话）

**把批次 Y 的剩余收尾做完**：执行「真·重生成」（1 行已裁决孤儿，见 §5.1）→ 全量回归全绿 → **正式提交**（当前是 `wip(skin)` 检查点，应改写/追加为正式批次 Y 提交）→ 回复贡献者（3 条 PR）→ 礼节性 merge → 发布 v3.2.10。

在这之前，请先读 §1–§4 确认现状，**并核对 §6 的「未决问题」**（F2 的 ±1 计数是唯一真正的裁决点）。

---

## 1. 事故与恢复状态（已还原）

- **事故**：批次 Y（前端生成器线）施工中，有人执行 `git checkout -- lib/client.js`，把 client.js 整份还原到 HEAD（v3.2.9 原始态），抹掉全部批次 Y 的手写区 + 生成块。
- **恢复**：事故前存在两份完整快照（见 §7），其中 `/tmp/client.forced.js` 含**完整批次 Y 手写区**。
- **手写区回位**：`lib/client.js` 现位 = `/tmp/client.forced.js`（`cmp` 逐字节一致；见证据 §3 的 classic 哈希）。
- **源文件全部幸存**（未被 checkout 波及）：`skins/iter5/{views,ui,native-panel,settings-copy}.js`、`skins/legacy/iter5-325.js.frozen`、`tools/build-iter5-skin.mjs`、四个 smoke 测试 —— 均为批次 Y 版。
- **我修复的一处源缺陷**：`skins/legacy/iter5-325.js.frozen` 的 `fExclude` 块曾被批次 Y 的搬移重写写成**非法 JS**（单引号字符串里含真实换行，会在重生成时产出语法崩溃的 client.js）。已恢复为 `\n` 转义形态；同时把搬移时丢掉的 2 行注释回补（回补后孤儿从 3 降到 1）。
- **检查点提交**：`e3498c6`（13 个文件：11 个原有修改 + 2 个批次 Y 新增测试文件 `tests/smoke/smoke-test-batch-y-frontend.mjs`、`tests/lib/complete-client.mjs`）。**这不是最终提交**——先保命，防二次事故。

---

## 2. 术语与四份同步（背景）

`lib/client.js` 有两个区块由**生成器**从源重建（块外是手写区，生成器不碰）：
1. 变体十屏/设置区：来源 `skins/iter5/*.js` + 手写区切片（`function SettingsPage()` 段）+ `tools/build-iter5-skin.mjs` 的变换补丁；
2. 旧款冻结块（LEGACY）：来源 `skins/legacy/iter5-325.js.frozen`（LF 契约）。

**四份同步**：`skins 源` + `生成器` + `frozen` + `client.js 产物` 必须一致。判据与铁律：
- `node tools/build-iter5-skin.mjs --check` → 期望输出 `SYNC-OK`（R1：源产物一致才放行）。
- 生成器实跑时若发现「只存在于 client.js 的行」会**默认停机**（R2），只有显式 `--force` 才写盘。
- **一切改动落源**（skins/frozen/生成器），产物只由生成器写；手改生成的块必被下次生成覆盖。

---

## 3. 证据表（可复跑）

**classic 哈希**（剥掉两个生成块后的手写区 sha256；测试口径在 `tests/smoke/smoke-test-iter5-skin.mjs` 顶部）：

| 文件 | classic 哈希 | 说明 |
|---|---|---|
| `lib/client.js`（现位） | `a0460128…01f` | **= 测试期望值 ✅ 手写区完整** |
| `/tmp/client.forced.js`（18:34 快照） | `a0460128…01f` | 同左 |
| `/tmp/client.pre-gen.js`（18:29 快照，= `client.cur.js`） | `a0460128…01f` | 同左（生成块较旧） |
| `/tmp/client.head.js`（HEAD 原始态） | `dc6192a3…` | 事故基线（≠期望） |
| 部分恢复废件（`/tmp/dam-batchy-snap/client.current-broken.js`） | `9395da49…` | 已被取代，勿用 |
| `/tmp/pr213-client.js`（PR#213 原版） | `2d692db4…` | 仅作参照 |

复跑：`node .tmp-classic-hash.mjs lib/client.js /tmp/client.forced.js`（脚本在仓库根，`/tmp` = `C:\Users\JHZ~1\AppData\Local\Temp`）。

**重生成沙箱验证**（不碰真文件；`tools/.tmp-gen-dryrun.mjs` = 生成器改写版，输出到 `.tmp-gen-output.js`）：

- `node tools/.tmp-gen-dryrun.mjs --force` → 报告放弃**1 行**孤儿（L11542，见 §5.1），写出 `Embedded iter5 skin (584245 bytes)`。
- `node --check .tmp-gen-output.js` → **语法通过**（frozen 修复前为 SyntaxError，实证修复必要）。
- 产物 classic 哈希 = `a0460128…01f`（**手写区经重生成保持不变** ✅）。

**批次 Y 验收套件**（批次 Y 自带，67+5 断言）：`node tests/smoke/smoke-test-batch-y-frontend.mjs`
- 对**现位** client.js：全部通过（`PASS batch-Y frontend acceptance`）。
- 对**重生成产物**（`.tmp-gen-output.js`）：72 断言中 1 项待裁决 —— **F2**（见 §6.1）。F6 已确认由重生成修复（2→3，正是 L11542 那行）。

---

## 4. 你接手时的已知状态

- 工作区：`git status --porcelain --untracked-files=no` 应为**空**（全部批次 Y 改动已在 `e3498c6` 检查点）。
- `lib/client.js` = 手写区完整 + 生成块**略旧**（相对当前源，差 1 行 + 一批块内新增）。真重生成会刷新块。
- `.tmp-gen-output.js` = 重生成预览产物（沙箱），可作 diff 参照。
- 我建议**先真重生成 + 提交正式批次 Y 提交**，因为块刷新是对现状的唯一空洞；但先看 §6 裁决 F2。

---

## 5. 剩余步骤（按序）

### 5.1 真重生成（**必须**）
```bash
cd /d/dsh-auto-memory
node tools/build-iter5-skin.mjs --force     # 唯一孤儿 = 旧 fJsExcerpt 行，属「换新弃旧」，见下
node --check lib/client.js                  # 语法
node tools/build-iter5-skin.mjs --check     # 幂等复核 → 应 SYNC-OK（不再有孤儿）
```
**--force 的裁决依据**：唯一孤儿 L11542 是**旧形态**的 `fJsExcerpt` 行（无 disabled），而 frozen/skins 的新形态是「disabled + 当前方案后缀」——重生成是把**修复落地**，不是丢内容。重生成后 F6（fJsExcerpt ×3）从 2 变 3，这是正确方向。
> 若你想先看零风险演练：`node tools/.tmp-gen-dryrun.mjs --force`（输出到 `.tmp-gen-output.js`，已实证）。

### 5.2 回归
```bash
node tools/run-smoke.mjs          # 全量（~70s；此前 285/0；批次 Y 新增 1 套件 → 应为 286+，全绿）
```
重点套件单跑：`smoke-test-iter5-skin.mjs`（含 R78 哈希锁，**已按批次 Y 终态预钉 = a0460128**，重生成后应自动通过）、`smoke-test-batch-y-frontend.mjs`、`smoke-test-settings-sync.mjs`、`smoke-test-switch-decouple.mjs`、`smoke-test-r19-fe02-screens2.mjs`、`smoke-test-r26-cross-layer.mjs`（E3 锁的是 index.js，本批未动）。
> 注：`smoke-test-iter5-skin.mjs` 的哈希锁**已经**是批次 Y 的期望值（R78 注释链在文件里）。若它红了，先核对是否真的源产物不符，**不要盲目重钉**。

### 5.3 提交（正式批次 Y 提交）
把 `e3498c6` 的 `wip` 消息改为正式提交（或 follow-up squash 提交），提交信息建议：
```
feat(skin): 批次 Y 前端生成器线（PR#212 #5/#6 + PR#213 全部前端 + migPickInto 缺陷修复）
```
并在消息里记录「事故恢复」一句（`git checkout` 事故 → 快照回位 → frozen 修复）。

### 5.4 回复贡献者（3 条 PR）
对 PR #210/#212/#213（作者 Minervaowl7）各回一条：说明采纳方式（拆批随版本发布）、明确指出**未采纳项及原因**（详见 `docs/internal/AUDIT-20261005-PR210-212-213-VERIFICATION-AND-FIX-PLAN.md` §4 与 §5「本轮不采纳/缓办清单」）。要点：
- #210：五项全采纳（W 批）；含两项**裁定变更**已获用户拍板（「不跳号→允许空洞」「泛化回退→类型化回退门」），记得在回复里点明方向与理由。
- #212：七项采纳（X 批 + Y 批前端）；**workspace-key 重键与 python 分块 v2 缓办**（#179 领地 / 语义索引整库重建），如实说明。
- #213：后端 + 前端均采纳（Z 批 + Y 批）；其自带缺陷（frozen `migPickInto` 未声明 `request` 的 ReferenceError）已由我们修正，回复时可正面提及（诚信加分）。
- 还有一件挂账：给 **PR 报告者/issue 用户**（如 Android 用户的 cwd-mismatch 报告）的回复也未发（见记忆文件名 `workbench-cwd-canon-android-20261005`）。这一条如果你要发，措辞要点：补丁已采纳进 3.2.9，并说明我们比原补丁多了什么（win32 `\\?\` 前缀保险、新建熔断）。

### 5.5 礼节性 merge + 发布 v3.2.10
- 礼节性 merge：可选两种——(a) 在 GitHub 上按内容差异最小方式 squash/merge（若 github UI 允许）或 (b) 以「已在本仓拆取」的方式关闭 PR 并注明版本。按用户此前用过的惯例（merge -s ours 保署名算 contribution，见 `pr150-skin-integration` 记忆）——**推荐 (b) 的变体：用 `git merge -s ours` 在 main 上生成 merge 提交，保住作者署名链路**，具体执行前先 `git log --oneline -5` 确认 main 与 pr-210/212/213 refs 状态。
- 发布 v3.2.10：**三件套硬闸门**（CHANGELOG `## [3.2.10]` + client.js 字典 `'3.2.10': { zh: [` + 指纹行 `client v3.2.10 fingerprint:`）→ **iter5-skin 基线重钉**（client.js 会再变：指纹行+字典 → classic 哈希变，R79=…）→ `node tools/release.mjs 3.2.10` → REL 基座先 `--ff-only` → 版本回写补提交 → push main + tag → npm publish（token 候选轮换）→ 线上验证。完整流程与坑位见记忆 `release-329-record` / `release-328-record`，以及本仓 `docs/internal/REPAIR-ORCHESTRATION-SOP.md`。

---

## 6. 未决问题（接手第一优先核对）

### 6.1 【待裁决】F2 计数：post-regen = 6，套件期望 = 5
- 现象：`smoke-test-batch-y-frontend.mjs` 的 F2 断言 `cnt(client, "min: 0.3, max: 1, step: 0.05, value: cfg.waterLevelAutoMargin") === 5`；
  - 现位 client.js（块旧）：**5**（通过）；
  - 重生成后（`.tmp-gen-output.js`）：**6**（唯一 FAIL）。
- 定位：frozen 现有**两处** fAutoMargin 分区（`window` 区 L~1569 + `handoff` 区 L~1625），重生成后两处都进入产物 + 手写区三处 = 6；块旧时少 1。
- **可能的解释**（需你核实）：
  1. **套件期望落后**：若批次 Y 真态 = 6 处（三面手写 + frozen 两分区经生成进入的再多 1 处属预期），则套件应改为 `=== 6`（或 ≥）；
  2. **frozen 多了一处**：若 `handoff` 区那份 fAutoMargin 是批 Y 意外重复（原本只该 `window` 区有），则该删 frozen 里那一处；
  3. 判断方法：看 `smoke-test-batch-y-frontend.mjs` F2 注释的原始意图（「三面 handoff 分区 + window 分区既有行」→ 期望=3+2=5 是**作者的原始口径**），再对 frozen 的 `handoff` 区那行做溯源（`git log -S` 或看 batch Y 提交链）。
- 我的倾向：**核对后改套件为 6**（生成块扩张是结构必然），但因为这涉及改动测试期望值，**留给你裁决并记录理由**（这是恢复后唯一未闭环的点）。

### 6.2 【低优先】`.gitattributes` 与 frozen 行尾
- `skins/legacy/*.frozen text eol=lf` 契约已在（批次 W 加）。但**磁盘上 frozen 现在有 CRLF 行**（`grep -c $'\r'` = 2344；HEAD 版本也有 2265 —— 属历史遗留，非本次引入）。
- 影响：`git add` 时会按 eol=lf 归一，无碍提交；但**用 Edit 工具改这个文件会把行尾翻成 CRLF 噪声**（本次已实测）。建议：改 frozen 用：`node -e "..."` 或先备份行尾；提交前可用 `git diff --stat` 确认无整文件翻行噪声。

### 6.3 【低优先】两个批次 Y 遗留未跟踪物
- `tools/.trace-gen.mjs`（生成器 trace 版，疑似调试残留）、`tools/snippets/*`（历史片段）——判断哪个是批次 Y 线需要的，不需要的别提交。

---

## 7. 快照与工具清单（都在磁盘上）

| 路径 | 内容 | 用途 |
|---|---|---|
| `/tmp/client.forced.js` | 2,136,231 B，18:34，**完整批次 Y 态** | 恢复源（现位即它） |
| `/tmp/client.pre-gen.js` | 2,132,781 B，18:29 | 手写区同哈希，块更旧 |
| `/tmp/client.head.js` | 2,100,576 B，HEAD 原样 | 事故基线对照 |
| `/tmp/pr213-client.js` | PR#213 原版 | 参照 |
| `/tmp/dam-batchy-snap/` | 恢复工作目录（含 broken 废件、diff、scripts/ 副本） | 取证 |
| `artifacts/backup/batch-y-20261005/` | 上述关键快照 + sandbox 产物 + frozen 修复版 | **仓库内持久备份**（未提交，防 /tmp 被清） |
| `.tmp-classic-hash.mjs` | classic 哈希计算器 | 证据复跑 |
| `.tmp-gen-dryrun.mjs`（在 `tools/`） | 沙箱生成器（输出 `.tmp-gen-output.js`） | 零风险演练 |
| `.tmp-scan-multiline.mjs` | 多行字符串扫描器 | 扫同类 frozen 损坏 |
| `.tmp-gen-output.js` | 重生成预览产物 | diff 参照 |
| `.replay-y.py` / `.replay-y2.py` | 事故后**部分恢复**用脚本（旧件） | 历史参照，勿再跑 |
| `tests/smoke/smoke-test-batch-y-frontend.mjs` | 批次 Y 验收套件（已入检查点） | 主判据 |
| `tests/lib/complete-client.mjs` | 批次 Y 的 VM 夹具（已入检查点） | 套件依赖 |

> 纪律：**在正式提交完成前，不要删除 `/tmp` 与 `artifacts/backup/batch-y-20261005/` 的任何快照。**

---

## 8. 事故复盘：为什么「3 层守卫」没拦住它？

用户的原问题是「复写链路有 3 层防强制覆盖守卫，怎么还会被还原」。实测结论：

- 现有三层都长在**生成器路径**上：① `--check`（R1 检测源产物失配）；② 生成器写盘前的 orphan 停机（R2 默认拒绝）；③ 测试里的哈希锁（iter5 R78 / r26 E3）。
- **`git checkout -- <file>` 根本不经过生成器**：它是 git 层的「用索引覆盖工作区」操作，先于一切业务守卫；且经查 **`.git/hooks/` 下零活跃钩子**（只有 `.sample`），没有任何 hook 拦截点。
- 所以三层守卫全部天然旁路。**唯一有效防线 = 快照/提交习惯**：
  1. 事故能救回，全靠 18:29/18:34 的两份快照（`client.pre-gen.js` / `client.forced.js`）——**危险操作前先留档**；
  2. 本次已把关键快照复制进 `artifacts/backup/batch-y-20261005/`（仓库内），并做了检查点提交 `e3498c6`；
  3. 建议把「动 client.js 前先 `cp lib/client.js <备份>`」固化成习惯；`.replay-y*.py` 还留着部分恢复的教训（它产出的 258 行差异与完整快照不同，说明**部分恢复不可信，优先用完整快照**）。

---

## 9. 快速上手清单（按序勾掉）

- [ ] 读 §3 证据表，复跑 classic 哈希确认现位 = `a0460128…`。
- [ ] §6.1 裁决 F2（唯一未闭环点）。
- [ ] §5.1 真重生成 + `--check` SYNC-OK。
- [ ] §5.2 全量回归全绿。
- [ ] §5.3 正式提交（改写/追加 e3498c6）。
- [ ] §5.4 回复 3 条 PR（+ 挂账的仓库外回复）。
- [ ] §5.5 礼节性 merge + v3.2.10 发布（三件套 → R79 重钉 → release.mjs → npm）。
- [ ] 清理 `.tmp-*` / `.replay-y*.py`（**仅在正式提交后**）。
