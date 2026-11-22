import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { EVENT_STORE_FILENAME } from '../event-store.js';
import { fileWithinRoots } from '../file-boundary.js';
import { stripSensitiveSections } from '../injection-policy.js';
import { listLegacyLedgers } from '../legacy-handoff-compat.js';
import {
  applyConsolidationResultPre, buildConsolidationPromptPre, collectConsolidationSourcesPre,
} from './consolidation.js';
import { projectEventSectionsPre } from './event-view.js';

const LOG_SCAN_LIMIT = 60;
const SOURCE_TAIL_CHARS = 2500;
const EXISTING_MEMORY_TAIL_CHARS = 1200;

function readError(code) {
  return Object.assign(new Error(code), { code });
}

async function readWorkspaceText(file, root) {
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) throw readError('invalid-source-file');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const physical = fileWithinRoots(file, [root], { strict: true });
  if (!physical) throw readError('source-outside-workspace');
  return readFile(physical, 'utf8');
}

async function workspaceDirectory(pathname, root) {
  try {
    const directory = await lstat(pathname);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw readError('invalid-source-directory');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!fileWithinRoots(pathname, [root], { strict: true })) throw readError('source-outside-workspace');
  return true;
}

async function addSnapshot(snapshot, channel, ref, read) {
  try {
    const text = await read();
    if (text === null) return false;
    if (typeof text !== 'string') throw readError('invalid-source-text');
    snapshot[channel].push({ ref, text });
    return !!text.trim();
  } catch (error) {
    snapshot[channel].push({ ref, error });
    return false;
  }
}

async function addDailyLogs(snapshot, root, days, listDailyLogs) {
  let logs;
  try {
    logs = await listDailyLogs(root, LOG_SCAN_LIMIT, true);
  } catch (error) {
    snapshot.logs.push({ ref: root, error });
    return;
  }
  let selected = 0;
  for (const log of logs) {
    // Production days counts populated files, even across gaps in the calendar.
    if (selected >= days) break;
    const ref = path.join(root, log.name);
    if (await addSnapshot(snapshot, 'logs', ref, () => readWorkspaceText(ref, root))) selected++;
  }
}

async function addReflections(snapshot, paths, listReflections) {
  try {
    if (!await workspaceDirectory(paths.reflectDir, paths.projectDir)) return;
    const reflections = await listReflections(paths.reflectDir, 30, true);
    for (const reflection of reflections) {
      const ref = path.join(paths.reflectDir, reflection.name);
      await addSnapshot(snapshot, 'reflections', ref, () => readWorkspaceText(ref, paths.projectDir));
    }
  } catch (error) {
    snapshot.reflections.push({ ref: paths.reflectDir, error });
  }
}

async function addLatestLedger(snapshot, paths, readMaintenanceLedger) {
  try {
    if (!await workspaceDirectory(paths.handoffDir, paths.projectDir)) return;
  } catch (error) {
    snapshot.handoff.push({ ref: paths.handoffDir, error });
    return;
  }
  if (readMaintenanceLedger) {
    const documentsDir = path.join(paths.handoffDir, 'documents');
    try {
      if (await workspaceDirectory(documentsDir, paths.projectDir)) {
        const selected = await readMaintenanceLedger(paths.handoffDir);
        if (selected?.ok && selected.document?.documentId) {
          const { documentId, text } = selected.document;
          const ref = path.join(documentsDir, documentId + '.md');
          if (selected.readErrors?.length) snapshot.handoff.push({ ref: documentsDir, error: readError('maintenance-ledger-read-failed') });
          await addSnapshot(snapshot, 'handoff', ref, () => text);
          return;
        }
        if (selected?.ok !== true || selected.readErrors?.length) {
          throw readError(selected?.error || 'maintenance-ledger-read-failed');
        }
      }
    } catch (error) {
      snapshot.handoff.push({ ref: documentsDir, error });
    }
  }
  const listed = await listLegacyLedgers({ handoffDir: paths.handoffDir });
  if (!listed.ok) snapshot.handoff.push({ ref: paths.handoffDir, error: readError('legacy-ledger-list-failed') });
  const latest = listed.items[0];
  if (latest) {
    const ref = path.join(paths.handoffDir, latest.name);
    await addSnapshot(snapshot, 'handoff', ref, () => readWorkspaceText(ref, paths.projectDir));
  }
}

function decodeEventRows(text) {
  if (!text.trim()) return [];
  const store = JSON.parse(text);
  if (!Array.isArray(store?.events)) throw readError('invalid-event-store');
  return store.events.filter(event => event && typeof event.id === 'string' && event.id);
}

function eventContext(text) {
  return decodeEventRows(text).map(event => {
    const fields = [event.summary, ...projectEventSectionsPre(event).map(section => section.text), event.outcome]
      .filter(field => typeof field === 'string' && field.trim()).map(field => field.trim());
    if (!fields.length) return '';
    return ['### ' + String(event.name || event.id).replace(/[\r\n]+/g, ' ') + ' #' + event.id, ...fields].join('\n');
  }).filter(Boolean).join('\n\n');
}

