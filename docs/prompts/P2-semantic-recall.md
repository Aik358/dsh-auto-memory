> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【P2】语义臂接入 recall

**目标**：`memory_recall` 当前为纯词法（工具描述自述"关键词匹配"）。接入语义臂，**输入用 L0 而非全文**（全文会超 e5 512 token 上限被截断）。

**涉及功能模块**：`lib/index.js` 的 `recall()` 实现与 `memory_recall_pre` 工具定义；`lib/semantic-js-pre.js`（C2）；`lib/shadow-retrieval-pre.js`（词法臂）。

**验收标准**：
1. 主题性查询（"发布踩坑"）能召回词法不重合但语义相关的记忆
2. **词法臂必须保留并继续打全文**（错误码/变量名/路径在 L0 里没有）
3. 语义引擎不可用 → fail-soft 退回纯词法，**不报错、不阻塞**
4. `recall(query, limit, agent, scope)` **签名不变**
5. 五套基线不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/context-host-pre.js`
- 关键词：`async recall(`、`defineTool('memory_recall_pre'`、`engine.recall(`、`lexicalSearch`、`buildQueryPlan`、`D6_FUSION_WEIGHTS_PRE_V1`、`fuseD6Pre`、`SHADOW_GATE_POLICY_PRE_V1`
- 必须先确认：① `recall()` 真实行号与完整函数体 ② 当前召回走的是 `lexicalSearch` 还是别的函数 ③ C2 引擎实例在 `index.js` 中如何持有（字段名）④ 是否已有 `scope='sessions'` 走 host 的分支

**改动边界**：
- ✅ 允许修改：`lib/index.js` 中 `recall()` 函数体内部（最小 diff）
- ❌ 禁止修改：`recall()` 签名、`defineTool` 的参数 schema 既有字段（只能新增可选字段）、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、激活决策层
- ❌ 禁止：把全文送进 embedding

**集成位置正确性**：必须说明为何改在 `recall()` 内部而非工具定义处；列出 `recall()` 的所有调用点行号。

**回滚**：`git checkout lib/index.js`（本段改动仅限该文件）。

---
