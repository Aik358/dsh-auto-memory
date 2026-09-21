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
 *          GIST_ID(收集文件的gist)/ REPO(备用)/
 *          TRIGGER(可选,明确反馈词)/ FEEDBACK_KEYWORDS(可选,问题关键词)/
 *          LLM_API_KEY / LLM_MODEL / LLM_BASE_URL / LLM_MAX_REPLY(均可选)
 *
 * ★ 2026-09-21 起（issue #113–#116）默认值全部改为 fail closed，**部署前必须先配好这几项**：
 *   ROUTE_TOKEN   —— 不再"可选"：`?report=` / `?diag=` / GET `?timer=1` 三类人用端点的凭据，
 *                    未配置 ⇒ 这些端点一律 403（旧实现是"未配置就对匿名开放"，会回群聊原文与密钥形状）
 *   TIMER_SECRET  —— 不再"可选"：SCF 定时触发器唤起日报班的共享密钥，未配置 ⇒ timer 一律拒绝
 *   STRICT_VERIFY —— 默认**开**（验签失败 401）；只有本地联调才显式设 0
 *   AI_MAX_PER_HOUR —— 默认 **6**；显式设 0 才是"不限额"
 *   RAW_DEBUG     —— 默认**关**；设 1 才把入站原始报文写进 gist，且采集点在验签之后
 */
const http = require('node:http')
const crypto = require('node:crypto')

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
  port: Number(process.env.PORT || 9000),
  // issue #113：验签默认**严格**（fail-closed）。旧默认 `=== '1'` ⇒ 不显式配置就不验签，
  // 而事件类型取自载荷 `payload.t`，任何打到本 URL 的人都能伪造 @ 事件触发 LLM 回复。
  // 需要放行（本地联调）时显式设 STRICT_VERIFY=0。
  strictVerify: process.env.STRICT_VERIFY !== '0',
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
    minGapHours: Number(process.env.TIMER_MIN_GAP_HOURS || 10),
  },
  // @ 答疑限频(2026-09-14 起全部走环境变量,改额度不用改代码):
  //   AI_MAX_PER_HOUR = 每小时最多答疑次数(**默认 6 次**;显式设 0 = 不限额,需明知代价);
  //   AI_QUOTA_HOURS = 时间窗(默认 1)。
  // issue #113：旧默认 0 = 不限额,与「验签默认关 + 事件名取自载荷」叠加后,公网 URL 即可以
  //   运维者的 LLM key 无上限刷调用。默认值改成有限值,把"不设防"变成需要显式声明的选择。
  ai: {
    maxPerHour: Number(process.env.AI_MAX_PER_HOUR === undefined || process.env.AI_MAX_PER_HOUR === '' ? 6 : process.env.AI_MAX_PER_HOUR),
    quotaHours: Number(process.env.AI_QUOTA_HOURS || 1),
  },
  // 本机器人在群内的 openid(严格判定「是否被 @」用)。它 ≠ /users/@me 的数字 uin,平台也不提供换算接口,
  // 因此作为身份常量内置(与 QQ_APP_ID 同性质);换群/换机器人时用环境变量 BOT_MENTION_ID 覆盖即可。
  // 实测取证(2026-09-14):@ 该 id 的消息全是对机器人提需求(@8FB1CC35 的则全是 @ 群主)。
  botMentionId: (process.env.BOT_MENTION_ID || '183DA99311014124CAB4E497F0AF5892').trim().toUpperCase(),
}
for (const k of ['appId', 'appSecret', 'groupId', 'ghToken']) {
  if (!CFG[k]) { console.error(`[webhook] 缺少环境变量 ${k}`); process.exit(1) }
}
const VERSION = 'webhook-secure-20260921a' // 部署核对标记:diag 端点与错误响应都会带它(20260921a=验签/额度/诊断端点凭据/timer 密钥全部改 fail closed,见 issue #113-#116)
const FEEDBACK_FILE = 'group-feedback.jsonl' // 反馈收集钉死文件名(digest 与 report 同读此名,清空时保留文件本身)
let lastError = null // 最近一次内部错误(diag 可见)
let botMentionToken = null // 从「@机器人+反馈词」消息里学习的机器人 mention 标识
// issue #116：RAW_DEBUG **默认关**。旧默认开且采集发生在验签之前 ⇒ 任何匿名请求都能把
// 完整入站报文（含群成员聊天文本）灌进共享 gist。需要排障时显式设 RAW_DEBUG=1，
// 且采集点已移到验签通过之后（见 http.createServer 内的顺序调整）。
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

