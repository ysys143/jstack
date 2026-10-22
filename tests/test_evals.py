#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate the complete evaluation tag population, answer placement, and Git binding.

Both missing and additional discriminating tags fail. Answer tokens must occur
in the rubric and remain absent from the prompt. All cases use one tag reader.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = ROOT  # Bind cases to the tested runtime snapshot.
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, os.path.join(ROOT, "skills"))
from eval_tags import _yaml_tags
from _suite_lib import (check_eval_cases,  # noqa: E402
                        check_no_constant_assertions, check_total)

TAG = "ablation-discriminating"

# **This is a measured floor.** These cases were measured at delta >= +0.67.
# Add inventory before increasing it; record why entries lost eligibility before
# reducing it.
DISCRIMINATING = {
    "discriminating/deck-design-slop",
    "discriminating/diagram-connector-rules",
    "discriminating/hwpx-format-units",
    "discriminating/workspace-scrum-rows",
    # The directory is regression, but the tag is discriminating. The plugin's K-O
    # classification cannot be produced from general knowledge, so this is a
    # discriminating case by content. The tag is also a free label independent of
    # directory structure; this set, rather than structure, is the contract.
    "regression/humanize-taxonomy-recall",
}

# **Answer tokens** for discriminating cases. These values must be in the rubric
# and **absent from the prompt**; leaking answers lets both with and without arms
# pass, killing delta and the distinction being measured. Owning skill suites
# verify the values; this suite checks **which file contains each answer**.
ANSWER_TOKENS = {
    "discriminating/hwpx-format-units": ["84186", "59528", "283.46", "7200",
                                        "100 HWPUNIT"],
    "discriminating/workspace-scrum-rows": ["8월 5주", "8월 4주", "2026-08-27",
                                           "13", "18", "23", "28",
                                           "the difference",
                                           "a specific team's recorded sheet structure"],
    "discriminating/diagram-connector-rules": [
        "Draw arrows before boxes", "6~10px",
        "Do not pass behind a third box (exceptions apply)"],
    "discriminating/deck-design-slop": ["underspec", "no-constraint", "no-verify",
                                       "median", "Content", "Tables and figures",
                                       "Typesetting", "Reversals in procurement",
                                       "Item counts must be exact: 6, 5, 6, 4."],
    "regression/humanize-taxonomy-recall": [
        "Procurement commitment register deviation", "Requirements traceability topology collapse",
        "Body–visual integration collapse", "K-1 … K-5", "M-1 … M-7",
        "L-1 … L-4", "N-1 … N-6", "O-1 … O-7"],
}
DISCRIMINATING |= {
    "discriminating/audit-priority",
    "discriminating/cleanup-axes",
}
ANSWER_TOKENS.update({
    "discriminating/audit-priority": [
        "Blockers", "order and count must match.",
        "blocking is the default verdict and the author bears the burden of proof",
    ],
    "discriminating/cleanup-axes": [
        "There are 10 axes", "wrapper for a single call site", "The count must be exact.",
    ],
})

results = []


def check(label, ok, detail=""):
    results.append((label, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {label}"
          + (f" — {detail}" if detail and not ok else ""))




def main():
    check_eval_cases(check, ROOT, REPO, _yaml_tags, tag=TAG,
                     discriminating=DISCRIMINATING, answer_tokens=ANSWER_TOKENS)
    # **Protect the set check itself.** Review 8 disabled this suite with two
    # changes: remove one tag from `case.yaml` and replace set comparison with
    # `True`; it stayed green at 11/11 while condition 4 opened. Static detection
    # catches literal assertions, and the total-count marker catches deletion.
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 133)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
