/** 批次 Y · 前端生成器线（PR#212 #5 前端段 + PR#213 claim1/2/3 前端段）拆取验收。
 *  纯静态/VM 断言（CI 无浏览器）：四份同步语义 + migPickInto 三份一致 + #212 前端字段接线 + 共享草稿设施。
 *  浏览器矩阵（真实点击/水合）按审计方案要求在合并前另行人工跑（本套件不覆盖）。 */
/* 计数锁口径（2026-10-05 重钉）：F2/F6 钉在「四份同步后的真重生成产物」上 —— legacy 生成块
   由 frozen 源重建后，fAutoMargin 的 handoff 分区与 fJsExcerpt 的 disabled 新形态才进入产物；旧块少数 1。
   依据：真重生成 + node --check + --check SYNTAX/SYNC-OK + classic 哈希 a0460128 不变。
   同一口径同时适用于 F3（三面 × 两分区 = 6）；frozen look 分区于 2026-10-05 补回后重生成。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

const client = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const frozen = readFileSync(new URL('../../skins/legacy/iter5-325.js.frozen', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const views = readFileSync(new URL('../../skins/iter5/views.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const ui = readFileSync(new URL('../../skins/iter5/ui.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const panel = readFileSync(new URL('../../skins/iter5/native-panel.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let p = 0
const ok = (c, m) => { if (c) p++; else { assert.fail(m) } }
const cnt = (s, x) => s.split(x).length - 1

/* ── A. 共享草稿设施（手写区，三面共用真源） ── */
ok(cnt(client, 'var memoryNoteDrafts = Object.create(null)') === 1, 'A1 memoryNoteDrafts 唯一定义')
ok(cnt(client, 'function memoryDraftIdentity()') === 1, 'A2 memoryDraftIdentity 唯一定义')
ok(cnt(client, 'function submitMemoryOperation(kind, key, submitted, endpoint, payload)') === 1, 'A3 submitMemoryOperation 单出口')
ok(cnt(client, 'function useMemoryOperation(kind, key, apply)') === 1 && (cnt(client, "useMemoryOperation('note'") + cnt(client, "useMemoryOperation('calendar'")) >= 6, 'A4 useMemoryOperation 定义 1（工厂层）+ 三面接线 ≥6 处')
ok(cnt(client, 'function prepareSettingsPatch(patch)') === 1, 'A5 prepareSettingsPatch 唯一定义（保存唯一出口内归一化）')
ok(cnt(client, 'function TeamSecretInput(props)') === 1, 'A6 TeamSecretInput 唯一定义（密钥不明文回显）')
ok(client.includes("apiPost(API.config, prepareSettingsPatch(patch))"), 'A7 saveConfigPatch 经 prepareSettingsPatch')
ok(client.includes('var semanticReadGenerations = new WeakMap()'), 'A8 refreshSem 代次守卫（WeakMap）')
ok(client.includes("close: function () {\n        // ★批次 Y（#213 claim2）"), 'A9 面板 close() 前置草稿脏确认')
ok(cnt(client, "useMemoryOperation('note'") + cnt(client, "useMemoryOperation('calendar'") >= 6, 'A10 note/calendar 两通道订阅接线 ≥6 处（手写2 + 生成2 + frozen2）')

/* ── B. migPickInto 三份统一（PR#213 自带缺陷修复） ──
 * pr-213 在 frozen 份 migPickInto 回调加了 `if(!settingsAlive.current || request!==pickerRequest.current)return`，
 * 但 `request` 未声明（必抛 ReferenceError ⇒ 点「选择目录」按钮永久卡死）且 settingsAlive 属 sibling 组件。
 * 统一形态：各组件自持 migAlive ref 的幂等守卫 `if(!migAlive.current)return`。 */
const migFix = 'if(!migAlive.current)return'
ok(client.includes('var migAlive = useRef(true)'), 'B1 client migAlive ref 存在（手写 StorageTab + 生成变体 ×2）')
ok(cnt(client, migFix) >= 4, 'B2 client migAlive 守卫 ≥4 处（每份 then+catch ×2）')
ok(frozen.includes('var migAlive = useRef(true)'), 'B3 frozen migAlive ref 存在')
ok(cnt(frozen, migFix) >= 2, 'B4 frozen migAlive 守卫 ≥2 处')
// 负路径：PR#213 的缺陷守卫不得存在（任何一份都不行）
ok(cnt(client, 'request!==pickerRequest.current)return') === 9, 'B5 picker 代次守卫恰 9 处（6 处 openBrowser 代码 + 3 处 migPickInto 修复注释引用旧缺陷形态）')
ok(!frozen.includes('request!==pickerRequest.current)return') || cnt(frozen, 'request!==pickerRequest.current)return') === 3, 'B5b frozen openBrowser 守卫 3 处（合法形态）')
// migPickInto 函数体内不得引用 settingsAlive/pickerRequest（越组件引用 = 缺陷）
function fnBody(src, head) {
  const i = src.indexOf(head)
  if (i < 0) return ''
  let d = 0, started = false
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') { d++; started = true }
    else if (ch === '}') { d--; if (started && d === 0) return src.slice(i, k + 1) }
  }
  return src.slice(i, i + 2000)
}
const migBodies = []
let mi = 0
while ((mi = client.indexOf('function migPickInto(', mi)) >= 0) {
  migBodies.push(fnBody(client.slice(mi), 'function migPickInto('))
  mi += 10
}
let fi=0
let frozenFound=0
{
  const fsrc=frozen
  let k=fsrc.indexOf('function migPickInto(')
  if(k>=0){ migBodies.push(fnBody(fsrc.slice(k),'function migPickInto(')); frozenFound=1 }
}

