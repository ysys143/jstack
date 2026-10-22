#!/usr/bin/env python3
"""Check connectors for diagonals (rule 1), overlap, ambiguous corridors, and crossings (rule 3).

connector-rules.md declares diagonal connectors an automatic failure, but there
was no enforcement. The vendored verify-geometry.py parses only rect elements and
checks label-mask clipping. SKILL.md nevertheless claimed automated diagonal
detection; external review exposed the discrepancy on 2026-08-30.

Why a separate file:
verify-geometry.py is a byte-identical upstream import, protected by the suite.
An attempted change immediately failed the upstream-byte-identity self-check.
The contract was correct, so implementation moved here instead of weakening it.

Provenance:
Python rewrite of up:archify (MIT, https://github.com/tt-a1i/archify)
scripts/check-render-output.mjs: orthogonal_arrows, collectArrows, and
diagonalStraightSegments. Rule 3 ports shared/geometry.mjs functions
collectAmbiguousCorridors, collinearAxisOverlap, and properSegmentIntersection
one-to-one. See NOTICE, LICENSE.archify, and UPSTREAM.sha256.
Upstream selects arrows through classes such as a-default; local SVG lacks those,
so marker-end determines membership. Exclude legend lines only in exact paired-sentinel spans.

Shortest invalid routes to a green result:
1. Remove marker-end: direction disappears, which the taste gate catches.
2. Split diagonals into pieces below 0.01: the staircase remains visually apparent.
3. Draw diagonals with Q/C curves: a real upstream-shared gap. Only straight commands
   are modeled. Entirely curved connectors silence orthogonality, overlap, and crossing
   checks; connector/no-segments reports that unmeasurable state.
4. Reduce overlap below 8px: a blind spot inherited from upstream's default;
   --min-overlap 0 narrows it.
5. Overuse hops: a Q around a crossing removes it from straight segments and passes.
   This intentional proxy does not establish that a hop is visually legible.
6. Offset fixed coordinates by 1px to escape collinearity. Full-length >=12px
   near-parallel clearance under rule 4 still requires visual inspection.

Diagnostic contract (--json):
Emit one envelope to stdout instead of human-readable lines. Fields follow
up:archify shared/diagnostics.mjs normalizedDiagnostic / rendererFailure:
schemaVersion, ok, source, diagnostics[]{code,severity,message,subject,evidence,supportedFixes}.

Two deliberate divergences, both recorded in NOTICE:
1. supportedFixes is an object array instead of upstream's string array, allowing
   machines to read five repair stages' order and requiresEvidence for deletion.
   Ordered repair stages are themselves a local addition.
2. Upstream uses ARCHIFY_DIAGNOSTIC_FORMAT=json for renderer subprocesses. This
   human-invoked CLI uses a flag.

message is exactly the human-readable output string. Both formats share one source
so they cannot silently diverge.

Usage:
    python3 scripts/verify-connectors.py assets/example-*.html
    python3 scripts/verify-connectors.py --all
    python3 scripts/verify-connectors.py --all --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Exclude legend samples only inside valid pairs of these exact case-sensitive markers.
LEGEND_BEGIN = "<!-- verify-connectors:legend:BEGIN -->"
LEGEND_END = "<!-- verify-connectors:legend:END -->"
LEGEND_MARKER_RE = re.compile(f"{re.escape(LEGEND_BEGIN)}|{re.escape(LEGEND_END)}")


def legend_projection(source: str) -> tuple[str, dict[str, int | str] | None]:
    """Blank excluded legend spans while preserving source length.

    Mask only valid non-nested BEGIN/END pairs. Invalid markers fail closed:
    return the original source with the first problematic marker's line and reason."""
    open_marker: re.Match[str] | None = None
    spans: list[tuple[int, int]] = []
    markers = list(LEGEND_MARKER_RE.finditer(source))
    for i, marker in enumerate(markers):
        is_begin = marker.group(0) == LEGEND_BEGIN
        line = source.count("\n", 0, marker.start()) + 1
        if is_begin:
            if open_marker is not None:
                return source, {"line": line, "reason": "nested"}
            open_marker = marker
        elif open_marker is None:
            reason = (
                "reversed-order"
                if any(later.group(0) == LEGEND_BEGIN for later in markers[i + 1 :])
                else "orphan-end"
            )
            return source, {"line": line, "reason": reason}
        else:
            spans.append((open_marker.start(), marker.end()))
            open_marker = None
    if open_marker is not None:
        return source, {
            "line": source.count("\n", 0, open_marker.start()) + 1,
            "reason": "orphan-begin",
        }

    projection = list(source)
    for start, end in spans:
        for i in range(start, end):
            if projection[i] not in "\r\n":
                projection[i] = " "
    return "".join(projection), None


# Whitespace around = is valid XML (marker-end = "url(#a)"). Requiring an
# exact marker-end= silently dropped connectors: one space changed a five-connector
# population with diagonal/crossing findings into four connectors with no findings.
# Population collapse can silently produce a green result.
ARROW_RE = re.compile(r"<(path|line)\b[^>]*\bmarker-end\s*=[^>]*>", re.I)

# Use a separate path for independent counting. Reusing ARROW_RE would let
# the same defect collapse both the parser and its Goodhart control, as F1 demonstrated.
TAG_RE = re.compile(r"<(?:path|line)\b[^>]*>", re.I)
ATTR_NAME_RE = re.compile(r"([a-zA-Z][\w:.-]*)\s*=")

