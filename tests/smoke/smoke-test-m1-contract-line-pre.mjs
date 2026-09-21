/**
 * M1 · 契约行渲染（缺口 3）
 *
 * 背景：
 *   白板契约 §3 规定索引派生行格式
 *     `- [卡片标题](<页面路径>#mem_<32hex>) — 一句话摘要 · layer=whiteboard · status=current · 日期`
 *   但代码侧只渲染**纯文本**行，且 sidecar entry **没有 layer/status 字段** ⇒
 *   契约 §8「派生出 index 与 Tier-0 条目一致」无法成立。
 *
 * 设计（已定案，不新建独立文件 —— 那会新增状态源，违反 S10.4「不建状态机」）：
 *   **同一次派生、两种渲染**：
 *     · renderCatalogLinePre 无 path/id → 纯文本（**逐字节同旧**，老调用方零影响）
 *     · renderCatalogLinePre 有 path/id → 契约 §3 链接形态
 *     · sidecarEntryToCatalogItemPre 只做**字段映射**，不复制渲染逻辑
 *   ⇒ 两者出自同一份 entries、同一个渲染函数，一致性**天然成立**。
 *
 * 本套件锁定五件事：
 *   ① 兼容红线：无 path 时**逐字节同旧**（老套件 3 条断言不能变）
 *   ② 新形态：字段齐备时输出契约 §3 精确格式
 *   ③ fail-closed：id 形态非法 / 只有 path 无 id ⇒ 退回纯文本，**绝不产出坏链接**
 *   ④ 桥接：entry → catalog item 字段映射正确（含 date 从 ts 提取）
 *   ⑤ 契约 §8：**两种渲染字段一致**（同一份 entries 走两条路径，值必须相同）
 */
