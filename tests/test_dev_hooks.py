#!/usr/bin/env python3
"""Layer-one hook contracts of the dev layer.

Hooks from three legacy plugins (`model-version-checker` and `python-convention`)
were inherited here. This file measures conditions from the ledger
(see the hook contract).

1. **Emoji removal is an inheritance condition.** The plugin includes a No-Emoji
   enforcement hook, so emoji in feedback is self-violation.
2. **The model database lives under `scripts/`.** It shared the hook directory in
   the legacy plugin and split during migration. An unspecified path makes import
   fail silently and the following `sys.exit(0)` disables the checker.
3. **The Stop hook is off by default.** add+commit on every Stop competes with
   other worktrees. Measure the no-op condition in an isolated temporary repo;
   run it rather than trusting comments.
4. **Hooks read JSON from stdin.** `validate_before_publish.sh` once read a
   `TOOL_NAME` environment variable that the host does not provide (section 2 of
   VALIDATION-GATE-AUDIT.md). Measure behavior with a polluted environment.

    python3 tests/test_dev_hooks.py
"""

import contextlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HOOKS = ROOT / "hooks"
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
import models_database  # noqa: E402

EMOJI = re.compile("[\U0001f300-\U0001faff\u2600-\u27bf\u2b00-\u2bff\ufe0f]")


def run_hook(name: str, payload: dict, cwd=None, env=None):
    """Feed a payload to one hook and return stdout, stderr, and exit code unchanged.

    Select the interpreter by extension; the plugin has three shell hooks and they
    must follow the same stdin JSON protocol.
    """
    path = HOOKS / name
    if name == "validate_before_publish.sh" and cwd is not None:
        local = Path(cwd) / "hooks" / name
        local.parent.mkdir(exist_ok=True)
        local.write_bytes(path.read_bytes())
        path = local
    argv = [sys.executable, str(path)] if name.endswith(".py") else ["bash", str(path)]
    return subprocess.run(
        argv,
        input=json.dumps(payload) if payload is not None else "",
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(cwd) if cwd else None,
        env=env,
    )


def decision(result) -> str:
    """Extract decision from the first JSON object on stdout, or return empty."""
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            return json.loads(line).get("decision", "")
        except json.JSONDecodeError:
            continue
    return ""


GIT_ENV = {
    "GIT_AUTHOR_NAME": "probe",
    "GIT_AUTHOR_EMAIL": "probe@example.invalid",
    "GIT_COMMITTER_NAME": "probe",
    "GIT_COMMITTER_EMAIL": "probe@example.invalid",
    # Keep user-global settings (core.hooksPath, gpgsign, templates) out of fixtures.
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
}


def env_with(**extra) -> dict:
    return {**os.environ, **GIT_ENV, **extra}


def git(root, *args, env=None):
    return subprocess.run(
        ["git", *args],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=120,
        env=env or env_with(),
    )


@contextlib.contextmanager
def temp_repo():
    """Isolated Git repository; hooks are run for real only here.

    Running a Stop hook in a real repository creates a commit. A measurement that
    changes its target is not instrumentation.
    """
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw).resolve()
        git(root, "init", "-q", "-b", "main")
        (root / "seed.txt").write_text("seed\n", encoding="utf-8")
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "chore: seed")
        yield root


def commit_count(root) -> int:
    result = git(root, "rev-list", "--count", "HEAD")
    return int(result.stdout.strip() or 0)


@contextlib.contextmanager
def stub_claude(message: str):
    """Stub `claude` to measure the enabled path without a real model call."""
    with tempfile.TemporaryDirectory() as raw:
        stub = Path(raw) / "claude"
        stub.write_text(
            f"#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' '{message}'\n",
            encoding="utf-8",
        )
        stub.chmod(0o755)
        yield f"{raw}:{os.environ.get('PATH', '')}"


@contextlib.contextmanager
def stub_gh():
    """Reproduce the label hook's discovery path without external GitHub."""
    with tempfile.TemporaryDirectory() as raw:
        bin_dir = Path(raw) / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "gh"
        stub.write_text(
            "#!/bin/sh\n"
            "case \"$1 $2\" in\n"
            "  \"auth status\") exit 0;;\n"
            "  \"label list\") printf '%s\\n' '[{\"name\":\":cat\"},{\"name\":\":pos\"}]';;\n"
            "  \"pr list\") printf '%s\\n' '[{\"labels\":[{\"name\":\":cat\"}]}]';;\n"
            "  *) exit 0;;\n"
            "esac\n",
            encoding="utf-8",
        )
        stub.chmod(0o755)
        yield env_with(PATH=f"{bin_dir}:{os.environ.get('PATH', '')}")


def write(content: str) -> dict:
    return {
        "tool_name": "Write",
        "tool_input": {"file_path": "probe.py", "content": content},
    }


def bash(command: str) -> dict:
    return {"tool_name": "Bash", "tool_input": {"command": command}}


