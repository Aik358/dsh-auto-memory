/**
 * report-sync.mjs — 群反馈状态镜像(Actions 用):GitHub issue/PR 状态 ↔ QQ 群一句话播报
 * 由 group-report-status.yml 触发,读 GITHUB_EVENT_PATH 判定状态:
 *   收到 ✅      群反馈 issue 建立(opened / 被打上 group-report 标签)
 *   正在处理 🔧  PR 开出且引用了带 group-report 标签的 issue(fixes/closes/#N 均可)
 *   处理完毕 ✅  群反馈 issue 关闭(PR 合并自动关单也算)
 * 双端同步:GitHub 侧在 issue 下留结构化评论,QQ 侧只发用户口吻的一句话。
 */
import { readFileSync } from 'node:fs'
import { sendGroupText } from './qq-send.mjs'

const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const REPO = process.env.GITHUB_REPOSITORY
const TOKEN = process.env.GITHUB_TOKEN
const LABEL = 'group-report'

const gh = (path, opts = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'report-sync', ...(opts.headers || {}) },
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }))

const hasLabel = (issue) => (issue.labels || []).some((l) => (l.name || '') === LABEL)
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
const when = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
const FOOT = '<sub>群助手自动同步 · QQ 群内已推送同款状态</sub>'

async function comment(issueNumber, body) {
  const r = await gh(`/repos/${REPO}/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  if (!r.ok) console.warn(`[sync] issue #${issueNumber} 评论失败 HTTP ${r.status}`)
}

const qqEnabled = !!(process.env.QQ_APP_ID && process.env.QQ_GROUP_OPENID)
async function qq(text) {
  console.log('[sync] QQ 播报:', text)
  if (!qqEnabled) return console.log('[sync] QQ secrets 未配置,跳过播报')
  try { await sendGroupText(text) } catch (e) { console.error('[sync] QQ 发送失败:', e.message); process.exitCode = 1 }
}

if (ev.event_name === 'issues') {
  const issue = ev.issue
  if (!hasLabel(issue)) { console.log('[sync] 非 group-report issue,忽略'); process.exit(0) }
  const t = clip(issue.title, 40)
  if (ev.action === 'closed') {
    await comment(issue.number, `## 处理完毕 ✅\n\n该群反馈已于 ${when()} 关闭,处理结果见关联提交与发布版本。QQ 群内已同步推送「处理完毕」。\n\n${FOOT}`)
    await qq(`处理完毕 ✅ 群反馈 #${issue.number}「${t}」已解决`)
  } else {
    await comment(issue.number, `## 收到 ✅\n\n已确认收到该群反馈(${when()})。处理进度将自动同步到本 issue 与 QQ 群:收到 → 正在处理 → 处理完毕。\n\n要把修理工交给 Copilot:把本 issue 分配给 **@copilot** 即可,它开工开 PR 后这里会出现「正在处理」。\n\n${FOOT}`)
    await qq(`收到 ✅ 群反馈已建单 #${issue.number}「${t}」,处理进度会同步`)
  }
} else if (ev.event_name === 'pull_request') {
  const pr = ev.pull_request
  const refs = [...new Set([...`${pr.title}\n${pr.body || ''}`.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))]
  if (!refs.length) { console.log('[sync] PR 未引用 issue,忽略'); process.exit(0) }
  for (const n of refs) {
    const r = await gh(`/repos/${REPO}/issues/${n}`)
    if (!r.ok || !r.body || !hasLabel(r.body)) continue
    await comment(n, `## 正在处理 🔧\n\n关联 PR #${pr.number}「${clip(pr.title, 50)}」已开工(${when()})。QQ 群内已同步推送。\n\n${FOOT}`)
    await qq(`正在处理 🔧 群反馈 #${n} → PR #${pr.number}「${clip(pr.title, 36)}」`)
  }
} else {
  console.log('[sync] 未处理的事件:', ev.event_name, ev.action)
}
