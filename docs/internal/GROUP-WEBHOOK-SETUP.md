# 群反馈云端耳朵(Webhook)部署说明

> 2026-09-13 搭建(同日改为 AI 归纳路线):**不再自动建 GitHub issue**。云端耳朵把群里命中
> 反馈词/问题关键词的消息静默收进一个**秘密 Gist**;每天 12:00/21:00 的日报(group-digest)读取
> gist、调用大模型归纳成带标题的「群内反馈(AI 归纳)」清单随日报发群,并清空 gist 防重复。
> 前置阅读:状态闭环词汇表见 `GROUP-LISTENER-SETUP.md`(issue 状态机保留但处于休眠,当前无建单方)。

## 组成

| 文件 | 作用 |
| --- | --- |
| `.github/cloud/qq-webhook/index.js` | Webhook 接收端(Web 函数,零依赖,任何 Node>=18 环境可跑) |
| `.github/scripts/group-listener.mjs` | WS 版耳朵(备用:有常开设备时的等价实现,二选一) |

## 部署步骤(腾讯云函数 · Web 函数)

1. 注册腾讯云并完成实名认证 → 控制台搜「函数服务 SCF」;
2. 新建函数:函数类型选 **Web 函数**,运行环境 **Node.js 18 或 20**,地域就近(如广州/上海);
3. 函数代码:把 `.github/cloud/qq-webhook/index.js` 打成 zip(就一个文件)上传,执行方法保持默认(`index.main_handler` 不适用 Web 函数,Web 函数看监听端口);
4. 环境变量(函数配置里加):
   ```
   QQ_APP_ID=1905260114
   QQ_APP_SECRET=<机器人secret>
   QQ_GROUP_OPENID=D4D52BA3A7412F88E9192011CD4B935A
   GH_TOKEN=<细粒度PAT,Account permissions → Gists: Read and write(收集用,不碰仓库)>
   GIST_ID=<秘密 gist 的 32 位 id,文件名 group-feedback.jsonl>
   REPO=Aik358/dsh-auto-memory
   ROUTE_TOKEN=<自造一段随机字符串,防扫描>
   FEEDBACK_KEYWORDS=问题,bug,报错,error,异常,失效,崩溃,闪退,不能用,出错了,坏了,修复  <可选,收集关键词>
   LLM_API_KEY=<可选;配了才启用「@ 消息大模型应答」(DeepSeek key 或任意 OpenAI 兼容端点)>
   LLM_MODEL=deepseek-chat            <可选,默认 deepseek-chat>
   LLM_BASE_URL=https://api.deepseek.com  <可选,换其他 OpenAI 兼容服务时改>
   ```
5. 部署后,函数详情页拿「**访问服务 URL**」(默认公网域名,HTTPS),在末尾拼上 `/<ROUTE_TOKEN>/`;
6. QQ 新版控制台 → 开发设置 → 「事件订阅与回调地址」→ 接收方式切换 **Webhook** → 粘贴上面的 URL;
   平台立刻发 op=13 验证请求,我们的服务会自动应答(用 AppSecret 派生 Ed25519 密钥签名),通过即绑定;
7. 真实验证:群里发「反馈 这是一条测试」→ 应出现:新建 issue(带 group-report 标签)+ 群里「收到 ✅」。

## 关键事实(来自官方文档,2026-09 核对)

- 回调只要求 **HTTPS + 端口 80/443/8080/8443**;文档未要求 ICP 备案(腾讯云函数默认域名可直用;若校验被拒,改用 API 网关触发器或 CloudBase 云接入的默认域名,再不行换 VPS 跑同一份代码);
- **签名**:seed = AppSecret 自我拼接补足 32 字节 → 派生 Ed25519 密钥对;op=13 用私钥签 `event_ts+plain_token` 回 `{plain_token, signature}`;事件推送用公钥验 `X-Signature-Ed25519`(原文 = 时间戳+原始 body);
- **切换即生效**:Webhook 与 WebSocket 互斥——切过去后,`qq-capture-openid.mjs`/`group-listener.mjs` 这类 WS 工具就收不到事件了(切回来同理);
- 建议在函数配置里把 `STRICT_VERIFY=1`(验签严格模式)等真实验证跑通后再开。

## 与 Copilot/修理工的关系

建出的 issue 分配给 @copilot(需 Copilot 付费档,学生包免费)或自行认领;PR 引用 issue 自动播「正在处理 🔧」,关闭自动播「处理完毕 ✅」——由 `group-report-status.yml` 负责,与本耳朵解耦。

## 按需报告接口(给 DeepSeek Harness / 人工用)