class TestTheHooksArrived(unittest.TestCase):
    #: Exact PreToolUse chain order; this is the judgment order.
    PRE = (
        "block_emoji.py",
        "hwpx_guard.py",
        "check_model_versions.py",
        "validate_uv_usage.py",
        "check_readme_version.py",
        "check_marketplace_versions.py",
        "ruff_check_before_commit.py",
        "validate_before_publish.sh",
        "validate_pr_label.py",
    )
    #: Per-event declarations. A file hook missing here runs without a contract.
    EXPECTED_BY_EVENT = {
        "PreToolUse": PRE,
        "PostToolUse": ("ruff_check_after_edit.py",),
        "Stop": ("commit-session.sh",),
        "SessionStart": ("load-recent-changes.sh", "ensure-statusline.mjs"),
    }
    EXPECTED = tuple(name for names in EXPECTED_BY_EVENT.values() for name in names)

    def test_every_inherited_hook_is_present(self):
        for name in self.EXPECTED:
            with self.subTest(hook=name):
                path = ROOT / "skills" / "hwpx" / "hooks" / name if name == "hwpx_guard.py" else HOOKS / name
                self.assertTrue(path.is_file())

    def test_the_model_database_is_in_scripts(self):
        self.assertTrue((SCRIPTS / "models_database.py").is_file())

    def test_hooks_json_registers_every_hook(self):
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        commands = json.dumps(document)
        for name in self.EXPECTED:
            with self.subTest(hook=name):
                self.assertIn(name, commands)

    def test_plugin_root_is_quoted_for_space_safe_hook_execution(self):
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        commands = [
            hook["command"]
            for entries in document["hooks"].values()
            for entry in entries
            for hook in entry.get("hooks", [])
            if "${CLAUDE_PLUGIN_ROOT}" in hook.get("command", "")
        ]
        self.assertTrue(commands)
        for command in commands:
            with self.subTest(command=command):
                self.assertIn('"${CLAUDE_PLUGIN_ROOT}/', command)

    @staticmethod
    def fired(event: str) -> list:
        """Return hooks actually fired by an event, in array order."""
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        names = []
        for entry in document["hooks"].get(event, []):
            for hook in entry.get("hooks", []):
                command = hook.get("command", "")
                if command:
                    names.append(command.split("/")[-1].strip("\"'"))
        return names

    def test_the_chain_order_follows_the_ledger(self):
        """Order is judgment order; measure the entire array.

        PreToolUse skips all later hooks after one blocks, so order is not a
        preference. Emoji comes first because its decision is most certain and
        least likely to break the chain by false positive. A stale model database
        can produce false positives and silently kill later hooks (ledger line 157,
        plan section 7).

        The last three also have deliberate positions. The two read-only version
        checks precede the **side-effecting** `ruff_check_before_commit`; if a
        commit will be blocked, block it before formatting and re-staging. The
        publish subprocess checker and networked label hook come last.
        """
        self.assertEqual(list(self.PRE), self.fired("PreToolUse"))

    def test_every_event_declared_is_the_event_present(self):
        """Measure missing events themselves; Stop and SessionStart once vanished."""
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(document["hooks"]), sorted(self.EXPECTED_BY_EVENT))
        for event, names in self.EXPECTED_BY_EVENT.items():
            with self.subTest(event=event):
                self.assertEqual(list(names), self.fired(event))

    def test_the_stop_hook_is_async_with_a_timeout(self):
        """Do not hold session termination; `claude -p` can take seconds."""
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        entry = document["hooks"]["Stop"][0]
        self.assertEqual(entry["matcher"], "")
        hook = entry["hooks"][0]
        self.assertTrue(hook["async"])
        self.assertEqual(hook["timeout"], 120)

    def test_session_start_only_fires_on_startup(self):
        """Do not inject context again on every `resume` or `clear`."""
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        self.assertEqual(document["hooks"]["SessionStart"][0]["matcher"], "startup")

    def test_every_hook_has_a_contract_block(self):
        """Do not create hooks that run without a contract (section 4.13.2)."""
        text = (HOOKS / "CONTRACT.md").read_text(encoding="utf-8")
        sections = {}
        for chunk in text.split("\n## ")[1:]:
            sections[chunk.split("\n", 1)[0].split()[0]] = chunk
        for name in self.EXPECTED:
            with self.subTest(hook=name):
                self.assertIn(name, sections, f"{name} has no contract block")
                block = sections[name]
                for key in ("matcher:", "block when:", "exit contract:"):
                    self.assertIn(key, block, f"{name} contract lacks {key}")


