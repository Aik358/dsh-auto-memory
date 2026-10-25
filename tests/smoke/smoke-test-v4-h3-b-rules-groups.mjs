#!/usr/bin/env node
/**
 * smoke-test-v4-h3-b-rules-groups.mjs —— H3-B：规约分组渲染 + 可增删改 + 警戒线提示。
 *
 * ★用户裁定 A（2026-10-25 逐字）：「规约为什么要并入画像啊？这个用户画像对用户的印象是感觉比较 emotional 的，
 *   比较主观或生活化，它主要是一个情境化的东西。而用户规约，作为每次完整版需要注入的约定类内容，
 *   是比较『硬』的东西，应该是比较 rational 的。**这两者不该在一起**」
 *   ⇒ 三类分立：用户画像(emotional) / 用户规约(rational 跨项目) / 项目规约(rational 本项目)
 *
 * ★用户裁定 B（2026-10-25 逐字）：「只增不减是不是有点不太对啊？应该是可以增减、可以修改的，
 *   不然以后每次都注入的话，是不是量有点太多了？」
 *   ⇒ 规约可增删改；且必须有注入面**警戒线**
 *
 * ★★警戒线语义（Lead 2026-10-25 裁决）：**4,000 是警戒线不是截断线**
 *   · ≤ 上限 ⇒ 正常注入，无提示
 *   · > 上限 ⇒ **全量注入（一个字都不砍）+ 强提示整理**
 *   **为什么不能截断**：静默截断 = 那条规约看似存在实则不生效，比超限危险得多。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RL = await import(pathToFileURL(path.join(ROOT, 'lib', 'rules-layer.js')).href)
const RE = await import(pathToFileURL(path.join(ROOT, 'lib', 'rules-edit.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
// B-1 常量（模块级，不新增配置键）
// ══════════════════════════════════════════════════════════════════════
console.log('[B-1] 警戒线常量');
{
  ok(RL.USER_RULES_WARN_CHARS_PRE_V1 === 1500, '★★B-1a 用户规约警戒线 = 1,500', String(RL.USER_RULES_WARN_CHARS_PRE_V1));
  ok(RL.PROJECT_RULES_WARN_CHARS_PRE_V1 === 4000, '★★B-1b 项目规约警戒线 = 4,000', String(RL.PROJECT_RULES_WARN_CHARS_PRE_V1));
  const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');
  ok(IX.indexOf('USER_RULES_WARN_CHARS') < 0 || !/USER_RULES_WARN_CHARS[^_A-Z]/.test(IX), '★B-1c 未把警戒线做成配置键（模块级常量即可）');
}

// ══════════════════════════════════════════════════════════════════════
// B-2 分组渲染（两个小节标题必须不同）
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[B-2] 分组渲染');
{
  const rules = { rules: [
    { text: '用户规约甲', layer: 'user' },
    { text: '用户规约乙', layer: 'user' },
    { text: '项目规约丙', layer: 'project' },
    { text: '项目规约丁', layer: 'project' },
  ] };
  const g = RL.renderRulesSectionPre(rules, { groupByLayer: true });
  ok(g.text.indexOf('[用户规约 — 跨项目通用 · 必须遵守]') >= 0, '★★★B-2a 有「用户规约」小节');
  ok(g.text.indexOf('[项目规约 — 本项目必守]') >= 0, '★★★B-2b 有「项目规约」小节');
  // ★两个标题必须不同（Lead 要求断言两者不等）
  const TITLE_U = '[用户规约 — 跨项目通用 · 必须遵守]';
  const TITLE_P = '[项目规约 — 本项目必守]';
  ok(TITLE_U !== TITLE_P, '★★★B-2c 两个小节标题**不同**（断言不等）');
  // 位置：用户规约在前，项目规约在后
  ok(g.text.indexOf(TITLE_U) < g.text.indexOf(TITLE_P), '★★B-2d 用户规约在小节顺序上先于项目规约');
  // 分流正确（负路径：互不串台）
  const segU = g.text.slice(g.text.indexOf(TITLE_U), g.text.indexOf(TITLE_P));
  const segP = g.text.slice(g.text.indexOf(TITLE_P));
  ok(segU.indexOf('用户规约甲') >= 0 && segU.indexOf('项目规约丙') < 0, '★★★B-2e 用户段只含用户规约（不含项目规约）');
  ok(segP.indexOf('项目规约丙') >= 0 && segP.indexOf('用户规约甲') < 0, '★★★B-2f 项目段只含项目规约（不含用户规约）');
  ok(g.groups.user > 0 && g.groups.project > 0, '★★B-2g groups 分别给出两段字符数', JSON.stringify(g.groups));
}

// ══════════════════════════════════════════════════════════════════════
// B-3 警戒线：超限 ⇒ 全量注入 + 提示（不截断）
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[B-3] 警戒线（超限不截断）');
{
  // 用户规约超 1500
  const bigU = { rules: Array.from({ length: 40 }, (_, i) => ({ text: '用户规则第' + i + '条：' + '甲'.repeat(35), layer: 'user' })) };
  const rU = RL.renderRulesSectionPre(bigU, { groupByLayer: true });
  ok(rU.groups.user > 1500, '★★B-3a 构造的用户规约确实超 1500', String(rU.groups.user));
  ok(!!rU.warn && rU.warn.indexOf('[用户规约超警戒线]') >= 0, '★★★B-3b 超限 ⇒ 有「用户规约超警戒线」提示');
  ok(rU.warn.indexOf(String(rU.groups.user)) >= 0 && rU.warn.indexOf('1500') >= 0, '★★B-3c 提示里给出「当前 X > 上限 Y」两个数');
  // ★★核心：全量注入，一条都不少
  const allU = Array.from({ length: 40 }, (_, i) => rU.text.indexOf('用户规则第' + i + '条') >= 0).every(Boolean);
  ok(allU, '★★★B-3d **40 条全部在注入文本里（不截断）**');
  // 警告在最前面
  ok(rU.text.trimStart().indexOf('[用户规约超警戒线]') === 0, '★★B-3e 警告放在**最前面**（模型先看到异常再读内容）');

  // 项目规约超 4000
  const bigP = { rules: Array.from({ length: 90 }, (_, i) => ({ text: '项目规则第' + i + '条：' + '乙'.repeat(48), layer: 'project' })) };
  const rP = RL.renderRulesSectionPre(bigP, { groupByLayer: true });
  ok(rP.groups.project > 4000, '★★B-3f 构造的项目规约确实超 4000', String(rP.groups.project));
  ok(!!rP.warn && rP.warn.indexOf('[项目规约超警戒线]') >= 0, '★★★B-3g 超限 ⇒ 有「项目规约超警戒线」提示');
  const allP = Array.from({ length: 90 }, (_, i) => rP.text.indexOf('项目规则第' + i + '条') >= 0).every(Boolean);
  ok(allP, '★★★B-3h **90 条全部在注入文本里（不截断）**');
  ok(rP.text.indexOf('…') < 0 && rP.text.indexOf('...') < 0, '★★★B-3i 没有省略号/截断标记（证明不是截断）');
  // ★负：未超限时**不得**有提示
  const small = { rules: [{ text: '小规约', layer: 'project' }] };
  const rS = RL.renderRulesSectionPre(small, { groupByLayer: true });
  ok(rS.warn === null, '★★★B-3j 未超限 ⇒ 提示为 null（不误报）');
}

// ══════════════════════════════════════════════════════════════════════
// B-4 向后兼容：不传 groupByLayer ⇒ 旧行为逐字节不变
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[B-4] 向后兼容');
{
  const rules = { rules: [{ text: '规则一', layer: 'user' }, { text: '规则二', layer: 'project' }] };
  const old = RL.renderRulesSectionPre(rules);
  ok(old.text.indexOf(RL.RULES_SECTION_TITLE_PRE_V1) >= 0, '★★★B-4a 不传 groupByLayer ⇒ 用旧标题（p6a 123 条断言不受影响）');
  ok(old.text.indexOf('[用户规约') < 0 && old.text.indexOf('[项目规约') < 0, '★★B-4b 不传 ⇒ 不出现新小节');
  ok(old.text === '\n' + RL.RULES_SECTION_TITLE_PRE_V1 + '\n' + RL.RULES_SECTION_GUIDE_PRE_V1 + '\n- 规则一\n- 规则二', '★★★B-4c **旧路径逐字节等价**（不是「差不多」）');
}

// ══════════════════════════════════════════════════════════════════════
// B-5 ★可增删改：删一条 ⇒ 渲染里真消失（真数据流，非文件断言）
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[B-5] 可增删改（真数据流：编辑 → 渲染）');
{
  const t0 = '## 2026-08-14\n- 第一条规约必须遵守\n- 第二条规约严禁违规\n- 第三条规约务必执行\n';
  const items0 = RE.listRuleItemsPre(t0);
  ok(items0.length === 3, '★B-5a 初始 3 条', String(items0.length));

  // ★删除：删第 2 条 ⇒ 渲染里必须消失
  const del = RE.removeRuleItemPre(t0, 1);
  ok(del.ok === true, '★★B-5b 删除返回 ok');
  const rDel = RL.renderRulesSectionPre({ rules: RE.listRuleItemsPre(del.text).map((x) => ({ text: x.text, layer: 'project' })) }, { groupByLayer: true });
  ok(rDel.text.indexOf('第二条规约严禁违规') < 0, '★★★B-5c **删掉的那条在渲染结果里真消失**（真数据流，不是文件断言）');
  ok(rDel.text.indexOf('第一条规约必须遵守') >= 0 && rDel.text.indexOf('第三条规约务必执行') >= 0, '★★B-5d 其余两条仍在');
  ok(RE.listRuleItemsPre(del.text).length === 2, '★★B-5e 删后剩 2 条');

  // ★修改：改第 1 条 ⇒ 渲染里显示新文本、旧文本消失
  const upd = RE.updateRuleItemPre(t0, 0, '第一条规约已修订为新版本');
  ok(upd.ok === true, '★★B-5f 修改返回 ok');
  const rUpd = RL.renderRulesSectionPre({ rules: RE.listRuleItemsPre(upd.text).map((x) => ({ text: x.text, layer: 'project' })) }, { groupByLayer: true });
  ok(rUpd.text.indexOf('第一条规约已修订为新版本') >= 0, '★★★B-5g **改后的新文本出现在渲染里**');
  ok(rUpd.text.indexOf('第一条规约必须遵守') < 0, '★★★B-5h **旧文本消失**（不是追加）');

  // ★新增：追加一条 ⇒ 渲染里出现
  const add = RE.appendRuleItemPre(t0, '新增的第四条规约', { dateSection: '2026-08-14' });
  ok(add.ok === true, '★★B-5i 追加返回 ok');
  const rAdd = RL.renderRulesSectionPre({ rules: RE.listRuleItemsPre(add.text).map((x) => ({ text: x.text, layer: 'project' })) }, { groupByLayer: true });
  ok(rAdd.text.indexOf('新增的第四条规约') >= 0, '★★★B-5j **新增的条出现在渲染里**');
  ok(RE.listRuleItemsPre(add.text).length === 4, '★★B-5k 追加后 4 条');
}

console.log('');
console.log('[v4-h3-b-rules-groups] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)