/** smoke-test-r21-skin-mount.mjs —— R21 6 槽位**真实页面挂载**运行时验收。
 * CR-10：真抽源码 → vm 真执行 → 真调用 SkinSlot/SkinEmpty → 断言真实返回；含负路径。
 * 权威：12 卷 §二（每张图用在哪个页面）/§四（三条纪律）。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fail++; fails.push(m) } };
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']');
const SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
const cnt = (s, x) => s.split(x).length - 1;
// ── A 组：纪律与守恒（静态，可作守卫）──
// ★跨模块接缝（第 11 条纪律）：R21 段的 SkinSlot 依赖 S2 段的 SkinImg/skinAssetUrl
//   ⇒ vm 必须**同时执行两段**，否则只测到桩、测不到真实接线。
const SB = '    // ===================== S2-skin:begin =====================';
const B1 = '    // ===================== S2-skin:end';
const iS = SRC.indexOf(SB), i1 = SRC.indexOf(B1);
ok(iS > 0 && i1 > iS, 'A1 S2+R21 段可定位');
const S2SEG = SRC.slice(iS, i1);
const B0 = '    // ═══════════ R21 皮肤视觉重构 A';
const i0 = SRC.indexOf(B0);
ok(i0 > iS && i0 < i1, 'A1b R21 段在 S2 段内部尾端');
const SEG = SRC.slice(i0, i1);
eq(cnt(S2SEG, 'function SkinImg'), 1, 'A1c ★接缝：SkinImg 定义在同一 vm 作用域内（真接通）');
ok(SEG.length > 2000, 'A2 R21 段字节 (' + SEG.length + ')');
// ★纪律一：代码只认 key，不认文件
ok(!/\.png|\.webp/.test(SEG), 'A3 ★纪律一：R21 段零路径字面量（换图只改宿主数据表）');
// ★纪律三：尺寸真源在宿主，客户端只做展示 —— 尺寸表只允许一处声明
eq(cnt(SEG, 'var SKIN_SLOT_SIZE = {'), 1, 'A4 ★纪律三：客户端尺寸表唯一（真源仍在 skin-assets.js）');
ok(!/2000|1400/.test(SEG), 'A5 ★bg.mindmap 尺寸不硬编码（R22 才挂载）');
// 结构层边界：挂载点不得带 block 锚（R10 锁）
ok(!/'data-dam-block'/.test(SEG), 'A6 ★挂载点零 block 锚（结构层语义边界）');
ok(!/'data-dam-kind'/.test(SEG), 'A7 ★挂载点零 kind 锚');
// 守恒
eq((SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length, 2, 'A8 ★计数锁 MEMORY_TABS() = 2');
ok(['page-nav','page','settings'].every(region=>SRC.includes(region)) && SRC.includes('data-dam-primary-nav') && SRC.includes('data-dam-secondary-nav'), 'A9 四主入口、次级导航与设置结构契约在场');
ok(damNoMixedEol(SRC), 'A10 纯 CRLF');
// 三处挂载点 + 原文案
// ★2026-09-30 双皮肤块：生成区现有两块（legacy + 三套变体），故「经典源」必须两块都剥。
const legacySource = SRC.replace(/    \/\/ ===== ITER5-LEGACY-GENERATED:BEGIN =====[\s\S]*?    \/\/ ===== ITER5-LEGACY-GENERATED:END =====/, '').replace(/    \/\/ ITER5-GENERATED:BEGIN[\s\S]*?    \/\/ ITER5-GENERATED:END/, '');
eq(cnt(legacySource, 'h(SkinEmpty,'), 3, 'A11 三处经典挂载仍保留（refine / hub-skills / stats）');
eq(cnt(SRC, 'h(SkinEmpty,') - cnt(legacySource, 'h(SkinEmpty,'), 1, 'A11b 原生统计复用相同空态槽位');
ok(['refineEmpty', 'hubSkillsEmpty', 'statsEmpty'].every((k) => cnt(SRC, "t('" + k + "')") >= 1), 'A12 ★原文案全保留（图是追加，不是替换）');
ok(SRC.includes('h(SkinHero,') || SRC.includes('function SkinHero'), 'A13 hero 首屏挂载表达存在');
// ★段标记唯一性（R22 实测抓到 R21 遗留：end 标记被复制成 2 处）
const MEND = '    // ===================== S2-skin:end =====================';
const MBEG = '    // ===================== S2-skin:begin =====================';
eq(cnt(SRC, MEND), 1, 'A14 ★段结束标记恰 1 处（防重复标记）');
eq(cnt(SRC, MBEG), 1, 'A15 ★段开始标记恰 1 处');
ok(SRC.indexOf(MBEG) < SRC.indexOf(MEND), 'A16 ★begin 在 end 之前（段边界有序）');
// ── B 组：真执行 + 真调用 ──
const h = function (type, props) {
  const rest = Array.prototype.slice.call(arguments, 2), kids = [];
  const push = (k) => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) { k.forEach(push) } else kids.push(k) };
  rest.forEach(push);
  return { __el: true, type: type, props: props || {}, kids: kids };
};
const sb = { console: console, h: h, locale: 'zh', String: String,
  useState: (v) => [v, function () {}], API: { skinAsset: '/api/dsh-auto-memory/skin-asset' } };
sb.globalThis = sb;
const ctx = vm.createContext(sb);
vm.runInContext(S2SEG + ';globalThis.__R = { SkinSlot: SkinSlot, SkinEmpty: SkinEmpty, SkinHero: SkinHero, skinSlotSize: skinSlotSize, SKIN_SLOT_SIZE: SKIN_SLOT_SIZE };', ctx, { filename: 'client.js#R21' });
const R = sb.__R;
ok(!!R, 'B1 R21 段在 vm 中真执行成功');
// ★组件描述符展开（模拟 React）：h(SkinSlot, {...}) 只是描述符，只有组件函数被真调用才产出锚点。
const COMP = { SkinSlot: R.SkinSlot, SkinEmpty: R.SkinEmpty, SkinHero: R.SkinHero };
const expand = (el, depth) => {
  if (!el || !el.props || depth > 6) return el;
  if (typeof el.type === 'function') {
    const child = el.type(el.props);
    if (!child || !child.props) return child;
    return { __el: true, type: child.type, props: child.props, kids: (child.kids || []).map((k) => expand(k, depth + 1)) };
  }
  return { __el: true, type: el.type, props: el.props, kids: (el.kids || []).map((k) => expand(k, depth + 1)) };
};
const findByAttr = (el, name) => {
  if (el && el.props && el.props[name] !== undefined) return el;
  for (const c of (el && el.kids) || []) { const r = findByAttr(c, name); if (r) return r }
  return null;
};
// ★SkinSlot 真调用：返回元素含语义锚点
const s1 = R.SkinSlot({ slot: 'empty.recall', kind: 'empty', size: [800, 600] });
eq(s1.props['data-dam-skin-slot'], 'empty.recall', 'B2 ★SkinSlot 真返回 data-dam-skin-slot');
eq(s1.props['data-dam-skin-kind'], 'empty', 'B3 ★SkinSlot 真返回 kind');
eq(s1.props.className.indexOf('dam-skin-slot') >= 0, true, 'B4 挂载点类名');
ok(s1.props.style && String(s1.props.style.aspectRatio).indexOf('800') === 0, 'B5 ★版位预留按尺寸（防布局跳动）');
// ★SkinEmpty 真调用：图 + 原文案都在
const e1 = expand(R.SkinEmpty({ slot: 'empty.library', size: [800, 600], children: '暂无技能' }), 0);
eq(e1.props['data-dam-skin-empty'], 'empty.library', 'B6 ★SkinEmpty 真返回锚点');
eq(e1.kids.length, 2, 'B7 ★SkinEmpty = 图 + 文案（两件都在，不是替换）');
ok(findByAttr(e1, 'data-dam-skin-slot') !== null, 'B7b ★展开后真出现挂载点锚');
eq(e1.kids[1].kids[0], '暂无技能', 'B8 ★原文案原样传出');
const inner = findByAttr(e1, 'data-dam-skin-slot');
eq(inner && inner.props['data-dam-skin-slot'], 'empty.library', 'B9 ★SkinEmpty 内层是真挂载点');
// ── C 组：负路径 ──
const bad = expand(R.SkinSlot({ slot: 'no.such.slot', kind: 'empty', size: [1, 1] }), 0);
eq(bad.props['data-dam-skin-slot'], 'no.such.slot', 'C1 ★负路径：未知 slot 仍返回确定性结构（不抛）');
const badImg = findByAttr(bad, 'data-dam-skin-ph') || bad.kids[0];
eq(badImg.type, 'div', 'C2 ★★负路径：未知 slot ⇒ 走占位 div（不是坏 <img>）');
eq(badImg.props['data-dam-skin-ph'], 'no.such.slot', 'C3 ★负路径：占位带槽位标识（可诊断）');
const noSize = R.SkinSlot({ slot: 'empty.recall', kind: 'empty' });
eq(noSize.props.style, undefined, 'C4 ★负路径：无尺寸 ⇒ 不写 style（不产生 NaN 版位）');
// 尺寸表边界
eq(R.skinSlotSize('bg.mindmap').length, 0, 'C5 ★bg.mindmap 不在客户端尺寸表（R22 挂载时才加）');
eq(R.skinSlotSize('').length, 0, 'C6 ★空 key 安全');
eq(R.skinSlotSize(null).length, 0, 'C7 ★null key 安全');
// ── D 组：hero 版位 ──
const hero = expand(R.SkinHero({}), 0);
eq(hero.props['data-dam-skin-hero'], 'hero.welcome', 'D1 hero 默认槽位 = hero.welcome');
const heroSlot = findByAttr(hero, 'data-dam-skin-slot');
eq(heroSlot && heroSlot.props['data-dam-skin-kind'], 'hero', 'D2 hero kind');
// ── E 组：皮肤组件共用单一取数通道 ──
const noComment = SRC.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const lit = cnt(noComment, '/api/dsh-auto-memory/skin-asset');
eq(lit, 0, 'E1 ★去注释后前端零路由字面量（走 API.skinAsset）[注释中 ' + cnt(SRC, '/api/dsh-auto-memory/skin-asset') + ' 处]');
ok(cnt(SRC, 'function skinAssetUrl') === 1 && cnt(SRC, 'function SkinImg') === 1, 'E2 取数通道唯一（skinAssetUrl）；SkinImg 唯一');
console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase());
console.log('PASS ' + pass + ' / FAIL ' + fail);
fails.forEach((f) => console.log('  FAIL: ' + f));
process.exit(fail === 0 ? 0 : 1);
