# 前端修复执行总案：生成器两条铁律 + 缺陷清零（2026-10-02）

> **文档性质**：修复执行方案，供执行 agent 逐项施工。**本轮不改任何代码。**
> **基线**：`wip/20260926-teamwork @ 11b6dba`（v3.2.7）。
> **前置文档**：体检报告 `docs/internal/FRONTEND-STATUS-ASSESSMENT-20261002.md`（现状依据）；审计报告 `docs/internal/AUDIT-20261002-FULL-VERIFICATION-AND-FIX-PLAN.md`（40+ issue 修复总案，其中前端批次 D/E 由本文档**接管并细化**，3 处口径修正见 §4 各条目）。
> **行号说明**：全部 file:line 已在 11b6dba 上人工核实；施工时以**内容匹配**为准，行号允许 ±2 漂移。
> **总纪律**（全程有效）：改生成区/生成器注入区的代码必须改源（`skins/iter5/*.js`、`skins/legacy/iter5-325.js.frozen` 或生成器本身）再跑生成器；手写区直改 client.js；每完成一项跑 §7 的守卫五件套。

---

## §1 本轮用户裁定（两条铁律）

1. **R1 同步即通过**：生成器计算出的产物与磁盘上的 client.js **逐字节一致 ⇒ 验证通过**。
2. **R2 失配即停机**：源文件改了、而生成器没有同步跟上（变换点失配 / 产物含无主内容）⇒ **必须硬停**，报错并要求先把生成器同步好，**不允许静默生成、不允许告警后照写**。

> **裁定变更声明**：生成器注释与 generator-guard 测试里固化的旧裁定「默认只告警不拦——用户裁定不能太严格、不要动不动回滚」（build-iter5-skin.mjs:729、smoke-test-generator-guard.mjs ⑤ 段）**自本方案起被 R2 取代**。执行 agent 落地 G0-3 时必须同步翻转 guard 测试 ⑤ 的断言与头部警告文案，不得保留旧行为。

现状要点（详见体检报告 §4）：`--check` 幂等实跑已通过（R1 的事实基础已成立）；R2 目前只覆盖一部分——48 处 replaceOnce 唯一匹配会响亮失败，但**约 25 处裸 replace 静默 no-op**、**4 处锚点无 -1 检查**、orphanedLines 在默认模式**告警后照写**。

---

## §2 生成器行为矩阵（目标态）

| # | 情形 | 现行为 | 目标行为（本方案落地后） |
|---|---|---|---|
| 1 | 源 × 生成器 === 磁盘 | `--check` 绿，`up to date` | **PASS**：输出 `SYNC-OK`，退出码 0（唯一通过判据，R1） |
| 2 | 源改了、产物未重建 | `--check` 报 stale | stale（提示重建）——正常流程，不是故障 |
| 3 | 源结构变了、生成器变换点失配 | ~25 处静默 no-op；4 处锚点 -1 静默产出坏片段 | **硬停**：`[G2] 源已变，生成器未同步：<变换点名>`，exit 2（R2-a） |
| 4 | 产物被手改（含生成器注入区），未落源 | 默认模式：告警后**照写**（丢改动） | **硬停**：orphanedLines 非空 → exit 2，列出将被丢弃的行；仅显式 `--force` 可覆盖（R2-b） |
| 5 | frozen 镜像与三面漂移 | 仅 settings-parity 查键集，行为表达式漂移无人管 | 新增 frozen 镜像守卫（G0-5），漂移即红（R2 的测试面延伸） |

---

## §3 批次 G0：生成器加固（必须最先做，是后续一切前端改动的护栏）

### G0-1 R1 固化：`--check` 为唯一 PASS 判据

- **现状**：`--check` 已是真只读（内存计算 → :747 重读磁盘 → :770-772 比对，writeFileSync 仅在 :774 非 check 分支），当前实跑 EXIT=0。
- **改法**（小）：①成功输出改为显式 `SYNC-OK: sources × generator == lib/client.js`（原 `up to date` 保留同义输出）；②stale 报错文案追加一句"若源刚改过属正常，请重建；若没改过源，说明产物被人手改，见 R2"；③把 `--check` 写进 `skins/iter5/README.md` 的 SOP 首位。
- **验收**：`--check` 绿时输出含 SYNC-OK；对 client.js 做任一字节扰动后 `--check` 非零退出。

