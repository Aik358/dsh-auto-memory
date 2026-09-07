# -*- coding: utf-8 -*-
"""M7-2 benchmark: pinned model + policy configuration.

Every model is pinned to an exact commit SHA (verified via HF API on
2026-08-24 before download). License tags come from the HF model card.
Nothing here touches production code; this is a standalone experiment.
"""

BENCH_ROOT = r"D:\dsh-auto-memory\python\bench"
HF_CACHE = BENCH_ROOT + r"\.hf-cache"
RESULTS_DIR = BENCH_ROOT + r"\results"
FIXTURE_OUT = r"D:\dsh-auto-memory\tests\m7-2-fixtures\embedding-fixture.json"

MODELS = {
    "bge-m3": {
        "repo_id": "BAAI/bge-m3",
        "revision": "5617a9f61b028005a4858fdac845db406aefb181",
        "license": "MIT",
        "dimension": 1024,
        "normalization": "l2_normalize",
        "pooling": "cls",
        "query_instruction": None,
        "doc_instruction": None,
        "query_prefix": "",
        "doc_prefix": "",
        "query_max_tokens": 256,
        "doc_max_tokens": 1024,
        "allow_patterns": [
            "config.json", "pytorch_model.bin", "sentencepiece.bpe.model",
            "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
            "1_Pooling/config.json", "sentence_bert_config.json",
            "config_sentence_transformers.json", "modules.json",
        ],
    },
    "qwen3-emb-0.6b": {
        "repo_id": "Qwen/Qwen3-Embedding-0.6B",
        "revision": "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3",
        "license": "Apache-2.0",
        "dimension": 1024,
        "normalization": "l2_normalize",
        "pooling": "last_token",
        "query_instruction": (
            "Instruct: Given a developer memory search query, retrieve the "
            "memory records that answer the query\nQuery:"
        ),
        "doc_instruction": None,
        "query_prefix": "",
        "doc_prefix": "",
        "query_max_tokens": 256,
        "doc_max_tokens": 1024,
        "allow_patterns": [
            "config.json", "model.safetensors", "tokenizer.json",
            "tokenizer_config.json", "vocab.json", "merges.txt",
            "generation_config.json", "1_Pooling/config.json",
            "config_sentence_transformers.json", "modules.json",
            "special_tokens_map.json",
        ],
    },
    "multilingual-e5-large": {
        "repo_id": "intfloat/multilingual-e5-large",
        "revision": "3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
        "license": "MIT",
        "dimension": 1024,
        "normalization": "l2_normalize",
        "pooling": "mean",
        "query_instruction": None,
        "doc_instruction": None,
        "query_prefix": "query: ",
        "doc_prefix": "passage: ",
        "query_max_tokens": 256,
        "doc_max_tokens": 512,  # XLM-R hard limit incl. <s></s>; content capped to 510
        "allow_patterns": [
            "config.json", "model.safetensors", "sentencepiece.bpe.model",
            "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
            "1_Pooling/config.json", "sentence_bert_config.json",
            "config_sentence_transformers.json", "modules.json",
        ],
    },
}

# Chunk policies compared in M7-2. "fixed*" = hard token windows with no
# paragraph respect; "para*" = greedy paragraph packing; ov = token overlap
# on continuation windows. All splitting is done with the model's own
# tokenizer (ids space), never with external word segmentation.
CHUNK_POLICIES = {
    "fixed-256-noov": {"max_tokens": 256, "para_aligned": False, "overlap": 0},
    "fixed-512-noov": {"max_tokens": 512, "para_aligned": False, "overlap": 0},
    "fixed-1024-noov": {"max_tokens": 1024, "para_aligned": False, "overlap": 0},
    "para-512-noov": {"max_tokens": 512, "para_aligned": True, "overlap": 0},
    "para-512-ov64": {"max_tokens": 512, "para_aligned": True, "overlap": 64},
}

TOP_K_FOR_LATENCY = 10
LATENCY_ITERS = 60
LATENCY_WARMUP = 5
ENC_BATCH_DOCS = 8
ENC_BATCH_QUERIES = 8
TORCH_THREADS = 16
