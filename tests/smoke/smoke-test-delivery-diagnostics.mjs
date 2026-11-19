import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const target = process.env.DSH_DIAGNOSTICS_MODULE
  ? pathToFileURL(process.env.DSH_DIAGNOSTICS_MODULE).href
  : new URL('../../lib/injection/diagnostics.js', import.meta.url).href;
const { readDiagnosticDigest, formatDiagnosticDigest, isDiagnosticCodeSyntax } = await import(target);
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const stamp = ms => new Date(ms).toISOString();
const line = (message, at = NOW - 1000) => stamp(at) + ' ' + message;
const structured = (code, extras = {}) => JSON.stringify({ at: NOW - 1000, level: 'error', code, ...extras });
function read(text, extra = {}) {
  return readDiagnosticDigest({ enabled: true, file: 'synthetic-diagnostic.log', now: NOW,
    windowHours: 24, maxLines: 5, readFile: () => text, ...extra });
}

test('disabled or omitted switch reads neither file nor option getters', () => {
  let reads = 0;
  const input = { enabled: false };
  for (const key of ['file', 'now', 'windowHours', 'maxLines', 'readFile']) {
    Object.defineProperty(input, key, { get() { reads++; throw Error('disabled option accessed'); } });
  }
  const out = readDiagnosticDigest(input);
  assert.equal(reads, 0);
  assert.equal(out.text, '');
  assert.deepEqual(out.codes, []);
  assert.deepEqual(out.chars, { total: 0, utf8Bytes: 0 });
  assert.equal(readDiagnosticDigest().text, '');
  assert.equal(readDiagnosticDigest({ enabled: false, readFile() { reads++; } }).text, '');
  assert.equal(reads, 0);
});

test('legacy ISO diagnostic messages map to fixed codes and counts only', () => {
  const privateData = 'C:/secret/MEMORY.md session-123 query=private model=gpt-6';
  const out = read([
    line('snapshot build failed: ' + privateData),
    line('snapshot build failed: different private text'),
    line('memory_note Phase3 补偿写入失败: ' + privateData),
  ].join('\n'));
  assert.deepEqual(out.codes, [{ code: 'snapshot-build', count: 2 }, { code: 'wal-flush', count: 1 }]);
  assert.equal(out.counts.errors, 3);
  assert.equal(out.priority, 'normal');
  assert.equal(out.text, '[记忆诊断] 最近 24h 错误 3 条：snapshot-build×2, wal-flush×1');
  for (const secret of ['secret', 'MEMORY', 'session-123', 'private', 'gpt-6']) {
    assert(!JSON.stringify(out).includes(secret));
  }
});

test('actual source legacy error prefixes work without exporting exception suffix', () => {
  const out = read([
    line('event-store 读取失败，事件层降级为空: 私有正文'),
    line('画像段预计算失败，已降级为空: C:/hidden'),
    line('config: legacy merge failed (fail-soft): raw-private'),
    line('snapshotUpgradeEvidencePre failed: sid-private'),
    line('evidence baseline snapshot failed: model-private'),
  ].join('\n'));
  assert.equal(out.counts.errors, 5);
  assert(out.codes.some(row => row.code === 'event-store-read'));
  assert(out.codes.some(row => row.code === 'portrait-build'));
  assert(out.codes.some(row => row.code === 'config-migration'));
  assert(out.codes.some(row => row.code === 'snapshot-upgrade'));
  assert(!JSON.stringify(out).includes('私有'));
  assert(!JSON.stringify(out).includes('hidden'));
  assert(!JSON.stringify(out).includes('private'));
});

test('structured JSONL accepts only error/fatal records with registered codes', () => {
  const out = read([
    structured('snapshot-build', { count: 2, message: 'secret-file', sessionId: 'secret-session' }),
    structured('wal-flush', { level: 'fatal' }),
    structured('snapshot-build', { level: 'info', count: 999 }),
  ].join('\n'));
  assert.deepEqual(out.codes, [{ code: 'snapshot-build', count: 2 }, { code: 'wal-flush', count: 1 }]);
  assert.equal(out.counts.errors, 3);
  assert(!JSON.stringify(out).includes('secret'));
});

