# dsh-auto-memory 前端构造全貌：生成器内外三区 + 双副本落点决策 + 守卫与基线

> **⚠️ 使用约束（必读）**
>
> 本技能由 **dsh-auto-memory** 从一次真实工作过程**自动沉淀**而来，**不是通用最佳实践**。
>
> 1. **附带程序仅供参考**：本目录下的脚本（如 `.py`）是**当时那次工作用过的程序**，
>    **不是可直接调用的工具**。它们可能依赖当时的路径、环境变量、数据格式或版本。
> 2. **场景根本不同时 → 只做迁移，不要直接运行**：若当前任务与下方「来源」描述的场景
>    **有根本差异**，请把附带的程序**当作思路参考**，按当前场景**重写**，而不是直接执行。
> 3. **跨项目使用须先核对**：本技能的「适用项目」若与当前项目**不一致**，
>    **一律只作参考**，不得直接套用其路径、命令与判据。
> 4. **高风险步骤需人工确认**：涉及删除、发布、付费、外部发送等动作，必须先向用户复述确认。

## 来源

- **适用项目**：`dsh-auto-memory`（`D:\dsh-auto-memory`）
- **沉淀自**：dsh-auto-memory 技能库（procedure `proc_pre_73fe8ffada24a5cbb05ceca546702a58`）
- **风险等级**：`medium`
- **导出时间**：2026-11-08T20:29:18.614Z

> 若你的当前项目**不是** `dsh-auto-memory`，请**只作参考**，不要直接套用下方路径与命令。

## 何时适用

- 工作区 D:\dsh-auto-memory，开发树即发布源；零依赖（无 node_modules/typescript）
- 改动前先跑 node tools/build-iter5-skin.mjs --check --strict 取基线（期望 SYNC-OK）
- 改前备份将被触碰的文件（四个面）

## 步骤