```
GET https://<函数URL>/<ROUTE_TOKEN>/?report=N      # 最近 N 小时(1-48)群反馈
GET ...?report=12&raw=1                            # 只要原文不要 AI 总结
```
返回 JSON:`{ window_hours, total, items:[{t,u,w,m}], summary?, v }`。
- items=带时间戳的原始反馈;配了云函数 LLM_API_KEY 时附 summary(AI 分诊:问题清单+修复优先级),没配则只有原文——harness 的模型可直接读原文自己分析。
- 注意:每次日报(11:40/20:40)读完后会清空收集区,所以可查范围≈「自上次日报以来收集的反馈」(与 12h 窗口天然对齐)。
- DeepSeek Harness 用法:直接 GET 该 URL(浏览器/curl/任意 HTTP 工具),把返回 JSON 交给模型出修复方案;或固化成 auto-memory 的 procedure。


---

## 2026-09-13 增量：定时班自触发 + @问答每小时限额（版本标记 20260913f）

**背景**：GitHub 的 schedule 定时触发对本仓库从未生效（全仓库 schedule 运行 0 次，成功的日报全是手动 dispatch）。改为「SCF 定时触发器 → 函数 → workflow_dispatch」：到点必达，GitHub 侧只当执行器。

### 控制台要做的三件事

1. **上传新 index.zip**（标记 `20260913e`；上传后 `?diag=1` 应显示 `"v":"webhook-gist-20260913e"`，并出现 `"ai"` 与 `"timer"` 两个配置块）。
2. **新增环境变量**（函数配置）：
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` —— 与日报 Actions secrets 同源（WorldCodes 中转 + minimax-m3），配了才有 @ 答疑；**注意 base 的变量名是 `LLM_BASE_URL`**（`LLM_API_BASE` 亦兼容，2026-09-13 曾因文档误写前者导致 base 一直是 DeepSeek 默认值的 401）；
   - `GH_DISPATCH_TOKEN` —— **Actions 读写权限**的 PAT（细粒度：Repository permissions → Actions: Read and write），定时班自触发必需；
   - `TIMER_SECRET`（可选）—— `?timer=1&key=<值>` 手动测试时的口令；`AI_QUOTA_HOURS`（可选，默认 1）；`TIMER_MIN_GAP_HOURS`（可选，默认 10）。
3. **添加定时触发器**（函数 → 触发管理 → 创建）：类型=定时触发器，名称必须叫 **`digest-dispatch`**（与默认 TIMER_TRIGGER_NAME 一致），自定义 Cron（SCF 七段=秒 分 时 日 月 星期 年，按北京时间）：
   - `0 40 11 * * * *`（北京 11:40 主班）
   - `0 40 20 * * * *`（北京 20:40 主班）
   - 触发器 POST 到函数 URL（会带 Type:Timer 事件体），函数内部有 10 小时防重（落 gist 的 bot-state.json），不会重发。

### 新行为

- **@ 答疑**：群成员 @机器人 + 任意问题（不含反馈触发词）→ AI（M3）**每小时限 1 次**详细回答（被动回复，带 msg_id，不占主动消息配额）；超限回复一条限频提示；配额时间戳落 gist `bot-state.json`，冷启动不失忆。反馈触发词（反馈/问题/bug）的收集行为不变。
- **手动测试**：`GET …?timer=1&key=<TIMER_SECRET>` 可随时触发一班日报（同样受 10h 防重保护）。
- **成本**：SCF 侧 新增调用 ≤ 每天几十次，远在免费额度内；LLM 侧 M3 约 0.02 元/次，日报 2 次/天 + 答疑上限 24 次/天 → 最坏 ~0.5 元/天，实际远低。


### 20260913f 追加：反馈文件钉死文件名（真 bug 修复）

- **问题**：反馈写入/日报读取/清空都用「gist 里第一个文件」当目标——`group-raw-debug.txt` 先建、或清空用 `content:''`（= **删除文件**）后，第一个文件就会换人，实测反馈行混进了原始调试文件。
- **修复**：三方（webhook 写入 / report 读取 / digest 收集清空）全部钉死 `group-feedback.jsonl`；清空改写 `'
'`（**保留文件本身**）；report 的 LLM 失败不再静默，外显 `llmError` 字段（检查 base/model/key 就看它）。
- **迁移**：旧混写的历史行留在 `group-raw-debug.txt` 作为调试史，不再被 report 读取；新反馈从上传新包起进 `group-feedback.jsonl`。**务必确认 Actions secret `FEEDBACK_GIST_ID` 与云函数 `GIST_ID` 是同一个值**（`fb17c49dab6c295346c96ac971727095`；secret 不可回读，不记得就重设）。
