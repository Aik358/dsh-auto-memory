import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const indexFile = path.join(repo, 'lib', 'index.js');
const adapterFile = path.join(repo, 'lib', 'injection', 'consolidation-production.js');
const harness = new URL('../lib/audit-engine.mjs', import.meta.url);
const hash = text => createHash('sha256').update(text).digest('hex');
const fixture = await mkdtemp(path.join(os.tmpdir(), 'dam-closure-co-'));
const savedHome = process.env.DSH_HOME;
const savedSource = process.env.DAM_AUDIT_ENGINE_SOURCE;
process.env.DSH_HOME = fixture;

const agent = { session: { id: 'co-test', header: { cwd: path.join(fixture, 'workspace') } } };
const projectDir = path.join(fixture, 'project');
const paths = {
  ws: agent.session.header.cwd, projectDir,
  handoffDir: path.join(projectDir, 'handoff'), reflectDir: path.join(projectDir, 'reflections'),
  planPath: path.join(projectDir, 'handoff', 'PLAN.md'), notesPath: path.join(projectDir, 'MEMORY.md'),
  userDir: fixture, userFile: path.join(fixture, 'MEMORY.md'),
};
const eventFile = path.join(paths.handoffDir, 'event-store.json');
const end = 'CASE-NEW-LOG';
const previous = 'CASE-SPARSE-LOG';
const outside = 'CASE-LOG-OVER-COUNT';
const tags = ['CASE-EVENT-DECISION', 'CASE-WHITEBOARD', 'CASE-LEDGER', 'CASE-REFLECTION'];
const oldHead = 'decdeccf';
// Captured from the pre-wiring production method against this exact fixture.
const oldDigest = '355896bc4137e7d26e42ec3c94a4a16154da1429a0c5349b060ca95facc59279';
const oldLength = 436;
const oldBytes = 946;
const clean = source => (process.env.DAM_AUDIT_ENGINE_SOURCE = source);

async function loadEngine(source, name) {
  let file;
  if (source === null) delete process.env.DAM_AUDIT_ENGINE_SOURCE;
  else {
    file = path.join(fixture, name + '.mjs');
    await writeFile(file, source, 'utf8');
    clean(file);
  }
  try { return (await import(harness.href + '?' + randomUUID())).MemoryEngine; }
  finally { if (savedSource === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE; else clean(savedSource); }
}

async function run(Engine, { days = 2, response = ' (\u65e0) \n' } = {}) {
  const engine = new Engine();
  engine.configLoaded = true;
  engine._subagents = {};
  engine.resolvePaths = async () => paths;
  const calls = [], writes = [];
  engine.runSubagent = async (prompt, label, owner) => {
    calls.push({ prompt, label, owner });
    return response;
  };
  engine.ensureBudget = async () => ({ ok: true });
  engine.appendText = async (file, text) => {
    writes.push({ file, text });
    return text;
  };
  const output = await engine.consolidateMemory(agent, days);
  return { calls, writes, output, prompt: calls[0]?.prompt };
}

function assertMaterials(result) {
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].label, 'auto-memory-consolidate-logs');
  assert.equal(result.calls[0].owner, agent);
  for (const text of tags) assert.ok(result.prompt.includes(text), 'missing source body ' + text);
}

function assertLogWindow(result) {
  assert.ok(result.prompt.includes(end), 'new log absent');
  assert.ok(result.prompt.includes(previous), 'nonempty log across calendar gap absent');
  assert.ok(!result.prompt.includes(outside), 'third nonempty log exceeded days');
}

function replaceOnce(source, anchor, replacement) {
  assert.equal(source.split(anchor).length - 1, 1, 'expected one mutation target ' + anchor);
  return source.replace(anchor, replacement);
}

async function mutatedEngine(index, adapter, name, anchor, change) {
  const adapterUrl = pathToFileURL(path.join(fixture, name + '-adapter.mjs'));
  // Keep actual production engine scope. Rewrite the temporary adapter's relative imports to the same modules.
  const altered = replaceOnce(adapter, anchor, change)
    .replace(/from '(\.{1,2}\/[^']+)'/g, (_, relative) =>
      'from ' + JSON.stringify(new URL(relative, pathToFileURL(adapterFile)).href));
  await writeFile(fileURLToPath(adapterUrl), altered, 'utf8');
  return loadEngine(replaceOnce(index, "'./injection/consolidation-production.js'", JSON.stringify(adapterUrl.href)), name);
}

