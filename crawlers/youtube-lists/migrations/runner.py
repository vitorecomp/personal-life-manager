"""Apply database (and notes folder) migrations in order and record them in schema_migrations.

Each migration is a file named NNNN_description.py in this folder with a function

    def migrate(conn: sqlite3.Connection, notes_dir: str) -> None

Migrations are applied once, in order. They must leave a database that already has their change
untouched, because databases created before this table existed are brought up to date by running all
of them. run.sh calls `python migrate.py ...` before every sync; the sync itself refuses to start on a
database with pending migrations.
"""

import importlib.util
import os
import re
import sqlite3
from datetime import datetime, timezone
from typing import List, Tuple

COMPONENT = "youtube-lists"
MIGRATIONS_DIR = os.path.dirname(os.path.abspath(__file__))
FILE_RE = re.compile(r"^(\d{4})_(\w+)\.py$")

TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    component  TEXT NOT NULL,
    version    TEXT NOT NULL,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (component, version)
)
"""


def available() -> List[Tuple[str, str, str]]:
    """(version, name, path) of every migration file, in order."""
    found = []
    for entry in sorted(os.listdir(MIGRATIONS_DIR)):
        match = FILE_RE.match(entry)
        if match:
            found.append((match.group(1), match.group(2), os.path.join(MIGRATIONS_DIR, entry)))
    return found


def applied(conn: sqlite3.Connection) -> set:
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone():
        return set()
    return {row[0] for row in conn.execute("SELECT version FROM schema_migrations WHERE component = ?", (COMPONENT,))}


def pending(conn: sqlite3.Connection) -> List[Tuple[str, str, str]]:
    done = applied(conn)
    return [m for m in available() if m[0] not in done]


def run(db_path: str, notes_dir: str) -> List[str]:
    """Apply every pending migration; returns the names applied."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(TABLE)
    conn.commit()
    names = []
    for version, name, path in pending(conn):
        spec = importlib.util.spec_from_file_location(f"migration_{version}", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.migrate(conn, notes_dir)
        conn.execute(
            "INSERT INTO schema_migrations (component, version, name, applied_at) VALUES (?, ?, ?, ?)",
            (COMPONENT, version, name, datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        conn.commit()
        names.append(f"{version}_{name}")
    conn.close()
    return names
