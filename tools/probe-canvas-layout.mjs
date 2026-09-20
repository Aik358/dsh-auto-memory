// 画布布局体检: 用真实看板载荷算出当前布局的真实规模, 判断可用性。
// 用途: 验证「文档=列」这一布局选择在真实数据下是否成立。
const API = 'http://127.0.0.1:3080/api/dsh-auto-memory-pre/kanban-board'

const r = await fetch(API)
const d = await r.json()
const lanes = d.lanes || []
const cards = []
for (const l of lanes) for (const c of (l.cards || [])) cards.push(c)

// 当前实现常量(与 lib/client.js 的 WBG_* 一致)
const NODE_W = 232, NODE_H = 104, GAP_X = 74, GAP_Y = 22, PAD = 40

const byDoc = new Map()
for (const c of cards) {
  const s = c.source || '(unknown)'
  if (!byDoc.has(s)) byDoc.set(s, [])
  byDoc.get(s).push(c)
}
const docs = [...byDoc.keys()]
let maxRows = 0, sumRows = 0
for (const [, list] of byDoc) { maxRows = Math.max(maxRows, list.length); sumRows += list.length }

const W = PAD * 2 + docs.length * NODE_W + Math.max(0, docs.length - 1) * GAP_X
const H = PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * GAP_Y

// 真实容器尺寸: 会话页整页宽(经验值 ~1100x640 可用区)
const VIEW_W = 1100, VIEW_H = 640
const fitScale = Math.min((VIEW_W - 24) / W, (VIEW_H - 24) / H)
const MIN_ZOOM = 0.35   // 当前实现里 setZoomBoth 的下限

console.log('=== 真实数据 ===')
console.log('节点(卡片)总数 :', cards.length)
console.log('文档(source)数  :', docs.length)
console.log('单文档最多卡片  :', maxRows, ' 平均:', (sumRows / docs.length).toFixed(1))
console.log('泳道数          :', lanes.length, '→', lanes.map((l) => l.key + ':' + (l.cards || []).length).join('  '))
console.log()
console.log('=== 当前「文档=列」布局的真实规模 ===')
console.log('画布宽 :', W.toLocaleString(), 'px')
console.log('画布高 :', H.toLocaleString(), 'px')
console.log('宽高比 :', (W / H).toFixed(1) + ':1', '(容器约', (VIEW_W / VIEW_H).toFixed(2) + ':1)')
console.log()
console.log('=== 可用性判定 ===')
console.log('理想 fit 缩放 :', fitScale.toFixed(4), '(需要缩到', (fitScale * 100).toFixed(1) + '%)')
console.log('实现的最小缩放 :', MIN_ZOOM, '(' + (MIN_ZOOM * 100) + '%)')
console.log('fit 是否可达 :', fitScale >= MIN_ZOOM ? '✅ 可' : '❌ 不可达 —— fit() 会被钳到 ' + MIN_ZOOM)
const visibleW = W * Math.max(fitScale, MIN_ZOOM)
console.log('fit 后可见宽度 :', Math.round(visibleW).toLocaleString(), 'px')
console.log('需要横向拖动   :', (W / VIEW_W).toFixed(1), '屏')
console.log()
// 若改用「按泳道分列」会怎样
const LANES = Math.max(1, lanes.length)
const W2 = PAD * 2 + LANES * NODE_W + (LANES - 1) * GAP_X
const maxLane = Math.max(...lanes.map((l) => (l.cards || []).length))
const H2 = PAD * 2 + maxLane * NODE_H + (maxLane - 1) * GAP_Y
console.log('=== 对照: 若「按泳道分列」 ===')
console.log('画布 :', W2.toLocaleString(), 'x', H2.toLocaleString(), ' (比', (H2 / H).toFixed(1) + ':1 更高)')
console.log('   → 单列', maxLane, '个节点仍然过高, 需纵向滚动', Math.round(H2 / VIEW_H), '屏')
