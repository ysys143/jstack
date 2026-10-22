#!/usr/bin/env python3
"""help contract suite.

Run: python3 tests/run_tests.py   (from skills/help)

## What this locks

1. **The map is complete, both ways** — a routing map that drifts answers
   confidently, which is worse than having no map. This is the only copy of the
   roster in the plugin, so it is verified against the tree rather than trusted.
2. **Nothing-applies is a real answer** — routing to the nearest-sounding skill
   applies rules built for another situation, invisibly.
3. **Indexed by situation, not by name** — a list of names does not answer the
   question people arrive with.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,  # noqa: E402
                        split_frontmatter, check_body_deletion,
                        check_contract_coverage)  # noqa: E402
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    # Flatten line breaks so sentence-level contracts survive reflow.
    flat = re.sub(r"\s+", " ", skill)

    # (1) The map must be complete both ways; it is the plugin's only roster copy.
    mapped = re.findall(r"(?m)^\| .+ \| `([a-z][a-z0-9-]+)` \|$", skill)
    on_disk = sorted(d for d in os.listdir(SKILLS)
                     if os.path.isdir(os.path.join(SKILLS, d))
                     and os.path.exists(os.path.join(SKILLS, d, "SKILL.md")))
    check('Map: has at least one entry', len(mapped) > 0, f"{len(mapped)} entries")
    check('Map: every mapped skill exists',
          all(m in on_disk for m in mapped),
          f"absent {[m for m in mapped if m not in on_disk]}")
    check('Map: every skill in the tree is mapped',
          all(d in mapped for d in on_disk),
          f"missing {[d for d in on_disk if d not in mapped]}")
    check('Map: has no duplicate entries', len(mapped) == len(set(mapped)),
          f"{[m for m in set(mapped) if mapped.count(m) > 1]}")
    check('Map: left column contains situations rather than names',
          all(not re.fullmatch(r"`?[a-z-]+`?", r.strip())
              for r in re.findall(r"(?m)^\| (.+?) \| `[a-z-]+` \|$", skill)))
    check('Map: includes itself, proving the roster is complete',
          "help" in mapped)

    # (2) Why a map rather than a list
    check('Rationale: says a name list does not identify applicability',
          "does not tell you which one applies" in skill)
    check('Rationale: says people arrive with situations',
          "arrive with is a situation" in skill)
    check('Rationale: says the name is the answer, never the question',
          "never the question" in skill)
    check('Rationale: says the map is checked against the tree',
          "checked against the tree" in skill)
    check('Rationale: says a stale map is worse than no map',
          "worse than no map" in skill)
    check('Rationale: explains why: it answers confidently',
          "answers confidently" in skill)

    # (3) Nothing applies is also an answer
    check('Absence: instructs the agent to say when nothing applies',
          "Say so plainly" in skill)
    check('Absence: requires stating what the request needs',
          "what the request would need" in skill)
    check('Absence: says routing to the nearest skill is worse',
          "worse than answering directly" in skill)
    check('Absence: says that mismatch is invisible in output',
          "invisible in the output" in skill)
    check('Absence: forbids redirecting to an uninstalled target',
          "user has not installed" in skill)
    check('Absence: states the plugin self-sufficiency principle',
          "sufficient on its own" in skill)

    # (4) When both seem applicable
    check('Conflict: instructs the agent to read both boundary sentences',
          "Read both boundary sentences" in skill)
    check('Conflict: says overlapping skills name their relevant neighbours',
          "skills with overlapping activation name the\nrelevant neighbour" in skill)
    check('Conflict: gives a concrete commonly confused pair',
          "`audit` and `cleanup`" in skill)
    check('Conflict: gives the distinction in one sentence',
          "judging changes nothing" in skill)
    check('Conflict: says an unresolved boundary is defective',
          "the boundary is wrong" in skill)
    check('Conflict: identifies where to fix that defect', "`author` covers fixing it" in skill)

    # (4.5) **Turn the claim into a contract.** help says every skill names its
    # neighbours. Prose alone hid drift: secrets↔gitrules had neither edge and
    # audit→consult had only one (found by external review). Measure the graph.
    graph = {}
    for d in sorted(os.listdir(SKILLS)):
        sp = os.path.join(SKILLS, d, "SKILL.md")
        if not os.path.isfile(sp):
            continue
        body = split_frontmatter(read(sp))[1]
        # **Two-letter names are skills too.** `{2,}` imposed a three-character floor
        # that could never see `ui`, whether it named or was named by a neighbour.
        # Requiring a following `skill` or `command` avoids new false positives.
        graph[d] = set(re.findall(
            r"`([a-z][a-z0-9-]+)`\s*\n?\s*(?:skill|command)", body
        ))
    check('Graph: every on-disk skill is in the boundary graph population',
          set(graph) == set(on_disk), f"graph={len(graph)}, disk={len(on_disk)}")
    dangling = sorted({(k, n) for k, v in graph.items() for n in v
                       if n not in graph and not os.path.exists(
                           os.path.join(os.path.dirname(SKILLS), "commands", n + ".md"))})
    check('Graph: every named neighbour exists as a skill or command',
          not dangling, f"{dangling}")
    # Pairs with overlapping triggers must point **both ways**. One-way routing
    # works from only one entry point. Literal trigger intersection derives no pairs
    # from the current tree, so keep a manual list and pin its size so additions are
    # reflected here. audit↔verify was an unregistered pair found in third review.
    pairs = [("secrets", "gitrules"), ("audit", "consult"), ("audit", "cleanup"),
             ("audit", "verify")]
    # **Use AND, not XOR.** `!=` catches a single missing edge but passes when both
    # are silent, which was the original secrets↔gitrules defect. Second-round
    # review proved deleting both edges still passed 49/49.
    broken = [(a, b) for a, b in pairs
              if not (b in graph.get(a, ()) and a in graph.get(b, ()))]
    check('Graph: overlapping-trigger pairs refer to each other', not broken, f"{broken}")
    # The manual list must grow. Pin its count because literal trigger intersection
    # currently provides no basis for automatic derivation.
    check('Graph: declares at least four bidirectional pairs', len(pairs) >= 4, f"{len(pairs)} pairs")

    # **A manual list cannot find new overlaps.** Normalize triggers by removing
    # particles and endings, then derive candidates mechanically. This found the
    # missing models↔team pair. Every derived pair must be bidirectional, providing
    # evidence that the manual list is not arbitrary.
    def _norm(t):
        # **Preserve spaces.** Removing them turns `cross verify` into the nonexistent
        # `crossverify` and erases token boundaries. Collapse runs to one space.
        t = re.sub(r"(해줘|해라|하라|해|줘|봐|줄래|알려|보자)$", "", t.strip())
        t = re.sub(r"(을|를|이|가|은|는|에|의|로|으로)$", "", t)
        return re.sub(r"\s+", " ", t).strip()

    trig = {}
    for d in graph:
        # **Do not overwrite outer `fm`.** Reusing that name once made later L0 checks
        # inspect another skill's frontmatter.
        other_fm = split_frontmatter(read(os.path.join(SKILLS, d, "SKILL.md")))[0]
        m = re.search(r"(?:Triggers|트리거)\s*—\s*(.+?)(?:\.\s|$)", other_fm, re.S)
        trig[d] = {_norm(t) for t in re.findall(r'"([^"]+)"', m.group(1))} if m else set()
        trig[d] = {t for t in trig[d] if len(t.replace(" ", "")) >= 2}

    # **Measure overlap at token boundaries.** Earlier code removed spaces and used
    # `in`, so consult's `cross verify` became `crossverify` containing `verify`;
    # it derived a non-bidirectional pair and broke the baseline. Routing ambiguity
    # comes from triggers sharing a prefix, while a shared suffix already differs at
    # the first token. Count prefix matches only when they end at a token boundary.
    #
    # One fact remains: consult and verify share `verify` and `검증` as tokens. This
    # rule excludes the pair because the overlap is not a prefix. Their failure to
    # name each other remains a defect in consult/SKILL.md and verify/SKILL.md.
    def _overlaps(x, y):
        """Return whether the shorter string is a prefix ending at a token boundary."""
        if x == y:
            return True
        short, long = (x, y) if len(x) < len(y) else (y, x)
        if len(short) < 3 or not long.startswith(short):
            return False
        return long[len(short)] == " "

    derived = set()
    for a in sorted(trig):
        for b in sorted(trig):
            if a >= b:
                continue
            if any(_overlaps(x, y) for x in trig[a] for y in trig[b]):
                derived.add((a, b))
    check('Graph: trigger normalization derives overlapping pairs', len(derived) >= 2,
          f"{sorted(derived)}")
    dbroken = sorted((a, b) for a, b in derived
                     if not (b in graph.get(a, ()) and a in graph.get(b, ())))
    check('Graph: every derived overlap is bidirectional', not dbroken, f"{dbroken}")

    # (5) Self-application. If help says every skill names its neighbours but lacks
    # its own Boundary section, its claim is false. Measurement exposed this gap.
    check('Self-application: help has a Boundary section', "\n## Boundary" in skill)
    check('Self-application: says it routes and stops', "routes and stops" in skill)
    check('Self-application: forbids replacing invocation with a summary',
          "in place of firing it" in skill)
    check('Self-application: explains that a summary is not the judgement',
          "is not the\njudgement" in skill or "is not the judgement" in skill)
    check('Self-application: routes map gaps to author',
          "`author` skill" in skill)
    named = set(re.findall(r"`([a-z][a-z0-9-]{2,})`\s*skill", skill))
    check('Self-application: every named neighbour exists',
          all(os.path.isdir(os.path.join(SKILLS, n)) for n in named),
          f"{sorted(named)}")

    # (6) Language and L0
    check('Language: description has Korean triggers',
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check('Language: description has English triggers', "help" in fm and "what can you do" in fm)
    check('L0: description states the routing axis as a decision, not a name',
          "not by its name" in fm)
    check('L0: description promises a nothing-applies response',
          "when nothing here covers it" in fm)

    # (7) **Index integrity: does each left side match its target?** Earlier tests
    # compared only right-side skill names with the tree. Rotating every left side,
    # replacing them with word salad, or repeating one sentence in all 18 rows still
    # passed, contradicting this document's claim that a stale map is worse than none.
    #
    # Measure whether left-side content words occur in the target SKILL.md and rank
    # that target above alternatives. Exclude map rows from scoring so help does not
    # match itself circularly.
    ROW_RE = r"(?m)^\| (.+?) \| `([a-z][a-z0-9-]+)` \|$"
    rows = re.findall(ROW_RE, skill)
    STOP = {"what", "that", "with", "this", "when", "from", "into", "your",
            "here", "does", "than", "then", "they", "them", "their", "have",
            "been", "will", "which", "without", "before", "after", "actually",
            "something", "whose", "must", "make", "take", "hand", "more",
            "over", "ready", "work", "using", "onto", "only", "also"}

    def content_words(s):
        return {w for w in re.findall(r"[a-z]+", s.lower())
                if len(w) >= 4 and w not in STOP}

    corpus = {}
    for d in sorted(os.listdir(SKILLS)):
        sp = os.path.join(SKILLS, d, "SKILL.md")
        if not os.path.isfile(sp):
            continue
        raw = read(sp)
        corpus[d] = "\n".join(ln for ln in raw.splitlines()
                              if not re.match(ROW_RE.replace("(?m)", ""), ln)).lower()

    def score(words, d):
        return sum(1 for w in words if w in corpus.get(d, ""))

    weak, misranked, top1, total_hits = [], [], 0, 0
    for left, tgt in rows:
        words = content_words(left)
        own = score(words, tgt)
        total_hits += own
        rank = sum(1 for d in corpus if score(words, d) > own) + 1
        if own < 1:
            weak.append((left[:34], tgt, own))
        if rank > 2:
            misranked.append((left[:34], tgt, rank))
        if rank == 1:
            top1 += 1
    check('Index: map row population is nonempty', len(rows) >= 15, f"{len(rows)} rows")
    check('Index: each left-hand side shares keywords with its target skill',
          bool(rows) and not weak, f"zero shared terms {weak}")
    check('Index: every target skill ranks in the top two',
          bool(rows) and not misranked, f"misranked rows {misranked}")
    check('Index: at least 17 rows rank their target first', top1 >= 17, f"{top1} rows")
    check('Index: total left-side-to-skill matching tokens is at least 57', total_hits >= 57,
          f"{total_hits} matches")

    # The old duplicate check covered only the right side; 18 identical left sides passed.
    lefts = [left.strip() for left, _ in rows]
    check('Index: left-hand sides have no duplicates', bool(lefts) and len(set(lefts)) == len(lefts),
          f"duplicates {sorted({x for x in lefts if lefts.count(x) > 1})}")

    # (8) **Index population.** The map intentionally includes skills only. Excluding
    # commands and agents is valid, but undocumented exclusion is indistinguishable
    # from omission. Measure the rationale and population sizes; pinned counts force
    # this choice to be reviewed when either layer grows.
    PLUGIN = os.path.dirname(SKILLS)
    cmds = sorted(f for f in os.listdir(os.path.join(PLUGIN, "commands"))
                  if f.endswith(".md")) if os.path.isdir(
                      os.path.join(PLUGIN, "commands")) else []
    agents = sorted(f for f in os.listdir(os.path.join(PLUGIN, "agents"))
                    if f.endswith(".md")) if os.path.isdir(
                        os.path.join(PLUGIN, "agents")) else []
    check('Population: commands exist', len(cmds) > 0, f"{len(cmds)} commands")
    check('Population: agents exist', len(agents) > 0, f"{len(agents)} agents")
    check('Population: says the map contains skills only',
          "The map indexes **skills, and only skills**." in flat)
    check('Population: explains why commands are excluded',
          "Commands are explicit entry points" in flat
          and "/jstack:test-plugin" in flat)
    check('Population: explains why agents are excluded',
          "An agent is never chosen by the user at all" in flat)
    check('Population: names where to go for a roster',
          "the `skills` command reads the tree and prints all three layers" in flat)
    check('Population: the named command exists',
          os.path.isfile(os.path.join(PLUGIN, "commands", "skills.md")))
    catalog_path = os.path.join(PLUGIN, "CAPABILITIES.md")
    catalog = read(catalog_path) if os.path.isfile(catalog_path) else ""
    catalog_skills = set(re.findall(r"`([a-z][a-z0-9-]+)`", "\n".join(
        line for line in catalog.splitlines() if line.startswith("|")
    )))
    check('카탈로그: help identifies the canonical feature catalog at the install root',
          "../../CAPABILITIES.md" in skill
          and "${JSTACK_PLUGIN_ROOT}/CAPABILITIES.md" in skill)
    check('카탈로그: the canonical catalog covers the on-disk skills',
          catalog_skills == set(on_disk),
          f"missing {sorted(set(on_disk)-catalog_skills)}, extra {sorted(catalog_skills-set(on_disk))}")
    catalog_commands = set(re.findall(r"`/([a-z][a-z0-9-]+)`", catalog.split("Claude Code exposes", 1)[-1]))
    disk_commands = {os.path.splitext(name)[0] for name in cmds}
    check('카탈로그: 36 public commands match the actual command files',
          len(catalog_commands) == 36 and catalog_commands == disk_commands,
          f"catalog={len(catalog_commands)}, disk={len(disk_commands)}")
    check('Examples: explains the different outcomes of the two setup commands',
          "prepares project recall" in skill
          and "Google Workspace installation and OAuth" in skill)
    check('Examples: distinguishes test-plugin, validate, and doctor targets',
          "runs plugin contracts" in skill and "validates an artifact" in skill
          and "diagnoses without\nchanging the project" in skill)

    # (9) **Literal L0 triggers.** Description is the only always-read layer. Counting
    # five Korean chunks and two English words let all triggers disappear; pin the
    # phrases that actually distinguish utterances.
    TRIGGERS = ["뭐 할 수 있어", "어떤 스킬", "도움말", "목록",
                "help", "what can you do", "스킬 알려줘", "이럴 땐 뭘 써"]
    gone = [t for t in TRIGGERS if f'"{t}"' not in fm]
    check('L0: every declared trigger phrase survives literally', not gone, f"absent {gone}")
    quoted = re.findall(r'"([^"]+)"', fm)
    check('L0: has at least eight trigger phrases', len(quoted) >= 8, f"{len(quoted)} triggers")

    # (10) **Section skeleton.** Replacing three prose sections with needle-only bullets
    # once passed. Pin heading order and each section's key sentence.
    sections = re.findall(r"(?m)^## (.+)$", skill)
    check('Skeleton: section headings retain their declared order',
          sections == ["Why a map and not a list", "The map",
                       "Commands are explicit entry points", "When nothing here applies",
                       "Two skills seem to apply", "Boundary"], f"{sections}")
    for label, sent in (
        ("why a map rather than a list",
         "A list of names tells you what exists; it does not tell you which one "
         "applies."),
        ("map is checked against the tree",
         "This map is checked against the tree: every skill here exists, and every "
         "skill in the plugin appears here."),
        ("why a stale map is worse",
         "A map that drifts is worse than no map, because it answers confidently."),
        ("nothing-applies response",
         "Say so plainly, and say what the request would need."),
        ("self-sufficiency",
         "This plugin is meant to be sufficient on its own for the work it names."),
        ("resolve conflicts through boundary sentences",
         "Read both boundary sentences; skills with overlapping activation name "
         "the relevant neighbour and say what belongs to it."),
        ("unresolved boundary is defective",
         "If the boundaries genuinely do not settle it, the boundary is wrong "
         "\u2014 that is a defect in the descriptions, and `author` covers fixing "
         "it."),
        ("route and stop",
         "This skill routes and stops. It does not do the work it points at, and "
         "it does not summarise a skill in place of firing it"),
    ):
        check(f"Sentence: {label} appears verbatim", sent in flat,
              "" if sent in flat else f"missing: {sent[:46]}...")

    check_skill_body(check, ROOT, needles=[
        "never the question",
        "worse than no map",
        "worse than answering directly",
        "Read both boundary sentences",
        "sufficient on its own",
    ], floor=3627)

    deletion_meta = ("자기검사:", "계약 커버리지:", "카탈로그:")
    check_contract_coverage(check, __file__, ROOT, per_file={"SKILL.md": 56},
                            live_ran=sum(1 for r in results
                                         if not r[0].startswith(deletion_meta)))
    check_body_deletion(check, __file__, ROOT, minimum=56,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(deletion_meta)))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 84)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
