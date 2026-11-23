# P2 范围裁定：三副本一致性与实现落点（2026-11-18）

性质：Lead 对 GPT《P2 测绘回执》的验收与范围批准。**批准 P2 编码**，本文件是 P2 的范围依据。

## 0. 裁定摘要

| # | 问题 | 裁定 |
|---|---|---|
| S1 | 三副本范围 | **批准三副本**：classic 手写源 + 生成 v4 + frozen；但**只有一份实现**，三面通过显式 props 接入 |
| S2 | 实现落点 | 新建共享组件源（进生成器输入）；**不得**把整页逻辑内联进 frozen 造成第二份副本 |
| S3 | 是否允许改 frozen | 允许，但仅限「挂载点 + props 透传」的定点修改 |
| S4 | 策略数据来源 | 有效策略读 /config **响应外层**字段；保存只发 deliveryPolicy 单键补丁 |
| S5 | 13 键 / 2 must | 从前端响应字段读取；**禁止**在前端另造第二份键表 |
| S6 | 诊断「打开日志」 | 复用现有 debug 面板的只读元数据（路径/大小/行数/复制）；**不得**新增网络请求或读正文 |
| S7 | 水位旧默认同步 | 三处 placeholder/fallback + frozen + settings-copy 文案一并改 '25'；**补精确字符串断言**，不得用现有 47/0 水位守卫的通过代替 |
| S8 | guard-map 技能文档 | 该文档为方法参考（其 System32 路径与 43/177 计数已过时）；P2 需在回执里产出**当轮实测** guard map |

## 1. S1/S2/S3：三副本怎么做到「一致」而不「复制」

**事实（已核）**：
- 设置主体由 tools/build-iter5-skin.mjs:205 从 lib/client.js 的 `function SettingsPage() {` 切片生成 v4 面（:24607 → :21259）。
- frozen 面（skins/legacy/iter5-325.js.frozen 的 Iter5Settings）是**独立源**，生成器**不重建**它。
- smoke-test-settings-parity.mjs:100-105 的方向是**单向**：implemented = classic 面有控件的键，断言 variants/legacy 不缺这些键（classic ⊆ variants、classic ⊆ legacy）。
  ⇒ 只要策略编辑器**不在 classic 的 SettingsPage() 切片里以 set('deliveryPolicy')/cfg.deliveryPolicy 出现**，parity 不会因新模块而红——但那样也意味着 parity **不再覆盖**新模块，必须补新守卫（见 §2）。

**批准做法（唯一合法形态）**：
1. 新增共享源（如 skins/iter5/policy-settings.js），**注册进生成器输入列表**；组件定义**只有这一份**。
2. **三面各加一个挂载点**，通过 props 接收该组件：
   - classic：SettingsPage() 内新增入口区块，渲染 props.policySettings（或宿主注入的 render 函数）；
   - v4：生成器派生，自动带同一挂载点；
   - frozen：frozen:875 起的 Iter5Settings 内**定点**加同一挂载点，同样从 props 取组件。
3. 宿主 Iter5HostSettings（lib/client.js:20454，真源 skins/iter5/surfaces.js:331）负责把组件实例透传给三面。
4. **禁止**把策略页实现复制进 frozen；**禁止**在 frozen 里 import（frozen 不能 import）——只能用 props。

**为什么不是「复制到 frozen」**：那会产生第二份实现，下次改策略页必然漂移，且直接违反「禁止整块复制/merge 式重构」纪律。

## 2. 必须补的新守卫（parity 覆盖不到的部分）

P2 交付时必须同时新增（真执行、带负路径）：

1. **挂载点三面存在**：classic / v4 / frozen 三面各含恰好 1 处策略挂载点（断言源码锚 + 生成后仍存在）。
2. **策略保存单键**：saveConfigPatch 调用只带 deliveryPolicy；旧散键在保存路径中零出现（负路径：往 patch 里塞一个旧键 ⇒ 必须红）。
3. **视图 ≠ 表示**：模块表把「视图（模块语义深度）」与「表示（单元完整性）」分成两个控件；断言不存在把二者合并的单一枚举来源。
4. **锁定的两个来源不可关**：user-memory / project-notes 渲染为只读，UI 上无可关闭控件（负路径：注入可关开关 ⇒ 红）。
5. **logs 别名**：模块表只出现一次 recentLogs；logs 不得单独成行（负路径：加入第二行 ⇒ 红）。
6. **诊断默认关**：默认状态下预览/注入零字节且**不读**诊断文件（spy readFile 断言未调用）。
7. **水位默认字符串**：三处 fallback/placeholder 与文案的默认必须是 '25'，且显式 '25,50' 仍可保留（负路径：改回 '25,50' ⇒ 红）。
8. **预览 partial 呈现**：partial:true 时 UI 必须显示「部分结果」并列出 violations（尤其 unit-quotas-not-executed）；负路径：隐藏 violations ⇒ 红。
9. **13 键清单同源**：前端不得硬编码第二份键表；响应缺字段时有显式兜底，兜底路径也要断言。
10. **三入口**：settings.section / settings.plugins.tab / plugins.detail.section 都能进入策略页（可访问名称 + 负路径：包名不匹配时 plugins.detail.section 不认领）。

## 3. 接口与数据来源纪律

- **有效策略**：/config 响应外层还带 deliveryPolicy（有效值，来自 legacyToPolicy）与 deliveryPolicyCapabilities；configOf(d)（lib/client.js:4195）只解 d.config。⇒ 新代码必须**显式读外层字段**，不能复用 configOf。
- **保存**：走 saveConfigPatch（:4164，成功即广播），补丁**只含** deliveryPolicy。删除该键 = 回滚到旧键适配。
- **诊断**：复用 API.debug（:3916）已有的路径/大小/行数元数据；**不得**新增读取诊断正文的网络路径，**不得**新增外部打开文件的系统调用。

## 4. 提交与边界

- P2 **只动** skins/iter5/*（含新共享源）、skins/legacy/iter5-325.js.frozen（仅挂载点）、lib/client.js（定点，经生成器重跑至 SYNC-OK）、测试、文档。
- **不得改** lib/index.js、lib/injection/*；发现后端缺口就报告申请，不得顺手改。
- P1 仍未提交（与 A 批 r3 在 lib/index.js 交织）；**P2 不依赖该提交**，可先做；提交裁决仍待用户。
- 未验证项必须单列：P2 完成后仍需全量回归与真实 DSH 宿主截图/a11y。

## 5. 与现有权威文档的关系

本文件是 TASKPACK/03-SETTINGS-CONTRACT.md（IA 与数据模型）与 04-ACCEPTANCE.md（A1–A15）在**范围与守卫**上的补充，冲突时以本文件为准；IA 细节仍以 03 为准。
