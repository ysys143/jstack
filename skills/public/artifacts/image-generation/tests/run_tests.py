#!/usr/bin/env python3
"""Image regression suite.

Run python3 tests/run_tests.py from skills/image.

Protect correct path selection and agreement between cli.md and implementation.
The upstream README used --prompt instead of positional input and was replaced
by cli.md. A new discrepancy would give users incorrect commands, so comparison
between documentation and code is central to this suite.
"""
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
# Shared skill helpers prevent frontmatter shadowing as a defect class.
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_no_constant_assertions, check_script_contracts, check_total, check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage)  # noqa: E402
ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
NANO = os.path.join(SCRIPTS, "nanobanana.py")
PROBE = os.path.join(SCRIPTS, "probe_backends.sh")
CLI_MD = os.path.join(ROOT, "references", "cli.md")
PROMPTS_MD = os.path.join(ROOT, "references", "prompts.md")

# Canonical prompt-slot order from measured, confirmed file-ledger entries:
# 11 slots plus one Hero-only slot. Upstream slopslap is absent from this tree,
# so both document and suite use this list; document-only edits fail here.
CANON_SLOTS = [
    "Use case", "Asset type", "Output target", "Primary request",
    "Scene/backdrop", "Subject", "Style/medium", "Composition/framing",
    "Text (verbatim, large labels only)", "Constraints", "Avoid",
    "Color palette",                      # 12: Hero assets only
]
# Deck owns cause-tag values. This list detects duplication here; it does not
# define the values. Include both candidates while four-to-two merging awaits C-43.
TAG_LITERALS = ["`median`", "`underspec`", "`no-constraint`", "`no-verify`", "`input`"]

# Lock row/value correspondence including column positions. Names and order
# alone accepted reversing all 24 cells in columns 3/4: bytes and needles
# survived. Legitimate wording changes must update these literals visibly in review.
CANON_ROWS = [('1',
  '`Use case`',
  'Placement: proposal cover, presentation background, document illustration',
  'A purposeless image is cropped when placed in the intended location'),
 ('2',
  '`Asset type`',
  'Asset kind: hero / icon / illustration / background / thumbnail',
  'The spacing convention specific to that asset kind is not enforced'),
 ('3',
  '`Output target`',
  'Final dimensions and medium: 16:9 slide / A4 print / square thumbnail',
  'The model chooses its default aspect ratio; cropping cuts off the subject'),
 ('4',
  '`Primary request`',
  'A one-sentence request. Only this slot is required',
  'The other ten slots have no request to qualify'),
 ('5',
  '`Scene/backdrop`',
  'Background, setting, and environment',
  'Gray gradients or purple-blue backgrounds become defaults'),
 ('6',
  '`Subject`',
  'Main subject and its state',
  'Only the background appears, or multiple subjects compete'),
 ('7',
  '`Style/medium`',
  'Visual style and medium: flat vector / photograph / line art / watercolor',
  "Default glossy 3D rendering clashes with the document's tone"),
 ('8',
  '`Composition/framing`',
  'Composition, viewpoint, and space: centered / left third / top clearance',
  'The subject fills the center, leaving no room for the title'),
 ('9',
  '`Text (verbatim, large labels only)`',
  '**Exact lettering** to include; large labels only',
  'The model invents unreadable pseudo-characters'),
 ('10',
  '`Constraints`',
  'Requirements: monochrome readability / minimum text size / safe margins',
  'Violations cannot be identified as failures without stated constraints'),
 ('11',
  '`Avoid`',
  'Exclusions: logos, human faces, specific colors',
  "Shapes resembling the procuring institution's logo can appear"),
 ('12',
  '`Color palette`',
  '**Hero only.** Specify exact color values',
  'Cover colors vary between runs, breaking consistency across the materials')]
SLOT_HEADER = ['#', 'Slot', 'What to specify', 'What happens if omitted']

# Cause-tag join table: swapping columns preserves byte volume and can evade
# volume/hash/line-survival axes. Lock literal values with their column positions.
JOIN_HEADER = ['This document', 'Joined category']
JOIN_ROWS = [('A slot among 1-11 (12) was empty',
  'Missing prompt information; fix it by **filling that slot**'),
 ('All slots were filled, but the result was not inspected',
  'Generation without verification; fix it by **rendering and visually inspecting**')]

# Path-argument table: swapping path columns preserves bytes but creates
# the executable false instruction to pass -a to codex.
PATHARG_HEADER = ['Slot', 'codex path', 'nanobanana path']
PATHARG_ROWS = [('Slot 3 `Output target`: aspect ratio',
  'State it in prose; control is weaker',
  'Pass `-a/--aspect-ratio`'),
 ('Slot 3 `Output target`: size', 'State it in prose', 'Pass `-s/--size`'),
 ('All remaining slots', 'Join into one paragraph', 'Join into one positional argument')]

