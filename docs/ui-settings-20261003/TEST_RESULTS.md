# 验证与复现

基线：upstream main `131ca794b9f0d07f78b19bf6feee3312939854ed`。最终代码使用 Node 22.23.3；Chromium 151.0.7922.173 与 React 18。云端 Linux，未使用用户电脑。

## 项目 CI smoke

项目 `.github/workflows/tests.yml` 指定 Node 22，命令为：

```bash
node tools/run-smoke.mjs --jobs=1 --timeout=90000 \
  --exclude=-live --exclude=m79-feature-v2 \
  --exclude=m710-fv2-emit --exclude=c4-fresh-install
```

| 运行 | 套件 | 通过 | 失败 | 超时 |
| --- | ---: | ---: | ---: | ---: |
| 干净 main / Node 22 | 244 | 241 | 3 | 0 |
| 干净 main / Node 24 | 244 | 241 | 3 | 0 |
| 最终修复 / Node 22 | 246 | 243 | 3 | 0 |

最终全量用时 138.3 秒，退出码 1（由以下三个基线失败导致）；修复未引入新增失败。新增两个设置套件又单独核验通过，含真实目录权限导致的原子配置写失败。

基线三个持续失败：

- `smoke-test-issue109-policy-parity.mjs`：仓库缺 `lib/policies`（JS 优先探测路径）。
- `smoke-test-py-runtime-chain.mjs`：当前机器没有开发 Python venv，C3 实际运行链验收不可执行。
- `smoke-test-s2-skin.mjs`：六个既有皮肤图片不在磁盘，导致六个存在性断言和一个总字节数断言失败；55 个断言通过、7 个失败。

额外捕获并修复一个基线时间相关测试缺陷：`issue162-diagnostic-integrity` 的秘密检查把正常 ISO 时间戳里的 39 秒当成硬编码旧文案。不可变 main 用固定 `2026-10-03T09:41:39.000Z` 复现；修复后相同固定时间 26 个测试全通过，仍拒绝 `39 old sessions`、Bearer 假凭据及非时间戳字段中的假凭据。没有放松生产脱敏。

按 CI 原配置排除，未声称运行如下验收：

- `smoke-test-fresh-download-live.mjs`
- `smoke-test-peer-probe-live.mjs`
- `smoke-test-team-minio-live.mjs`
- `smoke-test-m79-feature-v2.mjs`
- `smoke-test-m710-fv2-emit.mjs`
- `smoke-test-c4-fresh-install.mjs`

## 新增实际引擎 / 文件系统回归

`settings-safety` 直接加载实际 MemoryEngine；临时导出文件测试后删除，生产 exports 未变。测试覆盖迁移异常保留原配置字节、已有目标数据保留、递归重试、用户耐久子目录、损坏 JSON、串行并发保存、实际原子写目录权限失败、复制临时文件故障清理、读异常、迁移期间早先文件变化、整数/时间边界、DSH_HOME 和 symlink 越界。

`settings-routes-safety` 执行出货的真实 route handler，使用真实 MemoryEngine 和临时文件；请求/响应对象与 semantic 原子写失败为 fixtures。覆盖 /config 字段 400 与 all-or-nothing，/semantic-emit 写失败不返回成功和损坏原 JSON 保留，/note 会话落点、CAS、实际文件读、重复拒绝及不可读目标保留。不是浏览器或完整宿主验收。

不可变 main 的用户目录复现另存 `baseline-user-migration.json`：目标目录已存在时根 MEMORY.md 复制成功，summaries 与 greetings 未复制，但 userMemoryDir 已发布。

## Chromium 浏览器

运行：

```bash
npm install --prefix /tmp/dsh-browser-tools --cache /tmp/dsh-npm-cache \
  playwright-core react@18 react-dom@18
DSH_BROWSER_TOOLS=/tmp/dsh-browser-tools CHROMIUM_PATH=/usr/bin/chromium \
  node tests/browser/settings-safety.mjs
```

测试加载完整出货 client factory 和真实 React 18；所有 API 为 fixture。16 组证据通过，浏览器异常 0：

