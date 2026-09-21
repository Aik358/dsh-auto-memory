// G4 (= M3) 验收: 白板纪律挂进**既有**注入机制 + 写记忆时提示维护白板。
//   用户原话:「开工有一个核心点, 就是白板的维护…每次写入记忆的时候, 也顺便维护一下白板。」
//   实测根因: GUIDANCE(:143) 对白板/PLAN/kind=plan/handoff **零覆盖**(七个关键词全 False)
//   ⇒ 模型从未被告知"存在白板这回事", 自然从不维护它。
//   ⚠️ 边界(文档 §2.3 硬约束): 零新增管线 / 不自动写盘 / 白板关时无副作用。
import { GUIDANCE, DEFAULT_PROMPT_LAYERS } from '../../lib/index.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

console.log('=== G4 白板纪律 + 写记忆时维护白板 ===')

// ─────────────────────────────────────────────────────────────
// G4-1..3 ★ 根因修复: GUIDANCE 的七个关键词全覆盖(实测前全 False)
// ─────────────────────────────────────────────────────────────
t('G4-1 ★ GUIDANCE 覆盖白板七个关键词(实测修复前全部 False —— 这就是白板腐烂的真因)', () => {
  const keys = ['白板', 'PLAN.md', 'kind=plan', 'kind=handoff', '账本', 'handoff-', '维护']
  const missing = keys.filter((k) => !GUIDANCE.includes(k))
  assert(missing.length === 0, '★ 缺失关键词: ' + missing.join(', '))
})

t('G4-2 ★ GUIDANCE 声明三层分工(白板=稳定事实 / 账本=动态状态唯一权威 / 笔记=可复用结论)', () => {
  assert(/白板纪律/.test(GUIDANCE), '须有「白板纪律」小节')
  assert(/稳定的/.test(GUIDANCE) || /稳定/.test(GUIDANCE), '须说明白板装"稳定"事实')
  assert(/动态状态的唯一权威/.test(GUIDANCE), '★ 须点明账本是动态状态的**唯一权威**(否则两者都会写"下一步"而漂移)')
  assert(/append-only/.test(GUIDANCE), '须说明账本 append-only(不追改旧账本)')
})

t('G4-3 ★ GUIDANCE 守住三条硬约束(条件触发 / 不自动删 / 白板关时跳过)', () => {
  assert(/条件触发，不是每轮|条件触发,\s*不是每轮/.test(GUIDANCE), '★ 须声明"条件触发, 不是每轮"(否则每轮都去重写白板)')
  assert(/不得删减|禁止.*删|不自动删/.test(GUIDANCE), '★ 须禁止未经同意删减白板内容')
  assert(/关闭时跳过|功能关闭/.test(GUIDANCE), '★ 须说明白板/产物关闭时跳过且不报错(零副作用)')
})

// ─────────────────────────────────────────────────────────────
// G4-4..5 G4c: 写记忆时顺带维护白板(用户核心诉求)
// ─────────────────────────────────────────────────────────────
t('G4-4 ★ memory_log_pre 的描述里加了"顺手维护白板"(用户原话: 每次写入记忆时也顺便维护)', () => {
  const i = SRC.indexOf("defineTool('memory_log_pre'")
  assert(i > 0, '应能找到 memory_log_pre 的 defineTool')
  const desc = SRC.slice(i, i + 2000)
  assert(/顺手维护白板/.test(desc), '★ 描述须含"顺手维护白板"')
  assert(/memory_note_pre/.test(desc), '须点明用哪个工具维护')
  assert(/kind=plan/.test(desc) && /kind=handoff/.test(desc), '★ 须分别说明 plan(重写白板)与 handoff(新开账本)两条路')
  assert(/条件触发,\s*不是每回都做/.test(desc), '须重申条件触发, 避免模型每回都重写')
})

t('G4-5 ★ 顺带维护=同一次回复内完成, 不新增管线(零新增注入通道)', () => {
  const i = SRC.indexOf("defineTool('memory_log_pre'")
  const desc = SRC.slice(i, i + 2000)
  assert(/同一次回复里顺带|同一次回复/.test(desc), '★ 须写明"同一次回复里顺带", 而非新开一轮')
  // 零新增管线: 没有为白板新加 pushPart / 新 context 面
  const g4Sites = (SRC.match(/顺手维护白板|白板纪律/g) || []).length
  assert(g4Sites >= 2, 'GUIDANCE 与工具描述各一处, 实为 ' + g4Sites)
})

