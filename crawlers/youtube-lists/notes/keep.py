"""Protected regions in notes: text between keep markers survives every rewrite.

    <!-- keep -->                 unnamed block (added by hand): kept in the section it was in
    ...text...
    <!-- /keep -->

    <!-- keep:name -->...<!-- /keep:name -->
                                  named block (usually from a template): the template's text is only the
                                  default for new notes; once the note exists, its own text is kept

Markers are HTML comments, so Markdown previews (Obsidian included) don't show them. Named blocks may be
inline; unnamed blocks must start and end on lines of their own.
"""

import re
from typing import List, Optional, Tuple

BLOCK_RE = re.compile(
    r"<!--\s*keep(?::\s*(?P<name>[\w.-]+))?\s*-->(?P<body>.*?)<!--\s*/keep(?::\s*(?P=name))?\s*-->",
    re.DOTALL,
)
HEADING_RE = re.compile(r"^(#{1,6})\s+\S.*$", re.MULTILINE)


def _blocks(text: str) -> List[Tuple[Optional[str], str, int, int]]:
    return [(m.group("name"), m.group(0), m.start(), m.end()) for m in BLOCK_RE.finditer(text)]


def _section_heading(text: str, position: int) -> Optional[str]:
    """The last Markdown heading line before `position`, if any."""
    heading = None
    for match in HEADING_RE.finditer(text, 0, position):
        heading = match.group(0)
    return heading


FRONT_MATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


def split_front_matter(text: str) -> Tuple[List[str], str]:
    """(front matter lines, rest of the note); no front matter gives ([], text)."""
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return [], text
    return match.group(1).split("\n"), text[match.end():]


def _key(line: str) -> Optional[str]:
    match = re.match(r"^([A-Za-z0-9_-]+)\s*:", line)
    return match.group(1) if match else None


def merge_front_matter(old: str, new: str) -> str:
    """Keep front matter properties of the existing note that the template doesn't write (e.g. a category
    added by crawlers/youtube-ai, or properties you added in Obsidian). Template properties win."""
    old_lines, _ = split_front_matter(old)
    new_lines, body = split_front_matter(new)
    if not old_lines:
        return new
    new_keys = {_key(line) for line in new_lines if _key(line)}
    extra, keeping = [], False
    for line in old_lines:
        key = _key(line)
        if key is not None:
            keeping = key not in new_keys
        if keeping:
            extra.append(line)  # includes indented continuation lines of a kept property
    if not extra:
        return new
    return "---\n" + "\n".join(new_lines + extra) + "\n---\n" + body


def normalize(text: str) -> str:
    """The note without front matter and keep blocks, whitespace collapsed: editing properties or keep
    blocks (and the blank lines around them) never counts as a change to the note."""
    _lines, body = split_front_matter(text)
    return " ".join(BLOCK_RE.sub(" ", body).split())


def normalize_with_front_matter(text: str) -> str:
    """How notes were normalized before front matter was ignored (to accept hashes stored back then)."""
    return " ".join(BLOCK_RE.sub(" ", text).split())


def extract_blocks(text: str) -> List[str]:
    return [block for _name, block, _start, _end in _blocks(text)]


def append_blocks(text: str, blocks: List[str]) -> str:
    """Add blocks at the end of `text`, skipping any it already contains."""
    for block in blocks:
        if block not in text:
            text = _insert_in_section(text, None, block)
    return text


def merge(old: str, new: str) -> str:
    """Carry the keep blocks and extra front matter properties of the existing note (`old`) into a freshly
    rendered one (`new`)."""
    new = merge_front_matter(old, new)
    old_blocks = _blocks(old)
    if not old_blocks:
        return new

    leftovers: List[Tuple[Optional[str], str]] = []
    new_names = {name for name, *_ in _blocks(new) if name}
    kept_named = {}
    for name, block, start, _end in old_blocks:
        if name and name in new_names and name not in kept_named:
            kept_named[name] = block
        else:
            leftovers.append((_section_heading(old, start), block))

    if kept_named:
        new = BLOCK_RE.sub(lambda m: kept_named.get(m.group("name"), m.group(0)) if m.group("name") else m.group(0), new)

    for heading, block in leftovers:
        new = _insert_in_section(new, heading, block)
    return new


def _insert_in_section(text: str, heading: Optional[str], block: str) -> str:
    """Put `block` at the end of the section under `heading` (or at the end of the note)."""
    end = len(text)
    if heading is not None:
        lines = text.split("\n")
        level = len(heading) - len(heading.lstrip("#"))
        for index, line in enumerate(lines):
            if line == heading:
                end_line = len(lines)
                for later in range(index + 1, len(lines)):
                    match = HEADING_RE.match(lines[later])
                    if match and len(match.group(1)) <= level:
                        end_line = later
                        break
                end = len("\n".join(lines[:end_line]))
                break
    before, after = text[:end].rstrip("\n"), text[end:].lstrip("\n")
    joined = f"{before}\n\n{block}\n"
    return joined + (f"\n{after}" if after else "")
