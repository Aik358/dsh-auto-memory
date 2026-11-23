import fs from 'node:fs'
import assert from 'node:assert/strict'

/**
 * 1.2 第5步（memory_conflict 工具）验收。
 *
 * 纪律：**真执行被测 handler**，不是源码字符串断言。
 *   做法：从 lib/index.js 抽出 tools.push(defineTool('memory_conflict', …)) 这一段**真实源码**，
 *   用桩注册器（defineTool/tools/engine/diag）跑一遍，拿回真正的 execute 函数再真调。
 *
 * 三道闸的语义（用户裁定 A+B 中的 B）：
 *   闸① list 只读；
 *   闸② resolve 默认 dryRun，返回 wouldRevoke 全文、**零写入**；
 *   闸③ 只有 confirm:true 才落盘，且必须写 resolvedBy=model（留审计痕迹）。
 */

const IX = fs.readFileSync('lib/index.js', 'utf8').split('\r\n').join('\n')
const start = IX.indexOf("tools.push(defineTool('memory_conflict',")
assert.ok(start > 0, '锚点：memory_conflict 定义必须存在（否则后续断言无意义）')
// 从该处起找到本次 push 的结束 "  }))"（缩进两空格，独占一行的收尾）
const endMark = '\n  }))'
const end = IX.indexOf(endMark, start)
assert.ok(end > start, '锚点：定义块必须有收尾')
const code = IX.slice(start, end + endMark.length)

let pass = 0
let fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + ((e && e.message) || e)) }
}

function makeStore(conflicts) {
  const calls = []
  return {
    calls,
    conflictCount: conflicts.length,
    pendingConflicts: () => conflicts.map((c) => ({ ...c })),
    getHighLikelihoodCount: () => conflicts.filter((c) => c.likelihood === 'high').length,
    resolveConflict: (id, choice, opts) => {
      calls.push({ id, choice, opts })
      return { ok: true, conflict: { conflictId: id, choice, resolvedBy: opts && opts.resolvedBy } }
    },
  }
}
function fixture() {
  return {
    conflictId: 'c1', scope: 'Workspace', subject: '服务', predicate: '端口',
    likelihood: 'high', likelihoodReason: 'distinct-claims',
    left: { factId: 'f1', object: '端口 3080', confirmedAt: 1000, sourceKind: 'explicit' },
    right: { object: '端口 8080', sourceKind: 'explicit' },
    detectedAt: 2000,
  }
}
/** 加载真实源码，返回真正的 execute 函数据 */
function loadTool(store, overrideCode) {
  const captured = []
  const fakeTools = { push: (x) => { captured.push(x); return x } }
  const fakeDefineTool = (name, desc, schema, fn) => ({ name, description: desc, parameters: { properties: schema }, execute: fn })
  // ★2026-11-09（同日续修）：conflictReminders 的**契约变了** ——
  //   原先它是 apply 内的块级 const，抽取式执行时必须作为**外部变量**注入同名参数；但那个块级 const
  //   实际上活得比块短，块外 6 处消费点全部抛 ReferenceError（memory_recall 整体失效、reflect 套件长期红）。
  //   真修后改为挂 engine._conflictReminders（块内定义、块外可读）⇒ 本桩随之改为挂在 engine 上。
  //   判据不变：仍断言「high 附一条提醒且只记一次」。
  const reminders = { calls: [], shouldRemind: () => true, markReminded: (id, sid) => { reminders.calls.push({ id, sid }); return 1 }, dropConflict: () => 0 }
  const fakeEngine = { _factStore: store, _conflictReminders: reminders, currentSessionId: () => 's-test' }
  const diag = () => {}
  // eslint-disable-next-line no-new-func
  new Function('tools', 'defineTool', 'engine', 'diag', overrideCode || code)(fakeTools, fakeDefineTool, fakeEngine, diag)
  assert.equal(captured.length, 1, '应恰好注册 1 个工具')
  return captured[0]
}

console.log('[闸①] list 只读')
t('★ list 返回待裁定冲突与档位计数，且 dryRun=true', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'list' }).then((r) => {
    assert.equal(r.ok, true)
    assert.equal(r.dryRun, true)
    assert.equal(r.pendingCount, 1)
    assert.equal(r.highLikelihoodCount, 1)
    assert.equal(r.conflictCount, 1)
    assert.equal(store.calls.length, 0, 'list 绝不得写盘')
    // ★2026-11-09（第6步接线）：high 会被投递提醒并记账，且只记一次
    assert.ok(r.reminder && r.reminder.items.length === 1, 'high 应附一条提醒')
    assert.equal(r.reminder.items[0].conflictId, 'c1')
  })
})

