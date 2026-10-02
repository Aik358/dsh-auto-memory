# #207 候选固定提交与验证

最终产品冻结：`f7d3b787dc9f2c38656a829eb964d91f5c3a7788`。首个产品提交`088d80f0a41e63241dac3eaeff82376385f56617`；f7d3b78只补冷迁移压缩残帧校验及对应回归。其后交付提交仅增加证据、PR正文、真正的自动tick回归及修正旧测试注释，不改产品。

基线重新fetch仍是`131ca794b9f0d07f78b19bf6feee3312939854ed`。新分支`Minervaowl7:fix/state-persistence-207-20261002`。现有#206 head857a422、#208 head513b613、#209 head1a4a6c4、#168 head85ef119保持不动。旧baseline三个失败不通过导入其它PR隐去。

## 故障证据

[baseline-reproduction.json](baseline-reproduction.json)是真实完整MemoryEngine、Node22.23.3、实际fs拒绝写生成的输出：last=12时连续分配13/13，磁盘仍12；闩锁返回true、缓存命中但磁盘不存在；205条后旧JSON只剩200，重启最早来源不命中；archive写失败不抛、磁盘仍旧条目。原四项拒绝/保全回归在旧源码下0/4、新实现通过。完整模块来自tests/lib/state-engine.mjs，仅在临时副本暴露内部类，不提取/改写被测方法。

可复跑：

```sh
git show 131ca794b9f0d07f78b19bf6feee3312939854ed:lib/index.js > /tmp/issue207-main-index.js
DAM_STATE_ENGINE_SOURCE=/tmp/issue207-main-index.js node docs/issue207-20261002/reproduce-baseline.mjs
```

脚本检查原baseline源码SHA-256，自动使用临时HOME/DSH_HOME并清理；源码不是原基线时拒绝执行。

## 回归结果

- issue207-state：10 PASS / 0 FAIL。覆盖真实rename拒绝与旧字节保全、损坏JSON/UTF-8/权限拒绝、失败恢复、冷初始化屏障、rollback不降、重启和>200来源、两种旧格式、归档delta合并/删除及巡检未知年龄不删。冷扫描125条历史（最大编号在最旧文件）以及完整双zstd帧/残帧拒绝均经过真实文件测试。
- issue207-processes：四个真正Node子进程，原目录/symlink别名共享HOME；历史#87后24个唯一编号88..111，来源仅一次标记，三个归档delta保全，重启继续112；持锁子进程SIGKILL后同机确认死亡owner恢复并继续120。它证明持锁未写时的死亡恢复，不宣称覆盖每个rename/断电点。
- issue207-routes：完整正式apply、注册legacy HTTP handler及生产decide/host/tickAutoContinue。编号提交拒绝时真实路径拒绝且没有创建；并发legacy请求编号不同；投递已接受而done提交拒绝保持pending、返回后继、重启阻止第二次创建；恢复只提交本机done；两个真实engine同来源仅一个创建；未知投递保护；副作用前失败解除后可重试；真自动arm→到期tick→创建/完成闩锁通过。控制器/fetch都是本地假服务。
- 相关既有contseq 20/0、autocont-host 106/0、continuation-transaction 13/0、continue-host 40/0。旧抽取式测试新增依赖明确由假的状态边界提供；新增真实模块suite覆盖实际IO，未把这些unit假边界当持久化证据。
- build-iter5-skin --check --strict与完整diff空白检查通过，无client/skin产物修改；src指纹按限定index变更更新，原断言保留。

## 整体及CI边界

本地最终f7d3b78产品、Node22.23.3全量：**244 PASS / 3 FAIL / 0 TIMEOUT，134.0秒**，247套。参数为run-smoke --jobs=1 --timeout=90000，排除-live、m79-feature-v2、m710-fv2-emit、c4-fresh-install。独立临时HOME/DSH_HOME；预加载fetch/http/https外网守卫，只放行loopback/data；无真实模型、QQ、通知或用户服务调用。

三项基线失败逐项为issue109-policy-parity缺lib/policies，py-runtime-chain缺本机开发venv，s2-skin缺assets。没有修其他issue，也不重复greetCount或接受通用WASM/CDN断言。

[最终产品f7d3b78 CI36999025570](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36999025570)：**243 PASS / 4 FAIL / 0 TIMEOUT，138.0秒**。额外失败js-semantic-host-recovery，内部5/1；runner只给最后25行，缺具体失败断言。对应lib/semantic-js.js与该suite相对main字节未改。相同Node22.23.3隔离单跑6/0；这些事实不能唯一归因该远端失败或称其无害。旧夹具缺陷与修复归#208；本分支不导入其改动。CI不能称全绿。

[前一088d80f CI36998669854](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36998669854)：244/3/0，137.4秒；本地准备阶段242/5包含H12旧自动重试预期和旧源码指纹，两者已定向更新后244/3。旧结果不代替最新。

后续证据/自动tick测试交付提交的准确head及其CI在最终交付报告列出；产品冻结与CI以上述表为准。限定代码仍待父任务独立复审，未宣称通过审查。

## PR与边界

[可提交标题正文](pr-body.md)。上游compare：
https://github.com/Aik358/dsh-auto-memory/compare/main...Minervaowl7:dsh-auto-memory:fix/state-persistence-207-20261002?expand=1

既有integration的createPullRequest权限拒绝按指示不重试，不换身份；未创建或改动#208/#209，未合并、发布或部署。只Refs #207，不关闭整单。

永久分片总体空间线性增长，不能同时承诺永久记忆和恒定总空间；单记录身份/文件、旧JSON读取、锁等待有明确界限。未知pending必须核实真实后继/投递后恢复，不能按时间/PID盲目解除。旧200裁剪已丢身份无法恢复。所有共享写入实例须升级；跨机器恢复、不合作旧版/外部编辑及突然断电的目录项持久性不在证明范围。归档动作已发生而时间未提交时仍未知年龄，不造时间、不自动删除。完整取舍及恢复方法见design.md。
