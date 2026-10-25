import fs from 'node:fs'
const ix = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
// 注入主链路：读的是 logText 还是 eventStore？
const keys = ['logText', 'eventStore', 'event-store', 'eventCards', 'eventCatalog', 'readEventStore', 'listEvents']
console.log('=== 关键符号在 index.js 的出现次数 ===')
for (const k of keys) console.log(k.padEnd(20), (ix.split(k).length - 1), '处')
console.log('')
// 事件段在注入里的位置
const i = ix.indexOf('event-cards')
console.log('=== event-cards 注入段 ===')
if (i > 0) console.log(ix.slice(i - 600, i + 900))
else console.log('★ 未找到 event-cards 注入段')