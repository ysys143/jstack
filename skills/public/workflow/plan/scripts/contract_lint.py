#!/usr/bin/env python3
"""Lint legacy contract v1 and executable task contract v2.

    python3 scripts/contract_lint.py .jstack/plan/<slug>/contract.yaml [...]
    python3 scripts/contract_lint.py --surface FILE --package-root DIR <file>

## Why this runs before verify

`verify` compares the contract with observed work. That comparison is meaningful
only if the contract follows its schema. Missing required fields, misspelled
grades, or unresolved conditional tables produce output resembling a verdict
without establishing one. Therefore verify runs this linter first and does not
begin comparison after a nonzero result.

## Three exit codes

| rc | Meaning |
|---|---|
| 0 | Schema valid; zero package-external path references |
| 1 | Violations: required fields, valid grades, unbaked conditional tables, or package-external paths |
| 2 | Checking could not start: missing file, YAML parse failure, missing PyYAML, or non-mapping root |

Never collapse 2 into 0. Inability to execute and successful checking are
different facts. Sharing an exit code makes a broken environment appear green,
as plugin-generator once did by returning 0 for missing paths (plan §10.9 F-7).

## What is checked

1. Common shape: `계약버전`, `발동`, `산출`, `검증`, and `선행`. Version 2 adds
   task IDs, preparation probes, delegation, and per-requirement user behavior,
   related files, and executable commands, connecting plan to verify.
2. Grade-specific required fields: `기계` requires `명령:` and `RED:`;
   `인간` requires `승인기록:`. Requiring a command for every grade lets an
   unverifiable claim pass with a fabricated command (plan §4.13.5 rule 3).
3. Unbaked conditional tables: table syntax (lines beginning with `|`) remaining
   in a value is a violation. When plan selects a backend, it must select one
   row and resolve it to one value; verify receives one executable command
   (plan §4.13.6).
4. Package-external paths: report a numeric count and return nonzero when the
   count is nonzero. The judge is author/references/package-surface.yaml, which
   already defines package membership; do not duplicate that definition here.

## Identifying path-like values (check 4)

Inspect all string scalars but compare only path-like values with the surface:
values starting with `${CLAUDE_PLUGIN_ROOT}/`, `/`, or a package top-level
name (`skills/`, `commands/`, `agents/`, `hooks/`, `scripts/`, `references/`),
and values containing `../`.

Task output such as `산출: 경로: src/api/login.py` matches none of those four
conditions and is outside this comparison. ../../other-plugin/skills/x/SKILL.md
contains ../ and is checked; matching no surface category makes it a violation.

When the surface declaration is missing, use the explicit fallback judge and
report that fact on stderr. A silent fallback changes the numbers without
revealing that the judge changed.
"""
import argparse
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(HERE)
SKILLS_ROOT = os.path.dirname(SKILL_ROOT)
PACKAGE_ROOT = os.path.dirname(SKILLS_ROOT)
DEFAULT_SURFACE = os.path.join(
    SKILLS_ROOT, "author", "references", "package-surface.yaml"
)
SECURITY_CONTRACT = os.path.join(
    SKILLS_ROOT, "verify", "scripts", "security_contract.py"
)

SCHEMA_VERSION = 2
SCHEMA_VERSIONS = (1, 2)
VALID_TRIGGERS = ("모델", "사용자")
VALID_GRADES = ("기계", "인간", "불가", "미상")
VALID_KINDS = ("정적", "동적")

# Package top-level directories. Values beginning with these names are treated as package paths.
PACKAGE_PREFIXES = (
    "skills/",
    "commands/",
    "agents/",
    "hooks/",
    "scripts/",
    "references/",
)

# Fallback used only when the surface declaration is unavailable. This is a coarse
# approximation, not a copy of the surface, because duplicate authorities drift.
FALLBACK_SURFACE_PATTERNS = (
    "skills/*/SKILL.md",
    "skills/*/references/**",
    "skills/*/scripts/**",
    "skills/*/tests/**",
    "skills/*/langs/**",
    "skills/_suite_lib.py",
    "commands/*.md",
    "agents/*.md",
    "hooks/**",
    "scripts/**",
    ".claude-plugin/plugin.json",
)


def glob_to_regex(pat):
    """Minimal glob translator where only `**` crosses directory boundaries.

    `fnmatch` lets `*` cross `/`, so `skills/*/SKILL.md` would also match
    `skills/a/b/SKILL.md` and erase the surface category boundary.
    """
    out, i = ["^"], 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out.append("(?:[^/]+/)*")
            i += 3
        elif pat.startswith("**", i):
            out.append(".*")
            i += 2
        elif pat[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pat[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pat[i]))
            i += 1
    out.append("$")
    return re.compile("".join(out))


