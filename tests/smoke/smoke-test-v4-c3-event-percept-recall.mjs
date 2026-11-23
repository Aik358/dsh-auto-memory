#!/usr/bin/env node
/**
 * smoke-test-v4-c3-event-percept-recall.mjs —— C3：事件召回语料补 percept 四类。
 *
 * ★用户裁定（2026-10-25 逐字）：「只要保证这个语义唤回引擎能够触及到足够的唤回细节就行了。」
 *
 * ★改动前实测缺口：`textOfEventPre` 只拼 name/summary/sections/checkpoints/outcome，
 *   **完全没有** userPercept / agentTrace / sharedGround / commitments。
 *   ⇒ 以后即使填了，召回引擎也**搜不到** —— 这比「没填」更严重（结构性缺口）。
 *
 * ★验收方式（真执行，不是源码字符串断言）：
 *   从 lib/index.js **抽取** `textOfEventPre` 函数体，用 `new Function` 真执行，
 *   喂含四类 percept 的 fixture，断言输出语料；再用真 `recallPassagesPre` 断言独有词能命中。
 *   （这同时绕开了 state-engine 沙箱对 `await import('./x.js')` 的限制 —— 见 C1 判据。）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const RP = await import(pathToFileURL(path.join(ROOT, 'lib', 'recall-passages.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ── 抽取 textOfEventPre（起锚 + 括号配平，两个边界都 fail-closed）──
function extractFn(src, declPrefix) {
  const start = src.indexOf(declPrefix);
  if (start < 0) throw new Error('抽取失败：找不到 ' + declPrefix);
  // ★declPrefix 已包含函数体起始 `{`（如 'const f = (ev) => {'）⇒ 从 declPrefix 末尾**前一个字符**开始配平。
  //   首版写成 `src.indexOf('{', start + declPrefix.length)` ⇒ 跳过了那个 `{` ⇒ 配平数从 0 起算错 ⇒ 抽到错误片段。
  let i = start + declPrefix.length - 1;
  if (src[i] !== '{') throw new Error('抽取失败：declPrefix 末尾不是 {（实际 ' + JSON.stringify(src[i]) + '）');
  let depth = 0, end = -1;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('抽取失败：括号未配平（终锚 -1）—— 拒绝继续');
  // ★关键：箭头函数有**参数**，不能只取 `{…}` 体（那样 `ev` 未定义）+ 也不能 `return {…}`（会被当代码块）。
  //   正确做法：从参数列表起点开始截「完整的箭头函数表达式」，再包一层括号求值。
  //   declPrefix 形如 'const textOfEventPre = (ev) => {' ⇒ 参数起点 = declPrefix 里第一个 '(' 的位置。
  const parenAt = declPrefix.indexOf('(');
  if (parenAt < 0) throw new Error('抽取失败：declPrefix 里没有参数列表');
  const fnExpr = src.slice(start + parenAt, end + 1);
  if (fnExpr.indexOf('=>') < 0) throw new Error('抽取失败：截出的片段不含 =>');
  return new Function('return (' + fnExpr + ')')();
}
const textOfEventPre = extractFn(IX, 'const textOfEventPre = (ev) => {');

// ── fixture：四类 percept 各 1 条，正文用**独有词**便于检索判定 ──
const mkEv = (over) => Object.assign({
  id: 'evt_00000001', name: '测试事件X', summary: '一句总览', status: 'active',
  sections: { goal: '目标甲内容', doing: '', deadend: '', next: '' },
  checkpoints: [{ kind: 'log', text: '检查点内容' }],
  userPercept: [{ kind: 'observation', stage: 'accepted', text: '用户明确表示讨厌紫色主题偏好' }],
  agentTrace: [{ action: '重构注入管线', result: '套件全绿通过', wasRefuted: false }],
  sharedGround: [{ claim: '事件优先是正确方向', confirmedBy: 'lead', correction: '' }],
  commitments: [{ promise: '下周交付规约卡', boundary: '仅后端', state: 'open' }],
  outcome: '已交付',
}, over || {});

console.log('[C3-1] 抽取与真执行前置');
{
  ok(typeof textOfEventPre === 'function', '★★C3-1a 从源码抽取 textOfEventPre 并真构造成功（不是字符串匹配）');
  const b = textOfEventPre(mkEv());
  ok(typeof b === 'string' && b.length > 50, '★★C3-1b 真调用返回语料字符串', 'len=' + b.length);
}

console.log('');
console.log('[C3-2] ★核心：四类 percept 都进语料');
{
  const b = textOfEventPre(mkEv());
  ok(b.indexOf('## 人类侧观察') >= 0, '★★★C3-2a 含 `## 人类侧观察`（userPercept）');
  ok(b.indexOf('## Agent 轨迹') >= 0, '★★★C3-2b 含 `## Agent 轨迹`（agentTrace）');
  ok(b.indexOf('## 共识') >= 0, '★★★C3-2c 含 `## 共识`（sharedGround）');
  ok(b.indexOf('## 约定') >= 0, '★★★C3-2d 含 `## 约定`（commitments）');
  ok(b.indexOf('紫色主题') >= 0, '★★C3-2e userPercept 正文进语料');
  ok(b.indexOf('重构注入管线') >= 0, '★★C3-2f agentTrace 正文进语料');
  ok(b.indexOf('事件优先是正确方向') >= 0, '★★C3-2g sharedGround 正文进语料');
  ok(b.indexOf('规约卡') >= 0, '★★C3-2h commitments 正文进语料');
}

console.log('');
console.log('[C3-3] 语义标注：stage / state 必须带（判断「用户确认过」的唯一依据）');
{
  const b = textOfEventPre(mkEv());
  ok(b.indexOf('stage=accepted') >= 0, '★★C3-3a userPercept 带 stage 标注（画像段只认 accepted/used）');
  ok(b.indexOf('kind=observation') >= 0, 'C3-3b userPercept 带 kind 标注');
  ok(b.indexOf('[open]') >= 0, '★★C3-3c commitment 带 state 标注（open/kept/dropped）');
  ok(b.indexOf('lead 确认') >= 0, 'C3-3d sharedGround 带 confirmedBy');
  const bRef = textOfEventPre(mkEv({ agentTrace: [{ action: 'A', result: 'B', wasRefuted: true }] }));
  ok(bRef.indexOf('已被推翻') >= 0, '★C3-3e agentTrace 的 wasRefuted=true 有显式标注', JSON.stringify(bRef.slice(-80)));
}

console.log('');
console.log('[C3-4] ★零字节纪律：空 percept ⇒ 连标题都不出');
{
  const bEmpty = textOfEventPre(mkEv({ userPercept: [], agentTrace: [], sharedGround: [], commitments: [] }));
  ok(bEmpty.indexOf('## 人类侧观察') < 0, '★★C3-4a 空 userPercept ⇒ 无标题');
  ok(bEmpty.indexOf('## Agent 轨迹') < 0, '★★C3-4b 空 agentTrace ⇒ 无标题');
  ok(bEmpty.indexOf('## 共识') < 0, '★★C3-4c 空 sharedGround ⇒ 无标题');
  ok(bEmpty.indexOf('## 约定') < 0, '★★C3-4d 空 commitments ⇒ 无标题');
  // 部分缺失：只有 userPercept 有值
  const bPart = textOfEventPre(mkEv({ agentTrace: [], sharedGround: [], commitments: [] }));
  ok(bPart.indexOf('## 人类侧观察') >= 0 && bPart.indexOf('## 共识') < 0, '★★C3-4e 部分缺失 ⇒ 只出有值那类标题');
  // 数组存在但元素全空 text
  const bBlank = textOfEventPre(mkEv({ commitments: [{ promise: '', boundary: '', state: '' }] }));
  ok(bBlank.indexOf('## 约定') < 0, '★C3-4f 元素全空文本 ⇒ 也不出标题');
}

console.log('');
console.log('[C3-5] 条数上限：50 条 ⇒ 语料有界 + 显式标注');
{
  const many = mkEv({ userPercept: Array.from({ length: 50 }, (_, i) => ({ stage: 'accepted', kind: 'preference', text: '偏好条目' + i })) });
  const b = textOfEventPre(many);
  const listed = (b.match(/偏好条目\d+/g) || []).length;
  ok(listed === 20, '★★C3-5a 只列前 20 条（PERCEPT_LIMIT）', '实测列出 ' + listed + ' 条');
  ok(b.indexOf('共 50 条') >= 0, '★★C3-5b 显式标注「共 50 条」（不静默截断）');
  ok(b.indexOf('前 20 条') >= 0, '★C3-5c 标注「前 20 条」');
  // 语料长度有界：不应随条数线性爆炸
  const b2 = textOfEventPre(mkEv({ userPercept: Array.from({ length: 500 }, (_, i) => ({ stage: 'accepted', text: 'T' + i })) }));
  ok(b2.length < 3000, '★★C3-5d 500 条时语料仍有界（<3000 字）', 'len=' + b2.length);
}

console.log('');
console.log('[C3-6] ★★真检索：percept 独有词必须能被 recallPassagesPre 命中');
{
  const b = textOfEventPre(mkEv());
  const cases = [
    ['userPercept', '紫色主题'],
    ['agentTrace', '重构注入管线'],
    ['sharedGround', '事件优先'],
    ['commitments', '规约卡'],
  ];
  for (const [label, q] of cases) {
    const hits = RP.recallPassagesPre(b, [q], 'event://x', true);
    ok(Array.isArray(hits) && hits.length >= 1, '★★★C3-6 ' + label + ' 独有词「' + q + '」能命中', '命中 ' + (hits ? hits.length : 0) + ' 条');
  }
  const neg = RP.recallPassagesPre(b, ['完全不存在词汇xyzabc'], 'event://x', true);
  ok(Array.isArray(neg) && neg.length === 0, '★★★C3-6e 负路径：不存在的词 ⇒ 0 命中', '命中 ' + (neg ? neg.length : 0));
}

console.log('');
console.log('[C3-7] 检索结果摘要行：命中事件含几条 percept');
{
  ok(IX.indexOf('附: 观察 ') >= 0, '★★C3-7a 结果输出含 percept 条数摘要行（守卫）');
  ok(/if \(_total > 0\)/.test(IX), '★★C3-7b 摘要行受 `_total > 0` 守卫 ⇒ 四类全 0 时不输出（零字节）');
}

console.log('');
console.log('[v4-c3-event-percept-recall] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)