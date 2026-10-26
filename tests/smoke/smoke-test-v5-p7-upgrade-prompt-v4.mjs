/**
 * smoke-test-v5-p7-upgrade-prompt-v4.mjs
 *
 * ★2026-10-27 新增：`MEMORY_BASIS_MIGRATION_PROMPT` v3 → v4 的验收。
 *
 * 【为什么必须新增】
 *   v3 的最大缺口：只说了「账本归到 L3 事件」，**没教怎么把几百篇账本归成几十个事件**。
 *   实测后果（本工作区 587 篇账本）：
 *     · 要么「一篇一个事件」⇒ 587 个垃圾事件
 *     · 要么子代理尝试读全量 ⇒ 124 万字符 ≈ 100 万 token ⇒ **直接爆上下文**
 *   v4 补上归组方法论 + 精读跳读规则 + 质量闸门。
 *
 * 【验收纪律】
 *   本套件是**提示词内容断言**（提示词本身是常量文本，无法「执行」）。
 *   但每条都必须是「**缺了就会导致真实故障**」的判据，不是随便抓几个词。
 *   每条都写清「为什么必须有」+ 对应的真实故障场景。
 */
import fs from 'node:fs'
import { MEMORY_BASIS_MIGRATION_PROMPT as P, MEMORY_BASIS_MIGRATION_PROMPT_CHARS as N } from '../../lib/migration-prompt.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