- 保留原始换行/逗号、失败草稿、重挂载恢复、保存规范化、空时间数组关闭。
- 同模型 ID 不同 provider 单一勾选、模态 Escape、密码显隐与 localStorage 不含假密钥、未接线传输禁用并保留旧值。
- 目录关闭重開乱序请求（response-2 先返回，response-1 后返回，旧响应不出现）。
- 连续点击仅一次笔记写请求；保存 A 期间输入 B 保留，经典/新款/冻结款恢复。
- 实际浮层切页、会话身份切换、关闭拒绝/接受、重开恢复；显式笔记 Cancel 确认后清除共享草稿。
- 地点为唯一修改的日历草稿：经典取消拒绝、Escape 拒绝与跨皮肤恢复、显式确认丢弃。
- 外部来源 A→B 的查询后返回 A 不覆盖 B。
- 配置和 semantic GET 新响应先返回、旧响应后返回，新状态保留。
- 两个同时挂载的设置实例 semantic 状态同步。
- 笔记/日历三入口×成功/失败×A 不变/新 B，共 24 个请求未完成时重挂载场景：pending、结果、错误与草稿同步。
- 新款/冻结/经典设置各测 handoff-state 新先旧后及会话切换，旧值立即撤下、旧响应不恢复。
- 新设置入口中英日四页签导航/selected 状态；外观页 390×844 / 1280×900 截图、页面水平溢出与 Tab 焦点移动。不是每页布局或完整键盘验收；旧款/经典入口另测水位交错。部分日文模式文案沿用既有英文回退。

未运行完整 DSH 初始化与会话模型、真实团队网络、Windows UI，以及宿主安装的 document 级 Escape/外点监听整体验收。已测真实浮层按钮及统一 controller 关闭保护；不把 fixture、模拟 hooks/handler 称为上述验收。

## Python 与其他检查

- `PYTHONDONTWRITEBYTECODE=1 python tests/test_m7_features_v2.py`：基线与修改树均 10 个规则测试通过，GoldenParity setUpClass 因缺 `artifacts/m7-live-pre/.../golden-parity-fixtures-v1.jsonl` 报 1 个错误；并非新增失败。
- `node --check`：index.js、client.js、settings-safety.js 通过。
- `node tools/build-iter5-skin.mjs --check`：源文件/生成产物一致。
- `git diff --check`：通过。
- `npm pack --dry-run --json --ignore-scripts`：本地 dry run；settings-safety.js 在包清单中，测试私有 harness 与 artifacts 不进入包，版本仍 3.2.7。没有实际打包发布或版本变更。

完整日志（仅清除行尾空白）、浏览器结果 JSON 与截图在 `artifacts/ui-settings-20261003/`。代码编写后的逐项复审见同目录文档 `REVIEW.md`；为同执行代理第二遍审查，未使用独立第三方代理。

## 独立复审后回归复测

补修前提交 d5899b3 的隔离 `/tmp` 拷贝：新增迁移回归失败（自产 A 残留）；Chromium 新 pending 状态断言失败，继续运行到结果断言也复现成功后新实例 A 不清除。真实 symlink 重叠案例由 mkdir 故障守卫确认旧代码会尝试创建源内目标，守卫阻止了递归，未声称进行了无限复制。

补修后实际引擎/文件系统回归增加归属账本、失败后源更新、新调用恢复、外部目标编辑保留、第二根失败回滚第一根、配置写失败回滚副本，以及 canonical 等同/双向包含创建前拒绝。实际 handler 回归增加同请求并发 200/400、队列/flight 清理，恢复真实会话解析（活 agents、冷 registry、withAgent），及切根等已接纳笔记完成/拒绝新笔记/迁移包含已完成写入/提交后旧落点 409。

统一最终 Node 22 smoke 为 243 通过/3 同基线失败/0 超时，138.3 秒；Chromium 16 组/0 异常。日志见 `artifacts/ui-settings-20261003/smoke-followup-node22.log`、`browser-followup.log`、`pre-fix-migration.log`、`pre-fix-pending-result.log`。Python 与其他原先不具备条件的验收未再次运行，状态不变。
