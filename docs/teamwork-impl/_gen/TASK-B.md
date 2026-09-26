# TASK-B · S3 皮肤协议差异对比（**只读调研 + 单文件产出**）

> 执行者：teammate。**只读代码，只写一个文件**。**禁止创建下级子代理。**

## 背景（用户明确要求，不许草草了事）

用户原话：
> 「皮肤一定要做完以后，把插件皮肤的框架协议也做出来…在这个前端皮肤大更新之后，
>  **可能旧的协议会有非常过时的地方，需要比较大程度的对比和修改。这个你要了解，不能草草了事**」

⇒ 本任务 = **把「官方皮肤契约」与「dsh-auto-memory 前端实际形态」做逐条对比**，
找出**过时点 / 缺口 / 冲突**，为后续「语义属性接入」提供依据。

## 权威源（只读）

官方契约目录：
`C:\Users\JH Z\.dsh\profiles\desktop\node_modules\@linxin666\dsh-client-ui-skin-center\contracts\`

含 6 个文件（**逐个读完，不要跳**）：
| 文件 | 大小 | 读什么 |
|---|---:|---|
| skin-manifest-v2.schema.json | 6673 | skin.json v2 结构 |
| semantic-attrs-v1.md | 15531 | **surface(8) / part(79) / plugin(13)** 枚举 |
| hooks-api.d.ts | 2624 | SkinHooksContext / defineSkinHooks |
| official-tokens-v1.json | 12206 | 官方 token 集 |
| primary-action-tokens-v1.md | 3616 | 主按钮 token 规则 |
| performance-guidelines-v1.md | 5963 | 性能约束 |

另可参考 `.../skin-center/README.zh.md` 与 `skins/blue-fantasy/skin.json`（**一个真实样例**）。

## 我们的现状（只读）

| 对象 | 位置 | 已知 |
|---|---|---|
| 前端 | `D:\dsh-auto-memory\lib\client.js`（742,031 B） | **163 个唯一 `data-dam-*` 锚点 / 0 个 `data-dsh-*`** |
| 皮肤原型 | `D:\dsh-auto-memory\docs\teamwork-research\skin\index.html`（190,355 B） | 10 屏 / 4 主题 / 92 token / **0 个 `<img>`** |
| token 契约 | `D:\dsh-auto-memory\docs\teamwork-research\skin\skin-token-contract.md` | 28,511 B |
| 插口清单 | `D:\dsh-auto-memory\docs\teamwork-impl\12-皮肤资源插口清单.md` | 6 张图 |

## 产出：**只写这一个文件**

`D:\dsh-auto-memory\docs\teamwork-impl\18-S3-皮肤协议差异对比.md`

必须包含以下章节：

### 1. 官方契约全貌（逐文件摘要）
每个契约文件：「它规定什么 / 谁是 owner / 版本轴 / 失败模式」。

### 2. 逐条差异表（★核心）
| # | 官方要求 | 我们现状 | 判定 | 建议动作 |
|---|---|---|---|---|
判定用三种：`缺失` / `冲突` / `已兼容`。
**必须覆盖**：surface 8 个 / part 79 行里与我们有关的 / plugin 13 个 / manifest v2 必填字段 / tokens。

### 3. ★过时点清单（用户最关心）
「官方协议里哪些部分，在我们这个插件的实际形态下**已经过时或不适用**」
—— 逐条给**证据**（官方原文 + 我们的实测数字），**不许凭感觉**。

### 4. 接入方案（具体到可施工）
- 我们该给哪些界面元素加 `data-dsh-part`？给**具体映射表**：`data-dam-X` → `data-dsh-part="Y"`
- 哪些**加不了**（官方枚举里没有对应项）⇒ 需要向上游提 issue 的清单
- 图片槽位（6 张）如何与 manifest `contributes` 对接

### 5. 未决问题
列出来，不要自行拍板。

## 硬约束
1. **只读**：绝不修改 lib/、package.json、tests/、skin-center 的任何文件
2. **只写** `18-S3-皮肤协议差异对比.md` 一个文件
3. 结论**必须附证据**（原文引用或实测数字）；推断须显式标注为推断
4. 行尾 CRLF

## 完成后留痕
在 `_gen/TASK-B.md` 末尾追加 `## TASK-B 完成回报`：文件字节 / 差异条数 / 过时点条数 / 未决问题数。

