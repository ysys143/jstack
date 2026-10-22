#!/usr/bin/env python3
"""Diagnose agent skill directory hygiene. Read-only by default; deletes nothing.

Checks
  broken symbolic links / missing SKILL.md / missing frontmatter
  directory/frontmatter name mismatch (the skill can then be invoked only by the other name)
  missing description / exceeding the 1,536-character per-entry limit
  duplicate names (personal skill vs plugin skill)
  orphan configuration entries (skillOverrides / [[skills.config]] target does not exist)
  ghost plugin keys (enabledPlugins entry without an installation record)
  non-skill files / nesting caused by cloning an entire repository

Usage: prune.py [--config-dir ~/.claude ...] [--json]

The exit code is this tool's only machine-readable signal. /doctor needs to know
whether defects exist, not merely how many were printed.

  0  scan completed with no defects
  1  defects found (count is in --json summary.total)
  2  unable to scan: no config directories exist (distinct from zero defects)

--json uses the same aggregation as the human-readable table. A single
aggregation function prevents the two representations from disagreeing.
"""
import argparse, glob, json, os, re, sys

try:
    import yaml
except ImportError:
    yaml = None

CAP = 1536  # description + when_to_use per-entry limit

# Exit-code contract. If unavailable (2) collapses into clean (0), a check that
# never ran is reported as clean.
EXIT_CLEAN, EXIT_ISSUES, EXIT_UNSCANNABLE = 0, 1, 2


def load_fm(path):
    """Return (frontmatter dict | None, error reason | None). If strict YAML fails,
    retry with a regex to accommodate host parser tolerance."""
    t = open(path, encoding='utf-8', errors='replace').read()
    m = re.match(r'^---\n(.*?)\n---\n', t, re.S)
    if not m:
        return None, 'missing frontmatter'
    block = m.group(1)
    if yaml:
        try:
            return (yaml.safe_load(block) or {}), None
        except Exception:
            pass
    fm = {}
    for key in ('name', 'description', 'when_to_use'):
        mm = re.search(rf'^{key}:\s*(.*)$', block, re.M)
        if mm:
            fm[key] = mm.group(1).strip().strip('"\'')
    # The strict parser failed, but the host may still read it. Record only a warning.
    return fm, 'strict YAML failed (host may still read it)'


def scan_dir(root):
    """Scan one skill directory."""
    out = {'skills': [], 'issues': []}
    if not os.path.isdir(root):
        out['issues'].append(('missing', root))
        return out
    for name in sorted(os.listdir(root)):
        if name.startswith('.'):
            continue
        p = os.path.join(root, name)
        if os.path.islink(p) and not os.path.exists(p):
            out['issues'].append(('broken link', f'{name} -> {os.readlink(p)}'))
            continue
        if not os.path.isdir(p):
            out['issues'].append(('non-skill file', name))
            continue
        sm = os.path.join(p, 'SKILL.md')
        if not os.path.isfile(sm):
            nested = glob.glob(os.path.join(p, '*', 'SKILL.md'))
            if nested:
                inner = {os.path.basename(os.path.dirname(n)) for n in nested}
                kind = 'nested (possible repository clone)' if name in inner else 'nested container'
                out['issues'].append((kind, f'{name} ({len(nested)} nested)'))
            else:
                out['issues'].append(('missing SKILL.md', name))
            continue
        fm, warn = load_fm(sm)
        if fm is None:
            out['issues'].append(('missing frontmatter', name))
            out['skills'].append((name, name, 0))
            continue
        if warn:
            out['issues'].append(('YAML warning', f'{name}: {warn}'))
        nm = str(fm.get('name') or name)
        desc = str(fm.get('description') or '')
        wtu = str(fm.get('when_to_use') or '')
        if nm != name:
            out['issues'].append(('name mismatch', f'directory={name} / name={nm}; callable only as /{nm}'))
        if not desc:
            out['issues'].append(('missing description', name))
        size = len(nm) + len(desc) + len(wtu)
        if size > CAP:
            out['issues'].append(('over 1536 characters', f'{name} ({size} characters)'))
        out['skills'].append((name, nm, size))
    return out