# SKILL.md ownership table. Swapped owners remain plausible prose, and the
# always-on description still routes requests. Lock owners literally and
# verify that their skills exist.
BOUNDARY_HEADER = ['Target', 'Owner', 'What image must not do']
BOUNDARY_ROWS = [('Structured diagrams: architecture, flows, and relationships',
  '`diagram`',
  'Rasterize editable lines and labels'),
 ('Slide typesetting and layout', '`deck`', 'Bake body text into an image'),
 ('Raster image generation and editing', '`image`', '—')]

# CLI argument table: shifted or swapped columns can mark positional input
# as an option while passing, recreating the upstream README discrepancy.
CLIARG_HEADER = ['Argument', 'Form', 'Value', 'Description']

# The codex binary is under nvm. Omitting it from fixed-PATH tests previously
# caused an incorrect codex-unavailable verdict.
NVM_BIN = os.path.expanduser("~/.nvm/versions/node/v20.20.1/bin")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def skills_dir_of(skill_root):
    """Return the flat skills directory for sibling lookup."""
    return os.path.dirname(skill_root)


def flat(text):
    """Flatten whitespace so whole-sentence needles survive wrapping.

    Shortening needles to avoid wrapping failures would let reversals escape.
    """
    return re.sub(r"\s+", " ", text)


def parse_md_table(text, header):
    """Return data rows from a table with an exactly matching ordered header.

    Swapped columns return None and fail at the caller. Volume and needles
    cannot detect swaps preserving bytes and cell text; read positions when
    column position is part of the contract.
    """
    cells = lambda ln: [c.strip() for c in ln.strip().strip("|").split("|")]
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if not ln.lstrip().startswith("|"):
            continue
        if cells(ln) != header:
            continue
        if i + 1 >= len(lines) or not re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            continue
        rows = []
        for b in lines[i + 2:]:
            if not b.lstrip().startswith("|"):
                break
            rows.append(cells(b))
        return rows
    return None


def row_diff(rows, canon):
    """Collect row/column positions where values differ from the canonical rows."""
    if rows is None:
        return ["Table absent (header mismatch)"]
    if len(rows) != len(canon):
        return [f"row count {len(rows)} != {len(canon)}"]
    bad = []
    for i, (got, want) in enumerate(zip(rows, canon)):
        if len(got) != len(want):
            bad.append(f"r{i + 1}: column count {len(got)} != {len(want)}")
            continue
        for j, (g, w) in enumerate(zip(got, want)):
            if g != w:
                bad.append(f"r{i + 1}c{j + 1}")
    return bad


def run_probe(path, home, key=None):
    env = {"PATH": path, "HOME": home}
    if key:
        env["GEMINI_API_KEY"] = key
    r = subprocess.run(["bash", PROBE], capture_output=True, text=True, env=env)
    return r.returncode, r.stdout


