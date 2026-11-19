/**
 * Optional, read-only diagnostic digest for delivery Policy v2.
 *
 * Current diag() records ISO timestamp + a free-form message. Only known static
 * error prefixes map to fixed public codes; arbitrary log text is never emitted.
 * Structured JSONL records require error/fatal level and a registered code.
 * readFile must be synchronous so the production snapshot renderer stays sync.
 */
export const DIAGNOSTIC_CODE_PATTERN = /^[a-z0-9:_-]{1,40}$/;

const PUBLIC_CODES = new Set([
  'snapshot-build', 'snapshot-upgrade', 'wal-flush', 'config-migration',
  'config-write', 'event-store-read', 'event-projection', 'event-write',
  'portrait-build', 'rules-read', 'greeting-build', 'plan-redraw',
  'water-check', 'auto-continue', 'session-restore', 'semantic-recall',
  'notification-commit',
]);

/** Syntax is independently enforced; registration is a second privacy boundary. */
export function isDiagnosticCodeSyntax(value) {
  return typeof value === 'string' && DIAGNOSTIC_CODE_PATTERN.test(value);
}

const LEGACY_ERROR_PREFIXES = [
  [/^snapshotUpgradeEvidencePre failed:/, 'snapshot-upgrade'],
  [/^evidence baseline snapshot failed:/, 'snapshot-build'],
  [/^snapshot build failed:/, 'snapshot-build'],
  [/^snapshot-build failed:/, 'snapshot-build'],
  [/^wal flush failed:/, 'wal-flush'],
  [/^wal-flush failed:/, 'wal-flush'],
  [/^config: legacy merge failed\b/, 'config-migration'],
  [/^config: period unify failed\b/, 'config-migration'],
  [/^config(?: save| write)? failed:/, 'config-write'],
  [/^event-store 读取失败，事件层降级为空:/, 'event-store-read'],
  [/^事件层预计算失败，已降级为空:/, 'event-projection'],
  [/^画像段预计算失败，已降级为空:/, 'portrait-build'],
  [/^画像去重取规约层失败，本轮按「无可去重规约」处理:/, 'rules-read'],
  [/^精简版事件\/画像段渲染失败(?:$|:)/, 'snapshot-build'],
  [/^问候环节预计算失败，退回静态文案:/, 'greeting-build'],
  [/^memory_note Phase3 补偿写入失败:/, 'wal-flush'],
  [/^memory_note 文档已写、事件未记:/, 'event-write'],
  [/^memory_note 事件侧写入失败:/, 'event-write'],
  [/^事件后白板重绘(?:失败|异常):/, 'plan-redraw'],
  [/^checkWaterLevel(?:AtStep)? error:/, 'water-check'],
  [/^(?:armAutoContinue|tickAutoContinue|hostAutoContinue) error:/, 'auto-continue'],
  [/^restoreLastAgent error:/, 'session-restore'],
];

function result(enabled, text = '', codes = [], errors = 0, omittedCodes = 0, warnings = []) {
  const rows = Object.freeze(codes.map(row => Object.freeze({ code: row.code, count: row.count })));
  return Object.freeze({
    enabled,
    text,
    codes: rows,
    counts: Object.freeze({ errors, codes: rows.length,
      displayedCodes: rows.length - omittedCodes, omittedCodes }),
    chars: Object.freeze({ total: text.length, utf8Bytes: Buffer.byteLength(text, 'utf8') }),
    priority: 'normal',
    warnings: Object.freeze(warnings.slice()),
  });
}

function invalid(field) {
  const error = new TypeError('invalid diagnostic option: ' + field);
  error.code = 'diagnostic-invalid-option';
  error.field = field;
  throw error;
}

function asTimestamp(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function structuredRecord(row, outerTimestamp) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (row.level !== 'error' && row.level !== 'fatal') return null;
  const code = row.code;
  // A syntactically valid session/query/model string is still not a diagnostic code.
  if (!isDiagnosticCodeSyntax(code) || !PUBLIC_CODES.has(code)) return null;
  const timestamp = outerTimestamp ?? asTimestamp(row.at ?? row.timestamp);
  if (timestamp === null) return null;
  const count = row.count === undefined ? 1 : row.count;
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  return { timestamp, code, count };
}

