# -*- coding: utf-8 -*-
"""Generate all figures for docs/M7-RESEARCH-PAPER.md from artifact JSONs.
Output: docs/paper-figures/fig1..fig7.png (150dpi, CJK font)."""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

R = r"D:\dsh-auto-memory\artifacts"
OUT = r"D:\dsh-auto-memory\docs\paper-figures"
os.makedirs(OUT, exist_ok=True)

l1 = json.load(open(rf"{R}\..\python\bench\results\m7-2-results.json", encoding="utf-8"))["results"]
l2 = json.load(open(rf"{R}\..\python\bench\results\m7-2-l2-results.json", encoding="utf-8"))["results"]
hyb = json.load(open(rf"{R}\m7-hybrid-pre\results.json", encoding="utf-8"))["results"]
msp = json.load(open(rf"{R}\m7-hybrid-pre\results-model-sparse.json", encoding="utf-8"))["results"]
rr = json.load(open(rf"{R}\m7-rerank-pre\results.json", encoding="utf-8"))["results"]
qp = json.load(open(rf"{R}\m7-rerank-pre\results-qwen-probe.json", encoding="utf-8"))["results"]
cl = json.load(open(rf"{R}\m7-cluster-pre\results.json", encoding="utf-8"))["results"]

C = {"bge-m3": "#2e7dd1", "qwen3-emb-0.6b": "#e8843c", "multilingual-e5-large": "#b03a3a"}
NAME = {"bge-m3": "BGE-M3", "qwen3-emb-0.6b": "Qwen3-Emb-0.6B", "multilingual-e5-large": "M-E5-Large"}
MODELS = list(C)


def get(rows, model, policy, key):
    for r in rows:
        if r["model"] == model and r["policy"] == policy:
            return r[key]
    return None


# ---- fig1: model quality (para-512), L1 vs L2 ----
fig, axes = plt.subplots(1, 2, figsize=(11, 4))
for ax, rows, title in ((axes[0], l1, "L1 合成压力层 (88 查询)"),
                        (axes[1], l2, "L2 真实语料层 (40 查询)")):
    metrics = ["recall@1", "recall@5", "mrr", "ndcg@10"]
    width = 0.26
    xs = range(len(metrics))
    for i, m in enumerate(MODELS):
        vals = [get(rows, m, "para-512-noov", k) for k in metrics]
        ax.bar([x + (i - 1) * width for x in xs], vals, width,
               label=NAME[m], color=C[m])
    ax.set_xticks(list(xs))
    ax.set_xticklabels(["R@1", "R@5", "MRR", "nDCG@10"])
    ax.set_ylim(0.4, 1.02)
    ax.set_title(title)
    ax.grid(axis="y", alpha=0.3)
axes[0].legend(loc="lower right", fontsize=9)
fig.suptitle("图1 三候选模型检索质量对比(bge-m3 × para-512 冻结策略)", y=1.02)
fig.tight_layout()
fig.savefig(rf"{OUT}\fig1_model_quality.png", dpi=150, bbox_inches="tight")
plt.close(fig)

# ---- fig2: chunk-size reversal for bge-m3 ----
fig, ax = plt.subplots(figsize=(7.5, 4.2))
pols = ["fixed-256-noov", "fixed-512-noov", "fixed-1024-noov", "para-512-noov", "para-512-ov64"]
xl = ["256", "512", "1024", "para-512", "para-512-ov64"]
ax.plot(xl, [get(l1, "bge-m3", p, "recall@5") for p in pols], "o-",
        color="#2e7dd1", label="L1 合成层 R@5")
ax.plot(xl, [get(l2, "bge-m3", p, "recall@5") for p in pols], "s-",
        color="#b03a3a", label="L2 真实层 R@5")
ax.plot(xl, [get(l2, "bge-m3", p, "hardneg_error") for p in pols], "^--",
        color="#666", label="L2 hard-negative 错误率")