1. 第0步 定三区（改前必做，行号必须现取不要凭记忆）：在 lib/client.js grep 三组标记，注意 GENERATED 有**两对**，靠**缩进**区分——① `// ===== ITER5-LEGACY-GENERATED:BEGIN =====` 与 `:END`（**4 空格缩进**）＝旧款冻结块；② 在①**内部**还有一对 `// ITER5-GENERATED:BEGIN` / `:END`（**6 空格缩进**）＝冻结块里嵌的那份旧款副本，其内容来自 `skins/legacy/iter5-325.js.frozen`，**不是**主生成块；③ 紧跟①之后还有一对 `// ITER5-GENERATED:BEGIN` / `:END`（**4 空格缩进**）＝**主生成块**（新款 iter5 皮肤，`--check` 真正比对的就是它）。2026-10-12 实测行号：①10389–12793；②10395–12788（嵌在①内）；③**12794–16109**。⇒ 三者之外的其余部分（10389 之前 + 16109 之后）＝**手写区**，经典档组件住在这里（WorkspaceTab 约 L8439、SettingsPage 约 L17560）。判据：先跑 `node tools/build-iter5-skin.mjs --check --strict`，若 SYNC-OK 说明磁盘产物 == 生成源产物，此时生成区内**不可能**存在人工手改。
2. 第1步 判断改动落在哪一区（决定改哪里+要不要重跑生成器）：① 只影响**经典档**（classic/旧版界面）→ 改 lib/client.js 的**手写区**（上述三区间之外），**不用**重跑生成器；② 影响**新款 iter5 皮肤** → 必须改 `skins/iter5/*` 源，然后重跑生成器；③ **两档共用的组件**（如 SettingsPage 被生成器 `client.slice` 取走再改名 `Iter5Settings`）→ 改 lib/client.js 手写区**并**重跑生成器，两条线同时生效；④ `skins/legacy/iter5-325.js.frozen` 是**第三份独立副本**（旧款皮肤真源），凡改三面共有的控件必须同步补它，否则 `smoke-test-settings-parity.mjs` 三面一致性守卫会红。
3. 第2步 改 skins/iter5/* 生成源后必须重跑生成器，三种模式语义（实测）：`--check` 只读比对，一致打印 SYNC-OK、不一致报 stale，**绝不写盘**；**无 flag 实跑 = 写盘**，且默认即停机（R2）——若产物含「只存在于 lib/client.js 而无生成源」的行，**拒绝写盘 exit 2**；`--force` 是唯一显式覆盖通道（`--strict` 是 `--force` 的反义别名，保留以免外部脚本失效）。**运行顺序纪律**：唯一合法序列 = `--check` 绿 → 无 flag 实跑 → 若被 R2 orphan 拦下，先归因（那些行该不该在？该在就搬进生成源），确属应弃才用 `--force`。
4. 第3步 R2 护栏被拦时的归因法（实测有效，**勿直接 --force**）：把 `skins/iter5/*` 与 `.frozen` **还原成旧版**再跑 `--check`；若报 SYNC-OK ⇒ 证明磁盘产物逐字节等于旧源产物、生成区内**没有手工修复**，被拦下的行就是本次有意替换掉的旧实现 ⇒ `--force` 合法。若还原后仍 stale ⇒ 生成区内有人手改，必须先把改动搬进生成源。
5. 第4步 防「半修」：改动可能横跨**生成源**与**生成区外手写区**两个面。逐 hunk 清点每个 hunk 属 ①`skins/iter5/*` ②`skins/legacy/*.frozen` ③`lib/client.js` 手写区 哪一类；只改生成源会让手写区接线缺失（实测 #334：经典档 WorkspaceTab 缺 `fitKey`/`current` 接线 ⇒ 组件拿不到必需 props，行为**静默退化**）。判据：`--check` 绿 **不等于** 移植完整。
6. 第5步 行尾约定（实测，勿猜）：`lib/client.js` 与 `lib/index.js` 是 **CRLF**（client.js 18992 CRLF / 0 裸 LF）；`skins/iter5/*.js|css`、`skins/legacy/*.frozen`、`tools/*.mjs` 是 **LF**（如 native-map.js 0 CRLF / 90 LF）。给 CRLF 文件打补丁时 `split("\n")` 会让行尾残留 \r ⇒ 写完必须断言 `(?<!\r)\n` 计数为 0；给 LF 文件写要断言 `\r` 计数为 0。`node --check` 对 `.frozen` 扩展名会报 ERR_UNKNOWN_FILE_EXTENSION（**不是语法错**），要复制成 `.js` 再 check。
7. 第6步 落地后按序跑守卫（缺一不可）：① `node --check lib/client.js` 与 `lib/index.js`；② `node tools/build-iter5-skin.mjs --check --strict`（期望 SYNC-OK，证明 生成源×生成器×产物 三者一致）；③ **真执行 factory 的运行时守卫** `node tests/smoke/smoke-test-iter5-skin.mjs`（静态断言与 `--check` 都**不足以**证明「能加载」）；④ 三面一致性 `node tests/smoke/smoke-test-settings-parity.mjs`（classic/variants/legacy 键集须一致）；⑤ 全量 `node tools/run-smoke.mjs --timeout=120000 --exclude=-live --exclude=m79-feature-v2 --exclude=m710-fv2-emit --exclude=c4-fresh-install`；⑥ **单独**跑 `node tools/verify-docs.mjs`（**不在回归套件内**，改配置键/计数会撞它）。
8. 第7步 基线锁红了先归因再动手（本仓 340 个套件，17 个涉生成器或生成区）：两把必看——`smoke-test-iter5-skin.mjs` 守「剥掉生成区后的**经典档**」sha256（改 client.js 手写区必红）；`smoke-test-r26-cross-layer.mjs` E3 守 `lib/index.js` 归一化 LF 后 sha256 前 16 位（改 lib/index.js 必红）。判据：先做「真缺陷 vs 判据过期」二选一——若本次是**有意演进**（改动可归因到本批具体改动），按 2026-10-01 用户裁定「判据过期改判据、不回滚成果」，用**套件自身打印的 actual** 重钉，并在常量旁写清演进原因；否则改代码。
9. 第8步 改配置键的连带（本批实测踩过）：新增/删除 `DEFAULT_CONFIG` 键会影响 ① POST /config 写入白名单（= `Object.keys(DEFAULT_CONFIG)`，自动放行）② `verify-docs.mjs` 的「配置键 = 代码实测」5 处（WHITEPAPER / HOMEPAGE-CONTENT-FOR-GM53 / FRONTEND-CO-CREATION×2 / README.md / README.zh-CN.md）③ r26 E3 哈希锁。三处都要同步，否则出现「回归全绿但文档校验红」的**假绿**。
10. 第9步 前端入口硬纪律：`lib/client.js`、`skins/iter5/*` **禁止三方合并 / 整块替换式重构**（用户 2026-10-01 明警告，社区改动曾大量污染、修一天）；社区前端改动默认**不移植**，只可逐块有限移植，且必须配「生成器 SYNC-OK + 真执行 factory 运行时守卫 + 同批重钉 iter5 基线」三件套。
11. 第0b步（2026-11-09 新增 · 血泪判据：改错副本 = 用户永远看不到而套件全绿）**先确定「用户界面属于哪一份副本」，再动手**。
12. 背景（设计原因，不是复制事故）：生成器把**两套皮肤打进同一个 bundle**，运行时零 reload 切换 ——
13. · `DAM_SKIN_STYLE_KEY` + `DAM_SKIN_VARIANT_IDS = [legacy, instrument, editorial, water]`；
14. · 冻结块整体包 IIFE（`LEGACY_SKIN_NS`）做**作用域隔离**，注释原话：「内部仍用原来的 Iter5* 名字，作用域隔离 ⇒ 与三套变体块零冲突；只导出 page/css 两个跨块符号」。
15. 所以同名函数（如 `Iter5Memory`）在 client.js 里出现两次是**故意的**，两份都叫同一个名字、各自完整实现。
16. ★命名陷阱（本次踩坑根因）：`DAM_SKIN_VARIANT_IDS[0] = legacy` 的那套**就是默认皮肤、也是用户口中的「新款/九页工作台」**；
17. 而技能里原先写的「新款 iter5 皮肤 = skins/iter5/*」指的是**变体十屏**，两者命名正好错位。禁止按名字猜。
18. 判据（可执行，3 条任取 2 条自洽即可定案）：
19. ① 拿用户截图里的**稳定文案**去 grep 源文件：命中 `.frozen` ⇒ 旧款那份；命中 `skins/iter5/*` ⇒ 变体那份。
20. 本次实测：「集中查看用户偏好、项目笔记、每日日志与反思记录。」只在 `.frozen` 与 client.js 冻结块出现。
21. ② 拿**页签表/导航项数组**去 grep：`[[browse, logs, reflections, search]]` 这类数组在哪份源里，就是哪份；
22. ③ 看 `damSkinLegacy()` / `damSkinStyleGet()` 的当前取值，以及「返回经典皮肤」按钮是否出现（出现 = 现在不是经典档）。
23. ⇒ 定案后才决定改 `.frozen` 还是 `skins/iter5/*`；**改错那份的表现是：生成器 SYNC-OK、全部套件绿、用户界面毫无变化**。
24. 第10步（2026-11-09 追加 · 双副本验收）改完必须核对「**目标副本确有改动**」，不能只看「源码里有」：
25. `grep -n "键标记" lib/client.js` 把**所有命中行号**列出来，逐个确认该行是否含本次改动（两份副本各一行，行号分别在冻结块与主生成块内）；
26. 再对源文件（`.frozen` / `skins/iter5/*`）各确认一次；三条（源 A / 源 B / 生成区 A / 生成区 B）互相印证后才算落地。
27. 反例（本次实测）：只改 `skins/iter5/ui.js` 并重建 ⇒ 主生成块含改动、冻结块仍为旧实现、SYNC-OK、`client-loadable` / `l3-team` / `iter5-skin` 全绿，而用户看不到任何变化。

## 检查点

- [ ] [ ] 改前先跑 --check：SYNC-OK ⇒ 生成区内不存在人工修复，可放心按「改源→重跑」推进；stale ⇒ 先弄清是「源改了没重跑」还是「产物被手改」
- [ ] [ ] 被 R2 orphan 拦下时，先做「还原旧源再 --check」归因实验，确认无手工修复后才用 --force
- [ ] [ ] 逐 hunk 清点是否横跨生成源与生成区外手写区（防半修：只改生成源会导致接线缺失、静默行为退化）
- [ ] [ ] 改 DEFAULT_CONFIG 后三处连带（白名单自动 / verify-docs 5 处 / r26 E3 哈希）是否都同步
- [ ] [ ] 基线锁红时先判「真缺陷 vs 判据过期」，禁止直接回滚成果
- [ ] [ ] 经典档浮层硬前提：frozen/经典档**禁止定义**任何 --i5-*/--dam-* 自定义属性（只允许读取），否则变量外溢污染全页
- [ ] [ ] 动手前已用「截图稳定文案 / 页签数组 / skinStyle 当前值」定案用户界面属于冻结块还是变体块（禁止按皮肤名字猜）
- [ ] [ ] 改完已 `grep -n` 列出该函数在 client.js 的**全部**命中行号，并逐个确认目标那份含改动（不是只看「源码里有」）

