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
  keywords: (process.env.FEEDBACK_KEYWORDS || '问题,bug,报错,error,异常,失效,崩溃,闪退,不能用,出错了,坏了,修复').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  routeToken: process.env.ROUTE_TOKEN || '',
  port: Number(process.env.PORT || 9000),
  strictVerify: process.env.STRICT_VERIFY === '1',
  llm: {
    key: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    base: (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    maxReply: Number(process.env.LLM_MAX_REPLY || 500),
  },
}
for (const k of ['appId', 'appSecret', 'groupId', 'ghToken']) {
  if (!CFG[k]) { console.error(`[webhook] 缺少环境变量 ${k}`); process.exit(1) }
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
        { role: 'system', content: '你是 QQ 群「dsh-auto-memory 交流群」的群助手 automemory。回答简短(通常不超过 150 字)、技术向、语气谦虚;关于本项目的问题如实回答,不确定就建议在群里说明情况。不要用 Markdown 标题,纯文本短段落。' },
        { role: 'user', content: userText },
      ],
      max_tokens: 400,
      temperature: 0.7,
    }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.choices?.[0]?.message?.content) throw new Error(`LLM 失败 ${r.status} ${JSON.stringify(j).slice(0, 160)}`)
  return j.choices[0].message.content.trim().slice(0, CFG.llm.maxReply)
}

// ---------- GitHub(Gist 收集) ----------
const gh = (p, opts = {}) =>
  fetch(`https://api.github.com${p}`, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${CFG.ghToken}`, 'User-Agent': 'qq-webhook', ...(opts.headers || {}) },
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }))

async function gistAppend(line) {
  const r0 = await gh(`/gists/${CFG.gistId}`)
  if (!r0.ok) throw new Error(`读 gist 失败 ${r0.status}`)
  const fname = Object.keys(r0.body.files || {})[0]
  if (!fname) throw new Error('gist 里没有文件')
  const prev = (r0.body.files[fname].content || '').split('\n').filter(Boolean)
  prev.push(line)
  while (prev.length > 400) prev.shift() // 只保留最近 400 条
  const r = await gh(`/gists/${CFG.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [fname]: { content: prev.join('\n') + '\n' } } }) })
  if (!r.ok) throw new Error(`写 gist 失败 ${r.status}`)
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
  if (payload.op === 0 && payload.t === 'GROUP_AT_MESSAGE_CREATE') {
    const d = payload.d || {}
    const id = d.id || `${d.timestamp}|${d.author?.openid}|${d.content}`
    if (seen.has(id)) return
    seen.add(id)
    if (seen.size > 500) seen.delete(seen.values().next().value)
    const text = String(d.content || '').replace(/<@!\d+>/g, '').trim()
    const lower = text.toLowerCase()
    const isAt = String(d.content || '').includes('@')

    // ① 问题收集:明确反馈词 或 问题关键词命中 → 存 gist(@ 的消息回一句已记录)
    const collected = CFG.triggers.find((w) => lower.includes(w.toLowerCase())) || CFG.keywords.find((w) => lower.includes(w))
    if (collected && CFG.gistId) {
      try {
        await gistAppend(JSON.stringify({ t: new Date().toISOString(), u: clip(d.author?.openid || '?', 10), w: collected, m: clip(text, 200) }))
        console.log('[webhook] 已收集:', clip(text, 50))
        if (isAt) await qqSend('已记录 ✅ 会归纳进下次群报', d.id).catch((e) => console.error('[webhook]', e.message))
      } catch (e) { console.error('[webhook] 收集失败:', e.message) }
      return
    }

    // ② 其他 @ 消息:LLM 聊天(配了 key 才启)
    if (isAt && CFG.llm.key) {
      try {
        const reply = await llmReply(text || '(空消息)')
        await qqSend(reply, d.id)
        console.log('[webhook] LLM 已回复:', clip(reply, 40))
      } catch (e) { console.error('[webhook] LLM 应答失败:', e.message) }
      return
    }
    console.log('[webhook] 忽略:', clip(text, 30))
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
      res.end(JSON.stringify(out || {}))
    } catch (e) {
      console.error('[webhook] 处理异常:', e.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    }
  })
})
server.listen(CFG.port, () => console.log(`[webhook] 监听 :${CFG.port},触发词:`, CFG.triggers.join('/'), '| 关键词:', CFG.keywords.join('/')))
