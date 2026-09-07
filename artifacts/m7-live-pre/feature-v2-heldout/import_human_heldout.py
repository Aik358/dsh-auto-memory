# -*- coding: utf-8 -*-
"""Import the user's A/P/S/H/E rulings from heldout-review-v2.xlsx into
heldout-human-gold.jsonl. Faithful transcription: annotations in the choice
column override letter codes; rows without a letter become deferred and are
NOT gold. Target interpreter: python/bench/.venv."""
import json
import os
from collections import Counter

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = {'A': 'activate', 'P': 'prefetch', 'S': 'suppress', 'H': 'harmful',
        'E': 'edit'}

proposed = {r['sampleId']: r for r in
            (json.loads(l) for l in open(
                os.path.join(HERE, 'heldout-proposed-all.jsonl'),
                encoding='utf-8') if l.strip())}

wb = openpyxl.load_workbook(os.path.join(HERE, 'heldout-review-v2.xlsx'))
ws = wb.worksheets[0]
out = []
for r in ws.iter_rows(values_only=True):
    if not (r[2] and str(r[2]).strip().startswith('hd-')):
        continue
    sid = str(r[2]).strip()
    p = proposed[sid]
    choice = (str(r[10]).strip() if r[10] else '')
    comment = (str(r[11]).strip() if r[11] else '')
    row = {
        'sampleId': sid,
        'queryText': p['queryText'],
        'language': p.get('language'),
        'category': p.get('category'),
        'independence': p.get('independence'),
        'expectedMemoryIds': p.get('expectedMemoryIds') or [],
        'forbiddenMemoryIds': p.get('forbiddenMemoryIds') or [],
        'harmfulFlag': bool(p.get('harmful')),
        'pairId': p.get('pairId'),
        'proposedAction': p.get('proposedAction'),
        'labelSource': 'human',
        'rawChoice': choice,
        'rowComments': [comment] if comment else [],
    }
    if choice in CODE:
        row['finalAction'] = CODE[choice]
        row['isGold'] = True
        row['overridesPrior'] = CODE[choice] != p.get('proposedAction')
    else:
        # free-text ruling (e.g. cross-workspace setting-dependent) ->
        # deferred: excluded from gold until the setting lands
        row['finalAction'] = None
        row['isGold'] = False
        row['deferredReason'] = ('user annotation: %s' % choice) if choice \
            else 'no user ruling'
    out.append(row)

with open(os.path.join(HERE, 'heldout-human-gold.jsonl'), 'w',
          encoding='utf-8') as f:
    for o in out:
        f.write(json.dumps(o, ensure_ascii=False) + '\n')

golds = [o for o in out if o['isGold']]
deferred = [o for o in out if not o['isGold']]
print('human gold:', len(golds), '| deferred:', len(deferred))
print('by action:', dict(Counter(o['finalAction'] for o in golds)))
print('by lang x action:', dict(Counter((o['language'], o['finalAction'])
                                        for o in golds)))
print('independence:', dict(Counter(o['independence'] for o in golds)))
print('overrides:', [(o['sampleId'], o['proposedAction'], o['finalAction'])
                     for o in golds if o['overridesPrior']])
print('deferred:', [(o['sampleId'], o['deferredReason'][:40]) for o in deferred])
for gate, val in [('activate>=15', sum(1 for o in golds if o['finalAction'] == 'activate') >= 15),
                  ('prefetch>=15', sum(1 for o in golds if o['finalAction'] == 'prefetch') >= 15),
                  ('suppress>=15', sum(1 for o in golds if o['finalAction'] == 'suppress') >= 15),
                  ('enActivate>=1', any(o['language'] == 'en' and o['finalAction'] == 'activate' for o in golds))]:
    print('gate %-14s %s' % (gate, 'PASS' if val else 'FAIL'))
