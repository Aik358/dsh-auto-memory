# v3.2.7 源码审计修复结论（独立复审待完成）

最新上游基线：`131ca794b9f0d07f78b19bf6feee3312939854ed`。相对原审计SHA `13f980ac3e199bbe4c7a488bb493f278c7d8017f`仅增加两项FUNDING.yml提交，产品代码相同。未混入清理PR #168。

代码提交：`be2af639808c91c7bdfcde8b06852abbb46cfd24` 首批；`26195e1391d6f51b3a9206defb4bff3295c2e1fd` 首批复审补修及后续修复。`3792ca863849bb0f94d139e31538fac6089b19a6` 本轮独立复审指出的隔离/事务/真实UI接线补修。`a8786c092be679f1a49feb550ace686ca3cc73a6` 日历别名路径自锁最终窄修。首批不能独立视为已过审，以当前最终diff为准。

“修复”表示分支已实现并经过所列隔离回归，仍待委托人的独立复审；不代表已合并或已在真实用户服务验证。30项新问题与5项旧残留均有修复候选，未发现可直接排除的上游已修项或反证。F24明确撤回，不计入。

| ID | 结论 | 修改与证据 | 验证套件（smoke-test-audit-*或既有套件） |
|---|---|---|---|
| [F01 #178](https://github.com/Aik358/dsh-auto-memory/issues/178) | 修复 | 完整归档后才应用折叠/容量护栏；归档失败保留原文。 | data-safety |
| [F02 #184](https://github.com/Aik358/dsh-auto-memory/issues/184) | 修复 | 挂载只请求一次真正只读的debug快照；该GET不refresh/load/migrate/写台账，真实注册路由200且文件内容不变。 | ui-wiring / review-regressions |
| [F03 #179](https://github.com/Aik358/dsh-auto-memory/issues/179) | 修复 | v2 稳定工作区键；歧义旧目录保留且警示，确认归属后分阶段迁移并重绑定技能。 | retrieval-isolation |
| [F04 #180](https://github.com/Aik358/dsh-auto-memory/issues/180) | 修复 | 保留外工作区未落盘状态，仅消费视图过滤；成功scope转移按已提交磁盘归属重载；JS/Python捕获原始路径身份，保留POSIX大小写。 | retrieval-isolation / procedure-hosts / review-regressions / m83 |
| [F05 #181](https://github.com/Aik358/dsh-auto-memory/issues/181) | 修复 | 隐式纠正归因限当前会话与工作区；显式ID禁止另行惩罚最近记忆。 | context-evidence |
| [F06 #182](https://github.com/Aik358/dsh-auto-memory/issues/182) | 修复 | --:-- 可解析、修改及迁移合并。 | data-safety |
| [F07 #183](https://github.com/Aik358/dsh-auto-memory/issues/183) | 修复 | 新事实事实性拒绝发生在撤销旧事实之前。 | data-safety |
| [F08 #185](https://github.com/Aik358/dsh-auto-memory/issues/185) | 修复 | enqueue 与 flush 首次操作均恢复持久队列；start→tick→flush无需新入队。 | data-safety / team-outbox |
| [F09 #186](https://github.com/Aik358/dsh-auto-memory/issues/186) | 修复 | render改用this；独立安装自写豁免；配置路径/工作区键统一；路由绑定session；水位/快照及外部记忆扫描cache/inflight分工作区。 | host-wiring / global-brief / review-regressions |
| [F10 #187](https://github.com/Aik358/dsh-auto-memory/issues/187) | 修复 | transfer-scope 在分支前声明pid；成功迁移后磁盘scope优先，旧内存不复活。 | host-wiring / review-regressions |
| [F11 #188](https://github.com/Aik358/dsh-auto-memory/issues/188) | 修复 | 宿主提供 manager消费的 notesPath/logPath。 | host-wiring / m10 |
| [F12 #189](https://github.com/Aik358/dsh-auto-memory/issues/189) | 修复 | 不同corpus并发重建等待后重查自身miv，不复用他人的promise结果。 | retrieval-isolation |
| [F13 #190](https://github.com/Aik358/dsh-auto-memory/issues/190) | 修复 | Tier使用真实CorpusRegistry同域miv及与host投影相同的workspace身份；非空实际语料与Windows路径复用通过。 | retrieval-isolation / review-regressions / t0-2-version-gate |
| [F14 #191](https://github.com/Aik358/dsh-auto-memory/issues/191) | 修复 | expand纳入PLAN与最近交接账本；修复错误的this.latestLedgerNamePre调用。 | retrieval-isolation / three-layer |
| [F15 #192](https://github.com/Aik358/dsh-auto-memory/issues/192) | 修复 | drop清理claimedPacketId；host清理明确drop/expired的缓存包，保留普通eager pump。 | host-wiring / m63 |
| [F16 #193](https://github.com/Aik358/dsh-auto-memory/issues/193) | 修复 | 硬信号直接通过arm比例门；显式关闭、冷却等门保持。 | host-wiring / water |
| [F17 #193](https://github.com/Aik358/dsh-auto-memory/issues/193) | 修复 | 缺省官方参数保持undefined，preset能接管；显式覆盖包括零headroom保持，三面UI输入零不再被默认值覆盖。 | host-wiring / ui-wiring |
| [F18 #194](https://github.com/Aik358/dsh-auto-memory/issues/194) | 修复 | 日文hubScopeCounts恢复为函数。 | ui-wiring |
| [F19 #195](https://github.com/Aik358/dsh-auto-memory/issues/195) | 修复 | 按session及正文revision缓存；内容变更更新；失败不缓存；缓存有界。 | ui-wiring |
| [F20 #196](https://github.com/Aik358/dsh-auto-memory/issues/196) | 修复 | 皮肤选择广播到两个挂载根以切换组件树；移除无效setNonce。共享CSS效果订阅皮肤事件，单独挂载设置/面板时也更新；源与产物同步。 | ui-wiring / generator-guard |
| [F21 #197](https://github.com/Aik358/dsh-auto-memory/issues/197) | 修复 | 健康状态接受verified-ok并兼容ready。 | ui-wiring |
| [F22 #198](https://github.com/Aik358/dsh-auto-memory/issues/198) | 修复 | 安装后版本读取调用engine.readTextSafe。 | host-wiring |
| [F23 #199](https://github.com/Aik358/dsh-auto-memory/issues/199) | 修复 | 首次工作台null状态安全取greetCount。 | data-safety |
| [F25 #200](https://github.com/Aik358/dsh-auto-memory/issues/200) | 修复 | readline保留跨块和最后无换行记录，本轮达限立即中断并关闭流，不等待下一条巨型行；真实流bytesRead有界。 | retrieval-isolation / review-regressions |
| [F26 #201](https://github.com/Aik358/dsh-auto-memory/issues/201) | 修复 | 文档token只包装一次；510正文预算；chunk policy升级触发旧向量失效。 | python-embedding / m73 |
| [F27 #202](https://github.com/Aik358/dsh-auto-memory/issues/202) | 修复 | gpu配置选择CUDA→CPU provider链；CPU配置保持CPU。 | python-embedding |
| [F28 #203](https://github.com/Aik358/dsh-auto-memory/issues/203) | 修复 | 恢复富entries后重建by_tag/by_cue；倒排字典使用无原型对象，支持constructor/toString/__proto__。 | host-wiring / review-regressions / graph-mode |
| [F29 #204](https://github.com/Aik358/dsh-auto-memory/issues/204) | 修复 | Actions事件类型读取GITHUB_EVENT_NAME；测试完全假GitHub且QQ关闭。 | report-sync |
| [F30 #205](https://github.com/Aik358/dsh-auto-memory/issues/205) | 修复 | 新用户目录先创建；复制失败不发布新配置；排除锁/临时文件；迁移参与日历双端锁；配置保存串行避免丢并发patch；物理路径去重避免同目录自锁。 | data-safety / review-regressions |
| [F31 #182](https://github.com/Aik358/dsh-auto-memory/issues/182) | 修复 | 新鲜读盘、仅吞ENOENT、原子日历写、文件级跨进程事务；迁移期间add/done/remove和包导入旧请求重解析路径；锁归一物理路径，symlink别名也串行；路径变化重试先释放旧锁，三条日历操作不再同物理锁自等。 | data-safety / calendar-processes / review-regressions |
| [R01 #82](https://github.com/Aik358/dsh-auto-memory/issues/82) | 修复 | 局部nextConfig，原子落盘成功才发布；mkdir/序列化/写失败保留旧内存和旧配置；purge在成功后；并发patch排队合并。 | data-safety / review-regressions |
| [R02 #160](https://github.com/Aik358/dsh-auto-memory/issues/160) | 修复 | 三种皮肤入口传previewToken；后端必需并重算目标字节，变化拒绝导入。 | host-wiring / migrate-safe-import |
| [R03 #117](https://github.com/Aik358/dsh-auto-memory/issues/117) | 修复 | 每次追加重新检查rotate，连续轮转。 | data-safety |
| [R04 #92](https://github.com/Aik358/dsh-auto-memory/issues/92) | 修复 | 当前会话degrade映射，不再fallback全局最近降级。 | host-wiring |
| [R05 #93](https://github.com/Aik358/dsh-auto-memory/issues/93) | 修复 | 每条候选按其真实sourceRef对应digest计算coverage。 | context-evidence |

## 验证与限制

- 重新运行未修改产品基线：241 PASS / 3 FAIL / 0 TIMEOUT。
- 最终产品提交a8786c092be679f1a49feb550ace686ca3cc73a6，本地Node22.23.3按CI参数串行全量：251 PASS / 3 FAIL / 0 TIMEOUT（134.3s，254套，新增10套audit）。诊断配置与数据全部临时隔离，memoryFileIndex开启分支也通过只读验证。
- 对应fork Node22.23.3 CI：[run36971892310](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36971892310)：251 PASS / 3 FAIL / 0 TIMEOUT（128.0s）。最新后续提交只更新报告、问题编号及历史材料发布状态，不改变产品或测试代码；将另外检查其远端CI。
- 历史相同产品代码补修CI：4d97eb6的run36970899464为251/3/0（126.4s）；464216e的run36971264747为251/3/0（137.7s）。
- 前一轮3792ca8 CI run36970675676出现额外`js-semantic-host-recovery`失败（250/4/0）；CI只保留失败套件最后25行，未含具体失败断言。相同产品代码下一轮CI全套恢复251/3/0；下载与CI相同的Node22.23.3后，该套件本地隔离6/6通过。额外失败表现为间歇性，具体原因未证明，没有擅改无关超时参数或隐藏失败。进一步相同Node22.23.3、两CPU亲和性、4套并发下，原13f980基线与修复分支交替各6次（各36子测试）全通过；完整原始输出保留在本执行环境`/tmp/dam-recovery-compare/`。这些复测没有还原该失败，不能据此定性为无害。前版26195e1的249/3/0只作为历史证据。
- 日历别名自锁可复现：用464216e生产index和新增真实排队回归，约10秒后明确`calendar-lock-timeout`；a8786c0同回归通过，add/done/remove都实际跨越alias配置提交。
- 三项基线失败分别为issue109-policy-parity缺`lib/policies`、py-runtime-chain缺开发venv、s2-skin缺assets。没有混入#168清理或#169–176既有问题的无关修复。
- 新测试使用临时DSH_HOME/数据目录、假模型和假GitHub传输；本地全量运行额外拦截外网，只允许loopback及data:。无真实模型、QQ或外部通知调用。
- UI以真实函数/hook/事件处理测试及生成器严格检查验证，未在真实DSH桌面GUI点击。GPU只验证provider选择和假会话输入，无GPU硬件/模型实测。
- F03旧扁平桶无法从名字恢复归属，因此保留原数据并显示警示，不静默分配。停止旧写入实例、核对内容与备份后，在相应旧桶写`.workspace-owner.json`，内容`{"workspace":"工作区的绝对路径"}`，再刷新迁移。配置根与默认hub根的旧桶各自确认归属；已有新桶不覆盖，使用迁移包显式合并。原目录保留，stage失败不会发布半成品。
- F17旧配置中已持久化的0.8/65536无法判断是否用户显式设置，因此保留其显式含义；要使用preset须移除这两个覆盖键。
- 日历锁记录host/PID；同机确认死亡的事务owner可自动恢复，活跃/外机/未知owner绝不按年龄抢锁。极小同步获取阶段崩溃留下`.lock.acquire`时保守报超时；停止所有实例、检查owner及备份后才能人工删除孤儿锁文件，不得在运行时强制删除。

## 材料与发布阻塞

Library原docx按规定prepare/helper流程尝试及重试各一次，均`download failed`，没有虚构下载成功或猜URL；完整问题清单足以开展本轮工作。原20页文件未读取。

integration此前`gh issue create -R Aik358/dsh-auto-memory`被`GraphQL: Resource not accessible by integration (createIssue)`拒绝；`gh pr create --draft`被`Resource not accessible by integration (createPullRequest)`拒绝，未绕过身份。

发布状态已由父任务核实：用户账号Minervaowl7提交本轮28条issues **#178–205**，五条旧残留评论也已提交到#82/#160/#117/#92/#93；本执行环境抽查#178与#205作者、题名及URL相符。逐项表和issues.json现关联已有编号，原正文文件作为历史提交材料保留，不再创建或提供新issue草稿。这不表示integration写权限恢复。上游draft PR仍未创建成功，正文见draft-pr.md，由授权维护者提交。

Fork分支：`Minervaowl7:fix/audit-data-safety-20261002`。上游PR预填比较入口：
https://github.com/Aik358/dsh-auto-memory/compare/main...Minervaowl7:dsh-auto-memory:fix/audit-data-safety-20261002?expand=1

仅推送fork；未合并上游PR、发布版本或部署。上游draft创建受阻不影响代码和可提交正文交付；独立复审是否最终通过由委托人判定。
