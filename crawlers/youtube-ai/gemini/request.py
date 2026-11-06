"""Build the Gemini requests for a video and read the responses.

Both requests of a video share the same prefix (system instruction, the video, the context prompt) and
differ only in the final task prompt, so Gemini's implicit cache can serve the second one from the first.
"""

from typing import Any, Dict, List, Optional, Tuple

from google.genai import types

from config import INPUT_TOKEN_LIMIT, KINDS, TOKENS_PER_SECOND, VIDEO_TOKEN_BUDGET
from prompting.builder import NO_VERBATIM, render


def choose_resolution(duration_seconds: Optional[int], setting: str) -> Tuple[Optional[str], str]:
    """Media resolution for both calls of a video, or (None, reason) when the video is too long."""
    def fits(resolution: str) -> bool:
        return duration_seconds is None or duration_seconds * TOKENS_PER_SECOND[resolution] <= VIDEO_TOKEN_BUDGET

    if setting in TOKENS_PER_SECOND:
        if fits(setting):
            return setting, ""
        return None, f"too long for the model's input, over ~2.5 hours (~{duration_seconds * TOKENS_PER_SECOND[setting]:,} tokens)"
    if duration_seconds is None:
        return "low", ""
    for resolution in ("high", "low"):
        if fits(resolution):
            return resolution, ""
    return None, f"too long for the model's input, over ~2.5 hours (~{duration_seconds * TOKENS_PER_SECOND['low']:,} tokens)"


def estimate_input_tokens(duration_seconds: Optional[int], resolution: str, prompt_chars: int) -> int:
    video = (duration_seconds or 0) * TOKENS_PER_SECOND[resolution]
    return min(INPUT_TOKEN_LIMIT, video + prompt_chars // 4)


def build_request(video: Dict[str, Any], kind: str, resolution: str, thinking_level: str,
                  max_output_tokens: int, paraphrase: bool = False) -> Tuple[List[types.Content], types.GenerateContentConfig, int]:
    """Contents, config and approximate size (characters of text) of one request. With `paraphrase`,
    prompts/no-verbatim.md is appended to the task (after a RECITATION block); it goes last so the shared
    prefix (system instruction, video, context) stays the same for caching."""
    system = render("system.md", video)
    context = render("context.md", video)
    task = render(KINDS[kind][0], video)
    if paraphrase:
        task = task + "\n" + render(NO_VERBATIM, video)
    contents = [types.Content(role="user", parts=[
        types.Part(file_data=types.FileData(file_uri=video["url"])),
        types.Part(text=context),
        types.Part(text=task),
    ])]
    config = types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=max_output_tokens,
        media_resolution=types.MediaResolution[f"MEDIA_RESOLUTION_{resolution.upper()}"],
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel[thinking_level.upper()]),
    )
    return contents, config, len(system) + len(context) + len(task)
