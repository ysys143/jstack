#!/usr/bin/env python3
"""
PreToolUse hook to detect deprecated LLM model versions.

This hook intercepts Write/Edit/Bash operations and checks for deprecated
model names in code and documentation. When found, it warns about outdated
models and suggests current alternatives.
"""

import io
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Optional

# The model database lives under `scripts/`. Upstream kept it beside this hook,
# but migration separated the paths. Without an explicit path the import fails
# silently and the `sys.exit(0)` below disables the entire checker.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

try:
    from models_database import check_model_status, normalize_model_name
except ImportError as _error:
    # Do not fail open silently. Project policy permits fail-open behavior, but
    # an unevaluated input must not be reported as a pass. A previous version
    # exited 0 here without a message, so migration of the DB path disabled the
    # checker while still producing a green result.
    print(f"[WARN] Model DB could not be loaded; no decision was made: {_error}", file=sys.stderr)
    sys.exit(0)

# Bash writes share block_emoji's classifier so the two hooks agree on what writes a file.
# Without it, every command counts as a possible write, as the classifier does when a
# command is ambiguous.
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from block_emoji import bash_writes_a_file
except ImportError:

    def bash_writes_a_file(command: str) -> bool:
        return True


# File extensions to check
TEXT_EXTENSIONS = {
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".md",
    ".yaml",
    ".yml",
    ".json",
    ".toml",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".rb",
    ".php",
    ".swift",
    # The NotebookEdit branch is ineffective without this extension. Because
    # `check_file_content` applies the extension allowlist first, omitting
    # `.ipynb` skips all content checks and returns rc=0 even when the matcher
    # includes NotebookEdit.
    ".ipynb",
    ".txt",
    ".rst",
}

# Documents and files outside the project mention models without calling them, so a
# finding there is advisory: warn instead of blocking the write.
DOCUMENT_EXTENSIONS = {".md", ".txt", ".rst"}


