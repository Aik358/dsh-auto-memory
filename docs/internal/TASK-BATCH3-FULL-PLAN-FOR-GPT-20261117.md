# 批次3 · 全量施工大计划（交 GPT，两批交付）

> 你一次做完，但**分两个独立补丁集交付**（A 批、B 批）。Lead 按 A→B 顺序验收，A 通过才落盘 B。
> 这样你可以连续工作，而验证不会串成一坨。

---

## 〇、上一批反馈（务必先读，否则会全批返工）

**问题：锚点行尾不一致。** 你上批 9 个锚点里 7 个在原文命中为 0——`before` 串是纯 LF，而 `lib/index.js` 是全 CRLF。你的验证器内部做了归一化所以能跑，但直接落盘会全部失配。

**要求（本批强制）**：
1. 锚点必须带**目标文件真实行尾**。`lib/index.js` 是 CRLF；`lib/injection/*.js` 是 LF；`lib/handoff-anchor.js` 请自行核实。
2. 在 `patches.json` 里为每个补丁标注 `"eol": "CRLF"` 或 `"eol": "LF"`。
3. 或者：锚点用 LF 并在文档里**显式声明**"需按目标文件行尾归一化后落盘"。二选一，但必须明示。

**已验证有效、请保持**：机器可读 patches.json + 基线/预期指纹 + 只读验证器 + 明确声明未做 HOST。这套机制很好。

---

## 一、当前真实状态（Lead 实测，作为你的输入事实）

- HEAD：`96bfded8`，`lib/index.js` 2,197,854B / CRLF 30,211 / 裸 LF 0 / 孤立 CR 1 / 导出 41
- 已接线：CA（水位解析）、RP（规则呈现）、BD（白板/账本投影）
- **未接线**：SR / RC / CA 主决策 / PJ / NT / 通知存储 / FM / EV / 事件组帧 / CO（`lib/index.js` 中这些导出符出现次数均为 **0**）
- 阶段0 已修：S1 规则异常放大、S2 选节前 2000 预截断、S3 白板无命中回全文、S4 降级不可读
- 仍未修的公共模块缺陷：F08 / F09 / F10 / F11 / F12 / F13 / F14 / F15 / F16 / F17 / F18 / F19

---

## 二、A 批：公共模块契约修复（不接生产入口）

**范围**：只改 `lib/injection/*.js`，**不得改 `lib/index.js`**。这批不增加任何生产调用，风险最低。

| 编号 | 缺陷 | 验收出口（Lead 执行） |
|---|---|---|
| F08 | `read-rules.js` 缺 owner/session 仍读取候选（实测读 3 次） | 缺身份时 reader **调用次数为 0**；有身份时正常读取 |
| F09 | `read-rules.js` 丢弃 user/project 中的 candidate 层条目 | 层内 candidate=1 时顶层 candidates 必须非空 |
| F10 | `projection.js` mode 不控制正文；自由画像可绕过过滤 | `plan:core` 不得含历史全文哨兵；自由画像与结构化画像不得并存两份 |
| F11 | `CONTENT_SPEC_TO_PROMPT_SECTION` 14 项映射仅 calendar 匹配生产分区键 | 逐项映射到生产真实键（如 `plan` → `whiteboard-plan`） |
| F12 | `cadence.js` 水位分支缺真人门；`slimAllowed` 无节流；fullGap 默认 5 与生产 20 不一致 | 非真人信号不授予 full；slim 间隔生效；缺省值可配 |
| F13 | `notification.js` 定稿不核对最终文本（"不含通知"仍 selected） | 文本不含通知时 `selectedNotificationIds` 为空；requestId/hash 不符时拒绝 |
| F14 | `final-frame.js` `capChars:1` 仍输出 7 字符 | 极小时 `text.length<=cap`，或显式返回不可满足（不得静默超限） |
| F15 | `consolidation.js` 异步写未完成即报成功 | async writer 落盘后才 `wroteAnything:true`；reject 时不得报成功 |
| F16 | `event-view.js` 四段可不入正文；预览/目录超自报预算 | sections-only 必须有 text；cap20 输出计入省略标记；目录计入标签换行 |
| F17 | `event-view.js` 直接替换会丢旧 percept/panels/outcome 与可见性 | 新旧哨兵对照；archived/closed 过滤保持 |
| F18 | `profile.js`/`dto.js` 拒绝 5 个生产档位；`deepFreeze` 放过函数；冻结调用方数组 | 5 个真实旧档逐一明确处理；函数/循环引用被拒；调用后原数组仍可用 |
| F19 | `read-sources.js` 不校验 policyVersion；`consolidation.js` 预算未生效 | 版本 999 被拒；`promptChars:1` 不得输出 235 字符 |

