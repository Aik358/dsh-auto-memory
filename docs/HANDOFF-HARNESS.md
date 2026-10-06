# dsh-auto-memory 交接文档（Handoff）

> 写给：在 DeepSeek Harness 里接手本项目的模型/Agent。
> 写于：2026-09-07。此前工作在 ZCode 环境完成，现移交 harness 内继续。
> 读完后你应该能：知道项目是什么、现在到哪了、哪些坑不能踩、下一步做什么。

---

## 1. 这个项目是什么（30 秒）

`dsh-auto-memory`：一个 DSH 插件，给任何模型外置记忆。npm 包 `@a9i5k4/dsh-auto-memory`（当前 latest **2.1.9**，工作区 `~/.dsh/profiles/web`）。

四大能力：**①主动联想**（Host 侧观察情境，记忆在模型开口前经固定边界注入，前缀缓存字节级稳定）→ **②上下文管理**（对标 GPT-6 Astra：交接账本 + PLAN 白板跨窗口续命 + 水位感知，实验特性默认关，设置→自动化开启）→ **③技能固化**（重复流程 → checklist）→ **④人机交互**（问候/反思/日历/无人值守）。

双半边架构：`lib/index.js`（Host 半：引擎/工具/注入/路由）+ `lib/client.js`（浏览器半：面板 12 页签 + 设置页，手写无 JSX、无反引号模板）。**零运行时依赖**。

## 2. 必读文档（按需取用）

| 文档 | 什么时候读 |
|---|---|
| `docs/M-CM-STATE.md` | **接手第一件事**——M-CM 全部实施过程档案（进度账/代码锚点/调试备忘） |
| `docs/M-CM-PLAN.md` | 动 M-CM 相关代码前——§2-§5 设计、§8 批判分析、§10 审计对账表（带 file:line 锚点） |
| `docs/NEXT-MAJOR-VISION.md` | 做宣传/写愿景前——功能对账清单（§2，35 项全覆盖） |
| `docs/PROMO-STYLE-GUIDE.md` + `docs/NEXT-MAJOR-PROMO.md` + `docs/NEXT-MAJOR-README-DRAFT.zh.md` | 宣传物料三件套（守则→文案库→README 草稿） |
| `docs/MEMORY-SYSTEMS-SURVEY-2026-09.md` | 找灵感时——五大开源记忆系统对比 |

## 3. 当前状态（截至交接）

**已发布 2.2.0**（npm latest / GitHub main / tag 同步；preview 分支 = 开发历史含全部过程提交）。

刚完成的（详见 git log 近 20 条）：
- **2.2.0**：外部记忆继承扩展 ZCode / Kimi Code / TRAE（自动扫描常见数据目录，链接模式只注路径不注内容）；定时做梦式固化（默认 09:30/7 天回看）+ 定时 30 天蒸馏（默认 10:00，无旧日志零成本跳过）；设置页新增「上下文管理」分区（交接白板+水位 7 项，新暴露 PlanChars/LedgerChars/WaterThreshold）；README 中英双语主副标题；快照外部源展示上限 3→6
- **#16-#20 五个 issue 全闭**：session 事件兼容（采社区 PR #17，贡献者已署名）/ greet 500 / 冷却允许 0 / **npm 包缺 python/**（双根部：dev files + release.mjs 生成器硬编码，均已修）
- **M7.6 Python 一键向导**：`lib/python-setup-pre.js`，detect→venv→deps→model 四步，装 `~/.dsh/python-engine/`（用户目录），6 个 API（`/api/dsh-auto-memory-pre/python-setup/*`），设置页有向导组件；GPU 推理开关（勾选装 onnxruntime-gpu；**CPU 基础集无 torch**——int8 档实测不需要）
- **JS 模型迁移用户目录**：`~/.dsh/models/js-semantic/`（原包目录在 npm 更新时被冲掉，用户"下载不成功"的主因）
- GPU 偏好存 `embedding-config.json` 的 `gpu` 键，worker 选 CUDA/CPU provider 自动回退