try {
  await Promise.all([paths.handoffDir, paths.reflectDir].map(dir => mkdir(dir, { recursive: true })));
  const logs = [
    ['2026-11-22.md', end], ['2026-11-21.md', '  \n'],
    ['2026-10-30.md', previous], ['2026-10-29.md', outside],
  ];
  const materials = [
    [eventFile, JSON.stringify({ events: [{ id: 'evt_00000001', name: 'CO case', summary: tags[0] }] })],
    [paths.planPath, tags[1]], [path.join(paths.handoffDir, 'handoff-20261122-120000.md'), tags[2]],
    [path.join(paths.reflectDir, '2026-11-22.md'), tags[3]],
  ];
  for (const [file, body] of [...logs.map(([name, text]) => [path.join(projectDir, name), text]), ...materials]) {
    await writeFile(file, body, 'utf8');
  }
  let baseline;
  try {
    baseline = execFileSync('git', ['show', oldHead + ':lib/index.js'], {
      cwd: repo, encoding: 'utf8', maxBuffer: 10_000_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) { /* Shallow checkouts can use the recorded baseline digest. */ }
  let previousVersion;
  if (baseline) {
    previousVersion = await run(await loadEngine(baseline, 'baseline'));
    assertLogWindow(previousVersion);
    for (const text of tags) assert.ok(!previousVersion.prompt.includes(text));
    assert.equal(hash(previousVersion.prompt), oldDigest);
    assert.equal(previousVersion.prompt.length, oldLength);
    assert.equal(Buffer.byteLength(previousVersion.prompt), oldBytes);
  }
  const Current = await loadEngine(null);
  const actual = await run(Current);
  assertMaterials(actual);
  assertLogWindow(actual);
  console.log('PASS B1 five sources', tags.join(', '));
  console.log('PASS B2 old/new chars', oldLength, '→', actual.prompt.length,
    'UTF-8 bytes', oldBytes, '→', Buffer.byteLength(actual.prompt));
  assert.equal(actual.writes.length, 0);
  const unknown = await run(Current, { response: { status: 'unexpected', text: '[PROJECT]\n- a valid-looking project decision' } });
  assert.equal(unknown.writes.length, 0);
  const inline = await run(Current, { response: '[PROJECT]\n- 兼容输出(无)和真正的空响应\n[USER]\n- 用户偏好两个独立输出渠道' });
  assert.deepEqual(inline.writes.map(write => write.file), [paths.notesPath, path.join(paths.userDir, 'PENDING-USER-MEMORY.md')]);
  console.log('PASS standalone (无), unknown status, and valid inline (无) through production result path');

  const index = await readFile(indexFile, 'utf8');
  const adapter = await readFile(adapterFile, 'utf8');
  const missingEvents = await mutatedEngine(index, adapter, 'no-event', "addSnapshot(snapshot, 'events', eventRef, () => readWorkspaceText(eventRef, paths.projectDir)),", '');
  const wrongDays = await mutatedEngine(index, adapter, 'wrong-days', 'if (selected >= days) break;', 'if (selected > days) break;');
  const eventMutation = await run(missingEvents);
  const daysMutation = await run(wrongDays);
  assert.throws(() => assertMaterials(eventMutation), /missing source body CASE-EVENT-DECISION/);
  assert.throws(() => assertLogWindow(daysMutation), /third nonempty log exceeded days/);
  console.log('PASS B4 event removal CAUGHT, days boundary CAUGHT');
  const restored = await run(Current);
  assertMaterials(restored);
  assertLogWindow(restored);
  console.log('PASS B4 restored production green');

  const toggle = index.match(/\bconst (use[A-Za-z]*(?:Consolidat[A-Za-z]*|FiveSource[A-Za-z]*)) = true\b/);
  assert.ok(toggle, 'unique production CO rollback switch absent');
  const Off = await loadEngine(replaceOnce(index, toggle[0], 'const ' + toggle[1] + ' = false'), 'co-off');
  const off = await run(Off);
  assert.equal(hash(off.prompt), oldDigest);
  assert.equal(off.prompt.length, oldLength);
  assert.equal(Buffer.byteLength(off.prompt), oldBytes);
  if (previousVersion) assert.deepEqual(Buffer.from(off.prompt), Buffer.from(previousVersion.prompt));
  console.log('PASS B5', previousVersion ? 'byte-equal with' : 'recorded digest from', oldHead, 'SHA256', hash(off.prompt));

  for (const [file] of [...logs.map(([name]) => [path.join(projectDir, name)]), ...materials]) {
    await writeFile(file, file === eventFile ? '{"events":[]}' : '  \n', 'utf8');
  }
  const empty = await run(Current);
  assert.match(empty.output, /没有可提炼的内容/);
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.writes.length, 0);
  console.log('PASS B3 five-source empty', empty.output);
  await writeFile(eventFile, '{bad json', 'utf8');
  const unreadable = await run(Current);
  assert.match(unreadable.output, /读取来源失败.*events/);
  assert.equal(unreadable.calls.length, 0);
  assert.equal(unreadable.writes.length, 0);
  console.log('PASS B3 unreadable differs from empty', unreadable.output);
} finally {
  if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
  if (savedSource === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE; else clean(savedSource);
  await rm(fixture, { recursive: true, force: true, maxRetries: 3 });
}
