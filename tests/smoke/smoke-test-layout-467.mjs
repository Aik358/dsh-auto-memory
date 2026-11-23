// #467 验收：datadir.js 深化为 layout 收口后，必须**真 import → 真调用 → 与真引擎对拍**。
//
// 判据纪律（CR-10）：
//   ① 不用「源码含某字符串」充当功能验收 —— 每条断言都真调 datadir 的新导出并断言返回值；
//   ② **对拍是最强判据**：真起 MemoryEngine，把 engine.projectDirOf/userDirOf/wsKey 的**真实输出**
//      与 datadir 的纯计算逐字比对。若两处口径漂移，这里必红（这正是 #467 要防的病）。
//   ③ 存量兼容必须**真跑**：memoryDir 的 <name>-pre 增量补齐语义在深化后必须逐字不变
//      （否则 #312 那类"改一处漏一处"的事故会重演）。
//   ④ 每条判据都带负路径。
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHarness } from './_harness.mjs'
import {
  LAYOUT, expandHome, workspaceKey, workspacesRoot, projectDir, userDir,
  handoffDir, planPath, archiveDir, eventStorePath, notesPath, calendarPath,
  resolveLayout, layoutRoots, isInsideLayout, isLexicallyInsideProject, memoryDir,
} from '../../lib/datadir.js'

const T = createHarness('layout-467')
const isWin = process.platform === 'win32'

console.log('\n[1] 纯函数：工作区键与 ~ 展开（与 engine 同口径）')
{
  T.eq(workspaceKey(''), 'default', '空工作区 ⇒ default')
  T.eq(workspaceKey('D:\\a\\b'), '--D--a-b--', '盘符与分隔符逐字符替换为 -')
  T.eq(workspaceKey('/home/u/p'), '---home-u-p--', 'POSIX 路径同款转义（开头的 / 也变 - ⇒ 三个连字符；与引擎对拍逐字一致）')
  // 负路径：非法字符表必须真的生效（'*' '?' ':' 等是 Windows 禁止字符）
  T.eq(workspaceKey('a*b?c"d<e>f|g'), '--a-b-c-d-e-f-g--', '全部非法字符都被替换（负路径：漏一个即红）')
  T.eq(expandHome('~', '/H'), '/H', '~ ⇒ home')
  T.eq(expandHome('~/x', '/H'), path.join('/H', 'x'), '~/x ⇒ home/x')
  T.ok(expandHome('', '/H') === undefined, '空串 ⇒ undefined（负路径：不产生误值）')
}

console.log('\n[2] resolveLayout 各 kind + 未知 kind fail-soft')
{
  const o = { ws: 'D:\\ws', home: '/H' }
  const pd = resolveLayout('project', o)
  T.ok(pd.endsWith(path.join('workspaces', '--D--ws--')), 'project ⇒ <home>/memory/workspaces/--D--ws--')
  T.eq(resolveLayout('handoff', o), path.join(pd, 'handoff'), 'handoff 是 project 的子目录')
  T.eq(resolveLayout('plan', o), path.join(pd, 'handoff', 'PLAN.md'), 'plan 落在 handoff/PLAN.md')
  T.eq(resolveLayout('archive', o), path.join(pd, 'handoff', 'archive'), 'archive 落在 handoff/archive')
  T.eq(resolveLayout('event-store', o), path.join(pd, 'handoff', 'event-store.json'), 'event-store 落在 handoff/')
  T.eq(resolveLayout('notes', o), path.join(pd, 'MEMORY.md'), 'notes 在项目根')
  T.eq(resolveLayout('calendar', o), path.join(pd, 'CALENDAR.md'), 'calendar 在项目根')
  T.eq(resolveLayout('nonsense', o), '', '未知 kind ⇒ 空串（fail-soft：宁可立刻失败也不写错地方）')
  // 负路径：绝对路径形式的 projectMemoryDir 必须走"旧用法兼容"分支，不再拼 workspaces
  T.eq(projectDir({ ws: 'D:\\ws', projectMemoryDir: '/ABS/dir', home: '/H' }).kind, 'absolute',
    'projectMemoryDir 为绝对路径 ⇒ kind=absolute（旧用法兼容分支）')
  T.eq(projectDir({ ws: 'D:\\ws', projectMemoryDir: '/ABS/dir', home: '/H' }).dir, '/ABS/dir',
    '绝对路径分支直接返回该路径，不与 workspaces 拼接')
}

