import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const [desktop, packageDir] = process.argv.slice(2)
if (!desktop || process.argv.length > 4) {
  console.error('Usage: node tests/live/auto-memory-terminal-storage.mjs <Desktop executable> [isolated plugin directory]')
  process.exit(2)
}
const plugin = resolve(packageDir || repo)
const entry = join(plugin, 'lib', 'terminal', 'cli.js')
const fixture = new URL('./auto-memory-cli-baseline.mjs', import.meta.url).href
const browserEntry = process.env.DAM_STORAGE_BROWSER_MODULE
const teamOnly = process.env.DAM_STORAGE_TEAM_ONLY === '1'
const remoteTeamOnly = process.env.DAM_STORAGE_TEAM_REMOTE_ONLY === '1'
const continuationOnly = process.env.DAM_STORAGE_CONTINUATION_ONLY === '1'
const automaticContinuationOnly = process.env.DAM_STORAGE_AUTOMATIC_CONTINUATION_ONLY === '1'
const deliveryOnly = process.env.DAM_STORAGE_DELIVERY_ONLY === '1'
const conptyOnly = process.env.DAM_STORAGE_CONPTY_ONLY === '1'
const externalUserOnly = process.env.DAM_STORAGE_EXTERNAL_USER_ONLY === '1'
const memoryActionsOnly = process.env.DAM_STORAGE_MEMORY_ACTIONS_ONLY === '1'

// Reuse the live launcher while keeping this probe's fixtures and assertions independent.
async function loadLauncher() {
  const hook = registerHooks({
    load(url, context, next) {
      const loaded = next(url, context)
      if (url !== fixture) return loaded
      const source = Buffer.from(loaded.source).toString('utf8').replaceAll('\r\n', '\n')
      const dispatch = '\nif (mutationMode) {\n  await verifyMutation'
      const offset = source.lastIndexOf(dispatch)
      assert.ok(offset > 0, 'Baseline launcher dispatch changed')
      const environmentAnchor = '    ...inherited,\n    DSH_HOME: home,'
      const settingsAnchor = '    externalSources: {},'
      let launcher = source.slice(0, offset)
      assert.ok(launcher.includes(environmentAnchor) && launcher.includes(settingsAnchor), 'Baseline isolation anchors changed')
      if (browserEntry) {
        const start = launcher.indexOf('    await openView(/^(白板看板|Whiteboard)$/u)')
        const end = launcher.indexOf('  } catch (error) {\n    const page = browser.contexts()', start)
        assert.ok(start > 0 && end > start, 'Baseline browser navigation changed')
        launcher = launcher.slice(0, start) + [
          '    await dismissPluginPrompts()',
          '    await openView(/^(记忆|Memory)$/u)',
          '    await dismissPluginPrompts()',
          "    await page.locator('[data-i5-nav=\"handoff\"]:visible').first().click({ timeout: 10000 })",
          '    const [preview] = await Promise.all([',
          '      page.waitForResponse(response => {',
          '        const url = new URL(response.url())',
          "        return url.pathname === api + 'external-view' && url.searchParams.get('source') === 'project-conventions'",
          '      }, { timeout: 12000 }),',
          "      page.getByRole('tab', { name: /^(外部来源|External sources)$/u }).click({ timeout: 10000 }),",
          '    ])',
          "    assert.equal(new URL(preview.url()).searchParams.get('sessionId'), event.sessionId)",
          '    assert.equal(preview.status(), 200)',
          "    assert.equal((await preview.json()).content, '# Isolated project conventions\\n')",
          "    await page.locator('.i5-external-content').getByText('Isolated project conventions', { exact: true }).waitFor({ timeout: 10000 })",
          "    report('browser external project source', { sessionScopedRequest: true, contentRendered: true })",
          '',
        ].join('\n') + launcher.slice(end)
      }
      return {
        ...loaded,
        source: launcher.replace(environmentAnchor, [
          '    ...inherited,',
          "    HOME: root, USERPROFILE: root, APPDATA: join(root, 'roaming'),",
          '    TMP: root, TEMP: root, TMPDIR: root,',
          '    DSH_HOME: home,',
        ].join('\n')).replace(settingsAnchor, [
          '    memoryAnchorEnabled: true,',
          '    maintainScheduleEnabled: false, consolidateScheduleEnabled: false,',
          '    autoContinueEnabled: false, autoContinueThreshold: 0.81,',
          "    externalSources: { 'project-conventions': false, 'claude-global': false, 'codex-sessions': false },",
        ].join('\n')) + '\nexport { authenticate, cli, collectProcess, createWorkspace, environment, prepare, pluginRequest, remote, report, sha256, startDesktop, startMaintenanceModel, verifyGui }\n',
      }
    },
  })
  const argv = process.argv
  process.argv = [...argv.slice(0, 2), desktop, plugin, ...(browserEntry ? [browserEntry] : [])]
  try {
    return await import(fixture)
  } finally {
    process.argv = argv
    hook.deregister()
  }
}

const { authenticate, cli, collectProcess, createWorkspace, environment, prepare, pluginRequest, remote, report, sha256,
  startDesktop, startMaintenanceModel, verifyGui } = await loadLauncher()
const tempAlias = tmpdir()
const temp = await realpath(tempAlias)
const root = await mkdtemp(join(temp, 'dam-terminal-storage-'))
const observed = []

function inside(dir, file) {
  const path = relative(dir, file)
  assert.ok(path && path !== '..' && !/^[.][.][\\/]/u.test(path) && !isAbsolute(path), 'Fixture path must stay inside its isolated directory')
  return file
}

