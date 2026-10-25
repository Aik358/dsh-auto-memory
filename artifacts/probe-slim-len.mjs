
const mod = await import('file:///D:/dsh-auto-memory/lib/index.js?t=' + Date.now())
const L = mod.DEFAULT_PROMPT_LAYERS || {}
const keys = ['snapshotHead','snapshotMeta','snapshotSlimGuide','snapshotSlimRecallHit','snapshotSlimNote','snapshotSlimMaintain','snapshotSlimRecallNote','snapshotTail']
let sum = 0
for (const k of keys) { const v = L[k] || ''; console.log(k.padEnd(24), String(v.length).padStart(5)); sum += v.length }
console.log('-'.repeat(34))
console.log('精简版合计（含 recall-hit 0 字节）'.padEnd(24), String(sum).padStart(5))