class TestNoEmojiSurvivedTheMigration(unittest.TestCase):
    """Inheritance condition: the No-Emoji enforcer must not emit emoji itself."""

    def files(self):
        """Count shell hooks too; one inherited hook once contained three emoji.

        This also suggested the file had never run: the repository shipped
        emoji-blocker while nobody had seen its output.
        (VALIDATION-GATE-AUDIT.md §2).
        """
        return (
            sorted(HOOKS.glob("*.py"))
            + sorted(HOOKS.glob("*.sh"))
            + sorted(SCRIPTS.glob("*.py"))
            + sorted(SCRIPTS.glob("*.sh"))
        )

    def test_no_hook_emits_an_emoji(self):
        offenders = []
        for path in self.files():
            hits = EMOJI.findall(path.read_text(encoding="utf-8"))
            if hits:
                offenders.append(f"{path.name}: {len(hits)} occurrences")
        self.assertEqual(offenders, [])

    def test_the_signal_survived_as_a_word(self):
        """Removing emoji can erase the signal; verify that a text prefix replaced it."""
        text = (HOOKS / "validate_uv_usage.py").read_text(encoding="utf-8")
        self.assertRegex(text, r"\[(WARN|HINT|NOTE|DOC|BLOCK|OK|FAIL)\]")


class TestTheModelCheckerStillJudges(unittest.TestCase):
    """Migration split the database path, and the checker silently died at that point."""

    def test_a_retired_model_is_blocked(self):
        self.assertEqual(
            run_hook(
                "check_model_versions.py", write('m = "claude-3-opus-20240229"')
            ).returncode,
            1,
        )

    def test_the_four_series_boundary_holds(self):
        self.assertEqual(
            run_hook(
                "check_model_versions.py", write('m = "claude-sonnet-4-6"')
            ).returncode,
            1,
        )
        self.assertEqual(
            run_hook(
                "check_model_versions.py", write('m = "claude-opus-4-8"')
            ).returncode,
            1,
        )
        self.assertEqual(
            run_hook(
                "check_model_versions.py", write('m = "claude-opus-5"')
            ).returncode,
            0,
        )

    def test_the_latest_gemini_passes(self):
        self.assertEqual(
            run_hook(
                "check_model_versions.py", write('m = "gemini-3.8-flash"')
            ).returncode,
            0,
        )

    def test_an_unknown_model_is_named(self):
        result = run_hook("check_model_versions.py", write('m = "claude-made-up-9-9"'))
        self.assertEqual(result.returncode, 0)
        self.assertIn("claude-made-up-9-9", result.stdout + result.stderr)

    def test_a_broken_database_path_is_reported_not_silent(self):
        """Do not record an import failure as a silent pass."""
        source = (HOOKS / "check_model_versions.py").read_text(encoding="utf-8")
        self.assertIn("no decision was made", source)
        self.assertIn("scripts", source)

    def test_current_roster_is_known_current(self):
        """Protect the 2026-09-29 tier refresh from becoming unknown or deprecated again."""
        names = (
            "claude-opus-5-5",
            "claude-opus-5",
            "claude-fable-5-1",
            "claude-sonnet-5",
            "claude-haiku-4-5",
            "gpt-6-astra",
            "gpt-6-sol",
            "gpt-6-luna",
            "gemini-3.8-flash",
            "qwen3.8-max",
            "glm-5.3",
        )
        for name in names:
            with self.subTest(model=name):
                deprecated, info = models_database.check_model_status(name)
                self.assertIsNotNone(info, f"{name} is missing from the model database")
                self.assertFalse(deprecated, f"{name} is marked deprecated")
                self.assertTrue(info.provider, f"{name} has no provider")

    def test_superseded_models_point_to_current_successors(self):
        """Every outdated or deprecated entry must name a replacement that is current."""
        for name, info in models_database.DEPRECATED_MODELS.items():
            if not info.replacement:
                continue
            with self.subTest(model=name):
                deprecated, target = models_database.check_model_status(info.replacement)
                self.assertIsNotNone(target, f"{name} points to unknown {info.replacement}")
                self.assertFalse(deprecated, f"{name} points to superseded {info.replacement}")

    def test_a_model_superseded_in_its_tier_is_blocked_with_its_successor(self):
        for name, successor in (("gpt-5.5", "gpt-6-astra"), ("glm-4.7", "glm-5.3-flash")):
            with self.subTest(model=name):
                result = run_hook("check_model_versions.py", write(f'm = "{name}"'))
                self.assertEqual(result.returncode, 1)
                self.assertIn(successor, result.stdout + result.stderr)

    def test_current_registry_target_has_no_upgrade_warning(self):
        result = run_hook("check_model_versions.py", write('m = "gpt-6-sol"'))
        self.assertEqual(result.returncode, 0)
        self.assertNotIn("UPGRADE", result.stdout + result.stderr)


class TestModelFindingsInDocumentsAreAdvisory(unittest.TestCase):
    """Documents and files outside the project mention models without calling them."""

    def _run(self, file_path, tool="Write"):
        payload = {"tool_name": tool, "tool_input": {"file_path": file_path, "content": 'm = "claude-sonnet-4-6"'}}
        return run_hook("check_model_versions.py", payload)

    def test_a_markdown_document_warns_without_blocking(self):
        result = self._run("docs/report.md")
        self.assertEqual(result.returncode, 0)
        self.assertIn("additionalContext", result.stdout)
        self.assertIn("claude-sonnet-4-6", result.stdout)

    def test_a_file_outside_the_project_warns_without_blocking(self):
        with tempfile.TemporaryDirectory() as outside:
            result = self._run(str(Path(outside) / "scratch.py"))
        self.assertEqual(result.returncode, 0)
        self.assertIn("additionalContext", result.stdout)

    def test_project_code_still_blocks(self):
        self.assertEqual(self._run("src/app.py").returncode, 1)

    def test_bash_still_blocks(self):
        result = run_hook("check_model_versions.py", bash('python run.py --model "claude-sonnet-4-6"'))
        self.assertEqual(result.returncode, 1)