test('syntactically valid unknown identifiers are not accepted as diagnostic codes', () => {
  const out = read([
    structured('session_12345678'),
    structured('private-query'),
    structured('gpt-6'),
    structured('C:/private/file'),
    structured('snapshot-build\nprivate'),
    structured('snapshot-build', { level: 'warn' }),
  ].join('\n'));
  assert.equal(out.text, '');
  assert.equal(out.counts.errors, 0);
  assert.deepEqual(out.codes, []);
});

test('code grammar rejects forbidden characters, length, case and line breaks', () => {
  assert.equal(isDiagnosticCodeSyntax('snapshot-build'), true);
  assert.equal(isDiagnosticCodeSyntax('a:b_c-9'), true);
  assert.equal(isDiagnosticCodeSyntax('a'.repeat(40)), true);
  for (const code of ['', 'a'.repeat(41), 'Snapshot', 'C:/private', '../note',
    'query value', 'secret@example', 'snapshot-build\nprivate', '\tsecret']) {
    assert.equal(isDiagnosticCodeSyntax(code), false, 'must reject ' + JSON.stringify(code));
  }
  assert.equal(isDiagnosticCodeSyntax(null), false);
});

test('timestamp-prefixed structured error uses the outer recorded timestamp', () => {
  const out = read([
    line(structured('wal-flush', { at: NOW - 10 * 86400000 })),
    line(structured('wal-flush'), NOW - 2 * 86400000),
  ].join('\n'));
  assert.deepEqual(out.codes, [{ code: 'wal-flush', count: 1 }]);
});

test('window excludes old and future records while including its exact boundary', () => {
  const out = read([
    line('snapshot build failed: current'),
    line('snapshot build failed: cutoff', NOW - 24 * 3600000),
    line('snapshot build failed: too old', NOW - 24 * 3600000 - 1),
    line('snapshot build failed: future', NOW + 1),
    'not a timestamp snapshot build failed: ignored',
  ].join('\n'));
  assert.equal(out.counts.errors, 2);
  const week = read(line('wal flush failed: older', NOW - 6 * 86400000), { windowHours: 168 });
  assert.equal(week.counts.errors, 1);
});

test('normal logging, unknown legacy messages, malformed JSON and invalid counts produce zero bytes', () => {
  const out = read([
    line('ready: engine + 22 tools'),
    line('received baseline offer secret'),
    line('private-query failed: unknown free-form text'),
    '{broken json',
    structured('snapshot-build', { count: 0 }),
    structured('snapshot-build', { count: -1 }),
    structured('snapshot-build', { count: 0.5 }),
    structured('snapshot-build', { count: Number.MAX_SAFE_INTEGER + 1 }),
    structured('snapshot-build', { at: 'not-a-date' }),
  ].join('\n'));
  assert.equal(out.text, '');
  assert.deepEqual(out.chars, { total: 0, utf8Bytes: 0 });
});

test('maxLines limits complete code records, and total output stays within 5 lines and 300 characters', () => {
  const codes = ['snapshot-build', 'snapshot-upgrade', 'wal-flush', 'config-migration',
    'config-write', 'event-store-read', 'event-projection', 'event-write'];
  const all = codes.map((code, index) => structured(code, { count: index + 1 })).join('\n');
  const out = read(all, { maxLines: 3 });
  assert.equal(out.codes.length, 8);
  assert.equal(out.counts.displayedCodes, 3);
  assert.equal(out.counts.codes, 8);
  assert.equal(out.counts.omittedCodes, 5);
  assert.equal(out.codes[0].code, 'event-write');
  assert(out.text.length <= 300);
  assert(out.text.split('\n').length <= 5);
  assert.equal(out.chars.total, out.text.length);
  assert.equal(out.chars.utf8Bytes, Buffer.byteLength(out.text, 'utf8'));
  assert(out.codes.slice(0, 3).every(row => out.text.includes(row.code + '×' + row.count)));
});

test('enabled zero code rows is legal and has no IO', () => {
  let calls = 0;
  const out = read('', { maxLines: 0, readFile() { calls++; return line('wal flush failed: x'); } });
  assert.equal(calls, 0);
  assert.equal(out.text, '');
});

test('read failures expose only a safe warning and no file path or original exception', () => {
  const out = read('', { file: 'C:/private/MEMORY.md',
    readFile() { throw Error('session-private, C:/private/MEMORY.md, query-private'); } });
  assert.equal(out.text, '');
  assert.deepEqual(out.warnings, ['diagnostic-read-failed']);
  for (const secret of ['session-private', 'C:/', 'MEMORY.md', 'query-private']) {
    assert(!JSON.stringify(out).includes(secret));
  }
});

