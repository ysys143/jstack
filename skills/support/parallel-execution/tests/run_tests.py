#!/usr/bin/env python3
"""team contract suite.

Run: python3 tests/run_tests.py   (from skills/team)

## What this locks

1. **Independent to check, not to start** — the distinction that decides whether
   parallelism pays; without it every task looks splittable.
2. **The brief carries what is settled** — the field that gets dropped, and the
   reason agents rediscover things differently.
3. **Independence is destroyed by sharing outputs** — three agents that read the
   same draft are one opinion counted three times.
4. **A report is a claim** — agreement between agents is evidence only if they
   were actually independent.
5. **Operational counts** — team sizes (2-3/3-5/5-7), four delivery methods,
   three follow-up branches, five feedback paths, and three evolution conditions.
   Test row names and values, not section headings, to catch filler replacement.
6. **Frontmatter is a contract** — lock seven literal Korean triggers and a size
   floor so replacing the entire description cannot remain green.
7. **Measure tables by row names** — counting pipes accepts four arbitrary rows.
   Counts must stay within the owning section.
8. **Zero orphaned references** — walk `references/` and require reachability from
   SKILL.md. A hard-coded list silently falls behind when files are added.
9. **Cross-check paired contracts** — open the quality-verifier file and verify
   the sentence cited by `orchestration-contract.md`. A one-sided contract is no contract.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions, check_total, check_skill_body,
    check_ref_contracts, split_frontmatter, check_body_deletion,
    check_contract_coverage, content_bytes,
)
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def rows(text, head, headers=("Split it", "Field")):
    """Return data rows beneath `## head`, or an empty list when absent.

    `headers` contains first cells of header rows. Without excluding them, the
    count is inflated by one and stays correct after one data row is deleted.
    """
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if r.strip() not in headers]


def section(text, head):
    """Return the body of `## head`, or an empty string when absent.

    Whole-document counts can be repaired by adding a marker elsewhere, so count
    only within the owning section.
    """
    if head not in text:
        return ""
    return text.split(head, 1)[1].split("\n## ", 1)[0]


def bullets(text, head):
    """Return top-level `- ` items beneath `## head`, or an empty list."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return re.findall(r"(?m)^- (.+)$", body)


def span(text, start, end=None):
    """Return the span between `start` and `end`, or an empty string.

    Templates inside references reuse `##` within markdown fences. Heading-level
    splitting would stop at the first fenced line, so boundaries are literal.
    """
    if start not in text:
        return ""
    body = text.split(start, 1)[1]
    if end and end in body:
        body = body.split(end, 1)[0]
    return body


def xrows(text, start, end=None, headers=()):
    """Return first cells of data rows in `span`, excluding header rows."""
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", span(text, start, end))
            if r.strip() not in headers]