import fsMod from 'node:fs'
import {
  renderCatalogLinePre, TIER0_ANCHOR_ID_RE,
} from '../../lib/tier0-catalog-pre.js'
import {
  buildSidecarEntryPre, sidecarEntryToCatalogItemPre, WB_ANCHOR_LINE_RE_PRE_V1,
} from '../../lib/wb-sidecar-pre.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n) } }
const eq = (a, b, n) => ok(a === b, n + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const ID = 'mem_' + 'a'.repeat(32)
console.log('=== M1 · 契约行渲染 ===\n')

// ── 1. ★ 兼容红线：无 path ⇒ 逐字节同旧 ──────────────────────────
console.log('[1] ★ 兼容红线（老调用方零影响）')
{
  eq(renderCatalogLinePre({ layer: 'project', status: 'current', date: '2026-09-13', title: '甲', oneLine: '乙' }),
    '甲 · 乙 · project · current · 2026-09-13', '旧断言①逐字节不变')
  eq(renderCatalogLinePre({ layer: 'log', status: 'current', date: '', title: '甲', oneLine: '甲' }),
    '甲 · log · current', '旧断言②title===oneLine 不重复')
  eq(renderCatalogLinePre({ layer: 'user', status: 'current', date: '2026-08-14', title: '', oneLine: '丙' }),
    '丙 · user · current · 2026-08-14', '旧断言③无 title 不留空段')
  ok(!renderCatalogLinePre({ layer: 'log', status: 'current', title: 'T', oneLine: 'S' }).startsWith('- '),
    '无 path 时不带列表前缀')
  ok(!renderCatalogLinePre({ layer: 'log', status: 'current', title: 'T', oneLine: 'S' }).includes('layer='),
    '无 path 时不用 key=value 写法')
}

// ── 2. 新形态：契约 §3 精确格式 ──────────────────────────────────
console.log('\n[2] 契约 §3 链接形态')
{
  const line = renderCatalogLinePre({
    layer: 'whiteboard', status: 'current', date: '2026-09-14',
    title: '卡片标题', oneLine: '一句话摘要', path: 'handoff/PLAN.md', id: ID,
  })
  eq(line, `- [卡片标题](handoff/PLAN.md#${ID}) — 一句话摘要 · layer=whiteboard · status=current · 2026-09-14`,
    '★ 与契约 §3 示例逐字符相同')
  ok(line.startsWith('- '), '带列表前缀（契约格式以 "- " 开头）')
  ok(line.includes(' — '), '标题与摘要用 em-dash 分隔')
  ok(line.includes('layer=whiteboard'), 'layer 用 key=value 写法')
  ok(line.includes('status=current'), 'status 用 key=value 写法')

  // 无日期 ⇒ 不 trailing 分隔符
  const noDate = renderCatalogLinePre({
    layer: 'whiteboard', status: 'current', title: 'T', oneLine: 'S', path: 'handoff/PLAN.md', id: ID,
  })
  ok(!noDate.endsWith(' · '), '无日期时不遗留尾分隔符')
  eq(noDate, `- [T](handoff/PLAN.md#${ID}) — S · layer=whiteboard · status=current`, '无日期形态精确')

  // title 与 oneLine 相同 ⇒ 不重复
  const same = renderCatalogLinePre({
    layer: 'whiteboard', status: 'current', title: '同', oneLine: '同', path: 'h/X.md', id: ID,
  })
  eq(same, `- [同](h/X.md#${ID}) · layer=whiteboard · status=current`, 'title===oneLine 时不重复摘要')
}

// ── 3. ★ fail-closed：不产出坏链接 ───────────────────────────────
console.log('\n[3] ★ fail-closed（宁可纯文本，不产坏链接）')
{
  const bad = renderCatalogLinePre({ layer: 'whiteboard', status: 'current', title: 'T', oneLine: 'S', path: 'h/X.md', id: 'mem_zzz' })
  ok(!bad.includes(']('), 'id 形态非法 ⇒ 退回纯文本（无链接）')
  eq(bad, 'T · S · whiteboard · current', '退回纯文本的内容正确')

  const noId = renderCatalogLinePre({ layer: 'whiteboard', status: 'current', title: 'T', oneLine: 'S', path: 'h/X.md' })
  ok(!noId.includes(']('), '只有 path 无 id ⇒ 退回纯文本')

  const noPath = renderCatalogLinePre({ layer: 'whiteboard', status: 'current', title: 'T', oneLine: 'S', id: ID })
  ok(!noPath.includes(']('), '只有 id 无 path ⇒ 退回纯文本')

  const empty = renderCatalogLinePre({ layer: 'whiteboard', status: 'current', title: 'T', oneLine: 'S', path: '', id: '' })
  ok(!empty.includes(']('), '空 path/id ⇒ 退回纯文本')

  let threw = false
  try {
    renderCatalogLinePre(null); renderCatalogLinePre(undefined); renderCatalogLinePre('x'); renderCatalogLinePre(123)
  } catch (_) { threw = true }
  ok(!threw, '非法入参不抛（fail-soft）')
}

// ── 4. 桥接：entry → catalog item ────────────────────────────────
console.log('\n[4] 桥接 sidecarEntryToCatalogItemPre（只映射，不发明）')
{
  const entry = buildSidecarEntryPre({
    workspaceKey: 'wk_pre_m1', relPath: 'handoff/PLAN.md',
    text: '## 卡片标题\n<!-- memory:' + ID + ' -->\n这是正文的一句话。',
    title: 'PLAN', ts: '2026-09-18T10:00:00.000Z',
  })
  eq(entry.layer, 'whiteboard', 'entry.layer 恒为 whiteboard')
  eq(entry.status, 'current', 'entry.status 缺省 current')
  const override = buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'h/P.md', text: 'x', title: 'P', status: 'superseded' })
  eq(override.status, 'superseded', 'entry.status 可被覆盖')

  const item = sidecarEntryToCatalogItemPre(entry)
  eq(item.layer, 'whiteboard', 'item.layer ← entry.layer')
  eq(item.status, 'current', 'item.status ← entry.status')
  eq(item.id, entry.id, 'item.id ← entry.id（已是 mem_ 形态）')
  eq(item.path, entry.source, 'item.path ← entry.source')
  eq(item.title, entry.title, 'item.title ← entry.title')
  eq(item.oneLine, entry.preview, 'item.oneLine ← entry.preview（一句话摘要）')
  eq(item.date, '2026-09-18', '★ item.date 从 ts 提取日期部分')

  ok(TIER0_ANCHOR_ID_RE.test(entry.id), '★ entry.id 通过锚点形态判据')

  // 无 ts ⇒ 空日期，不编造
  const noTs = sidecarEntryToCatalogItemPre(buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'h/P.md', text: 'x', title: 'P' }))
  eq(noTs.date, '', '无 ts ⇒ 空日期（不编造）')

  // 非法入参 fail-soft
  let t2 = false
  try { sidecarEntryToCatalogItemPre(null); sidecarEntryToCatalogItemPre('x') } catch (_) { t2 = true }
  ok(!t2, '非法入参不抛')
}

// ── 5. ★ 契约 §8：两种渲染字段一致 ──────────────────────────────
console.log('\n[5] ★ 契约 §8「index 与 Tier-0 条目一致」')
{
  const docs = [
    { relPath: 'handoff/PLAN.md', text: '## 甲卡\n<!-- memory:' + ID + ' -->\n甲的一句。', title: 'PLAN', ts: '2026-09-14' },
    { relPath: 'handoff/handoff-2026-09-13.md', text: '## 乙卡\n正文。', title: 'handoff-x', ts: '2026-09-13' },
  ]
  for (const d of docs) {
    const entry = buildSidecarEntryPre(Object.assign({ workspaceKey: 'wk' }, d))
    const item = sidecarEntryToCatalogItemPre(entry)
    // 同一份 entry，走「渲染」路径拿到的字段
    const line = renderCatalogLinePre(item)
    // 断言：渲染行里的每个值都能在 entry 上找到出处（一致性）
    ok(line.includes(item.layer) || !line.includes('layer='), 'layer 值来自同一 entry')
    ok(line.includes(item.status) || !line.includes('status='), 'status 值来自同一 entry')
    if (item.id && TIER0_ANCHOR_ID_RE.test(item.id)) {
      ok(line.includes('#' + item.id), '★ 渲染行里的锚点 id 与 entry.id 一致')
      ok(line.includes('(' + item.path + '#'), '★ 渲染行里的路径与 entry.source 一致')
    } else {
      ok(!line.includes(']('), 'id 非法时不产链接（与 entry 状态一致）')
    }
  }

  // 反向：删掉 layer 字段 ⇒ 渲染退化，证明「一致性真的由字段驱动」
  const e2 = buildSidecarEntryPre({ workspaceKey: 'wk', relPath: 'handoff/PLAN.md', text: 'x', title: 'PLAN' })
  const i2 = sidecarEntryToCatalogItemPre(e2)
  const broken = Object.assign({}, i2, { id: '' })
  ok(!renderCatalogLinePre(broken).includes(']('), '★ 变异演示：拿掉 id ⇒ 链接消失（断言非空转）')
}

