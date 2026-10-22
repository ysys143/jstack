#!/usr/bin/env python3
"""PreToolUse guard for the moment an HWPX file is handed to the user.

Why guard delivery rather than generation:
Generation checks can be bypassed by direct XML authoring, skipped validation,
or another tool. Every output still passes through delivery. Checking that
single handoff point reduces cost and coverage gaps.

For existing .hwpx paths in tool input, check four conditions:
1. mimetype is the first entry and uncompressed, as Hancom requires.
2. Required Contents/header.xml and Contents/section0.xml entries exist.
3. No client preview thumbnail remains, matching sanitize_template.py.
4. No charPr wiring boxes every character, matching fix_borders.py.

Allow this skill's own script calls. Blocking conversion, validation, or repair
would prevent fixing defects and create deadlock.

Fail open on unreadable input, missing files, and unexpected exceptions. Hook
uncertainty must not stop the user's work; block only confirmed defects.

Registration is owned by the plugin-root hooks/hooks.json, while this file stays
inside the skill:

    {"hooks": {"PreToolUse": [{"matcher": "Bash|Read|Write|Edit",
      "hooks": [{"type": "command",
        "command": "python3 ${CLAUDE_PLUGIN_ROOT}/skills/hwpx/hooks/hwpx_guard.py"}]}]}}
"""

from __future__ import annotations

import json
import os
import re
import sys
import zipfile

MIMETYPE = "application/hwp+zip"
REQUIRED = ("Contents/header.xml", "Contents/section0.xml")
HH = "{http://www.hancom.co.kr/hwpml/2011/head}"
SIDES = ("leftBorder", "rightBorder", "topBorder", "bottomBorder")

# Skill-owned tools: a matching command is work on the file, not delivery.
OWN_TOOLS = (
    "md_to_hwpx.py", "validate_hwpx.py", "build_hwpx.py", "analyze_template.py",
    "batch_convert.py", "text_extract.py", "fix_borders.py",
    "sanitize_template.py", "ensure_hwpx.sh",
)

_PATH_RE = re.compile(r"""[^\s"'`<>|]+\.hwpx""")

# Matches hwpx_zip.NEUTRAL_PNG. Do not modify sys.path: the harness cwd is
# unknown, and a swallowed import failure would silently disable checks
# rather than provide meaningful fail-open behavior.
NEUTRAL_PNG_LEN = 67


def candidate_paths(tool_input: dict) -> list[str]:
    blob = " ".join(str(v) for v in tool_input.values() if isinstance(v, (str, int)))
    seen, out = set(), []
    for m in _PATH_RE.finditer(blob):
        p = m.group(0)
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _bordered_charpr(header_xml: bytes) -> int:
    import xml.etree.ElementTree as ET

    root = ET.fromstring(header_xml)
    bad = set()
    for bf in root.iter(f"{HH}borderFill"):
        bid = bf.get("id")
        if bid is None:
            continue
        for side in SIDES:
            el = bf.find(f"{HH}{side}")
            if el is not None and (el.get("type") or "NONE") != "NONE":
                bad.add(bid)
                break
    return sum(1 for cp in root.iter(f"{HH}charPr")
               if cp.get("borderFillIDRef") in bad)


def inspect(path: str) -> list[str]:
    """Return defects; inability to judge yields an empty passing list."""
    problems: list[str] = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if not infos:
            return []
        first = infos[0]
        if first.filename != "mimetype":
            problems.append("mimetype is not the first ZIP entry")
        elif first.compress_type != zipfile.ZIP_STORED:
            problems.append("mimetype should use ZIP_STORED")
        elif z.read("mimetype").decode("ascii", "replace").strip() != MIMETYPE:
            problems.append("Invalid mimetype")
        names = set(z.namelist())
        for req in REQUIRED:
            if req not in names:
                problems.append(f"Missing required file: {req}")
        if "Preview/PrvImage.png" in names:
            n = len(z.read("Preview/PrvImage.png"))
            if n > NEUTRAL_PNG_LEN:
                problems.append(
                    f"Preview/PrvImage.png still carries the reference thumbnail "
                    f"({n} bytes) — run scripts/sanitize_template.py --fix")
        if "Contents/header.xml" in names:
            n = _bordered_charpr(z.read("Contents/header.xml"))
            if n:
                problems.append(
                    f"{n} charPr point at a bordered borderFill — every character "
                    f"would be boxed; run scripts/fix_borders.py --fix")
    return problems


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        tool_input = payload.get("tool_input") or {}
        if not isinstance(tool_input, dict):
            return
        command = str(tool_input.get("command", ""))
        if any(tool in command for tool in OWN_TOOLS):
            return  # Work by this skill, not delivery.

        blocking: list[str] = []
        for path in candidate_paths(tool_input):
            if not os.path.isfile(path):
                continue
            try:
                found = inspect(path)
            except Exception:  # noqa: BLE001 — Pass when unable to judge
                continue
            for f in found:
                blocking.append(f"{path}: {f}")

        if blocking:
            print(json.dumps({
                "decision": "block",
                "reason": (
                    "Repair this .hwpx before handing it to the user:\n- "
                    + "\n- ".join(blocking)
                    + "\nValidate: python3 scripts/validate_hwpx.py <file> --semantic"
                ),
            }, ensure_ascii=False))
    except json.JSONDecodeError:
        return
    except Exception as exc:  # noqa: BLE001 — fail-open
        print(f"hwpx_guard error: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
