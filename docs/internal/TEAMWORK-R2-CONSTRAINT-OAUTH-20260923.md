# R2 硬约束：OAuth 回调与 DSH 插件路由的冲突（主代理实测 · 2026-09-23）

> **本文件是身份架构方案的硬约束，任何设计必须先解决它，否则 Google / 阿里云登录无法落地。**
> 全部数据由主代理实测（脚本 `artifacts/_r2-identity-probe.mjs`），可复跑。

---

## 一、事实（实测，非推断）

### 事实 1：3080 端口**绑定在 `0.0.0.0`**

```
LocalAddress = 0.0.0.0    PID = 13748 (node)    启动 09-23 20:01:00
```

⇒ **端口是"对外可达"的形态**（监听全网卡）。理论上公网/局域网可连到 3080。

### 事实 2：但插件有 **55 处回环守卫**，覆盖全部 54 条路由

`lib/index.js:9040-9052` 是守卫定义，**55 次调用**、**59 处 `loopback-only` 拒绝文案**：

```js
function isLoopbackRequest(req) {
  const address = req.socket && req.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false      // ← L9048 关键
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}
```

三道闸门：① socket 源地址必须是回环；② `Host` 头 hostname 必须是 `127.0.0.1`/`localhost`/`[::1]`；③ **`Sec-Fetch-Site: cross-site` 直接拒绝**。

### 事实 3：插件没有**任何** cookie / 会话 / CORS / Authorization 处理

| 关键字 | 出现次数 |
|---|---|
| `cookie` / `Cookie` | **0 / 0** |
| `setHeader` | **0** |
| `Access-Control` / `cors` | **0 / 0** |
| `Authorization` / `bearer` / `Bearer` | **0 / 0 / 0** |

- `req` 只用到 4 个字段：`headers` / `method` / `socket` / `url`。
- 路由注册契约：`export const inject = ['webServer', 'tools', 'systemPrompt', 'subagents', 'llm']`（`lib/index.js:206`），然后 `for (const route of routes) disposers.push(ctx.webServer.register(route))`。
- 路由形状：`{ kind: 'exact', path: API['...'], handler: async (req, res) => {...} }`，**`kind:'exact'` 共 54 条**。
- `ctx.*` 可用成员：`directoryPicker effect get head on policy remote sessions systemPrompt tokenMeter tools webServer` —— **没有用户/身份/鉴权相关能力**。

---

## 二、冲突（这是本文件的核心）

**OAuth 授权码流的最后一步是「浏览器被外部 IdP 重定向回你的回调地址」。**

Google 登录的重定向是：浏览器在 `accounts.google.com` → 被 302 到 `http://127.0.0.1:3080/...?code=...`。

这次跳转在浏览器看来是一次**跨站顶级导航**，因此：

| 闸门 | 回调请求的实际值 | 结果 |
|---|---|---|
| ① socket 源地址 | `127.0.0.1`（本机浏览器发起） | ✅ 通过 |
| ② `Host` hostname | `127.0.0.1` | ✅ 通过 |
| ③ **`Sec-Fetch-Site`** | **`cross-site`**（来自 accounts.google.com） | ❌ **403 拒绝** |

⇒ **直接把回调地址指向现有插件路由，会被 `lib/index.js:9048` 挡死。** 这不是配置问题，是代码里的硬判据。

补充：即使放宽闸门③，还有第二层问题——**桌面/内网场景下 IdP 无法把浏览器重定向到"用户那台机器"**（若 GUI 是在远程/容器里跑，`127.0.0.1` 指的是服务器而不是用户浏览器）。

---

## 三、三条可行路线（方案报告必须选一条并给出理由）

### 路线 A：为「回调」开一条**专用的、受控的**例外路由
- 只对**一条** `path`（如 `/api/dsh-auto-memory/auth/callback`）放宽闸门③，其余 53 条保持原样。
- 必须同时补上补偿控制：`state` 一次性 + 短 TTL（≤5 分钟）、PKCE `code_verifier`、绑定发起会话的 `sessionId`、回调后立即失效该 state、**不通过 URL 传令牌**。
- 代价最小、改动最集中（守卫函数加一个白名单 path 参数），但要非常小心「放宽一处 = 打开一个口子」。
- **风险**：闸门③ 存在的理由（防 CSRF / 防本地服务被网页探测）在这条路径上被削弱，必须用 state 绑定补偿。

### 路线 B：**本机回环临时监听**（`gh` / `gcloud` CLI 的标准做法）
- 登录时由插件**临时**监听一个随机高端口（如 `127.0.0.1:49152`），只服务一次回调，拿到 code 后立刻关闭。
- 该临时服务**不受 55 处守卫约束**（自己写的、自己管），可自带 `state` 校验。
- `redirect_uri` 用 `http://127.0.0.1:<随机端口>/callback` —— Google 对 **"Desktop app" 类型客户端**允许任意端口的回环地址。
- **风险**：DSH 是否允许插件监听额外端口？**未验证**（`ctx.webServer` 只提供 `register(route)`，未见 `listen`）。若宿主不允许多端口，此路走不通。

### 路线 C：**设备码 / 无回调**（Device Authorization Grant，RFC 8628）
- 不依赖任何回调：插件显示一个 code + 短链，用户在**另一台设备**上完成授权后插件轮询取令牌。
- 天然规避回调、`Sec-Fetch-Site`、多端网络拓扑三个问题。
- 支持情况：Google **对"有限输入设备"类型支持 device flow**（需申请）；阿里云/IDaaS 需核实是否支持。
- **风险**：体验多一步（用户要去另一个页面输码），企业客户端可能不接受。

**主代理的倾向（非结论，供方案报告评估）**：**B 优先，A 作为退路，C 作为企业/无浏览器环境兜底**。理由是 B 不改动现有 54 条路由的安全模型，且符合业界 CLI 惯例。

---

## 四、对其他部分的连带影响（方案报告必须一并交代）

1. **`actor` 升级**：当前 `actor` 是字符串（`lib/state-commit.js:179-191` 的提交单据里）。引入身份后应升级为 `memberRef`，但**老数据没有 memberId** ⇒ 必须向后兼容（建议：`actor: { memberId?, raw }`，缺失时按"未知成员"处理而非报错）。
2. **数据边界已实测**：记忆目录含 `ws/.dsh-memory`、`projectDir/handoff`（含 `PLAN.md` / `archive` / `index.json` / `prev-session-*`）等 —— 团队共享要先划清"哪些随人走、哪些上团队"。
3. **前端零鉴权**：`client.js` 里 `auth`=0、`login`=0、`actor`=0 ⇒ **前端没有任何登录态概念**，身份 UI 是从零加。
4. **宿主契约限制**：`ctx` 无 identity/auth 能力，`inject` 里也没有 —— 身份能力**只能由插件自己实现**，不能指望宿主给现成的。
5. **`user`/`head`**：`kind` 分布里还出现了 `user`(2)/`assistant`(1) 等 —— 这些是**消息角色**不是身份，不要混淆。
