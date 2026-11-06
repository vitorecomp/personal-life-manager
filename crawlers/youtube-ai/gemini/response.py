"""Reading Gemini answers: the text (without the model's thinking) and the token usage."""

from typing import Any, Dict, Optional

from google.genai import types


class Blocked(ValueError):
    """The model returned no usable text; `finish_reason` says why (e.g. RECITATION: a verbatim copy)."""

    def __init__(self, message: str, finish_reason: Optional[str] = None) -> None:
        super().__init__(message)
        self.finish_reason = finish_reason


def read_response(response: Optional[types.GenerateContentResponse]) -> Dict[str, Any]:
    """Text and token usage of a response; raises ValueError when there is no usable text."""
    if response is None:
        raise ValueError("empty response")
    candidates = response.candidates or []
    if not candidates:
        feedback = response.prompt_feedback
        reason = getattr(feedback, "block_reason", None) if feedback else None
        raise ValueError(f"no answer from the model (blocked: {reason})" if reason else "no answer from the model")
    candidate = candidates[0]
    parts = candidate.content.parts if candidate.content and candidate.content.parts else []
    text = "".join(part.text for part in parts if part.text and not part.thought).strip()
    finish = candidate.finish_reason.name if candidate.finish_reason else None
    if not text:
        raise Blocked(f"no text in the answer (finish reason: {finish})", finish)
    usage = response.usage_metadata
    return {
        "text": text,
        "finish_reason": finish,
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "cached_tokens": getattr(usage, "cached_content_token_count", None) or 0,
        "output_tokens": getattr(usage, "candidates_token_count", None),
        "thinking_tokens": getattr(usage, "thoughts_token_count", None),
    }
