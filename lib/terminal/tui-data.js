import { singleLine } from './tui-text.js'

export const ids = {
  status: 'status',
  events: 'board.events.list',
  detail: 'board.events.detail',
  kanban: 'board.kanban',
  workspaces: 'system.workspaces',
}

export function readOnly(operation) {
  return ['read', 'read-only', 'readonly'].includes(operation?.access)
}

export function unavailable(operation) {
  const status = operation?.status
  const state = typeof status === 'object' ? status?.state ?? status?.status : status
  if (status?.supported === false || status?.available === false || status?.enabled === false ||
    status === false || ['unavailable', 'unsupported', 'disabled', 'denied', 'forbidden', 'not-supported'].includes(state)) {
    return status?.reason ?? operation.reason ?? state ?? '当前不可用'
  }
  return ''
}

export function validateDiscovery(result) {
  if (!/^1\.\d+$/.test(result?.contractVersion)) {
    throw new Error(`契约 ${result?.contractVersion ?? '未知'}，本终端支持 1.x。请核对已加载插件和 CLI 版本。`)
  }
  if (!result.identity?.instanceId || !Array.isArray(result.operations)) {
    throw new Error('发现响应缺少实例身份或操作清单')
  }
  return result
}

export function itemsFrom(data, keys) {
  if (Array.isArray(data)) return data
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
    if (Array.isArray(data?.data?.[key])) return data.data[key]
  }
  return []
}

export function eventTitle(event) {
  return singleLine(event?.name ?? event?.title ?? event?.id ?? event?.eventId ?? '未命名事件')
}

export function eventArgs(operation, event) {
  const id = event?.id ?? event?.eventId
  if (typeof id !== 'string' || !id) return {}
  const properties = operation.inputSchema?.properties ?? {}
  if (Object.hasOwn(properties, 'eventId')) return { eventId: id }
  if (Object.hasOwn(properties, 'id')) return { id }
  return {}
}

export function defaults(operation) {
  return Object.fromEntries(Object.entries(operation.inputSchema?.properties ?? {})
    .filter(([, schema]) => schema && Object.hasOwn(schema, 'default'))
    .map(([key, schema]) => [key, schema.default]))
}

export function requiresInput(operation, args) {
  const schema = operation.inputSchema ?? {}
  return (schema.required ?? []).some(key => !Object.hasOwn(args, key)) ||
    Boolean(schema.anyOf || schema.oneOf || schema.if || schema.allOf || schema.$ref)
}

export function workspaceName(item) {
  return typeof item === 'string' ? item : item?.workspace ?? item?.ref ?? item?.wsKey ?? item?.cwd ?? item?.path ?? item?.key
}

export function nextPage(operation, data, args) {
  const properties = operation.inputSchema?.properties ?? {}
  const meta = data?.pagination ?? data?.pageInfo ?? data ?? {}
  if (Object.hasOwn(properties, 'cursor') && meta.nextCursor != null && meta.nextCursor !== '') return { ...args, cursor: meta.nextCursor }
  if (Object.hasOwn(properties, 'offset') && Number.isInteger(meta.nextOffset)) return { ...args, offset: meta.nextOffset }
  const limit = args.limit ?? args.pageSize ?? meta.limit ?? meta.pageSize
  const offset = args.offset ?? meta.offset ?? 0
  if (limit > 0 && Object.hasOwn(properties, 'offset') && (meta.hasMore || offset + limit < meta.total)) {
    return { ...args, offset: offset + limit }
  }
  const page = args.page ?? (Number.isInteger(meta.page) ? meta.page : 1)
  if (Object.hasOwn(properties, 'page') && (meta.hasMore || page < meta.totalPages)) return { ...args, page: page + 1 }
  return null
}
