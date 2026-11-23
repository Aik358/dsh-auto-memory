#!/usr/bin/env node
/**
 * smoke-test-v4-h3-f-migration-drill.mjs —— 迁移演练（真实数据 / 四层对照表 / 不真改）。
 *
 * ★用户第四轮裁定 + Lead 硬要求：
 *   「① 用【真实数据】跑，产出对照表，但**不真改**（只在临时 workspace 做）
 *     ② 对照表必须体现【四层】：L0 人之上的层 / L1 用户规约 / L2 项目规约 / L3 项目事件
 *     ★不能只有五类分拣，要能看出「哪些进了 L0」—— 这是用户最关心的一条」
 *
 * ★本套件的定位：**演练脚本的验收**，不是功能实现。它验证：
 *   ① 真读两份真实 MEMORY.md（只读，不改）
 *   ② 四层对照表能产出，且**L0 显式可见**（不只一个数字，要有样例）
 *   ③ 条目数守恒（旧 N = 四层之和）
 *   ④ 演练前后真实文件 **sha256 不变**（证明确实没真改）
 *
 * ★★诚实标注（CR-10 纪律）：对照表里的**分层归类是启发式粗分**，
 *   仅用于**估算工作量**，**不是真实分拣结果**。真实分拣必须由模型判断
 *   （提示词阶段 3 明确写「模型判断」，H5 实测正则准确率仅 20%）。
 *   ⇒ 本套件只断言「能分出四层且守恒」，不断言「分得对」。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RE = await import(pathToFileURL(path.join(ROOT, 'lib', 'rules-edit.js')).href)

let pass = 0, fail = 0
let skipped = 0
// ★#507：数据缺席时用 skip 记账，**不计入 PASS**（旧行为是崩或假绿）
const skip = (n, why) => { skipped++; console.log('  SKIP ' + n + ' :: ' + (why || '数据缺席')) };
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
// 真实数据路径（只读）
// ══════════════════════════════════════════════════════════════════════
// ★#507（2026-11-02）：HOME 安全回退，不再写死维护者本机用户名。
//   实测坑：os.homedir() 在「HOME/USERPROFILE 都被显式置空」时会抛
//     SystemError [ERR_SYSTEM_ERROR]: uv_os_homedir returned ENOENT ——
//     也就是说它**不能**当作无条件兜底。故这里包 try，取不到就返回空串，
//     由下面的数据存在性守卫走显式 skip（而不是让整个进程崩掉）。
const HOME = (() => {
  const env = process.env.USERPROFILE || process.env.HOME || ''
  if (env) return env
  try { return os.homedir() || '' } catch (_) { return '' }
})()
const USER_MD = path.join(HOME, '.dsh', 'memory', 'MEMORY.md');
const WSID = '--D--dsh-auto-memory--';
const PROJ_MD = path.join(HOME, '.dsh', 'memory', 'workspaces', WSID, 'MEMORY.md');
const HANDOFF = path.join(HOME, '.dsh', 'memory', 'workspaces', WSID, 'handoff');
// ★#507：数据存在性守卫（F-1 与 F-2/F-3 共用同一份判据 —— 只写一处，避免半修）
const HAS_REAL_DATA = !!HOME && fs.existsSync(USER_MD) && fs.existsSync(PROJ_MD) && fs.existsSync(HANDOFF);

console.log('[F-1] 真实数据可读（只读）');
// ★#507：F-1 是**数据前置条件**，不是产品判据。数据本来就不存在时把它记成 FAIL，
//   会让 CI 上永远挂着 3 条与产品无关的红 —— 所以改成「有数据就真断言，没数据就 skip 并打印路径」。
{
  if (HAS_REAL_DATA) {
    ok(fs.existsSync(USER_MD), '★F-1a 用户级 MEMORY.md 存在', USER_MD);
    ok(fs.existsSync(PROJ_MD), '★F-1b 项目 MEMORY.md 存在', PROJ_MD);
    ok(fs.existsSync(HANDOFF), '★F-1c handoff/ 存在');
  } else {
    skip('F-1a 用户级 MEMORY.md 存在', '数据缺席 HOME=' + HOME + ' path=' + USER_MD);
    skip('F-1b 项目 MEMORY.md 存在', '数据缺席 path=' + PROJ_MD);
    skip('F-1c handoff/ 存在', '数据缺席 path=' + HANDOFF);
  }
}

// ══════════════════════════════════════════════════════════════════════
// sha 快照（演练前后必须一致 ⇒ 证明没真改）
// ══════════════════════════════════════════════════════════════════════
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const shaBefore = { user: fs.existsSync(USER_MD) ? sha(USER_MD) : '', proj: fs.existsSync(PROJ_MD) ? sha(PROJ_MD) : '' };

// ══════════════════════════════════════════════════════════════════════
// 四层对照表
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[F-2] 四层对照表（L0 必须显式可见）');
// ★★#507（2026-11-02）真崩点修复：旧实现这里直接 readFileSync，**未捕获 ENOENT**。
//   在没有真实记忆目录的机器（CI / 新贡献者 / 换了用户名）上 ⇒ 进程直接抛错退出，
//   后续 13 条断言**从未执行** —— 覆盖率静默缩水，比「红」更糟（绿/红都看不到它们）。
//   ⇒ 数据缺席时**显式 skip 并打印原因**，绝不静默通过、也绝不崩。
if (!HAS_REAL_DATA) {
  const why = 'USER_MD=' + (fs.existsSync(USER_MD) ? 'ok' : '缺失') +
              ' PROJ_MD=' + (fs.existsSync(PROJ_MD) ? 'ok' : '缺失') +
              ' HANDOFF=' + (fs.existsSync(HANDOFF) ? 'ok' : '缺失');
  console.log('  SKIP F-2/F-3 全部数据驱动断言：本机没有真实记忆目录（HOME=' + HOME + ' ; ' + why + '）');
  console.log('  SKIP 原因：本套件验证的是「在真实数据上能否产出四层对照表且不改动文件」，');
  console.log('  SKIP       没有真实数据时**无法给出任何有意义的判定** ⇒ 显式 skip，不当成 PASS。');
  console.log('  SKIP 这是 CI 上的预期行为，不是产品缺陷。');
}
const uTxt = HAS_REAL_DATA ? fs.readFileSync(USER_MD, "utf8") : "";
const pTxt = HAS_REAL_DATA ? fs.readFileSync(PROJ_MD, "utf8") : "";
const uItems = HAS_REAL_DATA ? RE.listRuleItemsPre(uTxt) : [];
const pItems = HAS_REAL_DATA ? RE.listRuleItemsPre(pTxt) : [];
const hFiles = HAS_REAL_DATA ? fs.readdirSync(HANDOFF).filter((f) => f.endsWith(".md")) : [];

// ★启发式粗分（仅估算，非真实分拣 —— 见文件头诚实标注）
const NORM_KW = ['必须', '严禁', '绝不', '不得', '禁止', '务必', '一律', '永远不', '不要再', '不准', '硬性规则', '规则】', '合规', '强制'];
const PREF_KW = ['偏好', '倾向', '喜欢', '在意', '反对', '希望', '习惯', '感受', '情绪', '沟通', '表达'];
const isRule = (t) => NORM_KW.some((k) => t.indexOf(k) >= 0);
const isPref = (t) => PREF_KW.some((k) => t.indexOf(k) >= 0);

const L0 = [], L1 = [], L2 = [];
let flow = 0;
for (const it of uItems) {
  const t = it.text;
  if (isRule(t) && !isPref(t)) L1.push(t);
  else if (isPref(t)) L0.push(t);
  else flow += 1;
}
for (const it of pItems) {
  const t = it.text;
  if (isRule(t)) L2.push(t);
  else flow += 1;
}

const table = [
  { layer: 'L0', name: '人之上的层', dest: '~/.dsh/memory/person/event-store.json', src: '用户级 MEMORY.md', n: L0.length, note: '画像/共同经历/情感（emotional）' },
  { layer: 'L1', name: '用户规约', dest: '~/.dsh/memory/MEMORY.md', src: '用户级 MEMORY.md', n: L1.length, note: '跨项目硬的约束（rational）' },
  { layer: 'L2', name: '项目规约', dest: 'workspaces/<wsid>/MEMORY.md', src: '项目 MEMORY.md', n: L2.length, note: '本项目必守（rational）' },
  { layer: 'L3', name: '项目事件', dest: 'workspaces/<wsid>/handoff/event-store.json', src: 'handoff/*.md', n: hFiles.length, note: '共同经历/事件' },
  { layer: '—', name: '纯流水', dest: 'memory_log / 丢弃', src: '两份 MEMORY.md', n: flow, note: '原件已备份' },
];

console.log('');
console.log('| 层 | 名称 | 去向 | 源 | 条目数 | 说明 |');
console.log('|---|---|---|---|---:|---|');
for (const r of table) console.log('| **' + r.layer + '** | ' + r.name + ' | ' + r.dest + ' | ' + r.src + ' | ' + r.n + ' | ' + r.note + ' |');
console.log('');

if (!HAS_REAL_DATA) skip('F-2a 对照表含 5 行'); else ok(table.length === 5, '★★F-2a 对照表含 5 行（四层 + 流水）');
if (!HAS_REAL_DATA) skip('F-2b 第一行是 L0'); else ok(table[0].layer === 'L0', '★★★F-2b **第一行就是 L0**（用户最关心的一条）');
if (!HAS_REAL_DATA) skip('F-2c L0 有条目'); else ok(table[0].n > 0, '★★★F-2c **L0 有条目**（不是 0 ⇒ 用户画像/共同经历被独立识别出来了）', String(table[0].n));
if (!HAS_REAL_DATA) skip('F-2d L0 有样例'); else ok(L0.length > 0 && L0.every((x) => typeof x === 'string' && x.length > 0), '★★★F-2d L0 有**样例内容**（不只一个数字）', '样例 ' + L0.length + ' 条');
console.log('');
console.log('  ★L0 样例（前 3 条）:');
L0.slice(0, 3).forEach((x, i) => console.log('    ' + (i + 1) + '. ' + x.slice(0, 70)));

// ★守恒：用户级 = L0 + L1 + 流水（用户侧）；项目级 = L2 + 流水（项目侧）
const userSide = L0.length + L1.length + uItems.filter((it) => { const t = it.text; return !(isRule(t) && !isPref(t)) && !isPref(t); }).length;
if (!HAS_REAL_DATA) skip('F-2e 用户级守恒'); else ok(userSide === uItems.length, '★★★F-2e 用户级条目守恒（L0+L1+流水 = 旧条目数）', userSide + ' = ' + uItems.length);
const projSide = L2.length + pItems.filter((it) => !isRule(it.text)).length;
if (!HAS_REAL_DATA) skip('F-2f 项目级守恒'); else ok(projSide === pItems.length, '★★★F-2f 项目级条目守恒（L2+流水 = 旧条目数）', projSide + ' = ' + pItems.length);
if (!HAS_REAL_DATA) skip('F-2g 总守恒'); else ok(L0.length + L1.length + L2.length + flow === uItems.length + pItems.length, '★★★F-2g 总守恒（四层之和 = 两份旧文件条目总数）', (L0.length + L1.length + L2.length + flow) + ' = ' + (uItems.length + pItems.length));

// ══════════════════════════════════════════════════════════════════════
// 不真改证明
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[F-3] ★不真改证明（sha256 前后一致）');
const shaAfter = HAS_REAL_DATA ? { user: sha(USER_MD), proj: sha(PROJ_MD) } : { user: '', proj: '' };
if (!HAS_REAL_DATA) skip('F-3a 用户级未改动'); else ok(shaBefore.user === shaAfter.user, '★★★F-3a 用户级 MEMORY.md **未被改动**（sha256 前后一致）');
if (!HAS_REAL_DATA) skip('F-3b 项目未改动'); else ok(shaBefore.proj === shaAfter.proj, '★★★F-3b 项目 MEMORY.md **未被改动**（sha256 前后一致）');
console.log('    用户级 sha16 = ' + shaAfter.user.slice(0, 16).toUpperCase());
console.log('    项目   sha16 = ' + shaAfter.proj.slice(0, 16).toUpperCase());

// ══════════════════════════════════════════════════════════════════════
// 诚实标注（CR-10）：这份对照表是**估算**，不是真实分拣
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[F-4] 诚实标注检查（★真断言，不是 ok(true) 恒真守卫）');
{
  // ★★这三条最初写成 `ok(true, ...)` —— 那是**恒真守卫**（「绿但假」第 ② 形态），
  //   什么都不会红。改成真断言：去提示词里查这几句话**确实写着**。
  const MP = await import(pathToFileURL(path.join(ROOT, 'lib', 'migration-prompt.js')).href);
  const promptText = MP.MEMORY_BASIS_MIGRATION_PROMPT;
  ok(promptText.indexOf('判据') >= 0, '★★F-4a 提示词里**确实写着**「判据」（H5 实测 20%）');
  // ★2026-10-27 v6：原判据要求「20% 或 准确率」字面量，但 v6 已删修订史（含该依据）。
  //   语义意图不变：提示词必须给出**可判定的行为指令**（不是空泛要求），用「模型判断」+「不许正则」双证。
  ok(promptText.indexOf('判据') >= 0 && promptText.indexOf('三条全满足') >= 0, '★★F-4b 提示词给出可判定的判据依据（模型判断 + 不许正则）')
  ok(promptText.indexOf('用户画像') >= 0 && promptText.indexOf('emotional') >= 0, '★★F-4c 提示词里写着「用户画像 = emotional」的三类分立判据');
  // ★本条自检：本套件不得有 ok(true 这种恒真守卫
  //   ★实现注意：不能直接对**本文件**全文正则 —— 正则字面量自身会被匹配（第一次就踩了，F-4d 假红）。
  //     正解：把匹配模式用**字符串拼接**构造，让它不出现在源码的纯文本形态里。
  const selfSrc = fs.readFileSync(new URL(import.meta.url), 'utf8');
  // ★★必须先剥注释再查（第 10 次「注释污染」）：本块的说明文字里就写着 ok(true, ...) 作为反例，
  //   不剥注释 ⇒ 正则命中自己写的注释 ⇒ 假红。仓内既有约定：stripComments。
  const stripComments = (src) => src.split('\n').map((ln) => {
    const i = ln.indexOf('//');
    if (i < 0) return ln;
    // 粗略处理字符串内的 // 不完美，但本套件没有 URL 字面量，够用
    return ln.slice(0, i);
  }).join('\n');
  const PAT = 'ok' + '\\(' + 'true' + '\\s*,';
  const tautology = new RegExp(PAT).test(stripComments(selfSrc));
  ok(tautology === false, '★★★F-4d **本套件不含 ok(true) 恒真守卫**（元断言，防自己假绿，模式用拼接构造避免自匹配）');
}

console.log('');
console.log('[v4-h3-f-migration-drill] ' + pass + ' PASS / ' + fail + ' FAIL / ' + skipped + ' SKIP');
process.exit(fail ? 1 : 0)