# Attribute names include digits: x1, y1, x2, y2. A letters-only regex parsed no
# line elements yet reported zero findings during porting. Silent parse failure
# is indistinguishable from passing. Single-quoted attributes are valid SVG too;
# unreadable-geometry/no-segments on them is a parser defect, not a diagram defect.
# Fix the parser (repository rule 3).
ATTR_RE = re.compile(r"""([a-zA-Z][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")

PATH_CMD_RE = re.compile(r"([MLHVQCmlhvqc])([^MLHVQCZmlhvqcz]*)")

# Exponent coordinates (1e2, 1.5e-3) are valid SVG. A decimal-only regex splits
# 1e2 into 1 and 2, while command validation misreads e as an unsupported command.
NUM_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")

Point = tuple[float, float]


def attrs_of(tag: str) -> dict[str, str]:
    """Read a tag attribute dictionary, supporting both quote styles."""
    return {k: (dq if dq else sq) for k, dq, sq in ATTR_RE.findall(tag)}


def connector_tags(body: str) -> list[str]:
    """Line/path tags with a marker-end attribute.

    Do not reuse ARROW_RE: independence requires a separate path. Collect tags
    first, then inspect attribute names so ARROW_RE defects do not affect the
    count. Inline style marker-end is not an attribute name and is excluded,
    matching ARROW_RE's intended population."""
    return [
        m.group(0)
        for m in TAG_RE.finditer(body)
        if "marker-end" in {n.lower() for n in ATTR_NAME_RE.findall(m.group(0))}
    ]


def _nums(text: str) -> list[float]:
    return [float(t) for t in NUM_RE.findall(text) if t not in ("+", "-", ".")]


def straight_segments(d: str) -> list[tuple[Point, Point]]:
    """Return straight segments from d; Q/C only move the cursor for rounded corners."""
    segs: list[tuple[Point, Point]] = []
    cx = cy = 0.0
    for cmd, body in PATH_CMD_RE.findall(d):
        n = _nums(body)
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M" and len(n) >= 2:
            cx, cy = (cx + n[0], cy + n[1]) if rel else (n[0], n[1])
        elif c == "L":
            for i in range(0, len(n) - 1, 2):
                nx, ny = (cx + n[i], cy + n[i + 1]) if rel else (n[i], n[i + 1])
                segs.append(((cx, cy), (nx, ny)))
                cx, cy = nx, ny
        elif c == "H":
            for v in n:
                nx = cx + v if rel else v
                segs.append(((cx, cy), (nx, cy)))
                cx = nx
        elif c == "V":
            for v in n:
                ny = cy + v if rel else v
                segs.append(((cx, cy), (cx, ny)))
                cy = ny
        elif c in ("Q", "C"):
            # Polybezier commands contain multiple coordinate groups. Adding only n[-2:]
            # to the original cursor loses earlier relative movement and makes later H/V/L
            # fabricate corridors and diagonals while missing real overlaps. For example,
            # M 0,0 q 10,0 10,10 10,10 20,20 h 5 yielded (20,20)->(25,20);
            # the correct segment is (30,30)->(35,30).
            stride = 4 if c == "Q" else 6
            for i in range(0, len(n) - stride + 1, stride):
                ex, ey = n[i + stride - 2], n[i + stride - 1]
                cx, cy = (cx + ex, cy + ey) if rel else (ex, ey)
    return segs


# Rule 3: overlap, ambiguous corridors, and crossings.
#
# One-to-one port of up:archify shared/geometry.mjs collinearAxisOverlap(:955),
# properSegmentIntersection(:976), and collectAmbiguousCorridors(:480), preserving
# epsilon, nested loops, and longest-overlap-per-pair noise suppression.
#
# Do not port the upstream sibling exemption. Upstream treats shared from/to
# connectors as intentional fan-out/fan-in topology. Local rule 3 prohibits all
# segment overlap, and rule 4 prohibits merging strokes near boxes. Local checks
# are stricter; references/connector-rules.md discloses this limitation.
EPS = 1e-4

# Upstream default; shorter overlaps are missed, as documented.
MIN_OVERLAP_PX = 8.0


def collinear_overlap(a: Point, b: Point, c: Point, d: Point):
    """Overlap length of axis-aligned segments on the same fixed coordinate.

    Return (length, start, end, axis, fixed) or None. axis names the fixed
    coordinate: y for horizontal runs, x for vertical runs."""
    if abs(a[1] - b[1]) <= EPS and abs(c[1] - d[1]) <= EPS and abs(a[1] - c[1]) <= EPS:
        s = max(min(a[0], b[0]), min(c[0], d[0]))
        e = min(max(a[0], b[0]), max(c[0], d[0]))
        if e - s > EPS:
            return (e - s, s, e, "y", (a[1] + c[1]) / 2)
    if abs(a[0] - b[0]) <= EPS and abs(c[0] - d[0]) <= EPS and abs(a[0] - c[0]) <= EPS:
        s = max(min(a[1], b[1]), min(c[1], d[1]))
        e = min(max(a[1], b[1]), max(c[1], d[1]))
        if e - s > EPS:
            return (e - s, s, e, "x", (a[0] + c[0]) / 2)
    return None


def cross_product(o: Point, a: Point, b: Point) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def proper_intersection(a: Point, b: Point, c: Point, d: Point):
    """Return only an X intersection inside both segments.

    Endpoint-only T junctions do not satisfy strict opposite-side tests,
    avoiding false positives for ordinary fan-out/fan-in."""
    d1 = cross_product(c, d, a)
    d2 = cross_product(c, d, b)
    d3 = cross_product(a, b, c)
    d4 = cross_product(a, b, d)
    if not ((d1 > EPS and d2 < -EPS) or (d1 < -EPS and d2 > EPS)):
        return None
    if not ((d3 > EPS and d4 < -EPS) or (d3 < -EPS and d4 > EPS)):
        return None
    den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
    if abs(den) < EPS:
        return None
    t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den
    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


def check_corridors(name: str, conns: list[dict], min_overlap: float) -> list[dict]:
    """Report only the longest collinear overlap per pair, matching upstream suppression."""
    out: list[dict] = []
    for i in range(len(conns)):
        for j in range(i + 1, len(conns)):
            best = None
            for si, (a, b) in enumerate(conns[i]["segs"], 1):
                for sj, (c, d) in enumerate(conns[j]["segs"], 1):
                    ov = collinear_overlap(a, b, c, d)
                    if (
                        ov
                        and ov[0] >= min_overlap
                        and (best is None or ov[0] > best[0][0])
                    ):
                        best = (ov, si, sj)
            if best is None:
                continue
            (length, start, end, axis, fixed), si, sj = best
            ci, cj = conns[i], conns[j]
            out.append(
                diagnostic(
                    "connector/ambiguous-corridor",
                    f"{name}:{ci['line']}: connectors {ci['idx']} and {cj['idx']} "
                    f"share a {length:g}px collinear corridor on {axis}={fixed:g} "
                    f"({start:g}..{end:g}) - connector-rules.md rule 3 forbids "
                    "overlapping runs; offset by >=12px",
                    {
                        "file": name,
                        "line": ci["line"],
                        "connector": ci["idx"],
                        "otherConnector": cj["idx"],
                        "segment": si,
                        "otherSegment": sj,
                    },
                    {
                        "overlapPx": length,
                        "axis": axis,
                        "fixed": fixed,
                        "start": start,
                        "end": end,
                        "threshold": min_overlap,
                    },
                )
            )
    return out


def check_crossings(name: str, conns: list[dict]) -> list[dict]:
    """Report only the first proper crossing per connector pair.

    Q/C curves only move the cursor, so a rounded hop at a crossing removes
    that span from straight segments and passes. This is a geometric proxy
    for a drawn hop. Entirely curved connectors still silence all three checks;
    the reference documents that limitation."""
    out: list[dict] = []
    for i in range(len(conns)):
        for j in range(i + 1, len(conns)):
            hit = None
            for a, b in conns[i]["segs"]:
                for c, d in conns[j]["segs"]:
                    p = proper_intersection(a, b, c, d)
                    if p:
                        hit = p
                        break
                if hit:
                    break
            if hit is None:
                continue
            ci, cj = conns[i], conns[j]
            out.append(
                diagnostic(
                    "connector/proper-crossing",
                    f"{name}:{ci['line']}: connectors {ci['idx']} and {cj['idx']} "
                    f"cross at ({hit[0]:g},{hit[1]:g}) with no hop - "
                    "connector-rules.md rule 3 requires a bridge/hop there; "
                    "drawing the crossing as a Q/C rounded hop passes this check",
                    {
                        "file": name,
                        "line": ci["line"],
                        "connector": ci["idx"],
                        "otherConnector": cj["idx"],
                    },
                    {"at": [hit[0], hit[1]]},
                )
            )
    return out


# Rules 2, 4, 5 and machine-readable taste-gate checks (--strict-rules).
#
# Disabled by default because the shipped examples have measured violations,
# whose counts the suite pins. These upstream derivatives are hash-bound and
# changing them is separate work. Enabling by default would ship examples failing
# our own validator, creating perpetual failures that invite disregard.
#
# SKILL.md Phase 3 requires --strict-rules for new diagrams. While defaults
# remain off, the suite measures detection on planted cases and retained debt
# in shipped examples. Pinned debt counts prevent silent growth.

RECT_RE = re.compile(r"<rect\b[^>]*>", re.I)
TEXT_TAG_RE = re.compile(r"<text\b[^>]*>", re.I)
STYLE_RE = re.compile(r"<style\b[^>]*>(.*?)</style>", re.I | re.S)
CSS_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)


