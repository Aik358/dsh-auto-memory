# 第三方验收报告 · dsh-auto-memory P1–P4（注入截流七档模型）

**交付给**：独立验收 Agent
**日期**：2026-10-26
**提交范围**：`c3309c54`（P1+P2）→ `ad767a39`（P3+P4）
**工作目录**：`D:\dsh-auto-memory`

---

## 0. 你的任务

对 `c3309c54` 与 `ad767a39` 两个提交做**独立验收**。

**核心要求**：

1. **不要相信本文档的任何结论** —— 每一条都要你自己跑一遍验证。
2. **必须真执行**，不能只看源码字符串。本仓有「断言源码含某字符串 = 恒真守卫，不构成功能验收」的硬纪律。
3. **每条验收都要有负路径**（证明「如果代码错了，这条会红」）。
4. **报告必须分线**：后端线 / 前端线分开，不得合并成一个总分数。
5. 发现任何**文档与代码不一致**，以代码为准，并把不一致列为缺陷。

---

## 1. 背景：这次改了什么

### 1.1 七档注入模型

用户（插件作者）与 AI 经过 7 轮澄清，确认了「七档注入矩阵」，核心裁定是：

> 「用户发声的完整版 / 用户发声的精简版 / 运行当中的完整版 / 运行当中的精简版 /
>  压缩后的完整提醒 / 交接的文档注入 —— 要**分开考虑，不可混为一谈**。」

| 档位 | 含义 | 触发条件 |
|---|---|---|
| F1 HUMAN_FULL | 用户发声完整版 | 水位跨阈值 + 真人请求（P2） |
| F2 HUMAN_SLIM | 用户发声精简版 | 真人请求 + 未达完整版门槛 |
| F3 RUN_FULL | 运行中完整版 | 非真人 + 达轮次门槛 |
| F4 RUN_SLIM | 运行中精简版 | 非真人 + 未达门槛 |
| F5 POST_COMPACT | 压缩后重建 | 刚发生压缩 |
| F6 HANDOFF_CARRY | 交接文档注入 | 会话接续 |
| F7 HANG_COMPENSATE | 挂机代位补偿 | 挂机 + 累计 token 达阈值（**默认关**） |
| LEGACY | 回退档 | 档位未判定时（= 改前行为） |

### 1.2 各档的内容差异（P3+P4 的产出）

| 档位 | 白板 | 规则 | 画像 | semantic-recall |
|---|---|---|---|---|
| F1 | **全文** | 全文 | 投 | 投 |
| F2 | 核心 3 节 | 全文 | 投 | 投 |
| F3 | 核心 3 节 | 全文 | **不投** | **不投** |
| F4 | **不投** | **摘要** | **不投** | **不投** |
| F5 | 核心 3 节 | 全文 | 投 | 投 |
| F6 | **全文** | 全文 | 投 | 投 |
| F7 | 核心 3 节 | 全文 | 投 | 不投 |
| LEGACY | 全文 | 全文 | **不投** | **不投** |

---

## 2. 开工前必做（环境与基线）

```bash
cd /d/dsh-auto-memory

# ① 确认提交存在
git log --oneline -3
# 期望看到：ad767a39 / c3309c54 / 600c59b6

# ② 确认工作区干净（本轮文件）
git status --porcelain lib/ tests/smoke/ skins/ docs/ README*.md
# 期望：无输出

# ③ 记录基线物理量（后面要复算）
node -e "const fs=require('fs');const s=fs.readFileSync('lib/index.js','utf8').replace(/\r\n/g,'\n');const c=require('crypto');console.log('index.js LF 长度:',s.length);console.log('sha16:',c.createHash('sha256').update(s).digest('hex').slice(0,16).toUpperCase())"
# 期望：长度 1296924 / sha16 4AAEC9C93E09E61B
```

> **注意**：仓库根目录有大量历史临时文件（`.ci-log-*`、`.d-*`、`.diag-*` 等）。
> **不要**用 `git add -A` 或 `git add .`。本任务不需要提交任何东西。

---

## 3. 验收项（逐条执行）

### 3.1 后端线

#### A. 纯函数（必须真执行，不能只看源码）

三条命令都要跑，**看实际返回值**：

```bash
node tests/smoke/smoke-test-v5-p2-water-pct.mjs
node tests/smoke/smoke-test-v5-p3-tier-content.mjs
node tests/smoke/smoke-test-v5-p4-content-tier.mjs
```

| 套件 | 期望 |
|---|---|
| `v5-p2-water-pct` | PASS 45 / FAIL 0 |
| `v5-p3-tier-content` | PASS 44 / FAIL 0 |
| `v5-p4-content-tier` | PASS 45 / FAIL 0 |

**⚠️ 这还不够** —— 套件可能是「假绿」。你必须**独立验证**以下行为：

