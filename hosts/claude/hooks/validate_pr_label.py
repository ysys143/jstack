#!/usr/bin/env python3
"""PreToolUse hook that checks `gh pr create` against repository label policy.

The old `session-and-git` version **hard-coded policy**. It passed for every
organization except one fixed organization, and its category list was constant.
That made it inert elsewhere and required code changes whenever labels changed.

This version **reads policy from the repository**, in this order:

1. **Find declared policy first** in documents such as PR templates,
   CONTRIBUTING, and CLAUDE.md. Explicit human declarations outrank observation.
2. **Infer from observation when declarations are absent**, using the defined
   label set and labels actually applied to existing PRs.
3. **Do not block when both signals are weak.** Repositories that do not use
   labels should not receive an invented policy; warn and pass.

Commit the decision and evidence to `.claude/pr-policy.json`, which answers why
a requirement exists for future maintainers.

**Delta handling:** changes to labels or declaration documents change the
fingerprint. Rediscover and update policy, report the difference, and pass
instead of silently blocking with stale policy.
"""

import hashlib
import json
import shutil
import os
import re
import subprocess
import sys
from pathlib import Path

POLICY_FILE = Path(".claude") / "pr-policy.json"

#: Locations where people declare policy, ordered by priority.
DECLARED_SOURCES = (
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/pull_request_template.md",
    ".github/CONTRIBUTING.md",
    "CONTRIBUTING.md",
    "CLAUDE.md",
    "AGENTS.md",
)

#: Treat labels as policy declarations only near these words. Collecting every
#: label name in a document would promote body examples into rules.
POLICY_HINTS = re.compile(
    r"(레이블|라벨|label|필수|required|반드시|must|정책|policy|convention)",
    re.IGNORECASE,
)

#: Minimum observed rate for treating a group as required without a declaration.
#: For example, 36 of 40 PRs (90%) is required.
REQUIRED_THRESHOLD = 0.80
#: Minimum rate for **promoting** a group when a declaration mentions it. A
#: human declaration makes less-certain observations eligible as rules.
SUGGEST_FLOOR = 0.50
#: Minimum confidence for **enforcing** rules. Rates between SUGGEST_FLOOR and
#: this value produce warnings without blocking. Equal values remove that range
#: and make the warning path dead code, which happened previously.
CONFIDENCE_FLOOR = 0.60

#: Number of lines below a hint that remain in the same context.
HINT_WINDOW = 3

OBSERVE_LIMIT = 50
GH_TIMEOUT = 20


# ---------------------------------------------------------------- shell helpers


def gh(args, timeout=GH_TIMEOUT):
    """Call `gh` and return stdout. Return None on failure; never raise."""
    try:
        done = subprocess.run(
            ["gh", *args], capture_output=True, text=True, timeout=timeout
        )
        return done.stdout if done.returncode == 0 else None
    except Exception:
        return None


#: Three `gh` states. Absence and missing authentication require different fixes.
GH_ABSENT, GH_UNAUTHENTICATED, GH_READY = "absent", "unauthenticated", "ready"


def gh_state():
    if shutil.which("gh") is None:
        return GH_ABSENT
    try:
        done = subprocess.run(
            ["gh", "auth", "status"], capture_output=True, text=True, timeout=GH_TIMEOUT
        )
        return GH_READY if done.returncode == 0 else GH_UNAUTHENTICATED
    except Exception:
        return GH_UNAUTHENTICATED


def gh_onboarding():
    """Return guidance when `gh` is unavailable, without installing it.

    A hook must not install software on another person's machine because that
    obscures what was installed and when. Explain the exact action instead.
    """
    state = gh_state()
    if state == GH_READY:
        return None

    if state == GH_ABSENT:
        if sys.platform == "darwin":
            install = "    brew install gh"
        elif sys.platform.startswith("linux"):
            install = (
                "    sudo apt install gh          # Debian/Ubuntu\n"
                "    sudo dnf install gh          # Fedora/RHEL"
            )
        else:
            install = "    winget install --id GitHub.cli"
        return "\n".join(
            [
                "GitHub CLI (`gh`) is not installed.",
                "",
                "Reading this repository's label policy requires `gh`. Install it:",
                "",
                install,
                "",
                "Authenticate after installation:",
                "",
                "    gh auth login",
                "",
                "To proceed without installing it, write the policy directly or "
                "use an empty file to declare that the repository has no label policy:",
                "",
                f"    mkdir -p {POLICY_FILE.parent} && : > {POLICY_FILE}",
            ]
        )

    return "\n".join(
        [
            "GitHub CLI (`gh`) is not authenticated.",
            "",
            "Reading this repository's label policy requires authentication:",
            "",
            "    gh auth login",
            "",
            "Check status:",
            "",
            "    gh auth status",
        ]
    )


