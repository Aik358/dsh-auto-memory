#!/usr/bin/env node
/**
 * smoke-test-v4-e-continuation.mjs —— v4 批次 E · 接续链（5 点 + 2 新增）验收。
 *
 * 纪律：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条都带负路径；
 *       关键断言做变异验证（改坏 ⇒ 必红）。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }

const carry = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-carry.js')).href)
const { renderEventBindingPre, eventCarriesMaterialPre, pickCarryEventPre, pendingFromEventPre, EVENT_CARRY_MAX_PENDING } = carry

const mkEv = (o = {}) => Object.assign({
  id: 'evt_00000001', name: '实现事件接续', summary: '把 eventId 贯通到接续链',
  status: 'active', outcome: null, skillRef: null, pausedReason: null,
  sections: { goal: '让新会话知道在续接哪个事件', doing: '', deadend: '', next: '' },
  checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: 100, updatedAt: 200,
}, o)

console.log('[E-1] ★事件绑定块：新会话必须知道自己在续接哪个事件')
const binding = renderEventBindingPre(mkEv())
ok(binding.includes('evt_00000001'), '★正：绑定块含 eventId')
ok(binding.includes('实现事件接续'), '正：含事件名')
ok(/status=active/.test(binding), '正：含原始状态值（模型可据此判断是否已 close）')
ok(binding.includes('【事件绑定】'), '正：有固定标题（可被既有解析识别）')
ok(binding.includes('不要用 memory_event(action=create) 重复建'), '★正：明确禁止重复建事件（防「同一任务变两个事件」）')
ok(binding.includes('进行'), '正：状态中文化（active→进行）')

console.log('[E-2] 负路径：无事件 ⇒ **零字节**，不得输出占位')
ok(renderEventBindingPre(null) === '', '★负：null ⇒ 空串')
ok(renderEventBindingPre({}) === '', '★负：无 id ⇒ 空串')
ok(renderEventBindingPre({ id: '  ' }) === '', '★负：空白 id ⇒ 空串')
ok(!renderEventBindingPre(null).includes('(无'), '★负：不得输出「(无事件)」类占位（会让模型误以为有事件）')

console.log('[E-3] 未完成项：从 sections.next 抽，跳过已完成')
const evPend = mkEv({ sections: { goal: '', doing: '', deadend: '', next: '- 给 injected plane 写测试\n- [x] 已做完的这条\n- 确认 Tier-0 余量' } })
const pend = pendingFromEventPre(evPend)
ok(pend.length === 2, '正：抽到 2 条未完成（跳过已完成，实测 ' + pend.length + '）')
ok(pend[0] === '给 injected plane 写测试', '正：去掉列表符号')
ok(!pend.join('').includes('已做完的这条'), '★负：跳过 [x] 已完成项')
ok(pendingFromEventPre(mkEv()).length === 0, '负：next 为空 ⇒ 0 条')
ok(pendingFromEventPre(null).length === 0, '负：null ⇒ 0 条')
ok(pendingFromEventPre(mkEv({ sections: { next: Array.from({length: 10}, (_, i) => '- 项' + i).join('\n') } })).length <= EVENT_CARRY_MAX_PENDING, '正：条数上限 ' + EVENT_CARRY_MAX_PENDING + '')
const longPend = pendingFromEventPre(mkEv({ sections: { next: '- ' + 'x'.repeat(300) } }))
ok(longPend[0].length <= 80, '正：单条超长被截断（实测 ' + longPend[0].length + '）')
ok(renderEventBindingPre(evPend).includes('【未完成项】'), '正：绑定块含未完成项行')
ok(!renderEventBindingPre(mkEv()).includes('【未完成项】'), '负：无未完成项 ⇒ 不输出该行（零字节约定同族）')

console.log('[E-4] 事件存在性硬门（新增 B）')
ok(eventCarriesMaterialPre(mkEv()) === true, '★正：active 事件 ⇒ 算接续材料')
ok(eventCarriesMaterialPre(mkEv({ status: 'paused', checkpoints: [{ text: 'a' }] })) === true, '★正：paused 且有检查点 ⇒ 也算（搁置后拾起是真实场景）')
ok(eventCarriesMaterialPre(mkEv({ status: 'paused', checkpoints: [] })) === false, '★负：paused 且无检查点 ⇒ 不算')
ok(eventCarriesMaterialPre(mkEv({ status: 'closed', checkpoints: [] })) === false, '★负：closed 且无检查点 ⇒ 不算')
ok(eventCarriesMaterialPre(null) === false, '负：null ⇒ false')
ok(eventCarriesMaterialPre({}) === false, '负：无 id ⇒ false')

console.log('[E-5] 挑接续事件：优先 active，其次最近有检查点的')
const pickA = pickCarryEventPre([
  mkEv({ id: 'evt_a', status: 'closed', updatedAt: 900, checkpoints: [{}] }),
  mkEv({ id: 'evt_b', status: 'active', updatedAt: 100 }),
])
ok(pickA && pickA.id === 'evt_b', '★正：active 优先于更新的 closed（实测 ' + (pickA && pickA.id) + '）')
const pickB = pickCarryEventPre([
  mkEv({ id: 'evt_c', status: 'paused', updatedAt: 100, checkpoints: [] }),
  mkEv({ id: 'evt_d', status: 'paused', updatedAt: 500, checkpoints: [{}] }),
])
ok(pickB && pickB.id === 'evt_d', '★正：无 active ⇒ 取最近有检查点的')
ok(pickCarryEventPre([]) === null, '负：空列表 ⇒ null')
ok(pickCarryEventPre(null) === null, '负：null ⇒ null')
ok(pickCarryEventPre([mkEv({ id: '' })]) === null, '负：无 id 的事件被过滤')
const pickC = pickCarryEventPre([mkEv({ id: 'evt_x', status: 'active', updatedAt: 100 }), mkEv({ id: 'evt_y', status: 'active', updatedAt: 900 })])
ok(pickC.id === 'evt_y', '★正：同为 active ⇒ 取 updatedAt 大的')

console.log('[E-6] 源码接线守卫（结构性负路径：这几点必须真在 buildContinueCarry 里）')
const idxSrc = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const carryStart = idxSrc.indexOf('async buildContinueCarry')
const carryBody = idxSrc.slice(carryStart, carryStart + 40000)
ok(carryBody.includes('renderEventBindingPre(carryEvent)'), '★正：绑定块真接进 buildContinueCarry')
ok(carryBody.includes('headParts.push(binding)'), '★正：★绑定块进 **head 区**（永不截断）—— 进 bulk 等于材料一多就丢')
ok(!/bulkParts\.push\(binding\)/.test(carryBody), '★负：绑定块**不得**进 bulk（可截断区）')
ok(carryBody.includes('eventId: (carryEvent && carryEvent.id)'), '★正：返回值带 eventId')
ok(carryBody.includes('eventName: (carryEvent && carryEvent.name)'), '★正：返回值带 eventName')
// ★2026-10-24 变异测试抓出的**测试弱点**：首版用两个分开的 includes 判「事件进了硬门」，
//   但把 `!evMaterial &&` 从条件里删掉后，两个词仍各自都在 ⇒ 变异恒绿、等于没测。
//   改为**精确匹配整条判据行**（含三元条件全部三段），删任何一段必红。
ok(/if \(!plan && !ledger && !evMaterial && !\(pack && \(pack\.tailText/.test(carryBody), '★正：事件存在性并入接续硬门（整行精确匹配，删任一段必红）')
// 绑定块必须在 assembleCarryPre 调用之前 push（否则组装完再 push 等于没进材料）
const pushAt = carryBody.indexOf('headParts.push(binding)')
const asmAt = carryBody.indexOf('assembleCarryPre({')
ok(pushAt > 0 && asmAt > pushAt, '★正：绑定块在 assembleCarryPre **之前**入队（之后 push 等于没进材料）')

console.log('[E-7] 刷新仪式：第 0 步读回 eventId + 账本必须带 eventId')
const ritStart = idxSrc.indexOf('refreshRitualPrompt()')
const ritBody = idxSrc.slice(ritStart, ritStart + 2500)
ok(ritBody.includes('0. ★'), '★正：仪式有第 0 步（先确认事件归属）')
ok(ritBody.includes('scope=') && ritBody.includes('events'), '★正：第 0 步用 memory_recall(scope=events) 查回事件')
ok(ritBody.includes('memory_event(action=') && ritBody.includes('create'), '★正：查不到时给出建事件的明确动作')
ok(/账本首行必须写 eventId=/.test(ritBody), '★正：账本必须带 eventId（新会话认领的唯一凭据）')
ok(!/只做下面两件事/.test(ritBody), '★负：不得再写「两件事」（已扩为三件）')

console.log('[E-8] 材料指纹：event-aware + TODO 已修')
const stampStart = idxSrc.indexOf('async handoffMaterialStamp')
const stampBody = idxSrc.slice(stampStart, stampStart + 2200)
ok(stampBody.includes('V4_EVENT_STORE_FILENAME'), '★正：指纹含事件维度')
ok(stampBody.includes('checkpointCount'), '★正：指纹含检查点总数（抓同毫秒多次 append）')
ok(/fail-soft/.test(stampBody) || /catch \(e\)/.test(stampBody), '★正：事件维度失败 fail-soft（不得让指纹整体失效）')
ok(!/TODO\(separate\)/.test(stampBody), '★正：原 TODO（读错工作区）已消除')
ok(stampBody.includes('resolvePathsForSession'), '★正：按源会话解析路径（修掉跨工作区比较另一个目录的真 bug）')

console.log('[E-9] 水位骨架改写事件检查点（E-4）：事件优先、账本兜底')
const waterStart = idxSrc.indexOf('水位 ' + "'" + '%' + "'" + '（系统自动检查点')
const waterIdx = idxSrc.indexOf("kind: 'water'")
ok(waterIdx > 0, '★正：水位检查点 kind=water（可在 T2 渲染里被折叠）')
ok(idxSrc.slice(waterIdx - 300, waterIdx + 300).includes("sourceRef: 'auto:water'"), '★正：sourceRef=auto:water（可追溯是系统自动写的）')
ok(idxSrc.slice(waterIdx - 600, waterIdx + 600).includes('idemKey'), '★正：有 idemKey（同分钟幂等，防重复检查点）')
ok(/const r = _waterWrittenToEvent \? null : await this\.writeHandoffLedger/.test(idxSrc), '★正：事件写成功则跳过账本（消污染源），失败才兜底')
ok(idxSrc.slice(waterIdx - 1500, waterIdx + 1500).includes('fail-soft'), '★正：事件写入 fail-soft（不得阻塞接续）')

console.log('[E-10] planUpdatePending 写读错位（E-5）：必须写到 agent 的 runtime')
// 这是**实跑确认过的既有真 bug**：get state() 无 ALS 时落 default runtime，读取方在 withAgent 内。
const w1 = idxSrc.indexOf("const _stFinal1 = _stW1 || this.state")
ok(w1 > 0, '★正：checkWaterLevel 的置位改用 runtimeFor(agent).state（带旧口径兜底）')
ok(idxSrc.slice(w1 - 600, w1 + 200).includes('runtimeFor(agent)'), '★正：确实取了 runtimeFor(agent)')
const w2 = idxSrc.indexOf('const _stFinal2 = _stW2 || this.state')
ok(w2 > 0, '★正：markContinuedSession 的置位也修正了（只有 sid，走 runtimes 兜底）')
// 注意：读取端 `this.state.planUpdatePending = null`（取了就清）**是对的** —— 它必须清
// 当前 runtime 上的值；只有「置位」必须写到目标 runtime。所以只匹配非 null 的置位。
const pendHits = (idxSrc.match(/this\.state\.planUpdatePending = \{/g) || []).length
ok(pendHits === 0, '★负：不再有任何裸 this.state.planUpdatePending **置位**（实测 ' + pendHits + ' 处）')
ok(/this\.state\.planUpdatePending = null/.test(idxSrc), '★正：读取端清空保留（一次性语义不变）')

console.log('[E-11] 事件命名/格式与既有实现一致（防假承诺）')
const esSrc = readFileSync(path.join(ROOT, 'lib', 'event-store.js'), 'utf8')
ok(esSrc.includes("EVENT_STORE_FILENAME = 'event-store.json'"), '正：文件名与 E 批一致')
const evIdOk = /evt_/.test(esSrc)
ok(evIdOk, '正：事件 id 前缀 evt_')
ok(esSrc.includes("'water'") || esSrc.includes('kind'), '正：checkpoint 支持 kind 字段')

console.log('')
console.log('[E] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)