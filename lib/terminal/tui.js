import { emitKeypressEvents } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { pathKey } from '../file-boundary.js'
import { clean, nextGlyph, previousGlyph, singleLine } from './tui-text.js'
import { makeScreen, pasteInput } from './tui-screen.js'
import { harnessDetails, pageNames, renderTui } from './tui-view.js'
import { boardModes, eventLanes, eventRange, eventRanges, eventWorkflows, graphLanes, readEventGroups, readEventPage } from './tui-board.js'
import {
  defaults, eventArgs, eventTitle, ids, itemsFrom, nextPage, readOnly, requiresInput,
  unavailable, validateDiscovery, workspaceName,
} from './tui-data.js'

const help = {
  页面: '0 宿主总览 · 1 记忆 · 2 白板看板 · / 或 Ctrl+P 搜索 · w 工作区',
  导航: '↑ ↓ 移动 · Enter 打开 · Tab 切换列表和正文 · Esc 返回 · q 退出',
  目标: 'w 浏览其他工作区 · 1 / 2 切页与 r 回读沿用当前浏览目标',
  阅读: 'PgUp / PgDn 翻屏 · Home / End 跳转 · r 回读快照 · e 编辑读取参数',
  事件: 'v 切换事件流、泳道和工作流 · a 选择事件范围 · n / p 事件流翻页 · Enter 展开分组或打开事件',
  画布: '白板看板首页打开白板画布 · k 查找卡片 · a 切换归档 · Enter 查看全文',
  检查点: '事件详情按 c 选择检查点 · d 关联文档 · s 读当前文件 · f 核验历史来源',
  请求: 'Esc 取消当前请求 · 丢失写入回执时先用 / 查回执或回读目标',
  参数: '在 JSON 编辑区粘贴参数 · Ctrl+A 全选 · Ctrl+S 提交 · Enter 换行 · Tab 查看契约',
}

