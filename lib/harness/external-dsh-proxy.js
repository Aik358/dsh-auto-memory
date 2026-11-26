import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { connectDsh } from '../terminal/client.js'
import { createExternalAdapter, ExternalHostError } from './external-hosts.js'

export function createDshProxyBinding({ workspace, workspaceRef = workspace, dshSessionId, dsh }) {
  if (!dsh?.profile || !dsh.instance || !dshSessionId) throw new ExternalHostError('binding-unavailable')
  const connection = connectDsh(dsh)
  return Object.freeze({
    workspace,
    workspaceRef,
    dshSessionId,
    profile: dsh.profile,
    connection,
    async lifecycle(event, options) {
      try {
        return await connection.call('external.lifecycle', event, options)
      } catch (error) {
        if (!['operation-not-found', 'operation-unavailable'].includes(error?.code)) throw error
        return { status: 'unavailable' }
      }
    },
  })
}

export async function connectExternalDsh({ harness, bindingFile, cwd = process.cwd(), signal }) {
  if (typeof bindingFile !== 'string' || !isAbsolute(bindingFile)) {
    throw new ExternalHostError('binding-unavailable')
  }
  const binding = JSON.parse(await readFile(bindingFile, { encoding: 'utf8', signal }))
  if (binding?.harness !== harness || binding.version !== 1) {
    throw new ExternalHostError('binding-unavailable')
  }
  const adapter = createExternalAdapter({ harness, ...createDshProxyBinding(binding) })
  adapter.assertWorkspace(cwd)
  return adapter
}
