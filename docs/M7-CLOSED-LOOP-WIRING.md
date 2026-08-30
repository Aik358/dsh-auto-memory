# M7 闭环接线：唤起决策 → 系统默认提示词投递（2026-08-26）

> 结论先行：**M4/M5/M6 早已把投递侧接口全部预留并 live 验证过，本轮唯一缺的一环是
> Python fv2 决策不发帧**。已补上（`activationEmitMode` 门控的发射桥），闭环现在
> 只差一次用户重启 + 把开关拨到 canary 档即可端到端运行。
> **时机裁定：现在就接，不等分层记忆**（理由见 §5）。
>
> **同日追加（C2 接线完成）**：`semanticEngineMode` 已有真实消费方——
> `lib/semantic-js-pre.js`（js_semantic_engine_pre_v1）：e5-small q8 懒加载 +
> miv 键索引缓存 + D6 融合进 envelope.refs（context-host 异步链内）；资产下载器
> （双源 cn=hf-mirror / intl=huggingface，auto 国内优先，流式进度+SHA256 校验+
> 原子落位）；设置页显示「当前生效检索」档位与真实进度条。详见 §7。

## 7. C2 内置语义接线（同日追加，2026-08-26 用户指令：JS 原生模式打通后再谈测试）

| 件 | 位置 | 说明 |
| --- | --- | --- |
| 引擎宿主 | `lib/semantic-js-pre.js` createJsSemanticEnginePre | peer @huggingface/transformers 多候选解析(发行包邻接 → 开发树 js-semantic-trial)；miv 键索引缓存(trial 版每次全库重嵌已修复)；rank 失败→null 回退词法,lastRankError 入 status |
| D6 融合 | 同文件 fuseD6Pre | minmax×0.7/0.3,平局 memoryId 升序;候选池=词法 kept ∪ 稠密 top-K(词法零分但语义强命中者可入选) |
| refs 接线点 | `lib/context-host-pre.js` onSegmentAccepted | C2 排名挂进 readyPromise 同一条延迟链(envelope 构建确定性纯函数,后移安全);钩子缺失/失败=行为与旧版逐字节一致 |
| 档位解析 | index.js engine.resolveSemanticTier | mode='lexical'→C1 强制;auto/js/python 在资产就绪时启用 C2 臂(python 模式下 C2 只改善 envelope.refs/candidateHit,sink 检索仍归 sidecar) |
| 下载器 | 同文件 createSemanticDownloaderPre + POST API['semantic-download'] {action:start|cancel,mirror} | 五文件清单 SHA256 冻结(onnx 118,308,185B 等);单飞行;取消;错误含 sha256-mismatch/http-<code>;落位 lib/models(发行包布局) |
| UI | client.js 设置页 | 「当前生效检索:C1/C2」状态行;引导卡=镜像三选(auto/cn/intl)+开始/取消/重试+真实进度条(1.5s 轮询 semantic-status.download)+体积/校验说明 |

验证：smoke-test-m81-c2-wiring-pre.mjs **21/21**(融合纯函数/注入 embedder 的排名与
miv 缓存/embedder 失败回退/下载器双源回退+SHA256 失败+单飞行+取消)；真机 e5 端到端：
琥珀查询→琥珀文档 0.929、面条查询→面条记录 0.904、缓存后单查询 4ms、3 文档首建 1.7s
(全库 ~300 条约 5.5s,每 miv 一次)。

## 1. 全链路现状（哪段早就通、哪段是新接的）

```text
 【观测面】assistant/chunk reasoning-delta / 用户消息 / 工具事件        ✅ 已通(round-2)
     → M2 Segment(kind 含 'reasoning', origin 权重 0.5)
 【组装面】M5 context-host: envelope(trigger+window+memoryRefs+evidence) ✅ 已通(sent=35)
     → python sink (context-sink-python-pre, 共享 SidecarClient)
 【判定面】worker fv2 两车道(hardGates→lane→echo veto→margin→completeness)✅ 已通(shadow 行 119+)
     → activation-shadow-v2.jsonl (决策照记,含 emit)                    ✅ 保持
     → 🆕 [本轮] emit bridge: decision=emit ∧ lane=explicit
       ∧ activationEmitMode≠shadow  →  activation_request 帧           ← 新接的唯一一环
 【投递面】SidecarClient.handleLine(activation_request 去重)            ✅ 预留已久(M7-1)
     → offerExternalActivation(assoc∧inbox∧source=python 三门+JS 硬校验) ✅ 预留已久(M6-3)
     → 收件箱 pending → 自然 pre-step claim(cooldown/TTL/cursor/index 四门)✅ live verified
     → Reference Tail 渲染进下一请求 messages('dsh:m6-reference-tail-pre')
     → markDelivered → M5 seen evidence                                ✅ live verified
```

关键事实更正：此前会话记录「JS onActivation→inbox 最后一跳未接」**不准确**——
`context-host-pre.js getPythonSink()` 早已挂 `onActivation → offerExternalActivation`，
且该方法真实存在（activation-host-pre.js:177）。真正缺的只有 Python 发射。

