/**
 * QQ 机器人 Webhook 接收端(「耳朵」的云端版)
 *
 * 部署形态:
 *   - 腾讯云函数「Web 函数」(推荐,零设备零月租):Node.js 18/20,入口文件本文件,监听端口取环境变量 PORT(默认 9000)
 *   - 任何能常驻跑 Node >= 18 的地方(本机/VPS):node index.js
 *
 * 职责:接收 QQ 开放平台 HTTP 事件回调(op=13 URL 验证 + GROUP_AT_MESSAGE_CREATE)
 *   → 命中触发词(默认 反馈/问题/bug)→ 建 GitHub issue(group-report 标签)→ 群里回「收到 ✅」
 *
 * 环境变量(云函数控制台配置,严禁写进代码库):
 *   QQ_APP_ID / QQ_APP_SECRET / QQ_GROUP_OPENID   机器人凭据与目标群
 *   GH_TOKEN       细粒度 PAT,仅需 issues:write
 *   REPO           默认 Aik358/dsh-auto-memory
 *   TRIGGER        可选,逗号分隔,默认 反馈,问题,bug
 *   ROUTE_TOKEN    可选,回调 URL 里带一段随机路径防扫描(如 https://…/qqcb-xxxxx/)
 *   STRICT_VERIFY  设为 1 则验签失败直接拒绝(默认只告警不阻断,防止算法差异丢消息)
 *
 * 签名方案(官方文档):seed = AppSecret 自我拼接补足 32 字节 → 派生 Ed25519 密钥对;
 *   URL 验证(op=13):用私钥签 event_ts+plain_token,hex 回传;
 *   事件推送:用公钥验证 X-Signature-Ed25519(原文 = X-Signature-Timestamp + 原始 body)。
 */
const http = require('node:http')
const crypto = require('node:crypto')

const CFG = {
  appId: process.env.QQ_APP_ID,
  appSecret: process.env.QQ_APP_SECRET,
  groupId: process.env.QQ_GROUP_OPENID,
  ghToken: process.env.GH_TOKEN,
  repo: process.env.REPO || 'Aik358/dsh-auto-memory',
  triggers: (process.env.TRIGGER || '反馈,问题,bug').split(',').map((s) => s.trim()).filter(Boolean),
  routeToken: process.env.ROUTE_TOKEN || '',
  port: Number(process.env.PORT || 9000),
  strictVerify: process.env.STRICT_VERIFY === '1',
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
async function qqSend(text) {
  const r = await fetch(`https://api.sgroup.qq.com/v2/groups/${CFG.groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${await getQQToken()}` },
    body: JSON.stringify({ content: String(text).replace(/https?:\/\/\S+/g, '(链接略)'), msg_type: 0, msg_seq: (Date.now() % 1000) + 1 }),
  })
  const b = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`QQ 发送失败 ${r.status} ${JSON.stringify(b).slice(0, 160)}`)
  return b
}

// ---------- GitHub ----------
const gh = (p, opts = {}) =>
  fetch(`https://api.github.com${p}`, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${CFG.ghToken}`, 'User-Agent': 'qq-webhook', ...(opts.headers || {}) },
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }))

async function ensureLabel() {
  const r = await gh(`/repos/${CFG.repo}/labels/group-report`)
  if (r.status === 404) {
    await gh(`/repos/${CFG.repo}/labels`, { method: 'POST', body: JSON.stringify({ name: 'group-report', color: 'F9A825', description: '来自 QQ 群的用户反馈(群助手自动创建)' }) })
    console.log('[webhook] 已创建标签 group-report')
  }
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
    const hit = CFG.triggers.find((w) => text.toLowerCase().includes(w.toLowerCase()))
    if (!hit) { console.log('[webhook] 忽略:', clip(text, 30)); return }
    console.log('[webhook] 命中反馈:', clip(text, 60))
    const body = [
      '## QQ 群反馈(群助手自动建单)', '',
      `- 汇报人: ${clip(d.author?.openid || '匿名', 12)}(脱敏标识)`,
      `- 时间: ${when()}(北京)`, '',
      '**原文:**', '',
      ...String(d.content || '').split(/\r?\n/).map((l) => '> ' + l), '',
      '---', '',
      '处理状态自动同步:收到 → 正在处理 → 处理完毕(issue 评论 + QQ 群)。',
      '可把本 issue 分配给 Copilot(若开通)或自行认领。', '',
      '<sub>由 QQ Webhook 云端接收端自动创建</sub>',
    ].join('\n')
    await ensureLabel()
    const r = await gh(`/repos/${CFG.repo}/issues`, { method: 'POST', body: JSON.stringify({ title: `[群反馈] ${clip(text, 30)}`, body, labels: ['group-report'] }) })
    if (!r.ok) {
      console.error('[webhook] 建 issue 失败', r.status, JSON.stringify(r.body).slice(0, 200))
      await qqSend(`收到 ✅(建单通道抖了一下,管理员会人工补记)「${clip(text, 24)}」`).catch(() => {})
      return
    }
    console.log('[webhook] 已建 issue #' + r.body.number)
    await qqSend(`收到 ✅ 群反馈已建单 #${r.body.number}「${clip(text, 24)}」,处理进度会同步`).catch((e) => console.error('[webhook]', e.message))
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
server.listen(CFG.port, () => console.log(`[webhook] 监听 :${CFG.port},触发词:`, CFG.triggers.join('/')))
