#!/usr/bin/env python3
"""Contract for `validate_pr_label.py`: read policy from the repository.

The old version hard-coded policy (pass when the owner was not
one fixed organization, with a constant category list). The test therefore asks
**whether the repository's rules apply wherever the hook is installed**.

Stub `gh` and `git` so the suite runs without network. Calling real `gh` binds
tests to GitHub state and makes failures impossible to attribute.

    python3 tests/test_dev_pr_label.py
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "validate_pr_label.py"


class PolicyCase(unittest.TestCase):
    LABELS = ["@web", "@server", "bug", "feature"]
    # 8/10 is (one position plus one category), a plausible required shape.
    PRS = [["@web", "feature"]] * 8 + [[], []]
    DOCS = {}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        for name, body in self.DOCS.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        self.stub_gh(self.LABELS, self.PRS)

    def tearDown(self):
        self.tmp.cleanup()

    # ---------------------------------------------------------------- Stubs

    def stub_gh(self, labels, pr_label_sets):
        """Put a script that imitates `gh` first on PATH."""
        labels_json = json.dumps([{"name": n} for n in labels])
        prs_json = json.dumps(
            [{"labels": [{"name": n} for n in names]} for names in pr_label_sets]
        )
        binder = self.root / "bin"
        binder.mkdir(exist_ok=True)
        script = binder / "gh"
        script.write_text(
            textwrap.dedent(f"""\
            #!/usr/bin/env python3
            import sys
            args = sys.argv[1:]
            if args[:2] == ["auth", "status"]:
                sys.exit(0)
            if args[:2] == ["label", "list"]:
                print({labels_json!r})
            elif args[:2] == ["pr", "list"]:
                print({prs_json!r})
            else:
                sys.exit(1)
            """),
            encoding="utf-8",
        )
        script.chmod(0o755)
        self.binder = binder

    # ------------------------------------------------------------- Runner

    def run_hook(self, command, gh=True):
        env = dict(os.environ)
        env["PATH"] = f"{self.binder}:{env['PATH']}" if gh else "/usr/bin:/bin"
        payload = {"tool_name": "Bash", "tool_input": {"command": command}}
        done = subprocess.run(
            [sys.executable, str(HOOK)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            cwd=self.root,
            env=env,
            timeout=60,
        )
        out = done.stdout.strip()
        return json.loads(out) if out else {}

    # ------------------------------------------------------------- Policy I/O

    def policy_path(self):
        return self.root / ".claude" / "pr-policy.json"

    def policy(self):
        return json.loads(self.policy_path().read_text(encoding="utf-8"))

    def write_policy(self, text):
        self.policy_path().parent.mkdir(parents=True, exist_ok=True)
        self.policy_path().write_text(text, encoding="utf-8")

    def seed_policy(self):
        """Register the policy exactly as blocking guidance presents it when a person chooses (1).

        Providing pasteable JSON is itself a contract. If it cannot be parsed,
        the guidance lied, so fail here.
        """
        reason = self.run_hook("gh pr create --title seed").get("reason", "")
        if "<<'EOF'" in reason:
            body = reason.split("<<'EOF'\n", 1)[1].split("\nEOF", 1)[0]
            json.loads(body)
        else:
            body = '{"version": 1, "rules": []}'
        self.write_policy(body)
        return json.loads(body)


class TestItOnlyWakesForPrCreate(PolicyCase):
    def test_other_bash_commands_are_ignored(self):
        for command in ("ls -la", "git push", "gh pr list", "gh issue create"):
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command), {})

    def test_nothing_is_written_for_unrelated_commands(self):
        self.run_hook("git push origin main")
        self.assertFalse(self.policy_path().exists())


class TestNoPolicyFileMeansNoPr(PolicyCase):
    """A missing policy file blocks PR creation, even when labels look correct.

    Do not generate it automatically: that produces green output before anyone
    reviews policy and is indistinguishable from a repository with no label policy.
    """

    def test_a_compliant_pr_is_still_blocked(self):
        result = self.run_hook('gh pr create --title t --label "@web" --label "bug"')
        self.assertEqual(result.get("decision"), "block")

    def test_it_does_not_write_the_file_by_itself(self):
        self.run_hook("gh pr create --title t")
        self.assertFalse(
            self.policy_path().exists(), "created the file before a human decided"
        )

    def test_it_shows_both_ways_out(self):
        reason = self.run_hook("gh pr create --title t")["reason"]
        self.assertIn("pr-policy.json", reason)
        self.assertIn(": >", reason, "does not explain the empty-file escape hatch")

    def test_the_suggestion_can_be_pasted_as_is(self):
        policy = self.seed_policy()
        self.assertEqual({r["group"] for r in policy["rules"]}, {"@", "_plain"})
        self.assertNotIn(
            "decision",
            self.run_hook('gh pr create --title t --label "@web" --label "bug"'),
        )

    def test_a_broken_file_is_not_a_bypass(self):
        self.write_policy("{ broken")
        result = self.run_hook('gh pr create --title t --label "@web" --label "bug"')
        self.assertEqual(result.get("decision"), "block")


class TestAnEmptyFileIsADecision(PolicyCase):
    """An empty file is a human declaration that this repository has no label policy."""

    def test_an_empty_file_lets_prs_through(self):
        self.write_policy("")
        self.assertNotIn("decision", self.run_hook("gh pr create --title t"))

    def test_whitespace_only_counts_as_empty(self):
        self.write_policy("\n  \n")
        self.assertNotIn("decision", self.run_hook("gh pr create --title t"))

    def test_it_stays_silent(self):
        self.write_policy("")
        self.assertEqual(self.run_hook("gh pr create --title t"), {})


class TestEnforcement(PolicyCase):
    def setUp(self):
        super().setUp()
        self.seed_policy()

    def test_a_compliant_pr_passes(self):
        result = self.run_hook('gh pr create --title t --label "@web" --label "bug"')
        self.assertNotIn("decision", result)

    def test_a_missing_group_is_blocked(self):
        result = self.run_hook('gh pr create --title t --label "bug"')
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("'@'", result["reason"])

    def test_equals_form_is_parsed(self):
        self.assertNotIn(
            "decision", self.run_hook("gh pr create --label=@web --label=bug")
        )


class TestDeclaredPolicyIsFoundFirst(PolicyCase):
    """A human declaration in documentation takes precedence over observation."""

    DOCS = {
        "CLAUDE.md": textwrap.dedent("""\
        ## PR 규칙

        ### 필수 레이블 (2개)

        1. Category: `feature`, `bug`
        2. Position: `@web`, `@server`, `@package`
        """)
    }

    def test_the_declaring_document_is_recorded(self):
        self.assertIn("CLAUDE.md", self.seed_policy()["declared_sources"])

    def test_a_declared_but_undefined_label_is_reported(self):
        """`@package` appears only in documentation, signaling stale documentation."""
        self.assertEqual(self.seed_policy()["phantom_labels"], ["@package"])

    def test_prose_identifiers_are_not_mistaken_for_labels(self):
        """A backticked token without a prefix may be a function name; do not promote it to a phantom label."""
        (self.root / "CLAUDE.md").write_text(
            "### 필수 레이블\n\n`check_file_content` 를 참고하라. `@web` 필수.\n",
            encoding="utf-8",
        )
        self.assertNotIn("check_file_content", self.seed_policy()["phantom_labels"])


class TestRepositoriesThatDoNotLabel(PolicyCase):
    """Generalization principle: do not force labels on repositories that do not use them."""

    PRS = [[]] * 10

    def test_no_rule_is_inferred(self):
        self.assertEqual(self.seed_policy()["rules"], [])

    def test_it_does_not_block(self):
        self.seed_policy()
        self.assertNotIn("decision", self.run_hook("gh pr create --title t"))


class TestWeakEvidenceWarnsInsteadOfBlocking(PolicyCase):
    """The warning interval sets rules without blocking (0.50 <= rate < 0.60).

    Without it, "warn and pass" is unreachable dead code. That happened when the
    inclusion and enforcement thresholds were equal.
    """

    DOCS = {"CLAUDE.md": "### 필수 레이블\n\n`@web` 과 `feature` 를 단다.\n"}
    PRS = [["@web", "feature"]] * 5 + [[]] * 5

    def test_a_rule_exists_but_is_not_enforced(self):
        policy = self.seed_policy()
        self.assertTrue(policy["rules"], "no rules were established; nothing to warn about")
        self.assertFalse(policy["enforced"])

    def test_it_warns_but_lets_the_pr_through(self):
        self.seed_policy()
        result = self.run_hook("gh pr create --title t")
        self.assertNotIn("decision", result)
        self.assertIn("too low to block", result.get("systemMessage", ""))


class TestDeltaDetection(PolicyCase):
    def test_a_new_label_refreshes_the_policy_and_reports_it(self):
        before = self.seed_policy()["fingerprint"]
        self.stub_gh(self.LABELS + ["@infra"], self.PRS)
        result = self.run_hook('gh pr create --title t --label "@web" --label "bug"')
        self.assertNotEqual(self.policy()["fingerprint"], before)
        self.assertIn("@infra", json.dumps(self.policy()["rules"], ensure_ascii=False))
        self.assertIn("refreshed", result.get("systemMessage", ""))

    def test_an_edited_policy_document_also_triggers_refresh(self):
        before = self.seed_policy()["fingerprint"]
        (self.root / "CONTRIBUTING.md").write_text(
            "### 필수 레이블\n\n`@web` 을 쓴다.\n", encoding="utf-8"
        )
        self.run_hook('gh pr create --title t --label "@web" --label "bug"')
        self.assertNotEqual(self.policy()["fingerprint"], before)

    def test_a_stale_policy_never_blocks_silently(self):
        """Silently blocking with stale policy is the failure this feature prevents."""
        self.seed_policy()
        # The group convention changed completely: @ prefixes became area:.
        self.stub_gh(["area:web", "bug", "feature"], [["area:web", "bug"]] * 10)
        result = self.run_hook(
            'gh pr create --title t --label "area:web" --label "bug"'
        )
        self.assertNotIn("decision", result)
        self.assertIn("refreshed", result.get("systemMessage", ""))


class TestGhOnboarding(PolicyCase):
    """Report missing or unauthenticated `gh` first; the tool comes before policy."""

    def test_a_missing_gh_still_blocks_when_nothing_is_registered(self):
        """A missing policy file is not a reason to pass, regardless of `gh`."""
        result = self.run_hook("gh pr create --title t", gh=False)
        self.assertEqual(result.get("decision"), "block")

    def test_it_says_how_to_install_and_authenticate(self):
        reason = self.run_hook("gh pr create --title t", gh=False)["reason"]
        self.assertIn("gh auth login", reason)
        self.assertRegex(reason, r"brew install gh|apt install gh|winget install")

    def test_it_still_offers_the_opt_out(self):
        """People who do not want to install `gh` need an escape path."""
        reason = self.run_hook("gh pr create --title t", gh=False)["reason"]
        self.assertIn(": >", reason)

    def test_it_never_installs_anything(self):
        before = subprocess.run(["which", "gh"], capture_output=True, text=True)
        self.run_hook("gh pr create --title t", gh=False)
        after = subprocess.run(["which", "gh"], capture_output=True, text=True)
        self.assertEqual(before.stdout, after.stdout)

    def test_a_registered_repo_does_not_need_gh(self):
        """Enforcement needs only the policy file; only discovery and delta use `gh`."""
        self.seed_policy()
        result = self.run_hook(
            'gh pr create --title t --label "@web" --label "bug"', gh=False
        )
        self.assertNotIn("decision", result)


class TestGhStateIsThreeValued(PolicyCase):
    """Measure the three `gh_state()` values **with stub PATH**.

    The prior version ran the whole hook with `gh=False` and inspected guidance
    only. Of the three values, only absent was exercised; unauthenticated was never
    reached, so deleting that branch stayed green. Exercise each value.

    Use separate processes because `shutil.which` sees **that process's PATH**;
    changing this process's PATH leaks into other tests.
    """

    def gh_state_with(self, path_value):
        code = (
            "import importlib.util, sys;"
            f"spec = importlib.util.spec_from_file_location('h', {str(HOOK)!r});"
            "m = importlib.util.module_from_spec(spec);"
            "spec.loader.exec_module(m);"
            "print(m.gh_state())"
        )
        env = dict(os.environ)
        env["PATH"] = path_value
        done = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True, text=True, cwd=self.root, env=env, timeout=60,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def stub_gh_auth(self, exit_code):
        """Create `gh` that exits `auth status` with the given code."""
        binder = self.root / "authbin"
        binder.mkdir(exist_ok=True)
        script = binder / "gh"
        # **Use `#!/bin/sh`.** `env python3` searches PATH again, but this test
        # narrows PATH to one stub. A missing interpreter makes exec fail and the
        # exception path in `gh_state()` turns it into unauthenticated, never
        # exercising ready (the original failure).
        script.write_text(f"#!/bin/sh\nexit {exit_code}\n", encoding="utf-8")
        script.chmod(0o755)
        return str(binder)

    def test_no_gh_on_path_is_absent(self):
        """With no `gh` on PATH, state is absent; its remedy differs from authentication."""
        empty = self.root / "emptybin"
        empty.mkdir(exist_ok=True)
        self.assertEqual(self.gh_state_with(str(empty)), "absent")

    def test_gh_that_fails_auth_status_is_unauthenticated(self):
        """When the binary exists but `auth status` fails, state is unauthenticated."""
        self.assertEqual(self.gh_state_with(self.stub_gh_auth(1)), "unauthenticated")

    def test_gh_that_passes_auth_status_is_ready(self):
        self.assertEqual(self.gh_state_with(self.stub_gh_auth(0)), "ready")

    def test_the_three_values_are_distinct(self):
        """Three distinct values are three states; merging two reduces the contract to a boolean."""
        empty = self.root / "emptybin2"
        empty.mkdir(exist_ok=True)
        got = [
            self.gh_state_with(str(empty)),
            self.gh_state_with(self.stub_gh_auth(1)),
            self.gh_state_with(self.stub_gh_auth(0)),
        ]
        self.assertEqual(len(set(got)), 3, got)

    def test_absent_and_unauthenticated_get_different_guidance(self):
        """States differ because remedies differ; verify that guidance differs too."""
        absent = self.run_hook("gh pr create --title t", gh=False)["reason"]
        self.assertIn("not installed", absent)
        self.assertNotIn("not authenticated", absent)


class TestTheCommandDirectoryDecides(PolicyCase):
    """The repository judged is the one `gh pr create` runs in, not the session's.

    An agent reaches another checkout with `cd <dir> && gh pr create`. Judging the
    session directory there blocked a compliant PR in a registered repository.
    """

    def setUp(self):
        super().setUp()
        self.other = self.root / "other"
        self.other.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=self.other, check=True)

    def declare_empty(self, repo):
        path = repo / ".claude" / "pr-policy.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    def run_payload(self, payload):
        env = dict(os.environ)
        env["PATH"] = f"{self.binder}:{env['PATH']}"
        done = subprocess.run(
            [sys.executable, str(HOOK)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            cwd=self.root,
            env=env,
            timeout=60,
        )
        out = done.stdout.strip()
        return json.loads(out) if out else {}

    def test_cd_into_a_registered_repository_uses_its_policy(self):
        self.declare_empty(self.other)
        self.assertEqual(self.run_hook(f"cd {self.other} && gh pr create --title t"), {})

    def test_cd_into_an_unregistered_repository_blocks_and_names_it(self):
        self.declare_empty(self.root)
        result = self.run_hook(f'cd "{self.other}" && gh pr create --title t')
        self.assertEqual(result.get("decision"), "block")
        self.assertIn(f"Repository: {self.other.resolve()}", result["reason"])

    def test_relative_cd_resolves_from_the_hook_directory(self):
        self.declare_empty(self.other)
        self.assertEqual(self.run_hook("cd other && gh pr create --title t"), {})

    def test_input_cwd_is_the_starting_directory(self):
        self.declare_empty(self.other)
        payload = {
            "tool_name": "Bash",
            "cwd": str(self.other),
            "tool_input": {"command": "gh pr create --title t"},
        }
        self.assertEqual(self.run_payload(payload), {})

    def test_a_cd_after_the_pr_command_is_ignored(self):
        self.declare_empty(self.other)
        result = self.run_hook(f"gh pr create --title t; cd {self.other}")
        self.assertEqual(result.get("decision"), "block")

    def test_an_unresolvable_cd_does_not_guess(self):
        self.declare_empty(self.other)
        result = self.run_hook("cd $JSTACK_SOMEWHERE && gh pr create --title t")
        self.assertEqual(result.get("decision"), "block")


if __name__ == "__main__":
    unittest.main(verbosity=2)
