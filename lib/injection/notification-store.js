/** B3-NT：真实共享锁、revision CAS 与原子写入适配器（仅显式路径，非生产默认）。 */
import { readFileSync, existsSync } from 'node:fs';
import { withSharedStateLock } from '../shared-state-lock.js';
import { writeTextAtomicPreSync } from '../config-io.js';
import { commitNotificationPre } from './notification.js';

/** 在单个通知状态文件的锁内执行 read → revision CAS → 纯提交 → 原子写。 */
export async function commitNotificationToFilePre(input) {
  const o = input && typeof input === 'object' ? input : {};
  if (typeof o.file !== 'string' || !o.file) throw new Error('notification file required');
  const readFile = typeof o.readFile === 'function' ? o.readFile : (p) => existsSync(p) ? readFileSync(p, 'utf8') : null;
  const writeAtomic = typeof o.writeAtomic === 'function' ? o.writeAtomic : writeTextAtomicPreSync;
  const lock = typeof o.withLock === 'function' ? o.withLock : withSharedStateLock;
  return lock(o.file, async () => {
    const raw = readFile(o.file);
    let state = { schemaVersion: 1, revision: 0, versions: {}, textSha256: null, selectedNotificationIds: [] };
    if (raw !== null && raw !== undefined && String(raw).trim()) {
      const parsed = JSON.parse(String(raw));
      if (!parsed || !Number.isInteger(parsed.revision)) throw new Error('notification-state-invalid');
      state = Object.assign(state, parsed);
    }
    if (o.expectedRevision !== undefined && state.revision !== o.expectedRevision) {
      return { ok: false, code: 'notification-revision-conflict', revision: state.revision, committed: [], skipped: [], errors: [{ code: 'notification-revision-conflict', message: 'expected ' + o.expectedRevision + ', actual ' + state.revision }] };
    }
    let nextState = state;
    const store = {
      read() { return state; },
      write(requestId, record) {
        nextState = Object.assign({}, state, record, { schemaVersion: 1, revision: state.revision + 1 });
      },
    };
    const result = commitNotificationPre({ requestId: o.requestId, finalizeReceipt: o.finalizeReceipt, finalizedText: o.finalizedText, store, now: o.now, onDegradation: o.onDegradation });
    if (result.committed.length > 0 && result.errors.length === 0) {
      const saved = writeAtomic(o.file, JSON.stringify(nextState, null, 2));
      if (!saved || saved.ok !== true) {
        return { ok: false, code: 'store-write-failed', revision: state.revision, committed: [], skipped: result.skipped, errors: [{ code: 'store-write-failed', message: String(saved && saved.error) }] };
      }
      return Object.assign({}, result, { ok: true, revision: nextState.revision, lockUsed: true });
    }
    return Object.assign({}, result, { ok: result.errors.length === 0, revision: state.revision, lockUsed: true });
  });
}
