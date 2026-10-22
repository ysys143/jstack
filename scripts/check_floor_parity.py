#!/usr/bin/env python3
"Compare every declared deletion floor with measured suite evidence."

import io
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TREES = ["."]
RUNTIME_ROOT = os.environ.get("JSTACK_RUNTIME_ROOT")
ALLOWED: list[tuple[str, str, str]] = []
EXPECTED_BY_LABEL: dict[str, int] = {
    "skills/asd-ste100": 4,
    "skills/audit": 8,
    "skills/author": 57,
    "skills/bridge": 12,
    "skills/cleanup": 8,
    "skills/consult": 14,
    "skills/dashboard": 8,
    "skills/decide": 2,
    "skills/deck": 9,
    "skills/delegate": 4,
    "skills/diagram": 23,
    "skills/emoji": 2,
    "skills/gitrules": 7,
    "skills/help": 2,
    "skills/humanize": 40,
    "skills/hwpx": 30,
    "skills/image": 6,
    "skills/models": 4,
    "skills/office": 5,
    "skills/plan": 6,
    "skills/proof": 7,
    "skills/prune": 5,
    "skills/react": 6,
    "skills/recall": 8,
    "skills/research": 10,
    "skills/science": 8,
    "skills/secrets": 3,
    "skills/setup": 10,
    "skills/tdd": 11,
    "skills/team": 10,
    "skills/ui": 5,
    "skills/upstream": 3,
    "skills/verify": 18,
    "skills/workspace": 24,
    "tests/test_contracts.py": 0,
    "tests/test_dev_agents.py": 8,
    "tests/test_dev_commands.py": 11,
    "tests/test_dev_hooks.py": 0,
    "tests/test_dev_pr_label.py": 0,
    "tests/test_evals.py": 0,
    "tests/test_floor_parity.py": 0,
    "tests/test_onboarding.py": 0,
    "tests/test_profiles.py": 0,
    "tests/test_repack.py": 0,
    "tests/test_repository.py": 0,
    "tests/test_session_migration.py": 0,
    "tests/test_skill_store.py": 0,
    "tests/test_work_agents.py": 0,
    "tests/test_work_commands.py": 0,
    "tests/test_work_hooks.py": 0,
}
EXPECTED = {
    t: sum(
        (v for k, v in EXPECTED_BY_LABEL.items() if t == "." or k.startswith(t + "/"))
    )
    for t in DEFAULT_TREES
}
VERDICT = re.compile("(?m)^(?P<pass>\\d+)/(?P<all>\\d+) 통과\\s*$")
UNITTEST_OK = re.compile("(?m)^OK(?:\\s*\\(.*\\))?\\s*$")
UNITTEST_BAD = re.compile("(?m)^FAILED\\s*\\((?P<detail>.*)\\)\\s*$")


def verdict_of(stdout):
    m = VERDICT.findall(stdout)
    if m:
        ok, all_ = (int(x) for x in m[-1])
        return (ok == all_, f"{ok}/{all_}", all_ - ok)
    bad = UNITTEST_BAD.findall(stdout)
    if bad:
        return (False, f"FAILED ({bad[-1]})", None)
    if UNITTEST_OK.search(stdout):
        return (True, "OK", 0)
    return None


LINE = re.compile(
    "^\\[(?:PASS|FAIL)\\] (계약 커버리지: (?P<f>\\S+)|자기검사: SKILL\\.md 본문 삭제 시 계약 검사가 실패한다|스크립트 계약: (?P<s>\\S+)) — (?P<got>\\d+)건 실패 \\(하한 (?P<floor>\\d+)\\)"
)


def suites(tree):
    root = RUNTIME_ROOT if tree == "." and RUNTIME_ROOT else os.path.join(REPO, tree)
    out = []
    sk = os.path.join(root, "skills")
    if os.path.isdir(sk):
        for n in sorted(os.listdir(sk)):
            td = os.path.join(sk, n, "tests")
            if not os.path.isdir(td):
                continue
            for f in sorted(os.listdir(td)):
                if not f.endswith(".py") or f.startswith("_"):
                    continue
                out.append(
                    (os.path.normpath(f"{tree}/skills/{n}"), os.path.join(td, f))
                )
    t = os.path.join(root, "tests")
    if os.path.isdir(t):
        for n in sorted(os.listdir(t)):
            if n.startswith("test_") and n.endswith(".py"):
                out.append((os.path.normpath(f"{tree}/tests/{n}"), os.path.join(t, n)))
    return out


def resolve(spec):
    ab = os.path.abspath(spec)
    if not os.path.exists(ab) and (not os.path.isabs(spec)):
        ab = os.path.join(REPO, spec)
    ab = os.path.realpath(ab)
    label_root = os.path.realpath(REPO)
    if RUNTIME_ROOT and os.path.commonpath(
        [os.path.realpath(ab), os.path.realpath(RUNTIME_ROOT)]
    ) == os.path.realpath(RUNTIME_ROOT):
        ab = os.path.realpath(ab)
        label_root = os.path.realpath(RUNTIME_ROOT)
    rel = os.path.relpath(ab, label_root).replace(os.sep, "/")
    if RUNTIME_ROOT and label_root == REPO and (not rel.startswith("../")):
        ab = os.path.join(RUNTIME_ROOT, rel)
    if os.path.isdir(os.path.join(ab, "skills")):
        return suites(rel)
    if os.path.isdir(ab) and os.path.isdir(os.path.join(ab, "tests")):
        td = os.path.join(ab, "tests")
        return [
            (rel, os.path.join(td, f))
            for f in sorted(os.listdir(td))
            if f.endswith(".py") and (not f.startswith("_"))
        ]
    if os.path.isfile(ab) and ab.endswith(".py"):
        parts = rel.split("/")
        if "skills" in parts:
            i = parts.index("skills")
            return [("/".join(parts[: i + 2]), ab)]
        return [(rel, ab)]
    raise SystemExit(f"[FAIL] 대상을 못 찾았다: {spec}")


