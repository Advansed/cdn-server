#!/usr/bin/env python3
"""Add the CDN location include to the existing TLS site, leaving the app in place."""

import re
import sys
from pathlib import Path

INCLUDE = "include /etc/nginx/snippets/cdn-location.conf;"
HOST = "reg.aostng.ru"
BACKUP_DIR = Path("/root/nginx-backup")


def server_blocks(text: str):
    blocks = []
    for match in re.finditer(r"(?m)^[ \t]*server\s*\{", text):
        brace = match.end() - 1
        depth = 0
        for index in range(brace, len(text)):
            char = text[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    blocks.append((match.start(), index + 1))
                    break
    return blocks


def main() -> None:
    files: list[Path] = []
    for root in (Path("/etc/nginx/sites-enabled"), Path("/etc/nginx/conf.d")):
        if root.is_dir():
            files.extend(sorted(path for path in root.iterdir() if path.is_file()))

    chosen = None
    for path in files:
        text = path.read_text(encoding="utf-8")
        for start, end in server_blocks(text):
            block = text[start:end]
            if HOST in block and re.search(r"listen[^;]*\b443\b", block):
                chosen = (path, text, end, block)
                break
        if chosen:
            break

    if chosen is None:
        print("no TLS server block for reg.aostng.ru", file=sys.stderr)
        sys.exit(1)

    path, text, end, block = chosen
    if INCLUDE in block:
        print(f"cdn location already included in {path}")
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f"{path.name}.bak"
    backup.write_text(text, encoding="utf-8")
    updated = text[: end - 1] + "\n    " + INCLUDE + "\n" + text[end - 1 :]
    path.write_text(updated, encoding="utf-8")
    print(f"inserted cdn location into {path} (backup {backup})")


if __name__ == "__main__":
    main()
