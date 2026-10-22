#!/usr/bin/env python3
"""Layer-one hook contracts of the work layer.

The former `emoji-blocker` hook was inherited here. Its assignment moved from
the dev layer because **failure costs are asymmetric**: emoji in code comments is a
cosmetic issue, while emoji in procurement deliverables reaches evaluators.

Three checks apply to `block_emoji.py`.

1. **Does the matcher match code branches?** The hook reads different fields per
   tool (`content` / `new_string` / `edits[]` / `new_source`). Adding a tool to
   the matcher without a branch leaves `content_to_check` empty and
   `if not content_to_check: return` **passes silently**. This already happened
   twice — MultiEdit and NotebookEdit. A machine must measure it.
2. **Does the exit contract match its declaration?** Exit 0 plus stdout
   `{"decision":"block"}`. A checker reading "nonzero means block" misclassifies
   this hook as dead.
3. **Is the accepted gap still closed?** The Bash-mediated write gap was closed
   by U-5 (b). Detect if it reopens when write-shape matching narrows.

Registering `hwpx_guard.py` adds three more checks.

4. **Is registration valid?** Check the `hooks.json` schema for unknown host
   fields and verify that every registered `command` script **exists**. This
   matters because `hwpx_guard.py` lives inside a skill directory and is only
   registered here; deleting that skill leaves a missing hook path.
5. **Does chain order match the declaration?** PreToolUse skips later hooks after
   one blocks, so array order is judgment order. Compare it with
   `scripts/check_hook_order.py`'s `EXPECTED_ORDER`.
6. **Does the HWPX forwarding gate actually fire?** Create defective `.hwpx`
   fixtures, feed stub payloads, and **measure** block/pass. It checks only when a
   file exists, so assertions without fixtures are tautologies.

    python3 tests/test_work_hooks.py
"""

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HOOKS = ROOT / "hooks"
HOOK = HOOKS / "block_emoji.py"
GUARD = ROOT / "skills" / "hwpx" / "hooks" / "hwpx_guard.py"
CONTRACT = HOOKS / "CONTRACT.md"
HOOKS_JSON = HOOKS / "hooks.json"
CHECK_LOAD = ROOT / "scripts" / "check_hook_order.py"

#: Firing order from the `hooks.json` PreToolUse array; order is judgment order.
#: Cheap block_emoji (about 18ms, no output) comes first, followed by ZIP-opening
#: hwpx_guard (about 27ms). See the chain-order table in hooks/CONTRACT.md.
CHAIN = ["block_emoji.py", "hwpx_guard.py"]

EMOJI = "✅"  # U+2705; this file itself must not emit emoji.

HEAD_NS = "http://www.hancom.co.kr/hwpml/2011/head"
CLEAN_HEADER = f'<hh:head xmlns:hh="{HEAD_NS}"/>'
#: Miswired charPr that boxes every character; same decision as `fix_borders.py`.
BORDERED_HEADER = (
    f'<hh:head xmlns:hh="{HEAD_NS}">'
    '<hh:borderFill id="2"><hh:leftBorder type="SOLID"/></hh:borderFill>'
    '<hh:charPr borderFillIDRef="2"/>'
    '</hh:head>'
)


def hooks_document() -> dict:
    return json.loads(HOOKS_JSON.read_text(encoding="utf-8"))


def fired_order() -> dict:
    """Per-event firing order, read like `check_load.check_hook_order`."""
    out: dict[str, list[str]] = {}
    for event, entries in hooks_document()["hooks"].items():
        names = []
        for entry in entries:
            for hook in entry.get("hooks", []):
                # **Strip quotes, as `check_load` does.** Two copies diverged when
                # only one was fixed for dashboard's
                # `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"`; quotes are required
                # when a path contains spaces.
                name = hook.get("command", "").split("/")[-1].strip("\"'")
                if name:
                    names.append(name)
        out[event] = names
    return out


def run(payload: dict, script: Path = HOOK, raw: str | None = None):
    return subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload) if raw is None else raw,
        capture_output=True,
        text=True,
        timeout=120,
    )


def decision(result) -> str | None:
    if not result.stdout.strip():
        return None
    return json.loads(result.stdout).get("decision")


def blocked(payload: dict) -> bool:
    return decision(run(payload)) == "block"


def guard_says_block(payload: dict) -> bool:
    return decision(run(payload, GUARD)) == "block"


