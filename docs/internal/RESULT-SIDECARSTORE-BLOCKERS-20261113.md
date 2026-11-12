# SidecarStore 原型 B1–B4 阻断修复结果

> 执行时间：2026-11-13（Asia/Hong_Kong）
> 任务：task-task-15（共享任务板未检索到该 id 或 task-15，按直接任务书执行）。
> 施工基线：preview `64b4ac9b53ba799260e2a3e09cc2dda53734a03d`。
> 收尾时其他线 HEAD：`0bf510b6ab5deae46e8df138c8d016bb8c14e64b`；未回退、未 cherry-pick、未 commit/push。
> 范围：仅原型与本文档；**生产接线、2.3/2.4/2.9、真实记忆、19387 未改动或未执行**。

## 1. 结论

四个已证阻断已在 Node/Windows 原型层修复并完成真 import、真构造、真调用、负路径与隔离变异验证。最终合计 **37 PASS / 0 FAIL / 0 skipped**，其中原合同 27 项、新增阻断合同 10 项；真实封存 fixture 存在并实际运行，无 skip。

这只是独立原型层的完成，**不是生产接入或 HOST 验收完成**。生产 facade/service、真实 writer/reader、R4 文档生命周期、`events.jsonl` 审计、配置迁移 admission/drain、真实 Electron 与掉电安全均未实施或未验证。

## 2. 修复设计与实际行为

| 项 | 实现 | 实测行为 |
|---|---|---|
| B1 | `index-state.js` 不再随 entry replace/remove 删除 versions。旧数组及空数组原样保留；archive 仅在 source 不存在时追加到该 id 链尾。 | 非空旧链（含无当前 entry 的链）在触及、删除、导出、压实、重启后保持；同 archive 重放去重；重复 id、跨 source id 继续 `INDEX_ENTRY_CONFLICT`，失败前后导出字节不变。**不提供无证据删链 API**。 |
| B2 | `SidecarStore.parserVersion` 补只读 getter；`.d.ts` 同步补 `readonly parserVersion: string` 和错误 `cause`。 | getter 与 `getStatus().parserVersion` 相等，赋值抛 TypeError；TS 消费样例描述 getter 与必填批准根。 |
| B3 | `importLegacyFile(file, {approvedRoot, ...mutationOptions})` 强制已存在的绝对批准目录；校验词法/物理根内、非 symlink regular file，按同一文件句柄读取并检查 inode 和读取前后元数据。 | 根内绝对/相对文件均成功；缺根、相对根、根为文件、根为 symlink、目录、根外、`../`、中间 junction、缺失文件、坏 JSON 全拒绝。缺根为 `INDEX_INVALID_ARGUMENT`；路径为 `INDEX_PATH`；坏 JSON 为 `INDEX_INVALID_DATA`；公开别名 `SidecarStoreError` 与 `cause` 保留。导入后后续合法调用可用，原文件字节不变。 |
| B4 | 原型 storage 边界把共享锁超时映射 `INDEX_LOCK_TIMEOUT`，其它底层文件系统错误映射 `INDEX_PATH`，保留原 cause。open 初始化同样映射；不改 `lib/shared-state-lock.js`。 | 真异进程活锁连续超时、open 超时、真 SIGKILL 死主锁回收、append/compact 发布前后 ENOSPC、自身锁/tmp 清理、队列继续、close 等待已受理任务并拒绝新任务均通过。append 完整行后失败可用同 operationId 返回 `alreadyApplied`。 |

### B2 报告措辞订正

审查报告称“`.d.ts:72` 已声明 `store.parserVersion:string`”。在指定基线 `64b4ac9b` 上，该行实际是 `StoreStatus.recoveredTailBytes`，而 `SidecarStore` 公开类没有该属性；`StoreStatus.parserVersion` 本身存在且合理。实际缺口是公开属性在 runtime 与声明两侧均缺，本次按兼容新增 getter + 声明处理，未删除已有声明。

## 3. 实际测试与可复算结果

### 3.1 合同

环境：`D:\nodejs\node.exe` / Node **v24.18.0** / Windows。

| 命令 | 实际结果 |
|---|---|
| `node prototypes/sidecar-store/tests/run-contracts.mjs` | **37 tests / 37 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo**；最终 TAP duration **4,952.5755 ms**；EXIT=0。 |
| `node --test --test-reporter=tap prototypes/sidecar-store/tests/adapter.test.mjs prototypes/sidecar-store/tests/contract.test.mjs` | **27 / 27 / 0 / 0 skipped**；duration **5,096.0473 ms**；EXIT=0。 |
| `node --test --test-reporter=tap prototypes/sidecar-store/tests/blockers.test.mjs` | **10 / 10 / 0 / 0 skipped**；duration **3,210.3727 ms**；EXIT=0。 |
| `node prototypes/sidecar-store/examples/basic.mjs` | EXIT=0；首次写 **1,591 B**，no-op **0 B**，编辑追加 **1,727 B**，最终 journal **3,318 B**，兼容导出 **1,978 B**。 |
| 全部原型 `.js/.mjs` `node --check` | EXIT=0；`SYNTAX_OK`。 |
| `node --experimental-strip-types --check prototypes/sidecar-store/tests/consumer.ts` | EXIT=0，**仅类型擦除语法检查**。 |
| `git diff --check -- prototypes/sidecar-store` | EXIT=0；无行尾混用，全部原型文件保持纯 LF。 |
| `node tools/verify-docs.mjs` | EXIT=0；22 tools / 86 routes / 181 config keys，声明与代码一致。 |

