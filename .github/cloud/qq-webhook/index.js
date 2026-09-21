/**
 * QQ 机器人 Webhook 接收端(「耳朵」的云端版)
 *
 * 部署形态:腾讯云函数「Web 函数」(Node.js 18/20/24)或任何能常驻跑 Node 的地方
 * 职责:接收 QQ 开放平台 HTTP 事件回调(op=13 URL 验证 + GROUP_AT_MESSAGE_CREATE)
 *   ① 命中反馈触发词/问题关键词的消息 → 追加进 GitHub Gist(group-feedback.jsonl)→ @ 消息回「已记录」
 *   ② 其他 @ 消息 → 配了 LLM_API_KEY 就让大模型被动回复,没配则沉默
 *   ※ 不再自动建 GitHub issue;日报时由 group-digest.mjs 读 gist、AI 归纳成问题清单后清空
 *
 * 环境变量:QQ_APP_ID / QQ_APP_SECRET / QQ_GROUP_OPENID / GH_TOKEN(需 Gists 读写)/
 *          GIST_ID(收集文件的 gist)/ REPO(备用)/
 *          TRIGGER(可选,明确反馈词)/ FEEDBACK_KEYWORDS(可选,问题关键词)/
 *          LLM_API_KEY / LLM_MODEL / LLM_BASE_URL / LLM_MAX_REPLY(均可选)
 *
 * ★ 2026-09-21 安全加固(上游 issue #113/#114/#115/#116):本文件是全仓唯一公网可达面,
 *   四条默认值原本都是「默认不安全」,现全部改为 **fail-closed**(不配就拒绝,而不是不配就放行):
 *
 *   STRICT_VERIFY         默认**开**(验签失败 → 401)。旧默认 `=== '1'` ⇒ 不显式配置就不验签,
 *                         而事件名取自载荷 `payload.t`,匿名即可伪造 @ 事件烧 LLM_API_KEY(#113)。
 *                         要关必须**同时**设 STRICT_VERIFY=0 与 ALLOW_INSECURE_VERIFY=1(仅本地联调)。
 *   AI_MAX_PER_HOUR       默认 6 次/小时(显式写 0 才是"不限额",且需自担代价)。旧默认 0=不限(#113)。
 *   ROUTE_TOKEN           人用端点(`?report=` / `?diag=`)的凭据,**不再是"可选"**:未配置 ⇒ 这两条端点
 *                         一律 403。旧行为是"token 为空 ⇒ 这道门不存在",于是匿名可读到群聊原文、
 *                         LLM key 形状(长度+头3+尾4)、appId/gistId/ghToken 前缀,`write=1` 还能写 gist(#115)。
 *   TIMER_SECRET          定时入口的共享密钥,**不再是"可选"**:未配置 ⇒ 定时入口一律拒绝(#114)。
 *   RAW_DEBUG             默认**关**(设 1 才开);且采集点已移到**验签之后**(#116)。
 *
 * ★ 三类入口的凭据各不相同,不要混:
 *   ① QQ 平台回调(默认路径) —— **不需要**任何自定义 token:平台只会把事件原样 POST 到登记的 URL,
 *      身份由 Ed25519 验签(X-Signature-Ed25519)负责。**给回调加 ROUTE_TOKEN 要求 = 机器人直接失联**。
 *   ② 人用端点 ?report= / ?diag= —— 需要 ROUTE_TOKEN(?token= 或请求头 x-route-token)。
 *   ③ 定时触发 ?timer=1 / POST Type:Timer —— 需要 TIMER_SECRET(另有触发名比对)。
 */
const http = require('node:http')
const crypto = require('node:crypto')

// 数值型环境变量解析:非数字/负数/空串一律回落到安全默认值。
// 为什么需要:旧写法 `Number(process.env.AI_MAX_PER_HOUR || 0)` 在写入非数字时会得到 NaN,
// 而限流判据是 `maxPerHour > 0` ⇒ NaN 让它**静默失效**(等于不限额),正是 #113 想要消除的形态。
const envNum = (v, def) => { if (v === undefined || v === null || v === '') return def; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : def }