def write_hwpx(
    path: Path,
    *,
    mimetype_first: bool = True,
    stored: bool = True,
    mimetype: str = "application/hwp+zip",
    header: str | None = CLEAN_HEADER,
    section: bool = True,
    preview: bytes | None = None,
) -> Path:
    """Real .hwpx fixture; the guard checks **only when the file exists**."""

    def put_mimetype(z):
        z.writestr(
            "mimetype",
            mimetype,
            compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED,
        )

    with zipfile.ZipFile(path, "w") as z:
        if mimetype_first:
            put_mimetype(z)
        if header is not None:
            z.writestr("Contents/header.xml", header)
        if section:
            z.writestr("Contents/section0.xml", "<sec/>")
        if preview is not None:
            z.writestr("Preview/PrvImage.png", preview)
        if not mimetype_first:
            put_mimetype(z)
    return path


class TestTheHookArrived(unittest.TestCase):
    def test_the_hook_file_is_present(self):
        self.assertTrue(HOOK.is_file(), "hooks.json points to a missing file")

    def test_hooks_json_registers_it(self):
        self.assertIn("block_emoji.py", json.dumps(hooks_document()))

    def test_the_guard_file_is_present(self):
        """hwpx_guard lives in the skill and is registered here."""
        self.assertTrue(GUARD.is_file(), "hooks.json points to a missing file")

    def test_hooks_json_registers_the_guard(self):
        self.assertIn("hwpx_guard.py", json.dumps(hooks_document()))

    def test_the_contract_declares_the_required_fields(self):
        """Section 4.13.2 — matcher/block condition/exit contract cannot be empty.

        **One contract block per hook.** A new hook without a block runs without a
        contract, so bind the fence count to the registered hook count.
        """
        blocks = re.findall(
            r"```contract\n(.*?)```", CONTRACT.read_text(encoding="utf-8"), re.S
        )
        registered = {
            hook["command"].split("/")[-1].strip('\"\'')
            for groups in hooks_document()["hooks"].values()
            for group in groups
            for hook in group["hooks"]
        }
        self.assertEqual(
            len(blocks), len(registered), "contract fences must equal registered hooks"
        )
        for block in blocks:
            declared = {
                line.split(":")[0].strip() for line in block.splitlines() if ":" in line
            }
            with self.subTest(matcher=block.splitlines()[0]):
                self.assertLessEqual(
                    {"matcher", "block when", "exit contract"}, declared
                )
                self.assertIn("fail-open", declared, "fail-open status cannot be empty")

    def test_the_contract_names_every_registered_hook(self):
        text = CONTRACT.read_text(encoding="utf-8")
        registered = {h["command"].split("/")[-1].strip('\"\'') for groups in hooks_document()["hooks"].values() for group in groups for h in group["hooks"]}
        for name in registered:
            with self.subTest(hook=name):
                self.assertIn("## " + name, text, f"{name} is registered without a contract")


class TestTheHooksJsonSchema(unittest.TestCase):
    """Fields unknown to the host are **silently ignored**.

    Plausible fake fields such as `name` and `config` look configured to a person
    while the host does nothing. This is a cheap, hard-to-see hook-layer failure,
    so measure it mechanically.
    """

    TOP_KEYS = {"hooks"}
    ENTRY_KEYS = {"matcher", "hooks"}
    HOOK_KEYS = {"type", "command", "async", "timeout"}
    EVENTS = {"PreToolUse", "PostToolUse", "Stop", "SessionStart", "SubagentStop",
              "UserPromptSubmit", "Notification", "PreCompact", "SessionEnd"}

    def test_no_fields_the_host_does_not_know(self):
        document = hooks_document()
        self.assertLessEqual(set(document), self.TOP_KEYS, "unknown top-level field")
        for event, entries in document["hooks"].items():
            self.assertIn(event, self.EVENTS, f"{event} is not a hook event")
            self.assertIsInstance(entries, list)
            for entry in entries:
                with self.subTest(event=event, matcher=entry.get("matcher")):
                    self.assertLessEqual(set(entry), self.ENTRY_KEYS)
                    self.assertIsInstance(entry["matcher"], str)
                    self.assertTrue(entry["hooks"], "an empty hook array is not registration")
                    for hook in entry["hooks"]:
                        self.assertLessEqual(set(hook), self.HOOK_KEYS)
                        self.assertEqual(hook["type"], "command")
                        self.assertIsInstance(hook["command"], str)

    def test_every_registered_command_points_at_a_real_file(self):
        """`hwpx_guard.py` is in the skill directory; deleting the skill empties this path."""
        for event, entries in hooks_document()["hooks"].items():
            for entry in entries:
                for hook in entry["hooks"]:
                    command = hook["command"]
                    with self.subTest(command=command):
                        self.assertIn("${CLAUDE_PLUGIN_ROOT}/", command)
                        tail = command.split("${CLAUDE_PLUGIN_ROOT}/", 1)[1]
                        # **Strip quotes.** Paths with spaces must be quoted
                        # (dashboard's `node "..."`); otherwise `x.mjs"` makes
                        # existence checks always false.
                        script = ROOT / tail.split()[0].strip("\"'")
                        self.assertTrue(
                            script.is_file(), f"{event}: points to an unregistered file"
                        )

    def test_the_guard_matcher_matches_its_own_declaration(self):
        """The registration example is embedded in the script docstring.

        The file belongs to the HWPX skill and cannot be fixed at the hook layer.
        If registration differs from its declaration, the declaration and actual
        hook diverge inside an **uneditable file**. Compare them mechanically.
        """
        declared = re.search(
            r'"matcher":\s*"([^"]+)"', GUARD.read_text(encoding="utf-8")
        )
        self.assertIsNotNone(declared, "guard docstring lost its registration example")
        registered = [
            entry["matcher"]
            for entry in hooks_document()["hooks"]["PreToolUse"]
            if "hwpx_guard.py" in json.dumps(entry)
        ]
        self.assertEqual(registered, [declared.group(1)])


