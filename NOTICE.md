# jstack provenance and distribution scope

jstack combines original instructions and runtime code with material imported
from other projects. The root `LICENSE` (MIT) covers original jstack material
only. Imported material keeps its own terms: the owning directory's `LICENSE`,
`LICENSE.*`, `NOTICE` and `UPSTREAM*` files record them, and
`.agents/skills/upstream-patrol/upstreams.json` records each source, pin and
local path.

## Imported material

| Source | Terms | Pin | Local paths |
|---|---|---|---|
| [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | MIT; some children declare their own terms (below) | `36d8f13` | `skills/public/research/scientific-tools/repos/kdense` |
| [google-deepmind/science-skills](https://github.com/google-deepmind/science-skills) | Apache-2.0 | `0b42509` | `skills/public/research/scientific-tools/repos/gdm` |
| [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | CC BY-NC 4.0 | `9469fc4` | `skills/public/research/scientific-tools/repos/academic` |
| [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design) | MIT | `ac490fd`, `8d8b299` | `skills/public/artifacts/svg-diagram` |
| [tt-a1i/archify](https://github.com/tt-a1i/archify) | MIT | `0853a80` | `skills/public/artifacts/svg-diagram` |
| [hunkim/ai-is-fast-your-tests-are-slow](https://github.com/hunkim/ai-is-fast-your-tests-are-slow) | MIT | `9b076d0` | `repository-setup` and `verify` references |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT, declared in its README and skill frontmatter; no license file | `063bee9` | `skills/public/engineering/react-performance/rules` |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT | `e3d624b` | `skills/public/engineering/web-interface` |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Apache-2.0 | `a86e346`, `aecd4c8` | `skills/public/engineering/repository-setup` |
| [ysys143/journey-qa](https://github.com/ysys143/journey-qa) | MIT | `8004bae` | `skills/public/workflow/journey-qa/repos/journey-qa` |
| [ysys143/cc-session-sync](https://github.com/ysys143/cc-session-sync) | The jstack author's own project | — | `skills/public/operations/session-memory/bin` |
| [corazzon/pptx-design-styles](https://github.com/corazzon/pptx-design-styles) | MIT, declared in its README; no license file | — | `skills/public/artifacts/slides/references/styles.md` |
| [uppinote20/claude-dashboard](https://github.com/uppinote20/claude-dashboard) | MIT | `f0937fe` | `skills/public/operations/dashboard` and its command and hook |
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | MIT | `30756c4` | `hosts/claude/mods/stack-viewer` (the `stack-viewer` Claude Code mod, unchanged) |
| [TryGhost/node-sqlite3](https://github.com/TryGhost/node-sqlite3) | BSD-3-Clause | `ba4ba07` | `packaging/vendor/sqlite3` and the SQLite runtime |
| [snflkd/fluent-korean](https://github.com/snflkd/fluent-korean) | MIT | — | `hosts/claude/output-styles/fluent-korean*.md`, `humanize` taxonomy |
| [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) | MIT | — | `hwpx-document` and `humanize` references |
| [vibedesignlab/slopslap](https://github.com/vibedesignlab/slopslap) | MIT | — | `skills/public/artifacts/image-generation/references/prompts.md` |
| [jkf87/noslop-ko](https://github.com/jkf87/noslop-ko) | MIT | — | `humanize` references |
| [corca-ai/claude-plugins](https://github.com/corca-ai/claude-plugins) | MIT | — | `google-workspace` report references |
| [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai) | MIT | `82137e8` | `humanize` references and scripts |
| 도대리의 서랍장, humanize-ko ([EP.01](https://dodaeri.vercel.app/ep/1)) | MIT, declared on the page; no individual holder named | — | `humanize` references and the `naturalness-reviewer` agent |
| [blader/humanizer](https://github.com/blader/humanizer) | MIT | — | `humanize` English references and Korean structure rules |
| [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) | MIT | — | `naturalness-reviewer` reader rubric |
| [tjboudreaux/cc-thinking-skills](https://github.com/tjboudreaux/cc-thinking-skills) | MIT | `7b8fece` | `verify`, `plan` and `skill-creator` references |
| [OWASP/CheatSheetSeries](https://github.com/OWASP/CheatSheetSeries) | CC BY-SA 4.0 | `6b6a66b` | `skills/public/workflow/review/references/owasp-cheatsheet-map.md` |
| hyperresearch | MIT | — | `skills/public/research/research` references and wrapper contract |
| benelog, "클로드 문체 없애기 지침" (gist) | No license; principles restated in original wording, no text copied | — | `humanize` taxonomy |

`hwpx-document` started from the `hwpx-skill` plugin by stevechoi0222; 26 of its
files are unchanged from that plugin.

## Terms that restrict reuse

- **Per-skill terms in kdense:** the repository license is MIT, but many kdense
  children declare their own `license:` in frontmatter, and that declaration
  applies to the child. Most are permissive (MIT, BSD, Apache-2.0); read the
  frontmatter before reusing any child. Notably `deepspot-m` (PolyForm
  Noncommercial 1.0.0) and `what-if-oracle` (CC BY-NC-SA 4.0) are noncommercial,
  `bioservices`, `etetoolkit` and `cobrapy` declare GPL terms, and `rowan`
  describes a proprietary API.
- **Noncommercial:** `repos/academic` (CC BY-NC 4.0) and the kdense children named
  above. Using them for commercial output may fall outside their licenses.
- **ShareAlike:** the OWASP Cheat Sheet map (CC BY-SA 4.0). Adaptations must keep
  the same license.
- **Declared without a license file:** vercel-labs/agent-skills and
  corazzon/pptx-design-styles state MIT in their documentation only.

## Not included

- The kdense children `docx`, `pdf`, `pptx` and `xlsx`: each carries an Anthropic
  license that forbids redistribution.

Upstream content, licenses and canonical relative paths are preserved. Four
aliases under academic's `skills/` are directory links that would duplicate the
same sources, so they are excluded from distribution; `packaging/excluded-aliases.json`
records them. The public delivery artifact is a generated package with a file
inclusion list and content hashes.