const CFG = {
  appId: process.env.QQ_APP_ID,
  appSecret: process.env.QQ_APP_SECRET,
  groupId: process.env.QQ_GROUP_OPENID,
  ghToken: process.env.GH_TOKEN,
  gistId: process.env.GIST_ID || '',
  repo: process.env.REPO || 'Aik358/dsh-auto-memory',
  triggers: (process.env.TRIGGER || '反馈,问题,bug').split(',').map((s) => s.trim()).filter(Boolean),
  keywords: (process.env.FEEDBACK_KEYWORDS || '问题,bug,报错,error,异常,失效,崩溃,闪退,不能用,出错了,坏了').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  routeToken: process.env.ROUTE_TOKEN || '',
  port: envNum(process.env.PORT, 9000),
  // ★ issue #113:验签**默认开**。旧默认 `=== '1'` ⇒ 不显式配置就不验签,叠加「事件名取自载荷 payload.t」,
  //   任何拿到本函数 URL 的人都能伪造 GROUP_AT_MESSAGE_CREATE 让函数用运维者的 LLM_API_KEY 生成回复。
  //   关闭需要**同时**显式声明两个开关(STRICT_VERIFY=0 + ALLOW_INSECURE_VERIFY=1),单个 0 不再生效:
  //   这样"我知道我在做什么"必须被写进配置里,而不是靠漏配。
  strictVerify: !(process.env.STRICT_VERIFY === '0' && process.env.ALLOW_INSECURE_VERIFY === '1'),
  // 显式声明的不验签联调模式(仅本地)。即便开启,LLM 答疑(花钱的那条路径)仍要求验签通过 —— 见 handleEvent。
  allowInsecure: process.env.STRICT_VERIFY === '0' && process.env.ALLOW_INSECURE_VERIFY === '1',
  llm: {
    key: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    base: (process.env.LLM_API_BASE || process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    maxReply: Number(process.env.LLM_MAX_REPLY || 500),
  },
  // 定时班自触发(2026-09-13):GitHub 的 schedule 定时器从未唤起过本仓库工作流(全仓库 schedule 运行 0 次,
  // 官方文档承认 schedule 尽力而为、高峰会整班丢)——改由常驻的 SCF 定时触发器打本函数,函数再调
  // workflow_dispatch API 把日报班唤起来。GitHub 侧只当执行器,到点必达。
  timer: {
    triggerName: process.env.TIMER_TRIGGER_NAME || 'digest_dispatch',
    secret: process.env.TIMER_SECRET || '',
    token: process.env.GH_DISPATCH_TOKEN || '',
    workflowFile: process.env.GH_WORKFLOW_FILE || 'group-digest.yml',
    minGapHours: envNum(process.env.TIMER_MIN_GAP_HOURS, 10),
  },
  // @ 答疑限频(2026-09-14 起全部走环境变量,改额度不用改代码):
  //   AI_MAX_PER_HOUR = 每小时最多答疑次数;AI_QUOTA_HOURS = 时间窗(默认 1)。
  // ★ issue #113:默认值由 0(不限额)改为 **6 次/小时**。旧默认与「验签默认关」叠加后,
  //   公网 URL 就是一个"无上限烧 LLM_API_KEY"的入口。显式写 AI_MAX_PER_HOUR=0 仍是"不限额",
  //   但那从此是一句需要被写下来的声明,而不是没人注意到的默认值。
  ai: {
    maxPerHour: envNum(process.env.AI_MAX_PER_HOUR, 6),
    quotaHours: envNum(process.env.AI_QUOTA_HOURS, 1),
  },
  // 本机器人在群内的 openid(严格判定「是否被 @」用)。它 ≠ /users/@me 的数字 uin,平台也不提供换算接口,
  // 因此作为身份常量内置(与 QQ_APP_ID 同性质);换群/换机器人时用环境变量 BOT_MENTION_ID 覆盖即可。
  // 实测取证(2026-09-14):@ 该 id 的消息全是对机器人提需求(@8FB1CC35 的则全是 @ 群主)。
  botMentionId: (process.env.BOT_MENTION_ID || '183DA99311014124CAB4E497F0AF5892').trim().toUpperCase(),
}
for (const k of ['appId', 'appSecret', 'groupId', 'ghToken']) {
  if (!CFG[k]) { console.error(`[webhook] 缺少环境变量 ${k}`); process.exit(1) }
}
const VERSION = 'webhook-failclosed-20260921a' // 部署核对标记:diag 端点与错误响应都会带它(20260914a=@ 答疑优先于已记录;20260921a=#113-#116 四条默认值全部改 fail-closed)
const FEEDBACK_FILE = 'group-feedback.jsonl' // 反馈收集钉死文件名(digest 与 report 同读此名,清空时保留文件本身)
let lastError = null // 最近一次内部错误(diag 可见)
let botMentionToken = null // 从「@机器人+反馈词」消息里学习的机器人 mention 标识
// ★ issue #116:RAW_DEBUG **默认关**(设 1 才开)。旧默认 `(env || '1') !== '0'` ⇒ 不配就是开,
//   且采集发生在**验签之前** ⇒ 任何匿名请求都能把全量入站报文(含群成员聊天文本)灌进共享 gist。
//   现在:默认关 + 采集点移到验签通过之后(见文件末 HTTP 服务)。它只是排障开关,排完请关掉。
const RAW_DEBUG = process.env.RAW_DEBUG === '1'

async function rawDebug(req, raw) {
  if (!RAW_DEBUG || req.method !== 'POST' || !CFG.gistId) return
  try {
    const r0 = await gh(`/gists/${CFG.gistId}`)
    const prev = r0.body.files['group-raw-debug.txt']?.content || ''
    const lines = [...prev.split('\n').filter(Boolean), `${new Date().toISOString()} ${clip(raw, 500)}`]
    while (lines.length > 50) lines.shift()
    await gh(`/gists/${CFG.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { 'group-raw-debug.txt': { content: lines.join('\n') + '\n' } } }) })
  } catch { /* 调试记录失败不影响主流程 */ }
}

// ---------- Ed25519 密钥派生(官方算法) ----------
function keyPairFromSecret(secret) {
  let seed = Buffer.from(secret, 'utf8')
  while (seed.length < 32) seed = Buffer.concat([seed, seed])
  seed = seed.subarray(0, 32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  return { priv, pub: crypto.createPublicKey(priv) }
}
const KEYS = keyPairFromSecret(CFG.appSecret)

// ---------- QQ 发送 ----------
let qqToken = null
let qqTokenAt = 0
async function getQQToken(force = false) {
  if (!qqToken || force || Date.now() - qqTokenAt > 30 * 60e3) {
    const r = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: CFG.appId, clientSecret: CFG.appSecret }),
    }).then((r) => r.json())
    if (!r?.access_token) throw new Error('取 token 失败: ' + JSON.stringify(r).slice(0, 120))
    qqToken = r.access_token
    qqTokenAt = Date.now()
  }
  return qqToken
}
async function qqSend(text, msgId) {
  const body = { content: String(text).replace(/https?:\/\/\S+/g, '(链接略)'), msg_type: 0, msg_seq: (Date.now() % 1000) + 1 }
  if (msgId) body.msg_id = msgId // 被动回复(5 分钟窗口内有效,不占主动消息配额)
  const r = await fetch(`https://api.sgroup.qq.com/v2/groups/${CFG.groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${await getQQToken()}` },
    body: JSON.stringify(body),
  })
  const b = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`QQ 发送失败 ${r.status} ${JSON.stringify(b).slice(0, 160)}`)
  return b
}

// ---------- @ 即查(2026-09-14,零 LLM):触发词=消息去掉@后**整条恰好**是关键词 ----------
// 边界(用户指定):只有"更新总结"/"现有问题"等作为独立消息出现才触发;长句中出现这些词不触发。
// 数据全部零 LLM:GitHub 公开 API / gist 状态文件 / raw.githubusercontent。
const AT_QUERY_WORDS = ['更新总结', '现有问题', '下版本前瞻', '使用帮助']
function matchAtQuery(text) {
  const t = String(text || '').trim()
  return AT_QUERY_WORDS.includes(t) ? t : null
}

function ghAnon(p) {
  return fetch(`https://api.github.com${p}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'qq-webhook' } })
    .then(async (r) => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }))
}
const clipLine = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

// 「现有问题」= 开放 bug/PR + 未解决事项跟踪清单(gist group-issues.json)
async function atQueryIssues() {
  const L = []
  try {
    const q = await ghAnon(`/repos/${CFG.repo}/issues?state=open&per_page=30`)
    const all = (q.body || []).filter((x) => !x.pull_request)
    const bugs = all.filter((x) => (x.labels || []).some((l) => /bug/i.test(l.name || '')) || /^\[?bug/i.test(x.title || ''))
    L.push(`开放 Issue ${all.length}(bug ${bugs.length})`)
    for (const b of bugs.slice(0, 5)) L.push(`🐛 #${b.number} ${clipLine(b.title, 44)}`)
    if (!bugs.length) L.push('开放 bug 清零 🎉')
  } catch (e) { L.push('(GitHub 读取失败,稍后再试)') }
  try {
    const si = await gh(`/gists/${CFG.gistId}`)
    const issues = JSON.parse(si.body?.files?.['group-issues.json']?.content || '{}')?.issues || []
    if (issues.length) {
      L.push('未解决事项(群内反馈跟踪):')
      for (const it of issues.slice(0, 8)) L.push(`• ${clipLine(it.title, 40)} —— ${clipLine(it.detail, 50)}`)
    } else L.push('当前没有未解决事项(群内反馈跟踪为空)。')
  } catch (e) { L.push('(跟踪状态读取失败)') }
  return L.join('\n')
}