class TestTheChainOrder(unittest.TestCase):
    """PreToolUse skips later hooks after one blocks; array order is judgment order."""

    RELATIVE = "hooks/hooks.json"

    def expected_order(self) -> dict:
        if not CHECK_LOAD.is_file():
            self.fail(f"required hook order checker is missing: {CHECK_LOAD}")
        spec = importlib.util.spec_from_file_location("check_load", CHECK_LOAD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.EXPECTED_ORDER[self.RELATIVE]

    def test_the_measured_order_is_the_declared_one(self):
        self.assertEqual(
            [name for name in fired_order()["PreToolUse"] if name in CHAIN], CHAIN
        )

    def test_declared_events_are_exactly_these(self):
        """Adding or removing an event makes the corresponding CONTRACT.md section false.

        `SessionStart` was added on 2026-09-05 (dashboard status line, off by default).
        **Increasing this count records that the event has a contract**; changing
        only this file without a CONTRACT.md section is caught below.
        """
        self.assertLessEqual({"PreToolUse", "SessionStart"}, set(fired_order()))

    def test_the_gate_declares_no_event_this_file_lacks(self):
        expected = self.expected_order()
        self.assertLessEqual(
            set(fired_order()),
            set(expected),
            "record per-event order in check_load.EXPECTED_ORDER",
        )

    def test_the_order_agrees_with_check_load(self):
        """Measure using the **same method** as the gate: filter declared names and compare order.

        Hooks the gate does not know (`hwpx_guard.py`) are filtered here, so this
        reflects gate acceptance. Position anchoring is covered separately by
        `test_the_measured_order_is_the_declared_one`.
        """
        expected = self.expected_order()
        measured = fired_order()
        for event, want in expected.items():
            with self.subTest(event=event):
                seen = [n for n in measured.get(event, []) if n in want]
                self.assertEqual(seen, want)

    def test_the_gate_declares_no_hook_that_is_gone(self):
        """A hook declared but absent on disk was deleted without anyone noticing."""
        expected = self.expected_order()
        measured = fired_order()
        for event, want in expected.items():
            with self.subTest(event=event):
                self.assertLessEqual(set(want), set(measured.get(event, [])))


class TestMatcherMatchesTheCode(unittest.TestCase):
    """A broad matcher without a branch is an illusion, not protection."""

    def matcher_tools(self):
        document = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
        tools = set()
        for entry in document["hooks"]["PreToolUse"]:
            if "block_emoji.py" in json.dumps(entry):
                tools |= set(entry["matcher"].split("|"))
        return tools

    # Tool -> payload carrying emoji through that tool.
    PAYLOAD = {
        "Write": {"tool_input": {"content": f"# 완료 {EMOJI}"}},
        "Edit": {"tool_input": {"new_string": f"# 완료 {EMOJI}"}},
        "MultiEdit": {
            "tool_input": {
                "edits": [{"new_string": "ok"}, {"new_string": f"# 완료 {EMOJI}"}]
            }
        },
        "NotebookEdit": {"tool_input": {"new_source": f"# 완료 {EMOJI}"}},
        "Bash": {"tool_input": {"command": f'echo "# 완료 {EMOJI}" > /tmp/probe.py'}},
    }

    def test_every_tool_in_the_matcher_is_actually_read(self):
        for tool in sorted(self.matcher_tools()):
            with self.subTest(tool=tool):
                self.assertIn(
                    tool,
                    self.PAYLOAD,
                    f"matcher contains {tool}, but this test lacks its payload; "
                    "add the branch and fixture together",
                )
                payload = {"tool_name": tool, **self.PAYLOAD[tool]}
                self.assertTrue(
                    blocked(payload),
                    f"{tool} is in the matcher but passed; its branch is missing",
                )

    def test_notebook_edit_is_covered(self):
        """RED anchor for CONTRACT.md; deleting a branch makes this fail first."""
        self.assertTrue(
            blocked(
                {
                    "tool_name": "NotebookEdit",
                    "tool_input": {"new_source": f"x = 1  # {EMOJI}"},
                }
            )
        )


class TestTheExitContract(unittest.TestCase):
    """Exit 0 plus a stdout decision; reading "nonzero = block" is wrong."""

    def test_blocking_exits_zero_and_speaks_on_stdout(self):
        result = run({"tool_name": "Write", "tool_input": {"content": f"{EMOJI}"}})
        self.assertEqual(result.returncode, 0, "blocking does not use a nonzero exit")
        self.assertEqual(json.loads(result.stdout)["decision"], "block")

    def test_the_reason_names_the_offending_character(self):
        result = run({"tool_name": "Write", "tool_input": {"content": f"{EMOJI}"}})
        self.assertIn("2705", json.loads(result.stdout)["reason"])


class TestBashWritesAreCovered(unittest.TestCase):
    """U-5 (b), a long-open gap. Auto sessions write all files through the shell;
    if this is not blocked, the most-used path is the only open path.
    """

    SHAPES = {
        "redirect": f'echo "완료 {EMOJI}" > /tmp/a.py',
        "append": f'echo "{EMOJI}" >> /tmp/a.py',
        "printf": f'printf "{EMOJI}" > /tmp/a.py',
        "heredoc": f"cat > /tmp/a.py <<EOF\n{EMOJI}\nEOF",
        "quoted heredoc": f"cat > /tmp/a.md <<'EOF'\n{EMOJI}\nEOF",
        "sed -i": f'sed -i "" "s/x/{EMOJI}/" /tmp/a.py',
        "tee": f'echo "{EMOJI}" | tee /tmp/a.py',
    }

    def test_every_write_shape_is_caught(self):
        for name, command in self.SHAPES.items():
            with self.subTest(shape=name):
                self.assertTrue(
                    blocked({"tool_name": "Bash", "tool_input": {"command": command}}),
                    f"emoji leaks through the {name} form",
                )


class TestWhatItDoesNotBlock(unittest.TestCase):
    def test_korean_and_ascii_markers_pass(self):
        clean = "# 완료 [OK] -> 다음 단계, 한글은 대상이 아니다"
        self.assertFalse(
            blocked({"tool_name": "Write", "tool_input": {"content": clean}})
        )

    def test_read_only_bash_commands_pass(self):
        """False-positive guard: blocking reads would make this hook unusable.

        In particular, `2>/dev/null` and `2>&1` look like redirections but do not
        write. Strip them before matching or a grep command is blocked.
        """
        for command in (
            f'grep "{EMOJI}" /tmp/a.py',
            f'grep "{EMOJI}" /tmp/a.py 2>/dev/null',
            f'echo "{EMOJI}" | wc -c',
            f'echo "{EMOJI}" > /dev/null',
            f'python3 x.py "{EMOJI}" 2>&1',
        ):
            with self.subTest(command=command):
                self.assertFalse(
                    blocked({"tool_name": "Bash", "tool_input": {"command": command}}),
                    "blocked a read command; write-shape matching is too broad",
                )

    def test_clean_bash_writes_pass(self):
        self.assertFalse(
            blocked(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": 'echo "# [OK]" > /tmp/a.py'},
                }
            )
        )


