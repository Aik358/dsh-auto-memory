import { readFileSync } from 'node:fs'
import { sendGroupText } from '../.github/scripts/qq-send.mjs'

const file = process.argv[2]
if (!file) { console.error('用法: node artifacts/qq-send-cli.mjs <UTF8文本文件>'); process.exit(2) }
const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
if (!text.trim()) { console.error('文本为空'); process.exit(2) }
console.log('即将发送 ' + text.length + ' 字,前 40 字: ' + text.slice(0, 40).replace(/\n/g, ' / '))
const r = await sendGroupText(text)
console.log('发送结果: ' + JSON.stringify(r))
