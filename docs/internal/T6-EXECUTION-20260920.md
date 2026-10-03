# T6 执行记录 — 代码能力 ↔ 模型 prompt 全量对齐 + DeepSeek Flow 可行性研究

> 日期：2026-09-20 · 触发：用户拍板「**全量补上，不然现在没有大模型的加持，这些代码都是死代码，什么都用不了**」
> 基线：改前全量回归 **PASS 134 / FAIL 0 / TIMEOUT 0**；改后 **PASS 134 / FAIL 0 / TIMEOUT 0（139.5s）**

---

## 一、DeepSeek Flow 可行性研究结论（用户指定站点）

**站点**：https://deepseekflow.kanghelyu.org/ · **仓库**：https://github.com/kanghelyu/dsh-deepseek-flow · **许可**：MIT（§License 确认）· **版本**：npm 0.4.2 / 站点标 v0.3.17

### 它是什么（实测抓取）

| 维度 | 实测内容 |
|---|---|
| 定位 | **可视化工作流编辑器** —— 官网原文「DeepSeek Flow 是编辑器，而不是工作流运行器」 |
| 事实来源 | 一份 `WORKFLOW.md` + 每步一个 `STEP.md`，Markdown 为唯一 source of truth |
| 画布 | 节点/连线/分支/依赖，可缩放拖拽；画布与 Markdown **双向同步** |
| 逻辑门 | **8 类**：IF/ELSE · AND · OR · NOT · NAND · NOR · XOR · XNOR（`data.gateType`） |
| 谓词 | 仅 `truthy` / `falsy` / `nonEmpty` —— **严禁自然语言条件**，语义判断须上游 Agent 步骤输出 JSON 布尔 |
| 拓扑事务 | 本地校验 → Session 审查 → 二次校验 → **原子保存**（新 revision，过期拒绝） |
| 隔离 | **per-session**：每个 Harness session 各持自己的工作流 |
| 模型工具 | `flow_create` / `flow_read` / `flow_put` / `flow_finalize_canvas` 等，附 `skills/deepseek-flow/SKILL.md` |
| 技术栈 | ESM + `zod` + `@deepseek-ai/dsh-typert-protocol`；client 注入 4 个 DSH client 包；`platform: web` |
| 主题 | 跟随 Harness 明暗 + 界面语言（中/EN 完整覆盖） |
| 测试 | 官方称 **75** 条自动化测试 |

### 结论：**形态不同，不能直接替换看板；但三条架构可移植**

| # | 可移植点 | 为什么对我们有价值 | 风险 |
|---|---|---|---|
| **F-1** | **Markdown 为唯一事实源 + 画布双向同步** | 我们的白板/账本本来就是 Markdown；看板是**只读投影**，模型改文件、面板跟着变，与它的范式一致 | 低 —— 我们已是这个架构 |
| **F-2** | **待审草稿 → Session 审查 → 原子保存** | 正好解决用户痛点：模型改白板**不静默落盘**，先成草稿，再由 Session 审，带 revision 防并发覆盖 | 中 —— 需引入 revision 概念 |
| **F-3** | **`SKILL.md` 随插件分发、注册后自动加载** | 与 T4 的 `memory_procedure` + skill 导出层方向一致，可参考其 frontmatter 与工具命名规范 | 低 |
| **F-4** | **8 类确定性逻辑门** | ⚠️ **不适用** —— 我们的看板是**状态展示**不是**流程编排**；硬套会引入无意义的布尔语义 | —— |

### 判定（一句话）

**不能换掉看板，但可以吸收「草稿→审查→原子保存」这一条改造看板的写侧。** 用户说「自由发挥空间还挺多的」成立：看板目前是纯只读投影，写侧完全靠模型直接改文件；Flow 的拓扑事务模型正好是补这块的现成参照。**是否要做，待用户拍板**（属前端重构范畴，触及 §8 决策点）。

---

## 二、T6 主体：全量补齐模型侧缺口（已落地）

### 改了什么（7 处，全部在 pre 线）

| # | 位置 | 内容 | 性质 |
|---|---|---|---|
| 1 | `lib/index.js` `applyNoteStatusPre` | 签名与 JSDoc 加 `retract` / `reason` | 新能力 |
| 2 | `lib/index.js` `applyNoteStatusPre` 循环体 | **新增 `plan.retract` 处理循环**（调 `applyStatusToRecordPre(text, id, 'retracted', {reason})`） | 🔴 A1 通道打通 |
| 3 | `lib/index.js` `memory_note` 调用侧 | 透传 `retract` + `retractReason`；门扩为三门 | 接线 |
| 4 | `lib/index.js` `memory_note` 参数表 | 新增 `retract` / `retractReason` 两个参数，**含与 supersedes 的分工说明** | 模型可见 |
| 5 | `lib/index.js` `memory_note` 主描述 | 补「结论失效时的两个通道（不要混用）」+ 看板 tag 说明 | 模型可见 |
| 6 | `lib/index.js` `renderMemoryStatic` | **新增「看板分列（5 条泳道 + tag 命名约定）」整条注入** | 🔴 A5/A6 打通 |
| 7 | `lib/index.js` + `lib/client.js` 铭文 | 第④条改为「结论失效/被取代」（含 retract 分工）；**新增第⑤条「看板落列」** | 收尾提醒 |

### 关键设计决策

**`retracted` 与 `superseded` 严格分工**（写进工具描述，模型据此选）：