原始最终回执：
- `artifacts/_index-gov-20261109/out/prototype-tests.json`：**482 B**，SHA-256 `23ba81906a0a5d0a20be2133d6527b236b10ffce73d33f7d69e13fd256aeda17`。
- `artifacts/_index-gov-20261109/out/prototype-tests.tap`：**9,385 B**，SHA-256 `36c06fb23cfd7adaaeb715e3942721af899659ad3354cf6f502e74fdb7a73c6b`。
- 新增测试最终隔离目录：`artifacts/_index-gov-20261109/prototype-tests/blockers-8c2f2103-d1f0-462a-86a7-a555a6a4168e`。
- 原 27 合同最终隔离目录：`artifacts/_index-gov-20261109/prototype-tests/contracts-1794504223464-77153d42-7a8c-4758-beac-7a371645bcff`。
- 基础示例最终目录：`artifacts/_index-gov-20261109/prototype-demo/03e9629e-d9b9-4a1b-bf4a-d98c0cc1f9b7`。

封存 fixture：2,848 entries，`base.json` **5,621,397 B** / SHA-256 `9d11033ab36df0f33c0d2a3e80fdf2376fa4c24626b762293277231bb2adeecb`；其 versions 实测为 **0 个键**。因此 B1 采用明确构造的非空 synthetic lineage 提供区分力，不能把该 fixture 说成真实非空旧血缘证据。旧 `fixture-meta.json` 的原始兼容 SHA `76ac012a1ba5af429d5699109043de33ca3bb6bbb0757b0a2968ccfbdd06e719` 与字节 **7,382,763 B** 是另一口径，不能与 `base.json` 物理 SHA 混用。

### 3.2 隔离变异

`node prototypes/sidecar-store/tests/mutation-runner.mjs`：干净克隆先跑 **37/37 PASS / 0 skipped**，之后才允许解释变异。六项均为真正目标行为红：

| 变异 | 实际 FAIL / PASS | 被捕获的行为 |
|---|---:|---|
| B1 删除旧血缘 | 1 / 36 | archive 追加去重与旧链保留 |
| B2 删除 getter | 1 / 36 | 真 runtime getter |
| B3 禁用批准根解析 | 1 / 36 | 根外/越界 fail-closed |
| B3 原生 JSON SyntaxError | 1 / 36 | `INDEX_INVALID_DATA` 与 cause |
| B4 原生锁/文件错误 | 3 / 34 | 连续/open 锁超时与 ENOSPC 映射 |
| B4 只映射锁、放过文件错误 | 1 / 36 | ENOSPC 映射与恢复 |

合计 **6 CAUGHT / 0 MISSED**。变异回执 `artifacts/_index-gov-20261109/out/prototype-mutations.json`：**3,262 B**，SHA-256 `e5c9bda3f3e4b3c653f371bc15dd2015e32c2ef3049ecb5e2d8e52a7f7d03888`。各 TAP 位于 `artifacts/_index-gov-20261109/out/mutations/<id>/tests.tap`；干净对照在 `clean-control/`。

早期尝试仅禁用词法 `../` 判据时，物理边界仍拒绝，变异未被捕获；已替换为禁用根解析的有效变异，**不把那次误报计入 6 项**。更早的模块加载失败和 Electron 误当 Node 的失败也全部排除，不算 CAUGHT。变异运行后五个实现文件的 SHA 与运行前相同；临时副本归档到 `artifacts/_index-gov-20261109/out/mutation-scratch/`，原型目录无 `.sidecar-mutation-*` 残留。

