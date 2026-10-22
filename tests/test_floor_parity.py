#!/usr/bin/env python3
"""`check_floor_parity` 의 오염 가드 — 빨간 트리에서 잰 하한은 처방이 아니다.

## 왜 이 테스트가 있나

삭제 회귀 하한은 "이 파일의 본문을 지우면 계약 검사 몇 건이 실패하는가" 다.
그 수가 뜻을 가지려면 **삭제 전 스위트가 초록**이어야 한다. 무조건 실패하는
검사가 k 개 있으면 어느 줄을 지우든 그 k 가 함께 세어져 **모든 파일의 실측이
일률적으로 +k** 가 된다.

실제로 그랬다 — dev 계층의 `inspect`·`validate` 두 판정이 rc=1 이던 동안
`commands/` 11개 파일 전부가 "선언 N / 실측 N+2 (여유 2)" 로 나왔고, 검사기는
그것을 드리프트로 보고 **11건의 하한 인상**을 처방했다. 두 판정을 고치자 11건이
한꺼번에 0 이 됐다. 처방을 따랐다면 오염 +2 가 하한에 영구히 박혔고, 이후 진짜
계약 두 건이 죽어도 그 여유가 삼켰을 것이다.

경고만으로는 부족하다 — 지시를 따르는 쪽이 여전히 싸기 때문에, 오염된 스위트의
하한 대조는 **무효**로 내고 하한 인상을 아예 처방하지 않는다.
"""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TOOL = os.path.join(REPO, "scripts", "check_floor_parity.py")

_passed = _failed = 0


def check(name, ok, why=""):
    global _passed, _failed
    if ok:
        _passed += 1
        print(f"[PASS] {name}")
    else:
        _failed += 1
        print(f"[FAIL] {name}" + (f" — {why}" if why else ""))


# `ui` 를 표본으로 쓴다. 디자인 팩도 각각 독립 하한을 가지며, 라벨이
# 실재해 `--from-dir` 경로 계산(`out_name`)이 실물과 같은 규약을 탄다.
LABEL = "skills/ui"
OUT = "ui.out"

FLOOR_LINES = "\n".join(
    f"[PASS] 계약 커버리지: {f} — {n}건 실패 (하한 {n})"
    for f, n in (
        ("SKILL.md", 16),
        ("NOTICE", 4),
        ("UPSTREAM.sha256", 2),
        ("references/web-interface-guidelines.md", 8),
    ) + tuple((f"assets/design-packs/fixture-{index}.md", 1) for index in range(41))
) + "\n[PASS] 자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다 — 16건 실패 (하한 16)"


def run(stdout_text, label=LABEL):
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, OUT), "w", encoding="utf-8") as f:
            f.write(stdout_text)
        p = subprocess.run(
            [sys.executable, TOOL, label, "--from-dir", d],
            capture_output=True, text=True, cwd=REPO,
        )
    return p


# ---- 1. 초록 스위트: 종전대로 통과한다 (가드가 정상 경로를 막지 않는다)
p = run(FLOOR_LINES + "\n\n47/47 통과\n")
check("초록 스위트는 통과한다", p.returncode == 0, f"rc={p.returncode} {p.stdout[-300:]}")
check("초록 스위트에서 오염을 주장하지 않는다",
      "오염된 실측" not in p.stdout, p.stdout[-300:])

# ---- 2. 빨간 스위트: 하한이 전부 맞아도 무효로 낸다
p = run(FLOOR_LINES + "\n\n45/47 통과\n")
check("빨간 스위트는 거부된다", p.returncode != 0, f"rc={p.returncode}")
check("오염이라고 이름 붙인다", "오염된 실측" in p.stdout, p.stdout[-400:])
check("무조건 실패 건수를 말한다", "2건" in p.stdout, p.stdout[-400:])
check("하한을 올리지 말라고 적는다", "하한을 올리지 마라" in p.stdout, p.stdout[-400:])

