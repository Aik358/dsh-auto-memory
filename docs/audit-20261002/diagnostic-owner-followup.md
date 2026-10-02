# PR206 诊断索引归属限定补修

复核日期2026-10-02。上游main重新fetch为131ca794b9f0d07f78b19bf6feee3312939854ed；PR206仍open、未合并、非draft，修复前head857a422a602a0b5aee9b9e3f4fb6b311dae936a9。只在既有fork分支fix/audit-data-safety-20261002正常新增提交；不改#207 head494af9f、#208、#209或cleanup分支，不force push。

## 复现与根因

refresh按runtime排队，各runtime可以并行；完成后路径字段无条件镜像到default state。生命周期refreshAll是fire-and-forget，await session-start及80ms都不能证明A/B完成顺序。PR206的debugInfo把default路径直接交给memoryIndexSnapshot，绕过该索引原本currentRuntime.agent || _lastAgent的owner选择。B后启动先完成、A后完成时，_lastAgent为B而default镜像为A，真实诊断GET索引归属A。索引缓存按文件路径保存digest/version，不是owner仲裁器。

新smoke-test-debug-index-owner.mjs使用完整生产模块、真实apply注册的生命周期与HTTP路由。只在_doRefresh的IO入口放deferred，并保存真实refresh返回promise；明确释放B→A，等待两者真正完成，再证明default为A且_lastAgent为B。无sleep作为完成屏障，不新增公共生产调试接口。配置关闭L0后台嵌入以隔离外部模型及无关异步写盘；其余刷新仍执行实际模块及临时文件IO。

首轮11场景测试：857a422完整源码为2 PASS/9 FAIL，修复后11 PASS/0 FAIL。覆盖B尚未完成、B先完成A晚完成、启动default晚完成、配置default正在刷新/晚完成、ALS owner优先、header缺失的已有runtime、无人值守既有锁和手动模式忽略旧锁、待完成headerless会话的registry只读绑定。每次GET断言configLoaded=false时不调用loadConfig/loadConfigSync、resolvePaths、迁移、saveConfig、refresh或runtimeFor；sync/async写盘计数为0、文件字节及runtime数量不变。

红测试复跑：

```sh
git show 857a422a602a0b5aee9b9e3f4fb6b311dae936a9:lib/index.js > /tmp/dam-debug-owner-baseline.js
DAM_AUDIT_ENGINE_SOURCE=/tmp/dam-debug-owner-baseline.js node tests/smoke/smoke-test-debug-index-owner.mjs
```

## 最小产品修复

仅修改debugInfo首部：在异步读之前选定current runtime agent或_lastAgent，用peekRuntime只读查询既有runtime；有效无人值守锁/header优先；无header时先按sid运行sessionWorkspaceFallback只读解析权威绑定，再回退到owner runtime状态/default/cwd。后续文件状态和memoryIndexSnapshot共用同一个p。无法获得会话绑定时保留既有default/cwd兜底，不扩展未知workspace语义。仍不加载配置、迁移、刷新或写盘；不改变default镜像、runtime队列、路径缓存/索引版本策略及业务路由。

既有源码指纹按限定index差异更新，未移除断言；issue162抽取式诊断投影unit仅补无live-owner依赖，实际owner/IO由新完整模块测试覆盖。既有memory-index回归通过，issue162为25/0。完整本地回归和固定head CI结果随最终报告核对，不用旧基线结论代替新验证；候选仍待独立原生复审。

## PR209 同步影响（只评估，不改其分支）

#209 head1a4a6c4e1d59d3ece3cbf63d9b5b5490d57b124d已经独立修改同一debugInfo首部，仅从_lastAgent既有state取ws，尚未覆盖本次pending/ALS/无人值守/registry场景。在独立detached工作树用其完整真实模块运行本测试，得到7 PASS/4 FAIL，失败分别为B pending、ALS owner优先、无人值守锁、headerless pending registry绑定。该结果不证明#209其他功能有问题。

后续同步需审查同一首部的合并冲突，采用本批明确owner和只读路径解析，并重算#209组合源码指纹、运行新正式回归及其相关诊断测试；不能盲目cherry-pick覆盖原逻辑。未修改或推送#209，需父任务说明并安排独立授权/复审。

## PR206 描述追加建议

新增诊断索引归属补修：后启动的B先完成、先启动的A后完成时，default路径镜像会退回A。诊断现在在读盘前选定ALS/最近agent并只读解析其工作区，各文件状态和索引共用这一归属。保留各runtime独立刷新及现有业务镜像；GET仍不加载配置、迁移或写盘。新增完整生产模块的deferred屏障回归，覆盖pending、反序完成、启动/配置default晚完成及已完成headerless会话后出现权威绑定等12个场景，取代概率性复现证据。

整体最新计数、固定SHA和CI链接按本次交付报告填写；保留现有PR的全部审计范围、逐项结论和迁移/恢复限制，勿把整单描述改成只处理本次补修。GitHub集成写权限先前拒绝，按指示不重试API改PR说明。

## 独立复审P2：晚出现的权威绑定优先于旧runtime fallback

31c867a首部优先runtime.state.ws会使headerless会话的未绑定旧fallback遮住后来的registry绑定，偏离正式resolvePaths的优先级。本轮只把这一回退移动到按sid的只读解析之后，仍保持有效unattended锁/header优先。不改mirror、queue、业务解析或#209。

追加确定性场景先清空registry，让新headerless会话D执行并真正完成生产refresh；证实runtime.state.ws等于隔离的process.cwd、解析缓存是负结果。随后加入D的registry权威路径，并将负缓存at明确设为过期值；不sleep、不再业务refresh，通过真实诊断GET断言全部索引owner为D，runtime旧路径/default镜像仍未改、原文件字节未变、写盘计数0、runtime数量未增加。测试process.cwd也隔离到临时目录，结束恢复原cwd，避免未绑定刷新接触用户工作区。

扩展后同套12场景在31c867a完整模块下为11过/1失败，修正后12/0。只读指没有持久业务副作用；sessionWorkspaceFallback及文件索引的内存解析/digest缓存可以更新，不声称完全零内存变更。原A/B的11场景已被独立复审核实正确，本轮新候选仍待复审。

本轮P2红测试复跑（31c867a）：

```sh
git show 31c867a2e8263f341bd8000073fb767af33543d3:lib/index.js > /tmp/dam-binding-baseline.js
DAM_AUDIT_ENGINE_SOURCE=/tmp/dam-binding-baseline.js node tests/smoke/smoke-test-debug-index-owner.mjs
```
