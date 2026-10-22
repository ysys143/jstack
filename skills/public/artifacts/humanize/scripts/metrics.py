"""Deterministic document metrics for COMPUTED rules.

Shared by prescan.py (generation) and reconcile.py (independent recalculation).
Metrics are calculated in code and do not depend on LLM judgment.
"""
import re
import statistics

from taxonomy_rules import normalize

# Split only on sentence-ending punctuation; newlines (\n) are not boundaries.
# This prevents unpunctuated bullets/headings from distorting sentence_len_stdev.
_SENT_SPLIT = re.compile(r"[.!?。…]+")
_BULLET = re.compile(r"^\s*([-*•]|\d+[.)])\s+")
_EM_DASH = re.compile(r"[—–]")  # em-dash, en-dash


def _sentences(text):
    return [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]


def compute_metrics(raw_text):
    """Input text to metric dictionary; all values use NFC text."""
    text = normalize(raw_text)
    sents = _sentences(text)
    lengths = [len(s) for s in sents]
    lines = text.splitlines()
    nonempty = [ln for ln in lines if ln.strip()]
    bullets = [ln for ln in nonempty if _BULLET.match(ln)]

    out = {
        "sentence_count": len(sents),
        "sentence_len_mean": round(statistics.fmean(lengths), 2) if lengths else 0.0,
        "sentence_len_stdev": round(statistics.pstdev(lengths), 2) if len(lengths) > 1 else 0.0,
        "em_dash_count": len(_EM_DASH.findall(text)),
        "bullet_ratio": round(len(bullets) / len(nonempty), 3) if nonempty else 0.0,
        "char_count": len(text),
    }
    out.update(_upstream_metrics(text))
    return out


def _upstream_metrics(text):
    """Merge vendored im-not-ai metrics (v1 KatFish + v2 translationese) into COMPUTED.

    Return an empty dictionary for skill copies (humanize-en) without metrics_v1/v2.
    This graceful degradation keeps this file byte-identical across both skills.
    """
    try:
        import metrics_v1 as _v1
        import metrics_v2 as _v2
    except ImportError:
        return {}
    return {
        "comma_inclusion_rate": round(_v1.comma_inclusion_rate(text), 3),
        "ending_comma_rate": round(_v1.ending_comma_rate(text), 3),
        "comma_segment_length": round(_v1.comma_segment_length(text), 2),
        "safe_balance_count": _v1.safe_balance_count(text),
        "antithesis_count": _v2.antithesis_count(text),
        "double_particle_count": _v2.double_particle_count(text),
        "relative_clause_nesting": _v2.relative_clause_nesting(text),
    }


# Metric expressions: join '<name> <op> <number>' clauses with ' and '.
# Example: 'sentence_len_stdev < 8 and sentence_count >= 5'
_CLAUSE = re.compile(r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|==|<|>)\s*(-?\d+(?:\.\d+)?)\s*$")
_OPS = {
    "<": lambda a, b: a < b,
    ">": lambda a, b: a > b,
    "<=": lambda a, b: a <= b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
}


def parse_metric_expr(expr):
    """'a < 8 and b >= 5' -> [('a','<',8.0), ('b','>=',5.0)]. Invalid syntax raises ValueError."""
    clauses = []
    for part in expr.split(" and "):
        m = _CLAUSE.match(part)
        if not m:
            raise ValueError(f"Invalid metric expression: {part!r} (format: '<name> <op> <number>' [and ...])")
        clauses.append((m.group(1), m.group(2), float(m.group(3))))
    if not clauses:
        raise ValueError(f"Empty metric expression: {expr!r}")
    return clauses


def eval_metric_expr(expr, metrics):
    """Evaluate a compound metric expression -> (triggered: bool, actuals: dict).

    Trigger only when every clause is true. Unknown names/invalid syntax raise ValueError.
    """
    clauses = parse_metric_expr(expr)
    actuals = {}
    triggered = True
    for name, op, num in clauses:
        if name not in metrics:
            raise ValueError(f"Unknown metric name: {name!r} (available: {sorted(metrics)})")
        actuals[name] = metrics[name]
        if not _OPS[op](metrics[name], num):
            triggered = False
    return triggered, actuals


# Populated dummy metric keys used by lint to validate metric names.
KNOWN_METRICS = set(compute_metrics("문장 하나. 문장 둘.").keys())