export async function runTui({
  client, scope, browseWorkspaces = false, showHarnesses = false, scanHosts, interval = 2000,
  stdin = process.stdin, stdout = process.stdout, stderr = process.stderr,
}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    stderr.write('Auto Memory TUI 需要交互式终端。管道或脚本请使用 dam status 或 dam api。\n')
    return 2
  }

  const screen = makeScreen(stdout)
  const state = { scope: { ...scope }, page: showHarnesses ? 'hosts' : 'memory', connection: '连接中', feedback: '',
    showHostTab: Boolean(scanHosts) }
  const pages = { hosts: [root('hosts')], memory: [root('memory')], board: [root('board')] }
  let editor
  let foreground
  const background = new Set()
  const recentRecalls = new Map()
  let watcher
  let watchTask
  let recentRequest
  let timer
  let closed = false
  let recent
  let recentError
  let recentRequested = false
  let receipt
  let workspaceSnapshot = []
  let inventory
  let inventoryController
  let inventoryRefreshedAt = 0
  let finish
  const completion = new Promise(resolve => { finish = resolve })

  const stack = () => pages[state.page]
  const current = () => stack().at(-1)
  const operations = () => state.discovery?.operations ?? []
  const operation = id => operations().find(item => item.id === id)
  const push = view => stack().push({ selected: 0, scroll: 0, ...view })
  const feedback = value => { state.feedback = value }
  const revision = data => data?.revision ?? data?.status?.revision
  const errorText = error => [error?.code, error?.message ?? error].filter(Boolean).map(singleLine).join(' · ')
  const sameScope = (a, b) => a.sessionId === b.sessionId && a.workspace === b.workspace && a.workspaceRef === b.workspaceRef
  const scopeKey = scope => JSON.stringify([scope.workspace && pathKey(scope.workspace), scope.sessionId])
  const isBusy = workspace => Boolean(workspace) && (
    workspaceSnapshot.some(row => row.workspace === workspace && row.activities && Object.values(row.activities).some(Boolean))
    || [...background].some(job => job.scope.workspace && pathKey(job.scope.workspace) === pathKey(workspace))
  )

  function root(page) {
    return { kind: 'root', title: pageNames[page], selected: 0, scroll: 0 }
  }

  async function loadHarnesses(force = false) {
    if (!scanHosts || closed || inventoryController || (!force && Date.now() - inventoryRefreshedAt < 15000)) return
    const controller = new AbortController()
    inventoryController = controller
    state.inventoryStatus = '正在检测本机宿主'
    paint()
    try {
      inventory = (await scanHosts({ signal: controller.signal })).harnesses
      state.inventoryStatus = ''
      const detail = pages.hosts.at(-1)
      if (detail.kind === 'harness') detail.data = harnessDetails(harnessRows().find(host => host.id === detail.id))
    } catch (error) {
      if (!controller.signal.aborted) state.inventoryStatus = '检测失败 · ' + errorText(error)
    } finally {
      inventoryController = undefined
      inventoryRefreshedAt = Date.now()
      paint()
    }
  }

  function harnessRows() {
    return (inventory ?? []).map(host => {
      let memory = host.memory
      if (host.id === 'dsh' && memory.state === 'checking') {
        if (state.connection === '已连接') {
          memory = { state: state.discovery?.mode === 'dsh-legacy' ? 'legacy' : 'connected', operations: operations().length }
        } else if (state.connectionError) {
          memory = { state: 'offline', reason: state.connectionError }
        }
      }
      const row = { ...host, memory }
      return { ...row, action: () => {
        if (row.id === 'dsh' && state.connection === '已连接' && host.memory.state === 'checking') {
          state.page = 'memory'
          openWorkspaces({ selectFirstWorkspace: true })
        } else {
          push({ kind: 'harness', id: row.id, title: row.name, data: harnessDetails(row) })
        }
      } }
    })
  }

  function paint() {
    if (closed) return
    const view = current()
    state.footer = editor?.kind === 'form' ? 'Ctrl+S 提交  Tab 契约  Esc 返回'
      : editor?.kind === 'confirm' ? 'y 提交  Esc 返回参数  PgDn 阅读'
        : editor ? '↑↓ 选择  Enter 打开  Esc 返回'
          : view.kind === 'events' ? (view.mode === '流' ? 'Enter 打开  v 视图  a 范围  n/p 翻页' : 'Enter 展开  v 视图  a 范围  r 回读')
            : view.kind === 'graph' || view.kind === 'graph-lane' ? 'Enter 打开  k 查找  a 归档  Esc 返回'
            : view.kind === 'harness' ? 'Esc 返回宿主总览  r 刷新  q 退出'
            : view.op?.id === ids.detail ? 'c 检查点  d 文档  PgDn 翻屏  Esc 返回'
              : view.kind === 'checkpoint' ? 's 读当前文件  f 核验  Esc 返回  / 命令'
            : 'Enter 打开  Tab 焦点  / 命令  r 回读  ? 帮助'
    renderTui(screen, state, view, rows(), editor, foreground)
  }

  function opRow(op) {
    return {
      label: `${op.title || op.id}${unavailable(op) ? ' [不可用]' : ''}`,
      keywords: `${op.id} ${op.group ?? ''}`,
      action: () => launch(op),
      preview: { 操作: op.id, 作用域: op.scope, 访问: op.access, 审批: op.approval, 状态: unavailable(op) || op.status },
    }
  }

  function eventRow(event, prefix = '', lane) {
    return {
      label: `${prefix}${eventTitle(event)}${event?.status ? `  [${event.status}]` : ''}`,
      get preview() { return lane ? lane.preview : event },
      action: () => {
        const op = operation(ids.detail)
        if (op) launch(op, eventArgs(op, event))
        else {
          push({ kind: 'result', title: eventTitle(event), data: event })
          feedback('当前清单未提供事件详情操作，显示列表快照')
        }
      },
    }
  }

  function relatedRows(op, data) {
    if (op.id === 'memory.calendar') return calendarRows(itemsFrom(data, ['entries']))
    if (op.id === 'board.continue.status') return continuationRows(data)
    if (op.id === 'memory.list') {
      const source = operation('memory.source')
      if (!source) return []
      const fileRow = (label, path, info) => ({ label: singleLine(label), preview: info, action: () => launch(source, { path }) })
      return [
        ...(data.notesSize > 0 ? [fileRow('项目笔记', 'MEMORY.md', { 字节: data.notesSize })] : []),
        ...itemsFrom(data, ['logs']).filter(item => item.name).map(item => fileRow(item.name, item.name, item)),
        ...itemsFrom(data, ['reflections']).filter(item => item.name).map(item => fileRow(item.name, 'reflections/' + item.name, item)),
      ]
    }
    if (op.id === 'memory.recall') {
      const source = operation('memory.source')
      if (!source) return []
      return [
        { label: '查看完整检索结果', preview: data, action: () => push({ kind: 'result', title: '检索结果', data }) },
        ...itemsFrom(data, ['hits', 'items', 'results']).map(hit => ({
          label: singleLine(hit.title ?? hit.name ?? hit.path ?? '来源'), preview: hit,
          action: () => typeof hit.path === 'string' ? launch(source, { path: hit.path }) : push({ kind: 'result', title: '来源', data: hit }),
        })),
      ]
    }
    return []
  }

  function continuationRows(status) {
    const decide = operation('board.continue.decide')
    if (!decide || readOnly(decide)) return []
    const makeRow = (label, action, edgeAt) => {
      const args = edgeAt === undefined ? { action } : { action, edgeAt }
      const reason = unavailable(decide)
      return {
        label: label + (reason ? ' [不可用]' : ''),
        preview: { 操作: decide.id, 目标: state.scope, 参数: args, 接续状态: status, 不可用: reason || undefined },
        action: () => {
          launch(decide, args)
          if (editor?.kind === 'form') submit(editor)
        },
      }
    }
    const edge = status?.execution?.edgeAt
    if (status?.executing || status?.execution) {
      return status.execution?.canCancel && Number.isSafeInteger(edge) && edge > 0
        ? [makeRow('取消正在执行的接续', 'cancel', edge)] : []
    }
    const armed = status?.armed?.edgeAt
    return [
      ...(Number.isSafeInteger(armed) && armed > 0 ? [
        makeRow('同意自动接续', 'agree', armed), makeRow('拒绝本次自动接续', 'reject', armed),
        makeRow('取消自动接续', 'cancel', armed),
      ] : []),
      makeRow('手动接续', 'manual'),
    ]
  }

  function graphCardRow(lane, card, index) {
    const cardTitle = item => singleLine(item?.title ?? item?.docTitle ?? item?.id ?? '卡片')
    return {
      label: cardTitle(card),
      keywords: [lane.title, card.docTitle, card.source, card.preview, card.section, ...itemsFrom(card, ['tags'])].join(' '),
      preview: {
        卡片: cardTitle(card), 来源: card.source, 行号: card.lineStart, 时间: card.ts,
        文档: card.docTitle, 标签: card.tags, 摘要: card.preview,
        较新: index > 0 ? cardTitle(lane.cards[index - 1]) : undefined,
        较早: index + 1 < lane.cards.length ? cardTitle(lane.cards[index + 1]) : undefined,
      },
      action: () => {
        const read = operation('board.card')
        if (read && typeof card.id === 'string') launch(read, { id: card.id })
        else push({ kind: 'result', title: cardTitle(card), data: card })
      },
    }
  }

  function projectGraph(view) {
    view.kind = 'graph'
    const available = view.data?.enabled !== false && view.data?.wsBound !== false
    const lanes = available ? graphLanes(view.data) : []
    view.title = `白板画布 · ${view.data?.stats?.archived?.included ? '含归档' : '当前卡片'}`
    view.rows = lanes.map(lane => {
      const title = singleLine(lane.title)
      return {
        label: `${title} · ${lane.cards.length} 张`,
        preview: { 泳道: title, 卡片: lane.cards.length, 顺序: '从较新到较早' },
        action: () => push({ kind: 'graph-lane', title, graph: view, rows: lane.cards.map((card, index) => graphCardRow(lane, card, index)) }),
      }
    })
    view.graphLanes = lanes
    view.documentData = available
      ? { 状态: lanes.length ? '选择泳道或按 k 查找卡片' : '当前没有白板卡片', 归档: view.data?.stats?.archived }
      : { 状态: '当前白板画布不可用', 原因: view.data?.reason, 模式: view.data?.boardMode }
  }

  function searchGraph(view) {
    const graph = view.graph ?? view
    const candidates = graph.graphLanes.flatMap(lane => lane.cards.map((card, index) => graphCardRow(lane, card, index)))
    if (!candidates.length) { feedback('当前没有可查找的白板卡片'); return }
    editor = { kind: 'palette', title: '查找白板卡片', value: '', cursor: 0, selected: 0, candidates }
  }

  function toggleGraphArchive(view) {
    const graph = view.graph ?? view
    if (!graph.op.inputSchema?.properties?.includeArchive) return
    if (state.connection !== '已连接') { feedback('等待连接恢复后重试'); return }
    if (view.graph) stack().pop()
    execute(graph.op, { ...graph.args, includeArchive: graph.data?.stats?.archived?.included ? 0 : 1 }, graph)
  }

  function calendarRows(entries) {
    const days = Map.groupBy(entries, entry => String(entry.date ?? '日期未知'))
    const dates = [...days.keys()].sort((a, b) => b.localeCompare(a))
    const months = Map.groupBy(dates, date => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : '其他日期')
    const add = operation('memory.calendar.add')

    function dayRow(date) {
      const items = days.get(date)
      const rows = items.slice().sort((a, b) => String(a.time ?? '').localeCompare(String(b.time ?? ''))).map(item => ({
        label: `${item.done ? '[完成]' : '[待办]'} ${singleLine(item.time ?? '')} ${singleLine(item.title ?? '')}`,
        preview: item,
        action: () => {
          const actions = ['memory.calendar.done', 'memory.calendar.remove'].map(operation).filter(Boolean)
          const args = item.id ? { id: item.id } : { date: item.date, time: item.time, title: item.title }
          push({ kind: 'result', title: singleLine(item.title), data: item, rows: actions.map(action => ({
            ...opRow(action), preview: item, action: () => launch(action, args),
          })) })
        },
      }))
      if (add && /^\d{4}-\d{2}-\d{2}$/.test(date)) rows.push({
        ...opRow(add), action: () => launch(add, { date }),
      })
      return {
        label: `${singleLine(date)} · ${items.length} 条`,
        action: () => push({ kind: 'result', title: singleLine(date), rows }),
      }
    }

    return [
      ...(add ? [opRow(add)] : []),
      { label: '日历时间轴', action: () => push({ kind: 'result', title: '日历时间轴', rows: dates.map(dayRow),
        data: dates.length ? undefined : '当前没有日历条目' }) },
      ...[...months].map(([month, datesInMonth]) => ({
        label: `${month} · ${datesInMonth.length} 天`,
        action: () => push({ kind: 'result', title: month, rows: datesInMonth.map(dayRow) }),
      })),
    ]
  }

  function openEventDocuments(view) {
    const sources = itemsFrom(view.data?.event, ['members'])
    const paths = [...new Set(sources.filter(path => typeof path === 'string').map(path => path.trim()).filter(Boolean))]
    const rows = paths.map(path => ({
      label: singleLine(path), preview: path,
      action: () => push({ kind: 'result', title: '文档路径', data: path }),
    }))
    push({ kind: 'result', title: '关联文档', rows, data: rows.length ? undefined : '当前事件没有关联文档' })
  }

  function openCheckpoints(view) {
    const event = view.data?.event ?? view.data
    const checkpoints = itemsFrom(event, ['checkpoints'])
    const rows = checkpoints.map((item, index) => ({
      label: singleLine(item.title ?? item.text ?? `检查点 ${index + 1}`),
      preview: { 来源: item.sourceRef ?? item.rel, 引文: item.quoteRef, 行号: item.quoteLine },
      action: () => {
        const structured = Array.isArray(item.panels)
          ? Object.fromEntries(item.panels.map(panel => [String(panel?.key ?? panel?.id ?? '').toLowerCase(), panel?.text ?? panel?.content]))
          : item.panels
        push({
          kind: 'checkpoint', title: `检查点 ${index + 1}`, source: item.rel, checkpoint: { eventId: event?.id, checkpointIndex: index },
          data: {
            目标: item.goal ?? structured?.goal, 进展: item.state ?? structured?.state,
            走过的弯路: item.dead ?? structured?.dead, 下一步: item.next ?? structured?.next,
            来源: item.sourceRef ?? item.rel, 引文: item.quoteRef, 行号: item.quoteLine,
            相对路径: item.rel, 字节数: item.bytes, SHA256: item.sha256, 记录: item,
          },
        })
      },
    }))
    push({ kind: 'result', title: `检查点 · ${checkpoints.length} 条`, rows, data: checkpoints.length ? undefined : '当前事件没有检查点' })
  }

  function readCheckpointSource(view) {
    const source = operation('memory.source')
    if (source && typeof view.source === 'string' && view.source) launch(source, { path: view.source })
    else feedback('当前检查点缺少可回读的来源路径或宿主操作')
  }

  function verifyCheckpointSource(view) {
    const verify = operation('board.checkpoint.read')
    if (!verify || !view.checkpoint?.eventId) {
      feedback('当前宿主没有检查点查验能力，或事件缺少可用标识')
      return
    }
    const reason = unavailable(verify)
    if (reason) feedback(`不可用 · ${reason}`)
    else execute(verify, view.checkpoint)
  }

  function rootRows() {
    const usable = operations().filter(op => op.id !== ids.status && op.id !== ids.workspaces)
    if (state.page === 'board') {
      return [ids.events, ids.kanban].map(operation).filter(Boolean).map(op => {
        const row = opRow(op)
        if (op.id === ids.kanban) row.label = '白板画布' + (unavailable(op) ? ' [不可用]' : '')
        return row
      })
        .concat(usable.filter(op => op.group === 'board' && op.id !== ids.events && op.id !== ids.kanban).map(opRow))
    }
    const statusMeta = statusDocument()
    const lastRecall = recentRecalls.get(scopeKey(state.scope))
    return [
      { label: '状态与连接', preview: statusMeta, action: () => push({ kind: 'status', title: '状态与连接', data: statusMeta }) },
      ...(lastRecall ? [{ label: '最近一次检索', preview: lastRecall.data, action: () => push(lastRecall) }] : []),
      ...itemsFrom(recent, ['events', 'items', 'rows', 'results']).slice(0, 3).map(event => eventRow(event, '最近 · ')),
      ...(recentError ? [{ label: '最近事件 · 获取失败', preview: recentError, action: () => loadRecent(true) }] : []),
      { label: '切换工作区', action: openWorkspaces },
      ...usable.filter(op => op.group !== 'board' || op.id === 'board.ledger').map(opRow),
    ]
  }

  function statusDocument() {
    if (!state.status) {
      return { 连接: state.connection, ...(state.connectionError && { 原因: state.connectionError }) }
    }
    const live = state.status
    const details = {
      连接: state.connection,
      ...(state.connectionError && { 原因: state.connectionError }),
      工作区: live.scope?.workspace ?? state.scope.workspace ?? '未绑定工作区',
      会话: live.scope?.sessionId ?? state.scope.sessionId ?? '未指定',
      模式: live.mode,
      引擎: live.engineMode ?? live.engine,
      检索索引: live.searchIndex ?? live.index,
      投递回执: live.delivery,
      后台任务: live.jobs,
      契约: state.discovery?.contractVersion,
      实例: state.discovery?.identity,
      状态快照: state.status,
    }
    return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined))
  }

  function rows() {
    if (editor?.kind === 'palette') {
      const candidates = editor.candidates ?? [
        { label: '切换工作区', keywords: 'workspace scope', action: openWorkspaces },
        { label: '连接状态', keywords: 'status', action: () => push({ kind: 'status', title: '状态与连接', data: statusDocument() }) },
        { label: '键盘帮助', keywords: 'help', action: openHelp },
        ...(receipt ? [{ label: '上次操作回执', keywords: 'receipt', action: () => push({ ...receipt }) }] : []),
        ...(receipt?.requestId && typeof client.receipt === 'function' ? [{ label: '向宿主查询上次写入回执', keywords: 'receipt request', action: lookupReceipt }] : []),
        ...operations().map(opRow),
      ]
      const terms = editor.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
      return candidates.filter(item => terms.every(term => `${item.label} ${item.keywords}`.toLowerCase().includes(term)))
    }
    if (editor?.kind === 'workspaces') return editor.rows
    if (editor) return []
    const view = current()
    if (state.page === 'hosts') return view.kind === 'root' ? harnessRows() : []
    if (view.kind === 'root') return rootRows()
    return view.rows ?? []
  }

  function applyStatus(data) {
    if (revision(data) !== state.revision || !state.status) state.status = data
    state.revision = revision(data)
    state.connection = '已连接'
    state.connectionError = undefined
    updateStatusViews()
  }

  function updateStatusViews() {
    for (const view of [...pages.memory, ...pages.board]) {
      if (view.kind === 'status') view.data = statusDocument()
    }
  }

  function checkInstance(identity) {
    const prior = state.discovery?.identity.instanceId
    if (prior && prior !== identity?.instanceId) throw new Error('运行实例已变更。请重新启动终端并选择目标实例。')
  }

  async function discover(target, signal) {
    const result = validateDiscovery(await client.discover({ signal, scope: target }))
    checkInstance(result.identity)
    return result
  }

  async function lightweightStatus(manifest, target, signal) {
    const op = manifest.operations.find(item => item.id === ids.status)
    if (!readOnly(op) || unavailable(op)) throw new Error(`轻量状态不可用 · ${unavailable(op) || ids.status}`)
    const data = await client.call(ids.status, {}, { signal, scope: target, instanceId: manifest.identity.instanceId })
    const identity = data?.identity ?? data?.status?.identity
    if (identity?.instanceId && identity.instanceId !== manifest.identity.instanceId) {
      throw new Error('状态来自不同运行实例。请重新启动终端并选择目标实例。')
    }
    if (data?.contractVersion && data.contractVersion !== manifest.contractVersion) {
      throw new Error(`运行时契约已变更为 ${data.contractVersion}`)
    }
    return data
  }

  async function poll(rediscover = false) {
    if (closed || watcher || foreground) return
    const signal = (watcher = new AbortController()).signal
    try {
      const firstConnection = !state.discovery
      const reconnect = firstConnection || state.connection !== '已连接'
      const manifest = reconnect || rediscover ? await discover(state.scope, signal) : state.discovery
      const target = { ...state.scope, ...manifest.scope }
      const data = await lightweightStatus(manifest, target, signal)
      if (signal.aborted || closed) return
      if (!sameScope(state.scope, target)) state.scope = target
      state.discovery = manifest
      applyStatus(data)
      const detail = pages.hosts.at(-1)
      if (detail.kind === 'harness' && detail.id === 'dsh') detail.data = harnessDetails(harnessRows().find(host => host.id === 'dsh'))
      if (reconnect && !editor) feedback('')
      if (firstConnection && browseWorkspaces && !editor && !foreground && current().kind === 'root') {
        openWorkspaces({ selectFirstWorkspace: true })
      }
    } catch (error) {
      if (!closed && !signal.aborted) {
        state.connection = state.discovery ? '已断开 · 快照保留' : '连接失败'
        state.connectionError = error.code === 'instance-not-found'
          ? 'instance-not-found · 请启动已加载终端服务的 Auto Memory 插件的 DSH Desktop。'
          : errorText(error)
        updateStatusViews()
        feedback(state.connectionError + (state.discovery ? ' · 实例重启后请退出并重新选择' : ''))
      }
    } finally {
      watcher = undefined
      paint()
    }
  }

  function request(label, act, { requestId, detached = false, scope: target = state.scope } = {}) {
    if (closed || (!detached && foreground)) return
    // Capture scope and instance at dispatch. A cancelled promise may still settle later.
    const instanceId = state.discovery?.identity.instanceId
    const controller = new AbortController()
    const { signal } = controller
    const job = { controller, label, requestId, scope: target }
    if (detached) background.add(job)
    else foreground = job
    feedback(`${detached ? '后台处理中' : '请求中'} · ${label}`)
    paint()
    const options = { signal, scope: target, instanceId }
    const call = (id, args) => client.call(id, args, requestId ? { ...options, approved: true, requestId } : options)
    Promise.resolve().then(() => act({ signal, call, options })).then(apply => {
      if (closed || signal.aborted || (!detached && foreground !== job)) return
      if (sameScope(state.scope, target) || !detached) feedback(`完成 · ${label}`)
      apply?.()
    }).catch(error => {
      if (!closed && !signal.aborted && (detached || foreground === job)) {
        if (requestId) rememberUncertain(label, requestId, errorText(error), target)
        if (sameScope(state.scope, target) || !detached) feedback(`${errorText(error)}${requestId ? ' · 请核对回执或回读目标' : ''}`)
      }
    }).finally(() => {
      if (foreground === job) foreground = undefined
      background.delete(job)
      paint()
    })
  }

  function rememberUncertain(label, requestId, message, scope) {
    receipt = { kind: 'result', title: '上次写请求', requestId, scope, data: { 操作: label, 请求编号: requestId, 目标: scope, 状态: message, 后续: '核对回执或回读目标后再决定是否重试' } }
  }

  function lookupReceipt() {
    const { requestId, scope } = receipt
    request('查询宿主回执', ({ options }) => client.receipt(requestId, options).then(data => () => {
      push({ kind: 'result', title: '宿主回执', data: { 请求编号: requestId, 目标: scope, 回执: data } })
    }), { scope })
  }

  function cancel() {
    if (!foreground) return false
    const job = foreground
    foreground = undefined
    job.controller.abort()
    if (job.requestId) rememberUncertain(job.label, job.requestId, '已取消等待，后端受理情况待核对', job.scope)
    feedback(job.requestId ? '已取消等待 · 请核对回执或回读目标' : '已取消请求')
    paint()
    return true
  }

  async function loadRecent(force = false) {
    const op = operation(ids.events)
    const args = op && defaults(op)
    if (recentRequest || recentRequested && !force || !readOnly(op) || unavailable(op) || requiresInput(op, args)) return
    if (op.scope === 'session' && !state.scope.sessionId && !state.status?.scope?.sessionId) return
    if (op.scope === 'workspace' && !state.scope.workspace && !state.status?.scope?.workspace) return
    if (Object.hasOwn(op.inputSchema?.properties ?? {}, 'limit')) args.limit = Math.max(op.inputSchema.properties.limit.minimum ?? 1, 3)
    recentRequested = true
    const target = state.scope
    const controller = new AbortController()
    recentRequest = controller
    try {
      const data = await client.call(op.id, args, { signal: controller.signal, scope: target, instanceId: state.discovery.identity.instanceId })
      if (!controller.signal.aborted) {
        recent = data
        recentError = undefined
      }
    } catch (error) {
      if (!controller.signal.aborted) recentError = errorText(error)
    } finally {
      if (recentRequest === controller) recentRequest = undefined
      paint()
    }
  }

  function launch(op, initial = {}, edit = false) {
    editor = undefined
    const reason = unavailable(op)
    if (reason) {
      push({ kind: 'result', title: op.title || op.id, data: { 操作: op.id, 不可用: reason, 参数: op.inputSchema } })
      feedback(`不可用 · ${reason}`)
      return
    }
    const args = { ...defaults(op), ...initial }
    if (edit || !readOnly(op) || requiresInput(op, args)) openForm(op, args)
    else execute(op, args)
  }

  function openForm(op, args, replacing) {
    const value = JSON.stringify(args, null, 2)
    editor = {
      kind: 'form', title: `参数 · ${op.title || op.id}`, op, value, cursor: value.length, scroll: 0, replacing,
      data: { 操作: op.id, 作用域: op.scope, 访问: op.access, 审批: op.approval, 参数契约: op.inputSchema ?? {} },
    }
  }

  function execute(op, args, replacing, history = replacing?.history ?? [], range = replacing?.range ?? eventRange(args)) {
    if (state.connection !== '已连接') {
      feedback('等待连接恢复后重试')
      return
    }
    const write = !readOnly(op)
    const recall = op.id === 'memory.recall'
    const detached = op.scope === 'workspace' || op.scope === 'session'
    const requestId = write ? randomUUID() : undefined
    const label = op.title || op.id
    const snapshotRevision = state.revision
    const parent = current()
    const target = state.scope
    const mode = replacing?.mode ?? '流'
    editor = undefined
    request(label, async ({ call }) => {
      const eventsOperation = op.id === ids.events
      const [page, groupEvents] = await Promise.all([
        eventsOperation ? readEventPage(call, op, args, range) : call(op.id, args).then(data => ({ data, args })),
        eventsOperation && mode !== '流' ? readEventGroups(call, op, range) : undefined,
      ])
      return () => {
        const { data } = page
        const view = {
          title: label, kind: 'result', data, op, args: page.args, read: !write, revision: snapshotRevision,
          history, focus: undefined,
        }
        if (op.id === ids.events) {
          view.kind = 'events'
          view.mode = mode
          view.range = range
          view.events = page.events
          view.groupEvents = groupEvents
          view.collapsed = replacing?.collapsed ?? new Map()
          view.focus = 'list'
          projectEvents(view)
        } else if (op.id === ids.kanban) projectGraph(view)
        else view.rows = relatedRows(op, data)
        if (recall) {
          const key = scopeKey(target)
          recentRecalls.delete(key)
          if (recentRecalls.size >= 12) recentRecalls.delete(recentRecalls.keys().next().value)
          recentRecalls.set(key, view)
        }
        if (write) {
          view.title = `回执 · ${label}`
          view.requestId = requestId
          view.scope = target
          view.data = { 操作: op.id, 请求编号: requestId, 目标: target, 回执: data }
          receipt = { ...view }
        }
        if (current() !== parent || editor || foreground && detached) return
        if (replacing && replacing === parent) stack().pop()
        push(view)
      }
    }, { requestId, detached, scope: target })
  }

  function projectEvents(view) {
    const { mode, range } = view
    const events = mode === '流' ? view.events : view.groupEvents
    const scopeLabel = eventRanges.find(option => option.value === range)?.label ?? range
    const total = mode === '流' && range !== 'active+paused' && view.data?.total != null ? ` / ${view.data.total}` : ''
    view.title = `事件${mode} · ${events.length} 条${total} · ${scopeLabel}`
    if (mode === '泳道') view.rows = eventLanes(events).map(lane => eventRow(lane.event, '', lane))
    else if (mode === '工作流') view.rows = eventWorkflows(events).flatMap(group => {
      const collapsed = view.collapsed.get(group.key) ?? group.collapsed
      return [{
        label: `[${collapsed ? '+' : '-'}] ${group.key} · ${group.events.length} 条`,
        preview: group.preview,
        action: () => {
          view.collapsed.set(group.key, !collapsed)
          projectEvents(view)
        },
      }, ...(collapsed ? [] : group.events.map(event => eventRow(event, '  ')))]
    })
    else view.rows = events.map(event => eventRow(event))
    view.documentData = view.rows.length ? { 范围: scopeLabel, [mode === '流' ? '本页事件' : '范围内事件']: events.length }
      : { 状态: events.length ? '当前范围没有账本事件 · v 返回事件流' : '当前范围没有事件', 范围: scopeLabel }
  }

  function cycleEventMode(view) {
    const mode = boardModes[view.mode]
    function changeMode() {
      view.mode = mode
      view.selected = view.scroll = 0
      projectEvents(view)
    }
    if (mode === '流' || view.groupEvents) return changeMode()
    request(view.op.title, async ({ call }) => {
      const events = await readEventGroups(call, view.op, view.range)
      return () => {
        view.groupEvents = events
        if (current() === view) changeMode()
      }
    })
  }

  function chooseEventRange(view) {
    editor = { kind: 'workspaces', title: '事件范围', selected: Math.max(0, eventRanges.findIndex(option => option.value === view.range)),
      rows: eventRanges.map(({ label, value }) => ({
        label,
        action: () => {
          const { status, cursor, all, ...args } = view.args
          if (!['active+paused', 'all'].includes(value)) args.status = value
          execute(view.op, args, view, [], value)
        },
      })) }
  }

  function paginate(view, direction) {
    if (!view.op || !view.read) return
    if (view.kind === 'events' && view.mode !== '流') {
      feedback('当前视图显示整个范围 · v 切换回事件流翻页')
      return
    }
    const history = [...view.history]
    const args = direction > 0 ? nextPage(view.op, view.data, view.args) : history.pop()
    if (!args) {
      feedback(direction > 0 ? '没有下一页' : '已在第一页')
      return
    }
    if (direction > 0) history.push(view.args)
    execute(view.op, args, view, history)
  }

  function openHelp() {
    push({ kind: 'result', title: '键盘帮助', data: help })
  }

  function openWorkspaces({ selectFirstWorkspace = false } = {}) {
    editor = undefined
    const op = operation(ids.workspaces)
    const open = data => {
      const items = itemsFrom(data, ['workspaces', 'items', 'rows', 'results', 'entries'])
      workspaceSnapshot = items
      const visible = items.filter(item => typeof workspaceName(item) === 'string')
      const { workspace: currentWorkspace, sessionId: currentSession } = state.scope
      const target = {
        ...(currentWorkspace && { workspace: currentWorkspace }),
        ...(currentSession && { sessionId: currentSession }),
      }
      editor = { kind: 'workspaces', title: '选择工作区 · 可选会话', selected: selectFirstWorkspace && visible.length ? 1 : 0, rows: [
        { label: '输入工作区和会话', action: () => openForm({ id: '@scope', title: '切换工作区和会话', inputSchema: { type: 'object', properties: { workspace: { type: 'string' }, sessionId: { type: 'string' } } } }, target) },
        ...visible.map(item => {
          const workspace = workspaceName(item)
          const sessionId = item.sessionId
          const location = singleLine(item.title || (item.path ?? workspace).split(/[\\/]/u).filter(Boolean).at(-1) || workspace)
          const title = item.sessionTitle || sessionId?.slice(-8)
          return {
            workspace,
            active: Object.values(item.activities ?? {}).some(Boolean) || isBusy(workspace),
            status: Object.values(item.activities ?? {}).some(Boolean) || isBusy(workspace) ? 'running' : 'idle',
            label: `${isBusy(workspace) ? '处理中 · ' : ''}${title ? `${location} · 会话 ${singleLine(title)}` : location}`,
            action: () => switchScope({ workspace, ...(sessionId ? { sessionId } : {}) }),
          }
        }),
      ] }
    }
    if (!readOnly(op) || unavailable(op) || requiresInput(op, defaults(op))) open()
    else request('工作区', ({ call }) => call(op.id, defaults(op)).then(data => () => open(data)))
  }

  function switchScope(target) {
    request('验证工作区和会话', async ({ signal }) => {
      const manifest = await discover(target, signal)
      const selection = { ...target, ...manifest.scope }
      const data = await lightweightStatus(manifest, selection, signal)
      return () => {
        editor = undefined
        watcher?.abort()
        recentRequest?.abort()
        recentRequest = undefined
        state.scope = selection
        state.discovery = manifest
        pages.memory = [root('memory')]
        pages.board = [root('board')]
        recent = recentError = undefined
        recentRequested = false
        state.status = undefined
        applyStatus(data)
        if (state.page === 'memory') void loadRecent()
      }
    })
  }

  function submit(form) {
    let args
    try {
      args = JSON.parse(form.value)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是 JSON 对象')
    } catch (error) {
      feedback(`参数错误 · ${error.message}`)
      return
    }
    if (form.op.id === '@scope') {
      if (Object.keys(args).some(key => !['workspace', 'sessionId'].includes(key) || typeof args[key] !== 'string')) {
        feedback('工作区作用域只接受字符串 workspace 和 sessionId')
        return
      }
      switchScope(Object.fromEntries(Object.entries(args).filter(([, value]) => value.trim())))
    } else if (readOnly(form.op)) execute(form.op, args, form.replacing, [], eventRange(args))
    else {
      if (form.op.scope === 'session' && !state.scope.workspace) {
        feedback('项目写入需要明确目标工作区。按 Esc 返回后使用 w 选择。')
        return
      }
      editor = {
        kind: 'confirm', title: '确认操作', form, args, scroll: 0,
        data: { 操作: form.op.id, 实例: state.discovery?.identity.instanceId, 目标: state.scope, 审批: form.op.approval, 参数: args },
      }
    }
  }

  function editInput(model, text, key) {
    const start = model.selectAll ? 0 : model.cursor
    const end = model.selectAll ? model.value.length : model.cursor
    const replace = (value, from = start, to = end) => {
      model.value = model.value.slice(0, from) + value + model.value.slice(to)
      model.cursor = from + value.length
      model.selectAll = false
      model.selected = 0
    }
    if (key.ctrl && key.name === 'a') model.selectAll = true
    else if (key.name === 'left') { model.cursor = previousGlyph(model.value, model.cursor); model.selectAll = false }
    else if (key.name === 'right') { model.cursor = nextGlyph(model.value, model.cursor); model.selectAll = false }
    else if (key.name === 'home') { model.cursor = model.value.lastIndexOf('\n', model.cursor - 1) + 1; model.selectAll = false }
    else if (key.name === 'end') { model.cursor = model.value.indexOf('\n', model.cursor); if (model.cursor < 0) model.cursor = model.value.length; model.selectAll = false }
    else if (key.name === 'backspace') replace('', model.selectAll ? 0 : previousGlyph(model.value, start))
    else if (key.name === 'delete') replace('', start, model.selectAll ? end : nextGlyph(model.value, end))
    else if (model.kind === 'form' && ['return', 'enter'].includes(key.name)) replace('\n')
    else if (key.name === 'paste' || text && !key.ctrl && !key.meta) replace(model.kind === 'palette' ? singleLine(text) : clean(text))
  }

  function navigate(model, key, list) {
    const page = Math.max(1, screen.height - 9)
    const delta = { up: -1, down: 1, pageup: -page, pagedown: page, home: -Infinity, end: Infinity }[key.name]
    if (delta === undefined) return false
    if (list) {
      model.selected = Math.max(0, Math.min(list.length - 1, (model.selected ?? 0) + delta))
      model.scroll = 0
    } else model.scroll = Math.max(0, (model.scroll ?? 0) + delta)
    return true
  }

  function handleEditor(text, key) {
    if (key.name === 'escape') {
      editor = editor.kind === 'confirm' ? editor.form : undefined
      return
    }
    if (editor.kind === 'confirm') {
      if (text === 'y' && !key.ctrl && !key.meta) execute(editor.form.op, editor.args)
      else navigate(editor, key)
    } else if (editor.kind === 'form') {
      if (key.ctrl && key.name === 's') submit(editor)
      else if (key.name === 'tab') { editor.showContract = !editor.showContract; editor.scroll = 0 }
      else if (editor.showContract || ['pageup', 'pagedown'].includes(key.name)) navigate(editor, key)
      else editInput(editor, text, key)
    } else {
      const list = rows()
      if (['return', 'enter'].includes(key.name)) {
        const item = list[editor.selected]
        if (item) { editor = undefined; item.action() }
      } else if (editor.kind === 'palette' && !['up', 'down', 'pageup', 'pagedown'].includes(key.name)) editInput(editor, text, key)
      else navigate(editor, key, list)
    }
  }

  async function refresh(view) {
    if (watcher) {
      watcher.abort()
      await watchTask
    }
    await startWatch(true)
    if (closed || foreground || current() !== view || state.connection !== '已连接') return
    if (view.kind === 'root' && state.page === 'memory') loadRecent(true)
    else if (view.op && view.read && readOnly(operation(view.op.id)) && !unavailable(operation(view.op.id))) execute(operation(view.op.id), view.args, view)
  }

  function startWatch(rediscover = false) {
    if (!watcher) watchTask = poll(rediscover)
    return watchTask
  }

  function onKey(text, key) {
    if (key.ctrl && key.name === 'c') { close(130); return }
    if (foreground) {
      if (key.name === 'escape') cancel()
      return
    }
    if (editor) handleEditor(text, key)
    else if (key.name !== 'paste') {
      const view = current()
      const list = rows()
      if (text === 'q' && !key.ctrl && !key.meta) { close(0); return }
      if (text === '/' || key.ctrl && key.name === 'p') editor = { kind: 'palette', title: '搜索命令', value: '', cursor: 0, selected: 0 }
      else if (text === '?') openHelp()
      else if (text === 'w') {
        if (state.page === 'hosts') state.page = 'memory'
        openWorkspaces()
      } else if (text === '0' && scanHosts) {
        state.page = 'hosts'
        pages.hosts.length = 1
        feedback('')
        void loadHarnesses()
      }
      else if (text === '1' || text === '2') {
        state.page = text === '1' ? 'memory' : 'board'
        feedback('')
        if (state.page === 'memory') loadRecent()
      } else if (key.name === 'escape') {
        if (view.focus === 'document' && list.length) view.focus = 'list'
        else if (stack().length > 1) stack().pop()
        feedback('')
      } else if (key.name === 'tab' && list.length) {
        view.focus = view.focus === 'document' ? 'list' : 'document'
        view.scroll = 0
      } else if (text === 'r') {
        if (state.page === 'hosts') void loadHarnesses(true)
        void refresh(view)
      }
      else if (text === 'c' && view.op?.id === ids.detail) openCheckpoints(view)
      else if (text === 'd' && view.op?.id === ids.detail) openEventDocuments(view)
      else if (text === 's' && view.kind === 'checkpoint') readCheckpointSource(view)
      else if (text === 'f' && view.kind === 'checkpoint') verifyCheckpointSource(view)
      else if (text === 'a' && view.kind === 'events') chooseEventRange(view)
      else if (text === 'a' && (view.kind === 'graph' || view.kind === 'graph-lane')) toggleGraphArchive(view)
      else if (text === 'k' && (view.kind === 'graph' || view.kind === 'graph-lane')) searchGraph(view)
      else if (text === 'e') {
        const op = view.op ?? (view.kind === 'root' && state.page === 'board' ? operation(ids.events) : undefined)
        if (op && readOnly(op)) openForm(op, view.args ?? defaults(op), view.kind === 'root' ? undefined : view)
      } else if (text === 'v' && view.kind === 'events' && view.op) {
        cycleEventMode(view)
      } else if (text === 'n' || text === 'p') paginate(view, text === 'n' ? 1 : -1)
      else if (['return', 'enter'].includes(key.name) && view.focus !== 'document') list[view.selected]?.action()
      else navigate(view, key, view.focus !== 'document' && list.length ? list : undefined)
    }
    paint()
  }

  const originalRaw = stdin.isRaw
  const wasFlowing = stdin.readableFlowing === true
  const input = pasteInput(onKey)
  const keypress = (text, key) => { if (key) input.handle(text, key) }
  const end = () => close(0)
  const terminate = () => close(143)
  const interrupt = () => close(130)

  function close(code) {
    if (closed) return
    closed = true
    clearInterval(timer)
    inventoryController?.abort()
    foreground?.controller.abort()
    for (const job of background) job.controller.abort()
    watcher?.abort()
    recentRequest?.abort()
    stdin.off('keypress', keypress)
    stdin.off('end', end)
    stdout.off('resize', paint)
    process.off('SIGTERM', terminate)
    process.off('SIGINT', interrupt)
    try { stdin.setRawMode(Boolean(originalRaw)) } finally {
      if (!wasFlowing) stdin.pause()
      screen.leave()
      finish(code)
    }
  }

  try {
    emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.on('keypress', keypress)
    stdin.on('end', end)
    stdout.on('resize', paint)
    process.once('SIGTERM', terminate)
    process.once('SIGINT', interrupt)
    screen.enter()
    stdin.resume()
    paint()
    if (showHarnesses) void loadHarnesses()
    void startWatch().then(() => { if (!closed && state.page === 'memory') loadRecent() })
    timer = setInterval(() => {
      void startWatch()
      if (state.page === 'hosts') void loadHarnesses()
    }, interval)
    return await completion
  } finally {
    if (!closed) close(1)
  }
}
