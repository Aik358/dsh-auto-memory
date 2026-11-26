import { cells, clip, documentLines, singleLine, wrap } from './tui-text.js'
import { splitRow } from './tui-screen.js'

const strong = text => ({ text, style: 'strong' })
const row = text => [{ text }]
const title = text => [strong(text)]
export const pageNames = { hosts: '宿主总览', memory: '记忆', board: '白板看板' }

const bridgeLabels = {
  connected: '已连接', legacy: '只读连接', checking: '连接中', offline: '连接失败',
  registered: '已登记', unbound: '未绑定', 'binding-error': '绑定异常', 'observe-only': '仅检测',
}

function detectedStatus(host) {
  if (host.running) return '运行中'
  if (host.installed) return '已安装'
  return host.configFiles.length ? '有配置' : '未发现'
}

export function harnessDetails(host) {
  if (!host) return {}
  return {
    本机: detectedStatus(host),
    AutoMemory: bridgeLabels[host.memory.state] ?? host.memory.state,
    ...(host.configFiles.length > 0 && { 配置文件: host.configFiles }),
    ...(host.executable && { 可执行文件: host.executable }),
    ...(host.memory.workspace && { 绑定工作区: host.memory.workspace }),
    ...(host.memory.operations && { 可用操作: host.memory.operations }),
    ...(host.memory.reason && { 详情: host.memory.reason }),
  }
}

function tabs(state) {
  const labels = [['hosts', '0 宿主'], ['memory', '1 记忆'], ['board', '2 白板看板']]
  return labels.filter(([page]) => page !== 'hosts' || state.showHostTab).flatMap(([page, label]) => [
    { text: state.page === page ? `[${label}]` : ` ${label} `, style: state.page === page ? 'selected' : undefined },
    { text: '  ' },
  ])
}

function field(text, width) {
  const value = clip(text, width, '...')
  return value + ' '.repeat(Math.max(0, width - cells(value)))
}

function bridgeStyle(state) {
  if (state === 'connected' || state === 'legacy') return 'active'
  if (state === 'offline' || state === 'binding-error') return 'warning'
  return state === 'checking' || state === 'registered' ? 'accent' : 'muted'
}

function renderHarnesses(screen, state, view, rows) {
  const width = screen.width
  const rule = (screen.ascii ? '-' : '─').repeat(Math.max(1, width - 4))
  const prefix = '  '
  const connectionCount = rows.filter(host => ['connected', 'legacy'].includes(host.memory.state)).length
  const runningCount = rows.filter(host => host.running).length
  const selected = Math.max(0, Math.min(view.selected ?? 0, rows.length - 1))
  const current = rows[selected]
  const columns = width >= 39
  const wide = width >= 94
  const hostWidth = width >= 48 ? 22 : Math.max(12, width - (columns ? 23 : 16))
  const runtimeWidth = width >= 48 ? 12 : 9
  const bridgeWidth = 16
  const tableWidth = hostWidth + runtimeWidth + bridgeWidth + 4
  const divider = screen.ascii ? ' | ' : ' │ '
  const tableHeader = [{ text: prefix + field('宿主', hostWidth) +
    (columns ? field('本机', runtimeWidth) : '') + (wide ? field('Auto Memory', bridgeWidth) + divider + '所选宿主' : 'Auto Memory'), style: 'muted' }]
  const header = [
    [{ text: prefix + 'AUTO MEMORY', style: 'accent' }, { text: '  /  宿主总览', style: 'strong' }],
    [{ text: prefix }, ...tabs(state)],
    row(''),
    rows.length ? [
      { text: prefix + `${rows.length} 个宿主    `, style: 'strong' },
      { text: `${runningCount} 个运行中    `, style: 'muted' },
      { text: `${connectionCount} 个已连接`, style: connectionCount ? 'active' : 'muted' },
    ] : title(prefix + (state.inventoryStatus || '正在检测本机宿主')),
    [{ text: prefix + rule, style: 'muted' }],
    tableHeader,
  ]
  const bodyHeight = Math.max(1, screen.height - header.length - 4)
  const offset = Math.min(Math.max(0, selected - bodyHeight + 1), Math.max(0, rows.length - bodyHeight))
  const shown = rows.slice(offset, offset + bodyHeight).map((host, index) => {
    const focus = index + offset === selected
    const mark = focus ? '> ' : prefix
    const memory = bridgeLabels[host.memory.state] ?? host.memory.state
    return [
      { text: mark + field(host.name, hostWidth - cells(mark)) + '  ', style: focus ? 'selected' : 'strong' },
      ...(columns ? [{ text: field(detectedStatus(host), runtimeWidth), style: host.running ? 'active' : 'muted' }] : []),
      { text: wide ? field(memory, bridgeWidth) : memory, style: bridgeStyle(host.memory.state) },
    ]
  })
  while (shown.length < bodyHeight) shown.push(row(''))
  if (wide && current) {
    const details = overviewDetail(current)
    for (const [index, detail] of details.entries()) {
      if (index >= shown.length) break
      const used = shown[index].reduce((sum, segment) => sum + cells(segment.text), 0)
      shown[index].push({ text: ' '.repeat(Math.max(0, tableWidth - used - 2)) + divider, style: 'muted' }, detail)
    }
  }
  const message = state.inventoryStatus || (rows.length ? `${selected + 1}/${rows.length}  ${current?.name ?? ''}` : '')
  const enter = current?.id === 'dsh' && ['connected', 'legacy'].includes(current.memory.state) ? 'Enter 工作区' : 'Enter 详情'
  const keys = `${screen.ascii ? 'Up/Down' : '↑↓'} 选择  ${enter}  w 工作区  r 刷新  q 退出`
  const footer = cells(keys) <= width - 2 ? keys : `${enter}  w 工作区  r 刷新  q 退出`
  screen.paint([
    ...header, ...shown,
    [{ text: prefix + rule, style: 'muted' }],
    [{ text: prefix + message, style: 'muted' }],
    row(prefix + footer),
  ])
}