def repo_root(cwd=None):
    try:
        done = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=cwd,
        )
        return Path(done.stdout.strip()) if done.returncode == 0 else None
    except Exception:
        return None


# ------------------------------------------------------------ label grouping


def group_key(label):
    """Return the group key for a label.

    Prefix conventions differ by organization: `@web`, `type:bug`, `area/web`.
    Treat a symbol before letters or a `key:`/`key/` prefix as the group key.
    Labels without prefixes form one `_plain` group. **Follow observed forms
    without imposing a convention.**
    """
    marked = re.match(r"^([^0-9A-Za-z]+)", label)
    if marked:
        return marked.group(1)
    delimited = re.match(r"^([0-9A-Za-z][0-9A-Za-z._-]*[:/])", label)
    if delimited:
        return delimited.group(1)
    return "_plain"


def group_labels(labels):
    groups = {}
    for label in labels:
        groups.setdefault(group_key(label), []).append(label)
    return {k: sorted(v) for k, v in groups.items()}


# -------------------------------------------------------------- policy discovery


def read_declared(root):
    """Return labels declared by people in documents and their source list."""
    declared, sources = set(), []
    for relative in DECLARED_SOURCES:
        path = root / relative
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        found = set()
        lines = text.splitlines()
        for index, line in enumerate(lines):
            # A hint need not share the line; lists commonly follow a heading
            # such as "### Required labels." Inspect up to three preceding lines.
            window = lines[max(0, index - HINT_WINDOW) : index + 1]
            if not any(POLICY_HINTS.search(near) for near in window):
                continue
            # Collect only tokens inside backticks or quotes, not words in prose.
            found |= set(re.findall(r"[`\"']([^`\"'\s]{2,40})[`\"']", line))
        if found:
            declared |= found
            sources.append(relative)
    return declared, sources


def read_defined(root):
    """Return labels actually defined in the repository."""
    raw = gh(["label", "list", "--limit", "200", "--json", "name"])
    if raw is None:
        return None
    try:
        return {row["name"] for row in json.loads(raw)}
    except Exception:
        return None


def observe_shape(defined):
    """Return per-group label rates in existing PRs and the observation count."""
    raw = gh(
        [
            "pr",
            "list",
            "--state",
            "all",
            "--limit",
            str(OBSERVE_LIMIT),
            "--json",
            "labels",
        ]
    )
    if raw is None:
        return {}, 0
    try:
        prs = json.loads(raw)
    except Exception:
        return {}, 0
    if not prs:
        return {}, 0

    keys = {group_key(label) for label in defined} if defined else set()
    tally = {key: 0 for key in keys}
    for pr in prs:
        names = [row["name"] for row in pr.get("labels", [])]
        for key in {group_key(name) for name in names} & keys:
            tally[key] += 1
    return {key: hits / len(prs) for key, hits in tally.items()}, len(prs)


def fingerprint(defined, root):
    """Fingerprint labels and declaration documents; any change alters the value."""
    parts = ["|".join(sorted(defined or []))]
    for relative in DECLARED_SOURCES:
        path = root / relative
        if path.is_file():
            try:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
                parts.append(f"{relative}:{digest}")
            except Exception:
                pass
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:32]


def discover(root):
    """Discover policy, returning None when `gh` is unavailable."""
    defined = read_defined(root)
    if defined is None:
        return None
    declared, sources = read_declared(root)
    rates, observed = observe_shape(defined)
    groups = group_labels(defined)

    # Labels declared but not defined in the repository signal stale policy docs.
    #
    # **Count only prefixed values.** A backticked token may be a label or function
    # name. Including unprefixed `_plain` tokens promotes code identifiers into
    # phantom labels; `check_file_content` was once captured this way. A prefix
    # such as `@package` makes the label intent unambiguous.
    phantom = sorted(
        name
        for name in declared
        if name not in defined
        and group_key(name) in groups
        and group_key(name) != "_plain"
    )

    rules = []
    for key, members in sorted(groups.items()):
        rate = rates.get(key, 0.0)
        # A declaration that mentions this group's label makes it a human rule.
        asserted = bool(declared & set(members)) or bool(
            [name for name in phantom if group_key(name) == key]
        )
        if rate >= REQUIRED_THRESHOLD or (asserted and rate >= SUGGEST_FLOOR):
            rules.append(
                {
                    "group": key,
                    "requirement": "at_least_one",
                    "allowed": members,
                    "observed_rate": round(rate, 3),
                    "declared": asserted,
                }
            )

    confidence = min([r["observed_rate"] for r in rules], default=0.0)
    return {
        "version": 1,
        "generated_by": "hooks/validate_pr_label.py",
        "fingerprint": fingerprint(defined, root),
        "observed_prs": observed,
        "declared_sources": sources,
        "phantom_labels": phantom,
        "confidence": round(confidence, 3),
        "enforced": confidence >= CONFIDENCE_FLOOR,
        "rules": rules,
    }


