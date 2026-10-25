import fs from 'node:fs'
const ix = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
// 1) memory_log 到底写到哪里？
const i = ix.indexOf("defineTool('memory_log'")
const body = ix.slice(i, i + 3500)
const lines = body.split('\n').filter(l => /logPath|writeFile|appendText|eventStore|eventAdd|projectDir/.test(l))
console.log('=== memory_log 写入目标 ===')
console.log(lines.slice(0, 8).join('\n'))
console.log('')
// 2) memory_event 写到哪？
const j = ix.indexOf("defineTool('memory_event'")
const evBody = ix.slice(j, j + 2500)
console.log('=== memory_event 写入目标 ===')
console.log(evBody.split('\n').filter(l => /eventStore|storePath|add\(|upsert|writeFile|event-store/.test(l)).slice(0, 8).join('\n'))