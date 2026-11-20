# 批次 3 P3-A2 U3a-3 真实身份回执

日期：2026-11-20

阶段：D4 修复与定向验收完成。

范围依据：[PROMPT-CODEX-U3A-3-REAL-IDENTITY-20261120.md](PROMPT-CODEX-U3A-3-REAL-IDENTITY-20261120.md)，SHA-256 `83114450e4fa725ff1a9fd08952997e987e011836c9e50ed2c881359f40c7db4`。HEAD `23646c04`。本轮未 commit、push 或改版本号。

## 修复

在 [unit-shadow.js](/D:/dsh-auto-memory/lib/injection/unit-shadow.js) 中删除了事件 checkpoint、portrait 和 calendar 的 `shadow-*` 身份投影，三个 adapter 现在接收原对象，身份字段保持原样。真实身份塌缩由既有 `bindUnits` / `selectUnits` 暴露为 `duplicate-id`；selector 抛错时 `counts.selected=null` 表示结果未知，避免将未知伪装成 0。

Rules 边界映射现在优先沿用真实非空 `revision` 与有效索引 tuple。只有缺字段时才使用 refresh-local revision 或索引 fallback；每个 RulesAggregate 最多追加一条明确披露：

```json
{"source":"rules","code":"rules-identity-synthesized","message":"rules revision/segment tuple synthesized for shadow"}
```

该披露不把 `computed` 置为 false。没有修改 `lib/index.js`、`unit-adapters.js`、`unit-policy.js`、客户端、配置或接线。

## 同一身份塌缩夹具对照

夹具含一个 active event，及两个字段相同的 checkpoint：`checkpointId:'unknown'`、`text:'same collapsed checkpoint'`。以下是修复前旧投影与修复后真实身份的原始回执 JSON。

修复前：

```json
{"version":1,"computed":true,"at":1,"assumed":{"phase":"human_full","budget":{"jsChars":8000,"utf8Bytes":24000},"reason":"refresh-before-tier"},"covered":["events","rules","plan","handoff","portrait","calendar"],"counts":{"raw":3,"selected":3,"deferred":0,"rejected":0},"cost":{"jsChars":83,"utf8Bytes":83},"truncatedBy":null,"budgetOvercommit":false,"unitIds":["events:checkpoint:event:evt_collapse:checkpoint:shadow-checkpoint-0-0","events:checkpoint:event:evt_collapse:checkpoint:shadow-checkpoint-0-1","events:event:event:evt_collapse"],"degradations":[]}
```

修复后：

```json
{"version":1,"computed":false,"at":1,"assumed":{"phase":"human_full","budget":{"jsChars":8000,"utf8Bytes":24000},"reason":"refresh-before-tier"},"covered":["events","rules","plan","handoff","portrait","calendar"],"counts":{"raw":3,"selected":null,"deferred":0,"rejected":0},"cost":{"jsChars":0,"utf8Bytes":0},"truncatedBy":null,"budgetOvercommit":false,"unitIds":[],"degradations":[{"source":"selection","code":"duplicate-id","message":"unit ids must be unique"}]}
```

修复前影子把两个重复身份改成两个唯一的 `shadow-checkpoint-*`，因此 selector 错报成功。修复后 adapter 保留两者的 `unknown` 身份，selector 按生产规则拒绝重复 unit ID。失败后没有成功 selection 结果，所以 `selected:null` 是显式的未知值；`raw:3` 保留真实适配数量。

## 新增判据与变异

| 判据 | 结果 |
|---|---|
| S-11 两个相同 `checkpointId:'unknown'` 必须使 shadow 失败 | PASS；`computed:false`，degradation 为 `duplicate-id`，`selected:null`。 |
| S-12 checkpoint、portrait、calendar identities 不被重写 | PASS；三个真实 checkpoint identity 均按 adapter 实际编码出现在 unit IDs 中，portrait sourceRef 与 calendar ID 原值可见，IDs 不含 `shadow-`。 |
| S-13 多 checkpoint 正常路径 | PASS；3 个有独立真实身份的 checkpoint 全部适配，computed 成功且无 duplicate-id degradation。 |
| S-14 缺 revision 的 rules source 显式披露 | PASS；出现指定 `rules-identity-synthesized` degradation，`computed:true`。 |

新增变异：MV-05 在 events 调用点重新改写 checkpoint identity，S-11 立即失红；MV-06 删除 rules synthesis disclosure，S-14 立即失红。既有 MV-01..MV-04 也保持通过。

命令 `node tests/smoke/smoke-test-batch3-unit-shadow.mjs`：**14 PASS / 0 FAIL；6 mutations CAUGHT / 0 MISSED**。首次 S-12 失败是测试期望错误地对 portrait sourceRef 做 URI 编码；核对 adapter 后改为按真实输出约定断言原 sourceRef。生产实现未为迎合该错误断言而改写身份。

既有 U1/U2 定向套件：`smoke-test-batch3-unit-policy.mjs` **32/0**，`smoke-test-batch3-unit-adapters.mjs` **35/0**。

## 物理量与未改锁

- `lib/injection/unit-shadow.js`：LF，295 行 / 12,426 B；SHA-256 `78b3bcb9acfa441cc9e58e0b64ddb2bed3858ca3407cd3e487bb0a7889e617d7`。
- `tests/smoke/smoke-test-batch3-unit-shadow.mjs`：LF，527 行 / 23,640 B；SHA-256 `b153668d6a49fa2ac1b138174c38ccf86d4eb5e9946988fb0bce3dd7e965a9f0`。
- `lib/index.js` 本轮未改；U3a-2 已验收的 r26 长度与 SHA16 锁值保持不变。
- `lib/client.js` 本轮未改；SHA-256 保持 U3a-2 值 `9154599dd272c142dbb3be83bf3b7d0608ce90575c0091e443920f39f57aecd8`。
- `lib/index.js` SHA-256 仍为 U3a-2 值 `8b3444f9c1fb685e9359f458fb549837baadf563f267ac7f2f718a56f667ef25`，本批未改且 r26 锁值不变。
- 不新增公开配置键；配置计数仍 **182**，路由 **87**，工具 **22**，导出 **41**。

## 未实现 / 未验证

- `on` 模式未实现。
- `deliveryModule` 未产出。
- 真实 DSH 宿主验证未做。
- `verify-docs`：**22 / 87 / 182**，全部一致。
- r26：**26 PASS / 0 FAIL**，锁值保持 U3a-2 的 **1,655,058 / E13A88D0409EE3AA**。
- `build-iter5-skin --check --strict`：**SYNC-OK**；U3a-3 没有客户端或生成源改动。
- 全量 `node tools/run-smoke.mjs --jobs=8 --timeout=180000`：**640 PASS / 0 FAIL / 0 TIMEOUT / 7 FLAKY**（647 suites）。以下 7 项串行重试通过、按 runner 纪律单列而未计入 PASS：`smoke-test-py-runtime-live.mjs`、`smoke-test-r4-system.mjs`、`smoke-test-fullpage-negative.mjs`、`smoke-test-v4-u6-memory-upgrade.mjs`、`smoke-test-m73.mjs`、`smoke-test-m78-host.mjs`、`smoke-test-m76.mjs`。
