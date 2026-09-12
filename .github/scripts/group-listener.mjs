/**
 * group-listener.mjs — 群反馈监听器(「耳朵」)
 * 跑在常开设备上(推荐:旧安卓手机 Termux;也可常开小主机)。零依赖,Node >= 21(需全局 WebSocket)。
 *
 * 职责:连 QQ 官方网关收群消息 → 命中触发词(默认 反馈/问题/bug)→ 在 GitHub 建结构化
 * issue(标签 group-report)→ 群里回「收到 ✅」。只出不进:不监任何端口,不用公网/穿透。
 *
 * 用法: node group-listener.mjs
 * 凭据放同目录 .env(严禁提交/上传):
 *   QQ_APP_ID=...            机器人 AppID
 *   QQ_APP_SECRET=...        机器人 AppSecret
 *   QQ_GROUP_OPENID=...      目标群 openid
 *   GH_TOKEN=github_pat_...  细粒度 PAT,仅 issues:write
 *   REPO=Aik358/dsh-auto-memory
 *   TRIGGER=反馈,问题,bug    可选,逗号分隔
 * 注意:同一机器人同时只能有一个网关连接——本脚本运行时,WorkBuddy 绑定/抓 openid 工具请勿同时连。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(DIR, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const REPO = process.env.REPO || 'Aik358/dsh-auto-memory'
const TRIGGERS = (process.env.TRIGGER || '反馈,问题,bug').split(',').map((s) => s.trim()).filter(Boolean)
const STATE = process.env.STATE_FILE || path.join(DIR, 'listener-state.json')
for (const k of ['QQ_APP_ID', 'QQ_APP_SECRET', 'QQ_GROUP_OPENID', 'GH_TOKEN']) {
  if (!process.env[k]) { console.error(`[listener] 缺少 ${k}(.env 或环境变量)`); process.exit(1) }
}

const seen = new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).seen || [] : [])
const saveSeen = () => { try { writeFileSync(STATE, JSON.stringify({ seen: [...seen].slice(-500) })) } catch { /* 状态丢失可接受 */ } }
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
const now = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())

// ---------- QQ ----------
let token = null
let tokenAt = 0
async function qqToken(force = false) {
  if (!token || force || Date.now() - tokenAt > 30 * 60e3) {
    const r = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: process.env.QQ_APP_ID, clientSecret: process.env.QQ_APP_SECRET }),
    }).then((r) => r.json())
    if (!r?.access_token) throw new Error('取 token 失败: ' + JSON.stringify(r).slice(0, 120))
    token = r.access_token
    tokenAt = Date.now()
  }
  return token
}
async function qqSend(text) {
  const base = (process.env.QQ_API_BASE || 'https://api.sgroup.qq.com').replace(/\/$/, '')
  const r = await fetch(`${base}/v2/groups/${process.env.QQ_GROUP_OPENID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${await qqToken()}` },
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
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'group-listener', ...(opts.headers || {}) },
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }))

async function ensureLabel() {
  const r = await gh(`/repos/${REPO}/labels/group-report`)
  if (r.status === 404) {
    await gh(`/repos/${REPO}/labels`, { method: 'POST', body: JSON.stringify({ name: 'group-report', color: 'F9A825', description: '来自 QQ 群的用户反馈(群助手自动创建)' }) })
    console.log('[listener] 已创建标签 group-report')
  }
}

async function handleGroupMessage(d) {
  const id = d.id || `${d.timestamp}|${d.author?.openid}|${d.content}`
  if (seen.has(id)) return
  seen.add(id); saveSeen()
  const text = String(d.content || '').replace(/<@!\d+>/g, '').trim()
  const lower = text.toLowerCase()
  const hit = TRIGGERS.find((w) => lower.includes(w.toLowerCase()))
  if (!hit) { console.log('[listener] 忽略:', clip(text, 30)); return }
  console.log('[listener] 命中反馈:', clip(text, 60))
  const title = `[群反馈] ${clip(text, 30)}`
  const body = [
    '## QQ 群反馈(群助手自动建单)', '',
    `- 汇报人: ${clip(d.author?.openid || '匿名', 12)}(脱敏标识)`,
    `- 时间: ${now()}(北京)`, '',
    '**原文:**', '',
    ...String(d.content || '').split(/\r?\n/).map((l) => '> ' + l), '',
    '---', '',
    '处理状态自动同步:收到 → 正在处理 → 处理完毕(issue 评论 + QQ 群)。',
    '把修理工交给 Copilot:将本 issue 分配给 **@copilot**。', '',
    '<sub>由 group-listener 自动创建</sub>',
  ].join('\n')
  await ensureLabel()
  const r = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['group-report'] }) })
  if (!r.ok) {
    console.error('[listener] 建 issue 失败', r.status, JSON.stringify(r.body).slice(0, 200))
    await qqSend(`收到 ✅(建单通道抖了一下,管理员会人工补记)「${clip(text, 24)}」`).catch(() => {})
    return
  }
  console.log('[listener] 已建 issue #' + r.body.number)
  await qqSend(`收到 ✅ 群反馈已建单 #${r.body.number}「${clip(text, 24)}」,处理进度会同步`).catch((e) => console.error('[listener]', e.message))
}

// ---------- 网关 ----------
let attempt = 0
async function connect() {
  await qqToken(true)
  console.log('[listener] 连接网关…(第', attempt + 1, '次)')
  const ws = new WebSocket('wss://api.sgroup.qq.com/websocket')
  let lastSeq = null
  let hbTimer = null
  ws.onmessage = (ev) => {
    let p; try { p = JSON.parse(ev.data) } catch { return }
    if (p.s) lastSeq = p.s
    if (p.op === 10) {
      ws.send(JSON.stringify({ op: 2, d: { token: `QQBot ${token}`, intents: 1 << 25, shard: [0, 1] } }))
      clearInterval(hbTimer)
      hbTimer = setInterval(() => { try { ws.send(JSON.stringify({ op: 1, d: lastSeq })) } catch { /* 断线由 onclose 接管 */ } }, Math.max(5, (p.d?.heartbeat_interval || 30000) - 3000))
      attempt = 0
      console.log('[listener] 已上线,监听触发词:', TRIGGERS.join('/'))
    } else if (p.op === 0 && p.t === 'GROUP_AT_MESSAGE_CREATE') {
      handleGroupMessage(p.d).catch((e) => console.error('[listener] 处理失败:', e.message))
    } else if (p.op === 11) {
      console.log('[listener] 心跳回执正常')
    }
  }
  ws.onclose = () => {
    clearInterval(hbTimer)
    attempt += 1
    const wait = Math.min(60000, 3000 * attempt)
    console.log(`[listener] 连接断开,${Math.round(wait / 1000)}s 后重连`)
    setTimeout(() => connect().catch((e) => console.error('[listener] 重连失败:', e.message)), wait)
  }
  ws.onerror = () => { try { ws.close() } catch { /* 忽略 */ } }
}
connect().catch((e) => { console.error('[listener] 启动失败:', e.message); process.exit(1) })
