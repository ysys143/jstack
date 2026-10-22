#!/usr/bin/env python3
"""Install marketplace skills into Codex at `~/.codex/skills`.

Each skill uses one mode:
  link      no Claude-specific dependency; create a drift-free symlink
  rewrite   only paths or filenames differ; copy after rules.json substitutions
  override  semantics differ; copy the plugin-provided SKILL.codex.md
  blocked   semantics differ and no override exists; skip and report

Copied skills can drift. Record the complete source-tree SHA-256 in the lockfile,
report changed inputs on rerun, and rebuild them.

Usage: install.py [--dry-run] [--codex-home DIR] [--only PLUGIN[,PLUGIN...]]

Exit 0 for success, 1 for a partial result containing blocked skills, and 2 when
the destination or root is missing or safe reclamation is blocked.
"""
import argparse, hashlib, json, os, re, shlex, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
RULES = json.load(open(os.path.join(HERE, 'rules.json'), encoding='utf-8'))
LOCK_NAME = '.jstack-bridge.json'

# Locate the marketplace root by this marker rather than fixed parent counts.
MARKER = os.path.join('.claude-plugin', 'marketplace.json')

# Exclude the skill directory that owns this installer from installation targets.
SELF_SKILL_DIR = os.path.realpath(os.path.dirname(HERE))
SELF_REASON = 'the skill that owns this installer'

# Codex has no ${CLAUDE_PLUGIN_ROOT}; files containing it require rewriting.
PLUGIN_ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}'
IGNORED_DIRS = {'node_modules', '__pycache__', '.ruff_cache', '.git', 'results'}


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def tree_sha(skill_dir):
    """Stable hash of all installation inputs, including references and scripts."""
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(skill_dir):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_DIRS)
        for name in sorted(filenames):
            if name == 'SKILL.codex.md':
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, skill_dir).replace(os.sep, '/')
            h.update(rel.encode('utf-8') + b'\0')
            with open(path, 'rb') as f:
                h.update(f.read())
            h.update(b'\0')
    override = os.path.join(skill_dir, 'SKILL.codex.md')
    if os.path.isfile(override):
        h.update(b'SKILL.codex.md\0')
        with open(override, 'rb') as f:
            h.update(f.read())
    return h.hexdigest()


def marketplace_root(start=HERE):
    """Find the marketplace marker upward; return None when absent.

    Fixed parent counts can point at the wrong root after a move, producing an
    empty scan that could otherwise reclaim every installed skill.
    """
    d = os.path.abspath(start)
    while True:
        if os.path.isfile(os.path.join(d, MARKER)):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def plugin_dirs(root):
    """Return declared plugin directories, or flat root/plugins when absent.

    Follow marketplace.json `source` because plugins may live outside plugins/.
    """
    out = []
    try:
        entries = json.load(open(os.path.join(root, MARKER), encoding='utf-8'))
        entries = entries.get('plugins', [])
    except Exception:
        entries = []
    for e in entries:
        src = e.get('source') if isinstance(e, dict) else None
        if not isinstance(src, str):
            continue
        p = os.path.normpath(os.path.join(root, src))
        if os.path.isdir(p):
            out.append(p)
    if not out:
        legacy = os.path.join(root, 'plugins')
        if os.path.isdir(legacy):
            out = [os.path.join(legacy, n) for n in sorted(os.listdir(legacy))
                   if os.path.isdir(os.path.join(legacy, n))]
    return sorted(set(out))


def repo_commit(root):
    try:
        return subprocess.run(['git', '-C', root, 'rev-parse', '--short', 'HEAD'],
                              capture_output=True, text=True, timeout=5).stdout.strip() or 'unknown'
    except Exception:
        return 'unknown'


def classify(text, skill_dir):
    override = os.path.join(skill_dir, 'SKILL.codex.md')
    blocked = [b for b in RULES['blockers'] if blocker_match(b, text)]
    if blocked:
        return ('override', None) if os.path.isfile(override) else ('blocked', blocked)
    if PLUGIN_ROOT_TOKEN in text:
        return 'rewrite', None
    if any(re.search(s['from'], text) for s in RULES['substitutions']):
        return 'rewrite', None
    return 'link', None


def blocker_match(blocker, text):
    """Preserve tool-name case to avoid mistaking domain APIs for host tools."""
    pattern = blocker['pattern']
    flags = 0 if pattern == r'Task\(' else re.I
    return re.search(pattern, text, flags) is not None


