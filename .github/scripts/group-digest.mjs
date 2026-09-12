#!/usr/bin/env node
/**
 * group-digest.mjs — 群同步日报:统计 GitHub issues/PRs/commits/release,生成中文摘要并投递到群。
 *
 * 由 .github/workflows/group-digest.yml 在 GitHub Actions 上定时调用(北京时间每天 12:00 / 21:00),
 * 电脑关机也能跑;也可本机手动执行:node .github/scripts/group-digest.mjs --print
 *
 * 统计窗口 = 上一次「成功」的 workflow run 时间 → 现在(错过一次就并到下次,封顶 MAX_WINDOW_HOURS)。
 * 通道由 DIGEST_CHANNEL 选择,全部零依赖(fetch 全局),发不出去时报错退出(本次 run 记为失败)。
 *
 * 环境变量:
 *   通用       GITHUB_TOKEN(可选,匿名也能读公开仓库)/ REPO / DIGEST_CHANNEL / FEEDBACK_URL /
 *              DIGEST_NOTES_PATH / EXTRA_NOTE / SINCE_HOURS / MAX_WINDOW_HOURS(默认168)
 *   qq_official  QQ_APP_ID / QQ_APP_SECRET / QQ_GROUP_OPENID / QQ_API_BASE(默认 https://api.sgroup.qq.com)
 *              注意:QQ 群消息禁止包含 URL,本通道会自动把链接替换成「(链接略)」。
 *   napcat     NAPCAT_HTTP_URL(如 http://1.2.3.4:3000)/ NAPCAT_TOKEN(可选)/ NAPCAT_GROUP_ID
 *   telegram   TG_BOT_TOKEN / TG_CHAT_ID
 *   discord    DISCORD_WEBHOOK_URL
 *   feishu     FEISHU_WEBHOOK_URL
 *   dingtalk   DINGTALK_WEBHOOK_URL
 *   generic    GENERIC_WEBHOOK_URL(POST JSON {text})
 *   none       只生成打印,不投递(默认)
 * CLI: --print 只打印不投递;--no-send 同 --print
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const env = process.env
const REPO = env.REPO || env.GITHUB_REPOSITORY || 'Aik358/dsh-auto-memory'
const TOKEN = env.GITHUB_TOKEN || env.GH_TOKEN || ''
const CHANNEL = (env.DIGEST_CHANNEL || 'none').trim().toLowerCase()
const NO_SEND = process.argv.includes('--print') || process.argv.includes('--no-send')
const WORKFLOW_FILE = env.WORKFLOW_FILE || 'group-digest.yml'
const NPM_PACKAGE = env.NPM_PACKAGE || '@a9i5k4/dsh-auto-memory'

// ---------- 小工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const dayFmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const fmtDT = (d) => dt.format(d)
const fmtDay = (d) => dayFmt.format(d)
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 保留 null */ }
  return { res, json, text }
}

async function gh(p) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'group-digest' }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  const { res, json } = await fetchJson(`https://api.github.com${p}`, { headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API ${p} → HTTP ${res.status}`)
  return json
}

// ---------- 统计窗口:上次成功 run → 现在 ----------
async function prevSuccessStart() {
  try {
    const runs = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&per_page=1`)
    return runs?.workflow_runs?.[0]?.run_started_at || null
  } catch (e) { console.warn('[digest] 取上次成功 run 失败(用默认窗口):', e.message); return null }
}

const now = new Date()
let capped = false
let sinceIso
const sinceHoursEnv = Number(env.SINCE_HOURS || 0)
if (sinceHoursEnv > 0) {
  sinceIso = new Date(now.getTime() - sinceHoursEnv * 3600e3).toISOString()
} else {
  const prev = await prevSuccessStart()
  sinceIso = prev || new Date(now.getTime() - 12 * 3600e3).toISOString()
}
const maxH = Number(env.MAX_WINDOW_HOURS || 168)
if (now.getTime() - new Date(sinceIso).getTime() > maxH * 3600e3) {
  sinceIso = new Date(now.getTime() - maxH * 3600e3).toISOString()
  capped = true
}
const windowH = (now.getTime() - new Date(sinceIso).getTime()) / 3600e3
console.log(`[digest] 窗口:${sinceIso} → ${now.toISOString()}(${windowH.toFixed(1)}h)`)

