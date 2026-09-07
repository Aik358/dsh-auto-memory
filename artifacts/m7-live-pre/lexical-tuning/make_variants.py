# -*- coding: utf-8 -*-
"""Generate patched COPIES of lib/shadow-retrieval-pre.js as lexical tuning
variants. Production lib is never touched; each variant differs by exactly
one (or a stated pair of) behavioural change."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', 'lib', 'shadow-retrieval-pre.js')
base = open(SRC, encoding='utf-8').read()

ANCHOR_TRUNC = 'const maxCjk = opts.maxCjkGrams || 64'
ANCHOR_STOP = ("export function isStopWord(term) {\n"
               "  if (STOPWORDS_HIT_SET.has(term)) return true")
NEG_GUARD = ("export function isStopWord(term) {\n"
             "  // negation/domain guard: never drop polarity or scope words\n"
             "  if (['not', 'no', 'none', 'never', 'without'].includes(term)) return false\n"
             "  if (/^(不|别|没|未|勿|无|非|莫|毋)/.test(term) && STOPWORDS_HIT_SET.has(term)) return false\n"
             "  if (STOPWORDS_HIT_SET.has(term)) return true")
ANCHOR_BM25 = "bm25: Object.freeze({ k1: 1.2, b: 0.75 }),"
ANCHOR_UNI = ("    if (run.length >= 2 && run.length <= 16) {\n"
              "      if (!seen.has(run)) { seen.add(run); out.push(run) }\n"
              "    }")
UNI_V4 = ("    if (run.length >= 1 && run.length <= 16) {\n"
          "      if (!seen.has(run)) { seen.add(run); out.push(run) }\n"
          "    }")

VARIANTS = {
    'v01_notrunc.js': [(ANCHOR_TRUNC, ANCHOR_TRUNC.replace('64', '4096'))],
    'v02_negstop.js': [(ANCHOR_STOP, NEG_GUARD)],
    'v03_b045.js': [(ANCHOR_BM25,
                     ANCHOR_BM25.replace('0.75', '0.45'))],
    'v03b_b030.js': [(ANCHOR_BM25,
                      ANCHOR_BM25.replace('0.75', '0.30'))],
    'v04_unigram.js': [(ANCHOR_UNI, UNI_V4)],
    'v05_notrunc_negstop.js': [
        (ANCHOR_TRUNC, ANCHOR_TRUNC.replace('64', '4096')),
        (ANCHOR_STOP, NEG_GUARD),
    ],
}

for name, patches in VARIANTS.items():
    text = base
    for old, new in patches:
        assert text.count(old) == 1, '%s: anchor not unique in %s' % (name, old[:40])
        text = text.replace(old, new)
    with open(os.path.join(HERE, name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('wrote', name)