def advisory_target(file_path: str, root: Optional[str] = None) -> bool:
    if Path(file_path).suffix.lower() in DOCUMENT_EXTENSIONS:
        return True
    base = Path(root or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    target = (base / file_path).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return True
    return False

# Patterns to detect model names in various contexts
MODEL_CONTEXT_PATTERNS = [
    # Direct assignments. Whitespace is spelled out so the Python and TypeScript twins
    # agree on every character.
    re.compile(r'model[ \t\n\r\f\v]*[=:][ \t\n\r\f\v]*["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'--model[= \t\n\r\f\v]+["\']?([^ \t\n\r\f\v"\']+)', re.IGNORECASE),
    re.compile(r'model_name[ \t\n\r\f\v]*[=:][ \t\n\r\f\v]*["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'llm_model[ \t\n\r\f\v]*[=:][ \t\n\r\f\v]*["\']([^"\']+)["\']', re.IGNORECASE),
    # Provider-specific patterns
    re.compile(r"(gpt-[0-9a-z.-]+)", re.IGNORECASE),
    re.compile(r"(claude-[a-z0-9.-]+)", re.IGNORECASE),
    re.compile(r"(gemini-[a-z0-9.-]+)", re.IGNORECASE),
    re.compile(r"(qwen[0-9.]*(?:-[a-z]+)?)", re.IGNORECASE),
    re.compile(r"(kimi-k[0-9.]+)", re.IGNORECASE),
    re.compile(r"(deepseek-v[0-9.]+)", re.IGNORECASE),
    re.compile(r"(glm-[0-9.]+)", re.IGNORECASE),
    re.compile(r"(solar-[a-z0-9-]+)", re.IGNORECASE),
    re.compile(r"(kanana-[0-9]+)", re.IGNORECASE),
    re.compile(r"(exaone-[a-z0-9.-]+)", re.IGNORECASE),
    re.compile(r"(k-exaone-[a-z0-9-]+)", re.IGNORECASE),
]

# A Bash command selects a model when a command that runs something carries its name: a
# flag, a setting, an API body, interpreter code or a positional argument. Data commands
# only search, print, record, query or manage paths, so their arguments are text, unless
# their output flows into a command that runs.
DATA_COMMANDS = set(
    "grep egrep fgrep zgrep rg ag ack ugrep find fd locate echo printf cat bat head tail less"
    " more wc sort uniq cut tr column nl fold diff cmp comm xxd od strings tee jq yq awk gawk"
    " sed gsed git gh sqlite3 duckdb psql mysql ls cd pwd mkdir rmdir rm cp mv ln touch stat file"
    " du chmod realpath readlink basename dirname tar zip unzip rsync scp test [ [[ true false :"
    " pytest".split(" ")
)
# Wrappers run the command after them; each lists its options that take a separate value.
WRAPPERS = {
    "sudo": ["-u", "-g", "-C", "-D", "-h", "-p", "-R", "-r", "-t", "-T", "-U", "--user", "--group", "--close-from", "--chdir", "--host", "--prompt", "--chroot", "--role", "--type", "--other-user", "--command-timeout"],
    "doas": ["-u", "-C"],
    "env": ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"],
    "nice": ["-n", "--adjustment"],
    "timeout": ["-s", "-k", "--signal", "--kill-after"],
    "xargs": ["-I", "-n", "-P", "-d", "-L", "-s", "-E", "-a", "--max-args", "--max-procs", "--delimiter", "--max-lines", "--eof", "--arg-file", "--max-chars", "--process-slot-var"],
    "stdbuf": ["-i", "-o", "-e", "--input", "--output", "--error"],
    "nohup": [],
    "command": [],
    "builtin": [],
    "exec": ["-a"],
    "python -m": [],
    "uv run": ["--with", "-w", "--python", "-p", "--project", "--directory", "--package", "--extra", "--group", "--env-file"],
    "uvx": ["--from", "--with", "-w", "--python", "-p", "--with-requirements", "--index", "--index-url"],
    "poetry run": [],
    "pipenv run": [],
    "pdm run": [],
    "hatch run": [],
    "time": ["-f", "-o"],
    "ionice": ["-c", "-n", "-p", "-P", "-u"],
    "setsid": [],
}
# Deeper nesting than this is judged as one text, as the hook did before it parsed commands.
MAX_DEPTH = 50
# Compound commands open and close with these words; keywords only separate their parts.
OPENERS = {"{", "(", "if", "for", "while", "until", "select", "case"}
CLOSERS = {"}", ")", "fi", "done", "esac"}
KEYWORDS = {"!", "then", "else", "elif", "do", "time"}
# Builtins that store their arguments or input in a variable instead of running them.
ASSIGNERS = {"read", "mapfile", "readarray", "export", "declare", "local", "typeset", "readonly"}
# Builtins that steer a loop or pause; they are judged but do not make a loop body run something.
NEUTRAL_COMMANDS = {"break", "continue", "return", "exit", "sleep", "wait", "shift", "set", "unset"}
ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=")
FD_PREFIX = re.compile(r"[0-9]+(?=[<>])")
REDIRECT_OPERATOR = re.compile(r"&>>|>>|>\||>&|<>|<&|&>|>|<")


class ShellParser:
    """Split a command line into simple commands.

    Handles quotes, `$(...)`, backticks, subshells, heredocs, comments and redirections.
    Not a full shell grammar. A command is a dict: `words` (each keeps its quoting in
    `raw`; `bare` replaces command substitutions, parsed into `subs`), `redirects`
    (redirection targets), `bodies` (heredoc bodies of the command that reads them) and
    `pipe` (output goes to the next command).
    """

    def __init__(self, src: str):
        self.src, self.i, self.pending = src, 0, []
        self.depth, self.too_deep = 0, False

    def char(self, offset: int = 0) -> str:
        index = self.i + offset
        return self.src[index] if index < len(self.src) else ""

    def script(self, closer: str = "") -> list[dict]:
        if self.depth >= MAX_DEPTH:
            self.too_deep = True
            self.i = len(self.src)
            return []
        self.depth += 1
        src, script = self.src, []
        command = {"words": [], "redirects": [], "bodies": [], "pipe": False}

        def finish(pipe: bool) -> None:
            nonlocal command
            if command["words"] or command["redirects"] or command["bodies"]:
                command["pipe"] = pipe
                script.append(command)
            elif pipe and script:
                script[-1]["pipe"] = True
            command = {"words": [], "redirects": [], "bodies": [], "pipe": False}

        while self.i < len(src):
            c, nxt = self.char(), self.char(1)
            if closer and c == closer:
                self.i += 1
                break
            if c == "\n":
                self.i += 1
                finish(False)
                self.bodies()
            elif c in " \t":
                self.i += 1
            elif c == "\\" and nxt == "\n":
                self.i += 2
            elif c == "#":
                while self.i < len(src) and src[self.i] != "\n":
                    self.i += 1
            elif c == "|":
                self.i += 2 if nxt in ("|", "&") else 1
                finish(nxt != "|")
            elif c == "&" and nxt != ">":
                self.i += 2 if nxt == "&" else 1
                finish(False)
            elif c in (";", ")"):
                self.i += 1
                finish(False)
            elif c == "(" and nxt == "(" and not command["words"]:
                start = self.i
                self.skip("(", ")")
                command["words"].append({"raw": src[start : self.i], "bare": src[start : self.i], "subs": []})
            elif c == "(":
                # A subshell keeps its parentheses as marker commands, so a pipe after it reaches every command inside.
                self.i += 1
                if not command["words"]:
                    script.append({"words": [{"raw": "(", "bare": "(", "subs": []}], "redirects": [], "bodies": [], "pipe": False})
                    for inner in self.script(")"):
                        script.append(inner)
                    command["words"].append({"raw": ")", "bare": ")", "subs": []})
            elif match := FD_PREFIX.match(src, self.i):
                self.i = match.end()
            elif c in ("<", ">", "&") and nxt != "(":
                self.redirect(command, closer)
            else:
                start = self.i
                word = self.word(closer)
                if self.i == start:
                    self.i += 1
                else:
                    command["words"].append(word)
        finish(False)
        self.depth -= 1
        return script

    def redirect(self, command: dict, closer: str) -> None:
        """A heredoc body waits for the next newline; a here-string is input like a body; a redirection target is kept apart from the words."""
        src = self.src
        if src.startswith("<<<", self.i):
            self.i += 3
            self.blanks()
            word = self.word(closer)
            command["bodies"].append(word["raw"])
            command["redirects"].append(word)
        elif src.startswith("<<", self.i):
            self.i += 2
            tabs = self.char() == "-"
            if tabs:
                self.i += 1
            self.blanks()
            word = re.sub(r"[\"'\\]", "", self.word(closer)["raw"])
            self.pending.append({"word": word, "tabs": tabs, "command": command})
        else:
            self.i = REDIRECT_OPERATOR.match(src, self.i).end()
            self.blanks()
            command["redirects"].append(self.word(closer))

    def bodies(self) -> None:
        pending, self.pending = self.pending, []
        for heredoc in pending:
            lines = []
            while self.i < len(self.src):
                newline = self.src.find("\n", self.i)
                end = len(self.src) if newline < 0 else newline
                line = self.src[self.i : end]
                self.i = end + 1
                if (line.lstrip("\t") if heredoc["tabs"] else line) == heredoc["word"]:
                    break
                lines.append(line)
            heredoc["command"]["bodies"].append("\n".join(lines))

    def blanks(self) -> None:
        while self.char() in (" ", "\t") or self.src.startswith("\\\n", self.i):
            self.i += 2 if self.char() == "\\" else 1

    def skip(self, open_: str, close: str) -> None:
        """Move past a balanced `open_`...`close` group that starts at the cursor."""
        depth = 0
        while self.i < len(self.src):
            c = self.src[self.i]
            self.i += 1
            if c == open_:
                depth += 1
            elif c == close:
                depth -= 1
                if depth == 0:
                    return

    def braces(self, subs: list) -> str:
        """The inside of a `${...}` expansion after its opening brace; command substitutions in it are parsed into `subs`."""
        src = self.src
        bare, depth = "", 1
        while self.i < len(src):
            c, nxt = self.char(), self.char(1)
            if c == "\\":
                bare += c + nxt
                self.i += 2
            elif c == "$" and nxt == "(" and self.char(2) != "(":
                self.i += 2
                subs.append(self.script(")"))
                bare += "$()"
            elif c == "`":
                self.i += 1
                subs.append(self.script("`"))
                bare += "``"
            else:
                self.i += 1
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        break
                bare += c
        return bare

    def word(self, closer: str) -> dict:
        src, start, subs = self.src, self.i, []
        bare, quote = "", ""
        while self.i < len(src):
            c, nxt = self.char(), self.char(1)
            if quote in ("'", "$'"):
                escaped = quote == "$'" and c == "\\"
                bare += c + nxt if escaped else c
                self.i += 2 if escaped else 1
                if c == "'" and not escaped:
                    quote = ""
                continue
            if c == "\\":
                bare += "" if nxt == "\n" else c + nxt
                self.i += 2
                continue
            if c == "`" and closer == "`":
                break
            if not quote:
                if c in ("'", '"'):
                    quote = c
                    bare += c
                    self.i += 1
                    continue
                if c == "$" and nxt == "'":
                    quote = "$'"
                    bare += c + nxt
                    self.i += 2
                    continue
                if c in ("<", ">") and nxt == "(" and self.i == start:
                    self.i += 2
                    subs.append(self.script(")"))
                    bare += c + "()"
                    continue
                if c in " \t\n;&|()<>":
                    break
            elif c == '"':
                quote = ""
                bare += c
                self.i += 1
                continue
            if c == "$" and nxt == "{":
                self.i += 2
                bare += "${" + self.braces(subs) + "}"
                continue
            if c == "$" and nxt in ("(", "["):
                begin = self.i
                self.i += 1
                if nxt == "[" or self.char(1) == "(":
                    self.skip(nxt, ")" if nxt == "(" else "]")
                    bare += src[begin : self.i]
                    continue
                self.i += 1
                subs.append(self.script(")"))
                bare += "$()"
                continue
            if c == "`":
                self.i += 1
                subs.append(self.script("`"))
                bare += "``"
                continue
            bare += c
            self.i += 1
        return {"raw": src[start : self.i].replace("\\\n", ""), "bare": bare, "subs": subs}


def command_parts(words: list[dict]) -> tuple[list[dict], str, list[dict]]:
    """The prefix a command runs under (assignments, reserved words, wrappers and the command word), its name and its arguments."""

    def name(k: int) -> str:
        return re.sub(r"[\"'\\]", "", words[k]["raw"]).split("/")[-1] if k < len(words) else ""

    k = 0
    while k < len(words):
        first = name(k)
        pair = ("python" if re.fullmatch(r"python[0-9.]*", first) else first) + " " + name(k + 1)
        raw = words[k]["raw"]
        if raw in OPENERS and raw not in ("for", "select", "case") or raw in CLOSERS or raw in KEYWORDS and raw != "time" or ASSIGNMENT.match(raw):
            k += 1
            continue
        wrapper = pair if pair in WRAPPERS else first if first in WRAPPERS else ""
        if not wrapper:
            break
        k += len(wrapper.split(" "))
        while k < len(words) and (ASSIGNMENT.match(words[k]["raw"]) or len(words[k]["raw"]) > 1 and words[k]["raw"][0] == "-") and words[k]["raw"] != "--":
            k += 2 if words[k]["raw"] in WRAPPERS[wrapper] else 1
        if k < len(words) and (words[k]["raw"] == "--" or re.fullmatch(r"[0-9]+(?:\.[0-9]+)?[smhd]?", words[k]["raw"])):
            k += 1
    return words[: k + 1], name(k), words[k + 1 :]


def edits_in_place(name: str, args: list[dict]) -> bool:
    """An in-place edit writes the file it names, which only its options reveal."""
    raws = [word["raw"] for word in args]
    if name in ("sed", "gsed", "perl"):
        return any(re.match(r"-[a-zA-Z]*i", raw) or re.match(r"--in-place(?:=|\Z)", raw) for raw in raws)
    if name == "yq":
        return any(re.fullmatch(r"-[a-zA-Z]*i[a-zA-Z]*", raw) or re.match(r"--inplace(?:=|\Z)", raw) for raw in raws)
    if name in ("awk", "gawk"):
        return any(
            raw in ("-iinplace", "--include=inplace")
            or raw in ("-i", "--include") and j + 1 < len(raws) and re.sub(r"[\"']", "", raws[j + 1]) == "inplace"
            for j, raw in enumerate(raws)
        )
    return False


def shell_text(raw: str) -> str:
    """Text with its shell quotes removed, enough to read an option value or a command string."""
    return re.sub(
        r"""'([^']*)'|"((?:[^"\\]|\\[\s\S])*)\"""",
        lambda m: m.group(1) if m.group(1) is not None else re.sub(r"\\([\s\S])", r"\1", m.group(2)),
        raw,
    )


def data_command(name: str, args: list[dict]) -> bool:
    """aws s3 copies files; gh records and queries are data; gh models, workflow run, variable or secret set and a non-GET api call with fields or --input run or dispatch something."""
    if name == "aws":
        return bool(args) and shell_text(args[0]["raw"]) == "s3"
    if name != "gh":
        return name in DATA_COMMANDS
    sub = [shell_text(word["raw"]) for word in args] + ["", ""]
    fields = any(re.match(r"(?:-[fF]|--field|--raw-field|--input)(?:=|\Z)", arg) or re.match(r"-[fF][\s\S]", arg) for arg in sub)
    get = any(
        re.fullmatch(r"-X|--method", arg) and re.fullmatch(r"get", sub[j + 1], re.IGNORECASE)
        or re.fullmatch(r"-XGET|--method=GET", arg, re.IGNORECASE)
        for j, arg in enumerate(sub[:-1])
    )
    return not (
        sub[0] == "models"
        or sub[0] == "workflow" and sub[1] == "run"
        or sub[0] in ("variable", "secret") and sub[1] == "set"
        or sub[0] == "api" and fields and not get
    )


def nested_script(text: str, out: dict) -> None:
    """A command string another command runs, such as a git alias or a rebase --exec value."""
    # `nested` counts command strings inside command strings, so siblings do not add up.
    if out["nested"] >= MAX_DEPTH:
        out["too_deep"] = True
        return
    out["nested"] += 1
    parser = ShellParser(text)
    selection_text(parser.script(), 0, out)
    out["too_deep"] = out["too_deep"] or parser.too_deep
    out["nested"] -= 1


def nested_words(words: list[dict], out: dict) -> None:
    """Words another command runs: one quoted word is a command string, several are a command line."""
    if len(words) == 1:
        nested_script(shell_text(words[0]["raw"]), out)
    elif words:
        selection_text([{"words": words, "redirects": [], "bodies": [], "pipe": False}], 0, out)


def git_commands(args: list[dict], out: dict) -> None:
    """Commands git runs for you: bisect run, rebase --exec, submodule foreach, and -c alias, pager or editor values."""
    j = 0
    while j < len(args):
        raw = args[j]["raw"]
        if raw == "-c" and j + 1 < len(args):
            j += 1
            text = shell_text(args[j]["raw"])
            eq = text.find("=")
            key, value = text[: max(eq, 0)], text[eq + 1 :]
            if eq > 0 and (re.match(r"alias\.", key, re.IGNORECASE) and value.startswith("!") or re.search(r"(?:pager|editor|\.cmd|sshcommand)\Z", key, re.IGNORECASE)):
                nested_script(re.sub(r"^!", "", value), out)
        elif raw == "-C" or re.fullmatch(r"--(?:git-dir|work-tree|namespace|exec-path|super-prefix|config-env)", raw):
            j += 1
        elif raw[:1] != "-":
            break
        j += 1
    sub = shell_text(args[j]["raw"]) if j < len(args) else ""
    rest = args[j + 1 :]
    if sub == "bisect" and rest and rest[0]["raw"] == "run":
        nested_words(rest[1:], out)
    if sub == "rebase":
        for n, word in enumerate(rest):
            if word["raw"] in ("-x", "--exec") and n + 1 < len(rest):
                nested_script(shell_text(rest[n + 1]["raw"]), out)
            elif word["raw"].startswith("--exec="):
                nested_script(shell_text(word["raw"][len("--exec=") :]), out)
    foreach = next((n for n, word in enumerate(rest) if word["raw"] == "foreach"), -1) if sub == "submodule" else -1
    if foreach >= 0:
        command = rest[foreach + 1 :]
        while command and command[0]["raw"][:1] == "-":
            command = command[1:]
        nested_words(command, out)


# pytest options whose value is a test filter or a path, flags that take no value, and short options that take one.
PYTEST_DATA_OPTIONS = {"-k", "-m", "-c", "--deselect", "--ignore", "--ignore-glob", "--junitxml", "--junit-xml", "--rootdir", "--confcutdir", "--basetemp", "--log-file", "--html", "--cov-config"}
PYTEST_FLAGS = {"--", "--lf", "--last-failed", "--ff", "--failed-first", "--nf", "--new-first", "--sw", "--stepwise", "--pdb", "--co", "--collect-only", "--exitfirst", "--verbose", "--quiet", "--no-header", "--showlocals", "--strict-markers", "--cache-clear", "--runxfail", "--disable-warnings"}
PYTEST_VALUE_SHORT = {"-p", "-o", "-n", "-W", "-r"}


def pytest_options(args: list[dict]) -> list[str]:
    """The pytest words that can select a model.

    Test paths, node ids, the -k and -m filters and path options are data. Every other
    option is judged with its value: a short option's value when the option takes one, a
    long option's value unless it names a test file, node id or directory.
    """
    kept = []
    for j, word in enumerate(args):
        raw = word["raw"]
        previous = args[j - 1]["raw"] if j > 0 else ""
        if len(raw) > 1 and raw[0] == "-":
            name = raw.split("=")[0]
            if name not in PYTEST_DATA_OPTIONS and name not in PYTEST_FLAGS and not re.match(r"-[km]", raw):
                kept.append(raw)
            continue
        if len(previous) < 2 or previous[0] != "-" or "=" in previous or previous in PYTEST_DATA_OPTIONS or previous in PYTEST_FLAGS:
            continue
        if previous.startswith("--"):
            if not re.search(r"::|\.py(?![A-Za-z0-9_])|/\Z", shell_text(raw)):
                kept.append(raw)
        elif previous in PYTEST_VALUE_SHORT:
            kept.append(raw)
    return kept


def emits(name: str, args: list[dict], command: dict) -> bool:
    """echo, printf, cat of a heredoc or here-string, and jq or yq with null input print text from their own command line."""
    if name in ("echo", "printf"):
        return True
    if name == "cat":
        return len(command["bodies"]) > 0
    return name in ("jq", "yq") and any(re.fullmatch(r"-[a-zA-Z]*n[a-zA-Z]*", word["raw"]) or word["raw"] == "--null-input" for word in args)


def judge_redirects(command: dict, flow: int, out: dict) -> None:
    for word in command["redirects"]:
        for sub in word["subs"]:
            selection_text(sub, flow, out)


def selection_text(script: list[dict], feeds: int, out: dict) -> None:
    """Collect the text of a parsed script that can select a model.

    Flows say where output goes: nowhere that runs (0), into a variable or loop list (1),
    or into a command that runs (2).

    - A command that runs something contributes every word and its input (heredoc
      bodies, here-strings).
    - A data command contributes only its prefix, unless its output flows into a command
      that runs (`feeds` for a substitution, the next stage for a pipe, the closer's flow
      for a compound command). An emitter's output assigned to a variable or loop list
      counts too.
    - An assignment contributes its words with substitutions removed. A loop list and the
      input of a compound command count only when its values go somewhere: the body runs
      something, its output reaches a command that runs, or its output is assigned and
      the body prints. Substitutions in them count for emitters only.
    - Every command or process substitution and a command run by `find -exec` or `fd -x`
      are judged on their own.
    """
    parts = [command_parts(command["words"]) for command in script]
    # A compound command spans its opener to its matching closer.
    groups, stack_open = [], []
    closed = [[] for _ in script]
    opened = [[] for _ in script]
    for k, command in enumerate(script):
        for word in command["words"]:
            if word["raw"] in CLOSERS:
                if stack_open:
                    start = stack_open.pop()
                    closed[k].append(len(groups))
                    opened[start].append(len(groups))
                    groups.append({"start": start, "end": k, "runs": False, "emits": False, "output": 0})
            elif word["raw"] in OPENERS:
                stack_open.append(k)
            elif word["raw"] not in KEYWORDS:
                break
    kinds = []
    for k, (_, name, args) in enumerate(parts):
        if closed[k] and not name:
            kinds.append("closer")
        elif not name or name in ASSIGNERS or name == "printf" and args and args[0]["raw"] == "-v":
            kinds.append("assign")
        elif name in ("for", "select"):
            kinds.append("loop")
        else:
            kinds.append("data" if data_command(name, args) else "neutral" if name in NEUTRAL_COMMANDS else "runs")
    # Counts of running and printing commands, so a group's span answers both questions at once.
    running, printing = [0], [0]
    for k, kind in enumerate(kinds):
        running.append(running[k] + (1 if kind == "runs" else 0))
        printing.append(printing[k] + (1 if kind == "data" and emits(parts[k][1], parts[k][2], script[k]) else 0))
    for group in groups:
        group["runs"] = running[group["end"] + 1] > running[group["start"]]
        group["emits"] = printing[group["end"] + 1] > printing[group["start"]]

    def passes(g: int) -> bool:
        return groups[g]["runs"] or groups[g]["output"] == 2 or groups[g]["output"] == 1 and groups[g]["emits"]

    # The innermost group around each command; a closer is outside its own group.
    inside, stack = [], []
    for k in range(len(script)):
        while stack and groups[stack[-1]]["end"] <= k:
            stack.pop()
        for g in reversed(opened[k]):
            stack.append(g)
        inside.append(stack[-1] if stack else -1)
    texts = out["texts"]
    downstream = feeds
    for k in range(len(script) - 1, -1, -1):
        command, kind = script[k], kinds[k]
        prefix, name, args = parts[k]
        output = downstream if command["pipe"] else feeds if inside[k] < 0 else groups[inside[k]]["output"]
        flow_in = 0
        if edits_in_place(name, args):
            out["writes"] = True
        if kind == "closer":
            # A closer passes the group's output on; the group reads the closer's heredoc, here-string and redirections.
            for g in closed[k]:
                groups[g]["output"] = output
            passing = any(passes(g) for g in closed[k])
            if passing:
                texts.append("\n".join(command["bodies"]))
            judge_redirects(command, 1 if passing else 0, out)
        elif kind == "assign":
            texts.append("\n".join([" ".join(word["bare"] for word in command["words"])] + command["bodies"]))
            for word in command["words"]:
                for sub in word["subs"]:
                    selection_text(sub, 1, out)
            judge_redirects(command, 1, out)
        elif kind == "loop":
            passing = not opened[k] or passes(opened[k][0])
            if passing:
                texts.append(" ".join(word["bare"] for word in command["words"]))
            for word in command["words"]:
                for sub in word["subs"]:
                    selection_text(sub, 1 if passing else 0, out)
            judge_redirects(command, 0, out)
        elif kind in ("runs", "neutral") or output == 2 or output == 1 and emits(name, args, command):
            # Bash joins the quoted pieces of a word, so the words are also judged with their quotes removed.
            raw = " ".join(word["raw"] for word in command["words"])
            plain = " ".join(shell_text(word["raw"]) for word in command["words"])
            texts.append("\n".join([raw] + command["bodies"]))
            if plain != raw:
                texts.append(plain)
            judge_redirects(command, 2, out)
            flow_in = 2
        else:
            texts.append(" ".join(word["raw"] for word in prefix))
            if name == "pytest":
                texts.append(" ".join(pytest_options(args)))
            if name == "git":
                git_commands(args, out)
            execs = r"-(?:exec|execdir|ok|okdir)" if name == "find" else r"-x|-X|--exec|--exec-batch" if name == "fd" else None
            for j, word in enumerate(args):
                if execs and re.fullmatch(execs, word["raw"]):
                    ends = [n for n in range(j + 1, len(args)) if re.fullmatch(r"\\;|';'|\";\"|\+", args[n]["raw"])]
                    nested = args[j + 1 : ends[0]] if ends else args[j + 1 :]
                    selection_text([{"words": nested, "redirects": [], "bodies": [], "pipe": False}], 0, out)
                for sub in word["subs"]:
                    selection_text(sub, 0, out)
            judge_redirects(command, 0, out)
            flow_in = 1 if output == 1 else 0
        # A command piped into a compound command feeds every command in it, and through them the group's output.
        if opened[k]:
            downstream = 0
            for g in opened[k]:
                downstream = 2 if groups[g]["runs"] else max(downstream, groups[g]["output"])
        else:
            downstream = flow_in


def load_config() -> dict:
    """Load configuration from pyproject.toml."""
    try:
        # Look for pyproject.toml in current directory or parent directories
        cwd = Path.cwd()
        for directory in [cwd] + list(cwd.parents):
            pyproject_path = directory / "pyproject.toml"
            if pyproject_path.exists():
                content = pyproject_path.read_text()

                # Simple TOML parsing for our specific keys
                config = {"check_model_versions": True, "approved_legacy_models": []}

                # Parse check_model_versions
                if match := re.search(
                    r"check_model_versions\s*=\s*(true|false)", content, re.IGNORECASE
                ):
                    config["check_model_versions"] = match.group(1).lower() == "true"

                # Parse approved_legacy_models array
                if match := re.search(
                    r"approved_legacy_models\s*=\s*\[(.*?)\]", content, re.DOTALL
                ):
                    models_str = match.group(1)
                    models = re.findall(r'["\']([^"\']+)["\']', models_str)
                    config["approved_legacy_models"] = models

                return config
    except Exception:
        # Fail-open on any error
        pass

    return {"check_model_versions": True, "approved_legacy_models": []}


# Every character either twin's trim removes, so the model database sees the same name from both twins.
EDGE_SPACE = re.compile(
    r"^[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"
    r"|[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+\Z"
)
# Characters that start a path segment before the dot of a dot-directory: a slash, a home tilde, an assignment, a quote or whitespace.
SEGMENT_START = {"/", "~", "=", '"', "'", " ", "\t", "\n", "\r", "\f", "\v"}


def in_path(content: str, start: int, end: int) -> bool:
    """A name at `start`..`end` is part of a path, not a model.

    That is a dot-directory or dot-file name (`~/.<name>`, `CLAUDE_CONFIG_DIR=.<name>`) or a
    directory component followed by `/` (`results/<name>/out.json`). The replacement of an
    `s/old/<name>/` substitution is text written into a file, so it still counts.
    """
    if start >= 1 and content[start - 1] == "." and (start < 2 or content[start - 2] in SEGMENT_START):
        return True
    if content[end : end + 1] != "/":
        return False
    second = content.rfind("/", 0, start)
    first = content.rfind("/", 0, second) if second > 0 else -1
    return not (
        first > 0
        and content[first - 1] == "s"
        and not (first >= 2 and re.match(r"[A-Za-z_]", content[first - 2]))
        and "\n" not in content[first:start]
    )


def extract_models_from_content(
    content: str, patterns: list[re.Pattern] = MODEL_CONTEXT_PATTERNS
) -> list[tuple[str, str]]:
    """
    Extract model names and their context from content.

    Returns:
        List of (model_name, context_snippet) tuples
    """
    found_models = []
    seen_models = set()

    for pattern in patterns:
        for match in pattern.finditer(content):
            if in_path(content, match.start(1), match.end(1)):
                continue
            model = EDGE_SPACE.sub("", match.group(1))
            normalized = normalize_model_name(model)

            # Avoid duplicates
            if normalized in seen_models:
                continue
            seen_models.add(normalized)

            # Extract context (50 chars before and after)
            start = max(0, match.start() - 50)
            end = min(len(content), match.end() + 50)
            context = content[start:end].replace("\n", " ").strip(" \t\n\r\f\v")

            found_models.append((model, context))

    return found_models


def check_file_content(
    file_path: str, content: str, approved_models: list[str]
) -> Optional[str]:
    """
    Check file content for deprecated models.

    Returns:
        Warning message if deprecated models found, None otherwise
    """
    # Check if file extension should be checked
    ext = Path(file_path).suffix.lower()
    if ext not in TEXT_EXTENSIONS:
        return None

    # Extract models from content
    found_models = extract_models_from_content(content)
    if not found_models:
        return None

    # Check each model
    deprecated_findings = []
    for model, context in found_models:
        is_deprecated, model_info = check_model_status(model)

        if is_deprecated and model_info:
            # Check if model is in approved list
            normalized = normalize_model_name(model)
            if normalized in approved_models:
                continue

            # Get replacement model info for enhanced recommendations
            replacement_info = None
            if model_info.replacement:
                _, replacement_info = check_model_status(model_info.replacement)

            deprecated_findings.append(
                {
                    "model": model,
                    "context": context,
                    "replacement": model_info.replacement,
                    "alternative": model_info.alternative,
                    "provider": model_info.provider,
                    "replacement_info": replacement_info,
                    "warn_only": model_info.warn_only,
                    "status": model_info.status,
                }
            )

    # Check current models with newer_version (migration hint, non-blocking)
    migration_findings = []
    for model, context in found_models:
        is_deprecated, model_info = check_model_status(model)
        if (
            not is_deprecated
            and model_info
            and getattr(model_info, "newer_version", None)
        ):
            normalized = normalize_model_name(model)
            if normalized not in approved_models:
                migration_findings.append(
                    {
                        "model": model,
                        "context": context,
                        "newer_version": model_info.newer_version,
                        "provider": model_info.provider,
                    }
                )

    # Do not report an unknown model as if the database recognized it.
    #
    # The previous version checked only deprecated models with replacements and
    # treated every other name with the same silence. It could not distinguish
    # an invented name from a newly released model, producing green without a
    # meaningful evaluation.
    #
    # Do not block it. Blocking unknown names creates false positives on every
    # new release; a checker users learn to ignore cannot block truly deprecated
    # models either.
    unknown_findings = []
    for model, context in found_models:
        is_deprecated, model_info = check_model_status(model)
        if model_info is None and normalize_model_name(model) not in approved_models:
            unknown_findings.append({"model": model, "context": context})

    if not deprecated_findings and not migration_findings and not unknown_findings:
        return None

    if not deprecated_findings and (migration_findings or unknown_findings):
        today = date.today().isoformat()
        parts = [
            f"WARN_ONLY:\n[INFO] Model check in `{file_path}` (checked: {today})\n"
        ]
        for f in migration_findings:
            parts.append(
                f"**[UPGRADE]** `{f['model']}` ({f['provider']})\n"
                f"A newer version is available: `{f['newer_version']}`\n"
                f"**Context:** `...{f['context']}...`\n\n"
            )
        for f in unknown_findings:
            parts.append(
                f"**[UNKNOWN]** `{f['model']}` is not in the model database\n"
                f"This check could not judge it — it is neither confirmed current "
                f"nor known to be deprecated.\n"
                f"If the model is real, add it to `models_database.py`; if it is a "
                f"typo, fix the name.\n"
                f"**Context:** `...{f['context']}...`\n\n"
            )
        return "".join(parts)

    # Separate block vs warn-only findings
    block_findings = [f for f in deprecated_findings if not f.get("warn_only")]
    warn_findings = [f for f in deprecated_findings if f.get("warn_only")]

    # If only warn-only findings, return with WARN_ONLY prefix
    if not block_findings and warn_findings:
        today = date.today().isoformat()
        parts = [
            f"WARN_ONLY:\n[NOTICE] Sunsetting LLM Model in `{file_path}` (checked: {today})\n"
        ]
        for finding in warn_findings:
            parts.append(
                f"**Sunsetting:** `{finding['model']}` ({finding['provider']})\n"
                f"**Recommended migration:** `{finding['replacement']}`\n"
            )
            if finding.get("alternative"):
                parts.append(f"**Note:** {finding['alternative']}\n")
        return "".join(parts)

    # Build blocking warning message
    all_findings = block_findings + warn_findings
    has_deprecated = any(f.get("status") == "deprecated" for f in all_findings)
    has_outdated = any(f.get("status") == "outdated" for f in all_findings)

    today = date.today().isoformat()
    if has_deprecated and has_outdated:
        header = f"\n[WARN] Deprecated/Outdated LLM Model Detected in `{file_path}` (checked: {today})\n"
    elif has_outdated:
        header = f"\n[WARN] Outdated LLM Model Detected in `{file_path}` (checked: {today})\n"
    else:
        header = f"\n[WARN] Deprecated LLM Model Detected in `{file_path}` (checked: {today})\n"

    warning_parts = [header, "The following model(s) need attention:\n"]

    for finding in all_findings:
        status = finding.get("status", "deprecated")
        if status == "outdated":
            label = "**[OUTDATED]**"
            reason = "Still works via API but not competitive — a significantly better option exists in the same tier."
        else:
            label = "**[DEPRECATED]**"
            reason = "Officially retired by the provider. This model may stop working."

        warning_parts.append(
            f"\n{label} `{finding['model']}` ({finding['provider']})\n"
            f"{reason}\n"
            f"**Recommended:** `{finding['replacement']}`\n"
        )

        # Add alternative if available
        if finding.get("alternative"):
            warning_parts.append(f"**Alternative:** `{finding['alternative']}`\n")

        # Add replacement model characteristics if available
        if finding.get("replacement_info"):
            info = finding["replacement_info"]
            if info.tier:
                warning_parts.append(f"  - Tier: {info.tier}\n")
            if info.capabilities:
                caps = ", ".join(info.capabilities)
                warning_parts.append(f"  - Capabilities: {caps}\n")
            if info.use_case:
                warning_parts.append(f"  - Use case: {info.use_case}\n")
            if info.cost_tier:
                warning_parts.append(f"  - Cost: {info.cost_tier}\n")

        warning_parts.append(f"**Context:** `...{finding['context']}...`\n")

    warning_parts.extend(
        [
            "\n**To proceed with this model anyway:**\n",
            "Add to `pyproject.toml`:\n",
            "```toml\n",
            "[tool.claude-hooks]\n",
            "approved_legacy_models = [",
        ]
    )

    # Add all deprecated models to example config
    for finding in all_findings:
        warning_parts.append(f'"{finding["model"]}", ')
    warning_parts.append("]\n```\n")

    warning_parts.extend(
        [
            "\n**To disable this check entirely:**\n",
            "```toml\n",
            "[tool.claude-hooks]\n",
            "check_model_versions = false\n",
            "```\n",
        ]
    )

    warning = "".join(warning_parts)
    return "WARN_ONLY:" + warning if advisory_target(file_path) else warning


def check_bash_command(command: str, approved_models: list[str]) -> Optional[str]:
    """
    Check bash command for deprecated models.

    Returns:
        Warning message if deprecated models found, None otherwise
    """
    # A selection on the command line can block; text the command writes into a file is
    # checked with every pattern, but only as advisory context.
    judgment = {"texts": [], "writes": False, "too_deep": False, "nested": 0}
    parser = ShellParser(command)
    selection_text(parser.script(), 0, judgment)
    if parser.too_deep or judgment["too_deep"]:
        judgment["texts"] = [command]
    selections = extract_models_from_content("\n".join(judgment["texts"]))
    selected = {normalize_model_name(model) for model, _ in selections}
    written = extract_models_from_content(command) if judgment["writes"] or bash_writes_a_file(command) else []
    found_models = selections + [
        (model, context) for model, context in written if normalize_model_name(model) not in selected
    ]
    if not found_models:
        return None

    # Check each model
    deprecated_findings = []
    for model, context in found_models:
        is_deprecated, model_info = check_model_status(model)

        if is_deprecated and model_info:
            # Check if model is in approved list
            normalized = normalize_model_name(model)
            if normalized in approved_models:
                continue

            # Get replacement model info for enhanced recommendations
            replacement_info = None
            if model_info.replacement:
                _, replacement_info = check_model_status(model_info.replacement)

            deprecated_findings.append(
                {
                    "model": model,
                    "context": context,
                    "replacement": model_info.replacement,
                    "alternative": model_info.alternative,
                    "provider": model_info.provider,
                    "replacement_info": replacement_info,
                    "warn_only": model_info.warn_only,
                    "status": model_info.status,
                }
            )

    if not deprecated_findings:
        return None

    # Separate block vs warn-only findings
    block_findings = [f for f in deprecated_findings if not f.get("warn_only")]
    warn_findings = [f for f in deprecated_findings if f.get("warn_only")]

    # If only warn-only findings, return with WARN_ONLY prefix
    if not block_findings and warn_findings:
        today = date.today().isoformat()
        parts = [
            f"WARN_ONLY:\n[NOTICE] Sunsetting LLM Model in Bash Command (checked: {today})\n"
        ]
        for finding in warn_findings:
            parts.append(
                f"**Sunsetting:** `{finding['model']}` ({finding['provider']})\n"
                f"**Recommended migration:** `{finding['replacement']}`\n"
            )
            if finding.get("alternative"):
                parts.append(f"**Note:** {finding['alternative']}\n")
        return "".join(parts)

    # Build blocking warning message
    all_findings = block_findings + warn_findings
    has_deprecated = any(f.get("status") == "deprecated" for f in all_findings)
    has_outdated = any(f.get("status") == "outdated" for f in all_findings)

    today = date.today().isoformat()
    if has_deprecated and has_outdated:
        header = f"\n[WARN] Deprecated/Outdated LLM Model Detected in Bash Command (checked: {today})\n"
    elif has_outdated:
        header = (
            f"\n[WARN] Outdated LLM Model Detected in Bash Command (checked: {today})\n"
        )
    else:
        header = f"\n[WARN] Deprecated LLM Model Detected in Bash Command (checked: {today})\n"

    warning_parts = [header, "The following model(s) need attention:\n"]

    for finding in all_findings:
        status = finding.get("status", "deprecated")
        if status == "outdated":
            label = "**[OUTDATED]**"
            reason = "Still works via API but not competitive — a significantly better option exists in the same tier."
        else:
            label = "**[DEPRECATED]**"
            reason = "Officially retired by the provider. This model may stop working."

        warning_parts.append(
            f"\n{label} `{finding['model']}` ({finding['provider']})\n"
            f"{reason}\n"
            f"**Recommended:** `{finding['replacement']}`\n"
        )

        # Add alternative if available
        if finding.get("alternative"):
            warning_parts.append(f"**Alternative:** `{finding['alternative']}`\n")

        # Add replacement model characteristics if available
        if finding.get("replacement_info"):
            info = finding["replacement_info"]
            if info.tier:
                warning_parts.append(f"  - Tier: {info.tier}\n")
            if info.capabilities:
                caps = ", ".join(info.capabilities)
                warning_parts.append(f"  - Capabilities: {caps}\n")
            if info.use_case:
                warning_parts.append(f"  - Use case: {info.use_case}\n")
            if info.cost_tier:
                warning_parts.append(f"  - Cost: {info.cost_tier}\n")

        warning_parts.append(f"**Context:** `{finding['context']}`\n")

    warning_parts.extend(
        [
            "\n**To proceed with this model anyway:**\n",
            "Add to `pyproject.toml`:\n",
            "```toml\n",
            "[tool.claude-hooks]\n",
            "approved_legacy_models = [",
        ]
    )

    for finding in all_findings:
        warning_parts.append(f'"{finding["model"]}", ')
    warning_parts.append("]\n```\n")

    warning = "".join(warning_parts)
    if any(normalize_model_name(f["model"]) in selected for f in block_findings):
        return warning
    return "WARN_ONLY:" + warning


def main():
    """Main hook entry point."""
    try:
        # The hook event is UTF-8 and the TypeScript twin writes UTF-8 with "\n". Text-mode
        # stdio on Windows uses the console code page and "\r\n", so a command holding a
        # non-ASCII character would be read as different text and judged differently.
        for stream in (sys.stdout, sys.stderr):
            if isinstance(stream, io.TextIOWrapper):
                stream.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        tool_input = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))

        # Load configuration
        config = load_config()

        # Check if checking is disabled
        if not config.get("check_model_versions", True):
            sys.exit(0)

        approved_models = [
            normalize_model_name(m) for m in config.get("approved_legacy_models", [])
        ]

        # Determine tool type and extract relevant content
        tool_name = tool_input.get("tool_name") or tool_input.get("tool")
        params = tool_input.get("tool_input") or tool_input.get("params", {})

        warning = None

        if tool_name == "Write":
            file_path = params.get("file_path", "")
            content = params.get("content", "")
            warning = check_file_content(file_path, content, approved_models)

        elif tool_name == "Edit":
            file_path = params.get("file_path", "")
            new_string = params.get("new_string", "")
            # Check the new content being added
            warning = check_file_content(file_path, new_string, approved_models)

        elif tool_name == "MultiEdit":
            # MultiEdit supplies an `edits` array with no top-level `new_string`.
            # Without this branch a deprecated model inserted through MultiEdit
            # passes silently. `block_emoji.py` already documented and closed
            # this same gap; this hook lagged behind. The same content measured
            # rc=1 through Write and rc=0 through MultiEdit.
            file_path = params.get("file_path", "")
            new_string = "\n".join(
                e.get("new_string", "") for e in params.get("edits", [])
            )
            warning = check_file_content(file_path, new_string, approved_models)

        elif tool_name == "NotebookEdit":
            # NotebookEdit supplies `new_source`, with neither `content` nor
            # `new_string`, so it needs an equivalent branch.
            file_path = params.get("notebook_path", "") or params.get("file_path", "")
            warning = check_file_content(
                file_path, params.get("new_source", ""), approved_models
            )

        elif tool_name == "Bash":
            command = params.get("command", "")
            warning = check_bash_command(command, approved_models)

        # If warning found, check if all findings are warn-only
        if warning:
            if warning.startswith("WARN_ONLY:"):
                # Output as additionalContext (non-blocking)
                result = {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "additionalContext": warning[len("WARN_ONLY:") :],
                    }
                }
                print(json.dumps(result))
                sys.exit(0)
            else:
                print(warning, file=sys.stderr)
                sys.exit(1)

        # Otherwise, allow operation
        sys.exit(0)

    except Exception as e:
        # Fail-open on any error
        print(f"[DEBUG] Model version checker error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
