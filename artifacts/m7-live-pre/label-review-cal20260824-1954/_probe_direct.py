import tempfile, json, os, hashlib
import worker_semantic_pre_v1 as W

home = tempfile.mkdtemp()
w = W.SemanticWorker('ep', home, {'provider': 'hash-pre-v1', 'dimension': 64})
hex32 = lambda s: hashlib.sha256(s.encode()).hexdigest()[:32]
wsr = 'wsr_' + hex32('m79ws')


def mk(i, text):
    return {
        'memoryId': 'mem_' + hex32('m79:m:%d' % i),
        'anchorId': 'anc_' + hex32('m79a%d' % i)[:12],
        'scope': 'Workspace', 'workspaceRef': wsr,
        'sourceRef': 'workspace:MEMORY.md', 'sourceEpoch': 'e-m79',
        'sourceVersion': 1,
        'fileDigest': hashlib.sha256(('m79f%d' % i).encode()).hexdigest(),
        'recordDigest': hashlib.sha256(('m79r%d' % i).encode()).hexdigest(),
        'heading': None, 'text': text,
        'chunkId': 'chk_pre_' + hex32('m79c%d' % i), 'chunkOrdinal': 0,
        'chunkCount': 1}


recs = [mk(1, '测试条目【琥珀协议】：虚构决策——采用琥珀协议作为模块间通信格式。')]
miv = 'idx_pre_' + hex32('m79miv')
snap = {'memoryIndexVersion': miv,
        'sources': [{'scope': 'Workspace', 'sourceRef': 'workspace:MEMORY.md',
                     'sourceEpoch': 'e-m79', 'sourceVersion': 1,
                     'fileDigest': hashlib.sha256(b'm79f').hexdigest()}],
        'records': recs}


def frame(ptype, payload):
    return {'workerEpoch': 'ep', 'sentAt': 1, 'payload': payload}


frames = []
frames += w.handle_index_sync_begin(frame('index_sync_begin', dict(
    snap, syncId='sy1', workspaceRef=wsr, scope='Workspace')))
try:
    frames += w.handle_index_sync_page(frame('index_sync_page', dict(
        page_payload := {'syncId': 'sy1', 'workspaceRef': wsr,
                         'scope': 'Workspace',
                         'memoryIndexVersion': miv, 'records': recs},
        pageIndex=0, pageCount=1)))
except Exception as e:
    print('page err:', e)
try:
    frames += w.handle_index_commit(frame('index_sync_commit', {
        'syncId': 'sy1', 'workspaceRef': wsr, 'scope': 'Workspace',
        'memoryIndexVersion': miv, 'recordCount': len(recs)}))
except Exception as e:
    print('commit err:', e)

sem_dir = os.path.join(home, 'memory', 'semantic-pre')
print('semantic-pre files:', os.listdir(sem_dir) if os.path.isdir(sem_dir) else 'NO DIR')

push = frame('context_push', {
    'kind': 'context_push', 'observationId': 'obs_probe',
    'session': {'sessionId': 's1', 'agentId': 'a1',
                'workspaceKey': 'D:/tmp/m79', 'scope': 'Workspace'},
    'cursor': {'eventSeq': 1, 'contextVersion': 1},
    'index': {'memoryIndexVersion': miv, 'sourceEpochs': ['e-m79']},
    'trigger': {'segmentId': 'sg', 'digest': 'd' * 16, 'kind': 'user',
                'eventSeq': 1, 'contextVersion': 1, 'ts': 1,
                'text': '之前关于采用琥珀协议作为模块间通信格式的决策是什么？'},
    'window': [], 'memoryRefs': [{'memoryId': recs[0]['memoryId']}],
    'evidence': [], 'policy': {}, 'budget': {}})
out = w.handle_frame(push)
print('push out frames:', len(out))
v2f = os.path.join(sem_dir, 'activation-shadow-v2.jsonl')
print('v2 file exists:', os.path.isfile(v2f))
if os.path.isfile(v2f):
    row = json.loads(open(v2f, encoding='utf-8').read())
    print('decision:', row.get('decision'), '| lane:', row.get('lane'),
          '| intentProb:', row.get('features', {}).get('intentProb'))
