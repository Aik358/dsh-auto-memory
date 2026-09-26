/** 工作台 v2 形状守卫（E6 · 2026-09-25）
 *
 * 立此守卫的原因（guard-scout 普查实证）：
 *   `epochToken` / `drainStartedAt` / `_wbStateOf` / `wbOwnerOf` / `_wbTokenOf` / `version: 2`
 *   在 `tests/` 下**全部 0 命中** —— v2 相位面的唯一验证原本只在 `artifacts/_e1-probe.mjs`(32/0)、
 *   `_e1fix-probe.mjs`(27/0)、`_e2-probe.mjs`(16/0)、`_e3-probe.mjs`(29/0)、`_e4-probe.mjs`(19/0)，
 *   而 `tools/run-smoke.mjs` 只扫 `tests/smoke/*.mjs` ⇒ **五支探针都不在 179 套件回归内**。
 *   ⇒ E3/E4 再动 workbench 形状，`tests/` 给不出任何红。本守卫把该面纳入常驻回归。
 *
 * 纪律：只读源码做静态断言 + 纯逻辑重放；不碰磁盘、不启进程、无副作用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根：由本文件位置推导（tests/smoke/*.mjs → 上两级）。
// 2026-09-26 修：原先硬编码 'D:/dsh-auto-memory'，CI 在 /home/runner/... 下必 ENOENT。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const idx = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')

let P = 0, F = 0
const ck = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''))
  ok ? P++ : F++
}

/** 花括号配平抽函数体（纪律第二十二条：不得用非贪婪正则） */
function bodyOf(src, anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) throw new Error('anchor not found: ' + anchor)
  let d = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}') { d--; if (!d) { j++; break } }
  }
  return src.slice(i, j)
}

console.log('\n══ ① v2 相位面字段齐备 ══')
ck('workbench.json 版本收敛到 2', /version: 2,/.test(idx))
ck('期牌 epochToken 落盘', /epochToken:/.test(idx))
ck('相位 phase 落盘', /phase: 'active',/.test(idx))
ck('current / previous 双槽', /current: \{ sessionId: realSid, openedAt: nowIso \}/.test(idx) && /previous:/.test(idx))
ck('drainStartedAt 落盘（E3 超时防御计时起点）', /drainStartedAt: 0,/.test(idx))
ck('consentGranted 落盘（E3 同意门只弹一次）', /consentGranted: wbGranted,/.test(idx))

