import { registerHooks } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'

// Run ConPTY before the existing isolated Desktop test shuts down its seeded host.
// The loader hook applies only to that test module in this process.
const baseline = new URL('./auto-memory-cli-baseline.mjs', import.meta.url).href
const [desktop, plugin] = process.argv.slice(2)
if (!desktop || !plugin) throw new Error('Usage: node auto-memory-tui-desktop.mjs DESKTOP_EXE CANDIDATE_PACKAGE_DIR')
const hook = registerHooks({
  load(url, context, next) {
    const loaded = next(url, context)
    if (url !== baseline) return loaded
    const source = Buffer.from(loaded.source).toString('utf8')
    const anchor = '    const event = await exercise(plugin, root, connection, label)'
    if (!source.includes(anchor)) throw new Error('Desktop fixture changed its seed point. Recheck the ConPTY fixture integration.')
    const probe = `
    let stopThenCheckTui
    if (label === 'worktree' || label === 'final-candidate') {
      const env = environment(root, home)
      delete env.ELECTRON_RUN_AS_NODE
      env.PYTHONUTF8 = '1'
      if (process.env.PYTHONPATH) env.PYTHONPATH = process.env.PYTHONPATH
      const runner = join(repo, 'tests', 'live', 'auto-memory-tui-pty.py')
      const entry = process.env.DAM_TUI_INSTALLED_ENTRY || join(repo, 'lib', 'terminal', 'cli.js')
      const state = await pluginRequest(connection, 'state', { query: { ws: event.workspace, sessionId: event.sessionId } })
      const originalNotes = await readFile(state.notesPath)
      const { eventStorePre, EVENT_STORE_FILENAME, readStorePre, writeStorePre } = await import(pathToFileURL(join(plugin, 'lib', 'event-store.js')))
      const store = join(state.projectDir, 'handoff', EVENT_STORE_FILENAME)
      await eventStorePre.set(store, event.id, { kind: 'ledger', members: ['docs/plan.md', 'handoff/notes.md', 'docs/plan.md'] })
      const start = Date.UTC(2026, 10, 16, 10)
      const hour = 3600000
      const shared = await eventStorePre.create(store, { name: 'P1 R2 并行验收', kind: 'ledger', startMs: start, endMs: start + 5 * hour })
      await eventStorePre.append(store, shared.id, { checkpoint: { text: '第一段推进', at: start, idemKey: 'parallel-first' } })
      await eventStorePre.append(store, shared.id, { checkpoint: { text: '恢复推进', at: start + 5 * hour, idemKey: 'parallel-next' } })
      const paused = await eventStorePre.create(store, { name: 'R2 暂停事项', kind: 'ledger', startMs: start + hour, endMs: start + 3 * hour })
      await eventStorePre.set(store, paused.id, { status: 'paused', pausedReason: '等待验收' })
      const closed = await eventStorePre.create(store, { name: 'P1 已关闭事项', kind: 'ledger', startMs: start + hour, endMs: start + 3 * hour })
      await eventStorePre.close(store, closed.id, '完成验收')
      const seeded = await readStorePre(store)
      for (const [order, item] of [paused, shared, closed].entries()) {
        seeded.events.find(row => row.id === item.id).updatedAt = start + (order + 1) * hour
      }
      await writeStorePre(store, seeded)
      const archive = join(dirname(store), 'archive')
      await mkdir(archive, { recursive: true })
      await writeFile(join(dirname(store), 'PLAN.md'), [
        '# 白板画布夹具', '', '## 当前状态', '图卡当前全文 7314', '', '## 目标', '通过真实宿主回读白板画布。',
      ].join('\\n'))
      await writeFile(join(archive, 'handoff-20261115-100000.md'), '# 历史白板\\n\\n## 归档条目\\n图卡归档全文 7314\\n')
      await pluginRequest(connection, 'config', { body: { boardMode: 'graph', boardArchive: 'off' } })
      const live = await pluginRequest(connection, 'event-list', { query: { all: 1, sessionId: event.sessionId } })
      assert.equal(live.events.find(row => row.id === shared.id).checkpointQuad.length, 2)
      assert.equal(live.events.find(row => row.id === paused.id).status, 'paused')
      assert.equal(live.events.find(row => row.id === closed.id).status, 'closed')
      const graph = await pluginRequest(connection, 'kanban-board', { query: { sessionId: event.sessionId } })
      assert.equal(graph.enabled, true)
      assert.ok(graph.lanes.some(lane => lane.cards.some(card => card.source === 'handoff/PLAN.md')))
      for (const body of [
        { date: '2026-10-13', time: '09:30', title: 'Calendar fixture earlier', quadrant: '重要紧急' },
        { date: '2026-11-26', time: '08:15', title: 'Calendar fixture latest', note: 'Compare the real calendar output' },
      ]) await pluginRequest(connection, 'calendar', { body })
      const target = ['--', process.execPath, entry, '--dsh-home', home, '--profile', 'desktop',
        '--session', event.sessionId, '--workspace', event.workspace]
      const args = ['-B', runner, '--expect', event.name, '--checkpoint', 'Checkpoint checked the source note',
        '--recall', 'tungstenwren', '--event-id', event.id, '--board-navigation', ...target]
      if (process.env.DAM_TUI_EVENT_WRITES === '1') args.splice(args.length - target.length, 0, '--event-writes')
      try {
        const child = spawn('python', args, { env, stdio: 'inherit', windowsHide: true })
        assert.equal(await withDeadline(new Promise((done, reject) => {
          child.once('error', reject)
          child.once('exit', done)
        }), 85000, 'ConPTY Desktop interaction'), 0)
      } finally {
        await writeFile(state.notesPath, originalNotes)
      }
      stopThenCheckTui = async () => {
        const probe = spawn('python', ['-B', runner, '--disconnect', '--expect', event.name, ...target],
          { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
        const ready = Promise.withResolvers()
        const done = new Promise((resolve, reject) => {
          probe.once('error', reject)
          probe.once('exit', resolve)
        })
        let output = ''
        probe.stdout.setEncoding('utf8').on('data', chunk => {
          output += chunk
          if (output.includes('TUI_READY_FOR_SHUTDOWN')) ready.resolve()
        })
        try {
          await withDeadline(Promise.race([ready.promise, done.then(code => { throw new Error('Disconnect probe exited before ready: ' + code) })]),
            20000, 'ConPTY ready to observe host shutdown')
          await host.stop()
          assert.equal(await withDeadline(done, 15000, 'ConPTY after host shutdown'), 0)
          console.log(output.trim())
        } finally {
          if (probe.exitCode === null && probe.signalCode === null) probe.kill()
        }
      }
    }`
    const position = source.indexOf(anchor) + anchor.length
    const afterSeed = source.slice(position)
    const stop = '    await host.stop()'
    if (!afterSeed.includes(stop)) throw new Error('Desktop fixture changed its shutdown point')
    const patched = source.slice(0, position) + probe + afterSeed.replace(stop,
      '    if (stopThenCheckTui) await stopThenCheckTui()\n    else await host.stop()')
    return {
      ...loaded,
      source: process.env.DAM_TUI_INSTALLED_ENTRY
        ? patched.replace("await run(repo, 'worktree')", "await run(resolve(process.env.DAM_TUI_INSTALLED_ENTRY, '../../..'), 'worktree')")
        : patched,
    }
  },
})

try {
  const originalArgv = process.argv
  process.argv = [...originalArgv.slice(0, 2), '--candidate', desktop, plugin]
  try {
    await import(baseline)
  } finally {
    process.argv = originalArgv
  }
} finally {
  hook.deregister()
}
