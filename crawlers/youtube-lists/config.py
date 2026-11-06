"""Shared constants."""


PLAYLISTS_FEED_URL = "https://www.youtube.com/feed/playlists"


SPECIAL_PLAYLISTS = {
    "WL": "Watch Later",
    "LL": "Liked videos",
}


CSV_FIELDS = [
    "playlist_id",
    "playlist_title",
    "playlist_url",
    "position",
    "video_id",
    "video_title",
    "video_url",
    "channel",
    "duration_seconds",
]


AI_FLAGS = ("summary", "videos-ai-description")


# Inside each playlist folder: full video notes, plus "-ref" notes for videos owned by another playlist.
VIDEOS_DIR = "videos"


REF_SUFFIX = "-ref"


# Root-level folder (next to the playlist folders) where notes of videos removed from playlists are kept.
REMOVED_DIR = "removed"


# Fields dropped from the stored raw_json: bulky and/or regenerated on every extraction.
RAW_JSON_DROP = {
    "formats", "thumbnails", "automatic_captions", "subtitles", "requested_formats",
    "requested_downloads", "requested_subtitles", "http_headers", "comments", "heatmap",
    "_format_sort_fields", "epoch",
}


# yt-dlp error fragments meaning the video itself is gone, so retrying will never help.
PERMANENT_FAILURES = (
    "private video", "video unavailable", "this video is not available", "no longer available",
    "has been removed", "removed by the uploader", "account associated with this video has been terminated",
    "members-only", "this video is unavailable", "this video has been", "this video is private",
)


# A playlist or video missing from a fetch that looks incomplete (or a playlist missing from the account
# feed) is only flagged as removed after being missing in this many consecutive runs.
CONFIRM_RUNS = 2


# What YouTube lists in place of a private or deleted video; must never overwrite a real title.
PLACEHOLDER_TITLES = ("[Private video]", "[Deleted video]")


# Re-checking details that were incomplete or unavailable when first fetched.
RETRY_RECENT_DAYS = 14          # uploads this young keep being re-checked for captions...


RETRY_RECENT_INTERVAL_DAYS = 1  # ...at most once a day


RETRY_OLD_INTERVAL_DAYS = 30    # older videos without captions: one re-check per month...


RETRY_OLD_MAX_ATTEMPTS = 3      # ...until they have been checked this many times in total


UNAVAILABLE_RECHECK_DAYS = 30   # private/deleted videos are re-checked this often