def css_declarations(source: str) -> list:
    """Return (element name, required class set, declarations) in source order.

    Parse CSS shallowly: final compound selector classes and element name only,
    without specificity, media queries, or descendant combinators. This matches
    verify-text-width.py. Without it, CSS-dashed connector auth lines lose rule 5
    exemptions and filled label-mask classes appear transparent (five measured
    false positives). Treat compound classes as sets: splitting .connector.auth
    into separate keys once made solid connector primary lines dashed, silencing
    rule 5 findings during porting."""
    out = []
    for block_text in STYLE_RE.findall(source):
        for sel, decls in CSS_RULE_RE.findall(block_text):
            body = {}
            for part in decls.split(";"):
                if ":" not in part:
                    continue
                k, _, v = part.partition(":")
                body[k.strip().lower()] = v.strip()
            if not body:
                continue
            for one in sel.split(","):
                one = one.strip()
                if not one:
                    continue
                last = one.split()[-1]
                classes = frozenset(
                    c[1:] for c in re.findall(r"\.[A-Za-z_][\w-]*", last)
                )
                m = re.match(r"^([A-Za-z][\w-]*)", last)
                out.append((m.group(1).lower() if m else None, classes, body))
    return out


def resolved(attrs: dict, tag_name: str, css: list, prop: str) -> str:
    """Resolve attributes, inline style, then CSS rules, with later rules winning."""
    if attrs.get(prop):
        return attrs[prop].strip()
    for part in attrs.get("style", "").split(";"):
        k, _, v = part.partition(":")
        if k.strip().lower() == prop:
            return v.strip()
    have = frozenset(attrs.get("class", "").split())
    got = ""
    for element, classes, body in css:
        if element is not None and element != tag_name.lower():
            continue
        if not classes <= have:
            continue
        if prop in body:
            got = body[prop]
    return got.strip()