function parseRecord(line) {
  const plainLine = line.trim();
  if (!plainLine) return null;
  if (plainLine[0] === '{') {
    try { return structuredRecord(JSON.parse(plainLine), null); } catch (_) { return null; }
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.*)$/.exec(plainLine);
  if (!match) return null;
  const timestamp = asTimestamp(match[1]);
  if (timestamp === null) return null;
  const message = match[2];
  if (message[0] === '{') {
    try { return structuredRecord(JSON.parse(message), timestamp); } catch (_) { return null; }
  }
  const found = LEGACY_ERROR_PREFIXES.find(([pattern]) => pattern.test(message));
  return found ? { timestamp, code: found[1], count: 1 } : null;
}

/**
 * Pure public formatter shared by preview and the file provider.
 * codes is the entire recognized aggregate, not pre-rendered log text.
 * Its output codes contains all safe aggregates; counts identifies rows shown.
 */
export function formatDiagnosticDigest(input) {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const windowHours = o.windowHours === undefined ? 24 : o.windowHours;
  const maxLines = o.maxLines === undefined ? 5 : o.maxLines;
  if (!Number.isSafeInteger(windowHours) || windowHours < 1 || windowHours > 168) invalid('windowHours');
  if (!Number.isSafeInteger(maxLines) || maxLines < 0 || maxLines > 5) invalid('maxLines');
  if (!Array.isArray(o.codes)) invalid('codes');
  const aggregate = new Map();
  let total = 0;
  let countOverflow = false;
  for (const row of o.codes) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || !isDiagnosticCodeSyntax(row.code) || !PUBLIC_CODES.has(row.code)
        || !Number.isSafeInteger(row.count) || row.count <= 0) continue;
    if (!Number.isSafeInteger(total + row.count)) { countOverflow = true; continue; }
    total += row.count;
    aggregate.set(row.code, (aggregate.get(row.code) || 0) + row.count);
  }
  const warnings = countOverflow ? ['diagnostic-count-overflow'] : [];
  if (!total) return result(true, '', [], 0, 0, warnings);
  const sorted = [...aggregate].map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, 'en'));
  const header = '[记忆诊断] 最近 ' + windowHours + 'h 错误 ' + total + ' 条：';
  const shown = [];
  for (const row of sorted) {
    if (shown.length >= maxLines) break;
    const next = shown.concat(row).map(item => item.code + '×' + item.count).join(', ');
    if (header.length + next.length > 300) break;
    shown.push(row);
  }
  const text = shown.length ? header + shown.map(row => row.code + '×' + row.count).join(', ') : '';
  return result(true, text, sorted, total, sorted.length - shown.length, warnings);
}

/**
 * @param {{enabled?:boolean,file?:string,now?:number,windowHours?:number,
 *   maxLines?:number,readFile?:function}} input
 * @returns {{enabled:boolean,text:string,codes:Array<{code:string,count:number}>,
 *   counts:object,chars:{total:number,utf8Bytes:number},priority:'normal',warnings:string[]}}
 *
 * enabled !== true is a zero-IO fast path. No file/clock/reader getters are touched
 * on that path. Enabled mode accepts 1..168 whole hours and 0..5 code rows.
 * It returns at most one line, and never cuts a code or count to satisfy 300 chars.
 */
export function readDiagnosticDigest(input) {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (o.enabled !== true) return result(false);

  const now = o.now;
  const windowHours = o.windowHours === undefined ? 24 : o.windowHours;
  const maxLines = o.maxLines === undefined ? 5 : o.maxLines;
  if (!Number.isSafeInteger(now) || now < 0) invalid('now');
  if (!Number.isSafeInteger(windowHours) || windowHours < 1 || windowHours > 168) invalid('windowHours');
  if (!Number.isSafeInteger(maxLines) || maxLines < 0 || maxLines > 5) invalid('maxLines');
  if (maxLines === 0) return result(true);
  if (typeof o.file !== 'string' || !o.file.trim()) invalid('file');
  if (typeof o.readFile !== 'function') invalid('readFile');

  let raw;
  try { raw = o.readFile(o.file, 'utf8'); }
  catch (_) { return result(true, '', [], 0, 0, ['diagnostic-read-failed']); }
  if (raw && typeof raw.then === 'function') {
    // An accidentally async reader must not leave an unhandled rejected promise.
    Promise.resolve(raw).catch(() => {});
    return result(true, '', [], 0, 0, ['diagnostic-sync-reader-required']);
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw !== 'string') return result(true, '', [], 0, 0, ['diagnostic-text-required']);

  const cutoff = now - windowHours * 3600000;
  const codes = [];
  for (const line of raw.split(/\r?\n/)) {
    const record = parseRecord(line);
    if (!record || record.timestamp < cutoff || record.timestamp > now) continue;
    codes.push({ code: record.code, count: record.count });
  }
  return formatDiagnosticDigest({ codes, windowHours, maxLines });
}

