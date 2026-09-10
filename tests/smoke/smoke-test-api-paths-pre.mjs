// 路径表一致性锁(2026-09-10 · 第 0 步「止血」)
//
// 背景:同一批 HTTP 路由声明了两份 —— 宿主 lib/index.js 的 `export const API`(权威一份)
// 与界面 lib/client.js 的 `var API`。两个半边是独立 bundle(客户端经 __ModuleLoader__ 手写加载),
// 没有共享模块可 import,所以"只有一份事实"这件事**不能靠代码结构保证,只能靠本测试守住**。
//
// 本测试同时是"加端点容易漏一处"这个机制性问题的回归闸:
//    A1 客户端表每条路径都必须存在于宿主表(否则界面在打一个不存在的端点)
//    A2 宿主独有路径必须**正好**是下面 WHITELIST 里那几个(有非界面消费者的端点)
//    A3 客户端表外不得出现裸的 /api/... 字面量(路径表不得再被绕过 —— 本次止血前有 28 处)
//    A4 宿主里 `path: API.<key>` 用到的键必须都在表里(防键名打错)
//
// 任何一条红了,都说明"两份声明开始漂移",请同步后再提交。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const hostSrc = readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
const clientSrc = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

// 宿主独有(界面侧零引用)但**不是死端点** —— 它们有非界面的消费者,删掉会连带打断:
//   .../activation-inbox : 契约测试与注入入口(docs/M6-CONTRACT.md,tests/smoke/smoke-test-m63/m70)
//   .../subagent-gc          : 子代理回收 CLI(tools/subagent-gc.mjs,artifacts/VERIFY-2.2.4.md 自查步骤)
const HOST_ONLY_WHITELIST = [
  '/api/dsh-auto-memory/activation-inbox',
  '/api/dsh-auto-memory/subagent-gc',
]

function parseHostTable(src) {
  const block = /export const API = \{[\s\S]*?\n\}/.exec(src)
  if (!block) throw new Error('宿主 API 表未找到(lib/index.js 形态变了,本锁需同步更新)')
  return {
    paths: [...block[0].matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]),
    keys: [...block[0].matchAll(/^\s*'?([A-Za-z0-9_-]+)'?:\s*'/gm)].map((m) => m[1]),
  }
}

function parseClientTable(src) {
  const pre = /var ROUTE_PREFIX = '([^']+)'/.exec(src)
  if (!pre) throw new Error('客户端 ROUTE_PREFIX 未找到(lib/client.js 形态变了,本锁需同步更新)')
  const block = /var API = \{[\s\S]*?\n    \}/.exec(src)
  if (!block) throw new Error('客户端 API 表未找到(lib/client.js 形态变了,本锁需同步更新)')
  const suffix = [...block[0].matchAll(/ROUTE_PREFIX \+ '([^']+)'/g)].map((m) => m[1])
  return {
    prefix: pre[1],
    paths: suffix.map((s) => pre[1] + s),
    blockStart: block.index,
    blockEnd: block.index + block[0].length,
  }
}

const host = parseHostTable(hostSrc)
const client = parseClientTable(clientSrc)
if (host.paths.length < 40) throw new Error('宿主路径表解析条目过少(' + host.paths.length + '),疑似解析失效')
if (client.paths.length < 35) throw new Error('客户端路径表解析条目过少(' + client.paths.length + '),疑似解析失效')

// A1 客户端 ⊆ 宿主
const missing = client.paths.filter((p) => host.paths.indexOf(p) === -1)
if (missing.length) throw new Error('A1 客户端打了宿主没有的端点:' + missing.join(', '))

// A2 宿主独有 == 白名单
const hostOnly = host.paths.filter((p) => client.paths.indexOf(p) === -1).sort()
const wantOnly = HOST_ONLY_WHITELIST.slice().sort()
if (hostOnly.join('|') !== wantOnly.join('|')) {
  throw new Error('A2 宿主独有路径与白名单不一致。实际=[' + hostOnly.join(', ') +
    '] 期望=[' + wantOnly.join(', ') + ']。' +
    '新增宿主独有端点时:接上界面,或加进 HOST_ONLY_WHITELIST 并注明它的非界面消费者。')
}

// A3 客户端表外无裸字面量
const offenders = []
let offset = 0
for (const line of clientSrc.split('\n')) {
  const start = offset
  offset += line.length + 1
  if (start >= client.blockStart && start <= client.blockEnd) continue
  if (line.indexOf('/api/dsh-auto-memory/') === -1) continue
  const head = line.replace(/^\s+/, '')
  if (head.startsWith('//') || head.startsWith('*') || head.startsWith('/*')) continue // 注释不算
  offenders.push(line.trim())
}
if (offenders.length) throw new Error('A3 客户端表外仍有裸路径字面量(' + offenders.length + ' 处):\n  ' + offenders.join('\n  '))

// A4 宿主注册引用的键都存在
const usedKeys = [...hostSrc.matchAll(/path:\s*API\.([A-Za-z0-9_]+)/g)].map((m) => m[1])
const badKeys = [...new Set(usedKeys)].filter((k) => host.keys.indexOf(k) === -1)
if (badKeys.length) throw new Error('A4 宿主注册引用了表里没有的键:' + badKeys.join(', '))

console.log('API 路径锁: 宿主 ' + host.paths.length + ' 条 / 客户端 ' + client.paths.length + ' 条')
console.log('A1 客户端全部命中宿主: OK(缺失 ' + missing.length + ')')
console.log('A2 宿主独有 == 白名单: OK(' + hostOnly.length + ' 条:' + hostOnly.join(', ') + ')')
console.log('A3 表外裸字面量: OK(0 处)')
console.log('A4 注册键全部在表内: OK(引用 ' + new Set(usedKeys).size + ' 个键)')
console.log('路径表一致性锁通过(4/4)')