// 「下版本前瞻」= .github/digest/PREVIEW.md(main 分支,与日报同源)
async function atQueryPreview() {
  const r = await fetch(`https://raw.githubusercontent.com/${CFG.repo}/main/.github/digest/PREVIEW.md`, { headers: { 'User-Agent': 'qq-webhook' } })
  if (!r.ok) return '(暂无下版本前瞻内容。)'
  // 注释剔除与 digest 端同纪律:逐行过滤 <!-- 与 #,并剥掉悬空的 HTML 注释闭合行 -->
  const lines = (await r.text()).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('<!--') && !l.startsWith('#') && l !== '-->')
  return lines.length ? ['▍下版本前瞻', ...lines.slice(0, 10).map((l) => clipLine(l, 70))].join('\n') : '(暂无下版本前瞻内容。)'
}

// 「使用帮助」= 静态说明(零 LLM,零 IO)
function atQueryHelp() {
  return [
    '我可用的指令(@我 后单独发,或 @我+指令):',
    '• @automemory 更新总结 —— 最近一版更新要点',
    '• @automemory 现有问题 —— 开放 bug + 群反馈未解决事项',
    '• @automemory 下版本前瞻 —— 下版本计划内容',
    '• @automemory 使用帮助 —— 显示本说明',
    '• @automemory + 任意问题 —— AI 答疑(限频见群内提示)',
    '反馈方式:消息里带上「反馈/问题/bug」等词,我会记录进下期总结。',
  ].join('\n')
}

// 「更新总结」= 最近一班日报正文。优先:最近成功 run 的 job logs(需带 token 的 API,免费且即时);
// 兜底:main 分支 CHANGELOG 最新两节(纯公开数据)。
async function atQuerySummary() {
  try {
    if (CFG.ghToken) {
      const runs = await gh(`/repos/${CFG.repo}/actions/workflows/${CFG.timer.workflowFile}/runs?status=success&per_page=1`)
      const run = runs.body?.workflow_runs?.[0]
      if (run) {
        const jobs = await gh(`/repos/${CFG.repo}/actions/runs/${run.id}/jobs`)
        const job = jobs.body?.jobs?.[0]
        if (job) {
          const lr = await fetch(`https://api.github.com/repos/${CFG.repo}/actions/jobs/${job.id}/logs`, {
            headers: { Authorization: `Bearer ${CFG.ghToken}`, 'User-Agent': 'qq-webhook' },
            redirect: 'follow',
          })
          if (lr.ok) {
            const text = await lr.text()
            const m = text.split('─────────────── 生成摘要 ───────────────')[1]
            if (m) {
              const body = m.split('────────────────────────────────────────')[0].split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l || (i > 0 && a[i - 1])).slice(0, 40).join('\n').trim()
              if (body) return `最近总结(${run.created_at.slice(5, 16).replace('T', ' ')} UTC 跑完):\n${body}`
            }
          }
        }
      }
    }
  } catch (e) { /* 走兜底 */ }
  // 兜底:CHANGELOG 最新两节
  const cl = await fetch(`https://raw.githubusercontent.com/${CFG.repo}/main/CHANGELOG.md`, { headers: { 'User-Agent': 'qq-webhook' } }).then((r) => r.text())
  const out = cl.split(/\n(?=## )/).slice(0, 2).map((sec) => {
    const head = (sec.split('\n')[0] || '').replace(/^## /, '')
    const bullets = sec.split('\n').filter((l) => /^[•\-*] /.test(l.trim())).slice(0, 5).map((l) => clipLine(l.trim(), 60))
    return `▍${head}\n${bullets.join('\n')}`
  }).filter((s) => s.length > 10).join('\n')
  return out || '(暂时取不到总结内容。)'
}

async function handleAtQuery(word) {
  try {
    if (word === '更新总结') return await atQuerySummary()
    if (word === '现有问题') return await atQueryIssues()
    if (word === '下版本前瞻') return await atQueryPreview()
    if (word === '使用帮助') return atQueryHelp()
    return null
  } catch (e) {
    lastError = 'atquery: ' + ((e && e.message) || e)
    return '(查询失败,稍后再试。)'
  }
}

// ---------- LLM 应答(可选):非反馈类 @ 消息交给大模型,被动回复 ----------
async function llmReply(userText) {
  const r = await fetch(`${CFG.llm.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.llm.key}` },
    body: JSON.stringify({
      model: CFG.llm.model,
      messages: [
        { role: 'system', content: '你是 QQ 群「dsh-auto-memory 交流群」的群助手 automemory。回答简短(通常不超过 150 字)、技术向、语气谦虚;关于本项目的问题如实回答,不确定就建议在群里说明情况。不要用 Markdown 标题,纯文本短段落。直接输出面向用户的最终回答,禁止输出任何思考过程/草稿/自我分析。你还有零额度的即查指令(用户 @你 后单独发送关键词即可):「更新总结」=最近一版更新要点;「现有问题」=开放 bug 与群反馈跟踪清单;「下版本前瞻」=下版本计划;「使用帮助」=完整说明。当用户问进展/现存问题/计划/怎么用你时,优先引导用对应指令,而不是让用户把内容贴给你。' },
        { role: 'user', content: userText },
      ],
      // 2026-09-14 修复:中转会把思维链混进 content 且计入 max_tokens——400 全被思考耗光,
      // 用户实测收到的是截断的思维链。放宽到 1600 给思考+正文都留足;过滤见下。
      max_tokens: 1600,
      temperature: 0.7,
    }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.choices?.[0]?.message?.content) throw new Error(`LLM 失败 ${r.status} ${JSON.stringify(j).slice(0, 160)}`)
  let out = j.choices[0].message.content.trim()
  // 过滤思维链(与日报脚本同源纪律):优先剥离正规分离形态 reasoning_content;混进 content 时
  // 按 </think> 标签切段,再按行首思考特征词剥除思维链前缀,只留成片正文。
  const rc = j.choices[0].message.reasoning_content
  if (rc && out.startsWith(String(rc).trim())) out = out.slice(String(rc).length).trim()
  if (/<think>/i.test(out)) out = out.split(/<\/think>/i).pop().trim()
  const thinkRe = /^(好[的吧]|让我|我需要|首先|嗯|用户(可能|在问|想|要)|他(想|要)|这段|这个问题|分析一下|总结一下|大概|应该[是从]|或许是|考虑|检查一下|等等|看来|也就是说|换句话说|好的[,,，]|[-—]{3,})/
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
  let lastCut = -1
  for (let i = 0; i < lines.length; i++) if (thinkRe.test(lines[i])) lastCut = i
  if (lastCut >= 0 && lastCut >= lines.length - 3) out = lines.slice(lastCut + 1).join('\n').trim() || out
  return out.slice(0, CFG.llm.maxReply)
}

