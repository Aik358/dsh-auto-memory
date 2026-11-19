# 批次3 A1c 回归归因 + P3-B 隔离宿主验收（2026-11-18）

性质：Lead 复核 A1b2、全量回归归因、修复 9 处真引入红 + 1 处超时假红，并在隔离真实宿主上完成三入口与冻结态验收。**未提交、未推送、未改版本；生产宿主 19387 未触碰。**

## 0. 结论

| 项 | 结论 |
|---|---|
| A1b2 | **通过**：p6a **131/0**；产品文件逐字节未变（client 3,033,480 / `895f88ad`，index 2,214,027 / `f71d8ece`，policy-runtime 2,666 / `42ed3bd5`）。 |
| 全量回归 R1 | FAIL **20** + TIMEOUT **1**。用 HEAD `96bfded8` worktree 逐套对照后：**9 个 HEAD 后引入 + 1 个并发假超时 + 11 个 HEAD 基线已红（失败项逐条相同）**。 |
| A1c 修复 | 6 个计数/文档锁、1 个测试夹具漂移、1 个 source 锚点、**1 个真契约缺口（diagnostic 未登记区）**、1 个重车道登记、1 处 P2 样式 token 化。 |
| 全量回归 R2 | **PASS 632 / FAIL 11 / TIMEOUT 0 / FLAKY 1**（354.5s）。11 个 FAIL 与 HEAD 基线逐条相同，**无本批新增失败**。 |
| P3-B 宿主 | 三入口与七键冻结态 **HOST PASS**；策略保存/删除 API **HOST PASS**；真实模型轮注入 **NOT-VERIFIED**（隔离 profile 无 LLM bundle）；UI 删除按钮的 confirm 未自动化。 |

## 1. A1b2 复核（Lead 实测）

- `node tests/smoke/smoke-test-p6a-rules-layer.mjs` → **131 PASS / 0 FAIL**，EXIT=0（P1 时 125/0 → A1 后 123/2 → A1b2 131/0）。
- 只改测试与回执：p6a 39,123 B / sha16 `e45d50da139fa25e`；`delivery-settings-ui` 25/0、`delivery-policy-runtime` 11/0、`r26` 26/0 复跑通过。

## 2. 全量回归 R1 的归因（HEAD 基线对照）

HEAD worktree：`C:\Users\JH Z\AppData\Local\Temp\dam-head-attrib`（`96bfded8`，`node_modules` junction，clean）。10 个目标测试文件与 HEAD 逐字节相同。

### 2.1 HEAD 后引入（9 + 1）

| 套件 | 首个失败/现象 | 类型 | 根因 |
|---|---|---|---|
| `smoke-test.mjs` | `expected 85 routes, got 87` | 计数锁 | 新增 `/api/dsh-auto-memory/delivery-preview`（HEAD 86 → 87） |
| `smoke-test-m3b3` | 同上（`:54`，`86`） | 计数锁 | 同上 |
| `smoke-test-context-observer` | `route count drifted (expected 84…): 87`（`:119`） | 计数锁 | 同上 |
| `smoke-test-team-routes` | `真 API 表 = 86 条`（`:93`） | 计数锁 | 同上 |
| `smoke-test-issue454-panel-lan` | `B1 85 处守卫…实测 87`（`:162`） | 计数锁 | 同款 loopback 守卫 +1（非漏守卫） |
| `smoke-test-issue111-docs-real-names` | 文档 86 vs 代码 87 | 文档锁 | `docs/HANDBOOK.md:89`、`docs/SOURCE-REFERENCE.md:29` |
| `smoke-test-m9-e2e` | `磁盘未落盘 12000`、`8000→24000`（4/7） | 测试夹具漂移 | 切片清单缺 `WATER_PCT_DEFAULTS_VERSION` 与 `upgradeWaterPctDefaultPre()` ⇒ TypeError 被 fail-soft catch 吞掉；补注入后 **7/7**，真实迁移无回归 |
| `smoke-test-b05-truncation-direction` | `账本段调用 weightedTrim…`（`:120`） | source 锚点过期 | A1 重构为 `_finish(selected)` 后实参可为 `selected`/`_ledgerRaw`；函数仍在账本段被调用（`index.js:13173-13176`） |
| `smoke-test-v4-b2-zone-registry` | `未登记: diagnostic` | **真契约缺口** | P1 新增 `pushPart('otherDynamic','diagnostic')`（`index.js:13709`）但未登记 ⇒ fail-safe 落 memory；已登记 `'diagnostic':'memory'`，行为等价、消除「靠默认值」 |
| `smoke-test-r4-p4-3-brief-scan` | 并发 TIMEOUT；单跑 **11.41s / 20-0** | 负载假红 | 进 `HEAVY_MS`（11,400ms），重车道 240s |