def instruction_body(rel, text):
    """Do not treat Markdown frontmatter tool allowlists as execution instructions."""
    if rel.lower().endswith(('.md', '.mdx')) and text.startswith('---\n'):
        parts = text.split('---', 2)
        if len(parts) == 3:
            return parts[2]
    return text


def runtime_texts(skill_dir):
    """Traverse UTF-8 inputs visible to the installed model or tools.

    Exclude tests, prefer a Codex override over source SKILL.md, and copy binary
    files without textual substitution.
    """
    override = os.path.join(skill_dir, 'SKILL.codex.md')
    root = override if os.path.isfile(override) else os.path.join(skill_dir, 'SKILL.md')
    try:
        root_text = open(root, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError):
        return

    # Start at paths invoked by SKILL.md so examples in unrelated assets are not
    # misclassified as runtime dependencies.
    prefix = re.compile(
        r"(?:\$\{CLAUDE_PLUGIN_ROOT\}/skills/[A-Za-z0-9_-]+/)?"
        r"((?:references|scripts|langs|bin|dist|repos|assets|templates)/"
        r"[A-Za-z0-9_./*?{}<>-]+)"
    )
    queued = [('SKILL.md', root_text)]
    seen = set()
    while queued:
        rel, text = queued.pop(0)
        if rel in seen:
            continue
        seen.add(rel)
        yield rel, text
        for match in prefix.finditer(text):
            # Root-enumerated paths are entry points. Follow paths in references only when
            # the surrounding line instructs a read, load, use, or run.
            if rel != 'SKILL.md':
                line_start = text.rfind('\n', 0, match.start()) + 1
                line_end = text.find('\n', match.end())
                line = text[line_start:line_end if line_end >= 0 else len(text)].lower()
                cues = ('read', 'run', 'load', 'use', 'see',
                        '읽', '실행', '로드', '사용', '따르')
                if not any(cue in line for cue in cues):
                    continue
            mention = match.group(1).rstrip('`.,:;)')
            if any(ch in mention for ch in '<>{}'):
                continue
            paths = []
            if any(ch in mention for ch in '*?'):
                import glob
                paths = glob.glob(os.path.join(skill_dir, *mention.split('/')))
            else:
                paths = [os.path.join(skill_dir, *mention.split('/'))]
            for path in sorted(paths):
                if not os.path.isfile(path):
                    continue
                child = os.path.relpath(path, skill_dir).replace(os.sep, '/')
                if child in seen or child.startswith('tests/'):
                    continue
                try:
                    child_text = open(path, encoding='utf-8').read()
                except (OSError, UnicodeDecodeError):
                    continue
                queued.append((child, child_text))


def classify_tree(skill_dir):
    """Classify the entry point and reachable runtime references and scripts."""
    rewrite_paths, blocked = [], []
    for rel, text in runtime_texts(skill_dir):
        hits = [b for b in RULES['blockers']
                if blocker_match(b, instruction_body(rel, text))]
        blocked.extend({'pattern': b['pattern'],
                        'reason': f"{rel}: {b['reason']}"} for b in hits)
        if (PLUGIN_ROOT_TOKEN in text
                or any(re.search(s['from'], text) for s in RULES['substitutions'])):
            rewrite_paths.append(rel)
    if blocked:
        return 'blocked', blocked, rewrite_paths
    if os.path.isfile(os.path.join(skill_dir, 'SKILL.codex.md')):
        return 'override', None, rewrite_paths
    if rewrite_paths:
        return 'rewrite', None, rewrite_paths
    return 'link', None, []


def rewrite(text, plugin_root=None):
    hits = []
    for s in RULES['substitutions']:
        text, n = re.subn(s['from'], s['to'].replace('\\', '\\\\'), text)
        if n:
            hits.append(f"{s['from']} -> {s['to']} x{n}")
    if plugin_root and PLUGIN_ROOT_TOKEN in text:
        n = text.count(PLUGIN_ROOT_TOKEN)
        # Use a raw path inside existing quotes and a shell-safe token elsewhere.
        text = text.replace(f'"{PLUGIN_ROOT_TOKEN}', f'"{plugin_root}')
        text = text.replace(f"'{PLUGIN_ROOT_TOKEN}", f"'{plugin_root}")
        text = text.replace(PLUGIN_ROOT_TOKEN, shlex.quote(plugin_root))
        hits.append(f'{PLUGIN_ROOT_TOKEN} -> {plugin_root} x{n}')
    return text, hits


def header(src_rel, commit, digest):
    return (f"<!-- generated by the bridge skill from {src_rel} @ {commit}\n"
            f"     source-sha256: {digest}\n"
            f"     Do not edit this file directly. Edit the source and rerun install.py. -->\n\n")


