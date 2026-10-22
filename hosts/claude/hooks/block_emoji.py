#!/usr/bin/env python3
"""
PreToolUse hook that blocks Edit/Write operations containing emoji.
Returns decision: block with detailed feedback so the agent can fix it.
"""

import json
import sys
import re


#: Emoji code-point ranges. Keep this at module scope: the `emoji` skill needs
#: the same pattern when cleaning existing files. If it is trapped inside a
#: function, the skill must create its own copy; three such copies once existed.
#:
#: `U+2300-23FF` (Misc Technical) also matches non-emoji technical symbols
#: such as `Cmd`. This is an intentional tradeoff documented in `hooks/CONTRACT.md`.
EMOJI_PATTERN = re.compile(
    "["
    "\U0001f600-\U0001f64f"  # Emoticons
    "\U0001f300-\U0001f5ff"  # Misc Symbols and Pictographs
    "\U0001f680-\U0001f6ff"  # Transport and Map
    "\U0001f700-\U0001f77f"  # Alchemical Symbols
    "\U0001f780-\U0001f7ff"  # Geometric Shapes Extended
    "\U0001f800-\U0001f8ff"  # Supplemental Arrows-C
    "\U0001f900-\U0001f9ff"  # Supplemental Symbols and Pictographs
    "\U0001fa00-\U0001fa6f"  # Chess Symbols
    "\U0001fa70-\U0001faff"  # Symbols and Pictographs Extended-A
    "\U0001f926-\U0001f937"  # Face gestures
    "\u2600-\u26ff"  # Miscellaneous Symbols
    "\u2700-\u27bf"  # Dingbats
    "\u2300-\u23ff"  # Miscellaneous Technical
    "\u2b50"  # Star
    "\u3030"  # Wavy dash
    "\u303d"  # Part alternation mark
    "\u3297"  # Circled ideograph congratulation
    "\u3299"  # Circled ideograph secret
    "]+"
)


def contains_emoji(text):
    """Return emoji found in text. Hangul is outside the ranges and is not matched."""
    return EMOJI_PATTERN.findall(text)


# Discarding or joining stdout and stderr does not write a file. Strip these
# first so a read such as `grep "..." f 2>/dev/null` is not mistaken for a write.
_NOT_A_WRITE = re.compile(r"\d*>&\d*|>>?\s*/dev/null")

# Forms that create files. A match makes the command a write.
_WRITE_SHAPES = (
    re.compile(r">>?\s*[^\s&|]"),  # > file  /  >> file
    re.compile(r"<<-?\s*[\'\"]?\w"),  # heredoc
    re.compile(r"(?:^|[\s|;&])sed\s+(?:-\S+\s+)*-i"),  # sed -i
    re.compile(r"(?:^|[\s|;&])tee\b"),  # tee
)


def bash_writes_a_file(command):
    """Return whether this Bash command writes a file.

    The matcher cannot distinguish Bash writes from reads because both use one
    tool name. Inspect the command's form instead. This is deliberately coarse,
    not a full shell parser, and ambiguous commands are treated as writes to
    avoid false negatives.
    """
    return any(shape.search(_NOT_A_WRITE.sub(" ", command)) for shape in _WRITE_SHAPES)


def main():
    """
    PreToolUse hook handler.
    Checks tool_input for emoji and blocks if found.
    """
    try:
        input_data = json.load(sys.stdin)
        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input", {})

        # Determine which field to check based on tool
        content_to_check = None
        if tool_name == "Write":
            content_to_check = tool_input.get("content", "")
        elif tool_name == "Edit":
            content_to_check = tool_input.get("new_string", "")
        elif tool_name == "MultiEdit":
            # MultiEdit supplies an `edits` array and has no top-level
            # `new_string`. Without this branch, the matcher accepts MultiEdit
            # but never reads `edits`, leaving `content_to_check` empty and
            # silently passing at `if not content_to_check: return` below.
            content_to_check = "\n".join(
                edit.get("new_string", "") for edit in tool_input.get("edits", [])
            )
        elif tool_name == "NotebookEdit":
            # NotebookEdit supplies `new_source`, with neither `content` nor
            # `new_string`. Without this branch it silently passes like
            # MultiEdit. This happened when the matcher was expanded to
            # NotebookEdit without updating the code, leaving cells unchecked.
            content_to_check = tool_input.get("new_source", "")
        elif tool_name == "Bash":
            # Bash writes (`echo >`, heredoc, `sed -i`, `tee`) were a long-open
            # gap while the matcher covered only Edit and Write. Inspect the
            # full command only when its form writes a file, avoiding false
            # blocks on read-only commands.
            command = tool_input.get("command", "")
            content_to_check = command if bash_writes_a_file(command) else ""

        if not content_to_check:
            return

        found_emoji = contains_emoji(content_to_check)

        if found_emoji:
            unique_emoji = list(set(found_emoji))
            emoji_list = ", ".join(
                f"{e} ({e.encode('unicode-escape').decode('ascii')})"
                for e in unique_emoji[:10]
            )
            if len(unique_emoji) > 10:
                emoji_list += f" ... and {len(unique_emoji) - 10} more"

            result = {
                "decision": "block",
                "reason": (
                    f"Emoji detected in content: {emoji_list}. "
                    "Default: remove all emoji characters and retry with ASCII "
                    "alternatives like [O], [X], [INFO], [WARN], ->, <- instead. "
                    "If the user explicitly asked for these emoji, this is a policy "
                    "exemption: read payload/skills/emoji/SKILL.md in the installed "
                    'jstack package (section "When the user asked for emoji") and do not '
                    "retry the same call unchanged."
                ),
            }
            print(json.dumps(result))

    except json.JSONDecodeError:
        pass
    except Exception as e:
        print(f"Hook error: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
