"""Where notes live on disk, and moving them without ever overwriting or deleting content."""

import os
import shutil

from config import REF_SUFFIX, REMOVED_DIR, VIDEOS_DIR


def ref_file_name(note_file: str) -> str:
    """'Title [id].md' -> 'Title [id]-ref.md'."""
    return f"{note_file[: -len('.md')]}{REF_SUFFIX}.md"


def note_rel_path(playlist_folder: str, name: str) -> str:
    return f"{playlist_folder}/{VIDEOS_DIR}/{name}"


def removed_rel_path(playlist_folder: str, name: str) -> str:
    """Notes of videos taken out of a playlist are parked here, grouped by the playlist they left."""
    return f"{REMOVED_DIR}/{playlist_folder}/{name}"


def is_removed_path(rel_path: str) -> bool:
    return rel_path.startswith(f"{REMOVED_DIR}/")


def move_note(output_dir: str, src_rel: str, dst_rel: str) -> str:
    """Move a note inside output_dir; never overwrites (adds ' (2)' etc.). Returns the final relative path."""
    src = os.path.join(output_dir, src_rel)
    dst = os.path.join(output_dir, dst_rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    stem, ext = os.path.splitext(dst)
    counter = 2
    while os.path.exists(dst):
        dst = f"{stem} ({counter}){ext}"
        counter += 1
    shutil.move(src, dst)
    return os.path.relpath(dst, output_dir).replace(os.sep, "/")
