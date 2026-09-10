# dsh-cua-pre · 截图自动识图「派 max 档子代理」问题 · 修复思路

> 观察日期 2026-09-10;live 插件源码 `E:\dsh-cua-pre`(符号链接进 `~/.dsh/profiles/web/node_modules/@a9i5k4/dsh-cua-pre`)。
> 结论:不是 Harness 的行为,是插件自己的设计 + 默认值组合出来的。

## 1 事实链(逐行)

| 环节 | 证据 | 说明 |
|---|---|---|
| 截图后自动识图 | `lib/index.js:273-280` `afterScreenshot → if (c.visionEnabled && c.visionAutoDescribe && frameId) maybeAppendVision(...)` | 每次成功截图都会自动追加一段 `[vision]` 描述 |
| 识图 = 起一个**子代理** | `lib/cua-vision-pre.js:104-112` `getSubagents()`、`subagents.start(providerName, ...)` | 不是一次 LLM 调用,而是完整子代理(有 session、会进任务板、会走 `subagent/end` 结算) |
| **模型/思考档位默认继承调用方** | `cua-vision-pre.js:176,182-187`:`const model = String(cfg.visionModel \|\| '').trim()` … `...(model ? { agentOptions: { model } } : {})` | `visionModel` 为空 ⇒ **完全不传 agentOptions** ⇒ 子代理继承当前会话路由 = `deepseek-flash` + `reasoningEffort: max` |
| 默认值 | `lib/index.js:59-61` `visionEnabled:false / visionModel:'' / visionAutoDescribe:true` | 本机 `~/.dsh/cua-pre.json` 里 visionEnabled=true,故每次截图都触发 |
| 超时很长 | `lib/index.js:584` `visionTimeoutMs`(本机 90000) | 90s 上限,出现「截图卡近 1 分钟」 |
| 分块昂贵 | `tileMaxPx:768 / visionMaxTiles:4` | 一屏最多 4 张图喂给那个 max 档子代理 |

**一句话**:截图 → 起一个继承「max 思考强度」的子代理 → 喂 4 张图 → 最多等 90 秒。这正是看到的现象。

## 2 修复方向(按性价比排序)

### P0 · 永远不要继承调用方的思考档位(1 行级)
识图是「读屏」任务,不需要推理链。无论用户是否配了 `visionModel`,都要**显式**传档位:

```js
const run = await subagents.start(providerName, {
  ...,
  agentOptions: {
    ...(model ? { model } : {}),
    reasoningEffort: String(cfg.visionReasoningEffort || 'off'),   // 新增配置键,默认 off
  },
})
```
顺带把 `provider` 也钉死(避免继承到不支持的 provider 直接熔断)。

### P1 · 让「谁来看图」变显式(消除默认歧义)
- `visionModel` 为空时**不要**默默跟随系统路由;两种选择都比现在好:
  a) 明确回退到「当前会话模型但 `reasoningEffort: off`」(最少惊讶),或
  b) 直接**不自动描述**,只把帧存下来(见 P2)。
- 建议在设置页把当前生效值显示成具体模型名(`当前:deepseek-flash(继承)`)而不是留空。

### P2 · 自动描述默认关,改为「按需」
驱动模型自己就能看图时(多模态),插件再派一个子代理描述同一张图纯属重复劳动:
- 把 `visionAutoDescribe` 默认值改成 `false`;
- 或加判断:调用方模型在多模态名单里 → 跳过自动描述,只返回帧路径(`read_image` 直接读);
- `describe` 端点(`/api/dsh-cua-pre/describe`)已经存在,保留手动路径即可。

### P3 · 用一次 LLM 调用代替子代理(结构性)
`inject` 里已经有 `llm`。识图完全可以用一次 `llm` completion 完成:
- 省掉:子代理 session 记录、任务板条目、`subagent/end` 结算事件、agent 生命周期开销;
- 省掉:子代理自己再触发你的 `auto-memory` 自动沉淀链(本机就看到了:每次截图会在今日日志/子代理看板里冒一条);
- 若必须用 `subagents.start`(某些 provider 只暴露子代理面),至少 P0 必须做。

### P4 · 成本闸门与去重
- `visionTimeoutMs` 默认降到 15-20s(识图失败不该堵住一次截图);
- 帧内容哈希去重:同一帧(或与上一帧相似度高)不重复描述;
- 每轮对话一个识图预算(例如 ≤3 次),超预算只返回帧、不描述;
- `visionMaxTiles` 默认降到 1-2,或按驱动模型的视觉分辨率动态决定。

### P5 · 可观测性
- 给这个子代理加固定 label(如 `cua-vision`),让它在任务板/日志里一眼可辨,而不是显示成一条无名子代理;
- 把「本次识图用的模型 + 档位 + 耗时 + tile 数」写进 `recordOp` 的 brief,便于事后追成本。

## 3 本次为解锁任务做的临时处置(可随时回退)

`~/.dsh/cua-pre.json` 已改为 `"visionAutoDescribe": false`(通过 `POST /api/dsh-cua-pre/config` 写盘,并写入进程内 `overrides`,**即时生效**,无需重启)。
→ 截图工具恢复秒回;需要识图时用 `/api/dsh-cua-pre/describe` 手动触发,或直接 `read_image` 读 `~/.dsh/cua-pre/artifacts/cua-frame-*.jpg`。
→ 要恢复:设置页把「自动描述截图」打开,或 POST `{"visionAutoDescribe": true}`。

## 4 顺带记录:坐标/缩放存疑(本次实操踩到)

- 帧图像是 **1600x984**,主屏 bounds 是 **2560x1440**(`list_displays`)⇒ 帧 = 屏 × 0.625。
- 但按帧坐标点击时**没有命中目标**:`left_click(1435,222)`(按 ×1.6 折算应落在屏幕 (2296,355),即 GitHub 标题框内)之后,焦点并没有落到输入框。
- 诊断:`mouse_move(1435,222)` 之后 `cursor_position` 返回 **(818,614)** —— 既不是 1:1,也不是 ×0.625/×1.6 的任何一致换算(1435→818 ≈ ×0.57,222→614 ≈ ×2.77)。
- 结论:**帧坐标 → 屏幕坐标的写路径与读路径不一致**(可能是新版本引入的 DPI/虚拟显示缩放处理问题,或 `cursor_position` 读的是另一种空间)。建议核对:
  1. 帧尺寸与 display bounds 的换算是否在**写入端**也统一应用;
  2. `mouse_move` 是否按物理像素写、`cursor_position` 是否按逻辑像素读(反之亦然);
  3. 有 DPI 缩放(本机疑似 150%)时,`SetCursorPos` / `SendInput` 的绝对坐标是否需要先除缩放比。
- 本次任务因此改用「键盘 + 直接读图」绕过,未再动窗口位置。
