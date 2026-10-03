# 长期记忆系统 逻辑审计 · 总汇总（2026-09-21）

> 对象：`D:\dsh-auto-memory`（pre 开发线，未提交未发布）
> 目的：用户反馈「长期记忆系统是一座屎山」，需要**全量捋清逻辑错误与 bug**，以便决定怎么改。
>
> **三份分册（含逐条 `文件:行号` 证据）**：
> 1. [第 1 批 · procedure 晋升与审批链路](./AUDIT-persistent-memory-logic-20260921-part1-procedure.md)
> 2. [第 2 批 · 事实/情节写入与去重链路](./AUDIT-persistent-memory-logic-20260921-part2-write.md)
> 3. [第 3 批 · 宿主接线一致性与 `-pre` 双份漂移](./AUDIT-persistent-memory-logic-20260921-part3-wiring.md)
> 4. [第 4 批 · 持久层、并发与写入闸门（子代理复核 + 探针实测）](./AUDIT-persistent-memory-logic-20260921-part4-persistence.md)
> 5. [第 5 批 · 召回与注入链路](./AUDIT-persistent-memory-logic-20260921-part5-recall.md)
>
> **本次审计只做诊断，未改任何代码。**（用户硬规则：procedure 记忆引擎含清洗器的改动须经拍板）

---

## 一、用户点名的三个问题，逐个回答

### Q1「现在批准不了，就是晋升不了记忆」

**成立，且是三个独立缺陷叠加。** 不是同一个 bug：

| # | 断点 | 证据 | 后果 |
|---|---|---|---|
| ① | **高风险条目根本没有「批准」这个动作** | `procedure-store-pre.js:313-322` 需要 `approveFn`；但宿主建 store（`index.js:9152-9165`）**没传 `approve`**，路由动作白名单（`index.js:10900`）也只有 `promote/activate/deprecate/pin` | 任何 `riskLevel:'high'` 的条目永远返回 `decision:'ask'`，`approved` 字段**无任何代码能置真** |
| ② | **用户手点与模型自写走两套门限** | 路由调 `procs.promote(pid)`（`index.js:10904`）**只传 1 个参数**；模型工具调 `procs.promote(pid, {}, { authorizedBy:'model' })`（`index.js:10384`） | 手点永远受「3 会话 / 2 成功」两道统计门约束，而模型条目这两项**恒为 0** ⇒ 永远 `keep` |
| ③ | **即使晋升成功也不会生效** | `procedurePromotionEnabled` 默认 `false`（`index.js:546`），而它是技能**注入总闸**（`context-host-pre.js:537`、`activation-host-pre.js:330`） | 现有 5 条 `active` 技能在当前默认配置下**全部不生效** |

附带：前端「晋升」按钮的显示条件（`client.js:3385` `!p.observationOnly`）**不等于**真实可晋升条件，
所以用户会对着结构上不可能晋升的条目反复点（缺 `successCriteria`、有 correction 等），只得到一行灰字，看起来就是"批准不了"。

### Q2「旧算法和新算法可能逻辑也特别乱」

**成立，根因是同一份数据存在多条互不同源的写入通路 + 仓库里有两个自洽的实现世界。**

- **写入通路三条，清洗口径不一**：
  `memory-hub-pre.js:186-193`（episode→fact）、`memory-hub-pre.js:288-317`（judgement→fact）、
  `index.js:9313-9320`（写回 MEMORY.md 的卫生门）。逻辑靠**复制**散在三处，注释里自陈踩过
  「补了口 A、漏了口 B」的坑。
- **`-pre` / 非 `-pre` 双份，26 对全部漂移，且旧世界内部自洽**：
  `lib/` 下有 **12 个非 `-pre` 文件、13 条 import 边**互相引用旧副本（明细见第 3 批 §2）。
  宿主只走 `-pre`，但读代码的人顺着旧文件读下去会读到**没有 T1/T4/T10/issue#30 任何修复**的逻辑。
  其中 `intent-clean` 与 `shadow-host` 是**双向分叉**（旧版比新版更大）⇒ 无法靠"以 `-pre` 为准"判定。
- **运行时数据也双份**：`~/.dsh/memory/hub/`（三个文件合计 395 B，空壳）与 `hub-pre/`（39 KB 真实数据）并存。

### Q3「这个算法的审批也特别乱」

**成立。** 具体表现：
1. **两份门限判定**：`promote()`（`procedure-store-pre.js:281-333`，有副作用）vs `evaluatePromotion()`（`:349-386`，只读投影，供前端展示"为什么不能晋升"）。
   代码注释要求两者逐行同步，但**已经在「授权」维度上不一致**——`promote()` 支持 `authorizedBy` 跳统计门，投影**不支持**
   ⇒ 一条已被模型授权晋升的条目，前端仍显示"diversity-below-3（条件不满足）"。**界面与状态互相矛盾。**
2. **按钮条件与门限无关**（见 Q1 附带）。
3. **拒绝也返回 `ok:true`**：`promote()` 所有 `keep` 分支都是 `{ok:true, decision:'keep'}` ⇒
   日志里全是 `ok:true` 的假阳性（宿主 `index.js:10928-10930` 的注释记录了这个已修过的坑）。

---

## 二、缺陷全景（15 条，按严重度）

