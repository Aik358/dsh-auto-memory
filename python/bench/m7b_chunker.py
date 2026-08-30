# -*- coding: utf-8 -*-
"""Tokenizer-driven chunking.

All splitting happens in the model's own token id space. No external word
segmentation (no jieba) is ever applied. Policies:

  fixed-N-noov : hard sliding windows of N ids, stride N (no overlap)
  para-N-noov  : greedy paragraph packing up to N ids; an oversized
                 paragraph is split into windows of N
  para-N-ov64  : like para-N-noov but continuation windows inside an
                 oversized paragraph keep 64 ids of overlap
"""
PARA_SPLIT = "\n"


def _para_token_spans(tokenizer, text):
    """Tokenize paragraph-by-paragraph; return [(para_idx, ids), ...].

    Tokenizing each paragraph separately (instead of the whole text) keeps
    paragraph boundaries visible in id space. Special tokens are NOT added;
    the embedder adds them per model convention at encode time.
    """
    spans = []
    paras = [p for p in text.split(PARA_SPLIT)]
    for i, p in enumerate(paras):
        ids = tokenizer(p, add_special_tokens=False)["input_ids"]
        if ids:
            spans.append((i, ids))
        else:
            spans.append((i, []))
    return spans


def _windows(ids, max_tokens, overlap):
    out = []
    step = max(1, max_tokens - overlap)
    start = 0
    while start < len(ids):
        win = ids[start:start + max_tokens]
        out.append(win)
        if start + max_tokens >= len(ids):
            break
        start += step
    return out


def chunk_record(tokenizer, record, policy_name, policy):
    """Return chunk dicts: {ord, token_len, para_start, para_end, text}."""
    max_tokens = policy["max_tokens"]
    overlap = policy["overlap"]
    spans = _para_token_spans(tokenizer, record["text"])
    chunks = []

    def emit(ids, p0, p1):
        chunks.append({
            "ord": len(chunks),
            "token_len": len(ids),
            "para_start": p0,
            "para_end": p1,
            "ids": list(ids),
            "text": tokenizer.decode(ids, skip_special_tokens=True),
        })

    if not policy["para_aligned"]:
        flat, pmap = [], []
        for i, ids in spans:
            for t in ids:
                pmap.append(i)
            flat.extend(ids)
            # paragraph boundary marker: newline token join is implicit;
            # hard windows ignore paragraph edges by design.
        for win in _windows(flat, max_tokens, overlap):
            emit(win, pmap[0] if pmap else 0, pmap[-1] if pmap else 0)
    else:
        cur, p0, p1 = [], None, None
        for i, ids in spans:
            if not ids:
                continue
            if cur and len(cur) + len(ids) <= max_tokens:
                cur.extend(ids)
                p1 = i
                continue
            if cur:
                emit(cur, p0, p1)
                cur, p0 = [], None
            if len(ids) <= max_tokens:
                cur, p0, p1 = list(ids), i, i
            else:
                # oversized paragraph: windows with policy overlap
                wins = _windows(ids, max_tokens, overlap)
                for w in wins:
                    emit(w, i, i)
        if cur:
            emit(cur, p0, p1)

    if not chunks:  # empty record guard
        chunks.append({"ord": 0, "token_len": 0, "para_start": 0,
                       "para_end": 0, "ids": [],
                       "text": ""})
    return chunks
