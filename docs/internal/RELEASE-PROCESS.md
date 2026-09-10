# 发版固定流程（dsh-auto-memory）

> 2026-09-10 固化。本文件是发版的唯一检查表；`tools/release.mjs` 已内置**版本标识一致性闸门**（缺任一项即拒绝构建），所以下面第 2、3 步不是"记得做"，而是"不做就发不出去"。

## 0. 前置门（不满足不许开工）

- [ ] 全量回归：`cd D:\dsh-auto-memory; Get-ChildItem tests\smoke -File -Filter *.mjs | ForEach-Object { node $_.FullName }` → **0 失败**
- [ ] `node --check lib/index.js` 与 `lib/client.js` 通过；改动文件无 BOM
- [ ] **脏树范围核实**：`git status --short` 里只有本次要发布的文件（`release.mjs` 的源就是工作区，脏树会整体进包且不可回溯）

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

## 4. pre 线提交

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

## 纪律

- **凭据只走行内 URL / 环境变量，严禁写进任何会上传 GitHub 或 npm 的文件**（本文件亦不写）。
- 本机 `~/.npmrc` 指向 npmmirror → 查询与发布都必须显式 `--registry=https://registry.npmjs.org`，否则会查到旧版本、误判发布失败。
- 发布后实机生效：宿主 `lib/index.js` 需重启；界面半边刷新页面即可。`update-check` 有落盘缓存（`~/.dsh/memory/update-check-pre.json`），需要时用「检查更新」强制刷新。
