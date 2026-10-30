# Browser Tool Priority: One Authority

Several browser tools can perform overlapping work. This file makes the selection explicit instead of letting whichever MCP happens to be loaded decide.

## Authority

The same policy is needed in three places:

| Consumer | Why it needs the selection policy |
|---|---|
| `deck` skill | Opens a browser during the visual-QA loop. |
| `diagram` skill | Opens a browser to verify rendered diagrams. |
| Project instructions appended by `setup` | Preserves the same order outside the plugin. |

They should reference this file instead of maintaining three independent
authorities. A standalone skill may inline the table so it remains functional
when installed alone, but this file wins if the copy diverges.

## Selection Table

| Condition | Tool |
|---|---|
| Default | `agent-browser`: headless CLI, does not occupy the user's browser, and exposes an accessibility tree through stable element references without keeping a large tool schema resident. |
| Existing authenticated browser session or cookies are required | `claude-in-chrome`, because it is the route to the user's real Chrome session and tabs. |
| Performance profiling, Lighthouse, or heap snapshots | `chrome-devtools` MCP for capabilities absent from agent-browser. |
| Any other overlap | Do not use the Playwright MCP; agent-browser already wraps the same engine and the additional 23 tool schemas add no unique capability here. |

The default combines three properties: it leaves the user's browser untouched, keeps its schema out of persistent context, and provides a referenceable accessibility tree. Choose another tool only for a capability that requires giving up one of those properties.

## Route by Relevant Prompts

Inject this guidance only when a prompt concerns screenshots, scraping, form
filling, E2E, browsers, or crawling and matches the following detection pattern;
do not make the table an unconditional session-start cost:

```regex
스크린샷|스크랩|폼 채우|E2E|브라우저|크롤|scrape|screenshot
```

Unlike session-start injection, prompt detection approaches zero cost outside
relevant requests.

A redundant tool preference alone is not necessarily a reason for an enforcement hook. Per `component-decision.md`, use a blocking layer only when violation causes enough harm to justify blocking.

## Evidence and Failure Boundaries

The legacy evidence was collected with:

```bash
grep -rn -i "playwright\|chrome\|browser" \
  plugins/*/skills/*/SKILL.md plugins/*/agents/*.md plugins/*/commands/*.md
```

That search returned 7 lines. 5 were false positives from the
`Monochrome Minimal` style name in `pptx-design-styles`; the remaining 2
were the Coupang bot-blocking record at `gws/skills/snack/SKILL.md:160-161`
where agent-browser received HTTP 403. The legacy plugin tree contained no
browser-priority table: the measured count was 0. This file is the first explicit policy, based on
browser ownership, schema cost, and accessibility-tree references.

Preserve site-specific failures as evidence. Some sites block a headless browser,
and the correct response may be to abandon that route rather than switch tools
automatically.
