# 群同步日报(GROUP-DIGEST)部署说明

> 2026-09-12 搭建。每天北京时间 **12:00 / 21:00** 由 **GitHub Actions** 自动统计仓库
> issues / PRs / commits / release,生成中文摘要投递到 QQ 群「dsh-auto-memory交流群」。
> 跑在 GitHub 云端,**本机电脑关机也照常执行**;本机从未登录任何 QQ 协议端。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/group-digest.yml` | 定时(UTC 4:00/13:00)+ 手动触发入口;凭据走 secrets/vars |
| `.github/scripts/group-digest.mjs` | 统计 + 生成 + 多通道投递,零依赖;`--print` 本机试跑 |
| `.github/scripts/qq-capture-openid.mjs` | 一次性工具:连官方 WS 网关抓群 `group_openid`(仅本机跑) |
| `.github/digest/NOTES.md` | 人工备注区:写了什么,群消息「备注」栏就带什么(改完要上 main 才生效) |
| `.github/digest/PREVIEW.md` | 「下版本前瞻」板块文案:网页编辑,写几行就整块出现在日报里,留空隐藏 |
| `tools/release.mjs` | 复制白名单已加 `.github` → 以后每次发版自动带到 REL 树,不会被发版清掉 |

**窗口口径**=上一次「成功」的 workflow run → 现在;错过一次自动并进下一次,封顶 7 天。
**发送失败**的 run 记为失败(不重置窗口);**未配置通道**时 run 成功,消息只归档到 run 页面。

## 通道配置(仓库 Settings → Secrets and variables → Actions)

先设仓库**变量** `DIGEST_CHANNEL`(variables 区,非 secret),再按下表配 secrets:

| 通道 | DIGEST_CHANNEL 值 | 需要的 secrets | 说明 |
| --- | --- | --- | --- |
| QQ 官方机器人(推荐) | `qq_official` | `QQ_APP_ID` / `QQ_APP_SECRET` / `QQ_GROUP_OPENID` | 零服务器、零封号风险;QQ 群消息**禁止 URL**,脚本自动剥链接 |
| NapCat(OneBot11) | `napcat` | `NAPCAT_HTTP_URL` / `NAPCAT_GROUP_ID` /(`NAPCAT_TOKEN`) | 功能最全,可加「群内反馈」采集(见下);需一台常开设备 |
| Telegram | `telegram` | `TG_BOT_TOKEN` / `TG_CHAT_ID` | 最简单,2 分钟配完 |
| Discord / 飞书 / 钉钉 / 自定义 | `discord` / `feishu` / `dingtalk` / `generic` | 对应 `*_WEBHOOK_URL` | 备用/转发用 |

### A. QQ 官方机器人(推荐路径)

1. [q.qq.com](https://q.qq.com) 注册开发者 → **个人身份证认证**(主动消息频控:认证后 60 条/分钟、单群 1000 条/天,每天 2 条绰绰有余;未认证 30/分钟也够)。
2. 创建机器人(名字建议 `auto-memory 助手`),拿到 AppID / AppSecret。
3. 群主把机器人添加进群(机器人管理页 → 添加到群聊)。
4. 本机抓 `group_openid`(开放平台不直接展示,只随「@机器人」事件下发):
   ```
   QQ_APP_ID=xxx QQ_APP_SECRET=xxx node .github/scripts/qq-capture-openid.mjs
   # 然后在群里发一条「@机器人 你好」,脚本会打印 group_openid
   ```
5. 配 secrets + 变量 → Actions 页手动触发 `group-digest` 验证。

### B. NapCat(顺带把"群内问题反馈"带进日报)

在任一常开设备(旧安卓手机 Termux / 学生机 / NAS)Docker 跑 [NapCat](https://napneko.github.io),
开 OneBot11 HTTP 服务(如 `http://IP:3000`,建议配 access_token)。
之后把采集地址填到 secret `FEEDBACK_URL`(relay 提供 `GET /feedback?hours=N` 返回
`{"items":[{"user","text"}]}`),日报自动多一栏「群内反馈」。relay 可后补,不阻塞日报上线。

### C. 其他平台 webhook

TG / Discord / 飞书 / 钉钉按表配即可,适合"先进别的群/推给自己,再转发 QQ 群"的过渡期。

## 测试与运维

- **手动试跑**:GitHub 仓库 → Actions → group-digest → Run workflow(可填 `since_hours=24`)。
  消息全文写在 run 的 Summary 里,发送结果看日志最后一行。
- **临时改备注**:直接在 GitHub 网页编辑 main 的 `.github/digest/NOTES.md`,下次统计生效。
- **已知限制**:GitHub schedule 可能有 5~30 分钟调度延迟(照常按窗口统计,不丢数据);
  首次运行窗口=过去 12 小时;secret 没配齐时该通道报错,run 页面能直接看到原因。
- **改文案/格式**:`group-digest.mjs` 的 `compose()`;改动要走 pre 树 + 发版流程,或直接网页改 main(下次发版前会被 pre 版本覆盖,注意同步)。