const digest = async file => sha256(await readFile(inside(root, file)))
async function readIfPresent(file) {
  try { return await readFile(file) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
const approve = () => ['--yes', '--request-id', randomUUID()]
const memoryId = letter => 'mem_' + letter.repeat(32)
const noteText = (letter, text) => '<!-- memory:' + memoryId(letter) + ' -->\n## ' + text + '\n'
const backend = {
  settings: 'settings.set',
  scan: 'memory.storage',
  repair: 'memory.storage.repair',
  delete: 'memory.storage.delete',
  export: 'memory.migration.export',
  stage: 'memory.migration.stage',
  inspect: 'memory.migration.inspect',
  import: 'memory.migration.import',
}

async function runChecks(home, launch, connection) {
  const web = (path, options) => pluginRequest(connection, path, options)
  async function workspace(name) {
    const workspace = join(root, name)
    const { sessionId, workspaceId } = await createWorkspace(connection, workspace)
    const state = await web('state', { query: { ws: workspace } })
    assert.equal(await realpath(state.ws), await realpath(workspace))
    inside(home, state.notesPath)
    return { sessionId, workspaceId, workspace, file: state.notesPath }
  }

  const a = await workspace('project-A')
  const b = await workspace('project-B')
  assert.notEqual(a.file, b.file)
  const shell = (scope, args, { input, exit = 0 } = {}) => cli(root, home, scope, [
    '--dsh-home', home, '--profile', 'desktop',
    ...(scope ? ['--session', scope.sessionId, '--workspace', scope.workspace] : []), ...args,
  ], undefined, { entry, input, expectedExit: exit })
  const call = (id, input = {}, scope = a) => shell(scope, ['api', 'call', id], { input })
  const rejected = async (id, input, scope, options, exit, code) => {
    const response = await shell(scope, ['api', 'call', id, ...options], { input, exit })
    assert.equal(response.error.code, code)
    return response.error
  }
  async function write(id, input, scope = a, requestId = randomUUID()) {
    const response = await shell(scope, ['api', 'call', id, '--yes', '--request-id', requestId], { input })
    assert.deepEqual(response.receipt, { requestId, state: 'finished' })
    return { ...response, requestId }
  }
  const receipt = (requestId, scope = a) => shell(scope, ['api', 'receipt', requestId])
  function finding(id, details) {
    observed.push(id)
    report('observed bug', { id, ...details })
  }
  async function businessRejection(id, input, scope, expectedReason) {
    const requestId = randomUUID()
    const env = environment(root, home)
    delete env.ELECTRON_RUN_AS_NODE
    env.DSH_SESSION_ID = scope.sessionId
    const args = ['--json', '--dsh-home', home, '--profile', 'desktop', '--workspace', scope.workspace, '--session', scope.sessionId,
      'api', 'call', id, '--yes', '--request-id', requestId, '--input-file', '-']
    const output = await collectProcess(process.execPath, [entry, ...args], { env, cwd: root }, JSON.stringify(input))
    if (output.code !== 0) {
      assert.equal(output.stdout, '')
      const { error } = JSON.parse(output.stderr)
      assert.ok([error.code, error.message, error.details?.reason].includes(expectedReason) ||
        (expectedReason === 'preview-stale' && /迁移包或目标文件已变化/u.test(error.message)), JSON.stringify(error))
      report('business rejection', { operation: id, reason: expectedReason, exit: output.code })
      return output.code
    }
    assert.equal(output.stderr, '')
    const response = JSON.parse(output.stdout)
    assert.equal(response.result.ok, false)
    assert.equal(response.result.reason || response.result.error, expectedReason)
    const stored = await receipt(requestId, scope)
    assert.deepEqual(stored.result, response.result)
    finding(id + ':' + expectedReason, { exit: output.code, stdout: response.result, state: stored.state })
    return output.code
  }

  const doctor = await shell(a, ['doctor'])
  const launchDoctor = await cli(root, home, a, ['doctor'], launch, { entry })
  assert.equal(doctor.identity.instanceId, launchDoctor.identity.instanceId)
  assert.equal(doctor.identity.profile, 'desktop')
  assert.equal(doctor.contractVersion, '1.0')
  if (process.env.DAM_SESSION_QUERY_BUILD_DIR) assert.equal(doctor.status.searchIndex.committedSearchVersion, 1)
  const manifest = await shell(a, ['api', 'list'])
  assert.equal(manifest.identity.instanceId, doctor.identity.instanceId)
  for (const id of Object.values(backend)) assert.ok(manifest.operations.some(op => op.id === id && op.status === 'available'), id)
  report('desktop terminal attached', {
    pluginVersion: doctor.identity.pluginVersion ?? doctor.cliVersion, build: doctor.identity.buildId,
    contract: doctor.contractVersion, operations: manifest.operations.length,
    committedSearchVersion: doctor.status.searchIndex.committedSearchVersion,
  })

  async function settings() {
    const { eventStorePre, EVENT_STORE_FILENAME } = await import(pathToFileURL(join(plugin, 'lib', 'event-store.js')))
    const eventPath = join(dirname(a.file), 'handoff', EVENT_STORE_FILENAME)
    assert.ok(await eventStorePre.create(eventPath, { name: 'Isolated board mode event 测试', summary: 'Verify visibility across all modes' }))
    const seeded = (await web('event-list', { query: { sessionId: a.sessionId } })).events
    assert.equal(seeded.length, 1)
    const original = await call('settings.get')
    let revision = original.revision
    const projections = []
    for (const boardMode of ['legacy', 'graph', 'event']) {
      const requestId = randomUUID()
      const input = { revision, patch: { boardMode } }
      const saved = await write(backend.settings, input, a, requestId)
      assert.notEqual(saved.result.revision, revision)
      assert.equal(saved.result.config.boardMode, boardMode)
      assert.equal((await call('status')).settingsRevision, saved.result.revision)
      assert.equal((await web('config')).config.boardMode, boardMode)
      const terminal = await call('board.kanban')
      const gui = await web('kanban-board', { query: { sessionId: a.sessionId } })
      assert.equal(terminal.boardMode, boardMode)
      assert.equal(terminal.enabled, boardMode === 'graph')
      assert.equal(terminal.reason, boardMode === 'graph' ? undefined : boardMode + '-mode')
      if (boardMode === 'graph') {
        assert.ok(terminal.matrix && terminal.wsBound)
        const { generatedAt, ...matrix } = terminal.matrix
        const { generatedAt: webGeneratedAt, ...webMatrix } = gui.matrix
        assert.ok(Number.isFinite(Date.parse(generatedAt)) && Number.isFinite(Date.parse(webGeneratedAt)))
        assert.deepEqual(matrix, webMatrix)
      }
      assert.equal(terminal.enabled, gui.enabled)
      assert.equal(terminal.reason, gui.reason)
      const events = await call('board.events.list')
      assert.deepEqual(events.events.map(row => row.id), seeded.map(row => row.id))
      const savedReceipt = await receipt(requestId)
      assert.equal(savedReceipt.state, 'finished')
      assert.equal(savedReceipt.result.revision, saved.result.revision)
      assert.deepEqual(await write(backend.settings, input, a, requestId), saved)
      projections.push({ boardMode, kanban: terminal.enabled, reason: terminal.reason ?? null, events: events.events.length })
      revision = saved.result.revision
    }
    await rejected(backend.settings, { revision, patch: { boardMode: 'event' } }, a, [], 3, 'confirmation-required')
    await rejected(backend.settings, { revision, patch: { boardMode: 'invalid' } }, a, approve(), 2, 'invalid-input')
    await rejected(backend.settings, { revision: original.revision, patch: { boardMode: 'legacy' } }, a, approve(), 5, 'settings-version-conflict')
    report('settings board modes', { projections, staleRevisionExit: 5, invalidEnumExit: 2, unapprovedExit: 3, idempotent: true })

    const policy = []
    for (const [enabled, threshold] of [[true, 0.01], [false, 1], [true, 0.72]]) {
      const { result } = await write(backend.settings, { revision, patch: { autoContinueEnabled: enabled, autoContinueThreshold: threshold } })
      const terminal = await call('board.continue.status')
      const gui = await web('auto-continue-state', { query: { sessionId: a.sessionId } })
      assert.equal(terminal.enabled, enabled)
      assert.equal(terminal.threshold, threshold)
      assert.deepEqual(terminal, gui)
      revision = result.revision
      policy.push({ enabled, threshold, armed: !!terminal.armed })
    }
    for (const threshold of [0, 1.01]) {
      await rejected(backend.settings, { revision, patch: { autoContinueThreshold: threshold } }, a, approve(), 2, 'invalid-input')
    }
    assert.equal((await call('settings.get')).revision, revision)
    await web('config', { body: { autoContinueThreshold: 0.63 } })
    const webSaved = await call('settings.get')
    assert.notEqual(webSaved.revision, revision)
    assert.equal(webSaved.config.autoContinueThreshold, 0.63)
    assert.equal((await call('board.continue.status')).threshold, 0.63)
    revision = webSaved.revision
    report('settings auto continuation', { policy, invalidThresholds: [0, 1.01], exit: 2, webToCliThreshold: 0.63 })

    await writeFile(join(a.workspace, 'CLAUDE.md'), '# Isolated project conventions\n')
    await writeFile(join(b.workspace, 'CLAUDE.md'), '# Independent cold project B conventions\n')
    await mkdir(join(root, '.claude'))
    await writeFile(join(root, '.claude', 'CLAUDE.md'), '# Isolated global source\n')
    let expected = { ...original.config.externalSources }
    const sourceStates = []
    const selectedSources = rows => Object.fromEntries(rows.filter(row => ['project-conventions', 'claude-global'].includes(row.id))
      .map(row => [row.id, { enabled: row.enabled, fileCount: row.fileCount }]))
    for (const patch of [{ 'project-conventions': true }, { 'claude-global': true }, { 'project-conventions': false }]) {
      const { result } = await write(backend.settings, { revision, patch: { externalSources: patch } })
      expected = { ...expected, ...patch }
      assert.deepEqual(result.config.externalSources, expected)
      assert.deepEqual((await web('config')).config.externalSources, expected)
      assert.deepEqual((await call('settings.get')).config.externalSources, expected)
      const { sources } = await call('memory.external')
      const states = selectedSources(sources)
      const browserSources = await web('external', { query: { sessionId: a.sessionId } })
      assert.deepEqual(states, selectedSources(browserSources.sources))
      assert.deepEqual(states['claude-global'], { enabled: expected['claude-global'], fileCount: expected['claude-global'] ? 1 : 0 })
      assert.deepEqual(states['project-conventions'], { enabled: expected['project-conventions'], fileCount: expected['project-conventions'] ? 1 : 0 })
      if (patch['project-conventions'] === true) {
        const source = 'project-conventions'
        const [projectA, projectB] = await Promise.all([a, b].map(scope => web('external-view', { query: { source, sessionId: scope.sessionId } })))
        assert.equal(projectA.content, '# Isolated project conventions\n')
        assert.equal(projectB.content, '# Independent cold project B conventions\n')
        const { sources: sourcesB } = await call('memory.external', {}, b)
        assert.equal(sourcesB.find(row => row.id === source)?.preview.trim(), projectB.content.trim())
        const request = { source, target: 'project', sessionId: a.sessionId }
        const linked = await web('external-import', { body: request })
        assert.match(linked.result, /已接入项目笔记/u)
        const content = await readFile(a.file, 'utf8')
        assert.ok(content.includes(join(a.workspace, 'CLAUDE.md')))
        assert.ok(!content.includes(join(b.workspace, 'CLAUDE.md')))
        assert.equal((await web('external-view', { query: { source, sessionId: a.sessionId } })).imported, true)
        assert.equal((await web('external-view', { query: { source, sessionId: b.sessionId } })).imported, false)
        assert.match((await web('external-remove', { body: request })).result, /已从/u)
        assert.equal((await web('external-view', { query: { source, sessionId: a.sessionId } })).imported, false)
        assert.equal(await readFile(join(a.workspace, 'CLAUDE.md'), 'utf8'), projectA.content)
        await web('external-view', { status: 400, query: { source, sessionId: 'isolated-unbound-session' } })
        if (browserEntry) await verifyGui(connection, a, 'project-source')
      } else if (patch['project-conventions'] === false) {
        await web('external-view', { status: 404, query: { source: 'project-conventions', sessionId: a.sessionId } })
      }
      sourceStates.push(states)
      revision = result.revision
    }
    await rejected(backend.settings, { revision, patch: { externalSources: { 'unknown-fixture': true } } }, a, approve(), 2, 'invalid-input')
    assert.equal((await call('settings.get')).revision, revision)
    report('settings external sources merge', { keys: expected, sourceStates, unknownKeyExit: 2,
      coldProjects: 2, scopedPreview: true, importRemove: true, unboundStatus: 400, disabledStatus: 404 })
  }

  async function workspaceAliases() {
    if (process.platform !== 'win32' || tempAlias.toLowerCase() === temp.toLowerCase()) {
      report('workspace aliases skipped', { reason: 'No Windows short alias for the temporary directory' })
      return
    }
    const slug = workspace => '--' + workspace.replace(/[\\/:*?"<>|]/gu, '-') + '--'
    const result = []
    for (const scenario of ['fresh', 'short-only', 'long-only', 'both']) {
      const workspace = join(root, 'project-alias-' + scenario)
      const alias = join(tempAlias, relative(temp, workspace))
      const { sessionId } = await createWorkspace(connection, workspace)
      assert.equal(await realpath(alias), await realpath(workspace))
      const longFile = join(home, 'memory', slug(workspace), 'MEMORY.md')
      const shortFile = join(home, 'memory', slug(alias), 'MEMORY.md')
      const shortText = noteText('b', 'Legacy short directory record')
      const longText = noteText('a', 'Legacy long directory record')
      const seed = async (file, text) => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, text)
      }
      if (scenario === 'both' || scenario === 'short-only') await seed(shortFile, shortText)
      if (scenario === 'both' || scenario === 'long-only') await seed(longFile, longText)
      const selected = scenario === 'short-only' ? shortFile : longFile
      const sig = { sessionId }
      for (const [index, ws] of [alias, workspace].entries()) {
        const state = await web('state', { query: { ...sig, ws } })
        assert.equal(state.notesPath, selected)
        const list = await web('list', { query: { ...sig, ws } })
        assert.equal(list.projectDir, dirname(selected))
        const terminal = await call(backend.scan, {}, { ...sig, workspace: ws })
        assert.equal(terminal.sources.find(row => row.kind === 'workspace').file, selected)
        const note = await web('note', { body: {
          ...sig, content: 'Alias write ' + (index ? 'from long workspace' : 'from short workspace'), expectedNotesPath: state.notesPath,
        } })
        assert.equal(note.path, selected)
      }
      const { content } = await web('file', { query: { ...sig, path: 'MEMORY.md' } })
      assert.match(content, /Alias write from short workspace/u)
      assert.match(content, /Alias write from long workspace/u)
      if (scenario === 'short-only') assert.ok(content.includes(shortText))
      if (scenario === 'both' || scenario === 'long-only') assert.ok(content.includes(longText))
      const inactive = selected === shortFile ? longFile : shortFile
      if (scenario === 'both') {
        const oldSource = await web('file', { query: { ...sig, path: shortFile } })
        assert.equal(sha256(oldSource.content), sha256(shortText))
        await web('file', { status: 403, query: { sessionId: b.sessionId, path: shortFile } })
        await web('note', { status: 409, body: { ...sig, content: 'Stale form must preserve the other file', expectedNotesPath: shortFile } })
        assert.equal(await digest(shortFile), sha256(shortText))
      } else {
        await assert.rejects(stat(inactive), { code: 'ENOENT' })
      }
      result.push({ scenario, destination: selected === shortFile ? 'legacy-short' : 'long', sha256: sha256(content) })
    }
    report('workspace alias writes', { result, bothExistingFilesReadable: true, staleDraftStatus: 409 })
  }

  async function externalUserSource() {
    const sourcePath = join(root, '.claude', 'CLAUDE.md')
    const originalSource = '# Isolated global Claude source\nShared profile memory pointer fixture.\n'
    await mkdir(dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, originalSource)
    const config = await call('settings.get')
    if (config.config.externalSources['claude-global'] !== true) {
      await write('settings.set', {
        revision: config.revision,
        patch: { externalSources: { 'claude-global': true } },
      })
    }
    const sources = await call('memory.external')
    const globalSource = sources.sources.find(row => row.id === 'claude-global')
    assert.equal(globalSource?.enabled, true)
    assert.equal(globalSource?.fileCount, 1)

    const importArgs = { source: 'claude-global', target: 'user' }
    const first = await write('memory.external.import', importArgs, a)
    assert.match(first.result.result, /已接入用户级记忆/u)
    assert.equal(first.result.skipped, false)
    const second = await write('memory.external.import', importArgs, a)
    assert.match(second.result.result, /已跳过已接入来源/u)
    assert.equal(second.result.skipped, true)

    const userA = await call('memory.read', { kind: 'user' }, a)
    const userB = await call('memory.read', { kind: 'user' }, b)
    const sourceOccurrences = userA.split(sourcePath).length - 1
    assert.equal(sourceOccurrences, 1)
    assert.equal(userB, userA, 'user-level imported references are shared across workspaces')
    assert.ok(!userA.includes(originalSource), 'external source contents remain linked, not copied')
    assert.equal((await readFile(sourcePath, 'utf8')), originalSource)

    const projectBefore = await Promise.all([a, b].map(scope => call('memory.read', { kind: 'notes' }, scope)))
    const removeArgs = { source: 'claude-global', target: 'user' }
    const removed = await write('memory.external.remove', removeArgs, a)
    assert.match(removed.result.result, /已从 .*移除已接入内容/u)
    const userAfterA = await call('memory.read', { kind: 'user' }, a)
    const userAfterB = await call('memory.read', { kind: 'user' }, b)
    assert.doesNotMatch(userAfterA, /claude-global|Isolated global Claude source/u)
    assert.equal(userAfterB, userAfterA)
    assert.deepEqual(await Promise.all([a, b].map(scope => call('memory.read', { kind: 'notes' }, scope))), projectBefore)
    assert.equal(await readFile(sourcePath, 'utf8'), originalSource, 'removal keeps the original source intact')

    const repeated = await write('memory.external.remove', removeArgs, a)
    assert.match(repeated.result.result, /尚未接入用户级记忆/u)
    assert.equal(await readFile(sourcePath, 'utf8'), originalSource)
    report('user-level external source import and removal', {
      workspaces: 2, sharedUserReadback: true, duplicateImportSkipped: true,
      userOnlyRemoval: true, originalSourcePreserved: true, duplicateRemovalSafe: true,
    })
  }

  async function memoryTerminalActions() {
    const ids = ['a', 'b', 'c'].map(letter => 'mem_' + letter.repeat(32))
    const note = [
      `<!-- memory:${ids[0]} -->\n## First conclusion\nA candidate for retraction and expansion.`,
      `<!-- memory:${ids[1]} -->\n## Second conclusion\nA candidate for superseding.`,
      `<!-- memory:${ids[2]} -->\n## Third conclusion\nThe confirmed replacement conclusion.`,
    ].join('\n\n')
    await mkdir(dirname(a.file), { recursive: true })
    await mkdir(dirname(b.file), { recursive: true })
    await writeFile(a.file, '# Existing note before the terminal replacement.\n')
    await writeFile(b.file, 'Unrelated workspace note remains unchanged.\n')
    const original = await call('memory.source', { path: a.file })
    const otherBefore = await digest(b.file)
    const replacement = {
      expectedNotesPath: a.file,
      expectedRevision: original.revision,
      content: note,
    }
    await rejected('memory.note.replace', replacement, a, [], 3, 'confirmation-required')
    await rejected('memory.note.replace', replacement, b, approve(), 5, 'note-destination-changed')
    const replaced = await write('memory.note.replace', replacement)
    assert.equal(replaced.result.changed, true)
    const afterReplace = await call('memory.source', { path: a.file })
    assert.equal(afterReplace.revision, replaced.result.revision)
    assert.match(afterReplace.content, /First conclusion/u)
    await rejected('memory.note.replace', replacement, a, approve(), 5, 'note-revision-conflict')

    const expanded = await call('memory.recall.expand', { expand: ids[0] })
    assert.match(typeof expanded === 'string' ? expanded : JSON.stringify(expanded), /First conclusion/u)
    const expandedElsewhere = await call('memory.recall.expand', { expand: ids[0] }, b)
    assert.doesNotMatch(typeof expandedElsewhere === 'string' ? expandedElsewhere : JSON.stringify(expandedElsewhere),
      /candidate for retraction and expansion/u)

    const state = await web('state', { query: { ws: a.workspace, sessionId: a.sessionId } })
    const planPath = join(state.projectDir, 'handoff', 'PLAN.md')
    await mkdir(dirname(planPath), { recursive: true })
    await writeFile(planPath,
      '# PLAN\n\n## Fixture checkpoint\n\nA source for type:dead-end in the final installed package.\n')
    const planOverview = JSON.parse(await call('memory.read', { kind: 'plan' }, a))
    assert.equal(await realpath(planOverview.path), await realpath(planPath))
    const planEntries = await call('memory.plan.expand', { tag: 'type:dead-end' }, a)
    assert.ok(planEntries.entries.length > 0, JSON.stringify(planEntries))
    const planTrace = await call('memory.plan.trace', { id: planEntries.entries[0].id }, a)
    assert.equal(planTrace.found, true)
    assert.equal(planTrace.entry.id, planEntries.entries[0].id)
    assert.match(JSON.stringify(planTrace), /PLAN\.md|Fixture checkpoint/u)
    const foreignPlan = await call('memory.plan.expand', { tag: 'type:dead-end' }, b)
    assert.equal(foreignPlan.entries.length, 0)
    const currentPlan = JSON.parse(await call('memory.read', { kind: 'plan' }, a))
    const archivedPlanIds = ['d', 'e'].map(letter => 'mem_' + letter.repeat(32))
    const originalPlan = [
      '# PLAN', '', '## Retained whiteboard card', `<!-- memory:${archivedPlanIds[0]} -->`,
      'Retain this project conclusion with its original identity.', '',
      '## Intentionally archived whiteboard card', `<!-- memory:${archivedPlanIds[1]} -->`,
      'Archive this card explicitly through the authorized terminal operation.', '',
    ].join('\n')
    await write('board.plan.update', { expectedRevision: currentPlan.revision, content: originalPlan })
    const planWithCards = JSON.parse(await call('memory.read', { kind: 'plan' }, a))
    assert.equal(planWithCards.cards.length, 2)
    assert.deepEqual(planWithCards.cards.map(card => card.id), archivedPlanIds)
    const retainedPlan = '# PLAN\n\n' + planWithCards.cards[0].text
    const archivePlanArgs = {
      expectedRevision: planWithCards.revision,
      content: retainedPlan,
      archivedIds: [archivedPlanIds[1]],
    }
    await rejected('board.plan.update', archivePlanArgs, a, [], 3, 'confirmation-required')
    const archived = await write('board.plan.update', archivePlanArgs)
    assert.equal(archived.receipt.state, 'finished')
    const planAfterArchive = JSON.parse(await call('memory.read', { kind: 'plan' }, a))
    assert.deepEqual(planAfterArchive.cards.map(card => card.id), [archivedPlanIds[0]])

    const { eventStorePre, EVENT_STORE_FILENAME } = await import(pathToFileURL(join(plugin, 'lib', 'event-store.js')))
    const storePath = join(state.projectDir, 'handoff', EVENT_STORE_FILENAME)
    const event = await eventStorePre.create(storePath, { name: 'Synthetic log attribution fixture' })
    const storeBefore = await readFile(storePath)
    const logBefore = await readIfPresent(state.logPath)
    const preflight = await call('memory.log.preflight', {
      note: 'Synthetic attribution preview for this session', eventId: event.id,
    })
    assert.match(preflight, /\[dryRun\]/u)
    assert.deepEqual(await readFile(storePath), storeBefore)
    assert.deepEqual(await readIfPresent(state.logPath), logBefore)
    await rejected('memory.log.preflight', {
      note: 'A preflight must not append a log', dryRun: false,
    }, a, [], 2, 'invalid-input')

    const eventsA = await call('memory.recall.scoped', { scope: 'events', query: '' }, a)
    const eventsB = await call('memory.recall.scoped', { scope: 'events', query: '' }, b)
    assert.match(eventsA, /Synthetic log attribution fixture/u)
    assert.doesNotMatch(eventsB, /Synthetic log attribution fixture/u)

    const afterRecall = await call('memory.source', { path: a.file })
    const retract = await write('memory.note.retract', {
      expectedNotesPath: a.file,
      expectedRevision: afterRecall.revision,
      retract: [ids[0]],
      retractReason: 'Final package lifecycle verification',
    })
    assert.equal(retract.result.changed, true)
    assert.match((await call('memory.source', { path: a.file })).content, /dsh-status: retracted/u)
    const afterRetract = await call('memory.source', { path: a.file })
    const repeatedRetract = await write('memory.note.retract', {
      expectedNotesPath: a.file,
      expectedRevision: afterRetract.revision,
      retract: [ids[0]],
      retractReason: 'Final package lifecycle verification',
    })
    assert.equal(repeatedRetract.result.changed, false)

    const beforeSupersede = await call('memory.source', { path: a.file })
    const supersede = await write('memory.note.supersede', {
      expectedNotesPath: a.file,
      expectedRevision: beforeSupersede.revision,
      supersedes: [ids[1]],
      successorId: ids[2],
    })
    assert.equal(supersede.result.changed, true)
    assert.match((await call('memory.source', { path: a.file })).content,
      new RegExp('dsh-status: superseded by=' + ids[2]))
    const beforeRestore = await call('memory.source', { path: a.file })
    await rejected('memory.note.restore', {
      expectedNotesPath: a.file,
      expectedRevision: beforeRestore.revision,
      restore: [ids[0], ids[1]],
    }, a, [], 3, 'confirmation-required')
    const restored = await write('memory.note.restore', {
      expectedNotesPath: a.file,
      expectedRevision: beforeRestore.revision,
      restore: [ids[0], ids[1]],
    })
    assert.equal(restored.result.changed, true)
    const restoredNote = await call('memory.source', { path: a.file })
    assert.equal(restoredNote.revision, restored.result.revision)
    assert.doesNotMatch(restoredNote.content, /dsh-status: (?:retracted|superseded)/u)
    const restoredAgain = await write('memory.note.restore', {
      expectedNotesPath: a.file,
      expectedRevision: restoredNote.revision,
      restore: [ids[0], ids[1]],
    })
    assert.equal(restoredAgain.result.changed, false)
    assert.equal(restoredAgain.result.revision, restoredNote.revision)
    assert.equal(await digest(b.file), otherBefore)
    report('final package memory note and recall actions', {
      replacementCas: true, expansionWorkspaceScoped: true, logPreflightDryRun: true,
      eventRecallWorkspaceScoped: true, planProjectionRead: true, planExpandAndTrace: true,
      retract: true, supersede: true, restore: true, archivedIds: true, foreignNoteUnchanged: true,
    })
  }

  async function storage() {
    const a = await workspace('project-storage-A')
    const b = await workspace('project-storage-B')
    await mkdir(dirname(a.file), { recursive: true })
    await mkdir(dirname(b.file), { recursive: true })
    await writeFile(a.file, noteText('a', 'Quartz aster seed') + '\n' + noteText('c', 'Cobalt fern retained'))
    await writeFile(b.file, noteText('b', 'Topaz heron private synthetic seed'))
    const scan = scope => call(backend.scan, {}, scope)
    const source = (result, file) => {
      assert.equal(result.indexEnabled, true)
      return result.sources.find(row => row.file === file)
    }
    const repair = async (scope, files) => (await write(backend.repair, { items: files.map(file => ({ file })) }, scope)).result
    const indexFile = file => {
      const absolute = resolve(file).replaceAll('\\', '/')
      const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
      return join(home, 'memory', 'index', 'files', sha256(key) + '.json')
    }
    const readIndex = async file => JSON.parse(await readFile(indexFile(file), 'utf8'))
    const firstA = await scan(a)
    const firstB = await scan(b)
    for (const [scope, snapshot] of [[a, firstA], [b, firstB]]) {
      const row = snapshot.sources.find(item => item.kind === 'workspace')
      assert.ok(row?.file, JSON.stringify(snapshot))
      inside(home, row.file)
      assert.equal(await realpath(row.file), await realpath(scope.file), JSON.stringify({ terminal: row.file, web: scope.file }))
      scope.file = row.file
    }
    assert.equal(source(firstA, a.file)?.status, 'stale')
    assert.equal(source(firstB, b.file)?.status, 'stale')
    assert.ok(source(firstA, a.file).reasons.includes('sidecar-missing'))
    assert.equal(source(firstA, b.file), undefined)
    assert.equal(source(firstB, a.file), undefined)
    await web('state', { query: { ws: a.workspace } })
    const webScan = await web('storage-manage', { body: { action: 'scan' } })
    assert.deepEqual(webScan.sources, firstA.sources)
    assert.deepEqual(webScan.counts, firstA.counts)
    assert.equal((await repair(a, [a.file])).repaired, 1)
    assert.equal((await repair(b, [b.file])).repaired, 1)
    const beforeEdit = await digest(a.file)
    const indexBeforeEdit = await digest(indexFile(a.file))
    const otherIndex = await digest(indexFile(b.file))
    const body = (await readFile(a.file, 'utf8')).replace('Quartz aster seed', 'Quartz aster changed by isolated editor')
    await writeFile(a.file, body)
    const afterEdit = await digest(a.file)
    const otherDigest = await digest(b.file)
    const stale = await scan(a)
    assert.ok(source(stale, a.file).reasons.includes('stale-source'))
    assert.equal(await digest(a.file), afterEdit)
    assert.equal(await digest(indexFile(a.file)), indexBeforeEdit, 'scan did not update the stale sidecar')

    const outsideFile = join(a.workspace, 'not-in-corpus.md')
    await writeFile(outsideFile, noteText('d', 'Project directory outside memory corpus'))
    const outsideDigest = await digest(outsideFile)
    for (const forbidden of [b.file, outsideFile]) {
      await rejected(backend.repair, { items: [{ file: a.file }, { file: forbidden }] }, a,
        approve(), 3, 'source-forbidden')
      await rejected(backend.delete, { filePath: forbidden, memoryId: memoryId('b'), expectedDigest: otherDigest }, a,
        approve(), 3, 'source-forbidden')
    }
    assert.equal(source(await scan(a), a.file)?.status, 'stale', 'mixed repair must reject before repairing A')
    assert.equal(await digest(b.file), otherDigest)
    assert.equal(await digest(outsideFile), outsideDigest)
    assert.equal(await digest(indexFile(a.file)), indexBeforeEdit)
    assert.equal(await digest(indexFile(b.file)), otherIndex)

    const repaired = await repair(a, [a.file])
    assert.equal(repaired.repaired, 1)
    const healthy = await scan(a)
    assert.equal(source(healthy, a.file)?.status, 'ok')
    assert.ok(healthy.audit.some(row => row.action === 'repair' && row.repaired === 1))
    assert.equal(await digest(a.file), afterEdit)
    assert.equal((await readIndex(a.file)).fileDigest, afterEdit)
    const repairedIndex = await digest(indexFile(a.file))
    const repairDescriptor = manifest.operations.find(op => op.id === backend.repair)
    if (repairDescriptor.inputSchema.required?.includes('items')) {
      await rejected(backend.repair, {}, a, approve(), 2, 'invalid-input')
      const webAutoRepair = await web('storage-manage', { body: { action: 'repair' } })
      assert.equal(webAutoRepair.ok, true)
      report('automatic stale repair parity gap', { terminalRequiresItems: true, terminalExit: 2, webAcceptsOmittedItems: true })
    } else {
      await writeFile(b.file, (await readFile(b.file, 'utf8')).replace('Topaz heron', 'Topaz finch'))
      const editedB = await digest(b.file)
      assert.equal(source(await scan(b), b.file)?.status, 'stale')
      const result = (await write(backend.repair, {}, b)).result
      assert.equal(result.repaired, 1)
      assert.equal(source(await scan(b), b.file)?.status, 'ok')
      assert.equal((await readIndex(b.file)).fileDigest, editedB)
      assert.equal(await digest(b.file), editedB)
      assert.equal(await digest(indexFile(a.file)), repairedIndex)
      report('automatic stale repair', { repaired: result.repaired, scope: 'B', bodySha256: editedB, otherIndexUnchanged: true })
    }
    report('storage scan and repair', { reasons: source(stale, a.file).reasons, repaired: repaired.repaired,
      invalidated: repaired.invalidated, health: source(healthy, a.file).status, bodySha256: afterEdit,
      outOfScopeSha256: [otherDigest, outsideDigest], foreignAndOutOfCorpusExit: 3 })
    const deleteInput = { filePath: a.file, memoryId: memoryId('a'), expectedDigest: beforeEdit }
    await businessRejection(backend.delete, deleteInput, a, 'conflict-external-edit')
    assert.equal(await digest(a.file), afterEdit)
    assert.equal(source(await scan(a), a.file)?.status, 'ok')
    await businessRejection(backend.delete, { ...deleteInput, memoryId: memoryId('f'), expectedDigest: afterEdit }, a, 'not-found')
    assert.equal(await digest(a.file), afterEdit)
    assert.equal(await digest(indexFile(a.file)), repairedIndex)
    const otherBeforeDelete = await digest(b.file)
    const deleted = await write(backend.delete, { ...deleteInput, expectedDigest: afterEdit }, a)
    assert.equal(deleted.result.ok, true)
    assert.ok(deleted.result.removed.includes(memoryId('a')))
    assert.equal((await receipt(deleted.requestId, a)).result.ok, true)
    const text = await readFile(a.file, 'utf8')
    assert.doesNotMatch(text, /Quartz aster/)
    assert.match(text, /Cobalt fern retained/)
    assert.equal(source(await scan(a), a.file)?.status, 'ok')
    assert.equal(await digest(b.file), otherBeforeDelete)
    const afterDelete = await digest(a.file)
    const indexed = await readIndex(a.file)
    assert.equal(indexed.fileDigest, afterDelete)
    assert.deepEqual(indexed.records.map(row => row.memoryId), [memoryId('c')])
    report('storage CAS and indexed delete', { beforeEdit, afterEdit, afterDelete, otherBeforeDelete, indexedRecords: indexed.records.length })
  }

  async function migration() {
    const uploads = join(home, 'exports', 'dsh-auto-memory', 'uploads')
    const badPack = join(root, 'malformed.dam-pack')
    await writeFile(badPack, 'not a migration package\n')
    const invalid = await rejected(backend.stage, { packPath: badPack }, null, approve(), 2, 'operation-rejected')
    assert.match(invalid.message, /pack-not-json/)
    assert.deepEqual(await readdir(uploads), [])
    await rejected(backend.stage, { packPath: 'relative.dam-pack' }, null, approve(), 2, 'invalid-pack-name')

    // Give the source and destination distinct bodies, independent of the storage test.
    const sourceText = noteText('e', 'Migration citrine source with Chinese text 迁移来源')
    const targetText = noteText('f', 'Migration garnet target before preview')
    for (const [scope, text] of [[a, sourceText], [b, targetText]]) {
      await mkdir(dirname(scope.file), { recursive: true })
      await writeFile(scope.file, text)
    }
    const sourceBefore = await digest(a.file)
    const targetBefore = await digest(b.file)

    const exported = await write(backend.export, { outPath: join(root, 'storage-proof.dam-pack.gz'), compress: true })
    assert.equal(exported.result.ok, true)
    const packPath = inside(root, exported.result.path)
    const staged = await write(backend.stage, { packPath }, null)
    assert.equal(staged.result.ok, true)
    const stagedPath = inside(uploads, staged.result.path)
    const content = await readFile(packPath)
    assert.equal(staged.result.bytes, content.length)
    assert.equal(await digest(stagedPath), sha256(content))
    assert.equal((await receipt(staged.requestId, null)).result.path, stagedPath)
    assert.equal(await digest(b.file), targetBefore)

    const browserStage = await fetch(new URL('/api/dsh-auto-memory/migrate-upload?name=storage-proof.dam-pack.gz', connection.origin), {
      method: 'POST',
      headers: { cookie: connection.browserCookie, 'content-type': 'application/octet-stream' },
      body: content, signal: AbortSignal.timeout(9000),
    })
    assert.equal(browserStage.status, 200)
    const webStage = await browserStage.json()
    assert.equal(webStage.bytes, staged.result.bytes)
    assert.equal(await digest(inside(uploads, webStage.path)), sha256(content))

    const args = { packPath: stagedPath, onConflict: 'overwrite' }
    const inspect = async () => {
      const view = await call(backend.inspect, args, b)
      assert.ok(view.ok)
      assert.match(view.previewToken, /^[a-f0-9]{64}$/u)
      assert.ok(view.plan.overwrites.some(row => row.path === basename(b.file)))
      assert.equal(await realpath(view.plan.target.ws), await realpath(b.workspace))
      return view
    }
    const initial = await inspect()
    const keep = await call(backend.inspect, { ...args, onConflict: 'keep' }, b)
    assert.equal(keep.ok, true)
    assert.equal(keep.plan.overwrites.length, 0)
    assert.notEqual(keep.previewToken, initial.previewToken)
    const browserView = await web('migrate-inspect', { body: { ...args, targetWs: initial.plan.target.ws } })
    assert.equal(browserView.previewToken, initial.previewToken)
    assert.deepEqual(browserView.plan, initial.plan)
    assert.equal(await digest(b.file), targetBefore)
    assert.equal(await businessRejection(backend.import, { ...args, previewToken: initial.previewToken }, a, 'preview-stale'), 5)
    assert.equal(await digest(a.file), sourceBefore)
    assert.equal(await digest(b.file), targetBefore)

    const edited = targetText.replace('before preview', 'changed after preview')
    await writeFile(b.file, edited)
    const targetEdited = await digest(b.file)
    const staleExit = await businessRejection(backend.import, { ...args, previewToken: initial.previewToken }, b, 'preview-stale')
    assert.equal(await digest(b.file), targetEdited)
    assert.equal(await digest(a.file), sourceBefore)
    const fresh = await inspect()
    assert.notEqual(fresh.previewToken, initial.previewToken)
    await rejected(backend.import, { ...args, previewToken: fresh.previewToken }, b, [], 3, 'confirmation-required')
    const imported = await write(backend.import, { ...args, previewToken: fresh.previewToken }, b)
    assert.equal(imported.result.ok, true)
    assert.ok(imported.result.written > 0)
    assert.ok(imported.result.writtenFiles.some(row => row.path === basename(b.file)))
    assert.equal(await digest(join(inside(home, imported.result.backup), basename(b.file))), targetEdited)
    assert.equal((await receipt(imported.requestId, b)).result.ok, true)
    assert.equal(await digest(b.file), sourceBefore)
    assert.equal(await digest(a.file), sourceBefore)
    const source = await web('file', { query: { path: b.file, sessionId: b.sessionId } })
    assert.equal(sha256(source.content), sourceBefore)
    report('migration stage inspect import', {
      packBytes: content.length, packSha256: sha256(content), invalidStageExit: 2, invalidStageCleaned: true,
      staleExit, targetBefore, targetEdited, backupSha256: targetEdited, importedSha256: sourceBefore,
      legacyUploadAndInspectMatch: true, sourcePreserved: true, crossTargetTokenExit: 5,
      keepPreviewOverwrites: keep.plan.overwrites.length, written: imported.result.written,
    })
  }

  async function boardPagination() {
    const { eventStorePre, EVENT_STORE_FILENAME, readStorePre, writeStorePre } = await import(pathToFileURL(join(plugin, 'lib', 'event-store.js')))
    const scopes = [
      await workspace('project-board-A'),
      await workspace('project-board-B'),
    ]
    const ledgers = ['## 任务状态', '- 进行中', '## 目标', '- 回归分页',
      '## 已试方案与失败原因', '- 暂无', '## 进度与下一步', '- 对照原文'].join('\n')
    const count = [5, 2]
    for (const [index, scope] of scopes.entries()) {
      const handoff = join(dirname(scope.file), 'handoff')
      await mkdir(handoff, { recursive: true })
      const store = join(handoff, EVENT_STORE_FILENAME)
      for (let number = 1; number <= count[index]; number++) {
        const event = await eventStorePre.create(store, { name: `Project ${index}, event ${number}` })
        if (number === 2) await eventStorePre.close(store, event.id, 'Synthetic outcome')
        await writeFile(join(handoff, `handoff-20261126-10000${number}.md`), ledgers)
      }
      await writeFile(join(handoff, 'unrelated.md'), '# Unrelated document\n')
    }

    for (const [index, scope] of scopes.entries()) {
      const [listed, pending] = [
        { operation: 'board.events.list', route: 'event-list', field: 'events', key: 'id' },
        { operation: 'board.events.unarchived', route: 'event-unarchived', field: 'items', key: 'rel' },
      ]
      for (const { operation, route, field, key } of [listed, pending]) {
        const ids = []
        let cursor = 0
        do {
          const page = await call(operation, { cursor, limit: 2 }, scope)
          const browser = await web(route, { query: { sessionId: scope.sessionId, cursor, limit: 2 } })
          assert.deepEqual(page, browser)
          assert.equal(page.total, count[index])
          ids.push(...page[field].map(row => row[key]))
          cursor = page.nextCursor
        } while (cursor !== null && ids.length <= count[index])
        assert.equal(cursor, null)
        assert.equal(new Set(ids).size, count[index])
      }
      const all = await call('board.events.list', { all: 1, limit: 1 }, scope)
      const closed = await call('board.events.list', { status: 'closed' }, scope)
      assert.equal(all.events.length, count[index])
      assert.equal(all.nextCursor, null)
      assert.ok(all.events.every(event => event.name.startsWith(`Project ${index},`)))
      assert.deepEqual(all, await web('event-list', { query: { sessionId: scope.sessionId, all: 1, limit: 1 } }))
      assert.equal(closed.events.length, 1)
      assert.equal(closed.events[0].status, 'closed')
      assert.deepEqual(closed, await web('event-list', { query: { sessionId: scope.sessionId, status: 'closed' } }))
    }
    await web('event-unarchived', { status: 400, query: { sessionId: 'no-registered-session' } })
    report('board event and unarchived ledger pagination', { counts: count, pageSize: 2,
      webEqualsCli: true, closedFilter: true, missingSessionStatus: 400 })
    const scope = scopes[0]
    const store = join(dirname(scope.file), 'handoff', EVENT_STORE_FILENAME)
    const seeded = await readStorePre(store)
    const sample = seeded.events.find(row => row.status === 'active')
    for (let index = 0; index < 128; index++) {
      const id = 'evt_' + (0x40000000 + index).toString(16)
      const updatedAt = Date.UTC(2026, 10, 16, index)
      seeded.events.push({ ...sample, id, name: 'P7 large-set event ' + index, updatedAt, createdAt: updatedAt })
    }
    await writeStorePre(store, seeded)
    const actual = []
    let cursor = 0
    do {
      const page = await call('board.events.list', { cursor, limit: 40 }, scope)
      assert.equal(page.total, 133)
      actual.push(...page.events.map(row => row.id))
      cursor = page.nextCursor
    } while (cursor !== null)
    const webAll = await web('event-list', { query: { sessionId: scope.sessionId, all: 1 } })
    assert.deepEqual(actual, webAll.events.map(row => row.id))
    assert.equal(new Set(actual).size, 133)
    assert.equal((await call('board.events.list', { all: 1 }, scopes[1])).events.length, 2)
    report('real Desktop large board cursor sequence', { events: actual.length, pageSize: 40,
      sameOrderAsWeb: true, unique: true, otherWorkspaceIndependent: true })
  }

  async function boardActions() {
    const created = await write('board.events.create', {
      name: 'Final package event lifecycle',
      summary: 'Created through the installed terminal contract',
      sections: { goal: 'Verify final package mutations' },
      kind: 'project',
      confidence: 'high',
    })
    const initial = await call('board.events.detail', { id: created.result.eventId })
    assert.equal(initial.revision, created.result.revision)
    assert.equal(initial.event.name, 'Final package event lifecycle')

    const updated = await write('board.events.set', {
      eventId: created.result.eventId,
      expectedRevision: initial.revision,
      status: 'paused',
      pausedReason: 'Awaiting checkpoint',
      summary: 'Updated through the installed terminal contract',
      sections: { doing: 'Running the real Desktop check' },
    })
    const afterUpdate = await call('board.events.detail', { id: created.result.eventId })
    assert.equal(afterUpdate.revision, updated.result.revision)
    assert.equal(afterUpdate.event.status, 'paused')
    assert.equal(afterUpdate.event.sections.doing, 'Running the real Desktop check')

    const appended = await write('board.events.append', {
      eventId: created.result.eventId,
      expectedRevision: afterUpdate.revision,
      checkpoint: {
        kind: 'progress', text: 'Installed package checkpoint', goal: 'Exercise event append',
        state: 'Desktop accepted the operation', dead: '', next: 'Rename and close',
        quoteLine: 1, rel: 'MEMORY.md', bytes: 16, sha256: 'a'.repeat(64),
        idemKey: 'final-package-event-checkpoint',
      },
    })
    const afterAppend = await call('board.events.detail', { id: created.result.eventId })
    assert.equal(afterAppend.revision, appended.result.revision)
    assert.equal(afterAppend.event.checkpoints[0].text, 'Installed package checkpoint')

    const renamed = await write('board.events.rename', {
      eventId: created.result.eventId,
      expectedRevision: afterAppend.revision,
      name: 'Final package event lifecycle verified',
    })
    const afterRename = await call('board.events.detail', { id: created.result.eventId })
    assert.equal(afterRename.revision, renamed.result.revision)
    assert.equal(afterRename.event.name, 'Final package event lifecycle verified')

    const closed = await write('board.events.close', {
      eventId: created.result.eventId,
      expectedRevision: afterRename.revision,
      outcome: 'Final package event lifecycle passed',
    })
    const final = await call('board.events.detail', { id: created.result.eventId })
    assert.equal(final.revision, closed.result.revision)
    assert.equal(final.event.status, 'closed')
    assert.equal(final.event.outcome, 'Final package event lifecycle passed')

    report('final package event lifecycle', {
      operations: ['create', 'detail', 'set', 'append', 'rename', 'close'],
      receiptsFinished: true,
      revisionReadback: true,
      finalStatus: final.event.status,
    })
  }

  async function settingsRootMigration() {
    const original = await call('settings.get')
    const projectRoot = inside(home, original.config.memoryRoot)
    const userRoot = inside(home, original.config.userMemoryDir)
    const nextProjectRoot = join(home, 'terminal-migrated-workspaces')
    const nextUserRoot = join(home, 'terminal-migrated-user-memory')
    const projectFiles = [a.file, b.file]
    for (const [index, file] of projectFiles.entries()) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, noteText(index === 0 ? 'd' : 'e', 'Synthetic root migration ' + (index + 1)))
    }
    const userFile = join(userRoot, 'summaries', 'isolated.md')
    await mkdir(dirname(userFile), { recursive: true })
    await writeFile(userFile, 'Isolated user summary 遷移\n')

    const files = [...projectFiles, userFile]
    const before = await Promise.all(files.map(digest))
    const patch = { memoryRoot: nextProjectRoot, userMemoryDir: nextUserRoot }
    const request = { revision: original.revision, patch }
    await rejected(backend.settings, request, a, [], 3, 'confirmation-required')
    for (const directory of Object.values(patch)) await assert.rejects(stat(directory), { code: 'ENOENT' })
    const { result: saved } = await write(backend.settings, request)
    assert.match(saved.migration, /memoryRoot:/u)
    assert.match(saved.migration, /userMemoryDir:/u)
    assert.notEqual(saved.revision, original.revision)
    const newConfig = (await web('config')).config
    assert.equal(newConfig.memoryRoot, nextProjectRoot)
    assert.equal(newConfig.userMemoryDir, nextUserRoot)
    assert.equal((await call('settings.get')).revision, saved.revision)
    assert.equal((await shell(a, ['doctor'])).identity.instanceId, doctor.identity.instanceId)

    const migrated = [
      ...projectFiles.map(file => join(nextProjectRoot, relative(projectRoot, file))),
      join(nextUserRoot, relative(userRoot, userFile)),
    ]
    assert.deepEqual(await Promise.all(migrated.map(digest)), before)
    assert.deepEqual(await Promise.all(files.map(digest)), before)
    for (const [index, scope] of [a, b].entries()) {
      const state = await web('state', { query: { sessionId: scope.sessionId, ws: scope.workspace } })
      assert.equal(await realpath(state.notesPath), await realpath(migrated[index]))
      const content = await call('memory.read', { kind: 'notes' }, scope)
      assert.match(content, new RegExp('Synthetic root migration ' + (index + 1)))
    }
    await rejected(backend.settings, request, a, approve(), 5, 'settings-version-conflict')
    report('settings root migration', { migrated: migrated.length, unchangedInstance: true,
      sourcePreserved: true, hashes: before, staleExit: 5 })
  }

  async function reflectionAndDirtyScan() {
    const scopes = [
      await workspace('project-reflection-A'),
      await workspace('project-reflection-B'),
    ]
    const date = '2026-11-20'
    const manualDate = '2026-11-19'
    for (const [index, scope] of scopes.entries()) {
      await mkdir(dirname(scope.file), { recursive: true })
      await writeFile(scope.file, ('scope-' + index + ' note repeated\n').repeat(3))
      await writeFile(join(dirname(scope.file), date + '.md'), '# Isolated log\n- Reflection source ' + index + '\n')
    }
    for (const [index, scope] of scopes.entries()) {
      const manual = await write('memory.reflection.save', { date: manualDate, text: 'Manual reflection ' + index }, scope)
      assert.match(manual.result.result, /已保存反思/u)
      const auto = await write('memory.reflection.generate', {}, scope)
      assert.match(auto.result.result, /已保存反思/u)
      const reflection = await call('memory.read', { kind: 'reflection', date }, scope)
      assert.match(reflection, new RegExp('Reflection source ' + index))
      assert.doesNotMatch(reflection, new RegExp('Reflection source ' + (1 - index)))
      const report = await call('memory.storage.dirty', {}, scope)
      const found = report.files.find(row => row.file === scope.file)
      assert.ok(found && found.findings.some(finding => finding.type.includes('重复内容行')), JSON.stringify(report.files))
      assert.ok(!report.files.some(row => row.file === scopes[1 - index].file))
    }
    report('reflection and dirty scan in two cold workspaces', { manual: true, generated: true, exactFile: true, foreign: false })
  }

  const scenarios = { settings, externalUserSource, workspaceAliases, storage, migration, boardPagination, boardActions,
    settingsRootMigration, reflectionAndDirtyScan }
  async function conptyStorage() {
    const project = await workspace('project-conpty-storage')
    const foreign = await workspace('project-conpty-unrelated')
    const retained = noteText('c', 'Keep the cobalt fixture')
    for (const scope of [project, foreign]) await mkdir(dirname(scope.file), { recursive: true })
    await writeFile(project.file, noteText('a', 'Remove only the amber fixture') + '\n' + retained)
    await writeFile(foreign.file, noteText('b', 'Unaffected unrelated fixture'))
    const originalDigest = await digest(project.file)
    const foreignDigest = await digest(foreign.file)
    const scopedFile = (await call(backend.scan, {}, project)).sources.find(row => row.kind === 'workspace')?.file
    assert.equal(await realpath(scopedFile), await realpath(project.file))
    const env = { ...environment(root, home), PYTHONUTF8: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    for (const name of ['PYTHONPATH', 'DAM_TUI_ARTIFACT_DIR']) {
      if (process.env[name]) env[name] = process.env[name]
    }
    const args = ['-B', join(repo, 'tests', 'live', 'auto-memory-tui-pty.py'),
      '--storage', JSON.stringify({ filePath: scopedFile, memoryId: memoryId('a'), expectedDigest: originalDigest }),
      '--', process.execPath, entry, '--dsh-home', home, '--profile', 'desktop',
      '--session', project.sessionId, '--workspace', project.workspace]
    const output = await collectProcess('python', args, { env, cwd: root })
    assert.equal(output.code, 0, output.stderr)
    assert.match(output.stdout, /ConPTY storage passed/)
    const body = await readFile(project.file, 'utf8')
    assert.match(body, /Keep the cobalt fixture/)
    assert.doesNotMatch(body, /Remove only the amber fixture/)
    assert.equal(await digest(foreign.file), foreignDigest)
    const after = await call(backend.scan, {}, project)
    assert.equal(after.sources.find(row => row.file === scopedFile)?.status, 'ok')
    assert.ok(after.audit.some(row => row.action === 'repair' && row.repaired === 1))
    report('ConPTY storage in installed Desktop', { scan: true, repair: true, delete: true,
      beforeSha256: originalDigest, afterSha256: await digest(project.file), foreignSha256: foreignDigest })
  }

  const selectedScenarios = conptyOnly ? { conptyStorage }
    : externalUserOnly ? { externalUserSource }
      : memoryActionsOnly ? { memoryTerminalActions } : scenarios
  for (const [name, check] of Object.entries(selectedScenarios)) {
    try {
      await check()
      report('passed', { section: name })
    } catch (error) {
      console.error(name + ' failed:', error)
      process.exitCode = 1
    }
  }
}

async function runTeamChecks() {
  for (const role of ['administrator', 'viewer']) {
    const scenario = join(root, role)
    const home = await prepare(scenario, plugin)
    const configPath = join(home, 'dsh-auto-memory.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    await writeFile(configPath, JSON.stringify({
      ...config, teamEnabled: true, teamMemberId: 'synthetic-' + role, teamMemberRole: role,
      teamId: 'isolated-team', teamSyncTransport: 'http', teamUpgradePhase: 'planning',
      teamServerUrl: '', teamEndpoint: '',
    }))
    const host = startDesktop(scenario, home)
    try {
      const { url: launch } = await host.ready()
      const connection = await authenticate(launch)
      const web = (id, options) => pluginRequest(connection, id, options)
      function invoke(id, input, flags = [], expectedExit = 0) {
        return cli(scenario, home, {}, ['--dsh-home', home, '--profile', 'desktop', 'api', 'call', id, ...flags],
          launch, { entry, input, expectedExit })
      }
      const state = await invoke('team.status')
      const diagnostics = await invoke('team.sync.diagnostics')
      const webState = await web('team-state')
      assert.equal(state.enabled, true)
      assert.equal(state.member.role, role)
      assert.equal(webState.member.role, role)
      assert.equal(diagnostics.transportReady, webState.transport.ready)
      assert.equal(diagnostics.transportReady, false)
      assert.deepEqual(await invoke('team.baseline.status'), await web('team-baseline'))
      const settings = await invoke('settings.get')
      const request = { revision: settings.revision, patch: { teamShowMemberBadges: false } }

      if (role === 'viewer') {
        const before = await digest(configPath)
        assert.equal((await invoke('settings.set', request, approve(), 3)).error.code, 'team-forbidden')
        assert.equal(await digest(configPath), before)
        assert.equal((await invoke('settings.get')).revision, settings.revision)
        report('team viewer policy', { role, canRead: true, settingWriteExit: 3, configUnchanged: true })
        continue
      }

      const changed = await invoke('settings.set', request, approve())
      assert.equal(changed.result.config.teamShowMemberBadges, false)
      assert.equal((await web('config')).config.teamShowMemberBadges, false)
      const shortPause = await invoke('team.pause.runtime', { paused: true }, approve())
      assert.equal(shortPause.result.paused, true)
      assert.equal((await web('team-state')).paused, true)
      assert.equal(JSON.parse(await readFile(configPath, 'utf8')).teamPaused, false)
      await invoke('team.pause.runtime', { paused: false }, approve())

      const paused = await invoke('team.pause', { paused: true, reason: 'Isolated upgrade' }, approve())
      assert.deepEqual(paused.result, { ok: true, paused: true, reason: 'Isolated upgrade' })
      const before = await digest(configPath)
      const failure = await invoke('team.pause', { paused: false }, approve(), 5)
      assert.equal(failure.error.message, 'upgrade-in-progress')
      assert.equal(failure.error.details?.canResume, false)
      assert.equal(failure.error.details?.paused, true)
      assert.equal(await digest(configPath), before)
      assert.equal((await web('team-state')).pausedReason, 'Isolated upgrade')
      report('team administrator policy', { role, settingsChanged: true, runtimePauseEphemeral: true,
        persistentPause: true, resumeWhileUpgradingExit: 5, configUnchangedAfterRejection: true })
    } finally {
      await host.stop()
    }
  }
}