## 2. 本轮改动清单

| 文件 | 改动 |
| --- | --- |
| `python/worker_semantic_pre_v1.py` | ①init 读 `activationEmitMode`(∈shadow/canary-explicit/active，非法回退 shadow)；②`_fv2_shadow_decide` 尾部 emit bridge：decision='emit' 且(canary-explicit→lane='explicit'，或 active)时经 `_build_fv2_activation` 发帧；③新方法 `_build_fv2_activation`：候选/身份块复用 v1 构造器(provenance 同契约)，判定块覆写为 fv2(policyVersion=activation_policy_pre_v2，score=intentProb，threshold=tauHi，reason='fv2 lane=… '+reasonCodes)，level 固定 'excerpt'(最小内容级)；④shadow 行恒写先于发射(观测连续性) |
| `lib/index.js` | semantic-status 增加 `activationEmitMode` 读数(读 embedding-config.json，与 worker 同源) |
| `lib/client.js` | 设置页阈值行追加只读「发射模式: xxx」；两个观测开关默认 true + 双语文案(2026-08-26 裁定) |
| `smoke-test-m710-fv2-emit-pre.mjs` | 新增 13 断言：T0 默认零帧泄漏(shadow 行照记 emit 的双保险断言)/T1 canary-explicit 帧数==explicit emit 行数/echo 不发/字段契约全验 |

设计原则：**阈值权威不动**——activation_policy_pre_v2.json(append-only)原封未改，
configHash 不变；`activationEmitMode` 是 JS/用户运营面开关(同 embedding-config.json
现有 search/activationPolicy 键的传递通道)，Python 缺失即 shadow(fail closed)。
节流不重复造轮子：M6 收件箱已有硬校验+身份门+重复门+抑制名单+cooldown(2 步)+TTL+
latest-wins 七层，worker 侧不再限速。

## 3. 开关与操作

配置文件 `<DSH_HOME>/memory/semantic-pre/embedding-config.json`：

```json
{ "activationEmitMode": "canary-explicit" }
```

- `'shadow'`(缺省)：只记 shadow 行，零注入。当前状态。
- `'canary-explicit'`：仅 explicit 车道 emit 发帧。**canary 阶段用这档**。
- `'active'`：预留(fv2 round-1 proactive 车道本就到 prefetch 为止，此档暂无增量行为；
  待 proactive emit 规则获批后启用)。
- 设置页「自动记忆引擎」分组阈值行可只读核对当前档位；semantic-status API 同样回报。

## 4. Token 影响面(用户要求：不计算上下文、只做增量)

Reference Tail 是**纯尾部增量**：走 systemPrompt.context 动态面(user-role 快照追加于
历史尾部)，不改写既有前缀、不进 systemPrompt.section(字节级稳定由 F7 断言锁定)、
单 packet ≤4096B(maxPacketBytes)、单条引用 ≤600B、excerpt ≤480B、TTL 3 步自灭、
投递后强制 2 步冷却。前缀缓存安全：注入点在官方 pre-step/context 边界，已发出请求
永不改写；delivered 以「实际渲染进 messages」为准(渲染即投递)，seen 证据闭环可审计。

## 5. 时机裁定：现在接入，不等分层记忆(working/procedural/lexical…)

- **投递侧与供给侧解耦**。分层记忆(M8 governance/M9 procedural/人脑式 working·
  procedure·lexical 分层+晋升渠道)改变的是「有什么记忆可被唤醒」；本闭环是「唤醒了
  怎么送达」。M6 契约(level 六级/checklist/excerpt/预算)对记忆来源无假设，后续层级
  以新 memoryId+provenance 进同一 corpus 即自动获得投递能力，无需再动这条链。
- **算法侧验收已过**：held-out actPrecision 0.917/predictedEmit 12/S-leak 0，冻结
  策略不再调；受控 shadow round-2 全链路实测通过。继续等待只会让验证过的决策持续
  停留在日志里。
- **风险已被结构性约束**：canary-explicit 只放行显式车道(用户明确要回忆的场景)；
  proactive 在 round-1 结构上不可发射；任一异常 → 关掉 JSON 里那一个键即回到零注入。
- 因此顺序是：**本轮重启加载代码 → 受控流量下把开关拨 canary-explicit 观察
  delivered/seen 与误报率 → 满意后保持，不满意一键回 shadow**。M8/M9 接入时复用
  同一链路，届时只需扩供给侧，不需要「再接一次」。

## 6. 验收证据

- smoke-test-m710-fv2-emit-pre.mjs **13/13 PASS**(hash provider 确定性语料)：
  T0 无帧泄漏+shadow 行照记 emit；T1 帧数==explicit emit 数、kind/activationId/
  threshold.policyVersion/level=excerpt/ttlSteps/candidates provenance/reason/
  session identity 全部符合 ActivationRequestPre+M6 validator 期望。
- py_compile + node --check + 全量串行回归见当日会话记录。
