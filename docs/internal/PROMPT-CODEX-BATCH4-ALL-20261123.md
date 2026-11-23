# Codex 任务书 · 批次 4 全部五项：平行形态联动

日期：2026-11-23 ｜ 执行者：外部代码线（GPT/Codex）｜ 验收者：Lead（本地独立复核，不采信自报）
基线提交：`2275a99a`（批次3 收尾三件全部落地；全量 650 PASS / 0 FAIL / 0 TIMEOUT）

> 前置：**先做《PROMPT-CODEX-DELIVERY-MODE-UI-20261123.md》**（设置页选择器）。
> 那份会重生成 `lib/client.js` 并重钉前端套件；本批若先做会与它的 client.js 改动互相踩。
> 顺序：**设置页选择器 → 本批五项**。

---

## 0. 范围与顺序

五项都可设计，但**同文件必须串行**（4.1/4.3/4.4/4.5 都碰 `lib/index.js`）。建议顺序：

| 序 | 项 | 主要落点 | 建议理由 |
|---|---|---|---|
| 1 | **4.4 诊断面读对目录** | 诊断/状态读取处（约 `index.js:9312`、`:16643` 的 `summariesDir`） | 最小、纯读，可最先验证 |
| 2 | **4.3 时段总结回读** | `memory_read` 工具（kind enum 约 `index.js:26527`、错误文案 `:26576`） | 纯读，与 4.4 共用 summaries 语义 |
| 3 | **4.2 工作区技能库 scope** | `createScopedHubIoPre`（约 `:22527`）、`rehydrateProcedureScopes`（约 `:9637`） | **Phase 0 可能发现已实现**，先核实再动手 |
| 4 | **4.1 person store 接画像** | `lib/user-portrait.js`（`buildUserPortraitPre`）+ person store 读取 | 写读链路最复杂，放后面 |
| 5 | **4.5 跨形态去重** | `pushPart` 共 **31 处**（实测） | 影响面最广，最后做并单独回归 |

每项**单独提交**、单项验收；不要五项合一个 commit。

---

## 1. 全局硬约束（违反即返工）

1. **模块化/API 化**：不得把业务逻辑堆进 `lib/index.js`。新增纯逻辑超过约 30 行必须抽独立模块（如 `lib/summary-read.js`、`lib/inject-dedupe.js`），`index.js` 只做薄接线。
2. **不新增顶层配置键**（保持 **182**）、**不新增路由**（**87**）、**工具数不变**（**22**；4.3 只是给 `memory_read` 的 `kind` 加一个枚举值，不算新工具）。
3. **不改 `lib/client.js`、不改 `skins/`**（本批纯后端）。
4. **先交 Phase 0 测绘，再写代码**：逐条核实本任务书给的行号与前提；**任何前提不成立就停手回报**，不要硬接。
5. 每条改动必须带：真调用证据 + 负路径 + 隔离变异（红→还原→绿）。**禁止用「源码含某字符串」当功能验收**。
6. 改 `lib/index.js` 后**必须重钉 r26**：用守卫自己报出的 actual（归一化长度 + SHA16），不许手算；重钉后 26 PASS / 0 FAIL。

---

## 2. 4.4 · 诊断面读对目录

**目标**：诊断/状态面显示的「时段总结体积」等读数，必须等于 `MEM/summaries` 的真实字节数。

**Phase 0 必须先核实**：

- 诊断读数当前从哪个目录取（按内容搜 `summaries`、`summariesDir`、体积/字节统计处），记真实行号。
- `MEM/summaries` 是否存在、是否有 `*-pre` 旧目录混入（有则只统计主目录并说明理由）。
- 是否已有公共「目录字节统计」函数可复用；有就复用，**不要写第二份**。

**验收**：

1. 隔离目录造 3 个已知字节数文件 → 真调诊断读数函数 → 断言读数**逐字节等于** `sum(stat.size)`（给出实测数字）。
2. 负路径：目录不存在 ⇒ 返回 0 或明确 `unavailable`，不崩、不读别的目录。
3. 隔离变异 ≥1：统计目录改成相邻目录 ⇒ 断言必须变红。
4. 若该读数经 HTTP 路由暴露，给出真实响应片段（隔离宿主或直接调用路由处理函数）。

---

## 3. 4.3 · 时段总结可回读

**目标**：`memory_read` 支持合法 `kind:"summary"`，返回该工作区**最新一条**时段总结；非法 kind 行为不变（仍报错，且错误信息能看出合法集合）。

**Phase 0 必须先核实**：

- `memory_read` 当前 kind 枚举与拒绝分支（工具 schema 与运行时校验**两处**都要改；约 `:26527` 与 `:26576`）。
- 时段总结真实落盘位置与命名规则；「最新一条」按什么排序（mtime / 文件名日期）。
- 已有「读 summaries」实现（可能在诊断或 consolidate 里）就复用，**不要写第二份**。

**验收**：

1. 真调 `memory_read({kind:"summary"})`（真 import → 真构造 engine → 真调用工具函数），返回值含最新一条正文与来源路径；**断言返回内容等于磁盘该文件字节**。
2. 负路径 A：目录为空 ⇒ 明确空态（不抛未捕获异常、不返回别的 kind 内容）。
3. 负路径 B：拼错 `kind:"summaries"` ⇒ 仍按现有语义报错，错误信息含合法集合。
4. 隔离变异 ≥2：改「最新一条」排序比较符、改 kind 白名单各一条 ⇒ 必须变红。
5. 文档：`docs/USER-GUIDE.zh-CN.md` / `.en.md` 的 `memory_read` kind 列表补 `summary`；白皮书/共创文档若列了 kind 也要同步。**verify-docs 必须仍 22 / 87 / 182**。

