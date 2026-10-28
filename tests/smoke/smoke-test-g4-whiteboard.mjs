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
  // 2026-10-27 判据更新（用户裁定 Q3「白板 = 事件的投影视图」落地）：旧判据守「白板=稳定事实+手写」
// 是已被推翻的旧决策 ⇒ 关键词 kind=plan 换成 fromEvents（新契约），其余六个不变。
const keys = ['白板', 'PLAN.md', 'fromEvents', 'kind=handoff', '账本', 'handoff-', '维护']
  const missing = keys.filter((k) => !GUIDANCE.includes(k))
  assert(missing.length === 0, '★ 缺失关键词: ' + missing.join(', '))
})

t('G4-2 ★ GUIDANCE 声明三层分工(白板=事件投影 / 账本=动态状态唯一权威 / 笔记=可复用结论)', () => {
  assert(/白板纪律/.test(GUIDANCE), '须有「白板纪律」小节')
  // 2026-10-27：白板语义由「稳定事实」改为「事件的投影视图」（用户裁定 Q3）
  assert(/投影视图|事件渲染/.test(GUIDANCE), '须说明白板是事件的投影视图（用户裁定 Q3），不是手写稳定事实')
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
t('G4-4 ★ memory_log 的描述里加了"顺手维护白板"(用户原话: 每次写入记忆时也顺便维护)', () => {
  const i = SRC.indexOf("defineTool('memory_log'")
  assert(i > 0, '应能找到 memory_log 的 defineTool')
  const desc = SRC.slice(i, i + 2000)
  assert(/顺手维护白板/.test(desc), '★ 描述须含"顺手维护白板"')
  assert(/memory_note/.test(desc), '须点明用哪个工具维护')
  assert(/kind=plan/.test(desc) && /kind=handoff/.test(desc), '★ 须分别说明 plan(重写白板)与 handoff(新开账本)两条路')
  assert(/条件触发,\s*不是每回都做/.test(desc), '须重申条件触发, 避免模型每回都重写')
})

t('G4-5 ★ 顺带维护=同一次回复内完成, 不新增管线(零新增注入通道)', () => {
  const i = SRC.indexOf("defineTool('memory_log'")
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
  //   ★2026-10-13 量法修正（本批复盘发现）：**旧写法从一开始就量错了对象** ——
  //   正则 `/snapshotInscription: '([\s\S]*?)',\r?\n/` 不是「解析字符串字面量」，它把
  //   源码里的拼接胶水（`\n'` + 换行 + 缩进 + `+ '`）与 `\n` 转义序列**一起截进来**，
  //   量到的是「源码文本」而不是「模型看到的内容」（实测差 74 字符，v3.2.15→v3.3.1 恒为 74）。
  //   现改为直接量 **DEFAULT_PROMPT_LAYERS 的求值结果**（本文件已 import），
  //   即模型每轮真正读到的字符数。所有内容断言（三大方向/分类/tag/三态）随之测真值。
  const tpl = DEFAULT_PROMPT_LAYERS.snapshotInscription
  assert(typeof tpl === 'string' && tpl.length > 800, '应能取到求值后的铭文（实测 ' + (tpl || '').length + ' 字符）')
  // 保留 {date} 占位（否则日期无法渲染）
  assert(/\{date\}/.test(tpl), '铭文须保留 {date} 占位, 实测为 ' + tpl)
  // ★ 三大方向（用户 2026-09-20 明确要求）
  assert(/memory_log/.test(tpl), '★ 方向① 写记忆文件须点名 memory_log')
  assert(/memory_note\(kind=plan\)/.test(tpl), '★ 方向② 白板须点名 memory_note(kind=plan)')
  assert(/memory_note\(kind=handoff\)/.test(tpl), '★ 方向② 账本须点名 memory_note(kind=handoff)')
  assert(/memory_procedure/.test(tpl), '★ 方向③ 长期记忆须点名 memory_procedure(技能库唯一模型入口)')
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
  // ★2026-10-12 上限由 1200 提到 1400：用户裁定「调大个一两百字……感知不强」。
// ★2026-09-20 上限由 800 提到 1200：用户拍板「全量补上，不然没有大模型加持这些代码都是死代码」，
  //   新增了 retract/superseded 分工 与 看板 tag 两条**必需**内容（模型无此知识则对应功能永不触发）。
  //   实测约 950 字符 ≈ 475 token = injectBudgetChars(8000) 的 12%，仍在可接受区间；
  //   且本段走 systemPrompt.context()（不击穿前缀缓存），内容不变时 dsh-agent-loop project() 去重不加发。
  //   ★2026-10-12 上限由 1200 提到 1400（用户裁定）：技能库**分工作区库/通用库**、写接口无 scope 等边界
  //   必须让模型在收尾位就知道（否则会误以为能选库）；实测 1244 字符（+63），仍在护栏内。
  //   ★2026-10-13 上限 1400 → 1500（#333②，同一用户裁定方向）：新增 snapshotInscriptionArchive 层（246 字符），
  //   铭文由「单层」变为「两层拼接渲染」。
  //   ⚠️ 同时修正了一个**假绿守卫**：旧断言只量单层 ⇒ 新增的 ⑦ 层完全不在被量范围内。现量两层拼接。
  //   ★2026-10-13 量法修正（#333② 复盘中发现的**系统性偏差**）：此前用**源码正则**截取字面量来量，
  //   而源码里的 `\n` 是**两个字符**（反斜杠+n）、求值后是**一个真换行**。实测该偏差恒为 74 字符
  //   （v3.2.15→v3.3.1 各版本一致），会让人误判「爆限额」。现统一改为**求值后口径**：
  //   直接量 DEFAULT_PROMPT_LAYERS（已 import 的求值结果），= 模型真正看到的字符数。
  assert(tpl.length <= 1500, '★ 铭文单层须守住成本(≤1500 字符), 实测 ' + tpl.length)
  // ★真正该守的是「模型每轮实际看到的铭文字符数」= 两层求值后拼接（含 ⑦ 归档层）。
  const archReal = DEFAULT_PROMPT_LAYERS.snapshotInscriptionArchive
  assert(typeof archReal === 'string' && archReal.length > 0, '应能取到 ⑦ 归档层（求值后非空）')
  const total = tpl + archReal
  assert(total.length <= 1500, '★ 铭文**渲染总量**须守住每轮成本(≤1500 字符, 含 Archive 层), 实测 ' + total.length)
  assert(total.length > tpl.length, '★ 总量必须 > 单层（防止 Archive 层被静默移除导致守卫失效）')
  assert(total.length + 1 <= 1500, '★ 计入 pushPart 前导 \\n 后仍须 ≤1500（真实交付给宿主的上限）')
})

/** 从 client.js 抽取 DEFAULT_PROMPT_LAYERS_CLIENT 并**求值**为真实对象（花括号配对，与键序解耦）。 */
function evalClientLayers() {
  const cliSrc = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
  const i = cliSrc.indexOf('var DEFAULT_PROMPT_LAYERS_CLIENT = {')
  assert(i >= 0, '应能从 client.js 定位 DEFAULT_PROMPT_LAYERS_CLIENT')
  const braceStart = cliSrc.indexOf('{', i)
  let depth = 0, end = braceStart
  for (let k = braceStart; k < cliSrc.length; k++) {
    if (cliSrc[k] === '{') depth++
    else if (cliSrc[k] === '}') { depth--; if (depth === 0) { end = k; break } }
  }
  return new Function('return ' + cliSrc.slice(braceStart, end + 1))()
}
t('G4-6b ★ 铭文与服务端逐字一致(镜像漂移守卫)', () => {
  // ⚠️ 不比源码字面量：两侧拼接缩进不同（服务端 4 空格 / 客户端 6 空格），字面比对必然误红。
  //   **取求值后的真实文本**再比 —— 这才是"用户实际看到的"。
  // ★2026-09-30（D3）：原实现用「下一个字段是 snapshotTail」当边界；D3 把客户端镜像补齐为与
  //   服务端**同一键序**的 23 层后，snapshotInscription 的下一个键变成 snapshotSlimNote ⇒ 旧假设失效。
  //   现改为复用下面 G4-6d 的通用抽取（按花括号配对整块求值），与键序彻底解耦。
  const cliObj = evalClientLayers()
  const cliVal = cliObj.snapshotInscription
  assert(typeof cliVal === 'string' && cliVal.length > 0, '客户端铭文求值应为非空字符串')
  const srv = DEFAULT_PROMPT_LAYERS.snapshotInscription
  assert(srv === cliVal, '★ 服务端与客户端铭文必须逐字一致（服务端 ' + srv.length + ' 字符 / 客户端 ' + cliVal.length + ' 字符）')
})

t('G4-6d ★ 提示词层镜像：客户端 27 层与服务端逐键逐字一致（D3 / 2026-09-30，2026-10-01 +2 层，2026-10-13 +1 层，2026-10-18 +1 层）', () => {
  // 用户裁定「设置页必须全量同步，不能有缺少」。此前客户端镜像只有 12 层，且 snapshotHead /
  // snapshotWelcomeBody 是截断版（46/49 字符 vs 服务端 302/149）⇒ 设置页「提示词层级」展示的
  // 内容与实际注入不符（用户以为某层没注入，实为镜像缺失）。
  // 判据：①键集完全相等；②逐键**求值后**的字符串逐字相等。
  const cliObj = evalClientLayers()
  const srvKeys = Object.keys(DEFAULT_PROMPT_LAYERS)
  const cliKeys = Object.keys(cliObj)
  // ★2026-10-18（注入交付根治）：26 → 27 —— 精简版新增 snapshotSlimMaintain（记忆维护底线）层，
  //   服务端与客户端镜像**同一提交内同步补齐**（无漏钉）。
  // ★2026-10-13（#333②）：25 → 26 —— 新增 snapshotInscriptionArchive（归档取回通道）层，
  //   服务端与客户端镜像**同步新增**（本次同一提交内补齐，无漏钉）。
  assert(srvKeys.length === 27, '服务端层数应为 27（实测 ' + srvKeys.length + '）')
  const missing = srvKeys.filter((k) => !cliKeys.includes(k))
  const extra = cliKeys.filter((k) => !srvKeys.includes(k))
  assert(missing.length === 0, '★ 客户端缺失层: ' + missing.join(', '))
  assert(extra.length === 0, '★ 客户端多出层: ' + extra.join(', '))
  const drift = []
  for (const k of srvKeys) {
    if (typeof cliObj[k] !== 'string') { drift.push(k + '(非字符串)'); continue }
    if (cliObj[k] !== DEFAULT_PROMPT_LAYERS[k]) drift.push(k + '(服务端 ' + String(DEFAULT_PROMPT_LAYERS[k]).length + ' vs 客户端 ' + cliObj[k].length + ' 字符)')
  }
  assert(drift.length === 0, '★ 逐字漂移: ' + drift.join('; '))
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
  assert(/retract:\s*\{\s*type:\s*'array'/.test(api), '★ memory_note 须有 retract 数组参数')
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