**A 批硬约束**：
- 不改 `lib/index.js`（一个字节都不动，导出 41 不变）
- 每个模块的现有导出符**不得减少**（可新增，须在交付说明列出）
- 每条修复必须自带**负路径**：去掉修复后对应用例必须变红

**A 批交付物**：`patches.json` + `PATCHES.md` + `verify.mjs`（只读，内存应用），以及一份「每条缺陷 → 修复 → 反向验证」对照表。

---

## 三、B 批：生产接线（依赖 A 批通过）

**范围**：改 `lib/index.js`，把未接线的 9 个模块接进去。**必须等 A 批验收通过后再交付。**

**接线顺序（内部依赖，请按此顺序设计补丁）**：

| 序 | 模块 | 接入点（你的判断为准，这里是线索） | 关键参数来源 |
|---|---|---|---|
| 1 | RC / SR | `_doRefresh` 双层读取后建唯一快照 | `resolvePaths` 的 userFile/notesPath/planPath/handoffDir；events 用 `V4_EVENT_STORE_FILENAME` |
| 2 | CA 主决策 | context 回调中，先推进请求身份再决策 | `requestIdPre`、`_stepSeq`、`fullInjectWaterPct`、carry/hang 判据 |
| 3 | PJ | 按段迁移候选构造 | RC 快照 + RP 呈现结果 + 真实 tier/frame |
| 4 | NT + 通知存储 + FM | **必须一起**接最终出口 | pending 真实对象、`requestIdPre`、runtime scope、预算现值 |
| 5 | EV + 事件组帧 | 接唯一 FM，不得双重裁量 | `eventMaxActiveInInject`、`eventCatalogChars`、store.events |
| 6 | CO | collect/build 先接，apply 单独验收 | `listDailyLogs`/`listHandoffLedgers`/`listReflections` + 真实 writer |

**B 批硬约束**：
- 导出 41、工具 22、路由 86、配置键 181 **不得变化**
- 每个接线点必须有 `typeof` 兜底（`renderMemoryDynamic` 被 20+ 套件抽取执行）
- 保留旧路径可回滚；但**同一请求只能有一个生产者**，不得新旧双写
- 不得在接线时擅自确定 L1 未决项（整帧预算、50K、full 豁免、白板具体视角等）

**B 批交付物**：同 A 批格式 + 一张「模块 × 档位 × 输出字符/字节」量化表 + 每模块的生效判据（不是"smoke 通过"）。

---

## 四、允许你调整计划

- 如果你认为 A 批中某条应与 B 批一起做（例如必须先接线才能验证），**说明理由并调整顺序**。
- 如果你认为某条缺陷判断有误（我们可能测错），**先说明依据再决定是否修**。
- 如果你判断某批工作量过大，可以拆成 A1/A2 交付，但要说明拆分依据。
- **部分交付 + 明确说明，优于勉强全做完再返工。**

---

## 五、Lead 侧验收流程（供你预判返工点）

每批：
1. 核锚点（含行尾）唯一命中 → 内容锚定落盘
2. `node --check` + 真实 import + 导出数核对
3. 按每条的「验收出口」用**真实输入**实测（不看你自报的 PASS 数）
4. 跑相关套件 + 计数锁 + `verify-docs`
5. 不通过则带实测数据退回

**最后**：真实 HOST 重启、真实会话、全量回归由 Lead 完成，不由你声明。

---

## 六、不需要你做的事（明确排除）

- 不要尝试在本机落盘或运行仓库命令
- 不要改 `lib/client.js` / `skins/`（前端冻结）
- 不要提交、推送、发版
- 不要动 `tests/` 下的既有套件（需要新用例请单独给出文件内容，由 Lead 落盘）
- 不要声明 HOST / 全量回归结果