### G0-2 R2-a：变换点全部响亮化（消灭静默 no-op）

- **改法**：把下列三类失败模式全部改为 throw，错误文案统一格式：
  `[G2] 源已变，生成器未同步：<变换点名>（期望 <唯一/N 处>，实际 <M 处>）——请同步 tools/build-iter5-skin.mjs 的该变换点，不要绕过生成器。`
  1. **裸 replace/replaceAll 群 → replaceOnce 或显式计数断言**（源结构变化时现在静默跳过）：`:289`（tauHi 文案）、`:303`（dam-settings-→i5-）、`:307`、`:308`（×4 replaceAll）、`:311`（storage fetch 错误处理）、`:372-375`（文案改写链，每条独立断言）、`:386`（DamSkinV4Page→Iter5Page 换名）、`:395/:401`（legacy 块挂载与 knob 注入）、`:417/:419/:421/:435`（includes 守卫式 replace——改为"守卫命中但 replace 未命中即 throw"）、`:439/:442/:443/:445`（tourDeep 系）、`:481/:484`（D2 订阅注入，:484 现为静默跳过）。已响亮的 48 处 replaceOnce 与 H3-1 守恒断言不动。
  2. **无 -1 检查的锚点 → 检查 + throw**：`:54-55`（frozen 切片 `lbIdx/leIdx`——frozen 标记被改坏时现在静默产出碎片）、`:161-162`（saveStart/fieldStart）、`:199-200`（modeStart/modeEnd）。另 `stripBlocks`（:97-108）"BEGIN 有而 END 无"的 break 改为 throw。
  3. **错误信息必须可行动**：每个 throw 点写明"是哪类源变化会触发、该去生成器哪里同步"（一句话即可，参照 H3-1 :614 既有文案风格）。
- **验收**：对任一被改写的目标串（如把 skins/iter5/settings-copy.js 里某个被 ：372 改写的文案改动一字），跑生成器必须 exit 2 且错误信息点名该变换点；恢复后 `--check` 绿。
- **预期噪音（重要）**：G0-2 落地后首次真实重建，存量失配会被一次性翻出来（最可能的是 `:386` 死壳变换点——若 G3 已摘死壳则该点应同步退化为断言）。这是 R2 在正确工作，按文案逐个同步生成器即可，**严禁为转绿把断言改回静默**。

> **G0 执行记录（2026-10-03，commit 11b1c52）**：六项全部落地，全量 smoke 253/0（基线 251+新增 2 套件）。两条执行期纪律修正，固化为 R2 的组成部分：
> 1. **`replaceMigrated` 第四类**：首跑翻出的 4 个零命中点（:386 死壳换名/:439 ensureStyle/:443/:445 tourDeep）经 `git log -S` 回溯全部是"更早提交已迁移到位"，不是"源变了没同步"。R2 的「失配」必须区分两种态——**源变了没同步（硬停）** vs **已迁移过（断言迁移后形态仍在即放行）**；两者皆无才停。`--check` 绿本身就是输入处于已迁移态的证明。
> 2. **真跑生成器的测试必须用 os.tmpdir() 整仓副本**（lib/+skins/+tools 复制后按生成器自身位置解析 root，行为等价），真仓库只留只读断言——run-smoke `--jobs=4` 下原地真跑会产生并发读者读半写文件的假红。
> 3. frozen-mirror 套件以 `KNOWN_DRIFT` 豁免登记了一条既存漂移（frozen 侧 snapshotMinGapRounds 旧口径 `Number(v)||5`）——这正是 G1-1 的 frozen:1470 项，由批次 C 销账；套件设计为三面一致时自动红并要求删除该豁免条目。

### G0-3 R2-b：orphanedLines 默认停机

