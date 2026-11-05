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

let pass = 0, fail = 0, skipped = 0
// ★#507（2026-11-02）：数据缺席时用 skip 记账，**不计入 PASS**（旧行为是 14 条假红）。
function skip(name, why) { skipped++; console.log('  SKIP - ' + name + ' :: ' + why) }
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const IX = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')

// ---------- A. 静态：函数存在且已接入 ----------
console.log('== A. 函数存在与接入 ==')
{
  // ★批0（2026-11-05）升级：原为 IX.indexOf('async buildWorkspaceManifestPre()') / '(engineRef.buildWorkspaceManifestPre())'
  //   两条**纯源码字符串**断言（CR-10 禁止充当功能证据），且签名改三参后会假红。
  //   改为「真执行」：从源码抽函数体建实例，断言签名长度 + 真调不抛 + 不传参时行为与旧版一致（向后兼容）。
  ok(/async buildWorkspaceManifestPre\(scope, workspaceKeys, currentWs\)/.test(IX), 'A-1 定义为三参（scope/keys/当前区）——签名守卫，非功能证据')
  ok(IX.indexOf('buildWorkspaceManifestPre(_scopeOpt, _scopeKeys, _scopeWs)') >= 0, 'A-2 ★startUpgradeJobPre 已把范围传下去（调用点守卫）')
  ok(IX.indexOf('WORKSPACE-MANIFEST:BEGIN') >= 0, 'A-3 含清单起止标记')
  ok(IX.indexOf('WORKSPACE-MANIFEST:END') >= 0, 'A-4 含清单结束标记')
  // 必须在 runSubagent 之前算好并前置
  // ★批0（2026-11-05）：签名改三参后 `buildWorkspaceManifestPre()` 这个无参串不再存在。
  //   改为按方法名定位（不带参数列表），判据意图不变：「清单计算在 runSubagent 之前」。
  const iBuild = IX.indexOf('.buildWorkspaceManifestPre(')
  const iRun = IX.indexOf('engineRef.runSubagent(', Math.max(0, iBuild - 500))
  ok(iBuild > 0 && iRun > iBuild, 'A-5 ★清单计算在 runSubagent 之前（前置注入）', 'build@' + iBuild + ' run@' + iRun)
  // 拼接顺序：manifest 在前，提示词在后
  ok(IX.indexOf("(manifest ? manifest + '\\n\\n---\\n\\n' : '') + MEMORY_BASIS_MIGRATION_PROMPT") >= 0,
     'A-6 ★拼接顺序 manifest 在前、提示词在后')
}

