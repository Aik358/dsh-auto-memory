# 施工概览 · 批次5 收口（铭文落盘 + 运行档默认关闭）

日期：2026-11-23 ｜ 执行：Codex ｜ 复核：Lead ｜ 基线：`preview@37f20223`
**用户已审批 §4.2 提示词措辞**；本文是施工依据，完成后即可收口。

---

## 0. 本次做两件事

| # | 事项 | 性质 | 是否改产品代码 |
|---|---|---|---|
| **A** | 批次5 铭文落盘（渲染 1,718 / 完整帧 1,723） | 实现已审批方案 | 是（文本层） |
| **B** | `run_full` / `run_slim` 默认关闭，可手动打开 | 新增开关（降占用） | 是（后端 + 前端） |

---

## 1. 事项 A · 铭文落盘

### A1 替换三处

| 落点 | 现状 | 动作 |
|---|---|---|
| `lib/index.js:1598-1615` | `snapshotInscription` 1,511 字符 | 替换为定稿**去掉 ⑦ 行后的 14 行** = **1,601 字符** |
| `lib/index.js:1622` | `snapshotInscriptionArchive` 旧 ⑦（159 字符） | **替换为新 ⑦ 行**（`\n` + 116 字符 = **117**） |
| `lib/index.js:1595` | 注释「实测约 420 字符 ≈ 210 token」 | 改为「实测 1,723 字符（模板 1,601 + 归档 117，含日期与前导 LF）」 |

> **拆分口径（方案 B，唯一正确）**：
> - `snapshotInscription` = 提案 15 行**去掉 ⑦ 行** = **1,601 字符**
> - `snapshotInscriptionArchive` = `'\n' + ⑦行(116)` = **117 字符**
> - 拼接渲染 = **1,718**（未代入日期）；代入日期 = **1,722**；**加前导 LF = 1,723**
>
> **验证**：方案 B 的渲染结果与用户审批稿**逐字相同**（两者 SHA256 均为 `5fe771981bdaeff8`）。
> 护栏 1,900 ⇒ 余量 **177**。
>
> ⚠️ **为什么必须拆**：① 提案 15 行已含新 ⑦，若再保留旧 archive 段 ⇒ **两个 ⑦**；
> ② archive 层不能置空 —— `G4-6` 的 `:129` 断言 `archReal.length > 0`、`:132` 断言 `total.length > tpl.length`。
> ⇒ 只能「从模板摘出 ⑦ 放回 archive 层」，这是唯一同时满足渲染等价与两条断言的解。

### A2 客户端镜像

`lib/client.js` 的 `DEFAULT_PROMPT_LAYERS_CLIENT.snapshotInscription` 必须**逐字一致**。
`G4-6b`（`:149`）是镜像守卫，两侧缩进不同（服务端 4 / 客户端 6 空格），**比求值后的真实文本，不比源码字面量**。

### A3 禁改清单

- **不要**为了「更简洁」重写措辞 —— **用户已逐字审批**，改一个字都算偏离授权。
- **不要**调整 ①②③… 编号顺序（⑧ 在 ⑦ 前是既有事实，不是笔误）。
- **不要**把 `snapshotInscriptionArchive` 置空（`:129`/`:132` 会红）；也不要保留旧 ⑦ 内容（会重复）。它必须换成新 ⑦ 行。

---

## 2. 事项 B · 运行档默认关闭

### B0 先讲清楚这是什么（Lead 已测绘）

`run_full` / `run_slim` **不是两个独立开关**，是 `decideInjectTierPre`（`lib/index.js:2158-2167`）产出的两个**档位**：

```js
if (o.isCarry) return HANDOFF_CARRY
if (o.postCompact) return POST_COMPACT
if (o.hangComp) return HANG_COMPENSATE
if (o.isHuman) return o.isFull ? HUMAN_FULL : HUMAN_SLIM
return o.isFull ? RUN_FULL : RUN_SLIM   // ← 只有「非真人」帧才进这两个档
```

**关键**：这两档只在**非真人帧**（工具循环、无人值守自主步）触发。
现有唯一总闸是 `snapshotTieredInject`（`:1178`，默认 `true`），但它是**整台档位机器的总开关** ——
关掉会把 `human_slim` / `post_compact` 一起关掉，**不可接受**。

### B1 新增专用开关（不要复用 snapshotTieredInject）

| 键 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `runTierInjectEnabled` | boolean | **`false`** | `false` ⇒ 非真人帧**不进** `run_full` / `run_slim`；`true` ⇒ 恢复现行为 |

接线点在 `decideInjectTierPre` 末行之前判定。

**`post_compact` 现状（已核实，无需改动）**：它**已经是 `human_full` 同级**，不会受本次改动影响：

- `isRulesFullTierPre`（`:2008-2013`）：`POST_COMPACT` 与 `HUMAN_FULL` 并列 ⇒ 规则段投全文
- `isPlanFullTierPre`（`:1982`）：`POST_COMPACT` 与 `HUMAN_FULL`/`HANDOFF_CARRY` 并列 ⇒ 白板投全文
- `:12845` `fullTier = HUMAN_FULL || HANDOFF_CARRY || POST_COMPACT` ⇒ 压缩后重建全貌

> 用户说「post compact 就是在压缩之后自动注入一遍 human full 就 OK 了」—— **现状已是如此**，
> 本事项**不需要**为它做任何改动，只需在验收里断言它**未被误伤**（§3.2 第 3 条）。

### B2 ✅ 已裁定：关闭后非真人帧**不注入记忆**（用户 2026-11-23 拍板）

用户原话：「反正关闭之后，非真人就先给假。无论如何都有这个，这就是换回记忆，每 3 分钟会给你扔一次 RAG 的东西别的就不用管了」