def pairs(text, start, end=None, headers=()):
    """Return all cells for each table row in `span`.

    First-cell counts miss column swaps and mixed row values that preserve volume and hashes.
    """
    out = []
    for line in span(text, start, end).splitlines():
        line = line.strip()
        if not line.startswith("|") or set(line) <= set("|-: "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and cells[0] in headers:
            continue
        out.append(cells)
    return out


def numbered(text, start, end=None):
    """Return `1. **Title**` lists as number/title pairs.

    Binding numbers to titles locks order; set membership would accept reversal.
    """
    return re.findall(r"(?m)^(\d+)\. \*\*(.+?)\*\*", span(text, start, end))


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    codex_fm, codex = split_frontmatter(read(os.path.join(ROOT, "SKILL.codex.md")))
    briefs = read(os.path.join(ROOT, "references", "briefs.md"))
    ops = read(os.path.join(ROOT, "references", "operations.md"))
    oflat = re.sub(r"\s+", " ", re.sub(r"(?m)^>\s?", "", ops))

    # The Codex variant is an independent contract, not a mechanical rewrite of
    # Claude invocation syntax. It preserves the shared core and names exclusions.
    check("Codex: preserves the name and bilingual triggers",
          "name: team" in codex_fm and len(re.findall(r"[가-힣]+", codex_fm)) >= 5
          and "parallel" in codex_fm)
    check("Codex: uses independent verification as the split criterion",
          "**independent to check**" in codex)
    check("Codex: requires one writer per file or artifact",
          "Never assign two writers to\nthe same file or generated artifact" in codex
          or "Never assign two writers to the same file or generated artifact" in codex)
    check("Codex: preserves all five brief fields",
          all(term in codex for term in
              ("deliverable in one sentence", "exact output shape",
               "already been established", "outside the agent's ownership",
               "how the result will be checked")))
    check("Codex: withholds other reasoning and reference answers from independent executors",
          "must not receive another executor's reasoning or a reference answer" in codex)
    check("Codex: follows live artifacts and fresh verification over reports",
          "the artifact and\nfresh verification win" in codex
          or "the artifact and fresh verification win" in codex)
    check("Codex: interruption recovery rereads repo, ref, status, diff, artifacts, and tests",
          all(term in codex for term in
              ("repository root", "exact ref", "status", "diff",
               "task artifacts", "test output")))
    check("Codex: recovered claims point to files, commits, artifacts, or fresh commands",
          "Every recovered claim points to a file, commit, artifact, or fresh command" in codex)
    excluded = set(re.findall(r"^- `([^`]+\.md)`$", codex, re.M))
    check("Codex: lists exactly three excluded Claude-only references",
          excluded == {"agent-design-patterns.md", "orchestrator-template.md",
                       "team-examples.md"}, f"{sorted(excluded)}")
    check("Codex: excludes Claude call syntax from parity accounting",
          "does not use Claude's task-call syntax, agent-role parameter" in codex
          and "not counted as Codex parity" in codex)
    check("Codex: creates a brief from the contract after v2 preflight",
          "workflow.py\" preflight <task-id>" in codex
          and "workflow.py\" brief <task-id>" in codex)
    check("Codex: does not treat a local brief as evidence of an agent call",
          "generated brief is local evidence, not an agent call" in codex)
    check("Codex: skips the brief for small unnecessary delegation",
          "`위임: 불필요`, keep the small task local and skip the brief" in codex)
    check("Codex: reviewer names and JSON receipts do not prove independence",
          "does not prove independence from a reviewer\nname or JSON flag" in codex
          or "does not prove independence from a reviewer name or JSON flag" in codex)

    # (1) Splittability is based on verification, not merely starting.
    check("decision: verification independence is the criterion",
          "**independent to check**" in skill)
    check("decision: distinguishes independence to start", "not merely\nindependent to start" in skill
          or "not merely independent to start" in skill)
    check("decision: explains the cost of parallel edits to one module",
          "costs more than doing it once" in skill)
    tbl = rows(skill, "## When parallelism is the right shape")
    check("decision: split/do-not-split table has four rows", len(tbl) == 4, f"{len(tbl)} rows")
    # Counting pipes accepts four arbitrary rows, so lock the row names.
    check("decision: row names cover multi-file transforms, searches, perspectives, and sources",
          tbl == ["The same transformation over many files",
                  "Independent searches over different areas",
                  "Several perspectives reviewing one artefact",
                  "Gathering from many sources"], f"{tbl}")
    check("decision: do-not-split column starts with mutually constrained design",
          "One design whose parts constrain each other" in skill)
    check("decision: do-not-split column includes a change with its intent-locking tests",
          "A change and the tests that lock its intent" in skill)
    check("decision: do-not-split column includes sequential work needing prior results",
          "each step needs the last step's result" in skill)
    check("decision: do-not-split column includes synthesis of gathered material",
          "The synthesis of what was gathered" in skill)
    check("decision: multi-perspective review has no merge problem",
          "no merge problem" in skill)
    check("decision: explains that outputs are findings rather than edits",
          "findings rather than edits" in skill)
    check("decision: identifies the common mistake of splitting synthesis",
          "four partial\nconclusions" in skill or "four partial conclusions" in skill)

    # (2) A brief must stand without the delegator's context.
    check("brief: states that a subagent cannot see this conversation",
          "does not see this conversation" in skill)
    check("brief: says omissions produce confident errors rather than confusion",
          "confidently wrong rather than confused" in skill)
    check("brief: enumerates four required items",
          all(f in skill for f in ("what to produce", "what shape the answer takes",
                                   "what is out of", "already been established")))
    check("brief: identifies already-established facts as the commonly dropped field",
          "the one that gets\ndropped" in skill or "the one that gets dropped" in skill)
    check("brief: says dropped facts are rediscovered differently",
          "sometimes differently" in skill)
    check("brief: connects the v2 preflight and brief commands",
          "workflow.py\" preflight <task-id>" in skill
          and "workflow.py\" brief <task-id>" in skill)
    check("brief: carries requirement ID, behavior, ownership, positive, RED, and review fields",
          all(term in skill for term in
              ("requirement ID", "user behavior", "owned files",
               "positive command", "RED command", "selected review")))
    check("brief: permits native delegation only after preflight passes",
          "Only delegate after preflight passes" in skill
          and "harness's native delegation tool" in skill)
    check("brief: skips delegation and the brief for simple work",
          "`위임: 불필요` stays local" in skill
          and "generating a brief would cost more" in skill)
    fl = rows(briefs, "## The fields")
    check("brief: field table has five rows", len(fl) == 5, f"{len(fl)} rows")
    check("brief: fields are deliverable, shape, established facts, scope, and verification",
          fl == ["The deliverable, in one sentence", "The output shape",
                 "Already established", "Explicitly out of scope",
                 "How it will be checked"], f"{fl}")
    check("brief: says missing deliverables cause exploration instead of production",
          "An agent that explores instead of producing" in briefs)
    check("brief: says missing exclusions cause scope drift into neighboring work",
          "Scope drift into the neighbouring agent's work" in briefs)
    check("brief: says missing verification makes the result unverifiable",
          "cannot be verified when it comes back" in briefs)
    check("brief: explains why exclusions matter especially during concurrency",
          "neither does the edge" in briefs)
    check("brief: says omitting established facts is not neutral",
          "does not make the agent neutral" in briefs)
    check("brief: says omission creates two answers",
          "now there are two answers" in briefs)

    # (3) Independent work must remain independent.
    check("independence: forbids showing agents one another's output",
          "do not let one see another's" in skill)
    check("independence: says a second opinion after reading the first is a rewrite",
          "is a rewrite of the first" in skill)
    check("independence: says three readers of one draft are one opinion counted three times",
          "one opinion counted three\ntimes" in skill
          or "one opinion counted three times" in skill)
    check("independence: requires synthesis only after all agents finish",
          "after all of them are done" in skill)

    # (4) Verify returned work.
    check("verification: treats a report as a claim rather than a result",
          "is a claim, not a result" in skill)
    check("verification: requires checking testable claims before building on them",
          "check it before building on it" in skill)
    check("verification: says agreement does not imply correctness",
          "not thereby correct" in skill)
    check("verification: requires actual independence before agreement is evidence",
          "actually independent" in skill)
    check("verification: requires evidence in reports",
          "Ask for evidence in the report" in briefs)
    check("verification: says unsupported checked claims are indistinguishable from unchecked ones",
          "cannot be distinguished from" in briefs)
    check("verification: runs workflow verify instead of copying success claims into state",
          "run the workflow's `verify` command rather than copying" in skill)
    check("verification: record-review does not prove self-reported independence",
          "does not turn a self-reported reviewer identity into\nproof of independence" in skill
          or "does not turn a self-reported reviewer identity into proof of independence" in skill)

    # (5) Work that does not belong in a subagent. Count within the section so
    # another bullet elsewhere cannot compensate for a deleted item here.
    nots = re.findall(r"(?m)^- \*\*(.+?)\*\*",
                      section(skill, "## What does not belong in a subagent"))
    check("prohibition: section contains three nondelegable items", len(nots) == 3, f"{len(nots)} items")
    check("prohibition: says delegation buys nothing when judgment must be relearned",
          "delegating it buys nothing" in skill)
    check("prohibition: says an unclear brief produces work that only looks finished",
          "now it looks finished" in skill)
    check("prohibition: excludes work shorter than its brief",
          "shorter than its brief" in skill)

    # (6) Output shape and search boundary.
    check("shape: requires the form that will be combined",
          "the form you will combine" in briefs)
    check("shape: quantifies the cost of converting five prose reports",
          "five chances to lose something" in briefs)
    check("shape: specifies what to report when nothing is found",
          "what to say when the agent finds" in briefs)
    check("shape: says silence is indistinguishable from failure",
          "indistinguishable from" in briefs)
    check("boundary: states the outcome of an unbounded brief",
          "summarises what it happened to have read" in briefs)
    check("boundary: accepts any one of three finite boundaries",
          "any one of the three" in briefs)

    # (7) Boundaries and languages.
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: named-neighbor population is nonempty", len(named) >= 2, f"{sorted(named)}")
    check("boundary: every named neighbor exists", not missing, f"missing {missing}")
    # Lock expected neighbors literally; an empty population made existence vacuously true.
    check("boundary: consult, models, and author are named neighbors",
          {"consult", "models", "author"} <= named, f"{sorted(named)}")

    # Frontmatter contract: replacing the entire description must fail.
    kr_triggers = ['"병렬로"', '"동시에 여러"', '"서브에이전트"', '"에이전트 여러개"',
                   '"팀으로"', '"나눠서 진행"', '"작업 분배"']
    lost = [t for t in kr_triggers if t not in fm]
    check("language: description preserves all seven Korean triggers",
          not lost, f"missing {lost}")
    check("language: description also contains English triggers", "parallel" in fm and "fan out" in fm)
    check("language: trigger clause uses the literal marker", "Triggers —" in fm)
    fm_bytes = content_bytes(fm)
    check(f"language: description volume (>= 306B)", fm_bytes >= 306, f"{fm_bytes}B")
    check("L0: description contains both split criteria and verification",
          "checked separately" in fm and "verify what comes back" in fm)

    # Reachability: walk references/ rather than relying on a hard-coded list.
    refdir = os.path.join(ROOT, "references")
    refs_on_disk = sorted(n for n in os.listdir(refdir) if n.endswith(".md"))
    orphans = [n for n in refs_on_disk if f"references/{n}" not in skill]
    check("reachability: references/ population is nonempty",
          len(refs_on_disk) >= 5, f"{len(refs_on_disk)} files")
    check("reachability: every reference is reachable from the SKILL.md body",
          not orphans, f"orphans {orphans}")

    # Cross-check the paired contract against the counterpart file. If
    # orchestration-contract.md claims quality-verifier rejects executor reasoning,
    # that statement must exist in quality-verifier itself.
    contract = read(os.path.join(refdir, "orchestration-contract.md"))
    check("cross-check: paired-contract section names quality-verifier",
          "## The paired contract: quality-verifier" in contract)
    check("cross-check: section withholds executor reasoning from the verifier",
          "never the executor's reasoning" in contract)
    verifier = os.path.join(os.path.dirname(SKILLS), "agents",
                            "quality-verifier.md")
    check("cross-check: quality-verifier.md exists", os.path.isfile(verifier),
          verifier)
    vtext = read(verifier) if os.path.isfile(verifier) else ""
    check("cross-check: quality-verifier.md itself rejects executor rationale",
          "Do not receive the executor's rationale" in " ".join(vtext.split()),
          "paired contract exists on one side only")

    # (8) Operational rules with numeric contracts.
    check("reference: SKILL.md cites the operations contract",
          "references/operations.md" in skill)

    mtx = rows(ops, "## Phase selection matrix", headers=("Change",))
    check("operations: phase selection matrix has three rows", len(mtx) == 3, f"{len(mtx)} rows")
    check("operations: adding an agent reuses Phase 0 results for Phase 1",
          "| Add an agent | Skip; use Phase 0 results |" in ops)
    check("operations: skill changes skip Phases 1-3 and require Phase 4",
          "| Add or modify a skill | Skip | Skip | Skip | Required |" in ops)
    check("operations: architecture changes alone require Phase 2",
          "| Change architecture | Skip | Required |" in ops)

    size = rows(ops, "## Team size guidelines", headers=("Workload",))
    check("operations: team-size table has three rows", len(size) == 3, f"{len(size)} rows")
    check("operations: small 5-10 task work uses 2-3 members with 3-5 tasks each",
          "| Small: 5–10 tasks | 2–3 | 3–5 |" in ops)
    check("operations: medium 10-20 task work uses 3-5 members with 4-6 tasks each",
          "| Medium: 10–20 tasks | 3–5 | 4–6 |" in ops)
    check("operations: large 20+ task work uses 5-7 members with 4-5 tasks each",
          "| Large: 20+ tasks | 5–7 | 4–5 |" in ops)
    check("operations: includes the focused-three-over-distracted-five rule",
          "Three focused members are better than five distracted members" in oflat)
    check("operations: attributes the rule to coordination overhead",
          "Coordination overhead grows with team size" in ops)

    proto = rows(ops, "## Data handoff protocol", headers=("Strategy",))
    check("operations: data-handoff table has four rows", len(proto) == 4, f"{len(proto)} rows")
    check("operations: strategies are messages, tasks, files, and return values",
          proto == ["**Messages**", "**Tasks**", "**Files**", "**Return values**"], f"{proto}")
    check("operations: only files support both team and subagent modes",
          "| Read and write agreed paths | Team + subagents |" in ops)
    check("operations: messages are team-only",
          "Direct member communication with `SendMessage` | Team |" in ops)
    check("operations: return values are subagent-only",
          "Return message from the `Agent` tool | Subagents |" in ops)
    check("operations: team mode recommends tasks, files, and messages",
          "tasks for coordination + files for artifacts + messages for live communication" in oflat)
    check("operations: subagent mode recommends return values and files",
          "return values for results + files for large artifacts" in oflat)
    check("operations: hybrid mode chooses the combination per phase",
          "use the combination appropriate to each phase's execution mode" in oflat)

    frules = bullets(ops, "## Data handoff protocol")
    check("operations: file handoff has three rules", len(frules) == 3, f"{len(frules)} items")
    check("operations: intermediate artifacts live under `_workspace/`",
          "Store intermediate artifacts in `_workspace/`" in ops)
    check("operations: fixes the filename convention and example",
          "`{phase}_{agent}_{artifact}.{ext}`, for example `01_analyst_requirements.md`" in ops)
    check("operations: preserves intermediate files for verification and audit",
          "Preserve `_workspace/` intermediates for later verification and audit tracing" in oflat)

    follow = bullets(ops, "## Detecting follow-up runs")
    check("operations: follow-up detection has three branches", len(follow) == 3, f"{len(follow)} branches")
    check("operations: existing output plus partial modification means partial rerun",
          "partial modification requested: **partial rerun**" in ops)
    check("operations: existing output plus new input means new run and moves the workspace",
          "new input supplied: **new run**" in ops and "`_workspace_prev/`" in ops)
    check("operations: absent workspace means initial run",
          "`_workspace/` does not exist: **initial run**" in ops)

    fb = rows(ops, "## Where feedback belongs", headers=("Feedback type",))
    check("operations: feedback-routing table has five rows", len(fb) == 5, f"{len(fb)} rows")
    check("operations: enumerates all five feedback types",
          fb == ["Artifact quality", "Agent role", "Workflow order",
                 "Team composition", "Missing trigger"], f"{fb}")
    check("operations: artifact quality changes the agent's skill",
          "| Artifact quality | The agent's skill |" in ops)
    check("operations: workflow order changes the orchestrator skill",
          "| Workflow order | Orchestrator skill |" in ops)
    check("operations: missing triggers extend the skill description",
          "| Missing trigger | Skill description |" in ops)

    trig = bullets(ops, "## Evolution triggers")
    check("operations: evolution has three trigger conditions", len(trig) == 3, f"{len(trig)} conditions")
    check("operations: same feedback type recurring twice is a trigger",
          "same feedback type recurs at least twice" in ops)
    check("operations: repeated failure pattern is a trigger",
          "repeatedly fails in the same pattern" in ops)
    check("operations: user bypassing the orchestrator is a trigger",
          "user bypasses the orchestrator" in ops)

    steps = re.findall(r"(?m)^\*\*Step (\d): ", ops)
    check("operations: maintenance has four steps", steps == ["1", "2", "3", "4"], f"{steps}")
    check("operations: makes one change at a time and synchronizes immediately",
          "Make one change at a time" in ops and "immediately" in ops)
    check("operations: major-change threshold includes three or more agents",
          "adding/removing three or" in ops)

    # =====================================================================
    # (9) Add **content verdicts** for four references previously at floor 3.
    #
    # These four totaled 39 KB but had only needle, volume, and survival checks.
    # Those miss carving between preserved needles: qa-agent-guide.md was reduced
    # from 163 to 98 lines, padded with unique filler, and produced a byte-for-byte
    # identical FAIL baseline. Volume sees only absolute size, survival does not run
    # outside Git, and refreezing restores 100% even in Git.
    #
    # Match the verdict to each document: row/value bindings for tables, numbered
    # order for procedures, step counts and verbs for execution lists, required keys
    # and value forms for templates, exact checklist counts, and sentence-level
    # needles for directional claims that would survive negation at phrase level.
    # =====================================================================
    adp = read(os.path.join(ROOT, "references", "agent-design-patterns.md"))
    tpl = read(os.path.join(ROOT, "references", "orchestrator-template.md"))
    qa = read(os.path.join(ROOT, "references", "qa-agent-guide.md"))
    ex = read(os.path.join(ROOT, "references", "team-examples.md"))

    # --- agent-design-patterns.md ---------------------------------------
    ARCH = "## Team architectures"
    arch = re.findall(r"(?m)^### (\d)\. (.+)$", span(adp, ARCH, "\n## Composite patterns"))
    check("design: architecture section contains six types", len(arch) == 6, f"{len(arch)} types")
    check("design: six numbered types are pipeline, fan-out, expert pool, producer-reviewer, supervisor, hierarchy",
          arch == [("1", "Pipeline"), ("2", "Fan-out/Fan-in"),
                   ("3", "Expert pool"), ("4", "Producer-Reviewer"),
                   ("5", "Supervisor"), ("6", "Hierarchical delegation")],
          f"{arch}")
    fit = re.findall(r"(?m)^\*\*Team suitability:\*\*", span(adp, ARCH, "\n## Composite patterns"))
    check("design: all six types include a team-suitability verdict", len(fit) == 6, f"{len(fit)} verdicts")
    # Lock directional claims at sentence level so inserted negation cannot survive.
    check("design: fan-out/fan-in requires an agent team",
          "**Use an agent team.**" in adp)
    check("design: expert pools instead favor subagents",
          "subagents fit better because only needed experts run" in adp)
    check("design: hierarchical delegation cites the no-nested-teams constraint",
          "teams cannot nest" in adp)
    check("design: hierarchy depth is capped at two levels",
          "Prefer at\nmost two levels" in adp or "Prefer at most two levels" in adp)
    check("design: producer-reviewer retries are capped at 2-3",
          "maximum of 2–3 retries" in adp)
    check("design: supervisor differs from fan-out by fixed versus dynamic assignment",
          "fan-out fixes assignments in advance; a supervisor\nadjusts them according to progress" in adp
          or "fan-out fixes assignments in advance; a supervisor adjusts them according to progress" in adp)
    check("design: teams are default and subagents require a communication check",
          "agent teams are the default" in adp and "communication between members is truly unnecessary" in adp)
    check("design: only one active team per session and teams cannot nest",
          "Only one team may be **active** per session" in adp and "Teams cannot nest" in adp)
    # Decision-tree branch order and destinations are values.
    tree = span(adp, "### Mode selection decision tree", "\n---")
    check("design: decision tree begins with at least two agents", "Are there at least two agents?" in tree)
    check("design: communication leads to team, no communication to subagents, one agent to subagent",
          bool(re.search(r"Yes → Agent team \(default\).*No → Subagents are also suitable.*"
                         r"└── No → Subagent\n", tree, re.S))
          and "Do they need to communicate?" in tree)
    # Bind complete table rows because column swaps preserve bytes and hashes.
    bi = pairs(adp, "### Built-in types", "### Custom types", headers=("Type",))
    check("design: built-in type table has three rows", len(bi) == 3, f"{len(bi)} rows")
    check("design: each built-in type binds to its tool access and use",
          bi == [["`general-purpose`", "All tools, including WebSearch and WebFetch", "Web research and general work"],
                 ["`Explore`", "Read only; no Edit/Write", "Codebase exploration and analysis"],
                 ["`Plan`", "Read only; no Edit/Write", "Architecture and planning"]], f"{bi}")
    sep = pairs(adp, "## Criteria for separating agents", "## Skills versus agents", headers=("Criterion",))
    check("design: separation-criteria table has four rows", len(sep) == 4, f"{len(sep)} rows")
    check("design: each criterion binds to its separate and combine values",
          sep == [["Expertise", "Different domains", "Overlapping domains"],
                  ["Parallelism", "Independent execution possible", "Consider combining sequential dependencies"],
                  ["Context", "High context burden", "Lightweight, quick work"],
                  ["Reuse", "Useful in other teams", "Consider combining team-specific roles"]], f"{sep}")
    sva = pairs(adp, "## Skills versus agents", "## Connecting skills and agents",
                headers=("Aspect",))
    check("design: skill/agent comparison table has five rows", len(sva) == 5, f"{len(sva)} rows")
    check("design: each comparison axis binds skill and agent values",
          sva == [["Definition", "Procedural knowledge and tool bundle", "Expert persona and operating principles"],
                  ["Location", "`.claude/skills/`", "`.claude/agents/`"],
                  ["Activation", "User-request keyword matching", "Explicit invocation through Agent"],
                  ["Size", "Small to large workflow", "Small role definition"],
                  ["Purpose", "How to do the work", "Who does the work"]], f"{sva}")
    link = xrows(adp, "## Connecting skills and agents", headers=("Method",))
    check("design: skill-connection table has three methods", len(link) == 3, f"{len(link)} methods")
    check("design: methods are Skill invocation, inline prompt, and reference loading",
          link == ["**Skill tool invocation**", "**Inline prompt**", "**Reference loading**"],
          f"{link}")
    check("design: inline method has a 50-line cap", "at most 50 lines" in adp)
    # Measure required template keys and value forms.
    adef = span(adp, "## Agent definition structure", "## Criteria for separating agents")
    check("design: agent template requires name and description frontmatter",
          "name: agent-name" in adef and "description: \"One or two sentences describing the role. List trigger keywords.\"" in adef)
    adef_h = re.findall(r"(?m)^## (.+)$", adef)
    check("design: definition template has six required sections in order",
          adef_h == ["Core responsibilities", "Operating principles", "Input/output protocol",
                     "Team communication protocol (agent team mode)", "Error handling", "Collaboration"], f"{adef_h}")
    check("design: requires defining every agent in a file",
          "define every agent in `.claude/agents/{name}.md`" in adp)
    check("design: chooses supported models by routing contract",
          'use the supported model selected by the `models` routing contract' in adp)
    cmb = xrows(adp, "## Composite patterns", "### Execution modes for composite patterns", headers=("Pattern",))
    check("design: composite-pattern table has three rows", len(cmb) == 3, f"{len(cmb)} rows")
    check("design: patterns are fan-out plus review, pipeline plus fan-out, and supervisor plus pool",
          cmb == ["**Fan-out + producer-reviewer**", "**Pipeline + fan-out**", "**Supervisor + expert pool**"],
          f"{cmb}")
    scn = xrows(adp, "### Execution modes for composite patterns", "## Selecting agent types",
                headers=("Scenario",))
    check("design: four composite scenarios all select agent teams",
          len(scn) == 4 and span(adp, "### Execution modes for composite patterns",
                                 "## Selecting agent types").count("| Agent team |") == 4,
          f"{len(scn)} rows")

    # --- orchestrator-template.md ---------------------------------------
    TA = span(tpl, "## Template A:", "## Template B:")
    TB = span(tpl, "## Template B:", "## Template C:")
    TC = span(tpl, "## Template C:", "## Writing Principles")
    pa = re.findall(r"(?m)^### Phase (\d): (.+)$", TA)
    check("template: A has six numbered phases from 0 through 5",
          pa == [("0", "Inspect Context (Support Follow-up Work)"),
                 ("1", "Prepare"), ("2", "Create the Team"),
                 ("3", "{Primary Work — for example, Research, Generation, or Analysis}"),
                 ("4", "{Follow-up Work — for example, Validation or Integration}"),
                 ("5", "Clean Up")], f"{pa}")
    pb = re.findall(r"(?m)^### Phase (\d): (.+)$", TB)
    check("template: B has five numbered phases from 0 through 4",
          pb == [("0", "Inspect Context"), ("1", "Prepare"), ("2", "Run in Parallel"),
                 ("3", "Integrate"), ("4", "Clean Up")], f"{pb}")
    pc = re.findall(r"(?m)^### Phase (\d): (.+)$", TC)
    check("template: C demonstrates only Phases 2, 3, and 4",
          pc == [("2", "Parallel Data Collection"),
                 ("3", "Consensus-based Integration"),
                 ("4", "Independent Validation")], f"{pc}")
    hyb = pairs(tpl, "## Execution Mode: Hybrid", "### Phase 2:", headers=("Phase",))
    check("template: hybrid phase/mode table has three rows", len(hyb) == 3, f"{len(hyb)} rows")
    check("template: each hybrid phase binds to mode and reason (subagent, team, subagent)",
          hyb == [["Phase 2 (parallel collection)", "Subagents", "Independent data collection; no team communication required"],
                  ["Phase 3 (consensus integration)", "Agent team", "Conflicting data requires discussion and agreement"],
                  ["Phase 4 (independent validation)", "Subagent", "One QA agent performs an objective validation"]],
          f"{hyb}")
    check("template: C's phase table records subagent, team, subagent in order",
          [r[1] for r in hyb] == ["Subagents", "Agent team", "Subagent"], f"{hyb}")
    eh = pairs(tpl, "## Error Handling", "## Test Scenarios", headers=("Situation",))
    check("template: A error-handling table has five rows", len(eh) == 5, f"{len(eh)} rows")
    check("template: five situations bind to their responses",
          [r[0] for r in eh] == ["One teammate fails or stops", "A majority of teammates fail",
                                 "Timeout", "Data conflicts between teammates",
                                 "Task status is delayed"]
          and "Preserve both versions" in eh[3][1]
          and "do not delete either version" in eh[3][1], f"{[r[0] for r in eh]}")
    prin = numbered(tpl, "## Writing Principles", "## Follow-up Keywords")
    check("template: writing principles have seven items", len(prin) == 7, f"{len(prin)} items")
    check("template: seven principles are bound to their numbered order",
          prin == [("1", "State the execution mode first"),
                   ("2", "In team mode, specify `TeamCreate`, `SendMessage`, and `TaskCreate` usage concretely"),
                   ("3", "In subagent mode, specify every `Agent` tool parameter"),
                   ("4", "Make file paths absolute"),
                   ("5", "Declare dependencies between phases"),
                   ("6", "Make error handling realistic"),
                   ("7", "Test scenarios are required")], f"{prin}")
    check("template: enumerates five Agent parameters for subagent mode",
          all(p in TB for p in ("`name`", "`subagent_type`", "`prompt`",
                                "`run_in_background: true`", "`model`")))
    check("template: includes at least one normal and one error test scenario",
          "### Normal Flow" in tpl and "### Error Flow" in tpl)
    check("template: hybrid transition rules cover team-to-subagent, subagent-to-team, and team-to-team",
          all(x in tpl for x in ("Team → subagent:", "Subagent → team:", "Team → team:"))
          and "Clean up the previous team" in tpl)
    follow_words = ("rerun", "update", "revise", "supplement", "repeat only part",
                    "build on previous results", "improve the result")
    check("template: follow-up language includes all seven trigger forms",
          all(x in tpl.lower() for x in follow_words),
          f"missing {[x for x in follow_words if x not in tpl.lower()]}")
    check("template: missing follow-up triggers makes later selection difficult",
          "effectively dead code after its first run" in tpl)
    check("template: recommends five or six tasks per teammate", "Five to six tasks per teammate" in tpl)
    check("template: TeamCreate example includes team_name, members, agent_type, model, and prompt",
          all(k in TA for k in ('team_name: "{domain}-team"', "members: [", 'agent_type: "{type}"',
                                'model: "{selected-model}"', 'prompt: "{role description and work instructions}"')))
    check("template: TaskCreate example includes title, description, assignee, and depends_on",
          all(k in TA for k in ("TaskCreate(tasks: [", 'title: "{task-1}"',
                                'description: "{details}"', 'assignee: "{teammate-1}"',
                                'depends_on: ["{task-1}"]')))
    check("template: B parallel phase names model and run_in_background parameters",
          "specify `name`, `subagent_type`, `prompt`, `model`, and `run_in_background: true`" in TB)
    check("template: cleanup preserves _workspace/ for verification and audit",
          "Preserve the `_workspace/` directory" in tpl
          and "required for later verification and an audit trail" in tpl)

    # --- qa-agent-guide.md ----------------------------------------------
    toc = re.findall(r"(?m)^(\d)\. (.+)$", span(qa, "## Contents", "\n---"))
    check("QA: contents list binds five numbered sections to their titles",
          toc == [("1", "Defect patterns QA agents miss"),
                  ("2", "Integration coherence verification"),
                  ("3", "QA agent design principles"),
                  ("4", "Validation checklist template"),
                  ("5", "QA agent definition template")], f"{toc}")
    bm = xrows(qa, "### 1-1. Boundary Mismatch", "### 1-2.", headers=("Boundary",))
    check("QA: boundary-mismatch table has six rows", len(bm) == 6, f"{len(bm)} rows")
    check("QA: six boundaries cover response-to-hook, field-to-type, path-to-href, transition-to-update, endpoint-to-hook, and immediate-to-async",
          bm == ["API response → frontend hook", "API response field name → type definition",
                 "File path → link href", "State-transition map → actual status update",
                 "API endpoint → frontend hook", "Immediate response → asynchronous result"], f"{bm}")
    check("QA: three static-review blind spots are generics, successful builds, and existence checks",
          "**Limit of TypeScript generics:**" in qa
          and "**`npm run build` passing does not mean the behavior works:**" in qa
          and "**Existence checks and connection checks are different:**" in qa)
    # Measure the number of procedure lists and the action of every step. Deleting
    # a list or replacing one action with another must fail this contract.
    icv = span(qa, "## 2. Integration Coherence Verification",
               "## 3. QA Agent Design Principles")
    steps_blocks = [re.findall(r"(?m)^(\d)\. (.+)$", b)
                    for b in re.findall(r"Validation steps:\n(.*?)\n```", icv, re.S)]
    check("QA: all four integration sections contain a Validation steps procedure",
          len(steps_blocks) == 4, f"{len(steps_blocks)} procedures")
    check("QA: the four procedures contain 4, 4, 5, and 4 steps",
          [len(b) for b in steps_blocks] == [4, 4, 5, 4],
          f"{[len(b) for b in steps_blocks]}")
    # English imperatives put the action verb first. Bind every step to that verb,
    # which preserves the original test's protection of all 17 actions.
    verbs = [[t.split()[0] for _, t in b] for b in steps_blocks]
    check("QA: every procedure step remains bound to its action verb",
          verbs == [["Extract", "Inspect", "Compare", "Check"],
                    ["Derive", "Collect", "Confirm", "Pay"],
                    ["Extract", "Search", "Confirm", "Identify", "Confirm"],
                    ["List", "List", "Identify", "Determine"]], f"{verbs}")
    check("QA: state-transition tracing includes dead-transition identification as a step",
          "Identify transitions declared in the map that no code executes (dead transitions)." in qa)
    prc = re.findall(r"(?m)^### 3-(\d)\. (.+)$", qa)
    check("QA: four design principles remain bound to their numbers",
          prc == [("1", "Use `general-purpose`, Not the `Explore` Type"),
                  ("2", "Prefer Cross-comparison Checks Over Existence Checks"),
                  ("3", 'The "Read Both Sides Together" Principle'),
                  ("4", "Run QA Immediately After Each Module, Not Only After the Build")], f"{prc}")
    ws = pairs(qa, "### 3-2.", "### 3-3.", headers=("Weak checklist item",))
    check("QA: weak/strong checklist comparison has four rows", len(ws) == 4, f"{len(ws)} rows")
    check("QA: each weak question remains bound to its stronger cross-check",
          ws == [["Does the API endpoint exist?",
                  "Does the API endpoint's response shape match the corresponding hook's type?"],
                 ["Is a state-transition map defined?",
                  "Does every status update in the code agree with a transition in the map?"],
                 ["Does the page file exist?",
                  "Does every link in the code point to a page that actually exists?"],
                 ["Is TypeScript strict mode enabled?",
                  "Is any type safety bypassed through generic casts?"]], f"{ws}")
    check("QA: incremental QA is fixed as the recommended pattern",
          "As soon as each backend API is complete, cross-check that API and its corresponding hook (incremental QA)." in qa)
    # Lock exact checklist counts; `>= N` would tolerate deletion.
    cl = span(qa, "## 4. Validation Checklist Template", "## 5. QA Agent Definition Template")
    cl_heads = re.findall(r"(?m)^#### (.+)$", cl)
    check("QA: checklist is divided into four areas",
          cl_heads == ["API ↔ Frontend Connection", "Routing Coherence",
                       "State-machine Coherence", "Data-flow Coherence"], f"{cl_heads}")
    cl_counts = [len(re.findall(r"(?m)^- \[ \] ", b))
                 for b in re.split(r"(?m)^#### .+$", cl)[1:]]
    check("QA: checklist counts are 5, 3, 4, and 3 for a total of 15",
          cl_counts == [5, 3, 4, 3] and sum(cl_counts) == 15, f"{cl_counts}")
    check("QA: response unwrapping and the 202/final-result distinction remain checklist items",
          "- [ ] When a response is wrapped, such as `{ items: [...] }`, the hook unwraps it." in qa
          and "- [ ] The frontend distinguishes the shape of an immediate response (`202`) from the final result." in qa)
    # Measure required template keys and value forms.
    qad = span(qa, "## 5. QA Agent Definition Template", "## Real Failures Found in SatangSlide")
    check("QA: definition template has name qa-inspector and a description value",
          "name: qa-inspector" in qad
          and 'description: "A QA validation specialist. Validates specification compliance, integration coherence, and design quality."' in qad)
    qad_h = re.findall(r"(?m)^## (.+)$", qad)
    check("QA: definition template contains responsibility, priority, method, and communication sections",
          qad_h == ["Core Responsibility", "Validation Priority",
                    'Validation Method: "Read Both Sides Together"',
                    "Team Communication Protocol"], f"{qad_h}")
    pri = numbered(qad, "## Validation Priority", "## Validation Method")
    check("QA: four validation priorities remain numbered with integration coherence first",
          pri == [("1", "Integration coherence"),
                  ("2", "Functional specification compliance"),
                  ("3", "Design quality"), ("4", "Code quality")], f"{pri}")
    both = pairs(qad, '## Validation Method: "Read Both Sides Together"',
                 "## Team Communication Protocol", headers=("Validation target",))
    check("QA: read-both-sides table has four rows", len(both) == 4, f"{len(both)} rows")
    check("QA: each producer remains bound to its consumer",
          both == [["API response shape", "`NextResponse.json()` in route.ts", "`fetchJson<T>` in hooks/"],
                   ["Routing", "Page-file paths under src/app/", "`href` and `router.push` values"],
                   ["State transitions", "`STATE_TRANSITIONS` map", "`.update({ status })` code"],
                   ["Database → API → UI", "Table column names", "API response fields → type definitions"]], f"{both}")
    check("QA: boundary issues must be reported to the agents on both sides",
          "For a boundary defect, notify the agents responsible for **both** sides." in qad)
    cases = xrows(qa, "## Real Failures Found in SatangSlide", headers=("Defect",))
    check("QA: real-failure table has seven rows", len(cases) == 7, f"{len(cases)} rows")
    check("QA: cases retain concrete filter, failedIndices, and thumbnail symptoms",
          "`projects?.filter is not a function`" in qa
          and "`data.failedIndices`" in qa and "`thumbnailUrl` vs `thumbnail_url`" in qa)

    # --- team-examples.md ------------------------------------------------
    exs = re.findall(r"(?m)^## Example (\d): (.+)$", ex)
    check("examples: five examples are bound to their numbers",
          exs == [("1", "Research Team"),
                  ("2", "Science-fiction Writing Team"),
                  ("3", "Webtoon Production"),
                  ("4", "Code Review Team"),
                  ("5", "Supervisor Pattern for Code Migration")], f"{exs}")
    pairs_am = re.findall(
        r"(?m)^\*\*Architecture:\*\* (.+?)\. \*\*Mode:\*\* (.+?)\.$", ex)
    check("examples: each architecture is bound to its execution mode",
          pairs_am == [("fan-out/fan-in", "agent team"),
                       ("pipeline plus fan-out", "agent team for collaborative phases and subagents for individual phases"),
                       ("generate and verify", "subagents"),
                       ("fan-out/fan-in plus discussion", "agent team"),
                       ("supervisor", "agent team")], f"{pairs_am}")
    rt = pairs(ex, "| Teammate | Agent type | Role | Output |",
               "Define every research agent", headers=("Teammate",))
    check("examples: research-team roster has five rows", len(rt) == 5, f"{len(rt)} rows")
    check("examples: four researchers and the leader bind to their output files",
          [r[0] for r in rt] == ["official-researcher", "media-researcher",
                                 "community-researcher", "background-researcher",
                                 "Leader/orchestrator"]
          and [r[-1] for r in rt] == ["research_official.md", "research_media.md",
                                      "research_community.md", "research_background.md",
                                      "consolidated-report.md"], f"{[r[0] for r in rt]}")
    rphase = re.findall(r"(?m)^Phase (\d): (.+)$", span(ex, "## Example 1:", "## Example 2:"))
    check("examples: research workflow binds Phases 1 through 5 to their names",
          rphase == [("1", "Preparation"), ("2", "Team creation"), ("3", "Research"),
                     ("4", "Consolidation"), ("5", "Cleanup")]
          and "sends newly discovered official statistics to the media" in ex
          and "preserve both sourced versions" in ex, f"{rphase}")
    nt = xrows(ex, "## Example 2:", "## Example 3:", headers=("Teammate",))
    check("examples: writing team has six members", len(nt) == 6, f"{len(nt)} members")
    check("examples: six members cover world, character, plot, prose, science, and continuity",
          nt == ["worldbuilder", "character-designer", "plot-architect",
                 "prose-stylist", "science-consultant", "continuity-manager"], f"{nt}")
    wb = span(ex, "### Full agent example: `worldbuilder.md`", "### Detailed team workflow")
    check("examples: worldbuilder definition has name and description values",
          "name: worldbuilder" in wb
          and 'description: "Designs science-fiction worlds, including physical laws, social structures, technology, and history."' in wb)
    wb_h = re.findall(r"(?m)^## (.+)$", wb)
    check("examples: worldbuilder definition has six required sections in order",
          wb_h == ["Core responsibilities", "Working principles", "Input and output protocol",
                   "Team communication protocol", "Error handling", "Collaboration"], f"{wb_h}")
    check("examples: worldbuilder output path is _workspace/01_worldbuilder_setting.md",
          "- Output: `_workspace/01_worldbuilder_setting.md`" in wb
          and "Read all three Phase 1 artifacts from _workspace/" in ex
          and "Write _workspace/02_prose_draft.md" in ex)
    webtoon = span(ex, "## Example 3:", "## Example 4:")
    check("examples: webtoon-reviewer binds to its role and two skills",
          "| webtoon-reviewer | custom | Review quality | review-webtoon, fix-webtoon-panel |" in webtoon
          and "name: webtoon-reviewer" in webtoon
          and 'description: "Reviews webtoon panels' in webtoon
          and "Input: panel images under `_workspace/panels/`" in webtoon
          and "Output: `_workspace/review_report.md`" in webtoon)
    check("examples: decisions are PASS/FIX/REDO and distinguish partial edits from regeneration",
          "returns `PASS`, `FIX`, or `REDO`" in webtoon
          and "Use `FIX` when a partial edit is sufficient and `REDO` when full regeneration is required" in webtoon)
    check("examples: retries stop after two loops and then pass with a warning",
          "at most two loops" in webtoon and "pass the panel with a warning" in webtoon)
    check("examples: a REDO majority triggers a prompt-revision suggestion",
          "at least half of all panels receive `REDO`" in webtoon
          and "suggest revising the generation prompt" in webtoon
          and "Deliver file-based correction instructions to webtoon-artist" in webtoon
          and "Review regenerated panels again, for at most two loops" in webtoon)
    check("examples: code review team includes security, performance, and test reviewers",
          all(f"{n}-reviewer" in span(ex, "## Example 4:", "## Example 5:")
              for n in ("security", "performance", "test")))
    check("examples: reviewers communicate directly across specialties",
          "Reviewers communicate directly to catch issues that cross specialties" in ex)
    sup = span(ex, "## Example 5:", "## Deliverable Patterns")
    sup_steps = re.findall(r"(?m)^(\d)\. (.+)$", sup)
    check("examples: supervisor allocation retains all six numbered workflow steps",
          len(sup_steps) == 6 and [n for n, _ in sup_steps] == list("123456"),
          f"{sup_steps}")
    check("examples: supervisor steps preserve collection-to-reassignment order",
          all(x in sup for x in ("Collect the complete target-file list",
                                 "Estimate complexity from file size, import count, and dependencies",
                                 "Register file batches and dependencies as tasks with `TaskCreate`",
                                 "Let teammates claim available work",
                                 "ask for the cause with `SendMessage`",
                                 "leader run integration tests")))
    check("examples: supervisor differs from fixed fan-out through dynamic runtime assignment",
          "Unlike a fixed fan-out, this pattern assigns work dynamically at runtime" in sup)
    check("examples: agent definitions enumerate five required sections",
          "includes core responsibilities, working principles, input/output protocol, error handling, and collaboration" in ex)
    check("examples: team mode additionally requires a communication protocol",
          "Team-mode definitions also include a **team communication protocol**" in ex
          and "incoming and outgoing messages" in ex)

    # --- orchestration-contract.md: measure the contract's constraints.
    wh = numbered(contract, "## What \"does not receive\" excludes",
                  "## Why this is a constraint")
    check("contract: two withheld inputs are bound to their numbered order",
          wh == [("1", "The original."), ("2", "Your carve reasoning.")], f"{wh}")
    # Paragraph wrapping can change, so collapse whitespace and test sentences.
    cflat = re.sub(r"\s+", " ", contract)
    check("contract: handing over the original defeats carving",
          "Handing over the original alongside the carved prompt defeats the carving"
          in cflat)
    check("contract: a boundary is defined by what actually crosses it",
          "a boundary is set by what crosses it, not by what could" in cflat)
    check("contract: an original plus a carved prompt is only an original plus a suggestion",
          "it has the original, plus a suggestion" in contract)
    check("contract: the information cut applies toward executor and verifier",
          "does not cross that step's boundary in either direction" in cflat)
    check("contract: verifier receives artifact and original but not executor reasoning",
          "the verifier receives the artifact and the original" in cflat)
    check("contract: cites four brief fields and excludes carve reasoning from them",
          "the deliverable, the output shape, what is out of scope, and what has already been established" in cflat
          and 'None of those fields is "why I decided this is the task"' in cflat)
    check("contract: carries the conclusion without its source or reasoning path",
          "carry the conclusion into the brief — not the source, and not the path you took to reach it" in cflat)

    # --- briefs.md: bind each field to the failure it prevents.
    fp2 = pairs(briefs, "## The fields", "## Say what is settled", headers=("Field",))
    check("briefs: five fields bind row-by-row to the failures they prevent",
          fp2 == [["The deliverable, in one sentence",
                   "An agent that explores instead of producing"],
                  ["The output shape",
                   "A report you have to re-read to extract anything from"],
                  ["Already established",
                   "Rediscovery, and rediscovery that lands somewhere different"],
                  ["Explicitly out of scope",
                   "Scope drift into the neighbouring agent's work"],
                  ["How it will be checked",
                   "Work that cannot be verified when it comes back"]], f"{fp2}")

    # --- operations.md: add semantic checks beyond the zero-slack size floor.
    check("operations: phases define all six harness-building stages",
          "1 domain analysis, 2 team architecture, 3 agent definitions, 4 skills, "
          "5 integration and orchestration, 6 validation and testing" in oflat
          and "Phase 0 audits the current state and always comes first" in oflat)
    check("operations: phase matrix has columns for Phases 1 through 6",
          "| Change | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |" in ops)
    check("operations: agent-role feedback changes the agent definition",
          '| Agent role | Agent definition `.md` | "Security review is needed": add an agent |' in ops)
    check("operations: team-composition feedback changes orchestrator and agents",
          '| Team composition | Orchestrator + agents | "These two can be combined": merge agents |' in ops)
    check("operations: task lower and upper bounds explain briefing cost and bottlenecks",
          "Below three tasks per member, briefing costs more than execution; above six, "
          "one member becomes a bottleneck" in oflat)
    check("operations: follow-up detection uses workspace existence and request type",
          "Both dimensions matter" in ops
          and "request type alone may try to read nonexistent artifacts on an initial run" in oflat)
    check("operations: moving old results preserves comparison",
          "Move existing results instead of overwriting them so the previous version remains "
          "available for comparison" in oflat)
    check("operations: timestamp suffix implements the same archival rule",
          "implements the same rule with a timestamp suffix, `_workspace_{YYYYMMDD_HHMMSS}/`" in oflat)
    check("operations: follow-up activation requires description keywords and recall instructions",
          "**Include follow-up keywords in the orchestrator description:**" in ops
          and "**Include recall instructions in agent definitions:**" in ops)
    check("operations: skipping Step 3 creates a mismatch at the next audit",
          "Skipping Step 3 after a modification creates a mismatch in the next audit" in oflat)

    check_skill_body(check, ROOT, needles=[
        "**independent to check**",
        "does not see this conversation",
        "do not let one see another's",
        "is a claim, not a result",
        "no merge problem",
        "references/operations.md",
    ], floor=4100)

    check_ref_contracts(check, ROOT, [
        ("briefs.md", "field table, settled facts, output shape, exploration bounds, and evidence",
         ["neither does the edge", "now there are two answers",
          "the form you will combine", "Ask for evidence in the report",
          "State whether the agent starts fresh or inherits a fork",
          "Do not spawn other agents", "including the coordinator",
          "Independent reviewers do not see one another"], 1522),
        ("agent-design-patterns.md", "team and subagent modes, six architectures, and separation criteria",
         ["Execution modes: agent teams and subagents", "Mode selection decision tree",
          "Skills versus agents"], 8941),
        ("orchestrator-template.md", "three orchestrator templates for team, subagent, and hybrid modes",
         ["Template A: Agent Team", "Template B: Subagent Mode",
          "Template C: Hybrid"], 9455),
        ("qa-agent-guide.md", "boundary mismatches, integration coherence, and QA design principles",
         ["Defect Patterns QA Agents Miss", "Integration Coherence Verification",
          "As soon as each backend API is complete, cross-check that API and its corresponding hook"], 8558),
        ("team-examples.md", "five examples for research, writing, webtoon, code review, and supervision",
         ["Example 1: Research Team", "Example 4: Code Review Team",
          "Supervisor Pattern for Code Migration"], 8922),
        ("orchestration-contract.md", "information-cut constraint and its paired quality-verifier contract",
         ["carved prompt", "never the executor's reasoning",
          "anchor on the executor's claim"], 2365),
        ("operations.md", "team sizes, four handoffs, three follow-ups, five feedback paths, three evolution triggers, and four steps",
         ["Three focused members are better",
          "| Large: 20+ tasks | 5–7 | 4–5 |",
          "Preserve\n  `_workspace/` intermediates for later verification and audit tracing",
          "move the old workspace to `_workspace_prev/`",
          "adding/removing three or\n  more agents"], 5413),
    ])

    # Measured and fixed with zero slack. The earlier four-reference ceiling was
    # three checks: needle, size, and survival. Survival did not run in the
    # out-of-repository deletion copy, so its effective ceiling was two. Remeasure
    # only after adding semantic checks.
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 47, "SKILL.codex.md": 14, "references/briefs.md": 20,
        "references/agent-design-patterns.md": 32,
        "references/orchestrator-template.md": 23,
        "references/qa-agent-guide.md": 26,
        "references/team-examples.md": 24,
        "references/orchestration-contract.md": 13,
        "references/operations.md": 51,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_body_deletion(check, __file__, ROOT, minimum=47,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 268)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