def out_name(label):
    parts = label.split("/")
    if "skills" in parts:
        return parts[-1] + ".out"
    return "tests_" + parts[-1] + ".out"


def main():
    argv = sys.argv[1:]
    from_dir = ""
    if "--from-dir" in argv:
        i = argv.index("--from-dir")
        from_dir = argv[i + 1]
        argv = argv[:i] + argv[i + 2 :]
    trees = argv or DEFAULT_TREES
    slack, checked, raw_seen = ([], 0, [])
    contaminated = set()
    selected = []
    for t in trees:
        selected.extend(resolve(t))
    if from_dir:
        _seen, _uniq = (set(), [])
        for lab, pth in selected:
            if lab in _seen:
                continue
            _seen.add(lab)
            _uniq.append((lab, pth))
        selected = _uniq
    seen_by_label = {}
    for label, path in selected:
        seen_by_label.setdefault(label, 0)
    for label, path in selected:
        cwd = os.path.dirname(os.path.dirname(path))
        runner = (
            [
                "uv",
                "run",
                "--isolated",
                "--no-project",
                "--quiet",
                "--with",
                "lxml",
                "python",
            ]
            if "/hwpx" in label
            else [sys.executable]
        )
        if from_dir:
            _f = os.path.join(from_dir, out_name(label))
            if not os.path.isfile(_f):
                print(f"  [FAIL] 러너 출력이 없다: {label} -> {_f}")
                slack.append((label, "러너 출력 부재", 0, 0))
                continue
            stdout = io.open(_f, encoding="utf-8", errors="replace").read()
        else:
            stdout = subprocess.run(
                runner + [path],
                capture_output=True,
                text=True,
                cwd=cwd,
                env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
            ).stdout
        _v = verdict_of(stdout)
        if _v is None:
            print(f"  [FAIL] 스위트 총평을 못 읽었다: {label} — 오염 여부 미판정")
            slack.append((label, "총평 부재 — 오염 여부 미판정", 0, 0))
            continue
        _green, _shown, _k = _v
        if not _green:
            _how = f"무조건 실패 {_k}건이" if _k else "무조건 실패하는 검사가"
            print(
                f"  [FAIL] 오염된 실측: {label} — 삭제 전 스위트가 이미 {_shown} 다. {_how} 모든 파일의 실측에 함께 세어진다. **하한을 올리지 마라** — 스위트를 먼저 초록으로"
            )
            _ok, _all = (0, 0)
            slack.append((label, f"오염 — 삭제 전 {_shown}", 0, 0))
            contaminated.add(label)
            continue
        for line in stdout.splitlines():
            m = LINE.match(line)
            if not m:
                continue
            checked += 1
            floor, got = (int(m.group("floor")), int(m.group("got")))
            raw_seen.append(
                (
                    label,
                    m.group("f") or m.group("s") or "SKILL.md 삭제 회귀",
                    floor,
                    got,
                )
            )
            what = m.group("f") or m.group("s") or "SKILL.md 삭제 회귀"
            if got != floor and (
                not any((a == label and b == what for a, b, _ in ALLOWED))
            ):
                slack.append((label, what, floor, got))
            seen_by_label[label] += 1
    print(f"하한 {checked}건 검사 / 어긋남 {len(slack)}건")
    for a, b, why in ALLOWED:
        if not why.strip():
            print(f"  [FAIL] 사유 없는 예외: {a} :: {b}")
            slack.append((a, b, 0, 0))
        elif not any((lb == a and wt == b for lb, wt, _, _ in raw_seen)):
            print(f"  [FAIL] 발화하지 않는 예외: {a} :: {b} — {why}")
            slack.append((a, b, 0, 0))
    for label in seen_by_label:
        if label in contaminated:
            continue
        want_n = EXPECTED_BY_LABEL.get(label)
        if want_n is None:
            print(
                f"  [FAIL] 등재되지 않은 스위트: {label} — 잰 하한 {seen_by_label[label]}건. EXPECTED_BY_LABEL 에 실측치를 적어라"
            )
            slack.append((label, "미등재 스위트", 0, seen_by_label[label]))
        elif seen_by_label[label] != want_n:
            print(
                f"  [FAIL] {label} 의 잰 하한이 {want_n} 건이어야 한다 — {seen_by_label[label]}건. 계약을 늘렸거나 줄였으면 이 수를 함께 고쳐라 (출력 형식이 바뀌어 정규식이 안 맞는 경우도 여기서 드러난다)"
            )
            slack.append((label, "잰 하한 수", want_n, seen_by_label[label]))
    for label, what, floor, got in slack:
        gap = got - floor
        print(
            f"  [FAIL] {label} :: {what} — 선언 {floor} / 실측 {got} ({('여유' if gap > 0 else '미달')} {abs(gap)})"
        )
    if not selected:
        print("[FAIL] 잰 하한이 없다 — 스위트를 못 돌렸거나 출력 형식이 바뀌었다")
        return 2
    return 1 if slack else 0


if __name__ == "__main__":
    sys.exit(main())