**裁定内容**：`runTierInjectEnabled=false` 时，非真人帧**不注入记忆快照**（甲方案）。

**为什么安全（Lead 已代码核实，不是推断）**：

| 保障 | 证据 |
|---|---|
| 铭文属**动态帧**，不受档位影响 | `pushPart('otherDynamic', 'frame-inscription')` 在 `:13833`，与 `decideInjectTierPre` 无关 ⇒ 每轮仍投 |
| 记忆唤回是**独立 context 面** | `dsh:m6-reference-tail-pre` 注册于 `:25408`；注释 `:24483`/`:25265` 明写「独立通道，不经过本计数器」「独立 context 注册，不受本节流影响」 |
| 唤回有**步骤级 TTL** | `context-host.js:567` `ttlSteps:3, expiresAt: +180000`（3 步 / 180 秒）⇒ 用户说的「每 3 分钟扔一次 RAG」即此通道，**不受 run 档开关影响** |

> ⚠️ **口径订正（须写进回执）**：用户说的「每 3 分钟」实测是**两个并列约束** ——
> `ttlSteps: 3`（3 个模型步）+ `expiresAt: +180000`（180 秒）。是「3 步或 180 秒，先到先算」，
> **不是严格的 3 分钟一次**。这不影响裁定（通道独立是不变的），但实现与文案不得写成「每 3 分钟固定」。

### B3 设置页开关（用户要求「可手动打开」）

参照 `deliveryMode` 三态选择器做法（`886caa09`）：
1. 在 `skins/iter5/policy-settings.js` 增加开关控件；
2. 走 `node tools/build-iter5-skin.mjs` 产出生成区，**不手改生成区**；
3. 文案要说清「关闭后长任务中途不刷新记忆，只保留每轮铭文」这一后果。

### B4 数量影响

新增 1 个顶层配置键 ⇒ **配置键 182 → 183**。
`verify-docs` 会因此红，需**用 verify-docs 报出的 actual 去改**，不许手算。工具数仍 22、路由仍 87。

---

## 3. 验收清单

### 3.1 必跑套件

| 套件 | 期望 | 备注 |
|---|---|---|
| `smoke-test-g4-whiteboard` | **11/0** | 含 G4-6b 逐字镜像、G4-6c/6d |
| `smoke-test-r26-cross-layer` | 26/0，**需重钉** | 铭文变了 ⇒ 归一化长度与 SHA16 必变，**用守卫报出的 actual** |
| `tools/verify-docs.mjs` | **22 / 87 / 183** | 配置键 +1 |
| `smoke-test-delivery-settings-ui` | 全绿 | 改了设置页就要跑 |
| `smoke-test-iter5-skin` | 全绿 | 生成器产物一致性 |
| `smoke-test-batch-y-frontend` | 75 断言 | 文案判据 |
| `smoke-test-v5-p6-r4-scope-filter` | 57/0 | 源码锚点漂移高发 |

### 3.2 事项 B 的专项验证（不能只看套件绿）

必须给出**可复算的行为证据**：

1. **默认关闭**：新配置下非真人帧**不产生** `run_full` / `run_slim` 注入（给日志或计数器实测值）。
2. **可手动打开**：显式 `runTierInjectEnabled: true` ⇒ 与改前**逐字节一致**（给对比证据）。
3. **不误伤**：`human_full` / `human_slim` / `post_compact` / `handoff_carry` 四档**逐档**验证，不是抽一个。
4. **负路径**：非法值（字符串 `'false'`、`null`、`0`）处理明确且有断言。

---

## 4. 需用户裁定

| 编号 | 决策 | A | B |
|---|---|---|---|
| ~~D-1~~ | ~~运行档关闭后非真人帧给什么~~ | **已裁定：不注入（甲）** | — |
| **D-2** | 默认值口径 | **新装默认 false**（用户原话「所有人都默认关闭」） | — |

> **迁移纪律（不用问，按此执行）**：只在不存在的键上补 `false`，
> **绝不覆盖用户已手动开的 `true`**。`undefined` 与显式 `false` 在用户开过 true 时行为不同，必须区分。

---

## 5. 停手条件

1. `G4-6b` 报镜像不一致 ⇒ **停手报**，不要「取其一为准」。
2. 铭文落盘后完整帧 ≠ **1,723**（或渲染文本 SHA256 ≠ `5fe77198`）⇒ 停手报实测值，**不要**调整措辞去凑。
3. `verify-docs` 报的配置键不是 **183** ⇒ 键没接上或加了不止一个，停手报。
4. `runTierInjectEnabled` 与 `snapshotTieredInject` 语义重叠到互相覆盖 ⇒ 停手报，**不要合并两键**。
5. 已绿套件变红且归因不清 ⇒ 先报，不改判据。

---

## 6. 收口判据（满足即批次5 完成）

1. 铭文完整帧 = **1,723**，渲染文本 SHA256 = `5fe771981bdaeff8`（= 用户审批稿），G4-6b 逐字一致，G4 **11/0**。
2. `r26` 按 actual 重钉后 **26/0**。
3. `verify-docs` **22 / 87 / 183**，文档声明值已同步。
4. `runTierInjectEnabled` 默认 `false`，§3.2 四项全部给出实测证据。
5. 设置页可手动打开，真 UI 验过（隔离宿主 + 截图）。
6. 两事项**各自独立 commit**，均不 push。

---

## 7. 明确不做

- 不改铭文措辞（用户已审批）。
- 不动 `snapshotInscriptionArchive`。
- 不合并 `runTierInjectEnabled` 与 `snapshotTieredInject`。
- 不改 `human_*` / `post_compact` / `handoff_carry` 四档行为。
- 不跑真实模型对照（收口后的独立事项）。
- 不 push、不发版。
