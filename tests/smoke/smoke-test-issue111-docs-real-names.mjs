#!/usr/bin/env node
/**
 * [issue111] 文档 → 代码真值 守卫（上游 #111 的回归锁）。
 *
 * 背景：docs/HANDBOOK.md / USER-GUIDE.zh-CN.md / USER-GUIDE.en.md 曾把使用者指向
 * **不存在的路径**（端点前缀、诊断日志、hub/evidence 目录写成 pre 开发树的拼写），
 * 后果是用户按「附日志」清单打包交出空文件、维护者据此误判「插件零诊断输出」。
 *
 * ★★去 pre 后的语义重写（2026-09-23，用户拍板）：
 *   本守卫原本的推导链第 ① 步是「从 tools/release.mjs 解析 pre→发布 转换表」，因为
 *   发布物会把 `-pre` 折成裸名 ⇒ 文档必须写**发布名**。
 *   去 pre 把两张改名表整段删除、构建退化为纯复制 ⇒ **开发名与发布名合一**，
 *   「文档该写哪个名」的二义性消失。故真值口径改为**直接取源码真值**：
 *     ① 从 lib/index.js 取端点前缀/诊断日志/配置名/memory 子目录（= 唯一真名）
 *     ② 断言三个文档陈述的就是 ①
 *     ③ 保留面：**文档里不得残留任何 `-pre` 拼写**（去 pre 的核心承诺）
 *   原始意图（不让文档把用户引向不存在的路径）完整保留。
 *
 * 只读、零网络、零副作用（不写任何文件，不改 process.env）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ok -', name) }
  else { fail++; console.error('  FAIL -', name); if (detail) console.error('         ' + detail) }
}
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
/** 文档里路径分隔符混用（表格用 \、正文用 /）；比较前一律归一成 /。 */
const norm = (s) => s.replace(/\\/g, '/')

// ---------- ① 源码真值（lib/index.js；去 pre 后即发布真值） ----------
const src = read('lib/index.js')
const endpointLiterals = [...new Set([...src.matchAll(/'(\/api\/dsh-auto-memory[^']*)'/g)].map((m) => m[1]))]
ok(endpointLiterals.length > 0, `从 lib/index.js 取到端点字面量(${endpointLiterals.length} 条)`)
const PREFIX = endpointLiterals[0].split('/').slice(0, 3).join('/') + '/'
ok(PREFIX === '/api/dsh-auto-memory/', '端点前缀为裸名（去 pre 后无 -pre 变体）', PREFIX)

const diagName = (src.match(/'dsh-auto-memory[^']*diagnose\.log'/) || [''])[0].slice(1, -1)
const cfgName = (src.match(/'dsh-auto-memory[^']*\.json'/) || [''])[0].slice(1, -1)
ok(diagName && cfgName, '从 lib/index.js 取到诊断日志与配置文件名', `${diagName} / ${cfgName}`)
ok(!diagName.includes('-pre') && !cfgName.includes('-pre'), '诊断日志/配置名均无 -pre 拼写')

const memoryDirs = [...new Set([...src.matchAll(/memoryDir\('([a-z-]+)'\)/g)].map((m) => m[1]))]
ok(memoryDirs.length > 0, `从 lib/index.js 取到 memory 子目录集合(${memoryDirs.length} 个)`, memoryDirs.join(', '))
ok(memoryDirs.every((d) => !d.endsWith('-pre')), '源码 memory 子目录集合无 -pre 后缀（去 pre 已落地）')

// ---------- ② 文档断言 ----------
const DOCS = ['docs/HANDBOOK.md', 'docs/USER-GUIDE.zh-CN.md', 'docs/USER-GUIDE.en.md']
const docs = new Map(DOCS.map((f) => [f, norm(read(f))]))

for (const [f, text] of docs) {
  ok(text.includes(diagName), `${f}: 诊断日志给的是真名 ${diagName}`)
  ok(text.includes('memory/hub/'), `${f}: hub 目录给的是分隔完整的 memory/hub/`)
  if (text.includes('evidence')) {
    ok(text.includes('memory/evidence/events'), `${f}: 证据事件给的是 memory/evidence/events`)
  }
  ok(!/C:\\Users\\/.test(text), `${f}: 无写死维护者用户名的机器绝对路径`)
  // ★★去 pre 保留面：文档不得再把使用者引向 -pre 目录/文件名
  const preHits = [...text.matchAll(/memory\/[a-z-]+-pre\b|dsh-auto-memory-pre\b/g)].map((m) => m[0])
  ok(preHits.length === 0, `${f}: 文档不得残留 -pre 拼写（去 pre 承诺）`, preHits.slice(0, 5).join(', '))
}

const hb = docs.get('docs/HANDBOOK.md')
ok(hb.includes(PREFIX), `HANDBOOK: 端点前缀给的是真名 ${PREFIX}`)
const m51 = hb.match(/### 5\.1 主要端点（[^）]*共\s*\*\*(\d+)\*\*\s*条/)
ok(Boolean(m51), 'HANDBOOK: §5.1 端点条数以「共 **N** 条」形式给出')
if (m51) ok(Number(m51[1]) === endpointLiterals.length, 'HANDBOOK: §5.1 端点条数 = 代码里 unique 端点字面量数', `文档 ${m51[1]} vs 代码 ${endpointLiterals.length}`)
for (const line of hb.split('\n')) {
  if (!line.includes('端点')) continue
  for (const m of line.matchAll(/(\d+)\s*条/g)) {
    ok(Number(m[1]) === endpointLiterals.length, 'HANDBOOK: 含「端点」的行内数量与代码一致', line.trim().slice(0, 90))
  }
}

console.log(`\n[issue111-docs] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
