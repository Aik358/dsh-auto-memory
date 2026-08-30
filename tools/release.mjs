#!/usr/bin/env node
/**
 * release.mjs — 预览版(auto-memory-pre / *_pre) → 正式版(auto-memory / 裸名) 自动发布构建
 * 用法: node tools/release.mjs <版本号> [--dry-run]
 *   例: node tools/release.mjs 0.1.30 --dry-run
 * 流程: 复制预览版 → 反转全部 _pre/-pre 标识(发布转换输入禁止出现 _dev/auto-memory-dev) →
 *       生成正式 package.json → 语法/BOM/残留验证。
 * 源目录: 默认 D:\dsh-auto-memory(preview 分支),可用环境变量 DSH_AUTO_MEMORY_DEV 覆盖。
 * 目标目录: 默认 D:\dsh_debug\_publish_dsh-auto-memory,可用环境变量 DSH_AUTO_MEMORY_REL 覆盖;
 *           --dry-run 时强制改用临时 staging 目录,不触碰真实发布基座,不做任何发布动作。
 */
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'

// ---------- 1. 参数 ----------
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const version = argv.find((a) => !a.startsWith('--'))
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('用法: node tools/release.mjs <版本号> [--dry-run]  例: node tools/release.mjs 0.1.30 --dry-run')
  process.exit(1)
}

const DEV = process.env.DSH_AUTO_MEMORY_DEV || 'D:\\dsh-auto-memory'          // 预览版源(preview 工作区)
let REL = process.env.DSH_AUTO_MEMORY_REL || 'D:\\dsh_debug\\_publish_dsh-auto-memory' // 发布基座(保留 .git)

// ---------- 2. 复制预览版文件(--dry-run 使用临时 staging) ----------
console.log('[release] 版本:', version, dryRun ? '(dry-run staging)' : '')
if (dryRun) {
  REL = path.join(tmpdir(), 'dam-release-staging-' + Date.now())
  console.log('[release] staging 目录:', REL)
}
if (!existsSync(DEV)) { console.error('[release] ❌ 源目录不存在:', DEV); process.exit(1) }
mkdirSync(REL, { recursive: true })
for (const entry of readdirSync(REL)) {
  if (entry === '.git' || entry === '.gitignore') continue
  rmSync(path.join(REL, entry), { recursive: true, force: true })
}
const copyDirExcluding = (src, dst, excludeRe) => {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (excludeRe.test(entry)) continue
    const s = path.join(src, entry), d = path.join(dst, entry)
    if (statSync(s).isDirectory()) copyDirExcluding(s, d, excludeRe)
    else cpSync(s, d)
  }
}
copyDirExcluding(path.join(DEV, 'lib'), path.join(REL, 'lib'), /\.bak/)
for (const entry of ['cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE', 'notices.json', 'smoke-test.mjs', 'smoke-test-external.mjs', 'smoke-test-reflect.mjs', 'smoke-test-context-observer.mjs', 'docs', 'social-preview.html']) {
  const s = path.join(DEV, entry), d = path.join(REL, entry)
  if (existsSync(s)) cpSync(s, d, { recursive: true })
}

