#!/usr/bin/env python3
"""Regenerate the references tier-3 index and SKILL.md routing table from the current repository state."""
import os, re, json, glob, collections, urllib.request
try:
    import yaml
except ImportError:
    raise SystemExit("pyyaml is required: pip install pyyaml")

D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(D, 'references/_kdense-catalog.md')
CAT_URL = ('https://raw.githubusercontent.com/K-Dense-AI/'
           'scientific-agent-skills/HEAD/docs/skills.md')

os.makedirs(os.path.join(D, 'references'), exist_ok=True)
urllib.request.urlretrieve(CAT_URL, CAT)

dom, c2, c3 = {}, None, None
for line in open(CAT, encoding='utf-8'):
    m2, m3 = re.match(r'^## (.+)$', line), re.match(r'^### (.+)$', line)
    if m2:
        c2, c3 = m2.group(1).strip(), None
        continue
    if m3:
        c3 = m3.group(1).strip()
        continue
    m = re.match(r'^-\s+\*\*\[.+?\]\(\.\./skills/([^/]+)/\)\*\*', line)
    if m:
        dom[m.group(1)] = c3 or c2

def one_line(s, n=110):
    s = ' '.join(str(s).split())
    return re.split(r'(?<=[.!?])\s', s)[0][:n].rstrip()

def skill_files(base):
    """Find SKILL.md files below `base`. **Do not follow directory symlinks.**

    `glob('**', recursive=True)` follows directory symlinks. `repos/academic`
    links `skills/<name>` to `../<name>`, so four items were counted twice and
    the resulting eight made the `SKILL.md`·`NOTICE`·`_sources.json` total 209.
    The measured total is 159 + 38 + 4 = **201**. Symlinks are not real files.
    """
    out = []
    for dp, dns, fns in os.walk(base, followlinks=False):
        dns[:] = [d for d in dns if not os.path.islink(os.path.join(dp, d))]
        if 'SKILL.md' in fns:
            out.append(os.path.join(dp, 'SKILL.md'))
    return sorted(out)


rows = []
for repo in ('kdense', 'gdm', 'academic'):
    for p in skill_files(f'{D}/repos/{repo}'):
        txt = open(p, encoding='utf-8', errors='replace').read()
        m = re.match(r'^---\n(.*?)\n---\n', txt, re.S)
        if not m:
            continue
        try:
            d = yaml.safe_load(m.group(1)) or {}
        except Exception:
            d = {}
        slug = os.path.basename(os.path.dirname(p))
        g = (dom.get(slug, 'Uncategorized') if repo == 'kdense'
             else 'Biological Databases (DeepMind)' if repo == 'gdm'
             else 'Academic Paper Pipeline')
        rows.append((g, slug, one_line(d.get('description', '')),
                     os.path.relpath(p, D), repo))

SRC = json.load(open(f'{D}/references/_sources.json'))

groups = collections.defaultdict(list)
for r in rows:
    groups[r[0]].append(r)

for f in glob.glob(f'{D}/references/*.md'):
    if not os.path.basename(f).startswith('_'):
        os.remove(f)

fname = lambda g: re.sub(r'[^a-z0-9]+', '-', g.lower()).strip('-') + '.md'
index = []
for g, items in groups.items():
    fn = fname(g)
    with open(f'{D}/references/{fn}', 'w', encoding='utf-8') as f:
        used = sorted({r[4] for r in items})
        cred = ", ".join(
            f"`{u}` = [{SRC[u]['repo']}]({SRC[u]['url']}) @ "
            f"{SRC[u]['commit'][:7]} ({SRC[u]['license'].split(' —')[0]})"
            for u in used if u in SRC)
        f.write(f'# {g}\n\n<!-- sources -->\n출처: {cred}\n\n'
                f'{len(items)} items. Choose one, read the `path`\'s '
                'SKILL.md, and follow its instructions.\n\n')
        for _, slug, desc, rel, repo in sorted(items, key=lambda x: x[1]):
            f.write(f'- **{slug}** (`{repo}`) — {desc}\n  `{rel}`\n')
    index.append({'domain': g, 'file': fn, 'count': len(items),
                  'bytes': os.path.getsize(f'{D}/references/{fn}')})
index.sort(key=lambda x: (-x['count'], x['domain']))
json.dump(index, open(f'{D}/references/_index.json', 'w'),
          ensure_ascii=False, indent=1)

HEAD_ROW = '| File | Count | Domain |\n|---|---|---|\n'


def replace_table(text, table):
    """Replace **only the table rows** in the SKILL.md routing table.

    A version that used `\\n## Updating` as its endpoint **deleted the prose
    section** between the table and that heading: the three-row table of
    "decisions we added" and its explanation disappeared on regeneration
    (measured 2026-09-02). A generator must touch only what it owns.

    The endpoint is where the table rows end. Nothing outside the table is changed.
    """
    start = text.index(HEAD_ROW) + len(HEAD_ROW)
    end = start
    while text.startswith('|', end):
        end = text.index('\n', end) + 1
    return text[:start] + table + '\n' + text[end:]


# Replace only the SKILL.md routing table.
sk = f'{D}/SKILL.md'
table = "\n".join(f"| `{i['file']}` | {i['count']} | {i['domain']} |" for i in index)
open(sk, 'w', encoding='utf-8').write(
    replace_table(open(sk, encoding='utf-8').read(), table))
print(f'{len(rows)} skills / {len(index)} domains / index '
      f'{sum(i["bytes"] for i in index):,}B — regeneration complete')
