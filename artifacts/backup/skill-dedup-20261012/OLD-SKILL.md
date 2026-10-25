---
name: mem-skill-dsh-auto-memory-c77663d10bd2
description: dsh-auto-memory 前端构造全貌：生成器内外三区 + 改动落点决策 + 守卫与基线
---

# dsh-auto-memory 前端构造全貌：生成器内外三区 + 改动落点决策 + 守卫与基线

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
- **沉淀自**：dsh-auto-memory 技能库（procedure `proc_pre_c77663d10bd247c4da72f29772fa4a3d`）
- **风险等级**：`medium`
- **导出时间**：2026-10-12T09:58:02.249Z

> 若你的当前项目**不是** `dsh-auto-memory`，请**只作参考**，不要直接套用下方路径与命令。

## 何时适用

- 工作区 D:\dsh-auto-memory，开发树即发布源；零依赖（无 node_modules/typescript）
- 改动前先跑 node tools/build-iter5-skin.mjs --check --strict 取得基线（期望 SYNC-OK）
- 改前备份将被触碰的文件（四个面）

## 步骤

1. 第0步 定三区（改前必做）：读 lib/client.js 顶部标记确定四个边界行号——// ITER5-LEGACY-GENERATED:BEGIN / :END（旧款冻结块）与 // ITER5-GENERATED:BEGIN / :END（新款生成块）。本文件 2026-10-12 实测：LEGACY 10389-12793、GENERATED 10395-12788（legacy 包着 generated），生成的再外层还有第 3 份经典档（L10395 之前 + L16109 之后的手写区，SettingsPage 约 L17560）。判据：先跑 node tools/build-iter5-skin.mjs --check --strict，若 SYNC-OK 说明磁盘产物 == 源产物，此时生成区内任何内容都**不可能**是人工手改的。
2. 第1步 判断改动落在哪一区（决定改哪里+要不要重跑生成器）：① 只影响**经典档**（classic/旧版界面）→ 改 lib/client.js 的**手写区**（生成区之外），不用重跑生成器；② 影响**新款 iter5 皮肤** → 必须改 skins/iter5/* 源（配置资产+JS 都在这里），然后重跑生成器；③ **经典档也用的组件**（如 SettingsPage，被生成器 slice 走再改名 Iter5Settings）→ 改 lib/client.js 手写区**并**重跑生成器，两条线同时生效；④ **旧款冻结表** skins/legacy/iter5-325.js.frozen 是第 3 份独立副本，凡改三面共有的控件必须同步补它，否则 smoke-test-settings-parity.mjs 三面一致性守卫会红。
3. 第2步 改 skins/iter5/* 生成源后必须重跑生成器，注意其三种模式语义（实测）：--check 只读比对，一致打印 SYNC-OK / 不一致报 stale，绝不写盘；无 flag 实跑 = 写盘，且默认即停机（R2）——若产物含「只存在于 lib/client.js 而无生成源」的行，**拒绝写盘 exit 2**；--force 是唯一的显式覆盖通道（--strict 是 --force 的反义别名）。**运行顺序纪律**：唯一合法序列 = --check 绿 → 无 flag 实跑 → 若被 R2 orphan 拦下，先归因（那些行该不该在？该在就搬进生成源），确属应弃才用 --force。
4. 第3步 R2 护栏被拦时的归因法（实测有效，勿直接 --force）：把 skins/iter5/* 与 .frozen **还原成旧版**再跑 --check；若报 SYNC-OK ⇒ 证明磁盘产物逐字节等于旧源产物、生成区内**没有手工修复**，因此被拦下的行就是本次有意替换掉的旧实现，--force 合法。若还原后仍 stale ⇒ 生成区内有人手改，必须先把改动搬进生成源。
5. 第4步 防「半修」：PR/改动可能横跨**生成源**与**生成区外手写区**两个面。逐 hunk 清点：每个 hunk 属于 ①skins/iter5/* ②skins/legacy/*.frozen ③lib/client.js 手写区 哪一类；只改生成源会让生成区外的接线缺失（实测 #334：经典档 WorkspaceTab 缺 fitKey/current 接线 ⇒ 组件拿不到必需 props，行为静默退化）。判据：生成器 --check 绿 **不等于** 移植完整。
6. 第5步 行尾约定（实测，勿猜）：lib/client.js 与 lib/index.js 是 **CRLF**（client.js 18992 CRLF / 0 裸 LF）；skins/iter5/*.js|css、skins/legacy/*.frozen、tools/*.mjs 都是 **LF**（如 native-map.js 0 CRLF / 90 LF）。给 CRLF 文件打补丁时 `split("\n")` 会让行尾残留 \r ⇒ 写完必须断言 `(?<!\r)\n` 计数为 0；给 LF 的 frozen 写要断言 `\r` 为 0。node --check 对 .frozen 扩展名会报 ERR_UNKNOWN_FILE_EXTENSION（不是语法错），要复制成 .js 再 check。
7. 第6步 落地后按序跑守卫（缺一不可）：① node --check lib/client.js 与 lib/index.js；② node tools/build-iter5-skin.mjs --check --strict（期望 SYNC-OK，证明源×生成器×产物三者一致）；③ **真执行 factory 的运行时守卫** node tests/smoke/smoke-test-iter5-skin.mjs（静态断言与 --check 都不足以证明「能加载」）；④ 三面一致性 node tests/smoke/smoke-test-settings-parity.mjs（classic/variants/legacy 键集必须一致）；⑤ 全量 node tools/run-smoke.mjs --timeout=120000 --exclude=-live --exclude=m79-feature-v2 --exclude=m710-fv2-emit --exclude=c4-fresh-install；⑥ **单独**跑 node tools/verify-docs.mjs（不在回归套件内，改配置键/计数会撞它）。
8. 第7步 基线锁红了先归因再动手（本仓 340 个套件，17 个涉生成器或生成区）：两把锁必看——smoke-test-iter5-skin.mjs 守「剥掉生成区后的经典档」sha256（改 client.js 手写区必红）；smoke-test-r26-cross-layer.mjs E3 守 lib/index.js 归一化 LF 后 sha256 前16位（改 lib/index.js 必红）。判据：先按「真缺陷 vs 判据过期」二选一——若本次是**有意演进**（改动可归因到本批具体改动），按 2026-10-01 用户裁定「判据过期改判据、不回滚成果」用**套件自身打印的 actual** 重钉，并在常量旁写清演进原因；否则改代码。
9. 第8步 改配置键的连带（本批实测踩过）：新增/删除 DEFAULT_CONFIG 键会影响 ① POST /config 写入白名单（= Object.keys(DEFAULT_CONFIG)，自动放行）② verify-docs.mjs 的「配置键 = 代码实测」5 处（WHITEPAPER / HOMEPAGE-CONTENT-FOR-GM53 / FRONTEND-CO-CREATION×2 / README×2）③ r26 E3 哈希锁。三处都要同步，否则出现「回归全绿但文档校验红」的假绿。
10. 第9步 前端入口的硬纪律：lib/client.js、skins/iter5/* **禁止三方合并 / 整块替换式重构**（用户 2026-10-01 明警告，社区改动曾大量污染）；社区前端改动默认不移植，只可逐块有限移植，且必须配「生成器 SYNC-OK + 真执行 factory 运行时守卫 + 同批重钉 iter5 基线」三件套。

## 检查点

- [ ] 改前先跑 --check：若 SYNC-OK，则生成区内不存在人工修复，可放心按「改源→重跑」推进；若 stale，先弄清是源改了没重跑还是产物被手改
- [ ] 被 R2 orphan 拦下时，先做「还原旧源再 --check」的归因实验，确认无手工修复后才用 --force
- [ ] 逐 hunk 清点是否横跨生成源与生成区外手写区（防半修：只改生成源会导致接线缺失、静默行为退化）
- [ ] 改 DEFAULT_CONFIG 后三处连带（白名单自动、verify-docs 5 处、r26 E3 哈希）是否都同步
- [ ] 基线锁红时先判定「真缺陷 vs 判据过期」，禁止直接回滚成果
- [ ] 经典档浮层硬前提：frozen/经典档**禁止定义**任何 --i5-*/--dam-* 自定义属性（只允许读取），否则变量外泄污染全页