- **现状**：orphanedLines（:730-745，对比"磁盘现有 vs 本次将写出"，唯一能定向指出"谁会丢"的检测）只在写盘路径跑（:749），默认模式打印告警后照写（:750-768），--strict 才 exit 2。
- **改法**：①orphan > 0 时**默认即 exit 2 拒写**（--strict 语义成为默认，:764-767 分支上移）；②新增显式逃生门 `--force`：打印完整将被丢弃行清单后照写（旧行为），头部警告块（:16-32 一带）同步改写为"默认停机；--force 是明确放弃这些内容的信号"；③`--strict` 保留为 `--force` 的反义别名（等价于新默认），避免外部脚本破坏；④**翻转 generator-guard 测试 ⑤**：默认模式断言从"仍写盘（探针行被覆盖）"改为"exit 2 且探针行存活"，新增 `--force` 用例断言覆盖发生；⑤同步更新生成器头部注释 :729 的裁定记录（注明 2026-10-02 用户改裁）。
- **验收**：注入探针 → 默认模式 exit 2 且探针在；`--force` 覆盖且输出列出了探针；guard 测试全绿。

### G0-4 恢复幂等验收 fixture（R1 的自动化）

- **现状**：原 fixture 幂等守卫在病根 3 事故期被移除（smoke-test-iter5-skin.mjs:396-407 注释写明"待生成器改正则配对后由维护者按需恢复"）；当前**没有任何自动化测试验证生成器幂等**。恢复判据（"能在当前 client.js 上幂等重跑且 --check 通过"）现已满足。
- **改法**：新套件 `tests/smoke/smoke-test-generator-idempotent.mjs`：
  1. 记 `H0=sha256(client.js)`；备份文件内容到内存；
  2. 子进程真实跑一次生成器（无 flag），`finally` 中恢复备份（backup/finally 纪律照抄 smoke-test-generator-guard.mjs ④ 段的既有先例）；
  3. 断言 `H1 === H0`（真实重建是 no-op）；
  4. 断言随后 `--check` 绿；
  5. R2 负路径联动：注入探针行 → 默认模式断言 exit 2 且探针存活（与 G0-3 验收呼应）。
- **验收**：套件全绿；注释里写明恢复出处（:396-407）与本轮判据满足的证据（2026-10-02 --check 实测）。

### G0-5 frozen 镜像守卫（堵"改了但镜像漏了"）

- **现状**：frozen 是唯一没有"改源重建"路径的第三副本，v3.2.6 就有改漏实锤（normalizeGapRounds 定义没进 frozen，见 G1-1）；settings-parity 只查键集，不查行为表达式。
- **改法**：新套件 `tests/smoke/smoke-test-frozen-mirror.mjs`，对四个自宿主切片组件（Settings/Storage/Skills/Stats）在 classic（手写区）/frozen/v4 块三面做两级比对：
  1. **签名级**：`function <名>(` 定义存在 + 生成器切片锚（build-iter5-skin.mjs:116/:309/:346/:359 的目标串）三面都能找到；
  2. **表达式级**：抽已知三副本点（pyOk 判定、headroom/compactionRatio/waterMode onChange、normalizeGapRounds 调用、saveConfigPatch 引用）逐面比对规范化文本；另对每面抽 `set('<KEY>'` 键集断言 frozen ⊇ classic（防再出现"调用点镜像了、配套没镜像"）。
  任一漂移即红，错误信息指向"frozen 需手工镜像，参考 skins/iter5/README.md 同步节"。
- **验收**：人为把 frozen 某一 onChange 表达式改回旧口径 → 套件红且点名组件与键。

### G0-6 配套卫生

1. `tools/build-iter5-skin.mjs.stage1`（58KB 旧副本，无任何防线）**删除**；skins/ 与 tools/ 下约 18 个 `.bak-*`（~2.3MB）本地清扫（均为 gitignore 外未跟踪文件，不入库）。
2. `skins/iter5/README.md:16` 措辞改为与实现一致："replaceOnce 群要求唯一匹配；其余变换点在 G0-2 后同样响亮失败"（G0-2 落地后原话即成立）。
3. 生成器头部注释补一行纪律："运行生成器的唯一合法序列 = `--check` →（需重建时）`--strict` 干跑看将丢弃行 → 无 orphan 才允许实跑；无 flag 实跑前必须 `--check` 绿"。

### G0 批次验收

- 行为矩阵 §2 的 5 行全部实测符合；
- generator-guard + generator-idempotent（新）+ frozen-mirror（新）三套件全绿；
- 全量 smoke 不因 R2 收紧出现意外红（预期内的一次性失配按 G0-2 验收节处理）。

---

## §4 批次 G1：自产缺陷清零（7 项，全部"我方自产"，与社区 PR 无关）

