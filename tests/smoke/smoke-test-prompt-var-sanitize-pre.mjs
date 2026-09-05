#!/usr/bin/env node
/** [prompt-var-sanitize] 提示词模板变量中和(0.1.39)。
 * 病例(2026-09-05 实发):自动沉淀把「GET {{baseUrl}}/v1/usage,headers Bearer {{apiKey}}」
 * 写进今日日志 → 记忆快照注入携带 → 宿主 prompt 装配校验 {{baseUrl}}(大写 U 不合
 * /^[a-z][a-z0-9_]*$/)判 malformed,整轮运行失败;合法小写名则被宿主替换丢内容。
 * 修复:注入出插件前统一把 {{ }} 改写为全角 ｛｛ ｝｝(模板装配零命中,内容对人可读)。
 * 本套件从 lib/index.js 抽取真实 neutralizePromptTemplateVars 函数体驱动,并守卫五个注入出口全部接线。 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

console.log('[prompt-var-sanitize] G0 源码守卫:中和函数存在且五个注入出口全部接线')
const MARK = 'function neutralizePromptTemplateVars(text) {'
const start = SRC.indexOf(MARK)
ok(start > 0, 'neutralizePromptTemplateVars 定义存在')
let depth = 0, end = -1
for (let i = start + MARK.length - 1; i < SRC.length; i++) {
  const ch = SRC[i]
  if (ch === '{') depth++
  else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
}
ok(end > start, '函数体花括号配平抽取成功')
ok(SRC.includes('return neutralizePromptTemplateVars(truncateHead(s.clean'), 'sanitizeForInjection(user/notes) 已接线')
ok(SRC.includes('const recent = neutralizePromptTemplateVars(s.recentLogs.map'), 'recentLogs(今日日志行)已接线')
ok(/return neutralizePromptTemplateVars\(lines\.join\('\\n'\)\)/.test(SRC), '动态快照兜底出口已接线')
ok(SRC.includes('return neutralizePromptTemplateVars([') && SRC.includes('昨日反思 — 待生成'), '反思请求块已接线')

// 抽取真实函数体执行
const factory = new Function(`
  ${SRC.slice(start, end + 1)}
  return neutralizePromptTemplateVars
`)
const neutralize = factory()

console.log('[prompt-var-sanitize] G1 真实病例行(2026-09-05 今日日志)')
{
  const bad = '18:59 为 CC Switch 编写 sub.vankit.top 用量查询脚本：GET {{baseUrl}}/v1/usage，headers Bearer {{apiKey}}(CC Switch 配置里的)'
  const out = neutralize(bad)
  ok(!/\{\{[A-Za-z_]/.test(out) && !/\}\}/.test(out), '输出不含任何 ASCII 双花括号(宿主校验零命中)')
  ok(out.includes('｛｛baseUrl｝｝/v1/usage') && out.includes('｛｛apiKey｝｝'), '全角改写且内容对人可读')
  ok(!out.includes('{{'), '无 {{ 残留')
}

console.log('[prompt-var-sanitize] G2 合法小写变量同样中和(防宿主替换丢内容)')
{
  const out = neutralize('每轮自动写 {{memory_log}} 与 {{dayBoundary}}')
  ok(!out.includes('{{') && out.includes('｛｛memory_log｝｝'), '小写合法名不被宿主解析')
}

console.log('[prompt-var-sanitize] G3 非模板内容零损伤')
{
  const j = '{"a":1,"b":[2,3]}'
  ok(neutralize(j) === j, '单花括号/JSON 原样保留')
  const code = 'function f(x) { return { x } }'
  ok(neutralize(code) === code, '普通代码块原样保留')
  ok(neutralize('') === '' && neutralize(null) === '', '空/null 安全')
}

console.log(`[prompt-var-sanitize] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
