#!/usr/bin/env python3
"Check adapted style rules, source attribution, and retained licenses."

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STYLE = "output-styles/fluent-korean.md"
STYLE_ALT = "output-styles/fluent-korean-not-coding.md"
ATTRIB = "output-styles/ATTRIBUTION.md"
TAXONOMY = "skills/humanize/references/ai-tell-taxonomy.md"
UPSTREAM = "snflkd/fluent-korean"
SECTION_REF = re.compile(r"output-style\s+([가-힣]+|sentence-level|phrase-level)-(\d+)")
PORTED_HEAD = re.compile("(?m)^###\\s+([A-Z]-\\d+)\\..*fluent-korean\\s*(?:이식|port)")
NOTE_IDS = re.compile(r"([A-Z]-\d+)\s*\(")


def read(root, rel):
    p = os.path.join(root, rel)
    if not os.path.exists(p) and rel.startswith("output-styles/"):
        p = os.path.join(root, "hosts/claude", rel)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return f.read()


def style_sections(text):
    out = {}
    for sec in re.split("(?m)^## ", text)[1:]:
        title = sec.splitlines()[0].strip()
        n = len(re.findall("(?m)^(\\d+)\\.", sec))
        out[title] = n
        out[title.replace(" ", "")] = n
        alias = {"Sentence level": "문장단위", "Phrase level": "구단위"}.get(title)
        if alias:
            out[alias] = n
        out[title.lower().replace(" ", "-")] = n
    return out


def rule_blocks(text):
    blocks = {}
    parts = re.split("(?m)^###\\s+", text)
    for p in parts[1:]:
        m = re.match("([A-Z]-\\d+)\\.", p)
        if m:
            blocks[m.group(1)] = p
    return blocks


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(HERE)
    if not os.path.isdir(root):
        print(f"[ERROR] 디렉토리 부재: {root}", file=sys.stderr)
        return 2
    style = read(root, STYLE)
    attrib = read(root, ATTRIB)
    tax = read(root, TAXONOMY)
    problems = []
    for rel, text in ((STYLE, style), (ATTRIB, attrib), (TAXONOMY, tax)):
        if text is None:
            print(f"  [FAIL] 파일 부재 — {rel}")
            problems.append(f"파일 부재: {rel}")
    if style is None or attrib is None or tax is None:
        print(f"\n불일치 {len(problems)}건")
        return 1
    ok = read(root, STYLE_ALT) is not None
    print(f"  [{('OK' if ok else 'FAIL')}] 예방 층 파일 2종 실재")
    if not ok:
        problems.append(f"파일 부재: {STYLE_ALT}")
    ported = set(PORTED_HEAD.findall(tax))
    note_line = next(
        (
            l
            for l in tax.splitlines()
            if "fluent-korean" in l
            and ("이식" in l or "ported" in l)
            and l.startswith(">")
        ),
        "",
    )
    declared = set(NOTE_IDS.findall(note_line))
    ok = bool(ported) and ported == declared
    print(
        f"  [{('OK' if ok else 'FAIL')}] 이식 규칙 집합 — 선언 {sorted(declared)} / 실재 {sorted(ported)}"
    )
    if not ok:
        if not ported:
            problems.append("No adapted rules discovered")
        only_d, only_p = (declared - ported, ported - declared)
        if only_d:
            problems.append(f"선언만 있고 규칙 없음: {sorted(only_d)}")
        if only_p:
            problems.append(f"규칙만 있고 선언 없음: {sorted(only_p)}")
    blocks = rule_blocks(tax)
    for rid in sorted(ported):
        body = blocks.get(rid, "")
        ok = UPSTREAM in body
        print(f"  [{('OK' if ok else 'FAIL')}] 출처 표기 {rid}")
        if not ok:
            problems.append(f"{rid}: '{UPSTREAM}' 출처 표기 없음")
    secs = style_sections(style)
    refs = set(SECTION_REF.findall(tax))
    for name, num in sorted(refs):
        have = secs.get(name)
        ok = have is not None and int(num) <= have
        print(
            f"  [{('OK' if ok else 'FAIL')}] 절 참조 {name}-{num} — {('항 ' + str(have) + '개' if have is not None else '절 없음')}"
        )
        if not ok:
            problems.append(f"절 참조 {name}-{num} 이 output-style 에 없다")
    for m in re.finditer("`(skills/[^`]+\\.md)`", attrib):
        rel = m.group(1)
        ok = os.path.exists(os.path.join(root, rel))
        print(f"  [{('OK' if ok else 'FAIL')}] ATTRIBUTION 경로 — {rel}")
        if not ok:
            problems.append(f"ATTRIBUTION 이 없는 경로를 가리킨다: {rel}")
    ok = "MIT License" in attrib and "WITHOUT WARRANTY" in attrib
    print(f"  [{('OK' if ok else 'FAIL')}] MIT 라이선스 전문 보존")
    if not ok:
        problems.append("ATTRIBUTION 에 MIT 전문이 없다")
    if problems:
        print(f"\n불일치 {len(problems)}건")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"\n정합 — 이식 규칙 {len(ported)}건, 절 참조 {len(refs)}건 전부 유효")
    return 0


if __name__ == "__main__":
    sys.exit(main())
