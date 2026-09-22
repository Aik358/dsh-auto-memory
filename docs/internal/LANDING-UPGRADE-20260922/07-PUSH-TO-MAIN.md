# 07 · PUSH — 把改好的落地页推送到 `origin/main`

- **Status**: TODO
- **Severity**: HIGH（做错会污染活宿主树）
- **依赖**: `01`–`05` 改完并通过 `06-VERIFY.md` 后执行

---

## 0. 三条硬约束（先读，违反任何一条都可能毁掉现场）

### ① 本仓库**绝不能切分支**、**绝不能 `git checkout`**

`D:\dsh-auto-memory` 是 **`link:` 挂载的活宿主代码树**——DSH 宿主正在跑的就是它。切分支/检出会让宿主读到另一份 `lib/`，导致正在运行的会话崩溃。

⇒ 本文件的所有操作都在**独立 worktree** 里做，主树一个字节都不动。

### ② 本地 `main` 与 `origin/main` **已分叉**，直接 push 会被拒

实测（执行前请自己复核，见 §1）：

```
git rev-list --left-right --count origin/main...HEAD
→ 72    144
```

含义：`origin/main` 有 **72** 个提交不在本地，本地有 **144** 个提交不在远端。**不是快进关系** ⇒ `git push origin main` 会被 `non-fast-forward` 拒绝。**不要用 `--force`**（会毁掉远端那 72 个提交，含 release 线）。

### ③ 好消息：本次要改的文件**基座完全一致**，所以无需合并

实测：

| 对象 | 本地工作树 | `origin/main` |
|---|---|---|
| `docs/landing/index.html` blob | `ec660427…` | **`ec660427…`（相同）** |
| 10 张 promo 图（含 `banner-v4` / `1b-auto-recall`） | — | **全部存在且 blob 逐一相同** |

⇒ 在 `origin/main` 之上**只提交这一个文件**即可，零冲突、零合并、零 force。

---

## 1. 执行前复核（只读，必做）

```powershell
cd D:\dsh-auto-memory

# 1a. 远端真值 —— 以 ls-remote 为准，不以本地 tracking ref 为准
git ls-remote origin refs/heads/main

# 1b. 确认分叉（应为 非零 对 非零）
git rev-list --left-right --count origin/main...HEAD

# 1c. 确认基座一致（两侧必须打印同一个 hash）
git rev-parse origin/main:docs/landing/index.html
git hash-object docs/landing/index.html      # 注意：工作树是 CRLF，见 §2 注意事项

# 1d. 本次要提交的内容确实已改好
git status --porcelain docs/landing/
```

**若 1c 两侧 hash 不一致 ⇒ 停下来报告**（说明远端 landing 已被别人改过，需先人工比对）。

---

## 2. 推送流程（worktree 方案）

### 2a. 建一个只挂 `origin/main` 的 worktree

```powershell
cd D:\dsh-auto-memory
git fetch origin --quiet
git worktree add --detach D:\_landing_pub origin/main
```

- `--detach`：**不要**建本地分支，避免留下垃圾分支。
- 目标路径 `D:\_landing_pub` 实测不存在（可用）。D: 剩余 59.5 GB，空间充足。

### 2b. 把改好的落地页复制进去

**只复制这一个文件**——promo 图在远端已存在且一致，不需要动。

```powershell
Copy-Item D:\dsh-auto-memory\docs\landing\index.html `
          D:\_landing_pub\docs\landing\index.html -Force
```

**换行符注意事项**：本仓库 `core.autocrlf=true` 且**无 `.gitattributes`**，工作树是 CRLF（实测 1,745 个 CRLF / 0 个 LF），而 blob 是 LF（123,315 B vs 工作树 125,060 B）。这是**正常且预期的**——git 提交时自动归一化。**不要**手动转换行尾。

### 2c. 提交（只提交这一个文件）

```powershell
cd D:\_landing_pub
git add -- docs/landing/index.html
git commit -m "landing: 深度档升级（动效体系 + 平台层 + 内容真值）"
```

**提交前必须确认暂存区只有这一个文件**：

```powershell
git diff --cached --name-only
# 期望输出：docs/landing/index.html   （有且仅有一行）
```

若出现其它文件 ⇒ `git reset` 后重做，**不要提交**。

### 2d. 推送

```powershell
git push origin HEAD:main
```

- `HEAD:main` 语义 = 把当前（detached）提交推到远端 `main`。
- 因为是**直接在 `origin/main` 之上**的提交，这是**快进推送**，不需要也不允许 `--force`。
- 凭据走已有的 `credential.helper=manager`，无需手工输入 token（本仓库已配置）。

### 2e. 清理 worktree

```powershell
cd D:\dsh-auto-memory
git worktree remove D:\_landing_pub --force
git worktree list        # 期望只剩 D:/dsh-auto-memory 一条
```

---

## 3. 回滚

**推送前**（最常用）：什么都不用做——主树从未被改动，直接 `git worktree remove` 丢弃即可。

**推送后**：

```powershell
git ls-remote origin refs/heads/main          # 取回 新HEAD 与 旧HEAD
# 用 GitHub API 或本地 revert 一个新提交（不要 force push）
```

> **绝不用 `git push --force origin`** 回滚 —— 会抹掉远端 72 个提交。

---

## 4. 推送后验证（必做，三处）

```powershell
cd D:\dsh-auto-memory
git fetch origin --quiet

# ① 远端 blob 已变（应与本地提交一致）
git rev-parse origin/main:docs/landing/index.html

# ② 远端内容确实含新标记（抽三条：动效 token / 七幕 / 版本号）
git show origin/main:docs/landing/index.html | Select-String -Pattern '--duration-quick|promo-7|v3\.1\.4' | Measure-Object
#   期望 3 条都能命中

# ③ 远端不再含旧标记
git show origin/main:docs/landing/index.html | Select-String -Pattern 'promo-0-banner-v2|object-fit:cover'
#   期望 0 命中
```

**最后用浏览器实测线上页面**（这是唯一能证明「用户真的看到新页面」的判据）：

```
https://htmlpreview.github.io/?https://github.com/Aik358/dsh-auto-memory/blob/main/docs/landing/index.html
```

> ⚠️ **URL 变了**：从 `blob/preview/` 改为 **`blob/main/`**。`preview` 分支已弃用，不再更新。

---

## 5. 备用方案：GitHub Contents API

若 worktree 方案因权限/锁失败，可改走 API（单文件提交，同样不动本地分支）：

1. `GET /repos/Aik358/dsh-auto-memory/contents/docs/landing/index.html?ref=main` 取当前 `sha`
2. `PUT` 同路径，body 带 `message` / `content`(base64) / `sha` / `branch: "main"`

token 从 `~/.dsh/memory/workspaces/--D--dsh_debug--/MEMORY.md` 第 6 行取（GitHub PAT）。
**token 只走命令行内联，不落盘、不回显、不进任何文件。**

---

## 6. 完成后向用户报告

1. 远端 `origin/main` 新 HEAD（短 hash）
2. 三处验证（§4 的 ①②③）逐条结果
3. **线上 URL 实测截图或确认**（用新地址 `blob/main/`）
4. worktree 已清理（`git worktree list` 只剩一条）
5. 明确声明：**主树未被改动 / 未切分支 / 未使用 force**
