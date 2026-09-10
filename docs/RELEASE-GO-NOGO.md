# 发版 Go / No-Go · 快速验证方案（2026-09-09 23:24）

> 结论：**今天/明天可发**。原先计划的「跑一周分布观察」是**权重标定**用的（P10），**不是发布正确性**用的——正确性可以加速验证，不必等自然数据。

## 0. 为什么不用等一周

| 关注点 | 一周观察在解决什么 | 发布正确性是否已具备 |
|---|---|---|
| success / correction 分布 | **标定** `IMPORTANCE_WEIGHTS`（P10） | ✅ 已实证：P9a 26 断言（真实 host 实例 + DSH_HOME 注入磁盘投影 JSONL）、P9d 13 断言（含"修复前同夹具返回 0、修复后 2 条"的回归证明） |
| importance 只有半条腿 | 让 `success+reuse` 项有数据 | ⚠️ 但不构成发布阻塞：当前 importance∈[0.30,0.65] 由 `distinctSessions`（跨会话重现度）驱动，**是可用信号，且比"此前没有 importance"更优** |
| M8 默认启用 | — | ✅ live 验证已过（端点 200、三层落盘、restore） |
| 回归 | — | ✅ 八套基线全绿（见 §2） |

**判据**：新能力是**渐进增强**，最差情况也只是回到"没有 importance"的旧状态，**不会比现状更差** ⇒ 不构成发布阻塞。

## 1. 唯一硬阻塞：工作区未提交

```
M lib/index.js            (+11/-5) 子代理超时兜底 + localAgent 兼容（DSH 0.1.2）
M lib/python-setup-pre.js (+16/-4) issue #27 bge-m3 仓库名（HF 401）+ #28 tokenizer 补拉
```

`tools/release.mjs` 的 DEV 源**就是工作区**，脏工作区会直接进包且无法回溯。

**处理**：这两个都是真实 bug 修复（建议带上）→ 先 commit；若不属于本次发布范围 → `git stash push -u` 后再发。

## 2. 快速验证清单（1–2 小时，非一周）

### A. 静态（已跑，全绿，可复用）

| 套件 | 基线 | 状态 |
|---|---|---|
| p9a correction 归因 | 26 | ✅ |
| p9d recentEvidenceForSuccess ts | 13 | ✅ |
| memory-importance | 18 | ✅ |
| p4 L0 返回 | 34 | ✅ |
| p8 RRF 接线 | 14 | ✅ |
| evidence-agg | 14 | ✅ |
| handoff | 51 | ✅ |
| continue-chain | 58 | ✅ |

### B. live 冒烟（15–30 分钟，建议全做；时间紧则至少做 B3）

- [ ] **B1** 重启 dsh web，设置页「记忆中枢」可见、三栏有内容或正确空态
- [ ] **B2** `GET /api/dsh-auto-memory-pre/memory-hub` 返回 200 + overview
- [ ] **B3** ⭐ **P8 语义臂实证**（排序行为变更，最关键）：
      用 `memory_recall_pre` 查一个**与记忆词法不重合但语义相关**的查询（如记忆里写"npm 发布报 ENEEDAUTH"，查"发布凭证问题"），
      确认能召回 ⇒ 证明 RRF 融合生效、语义臂不是摆设。
      若召回失败且 `legacy` 开关切回后正常 → 立即回报，**暂缓发版**。
- [ ] **B4** correction 端到端：对 AI 说一句命中纠正词典的话（如"不对，你记错了"），检查当日 events 是否新增 `"kind":"correction"`
- [ ] **B5** success（可选，自然触发概率低）：临时调小 `autoConsolidateCooldownMinutes` → 先 read 一条记忆 → 触发一次 consolidation → 看是否落 `"kind":"success"`。
      若不方便，**接受 P9d 的 G1 断言作为功能实证**，跳过。

### C. 发布

```bash
cd D:/dsh-auto-memory
git status --short      # 必须干净（或只剩未跟踪的 artifacts/ 之类）
git diff --stat         # 确认最小改动
node tools/release.mjs 2.2.7
```

> 发版前确认 `package.json` 版本未被手工改过（当前 2.2.6，release.mjs 会自动回写）。

## 3. 发布措辞建议（避免过度承诺）

- ✅ 可写：「记忆检索支持分层语义召回」「记忆重要性权重（跨会话重现度）」「修正 evidence 时间戳与 correction 归因缺陷」
- ❌ 不要写：「按有用性排序」「被纠正的记忆会自动降权」——`success`/`reuse` 尚无真实数据，`correction` 刚修复，语义虽已实现但**未经真实分布验证**

## 4. 发布后（不阻塞）

1. 跑一周真实分布：success / correction / reuse 的实际量级
2. 对照 P9 的「理想触发场景清单」（correction 应达 cite 的 0.5–2%，success 应达 read+cite 的 1–5%）
3. 若不达标 → 独立小段放宽窗口（success 语义变更需裁决）
4. P10 定标：`IMPORTANCE_WEIGHTS` 升版本 + `w` 系数
5. reuse（P9c）继续延后，与 success 合并为「有用性信号补全」

## 5. No-Go 条件（触发即暂缓）

- B3 语义查询召回失败，且 `legacy` 下正常 ⇒ P8 排序有回归
- 工作区无法清理干净
- 任一基线数字下降
