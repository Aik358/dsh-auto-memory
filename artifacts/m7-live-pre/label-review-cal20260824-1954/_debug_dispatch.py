import sys, os, json, tempfile
sys.path.insert(0, r'D:\dsh-auto-memory\python')
import worker_semantic_pre_v1 as W

frame_path = sys.argv[1]
home = tempfile.mkdtemp()
w = W.SemanticWorker('ep', home, {'provider': 'hash-pre-v1', 'dimension': 64})
obj = json.load(open(frame_path, encoding='utf-8'))
handler = getattr(w, 'handle_' + obj['type'])
try:
    frames = handler(obj)
    for f in frames:
        print('FRAME:', json.dumps(f)[:220])
except Exception:
    import traceback
    traceback.print_exc()
print('HOME:', home)
