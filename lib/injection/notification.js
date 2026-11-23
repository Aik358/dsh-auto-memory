/**
 * lib/injection/notification.js —— B3-NT：通知与定稿（L1 §4.8）
 *
 * prepareNotificationPre({scanResult}) → {id,version,payload,commitToken}
 * finalizeInjectionPre({requestId,text,prepared}) → {text,finalizeReceipt,selectedNotificationIds}
 * commitNotificationPre({requestId,finalizeReceipt,finalizedText?,store}) → {committed,skipped,errors}
 * Missing finalizedText preserves legacy commit with explicit unverified degradation; supplied text is strictly checked.
 *
 * 契约（L1 §4.8 / L2 §7.1 逐条）：
 *   · **prepare 只读**：不消费、不清 planUpdatePending、不推进水位、不发通知；
 *   · **finalize 只产生插件最终文本与候选身份**，**不冒充宿主已交付**（hostObservation=unknown）；
 *   · **commit 只提交最终保留的身份与版本**；**旧版本不得清掉新待办**；
 *   · **同请求幂等**；**写盘失败显式报错并可重试**；
 *   · planUpdatePending / _recallJustDelivered 与 CA 的 water/postCompact/full grant **分开处理**；
 *   · 运行时状态必须通过**显式 runtimeScope/sessionId** 写入，**不得使用无 ALS 上下文的默认 runtime**。
 */

import { INJECTION_ERROR_CODES, fail } from './errors.js';
import { makePreparedNotification, makeFinalizeReceipt, makeDeliveryReceipt } from './dto.js';
import { createHash } from 'node:crypto';

/** sha256（finalizeReceipt 需要 textSha256）。 */
function sha256(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/**
 * ★ prepare：**只读**。给定 scanResult 产出待发通知候选。
 *
 * ★★**绝对副作用禁止清单**（每条都有对应负向断言）：
 *   · 不清 planUpdatePending；
 *   · 不推进 waterPct / waterFired；
 *   · 不写 _recallJustDelivered；
 *   · 不发送任何通知（只产 candidate）；
 *   · 不消费 scanResult（同对象二次调用产出**同 id/version**）。
 *
 * @param {object} input {scanResult, runtimeScope, sessionId, prevVersion}
 */
export function prepareNotificationPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  // ★runtimeScope / sessionId 必填：缺了就拒绝，**不回落默认 runtime**
  const runtimeScope = o.runtimeScope;
  const sessionId = o.sessionId;
  if (typeof runtimeScope !== 'string' || !runtimeScope) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD,
      'prepareNotificationPre requires explicit runtimeScope (no default runtime fallback)', { field: 'runtimeScope' });
  }
  if (typeof sessionId !== 'string' || !sessionId) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD,
      'prepareNotificationPre requires explicit sessionId (no default runtime fallback)', { field: 'sessionId' });
  }

  const scan = o.scanResult && typeof o.scanResult === 'object' ? o.scanResult : null;
  if (!scan) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'prepareNotificationPre requires scanResult', { field: 'scanResult' });
  }

  // 只读地读取「是否有待办」——**不写回、不清除**
  const pending = scan.planUpdatePending;
  const hasPending = pending === true
    || (pending !== null && typeof pending === 'object' && !Array.isArray(pending));
  const due = Array.isArray(scan.due) ? scan.due : [];
  const dueKey = due.map((x) => String(x && (x.id || x.key || x) || '')).join('|');
  const payload = typeof scan.payload === 'string' ? scan.payload
    : hasPending ? 'planUpdatePending:true;due:' + dueKey
      : 'planUpdatePending:false;due:' + dueKey;

  // ★幂等：同 (runtimeScope,sessionId,payload) ⇒ 同 id / 同 version / 同 commitToken
  const digest = sha256(runtimeScope + '\u0000' + sessionId + '\u0000' + payload).slice(0, 16);
  const id = 'notif_' + digest;
  const version = Number.isFinite(Number(o.prevVersion)) ? Number(o.prevVersion) + 1 : 1;
  const commitToken = 'ct_' + sha256(id + '\u0000' + version + '\u0000' + payload).slice(0, 24);

  return makePreparedNotification({ id, version, payload, commitToken });
}

/**
 * ★ finalize：定稿插件文本与候选身份。
 *
 * ★**不冒充宿主已交付**：`finalizeReceipt.hostObservation` 恒为 unknown。
 * 也**不**在这里推进水位/清待办（那是 commit 的事，且只提交最终保留版本）。
 */
