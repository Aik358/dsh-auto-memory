# 群反馈闭环(GROUP-REPORT)部署说明

> 2026-09-13 搭建。日报(见 `GROUP-DIGEST-SETUP.md`)之外的第二条链路:**群员在 QQ 群里汇报问题
> → 自动建 GitHub issue → 状态回执「收到 ✅ / 正在处理 🔧 / 处理完毕 ✅」双端同步(QQ 群一句话 + issue 结构化评论)**。
> 修理工可以是 Copilot(把 issue 分配给 @copilot),也可以是人。

## 状态词汇表(和群主口头回复一致)

| 状态 | 触发点 | QQ 群播报 | GitHub issue |
| --- | --- | --- | --- |
| 收到 ✅ | 群反馈建单 | `收到 ✅ 群反馈已建单 #N「…」,处理进度会同步` | 「收到 ✅」评论 |
| 正在处理 🔧 | PR 开出且引用该 issue | `正在处理 🔧 群反馈 #N → PR #M「…」` | 「正在处理 🔧」评论 |
| 处理完毕 ✅ | issue 关闭(合并自动关单也算) | `处理完毕 ✅ 群反馈 #N「…」已解决` | 「处理完毕 ✅」评论 |

## 组成

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/group-report-status.yml` | 状态机:issues opened/labeled/closed + PR opened/reopened → 双端同步 |
| `.github/scripts/report-sync.mjs` | 状态判定 + issue 评论 + QQ 播报(云端) |
| `.github/scripts/qq-send.mjs` | QQ 发送共享模块 |
| `.github/scripts/group-listener.mjs` | 「耳朵」:常开设备上连官方网关收群消息 → 建单 → 群里回收到 |

## 群员怎么报问题(两种都通)

1. **在群里说**(需要耳朵在跑):@机器人 并带触发词,如「@automemory 反馈助手 反馈 导出按钮点了没反应」→ 自动建单;
2. **直接提 GitHub issue**:标题随意,打上 `group-report` 标签 → 同样进入状态闭环(适合贴日志/截图)。

## 耳朵部署(旧安卓手机 Termux)

1. Termux(F-Droid 版)里:`pkg install nodejs-lts git`;
2. `git clone https://github.com/Aik358/dsh-auto-memory && cd dsh-auto-memory/.github/scripts`;
3. 建 `.env`(模板见 `group-listener.mjs` 头注释;GH_TOKEN 用**仅 issues:write 的细粒度 PAT**,别复用推送 PAT);
4. `node group-listener.mjs` → 看到「已上线,监听触发词」即可;
5. 常驻:关闭 Termux 电池优化 + `termux-wake-lock`;进阶用 Termux:Boot 开机自启。

**约束**:同一机器人同时只允许一个网关连接——耳朵在跑时,勿再跑 `qq-capture-openid.mjs` 或绑定 WorkBuddy(二者互踢)。

## Copilot 当修理工

1. 前提:仓库 Settings → Copilot 开启 coding agent;账号需 Copilot 付费档(GitHub 学生包通常自带 Copilot Pro);
2. 在群反馈 issue 里 assign `@copilot` → 它开工并开出草稿 PR(正文引用本 issue)→ 状态机自动播「正在处理 🔧」;
3. 人审合并 → issue 自动关闭 → 自动播「处理完毕 ✅」。

## 测试方法(需先 push 到 main)

1. 建一个测试 issue 打上 `group-report` → 群里应出现「收到 ✅」+ issue 出现评论;
2. 开个 PR 正文写 `fixes #<测试issue号>` → 群里「正在处理 🔧」;
3. 关闭测试 issue → 群里「处理完毕 ✅」。