# Label-mask rectangle height range; measured asset heights are 12 and 16.
MASK_H_MIN, MASK_H_MAX = 8.0, 20.0
# Minimum node-box size.
NODE_W_MIN, NODE_H_MIN = 40.0, 24.0
# Maximum distance for pairing a mask with a connector label.
LABEL_ASSOC_PX = 24.0
# Rule 2: minimum gap between mask edge and stroke.
LABEL_GAP_MIN = 6.0
# Rule 4: adjacent same-side attachment spacing; short sides have an 8px floor.
FAN_MIN_PX = 12.0
FAN_SMALL_EDGE = 48.0
FAN_SMALL_MIN_PX = 8.0
# Tolerance for treating an attachment as lying on a box edge.
ON_EDGE_EPS = 1.0

OPAQUE_NONE = {"", "none", "transparent"}


def rects_of(body: str) -> list:
    """Rectangles with numeric coordinates only; exclude percentage-sized backgrounds."""
    out = []
    for m in RECT_RE.finditer(body):
        a = attrs_of(m.group(0))
        try:
            x, y = float(a["x"]), float(a["y"])
            w, h = float(a["width"]), float(a["height"])
        except (KeyError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        out.append(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "attrs": a,
                "tag": "rect",
                "start": m.start(),
            }
        )
    return out


def classify_rects(rects: list):
    """Return (nodes, masks).

    Exclude zone containers from nodes: they paint before arrows and are exempt
    under rules 5 and 6. Zones fully contain another node. Small rectangles fully
    inside nodes are badge chips, not label masks, as rule 6 states. Failing to
    exclude them misclassified EXT/EDGE badges and caused 11 false positives."""
    big = [r for r in rects if r["w"] >= NODE_W_MIN and r["h"] >= NODE_H_MIN]
    nodes = []
    for r in big:
        contains = any(
            o is not r
            and o["x"] >= r["x"] - EPS
            and o["y"] >= r["y"] - EPS
            and o["x"] + o["w"] <= r["x"] + r["w"] + EPS
            and o["y"] + o["h"] <= r["y"] + r["h"] + EPS
            and (o["w"] < r["w"] - EPS or o["h"] < r["h"] - EPS)
            for o in big
        )
        if not contains:
            nodes.append(r)
    small = [r for r in rects if MASK_H_MIN <= r["h"] <= MASK_H_MAX]
    masks = [
        r
        for r in small
        if not any(
            o is not r
            and o["h"] > r["h"] + EPS
            and o["x"] <= r["x"] + EPS
            and o["y"] <= r["y"] + EPS
            and o["x"] + o["w"] >= r["x"] + r["w"] - EPS
            and o["y"] + o["h"] >= r["y"] + r["h"] - EPS
            for o in big
        )
    ]
    return nodes, masks


def _axis_of(a: Point, b: Point):
    if abs(a[1] - b[1]) <= EPS and abs(a[0] - b[0]) > EPS:
        return "h"
    if abs(a[0] - b[0]) <= EPS and abs(a[1] - b[1]) > EPS:
        return "v"
    return None


def mask_gap(rect: dict, a: Point, b: Point):
    """Mask-to-axis-aligned-segment gap: -1 for overlap, None if not parallel."""
    axis = _axis_of(a, b)
    if axis is None:
        return None
    if axis == "h":
        lo, hi = sorted((a[0], b[0]))
        if hi < rect["x"] - EPS or lo > rect["x"] + rect["w"] + EPS:
            return None
        fixed = a[1]
        if rect["y"] - EPS <= fixed <= rect["y"] + rect["h"] + EPS:
            return -1.0
        return (
            (rect["y"] - fixed)
            if fixed < rect["y"]
            else fixed - (rect["y"] + rect["h"])
        )
    lo, hi = sorted((a[1], b[1]))
    if hi < rect["y"] - EPS or lo > rect["y"] + rect["h"] + EPS:
        return None
    fixed = a[0]
    if rect["x"] - EPS <= fixed <= rect["x"] + rect["w"] + EPS:
        return -1.0
    return (rect["x"] - fixed) if fixed < rect["x"] else fixed - (rect["x"] + rect["w"])


def nearest_connector(rect: dict, conns: list):
    """Nearest (gap, connector, segment index) to the mask, or None."""
    best = None
    for c in conns:
        for si, (a, b) in enumerate(c["segs"], 1):
            g = mask_gap(rect, a, b)
            if g is None:
                continue
            if best is None or g < best[0]:
                best = (g, c, si)
    return best


def check_label_gaps(name: str, conns: list, masks: list) -> list:
    """Rule 2: check whether a mask touches its connector or lies within 6px."""
    out = []
    for rect in masks:
        hit = nearest_connector(rect, conns)
        if hit is None:
            continue
        gap, conn, si = hit
        if gap > LABEL_ASSOC_PX:
            continue  # Not a label for that connector
        if gap >= LABEL_GAP_MIN - EPS:
            continue
        touching = gap < 0
        out.append(
            diagnostic(
                "connector/label-gap",
                f"{name}:{conn['line']}: the label mask at "
                f"({rect['x']:g},{rect['y']:g} {rect['w']:g}x{rect['h']:g}) "
                + ("overlaps" if touching else f"sits {gap:g}px from")
                + f" connector {conn['idx']} segment {si} - connector-rules.md "
                "rule 2 requires a visible gap of at least 6px between the mask "
                "edge and the stroke",
                {
                    "file": name,
                    "line": conn["line"],
                    "connector": conn["idx"],
                    "segment": si,
                },
                {
                    "gapPx": gap,
                    "minimum": LABEL_GAP_MIN,
                    "mask": [rect["x"], rect["y"], rect["w"], rect["h"]],
                },
            )
        )
    return out