def write_copy(skill_dir, dst, mode, rewrite_paths, plugin_root, src_rel, commit, digest):
    """Apply the same safe substitutions to every classified runtime text file."""
    shutil.copytree(
        skill_dir, dst,
        ignore=shutil.ignore_patterns('SKILL.codex.md', *sorted(IGNORED_DIRS)))
    override = os.path.join(skill_dir, 'SKILL.codex.md')
    if mode == 'override':
        text = open(override, encoding='utf-8').read()
        open(os.path.join(dst, 'SKILL.md'), 'w', encoding='utf-8').write(text)
    for rel in rewrite_paths:
        path = os.path.join(dst, *rel.split('/'))
        if not os.path.isfile(path):
            continue
        text = open(path, encoding='utf-8').read()
        open(path, 'w', encoding='utf-8').write(rewrite(text, plugin_root)[0])
    root_path = os.path.join(dst, 'SKILL.md')
    body = open(root_path, encoding='utf-8').read()
    open(root_path, 'w', encoding='utf-8').write(
        header(src_rel, commit, digest) + body)


def key_name(key):
    return key.split(':', 1)[1] if ':' in key else ''


def owns_path(root, dst, key, rec):
    """Compare lock ownership with an independent marker at the current path."""
    source = rec.get('source', '')
    if not source or key_name(key) != os.path.basename(dst):
        return False
    if rec.get('mode') == 'link':
        expected = os.path.dirname(os.path.join(root, source))
        return os.path.islink(dst) and os.path.realpath(dst) == os.path.realpath(expected)
    if not os.path.isdir(dst) or os.path.islink(dst):
        return False
    try:
        head = open(os.path.join(dst, 'SKILL.md'), encoding='utf-8').read(1024)
    except OSError:
        return False
    return (f"generated by the bridge skill from {source} @" in head
            and f"source-sha256: {rec.get('source_sha256', '')}" in head)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--codex-home', default=os.path.expanduser('~/.codex'))
    ap.add_argument('--only', default='')
    ap.add_argument('--root', default=None,
                    help='set marketplace root for tests; otherwise search upward for the marker')
    a = ap.parse_args()

    root = a.root or marketplace_root()
    if not root:
        print(f"[STOP] Marketplace root not found: {MARKER} is absent above: {HERE}")
        return 2
    commit = repo_commit(root)
    dest_root = os.path.join(a.codex_home, 'skills')
    only = {x.strip() for x in a.only.split(',') if x.strip()}

    if not os.path.isdir(dest_root):
        print(f"[STOP] Codex skills directory does not exist: {dest_root}")
        return 2

    lock_path = os.path.join(dest_root, LOCK_NAME)
    lock = json.load(open(lock_path, encoding='utf-8')) if os.path.isfile(lock_path) else {}
    # `--only` is a reconciliation scope, not a request to rebuild the whole
    # lockfile.  Keep records outside that scope from the start; the removal
    # pass below also skips their paths.  Entries inside the selected scope are
    # intentionally rebuilt (or reclaimed when their source is gone), matching
    # the full-scan behavior.
    new_lock = ({key: rec for key, rec in lock.items()
                 if key.split(':', 1)[0] not in only} if only else {})
    report = {'link': [], 'rewrite': [], 'override': [], 'blocked': [],
              'updated': [], 'skipped': []}

    all_plugins = plugin_dirs(root)
    current_by_name = {}
    for plug_dir in all_plugins:
        sk_root = os.path.join(plug_dir, 'skills')
        if not os.path.isdir(sk_root):
            continue
        for name in sorted(os.listdir(sk_root)):
            if os.path.isfile(os.path.join(sk_root, name, 'SKILL.md')):
                current_by_name.setdefault(name, []).append(
                    f"{os.path.basename(plug_dir)}:{name}")
    collisions = {
        name: keys for name, keys in current_by_name.items()
        if len(keys) > 1
        and (not only or any(key.split(':', 1)[0] in only for key in keys))
    }
    protected_names = set(collisions)

    # On a global name collision, install no source. Preserve only independently
    # proven ownership and discard ambiguous lock claims without changing paths.
    for name, keys in sorted(collisions.items()):
        report['blocked'].append((f"{','.join(keys)}", [f"{name}: global skill-name collision"]))
        dst = os.path.join(dest_root, name)
        proven = [(key, rec) for key, rec in lock.items()
                  if key_name(key) == name and owns_path(root, dst, key, rec)]
        if len(proven) == 1:
            new_lock[proven[0][0]] = proven[0][1]

    for plug_dir in all_plugins:
        plug = os.path.basename(plug_dir)
        if only and plug not in only:
            continue
        sk_root = os.path.join(plug_dir, 'skills')
        if not os.path.isdir(sk_root):
            continue
        for name in sorted(os.listdir(sk_root)):
            skill_dir = os.path.join(sk_root, name)
            src = os.path.join(skill_dir, 'SKILL.md')
            if not os.path.isfile(src):
                continue
            key = f'{plug}:{name}'
            # Exclude self by the owning skill directory rather than an obsolete plugin name.
            if os.path.realpath(skill_dir) == SELF_SKILL_DIR:
                report['skipped'].append((key, SELF_REASON))
                continue
            if name in collisions:
                continue
            dst = os.path.join(dest_root, name)
            src_rel = os.path.relpath(src, root)
            text = open(src, encoding='utf-8', errors='replace').read()
            mode, blockers, rewrite_paths = classify_tree(skill_dir)
            digest = sha(src)
            digest_tree = tree_sha(skill_dir)

            if mode == 'blocked':
                report['blocked'].append((key, [b['reason'] for b in blockers]))
                continue

            # Never replace a path unless lock and independent marker prove ownership.
            # Preserve broken user links by checking lexists.
            if os.path.lexists(dst) and not (key in lock and owns_path(root, dst, key, lock[key])):
                report['skipped'].append((key, 'cannot prove bridge ownership of the same-name path'))
                protected_names.add(name)
                continue

            prev = lock.get(key, {})
            changed = (prev.get('source_sha256') != digest
                       or prev.get('tree_sha256') != digest_tree
                       or prev.get('mode') != mode)
            if changed and prev:
                report['updated'].append(key)

            if not a.dry_run:
                if os.path.islink(dst):
                    os.unlink(dst)
                elif os.path.isdir(dst):
                    shutil.rmtree(dst)
                if mode == 'link':
                    os.symlink(skill_dir, dst)
                else:
                    write_copy(skill_dir, dst, mode, rewrite_paths, plug_dir,
                               src_rel, commit, digest)

            report[mode].append(key)
            new_lock[key] = {'source': src_rel, 'mode': mode,
                             'source_sha256': digest, 'tree_sha256': digest_tree,
                             'commit': commit,
                             'installed_at': time.strftime('%Y-%m-%dT%H:%M:%S')}

    # Reclaim vanished sources, except when a nonempty lock accompanies an empty
    # scan; that usually means the wrong root and could delete every installation.
    removed = []
    if lock and not new_lock and not only:
        print(f"[STOP] Scan is empty but lockfile has {len(lock)} entries; "
              f"root may be wrong, so no paths were reclaimed: {root}")
        return 2
    for key, rec in lock.items():
        if key in new_lock:
            continue
        if only and key.split(':', 1)[0] not in only:
            continue
        name = key_name(key)
        if name in protected_names or any(key_name(k) == name for k in new_lock):
            continue
        dst = os.path.join(dest_root, name)
        if os.path.lexists(dst):
            if owns_path(root, dst, key, rec):
                if not a.dry_run:
                    (os.unlink if os.path.islink(dst) else shutil.rmtree)(dst)
                removed.append(key)
            else:
                report['skipped'].append((key, 'cannot prove bridge ownership of the reclamation target'))

    if not a.dry_run:
        json.dump(new_lock, open(lock_path, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1, sort_keys=True)

    print(f"Target: {dest_root}   repository commit: {commit}")
    print(f"  root     {root}")
    print(f"  link     {len(report['link']):3d}   symlink (no drift)")
    print(f"  rewrite  {len(report['rewrite']):3d}   rewritten copy")
    print(f"  override {len(report['override']):3d}   using SKILL.codex.md")
    print(f"  updated  {len(report['updated']):3d}   upstream change detected")
    print(f"  removed  {len(removed):3d}   source disappeared")
    if report['skipped']:
        print(f"\n  skipped {len(report['skipped'])} entries")
        for k, why in report['skipped']:
            print(f"    {k}: {why}")
    if report['blocked']:
        print(f"\n  [ACTION REQUIRED] Codex override missing: {len(report['blocked'])} entries")
        print("  Add SKILL.codex.md to the skill directory for automatic installation.")
        for k, why in report['blocked']:
            print(f"    {k:44s} {', '.join(sorted(set(why)))}")
    if a.dry_run:
        print("\n(dry-run; no changes made)")
    return 1 if report['blocked'] else 0


if __name__ == '__main__':
    sys.exit(main())