### 2.2 HEAD 基线已红（11，失败项与计数逐条相同；非本批引入）

`bc-audit-fixes` 25/2 · `g3-note-status-wire` 48/1 · `handoff` 63/3 · `issue164-plan-tools`（首断言崩） · `issue368-write-contract-negative`（首断言崩） · `migration-optin-compat` 30/7 · `p7-write-fix` 42/43 · `r15-left-rail` 90/2 · `switch-decouple` 53/54 · `v314-gate-scope-j` 20/3 · `v4-c1-wal-note` 16/6。
其中 `r15` 的裸 hex 当前曾从基线 4 增到 8（P2 新增 `skins/iter5/policy-settings.css` 的 `#c67b14`×2、`#b63845`×2）⇒ A1c 已 token 化为 `var(--dam-warn)` / `var(--dam-tone-error)`，**回到基线 4**；失败状态仍为 HEAD 既有。

## 3. A1c 落盘清单（Lead 直接改）

1. 计数锁 86→87：`tests/smoke/smoke-test.mjs:85`、`smoke-test-m3b3.mjs:54`、`smoke-test-context-observer.mjs:119`、`smoke-test-team-routes.mjs:93`、`smoke-test-issue454-panel-lan.mjs:162`；文档 `docs/HANDBOOK.md:89`、`docs/SOURCE-REFERENCE.md:29`。负路径原样保留。
2. `smoke-test-m9-e2e.mjs` 夹具补 3 处注入；`smoke-test-b05-truncation-direction.mjs:120` 正则容两形。
3. **产品文件唯一改动** `lib/injection-zones.js`：登记 `'diagnostic': 'memory'`（+ 归因注释）。
4. `tools/run-smoke.mjs` `HEAVY_MS` 登记 `smoke-test-r4-p4-3-brief-scan.mjs: 11400`。
5. `skins/iter5/policy-settings.css:117-118` 色值 token 化；生成器 `--force` 重建，`--check --strict` = `SYNC-OK`。重建后 client **3,033,568 B / 27,281 行 / 纯 CRLF / sha16 `dbf18ab4`**；`iter5-skin` 26/0、`r26` 26/0、UI 25/0 均通过（无需重钉）。
6. 修正 P2 回执落点失真：策略样式真实落点为新增文件 `skins/iter5/policy-settings.css`，不是 `native-settings.css`。

## 4. 全量回归 R2

`node tools/run-smoke.mjs --jobs=8 --timeout=180000` → **PASS 632 / FAIL 11 / TIMEOUT 0 / FLAKY 1**，354.5s。11 个 FAIL 即 §2.2 的 HEAD 基线红名单；无新增失败。

## 5. P3-B 隔离真实宿主验收

**环境**：`artifacts/_p3b-host-20261118/dsh-home`（memoryRoot/userMemoryDir 均绝对路径指向本目录），profile `p3b` 仅 `dsh-base + dsh-web-app + link:D:/dsh-auto-memory`；端口 **19431**；启动日志含 token；**生产 19387 未读写**。

