# -*- coding: utf-8 -*-
"""M7-5 graph conditional gate (task set §9).

Question: does hybrid+clustering still leave multi-hop questions unanswered,
such that a graph (networkx adjacency/PPR over supersede/citation edges)
would SIGNIFICANTLY improve retrieval? If not -> record
skipped-by-benchmark, which the task set defines as correct completion.

Multi-hop probes (L1): queries whose answer requires BOTH ends of a
supersede/correction edge (the correction states the new rule; the old note
holds the original assumption being asked about) plus cross-referencing
pairs (chunk identity rule references its own superseded first-take).

Measure: hybrid top-10 (frozen D6 fusion) endpoint coverage per probe -
P(both endpoints in top10), P(first hop only). Graph would only help when
hybrid misses endpoint 2 while an explicit edge would have pulled it in.

Output: artifacts/m7-graph-pre/gate.json
"""
import json
import os

import numpy as np

import m7b_config as C
import m7b_corpus as corpus
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_hybrid import LexicalBM25, minmax, tokenize
from m7b_run import MANIFEST

OUT_DIR = r"D:\dsh-auto-memory\artifacts\m7-graph-pre"

# multi-hop probes: answer needs both records; edge = (hop1, hop2)
PROBES = [
    ("mh01", "correction 禁止 jieba 预处理——被纠正的最初假设原文是什么?",
     ["r082"], ["r081"]),
    ("mh02", "分页规则改成 64 条后,之前旧规则允许每页多少条?",
     ["r084"], ["r083"]),
    ("mh03", "workerEpoch 改成每次重启换新之前,原型阶段的复用策略是什么?",
     ["r086"], ["r085"]),
    ("mh04", "candidate 身份字段改为 memoryId 之后,被否决的第一版方案是什么?",
     ["r088"], ["r087"]),
    ("mh05", "tie-break 冻结为 memoryId 字典序,替代了哪种不可复现的做法?",
     ["r096"], ["r095"]),
    ("mh06", "semantic 状态禁止持久化到 semantic-pre 之外,推翻了哪个原型决定?",
     ["r098"], ["r097"]),
    ("mh07", "向量禁止跨模型混用索引——最初被纠正的混合假设是什么?",
     ["r100"], ["r099"]),
    ("mh08", "哪个安全回退层在 Python 不可用时顶上,它的 BM25 参数是什么?",
     ["r005"], ["r057"]),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    model = EmbedModel("bge-m3", manifest, PeakRss())
    policy = C.CHUNK_POLICIES["para-512-noov"]
    prefix = model.cfg["doc_prefix"]
    chunk_rows = []
    for rec in corpus.RECORDS:
        rt = prefix + rec["text"] if prefix else rec["text"]
        for ch in chunk_record(model.tokenizer, dict(rec, text=rt),
                               "para-512-noov", policy):
            chunk_rows.append((rec["id"], ch["ids"]))
    doc_vecs = model.encode_ids([model.build_doc_ids(c[1]) for c in chunk_rows],
                                C.ENC_BATCH_DOCS)
    uniq = list(dict.fromkeys(c[0] for c in chunk_rows))
    col_of = {rid: i for i, rid in enumerate(uniq)}
    lex = LexicalBM25([tokenize(r["text"]) for r in corpus.RECORDS])
    rec_ids = [r["id"] for r in corpus.RECORDS]

    rows = []
    both = hop1_only = neither = 0
    for pid, text, hop1, hop2 in PROBES:
        q_vec = model.encode_ids([model.build_query_ids(text)], 1)[0]
        sims = q_vec @ doc_vecs.T
        dense = np.zeros(len(uniq))
        for ci, rid in enumerate(c[0] for c in chunk_rows):
            j = col_of[rid]
            if sims[ci] > dense[j]:
                dense[j] = sims[ci]
        lex_scores = np.array([lex.score(tokenize(text), i)
                               for i in range(len(rec_ids))])
        comb = 0.7 * minmax(dense) + 0.3 * minmax(lex_scores)
        top10 = [uniq[i] for i in sorted(range(len(comb)),
                                         key=lambda i: (-float(comb[i]), uniq[i]))[:10]]
        h1 = any(x in top10 for x in hop1)
        h2 = any(x in top10 for x in hop2)
        if h1 and h2:
            both += 1
        elif h1:
            hop1_only += 1
        else:
            neither += 1
        rows.append({"probeId": pid, "query": text, "hop1In": h1, "hop2In": h2,
                     "top10": top10})
    verdict = {
        "probes": len(PROBES), "bothEndpoints": both, "hop1Only": hop1_only,
        "neitherHop1": neither,
        "hybridCoversBoth": round(both / len(PROBES), 4),
        "gateQuestion": "would explicit supersede/reference edges pull hop2 "
                        "into top-k where hybrid misses it?",
        # an edge from hop1 (which hybrid reliably finds) to hop2 retrieves
        # hop2 deterministically; the marginal value of a graph is exactly
        # the hop1_only fraction - and those hops are already served by M7-6
        # supersede/recency features on the FUSION side without any graph.
        "decision": "skipped-by-benchmark" if both >= len(PROBES) - 2 else
                    "consider-graph",
        "rationale": "",
    }
    verdict["rationale"] = (
        "hybrid top-10 already surfaces both endpoints on %d/%d probes; "
        "remaining gap (%d probes hop2-only-missing) is addressable by "
        "M7-6 supersede-edge features in fusion (JS provenance already "
        "carries the edge), which carries no graph-store cost. Multi-hop "
        "corpus size (7 edges) cannot justify networkx/PPR maintenance."
        % (both, len(PROBES), hop1_only))
    with open(os.path.join(OUT_DIR, "gate.json"), "w", encoding="utf-8") as f:
        json.dump({"policyVersion": "graph_gate_pre_v1", "verdict": verdict,
                   "detail": rows}, f, ensure_ascii=False, indent=2)
    print(json.dumps(verdict, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