function overviewDetail(host) {
  const { state, operations, workspace } = host.memory
  const lines = [{ text: host.name, style: 'accent' }, { text: '' }]
  if (host.configFiles.length) lines.push({ text: `找到 ${host.configFiles.length} 个配置文件` })
  if (workspace) lines.push({ text: `绑定工作区  ${singleLine(workspace)}` })
  if (operations) lines.push({ text: `${operations} 项可用操作`, style: 'active' })
  if (state === 'unbound') lines.push({ text: '等待配置 Auto Memory 绑定', style: 'muted' })
  if (state === 'observe-only') lines.push({ text: '可查看本机安装与配置状态', style: 'muted' })
  if (state === 'binding-error' || state === 'offline') lines.push({ text: '按 Enter 查看连接详情', style: 'warning' })
  return lines
}

export function renderTui(screen, state, view, rows, editor, busy) {
  if (state.page === 'hosts' && view.kind === 'root' && !editor && !busy) {
    return renderHarnesses(screen, state, view, rows)
  }
  const width = screen.width
  const glyph = screen.ascii ? { rule: '-', divider: ' | ' } : { rule: '─', divider: ' │ ' }
  const wide = width >= 92 && rows.length > 0 && !editor
  const documentWidth = wide ? width - listWidth(width) - 3 : width
  const identity = state.discovery?.identity ?? {}
  const workspace = singleLine(state.status?.scope?.workspace ?? state.scope.workspace ?? '未绑定工作区')
  const session = singleLine(state.status?.scope?.sessionId ?? state.scope.sessionId ?? '未指定')
  const scopeLine = width >= 92
    ? `工作区  ${clip(workspace, width - 39, '...')}    会话  ${clip(session, 22, '...')}`
    : `工作区  ${clip(workspace, width - 8, '...')}`
  const top = [
    [{ text: ' AUTO MEMORY ', style: 'accent' }, { text: `${state.connection}  ${state.discovery?.mode ?? identity.harness ?? ''}${identity.profile ? ` / ${identity.profile}` : ''}${identity.pluginVersion ? `  v${identity.pluginVersion}` : ''}` }],
    row(scopeLine),
    tabs(state),
    [{ text: glyph.rule.repeat(width), style: 'muted' }],
  ]
  const bodyHeight = Math.max(1, screen.height - top.length - 4)
  const active = editor ?? view
  const isList = rows.length > 0 && !editor && (wide || view.focus !== 'document')
  const selected = Math.max(0, Math.min(active.selected ?? 0, rows.length - 1))
  const viewData = view.documentData ?? view.data
  const preview = editor?.data ?? (rows.length && !editor ? rows[selected]?.preview ?? viewData : viewData)
  const value = preview ?? (view.kind === 'root' ? state.status : undefined)
  const terminalQuery = editor ? editorQuery(editor, width) : null
  const docHeight = Math.max(1, bodyHeight - (terminalQuery ? terminalQuery.length : 0))
  const documentView = value === undefined ? [{ text: isList ? '选择项目后打开详情。' : '暂无快照。' }] : cachedDocument(active, value, documentWidth)
  const offset = Math.max(0, Math.min(active.scroll ?? 0, documentView.length - docHeight))
  active.scroll = offset
  const rowWindow = Math.min(Math.max(0, selected - bodyHeight + 1), Math.max(0, rows.length - bodyHeight))
  const focus = editor ? '输入' : isList && view.focus !== 'document' ? '列表' : '正文'
  const position = focus === '列表' || editor?.kind === 'palette' || editor?.kind === 'workspaces'
    ? `  ${rows.length ? `${selected + 1}/${rows.length}` : '0 项'}`
    : `  ${offset + 1}–${Math.min(offset + docHeight, documentView.length)}/${documentView.length} 行`
  const header = `${active.title}  [${focus}]${position}`
  const body = []
  if (terminalQuery) body.push(...terminalQuery.map(title))
  for (let index = 0; body.length < bodyHeight; index++) {
    const item = rows[rowWindow + index]
    const highlight = item && rowWindow + index === selected
    const left = { text: item ? `${highlight ? '> ' : '  '}${item.active && item.status === 'running' ? (screen.ascii ? '* ' : '● ') : ''}${item.label}` : '',
      style: item?.active ? (highlight ? 'activeSelected' : 'active') : highlight ? 'selected' : undefined }
    const right = documentView[offset + index] ?? { text: '' }
    if (wide) body.push(splitRow(left, right, listWidth(width), glyph.divider))
    else if (isList || editor?.kind === 'palette' || editor?.kind === 'workspaces') body.push([left])
    else body.push([right])
  }
  const receipts = busy ? 'Esc 取消请求' : state.footer
  const freshness = view.read && view.revision !== undefined && state.revision !== undefined && view.revision !== state.revision
    ? '  快照可回读 · r' : ''
  const status = state.revision === undefined ? '等待状态' : `状态 ${String(state.revision).slice(0, 10)}${freshness}`
  const message = width >= 92 && state.feedback ? `${status}  |  ${state.feedback}` : state.feedback || status
  screen.paint([
    ...top, title(header), ...body, [{ text: glyph.rule.repeat(width), style: 'muted' }],
    row(clip(singleLine(message), width, '...')), row(receipts),
  ])
}

