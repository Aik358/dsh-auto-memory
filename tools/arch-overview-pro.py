# -*- coding: utf-8 -*-
"""DSH Auto Memory - professional architecture overview.

Source of truth: docs/architecture/system-map.json
(21 components / 21 connections / 3 boundaries; every node is pinned to upstream
commit 828050056cf053c53fb2c237706f6e89c7baef09).

This script adds NO inferred relation: all edges and groupings are read from that
file. It only decides the presentation.

Usage:
    python tools/arch-overview-pro.py --locale zh-CN
    python tools/arch-overview-pro.py --locale en
"""
import json, os, argparse, time
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D

EN = {
    "client": ("DSH browser memory UI", "Panels / board / settings / skins", "host React / Iter5 / slots"),
    "api": ("Plugin API & model tools", "Loopback routes / tools / config tx", "loopback / config lock"),
    "engine": ("Node host - MemoryEngine", "Session isolation / refresh / lifecycle", "session runtime + AsyncLocalStorage"),
    "lifecycle": ("Water level, continuation, workbench", "Reserve / ritual / create / commit", "cross-process lock"),
    "sessions": ("DSH host sessions & models", "Controller / model select / subagents", "create / prompt / subagents"),
    "observe": ("Observation, evidence, activation", "Segment / evidence / decide / inbox", "master gate + sub-gates"),
    "prompt": ("DSH prompt assembly", "Rules / snapshot / Reference Tail", "budget / tiered snapshot"),
    "brief": ("Workspace change brief", "Project docs / external memory / diffs", "on by default, on change"),
    "writer": ("Writing, consolidation, PLAN upkeep", "Model distill / content gate / CAS", "shared queue / conflict safe"),
    "markdown": ("Markdown & pending candidates", "Memory truth source / USER staging", "PENDING never auto-global"),
    "recall": ("Recall & layered retrieval", "L0 summary / RRF / on-demand expand", "local / external / history"),
    "semantic": ("Semantic ranking & indexing", "C3 then C2 then lexical fallback", "asset probe / engine version"),
    "jsworker": ("JS semantic inference worker", "Separate process / e5-small q8", "fork / IPC"),
    "python": ("Optional Python sidecar", "Separate process / BGE-M3 / JSONL", "gates differ from ranking"),
    "hub": ("Memory hub & process governance", "Episodic / fact / procedure tiers", "evidence / approval gate"),
    "hubstore": ("Hub & evidence store", "JSON snapshots / JSONL evidence", "per user / workspace"),
    "skill": ("Reusable SKILL.md", "Exported on activation", "DSH_HOME/skills/"),
    "team": ("Optional team collaboration", "Identity / outbox / merge", "teamEnabled=true only"),
    "remote": ("Configured team remote", "Sync API and S3 object channel", "transport not injected here"),
    "governance": ("Config safety, storage, migration", "Lock / validate / repair / migrate", "path boundary / ownership log"),
    "governedstore": ("Files, config & derived index", "CAS / atomic write / conflict safe", "same store as maintenance"),
}


def find_repo(start):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.exists(os.path.join(d, "docs", "architecture", "system-map.json")):
            return d
        d = os.path.dirname(d)
    return os.path.abspath(start)


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = find_repo(HERE)
SRC = json.load(open(os.path.join(REPO, "docs", "architecture", "system-map.json"), encoding="utf-8"))
COMPS = {c["id"]: c for c in SRC["components"]}

W, H = 20.8, 18.0
BW, BH = 2.32, 1.34
TBW, TBH = 4.30, 1.22
EBW, EBH = 6.70, 2.05

STYLE = {
    "frontend": ("#dbeafe", "#1d4ed8"),
    "security": ("#ede9fe", "#6d28d9"),
    "backend":  ("#d1fae5", "#047857"),
    "database": ("#fef3c7", "#b45309"),
    "external": ("#f1f5f9", "#475569"),
}


