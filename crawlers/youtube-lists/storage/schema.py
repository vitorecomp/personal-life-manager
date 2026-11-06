"""Opening the database. The schema itself is created and upgraded by the files in migrations/."""

import os
import sqlite3

from migrations.runner import pending


class MigrationsPending(RuntimeError):
    pass


def open_db(path: str) -> sqlite3.Connection:
    """Open the database; refuse to work on one with pending migrations (run.sh applies them first)."""
    if not os.path.exists(path):
        raise MigrationsPending(f"{path} does not exist yet; create it with: python migrate.py --db ... --notes-dir ...")
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    todo = pending(conn)
    if todo:
        conn.close()
        names = ", ".join(f"{version}_{name}" for version, name, _path in todo)
        raise MigrationsPending(f"{path} needs migrations ({names}); run: python migrate.py --db ... --notes-dir ...")
    return conn
