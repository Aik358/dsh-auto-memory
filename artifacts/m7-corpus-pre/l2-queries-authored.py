# -*- coding: utf-8 -*-
"""L2 hand-authored benchmark queries over real episodes.

Authored 2026-08-24 against artifacts/m7-corpus-pre/episodes.jsonl (251 eps).
Categories mirror L1: zh/en/mixed/code + hardneg twins + supersede-style
recency preference (later record should win) + cross-source.
Emitted as multilingual-queries.jsonl / hard-negatives.jsonl /
activation-scenarios.jsonl by emit().
"""
import json
import os

OUT = r"D:\dsh-auto-memory\artifacts\m7-corpus-pre"

# qid -> (text, lang, cat, gold, neg[])
QUERIES = [
    # --- M7 embedding 选型/调研 (hard-negative 密集区) ---
    ("lq01", "embedding 模型选型调研比较了哪几个模型,许可证分别是什么", "zh", "m7-research",
     ["ep_69025fcb515a3c27"], ["ep_f0c77ba04cd121f5"]),
    ("lq02", "M7 contract freeze 交付了哪几份文档", "zh", "m7-contract",
     ["ep_fbaf15fadf93800d"], ["ep_69025fcb515a3c27"]),
    ("lq03", "tokenizer 和 chunking 的分工结论:dense tokenizer 绑定什么", "zh", "m7-research",
     ["ep_f0c77ba04cd121f5"], ["ep_69025fcb515a3c27"]),
    ("lq04", "Which milestone completed the JS stages M0-M6 with live verification of the reference tail?", "en", "milestone",
     ["ep_61e630101d904981"], ["ep_d55314eeacdc176f", "ep_500b546cf7287f7f"]),
    ("lq05", "lexical_pre_v2 的 BM25 参数是什么,k1 和 b 取多少", "zh", "lexical",
     ["ep_4d566bf383c52c84"], []),
    ("lq06", "JS 词法检索层在 M7 架构里的定位是什么", "zh", "lexical",
     ["ep_2d11607f40f1e2fa"], ["ep_4d566bf383c52c84"]),
    ("lq07", "MIRIX 代码审查借鉴了哪些设计,不照搬哪些", "zh", "m7-research",
     ["ep_83d38dfa5430a366"], []),
    # --- M5/M6 validator / inbox (强 hard-negative 对) ---
    ("lq08", "context_push envelope 的预算是多少条 segment 多少字节", "zh", "m5",
     ["ep_9695c53761cd879c"], ["ep_0fb0cc7f49cd63ba"]),
    ("lq09", "ActivationRequest validator 硬校验哪些身份和预算字段", "zh", "m6",
     ["ep_0fb0cc7f49cd63ba"], ["ep_7f62b88e4a88a30c"]),
    ("lq10", "per-runtime inbox 的 offer 门序是什么", "zh", "m6",
     ["ep_7f62b88e4a88a30c"], ["ep_0fb0cc7f49cd63ba"]),
    ("lq11", "live 会话里 contextVersion 每步自增导致什么问题,怎么解的", "zh", "m6",
     ["ep_821e9a67dfaa1167"], []),
    ("lq12", "read coverage 落盘的实测值是多少,隐私投影检查结果", "zh", "m5",
     ["ep_d5a1fada0a5eb4e9"], ["ep_9695c53761cd879c"]),
    ("lq13", "anchor 开启时 compactLayer 记录级压缩的配额怎么分", "zh", "m3b",
     ["ep_500b546cf7287f7f"], []),
    # --- OX-Alpha / OpenCode 线 ---
    ("lq14", "OX-Alpha 切 Responses API 为什么不可行,503 的根因", "zh", "oxalpha",
     ["ep_09c98bb7f754d65c"], ["ep_b73077cbb601372b"]),
    ("lq15", "OpenCode v1.18.21 修复了什么和截断相关的问题", "zh", "opencode",
     ["ep_b73077cbb601372b"], ["ep_09c98bb7f754d65c"]),
    ("lq16", "pi-ai 插件有没有截断自动续写,现有旋钮是哪两个", "zh", "oxalpha",
     ["ep_ddc63e90a4b13fc5"], ["ep_e18652acb486ac1d"]),
    ("lq17", "UNKNOWN_MODEL 扰动源的真相是什么,和 subagent 配置有关吗", "zh", "incident",
     ["ep_e18652acb486ac1d"], ["ep_668da319b91aa991"]),
    ("lq18", "web profile link 装载关系是怎么实锤的", "zh", "incident",
     ["ep_f2df4ea4d35bf174"], ["ep_668da319b91aa991"]),
    # --- M4 shadow ---
    ("lq19", "M4-2 corpus adapter 的六种 fail closed 原因", "zh", "m4",
     ["ep_566f658323d4e89b"], ["ep_0d0c64a265caac62"]),
    ("lq20", "M4-4 live 影子验证发现了哪两个真实缺陷", "zh", "m4",
     ["ep_d55314eeacdc176f"], ["ep_ab6cde5f504c55ca"]),
    ("lq21", "shadow-host 的 audit 隐私投影怎么做的,保留多久", "zh", "m4",
     ["ep_ab6cde5f504c55ca"], ["ep_d55314eeacdc176f"]),
    # --- 跨语言(en 查中文记录) ---
    ("lq22", "Why was the route to M5/M6/M7 re-ordered into two stages, and what was frozen?", "en", "milestone",
     ["ep_d1b5ccbaa319263e"], []),
    ("lq23", "What was the root cause of cross-step injected packets being rejected as stale?", "en", "m6",
     ["ep_821e9a67dfaa1167"], []),
    ("lq24", "How does the auto-memory plugin protect itself from UNKNOWN_MODEL errors?", "en", "incident",
     ["ep_668da319b91aa991"], ["ep_e18652acb486ac1d"]),
    # --- session episodes(真实会话) ---
    ("lq25", "HarmonyOS 开发指引的核心规则和 API 用法清单", "zh", "session",
     ["ep_d1ad532209bc0390"], []),
    ("lq26", "PsychoPy Studio 鸿蒙移植的技术栈是什么", "zh", "session",
     ["ep_fed40ce72e0ecc0f"], []),
    ("lq27", "抽卡演出重做任务里用户对美学的抱怨和要求是什么", "zh", "session",
     ["ep_93e469ae72141e16"], ["ep_35976e7114cb8b34", "ep_04206de019da3a18"]),
    ("lq28", "素材来源放宽到游戏资产库的决定依据", "zh", "session",
     ["ep_464d5cf4839ee012"], ["ep_0fd0cbbac234bb5b"]),
    ("lq29", "GitHub SSH host key 问题导致插件装不上怎么处理", "zh", "session",
     ["ep_7f86c6be19ce3103"], ["ep_2796e89a18b449d2"]),
    ("lq30", "marketplace 添加失败因为残留的 partial clone", "zh", "session",
     ["ep_2796e89a18b449d2"], ["ep_7f86c6be19ce3103"]),
    # --- profile 规则块 ---
    ("lq31", "项目里哪个文件是唯一权威,里程碑完成后必须更新什么", "zh", "rules",
     ["PROFILE:system-map-authority"], []),
    # --- code/错误码风格 ---
    ("lq32", "503 Endpoint is unavailable ox-alpha-free responses", "code", "oxalpha",
     ["ep_09c98bb7f754d65c"], []),
    ("lq33", "ev_pre_ 前缀的 coverage 记录 cov=0.035", "code", "m5",
     ["ep_d5a1fada0a5eb4e9"], []),
    ("lq34", "finish_reason network_error 重试 xAI 容量流", "code", "opencode",
     ["ep_b73077cbb601372b"], []),
    ("lq35", "pkt_pre_ a602f2aa 注入即泵尾注渲染", "code", "m6",
     ["ep_61e630101d904981"], ["ep_821e9a67dfaa1167"]),
    # --- 新近性偏好(supersede 风格:后记录应胜) ---
    ("lq36", "M7-0 和 M7-1 做完了什么,测试结果如何", "zh", "m7-progress",
     ["ep_2010e63c143e2e2f"], ["ep_fbaf15fadf93800d"]),
    ("lq37", "全量回归现在一共多少项测试全绿", "zh", "m7-progress",
     ["ep_2010e63c143e2e2f"], ["ep_61e630101d904981"]),
    # --- mixed 中英混写 ---
    ("lq38", "activation inbox 的 capability snapshot 按什么判定 dynamic-context", "mixed", "m6",
     ["ep_af18a2831102157b"], ["ep_7f62b88e4a88a30c"]),
    ("lq39", "M5 envelope 的 identity 和 coverage v2 前缀比例设计", "mixed", "m5",
     ["ep_9695c53761cd879c"], ["ep_0fb0cc7f49cd63ba"]),
    ("lq40", "embedded 4096 维 padding 和 embedding_config 版本列是哪来的设计", "mixed", "m7-research",
     ["ep_83d38dfa5430a366"], []),
]

