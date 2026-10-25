/**
 * migration-prompt.js —— v4 记忆基座迁移流程的**固定提示词**（用户裁定 C 第④步）。
 *
 * ★★为什么单独成一个模块，而不是硬编码进 lib/index.js：
 *   ① `lib/index.js` 已经 1.2M 字符，再塞 4.3KB 纯文本会**淹没在 2 万行里**，没人会去维护它；
 *   ② 这段提示词是**用户逐字口述的流程**（四段：兼容 → 提醒 → 问用户 → 派子代理整理），
 *      它的价值在「**固定**」而不在「可改」—— 独立模块让它可被单测逐字比对；
 *   ③ **两份真源的风险用断言消掉**（见下）：artifacts/ 下留一份人类可读版，本模块留一份运行时用，
 *      套件断言两者**逐字相等** ⇒ 任何一边改了另一边没改，立刻红。
 *
 * ★为什么不「工具运行时去读 artifacts/ 那个文件」：
 *   工具跑在**宿主进程**里，工作目录不一定是仓库根（用户可能在任意 workspace），
 *   用相对路径读仓内文件**不可靠**（实测本仓已有 `ERR_MODULE_NOT_FOUND` 前科）。
 *   ⇒ 打包成模块，跟着 lib/ 一起被 import，零路径依赖。
 *
 * ★本模块是**纯常量**：零 IO、无 import、无副作用。
 */

/**
 * 记忆基座迁移标准流程全文（与 artifacts/MEMORY-BASIS-MIGRATION-PROMPT-2026-10-25.md 逐字一致）。
 * ★一致性由 tests/smoke/smoke-test-v4-h3-c3-upgrade-plan.mjs 断言（两份真源防漂移）。
 */