## 成功判据

- 三区边界行号已**实测复算**（GENERATED 两对靠缩进区分：4 空格=主生成块、6 空格=冻结块内嵌副本），非凭记忆
- 改动落点分类明确：能说清改的是 ①skins/iter5/* ②skins/legacy/*.frozen ③lib/client.js 手写区 中的哪几类，并据第1步决定是否重跑生成器
- node tools/build-iter5-skin.mjs --check --strict 输出 SYNC-OK（生成源 × 生成器 × lib/client.js 产物 三态一致）
- 真执行 factory 的运行时守卫通过：node tests/smoke/smoke-test-iter5-skin.mjs exit 0（不能用静态断言替代）
- 三面一致性通过：node tests/smoke/smoke-test-settings-parity.mjs 报 classic/variants/legacy 键数相同
- 全量回归 FAIL 0 / TIMEOUT 0，且计数 ≥ 改动前基线 + 本批新增套件数
- node tools/verify-docs.mjs 单独跑并全绿（它不在回归套件内）
- 行尾复算给出数字：CRLF 文件裸 LF = 0、LF 文件 CR = 0
- 若重钉了基线锁：新值来自套件自身打印的 actual 或套件自身表达式复算，常量旁写明本次演进原因；无一处「为变绿而放宽断言」
- 已用「截图稳定文案 / 页签数组 / 皮肤当前值」实测定案改动目标是冻结块还是变体块，不按皮肤名字推断
- 目标函数在 lib/client.js 的**所有**命中行号已列出并逐个确认含本次改动；两份副本各自的源文件也已同步（若两份都该有）
- 若只应改一份：已说明另一份为何不需要改（避免下次被当成漏改）

## 回滚

- 改前备份四个面：lib/client.js、lib/index.js、skins/iter5/*（改动的那几个）、skins/legacy/iter5-325.js.frozen
- 生成器写盘后若发现不对：用备份还原**源**再重跑生成器；不要手工编辑生成区（下次重跑会被覆盖，且破坏 SYNC-OK）
- 基线锁重钉后发现误判：把常量改回原值（锁本身不改行为），同时说明为何判「真缺陷」


<!-- mem-skill-export-pre-v1 -->