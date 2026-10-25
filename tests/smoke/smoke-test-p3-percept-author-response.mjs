/**
 * smoke-test-p3-percept-author-response.mjs —— P3 percept 标签守卫
 *
 * 守三件事：
 *   ① authorResponse ⇒ 「作者回应」可读标签（用户要求「要加入作者回应这类内容」）
 *   ② 已知 stage/kind 也给中文
 *   ③ ★未知 kind **不得渲染成 undefined、不得丢失**（原样输出）
 *   ④ 变异：删掉 authorResponse 映射 ⇒ 判据必红
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = 'D:/dsh-auto-memory'
const CL = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   - ' + m + (x?' :: '+x:'')) } else { fail++; console.log('  FAIL - ' + m + (x?' :: '+x:'')) } }

function extractFn (src, name) {
  let idx = src.indexOf('function ' + name + '(')
  if (idx < 0) idx = src.indexOf('function ' + name + ' (')
  if (idx < 0) return null
  const o = src.indexOf('{', idx)
  let d = 1, i = o + 1, s = null, e = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (e) { e = false; continue }
    if (c === String.fromCharCode(92)) { e = true; continue }
    if (s) { if (c === s) s = null; continue }
    if (c === '"' || c === "'" || c === String.fromCharCode(96)) { s = c; continue }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { i++; break } }
  }
  return src.slice(idx, i)
}

// 抽 PERCEPT_TAG_LABELS + perceptTagOfPre（同一作用域）
const labelsSrc = (function () {
  const i = CL.indexOf('var PERCEPT_TAG_LABELS = {');
  if (i < 0) return null;
  const e = CL.indexOf('}', i);
  return CL.slice(i, e + 1) + ';';
})()
ok(!!labelsSrc, '★★① PERCEPT_TAG_LABELS 可抽取')
const fnSrc = extractFn(CL, 'perceptTagOfPre')
ok(!!fnSrc, '★★① perceptTagOfPre 可抽取')

const ctx = vm.createContext({})
vm.runInContext(labelsSrc + '\n' + fnSrc + ';globalThis.__T = perceptTagOfPre;', ctx)
const T = ctx.__T
ok(typeof T === 'function', '★★① 真执行得到函数')

console.log('');
console.log('== 1. authorResponse ⇒ 作者回应 ==');
ok(T({ kind: 'authorResponse', text: '他说这个方案不行' }) === '[作者回应] ', '★★★① authorResponse → [作者回应]', JSON.stringify(T({ kind: 'authorResponse' })))
ok(T({ stage: 'accepted', kind: 'authorResponse' }) === '[已确认] ', '★★① stage 优先于 kind（沿用原语义）', JSON.stringify(T({ stage: 'accepted', kind: 'authorResponse' })))

console.log('');
console.log('== 2. 已知 stage/kind 中文 ==');
const known = [['retrieved','被检索'],['delivered','已投递'],['used','已被采用'],['mentioned','被提到'],['accepted','已确认'],['preference','偏好'],['state','状态'],['unfinishedGoal','未完成目标']];
for (const [k, want] of known) {
  const got = T({ kind: k });
  ok(got === '[' + want + '] ', '★★② ' + k + ' → ' + want, JSON.stringify(got));
}

console.log('');
console.log('== 3. ★未知 kind 不得 undefined、不得丢失 ==');
const u = T({ kind: 'someBrandNewKind' })
ok(u !== undefined && u !== null, '★★★③ 未知 kind 不返回 undefined/null', JSON.stringify(u))
ok(u.indexOf('undefined') < 0, '★★★③ 输出里不含 undefined 字样', JSON.stringify(u))
ok(u.indexOf('someBrandNewKind') >= 0, '★★★③ 未知 kind **原样保留**（不静默吞数据）', JSON.stringify(u))
ok(T({}) === '', '★★③ 空对象 ⇒ 空前缀')
ok(T(null) === '', '★★③ null ⇒ 空前缀')
ok(T('string') === '', '★★③ 非对象 ⇒ 空前缀')

console.log('');
console.log('== 4. ★变异：删掉 authorResponse 映射 ⇒ 判据必红 ==');
const mutLabels = labelsSrc.replace("authorResponse: '作者回应',", '')
ok(mutLabels !== labelsSrc, '★★★[变异] 成功删掉 authorResponse 映射')
const mctx = vm.createContext({})
vm.runInContext(mutLabels + '\n' + fnSrc + ';globalThis.__T = perceptTagOfPre;', mctx)
const MT = mctx.__T
const mu = MT({ kind: 'authorResponse' })
ok(mu !== '[作者回应] ', '★★★[变异] 变异版输出 ' + JSON.stringify(mu) + '（不是「作者回应」）⇒ 上面 ① 的判据必红')

console.log('');
console.log('== 5. 与 renderPerceptBlockPre 的接线（标签真的会进 DOM）==');
ok(CL.indexOf('perceptTagOfPre(picked[j]) + body') >= 0, '★★⑤ renderPerceptBlockPre 真用该标签拼文本')
ok(CL.indexOf("'data-dam-percept-item': key") >= 0, '★★⑤ 每条 percept 带 data-dam-percept-item 锚点（可测）')

console.log('');
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)