// ─────────────────────────────────────────────────────────────
// G4-6 ★2026-09-20 用户裁定推翻原否决：铭文**恢复收尾自检正文**
//   - 原断言（否决）：铭文须保持裸标记，理由是"加散文=纯每轮成本"。
//   - 新裁定（用户原话）："记忆写入提醒必须固定在每轮收尾（尾部注入），不能只靠开头注入：
//     开头注入在长输出下会注意力丢失，收尾提醒是所有记忆插件必备的核心机制。"
//     并明确要求恢复**三大方向**：①写记忆文件 ②更新白板 ③长期记忆判断（含 skill 化）。
//   - 取证：铭文自 v0.1.30（fbc14fb, 2026-09-01）起即为空壳；v0.1.9（85d9340）的尾部正文
//     在那次重构中被固化进 renderMemoryStatic（system prompt，位置在最前）。
//   - 成本纪律仍然守：只列**方向 + 工具名 + 分类枚举**，不写解释性散文；详版留在
//     renderMemoryStatic（system prompt，不随对话增长）。实测约 420 字符。
//   - 缓存纪律：本段走 systemPrompt.context()（user-role，追加在历史尾部），不击穿前缀缓存。
// ─────────────────────────────────────────────────────────────
t('G4-6 ★【2026-09-20 用户裁定】铭文恢复收尾自检正文——三大方向齐备', () => {
  const m = SRC.match(/snapshotInscription: '([\s\S]*?)',\r?\n/)
  assert(m, '应能找到 snapshotInscription')
  const tpl = m[1]
  // 保留 {date} 占位（否则日期无法渲染）
  assert(/\{date\}/.test(tpl), '铭文须保留 {date} 占位, 实测为 ' + tpl)
  // ★ 三大方向（用户 2026-09-20 明确要求）
  assert(/memory_log_pre/.test(tpl), '★ 方向① 写记忆文件须点名 memory_log_pre')
  assert(/memory_note_pre\(kind=plan\)/.test(tpl), '★ 方向② 白板须点名 memory_note_pre(kind=plan)')
  assert(/memory_note_pre\(kind=handoff\)/.test(tpl), '★ 方向② 账本须点名 memory_note_pre(kind=handoff)')
  assert(/memory_procedure_pre/.test(tpl), '★ 方向③ 长期记忆须点名 memory_procedure_pre(技能库唯一模型入口)')
  // ★ 分类别丢（用户 2026-09-20 强调"不同分类希望他都不要丢掉"）
  for (const k of ['rule', 'preference', 'fact', 'todo']) {
    assert(new RegExp('\\b' + k + '=').test(tpl), '★ 分类枚举须含 ' + k)
  }
  // ★ 三态别丢（结论被取代的写法）——★T6 新增 retract 通道
  assert(/supersedes/.test(tpl), '★ 须提示 supersedes 标 superseded')
  assert(/retract/.test(tpl), '★ 须提示 retract 标 retracted(教训通路,此前模型完全写不了)')
  assert(/retractReason/.test(tpl), '★ 须提示 retractReason 说明错在哪')
  assert(/restore/.test(tpl), '★ 须提示 restore 撤回通道')
  // ★T6 看板 tag 命名约定（不写 tag 则看板泳道空列）
  for (const tag of ['type:goal', 'type:state', 'type:dead-end', 'type:progress']) {
    assert(tpl.includes(tag), '★ 看板 tag 须含 ' + tag)
  }
  // 成本纪律：不得写成散文长文。
  // ★2026-09-20 上限由 800 提到 1200：用户拍板「全量补上，不然没有大模型加持这些代码都是死代码」，
  //   新增了 retract/superseded 分工 与 看板 tag 两条**必需**内容（模型无此知识则对应功能永不触发）。
  //   实测约 950 字符 ≈ 475 token = injectBudgetChars(8000) 的 12%，仍在可接受区间；
  //   且本段走 systemPrompt.context()（不击穿前缀缓存），内容不变时 dsh-agent-loop project() 去重不加发。
  //   上限 1200 是"防继续膨胀"的护栏，不是精确预算——真要再加内容应先移到 renderMemoryStatic。
  assert(tpl.length <= 1200, '★ 铭文须守住每轮成本(≤1200 字符), 实测 ' + tpl.length)
})

