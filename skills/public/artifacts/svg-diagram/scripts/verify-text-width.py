#!/usr/bin/env python3
"""Check label width, counting CJK as two units and detecting container overflow.

Coefficients are provisional. ASCII 0.6em comes from upstream nodeTextFit.widthFactor
for Geist; full-width 1.0em comes from references/output-spec.md. Actual advances
have not been measured with Apple SD Gothic Neo or Noto Sans KR, so small Korean
overruns may be missed. SKILL.md discloses this limitation as well.

Ported and divergent behavior:
Rewrites textUnits() in renderers/shared/utils.mjs and nodeTextFit in
renderers/shared/text-fit.mjs from up:archify (MIT, https://github.com/tt-a1i/archify).
text_units() preserves the FULLWIDTH ranges and variation selectors exactly:
VS15 counts as one unit and VS16 as two.

The width formula deliberately diverges. Enforcing upstream's mask-width guidance
of approximately 6.5px * ASCII units + 13px flags eight of 11 masks in
example-architecture.html: RESP 39 > 32, READ MDX 65 > 60, QUERY 45.5 > 44,
EXT/CMS 32.5 > 28, EDGE/ORIG 39 > 32, CONTENT 58.5 > 52. At widthFactor 0.6,
6.5px/unit assumes a 10.8px font; our labels use 7–8px, creating 20–40%
overestimates. Enforce a font-size-scaled model and retain the empirical formula
only as authoring guidance in documentation and finding evidence.

    advance = fs * (0.6 * ascii_units + 1.0 * fullwidth_chars)
              + ls_em * fs * max(0, n_chars - 1)

Count letter-spacing across n−1 gaps, excluding trailing space. Without that
correction, DEPLOY TRIGGER in example-swimlane.html falsely fails at −0.6px.
Use full-width 1.0em, not upstream's converted 0.6 * 2 = 1.2em, following
output-spec.md and Korean fallback full-width advances. The more permissive
coefficient is safer against false positives.

Container selection: abandon height heuristics.
Earlier code classified 8≤h≤14 as masks and h≥40 as nodes, causing two defects:
- A 16px zone-mask fell outside the range and paired its label with a 696px zone
  rectangle, passing 1.4x overflow (present in example-dp-integration.html).
- Required 12px CJK labels needed masks taller than 14px, classifying as neither
  masks nor nodes and silently disappearing without findings or unmeasurable status.

Now use the smallest rectangle by area containing the anchor. Exclude only
background rectangles (percentage dimensions or at least 90% of viewBox area)
and rectangles inside defs, pattern, marker, symbol, clipPath, or mask. A label
mask naturally wins as the smallest enclosing box without a height range.

Respect text-anchor:
Comparing advance only with box width allowed a start-anchored label protruding
150px past the right edge to pass and count as measured. Compute left/right
extents: start [x,x+adv], middle [x−adv/2,x+adv/2], end [x−adv,x], and compare
with the container edges.

Coordinate systems:
Grouping nodes with g transform="translate(...)" is standard SVG. Earlier code
marked all such text unmeasurable, a parser defect on valid syntax. Accumulate
ancestor translations into one absolute coordinate system for rectangles and text.
Inherit font-size, letter-spacing, and text-anchor from ancestors too.
Unsupported rotate, scale, matrix, or skew transforms cannot be compared with
axis-aligned boxes; emit text/out-of-scope warnings rather than silently omit them.

Do not silence parsing failures:
If size cannot be found in attributes, style, or CSS, emit text/unmeasurable (error)
rather than assuming 12px. Assets use all three forms: font-size="8", class font
shorthand (.node-name{font:600 12px var(--sans)}), and element selectors
(svg text{font-size:12px}). Reading only class selectors formerly rejected valid
SVG using element selectors. tspan children and textLength require a different
layout model and emit text/out-of-scope warnings; neither occurs in current assets.

The --json summary reports actual coverage through labels/texts and skipped details.
Those counts distinguish zero overflows from a parser that never reached the content.

Usage:
    python3 scripts/verify-text-width.py assets/example-*.html
    python3 scripts/verify-text-width.py --all
    python3 scripts/verify-text-width.py --all --json
"""