ax.set_xlabel("chunk 策略(token 上限)")
ax.set_ylabel("指标值")
ax.set_title("图2 chunk 粒度效应的双层反转:BGE-M3(合成层偏小窗,真实层偏大窗)")
ax.legend()
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(rf"{OUT}\fig2_chunk_reversal.png", dpi=150)
plt.close(fig)

# ---- fig3: latency by model (L1, para-512) ----
fig, ax = plt.subplots(figsize=(7.5, 4))
xs = range(len(MODELS))
p50 = [get(l1, m, "para-512-noov", "latency_encode_search_p50_ms") for m in MODELS]
p95 = [get(l1, m, "para-512-noov", "latency_encode_search_p95_ms") for m in MODELS]
ax.bar([x - 0.18 for x in xs], p50, 0.34, label="p50", color="#4a90d9")
ax.bar([x + 0.18 for x in xs], p95, 0.34, label="p95", color="#1f5fa8")
ax.axhline(500, color="#b03a3a", ls="--", lw=1.5)
ax.text(2.35, 520, "500ms 查询预算", color="#b03a3a", fontsize=9)
ax.set_xticks(list(xs))
ax.set_xticklabels([NAME[m] for m in MODELS])
ax.set_ylabel("查询延迟(编码+精确检索, ms)")
ax.set_title("图3 查询延迟对比(CPU 16 线程,L1 语料 154 chunk)")
ax.legend()
ax.grid(axis="y", alpha=0.3)
fig.tight_layout()
fig.savefig(rf"{OUT}\fig3_latency.png", dpi=150)
plt.close(fig)

# ---- fig4: hybrid arms ----
fig, axes = plt.subplots(1, 2, figsize=(12, 4.2))
for ax, layer, title in ((axes[0], "L1", "L1 合成层"), (axes[1], "L2", "L2 真实层")):
    rows = [r for r in hyb if r["layer"] == layer]
    picks = [("dense", ""), ("lexical", ""), ("bm25s", ""), ("weighted", "w=0.3"),
             ("weighted", "w=0.5"), ("weighted", "w=0.7"), ("rrf", "k=60")]
    labels = ["dense", "lexical", "bm25s", "w=.3", "w=.5", "w=.7", "RRF"]
    r5, mrr = [], []
    for arm, prm in picks:
        row = next(r for r in rows if r["arm"] == arm and r["params"] == prm)
        r5.append(row["recall@5"])
        mrr.append(row["mrr"])
    xs = range(len(labels))
    ax.bar([x - 0.2 for x in xs], r5, 0.38, label="R@5", color="#4a90d9")
    ax.bar([x + 0.2 for x in xs], mrr, 0.38, label="MRR", color="#e8843c")
    ax.set_xticks(list(xs))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylim(0.55, 1.02)
    ax.set_title(title)
    ax.grid(axis="y", alpha=0.3)
axes[0].legend(loc="lower right", fontsize=9)
fig.suptitle("图4 检索通道消融:单通道 vs 加权融合 vs RRF(dense=冻结 BGE-M3)", y=1.02)
fig.tight_layout()
fig.savefig(rf"{OUT}\fig4_hybrid.png", dpi=150, bbox_inches="tight")
plt.close(fig)

# ---- fig5: rerank quality-latency tradeoff (log x) ----
fig, ax = plt.subplots(figsize=(7.5, 4.4))
pts = [
    ("融合基线(不重排) L1", 0.8373, 129, "#2e7dd1"),
    ("融合基线(不重排) L2", 0.8657, 129, "#2e7dd1"),
    ("bge-reranker L1", 0.947, 26093, "#b03a3a"),
    ("bge-reranker L2", 0.8921, 32857, "#b03a3a"),
    ("qwen3-reranker 探针 L1", 0.9, 7826 * 5, "#e8843c"),
    ("qwen3-reranker 探针 L2", 0.6867, 9496 * 5, "#e8843c"),
]
for label, mrr, ms, color in pts:
    ax.scatter(ms, mrr, s=90, color=color)
    ax.annotate(label, (ms, mrr), textcoords="offset points", xytext=(8, -4),
                fontsize=8.5)
