/**
 * smoke-test-l0-layer-pre —— 三层契约 C1：L0 抽取层补 `layer` + `status`。
 * 纯 Node、零依赖、不联网；临时目录里造 5 类来源（user/project/log/reflection/whiteboard）的真实
 * 文件，从磁盘读回后断言：① 每条结果 layer 正确 ② status 全为 current ③ 老字段与老调用方式
 * 完全向后兼容 ④ 无来源时回退 L0_DEFAULT_LAYER ⑤ 输出确定性 ⑥ 源文件 UTF-8 无 BOM。
 * 目录布局对齐真实实现（lib/index.js resolvePaths：集中式根 <dshHome>/memory/workspaces/<wsKey>/
 * 与旧版分散 {ws}/.dsh-memory/）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildL0IndexPre, classifyLayerPre,
  L0_LAYERS, L0_STATUSES, L0_DEFAULT_LAYER, L0_LAYER_VERSION, L0_EXTRACT_VERSION,
} from '../../lib/l0-extract.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }

const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`
const memId = (c) => 'mem_' + c.repeat(32)

const ROOT = mkdtempSync(path.join(tmpdir(), 'dsh-l0-layer-'))
const write = (rel, body) => {
  const p = path.join(ROOT, ...rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, body, 'utf8')
  return p
}
const WS = ['.dsh', 'memory', 'workspaces', '--D--proj--']

// ---------- 5 类来源样本（真实临时文件） ----------
const CASES = [
  { layer: 'user', kind: '用户级记忆', rel: ['.dsh', 'memory', 'MEMORY.md'], c: 'a', body: '## 用户级硬性规则（12:00）\n- 严禁引入 UTF-8 BOM' },
  { layer: 'project', kind: '项目笔记（集中式根）', rel: [...WS, 'MEMORY.md'], c: 'b', body: '## 项目约定（09:10）\n- 零运行时依赖' },
  { layer: 'log', kind: '今日日志', rel: [...WS, '2026-09-14.md'], c: 'c', body: '- 08:23 完成 L0 抽取层的 layer 补齐' },
  { layer: 'log', kind: '历史日志', rel: [...WS, 'archive', '2026-08-01.md'], c: 'd', body: '- 21:05 归档前的旧日志条目' },
  { layer: 'reflection', kind: '每日反思', rel: [...WS, 'reflections', '2026-09-13.md'], c: 'e', body: '## 成果回顾\n- 待办总表交付' },
  { layer: 'whiteboard', kind: '白板 PLAN.md', rel: [...WS, 'handoff', 'PLAN.md'], c: 'f', body: '## 项目全貌\n- 三层检索契约施工中' },
  { layer: 'whiteboard', kind: '交接账本', rel: [...WS, 'handoff', 'handoff-20260914-101010.md'], c: '1', body: '## 任务状态\n- C1 已完成' },
  { layer: 'project', kind: '项目笔记（旧版 {ws}/.dsh-memory）', rel: ['ws', '.dsh-memory', 'MEMORY.md'], c: '2', body: '## 旧版结构项目笔记\n- 集中式迁移前' },
  { layer: 'log', kind: '旧版日志', rel: ['ws', '.dsh-memory', '2026-09-12.md'], c: '3', body: '- 19:40 旧版分散结构里的日志' },
]

// ---------- ① 5 类来源：layer 正确 + status=current ----------
const seen = new Set()
for (const cs of CASES) {
  const abs = write(cs.rel, `${anchor(cs.c)}${cs.body}`)
  const text = readFileSync(abs, 'utf8') // 真·从磁盘读回
  t(`layer[${cs.layer}] ${cs.kind}`, () => {
    const rows = buildL0IndexPre(text, { layer: abs })
    assert.equal(rows.length, 1, '应切出 1 条条目')
    assert.equal(rows[0].id, memId(cs.c))
    assert.equal(rows[0].layer, cs.layer)
    assert.equal(rows[0].status, 'current')
    assert.ok(L0_LAYERS.includes(rows[0].layer), 'layer 必须落在契约取值域内')
    assert.ok(L0_STATUSES.includes(rows[0].status), 'status 必须落在契约取值域内')
  })
  seen.add(cs.layer)
}
t('5 类来源全部覆盖（user/project/log/reflection/whiteboard）', () => {
  assert.deepEqual([...seen].sort(), [...L0_LAYERS].sort())
})

// ---------- ② 入参形态：opts.layer / opts.path / 键名 / 目录 ----------
t('opts.path 别名与 opts.layer 等价', () => {
  const abs = path.join(ROOT, ...CASES[4].rel)
  const text = readFileSync(abs, 'utf8')
  assert.equal(buildL0IndexPre(text, { path: abs })[0].layer, 'reflection')
  assert.equal(buildL0IndexPre(text, { sourcePath: abs })[0].layer, 'reflection')
})
t('路径可直接当 layer 值传（契约字段名 symbol）', () => {
  const text = readFileSync(path.join(ROOT, ...CASES[1].rel), 'utf8')
  assert.equal(buildL0IndexPre(text, { layer: 'workspaceMemoryPath' })[0].layer, 'project')
  assert.equal(buildL0IndexPre(text, { layer: 'userMemoryPath' })[0].layer, 'user')
  assert.equal(buildL0IndexPre(text, { layer: 'todayLogPath' })[0].layer, 'log')
})
t('Windows 反斜杠与正斜杠同样识别', () => {
  const abs = path.join(ROOT, ...CASES[5].rel)
  const fwd = abs.replace(/\\/g, '/')
  const text = readFileSync(abs, 'utf8')
  assert.equal(buildL0IndexPre(text, { layer: abs })[0].layer, 'whiteboard')
  assert.equal(buildL0IndexPre(text, { layer: fwd })[0].layer, 'whiteboard')
})

// ---------- ③ 无来源信息：回退默认层 ----------
t('无 opts → layer=L0_DEFAULT_LAYER（log）、status=current', () => {
  const text = readFileSync(path.join(ROOT, ...CASES[1].rel), 'utf8')
  const rows = buildL0IndexPre(text)
  assert.equal(L0_DEFAULT_LAYER, 'log')
  assert.equal(rows[0].layer, 'log')
  assert.equal(rows[0].status, 'current')
})
t('opts.layer 非法值不抛：回退默认层', () => {
  const text = `${anchor('a')}- 12:01 内容甲`
  assert.equal(buildL0IndexPre(text, { layer: 'nonsense' })[0].layer, 'log')
  assert.equal(buildL0IndexPre(text, { layer: '' })[0].layer, 'log')
  assert.equal(buildL0IndexPre(text, { layer: null })[0].layer, 'log')
})

// ---------- ④ 向后兼容：老字段一个不少、值不变、签名不变 ----------
t('向后兼容：老字段（id/l0/source/chars/bodyChars）与无 opt 调用逐字段一致', () => {
  const abs = path.join(ROOT, ...CASES[2].rel)
  const text = readFileSync(abs, 'utf8')
  const withLayer = buildL0IndexPre(text, { layer: abs })
  const plain = buildL0IndexPre(text)
  assert.equal(withLayer.length, plain.length)
  for (let i = 0; i < plain.length; i++) {
    for (const k of ['id', 'l0', 'source', 'chars', 'bodyChars']) {
      assert.ok(k in withLayer[i], `缺老字段 ${k}`)
      assert.deepEqual(withLayer[i][k], plain[i][k], `字段 ${k} 被改动`)
    }
    assert.deepEqual(Object.keys(withLayer[i]).sort(), ['bodyChars', 'chars', 'id', 'l0', 'layer', 'source', 'status'].sort())
    assert.equal(withLayer[i].chars, withLayer[i].l0.length)
  }
})
t('签名与既有常量的兼容面：多条目按 id 升序、版本串未动', () => {
  const text = `${anchor('b')}## 主题乙\n- 条目${anchor('a')}- 12:01 内容甲很长很长很长`
  const rows = buildL0IndexPre(text, { layer: 'log' })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, memId('a'))
  assert.equal(rows[1].id, memId('b'))
  assert.equal(rows[0].layer, 'log')
  assert.equal(rows[1].layer, 'log')
  assert.equal(L0_EXTRACT_VERSION, 'l0_extract_pre_v1')
  assert.equal(L0_LAYER_VERSION, 'l0_layer_pre_v1')
})
t('extractL0Pre / parseMemoryItemsPre 行为不受影响（opts 透传不串味）', () => {
  const text = `${anchor('a')}- 14:23 用户报告了发布管道问题需要立即处理`
  const rows = buildL0IndexPre(text, { layer: 'project', maxChars: 40, minChars: 5 })
  assert.equal(rows[0].l0, '用户报告了发布管道问题需要立即处理')
  assert.equal(rows[0].source, 'firstSentence')
  assert.equal(rows[0].layer, 'project')
})

// ---------- ⑤ 确定性 ----------
t('确定性：同输入两次调用全等（含 layer/status）', () => {
  const text = `${anchor('a')}- 12:01 内容甲${anchor('b')}## 主题乙（13:00）\n- 条目乙`
  const abs = path.join(ROOT, ...CASES[3].rel)
  assert.deepEqual(buildL0IndexPre(text, { layer: abs }), buildL0IndexPre(text, { layer: abs }))
})

// ---------- ⑥ classifyLayerPre 单元（纯函数边界 + fail closed） ----------
t('classifyLayerPre：显式层名 / 键名 / 路径 / 判不出→null', () => {
  for (const l of L0_LAYERS) assert.equal(classifyLayerPre(l), l)
  assert.equal(classifyLayerPre('WhiteBoardPath'), 'whiteboard')
  assert.equal(classifyLayerPre('notesPath'), 'project')
  assert.equal(classifyLayerPre('/x/memory/workspaces/--w--/MEMORY.md'), 'project')
  assert.equal(classifyLayerPre('/home/u/.dsh/memory/MEMORY.md'), 'user')
  assert.equal(classifyLayerPre('/x/memory/workspaces/--w--/reflections/2026-09-13.md'), 'reflection')
  assert.equal(classifyLayerPre('/x/memory/workspaces/--w--/handoff/PLAN.md'), 'whiteboard')
  assert.equal(classifyLayerPre('/x/.dsh-memory/2026-09-14.md'), 'log')
  assert.equal(classifyLayerPre(''), null)
  assert.equal(classifyLayerPre(null), null)
  assert.equal(classifyLayerPre('随手写的字符串'), null)
  assert.equal(classifyLayerPre('MEMORY.md'), null, '裸文件名信息不足，不猜（回退默认层）')
})

// ---------- ⑦ 无 BOM（用户硬性规则） ----------
const NO_BOM = (p) => {
  const b = readFileSync(p)
  assert.ok(!(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf), `检测到 UTF-8 BOM: ${p}`)
}
t('源文件 UTF-8 无 BOM', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  NO_BOM(path.join(here, '..', '..', 'lib', 'l0-extract.js'))
  NO_BOM(path.join(here, 'smoke-test-l0-layer.mjs'))
})

// ---------- 清理 + 汇总 ----------
rmSync(ROOT, { recursive: true, force: true })
console.log(`[l0-layer-pre] pass=${pass} fail=${fail}`)
if (fail) process.exit(1)
