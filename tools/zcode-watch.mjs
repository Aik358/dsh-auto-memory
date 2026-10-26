import fs from 'node:fs'
import path from 'node:path'

/**
 * Zcode 供应商/额度监测器 v2
 *
 * 判据来源（都是真实文件，不猜）：
 *  A. C:/Users/JH Z/.zcode/cli/rollout/*.jsonl
 *     每行 { completedAt, durationMs, requestId, attempt, model:{modelId,providerId}, response, ... }
 *     -> 能精确判定「这一轮实际用了哪个 provider」
 *  B. C:/Users/JH Z/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl
 *     -> 能看 accountRevision（各 plan entitled 状态），但注意：
 *        entitled=false 是**订阅权益**，与「免费额度是否用完」不是一回事，
 *        实测所有 plan 都是 entitled=false 却仍正常请求 => **不能拿它当额度判据**，
 *        只作为「账户权益变化」的旁证记录。
 *
 * 三级告警：
 *  P0 硬告警：出现非白名单 providerId  => 已切到收费中转站/第三方
 *  P1 先兆  ：attempt > 1（重试）或 response 为空/异常 => 可能限流或额度临界
 *  P2 记录  ：正常，仅记录 provider 分布
 */
const ROLLOUT = 'C:/Users/JH Z/.zcode/cli/rollout'
const LOGDIR = 'C:/Users/JH Z/.zcode/cli/log'
const STATE = 'D:/dsh-auto-memory/artifacts/_zcode_watch_state.json'
const LOG = 'D:/dsh-auto-memory/artifacts/zcode-watch.log'

// 只把这些认作"官方/免费额度"来源。其它一律告警。
const OFFICIAL_PREFIX = 'account:'
const OFFICIAL_IDS = [
  'account:bigmodel-start-plan',
  'account:zai-coding-plan',
  'account:zai-start-plan',
  'account:bigmodel-coding-plan',
  'account:zai-individual-coding-plan',
  'account:zai-team-coding-plan',
  'account:bigmodel-individual-coding-plan',
  'account:bigmodel-team-coding-plan',
  'account:zai-offpeak-idle-plan',
  'account:bigmodel-offpeak-idle-plan',
  'account:zai-highspeed-card',
  'account:bigmodel-highspeed-card',
]

function isOfficial (pid) {
  return OFFICIAL_IDS.indexOf(pid) >= 0
}

function readRollout () {
  const out = []
  let names = []
  try { names = fs.readdirSync(ROLLOUT).filter(f => f.endsWith('.jsonl')) } catch (e) { return out }
  for (const f of names) {
    const full = path.join(ROLLOUT, f)
    let st
    try { st = fs.statSync(full) } catch (e) { continue }
    if (Date.now() - st.mtimeMs > 3 * 3600 * 1000) continue
    let txt = ''
    try { txt = fs.readFileSync(full, 'utf8') } catch (e) { continue }
    for (const line of txt.split(String.fromCharCode(10))) {
      if (!line || line.charCodeAt(0) !== 123) continue
      let o
      try { o = JSON.parse(line) } catch (e) { continue }
      if (!o || !o.requestId) continue
      const resp = o.response
      let respEmpty = false
      if (resp == null) respEmpty = true
      else if (typeof resp === 'object') {
        const c = resp.content || resp.output || resp.text
        respEmpty = (c == null) || (Array.isArray(c) && c.length === 0)
      }
      out.push({
        file: f,
        requestId: o.requestId,
        attempt: Number(o.attempt) || 1,
        completedAt: o.completedAt || '',
        startedAt: o.startedAt || '',
        durationMs: Number(o.durationMs) || 0,
        modelId: (o.model && o.model.modelId) || '',
        providerId: (o.model && o.model.providerId) || '',
        respEmpty,
      })
    }
  }
  return out
}

function readEntitlements () {
  let names = []
  try { names = fs.readdirSync(LOGDIR).filter(f => /^zcode-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort() } catch (e) { return null }
  const f = names[names.length - 1]
  if (!f) return null
  let txt = ''
  try { txt = fs.readFileSync(path.join(LOGDIR, f), 'utf8') } catch (e) { return null }
  let last = null
  for (const l of txt.split(String.fromCharCode(10))) if (l.includes('accountRevision')) last = l
  if (!last) return null
  try {
    const o = JSON.parse(last)
    const rev = o.context.accountRevision
    const arr = JSON.parse(rev.slice(rev.indexOf('account:') + 'account:'.length))
    return { at: o.timestamp, items: arr[1] }
  } catch (e) { return null }
}

function main () {
  const rows = readRollout()
  let prev = { seen: [] }
  try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch (e) {}
  const seenSet = new Set(prev.seen || [])

  const fresh = rows.filter(r => !seenSet.has(r.requestId))
  const p0 = []
  const p1 = []
  const byProvider = {}
  const byModel = {}

  for (const r of fresh) {
    byProvider[r.providerId] = (byProvider[r.providerId] || 0) + 1
    byModel[r.modelId] = (byModel[r.modelId] || 0) + 1
    if (r.providerId && !isOfficial(r.providerId)) p0.push(r)
    if (r.attempt > 1 || r.respEmpty) p1.push(r)
  }

  const ts = new Date().toISOString()
  const lines = []
  lines.push('[' + ts + '] 新增请求 ' + fresh.length + ' 条')

  if (fresh.length) {
    lines.push('  provider: ' + JSON.stringify(byProvider))
    lines.push('  model   : ' + JSON.stringify(byModel))
  }

  if (p0.length) {
    lines.push('  *** P0 告警：出现非官方 provider ' + p0.length + ' 条 —— 可能已切到收费中转站 ***')
    for (const b of p0.slice(0, 10)) {
      lines.push('    ' + b.providerId + ' / ' + b.modelId + ' @ ' + b.completedAt + ' attempt=' + b.attempt)
    }
  } else if (fresh.length) {
    lines.push('  P0 通过：全部为官方 provider')
  }

  if (p1.length) {
    lines.push('  !! P1 先兆：重试或空响应 ' + p1.length + ' 条（额度/限流可能临界）')
    for (const b of p1.slice(0, 5)) {
      lines.push('    provider=' + b.providerId + ' model=' + b.modelId +
        ' attempt=' + b.attempt + ' respEmpty=' + b.respEmpty + ' @ ' + b.completedAt)
    }
  }

  const ent = readEntitlements()
  if (ent) {
    const avail = ent.items.filter(x => x && x.config && x.config.access && x.config.access.entitled === true)
    lines.push('  权益快照(' + ent.at + '): ' + avail.length + '/' + ent.items.length + ' 个 plan entitled=true')
  }

  const out = lines.join(String.fromCharCode(10))
  console.log(out)
  try { fs.appendFileSync(LOG, out + String.fromCharCode(10) + String.fromCharCode(10)) } catch (e) {}

  const allSeen = Array.from(seenSet).concat(fresh.map(r => r.requestId))
  try {
    fs.writeFileSync(STATE, JSON.stringify({
      seen: allSeen.slice(-8000),
      lastRun: Date.now(),
      lastProviderCounts: byProvider,
      p0Total: (prev.p0Total || 0) + p0.length,
      p1Total: (prev.p1Total || 0) + p1.length,
    }))
  } catch (e) {}
}

main()