from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- Port from upstream utils.mjs -------------------------------------------------
# Preserve the upstream FULLWIDTH_RE ranges as tuples because Python re
# does not support JavaScript \u{...} syntax.
FULLWIDTH_RANGES = (
    (0x1100, 0x115F), (0x231A, 0x231B), (0x2329, 0x232A), (0x23E9, 0x23EC),
    (0x23F0, 0x23F0), (0x23F3, 0x23F3), (0x25FD, 0x25FE), (0x2614, 0x2615),
    (0x2630, 0x2637), (0x2648, 0x2653), (0x267F, 0x267F), (0x268A, 0x268F),
    (0x2693, 0x2693), (0x26A1, 0x26A1), (0x26AA, 0x26AB), (0x26BD, 0x26BE),
    (0x26C4, 0x26C5), (0x26CE, 0x26CE), (0x26D4, 0x26D4), (0x26EA, 0x26EA),
    (0x26F2, 0x26F3), (0x26F5, 0x26F5), (0x26FA, 0x26FA), (0x26FD, 0x26FD),
    (0x2705, 0x2705), (0x270A, 0x270B), (0x2728, 0x2728), (0x274C, 0x274C),
    (0x274E, 0x274E), (0x2753, 0x2755), (0x2757, 0x2757), (0x2795, 0x2797),
    (0x27B0, 0x27B0), (0x27BF, 0x27BF), (0x2B1B, 0x2B1C), (0x2B50, 0x2B50),
    (0x2B55, 0x2B55), (0x2E80, 0xA4CF), (0xA960, 0xA97C), (0xAC00, 0xD7A3),
    (0xF900, 0xFAFF), (0xFE10, 0xFE19), (0xFE30, 0xFE6F), (0xFF01, 0xFF60),
    (0xFFE0, 0xFFE6), (0x16FE0, 0x18DFF), (0x1AFF0, 0x1AFFF),
    (0x1B000, 0x1B2FF), (0x1F000, 0x1FAFF), (0x20000, 0x3FFFD),
)

VARIATION_SELECTOR_FIRST = 0xFE00
VARIATION_SELECTOR_LAST = 0xFE0F
VARIATION_SELECTOR_TEXT = 0xFE0E   # VS15: text presentation, narrow rendering
VARIATION_SELECTOR_EMOJI = 0xFE0F  # VS16: emoji presentation, square advance


def is_fullwidth(ch: str) -> bool:
    cp = ord(ch)
    for lo, hi in FULLWIDTH_RANGES:
        if lo <= cp <= hi:
            return True
    return False


def measure(text: str) -> tuple[int, int, int, int]:
    """(units, ascii_units, fullwidth_chars, n_chars).

    units matches upstream textUnits(), counting full-width as two. The other
    values separate ASCII and full-width coefficients. Variation selectors have
    no advance and are not counted in either category.
    """
    chars = list(text)
    units = ascii_units = fw = n = 0
    for i, ch in enumerate(chars):
        cp = ord(ch)
        if VARIATION_SELECTOR_FIRST <= cp <= VARIATION_SELECTOR_LAST:
            continue
        nxt = ord(chars[i + 1]) if i + 1 < len(chars) else -1
        n += 1
        if nxt == VARIATION_SELECTOR_EMOJI:
            units += 2
            fw += 1
        elif nxt == VARIATION_SELECTOR_TEXT:
            units += 1
            ascii_units += 1
        elif is_fullwidth(ch):
            units += 2
            fw += 1
        else:
            units += 1
            ascii_units += 1
    return units, ascii_units, fw, n


def text_units(text: str) -> int:
    """Match upstream textUnits(): full-width characters count as two units."""
    return measure(text)[0]


# --- Width model ---------------------------------------------------------------
ASCII_EM = 0.6      # Upstream nodeTextFit.widthFactor (Geist Mono, provisional)
FULLWIDTH_EM = 1.0  # output-spec.md: one full-width character = 1em (provisional)
SLACK_PX = 4.0      # Worst measured overrun 1.6px plus 2.4px margin
UPSTREAM_RULE_OF_THUMB = "6.5*asciiUnits+13"
# Exclude background rectangles covering at least this fraction of viewBox area.
BACKGROUND_AREA_RATIO = 0.90
EPS = 0.01


