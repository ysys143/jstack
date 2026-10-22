"""Claude project-directory adapter; sources stay in place."""

from pathlib import Path
from .common import MigrationError, read, records


def encoded(path):
    return str(path).replace("/", "-")


def discover(profiles, old, new):
    keys = {encoded(p).replace("_", "-") for p in (old, new)}
    for profile in profiles:
        projects = Path(profile) / "projects"
        if not projects.is_dir():
            raise MigrationError(f"Claude projects directory missing: {projects}")
        for folder in sorted(projects.iterdir()):
            if folder.is_dir() and folder.name.replace("_", "-") in keys:
                if folder.resolve() != folder:
                    raise MigrationError("Project symlink requires explicit resolution")
                # Encoded project names are not injective (slashes and hyphens
                # collide). Check native transcript metadata before selecting the
                # whole project directory, including its ancillary files.
                for transcript in sorted(folder.glob("*.jsonl")):
                    first_cwd = next(
                        (row.get("cwd") for row in records(read(transcript)) if row.get("cwd")),
                        None,
                    )
                    if first_cwd and first_cwd not in {old, new}:
                        raise MigrationError(
                            "Ambiguous Claude project directory: transcript belongs to another project"
                        )
                for file in sorted(folder.rglob("*")):
                    if file.is_symlink():
                        raise MigrationError(
                            f"Project symlink requires explicit resolution: {file}"
                        )
                    if file.is_file():
                        yield (
                            file,
                            Path("projects") / encoded(new) / file.relative_to(folder),
                            None,
                        )
