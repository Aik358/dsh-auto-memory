/**
 * smoke-test-v5-p8-workspace-manifest.mjs
 *
 * ★2026-10-27 新增：`buildWorkspaceManifestPre` 的验收。
 *
 * 【为什么必须有这个函数】
 *   实测事故（v5 首跑 · upg_mvpzovu1558p）：子代理 **55 次工具调用 0 次写盘**，
 *   全程在推演「我到底该在哪个工作区干活」：
 *     · grep「工作区错配」这个历史诊断词
 *     · 读 D:/dsh-auto-memory/lib/index.js 源码（想弄清 runSubagent 怎么定 cwd）
 *     · session_trace / session_event_search 查「我是谁」
 *   最终 subagent 返回空 ⇒ phase=failed。**数据未被污染**（事件仍 2 个）。
 *   ⇒ 根因：提示词没告诉它边界，让它自己推演。
 *   ⇒ 修法：由程序扫描并注入**确定的清单**，子代理零猜测。
 */
import fs from 'node:fs'
import { memoryDir } from '../../lib/datadir.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const IX = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')

// ---------- A. 静态：函数存在且已接入 ----------
console.log('== A. 函数存在与接入 ==')
{
  ok(IX.indexOf('async buildWorkspaceManifestPre()') >= 0, 'A-1 定义了 buildWorkspaceManifestPre')
  ok(IX.indexOf('engineRef.buildWorkspaceManifestPre()') >= 0, 'A-2 ★已接入 startUpgradeJobPre')
  ok(IX.indexOf('WORKSPACE-MANIFEST:BEGIN') >= 0, 'A-3 含清单起止标记')
  ok(IX.indexOf('WORKSPACE-MANIFEST:END') >= 0, 'A-4 含清单结束标记')
  // 必须在 runSubagent 之前算好并前置
  const iBuild = IX.indexOf('buildWorkspaceManifestPre()')
  const iRun = IX.indexOf('engineRef.runSubagent(', iBuild - 500)
  ok(iBuild > 0 && iRun > iBuild, 'A-5 ★清单计算在 runSubagent 之前（前置注入）', 'build@' + iBuild + ' run@' + iRun)
  // 拼接顺序：manifest 在前，提示词在后
  ok(IX.indexOf("(manifest ? manifest + '\\n\\n---\\n\\n' : '') + MEMORY_BASIS_MIGRATION_PROMPT") >= 0,
     'A-6 ★拼接顺序 manifest 在前、提示词在后')
}

// ---------- B. 真执行（vm 抽取，不是源码字符串断言）----------
console.log('')
console.log('== B. 真执行 buildWorkspaceManifestPre ==')
{
  const start = IX.indexOf('async buildWorkspaceManifestPre() {')
  let i = IX.indexOf('{', start), depth = 0, end = -1
  for (; i < IX.length; i++) { const c = IX[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  ok(end > start, 'B-1 函数体括号配平成功', 'len=' + (end - start))
  const body = IX.slice(start, end)
  const fakeThis = {
    config: { memoryRoot: '' },
    expandUserPath: (p) => (p ? String(p).replace(/^~/, (process.env.HOME || 'C:/Users/JH Z')) : ''),
  }
  const fn = new Function('memoryDir', 'diag', 'fakeThis',
    'return (async () => { const _f = ({' + body + '}); return await _f.buildWorkspaceManifestPre.call(fakeThis) })()')
  let out = ''
  try { out = await fn(memoryDir, () => {}, fakeThis) } catch (e) { ok(false, 'B-2 执行未抛错', e.message) }
  ok(typeof out === 'string' && out.length > 200, 'B-2 ★真执行返回非空清单', 'len=' + out.length)

  // 内容断言
  ok(out.indexOf('阶段 -1') >= 0, 'B-3 ★含「阶段 -1：你是谁」前置段')
  ok(out.indexOf('你是「记忆中枢」的迁移子代理') >= 0, 'B-4 ★★钉死身份')
  ok(out.indexOf('你要处理的工作区清单') >= 0, 'B-5 含工作区清单标题')
  // ★★ 边界禁令四条必须都在
  const bans = [
    ['不要去读 D:/dsh-auto-memory/lib/ 下任何源码', 'B-6 ★禁读插件源码'],
    ['不要用 session_trace / session_event_search', 'B-7 ★禁查自己是谁'],
    ['不要 grep「工作区错配」', 'B-8 ★禁搜历史诊断词（本次事故直接诱因）'],
    ['不要读 .dsh-memory/migration-*/SELFCHECK.md', 'B-9 ★禁读前序报告'],
    ['不要纠结「记忆中枢是哪个工作区」', 'B-10 ★禁推演工作区归属'],
  ]
  for (const [k, name] of bans) ok(out.indexOf(k) >= 0, name)

  // 清单元数据
  const mCount = out.match(/共 (\d+) 个/)
  ok(mCount && Number(mCount[1]) > 0, 'B-11 ★清单含工作区总数', mCount ? mCount[1] + ' 个' : 'MISS')
  ok(/白板总量 \*\*\d+ 字符\*\*/.test(out), 'B-12 ★含白板总量成本预算')
  ok(out.indexOf('目标耗时') >= 0, 'B-13 含目标耗时')
  ok(out.indexOf('总工具调用次数应 ≈') >= 0, 'B-14 ★含调用次数判据')

  // ★负路径：不得把测试残留目录当工作区
  ok(out.indexOf('AppData-Local-Temp') < 0, 'B-15 ★负路径：清单不含测试残留 AppData-Local-Temp')
  ok(out.indexOf('dam-plan-cas') < 0, 'B-16 ★负路径：清单不含 dam-plan-cas')
  ok(out.indexOf('migration-workspace') < 0, 'B-17 ★负路径：清单不含 migration-workspace')

  // 表格行数应与总数一致
  const rows = (out.match(/^\| \d+ \| `/gm) || []).length
  ok(mCount && rows === Number(mCount[1]), 'B-18 ★清单表格行数 = 声明的总数', 'rows=' + rows + ' declared=' + (mCount ? mCount[1] : '?'))
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)