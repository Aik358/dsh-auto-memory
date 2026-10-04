# PR #212 main 集成与后续修复

## 合并意图

- 合并 `upstream/main` 的 `f2f7cc1`，16 个冲突文件逐段处理。保留本 PR 的工作区 ownership、严格账本读取、诊断归属、空库恢复和独占/CAS 迁移语义；接入 main 的团队生命周期、PLAN/CALENDAR 原生锁、待确认 USER、WASM 路径及生成器严格检查。
- 合并后的真实存储 factory 改用 catalog 的 `workspaceMemoryPath` / `todayLogPath`；真实皮肤源去除每实例重复的 `skin-changed` 订阅后重新生成 client。保留订阅次数、卸载和原生产 delete/CAS 断言。
- frozen 统一 LF 并增加 checkout 属性；路径候选测试改为检查完整函数体，保留真实正反路径及唯一候选断言。

## CI 与实际回归

- 合并提交 `3080df4` 的首轮本地完整 smoke 为 **278 PASS / 4 FAIL / 0 TIMEOUT**；四项修复后定向通过。该提交远端完整 smoke 为 **281 PASS / 1 FAIL / 0 TIMEOUT**，剩余 audit-host-wiring 仍断言旧 factory 字段。
- audit-host-wiring 现在验证实际 factory 输出及实际 storage `scanHealth` 消费契约。实际 `saveConfig` 与 legacy copy 回归保留 `report.tmp.md` 等合法文件，只过滤完整运行时临时后缀，并遍历名称类似运行时文件的真实目录。
- PLAN 回归当前 **9 PASS**：原生锁上已接纳写入在迁移前 drain；迁移期间新写明确拒绝；锁内根变化拒绝；失败无 flight 泄漏；真实 agent 首建在读取/路径解析期间跨根发布时拒绝旧路径，随后新根重试成功；仅 `projectMemoryDir` 绑定变化也等待锁队列及锁回调中的实际 sidecar 完成；真实注册 `memory_note(kind=plan)` 拒绝旧 resolver 结果，并在当前根重试成功。
- `issue164-plan-cas`、`issue164-plan-tools`、`issue164-plan-processes` 实际套件通过；保留读前写、字节 revision、旧版本冲突留存、归档和跨进程原生文件锁，未降级 CAS。
- 测试使用临时 `USERPROFILE` / `HOME` / `DSH_HOME`，不读取个人记忆或真实会话。最终提交的完整远端 CI 结果由 PR 正文记录；本文件不将尚未运行的最终完整 CI 标成 PASS。

## 并发范围

根迁移 admission/drain 协调同一 `MemoryEngine` 实例中参与该协议的 PLAN 写入；它不提供跨独立 engine 或跨进程的根迁移屏障。PLAN 文件原有跨进程锁保持有效。
