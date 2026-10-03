# plan · R19 fe02 八屏契约补完 B（屏⑤–⑧）

> 依据：70 卷 L105「R19 fe02 八屏契约补完 B（5–8 屏）｜19a 屏 5–6；19b 屏 7–8｜权威同上｜判据：逐屏判据 + 9 处计数站点同步」；
> 权威卷 fe02 §5.2 / §5.3 / §6.1 / §6.2（本轮已全量读 §5.2–§7）。R18 已完成屏①–④（30/66）。

## 一、小轮清单

| 小轮 | 内容 | 锚点 |
|---|---|---|
| **19a** | 屏⑤ 技能审批 + 屏⑥ 交接账本 | 8 + 6 = 14 |
| **19b** | 屏⑦ 设置分区 15 控件 + 屏⑧ 同步调试 | 15 + 7 = 22 |

## 二、逐屏判据（fe02 原文派生，不自行发明）

### 屏⑤ 技能审批（§5.2）
- 8 锚点：skills / skill / skill-owner / skill-evidence / skill-steps / skill-approve / skill-reject / skill-edit
- ★**审批权只看后端** `skill.canApprove` + `skill.approveBlockedReason`（**不得**用本地 role 推断）
- ★`riskLevel === 'high'` 必须**二次确认**；medium/low 直接提交
- 证据行复用 `hubEvLine` 语义（seen/success/sessions/reused/corrections）

### 屏⑥ 交接账本（§5.3）
- 6 锚点：ledger / ledger-seg（带 `data-actor`）/ ledger-chain / chain-node / chain-link / takeover
- ★分色**禁止硬编码**：`--dam-team-actor-hue` = 由 `actorId` **稳定哈希**得 0–360 增量，行内 CSS 变量注入；
  新规则 `[data-dam-team-ledger-seg][data-actor] { border-left-color: hsl(var(--dam-team-actor-hue) 62% 52%) }` 消费
- 同一 actorId ⇒ 色相恒定（**稳定性判据**）；不同 actorId 在样本内应分散

### 屏⑦ 设置分区（§6.1）★15 控件
| # | 锚点 | 类型 | 配置键 | 默认 |
|---|---|---|---|---|
| 1 | `data-dam-team-enable` | checkbox | teamEnabled | false |
| 2 | `data-dam-team-server` | text | teamServer | '' |
| 3 | `data-dam-team-id` | text | teamId | '' |
| 4 | `data-dam-team-member-name` | text | teamMemberName | '' |
| 5 | `data-dam-team-sync-mode` | select | teamSyncMode | manual |
| 6 | `data-dam-team-sync-interval` | number | teamSyncIntervalSec | 60 |
| 7 | `data-dam-team-scope-default` | select | teamScopeDefault | local |
| 8 | `data-dam-team-share-external` | checkbox | teamShareExternal | false |
| 9 | `data-dam-team-conflict-policy` | select | teamConflictPolicy | ask |
| 10 | `data-dam-team-attribution-show` | checkbox | teamShowAttribution | true |
| 11 | `data-dam-team-skin-url` | text | teamSkinId | '' |
| 12 | `data-dam-team-audit-show` | checkbox | teamShowAudit | false |
| 13 | `data-dam-team-test` | button | — | 自检 |
| 14 | `data-dam-team-test-result` | 容器 | — | 结果 |
| 15 | `data-dam-team-leave` | button | — | 退出（二次确认）|

- ★**三档互斥**：`teamSyncMode ∈ off|manual|auto`；**不得让 auto 顺带开 enable**（开关解耦硬约束）
- ★**即时回显**：onChange 立刻 `setCfg` 本地翻面再写盘（用户既有偏好）
- ★15 个 `f*` i18n 键 **zh + en 双语**
- 新增 `<section id="dam-settings-team" data-dam-settings-group data-dam-team-settings>`；既有 9 分区零改动

### 屏⑧ 同步调试（§6.2）
- 7 锚点：debug / debug-queue / debug-last / debug-errors / debug-cursor / debug-copy / debug-reset
- ★`debug-reset` **危险操作二次确认**（同 removeArm 范式）
- ★诊断 JSON **不得含记忆正文**（只 id/时间/错误码/计数）

## 三、零改动约束
- 追加式：新段插在 `L3-team:end` 之前；既有行**零删除零移动**
- ES5（var/function）· 零字面色值 · 零新增定时器 · 零新增路由（⇒ §8.4 九处计数落点 0 联动）
- ★★**不得让 teamEnabled 顺带影响既有 13 页签 / 9 分区 / 注入 / 反思**（开关解耦）

## 四、判据可脚本化清单
1. 36 个契约锚点逐个命中（+ 既有 30 ⇒ 全 66）
2. 新段零字面色值 / 零定时器 / 零 ES6
3. ★分色稳定性：同 actorId 两次调用 hue 相同；不同 actorId hue 不同
4. ★三档互斥：mode='auto' 不改变 enable 状态（真调用验证）
5. ★即时回显：onChange 同步调用 set(key,val) 恰 1 次
6. 既有守恒：MEMORY_TABS()=2 · region 18 · 值枚举锚点全在 · sectionLabels 键数 9→10
7. 负路径：删任一新增锚点 ⇒ 断言变红

