"""Fixture: shallow patch that only blocks one spelling."""
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent

def read_user_path(value: str) -> str:
    if "../" in value:
        return "DENIED"
    candidate = ROOT / unquote(value)
    try:
        candidate.read_text()
    except OSError:
        return "MISSING"
    return "ALLOWED"

if __name__ == "__main__":
    print(read_user_path(sys.argv[1]))
