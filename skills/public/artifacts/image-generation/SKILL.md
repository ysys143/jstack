---
name: image-generation
description: "Generate or edit images; not SVG diagrams. Triggers: 이미지 생성, 이미지 편집."
---

# Image — generation and editing

## Paths

| Path | Role | Requirements | When |
|---|---|---|---|
| **codex** | `기본` | None; already authenticated | `상시` |
| **nanobanana** | `선택` | Google API key (`GEMINI_API_KEY`); each image is billed to that Google account | `조건:` The user approves the charge for a run that needs direct control over aspect ratio, resolution, or input-image editing |
| **openai** | `선택` | OpenAI CLI and `OPENAI_API_KEY`; each image is billed to that API organization | `조건:` The user approves the charge for a run that needs a control the codex path lacks |

The role and timing columns are declarations with fixed pairings, not free-form prose.

| Role | When | Meaning |
|---|---|---|
| `기본` | `상시` | Always available without preparation; exactly one row |
| `선택` | Starts with `조건:` | Only when prerequisites and the stated condition hold |

Mismatched pairs violate the contract. Combining `기본` with `조건:`, or `선택`
with `상시`, makes the document self-contradictory and routing unreliable.

Codex is the default because it needs no additional preparation. Users can use it
as soon as the plugin is installed. Nanobanana requires each user to obtain and
manage a Google API key, so it remains optional. The nanobanana and openai paths are
never chosen automatically: each bills every image, so it runs only after the user
approves that run (see "Approval for paid paths").

## Path 1: codex (default)

```
codex exec --sandbox workspace-write --skip-git-repo-check \
  '<prompt>. Save the result to <path>.png and print only the saved path on the final line.'
```

Measurement (2026-08-29): requesting bold Korean text "조달" on a white background
produced a 1254×1254 PNG with correct glyph shapes. This is recorded because image
models often mishandle Korean. Longer text can still break; visually inspect results.

- Without `--sandbox workspace-write`, files cannot be written.
- Outside a Git repository, `--skip-git-repo-check` is required.
- Codex generates under `~/.codex/generated_images/` and copies to the requested path.

Limitations: aspect ratio, seed, and upscaling cannot be passed as direct arguments.
They depend on prompt interpretation, reducing control over fixed specifications.
The built-in Codex image tool takes no quality or size argument, so tiers such as
`xhigh` and `max` are unavailable here.

With a ChatGPT sign-in, built-in generation counts toward the Codex usage limits
instead of an API bill. Keep the prompt free of requests for a CLI, the API, or a
model: Codex's own image skill then stays on its built-in tool, while its fallback
CLI bills `OPENAI_API_KEY`. A codex failure is a reason to propose a paid path, not
approval to use it.

## Path 2: nanobanana (Google API key, approval required)

This calls the Gemini image model directly through REST. Without a key, this path
is unavailable.

```
python3 ${JSTACK_PLUGIN_ROOT}/skills/image/scripts/nanobanana.py <prompt> [options]
```

`references/cli.md` lists arguments. The prompt is positional, not `--prompt`;
input images use `-i/--image`.

### Setup guidance for users without a key

Each user must obtain and configure their own key. The plugin does not include
one. Do not share another person's key: their account receives the charges, and
exposure broadens the scope of revocation.

