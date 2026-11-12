# SidecarStore 原型独立质量评审与接入阻断报告

> 日期：2026-11-13（Asia/Hong_Kong）
> 基线：preview / `f8968bba9e7faa957355a9c413cdb1598c79a31a`
> 评审：Lead 与独立 `dshapi-kimi/kimi-k3.1-pro` 执行代理。
> 范围：`prototypes/sidecar-store/` 实现、类型声明、公开测试、生产接入文档与当前接口。
> 性质：**只读 + 隔离 API/进程探针；未修改原型或生产代码，未迁移真实数据。**

## 1. 结论

模块化/API 化总体成立，不是概念壳；可以保留为后续接入基础，但**不能直接接线**。独立评审实证四个生产接入前阻断问题，且非空 versions、fixture 门、R4 生命周期与审计同步仍需闭合。

### 实测
- `node prototypes/sidecar-store/tests/run-contracts.mjs`：EXIT=0，27 tests/27 pass/0 fail/0 skipped，Node v24.18.0。
- Lead 回读 `artifacts/_index-gov-20261109/out/prototype-tests.json` 与 TAP；当前工作树、2,848 封存 fixture 和该回执均有效。
- 独立评审含真实双进程、CAS、三处 SIGKILL、隔离版本/类型/迁移/锁超时探针；未写生产。

## 2. 生产接入阻断项

### B1 · 非空旧 versions 在 source 更新后丢失 [runtime]
`index-state.js:321–332` 对旧 source 条目无条件删除 `#versions`，仅按新 `entry.kind==='archive'` 重建。合法旧视图的非空归档血缘会在普通 `replaceSource` 后变成 {}。

影响：与 README 的保留/触及语义及接入文档的 opaque versions 兼容要求不一致。封存 fixture 的 versions=0，未覆盖该情况；不是现网已经损坏的证明。

验收：保留/追加/删除的所有权规则先定稿；用非空 versions fixture 做增量、重启、导入/导出与回归，不允许静默丢链。

### B2 · 公开只读属性在类型声明与运行时均缺失 [runtime]
`index.d.ts:72` 的 `parserVersion` 属于 `StoreStatus`；`SidecarStore` 类未声明该只读属性，运行时也无 getter。`sidecar-store.js:253` 只在 `getStatus()` 返回，实测 `typeof store.parserVersion==='undefined'`。

验收：按既有接口补 getter 与 `.d.ts` 只读声明，保持 `getStatus()` 字段兼容；增加真实 .d.ts/消费测试。若本机无 tsc，如实标注未编译，不虚构类型通过。

### B3 · 迁移输入缺少根与 regular-file 边界 [runtime]
`markdown-adapter.js:48–50` 对任意 `file` 直接 `readFile + JSON.parse`；没有 approved root、symlink/regular-file 检查，坏 JSON/目录/锁错误也可能以原生异常逸出。与 `codec.js` 的公开错误契约及接入文档批准文件要求不一致。

验收：迁移 facade 显式授权根、拒绝根外与符号链接、拒绝目录/非普通文件；将 schema/path/lock 错误稳定映射为公开 `SidecarStoreError`，保留 cause 和可诊断 code。

### B4 · 共享锁超时未统一为公开错误 [runtime]
`journal-storage.js:122–136` 直接使用 `withSharedStateLock`；超时发生在包装回调外。独立探针用同 PID/hostname 活锁+`lockTimeoutMs:30` 稳定得到原生 Error/`state-lock-timeout`，而非 `SidecarStoreError`。

验收：定义 INDEX_* code 与 cause，测超时、清理、失败后队列继续与启动清理。该探针是可捕获 API 错误，不是产品崩溃证据；open 未返回实例，不能虚构调用方可 close 的对象。

## 3. 设计风险与未闭合语义

- **归档/同 ID 兼容**：import 拒绝重复/跨 source ID；现网是否允许共享 ID 尚无真实 fixture 证明。先定 versions 所有权与归档身份，不能泛称所有旧形态已兼容。
- **幂等窗口有限**：`operationHistoryLimit` 淘汰旧 receipt 后同 operationId 会再次提交。崩溃/长间隔重试必须依赖 CAS；强杀后同 ID 重试尚未覆盖。
- **压实无自动触发或旧代 GC**：每次 compact 换 generation，旧代保留；orphan generation fail-closed。需保留上限、恢复/回滚和触发策略。
- **durable 不等于掉电证明**：仅文件 sync，不承诺目录 sync；cooperating-process 锁不代替正文 CAS、写入 admission、M1 或跨文件原子事务。
- **open 失败清理**：storage.close 与已拒绝队列等待关系需行为测试；本轮未证实资源泄漏/死锁，不能标为已证缺陷。
- **fixture 门**：`tests/contract.test.mjs:378–385` 缺文件时 skip，运行器只回写 skip 数；发布验收必须 required-fixture=true 且 skipped=0。

## 4. 已验证的正常设计

- `index.js` 只暴露 facade/adapter/error；内存状态与 IO 分层明确。
- `replaceSources` 先复制/规范化、锁内 replay+CAS、append 后发布内存；真实多进程竞争一成功一冲突。
- Journal 完整行 schema/checksum/连续 seq 校验；只截无换行残尾；初始化/压实同锁换代；崩溃恢复后可继续写。
- `loadView` 八字段、未知 entry 字段、detached values、基本 fixture 导入/导出已验证。
- Lead 隔离探针确认：修改 `getEntry` 返回对象的 tags 后，内部条目与 by_tag 均不变化；不能误报为直接引用泄漏。

## 5. 与当前生产接口的同步缺口

- `lib/index.js` 当前无 SidecarStore 调用；`writeSidecarEntryPre`、`_writeSidecarIndexPre`、`rebuildSidecarIndexPre`、`_loadSidecarIndexPre`、`handoffPanelData` 仍需 facade 接入。
- 保留 `sourceRevisions`、`planRevisionPre`、同 source 多节替换、倒排与八视图；不可只替换 JSON 写盘。
- 当前 `handoffPanelData` 在 `ledgerDocEnabled=true` 时有独立 `documents/*.md` 分支。原型 service 不得误删、覆盖、归档 R4 文档或重建其 lifecycle。
- `appendSidecarEventPre` 的 `events.jsonl` 审计须明确保留/接入；它不属于 SidecarStore 持久化格式。
- `_saveConfigChecked` 的迁移 admission/drain、活动 store 与 dispose 生命周期仍需实际实现与验收。
- 3.0 是注入/投递，不是 SidecarStore 本体；3.0 定版规范与独立报告仍为准。

## 6. 接入建议与停止条件

1. 先修 B1–B4 并补隔离测试、真实 fixture 与类型/错误边界。
2. 再实现默认关闭的生产 facade/service；3.0、2.3、2.9 可各自独立开发，`lib/index.js` 最终接线单一写者。
3. 明确 versions/归档/重试/压实/回滚语义，不把旧 fixture 的 versions=0 当全数据证明。
4. 完成真实生产 writer/reader、面板、审计、R4 文档和隔离 HOST 验证。
5. 未完成前：不启用生产、不迁移/删除真源、不 2.4、不发布；27/27 只代表 Node/Windows 原型层。

## 7. 本轮边界

- 独立评审未改源码、未启动生产、未 commit/push；Lead 复核源码与运行记录后落本报告。
- 真实 Electron、掉电、跨设备、所有旧数据形态均未验证；缺证据处明确保留。