test('sync reader contract handles Buffer, unsupported return values and async readers explicitly', async () => {
  assert.equal(read('', { readFile: () => Buffer.from(line('wal flush failed: x')) }).counts.errors, 1);
  assert.deepEqual(read('', { readFile: () => ({ text: 'not accepted' }) }).warnings, ['diagnostic-text-required']);
  const out = read('', { readFile: () => Promise.reject(Error('secret async error')) });
  assert.equal(out.text, '');
  assert.deepEqual(out.warnings, ['diagnostic-sync-reader-required']);
  await new Promise(resolve => setImmediate(resolve));
});

test('enabled options have strict integer ranges and injected now is required', () => {
  for (const [key, value] of [['now', undefined], ['now', -1], ['now', NaN],
    ['windowHours', 0], ['windowHours', 169], ['windowHours', 1.5],
    ['maxLines', -1], ['maxLines', 6], ['maxLines', 1.5],
    ['file', ''], ['readFile', undefined]]) {
    assert.throws(() => read('', { [key]: value }), error =>
      error.code === 'diagnostic-invalid-option' && error.field === key);
  }
});

test('input remains unchanged and repeated reads with the same now are byte equal', () => {
  const raw = [structured('wal-flush'), structured('snapshot-build')].join('\n');
  const input = Object.freeze({ enabled: true, file: 'fixture.log', now: NOW,
    windowHours: 24, maxLines: 5, readFile: () => raw });
  const a = readDiagnosticDigest(input);
  const b = readDiagnosticDigest(input);
  assert.deepEqual(a, b);
  assert.equal(input.enabled, true);
  assert(Object.isFrozen(a.codes));
  assert(Object.isFrozen(a.codes[0]));
  assert(!a.text.includes('fixture.log'));
});

test('integer count aggregation does not silently overflow its accounting', () => {
  const out = read([structured('wal-flush', { count: Number.MAX_SAFE_INTEGER }),
    structured('snapshot-build')].join('\n'));
  assert.equal(out.counts.errors, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(out.codes, [{ code: 'wal-flush', count: Number.MAX_SAFE_INTEGER }]);
  assert.deepEqual(out.warnings, ['diagnostic-count-overflow']);
});

test('disabled provider does not invoke a supplied reader spy', () => {
  let calls = 0;
  const out = readDiagnosticDigest({ enabled: false, file: 'private.log', now: NOW,
    readFile() { calls++; return line('wal flush failed: sensitive'); } });
  assert.equal(calls, 0);
  assert.equal(out.chars.total, 0);
});

test('pure formatter reproduces the read digest byte-for-byte even when rows are omitted', () => {
  const inputCodes = ['snapshot-build', 'snapshot-upgrade', 'wal-flush', 'config-migration',
    'config-write', 'event-store-read', 'event-projection', 'event-write'];
  const digest = read(inputCodes.map(code => structured(code)).join('\n'), { maxLines: 2 });
  assert.equal(digest.counts.displayedCodes, 2);
  assert.equal(digest.counts.omittedCodes, 6);
  const formatted = formatDiagnosticDigest({ codes: digest.codes, windowHours: 24, maxLines: 2 });
  assert.deepEqual(formatted, digest);
  assert.equal(Buffer.compare(Buffer.from(formatted.text), Buffer.from(digest.text)), 0);
});

test('formatter sanitizes structured codes and never accepts supplied preformatted text', () => {
  const malicious = {
    text: 'C:/private/MEMORY.md session-private query-private gpt-6',
    codes: [{ code: 'snapshot-build', count: 2 }, { code: 'session-private', count: 1 },
      { code: 'gpt-6', count: 1 }, { code: 'C:/private', count: 1 }]
  };
  const out = formatDiagnosticDigest(malicious);
  assert.deepEqual(out.codes, [{ code: 'snapshot-build', count: 2 }]);
  assert.equal(out.text, '[记忆诊断] 最近 24h 错误 2 条：snapshot-build×2');
  assert(!JSON.stringify(out).includes('private'));
  assert(!JSON.stringify(out).includes('gpt-6'));
  assert.throws(() => formatDiagnosticDigest({ codes: 'invalid' }),
    error => error.code === 'diagnostic-invalid-option' && error.field === 'codes');
});