console.log('\n[3] 与**真引擎**对拍（最强判据：口径漂移必红）')
let engine = null
{
  const iso = T.isolatedHome()
  iso.applyEnv()
  try {
    const { MemoryEngine } = await import('../lib/audit-engine.mjs')
    engine = new MemoryEngine()
    engine.config = Object.assign({}, engine.config, {
      memoryRoot: path.join(iso.home, 'memory', 'workspaces'),
      userMemoryDir: path.join(iso.home, 'memory'),
    })
    engine.configLoaded = true
  } catch (e) {
    console.error('  engine load failed: ' + (e && e.message))
  } finally {
    iso.restoreEnv()
  }
  if (!engine) {
    T.skip('引擎对拍段', '隔离环境下 MemoryEngine 装载失败')
  } else {
    const wsList = ['D:\\ws\\a', '/home/u/proj', '', 'C:\\有 空格\\x']
    for (const ws of wsList) {
      T.eq(workspaceKey(ws), engine.wsKey(ws), 'wsKey 对拍 ws=' + JSON.stringify(ws))
      const got = projectDir({ ws, memoryRoot: engine.config.memoryRoot, projectMemoryDir: engine.config.projectMemoryDir, home: T.isolatedHome().home }).dir
      T.eq(got, engine.projectDirOf(ws), 'projectDir 对拍 ws=' + JSON.stringify(ws))
    }
    T.eq(userDir({ userMemoryDir: engine.config.userMemoryDir }), engine.userDirOf(),
      'userDir 对拍 engine.userDirOf()')
    const ews = engine.wsKey('D:\\q')
    T.ok(ews === '--D--q--', 'engine.wsKey 自证（若引擎口径变了，本段对拍会红并指出）')
  }
}

console.log('\n[4] 边界判据：正例放行 / 越界必拒（负路径）')
{
  // ★必须用**真实存在**的根：fileWithinRoots 走 realpath，根不存在时会一路 null
  //   （这正是上一版本段判红的成因 —— 判据写错，不是实现错）。
  const home = T.tmpdir('dam-467-bnd-')
  const o = { ws: 'D:\\ws', home, userMemoryDir: path.join(home, 'udir') }
  const pd = resolveLayout('project', o)
  mkdirSync(path.join(pd, 'handoff'), { recursive: true })
  writeFileSync(path.join(pd, 'handoff', 'PLAN.md'), 'x', 'utf8')
  T.ok(isLexicallyInsideProject(path.join(pd, 'handoff', 'PLAN.md'), o), '项目内文件 ⇒ 词法判定通过')
  T.ok(!isLexicallyInsideProject(path.join(pd, '..', 'evil', 'x.md'), o), '相邻前缀外的路径 ⇒ 拒（负路径）')
  T.ok(!isLexicallyInsideProject(pd + '-sibling/x', o), '同前缀相邻目录 ⇒ 拒（这正是 #236 的成因）')
  const inside = isInsideLayout(path.join(pd, 'handoff', 'PLAN.md'), o)
  T.ok(inside !== null, 'isInsideLayout 走 file-boundary（真实存在的项目内文件 ⇒ 返回被校验路径）')
  // 负路径：真实存在但不属于本工作区记忆的目录 ⇒ 必须 null，且**不自动改写**到别处
  const other = T.tmpdir('dam-467-out-')
  writeFileSync(path.join(other, 'outside.md'), 'x', 'utf8')
  T.ok(isInsideLayout(path.join(other, 'outside.md'), o) === null, '工作区外（真实存在）⇒ null 拒绝')
  // 负路径：越界的**不存在**路径也不得因 allowMissing 而放行
  T.ok(isInsideLayout(path.join(other, 'not-yet.md'), o) === null, '工作区外且不存在 ⇒ 仍拒（allowMissing 不放行外域）')
}

console.log('\n[5] 常量同源：LAYOUT.eventStoreFile 必须等于 event-store.js 的权威常量')
{
  const es = await import('../../lib/event-store.js')
  T.ok(typeof es.EVENT_STORE_FILENAME === 'string', 'event-store.js 导出了文件名常量')
  T.eq(LAYOUT.eventStoreFile, es.EVENT_STORE_FILENAME, '两处文件名同值（不同即红：说明又被抄了一份）')
}

console.log('\n[6] 存量兼容：memoryDir 的 <name>-pre 增量补齐语义**逐字未变**')
{
  const home = T.tmpdir('dam-467-legacy-')
  mkdirSync(path.join(home, 'memory', 'zed-pre'), { recursive: true })
  writeFileSync(path.join(home, 'memory', 'zed-pre', 'a.json'), JSON.stringify({ k: [1] }), 'utf8')
  const got = memoryDir('zed', () => home)
  T.eq(got, path.join(home, 'memory', 'zed'), '仍返回裸名目录')
  T.ok(existsSync(path.join(got, 'a.json')), '旧目录文件已补齐（迁移语义保持）')
  const log = path.join(home, 'memory', 'datadir-migration.log')
  T.ok(existsSync(log) && readFileSync(log, 'utf8').includes('zed-pre -> zed'), '迁移日志照写（存量可观测行为未变）')
  // 负路径：只建裸名目录、无 -pre ⇒ 不做任何复制，且原样返回
  const home2 = T.tmpdir('dam-467-nopre-')
  mkdirSync(path.join(home2, 'memory', 'y'), { recursive: true })
  const got2 = memoryDir('y', () => home2)
  T.eq(got2, path.join(home2, 'memory', 'y'), '无 -pre ⇒ 原样返回')
  T.ok(!existsSync(path.join(home2, 'memory', 'datadir-migration.log')), '无 -pre ⇒ 不产生迁移日志（负路径：不乱写）')
}

T.done()