| # | 验证什么 | 怎么验证 | 期望 |
|---|---|---|---|
| A1 | parseWaterPctThresholdsPre 真能解析 | 从源码抽出函数用 new Function 执行 | `"25,50"` → `[25,50]`；`"0"` → `[]` |
| A2 | decideWaterPctFirePre 跳档只投一次 | 同上 | 水位 55% / 已投 0 → fireAt=50（不是 25 也不是连投） |
| A3 | decideInjectTierPre 优先级 | 同上 | 全条件命中时返回 HANDOFF_CARRY |
| A4 | planSpecForTierPre F4 不投 | 同上 | RUN_SLIM → `{inject:false}` |
| A5 | decideHangCompensatePre 清零 | 同上 | (300000,300000,true) → `{fire:true,nextAccum:0}` |

#### B. 注入侧接线（源码断言 + 语义核对）

这些**不是**功能验收，只是守卫。你要判断的是「接线是否真的到位」：

| # | 检查点 | 方法 |
|---|---|---|
| B1 | F1 水位授予分支存在 | `grep -n "_waterFire.fire && isHuman" lib/index.js` |
| B2 | F7 授予分支存在 | `grep -n "_hangFire.fire" lib/index.js` |
| B3 | F7 与 F1 条件互斥 | F7 要求 `!isHuman && 挂机`；F1 要求 `isHuman` |
| B4 | 档位写入 state | `grep -n "_injectTierPre = " lib/index.js` |
| B5 | 渲染层读档位 | `grep -n "s._injectTierPre" lib/index.js` |

**⚠️ B 组要特别小心一个陷阱**：源码里有**注释**也含这些字符串。
如果你用 `indexOf` 定位，可能命中注释而不是代码。**必须过滤注释行**（如 `trim().startsWith('if (')`）。

#### C. 端到端（真数据）

| # | 验证什么 | 怎么验证 | 期望 |
|---|---|---|---|
| C1 | 真实白板按档位裁剪 | 真跑 truncatePlanBySections + 真实 handoff/PLAN.md | 全文 ~24.5k → 瘦档 ~4.1k（约 16.6%） |
| C2 | 真实规则精简 | 真跑 renderRulesSlimPre + 真实 ~/.dsh/memory/MEMORY.md | 压缩比约 69%（1,127 / 1,625） |
| C3 | 真实配置键默认值 | 读 DEFAULT_CONFIG | fullInjectWaterPct="25,50" · fullInjectSemanticChars=800 · hangCompensateEnabled=false |

#### D. 变异验证（**最关键的一环**）

**光有绿套件不算验收。** 你必须证明「如果代码错了，套件会红」。

请对以下变异**各做一次**：改代码 → 跑对应套件 → 确认变红 → 还原：

| # | 变异 | 应红的断言 |
|---|---|---|
| D1 | decideWaterPctFirePre 里 cur >= t 改成 cur > t | P2 的 B-14 |
| D2 | 跳档取最低阈值而非最高 | P2 的 B-7 |
| D3 | planSpecForTierPre 里 isPlanFullTierPre 恒 false | P3 的 B-1/B-2 |
| D4 | shouldInjectPlanPre 恒 true（F4 也投） | P3 的 B-7/C-6 |
| D5 | decideHangCompensatePre 触发后不清零 | P4 的 C-3/C-4 |
| D6 | 规则精简不取首句 | P4 的 A-7 |

**做变异时注意三个本仓已踩过的坑**：

1. **CRLF 锚点**：lib/index.js 是 CRLF。用 `\n` 拼的锚点**匹配不上** ⇒ 变异没施加 ⇒「套件全绿」是假象。
   必须断言 `APPLIED bytes A -> B`，且 **A ≠ B**。
2. **bash 吃掉 \r\n**：不要用 `bash -c` 内联脚本做变异，写成 .mjs 文件用 node 跑。
3. **锚点变量名可能过期**：如果代码改过名，旧锚点会 MISS。必须看 APPLIED 输出确认命中。

#### E. 闸门（必须各自单独跑）

```bash
node --check lib/index.js
node --check lib/client.js
node tests/smoke/smoke-test-client-loadable.mjs
node tools/gen-ev4-blocks.mjs --check
node tools/build-iter5-skin.mjs --check --strict
node tools/verify-docs.mjs
```

| 闸门 | 期望 |
|---|---|
| node --check 两个文件 | 都无输出（成功） |
| client-loadable | PASS 17 / FAIL 0（**这是真执行 factory 的运行时守卫**，不是静态断言） |
| gen-ev4-blocks --check | OK（128,858 字符） |
| build-iter5-skin --check --strict | `SYNC-OK: sources × generator == lib/client.js` |
| verify-docs | EXIT=0，输出 `工具 21 · 路由 80 · 配置键 174` |

