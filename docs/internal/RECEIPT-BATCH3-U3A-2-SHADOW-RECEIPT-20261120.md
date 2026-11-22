# 批次 3 P3-A2 U3a-2 影子回执施工回执

日期：2026-11-20

阶段：U3a-2 实施与本地验收完成。

范围依据：[PROMPT-CODEX-U3A-2-SHADOW-RECEIPT-20261120.md](PROMPT-CODEX-U3A-2-SHADOW-RECEIPT-20261120.md)，SHA-256 `5a41ee7842a18142554b9ebbf60d4d4f9367a556aa5d6695818ed010f919f60e`；优先裁定：[RULING-BATCH3-U3A-SOURCES-20261120.md](RULING-BATCH3-U3A-SOURCES-20261120.md)，SHA-256 `61c3b284834b6c07c9419d55f3f9f89eec0f1e9a78a94c54024aa7e1c897d5db`。
HEAD `23646c04`；没有 commit、push 或版本号变更。

## 结果

按 R1/R2/R3 完成 shadow 接线：计算发生在既有 `refreshEventStatePre()` 的事件 store 读取上下文中，六种来源即时送入 adapter，不把 source DTO 写入 state。只将不含正文的受限回执写入当前 runtime 的 `state._unitShadowPre`；从现有 `POST /api/dsh-auto-memory/delivery-preview` 与 `debugInfo().unitShadow` 只读暴露。没有新增配置键或路由，没有修改 renderer、诊断 part、`client.js` 或生成源。

## 改动落点

| 文件 | 改动与行号 | 行尾 / 差异 |
|---|---|---|
| `lib/injection/unit-shadow.js` | 新模块；`buildUnitShadow()` :250。组装六个 adapter 输入、绑定与选择；对 rules aggregate 做稳定的 shadow-only 字段映射；用既有 handoff parser 与 refresh 调用方传入的 plan section 名；接住来源错误并记录 degradation；身份投影防止 checkpoint / portrait / calendar 正文进入 unit IDs；回执限制 40 个 IDs 和 4 KiB。 | LF；303 行 / 12,406 B；SHA-256 `d44259ca9433a9045a7193d61fe3497f200fdde4bfced3e5215811d67874010e`。 |
| `lib/index.js` | imports :201-203；refresh 开始清除过期回执及诊断开关门 :10415-10419；保留局部 rules aggregate :10527-10532；计算和保存 shadow :10573-10612；debug 只读投影 :16403-16404；preview 只读投影 :29315-29319。 | CRLF，30,466 行 / 2,216,970 B / 30,466 CRLF / 0 裸 LF；SHA-256 `8b3444f9c1fb685e9359f458fb549837baadf563f267ac7f2f718a56f667ef25`。`git diff --numstat`：52 additions / 1 deletion。 |
| `tests/smoke/smoke-test-batch3-unit-shadow.mjs` | S-01..S-10 真执行测试及四个隔离变异。 | LF；442 行 / 18,325 B；SHA-256 `1c22181287f4a4337f0836a842004ed3db3600e806ce3ef18bac8337777093e8`。 |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | :823 的 index SHA16 与 :1065-1067 的 LF 长度锁按套件实际重钉。 | LF；1,087 行 / 144,779 B；SHA-256 `32954766f282457035332ad8294068df130d43a59fee4ba6e665e1d44a63e296`。 |

## U3a 验收

| 判据 | 结果 |
|---|---|
| S-01 diagnostics 关闭后不计算，并清掉旧回执 | PASS：真实 refresh 后 `_unitShadowPre` 不存在。 |
| S-02 diagnostics 开启时从真实 event store refresh 计算 | PASS：六源 fixture 得到 `computed:true`，raw 与 selected 均大于零。 |
| S-03 shadow 不改变动态 prompt | PASS：同一 runtime 的 diagnostics 开 / 关输出逐字节相等。 |
| S-04 来源非法时 fail-soft | PASS：事件适配 degradation 可见，refresh 与正常事件卡继续工作。 |
| S-05 phase / budget 假设 | PASS：`human_full`、`refresh-before-tier` 与预算在回执中明确。 |
| S-06 回执上限 | PASS：61 个被选单元保留 `counts.selected=61`，最多 40 个 IDs，JSON ≤ 4,096 B。 |
| S-07 纯函数与幂等 | PASS：同输入、同 `now` deep-equal；输入不变；源码无 fs/path/Date.now/Math.random。 |
| S-08 只读暴露 | PASS：preview 与 debugInfo 返回当前缓存回执；关闭 diagnostics 后均为 null。 |
| S-09 事件族 quota | PASS：`event/event max=1` 限制事件族选择并报告 quota rejection。 |
| S-10 性能界 | PASS：暖机后的单次计算低于 15 ms。 |

命令 `node tests/smoke/smoke-test-batch3-unit-shadow.mjs`：**10 PASS / 0 FAIL；4 mutations CAUGHT / 0 MISSED**。

