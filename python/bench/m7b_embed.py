# -*- coding: utf-8 -*-
"""Model wrapper: load pinned snapshot, encode with canonical pooling.

Pooling conventions follow each model card exactly:
  bge-m3               CLS token, L2-normalized, no prefixes
  qwen3-emb-0.6b       last-token pooling, L2-normalized, queries get the
                       "Instruct: ... Query:" format from the model card
  multilingual-e5-large mean pooling over attention mask, L2-normalized,
                       "query: "/"passage: " prefixes
"""
import os
import time

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import psutil
import torch

import m7b_config as C

torch.set_num_threads(C.TORCH_THREADS)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass


class PeakRss:
    def __init__(self):
        self.proc = psutil.Process()
        self.peak = self.proc.memory_info().rss

    def tick(self):
        rss = self.proc.memory_info().rss
        if rss > self.peak:
            self.peak = rss
        return rss

    def reset_baseline(self):
        """Start a new per-model measurement window (peak = current rss)."""
        self.peak = self.proc.memory_info().rss


class EmbedModel:
    def __init__(self, name, manifest, rss: PeakRss):
        self.name = name
        self.cfg = C.MODELS[name]
        self.rss = rss
        self.local_path = manifest["models"][name]["local_path"]
        from transformers import AutoModel, AutoTokenizer
        t0 = time.perf_counter()
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.local_path, revision=self.cfg["revision"])
        self.model = AutoModel.from_pretrained(
            self.local_path, revision=self.cfg["revision"], torch_dtype=torch.float32)
        self.model.eval()
        self.load_seconds = round(time.perf_counter() - t0, 2)
        rss.tick()
        self.pad_id = (self.tokenizer.pad_token_id
                       if self.tokenizer.pad_token_id is not None
                       else self.tokenizer.eos_token_id)
        # transformers 5.x removed build_inputs_with_special_tokens; probe
        # the tokenizer for the special-token prefix/suffix it wraps around
        # content (XLM-R: <s> ... </s>, Qwen3: none). Locate the content
        # subsequence, then cross-validate on a second sample.
        def specials_for(text):
            probe = self.tokenizer(text, add_special_tokens=True)["input_ids"]
            core = self.tokenizer(text, add_special_tokens=False)["input_ids"]
            for i in range(len(probe) - len(core) + 1):
                if probe[i:i + len(core)] == core:
                    return probe[:i], probe[i + len(core):]
            raise RuntimeError("cannot locate content in tokenized probe")
        p1, s1 = specials_for("x")
        p2, s2 = specials_for("x y")
        assert p1 == p2 and s1 == s2, "special wrapping is not stationary"
        self._special_prefix = p1
        self._special_suffix = s1

    # ---- batching over pre-built id lists (specials already included) ----
    def _forward(self, ids_list):
        maxlen = max(len(x) for x in ids_list)
        input_ids = torch.full((len(ids_list), maxlen), self.pad_id,
                               dtype=torch.long)
        attn = torch.zeros((len(ids_list), maxlen), dtype=torch.long)
        for r, ids in enumerate(ids_list):
            input_ids[r, :len(ids)] = torch.tensor(ids, dtype=torch.long)
            attn[r, :len(ids)] = 1
        with torch.no_grad():
            out = self.model(input_ids=input_ids, attention_mask=attn)
        return out.last_hidden_state, attn

    def _pool(self, hidden, attn):
        if self.cfg["pooling"] == "cls":
            return hidden[:, 0]
        if self.cfg["pooling"] == "mean":
            mask = attn.unsqueeze(-1).to(hidden.dtype)
            return (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        if self.cfg["pooling"] == "last_token":
            lengths = attn.sum(dim=1) - 1
            return hidden[torch.arange(hidden.size(0)), lengths]
        raise ValueError(self.cfg["pooling"])

    def encode_ids(self, ids_list, batch_size):
        vecs = []
        for i in range(0, len(ids_list), batch_size):
            part = ids_list[i:i + batch_size]
            hidden, attn = self._forward(part)
            pooled = self._pool(hidden, attn)
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            vecs.append(pooled.to(torch.float32).numpy())
            self.rss.tick()
        return np.concatenate(vecs, axis=0) if vecs else np.zeros((0, self.cfg["dimension"]), np.float32)

    # ---- text helpers ----
    def build_doc_ids(self, chunk_ids):
        ids = list(self._special_prefix) + list(chunk_ids) + list(self._special_suffix)
        cap = self.cfg["doc_max_tokens"]
        if len(ids) > cap:  # keep specials while capping content
            drop = len(ids) - cap
            body = ids[len(self._special_prefix):len(ids) - len(self._special_suffix) or None]
            body = body[:len(body) - drop] if drop < len(body) else []
            ids = list(self._special_prefix) + body + list(self._special_suffix)
        return ids

    def build_query_ids(self, query_text):
        if self.name == "qwen3-emb-0.6b":
            text = self.cfg["query_instruction"] + query_text
        else:
            text = self.cfg["query_prefix"] + query_text
        enc = self.tokenizer(text, add_special_tokens=True,
                             truncation=True,
                             max_length=self.cfg["query_max_tokens"])
        return enc["input_ids"]

    def build_doc_text_ids(self, text):
        enc = self.tokenizer(self.cfg["doc_prefix"] + text,
                             add_special_tokens=True, truncation=True,
                             max_length=self.cfg["doc_max_tokens"])
        return enc["input_ids"]