**未完成/待办**：
1. **live 验证 Python 向导**：真实 539MB 模型下载全链路没跑过（hf-mirror 主源）
2. torch CPU-only wheel 优化（省 200MB+，可选）
3. dsh-desktop 兼容问题跟进：issue #21（bundles 数组缺失导致 inert 形态），等用户回环境信息
4. dsh-draw-gacha 同样中招 @deepseek-ai 作用域问题，未修
5. M-CM3 语义通道 / M-CM4 真实 token 精度（需 host 能力）/ sessionProjections 深度接入（dsh-context 有成熟实现可抄）

## 4. 铁律（踩过的坑，违反会重复事故）

1. **改 lib/index.js 路由后，必须同步 3 个路由数守卫**：`tests/smoke/smoke-test.mjs` / `smoke-test-context-observer.mjs` / `smoke-test-m3b3-pre.mjs`（当前值 **41**）——漏改 = 回归挂
2. **harness ≥0.1.2-rc.1 保留 `@deepseek-ai` 作用域给官方包**：插件身份必须是 `@a9i5k4/dsh-auto-memory`（四处：包名/roster/client loader id/profile 挂载）。旧作用域 = 浏览器半边被静默剔除（入口消失但 host 照跑，极隐蔽）
3. **web UI 有 token 认证闸门**（0.1.2-rc.1 起）：裸 127.0.0.1:3080 返回 401；token 每次重启更换，只在 `dsh web` 终端打印。Agent 自行重启时用 PowerShell `Start-Process cmd '/c dsh web' -RedirectStandardOutput <file>` 捕获新 token
4. **重启 3080 只杀监听进程**（netstat 找 PID），勿动 dsh-doctor supervisor / anchored-monitor；用户自己提权启动的进程杀不动，先做免重启判定（client.js 改动即 live；host 改动比对进程 StartTime 与 git commit 时间）
5. **持久数据绝不放包目录**：模型/用户数据一律 `~/.dsh/`（models/js-semantic、python-engine）——node_modules 更新即重装，包目录数据会被冲掉（#20 和"下载不成功"都是这个反模式）
6. **发布走 `node tools/release.mjs <版本>`**：pre→裸名转换+双闸门校验（python 运行时必须在场/bench 必须排除）。npm 不可变——**发废了只能 bump 版本重发**（2.1.5 的教训）
7. **改 tools/release.mjs 生成器才对**：它生成发布 manifest 时会覆盖 dev package.json 的 description/files（#20 双根因之一）
8. **复杂 JS 注入不用 Python 大段 slice**：反斜杠/换行会被工具层双重吞噬（split('\n') 变真实换行的教训）；用 Edit 工具或 String.fromCharCode
9. **依赖选型必须对照 worker 实际 import**：fastembed 替换 transformers 的教训——注册表无 BGE-M3 且池化契约不同，精度基线（R@5 0.925）会作废
10. **测试接手**：`tests/smoke/smoke-test-handoff-pre.mjs`（43 断言，交接白板+水位全行为测试）是回归主力；抽取函数时方法体引用的模块级符号要逐个注入 new Function 作用域

## 5. 快速验证清单（接手后先跑一遍确认环境正常）

```bash
node tests/smoke/smoke-test.mjs            # 主套件（需 42 路由断言通过）
node tests/smoke/smoke-test-handoff-pre.mjs # 43/43
node tests/smoke/smoke-test-m85-storage-manage-pre.mjs  # 45/45
curl -s http://127.0.0.1:3080/api/dsh-auto-memory-pre/handoff-state  # (需 harness 运行中;loopback 免认证) 返回 enabled:true
```

## 6. 当前 git 布局

- `main`（远端）= 发布历史（裸名、干净）；本地 dev 历史已推 `preview` 分支
- 本地工作区 `D:\dsh-auto-memory`（main 分支，含 dev 合并历史）——与远端 main 已同步（commit `6dd04ba` 后）
- npm token / GitHub PAT：**不存盘**，用时向用户要；.npmrc 用完即删

## 7. 用户沟通备忘

- issue 回复用中文、礼貌、结论先行、给可复制命令（参考 #15/#21 的回复风格）
- 高手群语气谦虚，"写了个…想请大家帮忙看看…欢迎拍砖"；竞品只做事实对照不挑衅
- 报告问题用户的更新报告模板：`artifacts/update-report-2.1.9.md`（逐人致谢格式可直接复用）
- QQ 群链接（README 顶部 + 设置页都有）：https://qm.qq.com/q/v7Asxn6vPa