export function finalizeInjectionPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const requestId = o.requestId;
  if (typeof requestId !== 'string' || !requestId) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'finalizeInjectionPre requires requestId', { field: 'requestId' });
  }
  const text = typeof o.text === 'string' ? o.text : '';
  const prepared = Array.isArray(o.prepared) ? o.prepared : [];
  if (o.retainedNotificationIds !== undefined && (!Array.isArray(o.retainedNotificationIds)
      || o.retainedNotificationIds.some(id => typeof id !== 'string' || !id))) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'retainedNotificationIds must contain non-empty strings', { field: 'retainedNotificationIds' });
  }
  const retained = o.retainedNotificationIds === undefined ? null : new Set(o.retainedNotificationIds);
  const selected = [];
  const versions = {};
  const seen = new Map();
  const degradations = [];
  for (const raw of prepared) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '');
    if (!id) continue;
    if (['__proto__', 'prototype', 'constructor'].includes(id)) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'reserved notification identity', { field: 'prepared.id' });
    }
    const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0;
    if (!Number.isSafeInteger(version) || version < 0) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'notification version must be a non-negative integer', { field: 'prepared.version' });
    }
    if (typeof raw.payload !== 'string' || !raw.payload.trim()) {
      // Legacy partial prepared records stay accepted, but cannot prove retained content.
      degradations.push(Object.freeze({ code: 'notification-payload-unverified', scope: 'notification',
        message: 'prepared notification has no non-empty payload; identity was not selected' }));
      continue;
    }
    const payload = raw.payload;
    const token = typeof raw.commitToken === 'string' ? raw.commitToken : null;
    const prior = seen.get(id);
    if (prior && (prior.version !== version || prior.payload !== payload || prior.token !== token)) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'conflicting prepared notification identity', { field: 'prepared' });
    }
    if (prior) continue;
    seen.set(id, { version, payload, token });
    if (!text.includes(payload) || (retained && !retained.has(id))) continue;
    selected.push(id);
    versions[id] = version;
  }
  const finalizeReceipt = makeFinalizeReceipt({
    requestId, textSha256: sha256(text),
    selectedNotificationIds: selected, preparedVersions: versions,
    hostObservation: { requestId, projected: 'unknown', retained: 'unknown', observedAt: null, evidenceRef: null },
  });
  return Object.freeze({
    dtoKind: 'FinalizeResult', schemaVersion: 1, text, finalizeReceipt,
    selectedNotificationIds: Object.freeze(selected.slice()),
    degradations: Object.freeze(degradations),
  });
}

/**
 * ★ commit：只提交**最终保留**的身份与版本。
 *
 * 契约要点：
 *   · **旧版本不得清掉新待办**：若存储里已有更高 version，旧 commit 被**跳过**（skipped），
 *     且**不得**清除 planUpdatePending；
 *   · **同请求幂等**：同一 (requestId, version, textSha256) 重复 commit ⇒ committed 一次，后续 skipped；
 *   · **写盘失败显式报错并可重试**：store.write 抛错 ⇒ 返回 errors（不吞），且**不得**标记为已提交
 *     ⇒ 下次同请求重试仍会尝试（因为没写入状态）。
 *
 * @param {object} input
 *   requestId, finalizeReceipt
 *   finalizedText —— 可选；提供时核对最终文本hash，省略时保留旧提交行为并返回unverified降级。
 *   store —— {read(requestId), write(requestId, record)}（由调用方注入，本层不自己碰 fs）
 *     record沿用{requestId, versions, textSha256, selectedNotificationIds, committedAt}。
 *     没有新选中版本时不调用write；对应requestId记录可能不存在，不能据此推断versions改名。
 */
