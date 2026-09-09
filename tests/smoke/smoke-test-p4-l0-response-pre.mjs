#!/usr/bin/env node
/** smoke-test-p4-l0-response —— P4 recall 返回 L0 + 按需展开 回归锁定(2026-09-09)。
 * 覆盖:L0 模式输出(id/得分/匹配_reason)/ 旧调用零改动(无 opts 与 opts={})/ 压缩比 /
 * 按 id 展开原文(字节区间复用 parseAnchors,不串条)/ 非法与未找到 id 的结构化回报 /
 * handoff 早返不受 opts 影响。
 * 方法:与 p2 同款 —— 从 lib/index.js 提取 recall/expandMemoryRecordPre 方法源码,绑定假引擎执行。
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { parseAnchors } from '../../lib/memory-anchor-pre.js'
import { INDEX_MAX_FILE_BYTES } from '../../lib/memory-index-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }

function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

// ---------- N1 源码守卫 ----------
console.log('[p4-l0-response] N1 源码守卫')
ok(SRC.includes("async recall(query, limit = 8, agent, scope = 'all', opts = null) {"), 'recall 签名 = 可选 opts 扩展(第5参,默认 null)')
ok(SRC.includes('async expandMemoryRecordPre(id, agent) {'), 'expandMemoryRecordPre 方法存在')
ok(/import \{ parseAnchors \} from '\.\/memory-anchor-pre\.js'/.test(SRC), 'parseAnchors 复用(字节区间定位,非新造)')
ok(SRC.includes("format: { type: 'string', enum: ['l0', 'full']"), '工具 schema 新增可选 format')
ok(SRC.includes("expand: { type: 'string', description: '按记忆 id"), '工具 schema 新增可选 expand')
ok(SRC.includes("{ format: args.format || 'l0', expand: args.expand }"), '工具层 format 缺省 l0(模型默认拿 L0 列表)')
ok(SRC.includes("== L0 命中(摘要,含 id/得分/匹配原因"), 'L0 输出节头存在')
ok(SRC.includes("== 本地记忆文件命中 =="), '旧输出节头保留(旧调用行为不变)')
ok(SRC.includes("scope === 'all' && !l0Mode && typeof this._jsSemanticRank === 'function'"), '独立语义节在 l0Mode 下跳过(防重复注入)')

// ---------- 夹具 ----------
const anchor = (h) => `<!-- memory:mem_${h} -->` // h 必须恰 32 hex
const hex32 = (c) => c.repeat(Math.ceil(32 / c.length)).slice(0, 32) // 恰 32 个 hex 字符(多字符 seed 均匀铺满)
const memId = (c) => 'mem_' + hex32(c)
const PAD = '关于发布流程与令牌选择的详细踩坑记录,包含上下文与结论,填充到约八百字符的正文内容。'
const mkBody = (tag, extra) => Array.from({ length: 18 }, (_, k) => `- 行${k}:${PAD}${tag}#${k}${extra || ''}`).join('\n')
const R1 = '## 发布踩坑:令牌选择与缓存延迟\n' + mkBody('r1')
const R2 = '## 水位测量的边界对齐\n' + mkBody('r2')
const R3 = '## 融合层排序权重\n' + mkBody('r3')
const R4 = '## 交接账本四段式\n' + mkBody('r4')
const R5 = '## 子代理痕迹回收\n' + mkBody('r5')
const RECORDS = [
  { id: memId('a1'), body: R1 }, { id: memId('b2'), body: R2 }, { id: memId('c3'), body: R3 },
  { id: memId('d4'), body: R4 }, { id: memId('e5'), body: R5 },
]
const LOG_TEXT = RECORDS.map((r) => anchor(r.id.slice(4)) + '\n' + r.body).join('\n')

const tmp = mkdtempSync(path.join(tmpdir(), 'p4-smoke-'))
const projDir = path.join(tmp, 'logs'); mkdirSync(projDir)
const reflectDir = path.join(tmp, 'reflections'); mkdirSync(reflectDir)
const logPath = path.join(projDir, '2026-09-09.md'); writeFileSync(logPath, LOG_TEXT, 'utf8')
const userFile = path.join(tmp, 'user-memory.md'); writeFileSync(userFile, '', 'utf8')
const notesPath = path.join(tmp, 'notes.md'); writeFileSync(notesPath, '', 'utf8')

// ---------- 假引擎 ----------
function bindRecall(fake) {
  const fnSrc = extractFn("async recall(query, limit = 8, agent, scope = 'all', opts = null) {")
  const l0Url = JSON.stringify(new URL('../../lib/l0-extract-pre.js', import.meta.url).href)
  const arrow = ('async ' + fnSrc.slice(fnSrc.indexOf('('), fnSrc.indexOf(') {') + 1) + ' => ' + fnSrc.slice(fnSrc.indexOf(') {') + 2)).replaceAll("'./l0-extract-pre.js'", l0Url)
  const factory = new Function('path', 'homedir', 'return { recall: ' + arrow + ' };')
  const obj = factory.call(fake, path, homedir)
  return (...args) => obj.recall.apply(fake, args)
}
function bindExpand(fake) {
  const fnSrc = extractFn('async expandMemoryRecordPre(id, agent) {')
  const arrow = 'async ' + fnSrc.slice(fnSrc.indexOf('('), fnSrc.indexOf(') {') + 1) + ' => ' + fnSrc.slice(fnSrc.indexOf(') {') + 2)
  const factory = new Function('readFile', 'parseAnchors', 'INDEX_MAX_FILE_BYTES', 'path', 'homedir', 'return { expandMemoryRecordPre: ' + arrow + ' };')
  const obj = factory.call(fake, readFile, parseAnchors, INDEX_MAX_FILE_BYTES, path, homedir)
  return (...args) => obj.expandMemoryRecordPre.apply(fake, args)
}

function fakeEngine() {
  return {
    resolvePaths: async () => ({ projectDir: projDir, reflectDir, userFile, notesPath, ws: tmp }),
    listDailyLogs: async () => [{ name: '2026-09-09.md' }],
    listReflections: async () => [],
    readTextSafe: async (p) => {
      if (p === logPath) return LOG_TEXT
      if (p === userFile || p === notesPath) return ''
      return ''
    },
    searchHandoffCorpus: async () => [],
    searchSessionHistory: async () => [],
    discoverWorkspaces: async () => [tmp],
    external: { search: async () => [] },
    _jsSemanticRank: null,
  }
}

const eng = fakeEngine()
const expand = bindExpand(eng)
eng.expandMemoryRecordPre = expand // recall 的 opts.expand 分支经 this 调用
const recall = bindRecall(eng)
const Q = '发布 水位 融合 交接 子代理' // 多词 OR:5 条记录各命中 1 词

// ---------- N2 L0 模式输出 ----------
console.log('[p4-l0-response] N2 L0 模式(工具缺省 format=l0)')
const l0Out = await recall(Q, 8, undefined, 'all', { format: 'l0' })
ok(l0Out.includes('== L0 命中'), 'L0 节头存在')
ok(!l0Out.includes('== 本地记忆文件命中 =='), '旧全文节不再出现')
ok((l0Out.match(/mem_[0-9a-f]{32}/g) || []).length === 5, '5 条命中各含完整 id')
ok(l0Out.includes('×') && l0Out.includes('词法×'), '含得分与词法 match_reason')
ok(l0Out.includes('expand="mem_xxx"'), '节头含展开用法提示')
ok(/· \[mem_[0-9a-f]{32}\] ×\d+ /.test(l0Out), '行格式:· [id] ×score')
const l0Lines = l0Out.split('\n').filter((l) => l.startsWith('· [mem_'))
ok(l0Lines.length === 5, '恰 5 行命中(不打全文)')
ok(l0Lines.every((l) => l.length < 250), '每行 <250 字符(摘要级,实测最长 ' + Math.max(...l0Lines.map((x) => x.length)) + ')')

// ---------- N3/N4 旧调用行为不变 ----------
console.log('[p4-l0-response] N3/N4 旧调用零改动')
const oldOut = await recall(Q, 8, undefined, 'all')
ok(oldOut.includes('== 本地记忆文件命中 =='), '无 opts → 旧全文节头')
ok(!oldOut.includes('== L0 命中'), '无 opts → 无 L0 节')
const oldOut2 = await recall(Q, 8, undefined, 'all', {})
ok(oldOut2.includes('== 本地记忆文件命中 ==') && !oldOut2.includes('== L0 命中'), 'opts={} 不带 format → 旧行为不变')
ok(typeof oldOut === 'string' && typeof l0Out === 'string', '两种模式都返回字符串(契约不变)')

// ---------- N5 压缩比 ----------
console.log('[p4-l0-response] N5 压缩比(5 条场景)')
const bodyTotal = RECORDS.reduce((s, r) => s + r.body.length, 0)
const l0Section = l0Out.slice(l0Out.indexOf('== L0 命中'))
ok(bodyTotal > 4000, '5 条原文合计 ' + bodyTotal + ' 字符(对齐验收基准 ~4070)')
ok(l0Section.length < bodyTotal * 0.5, 'L0 段 ' + l0Section.length + ' 字符 < 原文 50%(实测压缩比 1:' + (bodyTotal / l0Section.length).toFixed(1) + ')')

// ---------- N6/N7 展开不串条 ----------
console.log('[p4-l0-response] N6/N7 按 id 展开')
const target = RECORDS[2] // 中间那条
const exp = await expand(target.id, undefined)
ok(exp.startsWith('[记忆展开] ' + target.id), '展开头含 id')
ok(exp.includes('2026-09-09.md'), '展开头含来源文件')
ok(exp.includes('digest '), '展开头含 recordDigest 前缀(校验凭据)')
ok(exp.includes(target.body.split('\n')[0]), '展开体含目标记录首行')
ok(!exp.includes(anchor(target.id.slice(4))) && !exp.includes('<!-- memory:'), '展开体不含锚点标记本身')
ok(!exp.includes(RECORDS[1].body.split('\n')[0]) && !exp.includes(RECORDS[3].body.split('\n')[0]), '不串条:相邻记录内容不出现')
ok(exp.includes(target.body.split('\n').pop()), '不串条:目标记录末行完整(字节区间未截断)')

// ---------- N8 非法/未找到 id ----------
console.log('[p4-l0-response] N8 结构化失败回报')
const bad1 = await expand('not-an-id', undefined)
ok(bad1.startsWith('memory_recall_pre: expand 需要合法记忆 id'), '非法 id → 结构化提示(不抛异常)')
const bad2 = await expand(memId('ffff'), undefined)
ok(bad2.startsWith('[记忆展开] 未找到') && bad2.includes('已搜索'), '未找到 → 列出已搜索范围')

// ---------- N9 早返分支不受 opts 影响 ----------
console.log('[p4-l0-response] N9 scope 早返与 expand 优先级')
const ho = await recall('交接', 4, undefined, 'handoff', { format: 'l0' })
ok(ho.startsWith('[记忆检索|handoff]'), 'handoff 早返不受 format 影响')
const ex = await recall(Q, 4, undefined, 'all', { expand: target.id })
ok(ex.startsWith('[记忆展开] '), 'opts.expand 优先于检索(expand+query 同传时直接展开)')

rmSync(tmp, { recursive: true, force: true })
console.log(`[P4] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