ok(migBodies.length === 4 && frozenFound === 1, 'B6 migPickInto 4 份实现（手写 + 生成变体 + legacy 生成 + frozen 源；legacy≡frozen）')
for (let i = 0; i < migBodies.length; i++) {
  ok(!/settingsAlive|pickerRequest/.test(migBodies[i]), 'B7-' + i + ' migPickInto 不引用 sibling 组件的 settingsAlive/pickerRequest')
  ok(migBodies[i].includes(migFix), 'B8-' + i + ' migPickInto 挂 migAlive 幂等守卫')
}
// 行为一致性：三份的 migPickInto 函数体逐字一致（归一化缩进后）
const norm = (s) => s.split('\n').map((l) => l.replace(/^\s+/, '')).join('\n')
const bodies = migBodies.map(norm)
// frozen 版含额外注释行 ⇒ 仅比对可执行行
const code = (s) => s.split('\n').filter((l) => l && !l.startsWith('//')).join('\n')
ok(code(bodies[0]) === code(bodies[1]), 'B9 手写 StorageTab 与生成变体 migPickInto 逐字一致')
ok(code(bodies[0]) === code(bodies[2]), 'B10 手写 StorageTab 与 legacy 生成块 migPickInto 逐字一致')
ok(code(bodies[2]) === code(bodies[3]), 'B11 legacy 生成块与 frozen 源 migPickInto 逐字一致（镜像守恒）')

/* ── C. #212 前端字段接线（X2 服务端两字段必填） ── */
ok(cnt(client, 'expectedNotesPath') >= 6, 'C1 client expectedNotesPath 接线 ≥6（手写 NotesTab + 三份 Iter5Note + 生成/frozen）')
ok(cnt(client, 'noteSessionId') >= 6, 'C2 client noteSessionId 快照注入 ≥6')
ok(cnt(ui, 'noteSessionId') >= 2, 'C3 skins/iter5/ui.js 快照注入 noteSessionId')
ok(panel.includes('sessionId: state && state.noteSessionId'), 'C4 native-panel 面板笔记挂载带 sessionId')
ok(views.includes('expectedNotesPath:props.source'), 'C5 views.js Iter5Note 发 expectedNotesPath')
ok(frozen.includes('expectedNotesPath:props.source'), 'C6 frozen Iter5Note 发 expectedNotesPath')
ok(client.includes("submitMemoryOperation('note',identity,draft,API.note,{content:draft.trim(),sessionId:currentSessionIdClient(),expectedNotesPath:"), 'C7 经典 NotesTab 提交带 sessionId+expectedNotesPath')

/* ── D. 草稿作用域（#213 claim2） ── */
ok(client.includes('var memoryNoteDrafts') && frozen.includes('memoryNoteDrafts'), 'D1 frozen 复用共享草稿表')
ok(views.includes('iter5NoteDrafts = memoryNoteDrafts'), 'D2 变体 Iter5Note 复用共享草稿表')
ok(views.includes('calendarKey=memoryDraftIdentity()'), 'D3 变体 Iter5Calendar 草稿作用域')
ok(frozen.includes('calendarKey=memoryDraftIdentity()'), 'D4 frozen Iter5Calendar 草稿作用域')
ok(cnt(client, "h(NotesTab,{key:memoryDraftIdentity()})") === 1, 'D5 经典 NotesTab 按身份重挂')
ok(cnt(client, "h(CalendarTab,{key:memoryDraftIdentity()})") === 1, 'D6 经典 CalendarTab 按身份重挂')

/* ── E. 陈旧响应守卫（#212 claim5 / #213 claim3） ── */
ok(cnt(client, 'function i5ApplyConfig(d, request)') === 2, 'E1 两个 I5 实例各有 i5ApplyConfig')
ok(cnt(frozen, 'function i5ApplyConfig(d, request)') === 1, 'E2 frozen i5ApplyConfig')
ok(cnt(client, 'var request=++i5Read.current') === 2, 'E3 D2 广播重取带请求号 ×2')
// E4: frozen 源不含 D2 订阅（由生成器 d2Subscribe 步骤注入 legacy 生成块）——验证注入产物即可
ok(cnt(client, 'var request=++i5Read.current') === 2, 'E4 D2 广播重取带请求号 ×2（宿主面板 + 工作台页，legacy 块实例由生成器注入）')
ok(cnt(client, 'if (i5Busy.current) return') >= 4, 'E5 client busy 屏障 ≥4（set/setMany/oEMC/D2 ×2 实例）')
ok(cnt(client, 'i5AppliedRead.current=++i5Read.current;i5Busy.current=true') === 4, 'E6 save/onEngineModeChange 推进代次 ×4（两实例 × save/oEMC；legacy 块实例由 frozen 源携带同款）')
ok(cnt(frozen, 'i5AppliedRead.current=++i5Read.current;i5Busy.current=true') === 2, 'E7 frozen 推进代次 ×2')
ok(cnt(client, 'var gateOk = live.associativeMemoryEnabled === true') === 2, 'E8 gateOk 读生效基线 ×2（I5 实例）')
ok(cnt(frozen, 'var gateOk = live.associativeMemoryEnabled === true') === 1, 'E9 frozen gateOk 读生效基线')
ok(cnt(client, 'data-dam-effective-water') === 3, 'E10 生效水位读数 ×3')
ok(cnt(client, 'refreshSem(apply,function(){if(alive)setSem({loaded:true,ready:false})},setSem)') === 3, 'E11 refreshSem identity 接线 ×3')