| 序 | 缺陷 | 批 | 级别 | 一句话 |
|---|---|---|---|---|
| 1 | `procedurePromotionEnabled` 语义错配 + 默认 false | 1/3 | **P0** | 它是注入总闸，被当成"自动晋升开关" |
| 2 | 高风险条目批准通路缺失 | 1 | **P0** | `approveFn` 无注入、路由无动作 |
| 3 | 清洗器漏网 `Reference: - HH:MM [kind:x]` | 2 | **P0** | 实测未命中，09-20 仍有脏数据入库 |
| 4 | 前端晋升按钮条件 ≠ 真实门限 | 1 | **P0** | 反复点无反应 |
| 5 | `promote()` / `evaluatePromotion()` 双份门限 | 1 | P1 | 授权维度已不一致 |
| 6 | 模型直写 `sourceMemoryIds` 恒空 | 1 | P1 | 成功证据永为 0，统计门永不通过 |
| 7 | 清洗逻辑散在三处 | 2 | P1 | 口径不一，易漏口 |
| 8 | 存量脏数据无清理机制 | 2 | P1 | 实测 10 条里 3 条结构性垃圾 |
| 9 | 对话发言直接当 fact subject | 2 | P1 | 缺事实性判据，事实库被聊天噪声填充 |
| 10 | `candidate` 死状态 / 死统计 / `applyAutomaticTransitions` 死函数 | 1 | P1 | 状态机与文档不符；90 天老化从不执行 |
| 11 | `validateProcedurePre` 不校验 `evidence` | 1 | P1 | 缺键 → `NaN` 静默通过 |
| 12 | **26 对 `-pre` 全部漂移 + 旧世界自洽** | 3 | P1 | 「改了不落地」事故的土壤 |
| 13 | M8-1 认识论字段零落地 | 2 | P1 | 10/10 条缺 `epistemicStatus` |
| 14 | 运行时数据双份（`hub/` 空壳） | 3 | P1 | 排查时看错目录 |
| 15 | `promote()` 拒绝返回 `ok:true`；`restore()` 静默跳过无计数 | 1/2 | P2 | 可观测性缺失 |
| 16 | **handoff 账本超 8000 字被静默截断**（不提示） | 4 | **P0** | 续命材料被砍掉「进度与下一步」 |
| 17 | factId 元组哈希 + 撤销不删 ⇒ 重复主键、新事实被永久跳过 | 4 | P1 | 与 #6 叠加致统计门永不通过 |
| 18 | 状态行写入破坏 CRLF（与文档承诺相反） | 4 | P1 | digest 漂移 / diff 放大 |
| 19 | episodic `current` 不按 sessionRef 隔离 ⇒ 跨会话段并进同一 episode | 4 | P1 | **第二条「晋升不了」成因**：distinctSessions 被低估 |
| 20 | 三个 store 的 `persist()` 吞掉落盘失败 | 4 | P1 | 内存/磁盘静默分叉 |
| 21 | `tailHas` 判据极弱 + 旁路绕过它 | 4 | P1 | 同一事实重复写入（历史症状：两个「M8 固化」段） |
| 22 | P2×8（`\|\|0.3` 让 0 不可表达 / 死计数器 / 浅拷贝共享引用 / addEvidence 抛错被吞 / append 不落盘 / 步骤压成单行 / checklist 硬截 2000 字 / `currentRuntime()` 可能 null） | 4 | P2 | 见第 4 批 §3 |

---

## 三、修复顺序建议（待你拍板）

**A 批 · 立即见效、低风险、不动引擎语义**
- #1 拆开关（`procedureInjectEnabled` 默认 true / `procedureAutoPromoteEnabled` 默认 false）或至少改默认值 + 文案
- #3 清洗器补 `Reference:` 前缀族 + 加回归测试（用真实脏串断言）
- #10 清死代码（candidate 状态、`stats.candidates`、`applyAutomaticTransitions`）
- #11 `validateProcedurePre` 补 evidence 形状校验
- #14 `hub/` 改名隔离 + 文档写明活跃路径

**B 批 · 需要你定方案**
- #2 高风险批准通路形态（路由加 `action:'approve'` / 设置页批量批准 / 其它）
- #9 事实性判据（收紧入口 vs 打标低置信 + 前端折叠）
- #13 认识论字段默认值（inference→observation，explicit→fact）

**C 批 · 架构收敛（动面最大）**
- #5 #7 #12 三合一：门限合一、清洗合一、双份实现合一

**D 批 · 数据操作（需先备份）**
- #8 存量脏数据标记/清理（建议**只标记不自动删**，交用户裁决）

---

## 四、本次审计未覆盖 / 需补做

1. **`tests/` 与 `tools/` 对旧副本的引用未核对** —— 删除/改名 v1 系列（第 3 批 §5）之前**必须**补这一步。
2. 26 对文件的**逐对 diff** 未做（本批只做了体量+mtime 基线，定性"哪些是真语义分叉"需 diff）。
3. `episodes.json`（35,688 B）内部逐条未解析，episode 层脏数据比例未知。
4. **召回/注入链路的完整复核**：已派两路子代理，第一路中途退出、第二路截至收尾未回；
   该链路的「融合排序正确性 / JS 与 Python 双引擎是否违规耦合 / 注入预算是否被绕过」**仍是审计空白**。
5. `evidence` 六类计数中 `seen/read/cite/reuse` 的喂入点未追完。
6. `stats.approvalAsked` 的实际增长需运行期观察（内存态，快照里读不到）。
7. 第 4 批已补：持久层语义、写入闸门、多通路去重（见第 4 批分册）。

---

## 五、审计方法（供复核）

- 所有结论均基于**代码行号 + 运行时真实数据**双向印证；
- 运行时数据取自 `~/.dsh/memory/hub-pre/{procedures,facts,episodes}.json`（用户本机真实库）；
- 清洗器行为用 `node` **直接跑真实脏串**验证（非推理）；脚本 `.vision-tmp/clean-probe.mjs`；
- 无证据的推断已在各分册中显式标注「推断」或列入「未能确认」；
- 全程只读，**未修改任何 `lib/` 文件**。
