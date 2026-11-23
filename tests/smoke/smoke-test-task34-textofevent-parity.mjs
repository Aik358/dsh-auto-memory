#!/usr/bin/env node
/**
 * smoke-test-task34-textofevent-parity.mjs —— task-34：`textOfEventPre` 两份实现对齐（补 C3 半修）。
 *
 * 缺陷（wb-event-builder 在 task-33 实测发现，Lead 亲自复核确认）：
 *   textOfEventPre 有两份实现，C3 只改了其中一份 ——
 *     ① lib/index.js 内联版（scope='events' 用）有 percept 四类块 ✅ C3 已修
 *     ② lib/event-recall.js（scope='all' 经 collectEventHitsPre 用）无 percept ❌ C3 漏修
 *   ⇒ 同一事件同一独有词，scope='events' 命中、scope='all' 未命中。
 *
 * ★纪律：本套件的 c) 是最强判据 —— 两份实现输出**逐字相同**（同时锁住顺序/格式/标点）。
 * ★另留防半修机制 g)：抽取两份实现的 percept 段断言 ===（这是同一语义两份实现第 2 次，防第 3 次）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const ER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'event-recall.js'), 'utf8')
const ER = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-recall.js')).href)
const RP = await import(pathToFileURL(path.join(ROOT, 'lib', 'recall-passages.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ── 抽取 lib/index.js 内联版 textOfEventPre（真执行，不是字符串断言）──
function extractInline() {
  const st = IX.indexOf('const textOfEventPre = (ev) => {');
  if (st < 0) throw new Error('未找到内联版 textOfEventPre');
  let i = IX.indexOf('{', st), depth = 0, end = -1;
  for (; i < IX.length; i++) { if (IX[i] === '{') depth++; else if (IX[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  if (end < 0) throw new Error('内联版大括号不闭合');
  return new Function('return ' + IX.slice(IX.indexOf('=', st) + 1, end))();
}
const inlineFn = extractInline();

// ── fixture ──
const UNIQ = 'PERCEPT-UNIQ-QQQ';
const evFull = {
  name: '测试事件', summary: '总览一句话',
  sections: { goal: '目标A', doing: '进行中B', deadend: '弯路C', next: '下一步D' },
  checkpoints: [{ kind: 'progress', text: '检查点1' }, { kind: 'log', text: '检查点2' }],
  userPercept: [{ stage: 'accepted', kind: 'authorResponse', text: UNIQ }, { stage: 'mentioned', kind: 'preference', text: '喜欢深色' }],
  agentTrace: [{ action: '改文件', result: '套件红了', wasRefuted: true }],
  sharedGround: [{ claim: '判据要遍历式', confirmedBy: 'lead', correction: '不要列举式' }],
  commitments: [{ promise: '明天交', boundary: '只交后端', state: 'open' }],
  outcome: '成果X',
};
const evEmpty = { name: '空事件', summary: 's', sections: {}, checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], outcome: 'o' };
const evMany = { name: '多', summary: 's', sections: {}, checkpoints: [], userPercept: Array.from({ length: 21 }, (_, k) => ({ stage: 'accepted', kind: 'preference', text: '第' + (k + 1) + '条' })), agentTrace: [], sharedGround: [], commitments: [] };

// ═══════════════════════════════════════════════════════════════════
console.log('[T34-a] ★★★ 真功能：collectEventHitsPre 能命中 userPercept 独有词');
{
  const collected = ER.collectEventHitsPre([evFull], [UNIQ.toLowerCase()], RP.recallPassagesPre, { full: false });
  ok(collected.hits.length === 1, '★★★T34-a1 collectEventHitsPre 命中 1 条', 'hits=' + collected.hits.length);
  const passagesText = JSON.stringify(collected.hits.map((h) => h.passages));
  ok(passagesText.includes(UNIQ), '★★★T34-a2 passages 里含该独有词', passagesText.slice(0, 200));
}

console.log('');
console.log('[T34-b] ★★★ 负路径：不存在的词 ⇒ 不命中');
{
  const neg = ER.collectEventHitsPre([evFull], ['NOT-EXIST-ZZZ-000'], RP.recallPassagesPre, { full: false });
  ok(neg.hits.length === 0, '★★★T34-b1 不存在的词 ⇒ hits = 0', 'hits=' + neg.hits.length);
  // 反向再验：命中集合里确实没有这条
  const neg2 = ER.collectEventHitsPre([evFull], ['NOT-EXIST-ZZZ-000'], RP.recallPassagesPre, { full: true });
  ok(neg2.hits.length === 0, '★★★T34-b2 full 模式同样不命中', 'hits=' + neg2.hits.length);
}

console.log('');
console.log('[T34-c] ★★★★ 最强判据：两份实现输出**逐字相同**（锁住顺序/格式/标点）');
{
  const cases = [
    ['四类全有', evFull],
    ['四类全空', evEmpty],
    ['只有 userPercept', { name: 'p', summary: 's', sections: {}, checkpoints: [], userPercept: [{ stage: 'used', kind: 'state', text: '正在做' }], agentTrace: [], sharedGround: [], commitments: [] }],
    ['21 条（上限）', evMany],
    ['空文本项被跳过', { name: 'e', summary: 's', sections: {}, checkpoints: [], userPercept: [{ stage: 'accepted', kind: 'x', text: '' }, { stage: 'accepted', kind: 'y', text: '有内容' }], agentTrace: [], sharedGround: [], commitments: [] }],
    ['agentTrace 全字段', { name: 'a', summary: 's', sections: {}, checkpoints: [], userPercept: [], agentTrace: [{ action: 'A', result: 'R', wasRefuted: true }], sharedGround: [], commitments: [] }],
    ['commitments 全字段', { name: 'c', summary: 's', sections: {}, checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [{ promise: 'P', boundary: 'B', state: 'kept' }] }],
  ];
  for (const [label, ev] of cases) {
    const a = inlineFn(ev), b = ER.textOfEventPre(ev);
    ok(a === b, '★★★T34-c 逐字相同: ' + label, a === b ? '长度 ' + a.length : 'A=' + a.length + ' B=' + b.length + ' 首个差异@' + (() => { for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) return k; return -1 })());
  }
}

console.log('');
console.log('[T34-d] ★★★ 零字节纪律：四类全空 ⇒ 不含任何 percept 标题');
{
  const out = ER.textOfEventPre(evEmpty);
  const titles = ['人类侧观察', 'Agent 轨迹', '共识', '约定'];
  for (const t of titles) ok(!out.includes(t), '★★T34-d 不含标题「' + t + '」');
  ok(out.split('\n').filter((l) => l.startsWith('## ')).length === 1, '★★★T34-d5 只剩 outcome 一个 ## 段（无空段噪声）', out.split('\n').filter((l) => l.startsWith('## ')).join('|'));
}

console.log('');
console.log('[T34-e] ★★★ 条数上限：单类 >20 条 ⇒ 标注「…共 21 条，此处列前 20 条」');
{
  const out = ER.textOfEventPre(evMany);
  ok(out.includes('…共 21 条，此处列前 20 条'), '★★★T34-e1 标注文案逐字正确', out.split('\n').filter((l) => l.includes('共 ')).join('|'));
  const items = out.split('\n').filter((l) => l.startsWith('- '));
  ok(items.length === 20, '★★★T34-e2 实际列出 20 条（不是 21）', String(items.length));
  ok(out.includes('第1条') && out.includes('第20条') && !out.includes('第21条'), '★★T34-e3 列的是前 20 条');
}

console.log('');
console.log('[T34-f] ★★★ 四类都真进语料（逐类）');
{
  const out = ER.textOfEventPre(evFull);
  ok(out.includes('人类侧观察') && out.includes(UNIQ), '★★★T34-f1 userPercept 进语料');
  ok(out.includes('Agent 轨迹') && out.includes('改文件') && out.includes('已被推翻'), '★★★T34-f2 agentTrace 进语料（含 wasRefuted 标注）');
  ok(out.includes('共识') && out.includes('判据要遍历式') && out.includes('lead 确认'), '★★★T34-f3 sharedGround 进语料（含 confirmedBy）');
  ok(out.includes('约定') && out.includes('明天交') && out.includes('[open]'), '★★★T34-f4 commitments 进语料（含 state）');
  ok(out.includes('stage=accepted') && out.includes('kind=authorResponse'), '★★★T34-f5 **语义标注在**（stage/kind 是判据，不带标注无法区分 accepted 与 mentioned）');
}

console.log('');
console.log('[T34-g] ★★★ 防半修机制：抽取两份实现的 percept 段断言 ===');
{
  const grabPercept = (src, closeMark) => {
    const st = src.indexOf('const PERCEPT_LIMIT = 20');
    if (st < 0) return null;
    const en = src.indexOf(closeMark, st);
    if (en < 0) return null;
    return src.slice(st, en);
  };
  const inlineSeg = grabPercept(IX, "return L2.join('\\n')");
  const erSeg = grabPercept(ER_SRC, "return L.join('\\n')");
  ok(inlineSeg != null, '★★T34-g1 抽取到内联版 percept 段', String(inlineSeg && inlineSeg.length));
  ok(erSeg != null, '★★T34-g2 抽取到 event-recall 版 percept 段', String(erSeg && erSeg.length));
  // 归一化：去缩进差异 + L2→L 变量名适配（这是两份实现**唯一**允许的差异）
  const norm = (s2) => String(s2 || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n').replace(/\bL2\.push/g, 'L.push');
  const ni = norm(inlineSeg), ne = norm(erSeg);
  ok(ni === ne, '★★★T34-g3 **两份实现的 percept 段逐字相同**（防半修机制）', ni === ne ? '归一化后 ' + ni.length + ' 字符' : 'A=' + ni.length + ' B=' + ne.length + ' 首个差异@' + (() => { for (let k = 0; k < Math.max(ni.length, ne.length); k++) if (ni[k] !== ne[k]) return k; return -1 })());
  // ★零依赖纪律：event-recall.js 不得新增 import
  const importCount = (ER_SRC.match(/^\s*import\s/gm) || []).length;
  ok(importCount === 0, '★★★T34-g4 event-recall.js **零 import**（本模块不 import 任何东西）', String(importCount));
}

console.log('');
console.log('[T34-h] ★★ 边界：percept 字段缺失 / 非数组 / 畸形对象 不崩');
{
  const odd = { name: 'odd', summary: 's', sections: {}, checkpoints: [] };
  let threw = null;
  let out = '';
  try { out = ER.textOfEventPre(odd) } catch (e) { threw = String(e && e.message) }
  ok(threw == null, '★★T34-h1 四类字段**缺失**（undefined）不崩', threw || 'OK');
  ok(out === '# odd\ns', '★★T34-h2 输出仅标题+summary（无空段）', JSON.stringify(out));
  const bad = { name: 'bad', summary: 's', sections: {}, checkpoints: [], userPercept: [null, 'str', 42, {}], agentTrace: [null], sharedGround: [null], commitments: [null] };
  let threw2 = null;
  try { ER.textOfEventPre(bad) } catch (e) { threw2 = String(e && e.message) }
  ok(threw2 == null, '★★★T34-h3 畸形项（null/字符串/数字/空对象）不崩', threw2 || 'OK');
  // 两份实现对畸形输入也必须一致
  ok(inlineFn(odd) === ER.textOfEventPre(odd) && inlineFn(bad) === ER.textOfEventPre(bad), '★★★T34-h4 畸形输入下两份实现仍逐字一致');
}

console.log('');
console.log('[task34] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)