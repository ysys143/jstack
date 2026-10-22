#!/usr/bin/env python3
"""Fail closed on private state, common credential forms and local business IDs.

Optional private-values.json is read locally, never copied into the artifact or
printed. This is a publication boundary check, not a complete secret scanner or
a license adjudication. Test fixtures use synthetic values, not live identifiers.
"""
import argparse
import json
import re
from pathlib import Path
import sys

PRIVATE_DIRS = {'.git', '.jstack', '.omc', '.omo', '.gjc', '.senpi', '__pycache__',
                'node_modules', '.pytest_cache', '.ruff_cache'}
PRIVATE_FILES = {'.env', 'credentials.json', 'credentials.enc', 'token.json',
                 'oauth_token.json', 'client_secret.json', '.DS_Store'}
KEYS = re.compile(r'(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{25,}|xox[baprs]-[A-Za-z0-9-]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
DRIVE = re.compile(r'`(?:0A|1)[A-Za-z0-9_-]{20,}`|https://docs\.google\.com/(?:document|spreadsheets)/d/([A-Za-z0-9_-]{20,})')
HOME = re.compile('/' + r'Users/([A-Za-z0-9_.-]+)')
EXAMPLE_USERS = {'user', 'username', 'name', 'you', 'me', 'example', 'test', 'testuser', 'alice', 'bob', 'someone', 'tester', 'a', 'b', 'x'}


def inspect(root, private_values=()):
    root = Path(root).resolve()
    findings, scanned = [], 0
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if path.is_symlink():
            findings.append({'path': rel.as_posix(), 'kind': 'symlink in distributable'})
            continue
        if not path.is_file():
            continue
        scanned += 1
        if PRIVATE_DIRS.intersection(rel.parts) or path.name in PRIVATE_FILES or ('evals' in rel.parts and 'results' in rel.parts):
            findings.append({'path': rel.as_posix(), 'kind': 'private state or development output'})
        raw = path.read_bytes()
        if any(value.encode() in raw for value in private_values if value):
            findings.append({'path': rel.as_posix(), 'kind': 'private comparison match'})
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            continue
        if KEYS.search(text):
            findings.append({'path': rel.as_posix(), 'kind': 'credential-shaped value'})
        # Imported published examples retain upstream source fidelity. Exact
        # private comparisons and credential checks still cover that entire tree.
        if 'repos' not in rel.parts:
            identifiers = [m.group(0).strip('`') for m in DRIVE.finditer(text)]
            if any(not re.fullmatch(r'[0-9a-f]{40,64}', x) for x in identifiers):
                findings.append({'path': rel.as_posix(), 'kind': 'embedded business resource ID'})
            if any(m[1].lower() not in EXAMPLE_USERS and not m[1].startswith('$') for m in HOME.finditer(text)):
                findings.append({'path': rel.as_posix(), 'kind': 'machine user path'})
    if not scanned:
        findings.append({'path': '.', 'kind': 'empty publication surface'})
    return {'scannedFiles': scanned, 'findings': findings, 'passed': bool(scanned) and not findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--private-values', type=Path)
    args = parser.parse_args()
    try:
        values = json.loads(args.private_values.read_text()) if args.private_values else []
        if not isinstance(values, list) or any(not isinstance(x, str) for x in values):
            raise ValueError('private comparison list must contain strings')
        result = inspect(args.root, values)
    except (OSError, ValueError) as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