console.log('[闸②] resolve 默认 dryRun —— 零写入 + 摊开 wouldRevoke')
t('★ choice=right 未传 confirm ⇒ 返回 wouldRevoke 全文且**零写入**', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'right' }).then((r) => {
    assert.equal(r.ok, true)
    assert.equal(r.dryRun, true)
    assert.ok(r.wouldRevoke, 'wouldRevoke 必须有值')
    assert.equal(r.wouldRevoke.factId, 'f1', 'must 精确指向将被撤销的事实')
    assert.equal(r.wouldRevoke.object, '端口 3080')
    assert.equal(store.calls.length, 0, '★ dryRun 必须零写入')
    assert.ok(typeof r.effect === 'string' && r.effect.length > 0, '必须说明后果')
  })
})
t('choice=left ⇒ wouldRevoke=null（保留现有不撤销任何事实）', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'left' }).then((r) => {
    assert.equal(r.dryRun, true)
    assert.equal(r.wouldRevoke, null)
    assert.equal(store.calls.length, 0)
  })
})
t('负路径：confirm:"true"（字符串）不得当成 true 放行', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'right', confirm: 'true' }).then((r) => {
    assert.equal(r.dryRun, true, '字符串 "true" 不是 true')
    assert.equal(store.calls.length, 0)
  })
})

console.log('[闸③] confirm:true 才落盘，且留审计痕迹')
t('★ confirm:true ⇒ 真调 resolveConflict，resolvedBy 固定 model、note 透传', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'right', confirm: true, note: '用户说 8080 是正式端口' }).then((r) => {
    assert.equal(store.calls.length, 1, '必须恰好写一次')
    assert.equal(store.calls[0].id, 'c1')
    assert.equal(store.calls[0].choice, 'right')
    assert.equal(store.calls[0].opts.resolvedBy, 'model', '★ 必须标 model，好追责')
    assert.equal(store.calls[0].opts.resolvedNote, '用户说 8080 是正式端口')
    assert.equal(r.ok, true)
  })
})

console.log('[负路径]')
t('未知 conflictId ⇒ not-found 且零写入', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'nope', choice: 'left', confirm: true }).then((r) => {
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'not-found')
    assert.equal(store.calls.length, 0)
  })
})
t('非法 choice ⇒ invalid-choice 且零写入', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'middle', confirm: true }).then((r) => {
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'invalid-choice')
    assert.equal(store.calls.length, 0)
  })
})
t('未知 action ⇒ unknown-action', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'delete' }).then((r) => {
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'unknown-action')
  })
})
t('★ 反向对照：同一调用链下 confirm:true 必须成功（防"一律拒绝"也能绿）', () => {
  const store = makeStore([fixture()])
  const tool = loadTool(store)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'left', confirm: true }).then((r) => {
    assert.equal(r.ok, true)
    assert.equal(store.calls.length, 1)
  })
})

console.log('[契约]')
t('schema 四参数齐全（action/conflictId/choice/confirm/note）', () => {
  const tool = loadTool(makeStore([]))
  const p = tool.parameters.properties
  for (const k of ['action', 'conflictId', 'choice', 'confirm', 'note']) assert.ok(p[k], '缺参数 ' + k)
  assert.equal(p.confirm.type, 'boolean')
})

console.log('[MUT] 变异反向验证')
function mutate(src, from, to, tag) {
  const out = src.split(from).join(to)
  if (out === src) throw new Error('变异未生效: ' + tag)
  return out
}
t('★ 变异：删掉 dryRun 闸（confirm 判断改成恒落盘）⇒ 「零写入」断言必红', () => {
  const mutated = mutate(code, 'if (args.confirm !== true) {', 'if (false) {', 'dryRun gate')
  const store = makeStore([fixture()])
  const tool = loadTool(store, mutated)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'right' }).then((r) => {
    const caught = store.calls.length === 1
    console.log('  [dryRun 闸] 变异后写入次数=' + store.calls.length + ' => ' + (caught ? 'CAUGHT' : 'MISSED'))
    assert.equal(caught, true, '变异体必须把 dryRun 变成写盘（证明原断言测的是真行为）')
  })
})
t('★ 变异：resolvedBy 写成 user-panel ⇒ 审计归属断言必红', () => {
  const mutated = mutate(code, "resolvedBy: 'model',", "resolvedBy: 'user-panel',", 'resolvedBy')
  const store = makeStore([fixture()])
  const tool = loadTool(store, mutated)
  return tool.execute({ action: 'resolve', conflictId: 'c1', choice: 'left', confirm: true }).then(() => {
    const caught = store.calls[0].opts.resolvedBy === 'user-panel'
    console.log('  [审计归属] 变异后 resolvedBy=' + store.calls[0].opts.resolvedBy + ' => ' + (caught ? 'CAUGHT' : 'MISSED'))
    assert.equal(caught, true)
  })
})

await new Promise((r) => setTimeout(r, 50))
console.log('')
console.log('[memory-conflict-tool] pass=' + pass + ' fail=' + fail)
if (fail) process.exitCode = 1