// ---------- 3. pre → 正式 反转(精确替换;转换输入一律 _pre,禁止 _dev) ----------
const transforms = [
  // client 注册 id(本地身份 → npm 身份)
  ['@deepseek-ai/dsh-auto-memory', '@a9i5k4/dsh-auto-memory'],
  // 14 个工具名 + 客户端文案
  ['memory_consolidate_pre', 'memory_consolidate'],
  ['memory_maintain_pre', 'memory_maintain'],
  ['memory_external_pre', 'memory_external'],
  ['memory_read_pre', 'memory_read'],
  ['memory_recall_pre', 'memory_recall'],
  ['memory_reflect_pre', 'memory_reflect'],
  ['memory_status_pre', 'memory_status'],
  ['memory_note_pre', 'memory_note'],
  ['memory_user_pre', 'memory_user'],
  ['memory_log_pre', 'memory_log'],
  ['calendar_remove_pre', 'calendar_remove'],
  ['calendar_done_pre', 'calendar_done'],
  ['calendar_list_pre', 'calendar_list'],
  ['calendar_add_pre', 'calendar_add'],
  // 缓存文件名
  ['update-check-pre', 'update-check'],
  ['notices-cache-pre', 'notices-cache'],
  // 全局 auto-memory-pre 标识(name/slots/API/context/localStorage/配置文件/日志前缀)
  ['auto-memory-pre', 'auto-memory'],
  // systemPrompt context/section 注册名前缀
  ['dsh:auto-memory-pre', 'dsh:auto-memory'],
  // UI label 与 GUIDANCE 的预览标记
  [' (dev)', ''],
  ['(开发版)', ''],
  ['开发版,', ''],
  ['（预览版,', '('],
  ['(预览版)', ''],
  ['预览版,', ''],
]
let totalReplaced = 0
for (const file of ['lib/index.js', 'lib/client.js', 'smoke-test.mjs', 'smoke-test-external.mjs', 'smoke-test-reflect.mjs', 'smoke-test-context-observer.mjs']) {
  const p = path.join(REL, file)
  let text = readFileSync(p, 'utf8')
  for (const [from, to] of transforms) {
    const count = text.split(from).length - 1
    if (count > 0) { text = text.split(from).join(to); totalReplaced += count }
  }
  writeFileSync(p, text)
}
console.log('[release] pre→正式 替换:', totalReplaced, '处')

// ---------- 3.5 cordis.patch.yml 转换(loader entry id + 包名,防止与预览版撞车) ----------
{
  const patchPath = path.join(REL, 'cordis.patch.yml')
  let pt = readFileSync(patchPath, 'utf8')
  pt = pt.split('- id: auto-memory-pre').join('- id: auto-memory')
  pt = pt.split('dsh:auto-memory-pre').join('dsh:auto-memory')
  pt = pt.split('@deepseek-ai/dsh-auto-memory').join('@a9i5k4/dsh-auto-memory')
  writeFileSync(patchPath, pt)
}

// ---------- 4. 生成正式 package.json ----------
const relPkg = {
  name: '@a9i5k4/dsh-auto-memory',
  description: 'DSH 自动记忆插件:三层记忆(用户级/项目笔记/每日日志)自动注入与检索、每轮对话自动沉淀、每日反思、可视化面板与设置页,支持继承其他 AI 工具的记忆。',
  version,
  type: 'module',
  main: 'lib/index.js',
  exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
  files: ['lib', 'cordis.patch.yml'],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: {
      inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-sidebar'],
      platform: 'web',
    },
  },
  keywords: ['dsh', 'deepseek-harness', 'memory', 'plugin', 'auto-memory'],
  repository: { type: 'git', url: 'git+https://github.com/Aik358/dsh-auto-memory.git' },
  peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
  license: 'BSD-3-Clause',
}
writeFileSync(path.join(REL, 'package.json'), JSON.stringify(relPkg, null, 2) + '\n')