/* ── F. 即时保存语义反馈（#213 claim1） ── */
ok(cnt(client, 'disabled: cfg.waterLevelThresholdMode !== \'fixed\'') === 3, 'F1 fWaterThreshold 仅固定模式可用 ×3')
ok(cnt(client, "min: 0.3, max: 1, step: 0.05, value: cfg.waterLevelAutoMargin") === 6, 'F2 fAutoMargin 钳制 0.3-1 恰 6（三面 × window/handoff 两分区：legacy 面此前缺 handoff 分区，重生成补上）')
ok(cnt(client, "value: typeof cfg.injectExcludeSources === 'string'") === 6, 'F3 排除来源持原始串恰 6（window 3 + look 2；look 经典/变体两行、frozen 一行）')
ok(cnt(client, "set('autoSummaryTimes', e.target.value)") === 3, 'F4 autoSummaryTimes 持原始串 ×3')
ok(cnt(client, 'fSlimPlanChars') === 0 && cnt(client, "set('slimPlanChars'") === 0, 'F5 死键 slimPlanChars 控件已摘除')
ok(cnt(client, 'disabled: cfg.jsDecideCandidateScheme !== \'custom\'') === 3, 'F6 fJsExcerpt 仅自定义方案可用 ×3（三面；legacy 面旧形态经重生成刷新为 disabled 新形态）')
ok(cnt(client, "白板模式（立即保存，需重启）") === 3, 'F7 白板模式标签注明立即保存+重启 ×3')
ok(cnt(client, "子代理模型 / 思考强度', 'Subagent model & reasoning effort'") === 3, 'F8 模型抽屉入口在 auto 分区 ×3')
ok(cnt(client, 'teamSecretAccessKey') >= 4, 'F9 团队密钥键接线（TeamSecretInput + 键表）')
ok(client.includes("L('待保存的团队开关：开', 'Team switch in this form: on')"), 'F10 团队开关读数改为「待保存」语义')
ok(cnt(client, "disabled: true }, L3('http 服务端") === 1, 'F11 http 传输不可新选（宿主未接线）')

/* ── G. 字典修正（分钟→轮 / 0=自动检测 / 0.3-1）三语齐全 ── */
ok(cnt(client, 'fAutoContinueHint: "默认关闭（仍在测试）') === 1, 'G1 zh fAutoContinueHint 修正')
ok(cnt(client, 'fAutoContinueHint: "Off by default (experimental)') === 1, 'G2 en fAutoContinueHint 修正')
ok(cnt(client, '"fAutoContinueHint": "既定はオフ（試験中）') === 1, 'G3 ja fAutoContinueHint 修正')
ok(cnt(client, 'fWaterWindowHint: "0 表示自动检测模型窗口') === 1, 'G4 zh fWaterWindowHint 修正')
ok(cnt(client, '"fWaterWindowHint": "0 はモデルのウィンドウを自動検出します') === 1, 'G5 ja fWaterWindowHint 修正')
ok(cnt(client, 'fAutoMarginHint: \'auto 档下水位判定的安全余量系数。范围 0.3-1，默认 0.9。\'') === 1, 'G6 zh fAutoMarginHint 修正')
ok(cnt(client, 'fAutoMarginHint: \'Safety margin factor for the auto water-level mode. 0.3-1, default 0.9.\'') === 1, 'G7 en fAutoMarginHint 修正')
ok(client.includes("'两次主动回忆的间隔（轮）', 'Minimum recall interval (turns)'"), 'G8 settings-copy fJsCooldown 分钟→轮')

/* ── H. 保存回执与固守（#213 claim7 合规佐证） ── */
ok(cnt(client, "setMsg(t('saved') + (d.migrated ? ' · ' + d.migrated : '') + (d.warning ? ' · ' + d.warning : ''))") === 2, 'H1 save 显示迁移/警告回执 ×2')
ok(cnt(frozen, "setMsg(t('saved') + (d.migrated ? ' · ' + d.migrated : '') + (d.warning ? ' · ' + d.warning : ''))") === 1, 'H2 frozen save 显示回执')

console.log('PASS batch-Y frontend acceptance: ' + p + ' assertions')
