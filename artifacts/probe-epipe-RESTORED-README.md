# probe-epipe-selfignite.mjs 重建说明（2026-10-24）

## 一、原件是什么

一个 **EPIPE 自激探针**：验证「`uncaughtException` 处理器内部的写路径」在**进程 stdio 断管**时，
会不会把异常写回自己、形成忙等死循环（既不退出、又满核空转）。

它是 2026-09-14 一次真实事故的取证装置。那次事故的现象：
`tests/smoke/smoke-test-consolidate-isolation.mjs`（仅 77 行）跑出**挂钟 29 分钟、累计 CPU 18 分钟**的进程。

四个形态（对应 FINDINGS 矩阵）：

| mode | 处理器内写路径 | 预期 |
|---|---|---|
| `old` | `console.error(...)` | **免疫**（Node 的 `kWriteToConsole` 内部临时挂 `noop 'error'` 监听，断管失败被吞） |
| `old-stream` | 裸 `process.stderr.write(...)` | **自激**（失败以异步 `'error'` 抛出、无人监听 ⇒ 再入 `uncaughtException` ⇒ …） |
| `new` | 修复形态：`writableEnded` 检查 + `try/catch` + 吞错 | 免疫 |
| `new-noswallow` | 修复形态去掉 `damSwallowStreamErrors` | 自激（负路径） |

配套装置：`probe-epipe-runner.ps1`（真实 cmd.exe 管道 + 精确 PID 采样）、`--sink`（管道读端「立刻退出」发生器）。

## 二、误删与重建

- 原件 **2026-10-24 12:5x 被误删**（清理一次性 probe 脚本时一并删掉，未先核对是否被文档引用）。
- 同批误删 26 个 `artifacts/probe-*.mjs`。**均从未进 git**（`git log --all -- artifacts/probe-epipe-selfignite.mjs` 为空），
  回收站与全盘搜索均未找回。
- **未受影响**：`probe-epipe-FINDINGS.md`（原始实测矩阵）、`probe-epipe-runner.ps1`（跑测装置）、
  `probe-epipe-runs/`（812 KB 原始 metrics / trace / verdict）。⇒ **结论仍可审计**。

## 三、重建版是什么、能不能复现

依据存活证据逐字段重建：

| 重建依据 | 恢复了什么 |
|---|---|
| `probe-epipe-runner.ps1:50` | 调用契约：位置参数 mode、`--boom-delay`、`--verdict-delay`、`--keep-streams`、`--breaker`、`--sink` |
| `probe-epipe-trace-*.jsonl` | 内部事件序列与字段：`start` / `streams-broken` / `handler-installed` / `boom-thrown` / `verdict-written` / `exit` |
| `probe-epipe-runs/*.metrics.json` | verdict 文件形状：`{mode, reachedAfterBoom, cpuMs, wallMs}` |
| `probe-epipe-FINDINGS.md` | 四形态判据与矩阵 |

**用存活的 runner 跑重建版，四形态与原始矩阵同构**（2026-10-24 实测）：

| mode | 重建版 | 原始 FINDINGS |
|---|---|---|
| old | exit 0 (own) / 2.21s / 6.4% CPU | exit 0 (own) / 2.32s / 3.4% |
| old-stream | **killed @10.71s / 83.9%** | **killed @10.43s / 90.0%** |
| new | exit 0 (own) / 2.22s / 4.9% | exit 0 (own) / 1.90s / 4.1% |
| new-noswallow | **killed @11.92s / 53.0%** | **killed @10.42s / 90.7%** |

⇒ **判据层面等价**（免疫形态自己退；自激形态被 runner 超时杀掉 + 高 CPU 空转）。
CPU 百分比有差异（采样粒度 + 保活定时器实现不同），**不作为等价值**。

**过程中踩到并修正的一个坑**（记录以防下次重犯）：
重建首版让所有 mode 都在写完 verdict 后 `exit(0)` ⇒ 自激形态只跑到 22.8% CPU，把真实差异掩盖掉了。
原件行为是「免疫形态自己退、自激形态继续转等 runner 杀」；改成按 `entries <= 1` 判定后才复现出 83.9% / 53.0%。
⇒ **判据必须写在探针里，不能靠外部观察**，否则重建版会谎报「都正常」。

## 四、与原件可能不同的地方（诚实标注）

1. **探针不造断管**：真正断管由 runner 的真实 cmd.exe 管道提供（与原件同）。`streams-broken` 事件只记录 `destroy()` 是 no-op 的实测结果。
2. **CPU 占用率偏低**：保活只用了一个 `setInterval`，原件可能还有别的忙等源（未确证）。
3. **`--breaker` 只实现 `none` / `both` 两档**（用于验证「能否自己停下来」）。

## 五、误删清单（26 项）

probe-bad-mtimes / probe-catalog-read / probe-deep-observer / probe-deep-reader / probe-dsh-cost / probe-dsh-cost2 /
probe-epipe-selfignite / probe-head-structure / probe-injection-anatomy / probe-injection-anatomy2 / probe-injection-anatomy3 /
probe-injection-final / probe-injection-final2 / probe-last-two / probe-last-two-b / probe-last-two-c / probe-last-two-d /
probe-preset-plane-shift / probe-salvage-51 / probe-seg-marginal / probe-seqrefs / probe-slim / probe-source-fields /
probe-sources / probe-tail-vs-head / probe-water-hard-guard-regex

其中**被存活文档按名引用**的只有 `probe-epipe-selfignite`（`docs/internal/ARCH-REVIEW-BRIEF.md:307`、
`artifacts/probe-epipe-FINDINGS.md` 第 3/74 行），已重建；其余 25 个无文档引用，均为一次性勘察脚本。

## 六、为什么这批文件不在 git / GitHub 里（不是失误，是默认约定）

- `.gitignore` **没有**整体忽略 `artifacts/`，但有 `artifacts/_*` 等十几条细分规则。
- `artifacts/` 实况：**29,805 个文件，只有 443 个 tracked（1.5%）**；983 个 untracked、1,021 个 ignored。
- 它是**工作区临时产物目录**：实验脚本、截图、备份、一次性勘察产物都在这里。按设计**默认不提交**。
- `package.json` 的 `files` 白名单 = `lib / python / locale / skins / icon.svg / cordis.patch.yml` ⇒ `artifacts/` **进不了 npm 包**。
- `tools/release.mjs` 也**不拷贝** `artifacts/`。
- `probe-epipe-selfignite.mjs` 在全部分支历史里**从未出现过**（`git log --all` 空）。

⇒ 「没上传 GitHub」是这套目录约定的正常结果。**真正的失误**是：把这个默认不追踪的目录当成可以随意清理，
而没有先做两步核验（核对文档引用 + 查是否 Tracked）。

## 七、下次清理 artifacts/ 的两步核验（已写进用户级记忆）

```bash
# ① 核对是否被存活文档按名引用
grep -rl "<文件名>" docs tools tests lib artifacts
# ② 确认是否 Tracked
git cat-file -e HEAD:<path> && echo TRACKED || echo untracked
```

两步都通过（无引用 + untracked）才可删；有引用就改成「保留 + 在文档里标注已废弃」。
