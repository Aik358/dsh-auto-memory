// B1-1 验收断言：内容寻址 id 的跨机/跨时一致性
// 判据（来自 06-实施批次与验收.md B1-1）：
//  1) 同 title+steps 两次生成**相同 id**（同内容 ⇒ 同 id）
//  2) 不同内容 ⇒ 不同 id
//  3) 与传入的 now 无关（换时间戳，id 不变）—— 这是本次修复的核心
//  4) 与 rows 里的**无关**条目无关（换机器 = 换 rows，id 仍相同）
import { newProcedureIdentityPre, procedureFingerprintPre } from '../lib/procedure-observation.js'

let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name) } }

const candA = { title: '发布前跑全量回归', origin: 'agent', riskLevel: 'low',
  steps: ['跑 node --check', '跑全量回归'], successCriteria: ['全绿'] }
const candB = { title: '发布前跑全量回归', origin: 'agent', riskLevel: 'low',
  steps: ['跑 node --check', '跑全量回归'], successCriteria: ['全绿'] }   // 内容等价
const candC = { ...candA, steps: ['跑 node --check'] }                      // 内容不同

const T1 = 1700000000000, T2 = 1900000000000   // 两个不同时刻
const rowsX = []                               // 机器 X
const rowsY = [{ procedureId: 'proc_pre_' + 'f'.repeat(32) }]  // 机器 Y：多一条无关记录

const idA1 = newProcedureIdentityPre(candA, T1, rowsX)
const idA2 = newProcedureIdentityPre(candB, T1, rowsX)
const idA3 = newProcedureIdentityPre(candA, T2, rowsX)   // ★ 换时间
const idA4 = newProcedureIdentityPre(candA, T1, rowsY)   // ★ 换机器（rows 不同）
const idC  = newProcedureIdentityPre(candC, T1, rowsX)

t('同内容 ⇒ 同 id（两次调用）', idA1 === idA2)
t('★ 换时间戳 ⇒ id 不变（旧实现会变）', idA1 === idA3)
t('★ 换 rows（模拟换机器）⇒ id 不变', idA1 === idA4)
t('不同内容 ⇒ 不同 id', idA1 !== idC)
t('id 前缀正确', idA1.startsWith('proc_pre_'))
t('id 长度正确（前缀+32hex）', idA1.length === 'proc_pre_'.length + 32)
t('指纹只含内容字段（不含时间）', !procedureFingerprintPre(candA).includes(String(T1)))

// 冲突消歧仍确定性：同内容 + 已占用 ⇒ 稳定递增，且仍不含时间
const rowsZ = [{ procedureId: idA1 }]
const idZ1 = newProcedureIdentityPre(candA, T1, rowsZ)
const idZ2 = newProcedureIdentityPre(candA, T2, rowsZ)
t('id 被占用时消歧，且换时间仍稳定', idZ1 === idZ2 && idZ1 !== idA1)

console.log('')
console.log('B1-1 断言：' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
