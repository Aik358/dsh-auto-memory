# RELEASE-AGENT · 发版执行子代理任务书

> **给使用者的说明**：**本任务书由主对话读取、填入版本号后原文派发给执行子代理**；用户不必、也不要绕过主对话直接投喂（两条入口并存才会产生并发冲突）。自包含，无需 `_COMMON.md`。
> 出错即停：任何一步失败或前置不满足，**立即停下回报**，绝不允许跳步、重试超过 1 次、或"先做完再说"。
> ⚠️ 子代理**不得重启 dsh web**；发布后宿主半边的生效由用户自己重启。

---

你是 dsh-auto-memory 的发版执行子代理。工作目录：`D:\dsh-auto-memory`（开发树，即唯一工作树；发布基座在 `D:\dsh_debug\_publish_dsh-auto-memory`，下称 REL）。**本次要发布的版本号：`<ver>`（由主对话填入，形如 2.5.0）。**

## 硬性禁令（违反任何一条=任务失败）

1. **版本标识闸门未过 → 不得真构建；dry-run 未过 → 不得真构建；未真构建 → 不得提交 REL / push / publish。** 单向门按顺序开。
2. **只允许改动**：`CHANGELOG.md`、`lib/client.js`（仅版本标识三处：CHANGELOG 字典、指纹行）、`package.json`（由 release.mjs 回写）。**其余任何文件出现改动立即停止回报。**
3. **凭据纪律**：PAT 与 npm token 只从 `~/.dsh/memory/workspaces/--D--dsh_debug--/MEMORY.md` 里读，只拼进行内 URL/命令行；**严禁写进任何文件、日志、回报**（回报里凭据一律以 `<redacted>` 代替）。该记忆文件明确「只存本地，严禁写入任何会上传 GitHub/npm 的文件」。
4. **不得 push 除非 PAT 读取成功**；**不得 `npm publish` 除非 push 成功且 tag 已打**。
5. 全程**不得重启 dsh web**、不得动 `~/.dsh` 下运行中宿主的任何文件、不得并发跑第二个写盘任务。

## 阶段 0 · 前置门（任一不满足 → 停，回报 `failed_step: 0`）

```powershell
cd D:\dsh-auto-memory
Get-ChildItem tests\smoke -File -Filter *.mjs | ForEach-Object { node $_.FullName > $null 2>&1; if ($LASTEXITCODE -ne 0) { "FAIL: " + $_.Name } }
node --check lib\index.js; node --check lib\client.js
git status --short
git log --oneline -3
```

- 全量回归 **0 失败**（批量连跑受负载影响的个别套件允许**单跑复验一次**，以单跑为准）。
- **脏树范围核实**：`release.mjs` 只复制 `lib/ tests/ python/ docs/ .github/` 与顶层白名单文件，仓库根下与发版无关的**未跟踪**杂项（`artifacts/`、`canvas-local/` 等）不进包，**记录即可继续**。必须停下回报的是：①任何**已跟踪**文件出现主对话告知的预期清单之外的改动 ②`lib/ tests/ docs/ .github/` 内出现预期外的新文件 ③删除型改动。
- **凭据读取**在阶段 6/7 才需要；读取失败就到那时再停，阶段 0-5 不需要碰凭据。

## 阶段 1 · CHANGELOG（第 1 笔）

- `CHANGELOG.md` 顶部新增 `## [<ver>] — <日期> · <一句话主题>` 小节。内容要点由主对话提供；主对话没给 → 停，回报缺输入。
- 闸门会校验文件里出现 `## [<ver>]`，缺失即拒绝构建。

## 阶段 2 · 软件内版本标识（第 2 笔，`lib/client.js`）

- `var CHANGELOG = { ... }` 顶部新增 `'<ver>': { zh: [...], en: [...] }`（应用内"更新说明"弹窗，文案取自 CHANGELOG 小节）。
- 第 10 行指纹行改为 `console.log('[dsh-auto-memory] client v<ver> fingerprint: ...')`（fingerprint 短语沿用当版，可顺手换新词）。
- `package.json.version` 不手改（release.mjs 构建时回写）。

