"""Deterministic protocol fixture. No inference, third-party imports or network."""
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--expect-epoch')
parser.add_argument('--dsh-home')
args = parser.parse_args()
scopes = {}
pending = {}
for line in sys.stdin:
    req = json.loads(line)
    kind, payload = req['type'], req['payload']
    with open(os.path.join(args.dsh_home, 'pr420-worker-events.jsonl'), 'a', encoding='utf-8') as log:
        log.write(json.dumps({'type': kind, 'executable': sys.executable, 'scope': payload.get('scope')}) + '\n')
    if kind == 'health':
        result_type, result = 'health_result', {'embedding': {'enabled': True, 'ready': True}}
    elif kind.startswith('index_sync_'):
        if kind == 'index_sync_begin':
            pending[payload['syncId']] = {'scope': payload['scope'], 'records': []}
        elif kind == 'index_sync_page':
            pending[payload['syncId']]['records'].extend(payload['records'])
        else:
            entry = pending.pop(payload['syncId'])
            scopes[entry['scope']] = entry['records']
        result_type, result = 'index_ack', {'accepted': True}
    elif kind == 'recall_rank':
        result_type = 'recall_rank_result'
        result = {'scores': [{'memoryId': rec['memoryId'], 'score': 0.9} for rec in scopes.get(payload['scope'], [])]
                  + [{'memoryId': 'mem_' + 'f' * 32, 'score': 1.0}]}
    else:
        continue
    response = dict(req, frameId='fixture-' + req['frameId'], type=result_type, payload=result)
    print(json.dumps(response), flush=True)