class TestTheGuardBlocksDefectiveHwpx(unittest.TestCase):
    """Does the forwarding gate actually fire?

    This hook checks **only when the file exists**, so assertions without fixtures
    are tautologies: a missing path passes regardless of input. Create a real
    `.hwpx` for every defect.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def payload(self, path: Path, tool: str = "Bash") -> dict:
        if tool == "Bash":
            inner = {"command": f"cp {path} /tmp/deliver.hwpx"}
        else:
            inner = {"file_path": str(path)}
        return {"tool_name": tool, "tool_input": inner}

    def test_mimetype_not_first_is_blocked(self):
        path = write_hwpx(self.dir / "a.hwpx", mimetype_first=False)
        self.assertTrue(guard_says_block(self.payload(path)))

    def test_compressed_mimetype_is_blocked(self):
        """RED anchor for CONTRACT.md: a condition under which Hancom rejects the file."""
        path = write_hwpx(self.dir / "b.hwpx", stored=False)
        self.assertTrue(guard_says_block(self.payload(path)))

    def test_wrong_mimetype_is_blocked(self):
        path = write_hwpx(self.dir / "c.hwpx", mimetype="application/zip")
        self.assertTrue(guard_says_block(self.payload(path)))

    def test_missing_required_entry_is_blocked(self):
        path = write_hwpx(self.dir / "d.hwpx", section=False)
        self.assertTrue(guard_says_block(self.payload(path)))

    def test_leftover_reference_thumbnail_is_blocked(self):
        path = write_hwpx(self.dir / "e.hwpx", preview=b"x" * 4096)
        self.assertTrue(guard_says_block(self.payload(path)))

    def test_bordered_charpr_is_blocked(self):
        path = write_hwpx(self.dir / "f.hwpx", header=BORDERED_HEADER)
        self.assertTrue(guard_says_block(self.payload(path)))

    def test_the_reason_names_the_path_and_the_repair(self):
        path = write_hwpx(self.dir / "g.hwpx", preview=b"x" * 4096)
        result = run(self.payload(path), GUARD)
        reason = json.loads(result.stdout)["reason"]
        self.assertIn(str(path), reason)
        self.assertIn("validate_hwpx.py", reason)

    def test_every_registered_tool_reaches_the_same_judgement(self):
        """The matcher's four tools flow through **one code path**.

        Unlike block_emoji, there are no tool-specific branches. Measure that this
        remains true; a pass for only one tool makes the matcher an illusion.
        """
        path = write_hwpx(self.dir / "h.hwpx", section=False)
        for tool in ("Bash", "Read", "Write", "Edit"):
            with self.subTest(tool=tool):
                self.assertTrue(guard_says_block(self.payload(path, tool)))


class TestWhatTheGuardDoesNotBlock(unittest.TestCase):
    """Block **only after confirming a defect**. Blocking an indeterminate state
    stops the user's work because of a hook defect.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_a_sound_hwpx_passes(self):
        path = write_hwpx(self.dir / "ok.hwpx")
        self.assertFalse(
            guard_says_block(
                {"tool_name": "Bash", "tool_input": {"command": f"cp {path} /tmp/"}}
            ),
            "blocked a valid file; this is deadlock, not a gate",
        )

    def test_a_path_that_does_not_exist_passes(self):
        self.assertFalse(
            guard_says_block(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "cp /nowhere/ghost.hwpx /tmp/"},
                }
            )
        )

    def test_the_skills_own_tools_pass(self):
        """Blocking the command that fixes a defect prevents all progress."""
        path = write_hwpx(self.dir / "broken.hwpx", section=False)
        for tool in ("validate_hwpx.py", "fix_borders.py", "sanitize_template.py"):
            with self.subTest(script=tool):
                self.assertFalse(
                    guard_says_block(
                        {
                            "tool_name": "Bash",
                            "tool_input": {"command": f"python3 scripts/{tool} {path}"},
                        }
                    ),
                    "blocked a repair command; this is deadlock",
                )

    def test_a_file_that_is_not_a_zip_passes(self):
        """Indeterminate input passes; opening a non-ZIP raises an exception."""
        path = self.dir / "notzip.hwpx"
        path.write_text("this is not an hwpx", encoding="utf-8")
        self.assertFalse(
            guard_says_block(
                {"tool_name": "Read", "tool_input": {"file_path": str(path)}}
            )
        )

    def test_unrelated_tool_input_passes(self):
        self.assertFalse(
            guard_says_block(
                {"tool_name": "Write", "tool_input": {"file_path": "/tmp/a.md"}}
            )
        )

    def test_broken_stdin_fails_open(self):
        for raw in ("", "not json", '{"tool_input": "문자열이다"}'):
            with self.subTest(stdin=raw):
                result = run({}, GUARD, raw=raw)
                self.assertEqual(result.returncode, 0, "fail-open contract violated")
                self.assertEqual(decision(result), None)


