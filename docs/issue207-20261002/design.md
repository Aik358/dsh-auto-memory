# #207 限定状态持久化修复候选

基线是2026-10-02重新fetch的上游main：131ca794b9f0d07f78b19bf6feee3312939854ed。#206 head857a422、#208 head513b613及#209 head1a4a6c4均未修本次三处持久化。分支fix/state-persistence-207-20261002独立从main创建，未导入其他PR，未改其分支。shared-state-lock独立复用已审查的calendar-lock算法，不依赖#206模块。

范围只包含接续编号、永久来源闩锁、归档时间账本。greetCount已在#199/#206处理，不重复修改；WASM/CDN通用结论没有证据，不在本补丁。归档问题是多engine/process共享目录时的整对象覆盖风险；同engine共享_saLedger不能据此推断普通同实例旧快照覆盖。归档时间丢失主要阻止自动删除，不等于立即丢正文。

## 接续编号

alloc在跨进程锁内重新读取、冷扫描、推进并原子提交。只有ENOENT是缺失；无效JSON/UTF-8、负数、非安全整数和权限错误均拒绝操作并保留原文件。历史JSON格式保持last/byWorkspace/updatedAt。冷初始化扫描全部会话的所选持久化版本，避免旧120文件封顶漏掉最大编号；无法读取/解码历史就拒绝猜测零。历史匹配规则与所选版本规则沿用原实现，首扫延迟取决于历史规模。

编号是持久预留，返回前写盘成功。文件数+1和常量1降级取消。写包失败不回收已发编号；rollbackContSeq保留兼容入口但不降低高水位。允许空号，防止晚到消费者、多实例及重启再次拿到已发序号。进程高水位只在提交成功后发布，文件被意外移除时同engine也不后退；不承诺抵御外部删除/旧备份恢复或不合作旧版本写入。

## 永久来源闩锁

旧auto-continue-done.json的字符串数组与sessions数组均只读兼容，原字节不改、不截200条、不覆盖坏证据。已有旧版本早已丢掉的200条以前记录无法凭空恢复。

新增auto-continue-done.d/<SHA256规范来源ID>.json：每条来源独立永久记录，不维护不断增长的缓存Set，不重写全部历史。身份最多4KiB，记录读取上限64KiB；单文件尺寸有界。总存储必然随接续来源数线性增长，要保证永久一次就不能按时间/最近200条偷偷删除身份。旧aggregate JSON读写上限32MiB，过大显式失败而非截断。旧插件不能理解新分片；共享目录所有写入实例必须升级，降级不能仅依赖旧JSON丢弃新记录。

宿主在外部取消/创建之前持久化pending来源预留；不同engine同时准备材料也只有一个能预留并创建。新会话投递前再持久化后继ID。材料投递成功后才完成done；完成写失败明确返回ok:false、continuationPending与后继ID，并保持原pending。投递异常不能仅凭报错字符串证明远端未接受，保守保留pending，重启/再次手动请求亦返回pending及后继ID。副作用前失败会按token移除自己的预留，失败的移除仍留保护并报告。

这是有意的兼容取舍：未核实的投递异常不自动重试，不宣称远端exactly-once。创建成功后即保留pending并保存原始后继ID，后续保存失败亦不自动解除；错误文本与当次GET状态返回实际新会话ID。保存失败再重启时，磁盘不知道后继ID，不猜测或补前缀。旧去前缀记录只显示successorKey，原始ID必须由操作者核实。

正式只读入口为auto-continue GET状态（pending/completed可跨重启读取）和随npm包发布的维护命令。维护命令须从已安装包根目录运行（包含lib/的目录），或将脚本改为安装位置的绝对路径；DSH_HOME指向真实共享数据根。恢复时核实宿主实际后继及是否投递：

```sh
DSH_HOME=/actual/home node lib/continuation-maintenance.js status --source session-SOURCE
# 已投递：只补本机done，不再创建或投递
DSH_HOME=/actual/home node lib/continuation-maintenance.js complete --source session-SOURCE --token TOKEN --expected-successor 'CURRENT_DISK_TO' --successor session-ACTUAL_RAW_ID --confirmed-delivered
# 确未投递：解除后才可重新请求；未知结果不得执行
DSH_HOME=/actual/home node lib/continuation-maintenance.js release --source session-SOURCE --token TOKEN --expected-successor 'CURRENT_DISK_TO' --confirmed-not-delivered
```

