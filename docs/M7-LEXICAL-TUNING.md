# JS 词法降级层（lexical_pre_v2）调优实验报告

> 2026-08-25 · 动机：用户提议用 M7 模型经验调优 JS 词法降级链路，让"不开语义增强"
> 的基础层尽量可用。方法：全部在 artifacts/m7-live-pre/lexical-tuning/ 用
> **打补丁的副本变体**离线实验，生产代码零改动。评测：L2 真实语料
> （251 episodes / 40 条手写查询，含 hard-negative 对），复用生产
> `buildQueryPlan` + `lexicalSearch`，ep→mem id 双射映射仅重命名。

## 基线

| R@1 | R@5 | MRR | nDCG@10 | negHit@5 |
| --- | --- | --- | --- | --- |
| 0.050 | **0.200** | 0.129 | 0.140 | 0.075 |

参照：dense bge-m3 同语料 R@5=0.925。差距主体是**词汇改述鸿沟**
（见失败分析），不是参数问题。

## 实验结果（全部变体）

| 变体 | 改动 | R@5 | MRR | nDCG@10 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **v03_b045 / v03b_b030 / g_k*_b*** | **BM25 长度归一 b: 0.75→0.45(或 0.30)，k1 不敏感** | **0.225** | **0.176–0.178** | 0.181–0.190 | ✅ **唯一正收益**：MRR +37%，nDCG +36%，R@1 翻倍 |
| v01_notrunc | 取消 maxCjkGrams=64 截断 | 0.150↓ | 0.117↓ | 0.116↓ | ❌ 反直觉否决：全文 token 流抬高 avgdl 后长文被归一惩罚压得更狠，且 negHit@5 升到 0.10 |
| v04_unigram | CJK run 补充单字 token | 0.150↓ | — | — | ❌ 稀释精度 |
| v02_negstop | 停用词否定词豁免（不/别/没…开头） | 0.200 = | = | = | ⚪ 本集零收益零损害（当前查询无被误杀否定词）；作为防御性修正可随 v3 顺带 |
| g_w_cov80 / g_w_head25 | 评分权重 0.72/0.15 重分配 | 0.200 = | ≈ | ≈ | ❌ 不敏感 |
| g_below005 | below-score 门 0.10→0.05 | 0.200 = | = | = | ❌ 不敏感 |
| 截断率诊断 | 32-term 查询预算 | — | — | — | 0/40 触发，非瓶颈 |

## 失败案例分析（b=0.45 下）

命中的查询（lq02 rank3、lq03 rank2）都与 episode 原文**共享术语**
（"M7 contract freeze"、"tokenizer/chunking"）。miss 的（lq01 rank48、
lq04/lq06 >64）全是**改述型问句**——查询用"调研比较/许可证"，episode 写的是
具体模型名和结论。这个鸿沟是词法匹配的定义性局限，正是 dense 语义层存在的理由。

## 结论与建议

1. **值得进生产的一项**：BM25 `b: 0.75 → 0.45`（短笔记语料的长度归一过强是
   实测失配；k1 维持 1.2）。收益：MRR +37% / nDCG +36% / R@1 ×2，零成本。
2. 顺带项：否定词停用豁免（防御性，本集中性）。
3. 其余直觉假设（取消截断/unigram/权重重分配）均被数据否决——保留现状。
4. **版本纪律**：若采纳，须按流程走 `lexical_pre_v3`：JS 改
   `SHADOW_GATE_POLICY_PRE_V1.dictionaries.bm25` 并升 policyVersion +
   decision record；**Python worker `_lexical_scores` 的 BM25(k1,b) byte-twin
   必须同步**（D6 融合两臂一致）；m70/m71/m73 smoke 断言更新；全量回归。
5. 产品叙事的实证支撑：调优后基础层 R@5 仍只有 ~0.225 vs 语义层 0.925——
   "基础层可用、语义层显著更强"的两级定位有了数字背书，RELEASE-SEMANTIC-OPTION.md
   的可选安装决策不受影响、反而更站得住。

## 复现

```bash
cd artifacts/m7-live-pre/lexical-tuning
node eval_lexical.mjs                 # 基线（生产 lib）
python make_variants.py               # 生成变体副本
node eval_lexical.mjs v03_b045.js     # 任一变体
```
