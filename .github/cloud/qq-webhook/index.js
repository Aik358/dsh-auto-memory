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
 *          GIST_ID(收集文件的 gist)/ REPO(备用)/ ROUTE_TOKEN(可选)/ STRICT_VERIFY(可选)/
 *          TRIGGER(可选,明确反馈词)/ FEEDBACK_KEYWORDS(可选,问题关键词)/
 *          LLM_API_KEY / LLM_MODEL / LLM_BASE_URL / LLM_MAX_REPLY(均可选)
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
  strictVerify: process.env.STRICT_VERIFY === '1',
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
  //   AI_MAX_PER_HOUR = 每小时最多答疑次数(不配或 0 = 不限额);AI_QUOTA_HOURS = 时间窗(默认 1)。
  ai: {
    maxPerHour: Number(process.env.AI_MAX_PER_HOUR || 0),
    quotaHours: Number(process.env.AI_QUOTA_HOURS || 1),
  },
}
for (const k of ['appId', 'appSecret', 'groupId', 'ghToken']) {
  if (!CFG[k]) { console.error(`[webhook] 缺少环境变量 ${k}`); process.exit(1) }
}
const VERSION = 'webhook-gist-20260913k' // 部署核对标记:diag 端点与错误响应都会带它(20260913h=@ 答疑优先于已记录/LLM 空应答外显错误体)
const FEEDBACK_FILE = 'group-feedback.jsonl' // 反馈收集钉死文件名(digest 与 report 同读此名,清空时保留文件本身)
let lastError = null // 最近一次内部错误(diag 可见)
let botMentionToken = null // 从「@机器人+反馈词」消息里学习的机器人 mention 标识
const RAW_DEBUG = (process.env.RAW_DEBUG || '1') !== '0' // 抓原始报文进 gist 的 group-raw-debug.txt(排查完可关)

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

// ---------- LLM 应答(可选):非反馈类 @ 消息交给大模型,被动回复 ----------
async function llmReply(userText) {
  const r = await fetch(`${CFG.llm.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.llm.key}` },
    body: JSON.stringify({
      model: CFG.llm.model,
      messages: [
        { role: 'system', content: '你是 QQ 群「dsh-auto-memory 交流群」的群助手 automemory。回答简短(通常不超过 150 字)、技术向、语气谦虚;关于本项目的问题如实回答,不确定就建议在群里说明情况。不要用 Markdown 标题,纯文本短段落。直接输出面向用户的最终回答,禁止输出任何思考过程/草稿/自我分析。' },
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
    const mentions = [...String(d.content || '').matchAll(/<@!?([0-9A-Fa-f]+)>/g)].map((m) => m[1])
    const isAt = mentions.length > 0
    if (isAt && !botMentionToken) botMentionToken = mentions[0] // 学习机器人自己的 mention 标识(任何 @ 都学,不限于反馈词)
    const text = String(d.content || '').replace(/<@!?[0-9A-Fa-f]+>/g, '').trim()
    const lower = text.toLowerCase()

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

    // ② @ 机器人的消息:LLM 答疑(限频全走环境变量:AI_MAX_PER_HOUR=每小时最多几次,不配=不限;
    //    AI_QUOTA_HOURS=时间窗,默认 1h。配额落盘 gist 防冷启动失忆;被动回复不占主动消息配额)。
    if (isAt && botMentionToken && mentions.includes(botMentionToken) && CFG.llm.key) {
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
    if (viaQuery && CFG.timer.secret && arg.get('key') !== CFG.timer.secret) return { ok: false, reason: 'bad key' }
    if (!viaQuery) {
      try { const ev = JSON.parse(arg); const norm = (x) => String(x || '').replace(/[-s]+/g, '_').toLowerCase(); const tn = norm(ev.TriggerName || ev.triggerName || ''); if (CFG.timer.triggerName && tn && tn !== norm(CFG.timer.triggerName)) return { ok: false, reason: 'trigger 不匹配: ' + tn } } catch (e) {}
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

// ---------- HTTP 服务(Web 函数/任何 Node 宿主通用) ----------
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
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
      rawDebug(req, raw).catch(() => {})
      // 按需报告:GET <url>?report=N → 最近 N 小时群反馈(items 原文;配了 LLM 且未 raw=1 时附 AI 归纳)
      if (req.method === 'GET' && req.url.includes('report=')) {
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
              const keyShape = `len=${CFG.llm.key.length}, tail=${CFG.llm.key.slice(-4)}, head=${CFG.llm.key.slice(0, 3)}${/\s/.test(CFG.llm.key) ? ', 含空白字符!' : ''}${/^bearer /i.test(CFG.llm.key) ? ', 已含 Bearer 前缀!' : ''}`
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
              if (!raw0) out.llmError = `HTTP ${r.status}(base=${CFG.llm.base}, model=${CFG.llm.model}, key ${keyShape}): ${clip(JSON.stringify(j), 240)}`
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
        const diag = {
          v: VERSION,
          lastError,
          appId: CFG.appId,
          groupId: CFG.groupId.slice(-6),
          gistId: CFG.gistId || '(未配置)',
          ghTokenPrefix: CFG.ghToken.slice(0, 14) + '…',
          triggers: CFG.triggers,
          keywords: CFG.keywords,
          llmEnabled: !!CFG.llm.key,
          ai: { maxPerHour: CFG.ai.maxPerHour, quotaHours: CFG.ai.quotaHours, mentionLearned: !!botMentionToken },
          timer: { triggerName: CFG.timer.triggerName, hasDispatchToken: !!CFG.timer.token, minGapHours: CFG.timer.minGapHours },
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
        if (!ok) console.warn('[webhook] 验签未通过(非严格模式,继续处理)')
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
