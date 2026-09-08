#!/usr/bin/env node
/** [continue-chain] 一键接续 / 自动接续链路防回归(2026-09-08)。
 * 守卫随包发布的真实代码(lib/client.js):
 *   G1 exports.inject 声明 remote/remote.session(06fbd10:只加 package.json dsh.client.inject 不够,
 *      client 模块自身导出的 inject 数组也必须声明,否则 ctx.remote.session 不被接线)
 *   G2 extractSessionId 对官方 create 的多种返回形态(裸字符串 / {sessionId} / {id} / {value} /
 *      {ok,value:{sessionId}})都能正确取到会话 id(f475321/6a94794)
 *   G3 两个接续执行点(oneClickContinue + runAutoContinue)都经 extractSessionId 提取
 *      (防未来重构恢复成对象直取 created.sessionId)
 *   G4 两处 session.prompt 都携带 clientTimeZone(6a94794:缺它被 host 校验拒绝 'rejected request')
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

// —— G1:客户端模块自身导出声明 remote/remote.session ——
ok(SRC.includes("exports.inject = ['slots', 'sessions', 'remote', 'remote.session']"),
  'G1 exports.inject declares remote + remote.session (06fbd10)')

// —— G2:真实抽取 extractSessionId(花括号配平,同 smoke-test-extract-chunk-flood)并驱动 ——
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
const extractSessionId = new Function('return (' + extractFn('function extractSessionId(created) {') + ')')()
const cases = [
  [null, null, 'null'],
  ['sess-abc', 'sess-abc', 'bare string (官方实际形态)'],
  [{ sessionId: 's1' }, 's1', '{sessionId}'],
  [{ id: 's2' }, 's2', '{id}'],
  [{ value: 's3' }, 's3', '{value}'],
  [{ ok: true, value: { sessionId: 's4' } }, 's4', '{ok,value:{sessionId}}'],
  [{ ok: true, value: { id: 's5' } }, 's5', '{ok,value:{id}}'],
  [{ ok: true, value: { value: 's6' } }, null, '{ok,value:{value}} 不越界解析'],
  [42, null, 'number'],
]
for (const [input, expect, name] of cases) {
  ok(extractSessionId(input) === expect, 'G2 extractSessionId(' + name + ') => ' + String(expect))
}

// —— G3:两个执行点都经 extractSessionId ——
ok((SRC.match(/newId = extractSessionId\(created\)/g) || []).length === 2,
  'G3 both continue paths (oneClickContinue + runAutoContinue) use extractSessionId')

// —— G4:两处 session.prompt 都携带 clientTimeZone ——
ok((SRC.match(/clientTimeZone: amCtz/g) || []).length === 2,
  'G4 both session.prompt calls carry clientTimeZone (6a94794)')

console.log('\n[smoke-test-continue-chain] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)