export const MEMORY_BASIS_MIGRATION_PROMPT = "# 记忆基座整理 · 标准流程（v4 升级迁移 · v2）\n\n> v1 的五类分拣去向**漏了「人之上的层」**，会把用户画像塞进工作区 ⇒ 换工作区丢失。v2 改为**四层**。\n\n## 阶段 0：必须先问用户（不许跳过）\n\n> 「本 auto-memory 插件已升级到 v4 —— 以事件为中心的情境化主动记忆。\n>  你的旧记忆还是旧格式，可能不再适用。\n>  是否允许我**派一个子代理**，把你的记忆整理成新版记忆基座？\n>  整理范围：①人之上的层（用户画像/共同经历/情感记忆）②用户规约 ③项目规约 ④项目事件 ⑤想法与偏好。\n>  **原文件会完整备份、不删除。**」\n\n**用户明确同意后才继续。不同意 ⇒ 停，只保留兼容层（旧格式照常可用）。**\n\n---\n\n## 阶段 1：备份（只读原样复制，不修改原件）\n\n复制到 `<ws>/.dsh-memory/backup/<YYYY-MM-DD>-pre-v4/`（工作区内，不受容量限制）：\n\n- `~/.dsh/memory/MEMORY.md`（用户规约真源）\n- `~/.dsh/memory/workspaces/<wsid>/MEMORY.md`（项目规约真源）\n- `~/.dsh/memory/workspaces/<wsid>/handoff/*.md`（PLAN.md + 全部账本）\n- `~/.dsh/memory/workspaces/<wsid>/*.md`（每日日志，若有）\n\n并记录每份的 **sha256** 到 `MANIFEST.json`。**备份未成功 ⇒ 中止，不进入阶段 2。**\n\n---\n\n## 阶段 2：派**一个**子代理（不并行多个）\n\n给它的任务 = 阶段 3 + 4 的完整清单。**不要拆成多个子代理**：分类要全局一致，拆开必然漂移。\n\n**子代理跑在「记忆中枢」workbench 会话里** —— 它的过程与总结都落在那，用户可在记忆中枢查看成果。\n\n---\n\n## 阶段 3：五类分拣（每条旧条目归入且只归入一类）★v2 修正：四层去向\n\n| 类 | 判据（**由模型判断，不许正则**） | 去向 |\n|---|---|---|\n| **人之上的层** | 「这个人是谁」「我们一起经历过什么」「他在意什么」——性格、偏好倾向、共同经历、情感记忆、自传 | **L0** `~/.dsh/memory/person/event-store.json` |\n| **用户规约** | 「跨项目通用、对我这个人的要求」——交付格式偏好、沟通方式约定、禁止行为 | **L1** `~/.dsh/memory/MEMORY.md` |\n| **项目规约** | 「这个项目必须怎么做」——硬约束、验收纪律、架构决策、路径约定 | **L2** `~/.dsh/memory/workspaces/<wsid>/MEMORY.md` |\n| **项目事件** | 「这个项目在做什么、试过什么、失败过什么」 | **L3** `~/.dsh/memory/workspaces/<wsid>/handoff/event-store.json` |\n| **纯流水** | 一次性进度记录、临时路径、已过时的计划 | `memory_log`（保留可检索）或丢弃（原件已备份）|\n\n### ★★L0 与 L2/L3 的边界（这是 v1 最大的错）\n\n```\n判断口诀：换个工作区打开，这条内容还应该在吗？\n  应该在      ⇒ L0（人之上的层）或 L1（用户规约）\n  只在这个项目有意义 ⇒ L2（项目规约）或 L3（项目事件）\n```\n\n**反例（必须避免）**：\n- ❌ 把「用户偏好中文回答」写进某个工作区的 MEMORY.md ⇒ 换工作区就没了\n- ❌ 把「我们上次一起调这个插件」写进工作区事件库 ⇒ 换工作区就没了\n- ❌ 把「本项目端口 56877」写进 person store ⇒ 污染跨项目层\n\n### ★★用户画像 vs 用户规约（用户明确强调）\n\n- **用户画像 = emotional / 主观 / 生活化 / 情境化**（感觉、印象、相处方式、共同经历）\n- **用户规约 = rational / 硬**（每次完整版注入的约定类内容）\n- **两者不许混在一起。** 若一条内容两者都沾，**拆成两条**，分别落到 L0 与 L1。\n\n---\n\n## 阶段 4：写回\n\n```\n人之上的层 → memory_event(action:append, scope:\"person\", userPercept:{stage:\"accepted\", kind:\"preference\"|\"state\"|\"unfinished-goal\"|\"authorResponse\"（作者回应：同意/否定/纠正/补充/质疑/拍板）, text})\n           或 memory_event(action:create, scope:\"person\", name, summary, sections{goal,doing,deadend,next})\n用户规约   → memory_user(append) 或 memory_rules（用户级）\n项目规约   → memory_rules(op:add) 或 memory_note(kind:note)\n项目事件   → memory_event(action:create/append)（默认 scope，即本工作区）\n纯流水     → memory_log(append)\n```\n\n**每一类最多一个批次，写完立刻自检，不要边写边判。**\n\n---\n\n## 阶段 5：自检（缺一不可）\n\n1. **条目数守恒**：旧文件总条目 N = 新五类条目之和（允许 ±0，不允许丢）\n2. **抽查 10 条**：随机取旧条目，确认内容在新位置可检索到\n3. **画像纯度**：`[用户画像]` 段里**不得出现技术规范**（用 3 条已知技术规范做反例）\n4. **规约纯度**：`[项目规约]` 段里**不得出现性格/生活偏好**\n5. **★层归属（新增）**：person store 里**不得出现项目路径 / 项目名 / 端口号**（那是 L2/L3 的）\n6. **★L0 独立可用（新增）**：换一个工作区打开，`[用户画像]` 段**仍必须有内容**\n7. **原文件 sha256 未变**（证明只备份没改）\n\n---\n\n## 阶段 6：报告给用户 + 上报完成\n\n### 6.1 对照表\n\n```\n旧文件 → 新位置            条数    示例\n用户 MEMORY.md → L1 用户规约   N1     「…」\n用户 MEMORY.md → L0 人之上     N2     「…」\n项目 MEMORY.md → L2 项目规约   N3     「…」\n项目 MEMORY.md → L3 项目事件   N4     「…」\n旧日志         → memory_log    N5     —\n```\n\n### 6.2 ★上报完成（用户裁定第 4 条：「让 AI 完成之后报告一下，然后检测」）\n\n```\n整理全部完成后，必须调用：\n  memory_status({ op: \"upgrade-done\", counts: { person: N0, userRules: N1, projectRules: N2, events: N3, logs: N4 } })\n\n该调用会写 ~/.dsh/memory/upgrade-state.json 的 completedAt / completedVersion；\n弹出窗口据此把「正在整理中」切成「已完成」并展示你的总结。\n若不调用 ⇒ 窗口只能靠「版本 >= 3.3.18 且不再是旧格式」兜底判定，\n            用户会看不到你的总结，且 Teamwork 双端恢复同步的第三个条件（双方 completedAt）无法满足。\n```\n\n**用户确认后才算真正完成。用户不确认 ⇒ 回滚到备份并保留旧格式。**\n\n---\n\n## 禁止事项\n\n- ❌ 不许一次删除原文件（只备份，永不删）\n- ❌ 不许用正则猜「哪条是偏好」（H5 实测准确率 **20%**，必须模型判断）\n- ❌ 不许跳过「用户同意」这一步\n- ❌ 不许并行多个子代理（分类必须全局一致）\n- ❌ 不许在备份失败时继续\n- ❌ **不许把 L0 内容（画像/共同经历）写进任何工作区**（换工作区就丢）\n- ❌ **不许把项目内容写进 L0**（污染跨项目层）\n"

/** 提示词字符数（供调用方做预算判断，免每次 .length） */
export const MEMORY_BASIS_MIGRATION_PROMPT_CHARS = MEMORY_BASIS_MIGRATION_PROMPT.length

export default { MEMORY_BASIS_MIGRATION_PROMPT, MEMORY_BASIS_MIGRATION_PROMPT_CHARS }