class TestBashChecksModelSelectionNotMentions(unittest.TestCase):
    """A Bash command that only carries a model name as data, a search term, or text does not select a model."""

    def sample(self) -> str:
        for name in models_database.DEPRECATED_MODELS:
            old, info = models_database.check_model_status(name)
            if old and info and info.status == "outdated" and not info.warn_only and re.fullmatch(r"(claude|gpt|gemini)-[a-z0-9.-]+", name):
                return name
        self.fail("the database must carry an outdated, blocking provider-prefixed model")

    def test_a_command_that_only_mentions_a_model_passes(self):
        s = self.sample()
        for command in [
            f"grep -A6 '\"{s}\"' models_database.py",
            f"echo {s}",
            f'git commit -m "bump {s}"',
            f"grep -rn 'model=\"{s}\"' src/",
            f"rg '\"model\": \"{s}\"' logs/",
            f"jq -n '{{model: \"{s}\"}}'",
            f'echo "use --model {s}"',
            f'git commit -m "default model={s}"',
            f"python -m pytest -k {s}",
            f'git -c user.name=x commit -m "{s} is outdated"',
            f"git -C /tmp/repo log -S 'model=\"{s}\"'",
            f"find . -name '*.py' | xargs grep -l 'model=\"{s}\"'",
            f"LC_ALL=C grep -rn 'model=\"{s}\"' src",
            f"sed -n '/model=\"{s}\"/p' app.py",
            f'sqlite3 usage.db "select count(*) from runs where model = \'{s}\'"',
            f'gh pr create --title "drop {s}" --body "model={s} is retired"',
            f"cat README.md # see --model {s}",
            f"count=$(grep -c '{s}' usage.jsonl)",
            f'for m in {s} other; do grep -c "$m" usage.jsonl; done',
            f"pytest tests -k {s}",
        ]:
            result = run_hook("check_model_versions.py", bash(command))
            self.assertEqual(result.returncode, 0, command)
            self.assertNotIn("OUTDATED", result.stdout + result.stderr, command)

    def test_a_command_that_writes_a_model_name_warns_without_blocking(self):
        s = self.sample()
        for command in [
            f"cat > stats.json <<'EOF'\n{{\"models\": {{\"claude\": [[\"{s}\", 0.6]]}}}}\nEOF",
            f"cat > usage.jsonl <<'EOF'\n{{\"model\": \"{s}\", \"tokens\": 120}}\nEOF",
            f"cat > app.py <<'EOF'\nDEFAULT = \"{s}\"\nEOF",
            f"sed -i 's/NEW/{s}/' app.py",
            f"git commit -m \"$(cat <<'EOF'\nfix: drop {s}\nEOF\n)\"",
            f"sed -Ei 's/NEW/{s}/' app.py",
            f"yq -i '.model = \"{s}\"' config.yaml",
        ]:
            result = run_hook("check_model_versions.py", bash(command))
            self.assertEqual(result.returncode, 0, command)
            self.assertIn("additionalContext", result.stdout, command)
            self.assertIn(s, result.stdout, command)

    def test_a_command_that_selects_a_model_still_blocks(self):
        s = self.sample()
        for command in [
            f"python run.py --model={s}",
            f"python -c \"client.create(model='{s}')\"",
            f"curl -d '{{\"model\":\"{s}\"}}' https://api.example.invalid",
            f'codex exec -m {s} "fix the bug"',
            f"gemini -m {s} -p hi",
            f"python run.py --model {s} > out.log 2>&1",
            f"aider --model openai/{s}",
            f"claude -p hi --model anthropic/{s}",
            f'curl -d "{{\\"model\\": \\"{s}\\"}}" https://api.example.invalid',
            f"out=$(python run.py --model {s})",
            f"echo \"$(llm -m {s} 'hi')\"",
            f"echo '{{\"model\":\"{s}\"}}' | curl -d @- https://api.example.invalid",
            f"python - <<'EOF'\nclient.create(model=\"{s}\")\nEOF",
            f"grep x file; claude --model {s}",
            f"python eval.py --judge-model {s}",
            f"ollama run {s}",
            f"python run.py --model {s},",
            f"BODY=$(jq -n '{{model:\"{s}\"}}'); curl -d \"$BODY\" https://api.example.invalid",
            f"{{ echo '{{\"model\":\"{s}\"}}'; }} | curl -d @- https://api.example.invalid",
            f"pytest evals --model {s}",
            f"gh workflow run eval.yml -f model={s}",
            f"git bisect run python eval.py --model {s}",
        ]:
            result = run_hook("check_model_versions.py", bash(command))
            self.assertEqual(result.returncode, 1, command)
            self.assertIn(s, result.stdout + result.stderr, command)

    def test_a_profile_path_is_not_a_model(self):
        """A profile directory that ends like a model names a path, in a command or in written content (#144)."""
        s = self.sample()

        def write_to(file_path, content):
            return run_hook("check_model_versions.py", {"tool_name": "Write", "tool_input": {"file_path": file_path, "content": content}})

        for command in [
            f"CLAUDE_CONFIG_DIR=$HOME/.{s} claude plugin list",
            f'for d in ~/.claude ~/.{s}; do f=$d/x; python3 -c "print(1)"; done',
            f"python run.py --out results/{s}/out.json",
        ]:
            result = run_hook("check_model_versions.py", bash(command))
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""), command)
        for file_path in ["docs/setup.md", "src/profiles.py"]:
            result = write_to(file_path, f'PROFILE = "~/.{s}"  # plugins in ~/.{s}/plugins, results in results/{s}/')
            self.assertEqual((result.returncode, result.stdout), (0, ""), file_path)
        self.assertEqual(write_to("src/profiles.py", f'PROFILE = "~/.{s}"\nMODEL = "{s}"').returncode, 1)


