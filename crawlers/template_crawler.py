"""
Base template for Second Brain crawlers.
"""

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Dict, List, Optional
import json


@dataclass
class IngestionDocument:
    id: str
    source: str
    url: str
    title: str
    author: Optional[str]
    published_at: Optional[str]
    fetched_at: str
    raw_content: str
    clean_content: str
    metadata: Dict[str, object]

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)


class BaseCrawler:
    """Base class for all crawler implementations."""

    def __init__(self, source_name: str):
        self.source_name = source_name

    def fetch(self, url: str) -> str:
        """Fetch raw content from a given URL."""
        raise NotImplementedError

    def parse(self, raw_content: str) -> IngestionDocument:
        """Parse raw content into a normalized IngestionDocument."""
        raise NotImplementedError

    def run(self, url: str) -> IngestionDocument:
        """Execute extraction pipeline for a single target."""
        raw = self.fetch(url)
        return self.parse(raw)
