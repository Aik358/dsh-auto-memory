# v3.4.0-alpha.1 · 抢先预览版（Preview / Research Build）

> **这不是正式版。** 不上 npm，只发 GitHub。目的是让社区先跑起来做核验与研究。

## 拉下来试

```bash
git clone --depth=1 --branch preview https://github.com/Aik358/dsh-auto-memory.git
cd dsh-auto-memory
node --version    # 需要 Node 20+
node tools/run-smoke.mjs --jobs=8 --timeout=180000
```

预期：535 套件全绿。若一条红，先单独复跑 `node tests/smoke/smoke-test-<name>.mjs`。

## 这一版是什么

v3.3.x 的记忆是**流水账**；v3.4 把它换成了**事件**。这不是加功能，是换地基。

| 层 | 单位 | 是否事件化 |
|---|---|---|
| **长期记忆** | 事件 `evt_xxxxxxxx` | ✅ 是（一件事一个容器，跨天可续） |
| 每日日志 | 日期 | ❌ 否（日记类） |
| 每日反思 | 日期 | ❌ 否（日志的蒸馏产物） |

**日志与反思刻意不事件化** —— 它们的语义单位是「一天」，不是「一件事」。

## 改动规模

相对 v3.3.17 分叉点 `e951d9eb`：**403 个提交**、**917 个新文件**、**45 个新 lib 模块**、**309 个新测试套件**。

## 已知问题（请优先验）

- ⚠️ **团队同步的服务端完全未验证**（本机 `teamEnabled=false`）。
  跑 `node tools/probe-team-baseline.mjs --url <你的服务端> --token <token>`，
  零副作用，会给出 `A_OK` / `A_NEEDS_SPLIT` / `A_BLOCKED_BY_SERVER`。
- **B3 升级驱动器的 `upgradeLocal` / `verify` 故意 fail-closed** —— 明确失败而非假装成功。
- **`artifacts/` 被追踪约 1.16 GB** —— 务必浅克隆。

## 怎么反馈

| Label | 管什么 |
|---|---|
| `preview function` | 功能正确性（该生效却没生效） |
| `preview bug report` | 代码运行正确性（异常/竞态/断言/边界） |

也可以 QQ 群直接 @ 作者。

## 完整排查指南

- [docs/PREVIEW-3.4.md](https://github.com/Aik358/dsh-auto-memory/blob/preview/docs/PREVIEW-3.4.md)
- [技术报告页（HTML）](https://github.com/Aik358/dsh-auto-memory/blob/preview/docs/landing/news/2026-10-31-preview-3-4-alpha1.html)

---
**作者自评的高风险区**：`lib/index.js`（单文件 1.37 MB，+25,336/−21,232）、事件与日志的边界判断、白板渲染回写环、同步 kind 白名单、前端样式变量。