> **`verify-docs` 不在回归套件内，必须单独跑。** 这是本仓的硬纪律（否则「校验器全绿仍属假绿」）。

#### F. 全量回归（**只跑一次**）

```bash
node tools/run-smoke.mjs
```

**期望**：`PASS 512+ / FAIL 0 / TIMEOUT 0`，约 162 秒。

**⚠️ 重要**：
- **不要**加 `--jobs` 参数（默认会用双车道 jobs=4 + heavy=8）。
- **只跑一次**。用户明确要求过不要反复跑全量（一轮 5 分钟，跑 3 轮 15 分钟，比改代码还久）。
- 如果出现 1-2 个 FAIL：**先分类**再定性。本仓已知有并行负载型抖动（issue207-processes、v4-c2-slim-events、v4-c4-tool-description 偶发）。
  判据：**单跑该套件 3 次**。若 3 次全 PASS ⇒ 抖动；若有 FAIL ⇒ 真问题，必须报告。

---

### 3.2 前端线

P3+P4 **没有前端功能改动**，但有设置页控件相关的一致性要求。

#### G. 设置页三面同步

本仓的设置页有**三面**：

| 面 | 位置 |
|---|---|
| 经典档（LEGACY） | skins/legacy/iter5-325.js.frozen（源） |
| ITER5 生成区 | 由 SettingsPage 切片生成 |
| SettingsPage 真源 | lib/client.js |

**验证**：

```bash
# ① 新增的两个控件必须在三面都出现（期望各 3）
grep -c "field(t('fInjectWaterPct')" lib/client.js
grep -c "field(t('fInjectSemanticChars')" lib/client.js

# ② 文案各 1 处（iter5SettingCopy 是单定义，两档共用）
grep -c "fInjectWaterPct: \[" lib/client.js
grep -c "fInjectSemanticChars: \[" lib/client.js

# ③ hint 各 3 处
node -e "const s=require('fs').readFileSync('lib/client.js','utf8');for(const k of ['fInjectWaterPct','fInjectSemanticChars']){console.log(k+'Hint:',(s.split(k+'Hint').length-1))}"

# ④ 生成一致性（真跑工具）
node tools/build-iter5-skin.mjs --check --strict
# 期望：SYNC-OK
```

#### H. 纯 LF 文件

skins/legacy/iter5-325.js.frozen **必须是纯 LF**（P3 曾因脚本写入 CRLF 而红）：

```bash
node tests/smoke/smoke-test-h43-theme-sync.mjs
# 期望：PASS 14 / FAIL 0
```

#### I. 前端加载守卫

**硬规则**（本仓 2026-09-27 事故固化）：凡改 DSH 插件前端入口，必须跑**真执行 factory** 的运行时守卫。

```bash
node tests/smoke/smoke-test-client-loadable.mjs
# 期望：PASS 17 / FAIL 0
```

**如果这条只是静态断言，不算数。** 请打开该套件确认它用了 node:vm 真执行了 factory。

---

## 4. 假绿陷阱清单（**必读**）

本仓历史上反复踩过这些坑，你验收时**必须主动去查**：

| # | 形态 | 怎么识别 |
|---|---|---|
| 1 | 返回 ok:true 但没写盘 | 有 dryRun/wrote:false 语义必须另写真写断言 |
| 2 | 断言对象是**源码字符串** | 恒真守卫。必须真执行被测函数才算功能验收 |
| 3 | **假状态桩**：手工塞产品不会产出的字段 | 测试输入必须由**被测代码自己产出** |
| 4 | **探针未命中**：patch/插桩没生效却被当成有效观测 | 凡插桩式观测，必须同时断言「插桩被命中」 |
| 5 | **变异的锚点没命中** | 必须断言 `APPLIED bytes A -> B` 且 A ≠ B |
| 6 | **indexOf 先命中注释** | 定位代码行必须过滤注释（trim().startsWith(...)） |
| 7 | **套件只测纯函数，没测接线** | 纯函数全绿但接线是 if (false) 也不红 |

**判据**：每看一条断言，问两个问题：
1. 如果被测代码错了，这条会红吗？
2. 如果桩/探针坏了，这条会红吗？

---

## 5. 需要重点审查的设计决策

以下是**作者主动声明的取舍**，请你评估是否合理（不是让你改，是让你判断有无隐患）：

### 5.1 P2：为什么是「阈值列表」而不是「每 N% 一次」

**理由**：DSH 压缩阈值 70-80%，实际到不了 75%。间隔制会在 70% 附近产生「刚触发就压缩」的无用注入。

**请你验证**：decideWaterPctFirePre 在跳档（如 20% → 55%）时**只投一次**，不会连投两份。

### 5.2 P2：为什么水位判定必须 AND isHuman

**理由**：水位可以在 Agent 挂机自跑时跨过阈值，那时没人消费完整版 ⇒ 投了纯浪费，还会消耗「本档只投一次」的配额。

