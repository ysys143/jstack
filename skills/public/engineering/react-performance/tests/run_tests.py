#!/usr/bin/env python3
"""react regression suite.

Usage: python3 tests/run_tests.py   (from skills/react)

All 78 rules preserve **upstream source** (Vercel; see `NOTICE`). This suite
therefore locks import integrity and routing-to-files parity rather than local prose.

  (1) Import integrity: all 78 `UPSTREAM.sha256` rows match bytes
  (2) Population: every skill file is in the manifest or declared local
  (3) Section parity: `_sections.md` prefixes equal `rules/` prefixes both ways
  (4) Next.js coupling parity: the ten names in `SKILL.md` and `NOTICE` equal
      the rules that actually mention Next.js
  (5) Rule shape: every rule has title, impact, tags, and incorrect/correct examples

Rules do not use per-file floors. Byte hashes provide stronger integrity because
line counts can be padded, while axis (2) checks the population directly.
"""
import hashlib
import io
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_ref_contracts,  # noqa: E402
                        check_no_constant_assertions, check_contract_coverage,
                        check_body_deletion, check_total, check_body_paths,
                        split_frontmatter, read_ref)

RULES = os.path.join(ROOT, "rules")

#: Next.js-coupled rules named by `SKILL.md` and `NOTICE`. All three sets must agree.
NEXT_COUPLED = {
    "server-hoist-static-io", "server-after-nonblocking", "server-cache-react",
    "server-auth-actions", "bundle-dynamic-imports", "bundle-analyzable-paths",
    "bundle-barrel-imports", "bundle-defer-third-party",
    "rendering-script-defer-async", "rendering-hydration-suppress-warning",
}

#: Locally authored files allowed outside the upstream manifest. Every item needs a reason.
OURS = {
    "SKILL.md": "locally authored decision layer",
    "NOTICE": "locally authored provenance record",
    "UPSTREAM.sha256": "the manifest itself",
    "rules/_sections.md": "local merge of two upstream section lists into a twelve-section table",
}

IMPACTS = {"CRITICAL", "HIGH", "MEDIUM-HIGH", "MEDIUM", "LOW-MEDIUM", "LOW"}

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    return io.open(p, encoding="utf-8", errors="replace").read()


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def manifest_rows():
    out = []
    for ln in read(os.path.join(ROOT, "UPSTREAM.sha256")).splitlines():
        if ln.startswith("#") or not ln.strip():
            continue
        parts = ln.split(None, 1)
        if len(parts) == 2:
            out.append((parts[0], parts[1].strip()))
    return out


def rule_files():
    return sorted(f for f in os.listdir(RULES)
                  if f.endswith(".md") and not f.startswith("_"))


