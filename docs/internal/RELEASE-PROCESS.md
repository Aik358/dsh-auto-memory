# 发版固定流程（dsh-auto-memory）

> 2026-09-10 固化。本文件是发版的唯一检查表；`tools/release.mjs` 已内置**版本标识一致性闸门**（缺任一项即拒绝构建），所以下面第 2、3 步不是"记得做"，而是"不做就发不出去"。

## 角色分工（2026-09-13 固化，改点3）

- **任务书流向**：主对话读本检查表 → 角色分工指向任务书 → **主对话填入版本号后原文派发给执行子代理**。用户不必、也不要绕过主对话直接投喂子代理（两条入口并存=并发冲突之源）。
- **主对话 = 决策者，只做三件事**：①开闸前确认前置门（第 0 节：全量回归结果 + 脏树范围核实）②收到子代理回报后**放行或中止** ③失败时决定处置方向。**主对话不得逐步执行本清单**——发版这类固化流程交给子代理执行（主对话上下文最贵）。
- **子代理 = 执行者**：投喂 [`docs/prompts/RELEASE-AGENT.md`](../prompts/RELEASE-AGENT.md)（自包含任务书，填入版本号），按本清单全跑、**出错即停**，只回结构化结论 `{ ok, version, pre_sha, rel_sha, tag, npm_latest, failed_step, error_tail }`。
- **不得并发（冲突防线）**：主对话**派活后等待回报**，期间对同一工作区**只读**（看日志/读状态可以；改文件、git 写操作、跑发版命令、再派第二个执行子代理都不行）；只读类任务书（回归/对账/巡检）之间可并行，但**不与发版执行并发**（回归占满 CPU 会污染计时敏感套件）。
- 凭据不经主对话转手：子代理按任务书自行从 `--D--dsh_debug--` 记忆文件读取，回报中一律 `<redacted>`。
- 同类固化流程的任务书：全量回归=[`REGRESSION-AGENT.md`](../prompts/REGRESSION-AGENT.md) · 双语对账=[`DOCS-AUDIT-AGENT.md`](../prompts/DOCS-AUDIT-AGENT.md) · 痕迹巡检=[`TRACE-PATROL-AGENT.md`](../prompts/TRACE-PATROL-AGENT.md)。

## 0. 前置门（不满足不许开工）

- [ ] 全量回归：`cd D:\dsh-auto-memory; Get-ChildItem tests\smoke -File -Filter *.mjs | ForEach-Object { node $_.FullName }` → **0 失败**
- [ ] `node --check lib/index.js` 与 `lib/client.js` 通过；改动文件无 BOM
- [ ] **脏树范围核实**：`git status --short` 里只有本次要发布的文件（`release.mjs` 的源就是工作区，脏树会整体进包且不可回溯）
- [ ] **上游回流对账**：`node tools\reconcile-upstream.mjs` → 结论必须是「✓ 上游产物已全部回流开发树」
      （`release.mjs` 已内置同名闸门 §3.7，缺产物即拒绝构建；本步是让人在动手前先看到分叉度与孤儿提交数）

## 0.5 上游修复回流工作树（2026-09-22 固化，事故换来的；2026-09-23 口径更新）

**为什么有这一节**：开发树与 GitHub `main` **自 2026-09-07 起分叉**，而**发布包是从开发树构建的**
（`release.mjs` 从 DEV 树生成 REL 树）。于是「在 `main` 上修」= **白修**：既不影响发布包，
还会被下一次发布强推冲成孤儿。**实证代价**：#103/#104/#105 三条 P1 修了两轮（PR #118/#119/#120，
2026-09-21 16:47 全部 `merged=true`），用户侧**从未拿到** —— 三个合并提交在本机
`git merge-base --is-ancestor … origin/main` 返回 **128（对象不存在）**，只剩 GitHub 侧。
完整取证见 [`WHY-FIXES-MISSING-20260922.md`](WHY-FIXES-MISSING-20260922.md)。

**硬约束（三条，缺一即视为没修）**：

1. **修复必须落在唯一工作树** `D:\dsh-auto-memory`（★2026-09-23 删净 pre 后：**已无 pre 线 / dev 树之分，
   也没有 `-pre` 后缀与 `libModuleRenames` 登记表** —— 构建退化为纯复制 + 身份变换，源码名即发布名）。
2. **合任何 `base=main` 的 PR 之后，立刻回流**：不能等下次发版才想起来。
   命令（只读、无网络）：
   ```powershell
   cd D:\dsh-auto-memory
   node tools\reconcile-upstream.mjs          # 报告：分叉度 + 孤儿提交 + 回流产物清单
   node tools\reconcile-upstream.mjs --strict # 闸门模式：有缺即 exit 1
   ```
3. **产物清单是活文档**：每回流一条上游修复，就把它的**产物**（模块 / 守卫 / 关键修复标记行）
   加进 `tools/reconcile-upstream.mjs` 的 `MUST_BE_IN_PRE` / `MUST_MARKERS`（去 pre 后清单内一律用**裸名**）——
   否则下次同样的事故闸门不会知道该拦。**这条是把「惯例」变成「机制」的关键**：清单不写，等于没立规矩。

