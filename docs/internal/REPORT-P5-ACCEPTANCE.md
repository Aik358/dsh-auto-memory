# P5 验收报告 · 分档运行验收与发布（2026-09-16）

依据：`MASTER-PLAN-3.0.md` §Phase 5 + `TODO-GRAPH.html` V2-P5 卡。
纪律（卡内原文）：**发布材料逐项记录通过/失败/未执行 —— 不把「没测试环境」写成「已验收」**；U1（兼容档实测）未完成时不能填写「兼容已验收」；T6-3 资源界限必须事前登记。

## 结论

- **releaseReady = false（如实记录）**——兼容档 U1 尚未实测（无登记设备与负载的实测流程），按 V2-P5 卡口径不得宣称「兼容已验收」。
- 3.0 主体八阶段（P0/P6A/P1/P6B/P2/P3/P4/P5）代码与测试侧全部结项；**发布动作（npm publish / git tag）待用户明示节奏**（用户级既有约定：UI/功能改动先本地联调，未经明确要求不发布）。

## 逐项验收状态（acceptance_pre_v1 清单，7 项必需）

| 项 | 状态 | 证据 / 理由 |
|---|---|---|
| T6-1 兼容配置拦截生成式调用=0 | **通过（代码+测试侧）** | P1 兼容档真值表断言（`smoke-test-p1-concurrency-pre.mjs` T1-8/T1-9）+ 兼容档目录/词法展开路径在 92 套件回归全绿（PASS 92 / FAIL 0 / TIMEOUT 0，147.1s） |
| T6-2 前台/后台时间分开测 | **通过（结构侧）** | P4 rerank-host：offer 即返 accepted（前台绝不等待），后台完成只进缓存 — `smoke-test-p4-rerank-window-pre.mjs` T5-3R 断言 |
| T6-3 资源界限事前登记 | **通过（登记侧）** | 实测数据已登记：bge P95 37.4s/RSS 3.84GB、qwen P95 8.8s/RSS 4.95GB、torch 2.13.0+cpu（`artifacts/m7-rerank-pre/results.json` + `results-qwen-probe.json`）；P4 killGrace 5s 机制化 |
| T6-5 最终动态文本全量计费/尾注不重复/交付幂等 | **通过（代码+测试侧）** | P6A/P0 分项账本（`memory-envelope-pre.js`）+ 注入断言套件；92 套件回归全绿 |
| T6-6 开关退回后撤回不出现/预算守住 | **通过（代码+测试侧）** | P6B kind 持久化+撤回套件、P2 引擎开关解耦（identity 门=indexing 开关、复用=delta 开关）；legacy 回滚路径=P3 `opts.fusion:'legacy'`、P4 rerank 档位 off |
| T6-7 隔离目录发行产物入口测试 + 工具能力矩阵 | **未执行（如实）** | 未在隔离目录从 npm 发行产物运行入口测试（需发布产物先打包；发布节奏由用户明示）——不写成「已验收」 |
| compat-U1 兼容档实测（冷启动/P95/RSS/峰值/磁盘/积压年龄） | **未执行（如实）** | 无登记设备与负载的实测流程；本机仅有 bge/qwen 精排基准（T6-3），不构成兼容档全量实测 |

## 变异演示（守卫真失败证明）

`artifacts/_mutate-p5.mjs`：撤 U1 兼容门 → 红；撤 release-ready 门 → 红；撤未知项拒绝 → 红（3/3，SHA256 逐字节还原）。

## 后续（待用户明示）

1. 兼容档实测流程（登记设备+负载 → 跑 U1 → 回填 acceptance 清单 → releaseReady 翻 true）。
2. 隔离目录发行产物入口测试（T6-7）——随首次发布一并执行。
3. 发布节奏由用户裁定；本窗口不发布、不推送、不建 tag。
