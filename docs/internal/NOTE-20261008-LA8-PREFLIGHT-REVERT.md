# L-A8（PR#303 第 1 点「静态预检前置」）回退说明 · 2026-10-08

## 结论
**回退 commit 169fd13。** 预检与用户已裁定的「允许降级、如实标注」在产品语义上互斥，
并非我当初以为的「纯增益叠加」。

## 取证
归属实验（完整树 + 换 HEAD~1 的 lib/index.js）：
- HEAD~1 (9dabde2)：issue207-create-boundaries PASS、issue207-routes PASS
- HEAD   (169fd13)：两个都 FAIL（assert.equal(continuationPending, true) 实得 undefined）
⇒ 真回归，非判据过期。

## 根因
预检抛错的条件是 `!prepared.provider || !prepared.model || typeof sc.selectModel !== 'function'`。
issue207 两组夹具的**源会话日志里根本没有 provider/model**，且替身 sessionController **没有 selectModel**
⇒ 三个条件全中 ⇒ 预检在 `sc.cancel` 之前直接 throw，夹具测不到原本要测的路径。

实测真实会话日志（`~/.dsh/sessions/*.jsonl`）**含** `"provider":"opencode-go","model":"deepseek-v4-flash"`，
故线上主路径不受影响；但「源会话无模型信息」是合法情形，此时：
- 预检语义 = **拒绝接续**（不 cancel、不投递）
- 批 D 语义（用户 2026-10-08 裁定）= **允许降级，但如实标注**
⇒ 两者对同一输入给出相反行为。

## 附带发现（真缺口，待用户裁定）
lane-a 的负路径变异揭示：provider 在、model 缺时 `d.provider && d.model` 为假 ⇒ 跳过 selectModel
⇒ **静默降级投递并报成功**，且因 `modelRequested` 为空串，批 D 的「未能确认」提示**不会显示**。
这是**批 D 未覆盖的可见性缺口**（不是预检的功劳）。

## 建议的下一项（不动产品语义的加法）
把批 D 的降级标注**扩展到「provider/model 缺失」这一类**（当前因 modelRequested 为空而不提示），
使「旧回合已停、模型没沿用」在**所有**降级路径上可见 —— 既守住用户裁定的「允许降级」，又补上可见性。

## 发版影响
3.2.12 只含批 A/B/C/D（全量回归 314/0/0）。预检不在本版交付，待用户就上述语义取舍裁定后再议。