**判据（人工复核用）**：`merge-base` 日期若明显落后于最近一次发版，且 `main` 独有提交里有带
`fix(...)` 的合并提交，则**必须**逐条确认其产物是否已在开发树。


## 1. 定版本号

- 纯修复 → patch；有新行为/新键 → minor。写在 `CHANGELOG.md` 与下文各处。

## 2. 必改 CHANGELOG（第 1 笔）

- [ ] `CHANGELOG.md` 顶部新增 `## [<ver>] — <日期> · <一句话主题>` 小节，含：覆盖范围 / 缺陷修复 / 内部重构（若有）/ 流程（若有）/ 验证
- 闸门校验：文件里必须出现 `## [<ver>]`，否则 `release.mjs` 拒绝构建

## 3. 必同步软件内版本标识（第 2 笔）

- [ ] **应用内更新说明字典**：`lib/client.js` 的 `var CHANGELOG = { ... }` 顶部新增 `'<ver>': { zh: [...], en: [...] }`（这是弹窗里的"更新说明"，缺了用户升级后看不到本版说明）
- [ ] **界面指纹行**：`lib/client.js` 第 10 行 `console.log('[dsh-auto-memory] client v<ver> fingerprint: ...')`
- [ ] `package.json.version`：**由 `release.mjs` 自动回写开发树**（面板徽标与「检测更新」读的就是它），构建后复核输出里有 `开发树版本回写: x.y.z → <ver>`
- 闸门校验：以上三项任一与新版本号不一致 → **拒绝构建**（防止检测更新一直拿旧版本号去比对）

## 4. 开发树提交

```powershell
cd D:\dsh-auto-memory
git add lib tests CHANGELOG.md tools/release.mjs
git -c user.name="Aik358" -c user.email="aik358@users.noreply.github.com" commit -m "v<ver>: <一句话>"
```

## 5. 先 dry-run 验闸门

```powershell
node tools\release.mjs <ver> --dry-run     # 走临时 staging,不碰发布基座
```
期望看到：`版本标识一致性: OK(CHANGELOG / 应用内更新说明 / 界面指纹行)` + `语法 ✓ BOM ✓ 无 pre/dev 残留 ✓` + `python/ 运行时完整 ✓ bench 已排除 ✓`

## 6. 真构建

```powershell
node tools\release.mjs <ver>               # 写 D:\dsh_debug\_publish_dsh-auto-memory + 回写开发树版本
```

## 7. REL 提交 + 打 tag

```powershell
cd D:\dsh_debug\_publish_dsh-auto-memory
git add -A
git -c user.name="Aik358" -c user.email="aik358@users.noreply.github.com" commit -m "v<ver>: <一句话>"
git tag -f v<ver>
```

## 8. push（必须带 PAT 行内 URL）

```powershell
git -c credential.helper= push https://x-access-token:<PAT>@github.com/Aik358/dsh-auto-memory.git main --tags --force
```

## 9. npm publish（单向门，最后一步）

```powershell
cd D:\dsh_debug\_publish_dsh-auto-memory
npm publish . --registry=https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=<token> --access public
```

## 10. 三处复核（缺一不算发完）

```powershell
npm view @a9i5k4/dsh-auto-memory version --registry=https://registry.npmjs.org   # 必须显式指定官方 registry
git ls-remote https://github.com/Aik358/dsh-auto-memory.git refs/heads/main
git ls-remote https://github.com/Aik358/dsh-auto-memory.git refs/tags/v<ver>
```
三处 sha/版本必须一致。

**坑（2026-09-10 实测）**：`npm view` 会命中本地 npm 缓存 —— 刚发布后可能仍回读到**上一个版本**（本次 v2.4.2 发布成功后仍回读 2.4.1）。判定以 **registry 权威接口**为准：

```powershell
Invoke-RestMethod 'https://registry.npmjs.org/@a9i5k4%2Fdsh-auto-memory/latest' | Select-Object -ExpandProperty version
npm view @a9i5k4/dsh-auto-memory version --registry=https://registry.npmjs.org --prefer-online
```

## 纪律

- **★ 上游修复必须回流开发树**（2026-09-22 事故固化，见 §0.5）：开发树与 `main` 是两条分叉历史，
  发布包从 pre 构建 ⇒ 在 `main` 上修等于没修。合完上游 PR 立刻 `node tools\reconcile-upstream.mjs`
  对账，并把新产物加进该脚本的清单。`release.mjs` §3.7 会在发版时再拦一次。
- **凭据只走行内 URL / 环境变量，严禁写进任何会上传 GitHub 或 npm 的文件**（本文件亦不写）。
- 本机 `~/.npmrc` 指向 npmmirror → 查询与发布都必须显式 `--registry=https://registry.npmjs.org`，否则会查到旧版本、误判发布失败。
- 发布后实机生效：宿主 `lib/index.js` 需重启；界面半边刷新页面即可。`update-check` 有落盘缓存（`~/.dsh/memory/update-check-pre.json`），需要时用「检查更新」强制刷新。
