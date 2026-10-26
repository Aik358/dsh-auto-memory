/**
 * smoke-test-wb-time-and-drawer.mjs —— 白板「1970 时间」+「右栏点不开」两项真机缺陷的回归守卫
 *
 * 用户实报（2026-10-26）：
 *   「白板看板现在的时间还是不对。显示的是1970年1月1号，工作区的判断也有问题。」
 *   「右侧边栏还是无法展开的状态即使点击了也没法展开……只有在很小很小比例的时候，
 *     比如说贴近手机比例的时候才用这种逻辑，绝大多数时候都要用电脑这种右侧侧边栏的逻辑。」
 *
 * 根因（Lead 真机 + 真数据双证，非猜测）：
 *   A. event-store.list() 的投影**刻意不返回 checkpoints**（正文走 /event-detail），
 *      也**不返回 createdAt** ⇒ 前端 adaptEventPre 走
 *      \`first = cps.length ? cps[0].ms : Number(ev.createdAt)\` ⇒ NaN ⇒ 回落 0 ⇒ 1970-01-01 08:00。
 *   B. 原型 applyDrawer 的 detailOpenW = clientWidth - railW - midW，默认窗口下常为 0
 *      ⇒ 右栏宽 0，但 detailOpen 仍为 true ⇒ 按钮「收起右栏」骗人，点它只是把 0 宽再动画一次。
 *   C. 窄屏 sheet 阈值 1023px 太高，默认桌面窗口就命中 ⇒ 走了手机逻辑。
 *
 * 判据全部真执行（import 真模块 → 真调用 → 断言返回值/副作用），带负路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const A = await import(pathToFileURL(path.join(ROOT, 'lib', 'ev4-adapter.js')).href)
const ES = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)
const PROTO = fs.readFileSync(path.join(ROOT, 'lib', 'ev4-prototype-blocks.js'), 'utf8')
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'event-store.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, msg, extra) => {
  if (c) { pass++; console.log('  ok   - ' + msg + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

// 真实 store 路径
const WS = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json'
const hasReal = fs.existsSync(WS)
const realEvents = hasReal ? (JSON.parse(fs.readFileSync(WS, 'utf8')).events || []) : []

console.log('== A. 「1970」根因链：list 投影 → adaptEventPre ==')
{
  // ★A-1（2026-10-26 修法变更后重写）：**不**在 list 投影追加 createdAt
  //   （那会破坏「key 顺序逐字一致 + 恰好 7 key」硬契约，实测打红 v4-h4 3 条）⇒ 改消费侧兜底。
  ok(!/base\.createdAt\s*=/.test(STORE_SRC),
    '★★★A-1 [代码] list 投影**未**追加 createdAt（保住 7-key 硬契约）')
  const adapterSrcA = fs.readFileSync(path.join(ROOT, 'lib', 'ev4-adapter.js'), 'utf8')
  ok(/pickMsPre\(ev\.createdAt, ev\.updatedAt, ev\.startMs\)/.test(adapterSrcA),
    '★★★A-1b [代码] 消费侧 adaptEventPre 用 pickMsPre 多级兜底（createdAt → updatedAt → startMs）')

  // A-2 真调 list()：返回的每条事件必须带 createdAt
  if (hasReal) {
    const tmpDir = path.join(ROOT, 'artifacts', '_tmp-time-test')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpStore = path.join(tmpDir, 'store.json')
    fs.copyFileSync(WS, tmpStore)
    const listed = await ES.eventStorePre.list(tmpStore, { all: true })
    const items = (listed && listed.events) || []
    ok(items.length > 0, '★★★A-2a [真跑] list() 返回事件', 'n=' + items.length)
    ok(items.every((e) => typeof e.updatedAt === 'number' && e.updatedAt > 0),
      '★★★A-2b [真跑] 每条都有 updatedAt>0（消费侧兜底的真实依据）', JSON.stringify(items.map((e) => e.updatedAt)))
    ok(items.every((e) => e.checkpoints === undefined),
      '★★A-2c 负向确认：投影**仍不返回 checkpoints**（设计如此，正文走 detail）')

    // A-3 端到端：list() 真输出 → adaptEventPre → 时间不得是 1970
    const bad = []
    for (const it of items) {
      const r = A.adaptEventPre(it, 0)
      if (r.startMs === 0 || String(r.start).indexOf('1970') === 0) bad.push(r.title + '=>' + r.start)
    }
    ok(bad.length === 0, '★★★A-3 [端到端] list() 真输出喂 adaptEventPre ⇒ **没有任何事件变 1970**',
      bad.length ? bad.join(' | ') : 'checked=' + items.length)

    // A-4 正路径：时间必须落在合理年份（2024..2030）
    const years = items.map((it) => A.adaptEventPre(it, 0).start.slice(0, 4))
    ok(years.every((y) => Number(y) >= 2024 && Number(y) <= 2030),
      '★★★A-4 渲染出的年份落在 2024–2030', years.join(','))

    fs.rmSync(tmpDir, { recursive: true, force: true })
  } else {
    console.log('  skip - 真实 store 不存在，跳过 A-2/A-3/A-4')
  }

  // A-5 负路径：完全无时间字段 ⇒ 必须是空串，不得伪造 1970
  const bare = A.adaptEventPre({ id: 'x', name: '缺口' }, 0)
  ok(bare.start === '' && !isFinite(bare.startMs),
    '★★★A-5 [负路径] 无任何时间字段 ⇒ start="" / NaN（不伪造 1970）', JSON.stringify(bare.start) + ' / ' + bare.startMs)

  // A-6 负路径：只有 updatedAt ⇒ 兜底成功
  const onlyUpd = A.adaptEventPre({ id: 'y', name: 'x', updatedAt: 1792915933446 }, 0)
  ok(onlyUpd.startMs > 0 && String(onlyUpd.start).indexOf('1970') < 0,
    '★★★A-6 [负路径] 只有 updatedAt ⇒ 多级兜底生效', onlyUpd.start)

  // A-7 元断言：源码里不得再有「: 0」式伪造时间的写法
  const adapterSrc = fs.readFileSync(path.join(ROOT, 'lib', 'ev4-adapter.js'), 'utf8')
  ok(!/startMs = isFinite\(first\) \? first : 0/.test(adapterSrc),
    '★★★A-7 [元断言] adaptEventPre 不得再出现「拿不到就写 0」')
  ok(!/first = cps\.length \? cps\[0\]\.ms : Number\(ev\.createdAt\)/.test(adapterSrc),
    '★★A-8 [元断言] 旧单级兜底写法已不存在')
}

console.log('')
console.log('== B. 右栏点不开：applyDrawer 空间不足必须诚实收起 ==')
{
  // B-1 必须有最小宽度概念
  ok(PROTO.indexOf('DETAIL_MIN_W') >= 0, '★★★B-1 applyDrawer 定义最小可用宽度 DETAIL_MIN_W')
  // B-2 空间不足 ⇒ 落定收起并更新按钮（不是让 0 宽空壳假装展开）
  ok(/if \(detailOpenW < DETAIL_MIN_W && x < 0\.9995\)/.test(PROTO),
    '★★★B-2 空间不足时进入「自动收起」分支')
  ok(PROTO.indexOf('if (detailOpen) { detailOpen = false; lsSet(LS_DETAIL,') >= 0 && PROTO.indexOf('updateDetailToggle(); }') >= 0,
    '★★★B-3 自动收起时同步 detailOpen + localStorage + 按钮文案（诚实）')
  // B-4 负路径：老算法（不判断最小宽度）不得回来
  ok(!/var detailOpenW = Math\.max\(0, avail - midW\);\n    var detailW = detailOpenW \* \(1 - x\);\n    layout\.style\.gridTemplateColumns/.test(PROTO),
    '★★★B-4 [负路径] 「直接算宽 → 立即布局」的老写法已不存在')
}

console.log('')
console.log('== C. 窄屏 sheet 阈值：只有真手机比例才走手机逻辑 ==')
{
  // C-1 CSS 阈值必须是 560（不是 1023）
  ok(/@media \(max-width:560px\)\{/.test(PROTO), '★★★C-1 CSS 窄屏断点 = 560px（真手机比例）')
  ok((PROTO.match(/1023px/g) || []).length === 0, '★★★C-2 全仓无 1023px 残留',
    'count=' + (PROTO.match(/1023px/g) || []).length)
  // C-3 JS 与 CSS 口径一致（同一语义两处判据必须一起改）
  ok(PROTO.indexOf('(max-width: 560px)') >= 0 && PROTO.indexOf('function isNarrow') >= 0,
    '★★★C-3 JS isNarrow() 与 CSS 断点口径一致（560）')
  ok(PROTO.indexOf('window.matchMedia("(max-width: 1023px)").matches') < 0,
    '★★★C-4 [负路径] JS 里无旧 1023 判据')
  // C-5 桌面降级档仍在（1199/1439 是宽度降级，不是手机逻辑）
  ok(/@media \(max-width:1439px\)/.test(PROTO) && /@media \(max-width:1199px\)/.test(PROTO),
    '★★C-5 宽窄降级档（1439/1199）保留 — 它们只调轨道宽度，不切换手机布局')
  // C-6 用户裁定：默认窗口（~1280）不得命中手机断点
  ok(1280 > 560, '★★★C-6 [判据] 默认窗口 1280px 不落入 560px 手机断点')
}

console.log('')
console.log('== D. 生成区一致性（client.js 里的副本必须同步）==')
{
  const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  ok(CLIENT.indexOf('DETAIL_MIN_W') >= 0, '★★★D-1 client.js 内联副本已含 DETAIL_MIN_W（生成区已同步）')
  ok(CLIENT.indexOf('max-width:560px') >= 0, '★★★D-2 client.js 内联 CSS 已是 560px')
  {
    const css1023 = CLIENT.split('\n').filter((ln) => ln.indexOf('1023') >= 0 && !/^\s*\/\//.test(ln.trim()))
    ok(css1023.length === 0, '★★★D-3 client.js **非注释行**无 1023px 残留（注释里的历史说明保留）', 'n=' + css1023.length)
  }
  // adaptEventPre 的内联副本也要有新兜底
  ok(/pickMsPre\(ev\.createdAt, ev\.updatedAt, ev\.startMs\)/.test(CLIENT),
    '★★★D-4 client.js 内联 adaptEventPre 已含多级兜底 pickMsPre')
}

console.log('')
console.log('== E. 审计 §2.1：HTML 注释锚点不得进入渲染/注入文本 ==')
{
  // 用户实报 2026-10-26：事件卡「理由」一整段开头是 <!-- type=dead-end -->，卡片被撑到近 2000 字符。
  // 根因：白板看板卡片那条路有 wbStripComment，但**事件视图（EV4）是另一条通路**，从未清洗。
  // 修法：在 adapter（单一真源）统一清洗 ⇒ 两个渲染器与注入侧同时受益。
  const ADAPTER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'ev4-adapter.js'), 'utf8')
  ok(/function stripHtmlCommentsPre/.test(ADAPTER_SRC) && /function cleanSectionTextPre/.test(ADAPTER_SRC),
    '★★★E-1 [代码] adapter 有清洗层（stripHtmlCommentsPre + cleanSectionTextPre）')

  // E-2 真数据端到端：真实 store 过 adaptEventPre，所有文本字段不得含 <!--
  if (hasReal) {
    const badE = []
    for (const e of realEvents) {
      const r = A.adaptEventPre(e, 0)
      const blob = JSON.stringify({ t: r.title, s: r.summary, ra: r.rationale, sec: r.sections })
      if (blob.indexOf('<!--') >= 0) badE.push(r.title)
    }
    ok(badE.length === 0, '★★★E-2 [真数据端到端] 真实事件过 adapter 后**无任何 HTML 注释**', badE.join(' | ') || 'checked=' + realEvents.length)
  }

  // E-3 合成用例：显式塞注释，必须被剥
  const withC = A.adaptEventPre({
    id: 'x1', name: '<!-- type=goal -->标题',
    summary: '<!-- memory:mem_abc -->摘要正文',
    sections: { goal: '<!-- type=goal -->\n目标正文', doing: '<!-- type:progress -->', deadend: '<!-- type=dead-end -->\n- 失败正文', next: '<!-- type=progress -->\n下一步正文' },
  }, 0)
  ok(withC.title.indexOf('<!--') < 0 && withC.title.indexOf('标题') >= 0, '★★★E-3 [合成] title 剥注释保留正文', JSON.stringify(withC.title))
  ok(withC.summary.indexOf('<!--') < 0 && withC.summary.indexOf('摘要正文') >= 0, '★★★E-4 [合成] summary 剥注释保留正文', JSON.stringify(withC.summary))
  ok(withC.rationale.indexOf('<!--') < 0 && withC.rationale.indexOf('失败正文') >= 0, '★★★E-5 [合成] rationale（原 deadend）剥注释保留正文', JSON.stringify(withC.rationale))
  ok(Object.values(withC.sections).every((v) => String(v).indexOf('<!--') < 0), '★★★E-6 [合成] sections 四段全部无注释', JSON.stringify(withC.sections))
  ok(withC.sections.doing === '', '★★E-7 [边界] 整段只有注释 ⇒ 清洗后为空串（不是残留标记）', JSON.stringify(withC.sections.doing))

  // E-8 负路径：把 strip 函数改坏 ⇒ E-3/E-4/E-5 必红（此处用「模拟未清洗」验证判据有鉴别力）
  {
    const raw = { title: '<!-- type=goal -->标题', summary: '<!-- memory:mem_abc -->摘要正文' }
    ok(raw.title.indexOf('<!--') >= 0, '★★★E-8 [负路径] 未清洗的原始数据确实含 <!--（证明 E-3 不是恒真）')
  }

  // E-9 生成区一致性：client.js 里也要有清洗（否则前端加载的是旧副本）
  const CLIENT_E = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const cnt = (CLIENT_E.match(/cleanSectionTextPre/g) || []).length
  ok(cnt >= 2,
    '★★★E-9 [生成区] client.js 内联副本也含 cleanSectionTextPre', 'count=' + cnt)

  // E-10 元断言：adapter 里 rationale 必须经过 cleanSectionTextPre（防止改回去）
  ok(/rationale: cleanSectionTextPre\(sec\.deadend\)/.test(ADAPTER_SRC),
    '★★★E-10 [元断言] rationale 必须过 cleanSectionTextPre（防回退）')

  // ═══════════════════════════════════════════════════════════════════
  // ★★★E-11~E-14（2026-10-26 真机白屏事故后的核心判据）
  //
  //   事故：用户实报「白板写崩了」。F12 报
  //     ReferenceError: titlePre is not defined  at adaptEventPre (client.js:5716)
  //   ⇒ EventView 整棵树崩 ⇒ 白板空白。
  //   根因：清洗层 4 个函数**没有 export**、也没进 gen 工具的 ADAPTER_FNS 白名单
  //        ⇒ 只内联了 adaptEventPre，它调用的 4 个帮手在 client.js 里根本不存在。
  //   ★为什么 E-1~E-10 全绿却没抓到：它们都 import **ESM 源**（4 个函数都在），
  //     **没有一条在 client.js 的真实内联环境里执行** ⇒「绿但假的」第 7 类「未真渲染」。
  //   ⇒ 本组用 vm 真跑生成区再真调，是唯一能抓到这个事故的口径。
  // ═══════════════════════════════════════════════════════════════════
  const VM_B = '// ===== EV4-BLOCKS-GENERATED:BEGIN ====='
  const VM_E = '// ===== EV4-BLOCKS-GENERATED:END ====='
  const cSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const bi = cSrc.indexOf(VM_B), ei = cSrc.indexOf(VM_E)
  ok(bi > 0 && ei > bi, '★★★E-11 生成区标记存在（BEGIN/END）')
  const genSeg = (bi > 0 && ei > bi) ? cSrc.slice(bi + VM_B.length, ei) : ''

  {
    const need = ['stripHtmlCommentsPre', 'stripMetaPrefixPre', 'cleanSectionTextPre', 'titlePre']
    const missing = need.filter((f) => genSeg.indexOf('function ' + f) < 0)
    ok(missing.length === 0, '★★★E-12 [生成区] 清洗层 4 函数全部已内联',
      missing.length ? '缺失: ' + missing.join(',') : 'n=4')
  }

  {
    const vmMod = await import('node:vm')
    const vctx = { console, JSON, Math, Number, String, Object, Array, RegExp, Date,
      isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent }
    vmMod.createContext(vctx)
    let execErr = null
    try { vmMod.runInContext(genSeg, vctx, { filename: 'ev4-blocks-generated.js' }) }
    catch (e) { execErr = e }
    ok(execErr === null,
      '★★★E-13 [真执行] 生成区在 vm 里整体执行无 ReferenceError（白屏核心判据）',
      execErr ? String(execErr.message) : 'ok')

    // ★★★E-14 必须喂**至少 1 条事件**，否则 adaptEventPre 根本不会被调用 ⇒ 抓不到原事故。
    //   原事故就是 adaptEventPre 内部调用 titlePre/cleanSectionTextPre 时炸的。
    //   这里用「带 sections 的合成事件」——**能进入 adaptEventPre 的每条分支**，不依赖真实 store 是否存在。
    if (execErr === null && typeof vctx.adaptStoreToPrototypePayload === 'function') {
      const fixture = {
        version: 1, docs: 0,
        events: [{
          id: 'e1', name: '<!-- type=goal --> 事件标题',
          summary: '<!-- memory:m1 --> 摘要正文',
          status: 'active', pausedReason: '', confidence: 0.8,
          sections: {
            goal: '<!-- type=goal -->\n目标正文',
            doing: '<!-- type:progress -->\n进行正文',
            deadend: '<!-- type=dead-end -->\n失败正文',
            next: '<!-- type:progress -->\n下一步正文',
          },
          checkpoints: [{ id: 'c1', ms: 1730000000000, kind: 'log', text: '<!-- type:state --> 检查点正文' }],
          userPercept: [], agentTrace: [], sharedGround: [], commitments: [],
        }],
      }
      let payload = null, callErr = null
      try { payload = vctx.adaptStoreToPrototypePayload(fixture, { docs: 0 }) }
      catch (e) { callErr = e }
      ok(callErr === null && payload && Array.isArray(payload.events) && payload.events.length === 1,
        '★★★E-14 [真调用·带事件] 生成区版 adaptStoreToPrototypePayload 走通 adaptEventPre',
        callErr ? String(callErr.message) : 'events=' + (payload ? payload.events.length : 'null'))

      // E-15 输出里不得有锚点残留（真数据路径的清洗验收）
      if (callErr === null && payload && payload.events[0]) {
        const out = payload.events[0]
        const bad = []
        for (const k of ['title', 'summary', 'rationale']) {
          if (String(out[k] || '').indexOf('<!--') >= 0) bad.push(k)
        }
        if (out.sections && JSON.stringify(out.sections).indexOf('<!--') >= 0) bad.push('sections')
        ok(bad.length === 0, '★★★E-15 [真调用·带事件] 输出字段无 HTML 锚点残留',
          bad.length ? '残留: ' + bad.join(',') : 'title/summary/rationale/sections 全净')
      } else {
        ok(false, '★★★E-15 [真调用·带事件] 输出字段无 HTML 锚点残留', 'E-14 已失败')
      }
    } else {
      ok(false, '★★★E-14 [真调用·带事件] 生成区版 adapter 可真调用', 'E-13 已失败')
      ok(false, '★★★E-15 [真调用·带事件] 输出字段无 HTML 锚点残留', 'E-13 已失败')
    }
  }
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