---

## 4. 4.2 · 工作区技能库写入口（`scope=workspace`）

**注意**：Phase 0 很可能发现**已有部分实现**（`createScopedHubIoPre` 约 `:22527`、`rehydrateProcedureScopes` 约 `:9637`、注释「M8-B：procedures 走双库适配器（合并读 + 按 scope 分派写）」）。
**若已完整实现**：如实回报「已实现 + 证据」，**不要为交差重写**；**若只是部分**：说清缺哪一环再补。

**目标**：带 `scope=workspace` 真调 → 落 `WS/hub/procedures.json`（不再恒落 global）；**负路径：不传仍落 global**（缺省行为必须保持兼容）。

**验收**：

1. 真调用写入（不是 mock IO）：`scope:"workspace"` ⇒ 文件落在工作区库；`scope:"global"` 或不传 ⇒ 落全局库。给两条路径的真实文件路径与字节数。
2. 负路径：非法 `scope` 值 ⇒ 明确拒绝或回落缺省（按现有语义选一，并在回执说明选了哪个）。
3. 读侧：工作区 + 全局合并读，**不得互相覆盖**；构造同名条目各一条 ⇒ 合并结果两条都在。
4. 隔离变异 ≥2：写分派改回恒 global、合并读改成只读一个库 ⇒ 都必须变红。

---

## 5. 4.1 · person store 接画像

**目标**：`person store` 里的一条 `accepted` 记录要真的进入注入画像段。当前 `lib/user-portrait.js` 的 `buildUserPortraitPre(events)` **只从事件里取**。

**Phase 0 必须先核实**：

- `person store` 的真实位置与结构（`MEM/person`？`WS/person`？）；若没有独立 store，说清 `accepted` 记录当前落在哪。
- `buildUserPortraitPre` 的输入形状与 stage 语义（`PORTRAIT_STAGES = [accepted, used]`、`PORTRAIT_KIND_BYPASS = [authorResponse]`）。
- 注入画像段的消费点（renderer 里读 `userPortraitText` 的位置）。

**验收**：

1. 写入 1 条 `accepted` ⇒ **真渲染**的注入帧里出现该内容（断言具体片段，不是「非空」）。
2. 负路径：写 1 条 `retrieved` / `delivered`（非 accepted/used）⇒ **不得**进入画像段（既有画像纪律不得被 4.1 破坏）。
3. 上限：超 `PORTRAIT_MAX_CHARS`(600) 时截断行为与既有规则一致，不得因新来源绕过。
4. 隔离变异 ≥2：删 person 来源读取 ⇒ ①红；把 stage 白名单放宽到全部 ⇒ ②红。
5. **与 3.0 画像投递契约对齐**：画像出现在哪些帧/档位沿用 D30B 已裁口径，**不得**为新来源扩大档位。

---

## 6. 4.5 · 跨形态去重

**目标**：注入组装时按**内容指纹**去重 —— 「账本与检查点同文」时只出现 1 份；**负路径：内容不同两份都在**。

**Phase 0 必须先核实**：

- `pushPart` 共 **31 处**（实测），逐处标出属于哪个段（规则/白板/账本/事件/画像/日历…），判断哪些段之间存在**同文可能**。
- 是否已有指纹/去重工具可复用；**不要**用前缀相似度当去重依据（本仓明令禁止）。

**验收**：

1. 构造「账本段落与某检查点正文完全相同」的夹具 ⇒ 最终帧内该文本**只出现 1 次**（给出现次数与帧摘录）。
2. 负路径：两段内容**差一个字符** ⇒ 两份都在（防误去重）。
3. 不得改变段的**语义归属**：去重后留下的那一份必须仍在原段位（不能把账本内容挪到事件段）。
4. 预算账：去重后 `measureFrame` 的字符数必须相应减少，`budgetOvercommit` 判定不受影响。
5. 隔离变异 ≥2：指纹改成「长度相同即视为重复」⇒ 第 2 条负路径必须变红；去重后不更新预算 ⇒ 第 4 条必须变红。

---

## 7. 每项改完必跑

```powershell
node --check lib/index.js
node -e "import('./lib/index.js').then(()=>console.log('IMPORT-OK'))"
node tools/verify-docs.mjs            # 必须 22 tools / 87 routes / 182 config keys
node tests/smoke/smoke-test-r26-cross-layer.mjs   # 改 index.js 必须重钉，保持 26/0
```

另加与本批直接相关的套件：`smoke-test-batch3-closure-ev|co|u3b`、`smoke-test-delivery-policy-runtime`、`issue162-diagnostic-integrity`。

---

## 8. 交付与回执

1. **五项 = 五个独立 commit**，每个给：每文件 `(bytes, lines, sha16)` 改前/改后 + 净增减对照。
2. Phase 0 测绘结论（**若某项已实现，直接写「已实现 + 证据」，不重复实现**）。
3. 每条验收的真实输出（PASS 数、变异 CAUGHT/MISSED、实测字节数、帧摘录）。
4. **未验证项单列**（真实宿主、a11y、真实模型轮），不得用「已修复/全绿」掩盖。
5. 回执落盘 `docs/internal/RECEIPT-BATCH4-<项号>-<日期>.md`；**不要 push**。

---

## 9. 必须停手回报的情况

- Phase 0 发现某项前提不成立（例如 person store 根本不存在独立存储、或 procedures scope 已完整实现）。
- 去重会改变某段的语义归属（4.5 第 3 条做不到）。
- 任何已绿套件变红且归因不清 —— 先报，不要改判据。
- `verify-docs` 计数变动（超出 182/87/22）—— 说明动到了不该动的键或路由。
