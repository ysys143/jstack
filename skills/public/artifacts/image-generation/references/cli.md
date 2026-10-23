# nanobanana CLI contract (from the implementation)

**This table was derived directly from `add_argument` in `scripts/nanobanana.py`.**
The upstream `README.md` examples disagreed with the implementation: they used
`--prompt` instead of a positional argument and `--input` instead of `-i/--image`.
That README was not imported; this document is the canonical CLI reference.

## Arguments

| Argument | Form | Value | Description |
|---|---|---|---|
| `text` | **Positional** | String | Prompt. **Not `--prompt`** |
| `-i`, `--image` | Option | Path | Input image (editing mode) |
| `-r`, `--resolution` | Option | `WxH` (e.g. `512x512`) | Resize the input image to these dimensions |
| `-g`, `--generate` | Flag | — | **Enable image generation** |
| `-a`, `--aspect-ratio` | Option | `1:1` `16:9` `9:16` `21:9` `4:3` `3:4` | Output aspect ratio |
| `-s`, `--size` | Option | `1K` `2K` `4K` | Output size |
| `-o`, `--output` | Option | Path | Output file (default `output.png`); its extension (`.png`, `.jpg`, `.jpeg`, `.webp`) sets the saved format |

**Omitting `-g` does not generate an image.** Without this flag, the script queries
or analyzes an input image. Check this flag first if generation returns an empty
response.

## Examples

```
# Generate: 16:9, 2K; Korean lettering is the actual image content
python3 nanobanana.py "Bold black Korean text '조달' on a white background" -g -a 16:9 -s 2K -o cover.png

# Edit: resize the input image to 512x512 before transformation
python3 nanobanana.py "Change the background to white" -i input.jpg -r 512x512 -g -o edited.png

# Analyze: no -g
python3 nanobanana.py "What is in this image?" -i photo.jpg
```

## Prerequisites

- `GEMINI_API_KEY`: the first found among the environment variable, the working
  directory's `.env`, and `~/.claude/.env.nanobanana`.
  **The script exits immediately if absent** (`nanobanana.py:68-70`).
- The API chooses the image encoding, often JPEG. The script re-encodes the result to
  the format the `-o` extension names. Before it sends the billed request, it rejects
  any other extension and a directory that does not exist.
- Dependencies: `google-genai`, `Pillow`, and `python-dotenv`; see `requirements.txt`.
  **The user installs these explicitly.** This skill does not install them.

## Model

The `MODEL` constant in `scripts/nanobanana.py:15` is authoritative. Do not copy
the model name here: two declarations drift, and model names change frequently.