console.log('\n══ ② 唯一读入口与归属函数 ══')
ck('_wbStateOf 存在（唯一读入口，归一旧/新形状）', /_wbStateOf\(raw\)\s*\{|_wbStateOf\(st\)\s*\{/.test(idx))
ck('wbOwnerOf 存在（current/sealed/orphan 三态）', /wbOwnerOf\(sessionId, st\)\s*\{/.test(idx))
ck('_wbTokenOf 存在', /_wbTokenOf\(st\)\s*\{/.test(idx))
ck('★_wbTokenOf 不做派生兜底（只读落盘值）', (() => {
  const b = bodyOf(idx, '  _wbTokenOf(st) {')
  return !/createHash|_workbenchEpochToken/.test(b)
})(), '派生会使归属门永不失配、形同虚设')
ck('★_wbStateOf 语义面不含 sealTriedAt（E3 教训：节流必须读原始对象）', (() => {
  const b = bodyOf(idx, '  _wbStateOf(st) {')
  return !b.includes('sealTriedAt')
})())

console.log('\n══ ③ 期牌算法逐字一致 ══')
ck('_workbenchEpochToken 用 sha256(epoch|sessionId) 截前 16', (() => {
  const b = bodyOf(idx, '  _workbenchEpochToken(epoch, sessionId) {')
  // ★断言必须对**真实标识符**写：源码用局部 e/s（`e + '|' + s`），不是形参名 epoch/sessionId。
  //   第一版写成 /epoch \+ '\|' \+ sessionId/ ⇒ 假红（源码无缺陷）。
  return /createHash\('sha256'\)/.test(b) && /\+\s*'\|'\s*\+/.test(b) && /slice\(0, 16\)/.test(b)
})())
ck('期牌空输入返回空串（不凭空造牌）', (() => {
  const b = bodyOf(idx, '  _workbenchEpochToken(epoch, sessionId) {')
  return /if \(!e \|\| !s\) return ''/.test(b)
})())
ck('status 回传 epochTokenNow（诊断可见）', /epochTokenNow/.test(idx))

console.log('\n══ ④ E3 轮换门结构 ══')
ck('_wbRotateTick 是相位迁移的唯一写者（挂在 15s 心跳）', (() => {
  const hb = idx.split('\n').filter((l) => l.includes('void engine._wbRotateTick()'))
  return hb.length === 1 && hb[0].includes('}, 15000)')
})())
ck('四常量齐备（QUIET / SEAL_TIMEOUT / SEAL_RETRY）', (() => {
  return /const WB_QUIET_MS = 2 \* 60 \* 1000/.test(idx) &&
    /const WB_SEAL_TIMEOUT_MS = 30 \* 60 \* 1000/.test(idx) &&
    /const WB_SEAL_RETRY_MS = 60 \* 1000/.test(idx)
})())
// ★判据改为「与真源码自身比对」，不用魔法数字（纪律：断言里凡出现魔法数字，一律改为与入参/真源码比对）。
//   意图不变 =「相位迁移只在 _wbRotateTick 内」⇒ 断言 总数 = 1（定义）+ 该函数体内调用数。
//   写死 5 会随实现演进假红（2026-09-26 E3-FIX-2④ 新增一处「收敛期号」调用，D5 判据本身未破）。
ck('_wbSetPhase 只在 _wbRotateTick 内被调用（唯一写者）', (() => {
  const i = idx.indexOf('  async _wbRotateTick() {')
  if (i < 0) return false
  let d = 0, j = idx.indexOf('{', i)
  for (; j < idx.length; j++) { if (idx[j] === '{') d++; else if (idx[j] === '}') { d--; if (!d) { j++; break } } }
  const body = idx.slice(i, j)
  const total = (idx.match(/_wbSetPhase\(/g) || []).length
  const inRot = (body.match(/_wbSetPhase\(/g) || []).length
  return total === 1 + inRot && inRot >= 4
})(), '总=' + (idx.match(/_wbSetPhase\(/g) || []).length)
ck('★超时纯防御：明写 NO forced switch', /NO forced switch/.test(idx))
ck('★异常判「不静止」（保守，不 fail-open 架空门）', /treat as NOT quiet/.test(idx))
ck('★旧期在 draining/sealing 期仍权威（不停记忆功能）', /old epoch still authoritative/.test(idx))
ck('_verifyWorkbench 体内无写盘（保持只读契约）', (() => {
  const b = bodyOf(idx, '  async _verifyWorkbench(nowMs) {')
  return !b.includes('_writeWorkbench') && !b.includes('_wbSetPhase')
})())

console.log('\n══ ⑤ E2 归属门（六个写路径收口在 runSubagent）══')
ck('WB_GATED_JOBS 六项齐备', (() => {
  const m = idx.match(/const WB_GATED_JOBS = \[([^\]]+)\]/)
  if (!m) return false
  const jobs = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  return jobs.length === 6 && ['greet', 'fold', 'summarize', 'consolidate', 'consolidate-logs', 'distill'].every((j) => jobs.includes(j))
})())
ck('门用 wbOwnerOf 且要求 === current', /const _wbGateOwner = this\.wbOwnerOf\(_wbGateSid, _wbGateSt\)/.test(idx) &&
  /if \(_wbGateOwner !== 'current'\)/.test(idx))
ck('门用 _wbTokenOf（只读落盘值）', /_wbGateToken = this\._wbTokenOf\(_wbGateSt\)/.test(idx))
ck('★迁移态放行：仅「非空且不符」才拒', /if \(_wbGateToken && _wbGateToken !== _wbGateNow\)/.test(idx))
ck('门异常 fail-open（宁可漏拦不停摆）', /ownership gate error \(fail-open\)/.test(idx))

console.log('\n══ ⑥ E4 父缓存绑定期牌 ══')
ck('_workbenchParent 赋值点仍为 3（未散落）', (idx.match(/this\._workbenchParent = /g) || []).length === 3,
  'got=' + (idx.match(/this\._workbenchParent = /g) || []).length)
ck('三处赋值点都打标签（标签出现 6 次 = 3 赋值 + 2 比较 + 1 诊断）',
  (idx.match(/_workbenchParentEpoch/g) || []).length === 6,
  'got=' + (idx.match(/_workbenchParentEpoch/g) || []).length)
ck('★空标签 = 迁移态放行（判据以 !! 开头）',
  /const _wbParentStale = !!this\._workbenchParentEpoch && String\(this\._workbenchParentEpoch\) !== _wbEpochNow/.test(idx))
ck('stale 并入既有门控（不新增机制）', /if \(!this\._workbenchReady \|\| _wbParentStale\) \{/.test(idx))

console.log('\n══ ⑦ 「只激活一次」幂等闸 ══')
const visBody = bodyOf(idx, '  async _ensureWorkbenchVisible(sid, st) {')
ck('visibleAt 早退闸在 prompt 之前（函数体内比较）',
  visBody.indexOf('if (!sid || !st || st.visibleAt) return false') < visBody.indexOf('await sc.prompt({ sessionId: sid'))
ck('发送后落盘 visibleAt', visBody.includes('st.visibleAt = new Date().toISOString()'))
ck('该函数体内 prompt 恰好 1 次', (visBody.match(/await sc\.prompt\(/g) || []).length === 1)

console.log('\n══ ⑧ 守卫 ⑰ 硬约束不回退（防旧方案复活）══')
ck('无删除工作台会话的调用', !/deleteSession|removeSession/.test(idx) || !/workbench/i.test(idx.match(/deleteSession[\s\S]{0,80}/)?.[0] || ''))
ck('subagent-gc 不触碰工作台（源码级：只在 gc 模块内判 label 前缀）', (() => {
  const gc = fs.readFileSync(path.join(ROOT, 'lib/subagent-gc.js'), 'utf8')
  return !/workbench/i.test(gc)
})(), 'subagent-gc.js 内不得出现 workbench')

console.log('\n══ ⑨ 纯逻辑重放：归属三态 + 期牌判据 ══')
{
  // 与源码同构的纯函数（照抄语义，不从源码 eval）
  const TOK = (e, s) => 'sha256(' + e + '|' + s + ')'.slice(0, 16)
  const NOW = 'B10358', CUR = 'session-cur', PRE = 'session-prev'
  const st = { epoch: NOW, current: { sessionId: CUR }, previous: { sessionId: PRE } }
  const owner = (sid, s) => {
    const cur = s.current && s.current.sessionId
    const pre = s.previous && s.previous.sessionId
    if (cur && sid === cur) return 'current'
    if (pre && sid === pre) return 'sealed'
    return 'orphan'
  }
  ck('本期会话 ⇒ current（放行）', owner(CUR, st) === 'current')
  ck('上一期会话 ⇒ sealed（拒绝）', owner(PRE, st) === 'sealed')
  ck('无关会话 ⇒ orphan（拒绝）', owner('session-x', st) === 'orphan')
  ck('空状态 ⇒ orphan（不误放行）', owner(CUR, {}) === 'orphan')
}

console.log('\n================ SUMMARY ================')
console.log('PASS ' + P + ' / FAIL ' + F)
console.log('=========================================')
process.exit(F ? 1 : 0)