def edge_attachments(node: dict, conns: list) -> dict:
    """Attachments by box edge: {edge: [(coordinate, connector index)]}."""
    edges = {"left": [], "right": [], "top": [], "bottom": []}
    x0, y0 = node["x"], node["y"]
    x1, y1 = x0 + node["w"], y0 + node["h"]
    for c in conns:
        if not c["segs"]:
            continue
        for px, py in (c["segs"][0][0], c["segs"][-1][1]):
            if (
                abs(px - x0) <= ON_EDGE_EPS
                and y0 - ON_EDGE_EPS <= py <= y1 + ON_EDGE_EPS
            ):
                edges["left"].append((py, c["idx"]))
            elif (
                abs(px - x1) <= ON_EDGE_EPS
                and y0 - ON_EDGE_EPS <= py <= y1 + ON_EDGE_EPS
            ):
                edges["right"].append((py, c["idx"]))
            elif (
                abs(py - y0) <= ON_EDGE_EPS
                and x0 - ON_EDGE_EPS <= px <= x1 + ON_EDGE_EPS
            ):
                edges["top"].append((px, c["idx"]))
            elif (
                abs(py - y1) <= ON_EDGE_EPS
                and x0 - ON_EDGE_EPS <= px <= x1 + ON_EDGE_EPS
            ):
                edges["bottom"].append((px, c["idx"]))
    return edges


def check_attachment_fan(name: str, conns: list, nodes: list) -> list:
    """Rule 4: adjacent same-side attachments need 12px separation, or 8px on short sides."""
    out = []
    for node in nodes:
        for edge, pts in edge_attachments(node, conns).items():
            if len(pts) < 2:
                continue
            length = node["h"] if edge in ("left", "right") else node["w"]
            floor = FAN_SMALL_MIN_PX if length < FAN_SMALL_EDGE else FAN_MIN_PX
            pts = sorted(pts)
            for (p, ci), (q, cj) in zip(pts, pts[1:]):
                if ci == cj:
                    continue
                d = q - p
                if d >= floor - EPS:
                    continue
                shared = d <= EPS
                out.append(
                    diagnostic(
                        "connector/attachment-fan",
                        f"{name}: connectors {ci} and {cj} "
                        + (
                            "share one attachment point"
                            if shared
                            else f"attach {d:g}px apart"
                        )
                        + f" on the {edge} edge of the box at "
                        f"({node['x']:g},{node['y']:g} {node['w']:g}x{node['h']:g}) - "
                        f"connector-rules.md rule 4 requires >={floor:g}px between "
                        "adjacent attachment points on one edge (L*k/(N+1))",
                        {
                            "file": name,
                            "connector": ci,
                            "otherConnector": cj,
                            "edge": edge,
                        },
                        {
                            "separationPx": d,
                            "minimum": floor,
                            "box": [node["x"], node["y"], node["w"], node["h"]],
                        },
                    )
                )
    return out


def _segment_crosses_rect(a: Point, b: Point, rect: dict) -> bool:
    """Whether an axis-aligned segment crosses the rectangle interior, not merely its edge."""
    axis = _axis_of(a, b)
    if axis is None:
        return False
    x0, y0 = rect["x"], rect["y"]
    x1, y1 = x0 + rect["w"], y0 + rect["h"]
    if axis == "h":
        if not (y0 + EPS < a[1] < y1 - EPS):
            return False
        lo, hi = sorted((a[0], b[0]))
        return hi > x0 + EPS and lo < x1 - EPS
    if not (x0 + EPS < a[0] < x1 - EPS):
        return False
    lo, hi = sorted((a[1], b[1]))
    return hi > y0 + EPS and lo < y1 - EPS


def _touches_rect(p: Point, rect: dict) -> bool:
    return (
        rect["x"] - ON_EDGE_EPS <= p[0] <= rect["x"] + rect["w"] + ON_EDGE_EPS
        and rect["y"] - ON_EDGE_EPS <= p[1] <= rect["y"] + rect["h"] + ON_EDGE_EPS
    )


def _rect_contains(rect: dict, inner: dict) -> bool:
    return (
        inner["x"] >= rect["x"] - EPS
        and inner["y"] >= rect["y"] - EPS
        and inner["x"] + inner["w"] <= rect["x"] + rect["w"] + EPS
        and inner["y"] + inner["h"] <= rect["y"] + rect["h"] + EPS
    )


def check_third_box(
    name: str, conns: list, nodes: list, masks: list, css: list
) -> list:
    """Rule 5: third-box transit must satisfy all three exception conditions.

    Check dashed stroke, whether the label is hidden inside the transit box,
    and whether the arrowhead resolves at its edge. Any violation is a finding."""
    out = []
    for c in conns:
        if not c["segs"]:
            continue
        start, end = c["segs"][0][0], c["segs"][-1][1]
        dashed = bool(
            resolved(c["attrs"], c.get("tag", "path"), css, "stroke-dasharray")
        )
        label = None
        for r in masks:
            hit = nearest_connector(r, conns)
            if (
                hit is not None
                and hit[1]["idx"] == c["idx"]
                and hit[0] <= LABEL_ASSOC_PX
            ):
                label = r
                break
        for rect in nodes:
            if _touches_rect(start, rect) or _touches_rect(end, rect):
                continue  # Source or destination box
            if not any(_segment_crosses_rect(a, b, rect) for a, b in c["segs"]):
                continue
            failed = []
            if not dashed:
                failed.append("stroke-dasharray")
            if label is not None and _rect_contains(rect, label):
                failed.append("label-on-visible-end")
            if _touches_rect(end, rect):
                failed.append("arrowhead-at-true-destination")
            if not failed:
                continue
            out.append(
                diagnostic(
                    "connector/third-box-transit",
                    f"{name}:{c['line']}: connector {c['idx']} passes behind the "
                    f"box at ({rect['x']:g},{rect['y']:g} {rect['w']:g}x{rect['h']:g}) "
                    "which is neither its origin nor its destination, and the "
                    f"rule 5 exception is not satisfied ({', '.join(failed)}) - "
                    "route around it, or meet all three conditions: dashed stroke, "
                    "label at the visible end, arrowhead resolved only at the true "
                    "destination",
                    {"file": name, "line": c["line"], "connector": c["idx"]},
                    {
                        "box": [rect["x"], rect["y"], rect["w"], rect["h"]],
                        "failedConditions": failed,
                        "dashed": dashed,
                    },
                )
            )
    return out


