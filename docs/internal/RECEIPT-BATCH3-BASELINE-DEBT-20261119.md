# 批次 3 基线债清理回执（2026-11-19）

## 结论

以 HEAD `96bfded8` 为对照，11 个原始失败项中 **10 个已修复到绿**；`migration-optin-compat` 仍为 **30/7**，确认是生产 UI 接线缺陷，本轮按“高风险仅报告”纪律未改。没有放宽失败判据；判据过期项改为核对现行契约并保留负路径。

HEAD 对照 worktree `C:\Users\JH Z\AppData\Local\Temp\dam-head-attrib-96bfded8-baseline-debt` 在这次执行期间重建自 `96bfded8`。逐套首错另存于 `artifacts/_batch3-baseline-debt-20261119/head/`；补跑精确 HEAD 用例在 `head-exact/`。修复前当前基线回放保存于 `current-before/`，由接收回执时的 A1c 源、HEAD 原用例组成，并逐文件确认 `lib/index.js` 是 SHA `f71d8ece…`，`lib/client.js` 是 SHA `dbf18ab4…`。变异/复绿记录位于同目录 `mutations/`，逐套最终输出在 `current-final/`。

## 逐套归因

| 套件 | HEAD / 修复前首错 | 归因与改动 | 最终 |
|---|---|---|---|
| `bc-audit-fixes` | 25/2；P-H1 用例正文 0 个合格 `##` 节，提前得到白板拒绝，未触及 team gate | **夹具过期**：用生产 `checkPlanCriteriaPre` 验证有效白板正例与空白板负例，再以有效正文验证 viewer 拒绝仍是 `team-forbidden` 且无写盘 | 29/0 |
| `g3-note-status-wire` | 48/1；`memory_note.changeSet` 的 array `items` 缺失 | **生产 schema 缺陷**：注册工具 schema 声明 object items、区域枚举和 `regionId`/`afterText` 必填；changeSet 本身保持可选，beforeText 仍由后端读取。测试从真实注册产物删除 items 会红 | 51/0 |
| `handoff` | 63/3；最新账本/时间头两断言失败，recall 事件下钻透传断言失败 | **前两项夹具缺依赖**：注入真实 `readLatestLegacyLedger`，不再用空结果替身。第三项**契约判据过期**：保留五个 scope 与事件字段负路径，核对现行 `eventId/checkpointIndex/idemKey` 透传。补 mtime 胜过反向字典序、缺失目录 fail-soft 用例 | 69/0 |
| `issue164-plan-tools` | 首断言因预期 `/冲突双方已保存/` 崩溃 | **契约判据过期**：stale card 现为 `plan-card-conflict` 预检拒绝；断言错误分类及 PLAN、event-store、冲突副本逐项不变，不再声称创建冲突副本 | PASS |
| `issue368-write-contract-negative` | HEAD `26579: writePlanSnapshot must be awaited or returned`；当前树 `26728: ...` | **检查器边界缺口**：允许同一行、以明确分隔符结束的表达式体箭头直接返回；块体丢结果、带前置无关箭头、三元/跨行条件仍拒绝 | 6/0；检查 38 个 writer calls |
| `migration-optin-compat` | 30/7；C6a–C6g 请求/确认控件缺失 | **未修复的产品缺陷，高风险只报告**：六个真实迁移请求不携 `allowUnprovenUserFiles`，三个入口无用户级 opt-in。后端在 `lib/migrate-pack.js:288` 对未证明的用户文件 fail-closed。临时副本中确认工具能生成 6 个请求绑定和 3 个勾选框，但生成后 `build-iter5-skin --check --strict` 失败：`Expected exactly one settings seam: apiPost(API.migrateInspect, { packPath: ...`。修复需同时调整生成源、生成器和三面/frozen，涉及显式允许导入未证明文件；本轮不改其 UI 或守卫 | **30/7，阻塞项保留** |
| `p7-write-fix` | 42/43；旧双标题 ledger 兼容断言失败 | **夹具缺依赖**：抽取 `readLatestHandoff` 时注入真实 `readLatestLegacyLedger`；新增旧文件写前后字节相同断言 | 44/44 |
| `r15-left-rail` | 90/2；外观扫描发现裸 hex 4、裸 rgba 4 | **既有样式契约缺陷**：红点色值曾以内联 var fallback 留在 legacy/v4；新增共享 `skins/iter5/shared-tokens.css`，两种皮肤均载入同一组 token，组件只读 token；裸色判据未改 | 92/0 |
| `switch-decouple` | 53/54；白板开时同一 fixture 未载入两层材料 | **夹具缺依赖**：注入真实旧账本读取器并启用 strict injection，保留“白板关不读正文、开时读取”的原判据 | 54/54 |
| `v314-gate-scope-j` | 20/3；J1d/J1f/J3c 窗口抽取找不到警示及 archivedIds | **判据窗口过期**：按 `writePlanSnapshot` 和 `memory_note` 实际方法/工具边界抽取；保留警示入回执和 archivedIds 透传断言 | 26/0 |
| `v4-c1-wal-note` | 16/6；长度 98、writeCalled=0、plan-version-conflict、补偿检查点断言不符 | **旧 WAL/账本判据过期**：验证当前摘要、磁盘指纹及指针读回；writer 成功后写事件；P-H1 预检零副作用；正式 writer 拒绝只在显式事件下写失败检查点 | 29/0 |