变异证据：MV-01 将假设 phase 改为 `auto`，测试识别错误 phase；MV-02 将 selected 计数改为 0，61 单元计数判据识别；MV-03 将 unit ID 上限改成 61，40 ID 上限判据识别；MV-04 清空 `truncatedBy`，quota 判据识别。每个变异都在隔离临时模块副本中执行。

## 实际回执样本

以下来自一次真实 `refreshEventStatePre()` 与临时 event-store fixture，已使用不含正文的 shadow identities；样本 JSON 为 894 B：

```json
{
  "version": 1,
  "computed": true,
  "at": 1795160649206,
  "assumed": {
    "phase": "human_full",
    "budget": { "jsChars": 8000, "utf8Bytes": 24000 },
    "reason": "refresh-before-tier"
  },
  "covered": ["events", "rules", "plan", "handoff", "portrait", "calendar"],
  "counts": { "raw": 10, "selected": 10, "deferred": 0, "rejected": 0 },
  "cost": { "jsChars": 278, "utf8Bytes": 332 },
  "truncatedBy": null,
  "budgetOvercommit": false,
  "unitIds": [
    "portrait:portraitItem:portrait:shadow-portrait-evt_sample-0",
    "events:checkpoint:event:evt_sample:checkpoint:shadow-checkpoint-0-0",
    "events:event:event:evt_sample",
    "plan:planSection:plan:%E5%BD%93%E5%89%8D%E7%8A%B6%E6%80%81",
    "plan:planSection:plan:%E5%BE%85%E5%8A%9E",
    "handoff:ledgerSection:handoff:type:dead-end",
    "handoff:ledgerSection:handoff:type:goal",
    "handoff:ledgerSection:handoff:type:progress",
    "handoff:ledgerSection:handoff:type:state",
    "calendar:calendarEntry:calendar:shadow-calendar-0"
  ],
  "degradations": []
}
```

## 计数锁与最终验证

- `node tools/verify-docs.mjs`：**22 tools / 87 routes / 182 config keys**，五份文档一致；没有新增 `unitPolicyMode`。
- `node tests/smoke/smoke-test-r26-cross-layer.mjs`：**PASS 26 / FAIL 0**。本次测得 `lib/index.js` LF-normalized length **1,655,058**，SHA16 **E13A88D0409EE3AA**；原登记值 1,652,347 / `6A01ADFE83DE9512`。重钉依据是本套件对当前文件实际读取、换行归一后的值，增量 2,711 字符。
- `node tools/build-iter5-skin.mjs --check --strict`：**SYNC-OK**；本批没有改皮肤或客户端。
- `node --check`：index、新模块、smoke 文件通过；真实 import `lib/index.js` 通过，导出保持 **41**。
- `lib/client.js` 前后 SHA-256 均为 `9154599dd272c142dbb3be83bf3b7d0608ce90575c0091e443920f39f57aecd8`；工作树实测 27,353 行 / 3,038,864 B / CRLF。文件未改。
- `git -c core.whitespace=cr-at-eol diff --check`：通过。普通 `git diff --check` 会把本机 CRLF checkout 在仓库 `eol=lf` 属性下的新增 CR 字节误报为尾随空白；按 `cr-at-eol` 复核无实际尾随空格。
- `node tools/run-smoke.mjs --jobs=8 --timeout=180000` 最终结果：**645 PASS / 0 FAIL / 0 TIMEOUT / 2 FLAKY**（647 suites）；`smoke-test-py-runtime-live.mjs` 与 `smoke-test-fullpage-negative.mjs` 串行重试后通过，按 runner 规则单列、不计入 PASS。

## 首次失败与修复

1. 首次 r26 运行得到旧锁两项失败：实际 SHA16 `E13A88D0409EE3AA`、长度 `1655058`，原预期为 `6A01ADFE83DE9512`、`1652347`。根因是本轮有意改动 index 后锁仍为旧值；按 r26 自身管道重钉，复跑 **26/0**。
2. phase 长度防护改为 `.slice(0, 32)` 后，U3a smoke 的 MV-01 替换锚点仍匹配旧表达式，隔离变异设置报 `assumed phase anchor`。将测试锚点同步为当前表达式；随后 **S-01..S-10 10/0、4/4 mutations caught**。
3. 第二次全量运行时 U3a smoke 的 MV-01 因 phase 长度保护改动后锚点未同步而失败；根因与修复见第 2 项。修复后第三次全量回归 **645/0/0/2 FLAKY**，两个 flaky 套件均在串行复试后通过；本节按 runner 的口径保留 FLAKY，未并入 PASS。

## 未验证 / 未实现

- 未做真实 DSH 宿主 a11y 树或截图；本任务没有 UI 改动，真实宿主验证仍未验证。
- `on` 接管没有实现；`deliveryModule` 没有产出，留给 U3b。
- 本影子按裁定假设计算 `phase='human_full'` 与配置字符预算，不代表当轮最终 full/slim 帧。