| 编号 | 判定 | 级别 | 真实操作与实测 |
|---|---|---|---|
| H1 | PASS | HOST | 宿主 boot 日志：`[dsh-auto-memory] ready: engine + 22 tools + injection + 87 routes`；`GET /api/dsh-auto-memory/config` 200 / 16,938 B，`config.deliveryPolicy=null`，envelope preset `human_full`，capabilities 4 presets，`promptSections=13 / must=2`。 |
| H2 | PASS | HOST | `POST /config {deliveryPolicy: PRESETS.human_slim}` 200；回读 `config.deliveryPolicy.presetId=human_slim`、`enabled=true`、triggers `{fullGapRounds:40,slimEveryRounds:15,waterPct:[25],tieredInject:true,hangCompensateEnabled:false,hangCompensateTokens:300000}`、`transport={}`、representation `full + fallback[summary,preview,pointer,omit]`；diagnostics `enabled=false`（默认关）。 |
| H3 | PASS | HOST + a11y | 三入口：① `settings.section` 设置左侧导航「自动记忆」可进入（内容含 记忆设置 + 4 页签）；② `settings.plugins.tab` 「设置 → 内置插件」页签列表 = `插件列表 / 自动记忆`；③ `plugins.detail.section` 插件管理页详情出现「记忆设置」。 |
| H4 | PASS | HOST + DOM | 有保存策略时真实 DOM `[data-dam-policy-legacy-readonly]` 恰 **7 键 ×2 实例**：`injectEnabled / snapshotMinGapRounds / fullInjectWaterPct / slimEveryRounds / snapshotTieredInject / hangCompensateEnabled / hangCompensateTokens`；可见文案「开启 · 已由投递策略接管」与按钮「转到投递策略」「删除策略恢复旧设置」。截图见 §6。 |
| H5 | PASS | HOST API | `POST /config {deliveryPolicy:null}` 200；回读 `config.deliveryPolicy` 为 null，envelope 回落 `human_full`；`promptSections` 仍 13/2。 |
| H6 | PARTIAL | HOST UI | 点「删除策略恢复旧设置」会打开策略页（`投递策略 / 收起策略 / 保存策略 / 删除策略并回滚到旧键适配`）；最终删除按钮触发浏览器原生 confirm，headless CDP 首次未处理导致页面阻塞、关闭标签后重开；**UI 删除按钮端到端未完成**（改由 H5 API 删除并回读）。 |
| H7 | NOT-VERIFIED | — | 真实模型轮的注入效果：隔离 profile 只含 base+web+auto-memory，无 LLM bundle，未触发模型调用；不以单元套件冒充。 |

## 6. 证据文件（`artifacts/_p3b-host-20261118/`，gitignored）

| 文件 | 字节 | 内容 |
|---|---:|---|
| `evidence-settings-dialog.png` | 70,870 | 设置对话框（左侧导航含「自动记忆」） |
| `evidence-settings-section.png` | 90,094 | 自动记忆设置页（记忆设置/4 页签/保存按钮） |
| `evidence-freeze-tab2.png` | 83,551 | 记录与使用页（接管文案与 7 键只读区的宿主态） |
| `evidence-policy-freeze.png` | 83,739 | 策略页/固定态 |
| `evidence-policy-delete-page.png` | — | 策略页（删除入口可见；该次截图未产出，见 H6） |
| `logs/host-boot.log` / `logs/endpoint.txt` | — | 启动日志与端口/token（token 不进报告正文） |

## 7. 未完成/待裁定

1. **11 个 HEAD 基线红**（§2.2）属存量债，本批不修；建议单开「基线债清理批」，逐套件按 HEAD 归因后修夹具/文档或真缺陷。
2. 真实模型轮注入（H7）与用户本机 19387 自身会话：未验证。
3. UI「删除策略并回滚」按钮的 confirm 流程未自动化；需在可见浏览器/宿主 UI 手工确认一次。
4. P3-A2（unit-policy 合同/selector/U2 适配/生产接线）未开工；模块/单位/事件接管不在本批。
5. 提交与发版：工作树仍未提交（HEAD `96bfded8`），等用户裁定。