t('G4-6b ★ 铭文与服务端逐字一致(镜像漂移守卫)', () => {
  // ⚠️ 不比源码字面量：两侧拼接缩进不同（服务端 4 空格 / 客户端 8 空格），
  //    字面比对必然误红。**取求值后的真实文本**再比 —— 这才是"用户实际看到的"。
  //    锚点：client.js 里 snapshotInscription 的下一个字段是 snapshotTail，用它划边界。
  const cliSrc = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
  const m = cliSrc.match(/snapshotInscription:\s*([\s\S]*?),?\s*\r?\n\s*snapshotTail:/)
  assert(m, '应能从 client.js 提取 snapshotInscription 表达式')
  // 去掉行间缩进与换行续接符（保留 `+` 连接符，否则字面量会粘连报语法错）。
  // ⚠️ 字符串内部的 `\n` 是**字面反斜杠+n**（两个字符），不会被 \r?\n 命中，安全。
  const expr = m[1].replace(/\r?\n\s*\+\s*/g, '+').trim().replace(/,$/, '')
  const cliVal = new Function('return ' + expr)()
  assert(typeof cliVal === 'string' && cliVal.length > 0, '客户端铭文求值应为非空字符串')
  const srv = DEFAULT_PROMPT_LAYERS.snapshotInscription
  assert(srv === cliVal, '★ 服务端与客户端铭文必须逐字一致（服务端 ' + srv.length + ' 字符 / 客户端 ' + cliVal.length + ' 字符）')
})

// ─────────────────────────────────────────────────────────────
// G4-6c ★T6 接线守卫：铭文只是"告诉模型能做"，**代码必须真能做**。
//   教训（2026-09-20 本轮变异演示暴露）：G4-6 只检查铭文文本里有 `retract` 字样，
//   把 `lib/index.js` 里真正的 `plan.retract` 处理循环删成 `for (const id of [])`
//   时套件**仍然全绿** —— 典型「断言太弱、路径未覆盖」。补这条：直接对 api 源码断言。
// ─────────────────────────────────────────────────────────────
t('G4-6c ★T6 retract 通道必须三处齐备(参数/描述/处理循环)——防"只改文案不改码"', () => {
  const api = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
  // ① 工具参数：模型看得见的入参
  assert(/retract:\s*\{\s*type:\s*'array'/.test(api), '★ memory_note_pre 须有 retract 数组参数')
  assert(/retractReason:\s*\{\s*type:\s*'string'/.test(api), '★ 须有 retractReason 说明参数')
  // ② 参数描述里必须讲清与 supersedes 的分工（否则模型会混用）
  assert(/与 supersedes 的分工/.test(api), '★ retract 描述须写明与 supersedes 的分工')
  // ③ 真正的处理循环（★变异靶点：删掉它必须变红）
  assert(/for \(const id of \(plan\.retract \|\| \[\]\)\)/.test(api), '★ 须存在 plan.retract 处理循环')
  assert(/applyStatusToRecordPre\(text, id, 'retracted'/.test(api), '★ 循环内须真的调 retracted 状态写入')
  // ④ 入口必须把 args.retract 传进 applyNoteStatusPre（否则参数是死的）
  assert(/plan\.retract|retract:\s*ret,/.test(api), '★ 调用侧须把 args.retract 透传进 applyNoteStatusPre')
  assert(/reason:\s*args\.retractReason/.test(api), '★ 调用侧须透传 retractReason')
})

// ─────────────────────────────────────────────────────────────
// G4-6d ★T6 静态纪律守卫：看板 tag 说明必须真在 renderMemoryStatic 里
// ─────────────────────────────────────────────────────────────
t('G4-6d ★T6 看板 tag 说明须真在静态纪律中(防"只加注释不加注入")', () => {
  // 只看 renderMemoryStatic 函数体，避免被文件别处的同名注释骗过
  const m2 = SRC.match(/renderMemoryStatic\(\)[\s\S]*?return neutralizePromptTemplateVars/)
  assert(m2, '应能提取 renderMemoryStatic 函数体')
  const body = m2[0]
  for (const tag of ['type:goal', 'type:state', 'type:dead-end', 'type:progress']) {
    assert(body.includes(tag), '★ 静态纪律须含看板 tag ' + tag)
  }
  assert(/5 条泳道/.test(body), '★ 须说明是 5 条泳道(此前模型只知 4 条)')
})

// ─────────────────────────────────────────────────────────────
// G4-7 无副作用: GUIDANCE 是常量, 不因 config 抛错
// ─────────────────────────────────────────────────────────────
t('G4-7 纯文本改动零运行时依赖(不读 config、不做 IO)', () => {
  // ⚠️ GUIDANCE 是**单行长字符串**(无换行) ⇒ 用 [\s\S] 而非 . 匹配, . 不跨行在此无害但更稳;
  //   注意本仓源文件是 **CRLF**, 故结尾用 \r?\n 而非 \n(教训: 写死 \n 会匹配不到)。
  const g = SRC.match(/export const GUIDANCE = '[\s\S]*?'\r?\n/)
  assert(g, '应能提取 GUIDANCE 常量')
  assert(!/this\.config|readFileSync|existsSync/.test(g[0]), 'GUIDANCE 不得引用 config 或做 IO')
})

const total = pass + fail
console.log('[g4-whiteboard] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
if (fail > 0) process.exit(1)
