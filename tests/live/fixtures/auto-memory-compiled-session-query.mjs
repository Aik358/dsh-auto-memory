import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [buildRoot, runtime] = [
  process.env.DAM_SESSION_QUERY_BUILD_DIR,
  process.env.DAM_SESSION_QUERY_ASAR_DSH,
]
if (!buildRoot || !runtime) throw new Error('Expected compiled session-query and installed DSH runtime directories')

const compiledTree = pathToFileURL(join(buildRoot, 'packages') + '/').href
const packedBase = pathToFileURL(join(runtime, 'package.json')).href
const packages = new Map([
  ['@deepseek-ai/dsh-session-query', 'session-query'],
  ['@deepseek-ai/dsh-session-query-sqlite', 'session-query-sqlite'],
])
const replacements = new Map()
for (const [name, folder] of packages) {
  const candidate = new URL('session-query/' + folder + '/lib/index.js', compiledTree).href
  replacements.set(name, candidate)
  replacements.set(new URL('node_modules/' + name + '/lib/index.js', packedBase).href, candidate)
}

registerHooks({
  resolve(specifier, context, next) {
    const candidate = replacements.get(specifier)
    if (candidate) return next(candidate, context)
    if (context.parentURL?.startsWith(compiledTree) && specifier.startsWith('@deepseek-ai/')) {
      return next(specifier, { ...context, parentURL: packedBase })
    }
    return next(specifier, context)
  },
})