def main():
    # (1) Compare cli.md with actual arguments: the upstream README defect.
    src = read(NANO)
    cli = read(CLI_MD)

    args = re.findall(r'add_argument\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?', src)
    declared = []
    for a, b in args:
        declared.append(b or a)          # Prefer the long name if present.
        if b:
            declared.append(a)           # Include the short name too.
    real = sorted(set(declared))
    missing = [a for a in real if a not in cli]
    check("cli.md includes every actual argument", not missing,
          f"missing {missing}" if missing else f"{len(real)} arguments")

    # Do not mislabel positional input as an option (the actual upstream defect).
    check("cli.md: text is marked positional",
          "Positional" in cli and "Not `--prompt`" in cli)
    check("cli.md: --prompt is not shown as usage",
          not re.search(r"nanobanana\.py\s+--prompt", cli))

    # Reverse check for invented arguments, excluding the opening quotation of
    # upstream mistakes. That quotation explains why this document replaced
    # the README; deleting it would erase provenance.
    body = cli.split("## Arguments", 1)[-1]
    # Negated mentions such as Not --prompt are not usage instructions.
    body = re.sub(r"Not\s+[`*]{0,2}--[a-z-]+[`*]{0,2}", "", body)
    # Do not require backticks: unquoted ghost arguments in cells otherwise escape
    # the population. The red suite also used backticks and passed 9/9 while
    # sharing the same syntactic blind spot. Match every argument-shaped token.
    doc_opts = set(re.findall(r"(?<![\w-])(--[a-z][a-z-]*)(?![\w-])", body))
    ghost = [o for o in doc_opts if o not in src]
    check("cli.md does not invent arguments absent from the implementation", not ghost,
          f"ghost {ghost}" if ghost else "")

    # Do not duplicate the model name; two declarations drift.
    m = re.search(r'MODEL\s*=\s*"([^"]+)"', src)
    check("cli.md does not duplicate the model name",
          bool(m) and m.group(1) not in cli, m.group(1) if m else "MODEL absent")

    # Lock the meaning of -g. Name-only presence accepts reversed instructions,
    # causing generation attempts in analysis mode and empty responses.
    # Check the sentence, implementation, and examples.
    flat_cli = flat(cli)
    G_NEEDLES = [
        "| `-g`, `--generate` | Flag | — | **Enable image generation** |",
        "**Omitting `-g` does not generate an image.**",
        "Without this flag, the script queries or analyzes an input image.",
    ]
    miss_g = [n for n in G_NEEDLES if n not in flat_cli]
    check("cli.md: the meaning of -g is not reversed", not miss_g, f"missing {miss_g}")
    # Implementation evidence: -g is store_true and adds IMAGE to response
    # modalities only when enabled, supporting the no-flag/no-generation rule.
    g_decl = re.search(
        r'add_argument\(\s*"-g"\s*,\s*"--generate"\s*,\s*action="store_true"', src)
    check("cli.md: actual -g declaration is store_true",
          g_decl is not None, "" if g_decl else "Declaration not found")
    gen_gate = re.search(
        r'if generate:\s*\n\s*gen_config[^\n]*responseModalities[^\n]*"IMAGE"', src)
    check("cli.md: generation modality is enabled only under generate",
          gen_gate is not None, "" if gen_gate else "generate branch not found")
    # Example labels must agree with flags. Changing only a label creates a
    # contradiction missed by needles that ignore labels.
    ex_pairs = re.findall(r"(?m)^# (Generate|Edit|Analyze)[^\n]*\n(python3 nanobanana\.py[^\n]*)", cli)
    ex_bad = [lab for lab, cmd in ex_pairs
              if (" -g" in cmd) != (lab in ("Generate", "Edit"))]
    check("cli.md: example labels agree with -g presence",
          len(ex_pairs) >= 3 and not ex_bad,
          f"{len(ex_pairs)} pairs; mismatches {ex_bad}")

    # Argument column positions matter: moving positional input into the option
    # column recreates the discrepancy that led to replacing the upstream README.
    cli_rows = parse_md_table(cli, CLIARG_HEADER)
    check("cli.md: argument headers use canonical column order", cli_rows is not None,
          "" if cli_rows is not None else f"Header {CLIARG_HEADER} not found")
    # Compare actual name-to-store_true/choices declarations with columns 2/3.
    real_flags, real_choices = {}, {}
    for decl in re.findall(r"add_argument\((.*?)\)\s*\n", src):
        nm = re.findall(r'"(-{0,2}[a-z][a-z-]*)"', decl)
        if not nm:
            continue
        key = nm[-1]
        real_flags[key] = "store_true" in decl
        ch = re.search(r"choices=\[([^\]]*)\]", decl)
        real_choices[key] = re.findall(r'"([^"]+)"', ch.group(1)) if ch else []
    shape_bad, value_bad = [], []
    for r in (cli_rows or []):
        if len(r) != len(CLIARG_HEADER):
            shape_bad.append(f"{r[0]}({len(r)} columns)")
            continue
        keys = re.findall(r'`(-{0,2}[a-z][a-z-]*)`', r[0])
        key = keys[-1] if keys else None
        if key is None or key not in real_flags:
            shape_bad.append(f"{r[0]}(absent from implementation)")
            continue
        want_shape = ("Flag" if real_flags[key]
                      else ("Positional" if not key.startswith("-") else "Option"))
        if want_shape not in r[1]:
            shape_bad.append(f"{key}: form={r[1]!r} != {want_shape}")
        for c in real_choices[key]:
            if f"`{c}`" not in r[2]:
                value_bad.append(f"{key}:{c}")
    check("cli.md: form column (2) matches actual declarations",
          bool(cli_rows) and not shape_bad, "; ".join(shape_bad)[:90])
    check("cli.md: value column (3) includes all actual choices",
          bool(cli_rows) and not value_bad, "; ".join(value_bad)[:90])

    # (2) No automatic installation into the user environment.
    _skill_raw = read(os.path.join(ROOT, "SKILL.md"))
    skill_fm, skill = split_frontmatter(_skill_raw)  # noqa: F841 (also used below)
    check("Policy: explicitly prohibits installing on the user's behalf",
          "does not install" in skill and "does not install" in cli)

    # (3) Four availability combinations.
    for label, path, home, key, want in [
        ("both available", f"{NVM_BIN}:/usr/bin:/bin", os.path.expanduser("~"), "dummy", 0),
        ("codex only", f"{NVM_BIN}:/usr/bin:/bin", "/nonexistent", None, 1),
        ("nanobanana only", "/usr/bin:/bin", os.path.expanduser("~"), "dummy", 1),
        ("neither available", "/usr/bin:/bin", "/nonexistent", None, 2),
    ]:
        rc, out = run_probe(path, home, key)
        check(f"probe: {label} → exit {want}", rc == want, f"exit={rc}")

    # Without a key, describe an optional path rather than removing it.
    _, out = run_probe("/usr/bin:/bin", "/nonexistent")
    check("probe: no-key guidance describes availability for key holders",
          "optional for Google API key holders" in out)

    # Other organization users without keys must be able to prepare independently;
    # a key on this machine says nothing about their setup.
    for label, needle in [
        ("Key issuance URL", "aistudio.google.com/apikey"),
        ("Configuration path", ".env.nanobanana"),
        ("Environment-variable alternative", "export GEMINI_API_KEY"),
        ("Dependency installation", "requirements.txt"),
        ("Local .env override warning", ".env overrides home settings"),
        ("Commit prohibition", "Never commit keys"),
    ]:
        check(f"probe guidance: {label}", needle in out)

    # The SKILL.md setup section must cover the same requirements.
    for label, needle in [
        ("Key issuer", "aistudio.google.com/apikey"),
        ("Restricted permissions", "chmod 600"),
        ("No key sharing", "Do not share another person's key"),
        ("Replace exposed keys", "revoke and replace it immediately"),
        ("Local .env precedence warning", "overrides the home configuration"),
        ("Load-order evidence (file:line)", "nanobanana.py:16-17"),
    ]:
        check(f"SKILL.md setup: {label}", needle in skill)

    # Lock the direction of key policy as whole clauses. Preserving just the
    # revoke/replace fragment allowed reversing the preceding repository ban
    # while still passing the adversarial probe.
    KEY_NEEDLES = [
        "3. Never place keys in the repository.",
        "Ignore `.env` files.",
        "If a key was committed, removing it from history is insufficient",
        "revoke and replace it immediately",
        "Do not share another person's key",
    ]
    miss_key = [n for n in KEY_NEEDLES if n not in flat(skill)]
    check("SKILL.md: key-commit prohibition is not reversed", not miss_key,
          f"missing {miss_key}")

    # (4) Codex is the documented default because it needs no preparation.
    # Role columns establish the choice; prose must explain its rationale.
    check("SKILL.md: body explains the default-path choice",
          "Codex is the default because" in skill)
    # Parse relationships, not word presence or forbidden synonyms. A synonym
    # bypassed the former always-word ban. Read columns by header: a regex
    # requiring bold names missed plain codex3 rows and extra defaults, while
    # an inserted column shifted role/timing interpretation. Inspect every row.
    def parse_role_table(text):
        cells = lambda line: [c.strip() for c in line.strip().strip("|").split("|")]
        lines = text.splitlines()
        out = {}
        for i, line in enumerate(lines):
            if not line.lstrip().startswith("|"):
                continue
            head = cells(line)
            if not {"Role", "Requirements", "When"} <= set(head):
                continue
            if i + 1 >= len(lines) or not re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
                continue          # No separator means this is not a table.
            ix = {k: head.index(k) for k in ("Role", "Requirements", "When")}
            for body_line in lines[i + 2:]:
                if not body_line.lstrip().startswith("|"):
                    break
                c = cells(body_line)
                name = re.sub(r"[*`]", "", c[0]).strip() if c else ""
                if not name:
                    continue
                if len(c) != len(head):
                    # Do not discard malformed rows: continue would hide an extra-column row
                    # and allow a second default (demonstrated).
                    malformed.append(f"{name}({len(c)} columns/{len(head)})")
                    continue
                out[name] = {"role": c[ix["Role"]].strip("`"),
                             "needs": c[ix["Requirements"]],
                             "when": c[ix["When"]]}
        return out

    # Collect all role tables. Returning after the first permits another default
    # in a second table. Report malformed rows instead of discarding them.
    malformed = []
    rows = parse_role_table(skill)
    check("SKILL.md: path table has no malformed rows", not malformed,
          "; ".join(malformed)[:80])

    # Do not conditionally remove checks: missing bodies must fail, not shrink
    # the population (review measured 27 copy judgments versus 34 live).
    codex = rows.get("codex", {"role": "", "needs": "", "when": ""})
    nano = rows.get("nanobanana", {"role": "", "needs": "", "when": ""})
    check("SKILL.md: path table includes codex and nanobanana",
          "codex" in rows and "nanobanana" in rows,
          f"rows {sorted(rows)}")

    # Word lists and condition vocabularies each failed under synonyms in two
    # probes. Require explicit role-column declarations and read them.
    check("SKILL.md: codex role is `기본`", codex["role"] == "기본", codex["role"])
    check("SKILL.md: nanobanana role is `선택`", nano["role"] == "선택", nano["role"])
    check("SKILL.md: roles differ (both cannot be default)",
          codex["role"] != nano["role"])
    # Lock exactly one default across the full table. Comparing only the two
    # known rows misses an added third row.
    n_default = sum(1 for r in rows.values() if r["role"] == "기본")
    check("SKILL.md: exactly one `기본` role across the full table",
          n_default == 1, f"{n_default} defaults / rows {sorted(rows)}")
    check("SKILL.md: body states exactly one default",
          "exactly one row" in skill)
    check("SKILL.md: body defines role and timing columns",
          "The role and timing columns are declarations with fixed pairings" in skill)

    # Timing is declarative too. Free prose accepted a default called fallback
    # and an optional path called always first. Check role/timing pairs.
    PAIR = {"기본": lambda w: w.strip("`").startswith("상시"),
            "선택": lambda w: w.strip("`").startswith("조건:")}
    # Keep two fixed judgment names independent of row count so missing bodies
    # fail instead of disappearing from measurement.
    for name, row in (("codex", codex), ("nanobanana", nano)):
        role, when = row["role"], row["when"]
        ok = role in PAIR and PAIR[role](when)
        check(f"SKILL.md: {name} role/timing pair agrees",
              ok, f"role={role} when={when[:30]}")
    check("SKILL.md: body declares mismatched pairs a contract violation",
          "Mismatched pairs violate the contract" in skill)

    # Asymmetric prerequisites explain why codex is the default.
    check("SKILL.md: default path requires no preparation",
          "None" in codex["needs"], codex["needs"][:40])
    check("SKILL.md: optional path requires a key",
          "GEMINI_API_KEY" in nano["needs"] or "API key" in nano["needs"],
          nano["needs"][:40])
    check("SKILL.md: paths have different prerequisites", codex["needs"] != nano["needs"])
    check("SKILL.md: body explains why codex is default",
          "because it needs no additional preparation" in skill)

    # D-3: verify handoff skill existence. Missing destinations in always-on
    # descriptions cost tokens and misroute every session. The unimplemented
    # marker previously excluded names from measurement, accepting invented
    # skills and stale markers. A complete diagram skill was marked absent,
    # routing diagram requests to image (adversarial P0). Check existence first:
    # existing skills make markers stale; absent skills require an explained marker.
    skills_dir = os.path.dirname(ROOT)
    # Do not restrict the population to selected ownership verbs: none appeared
    # in the body, leaving an empty set whose negation always passed. Do not
    # require backticks either; bold or plain skill names must remain measurable.
    NAME = r"(?<![\w-])[`*]{0,2}([a-z][a-z-]{2,})[`*]{0,2}\s*skill\b"
    MARKED = NAME + r"\s*\(미구현"
    EXCUSED = NAME + r"\s*\(미구현\s*[—–-]\s*[^)]{4,}\)"

    def classify_mentions(text):
        """Classify mentioned skills into population, stale markers, and absence.

        Stale: marked unimplemented but exists. Absent: does not exist and
        has no explained unimplemented marker.
        """
        named = sorted(set(re.findall(NAME, text)))
        marked = set(re.findall(MARKED, text))
        excused = set(re.findall(EXCUSED, text))
        live = {n for n in named if os.path.isdir(os.path.join(skills_dir, n))}
        stale = sorted(marked & live)
        absent = sorted(n for n in named if n not in live and n not in excused)
        return named, stale, absent

    declared, stale_marks, missing_skills = classify_mentions(skill)
    # An empty population is not a verdict. Enforce a floor to prevent vacuous truth.
    check("Handoff destination population is nonempty", len(declared) >= 1, str(declared))
    check("All handoff destinations exist", not missing_skills,
          f"missing {missing_skills}" if missing_skills else f"{declared}")
    check("No existing skill carries a stale `(미구현)` marker",
          not stale_marks, f"Existing skills {stale_marks}" if stale_marks else "")
    check("Body mentions other skills (ownership boundaries exist)",
          bool(declared), str(declared))
    check("SKILL.md: `(미구현)` does not waive existence checks",
          "`(미구현)` does not waive existence checks" in flat(skill))

    # Detector self-tests use fixed inputs on every run. Clean documents leave
    # empty error lists whose negations also pass under tautological implementations;
    # probe what each axis actually detects.
    _fake = "The `zzz-nosuch` skill(미구현) owns this task."
    _stale = "The `diagram` skill(미구현) owns diagrams."
    _excused = "The `zzz-nosuch` skill(미구현 — plan C-99, not implemented yet) owns this task."
    check("Detector: unexplained `(미구현)` does not excuse absence",
          "zzz-nosuch" in classify_mentions(_fake)[2],
          str(classify_mentions(_fake)[2]))
    check("Detector: `(미구현)` on an existing skill is stale",
          "diagram" in classify_mentions(_stale)[1],
          str(classify_mentions(_stale)[1]))
    check("Detector: explained `(미구현 — …)` excuses absence",
          "zzz-nosuch" not in classify_mentions(_excused)[2],
          str(classify_mentions(_excused)[2]))

    # Lock ownership row/value correspondence. Swapping diagram and deck remains
    # plausible prose and preserves bytes; an adversarial handoff negation was missed.
    bound_rows = parse_md_table(skill, BOUNDARY_HEADER)
    check("SKILL.md: ownership headers use canonical column order", bound_rows is not None,
          "" if bound_rows is not None else f"Header {BOUNDARY_HEADER} not found")
    bdiff = row_diff(bound_rows, BOUNDARY_ROWS)
    check("SKILL.md: ownership row/owner mapping matches the canon", not bdiff, "; ".join(bdiff)[:90])
    owners = [r[1].strip("`*") for r in (bound_rows or []) if len(r) > 1]
    ghost_owners = [o for o in owners
                    if not os.path.isdir(os.path.join(skills_dir, o))]
    check("SKILL.md: every skill in the owner column exists",
          bool(owners) and not ghost_owners,
          f"missing {ghost_owners}" if ghost_owners else f"{owners}")

    check("SKILL.md: discloses codex dimensional-control limits",
          "aspect ratio" in skill and "reducing control" in skill)

    # (5) Read prompt slots from the table. Presence-only needles missed a deleted
    # slot. Upstream is absent, making this the local slot definition; an omitted
    # slot is filled by model defaults, which is the defect.
    prompts = read(PROMPTS_MD)
    flat_prompts = flat(prompts)
    # Read whole rows. Parsing only number/name accepted inversion of all 24
    # cells in columns 3/4 with 87/87 passing. Compare ordered headers and row literals.
    slot_rows = parse_md_table(prompts, SLOT_HEADER)
    check("prompts: slot headers use canonical column order", slot_rows is not None,
          "" if slot_rows is not None else f"Header {SLOT_HEADER} not found")
    rows = slot_rows or []
    nums = [int(r[0]) for r in rows if r and r[0].isdigit()]
    names = [r[1] for r in rows if len(r) > 1]
    # An empty population is not a verdict. Enforce a floor before comparisons.
    check("prompts: slot table is readable", len(rows) >= 1, f"{len(rows)} rows")
    check("prompts: 12 slot rows (11 plus one Hero-only slot)",
          len(rows) == len(CANON_ROWS), f"{len(rows)} rows")
    check("prompts: numbering is contiguous from 1 through 12",
          nums == list(range(1, len(CANON_ROWS) + 1)), str(nums))
    check("prompts: slot names and order match the canon",
          names == [r[1] for r in CANON_ROWS],
          f"differences {[a for a, b in zip(names, CANON_ROWS) if a != b[1]]}")
    # Lock columns 3/4 by position; swapping them produces 24 mismatches.
    c3 = [(r[0], r[2]) for r in rows if len(r) > 2]
    c4 = [(r[0], r[3]) for r in rows if len(r) > 3]
    bad3 = [f"r{a}" for (a, g), w in zip(c3, CANON_ROWS) if g != w[2]] or \
           ([] if len(c3) == len(CANON_ROWS) else [f"row count {len(c3)}"])
    bad4 = [f"r{a}" for (a, g), w in zip(c4, CANON_ROWS) if g != w[3]] or \
           ([] if len(c4) == len(CANON_ROWS) else [f"row count {len(c4)}"])
    check("prompts: column 3 (what to specify) matches every canonical row",
          not bad3, " ".join(bad3)[:80])
    check("prompts: column 4 (omission outcome) matches every canonical row",
          not bad4, " ".join(bad4)[:80])

    # Measure slot counts. Changing one scattered prose declaration from 11 to 10
    # left the table intact and escaped every axis. Compare every declaration
    # with the count measured from the table.
    hero_rows = [r for r in rows if len(r) > 2 and "Hero only" in r[2]]
    total_slots = len(rows)
    base_slots = total_slots - len(hero_rows)
    check("prompts: exactly one Hero-only row, with the final number",
          len(hero_rows) == 1 and hero_rows[0][0] == str(total_slots),
          f"{len(hero_rows)} rows {[r[0] for r in hero_rows]}")
    check("prompts: measured slots are 11 base and 12 Hero",
          (base_slots, total_slots) == (11, 12), f"{base_slots}/{total_slots}")

    # Declaration locations: removal shrinks the population; changed values
    # mismatch the table. Both must fail.
    SLOT_CLAIMS = [
        ("prompts H1", flat_prompts,
         r"# Image prompt slots: (\d+) slots \((\d+) for Hero only\)",
         (base_slots, total_slots)),
        ("prompts confirmed count", flat_prompts,
         r"\*\*There are (\d+) slots\.\*\*", (base_slots,)),
        ("prompts Hero addition", flat_prompts,
         r"adds `Color palette`, making (\d+)", (total_slots,)),
        ("prompts Hero-only clause", flat_prompts,
         r"\*\*Only Hero has (\d+) slots\.\*\* The other six asset kinds use (\d+)",
         (total_slots, base_slots)),
        ("prompts join-table left column", flat_prompts,
         r"A slot among (\d+)-(\d+) \((\d+)\) was empty",
         (1, base_slots, total_slots)),
        ("prompts checklist", flat_prompts,
         r"Have \*\*all (\d+) slots \((\d+) for Hero\)\*\* been written", (base_slots, total_slots)),
        ("SKILL.md Phase 1", flat(skill),
         r"Use (\d+) prompt slots \((\d+) for Hero assets\)", (base_slots, total_slots)),
    ]
    found, wrong = [], []
    for label, text, pat, want in SLOT_CLAIMS:
        m2 = re.search(pat, text)
        if m2 is None:
            continue
        found.append(label)
        if tuple(int(g) for g in m2.groups()) != want:
            wrong.append(f"{label}={m2.groups()}")
    check("prompts/SKILL: all seven slot-count declarations found",
          len(found) == len(SLOT_CLAIMS),
          f"Found {found}")
    check("prompts/SKILL: every slot-count declaration matches measured 11/12",
          not wrong, "; ".join(wrong)[:100])
    check("prompts: non-Hero assets explicitly omit Color palette",
          "omit `Color palette`" in flat_prompts)

    # The table locks order, but reversing its rationale from broad-to-specific
    # would leave the table intact and reverse guidance. Lock whole sentences.
    ORDER_NEEDLES = [
        "## Slot table: order is a contract",
        "Move from broad to specific.",
        "Reordering can make the model read later slots as modifiers of earlier slots, confusing the scene and subject.",
    ]
    miss_order = [n for n in ORDER_NEEDLES if n not in flat_prompts]
    check("prompts: slot-order contract direction is not reversed", not miss_order,
          f"missing {miss_order}")

    # Slot 9: preserve the short-accurate/long-degraded Korean lettering direction
    # to prevent embedding paragraph-length text in images.
    LEN_NEEDLES = [
        "**Use large labels only.** Paragraph-length Korean text loses stroke fidelity.",
        "Measurements found accurate short words but degradation as character count increased",
        "**Embedded lettering cannot be edited afterward.**",
    ]
    miss_len = [n for n in LEN_NEEDLES if n not in flat_prompts]
    check("prompts: Korean label-length constraint is not reversed", not miss_len,
          f"missing {miss_len}")
    SKILL_LEN_NEEDLES = [
        "with correct glyph shapes",
        "Longer text can still break; visually inspect results.",
    ]
    miss_slen = [n for n in SKILL_LEN_NEEDLES if n not in flat(skill)]
    check("SKILL.md: Korean measurement findings are not reversed", not miss_slen,
          f"missing {miss_slen}")

    # Cause-tag join table: swapping two columns preserves byte count.
    join_rows = parse_md_table(prompts, JOIN_HEADER)
    check("prompts: join headers use canonical column order", join_rows is not None,
          "" if join_rows is not None else f"Header {JOIN_HEADER} not found")
    jdiff = row_diff(join_rows, JOIN_ROWS)
    check("prompts: join row/column mapping matches the canon", not jdiff,
          "; ".join(jdiff)[:90])

    # Do not duplicate tag values: deck owns them and the four-to-two merge is
    # pending. Copies would drift when that decision lands. Lock SSOT direction
    # too: mere mention of design-slop.md accepted exchanging source and consumer.
    # Parse the owner, require deck, verify its file defines values, and require
    # this document not to duplicate them.
    m_ssot = re.search(
        r"The canonical tag-value set is the \"Cause tags\" definition table in the "
        r"`([a-z][a-z-]*)` skill's `([^`]+)`", flat_prompts)
    check("prompts: canonical tag owner is parseable from the sentence",
          m_ssot is not None, "" if m_ssot else "Canonical declaration sentence not found")
    owner = m_ssot.group(1) if m_ssot else ""
    owner_rel = m_ssot.group(2) if m_ssot else ""
    check("prompts: canonical source points to deck design-slop.md",
          (owner, owner_rel) == ("deck", "references/design-slop.md"),
          f"{owner} / {owner_rel}")
    tag_src = os.path.join(skills_dir_of(ROOT), owner, owner_rel) if owner else ""
    ssot_body = read(tag_src) if tag_src and os.path.isfile(tag_src) else ""
    check("prompts: referenced canonical file actually defines tag values",
          "## Cause tags" in ssot_body
          and sum(1 for t in TAG_LITERALS if t in ssot_body) >= 2,
          tag_src or "Path absent")
    dup = [t for t in TAG_LITERALS if t in prompts]
    check("prompts: cause-tag values are not duplicated (deck owns them)", not dup,
          f"duplicates {dup}")
    check("prompts: document declares itself noncanonical",
          "Do not duplicate those values here" in flat_prompts
          and "That value set is awaiting a decision" in flat_prompts)

    # Path-argument table: swapping columns preserves bytes but instructs
    # passing -a to codex, an executable falsehood.
    pa_rows = parse_md_table(prompts, PATHARG_HEADER)
    check("prompts: path-argument headers use canonical column order", pa_rows is not None,
          "" if pa_rows is not None else f"Header {PATHARG_HEADER} not found")
    padiff = row_diff(pa_rows, PATHARG_ROWS)
    check("prompts: path-argument row/column mapping matches the canon", not padiff,
          "; ".join(padiff)[:90])
    # Independent implementation check: codex accepts no argument tokens here;
    # the nanobanana arguments must exist in the actual script.
    codex_col = " ".join(r[1] for r in (pa_rows or []) if len(r) > 1)
    nano_col = " ".join(r[2] for r in (pa_rows or []) if len(r) > 2)
    check("prompts: codex column contains no unsupported argument tokens",
          bool(pa_rows) and not re.search(r"(?<![\w-])--[a-z]", codex_col),
          codex_col[:60])
    nano_opts = set(re.findall(r"(?<![\w-])(--[a-z][a-z-]*)(?![\w-])", nano_col))
    check("prompts: nanobanana column arguments exist in the implementation",
          bool(nano_opts) and all(o in src for o in nano_opts),
          f"{sorted(nano_opts)}")

    # Run a body-deleted copy and require measured failures; regex linting could
    # not prevent syntactic evasions. A minimum of 1 allowed ten contracts to
    # disappear. Update only for legitimate contract changes. Per-file floors
    # prevent aggregate compensation and expose zero-contribution references.
    # Zero is forbidden: declaring an unprotected reference must fail.

    # Forbid constant assertions with AST inspection. Review 7 exposed
    # ... if cond else True, visually plausible but unable to fail.
    check_ref_contracts(check, ROOT, [
        ("cli.md", "Argument table matches implementation",
         ["--aspect", "--size", "--image", "GEMINI_API_KEY"], 1502),
        ("prompts.md", "Slot structure and tag join remain substantive",
         ["Text (verbatim, large labels only)",
          "Empty slots are filled with defaults",
          "The canonical tag-value set is",
          "Only Hero has 12 slots"], 5423),
    ])

    # Needles alone accepted a shell retaining only needle-bearing lines after
    # deleting 67-85% of content (review 10). The dev-layer fix from review 12 was
    # absent from nine work-layer skills. Line survival (70%), volume, and blob
    # binding detect the reduction.
    check_skill_body(check, ROOT, needles=[
        'Text embedded in a raster image cannot be edited later',
        'The role and timing columns are declarations with fixed pairings',
        'Without a key, this path\nis unavailable',
        'Mismatched pairs violate the contract',
        'Use 11 prompt slots (12 for Hero assets)',
    ], floor=4243)

    check_no_constant_assertions(check, __file__)

    # Do not exempt reference-contract prefixes. A previous workaround excluded
    # prompts.md because the shared helper returned from its loop before line
    # survival, dropping two second-reference axes in deletion copies. The helper
    # now continues, so the exemption would skip checks and introduce slack.
    # Exclude the script-contract prefix on both sides because that helper returns
    # early in deletion copies. Although this count precedes the call, all three
    # consumers must share exclusions to preserve zero slack.
    live_ran = sum(1 for r in results
                   if not r[0].startswith(("자기검사:", "계약 커버리지:",
                                           "스크립트 계약:")))

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 40,
        "references/cli.md": 11,
        "references/prompts.md": 27,
    }, live_ran=live_ran)

    check_body_deletion(check, __file__, ROOT, minimum=75,
                        extra_strip=["references/cli.md", "references/prompts.md"],
                        live_ran=live_ran)


    # Lock the total count. Review 10 deleted a reference together with its
    # contracts, floors, and frozen copy, losing four checks without failure.

    # Measure scripts separately: document-deletion regressions cannot protect
    # script behavior because those checks survive empty documents. Review 12
    # replaced all three ensure outcomes with tautologies and passed.
    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/nanobanana.py": 6,
        "scripts/probe_backends.sh": 10,
    }, live_ran=live_ran)
    check_total(check, results, 109)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