export function commitNotificationPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const requestId = o.requestId;
  if (typeof requestId !== 'string' || !requestId) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'commitNotificationPre requires requestId', { field: 'requestId' });
  }
  const receipt = o.finalizeReceipt;
  if (!receipt || typeof receipt !== 'object') {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'commitNotificationPre requires finalizeReceipt', { field: 'finalizeReceipt' });
  }
  if (receipt.requestId !== requestId) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'finalize receipt belongs to another request', { field: 'finalizeReceipt.requestId' });
  }
  const hasFinalizedText = o.finalizedText !== undefined;
  if (hasFinalizedText && typeof o.finalizedText !== 'string') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'finalizedText must be a string when supplied', { field: 'finalizedText' });
  }
  const textSha256 = typeof receipt.textSha256 === 'string' ? receipt.textSha256 : '';
  if (hasFinalizedText && textSha256 !== sha256(o.finalizedText)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'finalizedText hash does not match finalize receipt', { field: 'finalizeReceipt.textSha256' });
  }
  const selected = receipt.selectedNotificationIds;
  const preparedVersions = receipt.preparedVersions;
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length
      || !preparedVersions || typeof preparedVersions !== 'object') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'invalid selected notification identities or versions', { field: 'finalizeReceipt' });
  }
  for (const id of selected) {
    const v = preparedVersions[id];
    if (typeof id !== 'string' || !id || ['__proto__', 'prototype', 'constructor'].includes(id)
        || !Object.prototype.hasOwnProperty.call(preparedVersions, id) || !Number.isSafeInteger(v) || v < 0) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'selected notification lacks a valid prepared version', { field: 'finalizeReceipt.preparedVersions' });
    }
  }
  const store = o.store;
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'commitNotificationPre requires synchronous read()/write() store', { field: 'store' });
  }
  const degradations = hasFinalizedText ? [] : [Object.freeze({
    code: 'notification-text-unverified', scope: 'notification',
    message: 'legacy commit omitted finalizedText; text hash was not recomputed',
  })];
  for (const degradation of degradations) {
    try {
      if (typeof o.onDegradation === 'function') {
        const pending = o.onDegradation(degradation);
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      }
    } catch (_) {}
  }
  // Extra diagnostics remain return-level fields; the existing DeliveryReceipt DTO is unchanged.
  const finish = (committed, skipped, errors, skippedDetail = []) => Object.freeze(Object.assign({},
    makeDeliveryReceipt({
      requestId, finalizedText: hasFinalizedText ? o.finalizedText : '',
      selectedNotificationIds: selected.slice(), committed, skipped, errors,
    }), {
      skippedDetail: Object.freeze(skippedDetail.slice()),
      degradations: Object.freeze(degradations.slice()),
      verification: Object.freeze({ requestId: 'matched', finalizedText: hasFinalizedText ? 'verified' : 'unverified' }),
    }));
  let prev = null;
  try {
    prev = store.read(requestId);
    if (prev && typeof prev.then === 'function') {
      Promise.resolve(prev).catch(() => {});
      throw new Error('notification store.read must be synchronous');
    }
  } catch (e) {
    return finish([], [], [{ code: 'store-read-failed', message: String((e && e.message) || e) }]);
  }
  const prevVersions = prev && prev.versions && typeof prev.versions === 'object' ? prev.versions : {};
  const nextVersions = Object.assign({}, prevVersions);
  const committed = [];
  const skippedDetail = [];
  for (const id of selected) {
    const version = preparedVersions[id];
    const oldVersion = Number.isFinite(Number(prevVersions[id])) ? Number(prevVersions[id]) : -1;
    if (oldVersion >= version && oldVersion !== -1) {
      skippedDetail.push({ id, reason: 'stale-version', prevVersion: oldVersion, version });
      continue;
    }
    nextVersions[id] = version;
    committed.push(id);
  }
  const skipped = skippedDetail.map(item => item.id);
  if (committed.length) {
    try {
      const saved = store.write(requestId, {
        requestId, versions: nextVersions, textSha256,
        selectedNotificationIds: selected.slice(), committedAt: o.now === undefined ? null : o.now,
      });
      if (saved && typeof saved.then === 'function') {
        Promise.resolve(saved).catch(() => {});
        throw new Error('notification store.write must be synchronous');
      }
      if (saved === false || (saved && saved.ok === false)) throw new Error('notification store.write explicitly rejected the commit');
    } catch (e) {
      return finish([], skipped, [{ code: 'store-write-failed', message: String((e && e.message) || e) }], skippedDetail);
    }
  }
  return finish(committed, skipped, [], skippedDetail);
}

/**
 * ★ 把「待办/水位/授予」三类状态**分开处理**（L1 §4.8 末条）。
 * 本函数只做**归类**，不写任何状态；供适配器显式提交时使用。
 */
export function splitRuntimeSignalsPre(signals) {
  const s = signals && typeof signals === 'object' ? signals : {};
  return Object.freeze({
    // 待办类：由 NT 负责
    pending: Object.freeze({ planUpdatePending: s.planUpdatePending === true
      || (s.planUpdatePending !== null && typeof s.planUpdatePending === 'object' && !Array.isArray(s.planUpdatePending)) }),
    // 召回交付类：**只由真实 Reference Tail 交付路径写入**（本层只读）
    recall: Object.freeze({ recallJustDelivered: s.recallJustDelivered === true }),
    // 节奏类：归 CA，**与上面两类分开**
    cadence: Object.freeze({
      waterPct: Number.isFinite(Number(s.waterPct)) ? Number(s.waterPct) : null,
      fullGranted: s.fullGranted === true,
      postCompact: s.postCompact === true,
    }),
  });
}

/** 注册专用 port（供 DI facade 使用）。 */
export function createNotificationPort(getInput, fn) {
  if (typeof getInput !== 'function' || typeof fn !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createNotificationPort requires (getInput, fn)');
  }
  return (() => fn(getInput()));
}