// ---------- GitHub(Gist 收集) ----------
const gh = (p, opts = {}) =>
  fetch(`https://api.github.com${p}`, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${CFG.ghToken}`, 'User-Agent': 'qq-webhook', ...(opts.headers || {}) },
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }))

async function gistAppend(line) {
  // 2026-09-13 修复:反馈一律写进**钉死的文件名** group-feedback.jsonl(PATCH 到不存在的文件名会自动创建)。
  // 旧实现取「gist 里第一个文件」——raw-debug 文件先建/清空后文件被删,第一个文件就会换人,
  // 反馈与原始调试混写(实测 14:29 的反馈行混进了 group-raw-debug.txt)。
  const r0 = await gh(`/gists/${CFG.gistId}`)
  if (!r0.ok) throw new Error(`读 gist 失败 ${r0.status}`)
  const prev = (r0.body.files[FEEDBACK_FILE]?.content || '').split('\n').filter(Boolean)
  prev.push(line)
  while (prev.length > 400) prev.shift() // 只保留最近 400 条
  const r = await gh(`/gists/${CFG.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FEEDBACK_FILE]: { content: prev.join('\n') + '\n' } } }) })
  if (!r.ok) throw new Error(`写 gist 失败 ${r.status}`)
}

// 状态文件(bot-state.json,与反馈收集同一个 gist):@问答配额/定时班去重都落这里,防冷启动失忆
async function botState() {
  const r0 = await gh(`/gists/${CFG.gistId}`)
  const f = r0.body && r0.body.files && r0.body.files['bot-state.json']
  try { return JSON.parse((f && f.content) || '{}') } catch (e) { return {} }
}
async function saveBotState(st) {
  const r = await gh(`/gists/${CFG.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { 'bot-state.json': { content: JSON.stringify(st) } } }) })
  if (!r.ok) throw new Error(`写 bot-state 失败 ${r.status}`)
}

// ---------- 事件处理 ----------
const seen = new Set()
const recentByContent = new Map() // 作者+内容 → 最近处理时间(重复推送去重,2026-09-14)
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
const when = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())

// verified = 本次请求是否通过 Ed25519 验签(HTTP 层传入)。默认配置下未验签请求已在上游被 401 拦掉,
// 这个参数只用于「显式关掉验签的联调模式」下继续拦住花钱的那条路径(issue #113)。
async function handleEvent(payload, verified = false) {
  // URL 验证(op=13):回传 plain_token + 对 event_ts+plain_token 的 Ed25519 签名(hex)
  if (payload.op === 13) {
    const { plain_token: plainToken, event_ts: eventTs } = payload.d || {}
    if (!plainToken || !eventTs) { console.warn('[webhook] op=13 缺字段'); return { plain_token: plainToken || '', signature: '' } }
    const sig = crypto.sign(null, Buffer.from(`${eventTs}${plainToken}`), KEYS.priv)
    console.log('[webhook] URL 验证应答完成')
    return { plain_token: plainToken, signature: sig.toString('hex') }
  }
  // 群消息事件
  // 事件识别:WS 信封用 t 字段;Webhook 信封没有 t,事件名在顶层 id 前缀(GROUP_MESSAGE_CREATE:xxx)
  const eventName = payload.t || String(payload.id || '').split(':')[0]
  if (payload.op === 0 && (eventName === 'GROUP_MESSAGE_CREATE' || eventName === 'GROUP_AT_MESSAGE_CREATE')) {
    const d = payload.d || {}
    const id = d.id || `${d.timestamp}|${d.author?.username || d.author?.openid}|${d.content}`
    if (seen.has(id)) return
    seen.add(id)
    if (seen.size > 500) seen.delete(seen.values().next().value)
    // 重复推送去重(2026-09-14 实测):平台会把同一条消息推两次(相隔 7-8 秒),**两次的 d.id 不同**
    // (id 尾部含递增 seq),故上面的 id 去重拦不住 —— 会导致群反馈记两遍、即查/答疑各回两次。
    // 这里按「作者 + 内容」做短窗口语义去重;时间戳字段缺失时退化为「作者+内容」永久去重(仅在 500 条窗口内)。
    const dedupKey = String(d.author?.member_openid || d.author?.username || '?') + '\u0000' + String(d.content || '')
    const nowMs = Date.now()
    const prevAt = recentByContent.get(dedupKey)
    if (prevAt && nowMs - prevAt < 60000) { console.log('[webhook] 重复推送已忽略:', clip(d.content, 30)); return }
    recentByContent.set(dedupKey, nowMs)
    if (recentByContent.size > 500) recentByContent.delete(recentByContent.keys().next().value)
    const mentions = [...String(d.content || '').matchAll(/<@!?([0-9A-Fa-f]+)>/g)].map((m) => m[1].toUpperCase())
    const text = String(d.content || '').replace(/<@!?[0-9A-Fa-f]+>/g, '').trim()
    const lower = text.toLowerCase()
    // 严格判定「是否被 @」(2026-09-14 修复):
    // 旧实现 isAt = mentions.length > 0 —— 群里任何 @(比如别人 @ 群主)都会被当成「@ 机器人」,
    // 机器人会抢答;更糟的是它把最后那个 mention 学成「机器人的 id」,于是永久认错人。
    // 现在只认两类证据:①平台明确给 AT 事件(只有 @机器人 才推送);②mention 命中已知的机器人 id。
    const atEvent = eventName === 'GROUP_AT_MESSAGE_CREATE'
    const knownBotId = CFG.botMentionId || botMentionToken || ''
    const isAt = atEvent || (!!knownBotId && mentions.includes(knownBotId))
    // 学习:AT 事件是"这条就是 @ 机器人"的权威证据 —— 只有在此时才学习机器人 id,且必须唯一
    if (atEvent && mentions.length === 1 && !CFG.botMentionId) botMentionToken = mentions[0]

    // ① 问题收集(2026-09-13 交互修正):所有消息(@ 与否)命中反馈词/关键词都静默记录 ——
    //    旧实现 @ + 反馈词会用「已记录」顶掉 LLM 回答(实测:用户 @ 提问带「反馈」二字 → 只收到已记录)。
    //    现在 @ = 答疑优先,收集静默进行,回答开头合并「已记录」确认(见 ②)。
    const collected = CFG.triggers.find((w) => lower.includes(w.toLowerCase())) || CFG.keywords.find((w) => lower.includes(w))
    let recorded = false
    if (collected && CFG.gistId) {
      try {
        await gistAppend(JSON.stringify({ t: d.timestamp || new Date().toISOString(), u: clip(d.author?.username || d.author?.member_openid || '?', 16), w: collected, m: clip(text, 200) }))
        recorded = true
        console.log('[webhook] 已收集:', clip(text, 50), isAt ? '(随 @ 答疑合并确认)' : '(非 @,静默)')
      } catch (e) { lastError = 'collect: ' + e.message; console.error('[webhook] 收集失败:', e.message) }
    }

    // ② @ 机器人的消息:先查即查指令(零 LLM,不占答疑额度);不是指令才走 LLM 答疑。
    if (isAt) {
      const atq = matchAtQuery(text)
      if (atq) {
        try { await qqSend(await handleAtQuery(atq), d.id) } catch (e) { console.error('[webhook] 即查失败:', (e && e.message) || e) }
        return
      }
    }

    // ③ @ 机器人的消息:LLM 答疑(限频全走环境变量:AI_MAX_PER_HOUR=每小时最多几次,**默认 6**;
    //    显式 0=不限;AI_QUOTA_HOURS=时间窗,默认 1h。配额落盘 gist 防冷启动失忆;被动回复不占主动消息配额)。
    // ★ issue #113:花钱那条路径(调 LLM_API_KEY + 往真实群发消息)额外要求**本次请求验签通过**。
    //   默认配置下未验签请求根本到不了这里(HTTP 层已 401);这一道是给「显式关掉验签的联调模式」兜底,
    //   确保那次显式放行不会变成匿名烧 key 的入口。
    if (isAt && CFG.llm.key && !verified) {
      console.warn('[webhook] 已跳过 LLM 答疑:本次请求未通过验签(即便处于显式放行的联调模式,也不替匿名流量花 LLM_API_KEY)')
    }
    if (isAt && CFG.llm.key && verified) {
      const confirm = recorded ? '已记录 ✅ 会归纳进下次群报\n\n' : ''
      try {
        const q = await botState()
        if (CFG.ai.maxPerHour > 0) {
          const winMs = Math.max(1, CFG.ai.quotaHours) * 3600e3
          const stamps = (q.aiReplyStamps || []).filter((t) => Date.now() - t < winMs)
          if (stamps.length >= CFG.ai.maxPerHour) {
            const waitMin = Math.max(1, Math.ceil((winMs - (Date.now() - stamps[0])) / 60000))
            await qqSend(confirm + `另外:我这段时间的答疑额度用完了(${CFG.ai.maxPerHour} 次/小时),约 ${waitMin} 分钟后恢复`).catch((e) => console.error('[webhook]', e.message))
            console.log('[webhook] LLM 配额内,已回复限频提示')
            return
          }
        }
        const reply = await llmReply(text || '(空消息)')
        await qqSend(confirm + reply, d.id) // 被动回复:带 msg_id,不占主动消息配额
        if (CFG.ai.maxPerHour > 0) {
          q.aiReplyStamps = ((q.aiReplyStamps || []).filter((t) => Date.now() - t < Math.max(1, CFG.ai.quotaHours) * 3600e3)).concat(Date.now())
          await saveBotState(q).catch(() => {})
        }
        console.log('[webhook] LLM 已回复:', clip(reply, 40))
      } catch (e) { lastError = 'llm: ' + e.message; console.error('[webhook] LLM 应答失败:', e.message) }
      return
    }
    if (!recorded) console.log('[webhook] 忽略:', clip(text, 30))
  }
}

// ---------- 定时班自触发(SCF 定时触发器 → workflow_dispatch) ----------
// GitHub 的 schedule 从未唤起过本仓库工作流(全仓库 schedule 运行 0 次)——由常驻 SCF 定时触发器
// 打本函数(POST body 带 Type:'Timer'),函数再调 workflow_dispatch 把日报班唤起来,到点必达。
//
// ★ issue #114:timer 入口的两道鉴权原本都能被请求载荷**短路**,现全部改为 fail-closed:
//   旧写法 `if (CFG.timer.secret && arg.get('key') !== CFG.timer.secret) …` —— TIMER_SECRET 未配时
//   整条件不成立,直接放行;POST 分支更是完全不查 key。后果:外部者可用 GH_DISPATCH_TOKEN 唤起
//   main 上带全套 secrets 的 workflow,而那条日报班每次成功运行都会把反馈 gist 覆写为 '\n'
//   ⇒ 一条匿名 HTTP 请求就能反复销毁群反馈数据。
//   现在:①TIMER_SECRET 未配 ⇒ 拒绝;②密钥缺失/不匹配 ⇒ 拒绝;③触发名缺失/不匹配 ⇒ 拒绝(载荷省略
//   TriggerName 不再等于"跳过校验")。三种拒绝都带人能读懂的原因 + 该改哪个环境变量。
const normTrigger = (x) => String(x || '').replace(/[-s]+/g, '_').toLowerCase()
// arg 形状:{ kind:'query', params:URLSearchParams, header } 或 { kind:'payload', payload, params, header }
function timerAuth(arg) {
  const secret = String(CFG.timer.secret || '')
  if (!secret) {
    return {
      ok: false, status: 403, code: 'timer_secret_unconfigured',
      error: '定时入口已关闭:云函数没有配置 TIMER_SECRET 环境变量。',
      hint: '这是 fail-closed 设计(未配密钥时该入口对所有人关闭)。请在云函数环境变量里配置 TIMER_SECRET,并让触发请求携带它:GET 用 ?timer=1&key=<TIMER_SECRET>、POST 用请求头 x-timer-secret: <TIMER_SECRET>,或在 body 里带 "key"/"timerSecret" 字段。',
    }
  }
  const given = arg.kind === 'query'
    ? (arg.params.get('key') || arg.header || '')
    : (arg.header || (arg.payload && (arg.payload.key || arg.payload.timerSecret || arg.payload['X-Timer-Secret'])) || '')
  if (!given || !timingSafeEq(given, secret)) {
    return {
      ok: false, status: 403, code: 'timer_secret_mismatch',
      error: (given ? '定时入口密钥不匹配。' : '定时入口缺少密钥。') + '(POST 分支旧实现完全不查 key,是 issue #114 的主缺口)',
      hint: '触发请求必须携带 TIMER_SECRET:GET ?timer=1&key=<TIMER_SECRET>;POST 请求头 x-timer-secret:<TIMER_SECRET> 或 body 字段 "key"/"timerSecret"。',
    }
  }
  const rawTn = arg.kind === 'payload'
    ? (arg.payload && (arg.payload.TriggerName || arg.payload.triggerName))
    : arg.params.get('trigger')
  const tn = normTrigger(rawTn)
  const want = normTrigger(CFG.timer.triggerName)
  if (want && tn !== want) {
    return {
      ok: false, status: 403, code: 'timer_trigger_mismatch',
      error: `定时入口触发名不匹配:收到 ${tn || '(请求未带 TriggerName)'},期望 ${want}。`,
      hint: '载荷里的 TriggerName 缺失**不再**等于跳过校验(旧实现的短路点之一)。若 SCF 定时触发器的触发名(或手动调用的 trigger 参数)与 TIMER_TRIGGER_NAME 不一致,请改成一致,或把 TIMER_TRIGGER_NAME 显式设成 ' + want + '。',
    }
  }
  return { ok: true }
}

async function handleTimer(arg) {
  try {
    // 二次校验(与 HTTP 层的准入同一套判据):即便入口被绕过,这里也不会用 GH_DISPATCH_TOKEN 去 dispatch。
    const auth = timerAuth(arg)
    if (!auth.ok) return { ok: false, dispatched: false, code: auth.code, reason: auth.error + ' ' + auth.hint }
    if (!CFG.timer.token) return { ok: false, dispatched: false, reason: 'GH_DISPATCH_TOKEN 未配置(需要 Actions 读写权限的 token)' }

    const st = await botState()
    const gapMs = Math.max(1, CFG.timer.minGapHours) * 3600e3
    if (st.lastDigestDispatchAt && Date.now() - st.lastDigestDispatchAt < gapMs) {
      return { ok: true, dispatched: false, reason: '距上次触发不足 ' + CFG.timer.minGapHours + 'h(防重,各班重试不会重发)' }
    }
    const r = await fetch(`https://api.github.com/repos/${CFG.repo}/actions/workflows/${CFG.timer.workflowFile}/dispatches`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${CFG.timer.token}`, 'User-Agent': 'qq-webhook' },
      body: JSON.stringify({ ref: 'main', inputs: { note: '', since_hours: '' } }), // since_hours 留空=自动接上次成功运行
    })
    if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error('dispatch ' + r.status + ' ' + b.slice(0, 140)) }
    st.lastDigestDispatchAt = Date.now()
    await saveBotState(st).catch(() => {})
    console.log('[timer] 已触发日报 workflow(', CFG.timer.workflowFile, ')')
    return { ok: true, dispatched: true, at: new Date().toISOString() }
  } catch (e) {
    lastError = 'timer: ' + ((e && e.message) || e)
    console.error('[webhook] timer 失败:', (e && e.message) || e)
    return { ok: false, error: String((e && e.message) || e) }
  }
}

