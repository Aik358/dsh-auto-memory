# 真实宿主 E2E 回执 · #546 migration opt-in（2026-11-20）

## 结论

**E1–E6 PASS。** 未执行导入/应用。E2、E4、E5 都由真实 UI 发出 `allowUnprovenUserFiles:false`，后端返回 `ok:false` 与 `userfiles-unproven-by-checksum`；E3 勾选后同一包路径随请求发送 `true`，真实 HTTP 路由返回 plan。E5 更换到字节完全相同但路径不同的副本后，勾选自动清空，预览重新 fail closed。`migrate-import` 请求数为 **0**。

## 环境与控制基线

- DSH_HOME：`artifacts/_p3b-host-20261118/dsh-home`；profile `p3b` 的 bundle 为 `dsh-base`、`dsh-web-app`、`link:D:/dsh-auto-memory`；host 仅在 `127.0.0.1:19431` 启动。生产 `19387` 本轮没有请求或探测。
- `dsh-auto-memory.json` 的 `memoryRoot`=`D:/dsh-auto-memory/artifacts/_p3b-host-20261118/memory/workspaces`，`userMemoryDir`=`D:/dsh-auto-memory/artifacts/_p3b-host-20261118/memory/user`；两者均是隔离根下的绝对路径。
- 启动日志显示 `[dsh-auto-memory] ready: engine + 22 tools + injection + 87 routes`。该次 `Tee-Object` 日志为 UTF-8，无 token 写入本回执；本地 token 位于证据目录 `endpoint.txt`。
- 先运行 `node artifacts/_lead-integ/probe-pr546-tmp/probe-validate.mjs`：未确认结果 `{ok:false, errors:['userfiles-unproven-by-checksum']}`；确认结果 `{ok:true, warnings:['userfiles-unproven-by-checksum-accepted:1']}`。夹具 356 B，SHA256 `9F5A8198652EA9625EBA7A6D8993286CF9DE84F36FEBE7FDB2EAAD45F82EF267`，`userFiles` 含 `CALENDAR.md`。

## E1–E6

| 项 | 实测 | 判定 |
|---|---|---|
| E1 | 打开真实宿主「自动记忆 → 存储管理 → 迁移搬包」。当前入口 DOM 有 `[data-dam-migration="legacy-opt-in"]`；选择原始包后 `checked=false`、`disabled=false`、`required()=true`。当前页面中文 label 与 classic / frozen / variant 三面中英源码文案一致。 | PASS |
| E2 | 不勾选原包后点击「预览差异」。请求体 `allowUnprovenUserFiles:false`；响应 `ok:false`、`errors=['userfiles-unproven-by-checksum']`，无 plan；UI 显示同一错误。HTTP 状态为 **200**（应用层拒绝），不是 4xx。 | PASS，应用层 fail closed |
| E3 | 勾选同一路径后再次预览。请求体 `allowUnprovenUserFiles:true`；响应 `ok:true`，`plan.additions` 为 `handoff/PLAN.md` 与 `NOTES.md`，`overwrites=[]`；warning 含 `userfiles-unproven-by-checksum-accepted:1`。UI 展示预览与「确认导入」按钮，没有自动导入；按钮未点击。 | PASS |
| E4 | 取消勾选并再次预览。请求体回到 `false`，响应再次 `ok:false` / `userfiles-unproven-by-checksum`，无 plan。 | PASS |
| E5 | 将原 356 B 夹具复制到 `artifacts/_p3b-host-20261118/e2e-546-20261120/legacy-copy.dam-pack`；SHA256 与原件相同。换路径后 DOM 自动变为未勾选；请求使用副本路径且 `allowUnprovenUserFiles:false`，再次返回同一拒绝。 | PASS |
| E6 | 停止隔离 host 后重算 `memory/` 逐文件 SHA256：前后均 **1 文件 / 246 B**，新增 0、删除 0、变化 0。 | PASS |

E2/E4/E5 的 HTTP 200 响应体仍明确拒绝，符合任务书 E2 判据“不是 plan；错误文案”，但与 §0 示例里“4xx/错误”中的 4xx 传输状态不同，故在此披露为应用层错误，不包装成 HTTP 4xx。

## 证据

四次真实路由请求体和响应 JSON（含 HTTP 状态、`plan/errors/warnings`）：

- `artifacts/_p3b-host-20261118/e2e-546-20261120/endpoint-e2.json`
- `artifacts/_p3b-host-20261118/e2e-546-20261120/endpoint-e3.json`
- `artifacts/_p3b-host-20261118/e2e-546-20261120/endpoint-e4.json`
- `artifacts/_p3b-host-20261118/e2e-546-20261120/endpoint-e5.json`
- 汇总：`endpoint-summary.json`；导入路由网络记录检查：`import-request-check.json`（0 请求）。

DOM checked 状态和 capability 状态：`dom-e1.json`、`dom-e2.json`、`dom-e3.json`、`dom-e3-pre-preview.json`、`dom-e4.json`、`dom-e5.json`、`dom-states.json`。三面中英 label 检查：`surface-copy.json`（bundle classic/frozen/variant 各 1 处，两个生成源各 1 处，完全一致）。

三张真实宿主截图：

- E2 失败态：`artifacts/_p3b-host-20261118/e2e-546-20261120/screenshot-e2.png`
- E3 成功预览态：`artifacts/_p3b-host-20261118/e2e-546-20261120/screenshot-e3.png`
- E5 换包后未勾选/失败态：`artifacts/_p3b-host-20261118/e2e-546-20261120/screenshot-e5.png`

memory 目录基线：`artifacts/_p3b-host-20261118/memory-baseline-546-20261120.json`；结束清单与差异：`memory-after-546.json`、`memory-compare-546.json`。夹具校验基线：`probe-validate.json`。授权配置健康响应摘要：`health-config-summary.json`。

## 额外观察

- 健康检查授权观测：浏览器 root 页面带有效 host token 可打开；root 页面无效 token 返回 401。`GET /api/dsh-auto-memory/config` 在 `127.0.0.1` loopback 下带 token 与不带 token均返回 200。因此该 loopback API 的行为不是“缺 token 必 401”；详情记录在 `health-auth-observation.json`。E1–E6 实际验收走宿主浏览器生成的请求。
- 预览请求中的 `targetWs` 为宿主当前工作区 `C:\Users\JH Z\Documents\deepseek-harness\default-workspace`。迁移预览按功能需要读取目标工作区清单来计算差异；本轮没有调用 import，且隔离 `memory/` 前后哈希相同。该目标路径不是 memory 隔离目录，已在 endpoint JSON 中原样记录。
- 实测 UI 语言为中文。英文 label 通过三面生成源码逐字校验；本轮未切换宿主语言做第二次真实英语界面渲染。
- 关闭 Playwright 浏览器并停止 `p3b` host；结束时 19431 无本轮 host 监听进程。未触碰 `19387`。没有修改 `lib/`、`skins/` 或生成器，没有真导入、提交或推送。
