#!/usr/bin/env node
/**
 * 重新登记 patch 的 lock 哈希。
 *
 * 背景：patch 文件被 tools/normalize-patch.mjs 规范化后（加基线头 + 转 LF），
 * 内容变了 ⇒ pnpm-lock.yaml 里的 patch_hash 失效。
 *
 * pnpm 记录的 patch_hash 口径 = 对 patch 文本做 **LF 归一化** 后的 sha256。
 * 本脚本按同一口径重算，写回 lock + .modules.yaml，使 pnpm install 不会判「patch 不匹配」。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const profile = process.argv[2] || 'C:/Users/ZHAN_ZC/.dsh/profiles/desktop'
const pkgKey = '@a9i5k4/dsh-auto-memory@3.3.11'
const patchRel = 'patches/@a9i5k4__dsh-auto-memory@3.3.11.patch'
const patchAbs = path.join(profile, patchRel.replace(/\//g, path.sep))

const raw = readFileSync(patchAbs, 'utf8')
const lf = raw.replace(/\r\n/g, '\n')
const hash = createHash('sha256').update(lf).digest('hex')
console.log('patch: ' + patchAbs)
console.log('  CRLF: ' + (raw.match(/\r\n/g) || []).length)
console.log('  patch_hash(LF 口径): ' + hash)

// ── ① pnpm-lock.yaml ──
const lockPath = path.join(profile, 'pnpm-lock.yaml')
let lock = readFileSync(lockPath, 'utf8')
const lockRe = new RegExp("(patchedDependencies:\\s*\\n\\s*'" + pkgKey.replace(/[/.]/g, (c) => '\\' + c) + "':\\s*)([0-9a-f]{64})")
const lm = lock.match(lockRe)
if (!lm) {
  console.log('\n★lock 里没找到 ' + pkgKey + ' 的 patchedDependencies 条目')
} else {
  const old = lm[2]
  console.log('  lock 旧值: ' + old)
  if (old === hash) {
    console.log('  ✓ lock 已是最新')
  } else {
    lock = lock.replace(lockRe, lm[1] + hash)
  }
}

// ── ② 依赖块里的 (patch_hash=…) ──
const before = (lock.match(/patch_hash=[0-9a-f]{64}/g) || [])
console.log('  lock 内 patch_hash 引用数: ' + before.length)
lock = lock.replace(/patch_hash=[0-9a-f]{64}/g, 'patch_hash=' + hash)
writeFileSync(lockPath, lock, 'utf8')
console.log('  ✓ lock 已更新')

// ── ③ node_modules/.modules.yaml ──
const modPath = path.join(profile, 'node_modules/.modules.yaml')
if (existsSync(modPath)) {
  let mod = readFileSync(modPath, 'utf8')
  const m2 = (mod.match(/patch_hash=[0-9a-f]{64}/g) || [])
  if (m2.length) {
    mod = mod.replace(/patch_hash=[0-9a-f]{64}/g, 'patch_hash=' + hash)
    writeFileSync(modPath, mod, 'utf8')
    console.log('  ✓ .modules.yaml 已更新（' + m2.length + ' 处）')
  } else {
    console.log('  .modules.yaml 无 patch_hash 引用')
  }
}

// ── ④ 复核 ──
const lock2 = readFileSync(lockPath, 'utf8')
const m3 = lock2.match(new RegExp("'" + pkgKey.replace(/[/.]/g, (c) => '\\' + c) + "':\\s*([0-9a-f]{64})"))
console.log('\n复核:')
console.log('  patch_hash(LF): ' + hash)
console.log('  lock 记录:      ' + (m3 ? m3[1] : '(未找到)'))
console.log('  ✓ 一致:        ' + (m3 && m3[1] === hash))