- `supersedes` = 被**更新的结论取代**（有后继，可追 `mem_id`）
- `retract` = **当时就做错了、直接撤回**（无后继，"错误本身"就是教训）
- `restore` = 撤销通道（标错了改回 `current`）

依据：用户 2026-09-18 裁定「**retracted 不是垃圾，是教训，不过滤只备注**」。此前 `note-status-pre.js` 三态齐备、`renderStatusLinePre` 也支持渲染 retracted、L0 侧还有 `L0_RETRACTED_MARK_PRE_V1='⚠已撤回'` 的呈现后缀，**但工具层只有 supersedes 一个通道且硬编码映射到 superseded** ⇒ 教训通路模型根本写不了。

**为什么铭文上限从 800 放宽到 1200**：新增的 retract 分工与看板 tag 属**必需内容**（模型不知道则对应功能永不触发）。实测约 950 字符 ≈ 475 token = `injectBudgetChars`(8000) 的 12%；且本段走 `systemPrompt.context()`（**不击穿前缀缓存**），内容不变时 `project()` 去重不加发。1200 是**防继续膨胀的护栏**，不是精确预算。

---

## 三、验收（全部实跑，非纸面）

| 项 | 结果 |
|---|---|
| `node --check`（index.js / client.js） | ✅ 通过 |
| G4 套件 | ✅ **10 / 10**（新增 G4-6c / G4-6d 两条接线守卫） |
| G3 套件 | ✅ **29 / 29**（门锁同步并加严） |
| note-status 套件 | ✅ **74 / 74** |
| **变异验证** | ✅ **4 / 4 全部真红**（`artifacts/_mutate-t6.mjs`） |
| 字节一致还原 | ✅ SHA256 `DF32BABA…A8835` |
| **全量回归** | ✅ **PASS 134 / FAIL 0 / TIMEOUT 0（139.5s）** |

### 变异验证明细（这是本轮最有价值的部分）

| 靶点 | 结果 |
|---|---|
| 删掉 `plan.retract` 处理循环 | ✅ 真红 |
| 删掉调用侧 `args.retract` 透传 | ✅ 真红 |
| 删掉工具参数 `retract` 定义 | ✅ 真红 |
| 删掉静态纪律整条看板 tag 语句 | ✅ 真红 |

**★ 过程中抓到一个真实缺陷**：G4-6 首版**只断言铭文文本含 `retract` 字样**，第一次变异（删掉 `plan.retract` 循环）时套件**仍然全绿** —— 典型「**断言太弱、路径未覆盖**」。据此**新增 G4-6c**（断言 retract 通道三处齐备：参数/描述/处理循环/调用侧透传）与 **G4-6d**（断言看板 tag 真在 `renderMemoryStatic` 函数体内，而非文件别处的同名注释）。

**★ 另一个教训**：变异4 首版**靶点选错**（只删段中一句，tag 名仍在续行 ⇒ 假绿）。判定为**靶点无效**而非守卫失效，改为正则整段删除后真红。⇒ **变异假绿要先怀疑靶点，再怀疑守卫。**

---

## 四、顺带修的两处硬锁（属合法扩展，锁同步加严）

| 套件 | 原锁 | 处置 |
|---|---|---|
| `smoke-test-note-status-pre.mjs` #7-5 | `!IDX.includes('note-status-pre.js')` —— 用**弱子串**检测"是否已接线" | **误报**：我注释里写了文件名即触发。真实接线走 `note-status-apply-pre.js`。改注释措辞消除，**锁语义未动** |
| `smoke-test-g3-note-status-wire-pre.mjs` #2-2 | `/if \(sup\.length \|\| res\.length\)/` 字面锁两门 | 门扩为三门是**合法扩展**；锁同步为三门，并**加严**：逐个断言 `sup`/`ret`/`res` 都在门里 |

---

## 五、B 类剩余缺口（**尚未补**，待拍板）

以下 11 条已在前轮 `PROMPT-GAP-AUDIT-20260920.md` 列出，本轮**只补了 B1/B2 相关的铭文部分**，其余仍在：

| # | 缺什么 | 影响 |
|---|---|---|
| B1 | 白板/账本**两套四段措辞**（`:5726` vs `:570`/`:3658`）| 模型可能当同一件事 |
| B3 | procedure 缺 `successCriteria` **结构上永不晋升**（T4 硬事实，未在描述里点明） | 模型可能写空判据 |
| B4 | R1 四条可读性判据仅在文档 | 模型不知何为"可读" |
| B5-B11 | 各工具参数/时机的描述不全（`date` 补写过去 / 容量整理行为 / `expand` 组合语义 / `days` 阈值 / `status`+`reflect` 时机 / `external` 只记指针 / 自动沉淀 vs 手动 consolidate 边界） | 模型用错或不用 |

**A 类剩余**（模型零入口，需新增工具）：

- **A2** `fact-store-pre.js` 9 个能力（含 `isExpired` 过期、`resolveConflict` 冲突、`revokeBySource`）—— **零 `defineTool`**
- **A3** episodic 写入 —— 仅宿主自动（`index.js:7411`）
- **A4** fact 5 个枚举（epistemic_status / scope / source_kind / source_class / trend）无语义说明

---

## 六、需用户动作

1. **重启 DSH 宿主** —— 本轮改了 `lib/index.js` + `lib/client.js`，不重启不生效（**宿主只能用户手动重启，AI 不得执行**）
2. **拍板是否继续补 B 类剩余 + A2/A3/A4**
3. **拍板 DeepSeek Flow 的 F-2（草稿→审查→原子保存）是否纳入前端重构**