**请你验证**：`if (_waterFire.fire && isHuman)` —— 确实有 isHuman 这个 AND 条件。

### 5.3 P3：为什么渲染层要**内联**常量而不是引用模块级

**理由**：renderMemoryDynamic 被 20+ 个套件用 new Function 抽出执行，沙箱里**没有模块级 const**。引用模块级符号会 ReferenceError。

**这是 P3 的实际事故**：一开始没内联，导致 **10 个套件全红**。

**请你验证**：`grep -n "const _T = {" lib/index.js` 应有结果（渲染层内联）；且不能有裸引用 INJECT_TIERS 出现在 renderMemoryDynamic 函数体内（函数外的模块级定义是正常的）。

**验证方法**：跑 `node tests/smoke/smoke-test-a13-inject-seg-chars.mjs` —— 它是抽取式测试，如果渲染层引用了模块级符号，它会 ReferenceError。

### 5.4 P3：LEGACY 档为什么必须存在

**理由**：「档位缺失」必须退化为**改前行为**，而不是回退到某个「看起来安全」的档位（如 RUN_FULL，它会走瘦档预算 —— 那是**新行为**）。

**这是 P3 的实际事故**：一开始回退到 RUN_FULL，导致 smoke-test-handoff 红。

**请你验证**：跑 `node tests/smoke/smoke-test-handoff.mjs`，期望 pass=66 fail=0。

### 5.5 P4：画像段为什么用「传空串」而不是「包 if」

**理由**：H5 套件有四条**字面量正则**判据（同 4 空格缩进、条件不含 && 等）。改结构会红。

**请你验证**：跑 `node tests/smoke/smoke-test-v4-h5-user-portrait.mjs`，期望 39 PASS / 0 FAIL。

---

## 6. 已知的「未完成」项（**不是缺陷，不要报**）

以下是作者明确知道且有意留待后续的，**请勿作为缺陷上报**：

| 项 | 状态 |
|---|---|
| F5 压缩后的「刚才压缩了」提示段 | 未做（压缩检测本身已有） |
| F7 视觉 Agent 测试章程 | 未做（需真人视觉验收设计） |
| F7 真机验证 | 不可能（默认关，且需长挂机累计 token）⇒ 只能靠纯函数 + 接线守卫 |
| §2.5 事件写路径串行化 | 未做 |
| §2.4 run-smoke 吞 uncaughtException | 未做 |
| §3.1 rulesLayeringMode=self 隔离语义 | 未实现（rules-layer.js 收了 ownerSessionId 但从不引用） |
| upgrade 功能 no-events 矛盾 | 未查（用户说以后再说） |
| 存量升级（586 账本 vs 2 事件） | 未做 |

**但是**：如果你发现这些「未完成」项**与其他功能产生了冲突或副作用**，那要报。

---

## 7. 报告格式要求

请按以下结构输出：

```markdown
# 验收报告 · <你的名字> · <日期>

## 结论摘要
- 后端线：<通过 / 有条件通过 / 不通过> · <一句话>
- 前端线：<通过 / 有条件通过 / 不通过> · <一句话>

## 后端线明细
| 验收项 | 期望 | 实测 | 判定 |
|---|---|---|---|
| A1 parseWaterPct | "25,50"→[25,50] | <实测> | PASS/FAIL |
...

## 前端线明细
<同上>

## 变异验证明细
| 变异 | 是否施加成功（bytes A→B） | 套件是否变红 | 还原是否复绿 |
|---|---|---|---|
...

## 缺陷清单
| # | 严重度 | 描述 | 复现步骤 | 证据 |
|---|---|---|---|---|
...

## 假绿风险清单
<你发现的「看着绿但其实没测到」的地方>

## 与文档不符处
<本文档说的与代码实际不一致的地方>
```

**判定标准**：

| 判定 | 含义 |
|---|---|
| 通过 | 所有验收项实测符合，变异全部能红，无缺陷 |
| 有条件通过 | 核心功能正确，但有非阻断性缺陷或文档不一致 |
| 不通过 | 有功能缺陷、变异不能红、或关键闸门红 |

---

## 8. 参考：本文档引用的物理量

如果这些数字与实际不符，**以实际为准并报告不一致**：

| 项 | 值 |
|---|---|
| lib/index.js LF 长度 | 1,296,924 |
| lib/index.js LF sha16 | 4AAEC9C93E09E61B |
| lib/client.js classicLF 长度 | 1,372,106 |
| lib/client.js classicLF sha256 | 4141f98915eb…（前 12 位） |
| 配置键数 | 174 |
| 工具数 | 21 |
| 路由数 | 80 |
| 全量回归 | 512+ suite / 0 FAIL / 162s |

---

**报告版本**：v1.0（2026-10-26）
**编写者**：Lead（dsh-auto-memory 项目）