function listWidth(width) {
  return Math.min(49, Math.floor(width * 0.39))
}

function cachedDocument(view, value, width) {
  if (view.document?.value !== value || view.document?.width !== width) {
    view.document = { value, width, lines: documentLines(value, width) }
  }
  return view.document.lines
}

function editorQuery(editor, width) {
  if (!Object.hasOwn(editor, 'value')) return null
  if (editor.showContract) return ['参数契约 · Tab 返回编辑']
  const value = editor.value.slice(0, editor.cursor) + '|' + editor.value.slice(editor.cursor)
  if (editor.kind === 'palette') return [`/ ${tail(value, width - 2)}`]
  const logical = value.split('\n')
  const current = value.slice(0, editor.cursor).split('\n').length - 1
  const start = Math.max(0, current - 2)
  return logical.slice(start, start + 3).map((line, index) => {
    const prefix = `${start + index + 1} `
    if (start + index === current) {
      const beforeCaret = line.slice(0, line.length - editor.value.slice(editor.cursor).split('\n')[0].length)
      return clip(prefix + tail(beforeCaret, width - cells(prefix) - 5) + line.slice(beforeCaret.length), width, '...')
    }
    return wrap(prefix + singleLine(line), width)[0]
  })
}

function tail(text, width) {
  if (cells(singleLine(text)) <= width) return singleLine(text)
  // Terminal window follows the caret, including in an unbroken JSON string.
  let index = Math.max(0, text.length - width)
  while (index < text.length && cells(singleLine(text.slice(index))) > width - 3) index++
  return '...' + singleLine(text.slice(index).replace(/^[\udc00-\udfff]/, ''))
}
