#!/usr/bin/env python3
"Exercise fixed boundary fixtures for shared contract-library predicates."

import os
import io
import re
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TREES = ["."]
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{('PASS' if ok else 'FAIL')}] {name}" + (f" — {detail}" if detail else ""))


def probe(tree):
    import importlib.util

    p = os.path.join(REPO, tree, "skills", "_suite_lib.py")
    spec = importlib.util.spec_from_file_location(f"_sl_{tree.replace('/', '_')}", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def axes_verdict(lib, live_body, frozen_body, floor, needles):
    fails = []

    def cap(name, ok, detail=""):
        if not ok:
            fails.append(name)

    with tempfile.TemporaryDirectory() as d:
        root = os.path.join(d, "skill")
        os.makedirs(os.path.join(root, "references"))
        os.makedirs(os.path.join(root, "tests", "refs"))
        fp = os.path.join(root, "references", "f.md")
        with open(fp, "w", encoding="utf-8") as f:
            f.write(live_body)
        with open(
            os.path.join(root, "tests", "refs", "f.md.lines"), "w", encoding="utf-8"
        ) as f:
            f.write("# blob:0000\n" + "\n".join(lib.ref_lines(frozen_body)))
        lib._ref_axes(
            cap,
            root,
            "f.md",
            fp,
            live_body,
            needles,
            floor,
            "tests/refs",
            label_prefix="T",
        )
    return fails


def main():
    frozen = "\n".join((f"line-{i} 내용이 있는 줄" for i in range(10)))
    half = (
        "\n".join((f"line-{i} 내용이 있는 줄" for i in range(5)))
        + "\n"
        + "\n".join((f"other-{i} 다른 줄" for i in range(5)))
    )
    most = (
        "\n".join((f"line-{i} 내용이 있는 줄" for i in range(8)))
        + "\n"
        + "\n".join((f"other-{i} 다른 줄" for i in range(2)))
    )
    for tree in TREES:
        lib = probe(tree)
        t = tree.split("/")[-1]
        check(
            f"{t}: 생존율 문턱 상수가 0.70 이다",
            getattr(lib, "SURVIVAL_FLOOR", None) == 0.7,
            str(getattr(lib, "SURVIVAL_FLOOR", None)),
        )
        check(
            f"{t}: 그 문턱으로 50% 는 떨어지고 80% 는 통과한다",
            0.5 < lib.SURVIVAL_FLOOR <= 0.8,
        )
        src = io.open(
            os.path.join(REPO, tree, "skills", "_suite_lib.py"), encoding="utf-8"
        ).read()
        lits = re.findall("rate >= ([0-9.]+)", src)
        check(
            f"{t}: 생존율 판정이 리터럴이 아니라 상수를 쓴다",
            not lits and src.count("rate >= SURVIVAL_FLOOR") >= 2,
            f"리터럴 {lits} / 상수 사용 {src.count('rate >= SURVIVAL_FLOOR')}회",
        )
        got = lib.content_bytes(frozen)
        fb = axes_verdict(lib, frozen, frozen, got + 1, [])
        check(
            f"{t}: 부피가 하한보다 1 작으면 실패한다",
            any(("부피" in x for x in fb)),
            f"실측 {got} / 하한 {got + 1} → {fb}",
        )
        fa = axes_verdict(lib, frozen, frozen, got, [])
        check(
            f"{t}: 부피가 하한과 같으면 통과한다",
            not any(("부피" in x for x in fa)),
            f"{fa}",
        )
        fn = axes_verdict(lib, frozen, frozen, 1, ["없는문자열"])
        check(
            f"{t}: 없는 needle 은 실패한다", any(("needle" in x for x in fn)), f"{fn}"
        )
        dup = "\n".join(["같은 줄이다"] * 10)
        check(
            f"{t}: content_bytes 가 중복 줄을 세지 않는다",
            lib.content_bytes(dup) == lib.content_bytes("같은 줄이다"),
            f"{lib.content_bytes(dup)} vs {lib.content_bytes('같은 줄이다')}",
        )
        check(
            f"{t}: content_bytes 가 needle 을 뺀다",
            lib.content_bytes("abc def", ["abc"]) < lib.content_bytes("abc def"),
        )
        a = ["a", "b", "c", "d"]
        check(
            f"{t}: survival_rate 가 순서를 본다",
            lib.survival_rate(list(reversed(a)), a) < 1.0,
            f"{lib.survival_rate(list(reversed(a)), a)}",
        )
    passed = sum((1 for _, ok, _ in results if ok))
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
