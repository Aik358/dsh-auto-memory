#!/usr/bin/env node
/**
 * qq-capture-openid.mjs — 一次性工具:抓取 QQ 群的 group_openid。
 *
 * 背景:QQ 官方机器人发群消息需要 group_openid,但它只随「群里有人 @机器人」的事件下发,
 * 开放平台控制台不直接展示。本脚本连一次官方 WebSocket 网关监听群消息事件:
 *   1. 在群里发任意一条「@机器人 你好」
 *   2. 脚本打印 group_openid(和消息 openid),拿去配 GitHub secrets 即可
 *
 * 用法(本机,Node ≥ 21):
 *   QQ_APP_ID=xxx QQ_APP_SECRET=xxx node .github/scripts/qq-capture-openid.mjs
 * 也可传参:node qq-capture-openid.mjs <APP_ID> <APP_SECRET>
 * 监听最多 180 秒,Ctrl+C 退出。
 */
import process from 'node:process'

const APP_ID = process.argv[2] || process.env.QQ_APP_ID
const APP_SECRET = process.argv[3] || process.env.QQ_APP_SECRET
if (!APP_ID || !APP_SECRET) {
  console.error('用法:QQ_APP_ID=xxx QQ_APP_SECRET=xxx node qq-capture-openid.mjs(或 <APP_ID> <APP_SECRET> 传参)')
  process.exit(1)
}

const { res, json } = await fetch('https://bots.qq.com/app/getAppAccessToken', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ appId: APP_ID, clientSecret: APP_SECRET }),
}).then(async (r) => ({ res: r, json: await r.json().catch(() => null) }))
const token = json?.access_token
if (!token) {
  console.error('取 access_token 失败:', JSON.stringify(json))
  process.exit(1)
}
console.log('[capture] access_token OK,连接网关…')

const ws = new WebSocket('wss://api.sgroup.qq.com/websocket')
let seq = null
let gotIt = false

ws.onmessage = (ev) => {
  let p
  try { p = JSON.parse(ev.data) } catch { return }
  if (p.op === 10) {
    seq = p.d.heartbeat_interval || 30000
    ws.send(JSON.stringify({ op: 2, d: { token: `QQBot ${token}`, intents: 1 << 25, shard: [0, 1] } }))
    setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq ?? null })), Math.max(5, seq - 3000))
    console.log('[capture] 已上线,请现在到群里发一条「@机器人 任意内容」…')
  } else if (p.op === 0 && p.t === 'GROUP_AT_MESSAGE_CREATE') {
    gotIt = true
    console.log('\n✅ 抓到了!')
    console.log('   group_openid =', p.d.group_openid)
    console.log('   (发送者 openid =', p.d.author?.openid + ')')
    console.log('\n把 group_openid 配到仓库 Settings → Secrets → QQ_GROUP_OPENID 即可。')
    process.exit(0)
  }
}
ws.onclose = () => { if (!gotIt) { console.error('[capture] 连接关闭'); process.exit(1) } }
ws.onerror = (e) => { console.error('[capture] 连接错误:', e.message || e); process.exit(1) }
setTimeout(() => { if (!gotIt) { console.error('[capture] 180 秒内没等到群消息事件,退出。重试时确认机器人已在群里。'); process.exit(2) } }, 180000)