def load_surface(path):
    """Load category globs from the surface declaration as (patterns, judge).

    Fall back when it is missing or damaged, and report that fact on stderr.
    """
    if not path or not os.path.isfile(path):
        print(
            f"package-surface.yaml is missing ({path}); using the built-in fallback judge",
            file=sys.stderr,
        )
        return list(FALLBACK_SURFACE_PATTERNS), "fallback"
    try:
        import yaml

        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f.read())
        cats = (data or {}).get("categories") or {}
        pats = [p for v in cats.values() for p in (v or [])]
        if not pats:
            raise ValueError("categories is empty")
    except Exception as exc:  # noqa: BLE001
        print(
            f"could not read package-surface.yaml ({exc}); using the built-in fallback judge",
            file=sys.stderr,
        )
        return list(FALLBACK_SURFACE_PATTERNS), "fallback"
    return pats, path


def load_contract(path):
    """Read a contract file, returning an rc 2 reason when it cannot be read."""
    if not os.path.isfile(path):
        return None, f"contract file does not exist: {path}"
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        return None, f"contract file is empty: {path}"
    try:
        import yaml
    except ImportError:
        return None, "PyYAML is unavailable; the check cannot run"
    try:
        data = yaml.safe_load(text)
    except Exception as exc:  # noqa: BLE001
        return None, f"could not parse YAML: {exc}"
    if not isinstance(data, dict):
        return None, f"contract root is not a mapping: {path}"
    return (data, text), None


