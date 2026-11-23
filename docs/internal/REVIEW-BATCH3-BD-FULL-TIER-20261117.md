# BD/FM full投递风险审查 · 2026-11-17

## 结论

禁止把内容档位简化为固定human_full/profile:full。每次无条件full会重复投递用户规约、白板、账本与事件材料，绕过内容选择，放大prompt并稀释当前任务；还会使通知/版本观测与实际内容档不一致。尚未量化实际token增长，不虚构数字。

## 当前代码事实

- planSpecForTierPre：human_full/handoff_carry/post_compact白板全文；run_slim不投；legacy与run_full/human_slim/hang_compensate为核心节。
- 生产内联_planSpec：legacy单独保留旧路径；白板预算用_isFullTier，legacy取得大预算，memLegacy时再限制2400/800。
- _isFullTier属于规则/旧内联口径：含legacy，不含hang_compensate，不能直接作为BD统一内容策略。
- 生产缺_injectTierPre时回退legacy；可能使白板/账本走大预算路径。属现有行为，需要独立量化与处置，不能归因为BD新增缺陷。
- RP已改为保留原tier，由公共模块决定规则呈现，不再把run_full改名为slim。

## 新适配硬门

1. 白板只消费planSpec结果：inject/full/core/none，不读取规则层_isFullTier。
2. 账本独立显式tier策略；真实tier决定sections/full，再复用四段加权预算。
3. BD只选择与段级预算；FM统一最终帧预算、计量和降级。
4. closed事件选择归EV，不在BD构造平行逻辑。
5. 入口实参与最终输出双验收，禁止只测公共模块或只搜字符串。
6. 覆盖正常slim、profile/tier冲突、模块异常、legacy fallback、重复请求；任何异常不得把slim放大成全文。
7. 对照plan/ledger/final字符与UTF-8字节、段数、丢弃/截断；重复请求不得累积放大。
8. 未知tier显式拒绝并记录degradation；兼容fallback必须保留原档位语义，不能默认full。

## 当前状态

BD草稿未提交，CA/RP提交保留。未做真实HOST，不能宣称生产风险已解除。

## 补充实测与最终裁定

- legacy未在公共词表时会抛错；入口空catch会掩盖接线失效，必须显式留痕。
- human_full + memLegacy=true若直接传full，会绕过既有7节/2400/800截流；memLegacy约束优先于任何full。
- run_full/hang_compensate的白板沿用现有生产核心节策略，不擅自扩大full集合。
- legacy原tier进入公共模块，不改名slim；账本legacy保留四段加权，不是无限全文。
- 异常必须走同档安全投影并记录degradation；重复请求、八档×memLegacy、profile/tier冲突均须量化验收。
