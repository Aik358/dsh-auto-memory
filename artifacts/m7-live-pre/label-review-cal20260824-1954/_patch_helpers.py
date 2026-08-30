    # ---- feature v2 shadow wiring (round-1) ----

    def _fv2_append(self, filename, obj):
        if not self.dsh_home:
            return
        d = self._semantic_dir()
        try:
            os.makedirs(d, exist_ok=True)
            fd, tmp = base.tempfile.mkstemp(dir=d, prefix='.tmp-fv2-',
                                            suffix='.jsonl')
            with os.fdopen(fd, 'wb') as fh:
                fh.write((base.dumps(obj) + '\n').encode('utf-8'))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, os.path.join(d, filename))
        except OSError as exc:
            base.diag('fv2-append-failed: ' + str(exc))

    def _fv2_repetition(self, sid, query):
        """30-min decayed counters; logging-only, never activates."""
        now = time.time()
        topic = featv2.normalize_text(query)[:24]
        key = (sid, hashlib.sha256(topic.encode('utf-8')).hexdigest()[:16])
        st = self._fv2_rep.get(key) or {'mentions': 0, 'failures': 0,
                                        'lastSeen': 0}
        if now - st['lastSeen'] > 1800:
            st['mentions'] = 0
            st['failures'] = 0
        st['mentions'] += 1
        st['lastSeen'] = int(now)
        self._fv2_rep[key] = st
        return {'topicKey': key[1], 'mentions': st['mentions'],
                'failures': st['failures'], 'decayWindowSec': 1800}

    def _intent_config_hash(self):
        ip_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               'policies', 'recall_intent_lr_pre_v1.json')
        try:
            with open(ip_path, encoding='utf-8') as f:
                ip = json.load(f)
            probe = {k: v for k, v in ip.items() if k != 'configHash'}
            payload = json.dumps(probe, sort_keys=True, ensure_ascii=False)
            return 'cfgh_' + hashlib.sha256(
                payload.encode('utf-8')).hexdigest()[:32]
        except Exception as exc:
            base.diag('intent-hash-failed: ' + str(exc))
            return None

    def _fv2_shadow_decide(self, req, p, candidates, frames):
        """Round-1: compute the feature-v2 decision alongside v1 and append a
        bounded shadow row. Never emits frames; fail closed when policy
        artifacts are invalid. No raw query text or absolute paths are
        persisted (hash + chars only)."""
        obs = str(p.get('observationId', ''))
        session = p.get('session') or {}
        sid = str(session.get('sessionId', ''))
        query = ' '.join(
            seg.get('text') for seg in ([p.get('trigger')] +
                                        list(p.get('window') or []))
            if isinstance(seg, dict) and isinstance(seg.get('text'), str))[-2000:]
        base_row = {
            'schemaVersion': 1, 'namespace': base.NAMESPACE,
            'featurePolicyVersion': (featv2.FEATURES_POLICY_VERSION
                                     if featv2 else None),
            'observationId': obs, 'queryChars': len(query),
            'candidateCount': len(candidates),
            'v1Available': bool(candidates),
        }
        if self._fv2 is None:
            base_row.update({'shadowReason': 'policy-invalid',
                             'error': self._fv2_invalid[:160]})
            self._fv2_rows += 1
            self._fv2_append('activation-shadow-v2.jsonl', base_row)
            return
        try:
            head = self._fv2['head']
            pol = self._fv2['policy']
            intent = featv2.infer_recall_intent(query, head)
            dact = featv2.infer_dialogue_act(query, intent)
            tneed = featv2.infer_task_need(dact)
            top = candidates[0] if candidates else None
            cand_text = ''
            ws_ref_key = None
            if top is not None:
                for key in self.derived:
                    recs = self.derived[key].get('records') or []
                    if any(rr['memoryId'] == top['memoryId'] for rr in recs):
                        ws_ref_key = key
                        for rr in recs:
                            if rr['memoryId'] == top['memoryId']:
                                cand_text = rr.get('text') or ''
                                break
                        break
            containment = featv2.lexical_containment(query, cand_text)
            dense_top = float(top['score']) if top else 0.0
            second = (float(candidates[1]['score'])
                      if len(candidates) > 1 else 0.0)
            margin = max(0.0, dense_top - second)
            tl = query.lower()
            mark = int(any(x in tl for x in
                           featv2.INTERROG + featv2.RECALL_CTX))
            mem_ref_ids = {mr.get('memoryId')
                           for mr in (p.get('memoryRefs') or [])
                           if isinstance(mr, dict)}
            candidate_hit = bool(mem_ref_ids &
                                 {c['memoryId'] for c in candidates})
            rep = self._fv2_repetition(sid, query)
            evidence = (p.get('evidence')
                        if isinstance(p.get('evidence'), list) else [])
            correction_gate = any(int(e.get('correction') or 0) > 0
                                  for e in evidence
                                  if isinstance(e, dict))
            stale_gate = any(e.get('freshness') == 'stale'
                             for e in evidence if isinstance(e, dict))
            features = {
                'id': obs, 'text': query,
                'denseTop': round(dense_top, 6), 'margin': round(margin, 6),
                'containment': round(containment, 4), 'mark': mark,
                'nCand': len(candidates), 'candidateHit': candidate_hit,
                'resolvedTargets': None, 'requiredHint': None,
                'hardGates': {'correction': correction_gate,
                              'stale': stale_gate},
                'repetition': rep,
                'requiresRelayFlag': False, 'piiClass': 'unknown',
            }
            out = featv2.decide_activation_v2(features, head, pol)
            nh = hashlib.sha256(featv2.normalize_text(query).encode(
                'utf-8')).hexdigest()[:16]
            row = {
                'schemaVersion': 1, 'namespace': base.NAMESPACE,
                'policyVersions': {
                    'features': featv2.FEATURES_POLICY_VERSION,
                    'intent': featv2.INTENT_POLICY_VERSION,
                    'activation': featv2.ACTIVATION_POLICY_VERSION},
                'configHashes': {
                    'activation': pol['configHash'],
                    'intent': self._intent_config_hash()},
                'goldDigest': pol['goldDigest'],
                'mode': pol['mode'],
                'observationId': obs, 'queryChars': len(query),
                'normTextHash': nh,
                'normTextLen': len(featv2.normalize_text(query)),
                'lane': out.get('features', {}).get('lane'),
                'decision': out['decision'],
                'reasonCodes': out['reasonCodes'],
                'features': out.get('features'),
                'candidateProvenance': [
                    {'memoryId': c['memoryId'],
                     'recordDigest': c['recordDigest']}
                    for c in candidates[:3]],
                'candidateHit': candidate_hit,
                'requiresCrossWorkspaceRelay':
                    bool(features['requiresRelayFlag']),
                'piiClass': features['piiClass'], 'advisoryOnly': None,
            }
            self._fv2_rows += 1
            row['rowsWritten'] = self._fv2_rows
            self._fv2_append('activation-shadow-v2.jsonl', row)
        except Exception as exc:  # fail closed; retrieval unaffected
            base.diag('fv2-decide-failed: ' + str(exc)[:200])
            self._fv2_rows += 1
            self._fv2_append('activation-shadow-v2.jsonl', {
                'shadowReason': 'decide-failed',
                'error': str(exc)[:200], 'observationId': obs})
