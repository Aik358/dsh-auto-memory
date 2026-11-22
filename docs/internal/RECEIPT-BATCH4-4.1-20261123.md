# 批次 4.1 · 跨工作区画像来源 · 2026-11-23

测绘确认 profile 下 `memory/person/event-store.json` 使用既有事件库格式。原刷新只读取工作区事件。现在刷新把 person 记录接入画像投影、单位候选与诊断 shadow。事件卡、目录和工作区语义段仍用各自来源。画像继续遵守各档位现有门控及 `accepted`、`used` 与 `authorResponse` 的原有过滤规则。

| 文件 | 行尾 | 改前字节 / 行 / SHA16 | 改后字节 / 行 / SHA16 |
| --- | --- | --- | --- |
| `lib/index.js` | CRLF | 2223505 / 30555 / `c7c5f8852edcf3a9` | 2223915 / 30558 / `6813e3df094f2b24` |
| `lib/injection/unit-delivery.js` | LF | 21693 / 439 / `615cf995de6ac1d8` | 21956 / 442 / `f3ffc313db19f9f4` |
| `lib/user-portrait.js` | LF | 14254 / 251 / `fcbfe417b2aef1de` | 14713 / 261 / `e6c3cb079dde288e` |
| `tests/smoke/smoke-test-batch4-person-portrait.mjs` | LF | 新增 | 11812 / 241 / `11bb18bfbaa48cc6` |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | LF | 145358 / 1094 / `10f2555a8bbbb0b6` | 145421 / 1095 / `b42282cf44536ad3` |

专项真引擎、真磁盘、真渲染 **8 PASS / 0 FAIL**。三个模式的画像段包含 `PERSON_ACCEPTED_PREFERENCE`、`PERSON_USED_STATE`、`PERSON_AUTHOR_RESPONSE`。`retrieved` 和 `delivered` 不进入画像。常规字符帧在 600 字处裁剪，单位帧保留完整的 408 字符单位并报 `module-transport-limit`。person 文件缺失或损坏时，工作区画像仍可投递。三条隔离变异（移除 person 读取、放开阶段门、撤掉单位上限）均 CAUGHT，恢复后复绿。

EV 20/0、CO 8/0、U3b 10/0、delivery-policy-runtime 11/0、issue162 26/0。隔离工作树另跑 H5 41/0、精简事件 39/0、规则画像去重 38/0、shadow 14/0、内容档 54/0。r26 初次 24/2，仅长度和 SHA16 锁变化。按套件 actual `1661614 / 82B168FCCBB73898` 重钉后 26/0。语法和真 import 通过，工具 22 / 路由 87 / 配置键 182。

真实 DSH 宿主、a11y、真实模型轮未验证。
