// M8-2 JS 激活判定验证(JS 端独立闭环,不依赖 Python)
// P1 工件加载:结构校验(fail closed)
// P2 意图头:LR+Platt 推理(确定性样本,分数范围断言)
// P3 决策核:两车道/echo veto/completeness/margin 各分支 decision+lane+reasonCodes
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
import { loadAndVerifyPolicy, decideActivationV2 } from '../../lib/semantic-decide.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const INTENT = path.join(HERE, '..', '..', 'python', 'policies', 'recall_intent_lr_v1.json')
const POLICY = path.join(HERE, '..', '..', 'python', 'policies', 'activation_policy_v2.json')

console.log('[P1] loadAndVerifyPolicy')
let ctx
try { ctx = loadAndVerifyPolicy(INTENT, POLICY); ok(true, 'artifacts load + structural verify') }
catch (e) { ok(false, 'load failed: ' + e.message) }

console.log('[P2] intent head (deterministic, JS-only)')
if (ctx) {
  const recallQ = '之前关于采用琥珀协议作为模块间通信格式的决策是什么？请回忆一下具体内容。'
  const echoQ = '今天中午吃的面条挺不错的。'
  const enRecall = 'What was the decision about the amber protocol?'
  const enChitChat = 'The weather is nice today.'
  const r1 = ctx.head.infer(recallQ)
  const r2 = ctx.head.infer(echoQ)
  const r3 = ctx.head.infer(enRecall)
  const r4 = ctx.head.infer(enChitChat)
  console.log('  intentProb 琥珀回忆=', r1, '| 面条echo=', r2, '| en回忆=', r3, '| en闲聊=', r4)
  // 中英文都应区分(论文 AUC 0.90,char_wb 天然支持中文;修复 CJK 切分后对齐 Python)
  ok(r1 > 0.5 && r2 < 0.5, '中文回忆意图 > 中文echo (' + r1 + ' > ' + r2 + ')')
  ok(r3 > r4, '英文回忆意图 > 英文闲聊 (' + r3 + ' > ' + r4 + ')')
  // 确定性:同一输入两次一致
  ok(ctx.head.infer(enRecall) === r3, 'deterministic (same input same score)')
}

console.log('[P3] decision core branches')
if (ctx) {
  const { head, policy } = ctx
  const th = policy.thresholds
  const base = (p) => Object.assign({ text: '', denseTop: 0, margin: 0, containment: 0, mark: 0, nCand: 0, candidateHit: false }, p)
  // 显式回忆 + 命中 + 高分 → emit
  const r1 = decideActivationV2(base({ text: '之前关于采用琥珀协议作为模块间通信格式的决策是什么？请回忆一下具体内容。', denseTop: 0.9, margin: 0.2, containment: 0.4, mark: 1, nCand: 3, candidateHit: true }), head, policy)
  ok(r1.decision === 'emit' && r1.lane === 'explicit' && r1.reasonCodes.includes('explicit_lane'), 'explicit recall hit → emit (lane=' + r1.lane + ' dec=' + r1.decision + ')')
  // 生活 echo → 应走 proactive 车道 echo veto(意图 0.004 < tauLane 0.45)→ proactive
  const r2 = decideActivationV2(base({ text: '今天中午吃的面条挺不错的。', denseTop: 0.85, margin: 0.1, containment: 0.8, mark: 0, nCand: 2, candidateHit: false }), head, policy)
  ok(r2.decision === 'suppress' && r2.reasonCodes.includes('echo_veto_proactive'), 'life echo -> echo_veto_proactive suppress (dec=' + r2.decision + ' lane=' + r2.lane + ' codes=' + String(r2.reasonCodes))
  // 显式弱回忆(未命中) → suppress_low_signal 或 prefetch
  const r3 = decideActivationV2(base({ text: '之前我们讨论过 DSH 推理吗？', denseTop: 0.6, margin: 0.05, containment: 0.2, mark: 1, nCand: 2, candidateHit: false }), head, policy)
  ok(['suppress', 'prefetch'].includes(r3.decision), 'weak explicit no-hit → suppress/prefetch (got ' + r3.decision + ')')
  // correction 硬门 → suppress hard_gate_correction
  const r4 = decideActivationV2(base({ text: '我记错了，其实 DSH 推理不是七档。', denseTop: 0.9, margin: 0.2, mark: 1, nCand: 3, candidateHit: true, hardGates: { correction: true } }), head, policy)
  ok(r4.decision === 'suppress' && r4.reasonCodes.includes('hard_gate_correction'), 'correction hard gate → suppress')
  // proactive margin → prefetch
  const r5 = decideActivationV2(base({ text: '说点别的，天气不错。', denseTop: 0.5, margin: 0.08, containment: 0.1, mark: 0, nCand: 3, candidateHit: false }), head, policy)
  ok(['prefetch', 'suppress'].includes(r5.decision), 'proactive low → prefetch/suppress (got ' + r5.decision + ')')
}

console.log(`[M82] pass=${pass} fail=${fail}`)
process.exit(fail > 0 ? 1 : 0)