def main():
    # ---- (1) Import integrity --------------------------------------------------
    rows = manifest_rows()
    check("import: manifest contains every rule", len(rows) == len(rule_files()),
          f"manifest {len(rows)} / rules {len(rule_files())}")
    missing = [r for _, r in rows if not os.path.isfile(os.path.join(ROOT, r))]
    check("import: every manifest file exists", not missing, f"{missing[:3]}")
    drift = [r for h, r in rows
             if os.path.isfile(os.path.join(ROOT, r)) and sha(os.path.join(ROOT, r)) != h]
    check("import: manifest hashes match files", not drift,
          f"drift {len(drift)} entries {drift[:3]}")

    # ---- (2) Population -------------------------------------------------------
    listed = {r for _, r in rows} | set(OURS)
    extra = []
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in ("__pycache__", "tests", "references")]
        for f in sorted(fn):
            rel = os.path.relpath(os.path.join(dp, f), ROOT).replace(os.sep, "/")
            if rel not in listed:
                extra.append(rel)
    check("import: no files exist outside the manifest population", not extra, f"unlisted {extra[:5]}")
    for k, why in sorted(OURS.items()):
        check(f"import: exception {k} exists and has a reason",
              os.path.isfile(os.path.join(ROOT, k)) and bool(why.strip()))

    # ---- (3) Section list equals files both ways --------------------------------------
    sec = read(os.path.join(RULES, "_sections.md"))
    declared = set(re.findall(r"\|\s*`([a-z0-9]+)-`\s*\|", sec))
    actual = {f.split("-")[0] for f in rule_files()}
    check("sections: table prefixes equal rule prefixes both ways", declared == actual,
          f"table only {sorted(declared - actual)} / files only {sorted(actual - declared)}")
    check("sections: table contains twelve sections", len(declared) == 12, f"{len(declared)} sections")
    # Compare the SKILL.md routing table too. Adversarial validation removed its
    # `js-` row without detection because only `_sections.md` was checked, even
    # though the model routes from SKILL.md.
    _skill_text = read(os.path.join(ROOT, "SKILL.md"))
    body_prefixes = set(
        re.findall(r"(?m)^\|\s*`([a-z0-9]+)-`\s*\|", _skill_text))
    check("sections: SKILL.md routing prefixes equal files both ways",
          body_prefixes == actual,
          f"table only {sorted(body_prefixes - actual)} / "
          f"files only {sorted(actual - body_prefixes)}")
    check("sections: SKILL.md and _sections.md tables have the same set",
          body_prefixes == declared,
          f"SKILL.md only {sorted(body_prefixes - declared)} / "
          f"_sections only {sorted(declared - body_prefixes)}")

    # ---- (4) Next.js coupling list equals files and docs -------------------------------
    NEXT_RE = re.compile(r"next\.js|nextjs|next/", re.I)
    found = {f[:-3] for f in rule_files() if NEXT_RE.search(read(os.path.join(RULES, f)))}
    check("coupling: Next.js list equals files", found == NEXT_COUPLED,
          f"files only {sorted(found - NEXT_COUPLED)} / list only {sorted(NEXT_COUPLED - found)}")
    body_all = read(os.path.join(ROOT, "SKILL.md"))
    notice = read_ref(os.path.join(ROOT, "NOTICE")) or ""
    for where, text in (("SKILL.md", body_all), ("NOTICE", notice)):
        absent = sorted(n for n in NEXT_COUPLED if n not in text)
        check(f"coupling: {where} names all ten Next.js rules", not absent,
              f"missing {absent[:3]}")

    # ---- (5) Rule shape ---------------------------------------------------
    no_fm, bad_impact, no_pair, no_code = [], [], [], []
    for f in rule_files():
        t = read(os.path.join(RULES, f))
        fm, _ = split_frontmatter(t)
        if not re.search(r"(?m)^title:", fm) or not re.search(r"(?m)^tags:", fm):
            no_fm.append(f)
        m = re.search(r"(?m)^impact:\s*(\S+)", fm)
        if not m or m.group(1) not in IMPACTS:
            bad_impact.append(f)
        if not re.search(r"(?m)^```", t):
            no_code.append(f)
        if not (re.search(r"\*\*Incorrect", t) and re.search(r"\*\*Correct", t)):
            no_pair.append(f[:-3])
    check("shape: every rule has title and tags frontmatter", not no_fm, f"{no_fm[:3]}")
    check("shape: every impact is within declared grades", not bad_impact,
          f"{bad_impact[:3]}")
    # Incorrect/correct pairs carry the collection's value. Six legitimate rules
    # use Example or Usage without a counterexample; bind their names rather than
    # a count, which would allow one rule to lose a pair as another gained one.
    check("shape: pairless rules equal the six declared names", set(no_pair) == PAIRLESS,
          f"files only {sorted(set(no_pair) - PAIRLESS)} / "
          f"declaration only {sorted(PAIRLESS - set(no_pair))}")
    check("shape: every rule has a code block", not no_code, f"{no_code[:3]}")

    # ---- Provenance contract ---------------------------------------------------------
    for frag in ("vercel-labs/agent-skills", "063bee9", "none"):
        check(f"provenance: NOTICE names '{frag}'", frag in notice)
    check("provenance: NOTICE records four local changes",
          sum(notice.count(f"**{n}.") for n in range(1, 5)) == 4)
    check("provenance: SKILL.md includes the upstream link",
          "https://github.com/vercel-labs/agent-skills" in body_all)

    # ---- Standard axes -----------------------------------------------------------
    fm, body = split_frontmatter(body_all)
    check_body_paths(check, ROOT, body, fm_of_skill=fm)
    check_skill_body(check, ROOT, needles=[
        "The 78 rules are not ours.",
        "**`js-` needs no React.**",
        "out of scope elsewhere — not wrong",
        "Impact grades are claims, and claims get checked",
        "**Measure before and after when the rule claims a number.**",
        # Bind the sentence that prevents repeating upstream `2-10x` without measurement.
        "as a hypothesis to confirm on the actual code path",
    ], floor=SKILL_FLOOR)
    check_ref_contracts(check, ROOT, [
        ("applying.md", "application and measurement contract survives",
         ["Measure numerical claims",
          "Do not reduce findings by deleting the subject",
          "When the project does not use Next.js, its ten rules are out of scope"], APPLYING_FLOOR),
    ])
    check_no_constant_assertions(check, __file__)

    live_ran = sum(1 for r in results
                   if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:")))
    # `rules/` is outside per-file floors. Hashes cover integrity and deletion
    # regression over 78 files would multiply each run by 78.
    check_contract_coverage(check, __file__, ROOT, per_file=PER_FILE,
                            completeness=False, live_ran=live_ran)
    check_body_deletion(check, __file__, ROOT, minimum=BODY_MIN, live_ran=live_ran)
    check_total(check, results, TOTAL)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


# Measured value; `scripts/check_floor_parity.py` requires declared == measured.
# Re-pinned after adding one needle (2795 -> 2786). `content_bytes` excludes the
# needles themselves, preventing a needle-only shell from satisfying the floor.
SKILL_FLOOR = 2786
APPLYING_FLOOR = 1981
BODY_MIN = 18
TOTAL = 50
#: Valid upstream rules with Example or Usage but no counterexample, bound by name.
PAIRLESS = {
    "bundle-conditional", "bundle-preload", "rendering-activity",
    "rendering-content-visibility", "rendering-resource-hints", "server-cache-lru",
}
PER_FILE = {"SKILL.md": 18, "NOTICE": 6, "UPSTREAM.sha256": 2,
            "rules/_sections.md": 4, "references/applying.md": 4}

if __name__ == "__main__":
    sys.exit(main())
