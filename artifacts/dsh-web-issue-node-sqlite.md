## 摘要

CI（GitHub Actions，Node 22）上 `pnpm test` 失败：`packages/dsh-session-archive` 的 vitest 测试无法打包 Node 内置模块 `node:sqlite`，报 "Cannot bundle Node.js built-in 'node:sqlite'"。该失败同时存在于 `dev` 分支自身的 CI（最近两次 push `c3f097b`、`c681332b` 均 failure），阻塞所有 PR 合并。

## 预期结果

CI 的 `Tests` 步骤（`pnpm test`）应全部通过，或在 Node 22 环境下对该包测试做正确降级 / 跳过，而不是让整个 CI 变红。

## 详情 / 复现步骤

1. 在 GitHub Actions 触发任意 PR 到 `dev` 分支（或直接 push `dev`）。
2. CI 运行 `.github/workflows/ci.yml` 的 `Tests` 步骤（`pnpm test`）。
3. `packages/dsh-session-archive` 的 vitest 报错：
   ```
   Cannot bundle Node.js built-in 'node:sqlite' imported from 'tests/inventory.spec.ts'
   (and from src/host/session-files.ts). Consider disabling environments.client.noExternal
   or remove the built-in dependency.
   ```
4. 整个 `Tests` 步骤标红，PR 无法通过合并门禁。

本地复现：本机 Node 24.18.0 下 `cd packages/dsh-session-archive && pnpm test` **8/8 通过**（`node:sqlite` 可用）；CI Node 22 下失败。差异来自 Node 版本对 `node:sqlite`（Node 22.5+ 实验模块）的支持。

## 环境信息

- DSH 版本：不适用（这是 dsh-web 仓库自身的 CI，与 DSH 运行时无关）
- 浏览器：不适用
- 插件名称 / 版本：`packages/dsh-session-archive`（dsh-web monorepo 包）
- 操作系统：CI = ubuntu-latest；本地对照 = Windows 10 / Node 24.18.0
- 触发方式：`pnpm test`（CI `Tests` 步骤，`actions/setup-node@v5` + `node-version: 22`）

## Bug 截图

无 UI 截图——这是 CI 环境问题，不是界面 bug。CI 失败证据：
- 上游 `dev` 分支自身 CI 失败记录：
  - https://github.com/zhu1090093659/dsh-web/actions/runs（`dev` 分支，c3f097b / c681332b 两次 push 的 CI 均为 failure）
- 本地 Node 24 对照：`packages/dsh-session-archive` 测试 8/8 通过

## 冒烟测试

- 环境（DSH / 插件版本）：本机 Node v24.18.0，dsh-web `dev` 分支最新代码
- 执行步骤与观察结果：
  1. `cd packages/dsh-session-archive && pnpm test` → **Test Files 8 passed (8)**
  2. `pnpm test` 全仓 → 唯一失败为该包 `node:sqlite` 打包错误（其余包通过）
- 对照 / 历史版本差异：CI 用 Node 22，本地用 Node 24；`node:sqlite` 在 Node 22.5+ 为实验模块，`DatabaseSync` 需实验标志或 Node 23+，导致 Vite 在 jsdom 环境下打包失败

## 引用代码

- `packages/dsh-session-archive/src/host/session-files.ts:9` — 顶层静态导入 `import { DatabaseSync } from 'node:sqlite'`
  https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-session-archive/src/host/session-files.ts#L9
- `packages/dsh-session-archive/tests/inventory.spec.ts:5` — 同样静态导入 `node:sqlite`
  https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-session-archive/tests/inventory.spec.ts#L5
- `packages/dsh-session-archive/vitest.config.ts` — `environment: 'jsdom'`（jsdom 环境触发 Vite 尝试打包 Node 内置模块）
  https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-session-archive/vitest.config.ts
- `.github/workflows/ci.yml:37` — `node-version: 22`

建议修复（任选其一）：
1. 该包 vitest 配置改 `environment: 'node'`（最小改动，Node 环境不打包内置模块）
2. `node:sqlite` 顶层静态导入改为惰性 `require` / 动态 `import`，仅 Node 路径执行
3. CI `node-version` 升到 24（需确认其他包兼容）

## 补充信息

这是全仓 CI 故障而非某个 PR 引入：`dev` 分支自身最近两次 push 的 CI 都是 failure，任何社区插件 / 皮肤 / 宠物索引 PR 到 `dev` 都会被这个红阻塞。建议优先修复以恢复 PR 合并能力。
