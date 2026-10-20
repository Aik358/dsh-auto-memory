# 部署说明：本补丁装到 DSH profile 的方式

> 本文件记录**部署面**的注意事项，与代码本身无关。
> 记录于 2026-10-20，由 TTA 侧交叉复核发现并纠正。

---

## 一、装在哪

```
profile:  C:\Users\ZHAN_ZC\.dsh\profiles\desktop
包路径:    node_modules/@a9i5k4/dsh-auto-memory
补丁登记:  该 profile 的 pnpm-workspace.yaml `patchedDependencies`（注意：不在 package.json）
补丁文件:  profile/patches/@a9i5k4__dsh-auto-memory@3.3.9.patch
```

**踩坑（2026-10-19 实证）**：只删 `patches/*.patch` 不够 —— `patchedDependencies` 登记在
`pnpm-workspace.yaml`，pnpm 会报 `Failed to read patch file ... (os error 3)` 并拒绝安装。
必须同时清：① workspace.yaml 的 `patchedDependencies` 段 ② lock 的 `patchedDependencies` 块
与 `(patch_hash=…)` ③ `node_modules/.modules.yaml` 对应条目。

## 二、★补丁文件必须存成纯 LF

**这是 TTA 在 2026-10-20 交叉复核时发现的部署隐患。**

事实：pnpm 记录的 `patch_hash` 是按 **LF 规范化后**的文本算 sha256 的；
若 patch 文件本身混有 CRLF（本例 13 行 CRLF），则**原始字节 sha256 ≠ lock 记录值**。

实测数据：

```
修复前: CRLF=13  raw_sha256 = 77a33d40…   lock 记录 = c798627b…   ← 不一致
修复后: CRLF=0   raw_sha256 = c798627b…   lock 记录 = c798627b…   ← 一致
```

**风险**：当前这台 pnpm 做规范化，所以能装上；但换机器或升级 pnpm 后若改按原始字节校验，
patch 会被判「不匹配」而**静默回退到未修复版本** —— 表现为「文件明明 patch 过却行为像没修」，
极难排查（与「守卫对源码树绿但对运行时红」是同一族陷阱）。

**做法**：patch-commit 前把 patch 文件转纯 LF；或每次 commit 后检查：

```powershell
$t = [System.IO.File]::ReadAllText($patch)
($t -match "`r`n")   # 必须为 False
```

**验证 LF 补丁可干净复现**（在没有打过补丁的原版上试，不能对已装产物试 ——
`pnpm patch` 的工作目录是从**已装产物**复制的，天然已含补丁，对它 apply 必失败）：

```powershell
# 用 pristine 的 v3.3.9（未打补丁）验
$tmp = "$env:TEMP\lf-patch-test"; mkdir "$tmp\lib"
copy G:\AMup\eval\wt339\lib\*.js "$tmp\lib\"
cd $tmp; git apply --check <patch>      # 期望 exit=0
git apply <patch>
# 再与 G:\AMup\upstream-work\v339\lib 逐文件比对，期望差异 0 行
```

## 三、装完必须验「运行时」，不能只验源码树

```powershell
node G:\AMup\upstream-work\repro\verify-tta-defects.mjs        "$inst\lib\index.js"
node G:\AMup\upstream-work\repro\verify-tier0-not-squeezed.mjs "$inst\lib\index.js"
node G:\AMup\upstream-work\repro\verify-legacy-archive.mjs     "$inst\lib\index.js"
node G:\AMup\upstream-work\repro\verify-archive-index.mjs      "$inst\lib\index.js"
node G:\AMup\upstream-work\repro\verify-real-e2e.mjs
```

（守卫脚本第 2 参数现在可以传**目录**，会自动拼 index.js。）

**为什么必须验运行时**：2026-10-20 发生过「源码树已修、runtime 仍是旧代码」——
已装 `rules-layer.js` 还是 18935 字节、mtime 停在 2026-09-27。
守卫对源码树全绿，对真实行为毫无约束力。

## 四、桌面端必须重启

插件代码在**进程启动时**加载。`lib` 更新后若不重启，进程内仍是旧代码：

```powershell
# 判断是否已加载新代码
$proc = Get-Process 'DeepSeek Harness' | Sort-Object StartTime | Select-Object -First 1
$proc.StartTime            # 必须晚于 lib 文件的 LastWriteTime
```

