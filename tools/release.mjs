#!/usr/bin/env node
/**
 * release.mjs — 开发版(auto-memory-dev) → 正式版(auto-memory) 自动发布构建
 * 用法: node tools/release.mjs <新版本号>  例: node tools/release.mjs 0.1.18
 * 流程: 复制开发版 → 反转全部 _dev 标识 → 生成正式 package.json → 语法/残留验证
 * 之后: cd D:\dsh_debug\_publish_dsh-auto-memory 手动 git commit/push/tag/npm publish
 */
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const DEV = 'C:\\Users\\JH Z\\dsh-auto-memory'          // 开发版(本地 dev-link)
const REL = 'D:\\dsh_debug\\_publish_dsh-auto-memory'      // 发布基座(保留 .git)

// ---------- 1. 参数 ----------
const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('用法: node tools/release.mjs <版本号>  例: node tools/release.mjs 0.1.18')
  process.exit(1)
}

// ---------- 2. 复制开发版文件(保留发布目录 .git) ----------
console.log('[release] 版本:', version)
console.log('[release] 复制开发版文件 → 发布目录 ...')
for (const entry of readdirSync(REL)) {
  if (entry === '.git' || entry === '.gitignore') continue
  rmSync(path.join(REL, entry), { recursive: true, force: true })
}
// lib 递归复制并排除 *.bak* 备份文件
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
for (const entry of ['cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE', 'notices.json', 'smoke-test.mjs', 'smoke-test-external.mjs', 'smoke-test-reflect.mjs', 'docs', 'social-preview.html']) {
  const s = path.join(DEV, entry), d = path.join(REL, entry)
  if (existsSync(s)) cpSync(s, d, { recursive: true })
}

// ---------- 3. dev → 正式 反转(精确替换,先长后短) ----------
const transforms = [
  // client 注册 id(本地身份 → npm 身份)
  ['@deepseek-ai/dsh-auto-memory', '@a9i5k4/dsh-auto-memory'],
  // 13 个工具名 + 客户端文案
  ['memory_consolidate_dev', 'memory_consolidate'],
  ['memory_maintain_dev', 'memory_maintain'],
  ['memory_external_dev', 'memory_external'],
  ['memory_read_dev', 'memory_read'],
  ['memory_recall_dev', 'memory_recall'],
  ['memory_reflect_dev', 'memory_reflect'],
  ['memory_status_dev', 'memory_status'],
  ['memory_note_dev', 'memory_note'],
  ['memory_user_dev', 'memory_user'],
  ['memory_log_dev', 'memory_log'],
  ['calendar_remove_dev', 'calendar_remove'],
  ['calendar_done_dev', 'calendar_done'],
  ['calendar_list_dev', 'calendar_list'],
  ['calendar_add_dev', 'calendar_add'],
  // 缓存文件名
  ['update-check-dev', 'update-check'],
  ['notices-cache-dev', 'notices-cache'],
  // 全局 auto-memory-dev 标识(name/slots/API/context/localStorage/配置文件/日志前缀)
  ['auto-memory-dev', 'auto-memory'],
  // UI label 与 GUIDANCE 的 dev 标记
  [' (dev)', ''],
  ['(开发版)', ''],
  ['开发版,', ''],
]
let totalReplaced = 0
for (const file of ['lib/index.js', 'lib/client.js']) {
  const p = path.join(REL, file)
  let text = readFileSync(p, 'utf8')
  for (const [from, to] of transforms) {
    const count = text.split(from).length - 1
    if (count > 0) { text = text.split(from).join(to); totalReplaced += count }
  }
  writeFileSync(p, text)
}
console.log('[release] dev→正式 替换:', totalReplaced, '处')

// ---------- 3.5. cordis.patch.yml 转换(loader entry id + 包名,防止与开发版撞车) ----------
{
  const patchPath = path.join(REL, 'cordis.patch.yml')
  let pt = readFileSync(patchPath, 'utf8')
  pt = pt.split('- id: auto-memory-dev').join('- id: auto-memory')
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
const check = (cmd) => { try { return execSync(cmd, { cwd: REL, encoding: 'utf8', windowsHide: true }).trim() } catch (e) { return 'ERR' } }
for (const f of ['lib/index.js', 'lib/client.js']) {
  const r = check('node --check ' + f)
  if (r !== '' && r !== 'ERR') { console.error('[release] ❌ 语法失败:', f, r); process.exit(1) }
}
for (const f of ['lib/index.js', 'lib/client.js', 'package.json']) {
  const b = readFileSync(path.join(REL, f))
  if (b[0] === 0xef) { console.error('[release] ❌ BOM:', f); process.exit(1) }
}
// cordis.patch.yml 检查
{
  const pt = readFileSync(path.join(REL, 'cordis.patch.yml'), 'utf8')
  if (!pt.includes('- id: auto-memory\n') || pt.includes('auto-memory-dev') || !pt.includes('@a9i5k4/dsh-auto-memory')) {
    console.error('[release] ❌ cordis.patch.yml 未正确转换(id/包名)'); process.exit(1)
  }
}
const residual = ['memory_log_dev', 'memory_note_dev', 'memory_user_dev', 'memory_recall_dev', 'memory_maintain_dev', 'memory_status_dev', 'memory_reflect_dev', 'memory_consolidate_dev', 'memory_external_dev', 'calendar_add_dev', 'calendar_done_dev', 'calendar_list_dev', 'calendar_remove_dev', 'auto-memory-dev', 'update-check-dev', 'notices-cache-dev', '@deepseek-ai/dsh-auto-memory', '开发版,', '(开发版)', ' (dev)']
const bad = []
for (const f of ['lib/index.js', 'lib/client.js']) {
  const text = readFileSync(path.join(REL, f), 'utf8')
  for (const r of residual) if (text.includes(r)) bad.push(f + ' 含残留: ' + r)
}
if (bad.length) { console.error('[release] ❌ 残留:\n' + bad.join('\n')); process.exit(1) }
console.log('[release] 语法 ✓ BOM ✓ 无 dev 残留 ✓')

// ---------- 6. 完成 ----------
console.log('\n✅ 发布目录已生成:', REL, '(version ' + version + ')')
console.log('下一步:')
console.log('  cd ' + REL)
console.log('  git add -A && git -c user.name=Aik358 -c user.email=Aik358@users.noreply.github.com commit -m "v' + version + ': ..."')
console.log('  git push https://x-access-token:<PAT>@github.com/Aik358/dsh-auto-memory.git main')
console.log('  git tag -a v' + version + ' -m "v' + version + '" && git push <同上> v' + version)
console.log('  npm publish --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken=<NPM_TOKEN>')
console.log('  (发布后把 lib/*.js + package.json 同步回开发版:版本号更新但保持 dev 标识)')