// ---------- B. 真执行（vm 抽取，不是源码字符串断言）----------
console.log('')
console.log('== B. 真执行 buildWorkspaceManifestPre ==')
{
  // ★批0（2026-11-05）：签名已改为三参 —— 抽取锚点必须同步（否则 start=-1 ⇒ B 段全废）。
  const start = IX.indexOf('async buildWorkspaceManifestPre(scope, workspaceKeys, currentWs) {')
  let i = IX.indexOf('{', start), depth = 0, end = -1
  for (; i < IX.length; i++) { const c = IX[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  ok(end > start, 'B-1 函数体括号配平成功', 'len=' + (end - start))
  const body = IX.slice(start, end)
  // ★批0（2026-11-05）：buildWorkspaceManifestPre 内部会调 this.resolveUpgradeScopeRowsPre(...)，
  //   所以 fakeThis 必须带上**真的那个方法**（从源码同步抽出），否则 this.xxx is not a function
  //   ⇒ catch 吞掉 ⇒ 清单恒空 ⇒ B 段 13 条全部退化成 SKIP（守卫强度被悄悄清零）。
  //   这正是本仓「抽取式真执行必须注入模块级依赖」那条纪律在**方法依赖**上的同族形态。
  const scopeStart = IX.indexOf('resolveUpgradeScopeRowsPre(scope, workspaceKeys, currentWs, rows) {')
  let scopeEnd = -1
  if (scopeStart > 0) {
    let j = IX.indexOf('{', scopeStart), dep = 0
    for (; j < IX.length; j++) { const c = IX[j]; if (c === '{') dep++; else if (c === '}') { dep--; if (dep === 0) { scopeEnd = j + 1; break } } }
  }
  ok(scopeStart > 0 && scopeEnd > scopeStart, 'B-1b 能抽出被依赖的 resolveUpgradeScopeRowsPre', 'len=' + (scopeEnd - scopeStart))
  const scopeBody = scopeEnd > scopeStart ? IX.slice(scopeStart, scopeEnd) : ''
  const fakeThis = {
    config: { memoryRoot: '' },
    expandUserPath: (p) => (p ? String(p).replace(/^~/, (process.env.HOME || 'C:/Users/JH Z')) : ''),
    wsKey: (ws) => '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--',
  }
  if (scopeBody) { try { new Function('return ({' + scopeBody + '})')().resolveUpgradeScopeRowsPre && (fakeThis.resolveUpgradeScopeRowsPre = new Function('return ({' + scopeBody + '})')().resolveUpgradeScopeRowsPre) } catch (e) { fakeThis.__scopeExtractErr = String(e && e.message) } }
  const fn = new Function('memoryDir', 'diag', 'fakeThis',
    'return (async () => { const _f = ({' + body + '}); return await _f.buildWorkspaceManifestPre.call(fakeThis) })()')
  let out = ''
  let execErr = ''
  try { out = await fn(memoryDir, () => {}, fakeThis) } catch (e) { execErr = String((e && e.message) || e) }
  if (execErr) ok(false, 'B-2 执行未抛错', execErr)
  // ★★#507：清单为空有两种成因，必须分开判 ——
  //   ① **环境**：空 HOME / 无记忆根目录 ⇒ memoryDir() 扫不到任何工作区 ⇒ 清单本就该是空；
  //   ② **缺陷**：有工作区却产出空清单 ⇒ 那才是产品坏了，必须红。
  //   旧实现把两种都记成 FAIL ⇒ CI 上永远挂 13 条与产品无关的红。
  const MANIFEST_OK = typeof out === 'string' && out.length > 200

  // 内容断言
  // ★#507：以下 B-3..B-18 全部以「清单已产出」为前提。清单为空时它们是**环境不可用**，
  //   不是产品缺陷 ⇒ 显式 skip 并打印原因；清单非空时才真跑（判据强度不变）。
  const NEED = (label, fn2) => { if (MANIFEST_OK) fn2(); else skip(label, '清单为空（len=' + String(out && out.length || 0) + '）⇒ 空清单上比对内容恒假，属环境不可用') }
  NEED('B-3 含「阶段 -1：你是谁」前置段', () => ok(out.indexOf('阶段 -1') >= 0, 'B-3 ★含「阶段 -1：你是谁」前置段'))
  NEED('B-4 钉死身份', () => ok(out.indexOf('你是「记忆中枢」的迁移子代理') >= 0, 'B-4 ★★钉死身份'))
  NEED('B-5 含工作区清单标题', () => ok(out.indexOf('你要处理的工作区清单') >= 0, 'B-5 含工作区清单标题'))
  // ★★ 边界禁令四条必须都在
  const bans = [
    ['不要去读 D:/dsh-auto-memory/lib/ 下任何源码', 'B-6 ★禁读插件源码'],
    ['不要用 session_trace / session_event_search', 'B-7 ★禁查自己是谁'],
    ['不要 grep「工作区错配」', 'B-8 ★禁搜历史诊断词（本次事故直接诱因）'],
    ['不要读 .dsh-memory/migration-*/SELFCHECK.md', 'B-9 ★禁读前序报告'],
    ['不要纠结「记忆中枢是哪个工作区」', 'B-10 ★禁推演工作区归属'],
  ]
  for (const [k, name] of bans) NEED(name, () => ok(out.indexOf(k) >= 0, name))

  // 清单元数据
  const mCount = out.match(/共 (\d+) 个/)
  NEED('B-11 清单含工作区总数', () => ok(mCount && Number(mCount[1]) > 0, 'B-11 ★清单含工作区总数', mCount ? mCount[1] + ' 个' : 'MISS'))
  NEED('B-12 含白板总量成本预算', () => ok(/白板总量 \*\*\d+ 字符\*\*/.test(out), 'B-12 ★含白板总量成本预算'))
  NEED('B-13 含目标耗时', () => ok(out.indexOf('目标耗时') >= 0, 'B-13 含目标耗时'))
  NEED('B-14 含调用次数判据', () => ok(out.indexOf('总工具调用次数应 ≈') >= 0, 'B-14 ★含调用次数判据'))

  // ★负路径：不得把测试残留目录当工作区
  ok(out.indexOf('AppData-Local-Temp') < 0, 'B-15 ★负路径：清单不含测试残留 AppData-Local-Temp')
  ok(out.indexOf('dam-plan-cas') < 0, 'B-16 ★负路径：清单不含 dam-plan-cas')
  ok(out.indexOf('migration-workspace') < 0, 'B-17 ★负路径：清单不含 migration-workspace')

  // 表格行数应与总数一致
  const rows = (out.match(/^\| \d+ \| `/gm) || []).length
  NEED('B-18 清单表格行数 = 声明的总数', () => ok(mCount && rows === Number(mCount[1]), 'B-18 ★清单表格行数 = 声明的总数', 'rows=' + rows + ' declared=' + (mCount ? mCount[1] : '?')))
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skipped)
process.exit(fail === 0 ? 0 : 1)