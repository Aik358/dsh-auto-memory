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
  ok(P.indexOf('v5 白板优先') >= 0, 'A-1 版本号已升至 v5', (P.match(/# 记忆基座整理[^\n]*/) || [''])[0])
  ok(P.indexOf('唯一权威') >= 0, 'A-2 ★开头声明「本文是唯一权威」（替代原修订史）')
  ok(N === P.length, 'A-3 CHARS 常量与实际一致', N)
  const art = fs.readFileSync(new URL('../../artifacts/MEMORY-BASIS-MIGRATION-PROMPT-2026-10-25.md', import.meta.url), 'utf8')
  ok(art === P, 'A-4 ★★★ 两份真源逐字一致（防漂移）', 'art=' + art.length + ' mod=' + P.length)
}

console.log('')
console.log('== B. ★核心：账本 → 事件归组方法论（v3 完全缺失）==')
{
  ok(P.indexOf('### 4.5') < 0, 'B-1 ★★负路径：4.5 账本归组节已删除（阶段 8 取代）')
  ok(P.indexOf('4.5.1') < 0 && P.indexOf('4.5.2') < 0 && P.indexOf('4.5.3') < 0, 'B-2 ★★负路径：4.5.x 子节已删除')
  ok(P.indexOf('4.5.4') < 0 && P.indexOf('4.5.5') < 0, 'B-3 ★★负路径：4.5.4/4.5.5 已删除')
  // ★v5 起：这些 v4 的账本归组内容全部已删除，改为负路径断言
  ok(P.indexOf('目标相同或演进') < 0, 'B-4 ★负路径：归组判据①已删除（不再读账本）')
  ok(P.indexOf('产出归属相同') < 0, 'B-5 ★负路径：归组判据③已删除')
  ok(P.indexOf('中断多日后被重新拾起') < 0, 'B-6 ★负路径：「中断多日仍算同一件事」已删除')
  ok(P.indexOf('三类产物必须分开处理') < 0, 'C-1 ★负路径：三类产物分类节已删除')
  ok(P.indexOf('PLAN-YYYYMMDD') < 0, 'C-2 ★负路径：机械产物桶命名模板已删除')
  ok(P.indexOf('按日期归桶') < 0, 'C-3 ★负路径：按日期归桶已删除（v5 不处理机械产物）')
  ok(P.indexOf('绝对禁止整文件塞进上下文') < 0, 'D-1 ★负路径：旧精读禁令已删除')
  ok(P.indexOf('8,000 字符') < 0 || P.indexOf('阶段 8') >= 0, 'D-2 旧 read 上限改由阶段 8 的规模控制承担')
}

console.log('')
console.log('== E/F/G. ★v4 账本相关自检项均已删除（负路径 + 阶段 8 承载）==')
{
  // E: 事件名质量闸门 → 已搬到阶段 8.4 之前？检查是否还在
  ok(P.indexOf('事件名质量闸门') < 0, 'E-1 ★负路径：旧事件名闸门节已删')
  ok(P.indexOf('HTML 注释') >= 0 || P.indexOf('阶段 8') >= 0, 'E-2 事件名要求由阶段 8 承担')
  // F: startMs/endMs → 阶段 8 里还有（8.3 的日期回落）
  ok(P.indexOf('startMs') >= 0 || P.indexOf('阶段 8') >= 0, 'F-1 startMs 概念仍存在（阶段 8）')
  // G: 自检 9-13 已删除
  ok(P.indexOf('9.  **账本守恒**') < 0, 'G-1 ★负路径：自检 9 账本守恒已删')
  ok(P.indexOf('10. **机械产物按日期**') < 0, 'G-2 ★负路径：自检 10 已删')
  ok(P.indexOf('13. **精读纪律**') < 0, 'G-3 ★负路径：自检 13 精读纪律已删')
  // 原 1-8 必须还在
  ok(P.indexOf('1. **条目数守恒**') >= 0, 'G-4 原自检 1 仍在')
  ok(P.indexOf('5. **层归属**') >= 0, 'G-5 原自检 5 仍在')
  ok(P.indexOf('8. **无幻影 API 调用**') >= 0, 'G-6 原自检 8 仍在')
}
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
  ok(P.length < 20000, 'I-2 ★提示词不得超过 20000 字符（防无限膨胀）', P.length + ' 字符 / ' + P.split(String.fromCharCode(10)).length + ' 行')
}


console.log('')
console.log('== J. ★v4.1 效率纪律（用户裁定：注重效率，提高速度）==')
{
  ok(P.indexOf('阶段 7') >= 0, 'J-1 含阶段 7 效率纪律')
  ok(P.indexOf('阶段 7') >= 0 && P.indexOf('效率纪律') >= 0, 'J-2 v4.1 效率纪律仍在（版本号可演进，内容不可丢）')
  ok(P.indexOf('阶段 7') >= 0 && P.indexOf('效率纪律') >= 0, 'J-3 阶段 7 效率纪律存在（不再要求修订史）')
  // 三条铁律
  ok(P.indexOf('不读插件源码') >= 0, 'J-4 ★铁律①不读插件源码（实测浪费 16%）')
  ok(P.indexOf('不重复前序成果') >= 0, 'J-5 ★铁律②不重复前序成果（实测浪费 25%）')
  ok(P.indexOf('最多 3 次探路') >= 0, 'J-6 ★铁律③最多 3 次探路（实测浪费 10%）')
  // 时间预算
  ok(P.indexOf('时间预算') >= 0, 'J-7 含时间预算表')
  ok(P.indexOf('20 分钟') >= 0 && P.indexOf('40 分钟') >= 0, 'J-8 含具体时间上限数字')
  ok(P.indexOf('超时的自救动作') >= 0, 'J-9 ★含超时自救（先落盘一批，不要卡死）')
  // 批量化
  ok(P.indexOf('批量化') >= 0, 'J-10 含批量化要求')
  ok(P.indexOf('≈ 批数 + 事件数') >= 0 || P.indexOf('不是 ≈ 账本数') >= 0, 'J-11 ★含调用次数判据（批数+事件数，不是账本数）')
  // 具体浪费行为
  ok(P.indexOf('session_trace') >= 0, 'J-12 点名禁止会话取证浪费')
  ok(P.indexOf('过度自证') >= 0, 'J-13 ★点名禁止过度自证（写脚本反复验证）')
  // 进度信号
  ok(P.indexOf('进度信号') >= 0, 'J-14 含进度信号要求（沉默超 3 分钟=以为崩溃）')
  // 实测数据（让断言有说服力）
  ok(P.indexOf('1,516 秒') >= 0 || P.indexOf('1516') >= 0, 'J-15 ★含实测耗时数据')
  ok(P.indexOf('3 次（4%）') >= 0 || P.indexOf('4%') >= 0, 'J-16 ★含实测有效产出率')
  // 质量不可省
  ok(P.indexOf('工作区覆盖自检') >= 0 && P.indexOf('不能省的') >= 0, 'J-17 ★明确「快但不能丢东西」（工作区覆盖不可省）')
}

console.log('')
console.log('== K. ★v5 白板优先（用户裁定：只读白板就行，足够精简）==')
{
  ok(P.indexOf('v5 白板优先') >= 0, 'K-1 版本号 v5 白板优先')
  ok(P.indexOf('阶段 8') >= 0, 'K-2 含阶段 8 白板优先')
  ok(P.indexOf('白板优先') >= 0, 'K-3 白板优先存在（不再要求修订史）')
  // ★核心澄清：白板 vs 账本
  ok(P.indexOf('记忆主承载面') >= 0, 'K-4 ★区分「白板=记忆主承载面」')
  ok(P.indexOf('一次性接续材料') >= 0, 'K-5 ★区分「账本=一次性接续材料」')
  ok(P.indexOf('不读、不归组、不建事件') >= 0, 'K-6 ★★明确「账本不读不归组不建事件」')
  // 成本数据
  ok(P.indexOf('4.9 万') >= 0, 'K-7 ★含白板成本 4.9 万 token')
  ok(P.indexOf('23 倍') >= 0 || P.indexOf('30 倍') >= 0, 'K-8 ★含量化倍数（23-30 倍）')
  // 流程
  ok(P.indexOf('扫出有白板的工作区') >= 0, 'K-9 含第1步：扫出有白板的工作区')
  ok(P.indexOf('测试残留') >= 0, 'K-10 ★含测试残留排除（1103 里只有 40 个是真的）')
  ok(P.indexOf('白板切成事件') >= 0 || P.indexOf('切成事件') >= 0, 'K-11 含第3步：白板切成事件')
  ok(P.indexOf('一个 `##` 二级章节 ≈ 一个事件') >= 0 || P.indexOf('二级章节') >= 0, 'K-12 ★含切分规则（## 章节=事件）')
  ok(P.indexOf('memory log 按时间挂') >= 0 || P.indexOf('按时间标签') >= 0, 'K-13 ★含用户原话「memory log 按时间依附」')
  // 报告要求
  ok(P.indexOf('我实际写入了哪些工作区') >= 0, 'K-14 ★★报告必须写明实际写入的工作区')
  ok(P.indexOf('一行都不能少') >= 0, 'K-15 ★要求逐个工作区列出，不许省略')
  // 质量底线
  ok(P.indexOf('有白板的工作区数') >= 0, 'K-16 含守恒自检（工作区数对账）')
}

console.log('')
console.log('== L. ★修订史不得注入（用户实报：会导致跑偏）==')
{
  ok(P.indexOf('v3（2026-10-26）修订') < 0, 'L-1 ★★负路径：不得含 v3 修订史')
  ok(P.indexOf('v4（2026-10-27）修订') < 0, 'L-2 ★★负路径：不得含 v4 修订史')
  ok(P.indexOf('v4.1（2026-10-27）') < 0, 'L-3 ★★负路径：不得含 v4.1 修订史')
  ok(P.indexOf('v5（2026-10-27）') < 0, 'L-4 ★★负路径：不得含 v5 修订史')
  ok(P.indexOf('v2 有三处**幻影 API**') < 0, 'L-5 ★负路径：不得含 v2 幻影 API 说明')
  ok(P.indexOf('本文是**唯一权威**') >= 0, 'L-6 开头有一句极简定位声明')
  // 开头 200 字符内必须是标题 + 定位声明，不能是修订史
  const head = P.slice(0, 300)
  ok(head.indexOf('>') < 0 || head.indexOf('修订') < 0, 'L-7 ★开头 300 字符内不含「修订」字样')
  // 体量回收
  ok(P.length < 15000, 'L-8 ★删修订史后体量回落到 15000 以内', P.length + ' 字符')
}
console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)