# ---- 3. 오염 상태에서 **하한 인상을 처방하지 않는다** (이 테스트의 핵심)
# 실측이 선언보다 2 큰, 오염이 만드는 바로 그 모양을 준다.
INFLATED = "\n".join(
    f"[FAIL] 계약 커버리지: {f} — {n + 2}건 실패 (하한 {n})"
    for f, n in (("SKILL.md", 14), ("NOTICE", 4))
)
p = run(INFLATED + "\n\n45/47 통과\n")
check("오염 상태에서 개별 여유를 드리프트로 보고하지 않는다",
      "여유 2" not in p.stdout and "선언 14 / 실측 16" not in p.stdout,
      p.stdout[-400:])
check("오염 상태에서도 rc 는 빨갛다", p.returncode != 0, f"rc={p.returncode}")

# ---- 4. 총평이 없으면 미판정으로 거부한다 (부재를 통과로 세지 않는다)
p = run(FLOOR_LINES + "\n")
check("총평이 없으면 거부한다", p.returncode != 0, f"rc={p.returncode}")
check("총평 부재를 이름 붙인다", "총평" in p.stdout, p.stdout[-400:])

# ---- 5. 오염 라벨에 '잰 하한 0건' 을 겹쳐 세지 않는다
p = run(FLOOR_LINES + "\n\n45/47 통과\n")
check("오염을 두 번 세지 않는다",
      "잰 하한 0건" not in p.stdout and "등재되지 않은 스위트" not in p.stdout,
      p.stdout[-400:])

# ---- 6. 마지막 총평을 읽는다 (중간에 다른 N/M 이 있어도)
p = run("12/34 통과\n" + FLOOR_LINES + "\n\n47/47 통과\n")
check("총평은 마지막 것을 읽는다", p.returncode == 0,
      f"rc={p.returncode} {p.stdout[-300:]}")

# ---- 7. `unittest` 계보의 총평도 읽는다
# 이 저장소의 스위트는 두 계보다. 첫 판이 `N/M 통과` 만 알아서 `test_hooks` ·
# `test_pr_label` 두 개를 "총평 부재" 로 빨갛게 냈다 — 내가 만든 부류 H 다.
p = run(FLOOR_LINES + "\n\nRan 44 tests in 2.199s\n\nOK\n")
check("unittest 의 OK 를 초록으로 읽는다", p.returncode == 0,
      f"rc={p.returncode} {p.stdout[-300:]}")
p = run(FLOOR_LINES + "\n\nRan 44 tests in 2.199s\n\nOK (skipped=2)\n")
check("OK (skipped=N) 도 초록이다", p.returncode == 0,
      f"rc={p.returncode} {p.stdout[-300:]}")
p = run(FLOOR_LINES + "\n\nRan 44 tests in 2.2s\n\nFAILED (failures=2)\n")
check("unittest 의 FAILED 는 오염이다",
      p.returncode != 0 and "오염된 실측" in p.stdout, p.stdout[-300:])
check("FAILED 의 상세를 그대로 보인다", "failures=2" in p.stdout, p.stdout[-300:])

# ---- 8. 모르는 형식은 초록으로 때우지 않는다 (등재제)
p = run(FLOOR_LINES + "\n\n전부 잘 됐습니다\n")
check("모르는 총평 형식은 거부한다",
      p.returncode != 0 and "총평" in p.stdout, p.stdout[-300:])

# External runtime paths and symlink aliases must map to the canonical label.
with tempfile.TemporaryDirectory() as alias_root:
    runtime = os.environ.get("JSTACK_RUNTIME_ROOT", REPO)
    target = os.path.join(runtime, "skills", "ui")
    p = run(FLOOR_LINES + "\n\n47/47 통과\n", target)
    check("외부 runtime 절대 경로가 정본 라벨로 대응된다", p.returncode == 0, p.stdout[-300:])
    alias = os.path.join(alias_root, "runtime")
    os.symlink(os.path.realpath(runtime), alias)
    p = run(FLOOR_LINES + "\n\n47/47 통과\n", os.path.join(alias, "skills", "ui"))
    check("runtime 심링크 별칭도 같은 라벨로 대응된다", p.returncode == 0, p.stdout[-300:])

# ---- 자기검사: 이 파일의 판정 수가 선언과 같다
TOTAL = 20
check(f"자기검사: 판정 총수가 {TOTAL} 건이다",
      _passed + _failed + 1 == TOTAL,
      f"실측 {_passed + _failed + 1}")

print(f"\n{_passed}/{_passed + _failed} 통과")
sys.exit(1 if _failed else 0)
