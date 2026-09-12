# 群反馈云端耳朵(Webhook)部署说明

> 2026-09-13 搭建。**推荐路线**:零设备、零月租——把 QQ 机器人的事件接收方式从 WebSocket 切成
> **Webhook**,HTTP 回调推给腾讯云函数(Web 函数),命中触发词就在 GitHub 建单并回「收到 ✅」。
> 前置阅读:状态闭环词汇表见 `GROUP-LISTENER-SETUP.md`(收到/正在处理/处理完毕 的定义不变)。

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
   GH_TOKEN=<细粒度PAT,仅 issues:write>
   REPO=Aik358/dsh-auto-memory
   ROUTE_TOKEN=<自造一段随机字符串,防扫描>
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