ax.axvline(500, color="#666", ls="--", lw=1.2)
ax.text(530, 0.83, "500ms 预算", fontsize=9, color="#666", rotation=90)
ax.set_xscale("log")
ax.set_xlabel("单查询延迟 p50, ms(对数轴;qwen3 为 10 对探针×5 外推 50 对)")
ax.set_ylabel("MRR")
ax.set_title("图5 Rerank 的质量-延迟权衡:质量增益 vs 超预算 50-90 倍")
ax.grid(alpha=0.3, which="both")
fig.tight_layout()
fig.savefig(rf"{OUT}\fig5_rerank_tradeoff.png", dpi=150)
plt.close(fig)

# ---- fig6: clustering sweep ----
fig, ax = plt.subplots(figsize=(8, 4.4))
ag = [r for r in cl if r["algo"] == "agglomerative" and r["layer"] == "L1"]
thrs = [float(r["params"].split("=")[1]) for r in ag]
ax.plot(thrs, [r["NMI"] for r in ag], "o-", color="#2e7dd1", label="NMI")
ax.plot(thrs, [r["bCubedF1"] for r in ag], "s-", color="#e8843c", label="B-cubed F1")
ax.plot(thrs, [r["pairSameCluster"] for r in ag], "^--", color="#666",
        label="双子同簇率")
hd = [r for r in cl if r["algo"] == "hdbscan" and r["params"] == "mcs=3"]
ax.scatter([0.55], [hd[0]["noiseRate"]], marker="x", s=120, color="#b03a3a")
ax.annotate("HDBSCAN mcs=3\n噪声率 0.62", (0.55, hd[0]["noiseRate"]),
            textcoords="offset points", xytext=(10, -18), fontsize=9,
            color="#b03a3a")
ax.set_xlabel("凝聚聚类余弦距离阈值")
ax.set_ylabel("指标值")
ax.set_title("图6 聚类阈值扫描与 HDBSCAN 失效(thr=0.3 为工作点,NMI 0.916)")
ax.legend()
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(rf"{OUT}\fig6_cluster_sweep.png", dpi=150)
plt.close(fig)

# ---- fig7: resource footprint ----
fig, axes = plt.subplots(1, 3, figsize=(12, 3.6))
size = {"bge-m3": 2.29, "qwen3-emb-0.6b": 1.21, "multilingual-e5-large": 2.26}
load = [get(l1, m, "para-512-noov", "model_load_seconds") for m in MODELS]
rss = [get(l1, m, "para-512-noov", "peak_rss_mb") / 1024 for m in MODELS]
axes[0].bar([NAME[m] for m in MODELS], [size[m] for m in MODELS],
            color=[C[m] for m in MODELS])
axes[0].set_title("权重体积 (GB)")
axes[1].bar([NAME[m] for m in MODELS], load, color=[C[m] for m in MODELS])
axes[1].set_title("加载时间 (s)")
axes[2].bar([NAME[m] for m in MODELS], rss, color=[C[m] for m in MODELS])
axes[2].set_title("峰值 RSS (GB)")
axes[2].axhline(10, color="#b03a3a", ls="--", lw=1.2)
axes[2].text(0.1, 10.25, "本机空闲 RAM", fontsize=8.5, color="#b03a3a")
for ax in axes:
    ax.grid(axis="y", alpha=0.3)
    ax.tick_params(axis="x", labelsize=8.5)
fig.suptitle("图7 三模型资源占用(测试机 31GB RAM,空闲约 10GB)", y=1.04)
fig.tight_layout()
fig.savefig(rf"{OUT}\fig7_resource.png", dpi=150, bbox_inches="tight")
plt.close(fig)

print("figures ->", OUT, os.listdir(OUT))