## TASK-B 完成回报

> 执行者：teammate `skin-protocol-diff`。**只读调研**，仅新增 1 个产出文件，未修改 `lib/`、`package.json`、`tests/`、skin-center 任何文件。

| 项 | 值 |
|---|---|
| 产出文件 | `docs/teamwork-impl/18-S3-皮肤协议差异对比.md` |
| 文件字节数 | **81297 B**（纯 CRLF：CRLF=931 / bareLF=0；共 931 行） |
| 差异条数 | **63 条**（surface 8 + part 33 + plugin 14 + manifest 8；每条附判定：缺失/冲突/已兼容） |
| 过时点条数 | **12 条**（A 级硬过时 8 / B 级半过时 3 / C 级名义过时 2） |
| 未决问题数 | **9 条**（U1–U9，均未自行拍板） |
| 附加上游 issue 清单 | 8 条（I1–I8，官方枚举缺口的提报建议） |

### 关键实测数字（全部可复现，命令见产出文件 §6）

| 指标 | 实测 |
|---|---|
| 我方 `data-dam-*` 唯一锚点 | **163**（其中 1 个为注释伪锚点 `data-dam-tour-`，真实 **162**） |
| 我方 `data-dsh-*` 输出 | **0** |
| 皮肤侧认识我方锚点 | **0**（skin-center 全库 6 契约 + 2 README + 2 lib 均不含 `data-dam-`） |
| 我方对官方 299 个 token 的覆盖 | **14 个 = 4.7%** |
| 主按钮四元组消费率 | **0%**（4 个 token 均 0 次） |
| 官方枚举 vs 自述 | part 自述 79 行 / 实测 79 行 = **96 值**；plugin 自述 **13** / 实测 **14** |

### 最重要的 3 个发现

1. **双向失明（O1/O2/O5）**：契约的两条产出通道都预设「插件源码在官方仓内」，且 `data-dsh-plugin` 枚举封闭（14 个值全为官方家族包）——**第三方插件既无法被 adapter 补打、也无法自注册归属值**。我方 163 个 `data-dam-*` 与皮肤侧 0 个引用，构成零覆盖而非「覆盖不完整」。这正是用户所说「插件皮肤框架协议」尚不存在的地方。
2. **平行协议撞名 + 零实现（O10）**：本项目 12 号文档自建的 `SKIN_ASSETS` / `data-skin-slot` / `--skin-*` 与官方 `contributes` / `data-dsh-part` / `--dsw-*` 是**两套独立体系**；实测 `SKIN_ASSETS`、`assetOf`、`data-skin-slot` 在 `lib/` 两文件中命中 **均为 0**（仅原型 index.html 用了 920 次 `--skin-*`、0 次 `--dsw-*`）⇒ **现在改协议代价最低**（无存量调用点）。
3. **可直接施工的白名单是真实的**：`part` 组中 **13 个锚点 / 77 次出现**可零风险直接映射（`sidebar-entry`/`tab-bar`/`tab`/`settings-row`/`banner`/`tag-chip`/`column`/`card`/`detail`/`panel` 等）；而 **141 个锚点（87.0%）**在官方 96 个 part 值里找不到对应项（缺「页面/控件/弹窗/日历/关系图」层级）⇒ 已整理 8 条上游 issue 建议。

### 一处取证更正（如实记录）

首轮脚本把 `--dsw-alias-`（尾随连字符）计为「幻觉 token」，逐条复核后确认它是**文档注释中的示意写法**，非代码引用；已在 §2.5.1 显式更正。真正需要修的是 **`--dsw-alias-text-warning`（L4192）**——该 token 不在官方 299 清单内，但带 `#d90` fallback 故长期静默。

### 并发改动声明

复核时发现 `lib/index.js` 由 **962,241 B → 963,818 B**（另一条会话线的合法写入，非本任务所为）；本任务**全部写入仅落在产出文件**。本报告结论不依赖 `lib/index.js`；主要证据源 `lib/client.js` 全程保持 **742,031 B** 未变。