// ── 6. 常量一致性（防双源漂移）──────────────────────────────────
console.log('\n[6] 常量一致性')
{
  ok(TIER0_ANCHOR_ID_RE instanceof RegExp, 'TIER0_ANCHOR_ID_RE 已导出')
  ok(TIER0_ANCHOR_ID_RE.test(ID), '接受合法 mem_<32hex>')
  ok(!TIER0_ANCHOR_ID_RE.test('mem_' + 'A'.repeat(32)), '拒绝大写 hex（契约要求小写）')
  ok(!TIER0_ANCHOR_ID_RE.test('mem_' + 'a'.repeat(31)), '拒绝 31 位')
  ok(!TIER0_ANCHOR_ID_RE.test('mem_' + 'a'.repeat(33)), '拒绝 33 位')
  ok(!TIER0_ANCHOR_ID_RE.test('mem_' + 'a'.repeat(32) + ' '), '拒绝尾部空格')

  // 与 wb-sidecar 的锚点行正则同源（都锚定 memory: 前缀）
  // ★ 注意括号：`'a' + x + 'b'.match(re)` 里 `.match` 只绑到 `'b'`（. 优先级高于 +），
  //   必须写成 `('a' + x + 'b').match(re)`。此坑已踩过一次，结果是拿到
  //   `'<!-- memory:...null'`（字符串拼接把 null 转成了 "null"），追查成本很高。
  const lineRe = WB_ANCHOR_LINE_RE_PRE_V1
  const anchorLine = '<!-- memory:' + ID + ' -->'
  ok(lineRe.test(anchorLine), 'WB_ANCHOR_LINE_RE 匹配标准锚点行')
  const m = anchorLine.match(lineRe)
  ok(Array.isArray(m) && m[1] && TIER0_ANCHOR_ID_RE.test(m[1]),
    '★ 两处正则对同一 id 判定一致（防漂移）')
}

// ── 7. 源码级：不新建状态源 ──────────────────────────────────────
console.log('\n[7] 设计纪律：不新建独立文件（S10.4）')
{
  const fs = fsMod
  // ★ 必须先剥离注释再断言 —— 否则 JSDoc 里提到函数名/文件名会被误判为真实调用。
  //   （与 R3 的裸 join 断言同源问题：注释误伤会制造假阳性，久了断言就被当噪音忽略。）
  const stripComments = (src) => {
    let out = '', inBlock = false
    for (const raw of src.split(/\r?\n/)) {
      let code = raw
      if (inBlock) {
        const close = code.indexOf('*/')
        if (close < 0) { out += '\n'; continue }
        code = code.slice(close + 2); inBlock = false
      }
      code = code.replace(/\/\*[\s\S]*?\*\//g, '')
      const open = code.indexOf('/*')
      if (open >= 0) { code = code.slice(0, open); inBlock = true }
      code = code.replace(/\/\/.*$/, '')
      out += code + '\n'
    }
    return out
  }

  const CAT_RAW = fs.readFileSync('lib/tier0-catalog-pre.js', 'utf8')
  const SIDE_RAW = fs.readFileSync('lib/wb-sidecar-pre.js', 'utf8')
  const CAT = stripComments(CAT_RAW)
  const SIDE = stripComments(SIDE_RAW)

  ok(CAT_RAW.includes('TIER0_ANCHOR_ID_RE'), 'tier0-catalog 定义锚点判据')
  ok(SIDE_RAW.includes('sidecarEntryToCatalogItemPre'), '★ wb-sidecar 导出桥接函数')
  ok(SIDE_RAW.includes("layer: 'whiteboard'"), '★ layer 在 sidecar 内硬编码（不接受调用方自由值）')
  ok(!SIDE.includes('renderCatalogLinePre'), '★ 桥接函数**不复制**渲染逻辑（渲染口径只有一处）')
  ok(!CAT.includes('wb-sidecar'), '★ tier0-catalog 不反向依赖 wb-sidecar（无循环耦合）')

  // 反向自检：证明剥离逻辑本身有效（否则上面两条可能是空转）
  ok(SIDE_RAW.includes('renderCatalogLinePre') && !SIDE.includes('renderCatalogLinePre'),
    '★ 剥离有效：原文含该词（JSDoc），剥离后不含 ⇒ 上面断言非空转')
}

console.log('\n=== M1-contract-line: PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exitCode = 1
