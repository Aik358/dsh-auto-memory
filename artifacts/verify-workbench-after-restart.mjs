/**
 * 子代理迁移 · 重启后验收（只读，无副作用）
 *
 * 用法（用户重启 dsh web 之后执行）：
 *   node artifacts/verify-workbench-after-restart.mjs
 *
 * ① 磁盘取证 workbench.json
 * ② 系统墙钟独立算期号，与落盘交叉校验
 * ③ 打真实后端：目标路由 + **必然不存在的对照路径**（差分实验，判 401/404 到底说明什么）
 *
 * 不启动/不重启任何进程；不调用 action:'setup'（写操作）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

const PORT = Number(process.env.DSH_PORT || 3080)
const TARGET = '/api/dsh-auto-memory/workbench'
const CONTROL = '/api/dsh-auto-memory/__definitely-not-a-route__'

const log = (s) => console.log(s)

log('══ 子代理迁移 · 工作台验收（只读）══')
log('时间: ' + new Date().toISOString())

// ── ① 磁盘
const wbFile = path.join(os.homedir(), '.dsh', 'memory', 'workbench.json')
log('\n── ① 落盘状态 ──')
log('文件: ' + wbFile)
let disk = null
if (fs.existsSync(wbFile)) {
  const raw = fs.readFileSync(wbFile, 'utf8')
  log('  存在, ' + raw.length + ' 字符, mtime ' + fs.statSync(wbFile).mtime.toISOString())
  try {
    disk = JSON.parse(raw)
    for (const k of ['version', 'sessionId', 'epoch', 'cwd', 'permission', 'period', 'createdAt']) {
      log('  ' + k.padEnd(12) + '= ' + JSON.stringify(disk[k]))
    }
  } catch (e) { log('  ⚠️ 解析失败: ' + e.message) }
} else {
  log('  ⚠️ 不存在 ⇒ 工作台尚未建立（重启后仍不存在 = ensureWorkbench 未跑或被门控）')
}

// ── ② 期号（与实现同算法的独立复算）
function epochNow(period, ms) {
  const d = new Date(ms)
  if (period === 'monthly') return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
  const start = Date.UTC(1970, 0, 5)
  const wk = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 604800000)
  return 'W' + Math.floor(wk / 2)
}
log('\n── ② 期号交叉校验（系统墙钟）──')
const per = (disk && disk.period) || 'biweekly'
const nowEp = epochNow(per, Date.now())
log('  period=' + per + '  当前应为 ' + nowEp + '  落盘 epoch=' + String(disk && disk.epoch))
if (disk && disk.epoch) log('  ' + (disk.epoch === nowEp ? '✅ 同期' : '⚠️ 不同期 ⇒ 应触发轮换'))

// ── ③ 差分实验
function post(p) {
  return new Promise((resolve) => {
    const body = Buffer.from('{}')
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: 'POST',
      headers: {
        Host: '127.0.0.1:' + PORT,
        'content-type': 'application/json',
        'content-length': body.length,
        'Sec-Fetch-Site': 'same-origin',
        Origin: 'http://127.0.0.1:' + PORT,
      },
      timeout: 8000,
    }, (res) => {
      let s = ''
      res.on('data', (c) => { s += c })
      res.on('end', () => resolve({ code: res.statusCode, body: s }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ code: null, body: 'timeout' }) })
    req.on('error', (e) => resolve({ code: null, body: e.code || e.message }))
    req.end(body)
  })
}

log('\n── ③ 后端真实路由（差分实验：目标 vs 对照）──')
const t = await post(TARGET)
log('  目标 ' + TARGET)
log('    → HTTP ' + t.code + '  ' + t.body.replace(/\s+/g, ' ').slice(0, 130))
const c = await post(CONTROL)
log('  对照 ' + CONTROL)
log('    → HTTP ' + c.code + '  ' + c.body.replace(/\s+/g, ' ').slice(0, 130))

log('')
let ready = false
if (t.code === 200) {
  let j = null
  try { j = JSON.parse(t.body) } catch (e) {}
  if (j) {
    log('  ready=' + j.ready + '  reason=' + j.reason)
    const v = j.verify || {}
    log('  verify.ok=' + v.ok + '  reason=' + v.reason + '  preset=' + v.preset + '  cwd=' + v.cwd)
    ready = !!j.ready
    log('  ' + (ready ? '✅ 三重校验通过：工作台就绪。' : '⚠️ 未就绪 ⇒ 子代理被门控，界面应弹居中向导。'))
  }
} else if (t.code === c.code) {
  log('  ⚠️ 目标与对照**同码**（' + t.code + '）⇒ 该码来自更外层的守卫（鉴权/回环），')
  log('     **不能**据此判断路由是否存在。此步无判别力 ⇒ 改用「重启后看 workbench.json + 人眼」验收。')
} else {
  log('  ⚠️ 目标与对照**不同码**（' + t.code + ' vs ' + c.code + '）⇒ 路由差异可见，但非 200，需人工看正文。')
}

log('\n── 还需人眼确认（脚本测不到）──')
log('  A. 普通会话左侧是否**不再出现**新的子对话条目。')
log('  B. 未就绪时界面**中心**应弹「记忆工作台需要初始化」向导（非左下角小卡片），含风险说明与一键修复。')
log('\n结论: ' + (ready ? '工作台已就绪 ✅' : '脚本未能判定就绪 ⇒ 以上面 ①② 两条硬证据 + 人眼 A/B 为准 ⚠️'))