# hard-negative pairs (episodeId twins, same topic, must not be confused)
HARD_NEGATIVE_PAIRS = [
    ("ep_69025fcb515a3c27", "ep_f0c77ba04cd121f5", "M7 选型调研 vs 跨语言/tokenizer 研究"),
    ("ep_0fb0cc7f49cd63ba", "ep_7f62b88e4a88a30c", "M6-1 validator vs M6-2 inbox 状态机"),
    ("ep_9695c53761cd879c", "ep_0fb0cc7f49cd63ba", "M5-1/2/3 bridge vs M6-1 validator"),
    ("ep_09c98bb7f754d65c", "ep_b73077cbb601372b", "OX-Alpha responses 不可行 vs OpenCode 更新核查"),
    ("ep_ddc63e90a4b13fc5", "ep_e18652acb486ac1d", "pi-ai 续写核查 vs 扰动源澄清"),
    ("ep_e18652acb486ac1d", "ep_668da319b91aa991", "扰动源澄清 vs UNKNOWN_MODEL 自保补丁"),
    ("ep_d55314eeacdc176f", "ep_61e630101d904981", "M4-4 live 通过 vs M6-4 live 通过"),
    ("ep_566f658323d4e89b", "ep_ab6cde5f504c55ca", "M4-2 corpus adapter vs M4-3 shadow host"),
    ("ep_7f86c6be19ce3103", "ep_2796e89a18b449d2", "SSH host key vs partial clone"),
    ("ep_93e469ae72141e16", "ep_464d5cf4839ee012", "抽卡美学抱怨 vs 素材放宽决定"),
]

