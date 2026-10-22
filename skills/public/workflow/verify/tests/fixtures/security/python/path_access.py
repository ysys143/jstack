"""Fixture: safe file access with a root containment check."""
from pathlib import Path
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent

def read_user_path(value: str) -> str:
    candidate = (ROOT / unquote(value)).resolve()
    if ROOT not in candidate.parents and candidate != ROOT:
        return "DENIED"
    try:
        candidate.read_text()
    except OSError:
        return "MISSING"
    return "ALLOWED"

if __name__ == "__main__":
    print(read_user_path(sys.argv[1]))
