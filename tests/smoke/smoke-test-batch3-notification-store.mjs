import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitNotificationToFilePre } from '../../lib/injection/notification-store.js';
const dir = await mkdtemp(path.join(tmpdir(), 'batch3-nt-store-'));
const file = path.join(dir, 'state.json');
try {
  const receipt = { requestId: 'r1', textSha256: 'a'.repeat(64), selectedNotificationIds: ['n1'], preparedVersions: { n1: 1 }, hostObservation: null };
  const a = await commitNotificationToFilePre({ file, requestId: 'r1', finalizeReceipt: receipt, expectedRevision: 0 });
  assert.equal(a.ok, true); assert.equal(a.revision, 1); assert.equal(a.lockUsed, true);
  const b = await commitNotificationToFilePre({ file, requestId: 'r1', finalizeReceipt: receipt, expectedRevision: 1 });
  assert.equal(b.committed.length, 0); assert.equal(b.ok, true);
  const conflict = await commitNotificationToFilePre({ file, requestId: 'r1', finalizeReceipt: receipt, expectedRevision: 0 });
  assert.equal(conflict.code, 'notification-revision-conflict');
  const old = { ...receipt, textSha256: 'b'.repeat(64), preparedVersions: { n1: 0 } };
  const stale = await commitNotificationToFilePre({ file, requestId: 'r1', finalizeReceipt: old, expectedRevision: 1 });
  assert.equal(stale.committed.length, 0);
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.versions.n1, 1);
  const before = await readFile(file, 'utf8');
  const failed = await commitNotificationToFilePre({ file, requestId: 'r2', finalizeReceipt: { ...receipt, requestId: 'r2', selectedNotificationIds: ['n2'], preparedVersions: { n2: 1 } }, expectedRevision: 1, writeAtomic: () => ({ ok: false, error: 'EPERM' }) });
  assert.equal(failed.ok, false); assert.equal(await readFile(file, 'utf8'), before);
  const retry = await commitNotificationToFilePre({ file, requestId: 'r2', finalizeReceipt: { ...receipt, requestId: 'r2', selectedNotificationIds: ['n2'], preparedVersions: { n2: 1 } }, expectedRevision: 1 });
  assert.equal(retry.ok, true);
  const race = await Promise.allSettled([
    commitNotificationToFilePre({ file, requestId: 'r3', finalizeReceipt: { ...receipt, requestId: 'r3', selectedNotificationIds: ['n3'], preparedVersions: { n3: 1 } }, expectedRevision: 2 }),
    commitNotificationToFilePre({ file, requestId: 'r4', finalizeReceipt: { ...receipt, requestId: 'r4', selectedNotificationIds: ['n4'], preparedVersions: { n4: 1 } }, expectedRevision: 2 }),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled' && r.value.ok === true).length, 1);
  console.log('PASS write failure original preserved + retry + same-revision race serialized');
  console.log('PASS real shared lock + revision CAS + atomic notification store');
} finally { await rm(dir, { recursive: true, force: true }); }
