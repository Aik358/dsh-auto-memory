import { randomUUID } from 'node:crypto'
import { resolveDshHomePre } from '../dsh-home.js'
import { CONTRACT_PATH, ContractError, isCompatible, loopbackOrigin, scopeSchema, validate } from './contract.js'
import { findLocalInstances, localProof, newLocalKey, verifyKey } from './discovery.js'

function requestSignal(signal, timeout) {
  const deadline = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

async function request(url, options) {
  try {
    return await fetch(url, { ...options, redirect: 'manual', cache: 'no-store' })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    const timedOut = error.name === 'TimeoutError'
    throw new ContractError(timedOut ? 'connection-timeout' : 'instance-unreachable',
      timedOut ? 'The DSH request timed out' : 'Could not reach the selected DSH instance', 503)
  }
}

async function readResponse(response) {
  if (response.status === 404 && !response.headers.get('content-type')?.includes('application/json')) {
    throw new ContractError('contract-missing', 'This DSH instance does not expose the Auto Memory terminal contract', 404)
  }
  let data
  try { data = await response.json() } catch (error) {
    if (error.name === 'AbortError') throw error
    if (error.name === 'TimeoutError') throw new ContractError('connection-timeout', 'The DSH response timed out', 503)
    throw new ContractError(response.status === 401 ? 'unauthorized' : 'invalid-response',
      response.status === 401 ? 'DSH rejected this credential' : 'DSH did not return the terminal contract', response.status === 401 ? 401 : 502)
  }
  if (!response.ok) {
    throw new ContractError(data.error?.code || 'operation-failed',
      data.error?.message || 'DSH returned HTTP ' + response.status, response.status, data.error?.details)
  }
  return data
}

async function verifyDiscovered(entry, signal) {
  const url = new URL(CONTRACT_PATH, entry.origin)
  const challenge = newLocalKey()
  url.searchParams.set('challenge', challenge)
  const proof = await readResponse(await request(url, { signal }))
  if (entry.identity.instanceId !== proof.instanceId || !verifyKey(proof.proof, localProof(entry.key, challenge))) {
    throw new ContractError('instance-proof-failed', 'The responding service could not verify the selected instance', 403)
  }
  return { origin: entry.origin, headers: { 'x-auto-memory-terminal-key': entry.key }, instanceId: proof.instanceId }
}

async function exchange(connectUrl, signal) {
  const parsed = loopbackOrigin(connectUrl, { pathAllowed: true })
  if (!parsed || !['/', '/connect'].includes(parsed.pathname) || parsed.searchParams.getAll('token').length !== 1 || parsed.hash) {
    throw new ContractError('invalid-connect-url', 'Provide the local DSH launch or /connect URL through DSH_CONNECT_URL')
  }
  const endpoint = new URL('/connect', parsed.origin)
  endpoint.searchParams.set('token', parsed.searchParams.get('token'))
  endpoint.searchParams.set('interactions', 'none')
  const response = await request(endpoint, { signal })
  const cookie = response.headers.getSetCookie().find(value => /^dsh[^=]*=/i.test(value))
  if (response.status !== 302 || !cookie) {
    throw new ContractError('unauthorized', 'DSH rejected the launch credential', 401)
  }
  return { origin: parsed.origin, headers: { cookie: cookie.split(';', 1)[0] } }
}

export function connectDsh({ url, connectUrl, profile, instance, home, expectedHostVersion, legacy = false, timeout = 30000 } = {}) {
  if (url && connectUrl) throw new ContractError('invalid-target', 'Select a DSH origin or a DSH launch URL')
  const explicit = url && loopbackOrigin(url)
  if (url && !explicit) throw new ContractError('invalid-target', 'Use a local DSH HTTP(S) origin')
  let target
  let targetPromise
  let loadedInstance
  let legacyClient

  async function resolveTarget(signal) {
    if (target) return target
    targetPromise ??= (async () => {
      const probe = requestSignal(signal, Math.min(timeout, 3000))
      if (connectUrl) return exchange(connectUrl, probe)
      const candidates = findLocalInstances(home).filter(entry =>
        (!profile || entry.identity.profile === profile)
        && (!instance || entry.identity.instanceId === instance)
        && (!explicit || entry.origin === explicit.origin))
      const probes = await Promise.allSettled(candidates.map(entry => verifyDiscovered(entry, probe)))
      const verified = probes.filter(result => result.status === 'fulfilled').map(result => result.value)
      if (verified.length > 1) throw new ContractError('multiple-instances', 'Select a DSH instance with --profile or --instance', 409,
        candidates.filter(entry => verified.some(row => entry.identity.instanceId === row.instanceId)).map(entry => entry.identity))
      if (verified.length === 1) return verified[0]
      if (probe.aborted && signal?.aborted) throw signal.reason
      if (candidates.length) throw probes[0].reason
      if (explicit) return { origin: explicit.origin, headers: {} }
      if (legacy && !home && !process.env.DSH_HOME && (!profile || profile === 'desktop') && !instance && !expectedHostVersion) {
        const { detectDesktopOrigins } = await import('./legacy-discovery.js')
        const origins = await detectDesktopOrigins()
        if (origins.length > 1) throw new ContractError('multiple-instances',
          'Select a DSH instance with its authorized launch URL', 409, { origins })
        if (origins.length === 1) return { origin: origins[0], headers: {}, localLegacyHome: resolveDshHomePre() }
      }
      throw new ContractError('instance-not-found', 'No local Auto Memory instance was discovered. Start a compatible DSH profile or specify a DSH origin.', 404)
    })()
    try {
      target = await targetPromise
      return target
    } finally {
      targetPromise = null
    }
  }

  async function adoptLegacy(selected, scope, signal) {
    const { createLegacyClient } = await import('./legacy-client.js')
    const client = createLegacyClient({ origin: selected.origin, headers: selected.headers,
      profile: selected.localLegacyHome ? 'desktop' : profile,
      home: selected.localLegacyHome,
      request: async (route, query, signal) => {
        const endpoint = new URL('/api/dsh-auto-memory/' + route, selected.origin)
        endpoint.search = new URLSearchParams(query).toString()
        return readResponse(await request(endpoint, { signal, headers: selected.headers }))
      },
    })
    const manifest = await client.discover({ scope, signal: requestSignal(signal, timeout) })
    legacyClient = client
    return manifest
  }

  async function discover({ signal, scope = {} } = {}) {
    validate(scope, scopeSchema)
    if (legacyClient) return legacyClient.discover({ scope, signal: requestSignal(signal, timeout) })
    const selected = await resolveTarget(signal)
    if (selected.localLegacyHome) {
      try {
        return await adoptLegacy(selected, scope, signal)
      } catch (error) {
        target = undefined
        throw error
      }
    }
    const endpoint = new URL(CONTRACT_PATH, selected.origin)
    for (const [key, value] of Object.entries(scope)) endpoint.searchParams.set(key, value)
    const response = await request(endpoint, { headers: selected.headers, signal: requestSignal(signal, timeout) })
    if (response.status === 404) {
      await response.body?.cancel()
      const existing = await request(new URL('/api/dsh-auto-memory/state', selected.origin), {
        method: 'HEAD', headers: selected.headers, signal: requestSignal(signal, Math.min(timeout, 3000)),
      })
      if (existing.status === 405) {
        if (legacy && !selected.headers.cookie) {
          throw new ContractError('legacy-auth-required', 'Set DSH_CONNECT_URL to an authorized DSH launch URL for this instance',
            401, { origins: [selected.origin] })
        }
        if (legacy && connectUrl && !instance && !expectedHostVersion) {
          return adoptLegacy(selected, scope, signal)
        }
        throw new ContractError('loaded-plugin-legacy', 'The running Auto Memory build predates the terminal contract', 404)
      }
      throw new ContractError('plugin-not-loaded', 'This DSH origin has no compatible Auto Memory route', 404)
    }
    const data = await readResponse(response)
    if (!isCompatible(data.contractVersion)) {
      throw new ContractError('contract-version-unsupported', 'The running plugin uses an unsupported terminal contract', 409, { supportedMajor: 1 })
    }
    if (!data.identity?.instanceId || !Array.isArray(data.operations)) throw new ContractError('invalid-manifest', 'DSH returned an invalid operation manifest', 502)
    if ((selected.instanceId && data.identity.instanceId !== selected.instanceId) || (loadedInstance && loadedInstance !== data.identity.instanceId)
      || (instance && data.identity.instanceId !== instance) || (profile && data.identity.profile !== profile)) {
      throw new ContractError('instance-changed', 'DSH identity differs from the selected instance. Select the running instance again.', 409)
    }
    if (expectedHostVersion && data.identity.hostVersion !== expectedHostVersion) {
      throw new ContractError('host-version-mismatch', 'The loaded DSH runtime differs from the requested host version', 409, {
        expected: expectedHostVersion, actual: data.identity.hostVersion ?? null,
      })
    }
    loadedInstance = data.identity.instanceId
    return data
  }

  async function call(id, args = {}, { signal, scope = {}, instanceId, approved = false, requestId } = {}) {
    validate(scope, scopeSchema)
    if (!loadedInstance && !legacyClient) await discover({ signal, scope })
    if (legacyClient) return legacyClient.call(id, args, { signal: requestSignal(signal, timeout), scope, instanceId })
    if (instanceId && instanceId !== loadedInstance) throw new ContractError('instance-changed', 'The selected plugin instance changed', 409)
    const selected = await resolveTarget(signal)
    const body = { operation: id, args, scope, instanceId: loadedInstance, ...(approved ? { approved, requestId: requestId || randomUUID() } : {}) }
    try {
      const data = await readResponse(await request(new URL(CONTRACT_PATH, selected.origin), {
        method: 'POST', headers: { ...selected.headers, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: requestSignal(signal, timeout),
      }))
      return data.result
    } catch (error) {
      if (body.requestId && ['connection-timeout', 'instance-unreachable'].includes(error.code)) {
        error.details = { requestId: body.requestId, instanceId: loadedInstance }
      }
      throw error
    }
  }
  return { discover, call, receipt: (requestId, options) => call('receipt', { requestId }, options) }
}