> 归属速记：**【源】**=改 skins 源或 frozen 后重建；**【手写】**=直改 client.js；**【成组】**=多副本必须一次改全。每项完成后跑守卫五件套（§7）。

### G1-1 normalizeGapRounds 越界（P1）——v3.2.6 引入，#160-7 修复实际失效

- **成因**：6b9b22a（v3.2.6）做 #160-7 修复时，把 helper 定义插进了 `damSkinCssText()`（:9948-10072）函数体内（:9957-9963）；8 个 client.js 调用点（legacy 块 :12074-12075、v4 块 :15159/:15161/:15162、手写 SettingsPage :17932/:17934/:17935）与 2 个 frozen 调用点（frozen:1472-1473）全部在别的作用域，词法不可达。**frozen 侧定义没镜像、fSnapGap（frozen:1470）仍是旧 `Number(v)||5` 口径**——重建会把带毒调用端到端再生产一遍。
- **后果**：三种皮肤档设置页的"快照最小间隔（snapshotMinGapRounds）/精简节奏（slimEveryRounds）/全量精简间隔（fullEverySlims）"任一数字输入 onChange 即 `ReferenceError`，值存不进去；且三块解析口径互不自洽（#160-7 要防的"0 被吞"变成了"直接崩"）。
- **修复**：
  1. 定义 :9957-9963 **上提到工厂层**（与 `damSkinCssFlavor` :9944 同层；生成器 H3-1 只管 damSharedSurfaceCss，不管这个函数，属手写区自由区直改）；
  2. 调用点统一为 normalizeGapRounds 口径：手写 SettingsPage :17932-17935【手写】已对齐无需动（只随定义上提受益）；**frozen:1470 的 fSnapGap 旧口径改为 normalizeGapRounds(e.target.value, 5)【源】**；
  3. 三块 fallback 值对齐 #160-7 语义（0 合法；snapshotMinGapRounds fallback=5、slimEveryRounds/fullEverySlims fallback=3，以 :15159 现值为准统一）；
  4. 跑生成器重建一次，覆盖 legacy/v4 两个生成块的调用点。
- **验收**：vm 真执行三个设置面的 onChange：0/正整数/空串/非法值四类输入，断言 set 收到的值符合 #160-7 语义且**无异常**；`grep -c "normalizeGapRounds"` 全文件=定义 1 + 调用 10（8 client + 2 frozen 镜像后）；新增守卫断言"damSkinCssText 函数体内不得有 function 定义"（防复发，可并入 frozen-mirror 套件）。
- **与审计报告差异**：审计批次 D 定 P2/5 处调用点；本文档升级 P1/10 处并补 frozen 同步——以本文档为准。

### G1-2 I18N.ja 七个 `__fn` 键（P1）——ja 档进记忆中枢即崩

- **成因**：PR #143 日文字典以 JSON 序列化带入（client.js:938-1550），函数键降级为 `{__fn:true, src:"function…"}` 占位对象；`t()`（:2464）无类型甄别直接返回真值对象。
- **后果**：7 个坏键——hubEvLine(:1184)、hubScopeCounts(:1201)、hubScopeReasons(:1210)、hubWhyCorrectionRate(:1229)、hubWhyDiversity(:1233)、hubWhyHasCorrection(:1237)、hubWhySuccess(:1246)；**19 个裸调点**（hubScopeCounts :6868/:12704/:15748，hubScopeReasons :6842-6847/:12678-12683/:15722-15727，hubEvLine :6922/:12758/:15802，hubWhy* :6633-6637）在 ja 档抛 TypeError；真 React 无外层错误边界 ⇒ classic 档整根白屏。
- **修复**（两层，全部【手写】直改，无需重建）：
  1. **还原**：把 7 个 `__fn` 条目还原为真实函数字面量（`src` 字符串里就是现成代码，去包装即可；**严禁 new Function/eval**）；
  2. **兜底**：`t()` 改为 `var v = I18N[locale] && I18N[locale][key]; if (v && v.__fn) v = null; return v || I18N.zh[key] || key`——未来再出现坏键回落 zh 而非崩。