async function runRemoteTeamChecks() {
  const teamId = 'isolated-terminal-team'
  const token = 'terminal-team-loopback-fixture'
  const received = []
  const denied = []
  let available = false
  const remoteServer = createServer(async (request, response) => {
    const reply = (status, data) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data))
    if (request.headers.authorization !== 'Bearer ' + token || request.headers['x-dam-team'] !== teamId) {
      denied.push({ method: request.method, headerPresent: typeof request.headers.authorization === 'string' })
      reply(401, { ok: false })
      return
    }
    if (request.method === 'GET') {
      reply(200, { ok: true, cursor: 0, changes: [] })
      return
    }
    if (request.method !== 'POST' || request.url !== '/api/team/sync/push') {
      reply(404, { ok: false })
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    received.push({ body, delivered: available })
    reply(available ? 200 : 503, { ok: available })
  })
  remoteServer.listen(0, '127.0.0.1')
  await once(remoteServer, 'listening')
  let host
  try {
    const origin = 'http://127.0.0.1:' + remoteServer.address().port
    const home = await prepare(root, plugin)
    const configPath = join(home, 'dsh-auto-memory.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    await writeFile(configPath, JSON.stringify({ ...config, teamEnabled: true, teamId, teamToken: token,
      teamMemberId: 'isolated-admin', teamMemberRole: 'administrator', teamServerUrl: origin, teamEndpoint: origin,
      teamSyncTransport: 'http', teamUpgradePhase: 'idle', teamSyncIntervalMs: 400 }))
    host = startDesktop(root, home)
    const { url: launch } = await host.ready()
    const connection = await authenticate(launch)
    const workspacePath = join(root, 'team-workspace')
    const scope = await createWorkspace(connection, workspacePath)
    const run = (id, input, flags = [], scoped = false, expectedExit = 0) => cli(root, home, scoped ? scope : null,
      [...(scoped ? ['--workspace', workspacePath, '--session', scope.sessionId] : []), 'api', 'call', id, ...flags],
      launch, { entry, input, expectedExit })
    const waitFor = async check => {
      const deadline = Date.now() + 18000
      do {
        if (await check()) return
        await new Promise(resolve => setTimeout(resolve, 250))
      } while (Date.now() < deadline)
      assert.fail('Team transport did not reach the expected state')
    }
    const event = await run('board.events.create', { name: 'Isolated team event for terminal' }, approve(), true)
    assert.ok(event.result.eventId)
    try {
      await waitFor(() => received.some(row => row.body.key === event.result.eventId && !row.delivered))
    } catch (error) {
      const { outbox, sync, transport } = await pluginRequest(connection, 'team-state')
      report('team sync fixture diagnostics', { outbox, sync, transport, denied: denied.slice(-4) })
      throw error
    }
    await waitFor(async () => {
      const cliState = await run('team.sync.diagnostics')
      return cliState.outbox?.size > 0 && cliState.sync?.hasError
    })
    const failed = await pluginRequest(connection, 'team-state')
    assert.equal((await run('team.sync.diagnostics')).transportReady, failed.transport.ready)
    assert.ok(failed.sync.lastError)
    const debug = await run('team.sync.debug')
    assert.equal(debug.enabled, true)
    assert.equal(debug.transportError, null)
    assert.match(debug.sync.lastError, /entries-failed/u)
    assert.equal(debug.identity.memberId, 'isolated-admin')
    available = true
    await waitFor(() => received.some(row => row.body.key === event.result.eventId && row.delivered))
    await waitFor(async () => (await run('team.sync.diagnostics')).outbox?.size === 0)
    const eventRequests = received.filter(row => row.body.key === event.result.eventId)
    assert.ok(eventRequests.every(row => row.body.idemKey === eventRequests[0].body.idemKey))
    assert.equal((await pluginRequest(connection, 'team-state')).outbox.size, 0)
    await run('team.pause', { paused: true, reason: 'Isolated transport test' }, approve())
    const pending = await run('board.events.create', { name: 'Isolated paused team event' }, approve(), true)
    const pausedAt = received.length
    await new Promise(resolve => setTimeout(resolve, 850))
    assert.equal(received.length, pausedAt)
    assert.ok(!received.some(row => row.body.key === pending.result.eventId))
    assert.equal((await run('team.sync.diagnostics')).outbox?.size, 1)
    const resume = await run('team.pause', { paused: false }, approve(), false, 5)
    assert.equal(resume.error.message, 'upgrade-state-unknown')
    assert.deepEqual(resume.error.details, { paused: true, canResume: false, detail: 'peer-version-unknown' })
    report('real Desktop team sync through HTTP', { networkFailure: 503, queuedAfterFailure: true, pausedSilencesPush: true,
      cliAndDebugStatus: true, retriedWhenAvailable: true, stableIdempotency: true,
      emptiedQueue: true, resumeRefusal: resume.error.details.detail })
  } finally {
    try { await host?.stop() } finally {
      remoteServer.closeAllConnections()
      await new Promise(resolve => remoteServer.close(resolve))
    }
  }
}