async function handleEvent(payload) {
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

    // ③ @ 机器人的消息:LLM 答疑(限频全走环境变量:AI_MAX_PER_HOUR=每小时最多几次,**默认 6**;显式 0=不限;
    //    AI_QUOTA_HOURS=时间窗,默认 1h。配额落盘 gist 防冷启动失忆;被动回复不占主动消息配额)。
    if (isAt && CFG.llm.key) {
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
async function handleTimer(arg) {
  const viaQuery = typeof arg !== 'string'
  try {
    // issue #114：两道判据都不许被"缺省"短路。旧写法 `if (CFG.timer.secret && …)` 与
    // `if (CFG.timer.triggerName && tn && …)` 在 TIMER_SECRET 未配 / 载荷省略 TriggerName 时
    // **整条件不成立**⇒直接放行,任何外部者都能唤起主分支上带全套 secrets 的 workflow
    // (而日报班每次运行都会把反馈 gist 覆写为 '\n',即一条匿名请求即可反复销毁用户反馈)。
    const secret = String(CFG.timer.secret || '')
    if (!secret) return { ok: false, dispatched: false, reason: 'TIMER_SECRET 未配置 ⇒ 定时入口一律拒绝(fail closed)' }
    if (viaQuery) {
      if (arg.get('key') !== secret) return { ok: false, reason: 'bad key' }
    } else {
      // POST 分支同样必须持密钥:SCF 定时触发器的 body 里带 X-Timer-Secret 或 ?key=。
      const qkey = (String(arg).match(/[?&]key=([^&"\s]+)/) || [])[1]
      let ev = null
      try { ev = JSON.parse(arg) } catch (e) { ev = null }
      const bodyKey = ev && (ev['X-Timer-Secret'] || ev.timerSecret || ev.key)
      if (qkey !== secret && bodyKey !== secret) return { ok: false, reason: 'missing timer secret' }
      const norm = (x) => String(x || '').replace(/[-s]+/g, '_').toLowerCase()
      const tn = norm(ev && (ev.TriggerName || ev.triggerName))
      // 触发名缺失不再等于"跳过校验"：配了 TIMER_TRIGGER_NAME 就必须带对
      if (CFG.timer.triggerName && tn !== norm(CFG.timer.triggerName)) {
        return { ok: false, reason: 'trigger 不匹配: ' + (tn || '(载荷未带 TriggerName)') }
      }
    }
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

/**
 * 人用端点准入门（`?report=` / `?diag=` / timer 手动触发）—— issue #115。
 *
 * ★ fail-closed：未配置 `ROUTE_TOKEN` 时**拒绝**，而不是像旧实现那样"空 token ⇒ 门不存在"。
 * 旧行为下这两个端点匿名可读，返回的是**群成员聊天原文**（最多 400 条）、LLM key 的形状
 * （长度 + 头 3 + 尾 4）、完整 appId、gistId 与 ghToken 前 14 字符，且 `write=1` 可匿名触发 gist 写入。
 *
 * QQ 事件回调**不**走这道门：平台只往登记的 URL 上原样 POST，带不上自定义 token；
 * 那条路径的身份由 Ed25519 验签负责（`STRICT_VERIFY` 现已默认开）。
 */
function diagnosticsAuthorized(req) {
  const tok = String(CFG.routeToken || '')
  if (!tok) return false
  return String(req.url || '').includes(tok)
}

// ---------- HTTP 服务(Web 函数/任何 Node 宿主通用) ----------
const server = http.createServer((req, res) => {
  const chunks = []
  let received = 0
  // issue #116/#115 配套：请求体上限。旧实现无界累积后再 Buffer.concat，恶意大 body 会先在
  // 内存里长大（SCF 网关自带上限，故实际影响受限，但应用层也该有一道）。
  const MAX_BODY = 1024 * 1024
  req.on('data', (c) => {
    received += c.length
    if (received > MAX_BODY) { req.destroy(new Error('body too large')); return }
    chunks.push(c)
  })
  req.on('error', () => { try { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'body too large' })) } catch (e) {} })
  req.on('end', async () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    try {
      if (CFG.routeToken && !req.url.includes(CFG.routeToken)) { res.writeHead(404); res.end(); return }
      // 定时班自触发入口:SCF 定时触发器 POST body 带 Type:'Timer';另支持 GET ?timer=1&key=<TIMER_SECRET> 手动测试。
      // 2026-09-13:GitHub API 从大陆云上调用耗时不稳(实测 3s 平台同步窗被掐)——先秒回"受理",
      // 实际触发放后台执行(结果看 diag.lastError 与群消息;防重逻辑在任务内部,重复触发不会重发)。
      if (raw.includes('"Type":"Timer"') || (req.method === 'GET' && req.url.includes('timer=1'))) {
        const arg = req.method === 'GET' ? new URL('http://x' + req.url).searchParams : raw
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, accepted: true, note: 'dispatching in background; 结果看 diag.lastError 与群消息' }))
        void handleTimer(arg).catch((e) => console.error('[webhook] timer async:', (e && e.message) || e))
        return
      }
      // issue #116：rawDebug 采集**移到验签之后**（见本函数尾部）。旧位置在鉴权/验签之前，
      // 于是任何匿名请求都能把内容灌进共享 gist 的 group-raw-debug.txt。
      // 按需报告:GET <url>?report=N → 最近 N 小时群反馈(items 原文;配了 LLM 且未 raw=1 时附 AI 归纳)
      if (req.method === 'GET' && req.url.includes('report=')) {
        // issue #115：返回的是群成员聊天原文 ⇒ 必须有凭据，未配 ROUTE_TOKEN 直接拒绝
        if (!diagnosticsAuthorized(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'report 需要 ROUTE_TOKEN（未配置则该端点关闭）', v: VERSION })); return }
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
              // issue #115：只报**布尔**判据，不再回显密钥形状（旧实现给长度 + 头 3 位 + 尾 4 位，
              // 足以让拿到该响应的人压缩爆破空间并确认密钥格式）。
              const keyFlags = [/\s/.test(CFG.llm.key) ? '含空白字符' : '', /^bearer /i.test(CFG.llm.key) ? '已含 Bearer 前缀' : ''].filter(Boolean).join(', ') || '形状正常'
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
              if (!raw0) out.llmError = `HTTP ${r.status}(base=${CFG.llm.base}, model=${CFG.llm.model}, key ${keyFlags}): ${clip(JSON.stringify(j), 240)}`
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
      // 自诊断:GET <url>?diag=1 → 汇报线上代码版本、关键变量与 gist 连通性(值脱敏);加 write=1 顺带做一次写入探针
      if (req.method === 'GET' && req.url.includes('diag=1')) {
        // issue #115：diag 泄露身份标识且 write=1 可匿名触发写 gist ⇒ 同一道凭据门
        if (!diagnosticsAuthorized(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'diag 需要 ROUTE_TOKEN（未配置则该端点关闭）', v: VERSION })); return }
        const diag = {
          v: VERSION,
          lastError,
          // issue #115：身份标识一律脱敏到"够判断配没配对"的程度——完整 appId / gistId /
          // ghToken 前 14 字符都不该出现在一个可被外部读到的响应里。
          appIdShape: CFG.appId ? `已配置(尾 ${String(CFG.appId).slice(-4)})` : '(未配置)',
          groupIdShape: CFG.groupId ? `已配置(尾 ${String(CFG.groupId).slice(-4)})` : '(未配置)',
          gistIdShape: CFG.gistId ? `已配置(尾 ${String(CFG.gistId).slice(-4)})` : '(未配置)',
          ghTokenConfigured: !!CFG.ghToken,
          dispatchTokenConfigured: !!CFG.timer.token,
          triggers: CFG.triggers,
          keywords: CFG.keywords,
          llmEnabled: !!CFG.llm.key,
          ai: { maxPerHour: CFG.ai.maxPerHour, quotaHours: CFG.ai.quotaHours, mentionLearned: !!botMentionToken },
          timer: { triggerName: CFG.timer.triggerName, hasDispatchToken: !!CFG.timer.token, minGapHours: CFG.timer.minGapHours, secretConfigured: !!CFG.timer.secret },
          strictVerify: CFG.strictVerify, rawDebug: RAW_DEBUG,
        }
        try {
          const g = await gh(`/gists/${CFG.gistId}`)
          const f = g.ok ? Object.values(g.body.files || {})[0] : null
          diag.gistProbe = { status: g.status, ok: g.ok, file: f ? f.filename : null, bytes: f ? f.size : null }
        } catch (e) { diag.gistProbe = { err: e.message } }
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
      const payload = JSON.parse(raw || '{}')
      if (payload.op !== 13) {
        const sigHex = String(req.headers['x-signature-ed25519'] || '')
        const ts = String(req.headers['x-signature-timestamp'] || '')
        let ok = false
        try { ok = !!sigHex && crypto.verify(null, Buffer.from(`${ts}${raw}`), KEYS.pub, Buffer.from(sigHex, 'hex')) } catch { /* 算法差异时告警 */ }
        if (!ok && CFG.strictVerify) { console.warn('[webhook] 验签失败,严格模式拒绝'); res.writeHead(401); res.end('bad signature'); return }
        if (!ok) console.warn('[webhook] 验签未通过(STRICT_VERIFY=0 显式放行,仅限本地联调)')
        // issue #116：原始报文采集**必须在验签之后**。旧实现放在请求一进来就做（且默认开启），
        // 于是任何匿名流量都能把内容灌进共享 gist 的 group-raw-debug.txt。
        rawDebug(req, raw).catch(() => {})
      }
      const out = await handleEvent(payload)
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
