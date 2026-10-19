import { redact } from './text.js'

export const API = '/api/dsh-auto-memory/core'

function allowed(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false
  try {
    const host = new URL(`http://${req.headers.host}`)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    if (req.headers.origin && new URL(req.headers.origin).host !== host.host) return false
    return true
  } catch { return false }
}

async function body(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('请求需使用 application/json')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 65536) throw new Error('请求过大')
    chunks.push(Buffer.from(chunk))
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('无效请求')
  return result
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

export function route(engine) {
  return { kind: 'exact', path: API, handler: async (req, res) => {
    if (!allowed(req)) return json(res, 403, { error: '仅允许本机同源访问' })
    try {
      if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: '方法不支持' })
      const args = req.method === 'GET' ? Object.fromEntries(new URL(req.url, 'http://localhost').searchParams) : await body(req)
      const workspace = await engine.forSession(args.sessionId)
      let result
      if (req.method === 'GET') {
        if (args.action === 'source') result = await engine.store.source(args.id, workspace, args.offset)
        else if (args.action === 'search') result = await engine.store.search(workspace, args.query, 30, true)
        else if (!args.action || args.action === 'list') result = {
          records: await engine.store.list(workspace, '', 50, args.offset), sources: [], status: await engine.status(workspace),
        }
        else throw new Error('未知操作')
      } else {
        if (args.action === 'write' || args.action === 'delete') result = await engine.mutate(workspace, args.action, args)
        else if (args.action === 'consolidate') result = await engine.run(workspace)
        else throw new Error('未知操作')
      }
      return json(res, 200, result)
    } catch (error) { return json(res, 400, { error: redact(error.message || String(error)) }) }
  } }
}