function collectSnapshot(snapshot) {
  const byRef = new Map(Object.values(snapshot).flat().map(entry => [entry.ref, entry]));
  return collectConsolidationSourcesPre({
    readers: Object.fromEntries(Object.entries(snapshot).map(([key, entries]) => [key, entries.map(entry => entry.ref)])),
    readFile(ref) {
      const entry = byRef.get(ref);
      if (entry.error) throw entry.error;
      // Validate the event store separately while fingerprinting the exact source bytes.
      if (ref === snapshot.events[0]?.ref) decodeEventRows(entry.text);
      return entry.text;
    },
  });
}

function projectPromptSources(sources, truncateTail) {
  const textOf = (text, cap) => truncateTail(stripSensitiveSections(text), cap);
  const project = (channel, render) => sources[channel]
    .map(source => ({ ...source, text: render(source) })).filter(source => source.text.trim());
  return {
    ...sources,
    logs: project('logs', ({ ref, text }) => {
      const body = textOf(text, SOURCE_TAIL_CHARS);
      return body ? '### ' + path.basename(ref, '.md') + '\n' + body : '';
    }),
    events: project('events', ({ text }) => textOf(eventContext(text), SOURCE_TAIL_CHARS)),
    plan: project('plan', ({ text }) => textOf(text, SOURCE_TAIL_CHARS)),
    handoff: project('handoff', ({ text }) => textOf(text, SOURCE_TAIL_CHARS)),
    reflections: project('reflections', ({ text }) => textOf(text, SOURCE_TAIL_CHARS)),
  };
}

async function existingMemoryContext(paths, truncateTail) {
  // [DECISION D30B-5 | 2026-11-22 | user ruling] 两份既有记忆都只取原有 1200 字尾部窗口。
  async function tail(file, root) {
    if (!file) return '(空)';
    try {
      const text = await readWorkspaceText(file, root);
      return truncateTail(stripSensitiveSections(text), EXISTING_MEMORY_TAIL_CHARS) || '(空)';
    } catch (_) { return '(读不到已有记忆)'; }
  }
  const [notes, user] = await Promise.all([tail(paths.notesPath, paths.projectDir), tail(paths.userFile, paths.userDir)]);
  return '\n\n已有项目笔记(尾部):\n' + notes + '\n\n已有用户级记忆(尾部):\n' + user;
}

/** Read a workspace snapshot, preserve production's log count, then use the five-source assembler. */
export async function prepareProductionConsolidationPre({
  paths, days, listDailyLogs, listReflections, readMaintenanceLedger, truncateTail,
}) {
  const snapshot = { logs: [], events: [], plan: [], handoff: [], reflections: [] };
  const eventRef = path.join(paths.handoffDir, EVENT_STORE_FILENAME);
  await Promise.all([
    addDailyLogs(snapshot, paths.projectDir, days, listDailyLogs),
    addSnapshot(snapshot, 'events', eventRef, () => readWorkspaceText(eventRef, paths.projectDir)),
    addSnapshot(snapshot, 'plan', paths.planPath, () => readWorkspaceText(paths.planPath, paths.projectDir)),
    addLatestLedger(snapshot, paths, readMaintenanceLedger),
    addReflections(snapshot, paths, listReflections),
  ]);
  const sources = projectPromptSources(collectSnapshot(snapshot), truncateTail);
  const built = buildConsolidationPromptPre({ sources });
  if (!built.counts.inputTotalChars) {
    const message = built.unreadableChannels.length
      ? 'memory_consolidate: 读取来源失败（' + built.unreadableChannels.join('、') + '），没有可提炼的内容。'
      : 'memory_consolidate: 五类来源没有可提炼的内容。';
    return { message, prompt: '', counts: { ...built.counts, promptChars: 0 }, unreadableChannels: built.unreadableChannels };
  }
  const format = '每条一句话。已有记忆中的结论不要重复。只按以下格式输出：\n[PROJECT]\n- 要点\n[USER]\n- 候选规则\n\n';
  const prompt = format + built.prompt + await existingMemoryContext(paths, truncateTail);
  return { prompt, counts: { ...built.counts, promptChars: prompt.length }, unreadableChannels: built.unreadableChannels,
    sourceProofs: built.sourceProofs };
}

/** Parse with the CO contract. The engine still owns all durable writes and admission checks. */
export function parseProductionConsolidationResultPre(result) {
  const projectPts = [];
  const userPts = [];
  const apply = applyConsolidationResultPre({
    parsed: typeof result === 'string' ? { text: result } : result,
    writer: {
      writeProjectNote: points => projectPts.push(...points),
      writeUserPending: points => userPts.push(...points),
    },
  });
  return { projectPts, userPts, reason: apply.skipped[0]?.reason || null };
}
