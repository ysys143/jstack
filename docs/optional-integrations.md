# Optional Python integrations

jstack's core runtime requires Node 20 or newer. These environments are for selected
external tools; `doctor` never creates them, downloads packages, installs uv, or
writes authentication settings. Choose only the feature needed for the task.

The authoritative inventory is
[`specialists.json`](../contracts/ts-migration/specialists.json). Its dependency
locks were resolved with uv for Python 3.10 using universal resolution and
package hashes. Resolution does **not** prove wheel availability on an old OS,
working output, or native Windows/Linux/macOS parity. Each feature remains
`not_run` and `not_accepted` until its output scenario below is executed on the
target platform. Do not raise the Node floor to resolve a Python tool limitation.

## Create one isolated environment

Install uv using the [official standalone installer](https://docs.astral.sh/uv/getting-started/installation/):

```sh
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```powershell
# Windows PowerShell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Reopen the terminal if needed, then check `uv --version`. The commands below
explicitly install Python and the selected feature's dependencies. Run them only when that feature has been selected.
Examples use `image`; substitute an ID from the table for all three paths.
Run from the jstack package directory containing `contracts/ts-migration`.

macOS/Linux:

```sh
uv python install 3.10
uv venv --python 3.10 "$HOME/.jstack/tools/image"
uv pip sync --python "$HOME/.jstack/tools/image/bin/python" --require-hashes --only-binary :all: contracts/ts-migration/specialists/image.lock.txt
"$HOME/.jstack/tools/image/bin/python" -c 'import requests, PIL, dotenv'
```

Windows PowerShell:

```powershell
uv python install 3.10
uv venv --python 3.10 "$HOME\.jstack\tools\image"
uv pip sync --python "$HOME\.jstack\tools\image\Scripts\python.exe" --require-hashes --only-binary :all: contracts/ts-migration/specialists/image.lock.txt
& "$HOME\.jstack\tools\image\Scripts\python.exe" -c "import requests, PIL, dotenv"
```

Use the environment's Python explicitly to launch the feature script. Do not use
global pip or rely on whichever Python happens to appear first on PATH. `sync`
makes this a feature-owned environment; never point it at an unrelated project
or user environment. The binary-only option fails when a compatible wheel is
missing; inspect that platform limitation instead of implicitly invoking compilers.
If Python 3.10 cannot be installed on the machine, record that feature as blocked.

## Feature dependencies and acceptance

| Environment ID | Actual dependencies | Required output scenario |
|---|---|---|
| `deck` | python-pptx, Pillow, fpdf2, PyMuPDF | Assemble image slides, open the resulting PPTX, and extract/rasterize a fixture PDF with `--skip-upscale`; verify slide/page count and dimensions. |
| `deck-image` | Combined deck and image dependencies | Convert a fixture PDF with explicitly authorized upscaling; inspect the resulting PPTX and images. |
| `image` | requests, Pillow, python-dotenv | Run a task-authorized Gemini request, inspect the produced image and requested dimensions; imports alone do not authenticate the key. |
| `hwpx` | lxml | Generate and validate a fixture HWPX; open it in the target reader and inspect XML namespace/order and rendered content. |
| `hwpx-windows` | lxml, pywin32 | On native Windows with licensed Hancom Office, convert a fixture `.hwp` via COM and validate/open the result. |
| `diagram-fonts` | fontTools with WOFF support, brotli | Subset an explicitly selected, embeddable font and inspect the output glyph coverage and rendered diagram. |

Each ID has a reviewed `.in` input and a generated `.lock.txt` under
`contracts/ts-migration/specialists/`. The manifest contains import-check commands
and source paths. Deck upscaling additionally uses image dependencies and a key;
use the provided `deck-image` lock in a dedicated `deck-image` environment. Two successive `uv pip sync` commands would remove the first
feature's dependencies and are not a valid combined setup.

Marp, a browser, OfficeCLI, Google Workspace CLI, and hyperresearch are separate
optional executables. Install them explicitly according to the selected skill.
A detected executable or account directory is inventory evidence, not proof of
successful authentication or document rendering. OfficeCLI diagnosis does not
invoke `npx --yes`, because that would install during a check.

The image requirements file now declares the previously missing `requests`
dependency and retains `google-genai` for compatibility. The dedicated image lock
follows the actual `nanobanana.py` imports.
No Google API key or credential value belongs in these files. Existing key-file
and `.env` precedence remains the image script's contract.

## Science, GPU tools, and WSL

The science catalog is upstream-owned and has per-skill requirements. Select the
specific `SKILL.md`, read its dependency manifest, and create a separate uv
environment with that manifest's Python version. The catalog's repository-level
Python 3.13 requirement belongs to its tooling and is not the jstack core minimum.
The AlphaGenome project declares Python >=3.10. Neither declaration proves that
every science integration shares the same requirement or runs on Windows.

Keep upstream licenses, scripts, and internal paths. Resolve a feature-specific
lock before installation, record the input manifest and Python version, and run
the skill's real sample with available data/hardware. Record unavailable GPU,
service credentials, licensed software, and hardware as blockers. Never install
all science dependencies as part of jstack installation or diagnosis.

Use WSL only when explicitly selected for a Linux-specific feature. Create its
Python environment inside WSL and execute the entire pipeline there. Native
Windows Hancom COM does not become available inside WSL. Cross-platform
acceptance requires an actual run on each claimed native/WSL backend.

jstack-owned YAML checkers are migration work, not specialist exceptions. Their
historical PyYAML imports must be removed when those checkers move to TS; the
specialist policy does not authorize retaining Python as a core prerequisite.