// ---------- 数据采集(每段独立容错,失败即跳过该段) ----------
async function collect() {
  const out = {}
  const tasks = {
    repo: gh(`/repos/${REPO}`),
    newIssues: gh(`/repos/${REPO}/issues?state=all&sort=created&direction=desc&per_page=60`),
    closedIssues: gh(`/repos/${REPO}/issues?state=closed&sort=updated&direction=desc&per_page=60`),
    openIssues: gh(`/repos/${REPO}/issues?state=open&per_page=60`),
    newPRs: gh(`/repos/${REPO}/pulls?state=all&sort=created&direction=desc&per_page=40`),
    mergedPRs: gh(`/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=40`),
    openPRs: gh(`/repos/${REPO}/pulls?state=open&per_page=20`),
    commits: gh(`/repos/${REPO}/commits?since=${encodeURIComponent(sinceIso)}&per_page=30`),
    release: gh(`/repos/${REPO}/releases/latest`),
  }
  for (const [k, p] of Object.entries(tasks)) {
    try { out[k] = await p } catch (e) { console.warn(`[digest] ${k} 采集失败:`, e.message); out[k] = null }
    await sleep(120)
  }
  const isIssue = (x) => x && !x.pull_request
  out.newIssues = (out.newIssues || []).filter(isIssue).filter((x) => x.created_at >= sinceIso)
  out.closedIssues = (out.closedIssues || []).filter(isIssue).filter((x) => x.closed_at >= sinceIso)
  const open = (out.openIssues || []).filter(isIssue)
  out.openBugs = open.filter((x) => x.labels?.some((l) => /bug/i.test(l.name || '')) || /^\[?bug/i.test(x.title || ''))
  out.openOthers = open.filter((x) => !out.openBugs.includes(x))
  out.newPRs = (out.newPRs || []).filter((x) => x.created_at >= sinceIso)
  out.mergedPRs = (out.mergedPRs || []).filter((x) => x.merged_at && x.merged_at >= sinceIso)
  out.commits = out.commits || []
  out.release = out.release && out.release.published_at && out.release.published_at >= sinceIso ? out.release : null
  out.npmVersion = null
  try {
    const { json } = await fetchJson(`https://registry.npmjs.org/${NPM_PACKAGE.replace('/', '%2F')}/latest`)
    out.npmVersion = json?.version || null
  } catch (e) { console.warn('[digest] npm 版本采集失败:', e.message) }
  out.groupFeedbackLines = null
  if (env.FEEDBACK_GIST_ID && env.FEEDBACK_GH_PAT) {
    try {
      const r = await fetch(`https://api.github.com/gists/${env.FEEDBACK_GIST_ID}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.FEEDBACK_GH_PAT}`, 'User-Agent': 'group-digest' } })
      const j = await r.json().catch(() => null)
      const fname = Object.keys(j?.files || {})[0]
      const content = (j?.files?.[fname]?.content || '').trim()
      if (content) {
        out.groupFeedbackLines = content.split('\n').filter(Boolean).slice(-120)
        await fetch(`https://api.github.com/gists/${env.FEEDBACK_GIST_ID}`, {
          method: 'PATCH',
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.FEEDBACK_GH_PAT}`, 'User-Agent': 'group-digest' },
          body: JSON.stringify({ files: { [fname]: { content: '' } } }),
        })
        console.log(`[digest] 群反馈原始消息 ${out.groupFeedbackLines.length} 条已取出(gist 已清空)`)
      }
    } catch (e) { console.warn('[digest] 群反馈 gist 读取失败(忽略):', e.message) }
  }
  return out
}

// ---------- 人工备注(.github/digest/NOTES.md,#/<!-- 开头的行视为注释) ----------
function loadNotes() {
  const notes = []
  const p = env.DIGEST_NOTES_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'digest', 'NOTES.md')
  try {
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith('#') || t.startsWith('<!--')) continue
        notes.push(t)
      }
    }
  } catch { /* 备注缺省无所谓 */ }
  if (env.EXTRA_NOTE && env.EXTRA_NOTE.trim()) notes.push(env.EXTRA_NOTE.trim())
  return notes
}

// ---------- 组装摘要 ----------
function compose(d) {
  const L = []
  L.push(`📌 ${REPO.split('/')[1]} 进度同步 · ${fmtDay(now)}`)
  L.push(`统计窗口 ${fmtDT(new Date(sinceIso))} → ${fmtDT(now)}(${windowH.toFixed(1)} 小时${capped ? ',已按上限截断' : ''})`)

  const prog = []
  for (const pr of d.mergedPRs.slice(0, 5)) prog.push(`✅ 合并 PR #${pr.number} ${clip(pr.title, 46)}(${pr.user?.login || '?'})`)
  for (const is of d.closedIssues.slice(0, 5)) prog.push(`✔️ 关闭 Issue #${is.number} ${clip(is.title, 46)}`)
  if (d.release) prog.push(`🚀 发布 ${d.release.tag_name || d.release.name}(npm latest${d.npmVersion ? ` = ${d.npmVersion}` : ''})`)
  if (d.commits.length) {
    for (const c of d.commits.slice(0, 5)) prog.push(`• ${c.sha.slice(0, 7)} ${clip(c.commit?.message?.split('\n')[0] || '', 44)}(${c.commit?.author?.name || '?'})`)
    if (d.commits.length > 5) prog.push(`• …等共 ${d.commits.length} 个提交`)
  }
  L.push('')
  L.push('▍这期进展')
  if (prog.length) L.push(...prog.map((s) => s))
  else L.push(`这期没有新动态,一切照常。`)

  L.push('')
  L.push('▍现存问题')
  const bugs = d.openBugs.slice(0, 6)
  if (bugs.length) {
    for (const b of bugs) {
      const age = daysSince(b.created_at)
      const ageTxt = age < 1 ? `${Math.max(1, Math.round(age * 24))} 小时` : `${Math.round(age)} 天`
      const isNew = b.created_at >= sinceIso ? ' ·🆕' : ''
      L.push(`🐛 #${b.number} ${clip(b.title, 44)} ·挂了 ${ageTxt}${isNew}`)
    }
  } else if (d.openOthers.length) {
    L.push(`(没有开放中的 bug;有 ${d.openOthers.length} 个其他开放 issue)`)
  } else {
    L.push('开放 bug 清零 🎉')
  }
  for (const pr of (d.openPRs || []).slice(0, 4)) L.push(`🛠 待处理 PR #${pr.number} ${clip(pr.title, 44)}`)
  L.push(`完整列表:GitHub 仓库 ${REPO} → issues 页(群消息不带链接,直接搜仓库名)`)

  if (d.groupFeedbackLines?.length) {
    L.push('')
    L.push('▍群内反馈(AI 归纳)')
    if (d.groupFeedbackSummary) L.push(...d.groupFeedbackSummary.split('\n'))
    else for (const line of d.groupFeedbackLines.slice(-8)) {
      try { const o = JSON.parse(line); L.push(`• ${clip(o.m, 60)}(${String(o.t || '').slice(5, 16).replace('T', ' ')})`) }
      catch { L.push(`• ${clip(line, 60)}`) }
    }
  }

  L.push('')
  L.push('▍当前状态')
  const stars = d.repo?.stargazers_count ?? '?'
  L.push(`⭐ ${stars} · 开放 Issue ${d.openBugs.length + d.openOthers.length}(bug ${d.openBugs.length})· 开放 PR ${(d.openPRs || []).length} · npm latest ${d.npmVersion || '?'}`)

  const notes = loadNotes()
  if (notes.length) {
    L.push('')
    L.push(`备注:${notes.join(' / ')}`)
  }
  L.push('')
  L.push(`—— 本消息由 GitHub Actions 定时统计(每天 12:00 / 21:00),有问题直接群里说`)
  let text = L.join('\n')
  if (CHANNEL === 'qq_official') text = text.replace(/https?:\/\/\S+/g, '(链接略)')
  return text
}

// ---------- 投递通道 ----------
async function send(text) {
  const post = async (url, headers, body) => {
    const { res, json, text: raw } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${raw.slice(0, 240)}`)
    return json
  }
  switch (CHANNEL) {
    // 常见 QQ 错误码:40034105 主动消息无权限(机器人未在 q.qq.com 审核上线)/ 40034101 机器人不在群里
    case 'qq_official': {
      const t = await post('https://bots.qq.com/app/getAppAccessToken', {}, { appId: env.QQ_APP_ID, clientSecret: env.QQ_APP_SECRET })
      if (!t?.access_token) throw new Error(`取 access_token 失败:${JSON.stringify(t).slice(0, 240)}`)
      const body = { content: text, msg_type: 0, msg_seq: 1 }
      if (env.QQ_MSG_ID) body.msg_id = env.QQ_MSG_ID
      const r = await post(`${(env.QQ_API_BASE || 'https://api.sgroup.qq.com').replace(/\/$/, '')}/v2/groups/${env.QQ_GROUP_OPENID}/messages`, { Authorization: `QQBot ${t.access_token}` }, body)
      if (r && typeof r.retcode === 'number' && r.retcode !== 0) throw new Error(`QQ retcode=${r.retcode} ${JSON.stringify(r).slice(0, 240)}`)
      return 'qq_official'
    }
    case 'napcat': {
      const headers = env.NAPCAT_TOKEN ? { Authorization: `Bearer ${env.NAPCAT_TOKEN}` } : {}
      const r = await post(`${env.NAPCAT_HTTP_URL.replace(/\/$/, '')}/send_group_msg`, headers, {
        group_id: Number(env.NAPCAT_GROUP_ID),
        message: [{ type: 'text', data: { text } }],
        auto_escape: false,
      })
      if (!r?.data?.message_id) throw new Error(`NapCat 应答异常:${JSON.stringify(r).slice(0, 240)}`)
      return 'napcat'
    }
    case 'telegram': {
      const r = await post(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {}, { chat_id: env.TG_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true })
      if (!r?.ok) throw new Error(`TG 应答异常:${JSON.stringify(r).slice(0, 240)}`)
      return 'telegram'
    }
    case 'discord': {
      await post(env.DISCORD_WEBHOOK_URL, {}, { content: text.slice(0, 1990) })
      return 'discord'
    }
    case 'feishu': {
      const r = await post(env.FEISHU_WEBHOOK_URL, {}, { msg_type: 'text', content: { text } })
      if (r && (r.code !== undefined ? r.code !== 0 : r.StatusCode !== 0)) throw new Error(`飞书应答异常:${JSON.stringify(r).slice(0, 240)}`)
      return 'feishu'
    }
    case 'dingtalk': {
      const r = await post(env.DINGTALK_WEBHOOK_URL, {}, { msgtype: 'text', text: { content: text } })
      if (r?.errcode !== 0) throw new Error(`钉钉应答异常:${JSON.stringify(r).slice(0, 240)}`)
      return 'dingtalk'
    }
    case 'generic': {
      await post(env.GENERIC_WEBHOOK_URL, {}, { text })
      return 'generic'
    }
    case 'none':
      return null
    default:
      throw new Error(`未知 DIGEST_CHANNEL=${CHANNEL}(可选:none/qq_official/napcat/telegram/discord/feishu/dingtalk/generic)`)
  }
}

// ---------- 主流程 ----------
const d = await collect()
// 群内反馈 AI 归纳:原始消息在 collect 里已取出并清空 gist,这里让 LLM 归纳成带标题的清单
if (d.groupFeedbackLines?.length && env.LLM_API_KEY) {
  try {
    const r = await fetch(`${(env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: env.LLM_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是群报整理员。下面是 QQ 群近一窗口的用户原始消息(JSONL:t=时间,u=用户脱敏标识,m=原文)。归纳其中反映的「问题/故障/使用障碍/请求」,合并同类项,输出最多 8 条,每条一行,格式「• 标题 —— 一句话细节(时间)」,标题不超过 20 字,时间为原文 t 转成北京时间。没有实质问题就只输出一行「(本窗口群内未捕获到明确问题)」。纯文本,不要 Markdown 标题。' },
          { role: 'user', content: d.groupFeedbackLines.join('\n').slice(0, 20000) },
        ],
        max_tokens: 600,
        temperature: 0.3,
      }),
    })
    const j = await r.json().catch(() => null)
    const text = j?.choices?.[0]?.message?.content?.trim()
    if (text) { d.groupFeedbackSummary = text; console.log('[digest] 群反馈 AI 归纳完成') }
    else console.warn('[digest] 群反馈归纳空应答,退回原文摘录')
  } catch (e) { console.warn('[digest] 群反馈归纳失败(退回原文摘录):', e.message) }
}
const text = compose(d)
console.log('─────────────── 生成摘要 ───────────────')
console.log(text)
console.log('────────────────────────────────────────')

if (env.GITHUB_STEP_SUMMARY) {
  try { appendFileSync(env.GITHUB_STEP_SUMMARY, `\n\`\`\`\n${text}\n\`\`\`\n`) } catch { /* summary 写不进不影响 */ }
}

if (NO_SEND) {
  console.log('[digest] --print:不投递。')
} else if (CHANNEL === 'none' || !CHANNEL) {
  console.log('[digest] DIGEST_CHANNEL 未配置,只生成不投递(配置仓库变量 DIGEST_CHANNEL + 对应 secrets 后自动生效)。')
} else {
  try {
    const used = await send(text)
    console.log(`[digest] ✅ 已通过 ${used} 投递。`)
  } catch (e) {
    const hint = /40034105/.test(e.message) ? '(机器人尚未在 q.qq.com 完成审核上线,主动消息被拒;上线后自动恢复)' : /40034101/.test(e.message) ? '(机器人不在目标群)' : ''
    console.error(`[digest] ❌ 投递失败(${CHANNEL}):`, e.message, hint)
    process.exitCode = 1
  }
}
