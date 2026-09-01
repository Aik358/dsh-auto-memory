#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M7-0/M7-1 deterministic fake Python sidecar worker (docs/PYTHON-SIDECAR-CONTRACT.md).

Discipline:
  - Python standard library ONLY; no third-party dependencies.
  - stdin/stdout: one UTF-8 JSON object per line; stdout carries PROTOCOL FRAMES ONLY;
    bounded diagnostics go to stderr.
  - Deterministic: identical fixture input produces byte-identical output frames
    (no wall clock, no randomness; sentAt/frameId are derived from the request).
  - No HTTP listener; no reads of DSH files/Markdown/sidecars/session logs/workspace files.
  - The ONLY filesystem write is the rebuildable derived corpus under
    <dsh-home>/memory/semantic/ (path supplied explicitly by JS via --dsh-home;
    never discovered). Atomic switch = temp file + os.replace.
  - Creates no evidence, no ReferenceTailPacket, no prompt text.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile

PROTOCOL = 'm7_wire_v1'
NAMESPACE = 'dsh-auto-memory'
INDEX_POLICY = 'index_sync_v1'
MAX_LINE_BYTES = 256 * 1024
MAX_RECORDS_PER_PAGE = 64
STDERR_BUDGET = 64

JS_TYPES = frozenset(['health', 'context_push', 'index_sync_begin', 'index_sync_page',
                      'index_sync_commit', 'cancel', 'close_session'])
PY_TYPES = frozenset(['health_result', 'context_ack', 'index_ack', 'activation_request', 'error'])

RE_MEMORY_ID = re.compile(r'^mem_[0-9a-f]{32}$')
RE_HEX64 = re.compile(r'^[0-9a-f]{64}$')
RE_IDX = re.compile(r'^idx_[0-9a-f]{32}$')
RE_WSR = re.compile(r'^wsr_[0-9a-f]{32}$')
RE_OBS = re.compile(r'^obs_')
RE_SOURCE_REF = re.compile(r'^(user|workspace|workspace-log):[A-Za-z0-9._\u4e00-\u9fff-]+$')

_stderr_used = {'n': 0}


def diag(msg):
    """Bounded diagnostics: never stdout."""
    if _stderr_used['n'] >= STDERR_BUDGET:
        return
    _stderr_used['n'] += 1
    try:
        sys.stderr.write('[worker_v1] ' + str(msg)[:400] + '\n')
        sys.stderr.flush()
    except Exception:
        pass


def first32(h):
    return h[:32]


def sha_hex(data):
    return hashlib.sha256(data).hexdigest()


def sha_str(s):
    return sha_hex(str(s).encode('utf-8'))


