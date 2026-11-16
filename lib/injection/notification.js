/**
 * lib/injection/notification.js —— B3-NT：通知与定稿（L1 §4.8）
 *
 * prepareNotificationPre({scanResult}) → {id,version,payload,commitToken}
 * finalizeInjectionPre({requestId,text,prepared}) → {text,finalizeReceipt,selectedNotificationIds}
 * commitNotificationPre({requestId,finalizeReceipt,store}) → {committed,skipped,errors}
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
  const hasPending = scan.planUpdatePending === true;
  const due = Array.isArray(scan.due) ? scan.due : [];
  const dueKey = due.map((x) => String(x && (x.id || x.key || x) || '')).join('|');
  const payload = hasPending
    ? 'planUpdatePending:true;due:' + dueKey
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

  const selected = [];
  const versions = {};
  for (const p of prepared) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '');
    if (!id) continue;
    selected.push(id);
    versions[id] = Number.isFinite(Number(p.version)) ? Number(p.version) : 0;
  }

  const finalizeReceipt = makeFinalizeReceipt({
    requestId,
    textSha256: sha256(text),
    selectedNotificationIds: selected,
    preparedVersions: versions,
    // ★恒 unknown：本层只看插件文本，**没有**任何宿主交付证据。
    // ⚠ 注意：dto.js 的 makeFinalizeReceipt 会**再次**调用 makeHostDeliveryObservation
    //   构造观测，而 HostDeliveryObservation 的字段校验会拒绝已冻结的 DTO（带 dtoKind）。
    //   ⇒ 这里必须传**普通对象**，不能直接传 makeUnknownHostObservation() 的产物。
    hostObservation: {
      requestId,
      projected: 'unknown',
      retained: 'unknown',
      observedAt: null,
      evidenceRef: null,
    },
  });

  return Object.freeze({
    dtoKind: 'FinalizeResult',
    schemaVersion: 1,
    text,
    finalizeReceipt,
    selectedNotificationIds: Object.freeze(selected.slice()),
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
 *   store —— {read(requestId), write(requestId, record)}（由调用方注入，本层不自己碰 fs）
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
  const store = o.store;
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT,
      'commitNotificationPre requires store with read()/write() (本层不自行写盘)', { field: 'store' });
  }

  const selected = Array.isArray(receipt.selectedNotificationIds) ? receipt.selectedNotificationIds : [];
  const preparedVersions = receipt.preparedVersions && typeof receipt.preparedVersions === 'object'
    ? receipt.preparedVersions : {};
  const textSha256 = String(receipt.textSha256 || '');

  const committed = [];
  const skipped = [];
  const errors = [];

  let prev = null;
  try {
    prev = store.read(requestId);
  } catch (e) {
    // 读失败不等于写失败；按「无既有记录」处理，但如实记录
    return makeDeliveryReceipt({
      requestId,
      finalizedText: o.finalizedText === undefined ? '' : o.finalizedText,
      selectedNotificationIds: selected.slice(),
      committed: [],
      skipped: [],
      errors: [{ code: 'store-read-failed', message: String((e && e.message) || e) }],
    });
  }
  const prevVersions = (prev && prev.versions && typeof prev.versions === 'object') ? prev.versions : {};
  const prevSha = prev && typeof prev.textSha256 === 'string' ? prev.textSha256 : null;

  const nextVersions = Object.assign({}, prevVersions);
  let wrote = false;

  for (const id of selected) {
    const v = Number.isFinite(Number(preparedVersions[id])) ? Number(preparedVersions[id]) : 0;
    const prevV = Number.isFinite(Number(prevVersions[id])) ? Number(prevVersions[id]) : -1;
    // ★旧版本不得覆盖新版本（新待办不能被旧 commit 清掉）
    if (prevV >= v && prevV !== -1) {
      skipped.push({ id, reason: 'stale-version', prevVersion: prevV, version: v });
      continue;
    }
    nextVersions[id] = v;
    committed.push({ id, version: v });
    wrote = true;
  }

  // 幂等：完全相同的内容与版本 ⇒ 不算新提交
  const sameContent = prevSha !== null && prevSha === textSha256;
  if (!wrote && sameContent) {
    // 全部都是旧版本且文本未变 ⇒ 幂等跳过（不清待办）
  }

  if (wrote) {
    try {
      store.write(requestId, {
        requestId,
        versions: nextVersions,
        textSha256,
        selectedNotificationIds: selected.slice(),
        committedAt: o.now === undefined ? null : o.now,
      });
    } catch (e) {
      // ★写盘失败：显式报错、**不吞**、且不回写任何版本状态（便于重试）
      return makeDeliveryReceipt({
        requestId,
        finalizedText: o.finalizedText === undefined ? '' : o.finalizedText,
        selectedNotificationIds: selected.slice(),
        committed: [],
        // ⚠ DTO 的 skipped 是**字符串数组**（不是对象数组）⇒ 编码为 id 字符串
        skipped: skipped.map((s) => String(s.id)),
        errors: errors.concat([{ code: 'store-write-failed', message: String((e && e.message) || e) }]),
      });
    }
  }

  const deliveryReceipt = makeDeliveryReceipt({
    requestId,
    finalizedText: o.finalizedText === undefined ? '' : o.finalizedText,
    selectedNotificationIds: selected.slice(),
    committed: committed.map((c) => c.id),
    // ⚠ DTO 的 skipped 是**字符串数组**；详细原因另放 skippedDetail（非 DTO 字段）
    skipped: skipped.map((s) => String(s.id)),
    errors,
  });
  return Object.freeze(Object.assign({}, deliveryReceipt, { skippedDetail: Object.freeze(skipped.slice()) }));
}

/**
 * ★ 把「待办/水位/授予」三类状态**分开处理**（L1 §4.8 末条）。
 * 本函数只做**归类**，不写任何状态；供适配器显式提交时使用。
 */
export function splitRuntimeSignalsPre(signals) {
  const s = signals && typeof signals === 'object' ? signals : {};
  return Object.freeze({
    // 待办类：由 NT 负责
    pending: Object.freeze({ planUpdatePending: s.planUpdatePending === true }),
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