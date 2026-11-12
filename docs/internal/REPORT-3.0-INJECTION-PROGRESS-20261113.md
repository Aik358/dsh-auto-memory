# 3.0 注入投递基础修复：定版范围与当前实现进度

> 日期：2026-11-13（Asia/Hong_Kong）
> 基线：preview / `5aa3d2c837aa0a20a293b6393787a8b9e6904500`
> 性质：**文档 + 当前代码复核；未修改生产实现，未启用新行为。**
> 结论：**3.0 的大体思路与目标规格已定版；代码并非从零，但按 3.0-A 的目标验收，七个施工项均尚有缺口。不能把旧审计中的“未开工”逐字当成当前事实，也不能把底层模块存在当成本项完成。**

## 1. 定版文档与范围

主规格：
- `docs/internal/CONSTRUCTION-GUIDELINE-INJECT-20261108.md`：S1–S12、用户裁定、实现建议与遗留边界。
- `docs/internal/CONSTRUCTION-PLAN-20261108.md`：当前 `3.0-A` 的 3.0.1–3.0.7 与 `3.0-B` 边界。
- `docs/internal/AUDIT-PROMPT-INJECT-REFACTOR-20261108.md`：首轮交叉审计任务与路径。
- `docs/internal/AUDIT-CROSS-ROUND1-CODEX-20261108.md`：旧基线证据与反证。

范围是注入/投递链：规则全文与指针、档位、总预算、通知、定稿、最终计量、白板/账本裁剪及真实回调。
SidecarStore 是派生索引的独立后续线；R4 文档存储/WAL、2.3 归属、2.9 规范化/覆盖证明均不自动等于 3.0 完成。

## 2. 总判断

| 层 | 当前事实 |
|---|---|
| 思路/规范 | 已定版：目标、判定、主要函数/模块落点及大部分验收已写清 |
| 既有基础设施 | 丰富：规则分层、L0/召回、快照/计量、请求幂等、裁剪模块均已有代码 |
| 3.0-A 功能闭环 | **尚未完成**；七项都有复用点，同时都仍存在目标差距或待验证缺口 |
| 3.0-B 边界 | **未全定**；预算/最终计量、特殊档、完整版频率与记忆联动不可由实现者自行改口径 |
| 真实宿主/最终回调 | 本轮未重新验证；现有真实回调宿主调查与局部测试可作前置证据，非最终验收 |

**无单一完成百分比。** 各子项独立计数，避免基础设施体量掩盖实际缺陷。

## 3. 逐项进度

