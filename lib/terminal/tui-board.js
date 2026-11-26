import { eventTitle, itemsFrom, nextPage } from './tui-data.js'

const twoHours = 2 * 60 * 60 * 1000
const main = '主线'
const formatter = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
export const boardModes = { 流: '泳道', 泳道: '工作流', 工作流: '流' }
export const eventRanges = [
  { label: '活跃（进行中及暂停）', value: 'active+paused' },
  { label: '全部状态', value: 'all' },
  { label: '仅进行中', value: 'active' },
  { label: '仅暂停', value: 'paused' },
  { label: '仅已关闭', value: 'closed' },
]

const eventItems = data => itemsFrom(data, ['events', 'items', 'rows', 'results'])
const openEvent = event => ['active', 'paused'].includes(event.status || 'active')
export const eventRange = args => args.status || (args.all === 1 ? 'all' : 'active+paused')

export async function readEventPage(call, operation, args, range) {
  let data = await call(operation.id, args)
  if (range !== 'active+paused') return { args, data, events: eventItems(data) }
  // The host supports one exact status. Filter active + paused across real
  // cursor pages and skip pages containing only closed events.
  let events = eventItems(data).filter(openEvent)
  let next = nextPage(operation, data, args)
  while (!events.length && next && next.cursor > (args.cursor ?? 0)) {
    args = next
    data = await call(operation.id, args)
    events = eventItems(data).filter(openEvent)
    next = nextPage(operation, data, args)
  }
  return { args, data, events }
}

export async function readEventGroups(call, operation, range) {
  const data = await call(operation.id, { all: 1, ...(!['all', 'active+paused'].includes(range) && { status: range }) })
  const events = eventItems(data)
  return range === 'active+paused' ? events.filter(openEvent) : events
}

function timestamp(value) {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? ms : 0
}

const date = ms => ms ? formatter.format(ms) : '未知'

function span(event) {
  const points = itemsFrom(event, ['checkpointQuad', 'checkpoints'])
    .map(point => timestamp(point.at)).filter(Boolean).sort((a, b) => a - b)
  const start = timestamp(event.startMs) || points[0] || timestamp(event.createdAt) || timestamp(event.updatedAt)
  const end = timestamp(event.endMs) || points.at(-1) || timestamp(event.updatedAt) || start
  return { event, start, end: Math.max(start, end), points }
}

function timeline(row, all) {
  const { event, start, end, points } = row
  const breaks = []
  for (let i = 1; i < points.length; i++) {
    const gap = points[i] - points[i - 1]
    if (gap > twoHours) breaks.push(`${date(points[i - 1])} → ${date(points[i])} · ${(gap / 3600000).toFixed(1)} 小时`)
  }
  const overlaps = start ? all.filter(other => other !== row && other.start && start < other.end && other.start < end) : []
  return {
    事件: eventTitle(event), 状态: event.status, 开始: date(start), 结束: date(end),
    检查点: event.checkpointCount ?? points.length, '推进断点（超过 2 小时）': breaks,
    区间重叠: overlaps.map(other => eventTitle(other.event)),
    摘要: event.summary,
  }
}

function workflowKeys(event) {
  // Same title and summary markers as the WebUI's event workflow.
  const text = `${event.title ?? event.name ?? ''}\n${event.summary ?? ''}`
  const marks = [...text.matchAll(/(?:^|[^A-Za-z0-9])(P\d{1,2}|R\d{1,2}|G\d{1,2})(?![0-9A-Za-z])|([EF])\s*线/g)]
  return marks.length ? [...new Set(marks.map(mark => mark[1] ?? mark[2] + '线'))] : [main]
}

export function eventLanes(events) {
  const ledger = events.filter(event => (event.kind || 'ledger') === 'ledger').map(span)
  let selected
  let preview
  return ledger.map(row => ({
    event: row.event,
    get preview() {
      if (selected !== row) {
        selected = row
        preview = timeline(row, ledger)
      }
      return preview
    },
  }))
}

export function eventWorkflows(events) {
  const grouped = new Map()
  const ledger = events.filter(event => (event.kind || 'ledger') === 'ledger').map(span)
  for (const row of ledger) {
    for (const key of workflowKeys(row.event)) {
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(row)
    }
  }
  const rank = key => key === main ? 10000 : Number(key.match(/^[PRG](\d+)$/)?.[1] ?? 9999)
  return [...grouped.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([key, rows]) => {
    rows.sort((a, b) => a.start - b.start)
    const start = rows.find(row => row.start)?.start ?? 0
    const end = rows.reduce((latest, row) => Math.max(latest, row.end), 0)
    const breaks = rows.slice(1).filter((row, index) => rows[index].end && row.start - rows[index].end > twoHours).length
    return { key, collapsed: key === main, events: rows.map(row => row.event),
      preview: { 工作线: key, 事件: rows.length, 开始: date(start), 结束: date(end), 断点: breaks } }
  })
}

export function graphLanes(data) {
  return itemsFrom(data, ['lanes', 'columns', 'groups']).map(lane => ({
    title: lane.title ?? lane.label ?? lane.name ?? lane.key ?? lane.id ?? '泳道',
    cards: itemsFrom(lane, ['cards', 'items']).slice().sort((a, b) =>
      String(b.ts ?? '').localeCompare(String(a.ts ?? '')) || (a.lineStart ?? 0) - (b.lineStart ?? 0)),
  })).filter(lane => lane.cards.length)
}
