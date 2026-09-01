# M8 记忆中枢（Memory Hub）：三层记忆系统路径/功能图

> 状态：M8-0/1/2/3 纯核心已实现并 tested（2026-08-27）；Host 接线（engine._memoryHub + /memory-hub 端点 + 设置页 + 面板页签）已完成；live 验证待用户重启 3080。
> 权威设计源：docs/proactive-associative-memory-system-map.html M-02/M-03/M-04 模块卡。

## 1. 一句话

记忆中枢把三层记忆（经历/事实/技能）串成一条链：**从对话沉淀经历 → 固化事实 → 把反复成功的流程固化为技能（skill）→ 相似场景自动召回注入，让 AI 按固定流程执行**。这是 M7 记忆召回系统的「供给侧」——M7 决定「怎么送达」，记忆中枢决定「有什么可送达」。

## 2. 路径/功能图

```
                     ┌────────────────────────────────────────────┐
                     │            M8 记忆中枢 (Memory Hub)          │
                     └────────────────────────────────────────────┘

  M2 segments (对话段)           M5 evidence (访问证据)         M7 judgement-shadow (建议)
  user/assistant/reasoning       seen/read/cite/reuse/          semantic/profile/procedure_
       │                         success/correction             candidate (Python 只建议)
       ▼                                ▼                             ▼
┌───────────────┐            ┌──────────────────┐        ┌──────────────────┐
│ M-02 Episodic │            │ M-03 Semantic     │        │ M-04 Procedural  │
│ 经历 store     │            │ 事实 store (M8-0)  │        │ 技能 store (M8-2) │
│ episodic-store│            │ fact-store-pre    │        │ procedure-store  │
│ -pre.js       │            │                   │        │ -pre.js          │
│               │            │ upsert/冲突/revoked│        │ observe→candidate│
│ append(段)    │            │ supersede/TTL     │        │ →validated→active│
│ consolidate() │            │ 用户声明>推断       │        │ →deprecated      │
│ 巩固→episode  │            │                   │        │ promote 门槛:     │
│               │            │                   │        │  ≥3会话+≥2成功    │
│ 失败→candidate│            │                   │        │  correction≤30%  │
└──────┬────────┘            └────────┬──────────┘        │  高风险需批准      │
       │  success episode             │  semantic/profile │  一次成功≠可靠     │
       │  crossFeed(举一反三)          │  candidate        │                  │
       └──────────────┬───────────────┴─────────┬─────────┘                  │
                      ▼                         ▼                            ▼
              ┌─────────────────────────────────────────────────────────┐
              │              memory-hub-pre.js (编排器)                  │
              │  ingestJudgement / crossFeed / renderChecklists / overview│
              └────────────────────────────┬────────────────────────────┘
                                           │ active procedure → checklist
                                           ▼
                          ┌────────────────────────────────┐
                          │ M7 召回系统 (context-host emit) │
                          │ query 匹配 active skill 标题    │
                          │ → 附加 act.skill 注入包         │
                          │ → M6 Reference Tail 投递        │
                          └────────────────────────────────┘
                                           │
                                           ▼
                              AI 按固定流程执行 (skill checklist)
```

## 3. 模块清单与数据流

| 模块 | 文件 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- | --- |
| M-02 Episodic | `lib/episodic-store-pre.js` | 对话经历记录+会话结束巩固 | M2 segments | episode（intent/actions/entities/outcome） |
| M-03 Semantic | `lib/fact-store-pre.js` | 事实/偏好/约束固化 | judgement-shadow semantic/profile_candidate | Fact（scope/subject/predicate/object + provenance/ttl/revoked） |
| M-04 Procedural | `lib/procedure-store-pre.js` | 技能状态机+晋升+checklist 渲染 | M5 evidence + procedure_candidate + episode success | active skill → checklist 注入包 |
| Memory Hub | `lib/memory-hub-pre.js` | 三层编排 | 上述全部 | overview / checklists / 检索信号 |

## 4. M-04 技能固化（最精彩部分）

**生命周期**：`observed → candidate → validated → active → deprecated`

**晋升门槛**（M-04 元代码，全部可调）：
- 跨会话多样性 ≥ 3（`procedureMinSessions`）
- 成功次数 ≥ 2（`procedureMinSuccess`）——一次成功或三次重复都不足以证明可靠
- correction 占比 ≤ 30%（`procedureCorrectionCap`）；有任何矛盾 → 保持候选
- 必须写明 successCriteria
- 高风险（SSH/部署/删除）需用户批准（`procedureHighRiskApproval`），且永不因相似度自动执行

**召回注入**：M7 emit 命中时，query 与 active skill 标题词法匹配 → checklist（步骤+完成标准）附加进注入包 → M6 Reference Tail 投递 → AI 按固定流程执行。高风险自动降级为 hint（仅提示可参考）。

## 5. 参数（设置页「记忆中枢」分组）

| 参数 | 键 | 默认 | 说明 |
| --- | --- | --- | --- |
| 总开关 | `memoryHubEnabled` | false | 三层记忆运行开关 |
| 经历最少段数 | `episodicMinSegments` | 2 | episode 巩固阈值 |
| 经历保留上限 | `episodicRetention` | 256 | 超出按时间淘汰 |
| 技能晋升跨会话数 | `procedureMinSessions` | 3 | M-04 元代码 |
| 技能晋升成功次数 | `procedureMinSuccess` | 2 | 一次成功≠可靠 |
| 纠正容忍度 | `procedureCorrectionCap` | 0.3 | 超过保持候选 |
| 高风险需批准 | `procedureHighRiskApproval` | true | SSH/部署/删除 |
| 技能注入形式 | `procedureActiveLevel` | checklist | checklist/excerpt/hint |

## 6. 前端入口

- **设置页**：新增「记忆中枢」分组（`secMemoryHub`），所有参数可调（中英双语）。
- **记忆面板**：新增「记忆中枢」页签（`hubTab`），展示三层记忆：技能（active skill + 成功/会话计数）、事实（固化 facts + 待决冲突）、经历（recent episodes + outcome）。美术照抄现有卡片风格，待 Kimi K3 精修。
- **后端**：`GET /api/dsh-auto-memory-pre/memory-hub` 返回 overview；`POST` 支持 consolidate/feed/render/crossfeed。

## 7. 验收矩阵

- [x] episodic 巩固/保留/失败默认 candidate（H1）
- [x] procedure 晋升门槛/去重/checklist 渲染（H2）
- [x] 高风险需批准 + 一次成功铁律（H3）
- [x] hub 消费 judgement 三类候选 + crossFeed + render（H4）
- [x] 持久化 restore（H5）
- [x] 零进程/网络原语卫生（H6）
- [x] fact store 41 断言 + hub 综合 33 断言
- [x] 全量回归 35 套件全绿
- [ ] live 验证（用户重启 3080 后）
