#!/usr/bin/env python3
"""Audit every measurement against what the taxonomy claims to measure.

A surface-matching defect once counted the final two characters 이다, conflating
all ~이다 endings with the intended 것이다. The conclusion stayed the same,
but its supporting numbers changed completely. A discovered defect class must
be rechecked everywhere. This script supplies the previously missing audit log.

Unlike lint_taxonomy.py, which validates declaration syntax, this checks what
those declarations actually match.

Audit axes:
1. Dead surface: no match in the rule's own body, even its signature examples.
   Strip emphasis/backticks before matching because input lacks that formatting.
   For patterns impossible to validate with in-section examples (line anchors),
   require a - 재감사: exemption reason of at least eight characters.
2. Unreachable alternatives: an earlier top-level alternative prefixes a later
   one; left-first regex alternation prevents separate counting of the latter.
3. Uninstrumented fields: a surface/metric field exists but its class ignores it.
4. Unmeasured metrics: COMPUTED declares a name not calculated by metrics.
5. Surface overlap: alternatives from different rules are substrings. Record
   these because they resemble defect 1, but do not affect exit status since
   some overlaps are legitimate.

Usage: python3 audit_measures.py [--taxonomy PATH] [--json]
Exit code: 0 no mismatch / 1 mismatch / 2 usage error.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from taxonomy_rules import parse_taxonomy, normalize  # noqa: E402
from metrics import KNOWN_METRICS, parse_metric_expr  # noqa: E402

DEFAULT_TAXONOMY = os.path.join(
    os.path.dirname(HERE), "references", "ai-tell-taxonomy.md"
)
FAIL_KINDS = ("죽은표층형", "도달불가대안", "계측밖필드", "미측정지표", "면제사유부실")
EMPHASIS_RE = re.compile(r"[*`]+")
# Exclude machine field lines: leaving declarations such as a literal surface
# lets dead patterns match their own declaration and appear alive. A corrupted
# copy passed in measurement; remove declarations before matching.
FIELD_RE = re.compile(r"(?m)^-\s*(?:표층형|surface|지표|metric|class|재감사):.*$")
REAUDIT_RE = re.compile(r"(?m)^-\s*재감사:\s*(.+?)\s*$")
MIN_REASON = 8


def sections(path):
    """Map rule IDs to their body below the heading, up to the next heading."""
    raw = normalize(open(path, encoding="utf-8").read())
    out, cur, buf = {}, None, []
    for line in raw.splitlines():
        h = re.match(r"^###\s+([A-Z]{1,2}-\d+)\.", line)
        if h:
            if cur:
                out[cur] = "\n".join(buf)
            cur, buf = h.group(1), []
            continue
        if re.match(r"^#{1,3}\s", line) and cur:
            out[cur] = "\n".join(buf)
            cur, buf = None, []
            continue
        if cur is not None:
            buf.append(line)
    if cur:
        out[cur] = "\n".join(buf)
    return out


def alternatives(surface):
    """Split only top-level |; treat parenthesized alternation as one unit."""
    parts, depth, cur = [], 0, ""
    esc = False
    for ch in surface:
        if esc:
            cur += ch
            esc = False
            continue
        if ch == "\\":
            cur += ch
            esc = True
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "|" and depth == 0:
            parts.append(cur)
            cur = ""
            continue
        cur += ch
    parts.append(cur)
    return [p for p in parts if p]


def plain(alt):
    """Return a string for alternatives without regex metacharacters, else None."""
    return alt if not re.search(r"[\\\[\]()*+?{}^$.|]", alt) else None


def _label(path):
    """Use a relative path within the skill root, otherwise the filename, for readable reports."""
    root = os.path.dirname(HERE)
    ap = os.path.abspath(path)
    return os.path.relpath(ap, root) if ap.startswith(root + os.sep) else os.path.basename(ap)


def audit(taxonomy_path):
    parsed = parse_taxonomy(taxonomy_path)
    body = sections(taxonomy_path)
    findings = []
    measurable = {"ANCHORED": 0, "COMPUTED": 0}
    measured = {"ANCHORED": 0, "COMPUTED": 0}
    plain_index = []

    for rid, rule in sorted(parsed["rules"].items()):
        klass = rule["klass"]
        surface, metric = rule["surface"], rule["metric"]

        if klass in ("HOLISTIC", None) and (surface or metric):
            findings.append(
                {
                    "kind": "계측밖필드",
                    "rule": rid,
                    "detail": f"class={klass or 'unannotated'} has "
                    + ("surface" if surface else "metric")
                    + " field",
                }
            )

        if klass == "ANCHORED" and surface:
            measurable["ANCHORED"] += 1
            try:
                pat = re.compile(surface)
            except re.error as e:
                findings.append(
                    {"kind": "죽은표층형", "rule": rid, "detail": f"Compile failed: {e}"}
                )
                continue
            sect = body.get(rid, "")
            hits = len(pat.findall(EMPHASIS_RE.sub("", FIELD_RE.sub("", sect))))
            exempt = REAUDIT_RE.search(sect)
            if hits:
                measured["ANCHORED"] += 1
            elif exempt and len(exempt.group(1)) >= MIN_REASON:
                findings.append(
                    {"kind": "재감사면제", "rule": rid, "detail": exempt.group(1)}
                )
            elif exempt:
                findings.append(
                    {
                        "kind": "면제사유부실",
                        "rule": rid,
                        "detail": f"Reaudit reason has {len(exempt.group(1))} characters; fewer than {MIN_REASON} does not qualify for exemption",
                    }
                )
            else:
                findings.append(
                    {
                        "kind": "죽은표층형",
                        "rule": rid,
                        "detail": "Zero matches in its own rule body; even signature examples are missed",
                    }
                )
            alts = alternatives(surface)
            for i, a in enumerate(alts):
                pa = plain(a)
                if pa is None:
                    continue
                plain_index.append((rid, pa))
                for b in alts[i + 1 :]:
                    pb = plain(b)
                    if pb and pb != pa and pb.startswith(pa):
                        findings.append(
                            {
                                "kind": "도달불가대안",
                                "rule": rid,
                                "detail": f"{pa!r} precedes {pb!r}, preventing separate counting of the latter",
                            }
                        )

        if klass == "COMPUTED" and metric:
            measurable["COMPUTED"] += 1
            try:
                clauses = parse_metric_expr(metric)
            except ValueError as e:
                findings.append({"kind": "미측정지표", "rule": rid, "detail": str(e)})
                continue
            unknown = [n for n, _o, _v in clauses if n not in KNOWN_METRICS]
            if unknown:
                findings.append(
                    {
                        "kind": "미측정지표",
                        "rule": rid,
                        "detail": f"Metrics not calculated by metrics: {unknown}",
                    }
                )
            else:
                measured["COMPUTED"] += 1

    for i, (rid_a, a) in enumerate(plain_index):
        for rid_b, b in plain_index[i + 1 :]:
            if rid_a == rid_b or a == b:
                continue
            if a in b or b in a:
                short, long_ = (a, b) if len(a) < len(b) else (b, a)
                findings.append(
                    {
                        "kind": "표층형겹침",
                        "rule": f"{rid_a}/{rid_b}",
                        "detail": f"{short!r} subsumes {long_!r}",
                    }
                )

    fails = [f for f in findings if f["kind"] in FAIL_KINDS]
    return {
        "taxonomy": _label(taxonomy_path),
        "rules": len(parsed["rules"]),
        "measurable": measurable,
        "measured": measured,
        "findings": findings,
        "fail_count": len(fails),
    }


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--taxonomy", default=DEFAULT_TAXONOMY)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if not os.path.isfile(args.taxonomy):
        print(f"Taxonomy file missing: {args.taxonomy}", file=sys.stderr)
        return 2
    rep = audit(args.taxonomy)
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        m, d = rep["measurable"], rep["measured"]
        print(
            f"Reaudit {rep['taxonomy']}: {rep['rules']} rules / "
            f"ANCHORED declared {m['ANCHORED']} measured {d['ANCHORED']} / "
            f"COMPUTED declared {m['COMPUTED']} measured {d['COMPUTED']}"
        )
        for f in rep["findings"]:
            print(f"  [{f['kind']}] {f['rule']}: {f['detail']}")
        print(f"Mismatches: {rep['fail_count']}")
    return 1 if rep["fail_count"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
