"""The categories table in prompts/categories.md: name, action (full | knowledge | skip), description."""

import os
import re
from dataclasses import dataclass
from typing import Dict, List

from config import ACTION_KINDS


@dataclass(frozen=True)
class Category:
    name: str
    action: str
    description: str


class CategoriesError(RuntimeError):
    pass


ROW_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$")


def load_categories(prompts_dir: str) -> Dict[str, Category]:
    path = os.path.join(prompts_dir, "categories.md")
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError as exc:
        raise CategoriesError(f"cannot read {path}: {exc}") from None
    categories: Dict[str, Category] = {}
    for number, line in enumerate(lines, start=1):
        match = ROW_RE.match(line)
        if not match:
            continue
        name, action, description = match.groups()
        if name.lower() == "category" or set(name) <= set(":- "):
            continue  # header and separator rows
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name):
            raise CategoriesError(f"{path}, line {number}: category '{name}' must be lowercase kebab-case")
        if action not in ACTION_KINDS:
            raise CategoriesError(f"{path}, line {number}: action '{action}' must be one of {', '.join(ACTION_KINDS)}")
        categories[name] = Category(name, action, description)
    if not categories:
        raise CategoriesError(f"{path} has no categories table")
    if "unknown" not in categories:
        raise CategoriesError(f"{path} must keep an 'unknown' category (used for videos without metadata)")
    return categories


def category_list(categories: Dict[str, Category]) -> List[Category]:
    return list(categories.values())
