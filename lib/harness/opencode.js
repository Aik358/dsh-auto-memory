import { connectExternalDsh } from './external-dsh-proxy.js'

export async function AutoMemory({ directory, client }, options) {
  const { bindingFile } = options ?? {}
  if (typeof bindingFile !== 'string') return {}

  let adapter
  let warned = false
  async function observe(name, sessionId, turnId, source) {
    if (!sessionId) return
    try {
      const signal = AbortSignal.timeout(4000)
      adapter ??= await connectExternalDsh({ harness: 'opencode', bindingFile, cwd: directory, signal })
      return await adapter.handleHook({
        cwd: directory, hook_event_name: name, session_id: sessionId, turn_id: turnId, source,
      }, { signal })
    } catch {
      if (!warned) {
        warned = true
        try {
          await client.app.log({ body: { service: 'Auto Memory', level: 'warn', message: 'OpenCode binding unavailable' } })
        } catch {}
      }
    }
  }

  async function start(sessionId) {
    return observe('SessionStart', sessionId, undefined, 'startup')
  }

  return {
    'chat.message': async ({ sessionID, messageID }, { message }) => {
      await start(sessionID)
      await observe('UserPromptSubmit', sessionID, messageID ?? message.id)
    },
    'experimental.chat.system.transform': async ({ sessionID }, output) => {
      await start(sessionID)
      const result = await observe('PreInvocation', sessionID)
      const context = result?.output?.hookSpecificOutput?.additionalContext
      if (context && !output.system.includes(context)) output.system.push(context)
    },
    'experimental.session.compacting': async ({ sessionID }) => {
      await start(sessionID)
      await observe('PreCompact', sessionID)
    },
    event: async ({ event }) => {
      if (event.type === 'session.idle') await observe('Stop', event.properties.sessionID)
      if (event.type === 'session.compacted') await observe('PostCompact', event.properties.sessionID)
    },
  }
}