def check_taste(name: str, source: str, conns: list, masks: list, css: list) -> list:
    """Two machine-checkable taste-gate requirements.

    Unported accessibility SVG, 4px grid, and six typography requirements are
    absent. Importing their upstream enforcers requires a separate decision."""
    out = []
    for rect in masks:
        hit = nearest_connector(rect, conns)
        if hit is None or hit[0] > LABEL_ASSOC_PX:
            continue
        fill = resolved(rect["attrs"], "rect", css, "fill").lower()
        opacity = resolved(rect["attrs"], "rect", css, "fill-opacity")
        try:
            weak_opacity = bool(opacity) and float(opacity) < 1
        except ValueError:
            weak_opacity = False
        if not (fill in OPAQUE_NONE or weak_opacity):
            continue
        out.append(
            diagnostic(
                "taste/mask-fill",
                f"{name}: the label mask at ({rect['x']:g},{rect['y']:g}) has "
                f"fill={fill or '(none)'!r} - a connector label mask must be "
                "opaque in the canvas colour, otherwise the stroke runs through "
                "the glyphs (connector-rules.md rule 2)",
                {"file": name},
                {
                    "fill": fill,
                    "fillOpacity": opacity,
                    "mask": [rect["x"], rect["y"], rect["w"], rect["h"]],
                },
            )
        )
    for m in TEXT_TAG_RE.finditer(source):
        a = attrs_of(m.group(0))
        if "writing-mode" not in a and "writing-mode" not in a.get("style", ""):
            continue
        line_no = source.count("\n", 0, m.start()) + 1
        out.append(
            diagnostic(
                "taste/writing-mode",
                f"{name}:{line_no}: <text> uses writing-mode - vertical CJK text "
                "cannot be measured against an axis-aligned box, so both width "
                "checkers go blind on it (cjk-contract.md)",
                {"file": name, "line": line_no},
                {"writingMode": a.get("writing-mode") or a.get("style", "")},
            )
        )
    return out