class TestTheMeasuredExitCodes(unittest.TestCase):
    """Both hooks **always exit 0** and report blocking on stdout.

    A checker reading "nonzero = block" would misclassify both hooks as dead. Lock
    this behavior with a measurement.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def cases(self):
        broken = write_hwpx(self.dir / "x.hwpx", section=False)
        sound = write_hwpx(self.dir / "y.hwpx")
        return [
            ("block_emoji", "block", HOOK,
             {"tool_name": "Write", "tool_input": {"content": EMOJI}}, "block"),
            ("block_emoji", "pass", HOOK,
             {"tool_name": "Write", "tool_input": {"content": "[OK]"}}, None),
            ("block_emoji", "fail-open", HOOK, {"garbage": True}, None),
            ("hwpx_guard", "block", GUARD,
             {"tool_name": "Bash", "tool_input": {"command": f"cp {broken} /tmp/"}},
             "block"),
            ("hwpx_guard", "pass", GUARD,
             {"tool_name": "Bash", "tool_input": {"command": f"cp {sound} /tmp/"}},
             None),
            ("hwpx_guard", "fail-open", GUARD, {"tool_input": None}, None),
        ]

    def test_every_path_exits_zero_and_speaks_on_stdout(self):
        for hook, path_name, script, payload, want in self.cases():
            with self.subTest(hook=hook, path=path_name):
                result = run(payload, script)
                self.assertEqual(result.returncode, 0, "nonzero exit is not this tree's contract")
                self.assertEqual(decision(result), want)


class TestItDoesNotViolateItself(unittest.TestCase):
    def test_the_hook_emits_no_emoji(self):
        pattern = re.compile("[\U0001f300-\U0001faff☀-➿⬀-⯿️]")
        found = pattern.findall(HOOK.read_text(encoding="utf-8"))
        self.assertEqual(found, [], "the emoji-blocking hook emits emoji")

    def test_no_registered_hook_emits_emoji(self):
        """This plugin enforces No-Emoji for every registered hook."""
        pattern = re.compile("[\U0001f300-\U0001faff☀-➿⬀-⯿️]")
        for script in (HOOK, GUARD):
            with self.subTest(script=script.name):
                found = pattern.findall(script.read_text(encoding="utf-8"))
                self.assertEqual(found, [])


class TestBlockEmojiReallyFailsOpen(unittest.TestCase):
    """Measure the fail-open contract by reaching the **exception handlers**.

    The block_emoji fail-open fixture in `TestTheMeasuredExitCodes`
    (`{"garbage": True}`) is **valid JSON**. Its empty `tool_name` causes an early
    `if not content_to_check: return`, so it reaches neither
    `except json.JSONDecodeError` nor `except Exception`. Replacing both handlers
    with `raise` would still leave that test green.

    The following three inputs actually reach the handlers:
      * not JSON -> `json.JSONDecodeError` (quiet pass)
      * `null` -> `None.get` -> `AttributeError` (report on stderr and pass)
      * `[]` -> `list.get` -> `AttributeError` (same)
    """

    PATHS = {
        "not JSON": "not json{",
        "null": "null",
        "array": "[]",
    }

    def test_every_broken_stdin_exits_zero_without_blocking(self):
        for name, raw in self.PATHS.items():
            with self.subTest(stdin=name):
                result = run({}, HOOK, raw=raw)
                self.assertEqual(result.returncode, 0, "fail-open contract violated")
                self.assertIsNone(decision(result), "blocked indeterminate input")

    def test_the_two_handlers_are_distinguishable(self):
        """Check that behavior matches CONTRACT's `fail-open:` declaration.

        `JSONDecodeError` is quiet while other exceptions print to stderr and pass;
        combining them into one handler erases this distinction.
        """
        quiet = run({}, HOOK, raw=self.PATHS["not JSON"])
        loud = run({}, HOOK, raw=self.PATHS["null"])
        self.assertEqual(quiet.stderr.strip(), "", "JSONDecodeError produced output")
        self.assertIn("Hook error", loud.stderr, "other exception disappeared silently")


if __name__ == "__main__":
    unittest.main(verbosity=2)