# -------------------------------------------------------------- policy storage


#: Four policy-file states. Existence itself contributes to the decision.
MISSING, EMPTY, BROKEN, PRESENT = "missing", "empty", "broken", "present"


def load_policy(root):
    """Return (state, policy); a file's existence signals a deliberate decision.

    Do not pass or auto-generate when the file is absent. Automatic generation
    would produce green before anyone reviewed policy and make that state
    indistinguishable from "this repository uses no labels." A person must
    create **at least an empty file** to establish that distinction.
    """
    path = root / POLICY_FILE
    if not path.is_file():
        return MISSING, None
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except Exception:
        return BROKEN, None
    if not raw:
        return EMPTY, None
    try:
        return PRESENT, json.loads(raw)
    except Exception:
        return BROKEN, None


def save_policy(root, policy):
    path = root / POLICY_FILE
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return True
    except Exception:
        return False


def describe_delta(before, after):
    """Describe changes for a person, or return an empty string when unchanged."""
    was = {r["group"]: set(r["allowed"]) for r in (before or {}).get("rules", [])}
    now = {r["group"]: set(r["allowed"]) for r in after.get("rules", [])}
    lines = []
    for key in sorted(set(was) | set(now)):
        if key not in was:
            lines.append(f"  + group '{key}' became required: {sorted(now[key])}")
        elif key not in now:
            lines.append(f"  - group '{key}' is no longer required")
        else:
            added, removed = sorted(now[key] - was[key]), sorted(was[key] - now[key])
            if added:
                lines.append(f"  + added to '{key}': {added}")
            if removed:
                lines.append(f"  - removed from '{key}': {removed}")
    return "\n".join(lines)


# ------------------------------------------------------------------ decision


_PR_CREATE = re.compile(r"\bgh\s+pr\s+create\b")
_CD = re.compile(r"""^\(*\s*(?:cd|pushd)\s+(?:--\s+)?(?:"([^"]*)"|'([^']*)'|(\S+))\s*$""")
_HOME = re.compile(r"^\$(?:HOME|\{HOME\})(?=/|$)")


def command_directory(command, base):
    """Return the directory the `gh pr create` in `command` runs from.

    The hook process runs in the session directory, but an agent often reaches
    another checkout with `cd <dir> && gh pr create`. Judging the session
    directory there checks the wrong repository: a compliant PR is blocked
    because the session repository has no policy, or passes under a policy that
    does not govern it. Follow each plain `cd` or `pushd` before the
    `gh pr create`, resolved against the hook input's `cwd`. A target that
    cannot be resolved without a shell (other variables, `cd -`, command
    substitution) stops the walk at the last known directory instead of
    guessing.
    """
    found = _PR_CREATE.search(command)
    before = command[: found.start()] if found else command
    directory = Path(base)
    for raw in re.split(r"&&|\|\||;|\n", before):
        match = _CD.match(raw.strip())
        if not match:
            continue
        target = next(group for group in match.groups() if group is not None)
        if target == "~" or target.startswith("~/"):
            target = str(Path.home()) + target[1:]
        elif _HOME.match(target):
            target = str(Path.home()) + _HOME.sub("", target)
        if target == "-" or "$" in target or "`" in target:
            break
        directory = (directory / target).resolve()
    return directory


def parse_labels(command):
    found = re.findall(r"--label(?:=|\s+)([\"']?)([^\"'\s]+)\1", command)
    return [value for _, value in found]


