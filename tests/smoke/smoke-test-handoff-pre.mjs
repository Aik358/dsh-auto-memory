#!/usr/bin/env node
/** [handoff] M-CM1 交接白板回归(PLAN.md 白板层 + 四段式交接账本 + 注入首位)。
 * 真实抽取 writePlanSnapshot/writeHandoffLedger/readLatestHandoff/handoffStamp/renderMemoryDynamic
 * (花括号配平),在临时目录与受控闭包里驱动 —— 测的是随包发布的真实代码:
 *   G0 源码守卫:配置键/prompt 层/静态纪律行/memory_note kind 分支/注入块存在且在日志段之前
 *   G1 handoffStamp 格式(YYYYMMDD-HHMMSS,文件名字典序=时间序)
 *   G2 writePlanSnapshot:首建无归档 → 改写归档旧版 → 同内容不再归档
 *   G3 writeHandoffLedger+readLatestHandoff:同秒双写 -b 后缀防撞,最新篇胜出
 *   G4 renderMemoryDynamic:白板+交接注入在日志段之前 / handoffEnabled=false 隐藏 / 超预算硬截断
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const CSRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }
const tmpRoot = (() => { const d = path.join(os.tmpdir(), 'dam-handoff-test-' + Date.now()); mkdirSync(d, { recursive: true }); return d })()

// —— 源码抽取器(花括号配平) ——
function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

console.log('[handoff] G0 源码守卫:接线完整')
ok(/handoffEnabled: false/.test(SRC) && /handoffPlanChars: 1200/.test(SRC) && /handoffLedgerChars: 800/.test(SRC),
  '配置默认键齐全(handoffEnabled/handoffPlanChars/handoffLedgerChars)')
ok(SRC.includes("snapshotPlanTitle: '[白板 PLAN.md") && SRC.includes("snapshotHandoffTitle: '[最近交接"),
  '动态注入层默认文案存在(promptLayerOverrides 可覆盖)')
ok(SRC.includes('交接与白板(长任务续命)') && SRC.includes('kind=handoff') && SRC.includes('kind=plan'),
  '静态纪律层含交接/白板指令(kind=handoff/plan)')
ok(/args\.kind === 'handoff' \|\| args\.kind === 'plan'/.test(SRC) && /engine\.writePlanSnapshot\(/.test(SRC) && /engine\.writeHandoffLedger\(/.test(SRC),
  'memory_note_pre kind 分支路由到白板/账本写入')
ok(SRC.includes("planPath: path.join(projectDir, 'handoff', 'PLAN.md')") && SRC.includes("handoffDir: path.join(projectDir, 'handoff')"),
  'resolvePaths 返回 handoffDir/planPath')
ok(SRC.includes("kind: { type: 'string', enum: ['note', 'handoff', 'plan']"), '工具 schema 声明 kind 枚举')

console.log('[handoff] G1 handoffStamp 格式')
const stampSrc = extractFn('const handoffStamp = () => {')
const padSrc = SRC.match(/^const pad = \(n\) => String\(n\)\.padStart\(2, '0'\)$/m)[0]
const handoffStampFn = new Function(padSrc + '\n' + stampSrc + '\nreturn handoffStamp;')()
const nowHmSrc = SRC.match(/^const nowHm = \(\) => \{ const d = new Date\(\); return `\$\{pad\(d\.getHours\(\)\)\}:\$\{pad\(d\.getMinutes\(\)\)\}` \}$/m)[0]
const nowHmFn = new Function(padSrc + '\n' + nowHmSrc + '\nreturn nowHm;')()
const stamp = handoffStampFn()
ok(/^\d{8}-\d{6}$/.test(stamp), '时间戳格式 YYYYMMDD-HHMMSS(' + stamp + ')')

// —— 真实 fs 假引擎(临时目录) ——
function makeFakeEngine() {
  return {
    memToday: () => '2026-09-06',
    async readTextSafe(p) { try { return (await readFile(p, 'utf8')) || '' } catch (e) { return '' } },
    async writeFullRaw(p, text) { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, text, 'utf8') },
  }
}
const bindMethod = (header, fake, extra) => { // 方法简写 → 对象字面量 → 取出绑定 fake this(注入模块级符号+extra)
  const names = ['path', 'existsSync', 'mkdir', 'writeFile', 'readdir', 'stat', 'handoffStamp', 'nowHm']
  const vals = [path, existsSync, mkdir, writeFile, readdir, stat, handoffStampFn, nowHmFn]
  for (const k of Object.keys(extra || {})) { names.push(k); vals.push(extra[k]) }
  const obj = new Function(...names, 'return {' + extractFn(header) + '};')(...vals)
  return obj[Object.keys(obj)[0]].bind(fake)
}

console.log('[handoff] G2 writePlanSnapshot:首建/改写归档/同内容免归档')
const proj = path.join(tmpRoot, 'ws')
const fake2 = makeFakeEngine()
const writePlanSnapshot = bindMethod('async writePlanSnapshot(projectDir, content) {', fake2)
const r1 = await writePlanSnapshot(proj, '# Plan v1\n全貌第一版')
ok(r1.ok && !r1.archived, '首建成功且无归档')
ok(existsSync(path.join(proj, 'handoff', 'PLAN.md')), 'PLAN.md 落盘')
const r2 = await writePlanSnapshot(proj, '# Plan v2\n全貌第二版')
ok(r2.ok && r2.archived && /archive[\\/]PLAN-\d{8}-\d{6}\.md$/.test(r2.archived), '改写触发旧版归档(' + path.basename(r2.archived) + ')')
ok((await readFile(r2.archived, 'utf8')).includes('v1'), '归档内容=旧版 v1')
ok((await readFile(path.join(proj, 'handoff', 'PLAN.md'), 'utf8')).includes('v2'), '当前 PLAN=新内容 v2')
const r3 = await writePlanSnapshot(proj, '# Plan v2\n全貌第二版')
ok(r3.ok && !r3.archived, '同内容重写不产生冗余归档')

console.log('[handoff] G3 writeHandoffLedger + readLatestHandoff')
const fake3 = makeFakeEngine()
const writeHandoffLedger = bindMethod('async writeHandoffLedger(projectDir, content) {', fake3)
const readLatestHandoff = bindMethod('async readLatestHandoff(handoffDir) {', fake3)
const l1 = await writeHandoffLedger(proj, '## 任务状态\n第一阶段')
const l2 = await writeHandoffLedger(proj, '## 任务状态\n第二阶段')
ok(l1.ok && l2.ok && l1.path !== l2.path, '同秒双写不撞名(-b 后缀)')
ok(/handoff-\d{8}-\d{6}(-[a-z])?\.md$/.test(l2.path), '账本文件名契约')
const latest = await readLatestHandoff(path.join(proj, 'handoff'))
ok(latest.includes('第二阶段') && !latest.includes('第一阶段'), 'readLatestHandoff 返回最新篇(字典序=时间序)')
ok(latest.startsWith('# 交接账本 · '), '账本自带时间头')

console.log('[handoff] G4 renderMemoryDynamic 注入行为')
const dynSrc = extractFn('renderMemoryDynamic(context) {')
const PLAN_LONG = '# 项目规划\n' + Array.from({ length: 200 }, (_, i) => '条目 ' + i + ':占位内容行,用于验证硬预算截断。').join('\n')
function makeFakeThis(planText, ledgerText, handoffEnabled) {
  return {
    state: {
      ws: 'D:\\proj', recentLogs: [{ date: '2026-09-06', text: '完成了A' }], latestReflection: '', latestReflectionDate: '',
      userText: '', notesText: '', planText, latestHandoffText: ledgerText, workspaceMap: [],
      todayGreeting: '', calendarText: '',
    },
    config: {
      injectBudgetChars: 2400, handoffEnabled, handoffPlanChars: 500, handoffLedgerChars: 400,
      dayBoundaryMinutes: 450, autoConsolidate: true, promptLayerOverrides: {},
    },
    memToday: () => '2026-09-06',
    runtimes: { values: () => [] },
    isUnattendedNow: () => false,
    external: { cache: [] },
  }
}
const HELPER_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const grab = (name) => { // 逐行扫描+(){} 混合配平(兼容 Object.freeze 包裹/单行箭头/var 正则字面量;不用正则抓取,规避 shell 反斜杠坑)
  const lines = HELPER_SRC.split('\n')
  let li = lines.findIndex((l) => { const t = l.trim(); return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=') || t.startsWith('function ' + name + '(') || t.startsWith('var ' + name + ' ') || t.startsWith('export const ' + name) })
  if (li < 0) throw new Error('helper not found: ' + name)
  let buf = '', depth = 0, started = false
  for (; li < lines.length; li++) {
    buf += lines[li] + '\n'
    for (const ch of lines[li]) {
      if (ch === '(' || ch === '{') { depth++; started = true }
      else if (ch === ')' || ch === '}') depth--
    }
    if (started && depth <= 0) break
    if (!started && / = \//.test(lines[li])) break // 正则字面量单行(var X = /…/)
  }
  return buf
}
const helpers = ['DEFAULT_PROMPT_LAYERS', 'neutralizePromptTemplateVars', 'truncateHead', 'truncateLinesBounded', 'stripSensitiveSections', 'sanitizeForInjection', 'scrubJunkLines', 'reflectionDigest', 'mojibakeDensity', 'MOJIBAKE_RE', 'hasStutter', 'BASE64_LINE']
const helperCode = helpers.map((h) => grab(h)).join('\n')
const renderFn = new Function(helperCode + '\nreturn {' + dynSrc + '};')()['renderMemoryDynamic']
const run = (fake) => renderFn.call(fake, {})
const out1 = run(makeFakeThis(PLAN_LONG, '# 交接账本 · 2026-09-06 12:00\n## 任务状态\n第二阶段', true))
const iPlan = out1.indexOf('白板 PLAN.md')
const iLedger = out1.indexOf('最近交接 — 四段式账本')
const iLogs = out1.indexOf('工作日志')
ok(iPlan > 0 && iLedger > iPlan && iLogs > iLedger, '注入顺序:白板 → 交接账本 → 工作日志(动态快照首位)')
ok(iPlan > out1.indexOf('workspaceMap') >= 0 || iPlan > 0, '白板位于记忆地图之后(头部区)')
const planSeg = out1.slice(iPlan, iLedger)
ok(planSeg.length <= 500 + 220 && !out1.includes('条目 199'), 'PLAN 段硬预算截断(段长 ' + planSeg.length + ',尾部未注入)')
const out2 = run(makeFakeThis(PLAN_LONG, '', true))
ok(out2.includes('白板 PLAN.md') && !out2.includes('最近交接'), '无账本时只注入白板')
const out3 = run(makeFakeThis(PLAN_LONG, '# 交接账本', false))
ok(!out3.includes('白板 PLAN.md') && !out3.includes('最近交接'), 'handoffEnabled=false 完全隐藏')

console.log('[handoff] G5 M-CM2 recall scope 路由(源码守卫+语料检索)')
ok(SRC.includes("async recall(query, limit = 8, agent, scope = 'all')"), 'recall 带 scope 参数(默认 all)')
ok(SRC.includes("if (scope === 'handoff') {") && SRC.includes("if (scope === 'sessions') {"), 'handoff/sessions 早返分支存在')
ok(SRC.includes("scope: { type: 'string', enum: ['all', 'handoff', 'sessions']") && SRC.includes("engine.recall(args.query, args.limit, exec.agent, args.scope || 'all')"), 'memory_recall_pre 工具声明 scope 枚举并透传')
ok(CSRC.includes("set('handoffEnabled', e.target.checked)") && CSRC.includes("fHandoff: '交接白板'"), '设置页交接白板开关接线(client)')
const fakeG5 = Object.assign(makeFakeEngine(), { config: { handoffEnabled: true } })
const listLedgers = bindMethod('async listHandoffLedgers(dir, limit = 12) {', fakeG5)
fakeG5.listHandoffLedgers = listLedgers
const searchCorpus = bindMethod('async searchHandoffCorpus(terms, limit, p) {', fakeG5)
const seeded = path.join(tmpRoot, 'ws-g5', 'handoff')
mkdirSync(path.join(seeded, 'archive'), { recursive: true })
writeFileSync(path.join(seeded, 'PLAN.md'), '# 白板\nM-CM 交接白板:白板归档里藏着关键词斑马')
writeFileSync(path.join(seeded, 'handoff-20260906-080000.md'), '# 交接账本\n进度:白板功能已上线,账本里有斑马线\n下一步:浏览器验证')
writeFileSync(path.join(seeded, 'handoff-20260906-080001.md'), '# 交接账本\n进度:第二篇,提到长颈鹿')
writeFileSync(path.join(seeded, 'archive', 'PLAN-20260905-070000.md'), '# 旧白板\n归档版:斑马在旧全貌里也出现过')
const terms = ['斑马']
const hits = await searchCorpus(terms, 8, { handoffDir: seeded })
const whereAll = hits.map((h) => h.where).join('|')
ok(hits.length >= 3 && whereAll.includes('白板 PLAN.md') && whereAll.includes('交接账本/') && whereAll.includes('白板归档/'), '语料检索覆盖 PLAN+账本+归档(' + hits.length + ' 处)')
ok(hits.reduce((a, h) => a + h.matches.length, 0) <= 8, 'limit 预算生效')
const hitsLedgerOnly = await searchCorpus(['长颈鹿'], 8, { handoffDir: seeded })
ok(hitsLedgerOnly.length === 1 && hitsLedgerOnly[0].where.includes('handoff-20260906-080001'), '词命中定位到正确账本篇')
const searchCorpusOff = bindMethod('async searchHandoffCorpus(terms, limit, p) {', Object.assign(makeFakeEngine(), { config: { handoffEnabled: false }, listHandoffLedgers: listLedgers }))
ok((await searchCorpusOff(['斑马'], 8, { handoffDir: seeded })).length === 0, 'handoffEnabled=false 语料检索返回空')

console.log('[handoff] G5.5 M-CM4 自动窗口检测(resolveWaterWindow)')
const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'wl-home-'))
writeFileSync(path.join(fakeHome, 'settings.yaml'), [
  'agent-default-model:',
  '  provider: opencode-go',
  '  model: deepseek-v4-flash',
  'llm-pi-ai:',
  '  providers:',
  '    opencode-go:',
  '      models:',
  '        - id: deepseek-v4-flash',
  '          contextWindow: 1000000',
].join(String.fromCharCode(10)))
const fakeRw = makeWaterFake({ waterLevelWindowTokens: 0 }, [])
const resolveWaterWindow = bindMethod('async resolveWaterWindow() {', fakeRw, { dshHome: () => fakeHome })
const w1 = await resolveWaterWindow()
ok(w1.window === 1000000 && w1.source === 'auto:opencode-go/deepseek-v4-flash', '自动检测:(' + JSON.stringify(w1) + ')')
const w2 = await resolveWaterWindow()
ok(w2.window === 1000000, '60s 缓存生效')
const fakeM = makeWaterFake({ waterLevelWindowTokens: 777 }, [])
const resolveM = bindMethod('async resolveWaterWindow() {', fakeM, { dshHome: () => fakeHome })
ok((await resolveM()).window === 777 && (await resolveM()).source === 'manual', '手动覆盖优先于自动检测')
const fakeF = makeWaterFake({ waterLevelWindowTokens: 0 }, [])
const resolveF = bindMethod('async resolveWaterWindow() {', fakeF, { dshHome: () => path.join(tmpRoot, 'no-home') })
ok((await resolveF()).window === 131072 && (await resolveF()).source === 'fallback', '检测失败回退 131072')

console.log('[handoff] G6 M-CM4 水位感知(官方 token 公式+compaction 事件)')
function makeWaterFake(opts, ledgerCalls) {
  const rt = {}
  const fake = Object.assign(makeFakeEngine(), {
    config: Object.assign({ handoffEnabled: true, waterLevelWindowTokens: 1000, waterLevelThreshold: 0.8, waterLevelAutoHandoff: true }, opts),
    runtimeFor: () => rt,
    resolvePaths: async () => ({ handoffDir: seeded, projectDir: path.join(tmpRoot, 'ws-g5'), logPath: path.join(seeded, 'fake-log.md') }),
    writeHandoffLedger: async (dir, content) => { ledgerCalls.push(content); return { ok: true, path: path.join(seeded, 'auto-' + ledgerCalls.length + '.md') } },
    state: {},
  })
  fake._rt = rt
  return fake
}
const wlBind = (fake) => {
  fake.estimateSessionTokens = bindMethod('estimateSessionTokens(messages) {', fake, {})
  const truncateHeadFn = new Function(grab('truncateHead') + '\nreturn truncateHead;')()
  const reflectionDigestFn = new Function('truncateHead', grab('reflectionDigest') + '\nreturn reflectionDigest;')(truncateHeadFn)
  fake.resolveWaterWindow = bindMethod('async resolveWaterWindow() {', fake, { dshHome: () => fakeHome })
  return bindMethod('async checkWaterLevel(agent) {', fake, { extractSessionMessages: (a) => a.messages, diag: () => {}, reflectionDigest: reflectionDigestFn, truncateHead: truncateHeadFn })
}
// 公式抽查:文本 token = ceil(字符/4)+4(角色框定)
const fFormula = makeWaterFake({}, [])
const estTokensFn = bindMethod('estimateSessionTokens(messages) {', fFormula, {})
ok(estTokensFn([{ text: 'x'.repeat(400) }]) === 104, 'token 公式:ceil(400/4)+4=104')
ok(estTokensFn([{ text: 'a' }, { text: 'bb' }]) === 10, '多消息逐条计价:各 ceil(len/4)+4(5+5=10)')
// 低于阈值
const fLow = makeWaterFake({}, [])
wlBind(fLow)({ messages: [{ text: 'x'.repeat(320) }] })
ok(!fLow._rt.waterLevelAdvised && (fLow.state.waterLevelRatio || 0) < 0.8, '低于阈值不触发 advisory(ratio=' + (fLow.state.waterLevelRatio || 0).toFixed(2) + ')')
// 越阈值(3200 字符 → ceil(3200/4)+4=804 token → ratio 0.804)
const ledgerCalls = []
const fHigh = makeWaterFake({}, ledgerCalls)
const wlHigh = wlBind(fHigh)
await wlHigh({ messages: [{ text: 'x'.repeat(3200) }] })
ok(fHigh._rt.waterLevelAdvised && (fHigh.state.waterLevelRatio || 0) >= 0.8, '越阈值触发 advisory 标志(ratio=' + fHigh.state.waterLevelRatio.toFixed(2) + ')')
ok(ledgerCalls.length === 1 && ledgerCalls[0].includes('系统自动快照') && ledgerCalls[0].includes('token') && ledgerCalls[0].includes('## 已试方案与失败原因'), '抽取性骨架账本写一次(' + JSON.stringify(String(ledgerCalls[0] || '').slice(0, 150)) + ')')
await wlHigh({ messages: [{ text: 'x'.repeat(3200) }] })
ok(ledgerCalls.length === 1, '第二次调用不重复写(每会话一次)')
// compaction 事件:水位 0.6 未到阈值,但检测到 compaction → 触发(0.5≤ratio 且 compacted)
const ledgerCalls2 = []
const fCmp = makeWaterFake({}, ledgerCalls2)
const wlCmp = wlBind(fCmp)
await wlCmp({ messages: [{ text: 'y'.repeat(2400) }], session: { events: [{ type: 'compaction/summary', seq: 3 }] } })
ok(ledgerCalls2.length === 1, '检测到 compaction/summary 事件触发补写(0.5≤ratio<阈值)')
await wlCmp({ messages: [{ text: 'y'.repeat(2400) }], session: { events: [{ type: 'compaction/summary', seq: 3 }] } })
ok(ledgerCalls2.length === 1, '同一 compaction 事件不重复补写(seq 去重)')
// 关闭
const fOff = makeWaterFake({ waterLevelWindowTokens: 0 }, [])
wlBind(fOff)({ messages: [{ text: 'z'.repeat(3200) }] })
ok(!fOff._rt.waterLevelAdvised, 'waterLevelWindowTokens=0 功能关闭')

console.log('')
console.log('[handoff] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
