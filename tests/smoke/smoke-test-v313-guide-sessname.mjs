/**
 * v3.1.3 引导改版 + 会话名去硬编码 的永久守卫。
 *
 * 钉死四件事（都是本次修过的、以后容易腐化的点）：
 *   V1 会话文件名解析：结构识别（不再固定候选表）+ 未来 v4 能被选中 + 备份排除
 *   V2 引导末页：两个链接在场，且 DSH API 链接**必须带 aff**
 *   V3 finishTour 不再有硬编码 '2.1.0' 的 latestKey
 *   V4 引导里不再出现已废弃的分区名（自动记忆引擎 / 记忆中枢审批）——防文案再次腐化
 *
 * 与既有套件同风格：自包含、零外部依赖、只读源码 + 真跑纯函数。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IX = path.join(ROOT, 'lib', 'index.js')
const CL = path.join(ROOT, 'lib', 'client.js')
const GC = path.join(ROOT, 'lib', 'subagent-gc.js')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.error('  ✗ ' + n + (d ? ' — ' + d : '')) } }
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

const ix = fs.readFileSync(IX, 'utf8')
const cl = fs.readFileSync(CL, 'utf8')
const gc = fs.readFileSync(GC, 'utf8')

console.log('=== V1 会话文件名去硬编码 ===')
ok(ix.includes('pickSessionFileNamePre(names, mtimes)'), 'V1a 宿主存在结构识别函数')
ok(cnt(ix, `const cands = ['session.v3.jsonl.zstd', 'session.jsonl.zstd', 'session.v3.jsonl', 'session.jsonl']`) === 1,
  'V1b 旧固定表**只保留在回退分支**里（实得 ' + cnt(ix, `const cands = ['session.v3.jsonl.zstd'`) + ' 处）')
ok(ix.includes('picked = this.pickSessionFileNamePre'), 'V1c resolveSessionFile 走目录扫描')
ok(ix.includes('遍历该会话目录里**全部** session.* 文件'), 'V1d sid 回退走目录遍历')
ok(gc.includes('hits.length ? hits'), 'V1e subagent-gc 走目录扫描')

// 真跑纯函数（源码抽取 + new Function，与补丁脚本同法但独立实现）
console.log('\n=== V1 纯函数真跑 ===')
try {
  const start = ix.indexOf('  pickSessionFileNamePre(names, mtimes) {')
  const ret = ix.indexOf('return cands[0].name', start)
  const end = ix.indexOf('\n  }', ret) + 5
  const body = ix.slice(start, end).replace('  pickSessionFileNamePre(names, mtimes) {', 'pickSessionFileNamePre(names, mtimes) {')
  const obj = new Function('return ({' + body + '})')()
  const P = (n, m) => obj.pickSessionFileNamePre(n, m)
  ok(P(['session.v4.jsonl.zstd', 'session.v3.jsonl.zstd'], {}) === 'session.v4.jsonl.zstd', 'V1f ★未来 v4 命名被选中')
  ok(P(['session.jsonl.zstd'], {}) === 'session.jsonl.zstd', 'V1g 旧命名仍兼容')
  ok(P(['session.v3.jsonl.broken-backup-1.zstd', 'session.jsonl.zstd'], {}) === 'session.jsonl.zstd', 'V1h 备份文件被排除')
  ok(P([], {}) === '', 'V1i 空目录返回空串')
} catch (e) { ok(false, 'V1 纯函数真跑异常', String(e && e.message || e).slice(0, 200)) }

console.log('\n=== V2 引导末页两个链接 ===')
ok(cl.includes('data-dam-tour-links'), 'V2a 末页链接容器在场')
ok(cl.includes('https://api.dshapi.icu/register?aff=HJU27P7JL39N'), 'V2b ★DSH API 链接带推广参数')
ok(cl.includes('htmlpreview.github.io/?https://github.com/Aik358/dsh-auto-memory/blob/main/docs/CONTRIBUTORS.html'), 'V2c 贡献者页链接在场')
ok(!/api\.dshapi\.icu\/(?!register\?aff=)/.test(cl), 'V2d 客户端无裸链接残留')

console.log('\n=== V3 finishTour 版本内联动态化 ===')
ok(cl.includes(`var latestKey = Object.keys(CHANGELOG).reduce(`), 'V3a latestKey 动态取最大值')
ok(!/var latestKey = '2\.1\.0'/.test(cl), 'V3b ★不再硬编码 2.1.0')
ok(cl.includes(`currentVersion: cur }), try { localStorage.setItem('dsh-auto-memory.seenVersion'`) ||
   cl.includes('seenVersion'), 'V3c seenVersion 仍被记录')

console.log('\n=== V4 过时文案不再回归 ===')
ok(!cl.includes('（默认关；内容比可见输出更敏感，按需开）'), 'V4a 思维链监听「默认关」已清除')
ok(cl.includes('默认开；内容比可见输出更敏感'), 'V4b 已改为「默认开」')
ok(!cl.includes('「记忆中枢」页审批'), 'V4c 技能固化指向记忆中枢审批已清除')
ok(cl.includes('晋升审批在「唤起回顾」页'), 'V4d 已改为唤起回顾页')
ok(!cl.includes(`planDisabled: '交接白板未启用(设置 → 自动化)。'`), 'V4e planDisabled 指向「自动化」已清除')
ok(cl.includes(`planDisabled: '交接白板未启用(设置 → 长会话接续)。'`), 'V4f 已改为「长会话接续」')
ok(!cl.includes('设置 → 自动记忆引擎 开启「记忆锚定索引」'), 'V4g 已废弃分区名指引已清除')
ok(cl.includes('设置 → 语义记忆总开关 开启「记忆锚定索引」'), 'V4h 已改为实际分区名')

console.log('\n=== V5 开关说真话（A 类） ===')
ok(ix.includes('engine.config.injectEnabled === false'), 'V5a ★injectEnabled 已接线（不再是死开关）')
ok(ix.includes('本键当前**无消费者**'), 'V5b softInjectionEnabled 已标注')
// ★A-1（2026-09-23）：本项原断言「设置页已补机械切片控件」（V5c）。该功能已整条删除
//   （用户裁定「机械通路已被我弃用」）⇒ 断言反转为「控件与配置键都不该再出现」，
//   否则会留下「写盘成功但界面无变化」的死控件（用户明确列为「功能坏了」）。
ok(!cl.includes(`'data-dam-key': 'hubMechanicalProcedureFeedEnabled'`), 'V5c ★A-1 设置页死控件已移除（机械切片已退役）')
ok(!cl.includes('hubMechanicalProcedureFeedEnabled'), 'V5d ★A-1 前端不再引用已退役的配置键')

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
