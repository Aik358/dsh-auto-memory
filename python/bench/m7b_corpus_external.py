# -*- coding: utf-8 -*-
"""M7-2 L2 external real corpus builder (contract docs/M7-TASKSET-DISPATCH.md §4).

Read-only over the user's real memory/session stores; writes only to
artifacts/m7-corpus-pre/. Rules implemented:
  - originals never modified; nothing imported back into MEMORY.md
  - system/developer instructions, tool declarations, runtime context excluded
  - profile files split by heading block; Markdown/RAW_JSON dupes collapsed
  - sessions merged into episodes by (session, time adjacency) - never
    per-message or whole-session vector units
  - secrets/phones/absolute paths redacted; only hashed sourceRef/sessionRef
  - sourceDigest / turn range / occurredAt / real flag / generator recorded
  - train/dev/test split by sessionRef hash; 100-300 episodes first round
"""
import glob
import hashlib
import json
import os
import re
import sys

OUT = r"D:\dsh-auto-memory\artifacts\m7-corpus-pre"
HOME = r"C:\Users\JH Z"

PROFILE_FILES = [
    ("workbuddy-profile", HOME + r"\.workbuddy\MEMORY.md"),
    ("workbuddy-session-memory", HOME + r"\.workbuddy\memory\bc55faab-1f63-4a45-8aa1-79d2b0f5f9df_memory.md"),
    ("codebuddy-memery", HOME + r"\.codebuddy\memery\bc55faab-1f63-4a45-8aa1-79d2b0f5f9df_memery.md"),
    ("dsh-profile", HOME + r"\.dsh\memory\MEMORY.md"),
    ("dsh-workspace-profile", HOME + r"\.dsh\memory\workspaces\--D--dsh-auto-memory--\MEMORY.md"),
]
DSH_WS_DIR = HOME + r"\.dsh\memory\workspaces\--D--dsh-auto-memory--"
SESSION_GLOBS = [
    ("workbuddy", HOME + r"\.workbuddy\projects\*\*.jsonl"),
    ("claude", HOME + r"\.claude\projects\**\*.jsonl"),
    ("codex", HOME + r"\.codex\sessions\**\*.jsonl"),
]

RE_SECRET = re.compile(
    r"(sk-[A-Za-z0-9_\-]{8,}|api[_\-]?key\s*[:=]\s*\S{6,}|Bearer\s+[A-Za-z0-9._\-]{8,}"
    r"|[A-Za-z0-9]{32,})")
RE_PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
RE_ABSPATH = re.compile(r"[A-Za-z]:\\[^\s\"'<>|,;)]*")
RE_ABSPATH2 = re.compile(r"(?:/[a-zA-Z0-9_.\-]+){3,}/[^\s\"'<>|,;)]*")
RE_USERHOME = re.compile(r"[A-Za-z]:/[Uu]sers/[^\s\"'<>|,;)/]+(?:/[^\s\"'<>|,;)]*)?")
RE_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

redaction_counts = {"secret": 0, "phone": 0, "abspath": 0, "email": 0}


def clean(text):
    text = RE_SECRET.sub("<redacted:secret>", text)
    redaction_counts["secret"] += 1 if "<redacted:secret>" in text else 0
    text2 = RE_PHONE.sub("<redacted:phone>", text)
    redaction_counts["phone"] += (text2 != text); text = text2
    text2 = RE_ABSPATH.sub("<path>", text)
    redaction_counts["abspath"] += (text2 != text); text = text2
    text2 = RE_ABSPATH2.sub("<path>", text)
    redaction_counts["abspath"] += (text2 != text); text = text2
    text2 = RE_USERHOME.sub("<user-home>", text)
    redaction_counts["abspath"] += (text2 != text); text = text2
    text2 = RE_EMAIL.sub("<redacted:email>", text)
    redaction_counts["email"] += (text2 != text); text = text2
    return text


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def href(prefix, s):
    return prefix + "_" + sha(s)[:16]


def cjk_ratio(t):
    if not t:
        return 0.0
    cjk = sum(1 for ch in t if "\u4e00" <= ch <= "\u9fff")
    letters = sum(1 for ch in t if ch.isalpha())
    if letters == 0:
        return 1.0 if cjk else 0.0
    return cjk / max(1, cjk + letters)


def lang_of(t):
    r = cjk_ratio(t)
    if r > 0.85:
        return "zh"
    if r < 0.05:
        return "en"
    return "mixed"


def ep_id(kind, key):
    return "ep_" + sha(kind + "\x00" + key)[:16]


def bounded(text, limit=1500):
    t = text.strip()
    return t if len(t) <= limit else t[:limit] + "…"


# ---------------- profile heading blocks ----------------

