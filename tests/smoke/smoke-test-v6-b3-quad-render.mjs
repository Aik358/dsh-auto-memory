/** smoke-test-v6-b3-quad-render.mjs —— B3 检查点四段注入渲染验收 */
import { renderT2Pre, RENDER_LIMITS, T2_BUDGET } from '../../lib/event-render.js'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ok   - ' + n + (e ? ' :: ' + e : '')) } else { fail++; console.log('  FAIL - ' + n + (e ? ' :: ' + e : '')) } }

const mkEv = (cks) => ({
  id: 'evt_aaaaaaaa', name: '测试事件', summary: '一句话摘要。', status: 'active',
  sections: { goal: 'G', doing: 'D', deadend: '', next: 'N' },
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  checkpoints: cks, startMs: 0, endMs: 0, members: [], rationale: '',
  kind: 'ledger', confidence: 'high', outcomes: [], ordinal: 0, skills: {}, createdAt: 1, updatedAt: 1,
})

console.log('=== A. 预算 ===')
ok(T2_BUDGET.CHECKPOINTS === 1800, 'A-1 CHECKPOINTS 预算 = 1800（原 900）', T2_BUDGET.CHECKPOINTS + '')
const sum = Object.keys(T2_BUDGET).reduce((a, k) => a + T2_BUDGET[k], 0)
console.log('  T2_BUDGET 合计:', sum, '/ RENDER_LIMITS.T2 =', RENDER_LIMITS.T2)
ok(RENDER_LIMITS.T2 >= 2400, 'A-2 T2 总上限仍 ≥ 2400', RENDER_LIMITS.T2 + '')

console.log('')
console.log('=== B. ★真渲染：有四段 ⇒ 用四段 ===')
const evQuad = mkEv([{
  at: Date.now(), kind: 'ledger', text: '原始正文不应优先',
  goal: '把三路工作移交 ZCode', state: '改 site/index.html', dead: '无', next: '等接手',
}])
const out1 = renderT2Pre(evQuad)
ok(out1.indexOf('把三路工作移交 ZCode') >= 0, 'B-1 ★goal 出现在注入文本')
ok(out1.indexOf('改 site/index.html') >= 0, 'B-2 ★state 出现')
ok(out1.indexOf('等接手') >= 0, 'B-3 ★next 出现')
ok(out1.indexOf('‖') >= 0, 'B-4 ★用 ‖ 分隔四段')
ok(out1.indexOf('原始正文不应优先') < 0, 'B-5 ★有四段时不回落 text')
ok(out1.length <= RENDER_LIMITS.T2, 'B-6 输出未超 T2 上限', out1.length + '/' + RENDER_LIMITS.T2)

console.log('')
console.log('=== C. ★负路径：无四段 ⇒ 回落 text ===')
const evText = mkEv([{ at: Date.now(), kind: 'log', text: '只有正文的检查点' }])
const out2 = renderT2Pre(evText)
ok(out2.indexOf('只有正文的检查点') >= 0, 'C-1 回落 text 内容')
ok(out2.indexOf('‖') < 0, 'C-2 ★负路径：无四段时不出现 ‖')

console.log('')
console.log('=== D. ★负路径：四段全空但有 text ⇒ 仍能渲染 ===')
const evEmpty = mkEv([{ at: Date.now(), kind: 'log', goal: '', state: '', dead: '', next: '', text: '兜底正文' }])
const out3 = renderT2Pre(evEmpty)
ok(out3.indexOf('兜底正文') >= 0, 'D-1 四段全空时回落 text')
ok(out3.indexOf('‖') < 0, 'D-2 不出现空分隔符')

console.log('')
console.log('=== E. 裸换行防护 ===')
const evNl = mkEv([{ at: Date.now(), kind: 'log', goal: '第一行\n第二行', state: 'S', dead: '', next: '' }])
const out4 = renderT2Pre(evNl)
ok(out4.indexOf('\n第一行') < 0 && out4.indexOf('第一行 / 第二行') >= 0, 'E-1 四段内的换行被替换为 / ')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)