// ---------- 拒绝响应(机器码 + 人话 + 该配哪个环境变量) ----------
// 方针「人看得懂」:拒绝时不能只回机器码。每个拒绝都带 code(机器可判)+ error(中文说明)+ hint(要改哪个 env)。
function deny(res, status, code, error, hint) {
  if (res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, code, error, hint, v: VERSION }, null, 2))
}
const tail4 = (s) => { const t = String(s == null ? '' : s); return t ? '…' + t.slice(-4) : '(未配置)' }
function timingSafeEq(a, b) {
  const A = Buffer.from(String(a == null ? '' : a)); const B = Buffer.from(String(b == null ? '' : b))
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B)
}
const rejects = { count: 0, lastCode: null, at: null, lastDetail: null }
function noteReject(code, detail) {
  rejects.count++
  rejects.lastCode = code
  rejects.at = new Date().toISOString()
  if (detail) rejects.lastDetail = clip(detail, 160)
}
const safeJson = (s) => { try { return JSON.parse(s) } catch { return null } }

// ★ 人用端点准入门(issue #115):?report= / ?diag= 必须持 ROUTE_TOKEN,**未配即 403**(门不存在 = 门关闭)。
//   旧实现是 `if (CFG.routeToken && !req.url.includes(routeToken)) 404` —— 没配 ROUTE_TOKEN 时这道门
//   根本不存在,于是匿名可读到群聊原文、LLM key 形状(长度+头3+尾4)、appId/gistId/ghToken 前缀,
//   `write=1` 还能匿名写 gist。
//   ★★ QQ 平台回调路径**不走**这道门:平台只把事件原样 POST 到登记的 URL,带不上自定义 token;
//      回调的身份由 Ed25519 验签负责(见文件末)。给回调加 token 要求 = 机器人直接失联。
function routeAuth(req, url) {
  const tok = String(CFG.routeToken || '')
  if (!tok) return { ok: false, code: 'route_token_unconfigured' }
  const given = String(req.headers['x-route-token'] || url.searchParams.get('token') || '')
  if (given && timingSafeEq(given, tok)) return { ok: true }
  // 兼容旧用法:旧实现只做 `req.url.includes(token)` 子串判定,老 URL 形如 ?diag=1&token=xxx 继续可用
  if (String(req.url || '').includes(tok)) return { ok: true, legacy: true }
  return { ok: false, code: 'route_token_mismatch' }
}
function routeDeny(res, endpoint, code) {
  noteReject(code)
  if (code === 'route_token_unconfigured') {
    return deny(res, 403, code,
      endpoint + ' 端点已关闭:云函数没有配置 ROUTE_TOKEN 环境变量。',
      '这是刻意设计的 fail-closed(未配凭据时对所有人关闭,以免匿名读到群聊原文与密钥形状)。请在云函数环境变量里配置 ROUTE_TOKEN 后重新部署,再用 ?token=<ROUTE_TOKEN> 或请求头 x-route-token 访问。')
  }
  return deny(res, 403, code,
    endpoint + ' 端点需要凭据:请求未携带匹配的 ROUTE_TOKEN。',
    '请在查询串里加 ?token=<ROUTE_TOKEN>,或加请求头 x-route-token: <ROUTE_TOKEN>。注意:QQ 平台回调路径不需要 token,它靠 Ed25519 验签。')
}