console.log('== A. 基础（版本与一致性）==')
{
  ok(P.indexOf('v4 升级迁移 · v4') >= 0, 'A-1 版本号已升至 v4', (P.match(/# 记忆基座整理[^\n]*/) || [''])[0])
  ok(P.indexOf('v4（2026-10-27）修订') >= 0, 'A-2 含 v4 修订说明')
  ok(N === P.length, 'A-3 CHARS 常量与实际一致', N)
  const art = fs.readFileSync(new URL('../../artifacts/MEMORY-BASIS-MIGRATION-PROMPT-2026-10-25.md', import.meta.url), 'utf8')
  ok(art === P, 'A-4 ★★★ 两份真源逐字一致（防漂移）', 'art=' + art.length + ' mod=' + P.length)
}

console.log('')
console.log('== B. ★核心：账本 → 事件归组方法论（v3 完全缺失）==')
{
  ok(P.indexOf('### 4.5') >= 0, 'B-1 含 4.5 节（账本→事件归组）')
  ok(P.indexOf('4.5.1') >= 0 && P.indexOf('4.5.2') >= 0 && P.indexOf('4.5.3') >= 0, 'B-2 含 4.5.1/4.5.2/4.5.3 三个子节')
  ok(P.indexOf('4.5.4') >= 0 && P.indexOf('4.5.5') >= 0, 'B-3 含 4.5.4/4.5.5（质量闸门 + 起止时间）')
  // 归组三条判据
  ok(P.indexOf('目标相同或演进') >= 0, 'B-4 归组判据①目标相同或演进')
  ok(P.indexOf('时间连续') >= 0, 'B-5 归组判据②时间连续')
  ok(P.indexOf('产出归属相同') >= 0, 'B-6 归组判据③产出归属相同')
  // 用户裁定
  ok(P.indexOf('中断多日后被重新拾起') >= 0 && P.indexOf('仍算同一件事') >= 0, 'B-7 ★★含用户裁定「中断多日仍算同一件事」')
  // 反例
  ok(P.indexOf('反例') >= 0 && P.indexOf('两个事件') >= 0, 'B-8 ★含反例（目标不同必须拆成两个事件）')
}

console.log('')
console.log('== C. ★★★三类产物分开处理（避免机械产物被语义误判）==')
{
  ok(P.indexOf('三类产物必须分开处理') >= 0, 'C-1 含「三类产物必须分开处理」标题')
  // 三类识别方法
  const kinds = [
    ['真账本', '含 `## 目标`'],
    ['白板快照', 'PLAN-YYYYMMDD'],
    ['会话转写包', 'prev-req-'],
  ]
  for (const [name, sig] of kinds) {
    ok(P.indexOf(name) >= 0 && P.indexOf(sig) >= 0, 'C-2 识别「' + name + '」（' + sig + '）')
  }
  ok(P.indexOf('按日期归桶') >= 0, 'C-3 ★机械产物按日期归桶（不做语义判断）')
  ok(P.indexOf('白板快照 · YYYY-MM-DD') >= 0, 'C-4 桶命名模板含日期')
  // 关键理由
  ok(P.indexOf('必然误判') >= 0 || P.indexOf('让模型判断') >= 0, 'C-5 ★写清了「为什么必须按日期」（否则必然误判）')
  ok(P.indexOf('518KB') >= 0 || P.indexOf('只读前 5 行') >= 0, 'C-6 ★prev-req 单篇可达 518KB ⇒ 只读前 5 行')
}

console.log('')
console.log('== D. ★★★精读跳读规则（防上下文爆炸）==')
{
  ok(P.indexOf('绝对禁止整文件塞进上下文') >= 0, 'D-1 含禁令「绝对禁止整文件塞进上下文」')
  ok(P.indexOf('8,000 字符') >= 0 || P.indexOf('8000 字符') >= 0, 'D-2 ★含硬上限「单次 read ≤8000 字符」')
  ok(P.indexOf('100 万 token') >= 0 || P.indexOf('124 万字符') >= 0, 'D-3 ★写清了「整体读会爆」的实测数字')
  // 三步法
  ok(P.indexOf('跳读建索引') >= 0, 'D-4 第 1 步：跳读建索引（不读正文）')
  ok(P.indexOf('归组判断') >= 0 && P.indexOf('不需要读任何正文') >= 0, 'D-5 第 2 步：归组判断（只看索引）')
  ok(P.indexOf('精读') >= 0 && P.indexOf('只读四段标题') >= 0, 'D-6 第 3 步：精读（只读结构）')
  // 具体命令
  ok(P.indexOf('sed -n') >= 0, 'D-7 含可执行的 sed 命令（不是空泛描述）')
  ok(P.indexOf('3 万 token') >= 0 || P.indexOf('3.5 万字') >= 0, 'D-8 写清索引表规模（证明装得下）')
}

console.log('')
console.log('== E. ★事件名质量闸门（防 HTML 注释垃圾名）==')
{
  ok(P.indexOf('事件名质量闸门') >= 0, 'E-1 含质量闸门标题')
  ok(P.indexOf('HTML 注释') >= 0 && P.indexOf('<!-- -->') >= 0, 'E-2 ★★禁止 HTML 注释（旧版垃圾名的直接来源）')
  ok(P.indexOf('4–60 字') >= 0, 'E-3 长度 4-60 字')
  ok(P.indexOf('markdown 标记开头') >= 0, 'E-4 禁止 markdown 前缀')
  ok(P.indexOf('占位名') >= 0, 'E-5 禁止占位名')
  ok(P.indexOf('直接拿文件名') >= 0, 'E-6 ★禁止直接拿文件名当事件名')
  // 正反例
  ok(P.indexOf('修复上下文页卡死') >= 0, 'E-7 含正例')
  ok(P.indexOf('<!--type=goal-->') >= 0 || P.indexOf('旧版垃圾事件名') >= 0, 'E-8 含反例（旧版踩过的坑）')
}

console.log('')
console.log('== F. 事件必须带起止时间（时间线清晰的根因）==')
{
  ok(P.indexOf('startMs') >= 0 && P.indexOf('endMs') >= 0, 'F-1 含 startMs / endMs')
  ok(P.indexOf('最早') >= 0 && P.indexOf('最晚') >= 0, 'F-2 说明 startMs=最早成员 / endMs=最晚成员')
  ok(P.indexOf('时间线') >= 0, 'F-3 说明这是时间线清晰的根本')
}

console.log('')
console.log('== G. 阶段 5 新增自检项（9-13）==')
{
  ok(P.indexOf('9.  **账本守恒**') >= 0, 'G-1 自检 9：账本守恒（members 总和 = 真账本数）')
  ok(P.indexOf('10. **机械产物按日期**') >= 0, 'G-2 自检 10：机械产物按日期，一天一桶')
  ok(P.indexOf('11. **事件名合规**') >= 0, 'G-3 自检 11：事件名零违规')
  ok(P.indexOf('12. **时间线完整**') >= 0, 'G-4 自检 12：每事件有 startMs/endMs 且 start<=end')
  ok(P.indexOf('13. **精读纪律**') >= 0, 'G-5 自检 13：全程无 read 超 8000 字符')
  // 负路径：原来的 1-8 必须还在
  for (const k of ['1. **条目数守恒**', '5. **层归属**', '8. **无幻影 API 调用**']) {
    ok(P.indexOf(k) >= 0, 'G-6 原自检项仍在：' + k.slice(0, 20))
  }
}

console.log('')
console.log('== H. ★v3 的既有约束不得被 v4 破坏（回归保护）==')
{
  const mustKeep = [
    ['同意已取得，不要再问用户', 'H-1 不得让子代理问用户（会永久卡住）'],
    ['不许用正则猜', 'H-2 必须模型判断，不许正则'],
    ['不许再派子代理', 'H-3 禁止递归派子代理'],
    ['memory_status({op:\'upgrade-done\'})', 'H-4 幻影 API 警示仍在'],
    ['不许一次删除原文件', 'H-5 只备份不删'],
    ['不许把 L0 内容写进任何工作区', 'H-6 L0 隔离纪律'],
  ]
  for (const [k, name] of mustKeep) {
    ok(P.indexOf(k) >= 0, name)
  }
  ok(P.indexOf('必须先问用户') < 0, 'H-7 ★负路径：不得出现旧话术「必须先问用户」')
}

console.log('')
console.log('== I. 体量控制（提示词不能无限膨胀）==')
{
  ok(P.length > 7000, 'I-1 提示词已包含 v4 内容', P.length + ' 字符')
  ok(P.length < 15000, 'I-2 ★提示词不得超过 15000 字符（防无限膨胀）', P.length + ' 字符 / ' + P.split(String.fromCharCode(10)).length + ' 行')
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)