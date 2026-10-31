"""Load the editable Markdown templates (md-templates/) and render them with Jinja2."""

import os
from datetime import datetime, timezone
from typing import Any, Optional

from utils.text import fence, format_date, format_duration, md_escape

DEFAULT_TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "md-templates")
TEMPLATE_NAMES = ("playlist.md", "video.md", "video-ref.md")

_env = None


class TemplateSetupError(RuntimeError):
    pass


def _md(value: Any) -> str:
    return md_escape(str(value)) if value not in (None, "") else ""


def _link(text: Any, url: Optional[str]) -> str:
    """Markdown link when both are present, escaped text when only the text is, else ''."""
    if not text:
        return ""
    return f"[{_md(text)}]({url})" if url else _md(text)


def _number(value: Optional[int]) -> str:
    return f"{value:,}" if value is not None else "unknown"


def _yesno(value: Optional[int]) -> str:
    return {1: "Yes", 0: "No"}.get(value, "Unknown")


def _blockquote(text: Optional[str], prefix: str = "> ") -> str:
    return "\n".join(prefix + line for line in ((text or "").splitlines() or [""]))


def _timestamp_date(value: Optional[int]) -> str:
    return datetime.fromtimestamp(value, timezone.utc).strftime("%Y-%m-%d") if value else "unknown date"


def configure(templates_dir: Optional[str] = None) -> None:
    """Create the Jinja2 environment and check every template parses, before any work is done."""
    global _env
    try:
        import jinja2
    except ImportError:
        raise TemplateSetupError(
            "jinja2 is not installed; run through run.sh, or `pip install -r requirements.txt`"
        ) from None
    directory = templates_dir or DEFAULT_TEMPLATES_DIR
    missing = [n for n in TEMPLATE_NAMES if not os.path.isfile(os.path.join(directory, n))]
    if missing:
        raise TemplateSetupError(f"missing template(s) in {directory}: {', '.join(missing)}")
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(directory),
        undefined=jinja2.StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
        autoescape=False,
    )
    env.filters.update(
        md=_md,
        link=_link,
        number=_number,
        yesno=_yesno,
        blockquote=_blockquote,
        fence=lambda text: "\n".join(fence(text or "")),
        date=format_date,
        duration=format_duration,
        timestamp_date=_timestamp_date,
    )
    for name in TEMPLATE_NAMES:
        try:
            env.get_template(name)
        except jinja2.TemplateSyntaxError as exc:
            raise TemplateSetupError(f"{directory}/{name}, line {exc.lineno}: {exc.message}") from None
    _env = env


def render(name: str, **context: Any) -> str:
    import jinja2

    if _env is None:
        configure()
    try:
        return _env.get_template(name).render(**context)
    except jinja2.TemplateError as exc:
        raise TemplateSetupError(f"template {name}: {exc}") from None
