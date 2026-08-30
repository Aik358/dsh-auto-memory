#!/usr/bin/env python3
"""Idempotent surgical patcher: wire feature v2 into the semantic worker.
Helpers content lives in _patch_helpers.py. Every step checks its own
marker first, so re-running is safe."""
import os

P = 'D:/dsh-auto-memory/python/worker_semantic_pre_v1.py'
HERE = os.path.dirname(os.path.abspath(__file__))
s = open(P, encoding='utf-8').read()
applied = []

# 1) guarded featv2 import
if 'import m7_activation_features_pre_v2 as featv2' not in s:
    old = ("import worker_pre_v1 as base  # noqa: E402  (tested M7-0/M7-1 "
           "protocol layer)\nimport m7_embedding_pre_v1 as emb  # noqa: E402")
    assert old in s, 'import anchor'
    s = s.replace(old, old + "\ntry:  # M7 activation feature v2 "
                          "(round-1 shadow wiring)\n"
                          "    import m7_activation_features_pre_v2 as "
                          "featv2  # noqa: E402\n"
                          "except Exception as _fv2_import_exc:\n"
                          "    featv2 = None\n"
                          "    _FEATV2_IMPORT_ERROR = str(_fv2_import_exc)"
                          "[:160]\nelse:\n    _FEATV2_IMPORT_ERROR = ''")
    applied.append('import')

# 2) init wiring + repetition store
if 'self._fv2_invalid' not in s:
    old = ("        self._lex_cache = None      # (wsRef, scope, miv) -> "
           "LexicalBM25\n        if self.embedding_config.get('provider'):\n"
           "            self._init_embedding()")
    assert old in s, 'init anchor'
    new = """        self._lex_cache = None      # (wsRef, scope, miv) -> LexicalBM25
        # ---- M7 activation feature v2 (round-1 shadow wiring) ----
        self._fv2 = None
        self._fv2_invalid = ''
        pol_dir = os.environ.get('DSH_M7_ACTIVATION_POLICY_DIR') or \\
            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         'policies')
        try:
            self._fv2 = featv2.load_and_verify_policy(
                os.path.join(pol_dir, 'recall_intent_lr_pre_v1.json'),
                os.path.join(pol_dir, 'activation_policy_pre_v2.json'))
        except Exception as exc:  # fail closed; retrieval unaffected
            self._fv2_invalid = str(exc)[:200]
            base.diag('featuresV2-policy-invalid: ' + self._fv2_invalid)
        self._fv2_rep = {}          # (sid,topicKey) -> decayed counters
        self._fv2_rows = 0
        if self.embedding_config.get('provider'):
            self._init_embedding()"""
    s = s.replace(old, new)
    applied.append('init')

# 3) call site in handle_context_push
if '_fv2_shadow_decide(req' not in s:
    old = ("            self._append_activation_shadow(row)\n"
           "        return frames")
    assert s.count(old) == 1, 'call anchor'
    s = s.replace(old, ("            self._append_activation_shadow(row)\n"
                        "        # ---- feature v2 round-1 shadow (never "
                        "emits frames) ----\n"
                        "        self._fv2_shadow_decide(req, p, candidates, "
                        "frames)\n        return frames"))
    applied.append('callsite')

# 4) helper methods from external file
if 'def _fv2_shadow_decide' not in s:
    helpers = open(os.path.join(HERE, '_patch_helpers.py'),
                   encoding='utf-8').read()
    anchor = "\n\ndef load_embedding_config_from_env("
    assert anchor in s, 'class tail anchor'
    s = s.replace(anchor, '\n' + helpers + anchor)
    applied.append('helpers')

open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('applied:', applied or 'nothing (already patched)')
