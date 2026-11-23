# Codex 任务书 · 设置页 deliveryMode 三态选择器（批次3 最后一块）

日期：2026-11-23 ｜ 执行者：外部代码线（GPT/Codex）｜ 验收者：Lead（本地独立复核，不采信自报）
基线提交：`2275a99a`（批次3 收尾三件全部落地，全量 650 PASS / 0 FAIL / 0 TIMEOUT）

---

## 0. 要解决什么

后端已支持 `deliveryPolicy.deliveryMode` 三态（`legacy` / `eventView` / `units`，缺省 `eventView`），但**设置页没有任何入口**。
现在只能通过 loopback 配置 API 切换模式 —— 这意味着用户「想关」时无法在界面里关。本任务补上这个选择器，让 D30B-14「唯一开关、设置里真能关」闭环。

三态的语义（**不要自己重新定义**）：

| 值 | 事件投影（卡片/目录/T1 摘要） | 最终帧组装 | 等价于 |
|---|---|---|---|
| `legacy` | 旧 `event-render.js` | 旧字符预算 | 批次 A 之前 |
| `eventView`（缺省） | 新 `event-view.js` | 旧字符预算 | 当前生产行为 |
| `units` | 新 `event-view.js` | **按单位组装**（模块开关/视图/配额真生效） | 新能力 |

---

## 1. 硬约束（违反即返工）

1. **前端改动必须走源 + 生成器 seam**：改 `skins/iter5/policy-settings.js` 等源文件，然后跑生成器产出 `lib/client.js` 的生成区；**禁止直接手改 `lib/client.js` 生成区**（下次 build 会被覆盖）。
2. **禁止整块替换 / 三方合并** `lib/client.js`、`skins/iter5/*`；只做定点插入。
3. **不新增顶层配置键**（保持 182）、**不新增 HTTP 路由**（87）、**不改工具数**（22）。
4. **不改后端行为**：`lib/injection/policy-v2.js`、`policy-runtime.js`、`unit-delivery.js` 一行都不要动（它们已验证通过）。
5. 必须保留旧控件冻结逻辑：`ITER5_POLICY_MANAGED_LEGACY_KEYS` 相关行为不变。
6. 中英双语文案都要有（`settings-copy.js` 的既有约定），不得只写中文。

---

## 2. 要做的

### 2.1 选择器本体

- 落点：投递策略的「预设与节奏」子页（`skins/iter5/policy-settings.js` 的 `renderPresetPage()`，约 :578；Phase 0 请按内容重新定位）。
- 控件形态：**三选一单选/分段控件**（不是下拉也可以，但必须能一眼看出三个档位的差异）。
- 每个档位必须有**一句人话说明**（不能只显示 `legacy`/`eventView`/`units` 这种内部代号）：
  - `legacy`：旧事件视图 + 旧组装（回滚用）
  - `eventView`：新事件视图 + 旧组装（默认，推荐）
  - `units`：按单位组装 —— 模块开关、视图、配额真正决定投递正文
- **必须显示「当前生效值」**：不能只显示 draft 值。用户保存后刷新页面要看到真实值。
- 未保存策略（`deliveryPolicy == null`）时显示 `eventView`，并标注「默认（未保存策略）」。

### 2.2 保存链路

- 保存时把 `deliveryMode` 写进 `deliveryPolicy`（与页面其它字段同一次保存，不要拆成第二个请求）。
- 保存成功后刷新回读，确认落盘值等于所选值。
- 删除策略（回滚旧键）后，页面要回到「默认 eventView」并如实显示。
- **非法值不给选**：UI 只有三个合法选项；不允许出现第四个值或自由输入。

### 2.3 文案与文档

- `skins/iter5/settings-copy.js` 补三档文案（中 + 英）。
- `docs/USER-GUIDE.zh-CN.md` / `docs/USER-GUIDE.en.md`：在投递策略章节补一段「投递模式」说明（三态 + 什么时候该用 `units` + 怎么回滚）。
- 若 `docs/internal/FEATURE-INVENTORY.md` 有策略页条目，同步一句。

---

## 3. 生成器与产物

```powershell
# 改完 skins 源后
node tools/build-iter5-skin.mjs            # 重新生成 client.js 生成区
node tools/build-iter5-skin.mjs --check    # 必须通过（产物 === 源）
```

生成后必须核：`lib/client.js` 的两个 `ITER5-GENERATED:BEGIN/END` 区间**内容有变化但行数在预期内**，且 `node --check lib/client.js` = 0。

---

## 4. 验收（每条贴实测输出）

1. **静态守卫**：新控件锚串在 `client.js` 生成区恰命中 1 次；三档文案中英各在；`deliveryMode` 写入路径在保存函数里。
2. **真执行 factory 的运行时守卫**（必须，不能只静态断言）：用既有的最小宿主 harness 真跑 `client.js` factory，断言设置页渲染出的策略页**真的包含三个可点选项**，并断言当前值高亮正确。
3. **真界面验收**（必须，不能只跑单测）：隔离 DSH 宿主 + 独立 profile + 空闲端口 → 打开设置 → 投递策略 → 预设与节奏 → 截图（三档可见、当前值正确）→ 点 `units` → 保存 → **回读 config 文件确认 `deliveryMode:"units"`** → 刷新页面确认显示 `units` → 切回 `eventView` → 保存 → 回读确认。
4. **负路径**：删除策略（回滚旧键）后，设置页显示「默认 eventView」，且回读 config 里没有 `deliveryMode`（或为缺省）；旧键控件冻结行为不变。
5. **回归**：`node tools/verify-docs.mjs` 必须仍 **22 / 87 / 182**；`batch-y-frontend`、`v5-p6-r4-scope-filter`、`iter5-skin`、`settings-safety` 等相关前端套件全绿（改动会动 `client.js` 文本，**需要按守卫自己报出的 actual 重钉**，不许手算）。
6. **真实宿主逐轮**（可选但推荐）：`units` 模式保存后下一轮真实模型请求中能看到按单位组装的正文（可复用批次 B 的本地 provider fixture 手法）。

---

## 5. 必须停手回报的情况

- Phase 0 发现策略页现有结构无法安全插入（例如该页由生成区整体渲染、无法定点插入）。
- 跑生成器后 `--check` 不一致，或 `client.js` 行数变化远超新增控件规模。
- 任何前端套件出现「修了才绿」的红 —— 先归因是判据过期还是真缺陷，**不要直接改判据**。
- 真实宿主上保存 `units` 后插件报错或设置页崩。

---

## 6. 交付

1. 每个文件改前/改后 `(bytes, lines, sha16)`；`client.js` 额外给生成区行数变化。
2. 第 4 节六条验收的逐条真实输出（含截图路径、config 回读片段、套件 PASS/FAIL 数）。
3. **未验证项单列**，不得用「已修复/全绿」掩盖。
4. 回执落盘 `docs/internal/RECEIPT-BATCH3-DELIVERY-MODE-UI-<日期>.md`；**不要 push**。