| 子项 | 已有代码/文档基础 | 距目标仍缺 | 判定 |
|---|---|---|---|
| **3.0.1 规则指针与完整读取** | `rules-layer.js` 按层抽取/分类/渲染；`lib/index.js:283–344` `applyRuleEditPre` 已支持 user/project、原文读取、expect、revision/CAS；`memory_rules` 已有 list/add/update/remove；`memory_read(kind=user/notes)` 可读单层全文 | 未形成明确的用户+项目聚合只读读取/引用协议，层内索引与完整说明需同源；摘要 pre-cut 与特殊档需按新规则调整，不能直接依赖旧入口逐字满足 | **部分实现；读写协议待闭合** |
| **3.0.2 精简档位修正** | `_SLIM_HUMAN_CTX_TIERS` 已含 human_slim/user_slim/run_slim/agent_slim；`renderSlimSnapshotPre` 已能构建精简事件/规则/召回/通知；历史骨架与复读机制存在 | 需要真实帧逐档比较、完整/精简/通知/定稿的同源验收；不能从候选摘要是否含 _waterPct 推真实窗口 | **部分实现；目标验收待闭合** |
| **3.0.3 通知消费与定稿** | `finalizePre` 已有请求级定稿/复读；reflection 消费在末级交付旁挂；白板更新、recall、动态 brief、request 幂等机制均存在 | **缺陷仍可见**：`briefDetectSyncPre` 在候选构建阶段调用并清状态；`_waterPctFired` 可在授予分支先于返回推进；`_recallJustDelivered` 在候选分支置 true。应统一 finalize 后 peek/commit | **有基础设施；通知正确性未闭环** |
| **3.0.4 最终预算与最终计量** | `memory-envelope.js` 有 envelope、固定成本、字符/token 计量与定长降级；`budgetInjectionPre` 有白名单/定长结构；`renderReflectionRequest` 等通知可纳入预算 | 当前 memRef/other 仍有分段比例/独立窗口；`observeInjection` 不在最终返回处；tail 可能绕开总预算与规则保护；real async 通知闭合待测 | **模块已有；全局预算/最终计量未闭环** |
| **3.0.5 白板/账本裁剪与 true full** | `buildSlimHandoffPre` 按四段+成员+最新检查点，`renderSectionPreview` 身份不变；`memory_recall expand/checkpoint` 与 R4 指针已有 2.7 实现 | `truncatePlanByPriority` 仍先 cut；深度账本 min/full 覆盖与同一 fingerprint、完整内容路径须验；2.9 尚施工中 | **有较强底座；full/裁剪验收未闭环** |
| **3.0.6 真实回调与消费证明** | 快照/摘要 API、project/retained 口径、真实回调宿主调查报告均已存在 | 真实 user turn / project 内存证明仍需本批最终联测；不能因为 Node/旧宿主调查就标完整闭环 | **调查完成；最终证明待补** |
| **3.0.7 联机通知与默认关闭** | `noticeCache` 与 `refreshNotificationsNow` 已有；但当前可见 **TODO：`noticeRemoteEnabled` 未实装** | 需要统一启用开关/默认状态、网络/缓存/重试/卸载边界和真实验证；不得借 3.0 擅自开启网络能力 | **未完整实现；默认关闭边界保留** |

## 4. 已存在的正确模块化方向

这些可以复用，不需重做：
- `lib/rules-layer.js`：规则分层、状态过滤、按层渲染；
- `lib/memory-envelope.js`：输入快照、固定成本/计量、定长降级；
- `lib/wb-sidecar.js`：白板分节、条目、倒排与确定性生成；
- `lib/event-pointer.js`：可信 sourceRef、raw/normalized 指纹与检查点下钻；
- `lib/plan-render.js`/`plan-derived.js`：事件投影与锁内派生合并；
- `lib/inject-tier.js` 等档位/节奏既有模块。

但 `renderMemoryDynamic` 存在测试抽取执行与生产运行两套上下文，不能把某个纯函数有测试等同于真实回调全链通过。改动应把共用契约抽到真正共享的模块/API，再由 `lib/index.js` 单点接线，避免继续复制局部判定。

## 5. 3.0-B 仍需单独保留的边界

- 最终预算的固定字节上限和实测真实 token 的计量/不截断纪律；
- 规则超限是否截断、MEMORY 全文与编辑索引、legacy 档位特殊处理；
- 精简白板详情、完整版次数与轮次证据、记忆联动和身份预留；
- 提醒投递、noticeRemoteEnabled 默认关闭和 callback=deduped 的验证口径。

这些不是“剩余实现者自由发挥”的细节，而是应沿用户既有裁定或另行确认的边界。

## 6. 对当前并行的实际建议

1. 2.3 的归属训练不替代 3.0 的投递修复。
2. 2.9 的独立核心可并行，但它影响账本正文/来源证据，不证明最终注入交付。
3. 3.0 可先设计并测试纯函数/API 与隔离帧，再对 `lib/index.js` 做单一写者接线。
4. SidecarStore 只作为独立索引持久化后续线，不以它的 27/27 证明 3.0 已完成。
5. 3.0 验收须真实回调与真实帧，按项报告；不以“模块数/文档数”或总分作完成判据。

## 7. 本轮边界

- 本轮只读并写本报告；未改 `lib/`、未改前端、未启用生产行为。
- 旧报告的数字与结论均带历史基线，须以当前源码为准。
- 没有 git commit/push；未进行真实宿主、跨设备或生产启用验证。
