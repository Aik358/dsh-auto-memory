import fs from 'node:fs'
const ix = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
// 1) memory_log 的实现：写事件还是写日志文件？
const iLog = ix.indexOf("defineTool('memory_log'")
console.log('=== memory_log 实现片段 ===')
console.log(ix.slice(iLog, iLog + 1200).split('\n').slice(0, 28).join('\n'))