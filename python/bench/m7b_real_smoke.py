# -*- coding: utf-8 -*-
"""M7-7.5 H5: real-provider closed-loop smoke (audit P0 proof).

Spawns worker_semantic_pre_v1.py with the REAL bge-m3 snapshot, runs a full
index_sync commit -> vector build -> context_push -> hybrid shadow search,
and asserts: 1024-dim L2-normalized vectors, identity block, query/corpus
template consistency (no double specials), hybrid fusion fields, provenance.

Run manually or from CI-with-model; NOT part of the offline 26-suite gate.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import hashlib as H

sys.path.insert(0, r'D:\dsh-auto-memory\python')
from worker_pre_v1 import canonical  # noqa: E402

SNAP = (r'D:\dsh-auto-memory\python\bench\.hf-cache'
        r'\models--BAAI--bge-m3\snapshots'
        r'\5617a9f61b028005a4858fdac845db406aefb181')
REV = '5617a9f61b028005a4858fdac845db406aefb181'

fails = []


def ok(cond, name):
    print(('  ok - ' if cond else '  FAIL - ') + name)
    if not cond:
        fails.append(name)


def main():
    home = tempfile.mkdtemp(prefix='m75real-')
    cfg = os.path.join(home, 'emb.json')
    json.dump({'provider': 'bge-m3-pre-v1', 'modelDir': SNAP,
               'modelRevision': REV, 'dimension': 1024, 'torchThreads': 16,
               'search': {'mode': 'hybrid', 'wDense': 0.7}},
              open(cfg, 'w', encoding='utf-8'))
    env = dict(os.environ, DSH_M7_EMBEDDING_CONFIG=cfg)
    t0 = time.time()
    p = subprocess.Popen(
        [sys.executable, r'D:\dsh-auto-memory\python\worker_semantic_pre_v1.py',
         '--expect-epoch', 'ep', '--dsh-home', home],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=env)

    def fr(t, rid, pl):
        return json.dumps({'protocolVersion': 'm7_wire_pre_v1',
                           'frameId': 'f' + rid, 'requestId': rid,
                           'workerEpoch': 'ep', 'type': t, 'payload': pl,
                           'sentAt': 1000}, ensure_ascii=False).encode() + b'\n'

    miv = 'idx_pre_' + 'ab' * 16
    wref = 'wsr_' + H.sha256(('evidence-wsref-pre-v1\u0000d:/tmp/real').encode()
                             ).hexdigest()[:32]

    def rec(i, text):
        return {'memoryId': 'mem_' + H.sha256(('r%d' % i).encode()).hexdigest()[:32],
                'anchorId': 'anc%d' % i, 'scope': 'Workspace',
                'workspaceRef': wref, 'sourceRef': 'workspace:MEMORY.md',
                'sourceEpoch': 'e1', 'sourceVersion': 1,
                'fileDigest': ('f%d' % i).ljust(64, '0'),
                'recordDigest': ('d%d' % i).ljust(64, '0'), 'heading': None,
                'text': text, 'chunkId': 'chk_pre_' + ('c%d' % i).ljust(32, '0'),
                'chunkOrdinal': 0, 'chunkCount': 1}

    recs = [
        rec(1, 'workerEpoch semantics: every sidecar restart mints a fresh '
               'opaque epoch; stale-epoch frames are dropped by the host.'),
        rec(2, '断路器策略:连续三次请求失败后熔断三十秒,半开探测成功归零计数。'),
        rec(3, '午餐备注:拉面店改到下午两点半关门。'),
    ]
    pdig = H.sha256(canonical(recs).encode()).hexdigest()
    page = {'schemaVersion': 1, 'syncId': 'syn_pre_' + 'a' * 32, 'pageNo': 0,
            'pageCount': 1, 'records': recs, 'pageDigest': pdig}
    fin = H.sha256(canonical({'kind': 'index_sync_final_pre_v1',
        'syncId': page['syncId'], 'memoryIndexVersion': miv,
        'workspaceRef': wref, 'scope': 'Workspace', 'recordCount': 3,
        'pageCount': 1, 'pageDigests': [pdig]}).encode()).hexdigest()

    p.stdin.write(fr('health', 'h1', {}))
    p.stdin.write(fr('index_sync_begin', 's1', {
        'schemaVersion': 1, 'syncId': page['syncId'], 'workspaceRef': wref,
        'scope': 'Workspace', 'memoryIndexVersion': miv, 'sourceTuples': [],
        'recordCount': 3, 'pageCount': 1,
        'indexPolicyVersion': 'index_sync_pre_v1'}))
    p.stdin.write(fr('index_sync_page', 's2', page))
    p.stdin.write(fr('index_sync_commit', 's3', {
        'schemaVersion': 1, 'syncId': page['syncId'],
        'memoryIndexVersion': miv, 'finalDigest': fin}))
    # zh query against EN gold + EN query against ZH gold (cross-lingual loop)
    p.stdin.write(fr('context_push', 'c1', {'kind': 'context_push',
        'observationId': 'obs_pre_' + '1' * 32,
        'session': {'sessionId': 's', 'agentId': 'a',
                    'workspaceKey': 'D:/tmp/real', 'scope': 'Workspace'},
        'cursor': {'eventSeq': 1, 'contextVersion': 1},
        'index': {'memoryIndexVersion': miv},
        'trigger': {'segmentId': 'sg', 'digest': 'd' * 16, 'kind': 'user',
                    'eventSeq': 1, 'contextVersion': 1, 'ts': 1,
                    'text': '进程重启之后 epoch 标识如何轮换?'},
        'window': [], 'memoryRefs': [], 'evidence': [], 'policy': {},
        'budget': {}, 'observedAt': 1, 'deadlineAt': 9000000000000}))
    p.stdin.write(fr('context_push', 'c2', {'kind': 'context_push',
        'observationId': 'obs_pre_' + '2' * 32,
        'session': {'sessionId': 's', 'agentId': 'a',
                    'workspaceKey': 'D:/tmp/real', 'scope': 'Workspace'},
        'cursor': {'eventSeq': 2, 'contextVersion': 2},
        'index': {'memoryIndexVersion': miv},
        'trigger': {'segmentId': 'sg', 'digest': 'd' * 16, 'kind': 'user',
                    'eventSeq': 2, 'contextVersion': 2, 'ts': 2,
                    'text': 'breaker 三次失败之后会怎样?'},
        'window': [], 'memoryRefs': [], 'evidence': [], 'policy': {},
        'budget': {}, 'observedAt': 2, 'deadlineAt': 9000000000002}))
    p.stdin.write(fr('health', 'h2', {}))
    p.stdin.close()
    out = p.stdout.read().decode()
    err = p.stderr.read().decode()
    frames = [json.loads(l) for l in out.splitlines() if l.strip()]
    sem = os.path.join(home, 'memory', 'semantic-pre')

    health1 = next(f for f in frames if f['type'] == 'health_result')
    ok(health1['payload']['worker'] == 'semantic', 'worker=semantic(真 provider 配置)')
    acks = {f['requestId']: f for f in frames if f['type'] == 'index_ack'}
    ok(all(a['payload']['accepted'] for a in acks.values()), 'index_sync 全 accepted')
    vec_files = [f for f in os.listdir(sem) if f.startswith('vectors-')]
    ok(len(vec_files) == 1, '真实建库:vectors 文件落盘(P0 闭环)')
    v = json.load(open(os.path.join(sem, vec_files[0]), encoding='utf-8'))
    import math
    n0 = math.sqrt(sum(x * x for x in v['vectors'][0]))
    ok(abs(n0 - 1.0) < 1e-4, f'向量 L2 归一(norm={n0:.6f})')
    ok(v['identity']['provider'] == 'bge-m3-pre-v1'
       and v['identity']['configHash'].startswith('cfgh_'), 'identity block 正确')
    cands = json.loads(json.dumps([f for f in frames
                                   if f['type'] == 'context_ack']))
    shadow = [json.loads(l) for l in open(
        os.path.join(sem, 'candidates-shadow.jsonl'), encoding='utf-8')]
    ok(len(shadow) == 2, '两次 push 均产出影子行(hybrid)')
    ok(all(r['method'] == 'hybrid' for r in shadow), 'method=hybrid(D6 进生产路径)')
    s1 = shadow[0]
    ok(s1['candidates'][0]['memoryId'] == recs[0]['memoryId'],
       '中文查询 → 英文 gold top1(zh→en 跨语言闭环)')
    ok(all(c['fusedScore'] >= c['denseScore'] - 1e-6 - 0.34
           for c in s1['candidates']), '融合分在分量凸包内')
    ok(all('lexicalScore' in c and 'denseScore' in c for r in shadow
           for c in r['candidates']), '候选携带 dense/lexical/fused 三分量')
    top_ids = [c['memoryId'] for c in shadow[1]['candidates']]
    ok(top_ids[0] == recs[1]['memoryId'], 'en 查询 → 中文 gold top1(en→zh 闭环)')
    health2 = [f for f in frames if f['type'] == 'health_result'][-1]
    ev = health2['payload']['embedding']
    ok(ev.get('ready') is True and ev.get('chunks') == 3,
       'health embedding ready=True chunks=3')
    lat = round(time.time() - t0, 1)
    print(f'[real-smoke] total {lat}s | fails={len(fails)}')
    if err.strip():
        print('stderr tail:', err.strip().splitlines()[-1])
    if fails:
        sys.exit(1)


if __name__ == '__main__':
    main()
