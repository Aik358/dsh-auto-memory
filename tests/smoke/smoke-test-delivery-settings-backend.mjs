import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { validatePolicy, PRESETS, legacyToPolicy } from '../../lib/injection/policy-v2.js';
import { previewDelivery } from '../../lib/injection/preview.js';
import { readDiagnosticDigest } from '../../lib/injection/diagnostics.js';
import { extractRulesLayerPre } from '../../lib/rules-layer.js';
import { DEFAULT_PROMPT_LAYERS } from '../../lib/index.js';

const home = await fs.mkdtemp(path.join(tmpdir(), 'delivery-p1-backend-'));
const oldHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('test: outbound network disabled'); };
const { MemoryEngine, API, flushDiagnostics } = await import('../lib/audit-engine.mjs?delivery-p1');
const source = await fs.readFile(process.env.DAM_DELIVERY_P1_SOURCE || new URL('../../lib/index.js', import.meta.url), 'utf8');
const engine = new MemoryEngine();
engine.refresh = async () => {};
const initial = { ...engine.config, memoryRoot: path.join(home, 'memory/workspaces'),
  userMemoryDir: path.join(home, 'memory'), fullInjectWaterPct: '25,50', snapshotMinGapRounds: 20, slimEveryRounds: 8 };
await fs.mkdir(path.dirname(engine._configPath), { recursive: true });
await fs.writeFile(engine._configPath, JSON.stringify(initial));
const parseHandler = (marker, extra = {}) => {
  const route = source.indexOf(marker);
  assert(route >= 0, marker);
  const start = source.indexOf('handler: ', route) + 'handler: '.length;
  const end = source.indexOf('\n      },', start);
  assert(end > start);
  const env = {
    engine, validatePolicy, legacyToPolicy, previewDelivery, extractRulesLayerPre, readDiagnosticDigest, DEFAULT_PROMPT_LAYERS,
    planSpecForTierPre: () => ({ sections: ['当前状态', '近期进展', '待办'] }),
    readFileSync, diagLogFile: () => path.join(home, 'dsh-auto-memory-diagnose.log'),
    isLoopbackRequest: req => req.loopback !== false, panelAllowedHosts: [],
    forbiddenPanelPayloadPre: () => ({ error: 'forbidden: panel-access' }),
    readJsonBody: async req => req.body, writeJson: (res, status, body) => { res.status = status; res.body = body; },
    ...extra,
  };
  return new Function(...Object.keys(env), 'return (' + source.slice(start, end) + '\n})')(...Object.values(env));
};
const call = async (handler, body, options = {}) => {
  const res = {};
  await handler({ method: 'POST', body, ...options }, res);
  return res;
};
test.after(async () => {
  await flushDiagnostics();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
  globalThis.fetch = oldFetch;
});
test('01 synchronous startup independently migrates full, slim and old water once and persists metadata', async () => {
  engine.loadConfigSync();
  const disk = JSON.parse(await fs.readFile(engine._configPath, 'utf8'));
  assert.equal(disk.snapshotMinGapRounds, 40);
  assert.equal(disk.slimEveryRounds, 15);
  assert.equal(disk.fullInjectWaterPct, '25');
  assert.equal(disk.snapshotGapDefaultsVersion, 3);
  assert.equal(disk.slimEveryDefaultsVersion, 2);
  assert.equal(disk.waterPctDefaultsVersion, 1);
  assert.equal(disk.waterPctDefaultsMigration.code, 'waterPct-old-default-migrated');
  const stable = await fs.readFile(engine._configPath, 'utf8');
  engine.loadConfigSync();
  assert.equal(await fs.readFile(engine._configPath, 'utf8'), stable);
});
test('02 explicit full=0 and slim=1 persist their own version-only upgrades', async () => {
  const raw = { ...initial, snapshotMinGapRounds: 0, slimEveryRounds: 1, fullInjectWaterPct: 'off' };
  engine.config = { ...raw };
  const changed = engine.upgradeSnapshotGapDefaultPre(raw);
  assert.equal(engine.config.snapshotMinGapRounds, 0);
  assert.equal(engine.config.slimEveryRounds, 1);
  assert(changed.includes('snapshotGapDefaultsVersion'));
  assert(changed.includes('slimEveryDefaultsVersion'));
  engine.upgradeWaterPctDefaultPre(raw);
  assert.equal(engine.config.fullInjectWaterPct, 'off');
  assert.equal(engine.config.waterPctDefaultsVersion, 1);
  await fs.writeFile(engine._configPath, JSON.stringify(engine.config));
  const disk = JSON.parse(await fs.readFile(engine._configPath, 'utf8'));
  assert.deepEqual(engine.upgradeSnapshotGapDefaultPre(disk), []);
  assert.deepEqual(engine.upgradeWaterPctDefaultPre(disk), []);
});
test('03 water changes only exact unstamped old default; stamped double/off/0/custom remain', () => {
  for (const value of ['25', 'off', '0', '20,70', '25, 50']) {
    const raw = { fullInjectWaterPct: value };
    engine.config = { ...raw };
    engine.upgradeWaterPctDefaultPre(raw);
    assert.equal(engine.config.fullInjectWaterPct, value);
  }
  const raw = { fullInjectWaterPct: '25,50', waterPctDefaultsVersion: 1 };
  engine.config = { ...raw };
  assert.deepEqual(engine.upgradeWaterPctDefaultPre(raw), []);
  assert.equal(engine.config.fullInjectWaterPct, '25,50');
});
test('04 async startup uses the same disk-original migration and persists stamp', async () => {
  await fs.writeFile(engine._configPath, JSON.stringify(initial));
  await engine.loadConfig();
  const disk = JSON.parse(await fs.readFile(engine._configPath, 'utf8'));
  assert.equal(disk.fullInjectWaterPct, '25');
  assert.equal(disk.slimEveryRounds, 15);
  assert.equal(disk.snapshotMinGapRounds, 40);
  assert.equal(disk.waterPctDefaultsVersion, 1);
});
test('04b water-only metadata upgrade persists exactly once without full/slim upgrades', async () => {
  const raw = { ...initial, snapshotMinGapRounds: 40, slimEveryRounds: 15,
    snapshotGapDefaultsVersion: 3, slimEveryDefaultsVersion: 2, fullInjectWaterPct: '25,50' };
  delete raw.waterPctDefaultsVersion;
  delete raw.waterPctDefaultsMigration;
  await fs.writeFile(engine._configPath, JSON.stringify(raw));
  await engine.loadConfig();
  const disk = JSON.parse(await fs.readFile(engine._configPath, 'utf8'));
  assert.equal(disk.fullInjectWaterPct, '25');
  assert.equal(disk.waterPctDefaultsVersion, 1);
  assert.equal(disk.waterPctDefaultsMigration.code, 'waterPct-old-default-migrated');
  const stable = await fs.readFile(engine._configPath, 'utf8');
  await engine.loadConfig();
  assert.equal(await fs.readFile(engine._configPath, 'utf8'), stable);
});
test('05 policy saving after stable startup changes only deliveryPolicy; invalid rejects with zero disk/memory publication', async () => {
  const baseline = JSON.parse(await fs.readFile(engine._configPath, 'utf8'));
  const saved = await engine.saveConfig({ deliveryPolicy: PRESETS.human_slim });
  const disk = JSON.parse(await fs.readFile(engine._configPath, 'utf8'));
  assert.equal(disk.deliveryPolicy.presetId, 'human_slim');
  const { deliveryPolicy: ignored, ...shadow } = disk;
  const { deliveryPolicy: old, ...original } = baseline;
  assert.deepEqual(shadow, original);
  const bytes = await fs.readFile(engine._configPath, 'utf8'), memory = JSON.stringify(engine.config);
  const invalid = structuredClone(PRESETS.human_slim); invalid.modules.events.quotas = [{ unit: 'bogus', scope: 'delivery', max: 3, strength: 'hard' }];
  await assert.rejects(engine.saveConfig({ deliveryPolicy: invalid }), error => error.statusCode === 400 && !!error.fields);
  assert.equal(await fs.readFile(engine._configPath, 'utf8'), bytes);
  assert.equal(JSON.stringify(engine.config), memory);
  await engine.saveConfig({ deliveryPolicy: null });
  assert.equal(Object.hasOwn(engine.config, 'deliveryPolicy'), false);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(engine._configPath, 'utf8')), 'deliveryPolicy'), false);
  assert.equal(legacyToPolicy(engine.config).triggers.waterPct.join(','), '25');
});
test('06 preview route enforces local POST and strict request without invoking providers', async () => {
  let reads = 0;
  const handler = parseHandler('      path: API.deliveryPreview,', { readDiagnosticDigest: () => { reads++; throw Error('unexpected'); } });
  assert.equal((await call(handler, {}, { loopback: false })).status, 403);
  assert.equal((await call(handler, {}, { method: 'GET' })).status, 405);
  assert.equal((await call(handler, { sources: { arbitrary: 'payload' } })).status, 400);
  assert.equal((await call(handler, { policy: { schemaVersion: 999, presetId: 'human_full' } })).status, 400);
  assert.equal(reads, 0);
});
test('07 preview is cached-only, deterministic, no state consumption; diagnostic off means zero file reads', async () => {
  const agent = { session: { id: 'fixture-only', header: { cwd: home } } };
  const runtime = engine.runtimeFor(agent);
  runtime.state.userText = 'USER-END'; runtime.state.notesText = 'PROJECT-END';
  runtime.state.eventCardsText = 'CARD-END'; runtime.state.eventCatalogText = 'CAT-END';
  runtime.state._waterPctFired = 25; runtime.state._humanPending = true;
  engine._lastAgent = agent;
  let reads = 0;
  const handler = parseHandler('      path: API.deliveryPreview,', { readFileSync: () => { reads++; throw Error('must not read'); } });
  const before = JSON.stringify(runtime.state);
  const request = { policy: PRESETS.human_slim, tier: 'human_slim', isHuman: true, isFull: false };
  const a = await call(handler, request), b = await call(handler, request);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.partial, true);
  assert(a.body.text.includes('USER-END') && a.body.text.includes('PROJECT-END'));
  assert.equal(a.body.receipt.contentTier, 'human_slim');
  assert.equal(a.body.receipt.counts.checkpointFull, null);
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(runtime.state), before);
});
test('08 diagnostic preview matches pure provider formatter and never exposes raw error text', async () => {
  const policy = validatePolicy({ schemaVersion: 2, presetId: 'run_slim', modules: { diagnostics: { enabled: true } } });
  let reads = 0;
  const now = Date.now();
  const raw = new Date(now).toISOString() + ' snapshot build failed: C:/SECRET/session-id/model-name/query\\n';
  const handler = parseHandler('      path: API.deliveryPreview,', { readFileSync: () => { reads++; return raw; } });
  const result = await call(handler, { policy, tier: 'run_slim' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const digest = readDiagnosticDigest({ enabled: true, file: 'fixture', now: Date.now(),
    readFile: () => raw, windowHours: 24, maxLines: 5 });
  assert(result.body.text.includes(digest.text));
  assert(!/SECRET|session-id|model-name|query/.test(result.body.text));
  assert.equal(result.body.receipt.diagnosticInjections, 1);
  assert.equal(reads, 1);
});
test('09 public config key and route are registered, metadata stamps stay outside public key list', async () => {
  const mod = await import('../../lib/index.js');
  assert.equal(Object.keys(mod).filter(k => k !== 'default').length, 41);
  assert.equal(API.deliveryPreview, '/api/dsh-auto-memory/delivery-preview');
  const src = source.slice(source.indexOf('const DEFAULT_CONFIG = {'), source.indexOf('\n}\r', source.indexOf('const DEFAULT_CONFIG = {')));
  assert.match(src, /deliveryPolicy: null/);
  assert(!/^\s{2}waterPctDefaultsVersion:/m.test(src));
});

test('10 shipped apply really registers the local preview handler and it executes as HTTP', async () => {
  const { Readable } = await import('node:stream');
  const mod = await import('../../lib/index.js');
  const routes = [], effects = [], tools = [], slots = [], store = new Map();
  mod.apply({
    effect(fn) { effects.push(fn); return () => {}; }, on() { return () => {}; },
    get(k) { return store.get(k); }, set(k, v) { store.set(k, v); },
    provide(k, v) { store.set(k, v); }, consume(k) { return store.get(k); },
    tools: { register(t) { tools.push(t); return () => {}; } },
    systemPrompt: { context(fn) { slots.push(fn); }, section(a, b) { slots.push(typeof a === 'function' ? a : b); } },
    webServer: { register(route) { routes.push(route); return true; } },
    log() {}, logger: { info() {}, warn() {}, error() {}, debug() {} }, config: {},
  });
  assert.equal(routes.length, 87); assert.equal(tools.length, 22);
  assert.equal(effects.length, 2); assert.equal(slots.length, 3);
  const route = routes.find(r => r.path === API.deliveryPreview);
  assert(route && typeof route.handler === 'function');
  const req = Readable.from([Buffer.from(JSON.stringify({ policy: PRESETS.run_slim, tier: 'run_slim' }))]);
  req.method = 'POST'; req.headers = { host: '127.0.0.1:19387', 'content-type': 'application/json' };
  req.socket = { remoteAddress: '127.0.0.1' };
  const res = { status: null, body: '', writeHead(status) { this.status = status; },
    setHeader() {}, end(chunk) { this.body += String(chunk || ''); } };
  await route.handler(req, res);
  assert.equal(res.status, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.partial, true);
  assert.equal(body.receipt.snapshotScope, 'cache-unavailable');
  const dispose = effects[0]();
  if (typeof dispose === 'function') dispose();
});
test('11 R1 removes state only for run_full; human_full is byte-equal to pre-R1 mapping', async () => {
  const { createHash } = await import('node:crypto');
  const moduleDir = await fs.mkdtemp(path.join(home, 'ledger-reference-'));
  const oldMapping = "const _LEDGER_FULL_TIERS = ['human_full', 'run_full', 'post_compact', 'handoff_carry', 'hang_compensate', 'legacy']";
  const newMapping = "const _LEDGER_FULL_TIERS = ['human_full', 'post_compact', 'handoff_carry', 'hang_compensate', 'legacy']";
  assert(source.includes(newMapping));
  const indexUrl = new URL('../../lib/index.js', import.meta.url);
  let baseline = source.replace(newMapping, oldMapping)
    .replace(/from '(\.\/[^']+)'/g, (_, relative) => 'from ' + JSON.stringify(new URL(relative, indexUrl).href))
    .replace(/import\('(\.\/[^']+)'\)/g, (_, relative) => 'import(' + JSON.stringify(new URL(relative, indexUrl).href) + ')');
  await fs.writeFile(path.join(moduleDir, 'index.mjs'), baseline + '\nexport { MemoryEngine };');
  const OldEngine = (await import(pathToFileURL(path.join(moduleDir, 'index.mjs')).href)).MemoryEngine;
  const oldEngine = new OldEngine();
  const agent = { session: { id: 'ledger-fixture', header: { cwd: home } } };
  const ledger = '# 交接\n## 目标 [goal]\n目标正文\n## 任务状态 [type:state]\nSTATE-UNIQUE\n## 已试方案与失败原因 [type:dead-end]\n失败原因-END\n## 进度与下一步 [type:progress]\n下一步-END\n';
  const configure = (e, tier) => {
    e.config = { ...e.config, handoffLedgerChars: 800, handoffEnabled: true, rulesLayeringMode: 'off',
      tier0CatalogEnabled: false, injectBudgetChars: 8000, deliveryPolicy: null };
    e.memToday = () => '2026-11-17';
    const st = e.runtimeFor(agent).state;
    Object.assign(st, { ws: home, userText: '', notesText: '', latestHandoffText: ledger,
      planText: '', _injectTier: tier, _injectTierPre: tier });
    return st;
  };
  const currentState = configure(engine, 'human_full');
  const oldState = configure(oldEngine, 'human_full');
  // The production renderer consumes injectTierPre; establish both exact state names used by callers.
  currentState.injectTierPre = 'human_full'; oldState.injectTierPre = 'human_full';
  const humanNow = engine.withAgent(agent, () => engine.renderMemoryDynamic({ agent }));
  const humanBefore = oldEngine.withAgent(agent, () => oldEngine.renderMemoryDynamic({ agent }));
  assert.equal(humanNow, humanBefore);
  assert(humanNow.includes('STATE-UNIQUE'), 'full fixture must actually contain state');
  currentState.injectTierPre = 'run_full'; currentState._injectTier = 'run_full'; currentState._injectTierPre = 'run_full';
  const run = engine.withAgent(agent, () => engine.renderMemoryDynamic({ agent }));
  assert(!run.includes('STATE-UNIQUE'), 'run_full must omit task-state');
  assert(run.includes('失败原因-END') && run.includes('下一步-END'));
  const ledgerSegment = engine.stateFor(agent).envelopeMeta.segments.find(s => s.kind === 'handoff-ledger');
  const decoration = ('\n' + DEFAULT_PROMPT_LAYERS.snapshotHandoffTitle + '\n').length;
  assert(ledgerSegment && ledgerSegment.chars - decoration <= 800, 'ledger body is within 800 after accounting for existing decoration');
  assert.equal(createHash('sha256').update(humanNow).digest('hex'), createHash('sha256').update(humanBefore).digest('hex'));
});

test('12 production dynamic diagnostic is normal, safe, opt-in and independently metered', async () => {
  const agent = { session: { id: 'diagnostic-render-fixture', header: { cwd: home } } };
  const st = engine.runtimeFor(agent).state;
  Object.assign(st, { ws: home, userText: '', notesText: '', planText: '', latestHandoffText: '', _injectTierPre: 'human_full' });
  engine.config = { ...engine.config, deliveryPolicy: null, handoffEnabled: false };
  const before = engine.withAgent(agent, () => engine.renderMemoryDynamic({ agent }));
  const file = path.join(home, 'dsh-auto-memory-diagnose.log');
  await fs.writeFile(file, new Date().toISOString() + ' snapshot build failed: SECRET-path-session-model-query\n');
  engine.config.deliveryPolicy = validatePolicy({ schemaVersion: 2, presetId: 'human_full', modules: { diagnostics: { enabled: true } } });
  const enabled = engine.withAgent(agent, () => engine.renderMemoryDynamic({ agent }));
  assert(enabled.includes('[记忆诊断]'), 'enabled production path contains digest');
  assert(enabled.includes('snapshot-build×1'));
  assert(!enabled.includes('SECRET-path-session-model-query'));
  const meta = engine.stateFor(agent).envelopeMeta;
  assert.equal(meta.diagnosticInjections, 1);
  assert(meta.segments.find(segment => segment.kind === 'diagnostic').chars <= 301);
  engine.config.deliveryPolicy = PRESETS.human_full;
  const disabled = engine.withAgent(agent, () => engine.renderMemoryDynamic({ agent }));
  assert.equal(disabled, before, 'disabled diagnostic keeps production output byte-equal');
  assert.equal(engine.stateFor(agent).envelopeMeta.diagnosticInjections, 0);
});