def strict_findings(name: str, source: str, body: str, conns: list) -> list:
    """Rules 2, 4, 5 and taste requirements enabled by --strict-rules."""
    nodes, masks = classify_rects(rects_of(body))
    # Rectangles at identical coordinates represent one box. Overlapping mask/body
    # rectangles are common; without deduplication, each finding is emitted twice.
    seen, uniq = set(), []
    for r in nodes:
        key = (r["x"], r["y"], r["w"], r["h"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    css = css_declarations(source)
    out = []
    out.extend(check_label_gaps(name, conns, masks))
    out.extend(check_attachment_fan(name, conns, uniq))
    out.extend(check_third_box(name, conns, uniq, masks, css))
    out.extend(check_taste(name, source, conns, masks, css))
    return out


# Five repair stages: deletion comes last and requires evidence.
# This ordered policy is a local addition, absent upstream; see the diagnostic contract.
REPAIR_ACTIONS = ("relocate", "reroute", "shorten", "restructure", "delete")

REPAIR_STEPS = (
    ("relocate", "Move the attachment to another side or point for orthogonal routing"),
    ("reroute", "Route as two orthogonal L segments (horizontal and vertical)"),
    ("shorten", "Shorten labels or paths to eliminate collisions"),
    ("restructure", "Reposition nodes to eliminate the slanted connection"),
    ("delete", "Last resort: record evidence that the relationship is unnecessary before deletion"),
)


def supported_fixes() -> list[dict]:
    """Return a fresh five-stage repair list; each diagnostic needs independent objects."""
    return [
        {"order": i, "action": a, "description": d, "requiresEvidence": a == "delete"}
        for i, (a, d) in enumerate(REPAIR_STEPS, 1)
    ]


def diagnostic(
    code: str, message: str, subject: dict, evidence: dict, severity: str = "error"
) -> dict:
    """Include the five repair stages only for connector defects.

    Relocating attachments is not a valid instruction for read or parse failures;
    those codes receive an empty list, matching upstream."""
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "subject": subject,
        "evidence": evidence,
        "supportedFixes": supported_fixes() if code.startswith("connector/") else [],
    }


def check(
    path: Path,
    *,
    min_overlap: float = MIN_OVERLAP_PX,
    crossings: bool = True,
    strict: bool = False,
) -> list[dict]:
    """Return diagnostic dictionaries.

    message is the human-readable output printed unchanged by main(). Sharing
    one source prevents format divergence. Rules 1 and 3 use the same population
    and parser; splitting them would let a parser defect be fixed in only one copy."""
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        # Do not silence read/parse failures. A traceback here formerly resembled
        # zero findings. Mirror input/read from upstream fallbackDiagnostic.
        return [
            diagnostic(
                "input/read",
                f"{path.name}: cannot read file - {type(exc).__name__}: {exc}",
                {"file": path.name, "path": str(path)},
                {"errno": getattr(exc, "errno", None), "reason": type(exc).__name__},
            )
        ]
    except UnicodeDecodeError as exc:
        # UnicodeDecodeError derives from ValueError, not OSError. Non-UTF-8 files
        # formerly caused a traceback and broke the one-envelope --json contract.
        return [
            diagnostic(
                "input/decode",
                f"{path.name}: not valid UTF-8 - {type(exc).__name__}: {exc}",
                {"file": path.name, "path": str(path)},
                {"encoding": "utf-8", "reason": type(exc).__name__},
            )
        ]
    body, malformed_marker = legend_projection(source)

    findings: list[dict] = []
    if malformed_marker is not None:
        line = malformed_marker["line"]
        reason = malformed_marker["reason"]
        findings.append(
            diagnostic(
                "input/legend-markup",
                f"{path.name}:{line}: malformed legend exclusion markup "
                f"({reason}) - no legend ranges were excluded",
                {"file": path.name, "line": line},
                {"file": path.name, "line": line, "reason": reason},
            )
        )
    conns: list[dict] = []
    body_conns = len(connector_tags(body))
    # Independently counted population. If ARROW_RE parses fewer connectors,
    # some silently disappeared. input/no-connectors catches only zero,
    # not two missing connectors out of three.
    expected_conns = body_conns
    seen = 0
    for idx, tag in enumerate(ARROW_RE.finditer(body), 1):
        seen = idx
        attrs = attrs_of(tag.group(0))
        line_no = source.count("\n", 0, tag.start()) + 1
        if tag.group(1).lower() == "line":
            try:
                segs = [
                    (
                        (float(attrs["x1"]), float(attrs["y1"])),
                        (float(attrs["x2"]), float(attrs["y2"])),
                    )
                ]
            except (KeyError, ValueError):
                findings.append(
                    diagnostic(
                        "connector/unreadable-geometry",
                        f"{path.name}:{line_no}: connector {idx} <line> has no "
                        "readable x1/y1/x2/y2 - cannot check orthogonality",
                        {"file": path.name, "line": line_no, "connector": idx},
                        {"attributes": sorted(attrs)},
                    )
                )
                continue
        else:
            d_attr = attrs.get("d", "")
            # Do not silently consume unmodeled commands. PATH_CMD_RE body classes allow
            # A/S/T arguments to be swallowed by the preceding command. For
            # M0 0 L10 10 A 5 5 0 0 1 20 20, L fabricated three diagonals through
            # (10,10)->(5,5)->(0,1)->(20,20). Report the path as uncheckable instead
            # of modeling arcs here. Remove numbers before looking for commands so
            # the e in valid exponent notation 1e2 is not a false unsupported command.
            residual = NUM_RE.sub(" ", d_attr)
            unsupported = sorted(
                set(re.findall(r"[A-Za-z]", residual)) - set("MLHVQCZmlhvqcz")
            )
            if unsupported:
                findings.append(
                    diagnostic(
                        "connector/unsupported-path-command",
                        f"{path.name}:{line_no}: connector {idx} <path> uses "
                        f"unmodelled command(s) {''.join(unsupported)} - the "
                        "parser would swallow their arguments into the previous "
                        "command and invent segments; rewrite the path with "
                        "M/L/H/V/Q/C only",
                        {"file": path.name, "line": line_no, "connector": idx},
                        {"commands": unsupported, "d": d_attr[:120]},
                    )
                )
                continue
            segs = straight_segments(d_attr)
            if not segs:
                # Entirely curved connectors or missing d cannot be measured under rules 1
                # and 3. Report that state itself: silently skipping it would make zero
                # findings indistinguishable from successful validation.
                findings.append(
                    diagnostic(
                        "connector/no-segments",
                        f"{path.name}:{line_no}: connector {idx} <path> yielded no "
                        "straight segments - cannot check rule 1/3",
                        {"file": path.name, "line": line_no, "connector": idx},
                        {"d": d_attr[:120]},
                    )
                )
                continue
        conns.append(
            {
                "idx": idx,
                "line": line_no,
                "segs": segs,
                "attrs": attrs,
                "tag": tag.group(1).lower(),
            }
        )
        for si, (a, b) in enumerate(segs, 1):
            if abs(a[0] - b[0]) > 0.01 and abs(a[1] - b[1]) > 0.01:
                findings.append(
                    diagnostic(
                        "connector/diagonal",
                        f"{path.name}:{line_no}: connector {idx} segment {si} is "
                        f"diagonal ({a[0]:g},{a[1]:g} -> {b[0]:g},{b[1]:g}) - "
                        "connector-rules.md rule 1 requires orthogonal runs",
                        {
                            "file": path.name,
                            "line": line_no,
                            "connector": idx,
                            "segment": si,
                        },
                        {
                            "from": [a[0], a[1]],
                            "to": [b[0], b[1]],
                            "dx": abs(a[0] - b[0]),
                            "dy": abs(a[1] - b[1]),
                            "tolerance": 0.01,
                        },
                    )
                )

    # Do not allow population collapse to look green. Parsing no connectors
    # means rules 1 and 3 were not measured, not that no defects exist.
    # The earlier x1 attribute-regex defect demonstrated exactly this failure.
    if seen < expected_conns:
        findings.append(
            diagnostic(
                "input/connector-population-mismatch",
                f"{path.name}: the independent scan sees {expected_conns} "
                f"marker-end connector(s) but the arrow parser matched {seen} - "
                "rule 1/3 were measured on a collapsed population",
                {"file": path.name},
                {"expected": expected_conns, "matched": seen},
            )
        )

    if not conns and not findings:
        findings.append(
            diagnostic(
                "input/no-connectors",
                f"{path.name}: no connector (marker-end) found after legend exclusions - "
                "rule 1/3 were not measured at all",
                {"file": path.name},
                {"connectors": 0},
            )
        )
        return findings
    findings.extend(check_corridors(path.name, conns, min_overlap))
    if crossings:
        findings.extend(check_crossings(path.name, conns))
    if strict:
        findings.extend(strict_findings(path.name, source, body, conns))
    return findings


def count_connectors(path: Path) -> int:
    """Total marker-end connectors: an independent Goodhart control.

    Fewer findings cannot distinguish repair from deletion. A simultaneous
    connector-count decrease suggests deletion."""
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return 0
    body, _ = legend_projection(source)
    # Do not reuse ARROW_RE. It once missed marker-end = "...", collapsing
    # this supposedly independent count too. Shared failure is not independence.
    return len(connector_tags(body))


def deletion_guard(baseline: dict, current: dict, *, strict: bool) -> list[dict]:
    """Warn when findings and connectors both decrease from the previous JSON.

    Default warnings do not affect rc: legitimate redesigns also reduce connector
    counts, making a default error a false positive. Only --strict-deletion
    makes the comparison affect the return code."""
    # Valid JSON with the wrong shape also needs handling. [] formerly raised
    # AttributeError at .get despite read/parse guards. Report shape mismatch
    # through the same input/json-parse diagnostic.
    b_sum = baseline.get("summary") if isinstance(baseline, dict) else None
    if not isinstance(b_sum, dict):
        return [
            diagnostic(
                "input/json-parse",
                "baseline: expected an object with a summary object - "
                f"got {type(baseline).__name__}",
                {"file": "<baseline>"},
                {"raw": str(baseline)[:200]},
                severity="warning",
            )
        ]
    c_sum = current.get("summary", {})
    try:
        b_f, b_c = int(b_sum["findings"]), int(b_sum["connectors"])
        c_f, c_c = int(c_sum["findings"]), int(c_sum["connectors"])
    except (KeyError, TypeError, ValueError):
        return [
            diagnostic(
                "input/json-parse",
                "baseline: summary.findings/connectors are missing or unreadable",
                {"file": "<baseline>"},
                {"raw": str(b_sum)[:200]},
                severity="warning",
            )
        ]
    if c_f < b_f and c_c < b_c:
        return [
            diagnostic(
                "repair/deletion-without-evidence",
                f"findings dropped {b_f} -> {c_f} but connectors also dropped "
                f"{b_c} -> {c_c} - green may mean deleted, not fixed",
                {"file": "<baseline comparison>"},
                {
                    "findingsBefore": b_f,
                    "findingsAfter": c_f,
                    "connectorsBefore": b_c,
                    "connectorsAfter": c_c,
                },
                severity="error" if strict else "warning",
            )
        ]
    return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--all", action="store_true")
    ap.add_argument(
        "--json",
        action="store_true",
        help="Emit one JSON diagnostic envelope without human-readable lines",
    )
    ap.add_argument(
        "--baseline",
        type=Path,
        help="Previous --json output; check whether deletion produced a green result",
    )
    ap.add_argument(
        "--strict-deletion",
        action="store_true",
        help="Promote --baseline comparison to error (default warning)",
    )
    ap.add_argument(
        "--min-overlap",
        type=float,
        default=MIN_OVERLAP_PX,
        help=f"Collinear overlap threshold in px (default {MIN_OVERLAP_PX:g}, matching upstream)",
    )
    ap.add_argument(
        "--strict-rules",
        action="store_true",
        help="Enable rules 2 (label gap), 4 (attachment fan), 5 (third-box avoidance), and "
        "machine-readable taste checks. Disabled by default because "
        "the four shipped examples retain rule 2 debt "
        "(counts pinned by tests/run_tests.py)",
    )
    ap.add_argument(
        "--no-crossings",
        action="store_true",
        help="Disable crossings-without-hops checks. Upstream exempts sibling connectors "
        "sharing from/to; local SVG lacks those identifiers, so no exemption applies. "
        "Use this escape hatch if that produces false positives",
    )
    args = ap.parse_args()
    files = sorted((ROOT / "assets").glob("*.html")) if args.all else args.files
    if not files:
        ap.error("pass one or more files, or --all")
    findings: list[dict] = []
    connectors = 0
    for f in files:
        findings.extend(
            check(
                f,
                min_overlap=args.min_overlap,
                crossings=not args.no_crossings,
                strict=args.strict_rules,
            )
        )
        connectors += count_connectors(f)

    if args.baseline is not None:
        current = {"summary": {"findings": len(findings), "connectors": connectors}}
        try:
            baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            findings.append(
                diagnostic(
                    "input/json-parse",
                    f"{args.baseline}: cannot read baseline JSON - "
                    f"{type(exc).__name__}: {exc}",
                    {"file": str(args.baseline)},
                    {"reason": type(exc).__name__},
                    severity="warning",
                )
            )
        else:
            findings.extend(
                deletion_guard(baseline, current, strict=args.strict_deletion)
            )

    errors = [d for d in findings if d["severity"] == "error"]
    if args.json:
        # Never mix human-readable lines into JSON output; one extra line breaks parsing.
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "ok": not errors,
                    "source": "verify-connectors",
                    "summary": {
                        "files": len(files),
                        "findings": len(findings),
                        "connectors": connectors,
                    },
                    "diagnostics": findings,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1 if errors else 0

    for d in findings:
        print(d["message"])
    print(f"Summary: {len(files)} file(s) checked, {len(findings)} finding(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
