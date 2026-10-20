import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const INST = process.argv[2] || 'C:/Users/ZHAN_ZC/.dsh/profiles/desktop/node_modules/@a9i5k4/dsh-auto-memory/lib'
const cat = await import(pathToFileURL(INST + '/tier0-catalog.js').href)
const build = cat.buildTier0CatalogFromTextPre

const REAL = 'C:/Users/ZHAN_ZC/.dsh/memory/workspaces/--G--AMup--/MEMORY.md'
const base = readFileSync(REAL, 'utf8')

// 模拟：在主笔记首位插入 N 个批次块（与补丁产出同形态）
function withBatches(n) {
  const blocks = []
  for (let i = 1; i <= n; i++) {
    blocks.push('## 归档批次 #' + i + ' · 重组织要点(整理于 2026-10-20)')
    blocks.push('- 本批原文：archive/notes-archived.md §2026-10-20T17:' + String(10 + i).padStart(2, '0') + ':00（约 2000 字符）')
    blocks.push('')
  }
  return blocks.join('\n') + base
}

console.log('=== TTA 6.2：批次块对 Tier-0 常驻目录的挤占 ===')
console.log('（Tier-0 预算 tier0MaxTokens=400，每轮注入）')
console.log('')
console.log('批次块数 | 目录行数 | 其中批次行 | 目录字符 | 真条目被挤掉')
console.log('-'.repeat(72))

for (const n of [0, 1, 2, 4, 8, 12]) {
  const text = withBatches(n)
  const src = [{ layer: 'project', path: REAL, sourceRef: 'project:MEMORY.md', body: text, text }]
  let out
  try {
    out = build(src, { maxTokens: 400, estimateMode: 'conservative', quota: { projectRatio: 0.5, floorRatio: 0.2 } })
  } catch (e) {
    console.log(n + ' | 构建失败: ' + e.message.slice(0, 50))
    continue
  }
  const lines = (out.text || '').split('\n').filter(Boolean)
  const batchLines = lines.filter((l) => /归档批次|本批原文/.test(l))
  const realLines = lines.filter((l) => !/归档批次|本批原文/.test(l))
  console.log(
    String(n).padStart(7) + ' | ' +
    String(lines.length).padStart(8) + ' | ' +
    String(batchLines.length).padStart(10) + ' | ' +
    String((out.text || '').length).padStart(8) + ' | ' +
    String(realLines.length).padStart(11)
  )
}

console.log('')
console.log('=== 判定 ===')
const t0 = build([{ layer: 'project', path: REAL, sourceRef: 'p', body: base, text: base }],
  { maxTokens: 400, estimateMode: 'conservative', quota: { projectRatio: 0.5, floorRatio: 0.2 } })
const t12 = build([{ layer: 'project', path: REAL, sourceRef: 'p', body: withBatches(12), text: withBatches(12) }],
  { maxTokens: 400, estimateMode: 'conservative', quota: { projectRatio: 0.5, floorRatio: 0.2 } })
const r0 = (t0.text || '').split('\n').filter(Boolean).filter((l) => !/归档批次|本批原文/.test(l)).length
const r12 = (t12.text || '').split('\n').filter(Boolean).filter((l) => !/归档批次|本批原文/.test(l)).length
console.log('  无批次块时真条目行数: ' + r0)
console.log('  12 个批次块时真条目行数: ' + r12)
console.log('  被挤掉: ' + (r0 - r12) + ' 条')