```powershell
node --check lib\client.js
git add lib tests docs CHANGELOG.md tools\release.mjs
git -c user.name="Aik358" -c user.email="aik358@users.noreply.github.com" commit -m "v<ver>: <一句话>"
```

（`git status --short` 核对已暂存清单与主对话给的预期一致后才 commit；仓库根的无关未跟踪杂项**不要** `git add -A` 进来。）

## 阶段 3 · dry-run 验闸门

```powershell
node tools\release.mjs <ver> --dry-run
```

必须看到：`版本标识一致性: OK(CHANGELOG / 应用内更新说明 / 界面指纹行)` + `语法 ✓ BOM ✓ 无 pre/dev 残留 ✓` + `python/ 运行时完整 ✓ bench 已排除 ✓`。否则**停**，回报 `failed_step: 5.05` + 闸门原文（error_tail）。

## 阶段 4 · 真构建

```powershell
node tools\release.mjs <ver>
```

复核输出含 `开发树版本回写: … → <ver>`。构建会写 REL 树。**构建后开发树的 `package.json` 已被回写为新版本 → 立即补一笔提交**（v2.5.0 教训：不补会留下脏文件，污染下一次发版的脏树闸门）：

```powershell
cd D:\dsh-auto-memory
git add package.json
git -c user.name="Aik358" -c user.email="aik358@users.noreply.github.com" commit -m "v<ver>: 回写开发树版本号(release.mjs 构建后回写)"
```

## 阶段 5 · REL 提交 + tag

```powershell
cd D:\dsh_debug\_publish_dsh-auto-memory
git add -A -- . ':(exclude).github/cloud/qq-webhook/index.zip'
git -c user.name="Aik358" -c user.email="aik358@users.noreply.github.com" commit -m "v<ver>: <一句话>"
git tag -f v<ver>
```

（index.zip 是 SCF 部署产物，不入库——这是群日报会话定下的先例；REL 树里若再出现其他构建产物同样排除。）

## 阶段 6 · push（带 PAT 行内 URL）

从凭据记忆文件读 PAT 后（读取失败 → 停，`failed_step: 8`）：

```powershell
git -c credential.helper= push https://x-access-token:<PAT>@github.com/Aik358/dsh-auto-memory.git main --tags --force
```

## 阶段 7 · npm publish（单向门，最后一步）

npm token 同样从凭据记忆文件读（需 bypass-2FA 的那个）：

```powershell
npm publish . --registry=https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=<token> --access public
```

**坑**：本机 `~/.npmrc` 指向 npmmirror；`npm view` 会命中本地缓存回读旧版本。判定一律用权威接口：

```powershell
Invoke-RestMethod 'https://registry.npmjs.org/@a9i5k4%2Fdsh-auto-memory/latest' | Select-Object -ExpandProperty version
```

## 阶段 8 · 三处复核（缺一不算发完）

1. registry `/latest` 的 version = `<ver>`（用上面的权威接口）
2. `git ls-remote https://github.com/Aik358/dsh-auto-memory.git refs/heads/main`
3. `git ls-remote https://github.com/Aik358/dsh-auto-memory.git refs/tags/v<ver>`

三者一致才算 ok。

## 回报格式（原样 JSON，不追加散文）

```json
{ "ok": true, "version": "<ver>", "pre_sha": "<开发树 commit 短 sha>", "rel_sha": "<REL commit 短 sha>", "tag": "v<ver>", "npm_latest": "<ver>", "failed_step": "", "error_tail": "" }
```

失败时：`ok:false`，`failed_step` 填阶段号（0/1/2/3/4/5/6/7/8；dry-run 闸门不过记 3），`error_tail` 贴**最后 ≤20 行**原始报错（凭据替换为 `<redacted>`）。已知会出现且**不算失败**的情况：无。任何意外都按失败回报，由主对话决定处置。

---

*回滚提示（供主对话，子代理不执行）：未 push/publish 前一切可回滚（开发树 `git reset`、REL 线 `git reset` + `git tag -d`）；publish 后不可撤，只能发 patch。*