## 变异与回归证据

| 修复 | 必红变异 → 恢复结果 |
|---|---|
| `bc-audit-fixes` | 退回 P-H1 无效旧正文 → 26/3、团队门断言红；恢复 → 29/0 |
| `g3-note-status-wire` | `required` 移除 `afterText` → 50/1；恢复 schema → 51/0。另有删除 items 的真实注册产物负路径 |
| `handoff` | 真实 ledger helper 替换为空读取器 → 66/3；恢复 → 69/0。含 mtime 排序与缺失目录负路径 |
| `issue164-plan-tools` | 恢复旧“冲突双方已保存”期望 → AssertionError；恢复现行 `plan-card-conflict` 断言 → PASS |
| `issue368-write-contract-negative` | 丢弃箭头调用返回值、缺 await、前置无关箭头、三元及跨行条件均被拒；检查器放宽变异被三元负路径捕获 |
| `v314-gate-scope-j` | 拔除 m1Warn、回执 warnLine、固定 archivedIds 各自变红；恢复 → 26/0 |
| `p7-write-fix` | 不注入旧 ledger helper → 43/44；恢复 → 44/44 |
| `r15-left-rail` | 把四个 token 还原为裸色 → 90/2；恢复 → 92/0；原三条颜色变异仍运行 |
| `switch-decouple` | 空 ledger 读取器替代真实 helper → 53/54；恢复 → 54/54 |
| `v4-c1-wal-note` | 保留原失效语义的断言路径实测为失败；契约测试后为 29/0，包含两条负向变异 |

修复后 11 套逐项重跑：10 个 PASS，唯 `migration-optin-compat` 保留 30/7。邻近套件：`r26-cross-layer` 26/0、`p6a-rules-layer` 131/0、`batch2-2.5-redraw-lock` 9/0、`frozen-mirror` 37/0、`client-loadable` 34/0、`generator-idempotent` 14/0、`generator-guard` 24/0、`lb1-classic-fallback` 11/0、`lb1-negative` 19/0、`delivery-settings-ui` 25/0、`continue-host` 40/0、`continue-chain` 68/0。`r4-read-side` 执行到 26/0 断言，但 Node 进程在 100 秒时仍未退出（ETIMEDOUT）；该结果不记作 PASS。

## 文件、计数与差异归因

- 后端唯一生产代码改动：`lib/index.js:25869` 的 `memory_note.changeSet.items` 增加 `required: ['regionId', 'afterText']`。HEAD schema 的 144 字节 `items` 描述加上本轮必填声明，解释了 `r26` 相对 A1 的 181 字符变化；测试按自身 LF 归一化管道重钉为 SHA16 `6A01ADFE83DE9512`、实际长度 `1,652,347`，当前 `r26` **26/0**。此前未重钉时，实测旧值 `248A1098C2142588` / `1,652,310` 失败。
- `lib/injection/*` 未改。当前 HEAD 仍 `96bfded8`；配置/路由/工具/`lib/index.js` 导出仍是 **182 / 87 / 22 / 41**。`node tools/verify-docs.mjs` 实测文档计数一致。
- `lib/index.js`：30,415 行、2,214,208 B、全 CRLF、41 exports、SHA256 `89bcc7e8e38c76b9af3f65fc1db4e0401754432c9279416026384a2cb8a82f6a`。
- `lib/client.js`：27,280 行、3,033,975 B、全 CRLF、SHA256 `28f7758f8d3d06567821803758addfa65d5572ea9bbf14454d0f15ed3be63832`；本轮只因 token 源位置迁移和已有 P2 生成源共同生成，无 client API/计数变化。
- `skins/iter5/shared-tokens.css` 为新增 LF 共享色值源；`tools/build-iter5-skin.mjs` 在变体表及 legacy 表均并入该源。`node tools/build-iter5-skin.mjs --check --strict` 输出 `SYNC-OK: sources × generator == lib/client.js`。
- `node --check` 通过 `lib/index.js`、`lib/client.js`、checker 与本轮改动测试；`lib/index.js` 真 import 为 41 exports；client factory 真加载 `client-loadable` 34/0。
- 默认 `git diff --check` 在 mandated CRLF 文件且 `eol=lf` 属性处把 `CR` 报成尾随空格；这些文件当前保持 CRLF（`lib/client.js` 也为 CRLF 约束）。用 `git -c core.whitespace=cr-at-eol diff --check` 对本轮触及的跟踪文件复核，退出 0、无真实空白错误。`README.md` / `README.zh-CN.md` 未纳入本轮修改。
- 真实宿主截图/新宿主重启/真实模型迁移验证未做；本轮未 commit、push 或改版本。