def box(ax, cx, cy, w, h, label, sub, tag, ctype, fs=9.0, sfs=7.0, tfs=6.1):
    fc, ec = STYLE.get(ctype, STYLE["backend"])
    ax.add_patch(FancyBboxPatch((cx - w / 2, cy - h / 2), w, h,
                                boxstyle="round,pad=0.02,rounding_size=0.10",
                                linewidth=1.35, edgecolor=ec, facecolor=fc, zorder=3))
    ax.text(cx, cy + h * 0.27, label, ha="center", va="center",
            fontsize=fs, fontweight="bold", color="#0f172a", zorder=4)
    if sub:
        ax.text(cx, cy - h * 0.02, sub, ha="center", va="center",
                fontsize=sfs, color="#334155", zorder=4)
    if tag:
        ax.text(cx, cy - h * 0.31, tag, ha="center", va="center",
                fontsize=tfs, color="#64748b", style="italic", zorder=4)


def arrow(ax, p1, p2, label="", color="#334155", rad=0.0, lw=1.15, lfs=6.4):
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle="-|>", mutation_scale=9,
                                 linewidth=lw, color=color, zorder=2,
                                 connectionstyle="arc3,rad=%.2f" % rad))
    if label:
        ax.text((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, label,
                ha="center", va="center", fontsize=lfs, color="#475569", zorder=6,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.94))


def strip(ax, x, y, w, h, label, fs=6.8):
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                                boxstyle="round,pad=0.02,rounding_size=0.16",
                                linewidth=1.1, edgecolor="#94a3b8", facecolor="none",
                                linestyle=(0, (5, 3)), zorder=1))
    ax.text(x + w / 2, y + h + 0.10, label, ha="center", va="bottom",
            fontsize=fs, color="#475569", style="italic", zorder=2)