async function runContinuationChecks() {
  const projectMarker = 'Synthetic continuation project plan'
  const otherMarker = 'Independent other project plan'
  const userMarker = 'Synthetic initial continuation turn'
  const refreshMarker = '[接续前刷新仪式]'
  const pressureMarker = 'Synthetic model context pressure'
  const automaticMarker = 'Isolated pressure scenario'
  const model = await startMaintenanceModel({ markers: [projectMarker, otherMarker, userMarker, refreshMarker, pressureMarker, automaticMarker],
    hangMarker: refreshMarker, pressureMarker })
  let host
  try {
    const home = await prepare(root, plugin, model.origin)
    const configPath = join(home, 'dsh-auto-memory.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    await writeFile(configPath, JSON.stringify({ ...config, autoContinueRefreshRitual: false }))
    host = startDesktop(root, home, model.origin)
    const { url: launch } = await host.ready()
    const connection = await authenticate(launch)
    const web = (id, options) => pluginRequest(connection, id, options)
    const rpc = (method, args) => remote(connection.origin, method, args, connection.browserCookie)

    async function project(name, marker) {
      const workspace = join(root, name)
      const scope = { ...await createWorkspace(connection, workspace), workspace }
      const state = await web('state', { query: { sessionId: scope.sessionId, ws: workspace } })
      const directory = inside(home, join(state.projectDir, 'handoff'))
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'PLAN.md'), `# Project plan\n\n## Goal\n- ${marker}\n`)
      return scope
    }
    const a = await project('continuation-A', projectMarker)
    const b = await project('continuation-B', otherMarker)
    const pressure = await project('continuation-pressure', automaticMarker)
    async function prompt(scope, message) {
      const sent = await rpc('session/prompt', { request: {
        sessionId: scope.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: message }],
      } })
      assert.equal(sent.accepted, true)
    }
    async function waitFor(check, timeout = 14_000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const result = await check()
        if (result) return result
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.fail('DSH did not reach the expected state')
    }
    const invoke = (scope, operation, input, args = [], expectedExit = 0) => cli(root, home, scope,
      ['--workspace-ref', scope.workspaceId, '--session', scope.sessionId, 'api', 'call', operation, ...args], launch, { entry, input, expectedExit })
    if (automaticContinuationOnly) {
      await web('config', { body: { autoContinueEnabled: true, autoContinueThreshold: 0.01, autoContinueConfirmSeconds: 10 } })
      await prompt(pressure, pressureMarker)
      const armed = await waitFor(async () => (await invoke(pressure, 'board.continue.status')).armed)
      assert.equal(armed.sessionId, pressure.sessionId)
      assert.equal(armed.expiresAt - armed.edgeAt, 10_000)
      const completed = await waitFor(async () => (await invoke(pressure, 'board.continue.status')).completed, 45_000)
      assert.ok(completed.successorId && completed.successorId !== pressure.sessionId)
      const successor = { ...pressure, sessionId: completed.successorId }
      const status = await invoke(successor, 'status')
      assert.equal(status.scope.sessionId, completed.successorId)
      assert.equal(await realpath(status.scope.workspace), await realpath(pressure.workspace))
      assert.equal((await invoke(b, 'board.continue.status')).completed, null)
      await waitFor(() => model.observations.some(row => row.markers.includes(automaticMarker)))
      report('DSH automatic continuation after countdown', { countdownSeconds: 10, successorVerified: true,
        automaticDispatch: true, deliveredProjectPlan: true, crossProjectIsolated: true })
      return
    }
    await web('config', { body: { autoContinueEnabled: true, autoContinueThreshold: 0.01, autoContinueConfirmSeconds: 120 } })
    await prompt(pressure, pressureMarker)
    const armed = await waitFor(async () => (await invoke(pressure, 'board.continue.status')).armed)
    assert.equal(armed.sessionId, pressure.sessionId)
    assert.ok(armed.ratio >= 0.01)
    assert.equal((await invoke(a, 'board.continue.status')).armed, null)
    const pendingCancel = await invoke(pressure, 'board.continue.decide', { action: 'cancel', edgeAt: armed.edgeAt }, approve())
    assert.equal(pendingCancel.result.wasArmed, true)
    assert.equal((await invoke(pressure, 'board.continue.status')).armed, null)
    await web('config', { body: { autoContinueEnabled: false } })
    await prompt(a, userMarker)
    await waitFor(() => model.observations.some(row => row.markers.includes(userMarker)))
    const preview = (await invoke(a, 'board.continue.preview', {}, approve())).result
    const browserPreview = await web('handoff-continue', { body: { fromSessionId: a.sessionId } })
    for (const result of [preview, browserPreview]) {
      assert.equal(result.prevSessionId, a.sessionId)
      assert.match(result.carryText, new RegExp(projectMarker))
      assert.doesNotMatch(result.carryText, new RegExp(otherMarker))
    }

    const denyTarget = await invoke(a, 'board.continue.permissions', { successorId: b.sessionId }, approve(), 5)
    assert.ok(['workspace-mismatch', 'invalid-successor'].includes(denyTarget.error.code))
    const badEdge = await invoke(a, 'board.continue.decide', { action: 'cancel', edgeAt: 1 }, approve(), 5)
    assert.equal(badEdge.error.code, 'stale-edge')
    const decision = { action: 'manual' }
    const unapproved = await invoke(a, 'board.continue.decide', decision, [], 3)
    assert.equal(unapproved.error.code, 'confirmation-required')

    const firstNew = model.observations.length
    const approval = approve()
    const continued = await invoke(a, 'board.continue.decide', decision, approval)
    const successor = continued.result.sessionId
    assert.ok(successor && successor !== a.sessionId && successor !== b.sessionId)
    await waitFor(() => model.observations.slice(firstNew).some(row => row.markers.includes(projectMarker)))
    assert.ok(model.observations.slice(firstNew).every(row => !row.markers.includes(otherMarker)))
    assert.deepEqual(await invoke(a, 'board.continue.decide', decision, approval), continued)
    const state = await invoke(a, 'board.continue.status')
    assert.equal(state.completed.successorId, successor)
    const foreignState = await invoke(b, 'board.continue.status')
    assert.equal(foreignState.completed, null)
    assert.equal(foreignState.lastOk, null)
    assert.equal(foreignState.lastRunAt, 0)
    const cliSuccessor = await invoke({ ...a, sessionId: successor }, 'status')
    assert.equal(cliSuccessor.scope.sessionId, successor)
    assert.equal(await realpath(cliSuccessor.scope.workspace), await realpath(a.workspace))

    await web('config', { body: { autoContinueRefreshRitual: true } })
    await prompt(b, 'Prepare the second isolated project')
    const executing = invoke(b, 'board.continue.decide', decision, approve())
    executing.catch(() => {})
    const active = await waitFor(async () => (await invoke(b, 'board.continue.status')).execution?.edgeAt)
    const crossStatus = await invoke(a, 'board.continue.status')
    assert.equal(crossStatus.executing, false)
    assert.equal(crossStatus.execution, undefined)
    await waitFor(() => model.observations.some(row => row.markers.includes(refreshMarker)))
    const cancel = { action: 'cancel', edgeAt: active }
    const foreignCancel = await invoke(a, 'board.continue.decide', cancel, approve(), 5)
    assert.equal(foreignCancel.error.code, 'stale-edge')
    const cancellation = await invoke(b, 'board.continue.decide', cancel, approve())
    assert.equal(cancellation.result.cancelled, true)
    assert.equal((await executing).result.cancelled, true)
    assert.deepEqual((await invoke(b, 'board.continue.decide', cancel, approve())).result, cancellation.result)
    await waitFor(() => model.observations.some(row => row.markers.includes(refreshMarker) && row.disconnected))
    const afterCancel = await invoke(b, 'board.continue.status')
    assert.equal(afterCancel.completed, null)
    assert.equal(afterCancel.pending, null)
    assert.equal(afterCancel.lastCancel.sessionId, b.sessionId)
    assert.equal((await invoke(a, 'board.continue.status')).lastCancel, null)
    report('DSH continuation with real successor and loopback model', {
      scopedPreview: true, deliveredProjectPlan: true, successorVerified: true, receiptReplay: true,
      crossWorkspaceExit: 5, staleEdgeExit: 5, unapprovedExit: 3, modelRequests: model.observations.length,
      permissionPreset: continued.result.permissionPreset, runningCancel: true, loopbackDisconnected: true,
      duplicateCancel: true, otherWorkspacesDoNotSeeExecution: true,
      autoArmed: true, armedRatio: armed.ratio, pendingCancel: true,
    })
  } finally {
    await host?.stop()
    await model.close()
  }
}

