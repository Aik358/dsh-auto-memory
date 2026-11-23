/**
 * smoke-test-issue478-diagnostic-fidelity.mjs —— issue #478 功能验收
 *
 * 背景（调查实证）：
 *   ① lib/diagnostic-error.js 的 ERROR_CODES 白名单只有 16 项，会话检索的
 *      SESSION_QUERY_SEARCH_DISABLED / SESSION_QUERY_INDEX_FAILED 都不在其中
 *      ⇒ 整码被丢弃，台账只剩 "type=unknown; message=[redacted]"。
 *   ② lib/degrade.js 的 persistDegradeLedgerPre 失败一律 return false，
 *      调用方分不清「没给 file / 没注入 fs / 目录建不了 / 写盘失败」。
 *
 * 本套件全部**真 import → 真构造 → 真调用 → 断言返回值**（CR-10），
 * 不拿"源码含某字符串"当功能证据。负路径用**真删/真改被测定义**实现，
 * 并先断言锚串恰命中 1 次（避免注释包住定义导致负路径恒绿）。
 *
 * 运行：node tests/smoke/smoke-test-issue478-diagnostic-fidelity.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  diagnosticErrorReasonPre,
  recordDiagnosticErrorPre,
  DIAGNOSTIC_DEBUG_ENV,
  DIAGNOSTIC_DEBUG_MESSAGE_MAX,
} from '../../lib/diagnostic-error.js'
import {
  persistDegradeLedgerPre,
  persistDegradeLedgerOkPre,
  persistDegradeLedgerResultPre,
  DEGRADE_PERSIST_REASONS_PRE_V1,
  DEGRADE_REASON_MAX_PRE_V1,
} from '../../lib/degrade.js'

let pass = 0
const fail = []
const t = (name, fn) => {
  try { fn(); pass += 1; console.log('  ok - ' + name) } catch (e) {
    fail.push({ name, e }); console.log('  FAIL - ' + name + ' :: ' + (e && e.message))
  }
}
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'dam-478-'))

// ── 调试态开关的帮助器：断言"关"与"开"两种态各自成立，且归还原值 ──────────
function withDebug(value, fn) {
  const saved = process.env[DIAGNOSTIC_DEBUG_ENV]
  try {
    if (value === undefined) delete process.env[DIAGNOSTIC_DEBUG_ENV]
    else process.env[DIAGNOSTIC_DEBUG_ENV] = value
    return fn()
  } finally {
    if (saved === undefined) delete process.env[DIAGNOSTIC_DEBUG_ENV]
    else process.env[DIAGNOSTIC_DEBUG_ENV] = saved
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n[A] 脱敏口径：code 白名单扩容（#478 主诉）')
// ══════════════════════════════════════════════════════════════════════

t('A1 SESSION_QUERY_SEARCH_DISABLED 不再被丢弃（默认脱敏态也保留 code）', () => {
  withDebug(undefined, () => {
    const e = Object.assign(new Error('whatever'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
    const r = diagnosticErrorReasonPre(e)
    assert.match(r, /code=SESSION_QUERY_SEARCH_DISABLED/, 'code 必须出现在 reason 里，实际: ' + r)
    assert.match(r, /message=\[redacted\]/, '默认态 message 必须仍被脱敏')
  })
})

t('A2 SESSION_QUERY_INDEX_FAILED 同样保留', () => {
  withDebug(undefined, () => {
    const e = Object.assign(new Error('x'), { code: 'SESSION_QUERY_INDEX_FAILED' })
    assert.match(diagnosticErrorReasonPre(e), /code=SESSION_QUERY_INDEX_FAILED/)
  })
})

t('A3 只有 message 含 code 时也能捞出来（旧行为不回归）', () => {
  withDebug(undefined, () => {
    const r = diagnosticErrorReasonPre(new Error('boom SESSION_QUERY_SEARCH_DISABLED here'))
    assert.match(r, /code=SESSION_QUERY_SEARCH_DISABLED/)
  })
})

t('A4 非白名单 code 仍被丢弃（白名单没被放开成"全收"）', () => {
  withDebug(undefined, () => {
    const e = Object.assign(new Error('x'), { code: 'TOKEN_SECRET_ABC' })
    const r = diagnosticErrorReasonPre(e)
    assert.doesNotMatch(r, /TOKEN_SECRET_ABC/, '非白名单 code 不得进 reason')
    assert.doesNotMatch(r, /code=/, '无合法 code 时不得出现 code= 段')
  })
})

t('A5 原白名单项仍工作（SESSION_QUERY_PERSISTENCE_FAILED）', () => {
  withDebug(undefined, () => {
    assert.match(diagnosticErrorReasonPre(new Error('SESSION_QUERY_PERSISTENCE_FAILED: private')),
      /code=SESSION_QUERY_PERSISTENCE_FAILED/)
  })
})

// ══════════════════════════════════════════════════════════════════════
console.log('\n[B] 调试态：开启才带 message，且截断 + 遮凭据')
// ══════════════════════════════════════════════════════════════════════

const longMsg = 'A'.repeat(500) + ' tail'
t('B1 关闭时不含 message 原文', () => {
  withDebug(undefined, () => {
    const r = diagnosticErrorReasonPre(new Error(longMsg))
    assert.match(r, /message=\[redacted\]/)
    assert.ok(!r.includes('AAAA'), '关闭态不得泄露 message 片段')
  })
})

t('B2 DSH_MEMORY_DEBUG=1 时带 message 且截断到 <= ' + DIAGNOSTIC_DEBUG_MESSAGE_MAX + ' 字符', () => {
  withDebug('1', () => {
    const r = diagnosticErrorReasonPre(new Error(longMsg))
    const m = /message=(.*)$/.exec(r)
    assert.ok(m, '开启态必须出现 message= 段, 实际: ' + r)
    const seg = m[1]
    assert.ok(seg.length <= DIAGNOSTIC_DEBUG_MESSAGE_MAX, 'message 段长度 ' + seg.length + ' 超过上限 ' + DIAGNOSTIC_DEBUG_MESSAGE_MAX)
    assert.ok(seg.startsWith('AAA'), '开启态应保留 message 开头')
  })
})

t('B3 开启态总长仍受 DEGRADE_REASON_MAX_PRE_V1 约束', () => {
  withDebug('1', () => {
    const r = diagnosticErrorReasonPre(new Error('B'.repeat(4000)))
    assert.ok(r.length <= DEGRADE_REASON_MAX_PRE_V1, 'reason 总长 ' + r.length + ' 超上限 ' + DEGRADE_REASON_MAX_PRE_V1)
  })
})

t('B4 Bearer 令牌必须被挡掉（含开启态）', () => {
  withDebug('1', () => {
    const r = diagnosticErrorReasonPre(new Error('call failed with Authorization: Bearer abc123XYZ secret'))
    assert.doesNotMatch(r, /abc123XYZ/, 'Bearer 令牌不得出现在 reason 里, 实际: ' + r)
    assert.match(r, /\[secret-redacted\]/, '应留下遮挡标记')
  })
})

t('B5 token= / password= 形状必须被挡掉', () => {
  withDebug('1', () => {
    for (const raw of ['token=tok_live_998877', 'password=hunter2pass', 'api_key=sk-abcdef123456']) {
      const r = diagnosticErrorReasonPre(new Error('fail ' + raw))
      const leaked = raw.split('=')[1]
      assert.ok(!r.includes(leaked), '凭据值 ' + leaked + ' 不得出现, 实际: ' + r)
    }
  })
})

t('B6 关闭态即使 message 含凭据也不泄露（默认强度不变）', () => {
  withDebug(undefined, () => {
    const r = diagnosticErrorReasonPre(new Error('Authorization: Bearer abc123XYZ'))
    assert.doesNotMatch(r, /abc123XYZ/)
    assert.match(r, /message=\[redacted\]/)
  })
})

t('B7 控制字符/换行被单行化（开启态也不得多行）', () => {
  withDebug('1', () => {
    const r = diagnosticErrorReasonPre(new Error('line1\nline2\r\nline3'))
    assert.doesNotMatch(r, /[\r\n]/, 'reason 必须是单行')
  })
})

t('B8 绝不落 stack（error.stack 即使被读取也不该进 reason）', () => {
  withDebug('1', () => {
    const e = new Error('with stack')
    e.stack = 'STACK_MARKER_XYZ'
    const r = diagnosticErrorReasonPre(e)
    assert.ok(!r.includes('STACK_MARKER_XYZ'), 'stack 不得进 reason')
  })
})

t('B9 恶意/畸形输入不抛（Getter 爆炸、Proxy、null、字符串）', () => {
  withDebug('1', () => {
    const hostile = [
      null, undefined, 'plain', 42,
      new Proxy({}, { get() { throw new Error('boom') } }),
      { name: 'evil\n'.repeat(1000), code: 'X', message: 'p'.repeat(10000) },
      { toString() { throw new Error('nope') } },
    ]
    for (const h of hostile) {
      assert.doesNotThrow(() => diagnosticErrorReasonPre(h))
      assert.ok(diagnosticErrorReasonPre(h).length <= DEGRADE_REASON_MAX_PRE_V1)
    }
  })
})

t('B10 非法开关值（0 / true / yes）不等于开启', () => {
  for (const v of ['0', 'true', 'yes', 'TRUE']) {
    withDebug(v, () => {
      assert.match(diagnosticErrorReasonPre(new Error('needle-visible')), /message=\[redacted\]/, 'v=' + v + ' 不应视为开启')
    })
  }
})

t('B11 recordDiagnosticErrorPre 仍 fail-soft（sink 抛错不影响调用方）', () => {
  assert.doesNotThrow(() => recordDiagnosticErrorPre({ record() { throw new Error('sink boom') } }, 'session-search', new Error('x')))
})

// ══════════════════════════════════════════════════════════════════════
console.log('\n[C] 落盘失败可区分：五种 reason')
// ══════════════════════════════════════════════════════════════════════

const snap = { schemaVersion: 'degrade_pre_v1', counts: { x: 1 }, recent: [] }

t('C1 不给 file → reason=no-file，且不抛', () => {
  for (const p of [{}, { file: '' }, { file: 123 }, null, undefined]) {
    let r
    assert.doesNotThrow(() => { r = persistDegradeLedgerResultPre(p) })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'no-file', '入参 ' + JSON.stringify(p) + ' 应报 no-file，实际 ' + r.reason)
  }
})

t('C2 不给 fs 函数 → reason=no-fs，且不抛', () => {
  const r = persistDegradeLedgerResultPre({ file: path.join(tmpRoot, 'a.json'), snapshot: snap })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no-fs')
  const r2 = persistDegradeLedgerResultPre({ file: path.join(tmpRoot, 'a.json'), snapshot: snap, mkdirSync: () => {} })
  assert.equal(r2.reason, 'no-fs', '只给 mkdirSync 仍应 no-fs')
})

t('C3 mkdir 抛错 → reason=mkdir-failed，且不抛', () => {
  const r = persistDegradeLedgerResultPre({
    file: path.join(tmpRoot, 'deep', 'b.json'), snapshot: snap,
    mkdirSync: () => { throw new Error('EACCES mkdir') }, writeFileSync: () => {},
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'mkdir-failed')
})

t('C4 writeFile 抛错 → reason=write-failed，且不抛', () => {
  const r = persistDegradeLedgerResultPre({
    file: path.join(tmpRoot, 'c.json'), snapshot: snap,
    mkdirSync: () => {}, writeFileSync: () => { throw new Error('ENOSPC write') },
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'write-failed')
})

t('C5 全正常 → reason=ok，且文件真的落盘', () => {
  const file = path.join(tmpRoot, 'ok', 'latest.json')
  const r = persistDegradeLedgerResultPre({ file, snapshot: snap, mkdirSync, writeFileSync })
  assert.equal(r.ok, true)
  assert.equal(r.reason, 'ok')
  assert.ok(existsSync(file), '文件应真实存在')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).counts, { x: 1 })
})

t('C6 reason 取值必在枚举内（五种全覆盖，无第六种）', () => {
  const file = path.join(tmpRoot, 'd.json')
  const seen = new Set()
  seen.add(persistDegradeLedgerResultPre({}).reason)
  seen.add(persistDegradeLedgerResultPre({ file, snapshot: snap }).reason)
  seen.add(persistDegradeLedgerResultPre({ file, snapshot: snap, mkdirSync: () => { throw new Error('x') }, writeFileSync: () => {} }).reason)
  seen.add(persistDegradeLedgerResultPre({ file, snapshot: snap, mkdirSync: () => {}, writeFileSync: () => { throw new Error('x') } }).reason)
  seen.add(persistDegradeLedgerResultPre({ file: path.join(tmpRoot, 'e.json'), snapshot: snap, mkdirSync, writeFileSync }).reason)
  for (const s of seen) assert.ok(DEGRADE_PERSIST_REASONS_PRE_V1.includes(s), 'reason ' + s + ' 不在枚举内')
  assert.equal(seen.size, 5, '五种 reason 应各出现一次，实际 ' + seen.size + ' 种: ' + [...seen].join(','))
})

t('C7 恶意 getter 也不抛（解构阶段炸掉 → 收口成结构化结果）', () => {
  const hostile = new Proxy({}, { get() { throw new Error('getter boom') } })
  let r
  assert.doesNotThrow(() => { r = persistDegradeLedgerResultPre(hostile) })
  assert.equal(r.ok, false)
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0)
})

// ══════════════════════════════════════════════════════════════════════
console.log('\n[D] 向后兼容：boolean 投影')
// ══════════════════════════════════════════════════════════════════════

t('D1 persistDegradeLedgerPre 成功 → 严格 === true（index.js:13855 依赖）', () => {
  const file = path.join(tmpRoot, 'compat', 'latest.json')
  const v = persistDegradeLedgerPre({ file, snapshot: snap, mkdirSync, writeFileSync })
  assert.equal(v, true, '旧名成功时必须严格等于 true，实际: ' + JSON.stringify(v))
  assert.equal(typeof v, 'boolean', '旧名必须仍返回 boolean，不得返回对象')
})

t('D2 persistDegradeLedgerPre 各种失败 → 严格 === false', () => {
  const file = path.join(tmpRoot, 'f.json')
  for (const p of [{}, { file }, { file, snapshot: snap, mkdirSync: () => { throw new Error('x') }, writeFileSync: () => {} }, { file, snapshot: snap, mkdirSync: () => {}, writeFileSync: () => { throw new Error('x') } }]) {
    const v = persistDegradeLedgerPre(p)
    assert.equal(v, false)
    assert.equal(typeof v, 'boolean')
  }
})

t('D3 persistDegradeLedgerOkPre 与 ResultPre.ok 逐例一致', () => {
  const file = path.join(tmpRoot, 'g.json')
  const cases = [
    {}, { file }, { file, snapshot: snap },
    { file, snapshot: snap, mkdirSync: () => { throw new Error('x') }, writeFileSync: () => {} },
    { file, snapshot: snap, mkdirSync: () => {}, writeFileSync: () => { throw new Error('x') } },
  ]
  for (const p of cases) {
    assert.equal(persistDegradeLedgerOkPre(p), persistDegradeLedgerResultPre(p).ok, '两种投影必须一致')
  }
})

t('D4 三个出口对同一入参口径一致（旧名 === OkPre）', () => {
  const file = path.join(tmpRoot, 'h.json')
  for (const p of [{}, { file }, { file, snapshot: snap, mkdirSync: () => { throw new Error('x') }, writeFileSync: () => {} }]) {
    assert.equal(persistDegradeLedgerPre(p), persistDegradeLedgerOkPre(p))
  }
})

// ══════════════════════════════════════════════════════════════════════
console.log('\n[E] 负路径：真删/真改被测定义，断言锚串恰命中 1 次')
// ══════════════════════════════════════════════════════════════════════

const libDir = new URL('../../lib/', import.meta.url)
const diagSrc = readFileSync(new URL('diagnostic-error.js', libDir), 'utf8')
const degradeSrc = readFileSync(new URL('degrade.js', libDir), 'utf8')

t('E1 负路径锚串唯一性（诊断模块：debug 开关判定行）', () => {
  const anchor = "return String((env && env[DIAGNOSTIC_DEBUG_ENV]) || '') === '1'"
  const hits = diagSrc.split(anchor).length - 1
  assert.equal(hits, 1, '锚串必须恰命中 1 次，实际 ' + hits + ' 次')
})

t('E2 负路径锚串唯一性（诊断模块：code 白名单注入点）', () => {
  const anchor = "'SESSION_QUERY_SEARCH_DISABLED',"
  const hits = diagSrc.split(anchor).length - 1
  assert.equal(hits, 1, '锚串必须恰命中 1 次，实际 ' + hits + ' 次')
})

t('E3 负路径：把脱敏改回无条件 [redacted] ⇒ B2 类断言必红', async () => {
  // 真删掉 "调试态才拼 message" 的那一行，用等价实现重建，再断言结果回落到旧行为。
  const anchor = 'const hit = wantDebug && message ? debugMessagePre(message, DIAGNOSTIC_DEBUG_MESSAGE_MAX) : \'\''
  const hits = diagSrc.split(anchor).length - 1
  assert.equal(hits, 1, '变异锚串必须恰命中 1 次，实际 ' + hits + ' 次')
  const mutated = diagSrc.replace(anchor, "const hit = ''")
  const mod = await import('data:text/javascript;base64,' + Buffer.from(
    mutated.replace("from './degrade.js'", "from '" + new URL('degrade.js', libDir).href + "'")
  ).toString('base64'))
  withDebug('1', () => {
    const r = mod.diagnosticErrorReasonPre(new Error('needle-should-be-invisible'))
    assert.match(r, /message=\[redacted\]/, '变异后必须回落到全脱敏')
    assert.ok(!r.includes('needle-should-be-invisible'), '变异后不得泄露 message')
  })
})

t('E4 负路径：把 reason 改回常量 false ⇒ C1..C5 必红', async () => {
  const anchor = "if (!file || typeof file !== 'string') return fail('no-file')"
  const hits = degradeSrc.split(anchor).length - 1
  assert.equal(hits, 1, '变异锚串必须恰命中 1 次，实际 ' + hits + ' 次')
  const mutated = degradeSrc.replace(anchor, "if (!file || typeof file !== 'string') return { ok: false, reason: 'false' }")
  const mod = await import('data:text/javascript;base64,' + Buffer.from(mutated).toString('base64'))
  assert.equal(mod.persistDegradeLedgerResultPre({}).reason, 'false', '变异后 reason 退化成常量')
  assert.ok(!DEGRADE_PERSIST_REASONS_PRE_V1.includes(mod.persistDegradeLedgerResultPre({}).reason),
    '变异后的 reason 必须掉出枚举（这正是 C6 会变红的原因）')
})

// ══════════════════════════════════════════════════════════════════════
try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
console.log('\n[issue478-diagnostic-fidelity] pass=' + pass + ' fail=' + fail.length)
if (fail.length) { for (const f of fail) console.log('  - ' + f.name + ' :: ' + (f.e && f.e.message)); process.exitCode = 1 }