def advance(text: str, font_size: float, ls_em: float) -> float:
    _, ascii_units, fw, n = measure(text)
    return (font_size * (ASCII_EM * ascii_units + FULLWIDTH_EM * fw)
            + ls_em * font_size * max(0, n - 1))


def extents(x: float, adv: float, anchor: str) -> tuple[float, float]:
    """Label (left, right) extents respecting its anchor."""
    if anchor == "middle":
        return x - adv / 2.0, x + adv / 2.0
    if anchor == "end":
        return x - adv, x
    return x, x + adv


# --- Parsing ------------------------------------------------------------------
TAG_RE = re.compile(r"<(/?)([A-Za-z][\w:.-]*)((?:'[^']*'|\"[^\"]*\"|[^>'\"])*)(/?)>",
                    re.S)
ATTR_RE = re.compile(r"""([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
TEXT_CLOSE_RE = re.compile(r"</text\s*>", re.I)
STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.I | re.S)
VIEWBOX_RE = re.compile(r"<svg\b[^>]*\bviewBox\s*=\s*[\"']([^\"']+)[\"']", re.I)
CSS_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
FONT_SIZE_RE = re.compile(r"(?:^|[;\s])font-size\s*:\s*([\d.]+)px", re.I)
# Extract px size from font shorthand: font:600 12px var(--sans) or
# font:8px var(--mono). Treat rem/clamp without px as unreadable.
FONT_SHORTHAND_RE = re.compile(r"(?:^|[;\s])font\s*:\s*[^;}]*?([\d.]+)px", re.I)
LETTER_SPACING_RE = re.compile(
    r"(?:^|[;\s])letter-spacing\s*:\s*(-?[\d.]+)(em|px)", re.I)
TEXT_ANCHOR_RE = re.compile(r"(?:^|[;\s])text-anchor\s*:\s*(start|middle|end)", re.I)
TRANSFORM_FN_RE = re.compile(r"([a-zA-Z]+)\s*\(([^)]*)\)")

# Descendants of these tags are not rendered, so do not count as containers or labels.
SKIP_TAGS = {"defs", "pattern", "marker", "symbol", "clippath", "mask",
             "filter", "lineargradient", "radialgradient", "style", "script",
             "title", "desc", "metadata"}
# HTML elements that cannot have children even without a closing slash.
VOID_TAGS = {"rect", "line", "path", "circle", "ellipse", "polygon",
             "polyline", "use", "image", "stop", "br", "meta", "link",
             "img", "input", "hr", "source"}
ANCHORS = ("start", "middle", "end")


def _f(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def attrs_of(raw: str) -> dict[str, str]:
    # findall returns an empty string, not None, for unmatched groups. Testing
    # is not None would erase single-quoted attributes, losing valid SVG
    # coordinates and classes and producing false positives.
    return {k.lower(): (dq or sq) for k, dq, sq in ATTR_RE.findall(raw)}


def blank_out(source: str) -> str:
    """Blank comments, style, and script bodies while preserving offsets and line numbers."""
    def rep(m: re.Match) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))
    def inner(m: re.Match) -> str:
        return m.group(1) + re.sub(r"[^\n]", " ", m.group(2)) + m.group(3)
    src = re.sub(r"<!--.*?-->", rep, source, flags=re.S)
    for tag in ("style", "script"):
        src = re.sub(rf"(<{tag}\b[^>]*>)(.*?)(</{tag}\s*>)", inner, src,
                     flags=re.S | re.I)
    return src


def parse_translate(value: str) -> tuple[float, float] | None:
    """Accumulate translate only; return None if any other transform appears."""
    dx = dy = 0.0
    body = value.strip()
    if not body:
        return 0.0, 0.0
    seen = 0
    for name, args in TRANSFORM_FN_RE.findall(body):
        seen += 1
        if name.lower() != "translate":
            return None
        parts = [p for p in re.split(r"[\s,]+", args.strip()) if p]
        nums = [_f(p) for p in parts]
        if not nums or len(nums) > 2 or any(v is None for v in nums):
            return None
        dx += nums[0]
        dy += nums[1] if len(nums) > 1 else 0.0
    return (dx, dy) if seen else None


def parse_css(source: str) -> dict[str, dict[str, dict]]:
    """Read .klass and element selectors shallowly.

    Missing element selectors such as svg text{font-size:12px} formerly marked
    valid SVG entirely text/unmeasurable. Specificity, inheritance, and media
    queries remain unmodeled; approximate class rules as overriding element rules.
    """
    out: dict[str, dict[str, dict]] = {"class": {}, "type": {}}
    for block in STYLE_RE.findall(source):
        for sel, body in CSS_RULE_RE.findall(block):
            fs = FONT_SIZE_RE.search(body) or FONT_SHORTHAND_RE.search(body)
            ls = LETTER_SPACING_RE.search(body)
            ta = TEXT_ANCHOR_RE.search(body)
            if not (fs or ls or ta):
                continue
            for one in sel.split(","):
                one = one.strip()
                if not one or one.startswith("@"):
                    continue
                # Read only the final compound selector: svg text.mono becomes text + mono.
                last = re.split(r"[\s>+~]+", one)[-1]
                classes = re.findall(r"\.([A-Za-z_][\w-]*)", last)
                el = re.match(r"([A-Za-z][\w-]*)", last)
                targets = ([("class", c) for c in classes[-1:]]
                           or ([("type", el.group(1).lower())] if el else []))
                for kind, name in targets:
                    slot = out[kind].setdefault(name, {})
                    if fs:
                        slot["font_size"] = float(fs.group(1))
                    if ls:
                        slot["ls"] = (float(ls.group(1)), ls.group(2).lower())
                    if ta:
                        slot["anchor"] = ta.group(1).lower()
    return out


def css_lookup(css: dict, tag: str, classes: list[str], key: str):
    for c in reversed(classes):
        rule = css["class"].get(c)
        if rule and key in rule:
            return rule[key], f"css:.{c}"
    rule = css["type"].get(tag)
    if rule and key in rule:
        return rule[key], f"css:{tag}"
    return None, None


def resolve_props(tag: str, attrs: dict, css: dict, parent: dict) -> dict:
    """Resolve font-size, letter-spacing, and text-anchor, inheriting from ancestors."""
    classes = attrs.get("class", "").split()
    style = attrs.get("style", "")

    fs = src = None
    if "font-size" in attrs:
        fs = _f(attrs["font-size"].strip().rstrip("px").strip())
        src = "attribute"
    if fs is None and style:
        m = FONT_SIZE_RE.search(";" + style) or FONT_SHORTHAND_RE.search(";" + style)
        if m:
            fs, src = float(m.group(1)), "style"
    if fs is None:
        fs, src = css_lookup(css, tag, classes, "font_size")
    if fs is None:
        fs, src = parent["font_size"], parent["font_size_source"]

    ls = attrs.get("letter-spacing")
    pair = None
    if ls:
        m = re.match(r"\s*(-?[\d.]+)(em|px)?\s*$", ls)
        if m:
            pair = (float(m.group(1)), (m.group(2) or "px").lower())
    if pair is None and style:
        m = LETTER_SPACING_RE.search(";" + style)
        if m:
            pair = (float(m.group(1)), m.group(2).lower())
    if pair is None:
        pair, _ = css_lookup(css, tag, classes, "ls")
    if pair is None:
        pair = parent["ls"]

    anchor = attrs.get("text-anchor", "").strip().lower()
    if anchor not in ANCHORS:
        anchor = ""
    if not anchor and style:
        m = TEXT_ANCHOR_RE.search(";" + style)
        if m:
            anchor = m.group(1).lower()
    if not anchor:
        got, _ = css_lookup(css, tag, classes, "anchor")
        anchor = got or parent["anchor"]

    return {"font_size": fs, "font_size_source": src, "ls": pair,
            "anchor": anchor}


ROOT_FRAME = {"font_size": None, "font_size_source": None, "ls": None,
              "anchor": "start", "tx": 0.0, "ty": 0.0, "transform_ok": True,
              "skip": False}


def walk(source: str, css: dict) -> tuple[list[dict], list[dict]]:
    """Walk document order and return rectangles and text in absolute coordinates.

    Accumulated ancestor g translate transforms support standard grouped-node SVG.
    """
    rects: list[dict] = []
    texts: list[dict] = []
    stack: list[dict] = [dict(ROOT_FRAME)]
    skip_to = 0

    for m in TAG_RE.finditer(source):
        if m.start() < skip_to:
            continue
        closing, tag, raw, self_closing = (m.group(1), m.group(2).lower(),
                                           m.group(3), m.group(4))
        if closing:
            if len(stack) > 1:
                stack.pop()
            continue

        attrs = attrs_of(raw)
        parent = stack[-1]
        frame = dict(resolve_props(tag, attrs, css, parent))
        frame["skip"] = parent["skip"] or tag in SKIP_TAGS
        tr = parse_translate(attrs["transform"]) if "transform" in attrs else (0.0, 0.0)
        frame["transform_ok"] = parent["transform_ok"] and tr is not None
        frame["tx"] = parent["tx"] + (tr[0] if tr else 0.0)
        frame["ty"] = parent["ty"] + (tr[1] if tr else 0.0)
        line_no = source.count("\n", 0, m.start()) + 1

        if tag == "text" and not frame["skip"]:
            close = TEXT_CLOSE_RE.search(source, m.end())
            inner = source[m.end():close.start()] if close else source[m.end():]
            if close:
                skip_to = close.end()
            label = html_mod.unescape(re.sub(r"\s+", " ", inner)).strip()
            x, y = _f(attrs.get("x", "0")), _f(attrs.get("y", "0"))
            texts.append({
                "label": label, "line": line_no, "attrs": attrs,
                "x": None if x is None else x + frame["tx"],
                "y": None if y is None else y + frame["ty"],
                "font_size": frame["font_size"],
                "font_size_source": frame["font_size_source"],
                "ls": frame["ls"], "anchor": frame["anchor"],
                "transform_ok": frame["transform_ok"],
                "has_tspan": "<tspan" in inner.lower(),
                "has_text_length": "textlength" in attrs,
            })
            continue

        if tag == "rect" and not frame["skip"] and frame["transform_ok"]:
            w, h = _f(attrs.get("width")), _f(attrs.get("height"))
            x, y = _f(attrs.get("x", "0")), _f(attrs.get("y", "0"))
            pct = "%" in attrs.get("width", "") or "%" in attrs.get("height", "")
            if not pct and None not in (x, y, w, h) and w > 0 and h > 0:
                rects.append({"x": x + frame["tx"], "y": y + frame["ty"],
                              "w": w, "h": h, "line": line_no})

        if not self_closing and tag not in VOID_TAGS:
            stack.append(frame)

    return rects, texts


def viewbox_area(source: str) -> float | None:
    m = VIEWBOX_RE.search(source)
    if not m:
        return None
    nums = [_f(p) for p in re.split(r"[\s,]+", m.group(1).strip()) if p]
    if len(nums) != 4 or any(v is None for v in nums):
        return None
    return abs(nums[2] * nums[3]) or None


def diagnostic(code: str, message: str, subject: dict, evidence: dict,
               severity: str = "error") -> dict:
    """Use the same diagnostic envelope fields as verify-connectors.py.

    Include supportedFixes only for width defects: shortening a label is not a
    valid repair for input-reading or measurement failures.
    """
    return {"code": code, "severity": severity, "message": message,
            "subject": subject, "evidence": evidence,
            "supportedFixes": supported_fixes()
            if code == "text/overflow" else []}


REPAIR_STEPS = (
    ("shorten", "Shorten the label to the briefest wording within the width budget"),
    ("widen", "Widen the container (mask or node)"),
    ("resize", "Reduce font size, staying above the output-spec.md minimum; "
               "hiding overflow through typography reduction violates the taste gate"),
    ("restructure", "Split the label into two elements or change the layout"),
    ("delete", "Last resort: record evidence that the label is unnecessary before deleting it"),
)


def supported_fixes() -> list[dict]:
    return [{"order": i, "action": a, "description": d,
             "requiresEvidence": a == "delete"}
            for i, (a, d) in enumerate(REPAIR_STEPS, 1)]


def empty_stats() -> dict:
    return {"texts": 0, "measured": 0, "noContainer": 0,
            "unmeasurable": 0, "outOfScope": 0}


def check(path: Path) -> tuple[list[dict], dict]:
    """(diagnostics, coverage statistics)."""
    stats = empty_stats()
    try:
        source = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        # A traceback on non-UTF-8 input could look like zero findings. Report
        # the unreadable input itself as a finding.
        return [diagnostic(
            "input/decode",
            f"{path.name}: not valid UTF-8 at byte {exc.start} - "
            f"{exc.reason}; re-save the file as UTF-8",
            {"file": path.name, "path": str(path)},
            {"reason": exc.reason, "encoding": exc.encoding,
             "byteOffset": exc.start})], stats
    except OSError as exc:
        return [diagnostic(
            "input/read",
            f"{path.name}: cannot read file - {type(exc).__name__}: {exc}",
            {"file": path.name, "path": str(path)},
            {"errno": getattr(exc, "errno", None),
             "reason": type(exc).__name__})], stats

    css = parse_css(source)
    body = blank_out(source)
    rects, texts = walk(body, css)
    vb = viewbox_area(source)
    containers = [r for r in rects
                  if vb is None or r["w"] * r["h"] < BACKGROUND_AREA_RATIO * vb]

    findings: list[dict] = []
    for t in texts:
        if not t["label"]:
            continue
        stats["texts"] += 1
        label, line_no, attrs = t["label"], t["line"], t["attrs"]

        scope = None
        if t["has_tspan"]:
            scope = "<tspan> child"
        elif t["has_text_length"]:
            scope = "textLength attribute"
        elif not t["transform_ok"]:
            scope = "non-translate transform (rotate/scale/matrix) on an ancestor or on <text>"
        if scope is not None:
            stats["outOfScope"] += 1
            findings.append(diagnostic(
                "text/out-of-scope",
                f"{path.name}:{line_no}: label {label[:40]!r} is outside this "
                f"checker's model - {scope}; it was NOT measured",
                {"file": path.name, "line": line_no, "label": label},
                {"reason": scope, "class": attrs.get("class"),
                 "units": text_units(label)},
                severity="warning"))
            continue

        fs = t["font_size"]
        if fs is None:
            stats["unmeasurable"] += 1
            findings.append(diagnostic(
                "text/unmeasurable",
                f"{path.name}:{line_no}: label {label[:40]!r} cannot be "
                "measured - no font-size in attribute, style, CSS class, CSS "
                f"element rule, or any ancestor ({attrs.get('class') or 'no class'})",
                {"file": path.name, "line": line_no, "label": label},
                {"reason": "no font-size", "class": attrs.get("class"),
                 "units": text_units(label)},
                severity="error"))
            continue

        x, y = t["x"], t["y"]
        if x is None or y is None:
            stats["unmeasurable"] += 1
            findings.append(diagnostic(
                "text/unmeasurable",
                f"{path.name}:{line_no}: label {label[:40]!r} cannot be "
                "measured - x/y is not a plain number",
                {"file": path.name, "line": line_no, "label": label},
                {"reason": "non-numeric x/y", "x": attrs.get("x"),
                 "y": attrs.get("y")},
                severity="error"))
            continue

        # Use the smallest rectangle containing the anchor. A label mask is
        # naturally the smallest enclosing box, so no size ranges are needed.
        pool = [r for r in containers
                if r["x"] - EPS <= x <= r["x"] + r["w"] + EPS
                and r["y"] - EPS <= y <= r["y"] + r["h"] + EPS]
        if not pool:
            stats["noContainer"] += 1
            continue  # Uncontained text, such as legends or titles
        box = min(pool, key=lambda r: r["w"] * r["h"])
        stats["measured"] += 1

        ls_val, ls_unit = t["ls"] or (0.0, "em")
        ls_em = ls_val if ls_unit == "em" else (ls_val / fs if fs else 0.0)
        adv = advance(label, fs, ls_em)
        left, right = extents(x, adv, t["anchor"])
        over_left = (box["x"] - SLACK_PX) - left
        over_right = right - (box["x"] + box["w"] + SLACK_PX)
        if over_left > 0 or over_right > 0:
            units, ascii_units, fw, _ = measure(label)
            side = ("left" if over_left >= over_right else "right")
            findings.append(diagnostic(
                "text/overflow",
                f"{path.name}:{line_no}: label {label!r} needs {adv:.1f}px and "
                f"spans [{left:.1f}, {right:.1f}] (anchor {t['anchor']}) but its "
                f"container is [{box['x']:g}, {box['x'] + box['w']:g}] "
                f"(slack {SLACK_PX:g}px) - exceeds the output-spec.md width budget",
                {"file": path.name, "line": line_no, "label": label},
                {"units": units, "asciiUnits": ascii_units,
                 "fullwidthChars": fw, "fontSize": fs, "letterSpacingEm": ls_em,
                 "fontSizeSource": t["font_size_source"],
                 "advancePx": round(adv, 2), "anchor": t["anchor"],
                 "labelLeft": round(left, 2), "labelRight": round(right, 2),
                 "containerX": box["x"], "containerWidth": box["w"],
                 "containerLine": box["line"],
                 "overflowSide": side,
                 "overflowPx": round(max(over_left, over_right), 2),
                 "slackPx": SLACK_PX,
                 "upstreamRuleOfThumb": UPSTREAM_RULE_OF_THUMB}))

    # Expose zero coverage when text and containers exist but no pairs match.
    # Labels outside boxes can be valid, so this alone is a warning.
    # The measured count in summary makes the coverage limit visible.
    if stats["measured"] == 0 and stats["texts"] > 0 and containers:
        findings.append(diagnostic(
            "text/no-pairings",
            f"{path.name}: {stats['texts']} <text> and {len(containers)} "
            "container rect(s) found but zero pairings - no label's anchor "
            "point fell inside any container, so nothing was measured; "
            "0 overflow finding here proves nothing",
            {"file": path.name},
            {"texts": stats["texts"], "containers": len(containers),
             "noContainer": stats["noContainer"],
             "unmeasurable": stats["unmeasurable"],
             "outOfScope": stats["outOfScope"]},
            severity="warning"))
    return findings, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", action="store_true",
                    help="Emit one JSON diagnostic envelope without human-readable lines")
    args = ap.parse_args()
    files = sorted((ROOT / "assets").glob("*.html")) if args.all else args.files
    if not files:
        ap.error("pass one or more files, or --all")

    findings: list[dict] = []
    total = empty_stats()
    per_file: dict[str, dict] = {}
    for f in files:
        fs, st = check(f)
        findings.extend(fs)
        for k, v in st.items():
            total[k] += v
        per_file[f.name] = st

    errors = [d for d in findings if d["severity"] == "error"]
    if args.json:
        print(json.dumps({
            "schemaVersion": 1,
            "ok": not errors,
            "source": "verify-text-width",
            "summary": {"files": len(files), "findings": len(findings),
                        "labels": total["measured"], "texts": total["texts"],
                        "skipped": {"noContainer": total["noContainer"],
                                    "unmeasurable": total["unmeasurable"],
                                    "outOfScope": total["outOfScope"]},
                        "perFile": per_file},
            "diagnostics": findings,
        }, ensure_ascii=False, indent=2))
        return 1 if errors else 0

    for d in findings:
        print(d["message"])
    print(f"Summary: {len(files)} file(s) checked, {len(findings)} finding(s), "
          f"measured {total['measured']} of {total['texts']} label(s) "
          f"({total['noContainer']} without a container, "
          f"{total['unmeasurable']} unmeasurable, "
          f"{total['outOfScope']} out of scope).")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
