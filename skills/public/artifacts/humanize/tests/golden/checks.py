"""Deterministic golden-fixture scorer for humanize general mode.

LLM output is non-deterministic, so these checks are DIRECTIONAL GATES,
never exact-string expectations. Each check asks "did a known failure mode
appear?" — e.g. a count that must not increase, or a structural element
that must not disappear. A legitimate rewrite always passes; only the
documented failure modes fail.

stdlib only. Usage as a library:

    from checks import run_checks
    failures = run_checks(original_text, rewritten_text)
    # empty list == PASS

or from the CLI:

    python3 checks.py input.txt output.txt

Failure codes (stable API — tests and fixtures reference these):
    empty_output       output is blank
    hayeot_injection   '하였' count increased vs original
    cliche_injection   a boilerplate phrase appeared/increased vs original
    colloquial_erased  colloquial sentence endings (해요체) wiped out
    heading_lost       a heading line disappeared entirely
    heading_absorbed   a heading line was merged into body prose
    footnote_count     inline footnote markers decreased
    footnote_numbers   the set of footnote numbers changed
    footnote_def       a footnote definition line was lost or altered
    footnote_anchor    a footnote marker moved to a different sentence
                       (detected via the nearest preceding number token)
    quote_altered      a direct quote is no longer verbatim
    number_injected    a numeric value appears in the output that never
                       occurred in the original (numeric injection)

Advisory (NOT a failure code): Lost original numbers can be normal after sentence
merging or notation normalization. dropped_numbers() returns lost values and
verify_gates.py observes them only on the report-only P4 axis.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass


@dataclass
class Failure:
    code: str
    message: str

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


# ===========================================================================
# Register checks: unintended increase in formality
# ===========================================================================

HAYEOT_RE = re.compile(r"하였")

# Boilerplate phrases the rewriter must never ADD. Increase-only gate:
# if the original already contains one, keeping it is not a failure.
CLICHE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("기록적인 성과", re.compile(r"기록적인\s*성과")),
    ("괄목할 만한", re.compile(r"괄목할\s*만한")),
    ("~로 평가된다", re.compile(r"로\s*평가(?:된다|받|되)")),
    ("주목받-", re.compile(r"주목받")),
    ("크게 기여", re.compile(r"크게\s*기여")),
    ("중요한 역할을 한다", re.compile(r"중요한\s*역할을\s*(?:한다|했다|할)")),
    ("시사하는 바가 크다", re.compile(r"시사하는\s*바가\s*크")),
    ("의미가 크다", re.compile(r"의미가\s*크다")),
]

# Sentence-final 요 (해요체/구어 종결). Counts "~인데요." "~거든요?" etc.
YO_ENDING_RE = re.compile(r"요\s*(?:[.?!…]|$)", re.MULTILINE)

# colloquial_erased fires only when the original is clearly colloquial
# (>= MIN_YO endings) AND the output keeps less than KEEP_RATIO of them.
# Sentence merging in a legitimate rewrite stays well above this floor.
MIN_YO = 3
KEEP_RATIO = 0.5


def check_register(original: str, output: str) -> list[Failure]:
    fails: list[Failure] = []

    a = len(HAYEOT_RE.findall(original))
    b = len(HAYEOT_RE.findall(output))
    if b > a:
        fails.append(Failure(
            "hayeot_injection",
            f"'하였' forms increased from {a} original to {b} rewritten occurrences (injected higher formality)",
        ))

    for name, pat in CLICHE_PATTERNS:
        a = len(pat.findall(original))
        b = len(pat.findall(output))
        if b > a:
            fails.append(Failure(
                "cliche_injection",
                f"Cliche '{name}' increased from {a} original to {b} rewritten occurrences (injection prohibited)",
            ))

    a = len(YO_ENDING_RE.findall(original))
    b = len(YO_ENDING_RE.findall(output))
    if a >= MIN_YO and b < a * KEEP_RATIO:
        fails.append(Failure(
            "colloquial_erased",
            f"Colloquial endings (~요) dropped from {a} original to {b} rewritten occurrences "
            f"(increased formality; register must remain unchanged)",
        ))

    return fails


# ===========================================================================
# Structure checks: damaged academic structure / footnotes
# ===========================================================================

_HEADING_PREFIX = re.compile(
    r"^(?:#{1,6}\s+"                      # Markdown: ## heading
    r"|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+\.\s*"          # Roman numeral: II. heading
    r"|\d{1,2}\.\s+"                      # Arabic numeral: 1. heading
    r"|\(\d{1,2}\)\s*"                    # Parentheses: (3) heading
    r"|제\d+[장절]\s*"                    # Korean chapter heading: 제3장
    r")"
)
_PROSE_ENDING = re.compile(r"(?:다|요|음|함|까)\s*[.?!]$")
_DEF_LINE = re.compile(r"^\s*\d{1,3}\)\s")


def extract_headings(text: str) -> list[tuple[str, str]]:
    """Return [(heading_line, core_title_without_numbering), ...]."""
    heads = []
    for line in text.splitlines():
        s = line.strip()
        if not s or len(s) > 50:
            continue
        if _DEF_LINE.match(s):  # footnote definition, not a heading
            continue
        if not _HEADING_PREFIX.match(s):
            continue
        if _PROSE_ENDING.search(s):  # short prose sentence, not a heading
            continue
        core = _HEADING_PREFIX.sub("", s).strip()
        if not core:
            continue
        heads.append((_norm_ws(s), core))
    return heads


def check_headings(original: str, output: str) -> list[Failure]:
    fails: list[Failure] = []
    out_lines = {_norm_ws(l) for l in output.splitlines() if l.strip()}
    out_joined = _norm_ws(output)
    for line, core in extract_headings(original):
        if line in out_lines:
            continue
        if core in out_joined:
            fails.append(Failure(
                "heading_absorbed",
                f"Heading '{line}' lost its standalone line and was absorbed into body prose",
            ))
        else:
            fails.append(Failure(
                "heading_lost",
                f"Heading '{line}' disappeared from the rewrite",
            ))
    return fails


# Inline marker: digits + ')' ATTACHED to the preceding character
# ("...증가했다.1)"). A space-preceded or line-leading "N) " is a footnote
# DEFINITION label, not an inline marker. '(3)' style headings are excluded
# by the '(' lookbehind; '(2024)' style years by the digit lookbehind.
_INLINE_MARKER = re.compile(r"(?<=\S)(?<![(\d])(\d{1,3})\)")
_DEF_LABEL = re.compile(r"(?:^|(?<=\s))(\d{1,3})\)\s")
_NUM_TOKEN = re.compile(r"\d+(?:[.,]\d+)*")

ANCHOR_WINDOW = 50  # chars scanned backwards from a marker for its anchor number


def extract_inline_markers(text: str) -> list[tuple[str, int]]:
    """Return [(footnote_number, absolute_position), ...] in document order."""
    markers = []
    offset = 0
    for line in text.splitlines(keepends=True):
        if not _DEF_LINE.match(line):
            for m in _INLINE_MARKER.finditer(line):
                markers.append((m.group(1), offset + m.start(1)))
        offset += len(line)
    return markers


def extract_defs(text: str) -> dict[str, str]:
    """Return {footnote_number: normalized_definition_content}.

    Handles both one-definition-per-line and (broken) merged lines, so the
    content-identity check still works on merged-but-verbatim definitions.
    """
    defs: dict[str, str] = {}
    for line in text.splitlines():
        if not _DEF_LINE.match(line):
            continue
        labels = [(m.start(), m.group(1)) for m in _DEF_LABEL.finditer(line)]
        for i, (pos, num) in enumerate(labels):
            end = labels[i + 1][0] if i + 1 < len(labels) else len(line)
            content = re.sub(r"^\s*\d{1,3}\)\s*", "", line[pos:end])
            defs[num] = _norm_ws(content)
    return defs


def _nearest_num_before(text: str, pos: int) -> str | None:
    seg = text[max(0, pos - ANCHOR_WINDOW):pos]
    nums = _NUM_TOKEN.findall(seg)
    return nums[-1] if nums else None


def check_footnotes(original: str, output: str) -> list[Failure]:
    fails: list[Failure] = []
    in_markers = extract_inline_markers(original)
    out_markers = extract_inline_markers(output)
    if not in_markers and not extract_defs(original):
        return fails  # original has no footnotes; nothing to protect

    if len(out_markers) < len(in_markers):
        fails.append(Failure(
            "footnote_count",
            f"Inline footnote markers decreased from {len(in_markers)} to {len(out_markers)}",
        ))

    in_nums = {n for n, _ in in_markers}
    out_nums = {n for n, _ in out_markers}
    if in_nums != out_nums:
        missing = sorted(in_nums - out_nums, key=int)
        invented = sorted(out_nums - in_nums, key=int)
        parts = []
        if missing:
            parts.append(f"missing {missing}")
        if invented:
            parts.append(f"invented {invented}")
        fails.append(Failure(
            "footnote_numbers",
            f"Footnote number set changed: {', '.join(parts)}",
        ))

    # Anchor check: a marker must stay attached to the same sentence.
    # Proxy: the nearest number token within ANCHOR_WINDOW chars before the
    # marker (numbers are immutable under the skill's iron rules, so they
    # survive a legitimate rewrite). Markers with no nearby number in the
    # original are skipped — count/set checks still cover their existence.
    out_first_pos = {}
    for n, p in out_markers:
        out_first_pos.setdefault(n, p)
    for num, pos in in_markers:
        anchor = _nearest_num_before(original, pos)
        if anchor is None or num not in out_first_pos:
            continue
        out_anchor = _nearest_num_before(output, out_first_pos[num])
        if out_anchor != anchor:
            fails.append(Failure(
                "footnote_anchor",
                f"Footnote {num}) moved from its original position "
                f"(adjacent numeric anchor '{anchor}' -> '{out_anchor}'): risk of altered citation attribution",
            ))

    in_defs = extract_defs(original)
    out_defs = extract_defs(output)
    for num, content in in_defs.items():
        if num not in out_defs:
            fails.append(Failure(
                "footnote_def",
                f"Footnote definition {num}) disappeared from the rewrite",
            ))
        elif out_defs[num] != content:
            fails.append(Failure(
                "footnote_def",
                f"Footnote definition {num}) changed (bibliographic details must remain invariant)",
            ))
    return fails


# ===========================================================================
# Number fidelity: numbers are invariant. Only injection fails this directional gate.
# Deletion may follow restructuring; observe it through dropped_numbers advisories.
# ===========================================================================

# Korean number units: convert only one character immediately following a number (1만).
# Do not convert compounds (1만2천) or spaced forms. Symmetric notation on both sides
# avoids false positives; do not overengineer.
_KO_UNIT_MULT = {
    "백": 100,
    "천": 1_000,
    "만": 10_000,
    "억": 100_000_000,
    "조": 1_000_000_000_000,
}


def _number_values(text: str) -> set[str]:
    """Canonical set of numeric values in text.

    Reuse _NUM_TOKEN for commas/decimals (10,000, 3.1). Normalize thousands commas
    so 10,000 == 10000; notation changes are not numeric alteration. Convert one
    immediately following Korean unit (만/억/조/천/백) into its value: 1만 == 10,000
    == 10000, 1억 == 100000000. Set comparison ignores heading renumbering and
    multiplicity/order changes, prioritizing fewer false positives.
    """
    values: set[str] = set()
    for m in _NUM_TOKEN.finditer(text):
        tok = m.group(0).replace(",", "")
        mult = _KO_UNIT_MULT.get(text[m.end():m.end() + 1])
        if mult:
            try:
                val = float(tok) * mult
                values.add(str(int(val)) if val == int(val) else str(val))
                continue
            except ValueError:
                pass
        values.add(tok)
    return values


def dropped_numbers(original: str, output: str) -> list[str]:
    """Values present in the original but absent from the rewrite; advisory only.

    Sentence merging/notation normalization can remove values, so gating would
    create false alarms. run_checks does not call this; verify_gates.py observes
    it on report-only P4.
    """
    return sorted(_number_values(original) - _number_values(output))


def check_numbers(original: str, output: str) -> list[Failure]:
    """Directional numeric-injection gate: fail only on number_injected."""
    fails: list[Failure] = []
    injected = sorted(_number_values(output) - _number_values(original))
    if injected:
        fails.append(Failure(
            "number_injected",
            f"Numeric values absent from the original appeared in the rewrite: {injected} "
            f"(numeric invariance; risk of injecting unsupported claims)",
        ))
    return fails


# ===========================================================================
# Quote fidelity — direct quotes are immutable under the iron rules
# ===========================================================================

MIN_QUOTE_LEN = 8


def extract_quotes(text: str, min_len: int = MIN_QUOTE_LEN) -> list[str]:
    quotes: list[str] = []
    for op, cl in (("「", "」"), ("『", "』"), ("“", "”")):
        quotes += re.findall(re.escape(op) + r"([^" + cl + r"]+)" + re.escape(cl), text)
    # Straight double quotes: only if balanced.
    parts = text.split('"')
    if len(parts) % 2 == 1:
        quotes += parts[1::2]
    return [q for q in quotes if len(q.strip()) >= min_len]


def check_quotes(original: str, output: str) -> list[Failure]:
    fails = []
    for q in extract_quotes(original):
        if q not in output:
            fails.append(Failure(
                "quote_altered",
                f"Direct quotation 「{q[:30]}…」 is not verbatim in the rewrite (quotation invariance)",
            ))
    return fails


# ===========================================================================
# Entry point
# ===========================================================================

_SUMMARY_BLOCK_RE = re.compile(r"<!--\s*HUMANIZE-SUMMARY\b.*", re.DOTALL)


def strip_summary_block(text: str) -> str:
    """Remove the final <!-- HUMANIZE-SUMMARY --> metadata block from final.md.

    This is metadata, not rewritten output. Prevent self-check phrases such as
    하였- 무 from being misread as body injections; same as verify_change_rate.py.
    """
    return _SUMMARY_BLOCK_RE.sub("", text).strip()


def run_checks(original: str, output: str) -> list[Failure]:
    original = strip_summary_block(original)
    output = strip_summary_block(output)
    if not output.strip():
        return [Failure("empty_output", "Rewritten output is empty")]
    fails: list[Failure] = []
    fails += check_register(original, output)
    fails += check_headings(original, output)
    fails += check_footnotes(original, output)
    fails += check_quotes(original, output)
    fails += check_numbers(original, output)
    return fails


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: python3 checks.py <original.txt> <rewritten.txt>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        original = f.read()
    with open(argv[2], encoding="utf-8") as f:
        output = f.read()
    failures = run_checks(original, output)
    if failures:
        for x in failures:
            print(f"FAIL {x}")
        return 1
    print("PASS (no known failure modes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
