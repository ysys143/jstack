#!/usr/bin/env python3
"""Regenerate selected contract reference snapshots using the suite's normalization.

This does not approve changed contracts or measure floors. Review the source
change, then validate a committed disposable snapshot and negative controls.
"""
import argparse
import importlib.util
from pathlib import Path
import subprocess


def freeze(root, source, destination=None):
    spec = importlib.util.spec_from_file_location('_jstack_suite', root / 'skills/_suite_lib.py')
    suite = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(suite)
    if not source.resolve().is_relative_to(root.resolve()):
        raise ValueError('source outside product')
    if destination is None:
        skill = source
        while skill != root and not (skill / 'SKILL.md').is_file():
            skill = skill.parent
        if skill == root:
            raise ValueError('non-skill sources require an explicit snapshot destination')
        rel = source.relative_to(skill)
        full = skill / 'tests/refs' / (str(rel) + '.lines')
        if rel.parts[0] == 'references' and not full.exists():
            rel = Path(*rel.parts[1:])
        destination = skill / 'tests/refs' / (str(rel) + '.lines')
        if source.name != 'SKILL.md' and destination.name.lower() == 'skill.md.lines' and destination.parent == skill / 'tests/refs':
            raise ValueError('case-insensitive SKILL.md collision: specify --destination')
    text = source.read_text()
    if source.name == 'SKILL.md':
        text = suite.split_frontmatter(text)[1]
    # Persist the object as well as its digest. A frozen reference can outlive
    # the commit that contains its source.
    digest = subprocess.check_output(
        ['git', 'hash-object', '-w', str(source)], text=True
    ).strip()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('# blob:' + digest + '\n' + '\n'.join(suite.ref_lines(text)) + '\n')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('sources', nargs='+', type=Path)
    args = parser.parse_args()
    if args.destination and len(args.sources) != 1:
        parser.error('--destination requires exactly one source')
    for source in args.sources:
        print(freeze(args.root, source, args.destination))


if __name__ == '__main__':
    main()