# activation scenarios (M7-6 calibration inputs): scenario -> expected episode + level hint
ACTIVATION_SCENARIOS = [
    ("as01", "用户在新会话问'现在 embedding 选型定了吗'", "ep_2010e63c143e2e2f", "hint"),
    ("as02", "用户问'activation validator 都查什么'", "ep_0fb0cc7f49cd63ba", "excerpt"),
    ("as03", "用户报错 'activation 一直 stale-context 丢弃'", "ep_821e9a67dfaa1167", "checklist"),
    ("as04", "用户问'BM25 参数能调吗'", "ep_4d566bf383c52c84", "excerpt"),
    ("as05", "用户说'OX-Alpha 又截断了'", "ep_ddc63e90a4b13fc5", "checklist"),
    ("as06", "用户问'能不能把 Python 直接读 memory 文件'", "ep_f274f56fea81d2b0", "hint"),
    ("as07", "用户问'reference tail 什么时候算 delivered'", "ep_61e630101d904981", "excerpt"),
    ("as08", "用户问'inbox 的重复门和冷却怎么工作'", "ep_7f62b88e4a88a30c", "excerpt"),
]


def main():
    eps = {}
    for line in open(os.path.join(OUT, "episodes.jsonl"), encoding="utf-8"):
        e = json.loads(line)
        eps[e["episodeId"]] = e
    # profile 特例:按文本匹配 system-map 权威规则块
    with open(os.path.join(OUT, "multilingual-queries.jsonl"), "w", encoding="utf-8") as fq, \
         open(os.path.join(OUT, "hard-negatives.jsonl"), "w", encoding="utf-8") as fn, \
         open(os.path.join(OUT, "activation-scenarios.jsonl"), "w", encoding="utf-8") as fa:
        missing = []
        for qid, text, lang, cat, gold, neg in QUERIES:
            gold_ids = []
            for g in gold:
                if g.startswith("PROFILE:"):
                    # resolve by content match
                    for eid, e in eps.items():
                        if "唯一权威" in e["text"] and "progressLedger" in e["text"]:
                            gold_ids.append(eid)
                            break
                elif g in eps:
                    gold_ids.append(g)
                else:
                    missing.append(g)
            neg_ids = [n for n in neg if n in eps]
            missing.extend(n for n in neg if n not in eps)
            fq.write(json.dumps({
                "qid": qid, "text": text, "lang": lang, "cat": cat,
                "gold": gold_ids, "neg": neg_ids,
                "workspace": "ws/dsh-core" if gold_ids and
                             eps.get(gold_ids[0], {}).get("workspace") == "ws/dsh-core"
                             else "all",
            }, ensure_ascii=False) + "\n")
        for a, b, why in HARD_NEGATIVE_PAIRS:
            if a in eps and b in eps:
                fn.write(json.dumps({"a": a, "b": b, "why": why},
                                    ensure_ascii=False) + "\n")
        for sid, scen, gold, level in ACTIVATION_SCENARIOS:
            if gold in eps:
                fa.write(json.dumps({"sid": sid, "scenario": scen,
                                     "goldEpisode": gold, "levelHint": level},
                                    ensure_ascii=False) + "\n")
        if missing:
            print("MISSING episode ids:", set(missing))
    n_q = sum(1 for _ in open(os.path.join(OUT, "multilingual-queries.jsonl"), encoding="utf-8"))
    print(f"queries={n_q} hardneg_pairs={len(HARD_NEGATIVE_PAIRS)} scenarios={len(ACTIVATION_SCENARIOS)}")


if __name__ == "__main__":
    main()