def walk_scalars(node, path="$"):
    """Yield every (path, string value) pair so violations retain their location."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_scalars(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_scalars(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def looks_like_path(value):
    v = value.strip()
    if not v:
        return False
    if v.startswith("${CLAUDE_PLUGIN_ROOT}/"):
        return True
    if v.startswith("/"):
        return True
    if "../" in v:
        return True
    return v.startswith(PACKAGE_PREFIXES)


def normalise_path(value):
    v = value.strip()
    if v.startswith("${CLAUDE_PLUGIN_ROOT}/"):
        v = v[len("${CLAUDE_PLUGIN_ROOT}/"):]
    return v


def check_schema(data):
    """Return required-field and enum violations for supported schemas."""
    bad = []

    ver = data.get("계약버전")
    if ver is None:
        bad.append("`계약버전:` is missing; a contract without a schema version cannot be checked")
    elif ver not in SCHEMA_VERSIONS:
        bad.append(f"`계약버전:` is not supported version 1 or 2: {ver!r}")

    trigger = data.get("발동")
    if trigger is None:
        bad.append("`발동:` is missing (required)")
    elif trigger not in VALID_TRIGGERS:
        bad.append(f"`발동:` has an invalid value: {trigger!r} (모델 | 사용자)")

    for field in ("산출", "검증"):
        items = data.get(field)
        if not isinstance(items, list) or not items:
            bad.append(f"`{field}:` must be a nonempty list")

    for i, item in enumerate(data.get("산출") or []):
        if not isinstance(item, dict):
            bad.append(f"`산출[{i}]` is not a mapping")
            continue
        for req in ("경로", "형식"):
            if not str(item.get(req, "")).strip():
                bad.append(f"`산출[{i}].{req}` is missing (required)")

    for i, item in enumerate(data.get("검증") or []):
        if not isinstance(item, dict):
            bad.append(f"`검증[{i}]` is not a mapping")
            continue
        grade = item.get("등급")
        if grade is None:
            bad.append(f"`검증[{i}].등급` is missing (required)")
            continue
        if grade not in VALID_GRADES:
            bad.append(
                f"`검증[{i}].등급` has an invalid value: {grade!r} "
                "(기계 | 인간 | 불가 | 미상)"
            )
            continue
        if grade == "기계" and ver == 1:
            if not str(item.get("명령", "")).strip():
                bad.append(f"`검증[{i}].명령` is missing; required for `등급=기계`")
            if not str(item.get("RED", "")).strip():
                bad.append(
                    f"`검증[{i}].RED` is missing; required for `등급=기계`. "
                    "A check without RED evidence is not machine-grade"
                )
        elif grade == "인간" and ver == 1:
            if not str(item.get("승인기록", "")).strip():
                bad.append(f"`검증[{i}].승인기록` is missing; required for `등급=인간`")

    if ver == 2:
        task_id = data.get("작업ID")
        if not isinstance(task_id, str) or not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", task_id):
            bad.append("version 2 `작업ID` has an invalid format")
        if data.get("위임") not in ("필요", "불필요"):
            bad.append("version 2 `위임` must be `필요` or `불필요`")
        prep = data.get("준비")
        if not isinstance(prep, list) or not prep:
            bad.append("version 2 `준비` is empty")
        else:
            for i, item in enumerate(prep):
                if not isinstance(item, dict):
                    bad.append(f"준비[{i}] is not a mapping")
                    continue
                for field in ("도구", "확인명령"):
                    if not isinstance(item.get(field), str) or not item[field].strip():
                        bad.append(f"준비[{i}].{field} is empty")

        seen = set()
        review_kinds = {"사실", "평가독립성", "SSOT", "이식성", "cold-read"}
        for i, item in enumerate(data.get("검증") or []):
            if not isinstance(item, dict):
                continue
            rid = item.get("요구ID")
            if not isinstance(rid, str) or not re.fullmatch(
                    r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", rid):
                bad.append(f"검증[{i}].요구ID has an invalid format")
            elif rid in seen:
                bad.append(f"검증[{i}].요구ID is duplicated: {rid}")
            else:
                seen.add(rid)
            if not isinstance(item.get("사용자행동"), str) or not item["사용자행동"].strip():
                bad.append(f"검증[{i}].사용자행동 is empty")
            files = item.get("관련파일")
            if not isinstance(files, list) or not files or not all(
                    isinstance(x, str) and x.strip() and not os.path.isabs(x)
                    and ".." not in x.split("/")
                    and not x.startswith((".git/", ".jstack/tasks/"))
                    for x in (files or [])):
                bad.append(f"검증[{i}].관련파일 must be a list of relative paths within the repository")
            for field in ("명령", "반증"):
                command = item.get(field)
                if not isinstance(command, dict):
                    bad.append(f"검증[{i}].{field} is not a mapping")
                    continue
                if not isinstance(command.get("실행"), str) or not command["실행"].strip():
                    bad.append(f"검증[{i}].{field}.실행 is empty")
                if (not isinstance(command.get("기대종료"), int)
                        or isinstance(command.get("기대종료"), bool)):
                    bad.append(f"검증[{i}].{field}.기대종료 is not an integer")
            red = item.get("반증")
            if isinstance(red, dict) and "{RED_ROOT}" not in str(red.get("실행", "")):
                bad.append(
                    f"검증[{i}].반증.실행 must use the temporary-copy placeholder {{RED_ROOT}}"
                )
            if item.get("인간검토") not in ("필요", "불필요"):
                bad.append(f"검증[{i}].인간검토 must be `필요` or `불필요`")
            reviews = item.get("추가검토", [])
            if not isinstance(reviews, list):
                bad.append(f"검증[{i}].추가검토 is not a list")
                continue
            kinds = set()
            for j, review in enumerate(reviews):
                if not isinstance(review, dict):
                    bad.append(f"검증[{i}].추가검토[{j}] is not a mapping")
                    continue
                kind, applies = review.get("종류"), review.get("적용")
                if kind not in review_kinds:
                    bad.append(f"검증[{i}].추가검토[{j}].`종류` is invalid")
                elif kind in kinds:
                    bad.append(f"검증[{i}].추가검토 kind is duplicated: {kind}")
                kinds.add(kind)
                if applies not in ("필요", "생략"):
                    bad.append(f"검증[{i}].추가검토[{j}].`적용` is invalid")
                if applies == "생략" and not str(review.get("생략사유", "")).strip():
                    bad.append(f"검증[{i}].추가검토[{j}] is missing `생략사유`")

    for i, item in enumerate(data.get("선행") or []):
        if not isinstance(item, dict):
            bad.append(f"`선행[{i}]` is not a mapping")
            continue
        if not str(item.get("조건", "")).strip():
            bad.append(f"`선행[{i}].조건` is missing (required)")
        kind = item.get("유형")
        if kind is None:
            bad.append(f"`선행[{i}].유형` is missing (required)")
        elif kind not in VALID_KINDS:
            bad.append(f"`선행[{i}].유형` has an invalid value: {kind!r} (정적 | 동적)")
        elif kind == "동적" and not str(item.get("확인", "")).strip():
            bad.append(
                f"`선행[{i}].확인` is missing; `유형=동적` must not trust state "
                "recorded when the contract was written"
            )

    followups = data.get("후행")
    if followups is not None:
        if not isinstance(followups, list):
            bad.append("`후행:` is not a list")
        else:
            for i, s in enumerate(followups):
                if not isinstance(s, str) or not s.strip():
                    bad.append(f"`후행[{i}]` is not a skill-name string: {s!r}")
    if data.get("보안검증") is not None:
        spec = importlib.util.spec_from_file_location(
            "jstack_security_contract_lint", SECURITY_CONTRACT)
        if spec is None or spec.loader is None:
            bad.append("could not load security_contract.py")
        else:
            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
                bad.extend(module.lint_link(data))
            except (OSError, ImportError) as exc:
                bad.append(f"could not load security_contract.py: {exc}")
    return bad


def check_unbaked_tables(data, text):
    """Detect unbaked conditional tables (§4.13.6) in parsed values and source text.

    Parsed values miss tables inside block scalars (`명령: |`) because YAML consumes
    `|` as a directive. Inspect source lines beginning with `|` as well; in YAML
    containing only mappings and lists, those lines can occur only inside values.
    """
    bad = []
    for where, value in walk_scalars(data):
        for line in value.splitlines():
            if line.strip().startswith("|"):
                bad.append(
                    f"{where} contains table syntax: {line.strip()[:60]!r} — "
                    "conditional tables must be resolved to one value before entering the contract"
                )
                break
    for n, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if s.startswith("|") and s.count("|") >= 2:
            bad.append(
                f"line {n} contains table syntax: {s[:60]!r}; the contract is unbaked"
            )
    return bad


def check_outside_refs(data, surface_patterns):
    """Check package-external path references, returning (violations, paths examined)."""
    res = [glob_to_regex(p) for p in surface_patterns]
    bad, examined = [], 0
    for where, value in walk_scalars(data):
        # Version 2 output and related-file paths belong to the target repository,
        # not to this plugin package. Their repository boundary is validated by
        # check_schema and again by workflow.py after realpath resolution.
        if data.get("계약버전") == 2 and (
                re.fullmatch(r"\$\.산출\[\d+\]\.경로", where)
                or re.fullmatch(r"\$\.검증\[\d+\]\.관련파일\[\d+\]", where)):
            continue
        if not looks_like_path(value):
            continue
        examined += 1
        rel = normalise_path(value)
        if not any(r.match(rel) for r in res):
            bad.append(
                f"{where} points outside the package: {value!r} — "
                "it matches no surface category"
            )
    return bad, examined


def lint(path, surface_patterns, judge, quiet=False):
    """Lint one contract file, returning (rc, violations, external references)."""
    loaded, err = load_contract(path)
    if err:
        print(err, file=sys.stderr)
        return 2, 0, 0
    data, text = loaded

    violations = check_schema(data)
    violations += check_unbaked_tables(data, text)
    outside, examined = check_outside_refs(data, surface_patterns)
    violations += outside

    if violations:
        print(f"{path} — violations: {len(violations)}:", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1, len(violations), len(outside)
    if not quiet:
        print(
            f"{path} — violations: 0 · package-external path references 0 "
            f"(checked {examined} path-like values) · judge {judge}"
        )
    return 0, 0, 0


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Contract file v1/v2 linter (rc 0 pass / 1 violation / 2 unable to run)"
    )
    ap.add_argument("contracts", nargs="*", help=".jstack/plan/<slug>/contract.yaml")
    ap.add_argument("--surface", default=DEFAULT_SURFACE, help="package surface declaration")
    ap.add_argument(
        "--package-root", default=PACKAGE_ROOT, help="package root (path comparison base)"
    )
    ap.add_argument("--quiet", action="store_true", help="suppress the success summary")
    args = ap.parse_args(argv)

    if not args.contracts:
        print(
            "no contract files were provided; checking zero files is not a pass",
            file=sys.stderr,
        )
        return 2

    surface_patterns, judge = load_surface(args.surface)

    rc, total_v, total_o = 0, 0, 0
    for path in args.contracts:
        one, nv, no = lint(path, surface_patterns, judge, quiet=args.quiet)
        total_v += nv
        total_o += no
        if one == 2:
            rc = 2
        elif one == 1 and rc != 2:
            rc = 1
    if rc != 2 and not args.quiet:
        print(
            f"contracts {len(args.contracts)} · violations {total_v} · "
            f"package-external path references {total_o} · judge {judge}"
        )
    return rc


if __name__ == "__main__":
    sys.exit(main())