## 成功判据

- 三区边界行号已实测复算（四个标记行号可从 lib/client.js grep 得出，非凭记忆）
- 改动落点分类明确：能说清改的是 ①skins/iter5/* ②skins/legacy/*.frozen ③lib/client.js 手写区 中的哪几类，并据第1步决定是否需要重跑生成器
- node tools/build-iter5-skin.mjs --check --strict 输出 SYNC-OK（三态一致：生成源 × 生成器 × lib/client.js 产物）
- 真执行 factory 的运行时守卫通过：node tests/smoke/smoke-test-iter5-skin.mjs exit 0（不能用静态断言替代）
- 三面一致性通过：node tests/smoke/smoke-test-settings-parity.mjs 报 classic/variants/legacy 键数相同
- 全量回归 FAIL 0 / TIMEOUT 0，且计数 ≥ 改动前基线 + 本批新增套件数
- node tools/verify-docs.mjs 单独跑并全绿（它不在回归套件内）
- 行尾复算：CRLF 文件裸 LF = 0、LF 文件 CR = 0（给数字，不给形容词）
- 若重钉了基线锁：新值来自套件自身打印的 actual 或套件自身表达式复算，且常量旁写明本次演进原因；无一处「为了变绿而放宽断言」

## 回滚

- 改前备份四个面：lib/client.js、lib/index.js、skins/iter5/*（改动的那几个）、skins/legacy/iter5-325.js.frozen
- 生成器写盘后若发现不对：用备份还原**源**再重跑生成器，不要手工去编辑生成区（下次重跑会被覆盖，且破坏 SYNC-OK）
- 基线锁重钉后发现是误判：把常量改回原值即可（锁本身不改行为），但需同时说明为何判定为「真缺陷」


<!-- mem-skill-export-pre-v1 -->