def judge(labels, policy):
    """Return (blocking reason, warning); both are None for a pass."""
    if not policy or not policy.get("rules"):
        return None, None

    missing = []
    for rule in policy["rules"]:
        allowed = set(rule["allowed"])
        if not (set(labels) & allowed):
            shown = ", ".join(rule["allowed"][:12])
            if len(rule["allowed"]) > 12:
                shown += f", ... ({len(rule['allowed'])} total)"
            missing.append(f"- one label from group '{rule['group']}': {shown}")

    if not missing:
        return None, None

    detail = "\n".join(missing)
    evidence = (
        f"Evidence: {policy.get('observed_prs', 0)} PRs observed"
        f" · confidence {policy.get('confidence', 0):.0%}"
        f" · policy {POLICY_FILE}"
    )

    if not policy.get("enforced"):
        return None, (
            f"[PR label] Policy confidence is too low to block.\n"
            f"{detail}\n{evidence}"
        )

    example = " ".join('--label "%s"' % rule["allowed"][0] for rule in policy["rules"])
    return (
        f"PR labels do not satisfy this repository's policy.\n\n{detail}\n\n{evidence}\n\n"
        f'Example: gh pr create --title "..." {example}'
    ), None


def onboarding_message(root, state):
    """Return guidance when the policy file is missing or broken.

    Block while showing **the corrective action** on the same screen. Run
    discovery without writing a file; a decision exists only after human review.
    """
    head = (
        f"This repository has no registered PR label policy: {POLICY_FILE}"
        if state == MISSING
        else f"The PR label policy file cannot be read: {POLICY_FILE}"
    ) + f"\nRepository: {root}"

    blocked_by_gh = gh_onboarding()
    if blocked_by_gh:
        # Discovery cannot produce a result without `gh`. Explain the tool first
        # so the required first action remains clear.
        return f"{head}\n\n{blocked_by_gh}"

    lines = [head, "", "Choose a policy before opening a PR. Use one of these options.", ""]

    suggestion = discover(root)
    if suggestion and suggestion.get("rules"):
        groups = ", ".join(f"'{r['group']}'" for r in suggestion["rules"])
        lines += [
            f"(1) Register the discovery result below as-is. Across "
            f"{suggestion['observed_prs']} PRs, groups {groups} appeared at "
            f"{suggestion['confidence']:.0%}:",
            "",
            f"    mkdir -p {POLICY_FILE.parent} && cat > {POLICY_FILE} <<'EOF'",
            json.dumps(suggestion, ensure_ascii=False, indent=2),
            "EOF",
            "",
        ]
        if suggestion.get("phantom_labels"):
            lines += [
                "    Note: labels declared in documents but undefined in the repository: "
                + ", ".join(suggestion["phantom_labels"]),
                "",
            ]
    else:
        lines += [
            "(1) No required label shape was observed in this repository. "
            "Populate rules to define policy manually.",
            "",
        ]

    lines += [
        "(2) If this repository has no label policy, declare that with an empty file:",
        "",
        f"    mkdir -p {POLICY_FILE.parent} && : > {POLICY_FILE}",
        "",
        "An empty file is a decision and must be distinguished from an absent file. "
        "Absence means no one has reviewed policy; opening a PR in that state leaves "
        "even the existence of rules unknown.",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------------ main


def main():
    try:
        data = json.load(sys.stdin)
        if data.get("tool_name") != "Bash":
            return
        command = data.get("tool_input", {}).get("command", "")
        if not re.search(r"\bgh\s+pr\s+create\b", command):
            return

        directory = command_directory(command, data.get("cwd") or os.getcwd())
        root = repo_root(directory) if directory.is_dir() else None
        if root is None:
            return
        os.chdir(root)

        state, policy = load_policy(root)
        notes = []

        if state in (MISSING, BROKEN):
            print(
                json.dumps(
                    {"decision": "block", "reason": onboarding_message(root, state)}
                )
            )
            return

        if state == EMPTY:
            # An empty file is a human declaration that the repository has no
            # label policy. Unlike an absent file, it records a decision.
            return

        # Delta: when labels or declarations change, do not block with stale policy.
        defined = read_defined(root)
        if defined is not None and fingerprint(defined, root) != policy.get(
            "fingerprint"
        ):
            fresh = discover(root)
            if fresh is not None:
                delta = describe_delta(policy, fresh)
                save_policy(root, fresh)
                policy = fresh
                notes.append(
                    "[PR label] Policy changed and was refreshed."
                    + (f"\n{delta}" if delta else " (required groups unchanged)")
                )

        reason, warning = judge(parse_labels(command), policy)
        if warning:
            notes.append(warning)

        if reason:
            print(
                json.dumps({"decision": "block", "reason": "\n".join(notes + [reason])})
            )
        elif notes:
            print(json.dumps({"systemMessage": "\n".join(notes)}))

    except Exception as error:
        # Fail open on unexpected errors. **A missing policy file is not such an
        # error**; it means no decision exists and is blocked above.
        print(json.dumps({"systemMessage": f"[PR label] Hook error: {error}"}))


if __name__ == "__main__":
    main()