def build(locale, out):
    zh = (locale == "zh-CN")

    def C(cid):
        if zh or cid not in EN:
            c = COMPS[cid]
            return c["label"], c.get("sublabel", ""), c.get("tag", "")
        return EN[cid]

    def L(z, e):
        return z if zh else e

    fig, ax = plt.subplots(figsize=(W, H), dpi=110)
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.axis("off")
    fig.patch.set_facecolor("#fbfdff")

    ax.text(W / 2, H - 0.62, "DSH Auto Memory", ha="center",
            fontsize=27, fontweight="bold", color="#0b2f6b")
    ax.text(W / 2, H - 1.20,
            L("系统架构总览 - 21 个组件 - 21 条依赖关系 - 3 处进程/维护边界",
              "Architecture overview - 21 components - 21 dependency edges - 3 process/maintenance boundaries"),
            ha="center", fontsize=10.8, color="#3b5f97")
    ax.text(W / 2, H - 1.55,
            L("事实来源 docs/architecture/system-map.json；上游固定提交 8280500（package.json 3.2.10）；本图不新增任何推断关系",
              "Source: docs/architecture/system-map.json; pinned upstream 8280500 (package.json 3.2.10); no inferred relation added"),
            ha="center", fontsize=8.0, color="#64748b", style="italic")
    ax.text(W / 2, H - 1.86,
            L("多数方框是 Node 宿主内部模块，并非独立部署的服务；JS 语义 Worker 与可选 Python 为独立进程。",
              "Most boxes are modules inside the Node host, not separately deployed services; the JS semantic worker and optional Python run as separate processes."),
            ha="center", fontsize=7.6, color="#64748b")

    TIERS = [
        (15.30, L("界面与入口", "Interface & entry")),
        (13.15, L("插件接口", "Plugin API")),
        (10.70, L("记忆引擎", "Memory engine")),
        (7.70,  L("能力分支", "Capability branches")),
        (4.75,  L("子组件与存储", "Submodules & storage")),
        (2.20,  L("独立进程与治理", "Processes & governance")),
    ]
    for y, name in TIERS:
        ax.text(0.30, y, name, ha="center", va="center", fontsize=8.2,
                color="#94a3b8", fontweight="bold", rotation=90)
    for y in [16.20, 14.20, 11.95, 9.05, 6.15, 3.40, 1.05]:
        ax.plot([0.50, W - 0.28], [y, y], color="#e8eef6", lw=1.0, zorder=0)

    Y = {k: v for (v, k) in [(15.30, "A"), (13.15, "B"), (10.70, "C"),
                             (7.70, "D"), (4.75, "E"), (2.20, "F")]}
    CX = [1.98, 4.78, 7.58, 10.38, 13.18, 15.98, 18.78]
    P = {
        "client": (10.38, Y["A"]), "brief": (16.80, Y["A"]),
        "api": (10.38, Y["B"]),
        "engine": (10.38, Y["C"]),
        "lifecycle": (CX[0], Y["D"]), "writer": (CX[1], Y["D"]), "recall": (CX[2], Y["D"]),
        "observe": (CX[3], Y["D"]), "hub": (CX[4], Y["D"]), "prompt": (CX[5], Y["D"]),
        "team": (CX[6], Y["D"]),
        "sessions": (CX[0], Y["E"]), "markdown": (CX[1], Y["E"]), "semantic": (CX[2], Y["E"]),
        "governedstore": (CX[3], Y["E"]), "hubstore": (CX[4], Y["E"]), "skill": (CX[5], Y["E"]),
        "remote": (CX[6], Y["E"]),
        "python": (CX[1], Y["F"]), "jsworker": (CX[2], Y["F"]), "governance": (CX[3], Y["F"]),
    }

    # ── 3 处边界：标签一律置于盒子上方，且盒间留白；y 下移给标签留空 ──
    FY = Y["F"] - 0.30
    strip(ax, CX[1] - 1.14, FY - 1.02, 2.28, 2.04,
          L("可选 Python 进程 (JSONL)", "Optional Python process (JSONL)"))
    strip(ax, CX[2] - 1.14, FY - 1.02, 2.28, 2.04,
          L("独立 JS 推理进程 (fork/IPC)", "Separate JS process (fork/IPC)"))
    gx, gw = CX[3] - 1.22, 2.44
    gy, gh = FY - 1.02, (Y["E"] + 0.95) - (FY - 1.02)
    ax.add_patch(FancyBboxPatch((gx, gy), gw, gh,
                                boxstyle="round,pad=0.02,rounding_size=0.16",
                                linewidth=1.1, edgecolor="#94a3b8", facecolor="none",
                                linestyle=(0, (5, 3)), zorder=1))
    ax.text(gx + gw / 2, gy + gh + 0.10,
            L("维护区 - 同一份真源", "Maintenance - same source"),
            ha="center", va="bottom", fontsize=6.8, color="#475569", style="italic", zorder=2)

    for cid, (cx, cy) in P.items():
        lab, sub, tag = C(cid)
        if cid == "engine":
            fc, ec = STYLE[COMPS[cid]["type"]]
            ax.add_patch(FancyBboxPatch((cx - EBW / 2, cy - EBH / 2), EBW, EBH,
                                        boxstyle="round,pad=0.02,rounding_size=0.10",
                                        linewidth=1.45, edgecolor=ec, facecolor=fc, zorder=3))
            ax.text(cx, cy + 0.70, lab, ha="center", va="center",
                    fontsize=10.4, fontweight="bold", color="#0f172a", zorder=4)
            ax.text(cx, cy + 0.24, sub, ha="center", va="center",
                    fontsize=7.6, color="#334155", zorder=4)
            ax.text(cx, cy - 0.30,
                    L("会话隔离 - AsyncLocalStorage - 刷新与生命周期 - 分项预算信封",
                      "Session isolation - AsyncLocalStorage - refresh & lifecycle - per-section budget envelope"),
                    ha="center", va="center", fontsize=7.0, color="#0f5b47", zorder=4)
            ax.text(cx, cy - 0.74, tag, ha="center", va="center",
                    fontsize=6.3, color="#64748b", style="italic", zorder=4)
        else:
            big = cid in ("client", "brief", "api")
            yy = FY if cid in ("python", "jsworker", "governance") else cy
            box(ax, cx, yy, TBW if big else BW, TBH if big else BH, lab, sub, tag,
                COMPS[cid]["type"], fs=9.3 if big else 8.85)

    def bot(cid):
        big = cid in ("client", "brief", "api")
        cy = FY if cid in ("python", "jsworker", "governance") else P[cid][1]
        return (P[cid][0], cy - (TBH if big else BH) / 2)

    def top(cid):
        big = cid in ("client", "brief", "api")
        yy = Y["E"] + 0.95 if cid == "governedstore" else P[cid][1]
        return (P[cid][0], yy + (TBH if big else BH) / 2)

    for c in SRC["connections"]:
        f, t, lab = c["from"], c["to"], c.get("label", "")
        if f == "engine":
            arrow(ax, (P["engine"][0], Y["C"] - EBH / 2), top(t), L(lab, lab))
        elif f == "brief":
            arrow(ax, (P["brief"][0] - TBW / 2, P["brief"][1] - 0.18),
                  (P["prompt"][0] + BW / 2, P["prompt"][1] + 0.46),
                  L(lab, lab), rad=-0.18, color="#b45309")
        else:
            arrow(ax, bot(f), top(t), L(lab, lab))

    # ── ★注入三通路（左上空白区）──
    ax.text(0.70, 15.05,
            L("★ 注入三通路 —— 本系统最核心的复杂度", "★ Three injection surfaces - the core complexity"),
            ha="left", va="top", fontsize=9.6, fontweight="bold", color="#0b2f6b", zorder=7)
    note = L(
        "① rules section —— 静态纪律段，字节恒定，\n"
        "     充当 prompt 前缀缓存锚\n"
        "② context 动态快照 —— 分级投递：\n"
        "     完整版 4,164 B ／ 精简版 1,850 B\n"
        "③ Reference Tail —— 独立动态 surface，\n"
        "     渲染即一次性投递\n\n"
        "宿主把多个 context 面拼接成单串，再做\n"
        "「整串逐字节」去重 → 任一面微变即重投；\n"
        "而 systemPrompt 只提供 section() 与\n"
        "context() 两个注册口。\n\n"
        "记忆封套另带分项预算；内部步骤与可选分支\n"
        "（开关、降级、USER 候选等）不在本图展开。",
        "① rules section - static discipline block,\n"
        "     byte-stable, the prompt prefix-cache anchor\n"
        "② context dynamic snapshot - tiered delivery:\n"
        "     full 4,164 B / slim 1,850 B\n"
        "③ Reference Tail - a separate dynamic surface,\n"
        "     delivered once per render\n\n"
        "The host concatenates all context surfaces and\n"
        "de-duplicates the whole string byte-wise, so a\n"
        "tiny change re-delivers it; systemPrompt exposes\n"
        "only section() and context().\n\n"
        "The memory envelope also carries per-section\n"
        "budgets; internal steps and optional branches\n"
        "(switches, degradation, USER candidates) are\n"
        "not expanded in this overview.")
    ax.text(0.70, 14.62, note, ha="left", va="top", fontsize=7.4, color="#334155",
            linespacing=1.50, zorder=7,
            bbox=dict(boxstyle="round,pad=0.42", fc="#f8fbff", ec="#c7d9f0", lw=1.0))

    leg = [("frontend", L("界面", "Frontend")), ("security", L("接口/安全", "API / security")),
           ("backend", L("宿主模块", "Host module")),
           ("database", L("持久存储/产物", "Store / artifact")),
           ("external", L("外部依赖", "External"))]
    h1 = [Line2D([0], [0], marker="s", linestyle="none", markersize=9,
                 markerfacecolor=STYLE[k][0], markeredgecolor=STYLE[k][1], label=v) for k, v in leg]
    l1 = ax.legend(handles=h1, loc="lower left", bbox_to_anchor=(0.026, 0.012),
                   ncol=5, fontsize=7.6, frameon=True, framealpha=1.0, edgecolor="#dbe6f3")
    l1.get_frame().set_facecolor("white")
    ax.add_artist(l1)
    h2 = [Line2D([0], [0], linestyle=(0, (5, 3)), color="#94a3b8",
                 label=L("进程 / 维护边界", "Process / maintenance boundary")),
          Line2D([0], [0], marker=">", linestyle="-", color="#334155", markersize=6,
                 label=L("依赖方向（箭头旁为边标签）", "Dependency direction (edge label beside arrow)"))]
    l2 = ax.legend(handles=h2, loc="lower right", bbox_to_anchor=(0.988, 0.012),
                   fontsize=7.6, frameon=True, framealpha=1.0, edgecolor="#dbe6f3")
    l2.get_frame().set_facecolor("white")

    for _ in range(3):
        try:
            if os.path.exists(out):
                os.remove(out)
            break
        except OSError:
            time.sleep(0.4)
    fig.savefig(out, bbox_inches="tight", facecolor=fig.get_facecolor(), pad_inches=0.20)
    plt.close(fig)
    print("  wrote " + out + "  (" + str(os.path.getsize(out)) + " B)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--locale", default="zh-CN", choices=["zh-CN", "en"])
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    tag = "zh-CN" if a.locale == "zh-CN" else "en"
    tgt = a.out or os.path.join(REPO, "docs", "architecture", "overview-" + tag + "-pro.png")
    build(a.locale, tgt)
