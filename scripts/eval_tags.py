"""Shared tag parsing for evaluation contracts."""

import re


def _yaml_tags(text):
    """Read inline or block YAML tags, excluding comments."""
    out, in_block = [], False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line:
            continue
        m = re.match(r"^tags:\s*(.*)$", line)
        if m:
            rest = m.group(1).strip()
            if rest.startswith("["):
                out += [
                    t.strip().strip("'\"")
                    for t in rest.strip("[]").split(",")
                    if t.strip()
                ]
                in_block = False
            else:
                in_block = True
            continue
        if in_block:
            m2 = re.match(r"^\s+-\s*(.+)$", line)
            if m2:
                out.append(m2.group(1).strip().strip("'\""))
                continue
            in_block = False
    return out
