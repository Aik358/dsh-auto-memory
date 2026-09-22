/**
 * v3.1.4 批 J 永久守卫：保护门范围收窄（折中档 A）+ archivedIds 真入口 + 引导末页样式。
 *
 * 用户裁定原文（2026-09-22）：「把 procedure 记忆引擎的保护范围已经可以关掉了……
 * 改成在动语义模型的时候需要保护一下，不然能防止全崩」+「既然你发现了有可能会出现故障，
 * 那就先保留，用你的折中档吧」⇒ **折中档 A**。
 *
 * 本套件钉死四件事：
 *   J1 **调用层降级**：白板 M1 不合格 ⇒ 照写 + 警示（不再是硬拒）；M2/M3 仍硬拒。
 *   J2 **纯函数语义未动**：validateMutationBoundaryPre 仍无条件报 M1 红（t0-8 守的那层不许动）。
 *      —— 这是本设计的核心不变量：**降级只发生在调用层**，判据本身保持权威。
 *   J3 **archivedIds 三层链路真通**（用户拍板「补真入口」）：参数表 → writePlanSnapshot → checkMutationPre。
 *   J4 **引导末页样式与 QQ 群按钮**（用户报「按钮实在有点难看」+「加上我那个QQ群的链接」）。
 *
 * ⚠️ 反假红纪律（本项目踩过多次）：容器类断言必须给「锚点 + 窗口」双条件，
 *   不能只 indexOf 一个只出现一次的字符串；计数断言要把替换/新增文本自身的贡献算准。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const MM = fs.readFileSync(path.join(ROOT, 'lib', 'memory-mutation-pre.js'), 'utf8')
const CL = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.error('  ✗ ' + n + (d ? ' — ' + d : '')) } }
const cnt = (h, n) => { let k = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return k; k++; i = p + n.length } }
/** 在 [start, start+win) 窗口内查找 —— 防止 indexOf 命中文件里更早的同类文本（本项目经典假红源）。 */
const inWindow = (h, anchor, needle, win) => { const i = h.indexOf(anchor); if (i < 0) return -1; const j = h.indexOf(needle, i); return (j >= 0 && j - i < win) ? j : -1 }

console.log('=== J1 调用层降级（折中档 A）===')
{
  // 判据必须同时含 target==='plan' 与 every(pass||M1)
  ok(IX.includes("if (!res.ok && target === 'plan' && res.hard.every((h) => h.pass || h.id === 'M1'))"),
    'J1a ★降级判据 = plan 专属 + 仅 M1 不合格（M2/M3 任一不合格仍硬拒）')
  ok(IX.includes('res.m1Downgraded = true') && IX.includes('res.ok = true'),
    'J1b 降级时置 ok=true + m1Downgraded=true（照写）')
  ok(IX.includes('planDowngradeWarn') && IX.includes('白板丢卡警示'),
    'J1c ★降级产生**显式警示行**（不静默放行）')
  // 警示必须能一路带到工具回执（否则"放行"变静默）
  ok(inWindow(IX, 'async writePlanSnapshot', 'const m1Warn = (gate && gate.m1Downgraded)', 4000) > 0,
    'J1d 警示在 writePlanSnapshot 内取出')
  ok(IX.includes('final: written, warn: m1Warn'), 'J1e 警示挂在成功 return 上')
  ok(inWindow(IX, "defineTool('memory_note_pre'", 'const warnLine = (r && r.warn)', 30000) > 0,
    'J1f ★警示在 memory_note_pre 里被拼进回执')
}

console.log('\n=== J2 纯函数语义未动（降级不许污染判据层）===')
{
  ok(!MM.includes('m1Downgraded'), 'J2a ★纯函数模块零降级痕迹（降级只在调用层）')
  ok(MM.includes("id: 'M1',") && MM.includes('pass: unarchived.length === 0'), 'J2b M1 判据仍是原式')
  ok(MM.includes("id: 'M2',") && MM.includes('m2pass'), 'J2c M2 仍硬判（用户备注区）')
  ok(MM.includes("id: 'M3',") && MM.includes('duplicateIds'), 'J2d M3 仍硬判（重复 id）')
}

console.log('\n=== J3 archivedIds 三层链路真通（假出路已修）===')
{
  ok(IX.includes("archivedIds: { type: 'array'"), 'J3a 工具参数表已暴露 archivedIds（此前缺 ⇒ 假出路）')
  ok(IX.includes('archivedIds: archIds'), 'J3b memory_note_pre 真的把参数喂下去')
  ok(inWindow(IX, 'async writePlanSnapshot', 'archivedIds: Array.isArray(opts && opts.archivedIds)', 4000) > 0,
    'J3c writePlanSnapshot 把 opts.archivedIds 透给 checkMutationPre（此前只传 4 字段）')
  ok(IX.includes('archivedIds: Array.isArray(o.archivedIds) ? o.archivedIds : []'), 'J3d checkMutationPre 仍原样喂给纯函数')
  ok(MM.includes('archivedIds'), 'J3e 纯函数侧本就认这个键（链路末端）')
}

console.log('\n=== J4 引导末页样式 + QQ 群按钮 ===')
{
  // v3.1.3 的缺陷：只有属性没有 CSS ⇒ 默认裸链接
  ok(CL.includes('[data-dam-tour-link] {'), 'J4a ★补上了 data-dam-tour-link 的 CSS（v3.1.3 只有属性、无样式）')
  ok(CL.includes(':hover') && inWindow(CL, '[data-dam-tour-link] {', ':hover', 1200) > 0, 'J4b 有 hover 反馈（与既有 chip 体系一致）')
  ok(CL.includes('--dam-accent'), 'J4c 用主题色变量（不硬编码颜色，随主题走）')
  ok(CL.includes('border-radius: 99px'), 'J4d 圆角胶囊（与页面既有 pill 同形）')
  ok(CL.includes("href: 'https://qm.qq.com/q/v7Asxn6vPa'"), 'J4e ★QQ 群按钮已加（链接与 README/CONTRIBUTORS 同源）')
  ok(CL.includes('QQ 交流群') || CL.includes('QQ group'), 'J4f QQ 按钮有中英文案')
  // 三个按钮并存，且仍不破坏原有结构（dots/foot 仍在）
  ok(cnt(CL, "'data-dam-tour-link': ''") === 3, 'J4g 三个按钮并存（实得 ' + cnt(CL, "'data-dam-tour-link': ''") + '）')
  ok(CL.includes("'data-dam-tour-dots'") && CL.includes("'data-dam-tour-foot'"), 'J4h 原有结构未破坏（dots/foot 仍在）')
}

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