def dumps(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def canonical(v):
    """Byte-identical twin of lib/m7-wire.js canonicalJson()."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float, str)):
        return dumps(v)
    if isinstance(v, list):
        return '[' + ','.join(canonical(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(dumps(str(k)) + ':' + canonical(v[k]) for k in sorted(v.keys())) + '}'
    return 'null'


class ProtocolError(Exception):
    def __init__(self, code, detail=''):
        super().__init__(code + (':' + detail if detail else ''))
        self.code = code
        self.detail = detail


# ---------- payload validators (mirror of lib/m7-wire.js) ----------


def validate_semantic_record(rec):
    if not isinstance(rec, dict):
        raise ProtocolError('invalid-record', 'not-object')
    def need(cond, field):
        if not cond:
            raise ProtocolError('invalid-record', field)
    need(RE_MEMORY_ID.match(str(rec.get('memoryId', ''))), 'memoryId')
    need(isinstance(rec.get('anchorId'), str) and rec.get('anchorId'), 'anchorId')
    need(rec.get('scope') in ('Workspace', 'User'), 'scope')
    need(RE_WSR.match(str(rec.get('workspaceRef', ''))), 'workspaceRef')
    need(RE_SOURCE_REF.match(str(rec.get('sourceRef', ''))), 'sourceRef')
    need(isinstance(rec.get('sourceEpoch'), str) and rec.get('sourceEpoch'), 'sourceEpoch')
    need(isinstance(rec.get('sourceVersion'), int) and not isinstance(rec.get('sourceVersion'), bool)
         and rec.get('sourceVersion') >= 1, 'sourceVersion')
    need(RE_HEX64.match(str(rec.get('fileDigest', ''))), 'fileDigest')
    need(RE_HEX64.match(str(rec.get('recordDigest', ''))), 'recordDigest')
    need(rec.get('heading') is None or isinstance(rec.get('heading'), str), 'heading')
    need(isinstance(rec.get('text'), str), 'text')
    need(isinstance(rec.get('chunkId'), str) and str(rec.get('chunkId')).startswith('chk_'), 'chunkId')
    ordinal = rec.get('chunkOrdinal')
    count = rec.get('chunkCount')
    need(isinstance(ordinal, int) and not isinstance(ordinal, bool) and ordinal >= 0, 'chunkOrdinal')
    need(isinstance(count, int) and not isinstance(count, bool) and count >= 1, 'chunkCount')
    need(ordinal < count, 'chunkOrdinal-range')


def require(cond, code, detail=''):
    if not cond:
        raise ProtocolError(code, detail)


class Worker:
    def __init__(self, expect_epoch, dsh_home):
        self.expect_epoch = str(expect_epoch or '')
        self.dsh_home = str(dsh_home or '')
        self.seen_obs = {}          # observationId -> sessionId (idempotence + close_session purge)
        self.active_sync = None     # at most one in-flight index sync (JS serializes anyway)
        self.derived = {}           # (workspaceRef, scope) -> current committed entry ONLY (old versions discarded)
        self.counts = {'frames': 0, 'errors': 0, 'acks': 0, 'activations': 0, 'commits': 0,
                       'cancels': 0, 'close_sessions': 0}

    # ---------- outbound ----------

    def _frame(self, req, ftype, payload, fid_prefix='res_'):
        rid = str(req.get('requestId', ''))
        return {
            'protocolVersion': PROTOCOL,
            'frameId': fid_prefix + first32(sha_str(rid + ':' + ftype)),
            'requestId': rid,
            'workerEpoch': str(req.get('workerEpoch', '')),
            'type': ftype,
            'payload': payload,
            'sentAt': req.get('sentAt', 0),
        }

    def error_frame(self, req, code, detail=''):
        payload = {'code': code, 'reason': code + (':' + detail if detail else '')}
        return self._frame(req, 'error', payload, fid_prefix='err_')

    # ---------- health ----------

    def corpus_view(self):
        view = []
        for (ws_ref, scope) in sorted(self.derived.keys()):
            e = self.derived[(ws_ref, scope)]
            view.append({'workspaceRef': ws_ref, 'scope': scope,
                         'memoryIndexVersion': e['memoryIndexVersion'],
                         'recordCount': e['recordCount']})
        return view

    def handle_health(self, req):
        payload = {
            'protocol': PROTOCOL,
            'worker': 'fake',
            'capabilities': ['fake-deterministic'],
            'indexPolicyVersion': INDEX_POLICY,
            'corpus': self.corpus_view(),
            'counts': dict(self.counts),
        }
        return [self._frame(req, 'health_result', payload)]

    # ---------- context_push ----------

    def handle_context_push(self, req):
        p = req.get('payload') or {}
        require(isinstance(p, dict), 'invalid-payload', 'not-object')
        require(p.get('kind') == 'context_push', 'invalid-payload', 'kind')
        obs = str(p.get('observationId', ''))
        require(RE_OBS.match(obs), 'invalid-payload', 'observationId')
        session = p.get('session') if isinstance(p.get('session'), dict) else {}
        sid = str((session or {}).get('sessionId', ''))
        ack_payload = {'schemaVersion': 1, 'observationId': obs}
        if obs in self.seen_obs:
            ack_payload['accepted'] = False
            ack_payload['reason'] = 'busy'
            self.counts['acks'] += 1
            return [self._frame(req, 'context_ack', ack_payload)]
        self.seen_obs[obs] = sid
        ack_payload['accepted'] = True
        ack_payload['reason'] = 'ok'
        ack_payload['workerEpoch'] = str(req.get('workerEpoch', ''))
        frames = [self._frame(req, 'context_ack', ack_payload)]
        act = self.maybe_activation(req, p)
        if act is not None:
            frames.append(act)
            self.counts['activations'] += 1
        self.counts['acks'] += 1
        return frames

    def maybe_activation(self, req, p):
        """Deterministic fake ActivationRequestPre copied from JS-owned provenance.
        Emits only when the frame carries valid identity + idx_ index version;
        otherwise stays silent (fail closed). Field-compatible with M6 validator."""
        miv = str((p.get('index') or {}).get('memoryIndexVersion', ''))
        if not RE_IDX.match(miv):
            return None
        session = p.get('session') if isinstance(p.get('session'), dict) else {}
        cursor = p.get('cursor') if isinstance(p.get('cursor'), dict) else {}
        sid = str((session or {}).get('sessionId', ''))
        agent = str((session or {}).get('agentId', ''))
        wskey = str((session or {}).get('workspaceKey', ''))
        scope = (session or {}).get('scope')
        cv = cursor.get('contextVersion')
        if not sid or not agent or not wskey or scope not in ('Session', 'Workspace', 'User'):
            return None
        if not isinstance(cv, int) or isinstance(cv, bool) or cv < 0:
            return None
        obs = str(p.get('observationId', ''))
        refs = p.get('memoryRefs') if isinstance(p.get('memoryRefs'), list) else []
        candidates = []
        for i, ref in enumerate(refs[:8]):
            if not isinstance(ref, dict):
                continue
            mid = str(ref.get('memoryId', ''))
            if not RE_MEMORY_ID.match(mid):
                continue
            aid = str(ref.get('anchorId', ''))
            rscope = ref.get('scope')
            sref = str(ref.get('sourceRef', ''))
            sepoch = str(ref.get('sourceEpoch', ''))
            sver = ref.get('sourceVersion')
            fdig = str(ref.get('fileDigest', ''))
            rdig = str(ref.get('recordDigest', ''))
            if not aid or rscope not in ('Workspace', 'User') or not RE_SOURCE_REF.match(sref):
                continue
            if not sepoch or not isinstance(sver, int) or isinstance(sver, bool) or sver < 1:
                continue
            if not RE_HEX64.match(fdig) or not RE_HEX64.match(rdig):
                continue
            activation_id = 'act_' + first32(sha_str('m7-fake-activation-pre-v1\u0000' + obs))
            cand = {
                'candidateId': 'cand_' + first32(sha_str(activation_id + '\u0000' + mid + '\u0000' + str(i))),
                'memoryId': mid,
                'anchorId': aid,
                'scope': rscope,
                'sourceRef': sref,
                'sourceEpoch': sepoch,
                'sourceVersion': sver,
                'fileDigest': fdig,
                'recordDigest': rdig,
                'score': round(0.9 - 0.05 * len(candidates), 4),
            }
            candidates.append(cand)
        if not candidates:
            return None
        activation_id = 'act_' + first32(sha_str('m7-fake-activation-pre-v1\u0000' + obs))
        created = req.get('sentAt', 0)
        ttl_steps = 2
        activation = {
            'schemaVersion': 1,
            'namespace': NAMESPACE,
            'kind': 'activation_request',
            'activationId': activation_id,
            'observationId': obs,
            'workerEpoch': str(req.get('workerEpoch', '')),
            'sessionId': sid,
            'agentId': agent,
            'workspaceKey': wskey,
            'scope': scope,
            'contextVersion': cv,
            'memoryIndexVersion': miv,
            'threshold': {
                'policyVersion': 'm7_fake_threshold_v1',
                'score': 0.92,
                'threshold': 0.8,
                'reason': 'deterministic fake activation (python worker)',
            },
            'level': 'excerpt',
            'candidates': candidates,
            'ttlSteps': ttl_steps,
            'createdAt': created,
            'expiresAt': created + ttl_steps * 60000,
        }
        return self._frame(req, 'activation_request', {'activation': activation}, fid_prefix='act_')

    # ---------- cancel / close_session (no response frames by contract) ----------

    def handle_cancel(self, req):
        self.counts['cancels'] += 1
        diag('cancel requestId=' + str(req.get('requestId', '')))
        return []

    def handle_close_session(self, req):
        p = req.get('payload') or {}
        sid = str(p.get('sessionId', ''))
        if sid:
            for obs in [o for o, s in self.seen_obs.items() if s == sid]:
                del self.seen_obs[obs]
        self.counts['close_sessions'] += 1
        return []

    # ---------- index_sync (M7-1) ----------

    def handle_index_begin(self, req):
        p = req.get('payload') or {}
        require(isinstance(p, dict), 'invalid-payload', 'not-object')
        require(p.get('schemaVersion') == 1, 'invalid-payload', 'schemaVersion')
        sync_id = str(p.get('syncId', ''))
        require(sync_id.startswith('syn_'), 'invalid-payload', 'syncId')
        ws_ref = str(p.get('workspaceRef', ''))
        require(RE_WSR.match(ws_ref), 'invalid-payload', 'workspaceRef')
        scope = p.get('scope')
        require(scope in ('Workspace', 'User'), 'invalid-payload', 'scope')
        miv = str(p.get('memoryIndexVersion', ''))
        require(RE_IDX.match(miv), 'invalid-payload', 'memoryIndexVersion')
        tuples = p.get('sourceTuples')
        require(isinstance(tuples, list), 'invalid-payload', 'sourceTuples')
        for t in tuples:
            require(isinstance(t, dict), 'invalid-payload', 'sourceTuples.entry')
            require(RE_SOURCE_REF.match(str(t.get('sourceRef', ''))), 'invalid-payload', 'sourceTuples.sourceRef')
            require(isinstance(t.get('sourceEpoch'), str) and t.get('sourceEpoch'), 'invalid-payload', 'sourceTuples.sourceEpoch')
            sv = t.get('sourceVersion')
            require(isinstance(sv, int) and not isinstance(sv, bool) and sv >= 1, 'invalid-payload', 'sourceTuples.sourceVersion')
            require(RE_HEX64.match(str(t.get('fileDigest', ''))), 'invalid-payload', 'sourceTuples.fileDigest')
        record_count = p.get('recordCount')
        page_count = p.get('pageCount')
        require(isinstance(record_count, int) and not isinstance(record_count, bool) and record_count >= 0,
                'invalid-payload', 'recordCount')
        require(isinstance(page_count, int) and not isinstance(page_count, bool) and page_count >= 0,
                'invalid-payload', 'pageCount')
        require((record_count == 0) == (page_count == 0), 'invalid-payload', 'count-consistency')
        require(p.get('indexPolicyVersion') == INDEX_POLICY, 'invalid-payload', 'indexPolicyVersion')
        if self.active_sync is not None:
            return [self.index_ack(req, p, 'begin', False, reason='sync-in-progress')]
        self.active_sync = {
            'syncId': sync_id, 'workspaceRef': ws_ref, 'scope': scope, 'memoryIndexVersion': miv,
            'recordCount': record_count, 'pageCount': page_count, 'tuples': tuples,
            'pages': {}, 'next_page': 0, 'received': 0, 'page_digests': [],
        }
        return [self.index_ack(req, p, 'begin', True)]

    def index_ack(self, req, begin_or_page, phase, accepted, reason=None, extra=None):
        src = begin_or_page
        payload = {
            'schemaVersion': 1,
            'syncId': str(src.get('syncId', '')),
            'phase': phase,
            'accepted': bool(accepted),
            'memoryIndexVersion': str(src.get('memoryIndexVersion', '')),
            'workspaceRef': str(src.get('workspaceRef', '')),
            'scope': src.get('scope'),
        }
        if not accepted:
            payload['reason'] = str(reason or 'rejected')
        if extra:
            payload.update(extra)
        self.counts['acks'] += 1
        return self._frame(req, 'index_ack', payload)

    def reject_sync(self, req, base, phase, reason, extra=None):
        """整次 sync 拒绝:任一终局失败即作废 active sync(后续同 syncId 帧 → no-active-sync)。"""
        self.active_sync = None
        return [self.index_ack(req, base, phase, False, reason=reason, extra=extra)]

    def handle_index_page(self, req):
        p = req.get('payload') or {}
        require(isinstance(p, dict), 'invalid-payload', 'not-object')
        st = self.active_sync
        if st is None:
            raise ProtocolError('no-active-sync', 'page-before-begin')
        sync_id = str(p.get('syncId', ''))
        if sync_id != st['syncId']:
            return self.reject_sync(req, st, 'page', 'unknown-sync', extra={'pageNo': p.get('pageNo')})
        base = st
        page_no = p.get('pageNo')
        if not isinstance(page_no, int) or isinstance(page_no, bool) or page_no < 0:
            raise ProtocolError('invalid-payload', 'pageNo')
        if page_no < st['next_page']:
            return self.reject_sync(req, base, 'page', 'page-duplicate', extra={'pageNo': page_no})
        if page_no != st['next_page']:
            return self.reject_sync(req, base, 'page', 'page-out-of-order', extra={'pageNo': page_no})
        if p.get('pageCount') != st['pageCount'] or p.get('schemaVersion') != 1:
            return self.reject_sync(req, base, 'page', 'count-mismatch', extra={'pageNo': page_no})
        # §8.4 页 payload 不含 scope/workspaceRef/memoryIndexVersion 字段:
        # 一致性由 syncId 绑定 begin + 逐条 records 检查 + commit 校验共同承担。
        records = p.get('records')
        require(isinstance(records, list), 'invalid-payload', 'records')
        if len(records) > MAX_RECORDS_PER_PAGE:
            return self.reject_sync(req, base, 'page', 'page-size', extra={'pageNo': page_no})
        if st['received'] + len(records) > st['recordCount']:
            return self.reject_sync(req, base, 'page', 'record-count-mismatch', extra={'pageNo': page_no})
        for r in records:
            validate_semantic_record(r)
            if r.get('workspaceRef') != st['workspaceRef'] or r.get('scope') != st['scope']:
                return self.reject_sync(req, base, 'page', 'record-scope-mismatch', extra={'pageNo': page_no})
        body = dumps(p)
        if len(body.encode('utf-8')) > MAX_LINE_BYTES:
            return self.reject_sync(req, base, 'page', 'page-oversize', extra={'pageNo': page_no})
        recomputed = sha_hex(canonical(records).encode('utf-8'))
        if recomputed != str(p.get('pageDigest', '')):
            return self.reject_sync(req, base, 'page', 'digest-mismatch', extra={'pageNo': page_no})
        st['pages'][page_no] = records
        st['next_page'] = page_no + 1
        st['received'] += len(records)
        st['page_digests'].append(recomputed)
        return [self.index_ack(req, base, 'page', True, extra={
            'pageNo': page_no, 'receivedPages': len(st['pages']), 'receivedRecords': st['received']})]

    def handle_index_commit(self, req):
        p = req.get('payload') or {}
        require(isinstance(p, dict), 'invalid-payload', 'not-object')
        st = self.active_sync
        if st is None:
            raise ProtocolError('no-active-sync', 'commit-before-begin')
        if str(p.get('syncId', '')) != st['syncId']:
            return self.reject_sync(req, st, 'commit', 'unknown-sync')
        if p.get('schemaVersion') != 1:
            return self.reject_sync(req, st, 'commit', 'count-mismatch')
        if str(p.get('memoryIndexVersion', '')) != st['memoryIndexVersion']:
            return self.reject_sync(req, st, 'commit', 'version-mismatch')
        if len(st['pages']) != st['pageCount']:
            return self.reject_sync(req, st, 'commit', 'missing-page')
        if st['received'] != st['recordCount']:
            return self.reject_sync(req, st, 'commit', 'record-count-mismatch')
        flat = []
        for i in range(st['pageCount']):
            flat.extend(st['pages'][i])
        expected_final = sha_hex(canonical({
            'kind': 'index_sync_final_v1',
            'syncId': st['syncId'],
            'memoryIndexVersion': st['memoryIndexVersion'],
            'workspaceRef': st['workspaceRef'],
            'scope': st['scope'],
            'recordCount': st['recordCount'],
            'pageCount': st['pageCount'],
            'pageDigests': st['page_digests'],
        }).encode('utf-8'))
        if expected_final != str(p.get('finalDigest', '')):
            return self.reject_sync(req, st, 'commit', 'final-digest-mismatch')
        entry = {
            'memoryIndexVersion': st['memoryIndexVersion'],
            'workspaceRef': st['workspaceRef'],
            'scope': st['scope'],
            'recordCount': st['recordCount'],
            'pageDigests': list(st['page_digests']),
            'finalDigest': expected_final,
            'records': flat,
        }
        self.derived[(st['workspaceRef'], st['scope'])] = entry   # wholesale swap; old version gone
        persisted = self.persist_derived()
        self.counts['commits'] += 1
        ack = self.index_ack(req, st, 'commit', True, extra={
            'recordCount': st['recordCount'], 'pageCount': st['pageCount'], 'persisted': persisted})
        self.active_sync = None
        return [ack]

    def persist_derived(self):
        if not self.dsh_home:
            return False
        dir_path = os.path.join(self.dsh_home, 'memory', 'semantic')
        entries = []
        for key in sorted(self.derived.keys()):
            e = self.derived[key]
            entries.append({
                'workspaceRef': e['workspaceRef'], 'scope': e['scope'],
                'memoryIndexVersion': e['memoryIndexVersion'], 'recordCount': e['recordCount'],
                'pageDigests': e['pageDigests'], 'finalDigest': e['finalDigest'],
                'records': e['records'],
            })
        payload = {'schemaVersion': 1, 'namespace': NAMESPACE,
                   'policyVersion': 'semantic_derived_v1', 'entries': entries}
        data = (dumps(payload) + '\n').encode('utf-8')
        try:
            os.makedirs(dir_path, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=dir_path, prefix='.tmp-derived-', suffix='.json')
            try:
                with os.fdopen(fd, 'wb') as fh:
                    fh.write(data)
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, os.path.join(dir_path, 'derived-corpus.json'))
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            return True
        except OSError as exc:
            diag('persist-failed: ' + str(exc))
            return False

    # ---------- dispatch ----------

    def handle_frame(self, req):
        self.counts['frames'] += 1
        ftype = req.get('type')
        if ftype == 'health':
            return self.handle_health(req)
        if ftype == 'context_push':
            return self.handle_context_push(req)
        if ftype == 'index_sync_begin':
            return self.handle_index_begin(req)
        if ftype == 'index_sync_page':
            return self.handle_index_page(req)
        if ftype == 'index_sync_commit':
            return self.handle_index_commit(req)
        if ftype == 'cancel':
            return self.handle_cancel(req)
        if ftype == 'close_session':
            return self.handle_close_session(req)
        raise ProtocolError('unknown-type', str(ftype))


def obs_id_of(payload):
    return str(payload.get('observationId', ''))


def envelope_shape_ok(obj):
    return (isinstance(obj, dict)
            and obj.get('protocolVersion') == PROTOCOL
            and isinstance(obj.get('frameId'), str) and obj.get('frameId')
            and isinstance(obj.get('requestId'), str)
            and isinstance(obj.get('workerEpoch'), str)
            and obj.get('type') in JS_TYPES
            and isinstance(obj.get('payload'), dict)
            and isinstance(obj.get('sentAt'), (int, float))
            and not isinstance(obj.get('sentAt'), bool))


def run_selftest():
    checks = 0
    assert canonical({'b': 1, 'a': ['x', {'z': None, 'y': True}]}) == '{"a":["x",{"y":true,"z":null}],"b":1}'
    checks += 1
    assert canonical('中\n"文"') == dumps('中\n"文"')
    checks += 1
    w = Worker('ep', '')
    req = {'requestId': 'r1', 'workerEpoch': 'ep', 'sentAt': 12, 'frameId': 'f', 'type': 'health', 'payload': {}}
    frames = w.handle_frame(req)
    assert len(frames) == 1 and frames[0]['type'] == 'health_result' and frames[0]['sentAt'] == 12
    assert frames[0]['frameId'] == 'res_' + first32(sha_str('r1:health_result'))
    checks += 1
    push = {'requestId': 'r2', 'workerEpoch': 'ep', 'sentAt': 20, 'frameId': 'f2', 'type': 'context_push',
            'payload': {'kind': 'context_push', 'observationId': 'obs_' + '0' * 32,
                        'session': {'sessionId': 's', 'agentId': 'a', 'workspaceKey': 'w', 'scope': 'Workspace'},
                        'cursor': {'eventSeq': 1, 'contextVersion': 3},
                        'index': {'memoryIndexVersion': 'idx_' + 'ab' * 16}, 'memoryRefs': []}}
    f2 = w.handle_frame(push)
    assert len(f2) == 1 and f2[0]['payload']['accepted'] is True
    again = w.handle_frame(push)
    assert again[0]['payload']['accepted'] is False and again[0]['payload']['reason'] == 'busy'
    checks += 1
    sys.stderr.write('SELFTEST OK ' + str(checks) + ' checks\n')


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('--expect-epoch', default='')
    ap.add_argument('--dsh-home', default='')
    ap.add_argument('--selftest', action='store_true')
    args, _unknown = ap.parse_known_args()
    if args.selftest:
        run_selftest()
        return 0
    worker = Worker(args.expect_epoch, args.dsh_home)
    out = sys.stdout.buffer
    inp = sys.stdin.buffer
    while True:
        raw = inp.readline(MAX_LINE_BYTES + 2)
        if raw == b'':
            break
        ended_with_newline = raw.endswith(b'\n')
        line = raw[:-1] if ended_with_newline else raw
        oversized = (len(line) > MAX_LINE_BYTES) or (not ended_with_newline and len(raw) >= MAX_LINE_BYTES + 1)
        if oversized:
            err = worker.error_frame({'requestId': '', 'workerEpoch': '', 'sentAt': 0}, 'line-oversize')
            out.write((dumps(err) + '\n').encode('utf-8'))
            out.flush()
            break  # fail closed: cannot resync a lost framing boundary
        req_for_error = {'requestId': '', 'workerEpoch': '', 'sentAt': 0}
        try:
            obj = json.loads(line.decode('utf-8'))
            if isinstance(obj, dict):
                req_for_error = {'requestId': str(obj.get('requestId', '')),
                                 'workerEpoch': str(obj.get('workerEpoch', '')),
                                 'sentAt': obj.get('sentAt', 0)}
        except (UnicodeDecodeError, ValueError):
            obj = None
        if not isinstance(obj, dict) or not envelope_shape_ok(obj):
            out.write((dumps(worker.error_frame(req_for_error, 'invalid-envelope')) + '\n').encode('utf-8'))
            out.flush()
            worker.counts['errors'] += 1
            continue
        if worker.expect_epoch and obj['workerEpoch'] != worker.expect_epoch:
            out.write((dumps(worker.error_frame(req_for_error, 'epoch-mismatch')) + '\n').encode('utf-8'))
            out.flush()
            worker.counts['errors'] += 1
            continue
        try:
            frames = worker.handle_frame(obj)
        except ProtocolError as exc:
            worker.counts['errors'] += 1
            frames = [worker.error_frame(req_for_error, exc.code, exc.detail)]
        except Exception as exc:  # noqa: BLE001 - worker must never die on a bad frame
            worker.counts['errors'] += 1
            frames = [worker.error_frame(req_for_error, 'internal-error', str(exc)[:120])]
        for fr in frames:
            out.write((dumps(fr) + '\n').encode('utf-8'))
        out.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
