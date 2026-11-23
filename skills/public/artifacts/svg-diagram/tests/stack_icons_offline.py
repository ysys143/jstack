"""Offline contract for the vendored stack-diagram fetch_icons.py.

Usage: python3 -I -S stack_icons_offline.py PATH/TO/fetch_icons.py

Upstream ships no tests for its scripts. This harness loads the given file, replaces
its network function `get` with a fixture map, and runs `main()` in temporary
directories, so no request leaves the process. It prints one PASS or FAIL line per
contract and exits 1 when any contract fails.
"""
import contextlib
import importlib.util
import io
import json
import pathlib
import sys
import tempfile

LOGO = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        b'<path fill="#E36002" d="M0 0h24v24H0z"/></svg>')
DARK = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        b'<path fill="#FFFFFF" d="M2 2h20v20H2z"/></svg>')
WHITE = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
         b'<path fill="#ffffff" d="M0 0h24v24H0z"/></svg>')
WEBP = b"RIFF\x40\x00\x00\x00WEBPVP8 " + b"\x00" * 64

SVGL = "https://api.svgl.app?search="
DEVICON = "https://raw.githubusercontent.com/devicons/devicon/master/icons/{0}/{0}-original.svg"

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS: " if ok else "FAIL: ") + name + ("" if ok else " -- " + detail))


def load(path):
    spec = importlib.util.spec_from_file_location("fetch_icons_under_test", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(module, outdir, specs, served):
    requested = []

    def fake_get(url, timeout=15):
        requested.append(url)
        if url in served:
            return served[url]
        raise OSError("offline fixture has no " + url)

    module.get = fake_get
    module.PACKAGES.clear()
    saved = sys.argv
    sys.argv = ["fetch_icons.py", str(outdir), *specs]
    out = io.StringIO()
    code = 0
    try:
        with contextlib.redirect_stdout(out):
            module.main()
    except SystemExit as stop:
        code = stop.code if isinstance(stop.code, int) else 1
    finally:
        sys.argv = saved
    return code, out.getvalue(), requested


def manifest(outdir):
    path = outdir / "manifest.json"
    return json.loads(path.read_text()) if path.exists() else {}


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    module = load(sys.argv[1])
    bypassed = []

    def refuse(request, *args, **kwargs):
        bypassed.append(getattr(request, "full_url", request))
        raise OSError("network disabled in the offline contract")

    # Any request that bypasses `get` is recorded and refused, never sent.
    module.urllib.request.urlopen = refuse
    every_request = []
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)

        # A fuzzy svgl hit must fall through to the next source.
        out = root / "fallback"
        served = {SVGL + "hono": b'[{"title": "Hono Router", "route": "https://svgl.app/library/wrong.svg"}]',
                  DEVICON.format("hono"): LOGO}
        code, text, requested = run(module, out, ["hono"], served)
        every_request += requested
        entry = manifest(out).get("hono", {})
        check("fallback: a non-exact svgl title is not used", "https://svgl.app/library/wrong.svg" not in requested, str(requested))
        check("fallback: devicon supplies the mark after svgl misses", code == 0 and entry.get("source") == "devicon", text)
        check("never recolor: the written mark equals the served bytes",
              (out / "hono.svg").exists() and (out / "hono.svg").read_bytes() == LOGO, text)

        # An exact svgl title with a light/dark split writes both variants unchanged.
        out = root / "split"
        served = {SVGL + "nextjs": b'[{"title": "Next.js", "route": {"light": "https://svgl.app/library/nextjs_light.svg", "dark": "https://svgl.app/library/nextjs_dark.svg"}}]',
                  "https://svgl.app/library/nextjs_light.svg": LOGO,
                  "https://svgl.app/library/nextjs_dark.svg": DARK}
        code, text, requested = run(module, out, ["nextjs"], served)
        every_request += requested
        entry = manifest(out).get("nextjs", {})
        check("svgl: the exact title wins and the light variant is the tile mark",
              code == 0 and entry.get("source") == "svgl" and (out / "nextjs.svg").read_bytes() == LOGO, text)
        check("svgl: the dark variant is saved unchanged for group labels",
              entry.get("dark_file") == "nextjs_dark.svg" and (out / "nextjs_dark.svg").read_bytes() == DARK, text)

        # A white mark is flagged, not recolored.
        out = root / "white"
        code, text, requested = run(module, out, ["ghost"], {DEVICON.format("ghost"): WHITE})
        every_request += requested
        entry = manifest(out).get("ghost", {})
        check("white fill: flagged for a dark plate and left unchanged",
              code == 0 and entry.get("white_fill") is True and (out / "ghost.svg").read_bytes() == WHITE, text)

        # An explicit official URL keeps its raster type.
        out = root / "explicit"
        code, text, requested = run(module, out, ["orpc=https://example.invalid/logo.webp"],
                                    {"https://example.invalid/logo.webp": WEBP})
        every_request += requested
        check("explicit URL: a WebP mark is written as .webp",
              code == 0 and (out / "orpc.webp").read_bytes() == WEBP and manifest(out)["orpc"]["source"] == "explicit", text)

        # A re-fetch removes the previous file so the builder cannot embed a stale mark.
        out = root / "refetch"
        out.mkdir()
        (out / "hono.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        code, text, requested = run(module, out, ["hono"], {DEVICON.format("hono"): LOGO})
        every_request += requested
        check("re-fetch: the old file of another type is removed",
              code == 0 and not (out / "hono.png").exists() and (out / "hono.svg").exists(), text)

        # A name that is not a plain token is refused before any file is written.
        out = root / "names" / "icons"
        code, text, requested = run(module, out, ["../escape:hono"], {DEVICON.format("hono"): LOGO})
        every_request += requested
        written = sorted(p.name for p in (root / "names").rglob("*") if p.is_file() and p.name != "manifest.json")
        check("names: a path-like name is refused and nothing is written",
              code == 1 and "SKIP" in text and written == [], text + str(written))

        # Every source missing fails loudly and writes no mark.
        out = root / "missing"
        code, text, requested = run(module, out, ["nosuchbrand"], {})
        every_request += requested
        check("missing: exit 1 with a FAIL line and no mark file",
              code == 1 and "FAIL nosuchbrand" in text and not list(out.glob("nosuchbrand.*")), text)

    check("sources: simple-icons is never requested",
          not any("simple-icons" in url for url in every_request), str([u for u in every_request if "simple-icons" in u]))
    check("network: no request bypassed the fixture function", bypassed == [], str(bypassed))
    failed = results.count(False)
    print(f"stack-diagram offline: {len(results) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
