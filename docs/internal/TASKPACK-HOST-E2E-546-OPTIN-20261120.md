# 任务书 · #546 迁移 opt-in 真实宿主端到端验收（只读）· 2026-11-20

性质：**只读验收**。目标是证明「勾选框 → 请求体 → 后端 fail-closed/放行」这条链在**真实宿主、真实浏览器、真实 HTTP 路由**上成立；**不得真正执行导入**。

## 0. 前置：控制基线（Lead 已实测，可直接复用）

夹具：`artifacts/_lead-integ/probe-pr546-tmp/legacy.dam-pack`（356 B，`format=dam-pack-v1`，含 `userFiles: {CALENDAR.md}`，checksum 只覆盖 `files` 不覆盖 `userFiles`）。

脚本已验（`node artifacts/_lead-integ/probe-pr546-tmp/probe-validate.mjs`）：

```
noOptIn  → { ok:false, errors:['userfiles-unproven-by-checksum'] }
withOptIn→ { ok:true,  warnings:['userfiles-unproven-by-checksum-accepted:1'] }
```

⇒ 端到端必须复现同一条分界：**不勾选 = 预览 4xx/错误；勾选 = 预览返回 plan**。

## 1. 环境（复用 P3-B 隔离宿主，禁止碰生产 19387）

| 项 | 值 |
|---|---|
| DSH_HOME | `artifacts/_p3b-host-20261118/dsh-home` |
| profile | `p3b`（bundles：dsh-base / dsh-web-app / `link:D:/dsh-auto-memory`） |
| 端口 | **19431**（生产 19387 全程不动） |
| memoryRoot / userMemoryDir | 已为**绝对路径**（指向 `artifacts/_p3b-host-20261118/memory/*`），勿改成 `~/` |
| 启动 | `dsh.cmd --profile p3b --port 19431 --host 127.0.0.1 --no-open`，用 pwsh **背景作业** + `*>&1 \| Tee-Object` |
| 取 token | 日志是 **UTF-16LE** ⇒ `Get-Content -Raw` + `[regex]` 提 `?token=`，写 UTF-8 端点文件；不要用 Node 按 utf8 读日志 |

启动后先做一次健康检查：`GET /api/dsh-auto-memory/...?token=...` 应 200（缺 token 401）。

## 2. 验收步骤（每步都要留证据）

| # | 动作 | 判据 |
|---|---|---|
| E1 | 打开宿主 → 设置/存储页的迁移向导 | 出现 3 个入口面（经典/旧款皮肤/变体十屏）中与当前皮肤对应的那一面的勾选框：`data-dam-migration="legacy-opt-in"` |
| E2 | 不勾选，选夹具包 → 点「预览」 | 网络响应 **不是** `plan`；错误文案含 `userfiles-unproven-by-checksum`（或 UI 明确报「未通过校验」） |
| E3 | 勾选 → 再点预览 | 网络响应含 `plan`（`additions/overwrites` 结构）；**UI 不得自动进入导入** |
| E4 | 取消勾选 → 再点预览 | 回到 E2 的失败态（确认不是一次性放行） |
| E5 | 勾选后**换一个包**（另存一份夹具，路径不同）→ 预览 | 勾选框自动**未勾选**（确认绑定的是「包路径」不是布尔）；再预览回到失败态 |
| E6 | 全程 | **不点「导入/应用」**；结束后 `artifacts/_p3b-host-20261118/memory/` 下文件数/字节与开始时一致（先记基线） |

## 3. 证据（缺一不算过）

1. **端点级**：E2/E3/E4/E5 四次的请求体与响应 JSON 落盘（`{packPath, targetWs, allowUnprovenUserFiles}` + 响应 `ok/errors/warnings/plan`）。
2. **UI 级**：勾选框在 DOM 里真实存在（`document.querySelector('[data-dam-migration="legacy-opt-in"]')` 非 null）+ `checked` 状态随操作变化；三面文案一致（中英）。
3. **截图**：E2 失败态、E3 成功预览态、E5 换包后未勾选态，各 1 张。
4. **未污染**：结束前后 `memory/` 目录清单与总字节对比一致。

## 4. 已知坑（省时间）

- 生产宿主 `127.0.0.1:19387` **不得触碰**；隔离宿主若端口占用，换 19432 并在回执写明。
- profile 必须带 `link:D:/dsh-auto-memory`，否则插件不加载（页面里看不到记忆页签）。
- `dsh-auto-memory.json` 里 `memoryRoot`/`userMemoryDir` 若不是绝对路径，`expandUserPath()` 会按 `os.homedir()` 展开到**真实记忆根** ⇒ 会写用户真数据。开工前先读一遍确认。
- CDP 自动化优先用 `element_token` / `Runtime.evaluate` 读 DOM，不靠坐标点击。
- 若 UI 层发现勾选框不出现（而端点层已正确），**先看 `globalThis.__damMigrationOptIn.required()`** 的返回值：它是能力协商的结果，后端声明不需要确认时会整体不渲染——这是设计行为，不是缺陷。

## 5. 出口判据

E1–E6 全过 + §3 四类证据齐 ⇒ 回执写 `PASS`。任一条不过 ⇒ 写 `FAIL`，附**最小复现**（哪一面、哪一步、请求体/响应原文）与归因（UI 接线 / 路由透传 / 契约层），**不要自行改代码**。

## 6. 明确不做

- 不改 `lib/` / `skins/` / 生成器；
- 不真导入、不点「应用」、不写真实记忆目录；
- 不提交、不推送、不发版。
