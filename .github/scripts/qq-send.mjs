/**
 * qq-send.mjs — QQ 群文本消息发送共享模块(零依赖,Node>=18)
 * 用法: import { sendGroupText } from './qq-send.mjs'
 *   await sendGroupText('收到 ✅ …')
 * 环境变量: QQ_APP_ID / QQ_APP_SECRET / QQ_GROUP_OPENID / QQ_API_BASE(可选,默认正式环境)
 * 说明: QQ 群消息禁止包含 URL,这里统一把链接剥成「(链接略)」。
 */
export async function getAccessToken() {
  const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: process.env.QQ_APP_ID, clientSecret: process.env.QQ_APP_SECRET }),
  }).then((r) => r.json())
  if (!res?.access_token) throw new Error('取 access_token 失败: ' + JSON.stringify(res).slice(0, 200))
  return res.access_token
}

let seq = 1
export async function sendGroupText(text) {
  const token = await getAccessToken()
  const base = (process.env.QQ_API_BASE || 'https://api.sgroup.qq.com').replace(/\/$/, '')
  const res = await fetch(`${base}/v2/groups/${process.env.QQ_GROUP_OPENID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
    body: JSON.stringify({
      content: String(text).replace(/https?:\/\/\S+/g, '(链接略)'),
      msg_type: 0,
      msg_seq: seq++,
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`QQ 发送失败 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 240)}`)
  return body
}