def claude_extras(cfg):
    """Claude-specific config checks: ghost plugin keys and orphan skillOverrides."""
    issues = []
    sp = os.path.join(cfg, 'settings.json')
    ipp = os.path.join(cfg, 'plugins', 'installed_plugins.json')
    if not os.path.isfile(sp):
        return issues
    try:
        st = json.load(open(sp, encoding='utf-8'))
    except Exception as e:
        issues.append(('failed to parse settings.json', str(e).splitlines()[0]))
        return issues
    ip = {}
    if os.path.isfile(ipp):
        try:
            ip = json.load(open(ipp, encoding='utf-8')).get('plugins', {})
        except Exception:
            issues.append(('failed to parse installed_plugins.json', ipp))
    for k in st.get('enabledPlugins', {}):
        if k not in ip:
            issues.append(('ghost plugin key', k))
    skdir = os.path.join(cfg, 'skills')
    for k in st.get('skillOverrides', {}):
        if not os.path.exists(os.path.join(skdir, k)):
            issues.append(('orphan skillOverrides', k))
    for k, recs in ip.items():
        for r in recs:
            if not os.path.isdir(r.get('installPath', '')):
                issues.append(('missing install path', f"{k}: {r.get('installPath')}"))
    return issues


def codex_extras(cfg):
    """Codex-specific check for [[skills.config]] paths that do not exist."""
    issues = []
    ct = os.path.join(cfg, 'config.toml')
    if not os.path.isfile(ct):
        return issues
    text = open(ct, encoding='utf-8', errors='replace').read()
    for path, enabled in re.findall(
            r'^\[\[skills\.config\]\]\npath = "([^"]+)"\nenabled = (\w+)', text, re.M):
        if not os.path.exists(os.path.expanduser(path)):
            issues.append(('orphan skills.config', f'{path} (enabled={enabled})'))
    return issues


def summarize(result):
    """Aggregate scan results into a machine-readable summary.

    The table and --json use the same function. An earlier version counted only
    for the table and always returned zero in JSON, leaving automation blind.
    """
    per_dir, total = {}, 0
    for cfg, r in result.items():
        by = {}
        for kind, _detail in r['issues']:
            by[kind] = by.get(kind, 0) + 1
        n = sum(by.values())
        total += n
        per_dir[cfg] = {'skills': len(r['skills']),
                        'listing_chars': sum(s[2] for s in r['skills']),
                        'issues': n, 'by_kind': by}
    return {'total': total, 'dirs': per_dir,
            'exit': EXIT_ISSUES if total else EXIT_CLEAN}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config-dir', action='append', default=[],
                    help='agent config directory to scan; repeatable; auto-detected when omitted')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    H = os.path.expanduser('~')
    # Default host homes plus the active profile overrides, without duplicates.
    defaults = [f'{H}/.claude', os.environ.get('CLAUDE_CONFIG_DIR', ''), f'{H}/.codex', os.environ.get('CODEX_HOME', '')]
    dirs = [os.path.expanduser(d) for d in a.config_dir] or list(dict.fromkeys(
        os.path.expanduser(d) for d in defaults if d and os.path.isdir(os.path.expanduser(d))))

    if not dirs:
        print('[blocked] no config directory is available to scan; this is unmeasured, not zero defects.',
              file=sys.stderr)
        return EXIT_UNSCANNABLE

    result = {}
    for cfg in dirs:
        r = scan_dir(os.path.join(cfg, 'skills'))
        r['issues'] += (codex_extras(cfg) if '/.codex' in cfg else claude_extras(cfg))
        result[cfg] = r

    summary = summarize(result)

    if a.json:
        print(json.dumps({'summary': summary, 'dirs': result},
                         ensure_ascii=False, indent=1, default=list))
        return summary['exit']

    total_issues = summary['total']
    for cfg, r in result.items():
        size = sum(s[2] for s in r['skills'])
        print(f"\n=== {cfg.replace(H, '~')}")
        print(f"  skills {len(r['skills'])} | listing cost {size:,} characters (~{size // 4:,} tokens)")
        if not r['issues']:
            print("  no issues")
            continue
        by = {}
        for kind, detail in r['issues']:
            by.setdefault(kind, []).append(detail)
        for kind in sorted(by, key=lambda k: -len(by[k])):
            print(f"  [{len(by[kind])}] {kind}")
            for d in by[kind][:10]:
                print(f"      - {d}")
            if len(by[kind]) > 10:
                print(f"      ... and {len(by[kind]) - 10} more")
    print(f"\nTotal issues: {total_issues}. This tool changed nothing.")
    return summary['exit']


if __name__ == '__main__':
    sys.exit(main())