// ---------- 5. 验证 ----------
console.log('[release] 验证 ...')
// 审查修复轮2:语法检查失败必须硬退出(旧实现把执行异常当 'ERR' 可接受,存在假绿)
const check = (cmd) => {
  try { return { out: execSync(cmd, { cwd: REL, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(), ok: true } }
  catch (e) { return { out: ((e && e.stdout) || '') + String((e && e.message) || e), ok: false } }
}
for (const f of ['lib/index.js', 'lib/client.js']) {
  const r = check('node --check ' + f)
  if (!r.ok || r.out !== '') { console.error('[release] ❌ 语法失败:', f, r.out); process.exit(1) }
}
// 扫描面扩大到整个 staging 树的文本文件(lib 递归 + 根部清单/文档/测试),不再只查两个 lib 文件
const walkFiles = (dir, acc) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(p, acc)
    else if (/\.(js|mjs|cjs|json|yml|yaml|md)$/.test(entry.name)) acc.push(p)
  }
  return acc
}
const scanTargets = [path.join(REL, 'package.json'), path.join(REL, 'cordis.patch.yml')]
scanTargets.push(...walkFiles(path.join(REL, 'lib'), []))
// staging 内的 smoke 副本也参与转换,必须一并扫描(不能扫 DEV 源文件——源码本就含 _pre)
for (const s of ['smoke-test.mjs', 'smoke-test-external.mjs', 'smoke-test-reflect.mjs', 'smoke-test-context-observer.mjs']) {
  const p = path.join(REL, s)
  if (existsSync(p)) scanTargets.push(p)
}
const seen = new Set()
for (const f of scanTargets) {
  if (seen.has(f)) continue
  seen.add(f)
  const b = readFileSync(f)
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { console.error('[release] ❌ BOM:', f); process.exit(1) }
}
{
  const pt = readFileSync(path.join(REL, 'cordis.patch.yml'), 'utf8')
  if (!/- id: auto-memory\r?\n/.test(pt) || pt.includes('auto-memory-pre') || pt.includes('auto-memory-dev') || pt.includes('dsh:auto-memory-pre') || !pt.includes('@a9i5k4/dsh-auto-memory')) {
    console.error('[release] ❌ cordis.patch.yml 未正确转换(id/包名)'); process.exit(1)
  }
}
const residual = [
  // 预览标识(_pre/-pre)—— 发布物中必须为裸稳定名
  'memory_log_pre', 'memory_note_pre', 'memory_user_pre', 'memory_recall_pre', 'memory_maintain_pre',
  'memory_status_pre', 'memory_reflect_pre', 'memory_consolidate_pre', 'memory_external_pre', 'memory_read_pre',
  'calendar_add_pre', 'calendar_done_pre', 'calendar_list_pre', 'calendar_remove_pre',
  'auto-memory-pre', 'update-check-pre', 'notices-cache-pre', 'dsh:auto-memory-pre',
  // 历史开发标识(_dev/-dev)同样禁止残留
  'memory_log_dev', 'memory_note_dev', 'memory_user_dev', 'memory_recall_dev', 'memory_maintain_dev',
  'memory_status_dev', 'memory_reflect_dev', 'memory_consolidate_dev', 'memory_external_dev', 'memory_read_dev',
  'calendar_add_dev', 'calendar_done_dev', 'calendar_list_dev', 'calendar_remove_dev',
  'auto-memory-dev', 'update-check-dev', 'notices-cache-dev',
  '@deepseek-ai/dsh-auto-memory', '开发版,', '(开发版)', ' (dev)', '（预览版,', '(预览版)',
]
const bad = []
for (const f of scanTargets) {
  const relName = path.relative(REL, f)
  let text = ''
  try { text = readFileSync(f, 'utf8') } catch (e) { continue }
  for (const r of residual) if (text.includes(r)) bad.push(relName + ' 含残留: ' + r)
}
if (bad.length) { console.error('[release] ❌ 残留:\n' + bad.join('\n')); process.exit(1) }
console.log('[release] 语法 ✓ BOM ✓ 无 pre/dev 残留 ✓')

// ---------- 6. 完成 ----------
console.log('\n✅ 构建输出目录:', REL, '(version ' + version + ')' + (dryRun ? ' [dry-run staging,未触碰真实发布基座]' : ''))
if (!dryRun) {
  console.log('下一步(需用户明确要求才会执行):')
  console.log('  cd ' + REL)
  console.log('  git add -A && git commit && git push && git tag && npm publish')
} else {
  console.log('dry-run 完成:仅生成 staging 并验证转换,未修改真实发布基座,未发布。')
}
