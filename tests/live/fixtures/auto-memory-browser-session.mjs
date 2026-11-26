import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const inject = ['sessions']

export async function apply(ctx) {
  const runtime = process.env.DAM_BASELINE_ASAR_DSH
  if (!runtime) throw new Error('Missing the isolated Desktop runtime directory')
  const llm = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')
  const { createUserMessage } = await import(pathToFileURL(llm).href)
  ctx.on('session/created', (session) => {
    if (!['project-A', 'project-B'].includes(basename(session.header.cwd || '')) || session.header.isSeeded) return
    // The real SessionStore enables append only after the creation observers settle.
    setImmediate(async () => {
      try {
        session.append('turn/start', { turn: 1 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'Isolated GUI fixture conversation' }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)
      } catch (error) {
        console.error('Auto Memory browser fixture failed:', error.message)
      }
    })
  }, { global: true })
}
