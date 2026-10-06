# 2026-10-07 审计问题修复记录

## 身份与范围

基线7c0d61441ee4685bd9683fd05ca7ffcd7612f1ff：upstream main828050056cf053c53fb2c237706f6e89c7baef09，加#240/#242/#243/#244/#245/#246/#247的固定未合并PR头。修复范围为 [#248](https://github.com/Aik358/dsh-auto-memory/issues/248)–[#261](https://github.com/Aik358/dsh-auto-memory/issues/261) 共14个已发布issue。修复以草稿候选交付；没有远端合并、部署或关闭issue。原dirty checkout的tracked diff SHA256开始/复核相同。

## 修复取舍

| Issue | 最终行为与取舍 |
|---|---|
| #248 | 状态修改/默认整理使用实际读取版本CAS；成功读空保持空，冲突保留成功append。 |
| #249 | config外门→文档锁，共享磁盘权威与解析绑定回执；迁移等待已进入IO，旧目的地请求409保留payload重试。模型等待在锁外，保存后refresh也在锁外，避免等待环。 |
| #250 | 同步store接口不变；库锁内fresh-read三方delta合并disjoint新增，同ID冲突可见拒绝，clear全库CAS，dispose不复活删除；缺库只读不建目录。 |
| #251 | 资源取得即交已注册owner，启动失败同一rollback；卸载后等待模型/锁的任务不发起新写，已提交写入按事实记partial。 |
| #252 | mount拥有timer/listener/controller/slot；卸载与晚到响应以身份/存活门拒绝。 |
| #253 | runtime dispose清会话与孤儿capture；所有晚到index/decision/skill结果不得重建map或提交激活，共享Pythonworker保持独立会话关闭。 |
| #254 | 拒绝不能无损存回的多行字段；原Markdown定点Add/Done/Remove保留历史续行/手写内容，歧义删除拒绝，普通heading终止日期节。 |
| #255 | 完整有界512 corpus先检查冲突、评分、去重再raw64/kept8，不更改评分与shadow总闸。 |
| #256 | 必需reconciliation helper随实际staging携带，strict非空证据，源码及staging都能dry-run；不依赖.git历史分支。 |
| #257 | 同源敏感段在降维前准入，Tier0/Tier1/Tier2/final与M4一致；BOM仅用于首行识别，不改变字节/行号/digest。显式全文读取合同保留。 |
| #258 | 锁内旧durable身份先授权配置patch，写入提交前重新核权限，队列发送前freshmember/role；保留个人设置与合法editor/admin动作。 |
| #259 | 物理文件边界，读取验证返回的路径；合法根内链接允许、根外/悬空明确skipped。Linux实际filelink旧漏出/新通过；WinEPERM不记PASS。 |
| #260 | 每次串行追加按真实大小反复轮转，有界单行与文件数，失败可恢复。 |
| #261 | 自动日期任务一次尝试+running/succeeded/failed/partial回执；不自动重放可能已写/付费任务，显式手工重试关联前次失败。 |

## 独立复核

原作者之外三条交叉审查线发现并要求关闭：配置refresh等待环、空库load副作用、BOM首行漏检、ContextHost晚到状态/激活、卸载后pending维护新写、日历附录误删。旧候选负对照保留，作者补修后，原复现代理在当前生产源码上独立复测，所有确认 findings 已闭合。

原测试失败的shape/harness修复保留原语义断言；gate scanner仅加完整标识符边界，A–D及缺陷变异控制不删。真实Map30同tick只run1，29busy拒绝，flight回收为0。

## 验证边界

所有测试为合成隔离HOME/USERPROFILE/DSH_HOME。未执行真实DSH浏览器、实际提供者推理、团队服务、人类视觉验收或部署安装。

## 最终自动验证

测试生产提交：`99b18cd5bc916de13bf0dc166001e27d3200b993`。本报告提交只增加审计记录，不改变已测试的生产实现或测试。

| 环境 / 检查 | 实际结果 |
|---|---|
| Ubuntu / ext4，Node22.23.3，Python3.12.3 | 313 PASS / 0 FAIL / 0 TIMEOUT，313个选中套件全部通过 |
| Windows，Node24.15.0，Python3.12.10 | 310 PASS / 3 FAIL / 0 TIMEOUT；未标为全绿 |
| 源码与测试diff检查、index/client语法、skin生成器check | 通过；生成器 SYNC-OK |
| npm pack --dry-run | 145文件；四个新增运行时helper齐全；版本3.2.10，没有publish |
| 实际release源码与其staging再次dry-run | smoke-test-release-reconciliation通过，缺helper/module/marker/空证据/version/凭据/worker反例均拒绝 |
| 原dirty checkout保留 | 2001行git状态逐行相同，tracked diff SHA256与开始时相同 |
| 测试Windows源码身份 | 244个生产/工具/skin文件与固定tar逐字节相同，未因测试改写实现 |
| 上游/开放PR漂移 | main和7个开放PR的SHA再次核对一致 |