class TestTheUvHookStillJudges(unittest.TestCase):
    def test_pip_is_blocked(self):
        self.assertIn(
            "block",
            run_hook("validate_uv_usage.py", bash("pip install requests")).stdout,
        )

    def test_uv_add_passes(self):
        self.assertNotIn(
            "block", run_hook("validate_uv_usage.py", bash("uv add requests")).stdout
        )

    def test_an_unrelated_command_passes(self):
        self.assertNotIn(
            "block", run_hook("validate_uv_usage.py", bash("ls -la")).stdout
        )

    def test_uv_pip_install_without_a_venv_is_blocked(self):
        """Measure the real warning path when the execution directory lacks .venv."""
        with tempfile.TemporaryDirectory() as raw:
            result = run_hook(
                "validate_uv_usage.py", bash("uv pip install requests"), cwd=raw
            )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(decision(result), "block")
        self.assertIn(".venv not found", result.stdout)


class TestHookInputDecisionMatrix(unittest.TestCase):
    """Measure block, warn, and explicit no-op stdin states through the real hook."""

    def test_unknown_model_is_a_nonblocking_warning_context(self):
        result = run_hook(
            "check_model_versions.py", write('m = "claude-made-up-9-9"')
        )
        self.assertEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertIn("hookSpecificOutput", payload)
        self.assertIn("additionalContext", payload["hookSpecificOutput"])
        self.assertIn("UNKNOWN", payload["hookSpecificOutput"]["additionalContext"])

    def test_pr_label_follows_cd_into_another_repository(self):
        with stub_gh() as env, temp_repo() as session, temp_repo() as target:
            policy_dir = target / ".claude"
            policy_dir.mkdir()
            (policy_dir / "pr-policy.json").write_text("", encoding="utf-8")
            command = f'cd "{target}" && gh pr create --title x'
            followed = run_hook("validate_pr_label.py", bash(command), cwd=session, env=env)
            self.assertEqual(followed.stdout, "")
            stayed = run_hook("validate_pr_label.py", bash("gh pr create --title x"), cwd=session, env=env)
            self.assertEqual(decision(stayed), "block")

    def test_pr_label_policy_states_are_block_empty_and_allow(self):
        payload = bash("gh pr create --title x")
        with stub_gh() as env, temp_repo() as root:
            missing = run_hook("validate_pr_label.py", payload, cwd=root, env=env)
            self.assertEqual(decision(missing), "block")

            policy_dir = root / ".claude"
            policy_dir.mkdir()
            policy = policy_dir / "pr-policy.json"
            policy.write_text("", encoding="utf-8")
            empty = run_hook("validate_pr_label.py", payload, cwd=root, env=env)
            self.assertEqual(empty.stdout, "")

            policy.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "fingerprint": "stale",
                        "observed_prs": 1,
                        "enforced": True,
                        "rules": [
                            {
                                "group": ":",
                                "requirement": "at_least_one",
                                "allowed": [":cat", ":pos"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            blocked = run_hook(
                "validate_pr_label.py",
                bash("gh pr create --title x --label :other"),
                cwd=root,
                env=env,
            )
            self.assertEqual(decision(blocked), "block")
            allowed = run_hook(
                "validate_pr_label.py",
                bash("gh pr create --title x --label :cat"),
                cwd=root,
                env=env,
            )
            self.assertEqual(allowed.stdout, "")


class TestTheStopHookIsOffByDefault(unittest.TestCase):
    """Measure by running the hook rather than reading comments.

    The Stop hook runs `git add -A` at every session end. When enabled it competes
    with edits and rebases in parallel worktrees and indiscriminately stages
    untracked files. **The default must be a no-op**, and that no-op must be
    measured. Check that the commit count stays unchanged in an isolated repository.
    """

    def test_nothing_is_committed_without_opt_in(self):
        with temp_repo() as root:
            (root / "dirty.txt").write_text("x\n", encoding="utf-8")
            before = commit_count(root)
            result = run_hook("commit-session.sh", None, cwd=root, env=env_with())
            self.assertEqual(result.returncode, 0)
            self.assertEqual(commit_count(root), before, "commit appeared without opt-in")
            self.assertEqual(result.stdout.strip(), "")

    def test_the_env_kill_switch_beats_the_marker_file(self):
        """An environment value of 0 wins even when the configuration file enables it."""
        with temp_repo() as root:
            (root / ".claude").mkdir()
            (root / ".claude" / "session-autocommit").write_text("", encoding="utf-8")
            (root / "dirty.txt").write_text("x\n", encoding="utf-8")
            before = commit_count(root)
            result = run_hook(
                "commit-session.sh",
                None,
                cwd=root,
                env=env_with(JSTACK_SESSION_AUTOCOMMIT="0"),
            )
            self.assertEqual(result.returncode, 0)
            self.assertEqual(commit_count(root), before)

    def test_the_guard_is_a_guard_not_a_corpse(self):
        """When enabled, it really commits; otherwise 'off by default' is meaningless.

        Stub `claude` to exercise the enabled path without a model call.
        """
        with temp_repo() as root, stub_claude("chore(probe): 스텁 메시지 추가") as path:
            (root / ".claude").mkdir()
            (root / ".claude" / "session-autocommit").write_text("", encoding="utf-8")
            (root / "dirty.txt").write_text("x\n", encoding="utf-8")
            before = commit_count(root)
            result = run_hook(
                "commit-session.sh", None, cwd=root, env=env_with(PATH=path)
            )
            self.assertEqual(result.returncode, 0)
            self.assertEqual(commit_count(root), before + 1)
            body = git(root, "log", "-1", "--pretty=%B").stdout
            self.assertIn("chore(probe): 스텁 메시지 추가", body)
            self.assertIn("Auto-Session-Commit: true", body)

    def test_the_env_var_alone_turns_it_on(self):
        with (
            temp_repo() as root,
            stub_claude("chore(probe): 환경변수 경로 추가") as path,
        ):
            (root / "dirty.txt").write_text("x\n", encoding="utf-8")
            before = commit_count(root)
            run_hook(
                "commit-session.sh",
                None,
                cwd=root,
                env=env_with(PATH=path, JSTACK_SESSION_AUTOCOMMIT="1"),
            )
            self.assertEqual(commit_count(root), before + 1)

    def test_this_repository_did_not_opt_in(self):
        """This repository did not opt in; the marker file must be absent."""
        self.assertFalse(
            (ROOT.parent.parent / ".claude" / "session-autocommit").exists()
        )

    def test_the_no_verify_bypass_is_documented(self):
        """Ledger line 453: there are two bypass paths and both must be documented."""
        source = (HOOKS / "commit-session.sh").read_text(encoding="utf-8")
        self.assertIn("--no-verify", source)
        contract = (HOOKS / "CONTRACT.md").read_text(encoding="utf-8")
        block = contract.split("\n## commit-session.sh", 1)[1]
        self.assertIn("--no-verify", block)
        self.assertIn("block_emoji.py", block)
        self.assertIn("Bash tool", block)


class TestSessionStartLoadsTheRecentPast(unittest.TestCase):
    def test_recent_commits_reach_the_context(self):
        with temp_repo() as root:
            (root / "a.txt").write_text("a\n", encoding="utf-8")
            git(root, "add", "-A")
            git(root, "commit", "-q", "-m", "feat: 표식이 되는 커밋 추가")
            result = run_hook("load-recent-changes.sh", None, cwd=root, env=env_with())
            self.assertEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            self.assertIn("표식이 되는 커밋", payload["additionalContext"])

    def test_the_changelog_tail_is_included(self):
        with temp_repo() as root:
            (root / "docs").mkdir()
            (root / "docs" / "CHANGELOG.md").write_text(
                "# CHANGELOG\n\n- 표식이 되는 변경 기록\n", encoding="utf-8"
            )
            result = run_hook("load-recent-changes.sh", None, cwd=root, env=env_with())
            payload = json.loads(result.stdout)
            self.assertIn("표식이 되는 변경 기록", payload["additionalContext"])

    def test_it_stays_silent_outside_a_repository_instead_of_dying(self):
        """One line fixed during inheritance.

        The original used `REPO_ROOT="$CLAUDE_PROJECT_DIR"`; under `set -u`, an
        unset variable made the hook fail. Failing to load context differs from
        the hook dying.
        """
        with tempfile.TemporaryDirectory() as raw:
            env = env_with()
            env.pop("CLAUDE_PROJECT_DIR", None)
            result = run_hook("load-recent-changes.sh", None, cwd=raw, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "")


def seed_plugin(
    root,
    name="probe",
    version="1.0.0",
    readme=True,
    root_table=True,
    marketplace_version=None,
):
    """Create a repository with one plugin, the shared fixture for two version gates."""
    plugin = root / "plugins" / name
    (plugin / ".claude-plugin").mkdir(parents=True)
    (plugin / ".claude-plugin" / "plugin.json").write_text(
        json.dumps({"name": name, "description": "d", "version": version}),
        encoding="utf-8",
    )
    if readme:
        (plugin / "README.md").write_text(
            f"# {name}\n\n## v{version}\n\n- 최초\n", encoding="utf-8"
        )
    if root_table:
        (root / "README.md").write_text(
            f"| plugin | version |\n|---|---|\n| {name} | {version} |\n",
            encoding="utf-8",
        )
    (root / ".claude-plugin").mkdir(exist_ok=True)
    (root / ".claude-plugin" / "marketplace.json").write_text(
        json.dumps(
            {"plugins": [{"name": name, "version": marketplace_version or version}]}
        ),
        encoding="utf-8",
    )
    git(root, "add", "-A")
    return plugin


class TestTheReadmeVersionHookStillJudges(unittest.TestCase):
    """One of the two gates confirmed live by audit section 5; verify it survived inheritance."""

    COMMIT = {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}

    def test_a_plugin_without_a_readme_blocks_the_commit(self):
        with temp_repo() as root:
            seed_plugin(root, readme=False)
            result = run_hook("check_readme_version.py", self.COMMIT, cwd=root)
            self.assertEqual(decision(result), "block")
            self.assertIn("README.md missing", result.stdout)

    def test_a_stale_root_table_blocks_the_commit(self):
        with temp_repo() as root:
            plugin = seed_plugin(root, version="2.0.0")
            (root / "README.md").write_text(
                "| plugin | version |\n|---|---|\n| probe | 1.0.0 |\n",
                encoding="utf-8",
            )
            git(root, "add", "-A")
            self.assertTrue(plugin.is_dir())
            result = run_hook("check_readme_version.py", self.COMMIT, cwd=root)
            self.assertEqual(decision(result), "block")

    def test_a_consistent_plugin_passes(self):
        with temp_repo() as root:
            seed_plugin(root)
            result = run_hook("check_readme_version.py", self.COMMIT, cwd=root)
            self.assertEqual(decision(result), "")

    def test_a_command_that_is_not_a_commit_passes(self):
        with temp_repo() as root:
            seed_plugin(root, readme=False)
            result = run_hook("check_readme_version.py", bash("ls -la"), cwd=root)
            self.assertEqual(decision(result), "")

    def test_the_block_message_says_warn_and_that_is_a_trap(self):
        """The prefix is [WARN] but the decision is block; does the contract record this trap?"""
        contract = (HOOKS / "CONTRACT.md").read_text(encoding="utf-8")
        block = contract.split("\n## check_readme_version.py", 1)[1]
        self.assertIn("[WARN]", block)


class TestTheMarketplaceVersionHookStillJudges(unittest.TestCase):
    """The blocker demonstrated **live** by audit section 5. This is also the
    repository's only direct evidence that `{"decision":"block"}` is valid."""

    PUSH = {"tool_name": "Bash", "tool_input": {"command": "git push origin HEAD"}}

    def test_a_version_mismatch_blocks_the_push(self):
        with temp_repo() as root:
            seed_plugin(root, version="1.0.0", marketplace_version="9.9.9")
            result = run_hook("check_marketplace_versions.py", self.PUSH, cwd=root)
            self.assertEqual(decision(result), "block")
            self.assertIn("9.9.9", result.stdout)

    def test_matching_versions_pass(self):
        with temp_repo() as root:
            seed_plugin(root, version="1.0.0")
            result = run_hook("check_marketplace_versions.py", self.PUSH, cwd=root)
            self.assertEqual(decision(result), "")

    def test_a_command_that_is_not_a_push_passes(self):
        with temp_repo() as root:
            seed_plugin(root, version="1.0.0", marketplace_version="9.9.9")
            result = run_hook("check_marketplace_versions.py", bash("ls"), cwd=root)
            self.assertEqual(decision(result), "")


class TestValidateBeforePublishReadsStdinNotTheEnvironment(unittest.TestCase):
    """Hook that was dead at inheritance (VALIDATION-GATE-AUDIT.md section 2).

    The old version read `TOOL_NAME`, which the host does not provide. It was always
    `unknown` and exited 0 at the first branch: a missing path passed publish and
    zero output hid the defect.
    """

    PUBLISH = {
        "tool_name": "Bash",
        "tool_input": {
            "command": "bash scripts/register_local.sh /nonexistent/plugin"
        },
    }

    def test_a_missing_plugin_directory_is_blocked(self):
        result = run_hook("validate_before_publish.sh", self.PUBLISH)
        self.assertEqual(result.returncode, 1)
        self.assertIn("[BLOCK]", result.stdout)

    def test_a_poisoned_tool_name_env_var_does_not_disable_it(self):
        """Lock the exact form of the former dead path."""
        result = run_hook(
            "validate_before_publish.sh",
            self.PUBLISH,
            env={**os.environ, "TOOL_NAME": "unknown", "TOOL_PARAMS": ""},
        )
        self.assertEqual(result.returncode, 1)

    @staticmethod
    def seed_validator(root, exit_code: int):
        """Place a checker stub in the disposable plugin's author skill."""
        script = root / "skills" / "author" / "scripts"
        script.mkdir(parents=True, exist_ok=True)
        path = script / "validate_plugin.sh"
        path.write_text(
            f"#!/usr/bin/env bash\necho '[FAIL] probe'\nexit {exit_code}\n",
            encoding="utf-8",
        )
        path.chmod(0o755)
        return path

    def test_a_passing_validator_lets_the_publish_through(self):
        """Does it really call the checker? The pass message must come from execution."""
        with temp_repo() as root:
            plugin = seed_plugin(root)
            self.seed_validator(root, 0)
            payload = bash(f"bash scripts/register_local.sh {plugin}")
            result = run_hook("validate_before_publish.sh", payload, cwd=root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("[HOOK] Pre-publish format validation", result.stdout)
            self.assertIn("Validation passed", result.stdout)

    def test_quoted_space_path_is_checked_like_a_plain_path_in_a_compound_command(self):
        """A quoted path with spaces is one token and receives the same checker decision."""
        with temp_repo() as root:
            plain = root / "plain-plugin"
            spaced = root / "plugin with spaces"
            plain.mkdir()
            spaced.mkdir()
            self.seed_validator(root, 0)

            for command in (
                f"cd / && bash scripts/register_local.sh {plain}",
                f'cd / && bash scripts/register_local.sh "{spaced}"',
            ):
                result = run_hook(
                    "validate_before_publish.sh", bash(command), cwd=root
                )
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn("Validation passed", result.stdout)

    def test_relative_target_after_cd_uses_the_compound_command_working_directory(self):
        with temp_repo() as root:
            workspace = root / "workspace"
            plugin = workspace / "relative-plugin"
            plugin.mkdir(parents=True)
            self.seed_validator(root, 0)
            result = run_hook(
                "validate_before_publish.sh",
                bash(
                    "cd workspace && "
                    "bash scripts/register_local.sh relative-plugin"
                ),
                cwd=root,
            )
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertIn(str(plugin), result.stdout)

    def test_unrelated_command_substitution_remains_a_silent_noop(self):
        result = run_hook("validate_before_publish.sh", bash("echo $(date)"))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_malformed_publish_target_is_blocked_without_executing_shell_text(self):
        """Missing arguments and unclosed quotes must not fail open."""
        with tempfile.TemporaryDirectory() as raw:
            marker = Path(raw) / "should-not-exist"
            commands = (
                "bash scripts/register_local.sh",
                f'bash scripts/register_local.sh; touch "{marker}"',
                'bash scripts/register_local.sh "unterminated',
                f'bash scripts/register_local.sh "$(touch {marker})"',
            )
            for command in commands:
                result = run_hook(
                    "validate_before_publish.sh", bash(command), cwd=raw
                )
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertIn("Could not safely parse", result.stdout)
            self.assertFalse(marker.exists())

    def test_a_failing_validator_blocks_the_publish(self):
        with temp_repo() as root:
            plugin = seed_plugin(root)
            self.seed_validator(root, 1)
            payload = bash(f"bash scripts/register_local.sh {plugin}")
            result = run_hook("validate_before_publish.sh", payload, cwd=root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("[BLOCK] Validation failed", result.stdout)
            self.assertIn("Reproduce manually", result.stdout)

    def test_a_missing_validator_blocks_rather_than_passes(self):
        """The only non-fail-open point in the chain; measure that it really is so."""
        with temp_repo() as root:
            plugin = seed_plugin(root)
            payload = bash(f"bash scripts/register_local.sh {plugin}")
            result = run_hook("validate_before_publish.sh", payload, cwd=root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("Format validator not found", result.stdout)

    def test_an_unrelated_command_is_silent(self):
        result = run_hook("validate_before_publish.sh", bash("ls -la"))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_a_non_bash_tool_is_silent(self):
        result = run_hook("validate_before_publish.sh", write("x = 1"))
        self.assertEqual(result.returncode, 0)

    def test_unparseable_input_does_not_crash(self):
        result = subprocess.run(
            ["bash", str(HOOKS / "validate_before_publish.sh")],
            input="not json at all",
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(result.returncode, 0)

    def test_the_plugin_relative_validator_is_documented(self):
        """The contract identifies the shipped plugin-relative validator."""
        contract = (HOOKS / "CONTRACT.md").read_text(encoding="utf-8")
        block = contract.split("\n## validate_before_publish.sh", 1)[1]
        self.assertIn("plugin-relative", block)
        self.assertIn("skills/author/scripts/validate_plugin.sh", block)


if __name__ == "__main__":
    unittest.main(verbosity=2)
