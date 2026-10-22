# marp — default backend for procurement slides

**Why it is the default.** This route retains Markdown as the source. With the
pptx/slidev routes described here, source and output diverge after generation,
requiring manual slide edits for later prose changes. With marp, send the `.md`
through humanize and render again. This provides the slide counterpart of the
`humanize → proof → hwpx` chain.

All four points below were measured on macOS on 2026-08-29.

**Version caveat.** That machine had Homebrew marp **4.1.2** and
`npx @marp-team/marp-cli@latest` **4.5.0**. `ensure_marp.js` prefers marp on PATH,
so the actual invocation used **4.1.2**. Their help text matched, but differing
versions can render the same Markdown differently.

## 1. Hard dependency on Chrome or similar — PDF, PPTX, and image output

Original `--help` excerpt:

```
Browser Options:
  --browser   The kind of browser to use for PDF, PPTX, and image
              [choices: "auto", "chrome", "edge", "firefox"] [default: "auto"]
```

**HTML works without a browser; PDF, PPTX, and images do not.** This explains
`--pdf` failures on clean machines. `ensure_marp.js` distinguishes availability
with exit codes: 0 = all formats, 1 = HTML only, 2 = marp missing.

## 2. Default `--pptx` creates non-editable image slides

Original `--help` excerpt:

```
--pptx            Convert slide deck into PowerPoint document
--pptx-editable   [EXPERIMENTAL] Generate editable PPTX when converting to PPTX
```

Default `--pptx` embeds each slide as an image. Recipients cannot edit its text.

**Do not select marp when editable slides are a required deliverable.** Although
`--pptx-editable` exists, its `[EXPERIMENTAL]` status is unsuitable for relying on
in submissions. Route editable-output requests to the office skill (OfficeCLI);
see the backend decision in SKILL.md.

## 3. `--allow-local-files (NOT SECURE)` is effectively the default procurement path

Original `--help` excerpt:

```
--allow-local-files   Allow to access local files from Markdown while
                      converting PDF, PPTX, or image (NOT SECURE)
```

Local images and fonts require this flag. Procurement slides commonly include
institution logos, organization charts, and figures supplied by the client.

Understand the flag before enabling it: Markdown gains access to local files
during conversion. **Do not enable it for Markdown of unknown origin.** Use it
only for manuscripts we authored.

## 4. Pin the CJK font stack — the default theme has no Korean font

Measured font declaration in HTML rendered from a Korean slide using the default
theme:

```
font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans,
             Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji
```

The declaration contains no explicit CJK font. Noto Sans in this stack covers
Latin; Korean uses the separate Noto Sans KR family. Korean therefore falls back
to browser-selected fonts, making the same Markdown use different fonts across
rendering machines. Procurement output can then overflow or wrap differently.

**Contract: every procurement slide declares a CJK stack.**

```css
/* Minimum contract injected by deck */
section {
  font-family:
    "Pretendard Variable", Pretendard,
    "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic",
    system-ui, sans-serif;
}
```

The ordering uses Pretendard as the commonly used open procurement-document font,
Noto Sans KR as the cross-platform fallback, and Apple SD Gothic Neo (macOS) or
Malgun Gothic (Windows) as final system fallbacks. **Do not specify only
`sans-serif`**; that leaves the same machine-dependent choice as the default theme.

Embedding local font files also requires the `--allow-local-files` flag above.

## Execution

```
# HTML (no browser required)
marp deck.md -o deck.html

# PDF (requires Chrome or similar)
marp deck.md -o deck.pdf --allow-local-files

# Check availability — exit codes report what is possible
node "${JSTACK_PLUGIN_ROOT}/skills/deck/scripts/ensure_marp.js"
```

marp-cli is not bundled. The skill invokes the user's installation;
`ensure_marp.js` reports exit 2 when it is absent.