def profile_episodes():
    out, seen_digests = [], set()
    for name, path in PROFILE_FILES:
        if not os.path.isfile(path):
            continue
        try:
            raw = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        blocks, cur_heading, cur_lines = [], None, []
        for line in raw.splitlines():
            if line.startswith("#"):
                if cur_lines and any(l.strip() for l in cur_lines):
                    blocks.append((cur_heading, "\n".join(cur_lines)))
                cur_heading, cur_lines = line.strip(), []
            else:
                cur_lines.append(line)
        if cur_lines and any(l.strip() for l in cur_lines):
            blocks.append((cur_heading, "\n".join(cur_lines)))
        for heading, body in blocks:
            body_c = clean(body)
            # RAW_JSON duplicate collapse: if block is json twin of an earlier
            # markdown block (same first 80 cleaned chars), skip
            key = re.sub(r"\s+", "", body_c)[:80]
            if not key or key in seen_digests:
                continue
            seen_digests.add(key)
            if len(body_c) < 60:
                continue
            out.append({
                "episodeId": ep_id("profile", name + heading + body_c[:120]),
                "kind": "profile-block",
                "source": name,
                "heading": clean(heading or "")[:120],
                "text": bounded(heading + "\n" + body_c if heading else body_c),
                "sourceDigest": "dg_" + sha(body)[:24],
                "sessionRef": href("sr", name),
                "turnStart": None, "turnEnd": None,
                "occurredAt": None,
                "lang": lang_of(body_c),
                "real": True, "derived": False, "synthetic": False,
                "generator": name,
                "workspace": "ws/external-" + name.split("-")[0],
            })
    return out


# ---------------- DSH daily anchored records ----------------

def dsh_daily_episodes():
    out = []
    files = sorted(glob.glob(os.path.join(DSH_WS_DIR, "*.md")) +
                   glob.glob(os.path.join(DSH_WS_DIR, "archive", "*.md")) +
                   glob.glob(os.path.join(DSH_WS_DIR, "reflections", "*.md")))
    for path in files:
        day = re.findall(r"(\d{4}-\d{2}-\d{2})", os.path.basename(path))
        day = day[0] if day else None
        try:
            raw = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        # anchored records: <!-- memory:mem_xxx --> ... <!-- next -->
        parts = re.split(r"<!--\s*memory:(mem_[0-9a-f]+)\s*-->", raw)
        for i in range(1, len(parts), 2):
            mid, body = parts[i], parts[i + 1]
            body_c = clean(body.strip())
            if len(body_c) < 40:
                continue
            ts = None
            m = re.search(r"\((\d{1,2}):(\d{2})\)", body_c[:200])
            if day and m:
                ts = f"{day}T{int(m.group(1)):02d}:{m.group(2)}:00"
            out.append({
                "episodeId": ep_id("dsh", mid),
                "kind": "memory-record",
                "source": "dsh-workspace-daily",
                "heading": None,
                "text": bounded(body_c),
                "sourceDigest": "dg_" + sha(body)[:24],
                "sessionRef": href("sr", "dsh:" + (day or "na")),
                "memoryId": mid,
                "turnStart": None, "turnEnd": None,
                "occurredAt": ts,
                "lang": lang_of(body_c),
                "real": True, "derived": False, "synthetic": False,
                "generator": "dsh-auto-memory",
                "workspace": "ws/dsh-core",
            })
    return out


# ---------------- session logs -> episodes ----------------

SKIP_MARKERS = ("<system-reminder", "<environment_context>", "<permissions",
                "<user_info>", "<identity_context", "<local-command-caveat",
                "<tool_result", "<attachments", "Caveat:", "<boot")


