"""Parser for ai-tell-taxonomy.md, the single source of truth.

Shared exclusively by lint_taxonomy.py, prescan.py, and reconcile.py.
Keep surface-match syntax defined in one place in code too.

Rule annotations (bullets below `### {ID}. ...` in taxonomy.md):
    - class: ANCHORED | COMPUTED | HOLISTIC
    - 표층형: `pat1|pat2|pat3`        # ANCHORED only; Python re on NFC text
    - 지표: sentence_len_stdev < 8     # COMPUTED only

English taxonomy field aliases have identical meaning:
    - surface: `pat1|pat2`            # == 표층형
    - metric: em_dash_count > 3       # == 지표

Unannotated rules default to HOLISTIC (LLM judgment) for backward compatibility.
"""
import hashlib
import re
import unicodedata

HEADING_RE = re.compile(r"^###\s+([A-Z]{1,2}-\d+)\.\s*(.*?)\s*$")
SEVERITY_RE = re.compile(r"\[(S[123])\]")
CLASS_RE = re.compile(r"^-\s*class:\s*(ANCHORED|COMPUTED|HOLISTIC)\s*$")
SURFACE_RE = re.compile(r"^-\s*(?:표층형|surface):\s*(.+?)\s*$")
METRIC_RE = re.compile(r"^-\s*(?:지표|metric):\s*(.+?)\s*$")
VERSION_RE = re.compile(r"v(\d+\.\d+)")

VALID_CLASSES = {"ANCHORED", "COMPUTED", "HOLISTIC"}


def normalize(text):
    """Normalize to NFC, fixing the basis for surface matching and offsets."""
    return unicodedata.normalize("NFC", text)


def content_hash(raw_text):
    """Taxonomy content hash: the prescan/detector/reconcile consistency stamp."""
    return hashlib.sha256(normalize(raw_text).encode("utf-8")).hexdigest()[:16]


def _strip_backticks(s):
    s = s.strip()
    if s.startswith("`") and s.endswith("`") and len(s) >= 2:
        s = s[1:-1]
    return s.strip()


def parse_taxonomy(path):
    """taxonomy.md → {version, content_hash, rules: {id: rule}}.

    rule = {id, name, severity, klass, surface(raw|None), metric(str|None), line}
    """
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()

    version = None
    m = VERSION_RE.search(raw.splitlines()[0]) if raw.splitlines() else None
    if m:
        version = m.group(1)

    rules = {}
    duplicates = []
    current = None
    for lineno, line in enumerate(raw.splitlines(), start=1):
        h = HEADING_RE.match(line)
        if h:
            rid = h.group(1)
            title = h.group(2)
            sev = SEVERITY_RE.search(title)
            rule = {
                "id": rid,
                "name": SEVERITY_RE.sub("", title).strip(),
                "severity": sev.group(1) if sev else None,
                "klass": None,          # None means unannotated; treat as HOLISTIC
                "surface": None,
                "metric": None,
                "line": lineno,
            }
            if rid in rules:
                duplicates.append(rid)
            rules[rid] = rule
            current = rule
            continue
        if current is None:
            continue
        cm = CLASS_RE.match(line)
        if cm:
            current["klass"] = cm.group(1)
            continue
        sm = SURFACE_RE.match(line)
        if sm:
            current["surface"] = _strip_backticks(sm.group(1))
            continue
        mm = METRIC_RE.match(line)
        if mm:
            current["metric"] = mm.group(1).strip()
            continue

    return {
        "version": version,
        "content_hash": content_hash(raw),
        "rules": rules,
        "duplicates": duplicates,
    }


def effective_class(rule):
    return rule["klass"] or "HOLISTIC"