- **验收**：i18n-really 套件加 7 键断言（ja 键 typeof === 'function'）；真机 ja 档进记忆中枢/技能页正常渲染。
- **与审计报告差异**：审计记 3 处调用点/7 键中 PR 只修 hubScopeCounts；本文档修正为 19 调用点/7 键全修（收口在 t()）。

### G1-3 调试中心挂载自动 POST（P1，前端收敛 + 后端闸两个动作）

- **成因**：DebugCenter（:16270，手写区）`refresh()`（:16299-16319）挂载即对 11 个端点探测，其中 5 个 POST（recall/summarize/greet/workspaces/**reflectAuto**），挂载点 5 处（:10910/:12376/:13353/:15458/:18235），storage 页访问即挂载。
- **后果**：看一眼调试中心 = 白白消耗模型调用（greet/workspaces 缓存缺失时真实调模型）+ 写 workbench 计数；**reflectAuto 无 pending 时回落最近日志日并不加锁覆盖 `reflections/<date>.md`（index.js:11387→:11390→:8918），已完成的反思会被"(待补充)"模板毁掉**——数据破坏面。
- **修复**：
  1. 前端【手写】：`refresh()` 收敛为单次只读 `fetch(API.debug)`（审计报告 A7 的 PR #206 hunk 即此方案，可直接采）；
  2. 后端【后端】：`reflectAuto`（index.js:11387）加闸——无 pending 且回退日期的反思文件已存在时**直接返回提示不覆盖**（不要在 saveReflection 上加全局禁止，memory_reflect 显式重写是合法用例）。**这一闸 PR #206 没做，是本文档新增的必做项。**
- **验收**：真机打开调试中心，网络面板零业务 POST（仅 1 个 GET /debug）；对已有反思的日志日调 reflect-auto 返回提示且文件字节不变。

### G1-4 皮肤家族切换不通知挂载根 + setNonce 死回调（P2）

- **成因**：家族切换权威状态在 localStorage（SkinPicker.pick() 双写 dam-skin-style + presentation.v1），但唯一家族分派点 MemoryPageView（:16097-16104）只订阅 controller，无人通知它重渲染；三处 `onSwitch` 引用组件局部才存在的 `setNonce`（:12319 legacy 块、:15406 v4 块、:18179 手写区）⇒ ReferenceError 被 catch 吞。
- **后果**：切换家族后存储与 CSS 已落盘，但挂载的组件树不切换，要等无关 tick 或重载；SkinPicker 高亮停留旧值。
- **修复**（源+产物成对）：
  1. `skins/iter5/style-choice.js` iter5SetStyle 末尾加 `try { window.dispatchEvent(new Event('dam-skin-changed')) } catch (eSkin) {}`【源】；
  2. 手写区 MemoryPageView（:16034 后）加 useEffect 订阅 `dam-skin-changed` → nonce bump；MemoryPanelFloat（:16133）可选加；
  3. 三处 onSwitch 无害化：:18179【手写】直改；frozen:1717【源】；:15406 由重建覆盖；
  4. 重建一次。**勿动三键互斥双写语义，勿做"统一状态源"式重构。**
- **验收**：真机四款家族两两互切，页面即时切换且高亮正确；h43/theme-sync 与 skin-pluggable 守卫绿。

### G1-5 Python 健康判定三份（P2）

- **成因**：后端状态枚举已换血为 `verified-ok/ready-unverified/…`（index.js:13926-13932 权威注释，全后端无裸 'ready'），前端白名单三份仍是 `rt.state === 'ready'`（:11842 legacy 块/:14929 v4 块/:17699 手写区）——三态改造（2026-09-30）只漏了这一行。
- **后果**：Python 引擎真实可用时诊断读数行恒显"不可用"，与同页检测面板自相矛盾，误导重复安装。
- **修复**【成组】：三处改 `(rt.state === 'verified-ok' || rt.state === 'ready') && rt.depsOk !== false`（保留 'ready' 兼容旧缓存 payload）：:17699【手写】直改；frozen:1240【源】；:11842/:14929 由重建覆盖。**四处成组，漏 frozen 必被下次重建回退。**
- **验收**：真机 Python verified-ok 时读数行显示就绪；settings-parity 绿。

### G1-6 headroom 显式 0 存不进（P2，与 G1-1 同批统一数值解析口径）

- **成因**：`Math.max(0, Number(v) || 65536)` 三份（:12093/:15180/:17953）——0 为 falsy 被顶成 65536，而 input `min:0` 允许 0。
- **后果**：用户无法经 UI 把 headroom 设为 0（审计批次 C 的 F17 会把 DEFAULT_CONFIG 两键改 undefined 让 preset 接管，届时"显式 0"是合法输入，本缺陷会从显示问题升级为功能缺口）。
- **修复**【成组】：三处同改解析式：`var n = Number(e.target.value); set('officialHeadroomTokens', String(e.target.value).trim() !== '' && Number.isFinite(n) ? Math.max(0, n) : 65536)`。:17953【手写】；frozen 对应段【源】；:12093/:15180 重建覆盖。
- **验收**：三面输入 0 → saveConfigPatch 发出 0；空串 → 回退 65536；与 G1-1 一并验证三面 parity。

### G1-7 白板全文缓存负缓存（P2，前端先行，后端 revision 随审计批次 C）

- **成因**：wbFullCache（:4651-4671，手写区）失败也缓存空串（:4664-4665 ok:false 也存 / :4667 catch 也存），键仅 card.id 无版本维度。
- **后果**：首次读取失败后该卡永远只显 preview 不再重试；改同标题小节正文后展开显示旧全文。有 preview 兜底不白屏。
- **修复**【手写】（先做最小两步）：①`ok:false`/异常路径**不写缓存**；②缓存加上限（256 条，满则清空）。revision 键（`[sessionId, id, revision]`）依赖后端 wb-sidecar 卡片加 `revision=sha256(body)`（审计批次 C 的 #195/#203 hunk），后端落地后再补键。
- **验收**：模拟后端 ok:false → 重试发起；后端 revision 就位后改卡片正文 → 展开显示新全文。

---

## §5 批次 G2：团队前端（条件批——先等用户对审计批次 B 的裁定）

团队前端四子项（teamFromState 读不存在的 st.team、teamPhaseOf 兜底假 'synced'、ConflictCenter 硬编码 items:[]、四按钮 onX 全 undefined，证据见体检报告 §8-2 A9）**依赖后端接线**（审计批次 B：/team-state 补字段 + /team-control 路由）。二选一：

- **分支 1（团队本期上线）**：随审计批次 B 的 PR #209 团队 hunks 一起落地（前后端硬配对，见审计报告 §4-2），前端改动集中在 client.js:9177-9758 手写区团队层。
- **分支 2（本期不上线）**：最小防误导一行【手写】：`teamPhaseOf` 兜底 `'synced'` → `'offline'`（:9431，缺数据不得显示已同步）；面板四按钮 disabled 化（:9320-9322 附近，props 缺失时禁用而非静默 no-op）。其余留待后续。

**无论哪个分支**，renderTeamSettings15 死代码删除归 G3。

---

## §6 批次 G3：清理项（一个独立小 PR）

| 项 | 内容 | 注意 |
|---|---|---|
| 死壳族裁决 | **建议摘除** DamSkinV4Page/Screen/Home/Welcome/Settings、DAM_SKIN_V4_PAGES、DAM_SKIN_V4_HOSTED(7 屏) 全族（~440 行）+ TOUR_STEPS 的 window 暴露（:16646，唯一消费者是死壳） | 生成器 :386 的 `h(DamSkinV4Page…→h(Iter5Page…` 变换点会失配——**这正是 R2 的价值**：正确顺序 = 先把该变换点退化为"断言已无 DamSkinV4Page 引用"或删除，再摘死壳，重建，`--check` 绿。另一选项是恢复死壳挂载（不推荐：遗留四项粗装都在里面） |
| renderTeamSettings15 | 删除 ：9713 + 配套 TEAM_FIELD_DEFS/TEAM_SEL_OPTS :9701-9711（零调用者） | 手写区直改 |
| StatsTab 缩进 | :8048 `function StatsTab() {` 0 缩进统一为两级（纯观感；生成器切片按签名不按缩进，无功能风险） | 重建后 iter5-skin 快照哈希重钉 |
| frozen 剥离顺序注释 | tests/lib/skin-bundle.mjs 的"先 legacy 再当前"陷阱注释保持（勿动） | — |

---

## §7 执行顺序与守卫门

```
G0（生成器加固：G0-1 → G0-2 → G0-3 → G0-4 → G0-5 → G0-6）
   │  ← G0 必须最先：R2 是后续所有改动的护栏
   ▼
G1-1（normalizeGapRounds，含 frozen 同步）→ G1-6（headroom，同一数值口径批）
   → G1-2（ja 七键）→ G1-3（调试中心+后端闸）→ G1-5（pyOk）→ G1-4（皮肤切换）→ G1-7（缓存）
   ▼
G2（团队前端：等用户分支裁定）
   ▼
G3（清理：死壳摘除 → renderTeamSettings15 → StatsTab 缩进）
```

**守卫五件套（每完成一项必跑）**：
```bash
node tools/build-iter5-skin.mjs --check        # R1：SYNC-OK
node --check lib/client.js                      # 语法
node tests/smoke/smoke-test-iter5-skin.mjs      # 快照哈希（重钉时按十次演进惯例带归因注释）
node tests/smoke/smoke-test-settings-parity.mjs # 三面键集
node tests/smoke/smoke-test-settings-sync.mjs   # 广播语义
# 涉及主题/皮肤切换加跑：h43-theme-sync、skin-pluggable、h1-outer-surface-skin
# G0 落地后加跑：generator-guard、generator-idempotent（新）、frozen-mirror（新）
```

**哈希重钉纪律**：本方案 G1/G3 的手写区与生成区改动会使 iter5-skin:70 经典档快照哈希与 r26 系计数失配——按仓库既有惯例重钉，每次重钉在测试注释里写明归因（"2026-10-02 前端缺陷清零批：G1-x/G3-x"），并确认"守卫语义不变：生成块之外的非意外改动仍会被抓住"。

---

## §8 全局验收清单

1. **守卫**：全量 smoke 全绿（当前基线 237+ 套件；G0 新增 2 套件）。
2. **R1/R2 行为矩阵**（§2 五行）逐行实测通过，generator-guard 断言已翻转。
3. **真机抽验**（宿主重启后）：
   - 三种皮肤档下，快照/精简节奏三个数字输入：0、正整数、空串、非法值均可保存且语义正确（G1-1）；
   - ja 档进记忆中枢/技能页正常渲染不白屏（G1-2）；
   - 打开调试中心网络面板仅 1 个只读 GET；对已完成反思的日志日调 reflect-auto 返回提示、文件字节不变（G1-3）；
   - 四款皮肤家族两两互切即时生效（G1-4）；Python verified-ok 时读数行就绪（G1-5）；headroom 可存 0（G1-6）；
   - 白板读取失败后重试可恢复（G1-7）。
4. **SOP 固化**：G0-6 的生成器头部纪律 + README 更新入库；`.stage1`/`.bak` debris 已清（本地）。
5. **commit 纪律**：G0 是重大工程动作，commit message 必须点名（"生成器 R2 硬停落地"，不再只活在注释里——v3.2.6 的教训）。

---

## §9 风险与回滚

1. **G0-2/G0-3 落地即红**：存量失配（尤其死壳变换点 :386）会被一次翻出——预期行为，按错误文案逐个同步生成器；严禁改回静默。
2. **重建覆盖面**：G1 多项要求重建；重建前必跑 `--check` 确认当前同步，重建后必跑 `--strict` 语义（默认已停机）确认无 orphan——G0 未落地前（施工顺序上不存在该窗口，因为 G0 最先）旧默认模式会告警后照写，若因故乱序施工，务必手动用 `--strict` 干跑。
3. **回滚**：每个批次开始前打 git 提交点；client.js 改动可按批次 revert；生成器改动回滚后必须重跑 `--check` 确认回到定点。
4. **与审计批次的关系**：G1-3 的前端收敛、G1-7 的后端 revision、G2 的团队接线分别与审计批次 A/C/B 的 hunk 重叠——执行 agent 应"一处修复只做一次"，以本文档的增量（reflectAuto 闸、revision 键、团队分支裁定）为准补差，避免同文件两套 hunk 打架。

---

*方案依据：体检报告（4 个并行只读深查）+ 审计报告（10 个核查代理）+ 本轮 3 组锚点人工复核（生成器静默变换点、normalizeGapRounds 8+2 调用点、pyOk/headroom 三副本行号）。全部证据 file:line 可回溯。*