## 4. 变更文件 bytes / SHA-256

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `prototypes/sidecar-store/README.md` | 11,828 | `c80599f2128c3578d244bded5e6128b4cfa01ab08250df84d6a13b1e14e7585a` |
| `prototypes/sidecar-store/codec.js` | 1,931 | `f0857f2473826ddc69b73e062822d20c7613515c7b20fb96b92e37e6dd5daa85` |
| `prototypes/sidecar-store/index-state.js` | 17,747 | `e0a215628bf978bccaf68982f7a2676d71ece6ba42e3d9b37979d67e2ddb4ea3` |
| `prototypes/sidecar-store/index.d.ts` | 4,839 | `10c84ed7a14bbf9f9c105e4ce0ad7bc5ecde7f85bcc5e89004ec4218b1bd2c75` |
| `prototypes/sidecar-store/journal-storage.js` | 15,384 | `6b242e89edd1adfcaa4ab596db01071aab8d7822cdf96ea1d324f3e749ef72ba` |
| `prototypes/sidecar-store/markdown-adapter.js` | 7,297 | `afb5a273d6f83703dc2c295bdc40872c7e946357ba932af4a62e5d0b75a3db2c` |
| `prototypes/sidecar-store/sidecar-store.js` | 15,492 | `0acde1223e431a62d8af947432c7d0f8f344977b0e99e5ca11ef579172f36ad6` |
| `prototypes/sidecar-store/tests/adapter.test.mjs` | 5,637 | `371d835b2a951954209b27cd930a4a7c24736ee97059458e395d63791c714442` |
| `prototypes/sidecar-store/tests/blockers.test.mjs` | 18,358 | `34890abfb89574610577080a913ee64ada40f06115b8aca89232c453f5eb2d07` |
| `prototypes/sidecar-store/tests/consumer.ts` | 911 | `0a0c3cee489af895a55325da3720d32d8d3947780b958272aec03bd5fee4f493` |
| `prototypes/sidecar-store/tests/lock-holder.mjs` | 393 | `068da8002f7d1675ad28b38f358e4858d3fac4b4492093059875831206cf1bb5` |
| `prototypes/sidecar-store/tests/mutation-runner.mjs` | 8,666 | `df08d16cee0e1a77b48ebfa62624f592b388503e15336411b1276e5a8bc330df` |

`index.js`、原 `contract.test.mjs`、原 `run-contracts.mjs`、原 `worker.mjs`、示例实现未改。唯一原测试修改是给既有 `importLegacyFile` 调用显式传 `approvedRoot: root`；原 27 项数量与覆盖意图未削弱。

生产边界抽查（不是本线写入）：
- `lib/index.js`：2,169,154 B / `ceb4c5fc42b596485aa0ca1e1df798d6024a1e4b8b9c0aefa1548196ae61cff4`。
- `lib/event-write.js`：49,381 B / `1b36d74268ab57b5cf21dfebee8c492c1a9e36999408c877271bcfaebd06946a`。
- `lib/shared-state-lock.js`：13,225 B / `693a15f8847a517da04e79418d5f90a899bab8dacd63b185cf8ecbb3187cc20e`。
- 其他线未跟踪的 `lib/handoff-coverage.js`：26,008 B / `97ade2445ea3030b158e46914d8ae24dc97dfe85d709ff0934b006011014fb42`；`lib/handoff-normalize.js`：15,876 B / `0ad3960cd2547c3339c8a3b20bd1ff53290a2a3e2f77b05ee153ab68a252aedc`。本线未创建或修改这些文件。

## 5. 未测项与保留风险

1. **tsc 未编译**：仓内无 TypeScript 开发依赖；本机 `tsc`、node_modules、全局路径及 npm 缓存均未找到编译器，未下载依赖。`consumer.ts` 已通过 Node strip-types 语法检查，且 runtime getter 与声明结构断言通过，但不得声称 TypeScript 编译通过。
2. **生产/HOST 未测**：未启动或修改 19387，未接五个生产读写门，未做 Electron/真实宿主验证；不承诺生产已修复。
3. **真实记忆未动**：只读取既有封存 fixture；没有迁移、删除、归档或生成真实记忆数据，未做 R4 文档或 `events.jsonl` 审计接入。
4. **锁/文件边界**：真实活锁、死主回收、目录 junction、文件 symlink、目录、越界和 ENOSPC 故障已测。批准根在读完后才撤除的不可信目录/权限拒绝、跨设备重解析、所有平台特殊文件类型未全覆盖。
5. **持久化边界**：没有真实掉电、父目录 sync、跨设备/跨 OS、磁盘物理写量证明；`durable:true` 仍只承诺文件 sync。
6. **versions 生命周期**：保留/追加/去重已验证；无证据删除刻意不实现。历史错误链的纠正、合法 GC/保留上限、现行卡与历史卡之间关系推断仍须有独立证据和另行裁定。
7. **原有风险仍保留**：operationHistory 淘汰后同 ID 重试、压实旧代 GC、自动触发、真实生产 stale/admission/drain、强杀后同 operationId 重试等不由本批宣称解决。
8. 全仓 smoke 未运行；`tools/verify-docs.mjs` 已单独执行且 EXIT=0（22 tools / 86 routes / 181 config keys，文档声明与代码实测一致）。本批功能验收以原型合同/示例/变异为准，其他线新提交或工作树文件不纳入本线完成声明。
