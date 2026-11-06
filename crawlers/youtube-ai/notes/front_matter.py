"""Setting a property in a video note's front matter (the youtube-lists sync keeps properties it didn't
write, so they survive later refreshes of the note)."""

import os
import re
import sqlite3


def set_property(path: str, key: str, value: str) -> bool:
    """Set `key: value` in the note's front matter (creating it if needed). Returns True if changed."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    line = f"{key}: {value}"
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
    if match:
        lines = match.group(1).split("\n")
        for index, existing in enumerate(lines):
            if re.match(rf"^{re.escape(key)}\s*:", existing):
                if existing == line:
                    return False
                lines[index] = line
                break
        else:
            lines.append(line)
        updated = "---\n" + "\n".join(lines) + "\n---\n" + text[match.end():]
    else:
        updated = f"---\n{line}\n---\n\n{text}"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(updated)
    return True


def write_category(conn: sqlite3.Connection, notes_dir: str, video_id: str, category: str) -> bool:
    row = conn.execute("SELECT note_path FROM video_detail WHERE video_id = ?", (video_id,)).fetchone()
    if not row or not row["note_path"]:
        return False
    path = os.path.join(notes_dir, row["note_path"])
    return os.path.isfile(path) and set_property(path, "category", category)
