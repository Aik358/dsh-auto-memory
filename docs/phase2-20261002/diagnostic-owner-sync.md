# PR209 同步审定诊断归属修复

2026-10-02重新核对：上游main为131ca794b9f0d07f78b19bf6feee3312939854ed，PR206/209均未合并；#206审定head ec1501e40ae1778b81942272d7c423883fc3078e，#209原head1a4a6c4e1d59d3ece3cbf63d9b5b5490d57b124d。本次已获用户明确授权同步及必要补修，未扩展其他issue。

## 依赖与冲突

#209原已包含#206的857a422审计基线；本次正常merge #206后续31c867a与ec1501e，保持历史依赖明确，不force push。产品只有debugInfo首部变更，采用审定的currentRuntime.agent或_lastAgent owner、有效unattended锁/header优先、sid权威绑定优先于owner runtime旧fallback，再回退default/cwd的只读逻辑。余下文件状态与索引共用选定p，不改变mirror、runtime queue、团队/PLAN产品内容或诊断公共接口。

三方合并仅在debugInfo首部和index源码指纹发生冲突。首部逐段采用审定ec1501逻辑；组合指纹重新计算，保留#209路由数70（#206为69），没有用#206整文件覆盖。新12场景suite与ec1501字节一致。issue162 harness只新增currentRuntime/peekRuntime三行依赖，原#209隐私断言与附加测试均保留。继承的docs/audit-20261002/diagnostic-owner-followup.md是#206补修历史；其中“不改#209”的表述针对先前阶段，此文记录随后得到授权的同步。

## 确定性验证

未同步的1a4a6c4完整模块（独立detached树）运行同一12场景为7/5，失败包括原先四场景及后来出现的权威绑定。同步后正式apply/生命周期/诊断GET回归12/0，issue162为26/0。deferred IO入口屏障真正等待刷新完成，无sleep当完成证据。覆盖B pending、B先完成A后完成、启动/配置default晚完成、ALS优先、已有runtime/headerless绑定、unattended锁及过期负缓存后权威绑定。

每次GET检查不加载配置、不迁移、不业务refresh、不写盘、不增加runtime，原文件字节保持不变。只读表示没有持久业务副作用，内存解析/digest缓存可以更新。测试HOME/DSH_HOME/cwd隔离，模型/L0后台嵌入及通知服务隔离，没有真实模型、QQ或用户服务调用。

完整限定分支及固定head CI结果由最终交付报告补充，CI不以旧结果替代。组合#208资源和#210状态仅在独立detached树验证，不推集成、不修改这两分支；#206与cleanup保持原样。未创建重复PR，不重试曾拒绝的描述API写权限；未合并、发布或部署。本候选待父任务独立原生复审。

## PR209 描述追加建议

本PR继续依赖#206审计基线，并合入其审定诊断归属补修ec1501e。诊断在异步读前选定ALS/最近agent，锁/header及会话权威绑定优先于旧runtime/default fallback，各文件状态和索引共用同一owner路径。保留团队/PLAN产品内容、70条路由及隐私断言；GET无配置加载、迁移、刷新、持久写入或runtime创建，允许内存解析缓存更新。完整生产模块deferred屏障回归12/0，原1a4a6c4为7/5；整体最新计数及固定CI链接按交付报告填写。