完整CI形状命令：

```sh
node tools/run-smoke.mjs --jobs=1 --timeout=90000 --exclude=-live --exclude=m79-feature-v2 --exclude=m710-fv2-emit --exclude=c4-fresh-install
node --check lib/index.js
node --check lib/client.js
node tools/build-iter5-skin.mjs --check
npm pack --dry-run --json
```

执行前将 HOME、USERPROFILE、DSH_HOME全部指向独立临时目录。Linux临时运行时提供 python → python3别名，与测试调用合同对应。未执行被明确排除的真实服务/遗留fixture套件，不把其标为PASS。

### Windows剩余3个失败

1. config-transactions：实际独立配置保存/迁移前置断言通过，但创建文件symlink返回EPERM。
2. v21-path-boundary：同前缀文件symlink创建返回EPERM。未改变Developer Mode/系统权限；完整相同套件和SEC259文件link矩阵已在Linux真实执行通过。
3. issue48：80次append/8store压力组的 `out.every(r.ok)` 失败。旧7c全套也曾有同断言失败；候选和旧基线有界单跑均37/37通过，额外固定archive/整套合成HOME对照也通过。失败未保存具体false reason，根因UNPROVEN，不能用单跑结果覆盖整套失败或认定超时原因。没有改生产或删断言来制造绿灯。

### 回归证据映射

| Issue | 仓库内可复跑证据 |
|---|---|
| #248 | smoke-test-note-snapshot-concurrency.mjs：6组snapshot/CAS/清空反例 |
| #249 | smoke-test-memory-migration-concurrency.mjs；smoke-test-settings-refresh-concurrency.mjs；实际双进程、别名/retarget与子任务drain |
| #250 | smoke-test-procedure-snapshot-concurrency.mjs；smoke-test-procedure-read-boundary.mjs；双进程merge/delete/clear/损坏保存/lock清理 |
| #251–#253 | smoke-test-host-startup-rollback.mjs；smoke-test-client-mount-lifecycle.mjs；smoke-test-context-session-cleanup.mjs；smoke-test-late-lifecycle-completion.mjs（9组）；公共appendEvidence正常及排队卸载反例 |
| #254 | smoke-test-issue254-calendar-preserve.mjs：最终10项，包含真实迁移/权限门及parser/Add/Done/Remove章节边界 |
| #255 | smoke-test-issue255-shadow-budget.mjs：后第65高分、置换、尾部冲突、去重provenance |
| #256 | smoke-test-release-reconciliation.mjs：源码无.git、真实staging和七类负控制 |
| #257 | smoke-test-issue257-sensitive-injection.mjs：实际read→Tier0/Tier1/Tier2/final/M4，BOM/noBOM×LF/CRLF×敏感/普通，原文fingerprint/行/字节保真 |
| #258 | smoke-test-issue258-team-policy.mjs：HTTP真实字段合同、配置/primitive/outbox及门内durable降权；普通设置与editor/admin控制 |
| #259 | smoke-test-issue259-export-boundary.mjs：根内/根外/悬空/calendar文件链接，目录链接控制；Windows不可创建项明确UNPROVEN |
| #260–#261 | smoke-test-audit-diagnostics-rotation.mjs；smoke-test-audit-diagnostics-maintenance.mjs：重复rotation/failure恢复/四态receipt/人工恢复/不自动重放 |

新反例分别在旧审计组合7c或引入缺口的49c/996固定候选上运行，真实失败记录保留于本地审计证据目录；没有把helper缺失的setup failure充当漏洞复现。独立审查线分别为security审并发、runtime审安全、dependencies/deadcode审生命周期/维护/发布/可观测性，原作者对发现缺口补修后由发现者复测。

宿主全文件守卫保持LF归一SHA16：`CE004B93701BC3E3`；client守卫使用原测试完整classic归一表达式，SHA256为 `8a271cb22cd62763e2ec05ab74735df4594c737936156cc48b3d965088efc062`。仅更新已独立审查的字节基准，没有放松严格比较或删掉生成守恒断言。

## 交付状态与剩余边界

14项issue对应实现和独立复核完成，候选保留为草稿。此分支包含7个开放PR的组合基线；其与main的diff不只本次修复。审阅修复增量应比较 `7c0d61441ee4685bd9683fd05ca7ffcd7612f1ff...99b18cd5bc916de13bf0dc166001e27d3200b993`。依赖PR合并/变更后必须重新建立基线并复跑，不能把本次候选CI当未来main或已安装版本验收。

没有实际DSH浏览器热卸载/重开、真实provider/团队服务器、设备、共享网络文件系统或人类视觉验收。没有合并、npm发布或部署，也没有因本地实现关闭issue。旧宿主/非协作外部编辑器不自动遵守新的文件事务协议；文档保留/冲突可见合同不能被理解为所有外部编辑都已同步。
