# 第二阶段最终验证记录（2026-10-02）

本记录与两份 PR 正文均随 fork 分支提交，远端可读。限定产品代码已经独立复审通过：资源/锚点修复、#164 四项补修、#174 其余补修及最后出队持久化 P2；最后窄复审针对196099dd。此后只修测试夹具与文档，没有修改产品代码。

## 基线与分支

最终重新 fetch 上游 main：`131ca794b9f0d07f78b19bf6feee3312939854ed`。原审计13f980ac之后仅两次FUNDING变动。PR #206 head `857a422a602a0b5aee9b9e3f4fb6b311dae936a9` 和 PR #168 清理 head `85ef119ac21b2f8da92c991ed0d1c8a8622cc4fe` 远端仍原样，未覆盖或混入清理改动。

| 范围 | 基点 | 最后产品 / 测试冻结提交 | 分支 |
|---|---|---|---|
| #170资源、#177 Tier-0 | 最新上游main | 产品/原子夹具394253233708c1b4066e12fa4f44dbb725d69d03；诊断测试ac0be33d22bad8d0f94e38f4366cc81075e599c5 | fix/resources-tier0-20261002 |
| #174团队、#164共享PLAN本地CAS | PR #206 head857a422 | 最后产品1b4ce6cb9b5b5a1d4a9e7241a718aa813825a184；原子夹具196099dd1d315634fa3a414d6fda1977aa8fe65b；诊断测试e9f4d89ac55d1a745b52cc4de25a27b616eaa70f | fix/team-plan-20261002 |
| 最终临时集成，不推送 | 上述全部产品与测试 | d0f9ed3731fd633c8ae2bfd10441c03ca3eeab67 | 临时独立worktree |

资源分支独立于 #206，不能把 #206 的只读诊断断言带入它。ac064f5中误同步的两项断言及两个harness目录适配在ac0be33纠正；3942532..ac0be33最终测试diff仅为时间戳误判修复，无 #206 产品代码或清理代码。团队分支不包含84个资源文件。

## 最终测试与远端 CI

| 冻结提交 | 来源 | 结果 |
|---|---|---|
| ac0be33 | [资源分支CI36993388904](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36993388904) | **247 PASS / 0 FAIL / 0 TIMEOUT**，136.6秒 |
| e9f4d89 | [团队分支CI36993335651](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36993335651) | 257 PASS / 3 FAIL / 0 TIMEOUT，139.9秒 |
| d0f9ed3 | 本地最终隔离集成，Node22.23.3 | **263 PASS / 0 FAIL / 0 TIMEOUT，137.3秒** |

团队独立 CI 的三项失败已逐项核对：issue109-policy-parity缺lib/policies；py-runtime-chain要求本机开发venv；s2-skin缺assets。资源分支恢复资源并将机器专用Python回归拆成真实临时子进程/venv的离线回归与单独opt-in live验收；集成补齐这些依赖后全量通过，不把团队独立 CI 记为全绿。

最终集成使用单线程suite队列、每套90秒限时，参数：

```sh
node tools/run-smoke.mjs --jobs=1 --timeout=90000 \
  --exclude=-live --exclude=m79-feature-v2 \
  --exclude=m710-fv2-emit --exclude=c4-fresh-install
```

HOME/DSH_HOME使用临时目录。预加载守卫拦截fetch/http/https外部用户服务，仅放行本地loopback及data；真实团队网络、模型、QQ、外部通知均未调用。suite最终263项全部完成。最终产品/测试diff、空白检查、生成器build-iter5-skin --check --strict通过，临时集成worktree干净。

## 最后持久化修复与夹具证据

最后P2的真实HTTP成功后outbox目标rename注入EPERM：旧ebbdcd0生产代码配新增回归失败（expected failed=1，actual=0）；1b4ce6c先落候选队列再内存出队，失败保留旧磁盘和全部内存条目（含等待期间新增项），sync/UI报告当前失败。恢复文件系统后持久出队并恢复当前健康，历史错误仍保留。取消代际不写旧队列、不继续发送或应用。远端已确认而本机未完成出队时可能重发，没有新增远端幂等协议。

JS semantic recovery测试的control JSON由原裸覆盖改为完整stage+rename；25ms空文件窗口机械复现原recovery-scores断言，日志含Unexpected end of JSON input；原子stage仍故意保持25ms不完整，但正式控制文件完整，6/0。冷却、scores、恢复、缓存断言保留。生产semantic engine未改。

issue162诊断测试原正则拒绝任意独立数字39。固定Date.now为2026-10-02T09:51:39Z，原测试21/4，失败输出都是合法诊断时间戳；收窄为旧39会话文案后26/0。新增自检接受时间戳/合法计数39，同时拒绝中英文旧会话文案及全部原敏感信息标记。e9f4d89仅该测试修复。资源分支同一修复保留其上游诊断行为断言。

历史远端失败需要保留：1b4ce6c CI36991609988为256/4/0（3基线+旧JS控制夹具）；196099dd CI36992065498为256/4/0（3基线+issue162，内部24/1）；资源26bf569 CI36987389948为246/1/0（JS recovery scores）。早期fc25 CI36981307760为246/1/0（issue162内部23/2）。旧runner只留最后25行，部分具体失败断言已丢失。受控时钟与JSON窗口确认了真实测试缺陷，但不能唯一追溯每个历史远端失败；不把它们称为无害偶发失败。当前完整CI及最终集成结果另列，不能用旧结果替代。

## 剩余边界与交付

- #164只完成共享白板本地卡片/文件版本冲突保护，不实现职责来源系统：session/task显式绑定、版本/撤销、经验证接续继承仍待产品决定。本PR不用Closes #164，不加入未经批准的ROLES.md或自动角色。
- PLAN外部编辑器不遵守插件锁时，最后内容检查到rename仍有不协作进程竞态；不能宣称磁盘强制CAS。SIGKILL回归证明持锁未写时死亡恢复，未覆盖每一个archive/rename中途崩溃点。
- 实际注册skin HTTP GET、正式工具/路由、真实前端组件回调与共享订阅已测试；未点击真实DSH桌面、未调用线上多人服务、未做GPU/CUDA硬件或真实C3模型质量验收。
- 84资源字节精确恢复、真实release复制阶段与npm资源选择通过；完整release --dry-run仍因既有缺tools/reconcile-upstream.mjs失败闭合，没有绕过门或发布。
- Library原审计docx按技能指定helper流程及一次支持重试均download failed，20页原文未读取。使用委托提供的完整稳定ID清单逐项验证；第一阶段35项结论在team分支docs/audit-20261002/results.md与issues.json，F24撤回不凑数。#178–205与旧issue评论已存在，不重复提交。
- integration先前createPullRequest返回Resource not accessible by integration；按委托不重试、不换身份。上游draft PR创建仍受写权限阻塞。两份可提交正文见resources-tier0-pr.md与team-plan-pr.md，由授权账号创建draft；仅推送fork，未合并、部署或发布版本。

文档后续提交仅交付上述正文与验证记录；最终分支SHA和对应文档提交CI另在最终交付报告给出。产品冻结提交及其CI可从本表直接追溯。
