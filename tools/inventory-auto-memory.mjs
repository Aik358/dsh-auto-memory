#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { Console } from 'node:console'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const baselineFile = path.join(root, 'docs/internal/auto-memory-cli-coverage.json')
const boardModes = ['default', 'legacy', 'event', 'graph']
const pluginFile = 'lib/index.js'
const webFile = 'lib/client.js'
const terminalPath = '/api/dsh-auto-memory/terminal/v1'
const fixtureSession = 'inventory-session'
const fixtureCookie = 'dsh-inventory=fixture-owner'
const runChild = promisify(execFile)

async function captureManifest(handler, workspace) {
  if (!handler) return null
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => { res.writeHead(500); res.end() })
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}${terminalPath}`
  try {
    assert.equal((await fetch(endpoint)).status, 401, 'terminal discovery without owner credentials')
    const discover = async scope => {
      const response = await fetch(endpoint + '?' + new URLSearchParams(scope), { headers: { cookie: fixtureCookie } })
      assert.equal(response.status, 200, `terminal discovery ${JSON.stringify(scope)}: ${await response.clone().text()}`)
      const manifest = await response.json()
      assert.equal(manifest.identity.harness, 'dsh')
      return manifest
    }
    const unscoped = await discover({})
    const scoped = await discover({ sessionId: fixtureSession, workspace })
    assert.deepEqual(unscoped.scope, {})
    assert.equal(scoped.scope.sessionId, fixtureSession)
    assert.equal(scoped.scope.workspace, workspace)
    assert.equal(scoped.contractVersion, unscoped.contractVersion)
    assert.equal(scoped.manifestVersion, unscoped.manifestVersion)
    assert.equal(scoped.identity.instanceId, unscoped.identity.instanceId)
    const operationMap = new Map(scoped.operations.map(op => [op.id, op]))
    assert.equal(operationMap.size, scoped.operations.length, 'duplicate operation in live terminal manifest')
    assert.equal(operationMap.size, unscoped.operations.length, 'unscoped terminal manifest operation count')
    const operations = unscoped.operations.map(({ status, reason, ...description }) => {
      const operation = operationMap.get(description.id)
      assert.ok(operation, `terminal operation ${description.id} missing from scoped manifest`)
      const { status: scopedStatus, reason: scopedReason, ...scopedDescription } = operation
      assert.deepEqual(scopedDescription, description, `terminal operation ${description.id} description depends on scope`)
      return { ...description, availability: { noSession: { status, reason: reason ?? null }, boundSession: { status: scopedStatus, reason: scopedReason ?? null } } }
    })
    return { contractVersion: scoped.contractVersion, manifestVersion: scoped.manifestVersion, operations }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

async function capture(mode, sourceRoot) {
  const home = process.env.DSH_HOME
  assert.ok(home === process.cwd() && path.basename(home).startsWith('dam-auto-memory-inventory-'), 'capture requires an isolated DSH_HOME')
  // apply() emits diagnostics. Keep the result on its own stream.
  globalThis.console = new Console(process.stderr)
  if (mode !== 'default') {
    await writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({ boardMode: mode }))
  }
  const { apply, API, name, inject } = await import(pathToFileURL(path.join(sourceRoot, pluginFile)).href)
  const routes = [], tools = [], events = [], prompts = [], cleanups = []
  const workspace = path.join(home, 'workspace')
  await mkdir(workspace)
  const agent = { session: { id: fixtureSession, header: { cwd: workspace } } }
  const services = {
    agents: { get: id => id === fixtureSession ? agent : undefined },
    connection: { admit: req => req.headers.cookie === fixtureCookie ? { peer: { principal: { kind: 'owner' } } } : null },
  }
  const noop = () => {}
  let terminalHandler, manifest
  try {
    await apply({
      get: name => services[name],
      on(event) { events.push(event); return noop },
      effect(start) { cleanups.push(start()) },
      systemPrompt: {
        context(spec) { prompts.push({ type: 'context', name: spec.name }); return noop },
        section(spec) { prompts.push({ type: 'section', name: spec.name }); return noop },
      },
      tools: {
        register(tool) {
          assert.equal(typeof tool.execute, 'function', tool.name)
          tools.push({ name: tool.name, inputSchema: tool.parameters ?? null, outputSchema: tool.output?.schema ?? null })
          return noop
        },
      },
      webServer: {
        register(route) {
          assert.equal(typeof route.handler, 'function', route.path)
          assert.equal(typeof route.path, 'string', 'registered route path')
          const { handler, ...registration } = route
          if (route.path === terminalPath) terminalHandler = handler
          routes.push(registration)
          return noop
        },
      },
    }, {})
    assert.equal(new Set(routes.map(route => route.path)).size, routes.length, 'duplicate route path')
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length, 'duplicate tool name')
    assert.ok(routes.length && tools.length, 'production apply registered no routes or tools')
    manifest = await captureManifest(terminalHandler, workspace)
  } finally {
    for (const dispose of cleanups.reverse()) if (typeof dispose === 'function') dispose()
  }
  process.stdout.write(JSON.stringify({ name, inject, API, routes, tools, events, prompts, manifest }) + '\n')
}

async function captureMode(mode, sourceRoot) {
  const home = await mkdtemp(path.join(tmpdir(), 'dam-auto-memory-inventory-'))
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DSH_|DAM_|NODE_OPTIONS$)/i.test(key)))
    Object.assign(env, { DSH_HOME: home, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home })
    const { stdout } = await runChild(process.execPath, [fileURLToPath(import.meta.url), '--capture-child', mode, sourceRoot], {
      cwd: home, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    }).catch(error => { throw new Error(`Production apply failed for ${mode}: ${error.stderr || error.message}`, { cause: error }) })
    return JSON.parse(stdout)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function indexWeb(source) {
  const requests = {}, slots = {}, settingsFields = {}, components = {}, configPatchSites = {}
  const prefix = source.match(/var ROUTE_PREFIX = '([^']+)'/)?.[1]
  const apiBlock = source.match(/var API = \{([\s\S]*?)^\s*\}/m)?.[1]
  assert.ok(prefix && apiBlock, 'Web API declaration not found')
  const api = Object.fromEntries(Array.from(apiBlock.matchAll(/^\s*(\w+): ROUTE_PREFIX \+ '([^']+)',?$/gm),
    ([, key, suffix]) => [key, prefix + suffix]))
  const convertAliases = Object.fromEntries(Array.from(
    (source.match(/var CONVERT_ROUTES = \{([\s\S]*?)^\s*\}/m)?.[1] ?? '').matchAll(/^\s*(\w+): API\.(\w+),?$/gm),
    ([, alias, key]) => [alias, key]))
  let region = 'handwritten', settingsGroup = null, inTeamFieldTable = false
  const lines = source.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const at = index + 1
    const text = line.trim()
    if (text.includes('ITER5-LEGACY-GENERATED:BEGIN')) region = 'legacy-generated'
    if (text.includes('ITER5-GENERATED:BEGIN')) region = 'iter5-generated'
    if (/ITER5-(?:LEGACY-)?GENERATED:END/.test(text)) region = 'handwritten'
    if (!text || /^(?:\/\/|\/\*|\*)/.test(text)) continue
    const component = text.match(/^(?:async\s+)?function\s+([\w$]+)\(/)?.[1]
    if (component) (components[component] ??= []).push(at)
    if (component === 'renderTeamSettings') inTeamFieldTable = true
    if (inTeamFieldTable && text === ']') inTeamFieldTable = false
    const teamField = inTeamFieldTable ? text.match(/^\['(team\w+)',\s*'\w+'\]/)?.[1] : null
    if (teamField) ((settingsFields.team ??= {})[teamField] ??= []).push({ line: at, region })
    if (component === 'SettingsPage' || component === 'Iter5Settings') settingsGroup = null
    const section = text.match(/^(?:policyMount.*?\? )?section\('([\w-]+)', sectionLabels\./)?.[1]
    if (section) settingsGroup = section
    if (/^(?:\]\s*\)\s*\]\s*\)|function (?:Iter5Storage|apply)\()/.test(text)) settingsGroup = null
    if (settingsGroup) {
      for (const [, field] of text.matchAll(/\b(?:set|setNum)\('([a-zA-Z]\w*)'\s*,/g)) {
        const locations = (settingsFields[settingsGroup] ??= {})[field] ??= []
        if (!locations.some(location => location.line === at)) locations.push({ line: at, region })
      }
    }
    const patchField = text.match(/\bsaveConfigPatch\(\{\s*(\w+)\s*:/)?.[1]
    if (patchField) (configPatchSites[patchField] ??= []).push({ line: at, region })
    const slot = text.match(/(?:\{\s*)?name: '(conversation\.view|settings\.section|settings\.plugins\.tab|plugins\.detail\.section|shell\.overlay|sidebar\.footer\.action)', id: '([^']+)'/)
    if (slot) slots[`${slot[1]}/${slot[2]}`] = at
    for (const match of text.matchAll(/\b(apiGet|apiPost|fetch|act|runAction)\(\s*API\.(\w+)|\b(apiPost)\([^,;\n]*?\?\s*API\.(\w+)(?:\s*:\s*API\.(\w+))?|\breturn\s+API\.(skinAsset)\s*\+/g)) {
      const [, direct, key, indirect, left, right, asset] = match
      const via = direct || indirect || 'img.src'
      const method = via === 'fetch' ? (text.slice(match.index).match(/^[^,]*,\s*\{\s*method:\s*'(\w+)'/)?.[1] ?? 'GET')
        : ['apiGet', 'img.src'].includes(via) ? 'GET' : 'POST'
      for (const name of [key, left, right, asset].filter(Boolean)) {
        assert.ok(api[name], `${webFile}:${at} uses undeclared API.${name}`)
        ;(requests[name] ??= []).push({ line: at, method, via, region })
      }
    }
    const convert = text.match(/\bapiPost\(CONVERT_ROUTES\.(\w+)/)
    if (convert) {
      const key = convertAliases[convert[1]]
      assert.ok(api[key], `${webFile}:${at} uses undeclared conversion alias ${convert[1]}`)
      ;(requests[key] ??= []).push({ line: at, method: 'POST', via: 'CONVERT_ROUTES.' + convert[1], region })
    }
    // Draft writes pass the endpoint as the fourth argument.
    const draft = text.match(/submitMemoryOperation\(.*?,\s*API\.(\w+)/)
    if (draft && !requests[draft[1]]?.some(site => site.line === at)) {
      assert.ok(api[draft[1]], `${webFile}:${at} uses undeclared API.${draft[1]}`)
      ;(requests[draft[1]] ??= []).push({ line: at, method: 'POST', via: 'submitMemoryOperation', region })
    }
  }
  return { api, requests, slots, settingsFields, configPatchSites, components }
}

function sourceReferences(source) {
  const routeLines = {}, toolLines = {}
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*\/\//.test(line)) continue
    const route = line.match(/\bpath: API(?:\.(\w+)|\['([^']+)'\])/)
    if (route) routeLines[route[1] ?? route[2]] = index + 1
    const tool = line.match(/\bdefineTool\('([^']+)'/)
    if (tool) toolLines[tool[1]] = index + 1
  }
  return { routeLines, toolLines }
}

function indexTerminalManifests(manifests) {
  const versions = {}, operations = {}
  for (const [mode, manifest] of Object.entries(manifests)) {
    const { contractVersion, manifestVersion } = manifest
    versions[mode] = { contractVersion, manifestVersion }
    for (const operation of manifest.operations) {
      const variants = operations[operation.id] ??= []
      const variant = variants.find(entry => isDeepStrictEqual(entry.operation, operation))
      if (variant) variant.boardModes.push(mode)
      else variants.push({ boardModes: [mode], operation })
    }
  }
  return { versions, operations }
}

async function inventory(sourceRoot, componentNames) {
  const captures = await Promise.allSettled(boardModes.map(mode => captureMode(mode, sourceRoot)))
  const runs = captures.map(result => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
  const [first] = runs
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
  const { routeLines, toolLines } = sourceReferences(await readFile(path.join(sourceRoot, pluginFile), 'utf8'))
  const web = indexWeb(await readFile(path.join(sourceRoot, webFile), 'utf8'))
  const routes = {}, tools = {}, terminalRoutes = {}, terminalManifests = {}
  const apiKeys = Object.fromEntries(Object.entries(first.API).map(([key, url]) => [url, key]))
  for (const [index, run] of runs.entries()) {
    assert.deepEqual(run.API, first.API)
    if (run.manifest) terminalManifests[boardModes[index]] = run.manifest
    for (const route of run.routes) {
      const url = route.path
      const key = apiKeys[url] ?? null
      const clientKey = Object.keys(web.api).find(name => web.api[name] === url) ?? null
      if (url === terminalPath) {
        const entry = terminalRoutes[url] ??= { registration: route, registeredIn: [] }
        assert.equal(key, null, `${url} entered the legacy server API table`)
        assert.equal(clientKey, null, `${url} entered the legacy Web API table`)
        assert.deepEqual(entry.registration, route, `route registrations vary for ${url}`)
        entry.registeredIn.push(boardModes[index])
        continue
      }
      const entry = routes[url] ??= {
        registration: route, apiKey: key, serverLine: routeLines[key] ?? null,
        clientKey, webRequests: web.requests[clientKey] ?? [], registeredIn: [],
      }
      assert.deepEqual(entry.registration, route, `route registrations vary for ${url}`)
      entry.registeredIn.push(boardModes[index])
    }
    for (const tool of run.tools) {
      const entry = tools[tool.name] ??= { ...tool, serverLine: toolLines[tool.name] ?? null, registeredIn: [] }
      assert.deepEqual(entry.inputSchema, tool.inputSchema, `input schemas vary for ${tool.name}`)
      assert.deepEqual(entry.outputSchema, tool.outputSchema, `output schemas vary for ${tool.name}`)
      entry.registeredIn.push(boardModes[index])
    }
  }
  for (const manifest of Object.values(terminalManifests)) {
    for (const { id, source } of manifest.operations) {
      assert.ok(source?.kind && source.key, `${id} is missing its terminal source binding`)
      if (source.kind === 'route') {
        assert.equal(first.API[source.key], source.path, `${id} uses a different legacy API path than ${source.key}`)
        assert.ok(routes[source.path], `${id} references unregistered route ${source.path}`)
      }
      if (source.kind === 'tool') assert.ok(tools[source.key], `${id} references unregistered tool ${source.key}`)
    }
  }
  const entriesSorted = object => Object.fromEntries(Object.entries(object).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  const observed = {
    plugin: { name: first.name, packageName: manifest.name, worktreeVersion: manifest.version, inject: first.inject },
    captureModes: runs.map(({ routes, tools }, index) => ({
      boardMode: boardModes[index], routes: routes.filter(route => route.path !== terminalPath).length, tools: tools.length,
    })),
    events: first.events,
    promptRegistrations: first.prompts,
    routes: entriesSorted(routes),
    tools: entriesSorted(tools),
    webSlots: web.slots,
    webSettingsFields: web.settingsFields,
    webConfigPatchSites: web.configPatchSites,
    webComponents: Object.fromEntries(componentNames.map(name => [name, web.components[name] ?? []])),
    declaredWithoutRegistration: Object.entries(first.API).filter(([, url]) => !routes[url]).map(([key]) => key),
    webOnlyApiKeys: Object.keys(web.api).filter(key => !routes[web.api[key]]),
  }
  return { observed, terminalRoutes, terminalManifest: indexTerminalManifests(terminalManifests) }
}

async function inventoryFromCommit(commit, componentNames) {
  assert.match(commit, /^[a-f0-9]{40}$/, 'expected a full baseline commit')
  const snapshot = await mkdtemp(path.join(tmpdir(), 'dam-auto-memory-source-'))
  const archive = path.join(snapshot, 'source.tar')
  const run = (exe, args) => {
    const result = spawnSync(exe, args, { cwd: root, encoding: 'utf8', timeout: 30000 })
    assert.equal(result.status, 0, `${exe}: ${result.error || result.stderr}`)
  }
  try {
    run('git', ['archive', '--format=tar', '-o', archive, commit, 'lib', 'package.json'])
    run('tar', ['-xf', archive, '-C', snapshot])
    return await inventory(snapshot, componentNames)
  } finally {
    await rm(snapshot, { recursive: true, force: true })
  }
}

async function main(command, useBaselineCommit) {
  if (command === '--help') {
    console.log('Usage: node tools/inventory-auto-memory.mjs [--check | --write | --capture-json] [--baseline]')
    console.log('--baseline reads the pinned Git commit via git archive and tar. Default reads the current worktree.')
    return
  }
  assert.ok(['--check', '--write', '--capture-json'].includes(command), `unknown option: ${command}`)
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'))
  const componentNames = [...new Set(baseline.operations.flatMap(operation => operation.webComponents ?? []))].sort()
  const { observed, terminalRoutes, terminalManifest } = useBaselineCommit
    ? await inventoryFromCommit(baseline.target.pluginCommit, componentNames) : await inventory(root, componentNames)
  if (command === '--capture-json') {
    process.stdout.write(JSON.stringify({ ...observed, terminalRoutes, terminalManifest }, null, 2) + '\n')
    return
  }
  const expectedTerminal = useBaselineCommit ? {} : Object.fromEntries(baseline.terminalInfrastructure.map(({ path, observed }) => [path, observed]))
  if (command === '--write') {
    assert.deepEqual(terminalRoutes, expectedTerminal, 'terminal-only registration changed')
    validateCoverage(baseline, observed)
    if (useBaselineCommit) baseline.observed = observed
    else {
      compareInventory(baseline.observed, observed, false)
      baseline.terminalManifest = terminalManifest
      baseline.terminalCoverage = deriveTerminalCoverage(baseline, terminalManifest)
      const problems = coverageProblems(baseline.terminalCoverage)
      console.log(`Wrote ${Object.keys(terminalManifest.operations).length} public operations`)
      if (problems.length) console.log(`Terminal coverage review required:\n${problems.join('\n')}`)
    }
    await writeFile(baselineFile, JSON.stringify(baseline, null, 2) + '\n')
    return
  }
  compareInventory(baseline.observed, observed, useBaselineCommit)
  assert.deepEqual(terminalRoutes, expectedTerminal, 'terminal-only registration changed')
  validateCoverage(baseline, observed)
  if (!useBaselineCommit) {
    const changes = terminalManifestChanges(baseline.terminalManifest, terminalManifest)
    const coverage = deriveTerminalCoverage(baseline, terminalManifest)
    const problems = coverageProblems(coverage)
    const sections = []
    if (changes.length) sections.push(`Terminal manifest drift:\n${changes.join('\n')}`)
    if (problems.length) sections.push(`Terminal coverage review required:\n${problems.join('\n')}`)
    if (!changes.length && !isDeepStrictEqual(coverage, baseline.terminalCoverage)) sections.push('Coverage links changed. Refresh with --write.')
    if (sections.length) throw new Error(sections.join('\n'))
    console.log(`Terminal manifest verified: ${Object.keys(terminalManifest.operations).length} public operations, ${coverage.pendingRequired.length} GUI/host rows pending, ${coverage.partial.length} partial rows`)
  }
  console.log(`Inventory verified: ${Object.keys(observed.routes).length} legacy routes, ${Object.keys(terminalRoutes).length} terminal-only routes, ${Object.keys(observed.tools).length} tools, ${baseline.operations.length} operations`)
}

function terminalManifestChanges(baseline, manifest) {
  const changes = []
  const before = baseline?.operations ?? {}, after = manifest.operations
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!before[id] || !after[id]) {
      changes.push(`${after[id] ? 'added' : 'removed'} public ${id}`)
      continue
    }
    if (isDeepStrictEqual(before[id], after[id])) continue
    const fields = new Set()
    for (const mode of boardModes) {
      const previous = before[id].find(entry => entry.boardModes.includes(mode))?.operation
      const current = after[id].find(entry => entry.boardModes.includes(mode))?.operation
      if (isDeepStrictEqual(previous, current)) continue
      if (!previous || !current) fields.add(`registration in ${mode}`)
      else for (const field of new Set([...Object.keys(previous), ...Object.keys(current)])) {
        if (!isDeepStrictEqual(previous[field], current[field])) fields.add(field)
      }
    }
    changes.push(`changed public ${id} (${[...fields].join(', ') || 'descriptor order'})`)
  }
  if (JSON.stringify(baseline?.versions) !== JSON.stringify(manifest.versions)) changes.push('changed public contract or manifest version')
  return changes
}

function coverageProblems(coverage) {
  return coverage.unmappedPublic.map(id => `unmapped public ${id}`).concat(coverage.invalidLinks)
}

function deriveTerminalCoverage(baseline, manifest) {
  const mapped = {}, pendingRequired = [], pendingModelTools = [], partial = [], invalidLinks = []
  const knownRows = new Map(baseline.operations.map(row => [row.id, row]))
  const reviewed = new Set()
  for (const [id, link] of Object.entries(baseline.terminalLinks)) {
    const variants = manifest.operations[id]
    if (!variants) {
      invalidLinks.push(`public ${id} is linked but no longer registered`)
      continue
    }
    assert.ok(link.rows?.length || link.note, `${id} needs coverage rows or a terminal-only explanation`)
    reviewed.add(id)
    for (const rowId of link.rows ?? []) {
      const row = knownRows.get(rowId)
      assert.ok(row, `public ${id} links to unknown coverage row ${rowId}`)
      for (const { operation: { source } } of variants) {
        const sameSource = source.kind === 'route'
          ? row.routes?.some(route => route.path === source.path && route.method === source.method)
          : source.kind === 'tool' && row.tools?.includes(source.key)
        if (!sameSource && !link.alternateSource?.some(binding => binding.kind === source.kind && binding.key === source.key)) {
          invalidLinks.push(`public ${id} → ${rowId}: changed source ${source.kind}/${source.key}`)
        }
      }
      ;(mapped[rowId] ??= []).push(id)
    }
  }
  for (const row of baseline.operations) {
    if (mapped[row.id] && (baseline.terminalRowLimits[row.id] ||
      mapped[row.id].every(id => baseline.terminalLinks[id].partialRows?.includes(row.id)))) partial.push(row.id)
    if (!mapped[row.id] && ['gui', 'gui-gated', 'host'].includes(row.visibility)) pendingRequired.push(row.id)
    if (!mapped[row.id] && row.visibility === 'model-tool') pendingModelTools.push(row.id)
  }
  return { mapped, pendingRequired, pendingModelTools, partial, invalidLinks, unmappedPublic: Object.keys(manifest.operations).filter(id => !reviewed.has(id)) }
}

function compareInventory(baseline, actual, compareLines) {
  const serialize = value => JSON.stringify(value, (key, child) => !compareLines && ['line', 'serverLine'].includes(key) ? undefined : child)
  const changes = []
  for (const key of Object.keys(actual)) {
    if (['routes', 'tools', 'webSlots', 'webSettingsFields', 'webConfigPatchSites', 'webComponents'].includes(key)) {
      const before = baseline?.[key] ?? {}, after = actual[key]
      for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (key === 'webSlots' && !compareLines && before[name] && after[name]) continue
        if (key === 'webComponents' && !compareLines && before[name]?.length === after[name]?.length) continue
        if (serialize(before[name]) === serialize(after[name])) continue
        changes.push(`${key} ${before[name] ? (after[name] ? 'changed' : 'removed') : 'added'} ${name}`)
      }
    } else if (key === 'plugin' && !compareLines) {
      const { worktreeVersion: beforeVersion, ...before } = baseline[key]
      const { worktreeVersion: afterVersion, ...after } = actual[key]
      if (serialize(before) !== serialize(after)) changes.push(`changed ${key}`)
    } else if (serialize(baseline?.[key]) !== serialize(actual[key])) changes.push(`changed ${key}`)
  }
  assert.equal(changes.length, 0, `Inventory drift:\n${changes.join('\n')}`)
}

function validateCoverage(baseline, observed) {
  const ids = new Set(), routes = new Set(), tools = new Set(), slots = new Set()
  for (const operation of baseline.operations) {
    assert.ok(operation.id && !ids.has(operation.id), `invalid or duplicate operation ID: ${operation.id}`)
    ids.add(operation.id)
    assert.ok(operation.scope && operation.surface && operation.visibility, `missing coverage fields for ${operation.id}`)
    for (const route of operation.routes ?? []) {
      assert.ok(observed.routes[route.path], `${operation.id} references unregistered route ${route.path}`)
      routes.add(route.path)
    }
    for (const name of operation.tools ?? []) {
      assert.ok(observed.tools[name], `${operation.id} references unregistered tool ${name}`)
      tools.add(name)
    }
    for (const name of operation.webComponents ?? []) {
      assert.ok(observed.webComponents[name]?.length, `${operation.id} references unknown Web component ${name}`)
    }
  }
  for (const surface of baseline.surfaces) {
    slots.add(surface.slot)
    assert.ok(observed.webSlots[surface.slot], `unmatched Web slot ${surface.slot}`)
  }
  for (const url of Object.keys(observed.routes)) assert.ok(routes.has(url), `unmapped route ${url}`)
  for (const name of Object.keys(observed.tools)) assert.ok(tools.has(name), `unmapped tool ${name}`)
  for (const name of Object.keys(observed.webSlots)) assert.ok(slots.has(name), `unmapped Web slot ${name}`)
}

try {
  const [command = '--check', option, sourceRoot, ...extra] = process.argv.slice(2)
  if (command === '--capture-child') {
    assert.ok(!extra.length && sourceRoot && boardModes.includes(option), 'invalid child arguments')
    await capture(option, sourceRoot)
  } else {
    assert.ok(!sourceRoot && (option === undefined || option === '--baseline'), 'invalid arguments')
    await main(command, option === '--baseline')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
