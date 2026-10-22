#!/usr/bin/env python3
"""Validate the structural integrity of an HWPX file.

Checks:
  - Valid ZIP archive
  - Required files present (mimetype, content.hpf, header.xml, section0.xml)
  - mimetype content is correct
  - mimetype is the first ZIP entry and stored without compression
  - All XML files are well-formed

Usage:
    python validate.py document.hwpx
    python validate.py document.hwpx --semantic --json

## Diagnostic contract (`--json`)

`--json` emits only one diagnostic envelope on stdout instead of the human
`VALID:`/`INVALID:` lines. Fields follow upstream `up:archify`'s
`shared/diagnostics.mjs` (`normalizedDiagnostic` / `rendererFailure`), matching
`skills/diagram`'s `verify-connectors.py --json` contract.

**The return types of `validate()` / `validate_semantic()` are unchanged.** Both
still return lists of strings: regression suites import them to assert `== []`,
and `check_script_contracts` enforces that boundary. A thin mapping layer,
`diagnostics_from_findings`, produces JSON inside `main()`.

`code`/`subject`/`evidence` are attached structurally at the defect site. Human
messages are never reparsed: previously, paragraph text appended to messages
could control classification. Text containing `1. undefined styleIDRef=9` changed
the code to `reference/undefined` and invented a reference in evidence.
`_validate_findings()` / `_semantic_findings()` return finding dictionaries;
the two public functions extract only `message` to preserve string lists.

The legacy string-only path (`to_diagnostics`) uses strict prefix matching and
retains raw evidence without extracting structure, preventing document text
from inventing values. Unmatched messages become `internal/unclassified` rather
than disappearing; the diagnostic count always equals `len(errors)`.
See "Limits" in `references/validation-rules.md`.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_STORED, BadZipFile, ZipFile

from lxml import etree

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

REQUIRED_FILES = [
    "mimetype",
    "Contents/content.hpf",
    "Contents/header.xml",
    "Contents/section0.xml",
]

EXPECTED_MIMETYPE = "application/hwp+zip"

NS = {
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
}


# Required `hp:secPr` children (I-5), evidenced by
# `templates/base/Contents/section0.xml`; canonical description:
# `references/xml-structure.md` section 2. Attributes cause a Hancom corruption
# dialog; missing children silently restore defaults. This list catches the latter.
SECPR_REQUIRED_CHILDREN = (
    "grid", "startNum", "visibility", "lineNumberShape",
    "pagePr", "footNotePr", "endNotePr", "pageBorderFill",
)


def _finding(code: str, message: str, *, subject: dict | None = None,
             evidence: dict | None = None) -> dict:
    """One defect, with code and evidence attached at its source.

    Never reparse messages: appended paragraph text would let user data control
    classification.
    """
    return {"code": code, "message": message,
            "subject": dict(subject or {}), "evidence": dict(evidence or {})}


def _validate_findings(hwpx_path: str) -> list[dict]:
    """Structural checks returning finding dictionaries (the body of `validate()`)."""

    findings: list[dict] = []
    path = Path(hwpx_path)

    if not path.is_file():
        return [_finding("input/read", f"File not found: {hwpx_path}",
                         subject={"path": hwpx_path})]

    # Check valid ZIP
    try:
        zf = ZipFile(hwpx_path, "r")
    except BadZipFile:
        return [_finding("input/read", f"Not a valid ZIP archive: {hwpx_path}",
                         subject={"path": hwpx_path})]

    with zf:
        names = zf.namelist()

        # Check required files
        for required in REQUIRED_FILES:
            if required not in names:
                findings.append(_finding(
                    "package/missing-file", f"Missing required file: {required}",
                    subject={"path": required}))

        # Check mimetype content
        if "mimetype" in names:
            mimetype_content = zf.read("mimetype").decode("utf-8").strip()
            if mimetype_content != EXPECTED_MIMETYPE:
                findings.append(_finding(
                    "package/mimetype",
                    f"Invalid mimetype: expected '{EXPECTED_MIMETYPE}', "
                    f"got '{mimetype_content}'",
                    subject={"path": "mimetype"},
                    evidence={"expected": EXPECTED_MIMETYPE,
                              "actual": mimetype_content}))

            # Check mimetype is first entry
            if names[0] != "mimetype":
                index = names.index("mimetype")
                findings.append(_finding(
                    "package/mimetype",
                    f"mimetype is not the first ZIP entry (found at index "
                    f"{index})",
                    subject={"path": "mimetype"}, evidence={"index": index}))

            # Check mimetype is stored without compression
            info = zf.getinfo("mimetype")
            if info.compress_type != ZIP_STORED:
                findings.append(_finding(
                    "package/mimetype",
                    f"mimetype should use ZIP_STORED (0), "
                    f"got compress_type={info.compress_type}",
                    subject={"path": "mimetype"},
                    evidence={"compressType": info.compress_type,
                              "expected": ZIP_STORED}))

        # Check XML well-formedness
        for name in names:
            if name.endswith(".xml") or name.endswith(".hpf"):
                try:
                    data = zf.read(name)
                    etree.fromstring(data)
                except etree.XMLSyntaxError as e:
                    findings.append(_finding(
                        "input/xml-parse", f"Malformed XML in {name}: {e}",
                        subject={"path": name}, evidence={"detail": str(e)}))

    return findings


def validate(hwpx_path: str) -> list[str]:
    """Validate HWPX file and return a list of error messages (empty = valid).

    The return type is unchanged; regression suites assert `== []`.
    Obtain structured code/subject/evidence through `_validate_findings()`.
    """
    return [f["message"] for f in _validate_findings(hwpx_path)]


def _ids(root: etree._Element, tag: str) -> set[str]:
    return {el.get("id") for el in root.findall(f".//hh:{tag}", namespaces=NS) if el.get("id") is not None}


def _style_by_name(root: etree._Element, name: str) -> etree._Element | None:
    wanted = re.sub(r"\s+", "", name)
    for style in root.findall(".//hh:style", namespaces=NS):
        if re.sub(r"\s+", "", style.get("name", "")) == wanted:
            return style
    return None


def _style_names_by_id(root: etree._Element) -> dict[str, str]:
    return {
        style.get("id"): style.get("name", "")
        for style in root.findall(".//hh:style", namespaces=NS)
        if style.get("id") is not None
    }


def _list_para_ids(root: etree._Element) -> set[str]:
    ids: set[str] = set()
    for para in root.findall(".//hh:paraPr", namespaces=NS):
        pid = para.get("id")
        if not pid:
            continue
        heading = para.find("hh:heading", namespaces=NS)
        heading_type = heading.get("type", "NONE") if heading is not None else para.get("headingType", "NONE")
        if heading_type != "NONE":
            ids.add(pid)
    return ids


def _own_text(paragraph: etree._Element) -> str:
    return "".join(paragraph.xpath("./hp:run/hp:t/text()", namespaces=NS))


def _text_runs(paragraph: etree._Element) -> list[etree._Element]:
    return [
        run
        for run in paragraph.findall("hp:run", namespaces=NS)
        if "".join(run.xpath("./hp:t/text()", namespaces=NS))
    ]


def _matches_style(paragraph: etree._Element, style: etree._Element) -> bool:
    style_id = style.get("id")
    para_id = style.get("paraPrIDRef")
    char_id = style.get("charPrIDRef")
    if style_id and paragraph.get("styleIDRef") != style_id:
        return False
    if para_id and paragraph.get("paraPrIDRef") != para_id:
        return False
    if char_id:
        for run in _text_runs(paragraph):
            if run.get("charPrIDRef") != char_id:
                return False
    return True


def _is_heading_like(paragraph: etree._Element, list_para_ids: set[str], style_names: dict[str, str]) -> bool:
    if paragraph.get("paraPrIDRef") in list_para_ids:
        return True
    return style_names.get(paragraph.get("styleIDRef"), "") in {"2.", "2.1", "2.1.1"}


def _semantic_findings(hwpx_path: str) -> list[dict]:
    """Semantic checks returning finding dictionaries for `validate_semantic()`.

    Each defect attaches its code, subject, and evidence here. Ordered-list
    findings append paragraph text to messages; reparsing those messages would
    let document text control classification.
    """

    findings: list[dict] = []
    try:
        with ZipFile(hwpx_path, "r") as zf:
            header = etree.fromstring(zf.read("Contents/header.xml"))
            section = etree.fromstring(zf.read("Contents/section0.xml"))
    except Exception as exc:
        return [_finding(
            "input/read",
            f"Unable to load header/section XML for semantic validation: {exc}",
            subject={"path": hwpx_path}, evidence={"detail": str(exc)})]

    style_ids = _ids(header, "style")
    para_ids = _ids(header, "paraPr")
    char_ids = _ids(header, "charPr")
    border_ids = _ids(header, "borderFill")
    list_para_ids = _list_para_ids(header)
    style_names = _style_names_by_id(header)
    table_content_style = _style_by_name(header, "표 내용")

    first_para = section.find(".//hp:p", namespaces=NS)
    if first_para is None:
        findings.append(_finding("document/structure",
                                 "section0.xml has no paragraph",
                                 subject={"path": "Contents/section0.xml"}))
    else:
        secpr = first_para.find(".//hp:secPr", namespaces=NS)
        if secpr is None:
            findings.append(_finding("document/structure",
                                     "first paragraph is missing hp:secPr",
                                     subject={"identity": first_para.get("id")},
                                     evidence={"missingElement": "hp:secPr"}))
        else:
            # I-5 previously checked presence alone. Missing secPr children let
            # the file open with default paper, margin, and footnote settings,
            # disrupting procurement forms. This is one of the few machine
            # signals available before a human opens the file in Hancom.
            for child in SECPR_REQUIRED_CHILDREN:
                if secpr.find(f"hp:{child}", namespaces=NS) is None:
                    findings.append(_finding(
                        "document/structure",
                        f"hp:secPr is missing required child: hp:{child}",
                        subject={"identity": first_para.get("id")},
                        evidence={"missingElement": f"hp:{child}"}))
            # Missing hp:margin under hp:pagePr also restores all default
            # margins, so inspect one level deeper.
            pagepr = secpr.find("hp:pagePr", namespaces=NS)
            if pagepr is not None and pagepr.find("hp:margin", namespaces=NS) is None:
                findings.append(_finding(
                    "document/structure",
                    "hp:secPr is missing required child: hp:pagePr/hp:margin",
                    subject={"identity": first_para.get("id")},
                    evidence={"missingElement": "hp:margin"}))
        if first_para.find(".//hp:colPr", namespaces=NS) is None:
            findings.append(_finding("document/structure",
                                     "first paragraph is missing hp:colPr",
                                     subject={"identity": first_para.get("id")},
                                     evidence={"missingElement": "hp:colPr"}))

    seen_pids: set[str] = set()
    for p in section.findall(".//hp:p", namespaces=NS):
        pid = p.get("id")
        own_text = _own_text(p).strip()
        has_table = p.find(".//hp:tbl", namespaces=NS) is not None
        is_list_para = p.get("paraPrIDRef") in list_para_ids
        subj = {"identity": pid} if pid else {}
        if pid:
            if pid in seen_pids:
                findings.append(_finding("document/duplicate-id",
                                         f"duplicate paragraph id: {pid}",
                                         subject=subj,
                                         evidence={"identity": pid}))
            seen_pids.add(pid)

        sid = p.get("styleIDRef")
        if sid and sid not in style_ids:
            findings.append(_finding(
                "reference/undefined",
                f"undefined styleIDRef={sid} on paragraph id={pid}",
                subject=subj, evidence={"idref": sid, "kind": "styleIDRef"}))
        para = p.get("paraPrIDRef")
        if para and para not in para_ids:
            findings.append(_finding(
                "reference/undefined",
                f"undefined paraPrIDRef={para} on paragraph id={pid}",
                subject=subj, evidence={"idref": para, "kind": "paraPrIDRef"}))

        for run in p.findall("hp:run", namespaces=NS):
            char = run.get("charPrIDRef")
            if char and char not in char_ids:
                findings.append(_finding(
                    "reference/undefined",
                    f"undefined charPrIDRef={char} on paragraph id={pid}",
                    subject=subj,
                    evidence={"idref": char, "kind": "charPrIDRef"}))

        if not own_text and is_list_para:
            findings.append(_finding(
                "style/mismatch",
                f"blank paragraph id={pid} uses list/outline "
                f"paraPrIDRef={p.get('paraPrIDRef')}",
                subject=subj,
                evidence={"paraPrIDRef": p.get("paraPrIDRef"),
                          "reason": "blank-paragraph"}))
        if has_table and is_list_para:
            findings.append(_finding(
                "style/mismatch",
                f"table anchor paragraph id={pid} uses list/outline "
                f"paraPrIDRef={p.get('paraPrIDRef')}",
                subject=subj,
                evidence={"paraPrIDRef": p.get("paraPrIDRef"),
                          "reason": "table-anchor"}))
        if "|---" in own_text:
            findings.append(_finding(
                "conversion/residual-markup",
                f"raw Markdown table separator remains on paragraph id={pid}",
                subject=subj, evidence={"marker": "|---"}))
        if "```" in own_text:
            findings.append(_finding(
                "conversion/residual-markup",
                f"raw Markdown code fence remains on paragraph id={pid}",
                subject=subj, evidence={"marker": "```"}))
        if "○" in own_text or "□" in own_text:
            findings.append(_finding(
                "conversion/residual-markup",
                f"literal proposal bullet marker remains on paragraph id={pid}",
                subject=subj,
                evidence={"marker": "○" if "○" in own_text else "□"}))
        if re.match(r"^\d+[.)]\s+\S", own_text) and not _is_heading_like(p, list_para_ids, style_names):
            # Include 40 text characters for human readers. Classification
            # ignores this string and cannot be manipulated by it (F1 repair).
            findings.append(_finding(
                "conversion/residual-markup",
                f"ordered list marker was not converted to parenthesized form "
                f"on paragraph id={pid}: {own_text[:40]}",
                subject=subj, evidence={"textPrefix": own_text[:40]}))

    for tbl in section.findall(".//hp:tbl", namespaces=NS):
        border = tbl.get("borderFillIDRef")
        if border and border not in border_ids:
            findings.append(_finding(
                "reference/undefined",
                f"undefined table borderFillIDRef={border}",
                evidence={"idref": border, "kind": "borderFillIDRef",
                          "where": "table"}))
        sz = tbl.find("hp:sz", namespaces=NS)
        table_width = int(sz.get("width", "0")) if sz is not None and sz.get("width", "0").isdigit() else 0
        for tc in tbl.findall(".//hp:tc", namespaces=NS):
            cell_border = tc.get("borderFillIDRef")
            if cell_border and cell_border not in border_ids:
                findings.append(_finding(
                    "reference/undefined",
                    f"undefined cell borderFillIDRef={cell_border}",
                    evidence={"idref": cell_border, "kind": "borderFillIDRef",
                              "where": "cell"}))
            for cell_p in tc.findall(".//hp:p", namespaces=NS):
                cell_pid = cell_p.get("id")
                cell_subj = {"identity": cell_pid} if cell_pid else {}
                if cell_p.get("paraPrIDRef") in list_para_ids:
                    findings.append(_finding(
                        "style/mismatch",
                        f"table cell paragraph id={cell_pid} uses list/outline "
                        f"paraPrIDRef={cell_p.get('paraPrIDRef')}",
                        subject=cell_subj,
                        evidence={"paraPrIDRef": cell_p.get("paraPrIDRef"),
                                  "reason": "table-cell"}))
                if table_content_style is not None and not _matches_style(cell_p, table_content_style):
                    findings.append(_finding(
                        "style/mismatch",
                        f"table cell paragraph id={cell_pid} does not use named "
                        f"style '표 내용'",
                        subject=cell_subj,
                        evidence={"expectedStyle": "표 내용",
                                  "styleIDRef": cell_p.get("styleIDRef")}))
        if table_width:
            for tr in tbl.findall("hp:tr", namespaces=NS):
                row_width = 0
                for tc in tr.findall("hp:tc", namespaces=NS):
                    cell_sz = tc.find("hp:cellSz", namespaces=NS)
                    if cell_sz is not None and cell_sz.get("width", "0").lstrip("-").isdigit():
                        row_width += int(cell_sz.get("width", "0"))
                if row_width > table_width + 5:
                    findings.append(_finding(
                        "layout/table-width",
                        f"table row width {row_width} exceeds table width "
                        f"{table_width}",
                        evidence={"rowWidth": row_width,
                                  "tableWidth": table_width}))

    return findings


def validate_semantic(hwpx_path: str) -> list[str]:
    """Validate common HWPX semantic references used by generated proposals.

    The return type remains a list of strings. Obtain structured diagnostics
    through `_semantic_findings()`.
    """
    return [f["message"] for f in _semantic_findings(hwpx_path)]


# --- Diagnostic contract (H-4) ----------------------------------------------
# Five repair steps share the diagram skill's action vocabulary, with HWPX text.
# Deletion is last and requires evidence. This is our addition to upstream,
# so supportedFixes is an array of objects rather than strings.
REPAIR_STEPS = (
    ("relocate", "Point references (IDRef) to existing IDs"),
    ("reroute", "Use another named style or paragraph property"),
    ("shorten", "Reduce text or table width to fit the specification"),
    ("restructure", "Restructure paragraphs or tables"),
    ("delete", "Last resort. Before deleting a paragraph or table, record "
               "evidence that the document does not need it"),
)

# Codes supporting all five steps. Reference repair is invalid for read/package defects.
REPAIRABLE = {
    "reference/undefined", "style/mismatch", "conversion/residual-markup",
    "layout/table-width", "document/duplicate-id", "document/structure",
}

# Strict prefix table: only message.startswith(needle) is allowed. This is the
# fallback for the legacy string-only to_diagnostics path without structured codes.
# Earlier substring matching let appended document text choose its diagnostic:
# `1. undefined styleIDRef=9` in an ordered-list message changed classification to
# reference/undefined and invented evidence. Prefix matching excludes the
# document-controlled message suffix from classification.
#
# Messages identifiable only by an internal substring become internal/unclassified.
# This narrower scope is documented under "Limits". All production finding paths
# attach structured codes and bypass this table.
CODE_TABLE = (
    ("File not found:", "input/read"),
    ("Not a valid ZIP archive:", "input/read"),
    ("Unable to load header/section XML", "input/read"),
    ("Missing required file:", "package/missing-file"),
    ("Invalid mimetype:", "package/mimetype"),
    ("mimetype is not the first ZIP entry", "package/mimetype"),
    ("mimetype should use ZIP_STORED", "package/mimetype"),
    ("Malformed XML in", "input/xml-parse"),
    ("section0.xml has no paragraph", "document/structure"),
    ("first paragraph is missing", "document/structure"),
    ("hp:secPr is missing required child", "document/structure"),
    ("duplicate paragraph id", "document/duplicate-id"),
    ("undefined styleIDRef=", "reference/undefined"),
    ("undefined paraPrIDRef=", "reference/undefined"),
    ("undefined charPrIDRef=", "reference/undefined"),
    ("undefined table borderFillIDRef=", "reference/undefined"),
    ("undefined cell borderFillIDRef=", "reference/undefined"),
    ("raw Markdown", "conversion/residual-markup"),
    ("literal proposal bullet marker", "conversion/residual-markup"),
    ("ordered list marker was not converted", "conversion/residual-markup"),
    ("table row width", "layout/table-width"),
)


def classify(message: str) -> str:
    """String-only fallback using strict prefix matching, never substring matching."""
    for needle, code in CODE_TABLE:
        if message.startswith(needle):
            return code
    # Preserve unmatched findings so diagnostic count == validate() result count
    # and classification gaps remain visible.
    return "internal/unclassified"


def supported_fixes(code: str) -> list[dict]:
    if code not in REPAIRABLE:
        return []
    return [{"order": i, "action": a, "description": d,
             "requiresEvidence": a == "delete"}
            for i, (a, d) in enumerate(REPAIR_STEPS, 1)]


def diagnostics_from_findings(findings: list[dict], input_path: str) -> list[dict]:
    """Map findings to diagnostic-envelope entries without reparsing messages.

    Code, subject, and evidence were attached at the defect site. Add the input
    path to subject and retain raw text only when evidence is empty.
    """
    out: list[dict] = []
    for f in findings:
        code = f.get("code") or "internal/unclassified"
        subject = {"input": input_path}
        for k, v in (f.get("subject") or {}).items():
            if v is not None:
                subject[k] = v
        evidence = {k: v for k, v in (f.get("evidence") or {}).items()
                    if v is not None}
        if not evidence:
            evidence = {"raw": f["message"]}
        out.append({"code": code, "severity": "error", "message": f["message"],
                    "subject": subject, "evidence": evidence,
                    "supportedFixes": supported_fixes(code)})
    return out


def to_diagnostics(errors: list[str], input_path: str) -> list[dict]:
    """Legacy string-only path preserving the finding count.

    Without structure, retain raw evidence rather than inventing it. Previously,
    regex extraction of undefined references turned paragraph text into
    evidence.idref, inventing references that did not exist.
    """
    return diagnostics_from_findings(
        [{"code": classify(m), "message": m} for m in errors], input_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate the structural integrity of an HWPX file"
    )
    parser.add_argument("input", help="Path to .hwpx file")
    parser.add_argument("--semantic", action="store_true", help="Check references, table widths, and proposal-specific style/text rules")
    parser.add_argument("--json", action="store_true",
                        help="Emit one diagnostic envelope on stdout instead of "
                             "the human VALID/INVALID lines")
    args = parser.parse_args()

    # Keep structured findings intact. Extract human messages here; JSON uses
    # the original code/subject/evidence without reparsing messages.
    findings = _validate_findings(args.input)
    if args.semantic:
        findings.extend(_semantic_findings(args.input))
    errors = [f["message"] for f in findings]

    if args.json:
        # Do not mix human output with JSON: even one extra line breaks parsing.
        print(json.dumps({
            "schemaVersion": 1,
            "ok": not errors,
            "source": "validate_hwpx",
            "summary": {"input": args.input, "findings": len(errors),
                        "semantic": bool(args.semantic)},
            "diagnostics": diagnostics_from_findings(findings, args.input),
        }, ensure_ascii=False, indent=2))
        sys.exit(1 if errors else 0)

    if errors:
        print(f"INVALID: {args.input}", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"VALID: {args.input}")
        print(f"  All structural checks passed.")
        if args.semantic:
            print(f"  Semantic proposal checks passed.")


if __name__ == "__main__":
    main()