1. Create a key at Google AI Studio (https://aistudio.google.com/apikey). A Google
   account is required, and usage is billed to that account.
2. Configure it using one of the following.

```
# Recommended: a home-directory file applies across projects.
mkdir -p ~/.claude
printf 'GEMINI_API_KEY=YOUR_ISSUED_KEY\n' > ~/.claude/.env.nanobanana
chmod 600 ~/.claude/.env.nanobanana
```

```
# Alternatively, a shell environment variable.
export GEMINI_API_KEY=YOUR_ISSUED_KEY
```

The script uses the first key it finds: the shell environment, then the working
directory's `.env`, then `~/.claude/.env.nanobanana` (`scripts/nanobanana.py:21-28`).
The working directory's `.env` overrides the home configuration, so a project `.env`
containing a different `GEMINI_API_KEY` wins over the home file. A key exported in
the shell wins over both. Check this first if the wrong key is selected.

3. Never place keys in the repository. Ignore `.env` files. If a key was committed,
   removing it from history is insufficient: revoke and replace it immediately.
4. The user installs dependencies; the image skill does not install them on their behalf.

```
uv pip install -r ${JSTACK_PLUGIN_ROOT}/skills/image/requirements.txt
```

5. Verify availability.

```
node ${JSTACK_PLUGIN_ROOT}/skills/image/scripts/probe_backends.js
```

`nanobanana: 사용 가능` indicates availability. The same line identifies the key
source; verify which file is used.

Choose this path for fixed aspect ratio (`-a 16:9`), resolution (`-s 2K`), editing
an existing image (`-i`), or resizing inputs (`-r`). It provides direct control for
fixed-size uses such as slide backgrounds. Each run needs the user's approval under
"Approval for paid paths".

## Path 3: openai (OpenAI API, approval required)

The `openai` CLI calls the OpenAI Images API. Every image is billed to the API
organization of `OPENAI_API_KEY`; a ChatGPT or Codex subscription does not cover it.
The CLI takes its key from `OPENAI_API_KEY` and does not use the Codex sign-in.

Propose it only for a requirement the codex path cannot meet:

- a quality tier such as `xhigh` or `max`, which only the newest GPT Image models offer
- a GPT Image model chosen by name, or an exact pixel size
- the codex path is unavailable, or its usage limit currently blocks generation

Each run needs the user's approval under "Approval for paid paths".

```
openai images generate --model <model> --quality <quality> --size <WxH> \
  --prompt '<prompt>' --name <name> --output-dir <existing directory>
```

- Pass `--model` explicitly. When it is omitted, the CLI's default model depends on
  whether it saves a file.
- `openai help --all images generate` lists the current models, quality tiers, and
  size limits. Read it there; model names change too often to copy here. Arbitrary
  `WxH` sizes apply only to the newest models; older ones accept a few fixed sizes.
- The CLI may parse a flag value containing `:` or braces as YAML. Its documentation
  recommends a YAML request body for such prompts.
- If `OPENAI_API_KEY` is absent, ask the user how to provide it. Never print the key,
  pass it as an argument, or create a key.
- The user installs the CLI (`brew install openai/tools/openai`); the image skill
  does not install it. `openai --version` confirms it.

## Approval for paid paths

Nanobanana and openai bill every image to the user's own API account. Before each
run on either path, ask the user to approve it, stating:

1. The requirement the codex path cannot meet.
2. Path, model, quality, size, and image count.
3. The estimated cost from the provider's current pricing page, looked up for this run, not from memory.

Approval is the user's answer to that statement. A request that names a paid path, a
model, or a tier is not approval, because it comes before the cost is known. A run
is one command with the stated prompt, settings, and count, and approval covers only
that run. A retry, another variant, or a higher tier needs a new approval. Without
approval, stay on the codex path and disclose what it cannot control.

### Price snapshot (checked 2026-10-23)

This table shows the order of magnitude only. Quote the live pricing page in the
approval request; input text and image tokens are charged on top.

| Path | Model | Price per output image |
|---|---|---|
| codex | Built-in Codex image tool | No API charge; uses Codex usage limits 3–5 times faster than turns without images |
| nanobanana | `gemini-nano-banana-2.1` | $0.0336 at 1K, $0.0504 at 2K, $0.113 at 4K |
| openai | GPT Image 2 | At 1024×1024: $0.006 low, $0.053 medium, $0.211 high |
| openai | GPT Image 2.5 | $30 per million image output tokens; the count varies with quality and size |

Pricing pages: https://ai.google.dev/gemini-api/docs/pricing and
https://developers.openai.com/api/docs/pricing; the GPT Image 2 per-image figures come
from https://developers.openai.com/api/docs/guides/image-generation#calculating-costs.
When the nanobanana model changes, update its row together with `MODEL` in
`scripts/nanobanana.py`.

## Ownership boundaries

| Target | Owner | What image must not do |
|---|---|---|
| Structured diagrams: architecture, flows, and relationships | `diagram` | Rasterize editable lines and labels |
| Slide typesetting and layout | `deck` | Bake body text into an image |
| Raster image generation and editing | `image` | — |

Owner names must resolve to real skills. `(미구현)` does not waive existence checks.
If its named target exists, remove the stale annotation. Otherwise use
`(미구현 — reason)` to explain its absence. An unexplained `(미구현)` cannot be
distinguished from an invented destination.

## Phase 0: select a path

```
node ${JSTACK_PLUGIN_ROOT}/skills/image/scripts/probe_backends.js
```

- Both available: choose by requirements; for dimensional control, propose nanobanana
  and wait for approval.
- Only codex: proceed with codex; disclose that exact dimensions may be unavailable.
- Only nanobanana: propose it and wait for approval; without approval, stop.
- Neither available: stop and explain why. The openai path may still be proposed
  under Path 3; do not invent any other fallback.
- The probe reports only codex and nanobanana. Never select the openai path from
  probe results; propose it under the conditions in Path 3. When nanobanana is
  available and meets the requirement, propose it before openai.

## Phase 1: prompt

Use 11 prompt slots (12 for Hero assets). `references/prompts.md` is authoritative
for names, order, and argument mapping. An omitted slot is filled by model defaults;
unexpected results often trace to unspecified slots. For procurement assets, fill
in that reference's assembly example.

- Always inspect Korean text in generated images for broken or invented strokes.
- Assume grayscale printing for procurement material; low-saturation contrast can vanish.
- Text-heavy content is better represented as editable slide elements. The `deck` skill owns
  slide layout. Text embedded in a raster image cannot be edited later.

## Phase 2: inspect

- Do not call the output complete before a person opens it.
- For distribution, verify resolution and aspect ratio against its intended placement.
- Copyright and licensing follow provider terms; the image skill provides no guarantee.

## Explicit limitations

- No backend is bundled. The codex path needs the Codex CLI, nanobanana a Google API
  key, and openai the OpenAI CLI with an API key.
- Structured diagrams and charts belong to `diagram`; route them according to the
  ownership table because text embedded in images cannot be edited later.
- If text must remain editable, do not rasterize it.
