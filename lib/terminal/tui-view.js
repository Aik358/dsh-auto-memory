import { cells, clip, documentLines, singleLine, wrap } from './tui-text.js'
import { splitRow } from './tui-screen.js'

const strong = text => ({ text, style: 'strong' })
const row = text => [{ text }]
const title = text => [strong(text)]
export const pageNames = { memory: '记忆', board: '白板看板' }

export function renderTui(screen, state, view, rows, editor, busy) {
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
    [{ ...strong(' AUTO MEMORY ') }, { text: `${state.connection}  ${state.discovery?.mode ?? identity.harness ?? ''}${identity.profile ? ` / ${identity.profile}` : ''}${identity.pluginVersion ? `  v${identity.pluginVersion}` : ''}` }],
    row(scopeLine),
    state.page === 'memory'
      ? [{ text: '[1 记忆]', style: 'selected' }, { text: '    2 白板看板' }]
      : [{ text: ' 1 记忆     ' }, { text: '[2 白板看板]', style: 'selected' }],
    row(glyph.rule.repeat(width)),
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
    ...top, title(header), ...body, row(glyph.rule.repeat(width)),
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