## 五、pnpm patch 的两个坑

1. **工作目录来源**：`pnpm patch <pkg>` 从**已装产物**复制工作目录。若已装产物含旧补丁，
   新工作目录也含旧补丁 ⇒ 对它 apply 新 diff 会失败。正确做法是**直接覆盖**目标文件，
   或先 `pnpm patch-commit` 清掉再重来。
2. **覆盖要覆盖整个 lib**：本补丁涉及 `index.js` / `rules-layer.js` / `tier0-catalog.js`
   三个文件，只覆盖 `index.js` 会漏掉后两个（2026-10-20 实际踩到）。
---

## 六、2026-10-20：升级到 3.3.11 + TTA 发现的两条 apply 陷阱

### 现状（已部署并验证）

```
profile 版本:      3.3.11
补丁文件:          patches/@a9i5k4__dsh-auto-memory@3.3.11.patch
基线声明:          patch 头部含三个文件 sha256(LF) + 上游 tag
patch 登记:        pnpm-workspace.yaml `patchedDependencies`（已含 3.3.11 条目）
运行时三文件与补丁树差异: 0 行
五条守卫（对已装 lib）: tta 12/0 · tier0 12/0 · legacy 14/0 · 锚点 23/0 · real-e2e 36/0
```

### ★陷阱 A：「碰巧能 apply」比「打不上」更危险

按 **3.3.9** 基线切的 patch，**居然能静默 apply 到 3.3.11**（`exit=0`）——
因为 3.3.11 新增的 `waterLevelProxyCompat` 整段没撞上本补丁的上下文。

后果：若基线不对，patch 会静默打进去而不报冲突，你看到「打上了」但内容可能是错的。

**对策（两件一起做）**：
1. patch 文件头写基线声明（三个文件 `sha256(LF)` + 上游 tag）；
2. 用 `tools/apply-patch-safely.mjs`：先校验基线，不匹配就拒绝；再在仓库外 apply；最后核对内容真的变了。

```powershell
node tools/apply-patch-safely.mjs <patch> <pkgDir> --dry-run   # 先验
node tools/apply-patch-safely.mjs <patch> <pkgDir>             # 真应用
```

负控已验证：拿 3.3.11 的 patch 去打 3.3.9 → `✗ index.js 基线不匹配 got=f54998de…` → **拒绝，exit=1**。

### ★陷阱 B：`git apply` 在仓库子目录里可能静默成功

TTA 报告：在 git 仓库**内部**的子目录里跑 `git apply`，`exit=0`、stderr 空，但**目标文件一个字节没改**
（路径被解析成「仓库根/当前目录偏移/lib/index.js」，不存在就没做，却返回成功）。

本机复测结果不同（我这边两个位置都是 `exit=128` 显式失败），说明这是**环境相关**，不是普遍行为。
但这恰恰更要防——**你无法靠 exit code 判断是否真的改了**。

**纪律**：
- 在仓库**外**的纯目录 apply，或 `--directory=<绝对路径>`；
- **apply 后必须核对文件内容/哈希，不能只看 exit code**（`apply-patch-safely.mjs` 已内置这道校验：
  若所有文件哈希都没变，直接判为静默失败并退出 1）。

### 升级到 3.3.11 的正确顺序（本次实走通）

`pnpm patch` 的工作目录是从**已装产物**复制的 —— 如果产物已经被打过补丁，
工作目录也是打过的，`patch-commit` 会报 `No changes were found`。正确顺序：

```
① 备份已打补丁的三文件
② 把产物**还原**成 3.3.11 基线（git archive a032e15 解出后覆盖）
③ pnpm patch '@a9i5k4/dsh-auto-memory@3.3.11'   # 此时工作目录 = 干净基线
④ 把备份的打补丁版覆盖进工作目录
⑤ pnpm patch-commit <工作目录>
⑥ 把 patch 文件重新加回基线声明头（pnpm 生成时会覆盖掉）
```

### 升级前置：必须先清旧 patch 登记

直接 `pnpm add` 新版本会因「旧 patch 文件找不到」而失败。顺序：
清 `pnpm-workspace.yaml` 的 `patchedDependencies` → 清 lock 的同名段与 `(patch_hash=…)` → 删旧 patch 文件 → `pnpm add`。
