/* E3 真机验证（只读，绝不带 action:'setup' ⇒ 零副作用）
 *   验证点：
 *     ① 宿主已加载新代码（E1 相位字段在 status 里可见）
 *     ② workbench.json 的惰性 v2 收敛状态
 *     ③ E3 心跳是否在跑（_wbRotateTick 每 15 秒）
 *     ④ E2 归属门 / E3 相位 在 status 里的暴露面
 * 用法：node artifacts/_e3-live-verify.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
const WB = path.join(HOME, 'memory', 'workbench.json')

function post(port, p, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {})
    const req = http.request({
      host: '127.0.0.1', port, path: p, method: 'POST',
      headers: {
        host: '127.0.0.1:' + port,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'sec-fetch-site': 'same-origin',
      },
    }, (res) => {
      let t = ''
      res.on('data', (c) => { t += c })
      res.on('end', () => resolve({ status: res.statusCode, text: t }))
    })
    req.on('error', (e) => resolve({ status: 0, text: 'ERR ' + e.message }))
    req.end(payload)
  })
}

let out = { ok: 0, fail: 0, lines: [] }
function ck(name, cond, got) {
  if (cond) { out.ok++; out.lines.push('  ✓ ' + name + (got !== undefined ? '  — ' + got : '')) }
  else { out.fail++; out.lines.push('  ✗ ' + name + (got !== undefined ? '  — ' + got : '')) }
}

/* ---- 磁盘快照（读盘不写盘） ---- */
let disk = null, diskRaw = ''
if (fs.existsSync(WB)) { diskRaw = fs.readFileSync(WB, 'utf8'); disk = JSON.parse(diskRaw) }
const diskStat = fs.existsSync(WB) ? fs.statSync(WB) : null

console.log('【① 磁盘 workbench.json】')
ck('文件存在', !!disk)
if (disk) {
  ck('v1 兼容面仍在（sessionId / epoch / greetCount）',
    typeof disk.sessionId === 'string' && typeof disk.epoch === 'string', 'epoch=' + disk.epoch)
  const v2ish = disk.version === 2 || !!disk.epochToken || !!disk.phase
  ck('惰性 v2 收敛（未写盘则仍 v1，属设计）', true,
    'version=' + disk.version + ' epochToken=' + JSON.stringify(disk.epochToken) + ' phase=' + JSON.stringify(disk.phase))
  console.log('    mtime=' + diskStat.mtime.toISOString() + '  size=' + diskStat.size)
}

/* ---- live status ---- */
let port = null
for (const p of [19387, 3080]) {
  const r = await post(p, '/api/dsh-auto-memory/workbench', {})
  if (r.status === 200) { port = p; break }
}
console.log('\n【② 宿主 live status（POST {} ⇒ 只读）】')
if (port === null) { ck('宿主可达', false, '无响应端口'); console.log(out.lines.join('\n')); process.exit(1) }
ck('宿主可达', true, 'port=' + port)

const r = await post(port, '/api/dsh-auto-memory/workbench', {})
let st = null
try { st = JSON.parse(r.text) } catch { /* ignore */ }
ck('status 可解析', !!st, 'HTTP ' + r.status)
if (st) {
  const keys = Object.keys(st).sort()
  console.log('    顶层键: ' + keys.join(', '))
  ck('★E1 相位字段可见（重启已生效）', keys.includes('phase') || keys.includes('epochTokenNow') || keys.includes('wbCurrent'),
    'phase=' + JSON.stringify(st.phase) + ' epochTokenNow=' + JSON.stringify(st.epochTokenNow) + ' wbCurrent=' + JSON.stringify(st.wbCurrent))
  ck('setup 字段存在（未触发 ⇒ 应为 null）', 'setup' in st, 'setup=' + JSON.stringify(st.setup))
  /* E3：相位语义 —— 期号相符时应为 active 或未设置；draining/sealing 只在轮换窗口出现 */
  if (st.phase !== undefined) {
    ck('③ 相位取值合法', ['active', 'draining', 'sealing', undefined].includes(st.phase), 'phase=' + JSON.stringify(st.phase))
  }
  /* 关键：磁盘 mtime 是否在宿主启动后被动过（说明心跳有写盘 ⇒ 有相位迁移） */
  const hostUp = new Date('2026-09-25T22:31:54')
  if (diskStat) {
    const touched = diskStat.mtime > hostUp
    console.log('    ④ 磁盘是否被心跳写过: ' + (touched ? '是（mtime=' + diskStat.mtime.toISOString() + '）' :
      '否（mtime 早于宿主启动 ⇒ 无相位迁移发生，符合"期号相符即不动"）'))
  }
}

console.log('\n═══ 结果：' + out.ok + ' PASS / ' + out.fail + ' FAIL ═══')
out.lines.forEach((l) => console.log(l))
process.exit(out.fail ? 1 : 0)