// ---------- HTTP 服务(Web 函数/任何 Node 宿主通用) ----------
const MAX_BODY_BYTES = envNum(process.env.MAX_BODY_BYTES, 1024 * 1024) // 入站 body 上限(issue #116)
const server = http.createServer((req, res) => {
  const chunks = []
  let received = 0
  let tooLarge = false
  req.on('data', (c) => {
    if (tooLarge) return
    received += c.length
    if (received > MAX_BODY_BYTES) {
      // issue #116:旧实现无界累积后再 Buffer.concat ⇒ 匿名大 body 先在内存里长大。超限即拒,不再读。
      tooLarge = true
      chunks.length = 0
      noteReject('body_too_large', 'bytes>' + MAX_BODY_BYTES)
      deny(res, 413, 'body_too_large',
        '入站请求体超过上限 ' + MAX_BODY_BYTES + ' 字节,已拒绝。',
        'QQ 回调报文只有几 KB;若确实要手工发大 body,再调 MAX_BODY_BYTES 环境变量。')
      return
    }
    chunks.push(c)
  })
  // 客户端中途断开(公网面上很常见:探测、超时取消、被 413 拒后仍继续写)会让 req 抛 error;
  // 没有监听者时 Node 会把它是当成未处理错误(可致函数实例崩溃)⇒ 这里显式吞掉,只当本次请求结束。
  req.on('error', () => { tooLarge = true })
  req.on('end', async () => {
    if (tooLarge) return
    const raw = Buffer.concat(chunks).toString('utf8')
    try {
      const url = new URL('http://x' + (req.url || '/'))
      // ---- ① 定时班自触发入口(SCF 定时触发器 POST Type:'Timer',或 GET ?timer=1&key=…&trigger=… 手动测试)----
      // 鉴权先做,失败一律 403 且**不** dispatch(旧实现先秒回 200 再校验,POST 分支甚至完全不查 key)。
      // 2026-09-13 的「先秒回受理、后台执行」保留:密钥/触发名校验是同步的,不占平台 3s 窗口。
      if (raw.includes('"Type":"Timer"') || (req.method === 'GET' && url.searchParams.get('timer') === '1')) {
        const header = String(req.headers['x-timer-secret'] || '')
        const arg = req.method === 'GET'
          ? { kind: 'query', params: url.searchParams, header }
          : { kind: 'payload', payload: safeJson(raw), params: url.searchParams, header }
        const auth = timerAuth(arg)
        if (!auth.ok) { noteReject(auth.code); return deny(res, auth.status, auth.code, auth.error, auth.hint) }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, accepted: true, v: VERSION, note: 'dispatching in background; 结果看 ?diag=1 的 rejects/lastError 与群消息' }))
        void handleTimer(arg).catch((e) => console.error('[webhook] timer async:', (e && e.message) || e))
        return
      }
      // ---- ② 人用端点:?report= / ?diag= 必须持 ROUTE_TOKEN(issue #115)----
      // 注:rawDebug 的采集点已从「请求一进来就采集」移到验签之后(见 ③),见 issue #116。
      // 按需报告:GET <url>?report=N&token=<ROUTE_TOKEN> → 最近 N 小时群反馈(items 原文;配了 LLM 且未 raw=1 时附 AI 归纳)
      if (req.method === 'GET' && req.url.includes('report=')) {
        // ★ issue #115:这里返回的是**群成员聊天原文** ⇒ 必须有凭据;未配 ROUTE_TOKEN 直接 403(门不存在=门关闭)。
        const gate = routeAuth(req, url)
        if (!gate.ok) return routeDeny(res, 'report', gate.code)
        const hours = Math.min(48, Math.max(1, Number((req.url.match(/report=(\d+)/) || [])[1]) || 12))
        const out = { window_hours: hours, total: 0, items: [], summary: null, v: VERSION }
        try {
          if (CFG.gistId) {
            const r0 = await gh(`/gists/${CFG.gistId}`)
            // 只读钉死的反馈文件(与 gistAppend/digest 同名);2026-09-13 前旧数据混在第一个文件里,不再兼容读取
            const content = r0.body.files[FEEDBACK_FILE]?.content || ''
            const cutoff = Date.now() - hours * 3600e3
            for (const line of content.split('\n')) {
              try {
                const o = JSON.parse(line)
                if (new Date(o.t).getTime() >= cutoff) out.items.push(o)
              } catch { /* 占位/坏行跳过 */ }
            }
          }
          out.total = out.items.length
          if (out.total && CFG.llm.key && !req.url.includes('raw=1')) {
            const text = out.items.map((o) => `- [${o.t}] ${o.u}: ${o.m}`).join('\n').slice(0, 20000)
            try {
              // ★ issue #115:密钥诊断只回**布尔**,不再回显长度 + 头 3 位 + 尾 4 位(旧实现足以让人压缩爆破空间,
              //   也直接暴露密钥格式是否正确)。base/model 是运维者自己的端点配置,保留以维持可排障性。
              const keyDiag = `key 已配置=${!!CFG.llm.key}${/\s/.test(CFG.llm.key) ? ', 含空白字符' : ''}${/^bearer /i.test(CFG.llm.key) ? ', 已含 Bearer 前缀' : ''}`
              const r = await fetch(`${CFG.llm.base}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.llm.key}` },
                body: JSON.stringify({
                  model: CFG.llm.model,
                  messages: [
                    { role: 'system', content: '你是 bug 分诊助手。下面是 QQ 群用户近期反馈的问题原文。输出两段:1)「问题清单」:合并同类,每条「• 标题 —— 细节(时间/人数)」;2)「修复优先级建议」:哪些最影响使用、可能原因猜测。纯文本共不超过 400 字,直接输出最终内容,禁止展示思考过程。' },
                    { role: 'user', content: text },
                  ],
                  max_tokens: 700,
                  temperature: 0.3,
                }),
              })
              const j = await r.json().catch(() => null)
              const raw0 = j?.choices?.[0]?.message?.content?.trim()
              if (!raw0) out.llmError = `HTTP ${r.status}(base=${CFG.llm.base}, model=${CFG.llm.model}, ${keyDiag}): ${clip(JSON.stringify(j), 240)}`
              if (raw0) {
                const kept = raw0.split('\n').map((l) => l.trim()).filter((l) => l && (/^[•\-\d]/.test(l) || /清单|优先级/.test(l)))
                out.summary = (kept.length ? kept : [clip(raw0, 400)]).join('\n')
              }
            } catch (e) { out.llmError = '归纳失败(请检查 LLM_API_BASE 或 LLM_BASE_URL/LLM_MODEL/LLM_API_KEY): ' + e.message }
          }
        } catch (e) { out.error = e.message }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(out, null, 2))
        return
      }
      // 自诊断:GET <url>?diag=1&token=<ROUTE_TOKEN> → 部署核对(版本 + 三个布尔)+ gist 连通性;加 write=1 顺带一次写入探针
      if (req.method === 'GET' && req.url.includes('diag=1')) {
        // ★ issue #115:diag 会回显配置标识、且 write=1 能写 gist ⇒ 与 report 同一道凭据门(未配 ROUTE_TOKEN 即 403)。
        const gate = routeAuth(req, url)
        if (!gate.ok) return routeDeny(res, 'diag', gate.code)
        const bool = (x) => !!x
        const diag = {
          v: VERSION, // ★ 部署核对的第 0 项:线上跑的到底是哪一版
          // ★ 方针「人看得懂」:一眼核对部署 —— 版本号 + 三个布尔(严格验签 / 原始调试 / 密钥已配)
          deployCheck: {
            严格验签: CFG.strictVerify,
            原始调试: RAW_DEBUG,
            密钥已配: bool(CFG.routeToken),
          },
          verdict: `部署核对 v=${VERSION} 严格验签=${CFG.strictVerify ? '开' : '关'} 原始调试=${RAW_DEBUG ? '开' : '关'} 密钥已配=${bool(CFG.routeToken) ? '是' : '否'}`,
          strictVerify: CFG.strictVerify,
          rawDebug: RAW_DEBUG,
          routeTokenConfigured: bool(CFG.routeToken),
          timerSecretConfigured: bool(CFG.timer.secret),
          ghDispatchTokenConfigured: bool(CFG.timer.token),
          insecureMode: CFG.allowInsecure, // 仅当 STRICT_VERIFY=0 且 ALLOW_INSECURE_VERIFY=1 时才是 true
          // ★ issue #115:身份标识只留**尾 4 位**(旧实现回显完整 appId 与 ghToken 前 14 字符),
          //   够判断"配没配对",不足以定位/复用凭据。
          identity: {
            appIdTail: tail4(CFG.appId),
            groupIdTail: tail4(CFG.groupId),
            gistIdTail: tail4(CFG.gistId),
          },
          llmEnabled: bool(CFG.llm.key),
          ai: { maxPerHour: CFG.ai.maxPerHour, quotaHours: CFG.ai.quotaHours, mentionLearned: bool(botMentionToken) },
          timer: { triggerName: CFG.timer.triggerName, hasDispatchToken: bool(CFG.timer.token), minGapHours: CFG.timer.minGapHours, secretConfigured: bool(CFG.timer.secret) },
          rejects: { count: rejects.count, lastCode: rejects.lastCode, at: rejects.at, lastDetail: rejects.lastDetail }, // 验签/密钥被拒次数(部署后用它判断"是否有匿名流量在敲门")
          lastError: lastError ? clip(lastError, 240) : null,
          triggers: CFG.triggers,
          keywords: CFG.keywords,
        }
        if (CFG.gistId) {
          try {
            const g = await gh(`/gists/${CFG.gistId}`)
            const f = g.ok ? Object.values(g.body.files || {})[0] : null
            diag.gistProbe = { status: g.status, ok: g.ok, file: f ? f.filename : null, bytes: f ? f.size : null }
          } catch (e) { diag.gistProbe = { err: e.message } }
        } else diag.gistProbe = { skipped: '未配置 GIST_ID' } // 没配就别发无意义的出站请求
        if (req.url.includes('write=1')) {
          try {
            await gistAppend(JSON.stringify({ t: new Date().toISOString(), u: 'DIAG', m: 'diag write probe' }))
            diag.writeProbe = 'ok(gist 已追加一行 DIAG 探针)'
          } catch (e) { diag.writeProbe = '失败: ' + e.message }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(diag, null, 2))
        return
      }
      // ---- ③ QQ 平台回调路径 ----
      // ★ 这条路径**不要求** ROUTE_TOKEN / TIMER_SECRET:QQ 平台只会按登记的 URL 原样 POST 事件
      //   (带 X-Signature-Ed25519 / X-Signature-Timestamp 头),带不上任何自定义 token。
      //   它的身份判定 = 下面的 Ed25519 验签;默认 STRICT_VERIFY=1,验签失败一律 401。
      //   ⚠️ 给下一个读者:不要给这条路径加 token 要求,平台无法配合,那等于让机器人失联。
      const payload = JSON.parse(raw || '{}')
      let verified = false
      if (payload.op === 13) {
        // URL 验证握手(op=13):平台校验的是我们的**应答签名**,响应内容自证身份,故不要求我们先验签。
        // 这条分支只回 plain_token + 签名,不碰群数据、不回显任何密钥。
      } else {
        const sigHex = String(req.headers['x-signature-ed25519'] || '')
        const ts = String(req.headers['x-signature-timestamp'] || '')
        let ok = false
        try { ok = !!sigHex && crypto.verify(null, Buffer.from(`${ts}${raw}`), KEYS.pub, Buffer.from(sigHex, 'hex')) } catch { /* 算法差异时告警 */ }
        verified = ok
        if (!ok && CFG.strictVerify) {
          // ★ issue #113:旧实现默认不严格 ⇒ 匿名请求只要把载荷事件名写成 GROUP_AT_MESSAGE_CREATE
          //   就能让函数用运维者的 LLM_API_KEY 生成回复(事件名取自载荷,谁都能自称是 @ 事件)。
          noteReject('signature_invalid', `no_sig=${!sigHex} ts=${!!ts}`)
          console.warn('[webhook] 验签失败,拒绝(STRICT_VERIFY 默认开)')
          return deny(res, 401, 'signature_invalid',
            '验签未通过:请求缺少 X-Signature-Ed25519 头,或签名与 QQ_APP_SECRET 派生的公钥不匹配。默认配置(STRICT_VERIFY=1)下一律拒绝。',
            '先确认云函数环境变量 QQ_APP_SECRET 与 QQ 开放平台的机器人密钥完全一致(勿多空格/换行)。只有本地联调才允许同时设 STRICT_VERIFY=0 与 ALLOW_INSECURE_VERIFY=1(那种模式下也不会替匿名流量花 LLM_API_KEY)。')
        }
        if (!ok) console.warn('[webhook] 验签未通过:已显式设 STRICT_VERIFY=0 + ALLOW_INSECURE_VERIFY=1,仅限本地联调')
      }
      // ★ issue #116:原始报文采集移到**验签之后**,且默认关(RAW_DEBUG=1 才开)。旧实现是
      //   "请求一进来就采集 + 默认开" ⇒ 任何匿名请求都能把全量入站报文(含群成员聊天文本)灌进共享 gist。
      if (verified && RAW_DEBUG) rawDebug(req, raw).catch(() => {})
      const out = await handleEvent(payload, verified)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (payload.op === 13) res.end(JSON.stringify(out || {})) // op=13 应答结构严格,不附加字段
      else res.end(JSON.stringify({ ...(out || {}), v: VERSION }))
    } catch (e) {
      console.error('[webhook] 处理异常:', e.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    }
  })
})
server.listen(CFG.port, () => console.log(`[webhook] 监听 :${CFG.port},触发词:`, CFG.triggers.join('/'), '| 关键词:', CFG.keywords.join('/')))