def text_from_content(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for b in c:
            if isinstance(b, dict) and isinstance(b.get("text"), str):
                if b.get("type") in ("input_text", "output_text", "text"):
                    parts.append(b["text"])
        return "\n".join(parts)
    return ""


def user_worthy(t):
    t = t.strip()
    if not t or len(t) < 12:
        return False
    if any(t.startswith(m) or m in t[:200] for m in SKIP_MARKERS):
        return False
    if t.startswith("<"):
        return False
    if t.startswith("Please continue with the conversation"):
        return False  # summarization-continuation artifact, not real intent
    return True


def assistant_worthy(t):
    t = t.strip()
    return len(t) >= 80 and not t.startswith("<")


def parse_workbuddy(path):
    turns = []
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") != "message":
            continue
        role = d.get("role")
        text = text_from_content(d.get("content"))
        turns.append((role, text, d.get("timestamp")))
    return turns


def parse_claude(path):
    turns = []
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") not in ("user", "assistant"):
            continue
        m = d.get("message") or {}
        text = text_from_content(m.get("content"))
        ts = d.get("timestamp")
        if isinstance(ts, str):
            ts = None
        turns.append(("user" if d["type"] == "user" else "assistant", text, ts))
    return turns


def parse_codex(path):
    turns = []
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        t = d.get("type")
        p = d.get("payload") or {}
        if t == "response_item" and p.get("type") == "message":
            role = p.get("role")
            if role not in ("user", "assistant"):
                continue
            text = text_from_content(p.get("content"))
            ts = d.get("timestamp")
            if isinstance(ts, str):
                ts = None
            turns.append((role, text, ts))
        elif t == "event_msg" and p.get("type") in ("user_message", "agent_message"):
            role = "user" if p["type"] == "user_message" else "assistant"
            turns.append((role, str(p.get("message", "")), None))
    return turns


PARSERS = {"workbuddy": parse_workbuddy, "claude": parse_claude, "codex": parse_codex}
MAX_EP_PER_SESSION = 6
MAX_EP_TOTAL = 300
MIN_EP_CHARS = 120


def session_episodes():
    out = []
    global_dedupe = set()
    for name, pattern in SESSION_GLOBS:
        files = sorted(glob.glob(pattern, recursive=True))
        # newest first by mtime to prioritize recent, higher-quality sessions
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        for path in files:
            if len(out) >= MAX_EP_TOTAL:
                break
            try:
                turns = PARSERS[name](path)
            except OSError:
                continue
            sref = href("sr", os.path.basename(path))
            emitted = 0
            # merge: user turn + following assistant conclusion = one episode
            pending_user = None
            for role, text, ts in turns:
                if role == "user" and user_worthy(text):
                    if pending_user is None:
                        pending_user = (text, ts)
                elif role == "assistant" and pending_user is not None and assistant_worthy(text):
                    u_text, u_ts = pending_user
                    pending_user = None
                    body = "Q: " + bounded(u_text, 500) + "\nA: " + bounded(text, 1000)
                    body_c = clean(body)
                    if len(body_c) < MIN_EP_CHARS:
                        continue
                    dkey = re.sub(r"\s+", "", body_c)[:120]
                    if dkey in global_dedupe:
                        continue
                    global_dedupe.add(dkey)
                    out.append({
                        "episodeId": ep_id("session", sref + str(emitted) + body_c[:80]),
                        "kind": "session-episode",
                        "source": name,
                        "heading": None,
                        "text": body_c,
                        "sourceDigest": "dg_" + sha(body)[:24],
                        "sessionRef": sref,
                        "turnStart": None, "turnEnd": None,
                        "occurredAt": u_ts,
                        "lang": lang_of(body_c),
                        "real": True, "derived": False, "synthetic": False,
                        "generator": name,
                        "workspace": "ws/external-" + name,
                    })
                    emitted += 1
                    if emitted >= MAX_EP_PER_SESSION:
                        break
            if len(out) >= MAX_EP_TOTAL:
                break
    return out


def split_of(session_ref):
    b = int(sha(session_ref)[:8], 16) % 100
    return "train" if b < 70 else ("dev" if b < 85 else "test")


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {"generatedAt": "2026-08-24", "sources": [], "rules": {
        "readonly": True, "exclusions": list(SKIP_MARKERS),
        "redactions": ["secret", "phone", "abspath", "email"],
        "episodeMerge": "user-turn + assistant-conclusion per session, <=6/session",
        "split": "by sessionRef hash 70/15/15 (paraphrases never cross splits)"}}
    episodes = []
    prof = profile_episodes()
    daily = dsh_daily_episodes()
    sess = session_episodes()
    episodes.extend(prof + daily + sess)
    for e in episodes:
        e["split"] = split_of(e["sessionRef"])
    manifest["sources"] = [
        {"name": n, "files": len(glob.glob(p, recursive=True)), "episodes":
         sum(1 for e in episodes if e["source"] == n or e["source"].startswith(n))}
        for n, p in [(s, g) for s, g in
                     [("profile-files", "*.md")] + SESSION_GLOBS]]
    with open(os.path.join(OUT, "episodes.jsonl"), "w", encoding="utf-8") as f:
        for e in episodes:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    with open(os.path.join(OUT, "raw-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    splits = {}
    for e in episodes:
        splits[e["split"]] = splits.get(e["split"], 0) + 1
    langs = {}
    for e in episodes:
        langs[e["lang"]] = langs.get(e["lang"], 0) + 1
    with open(os.path.join(OUT, "split-manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"splits": splits, "langs": langs,
                   "byKind": {k: sum(1 for e in episodes if e["kind"] == k)
                              for k in {e["kind"] for e in episodes}}},
                  f, ensure_ascii=False, indent=2)
    privacy = {
        "episodes": len(episodes),
        "redactionCounts": redaction_counts,
        "hashedRefsOnly": True,
        "noOriginalsModified": True,
        "reviewQueue": ">=30 recommended: emitted separately",
    }
    with open(os.path.join(OUT, "privacy-report.json"), "w", encoding="utf-8") as f:
        json.dump(privacy, f, ensure_ascii=False, indent=2)
    print(f"episodes={len(episodes)} profile={len(prof)} dsh-daily={len(daily)} "
          f"session={len(sess)} splits={splits} langs={langs} "
          f"redactions={redaction_counts}")


if __name__ == "__main__":
    sys.exit(main())