async function runDeliveryChecks() {
  const greetingPrompt = '今天已记录的工作'
  const summaryPrompt = '写一段生活化总结'
  const greetingText = '隔离问候已从宿主模型返回。'
  const summaryText = '隔离摘要已从宿主模型返回。'
  const activityMarker = 'Isolated running turn for workspace activity'
  const noteMarkers = ['sunstone-waterfall membership Alpha', 'bluebell-summit membership Beta']
  const model = await startMaintenanceModel({
    markers: [greetingPrompt, summaryPrompt, activityMarker, ...noteMarkers],
    hangMarker: activityMarker,
    responseForPrompt: payload => {
      if (payload.includes(greetingPrompt)) return greetingText
      if (payload.includes(summaryPrompt)) return `[SUMMARY]\n${summaryText}\n[WORK] 隔离验收\n- 已读取日志\n- 已记录证据`
    },
  })
  let host
  try {
    const home = await prepare(root, plugin, model.origin)
    host = startDesktop(root, home, model.origin)
    const { url: launch } = await host.ready()
    const connection = await authenticate(launch)
    const web = (id, options) => pluginRequest(connection, id, options)
    const rpc = (method, args) => remote(connection.origin, method, args, connection.browserCookie)
    const scopes = []
    for (const [index, marker] of noteMarkers.entries()) {
      const workspace = join(root, 'delivery-project-' + index)
      const scope = { ...await createWorkspace(connection, workspace), workspace }
      const state = await web('state', { query: { ws: workspace, sessionId: scope.sessionId } })
      await web('note', { body: { sessionId: scope.sessionId, expectedNotesPath: state.notesPath, content: marker } })
      await writeFile(inside(home, state.logPath), `# Synthetic activity\n- 09:00 ${marker}\n`)
      scopes.push(scope)
    }
    const [a, b] = scopes
    const invoke = (scope, operation, input, args = []) => cli(root, home, scope,
      ['--workspace-ref', scope.workspaceId, '--session', scope.sessionId, 'api', 'call', operation, ...args], launch, { entry, input })
    const unobserved = { source: 'unobserved' }
    assert.deepEqual(await invoke(a, 'memory.delivery.receipt'), unobserved)
    assert.deepEqual(await invoke(b, 'memory.delivery.receipt'), unobserved)
    const settings = await invoke(a, 'settings.get')
    await invoke(a, 'settings.set', { revision: settings.revision, patch: { deliveryPolicy: {
      schemaVersion: 2, presetId: 'human_full', deliveryMode: 'eventView',
      transport: { strength: 'hard', jsChars: 16000, utf8Bytes: 48000 },
    } } }, approve())
    const sent = await rpc('session/prompt', { request: {
      sessionId: a.sessionId, requestId: randomUUID(), mode: 'queue',
      content: [{ type: 'text', text: 'Use rules from the current isolated project.' }],
    } })
    assert.equal(sent.accepted, true)
    let receipt
    const until = Date.now() + 15000
    do {
      receipt = await invoke(a, 'memory.delivery.receipt')
      if (receipt.source === 'last-observed-delivery' && model.observations.length) break
      await new Promise(resolve => setTimeout(resolve, 150))
    } while (Date.now() < until)
    assert.equal(receipt.source, 'last-observed-delivery')
    assert.equal(receipt.accepted, true)
    assert.ok(receipt.deliveredChars > 0 && receipt.deliveredBytes >= receipt.deliveredChars)
    assert.deepEqual((await invoke(a, 'status')).delivery, receipt)
    assert.deepEqual(await invoke(b, 'memory.delivery.receipt'), unobserved)
    const deliveredProject = model.observations.some(row => row.markers.includes(noteMarkers[0]))
    assert.ok(!model.observations.some(row => row.markers.includes(noteMarkers[1])))
    report('DSH actual delivery and cold session isolation', { accepted: true, deliveredProject,
      chars: receipt.deliveredChars, bytes: receipt.deliveredBytes, cold: true })

    const workbench = await web('workbench', { body: { action: 'setup' } })
    assert.equal(workbench.ready, true)
    const greeting = await invoke(a, 'memory.greet', {}, approve())
    assert.deepEqual(greeting.result, { greeting: greetingText, cached: false })
    assert.deepEqual(await web('greet', { body: { ws: b.workspace } }), { greeting: greetingText, cached: true })
    const period = '今天'
    const generated = (await invoke(a, 'memory.summary.generate', { period, force: true }, approve())).result
    assert.equal(generated.summary, summaryText)
    assert.equal(generated.cached, false)
    assert.deepEqual(generated.works, [{ title: '隔离验收', points: ['已读取日志', '已记录证据'] }])
    const cached = await web('summarize', { body: { period, ws: b.workspace } })
    assert.equal(cached.result, summaryText)
    assert.equal(cached.cached, true)
    assert.deepEqual(cached.works, generated.works)
    assert.ok(model.observations.some(row => row.markers.includes(greetingPrompt) &&
      noteMarkers.every(marker => row.markers.includes(marker))))
    assert.ok(model.observations.some(row => row.markers.includes(summaryPrompt)))
    report('DSH greeting and global summary Web and CLI', { greetingGenerated: true, summaryGenerated: true,
      webCacheReused: true, bothProjects: true, loopbackRequests: model.observations.length })
    const activePrompt = await rpc('session/prompt', { request: {
      sessionId: a.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: activityMarker }],
    } })
    assert.equal(activePrompt.accepted, true)
    let otherStatus
    const deadline = Date.now() + 12000
    do {
      otherStatus = await cli(root, home, null, ['api', 'call', 'system.workspaces'], launch, { entry })
      if (otherStatus.workspaces.some(row => row.workspace === a.workspace && row.activities?.turn > 0)) break
      await new Promise(resolve => setTimeout(resolve, 150))
    } while (Date.now() < deadline)
    assert.ok(otherStatus.workspaces.some(row => row.workspace === a.workspace && row.activities?.turn > 0))
    assert.ok(!otherStatus.workspaces.some(row => row.workspace === b.workspace && row.activities?.turn > 0))
    const otherMemory = await cli(root, home, null, ['--workspace-ref', b.workspaceId, 'memory', 'source'], launch,
      { entry, input: { path: 'MEMORY.md' } })
    assert.ok(otherMemory.content.includes(noteMarkers[1]))
    assert.ok(!otherMemory.content.includes(noteMarkers[0]))
    assert.ok(model.observations.some(row => row.markers.includes(activityMarker) && !row.disconnected))
    report('DSH workspace activity during independent browse', { onlyOriginActive: true, otherWorkspaceRead: true,
      noSessionNeeded: true, realTurnStillRunning: true })
    if (process.env.DAM_STORAGE_ACTIVITY_CONPTY === '1') {
      const env = { ...environment(root, home), PYTHONUTF8: '1' }
      delete env.ELECTRON_RUN_AS_NODE
      for (const name of ['PYTHONPATH', 'DAM_TUI_ARTIFACT_DIR']) {
        if (process.env[name]) env[name] = process.env[name]
      }
      const args = ['-B', join(repo, 'tests', 'live', 'auto-memory-tui-pty.py'), '--workspace-activity',
        '--', process.execPath, entry, '--dsh-home', home, '--profile', 'desktop', '--workspace-ref', b.workspaceId]
      const output = await collectProcess('python', args, { env, cwd: root })
      assert.equal(output.code, 0, output.stderr)
      assert.match(output.stdout, /ConPTY workspace activity passed/)
      report('ConPTY switches browsing workspace during a running DSH turn', { greenIndicator: true, scopeIsolated: true })
    }
  } finally {
    await host?.stop()
    await model.close()
  }
}

let host
try {
  if (teamOnly) {
    await runTeamChecks()
  } else if (remoteTeamOnly) {
    await runRemoteTeamChecks()
  } else if (continuationOnly || automaticContinuationOnly) {
    await runContinuationChecks()
  } else if (deliveryOnly) {
    await runDeliveryChecks()
  } else {
    const home = await prepare(root, plugin)
    host = startDesktop(root, home)
    const { url: launch } = await host.ready()
    await runChecks(home, launch, await authenticate(launch))
  }
} finally {
  try {
    await host?.stop()
  } finally {
    assert.equal(dirname(root), temp)
    assert.match(basename(root), /^dam-terminal-storage-/u)
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  }
}
report('result', { observedBugs: observed, assertionFailure: process.exitCode === 1 })
if (observed.length && !process.exitCode) process.exitCode = 1