CURRENT_DISK_TO必须精确取status.expectedSuccessor（未知则空串），不能把规范化key当原始宿主ID。两种恢复操作都校验当前pending/token/后继快照；完成另校验核实的原始ID。缺确认、旧token、错误后继、已完成记录均拒绝。共享active锁拒绝恢复正在运行的接续，避免投递中解除闩锁。pending不按时间/进程死亡自动解除。确认是操作者对实际结果的声明，命令本身不访问真实用户服务。

legacy /handoff-continue只构造材料，仍不把权限回调冒充接续完成。它现在必须真实持久预留编号，不能绕过编号锁；不声称能够约束旧客户端在插件外独立执行的远端创建/投递动作。

## 归档账本

每次巡检新鲜读取；save在跨进程锁内重读并合并本次实际归档delta与显式删除ID，不写整缓存快照。相同ID保留较新的真实归档时间，避免过早删除；无关实例的条目保留。JSON格式保持旧平面ID→时间戳。

原子替换失败保全已提交文件，错误不吞。巡检返回ok:false和archive-ledger错误并记诊断；新归档记录提交失败时本轮停止删除。真实归档动作已发生但时间未保存的来源仍是未知年龄，不从mtime、当前时间或下次重试猜测归档时间，继续禁止自动删除。操作者须核对实际时间后恢复记录；普通写入故障解除后可重试明确delta。正文删除完成而账本清理失败时保留旧账本并报告，不把整个巡检说成成功。

锁用物理路径归一化，支持同机新版本实例/进程及父目录symlink别名；状态文件本身的leaf symlink明确拒绝，保持链接与目标字节，避免锁目标和rename目标不一致；同机确认死亡PID的事务锁可恢复，活跃/外机/未知owner不按年龄抢锁。孤儿.acquire门保守超时，须停所有实例后核对并处理。未知网络文件系统语义、跨机器自动锁恢复、外部编辑器、不合作旧版本与突然断电后的目录项持久性不作保证。

## 已有证据

真实完整MemoryEngine首轮红测试四项全部失败：编号拒绝写仍返回、闩锁拒绝写仍返回、205条重启丢最早记录、归档拒绝写吞错。首轮修复后10项状态回归通过，复审补修新增文件分类、SQLite和leaf alias回归；还覆盖原子rename拒绝/旧字节保全、损坏与读权限拒绝、冷扫描两实例屏障、rollback/重启、两种旧闩锁格式、归档delta合并及正式巡检未知年龄保护。

三个新suite均使用完整生产模块：正式apply注册legacy HTTP handler与正常decide/host路径；四个真实子进程共享HOME含symlink别名，验证冷历史#87起连续24个唯一号、唯一来源闩锁、归档合并、重启及SIGKILL已确认死亡锁owner恢复。新测试临时HOME/DSH_HOME，假控制器/假fetch，未调用模型、QQ、外部通知或真实用户服务。旧抽取式流程测试仅适配新增依赖；新suite补真实模块与IO证据。源码指纹按此限定变更更新，未删断言。

限定产品源码冻结在5bc5e2d57eff3f32abeebb0c2b0a1a149daf0d25，已由两位独立原生审查者通过复审，上轮阻塞全部关闭。收尾仅纠正旧token回归与交付文档，不改产品范围；整体回归及对应fork CI记入validation.md及最终报告。未创建上游PR（既有integration权限拒绝，按指示不重试），未合并/发布/部署。

## 复审补修的冷迁移政策

冷扫描分类目录与普通文件：sessions根和工作区的普通文件不会作为目录打开；真正的权限/读取/解码故障继续显式拒绝。SQLite历史没有可靠的标题覆盖证明，存在sessions.sqlite等数据库时不假设JSONL覆盖所有历史，不分配猜测编号。此时须核对全部历史接续最大值，使用正式维护入口：

```sh
DSH_HOME=/actual/home node lib/continuation-maintenance.js seed-counter --last VERIFIED_GLOBAL_MAX --confirmed-history-reviewed
```

seed拒绝负数、非安全整数、降低已有全局/工作区高水位及未经确认操作。零不能绕过冷迁移；核实数据库确为空时可显式预留1（产生空号），随后从2开始。已存在正高水位无需冷扫描。此人工核验政策是兼容限制，不宣称自动迁移SQLite标题。实测同时有JSONL/SQLite及SQLite-only均明确拒绝，核实seed后正式alloc继续。
