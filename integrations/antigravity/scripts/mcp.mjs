import { isAbsolute, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { connectExternalDsh } from '../lib/harness/external-dsh-proxy.js'
import { serveExternalMcp } from '../lib/harness/external-mcp.js'

const workspace = process.env.DAM_AUTO_MEMORY_WORKSPACE_ROOT
if (!workspace || !isAbsolute(workspace)) {
  process.stderr.write('auto-memory: workspace-required\n')
  process.exit(1)
}

try {
  if (realpathSync.native(workspace) !== realpathSync.native(process.cwd())) {
    process.stderr.write('auto-memory: scope-forbidden\n')
    process.exit(1)
  }
  const bindingFile = join(workspace, '.agents', 'auto-memory-antigravity.json')
  const adapter = await connectExternalDsh({ harness: 'antigravity', bindingFile })
  await serveExternalMcp(adapter)
} catch {
  process.stderr.write('auto-memory: binding-or-live-api-unavailable\n')
  process.exitCode = 1
}
